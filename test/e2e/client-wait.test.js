// test/e2e/client.mjs waitForFunctionLong (Node, no browser): a long wait of the real-server browser suites polls in
// slices shorter than the CDP protocol timeout. A plain page.waitForFunction runs its whole poll inside one
// Runtime.callFunctionOn, which the 90 s protocol timeout cut off: watch-bonds.e2e's "own battle over" wait (240 s) failed
// with a bare "Waiting failed" whenever the own battle at 1× lasted longer than 90 s (0.1.4 release candidate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, PROTOCOL_TIMEOUT_MS, waitForFunctionLong } from './client.mjs';

const timeoutError = (ms) => Object.assign(new Error(`Waiting failed: ${ms}ms exceeded`), { name: 'TimeoutError' });

/** A page whose predicate turns true after `trueAfter` ms; each waitForFunction slice behaves like puppeteer's. */
function fakePage(trueAfter) {
  const t0 = Date.now();
  const calls = [];
  return {
    calls,
    /** The origin of the fake predicate's timeline (test 1 derives its slice count from it). */
    t0,
    waitForFunction(fn, opts, ...args) {
      // `at` = when the slice STARTED: a real setTimeout overshoots its delay by a few ms under load, so the number of
      // slices a predicate needs is a property of the timeline, never of a single hard-coded call count
      calls.push({ fn, opts, args, at: Date.now() });
      const left = t0 + trueAfter - Date.now();
      return new Promise((resolve, reject) => {
        if (left <= opts.timeout) setTimeout(() => resolve({ handle: 'ok', args }), Math.max(0, left));
        else setTimeout(() => reject(timeoutError(opts.timeout)), opts.timeout);
      });
    },
  };
}

test('a wait longer than one slice keeps polling the same predicate until it holds', async () => {
  // The predicate turns true 95 ms in: with 30 ms slices the timeline asks for ⌈95/30⌉ = 4 polls, but a real setTimeout
  // overshoots its delay under load, so a busy machine merges slices and legitimately needs fewer calls. The count is
  // therefore NEVER asserted (a hard-coded one was the old flake, and a derived lower bound flakes again when the whole
  // suite saturates the CPU and several timers land late at once): what is under test is that the wait SLICES at all,
  // that every slice honours the cap, and that the wait ends only once the predicate can hold.
  const TRUE_AFTER = 95;
  const SLICE = 30;
  const TOL = 5; // clock granularity: Date.now() and the timer callback are not the same instant
  const page = fakePage(TRUE_AFTER);
  const fn = () => true;
  const got = await waitForFunctionLong(page, fn, { timeout: 1000, polling: 200, slice: SLICE }, 'a', 2);
  assert.deepEqual(got, { handle: 'ok', args: ['a', 2] });
  // it sliced at all: the whole wait was never handed to one waitForFunction
  assert.ok(page.calls.length > 1, `sliced (${page.calls.length} calls)`);
  for (const c of page.calls) {
    assert.equal(c.fn, fn);
    assert.deepEqual(c.args, ['a', 2]);
    assert.equal(c.opts.polling, 200);
    assert.ok(c.opts.timeout > 0 && c.opts.timeout <= SLICE, `slice ${c.opts.timeout}`);
  }
  // The wait must never come back before the predicate could hold — that is the old flake's bug (a slice that ended
  // early resolved the wait while the predicate was still false). Note what is deliberately NOT asserted: that every
  // call but the last timed out. A single overshooting timer under load can legitimately leave only two calls, the
  // second of which resolves, so pinning "which call resolved" is what makes such a test flaky on a loaded machine.
  const startedAt = (i) => page.calls[i].at - page.t0;
  const resolvedAt = startedAt(page.calls.length - 1) + page.calls.at(-1).opts.timeout;
  assert.ok(resolvedAt >= TRUE_AFTER - TOL,
    `the wait returned ${resolvedAt}ms in, before the predicate could hold (${TRUE_AFTER}ms)`);
  assert.ok(Date.now() - page.t0 >= TRUE_AFTER - TOL, `real elapsed time also covers the predicate (${Date.now() - page.t0}ms)`);
});

test('the overall timeout still ends the wait with a TimeoutError naming it; the last slice is the remainder', async () => {
  const page = fakePage(10_000);
  const t0 = Date.now();
  await assert.rejects(waitForFunctionLong(page, () => false, { timeout: 70, slice: 30 }), (e) => e.name === 'TimeoutError' && /70ms exceeded/.test(e.message));
  assert.ok(Date.now() - t0 >= 65, 'not before the deadline');
  assert.ok(page.calls.at(-1).opts.timeout <= 30);
  assert.ok(page.calls.reduce((n, c) => n + c.opts.timeout, 0) <= 75, 'the slices add up to the timeout');
});

test('any other failure is not retried (a page error, a detached frame, the protocol timeout itself)', async () => {
  for (const err of [new Error('Waiting failed'), Object.assign(new Error('boom'), { name: 'ProtocolError' })]) {
    let n = 0;
    const page = { waitForFunction: () => { n++; return Promise.reject(err); } };
    await assert.rejects(waitForFunctionLong(page, () => true, { timeout: 1000, slice: 30 }), (e) => e === err);
    assert.equal(n, 1);
  }
});

test('the default slice stays well under the protocol timeout every Client launches with', async () => {
  const page = fakePage(0);
  await waitForFunctionLong(page, () => true, { timeout: 240000 });
  assert.ok(page.calls[0].opts.timeout < PROTOCOL_TIMEOUT_MS / 2, `slice ${page.calls[0].opts.timeout}`);
  const client = readFileSync(path.join(ROOT, 'test/e2e/client.mjs'), 'utf8');
  assert.match(client, /protocolTimeout: PROTOCOL_TIMEOUT_MS \}/, 'Client.open launches with the exported constant');
});

test('no Client suite has a plain page.waitForFunction as long as the protocol timeout (use waitForFunctionLong)', () => {
  const files = [];
  for (const dir of ['test/ui', 'test/e2e']) {
    for (const f of readdirSync(path.join(ROOT, dir))) if (/\.(m?js)$/.test(f)) files.push(path.join(dir, f));
  }
  const long = [];
  for (const f of files) {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    if (!/from '\.\.\/e2e\/client\.mjs'|from '\.\/client\.mjs'/.test(src)) continue;
    for (let i = src.indexOf('.waitForFunction('); i >= 0; i = src.indexOf('.waitForFunction(', i + 1)) {
      const next = src.indexOf('.waitForFunction(', i + 1);
      const m = src.slice(i, next < 0 ? undefined : next).match(/\{ timeout: ([0-9_]+)/);
      if (m && Number(m[1].replace(/_/g, '')) >= PROTOCOL_TIMEOUT_MS) long.push(`${f}:${src.slice(0, i).split('\n').length} (${m[1]} ms)`);
    }
  }
  assert.deepEqual(long, []);
});
