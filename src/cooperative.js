import { setImmediate as nextTurn } from 'node:timers/promises';

// Cooperative scheduling for the poller-owned structured-log scans.
//
// The scan bodies are generator functions that `yield` only when a pacer says
// the current time slice is spent. Two drivers run the same generator:
//   - runToCompletion: the synchronous wrapper every existing caller and test
//     uses. It passes no pacer, so the generator never yields and the work is
//     byte-for-byte the synchronous scan it always was.
//   - runCooperatively: the poller's driver. At each yield it returns to the
//     event loop (setImmediate runs after the I/O poll phase, so pending
//     connections and requests are served) and then resumes the scan exactly
//     where it left off.
// Suspension points never change what is read, parsed, bounded, cached, or
// published; every budget, last-good fallback, and atomic cache replacement
// stays inside the scan body. The slice is wall-clock real time and is
// deliberately separate from the scans' injectable `nowFn` budget clocks.
export const SCAN_SLICE_MS = 20;

export function createPacer(sliceMs = SCAN_SLICE_MS, now = () => performance.now()) {
  let sliceStartedAt = now();
  return {
    due() { return now() - sliceStartedAt >= sliceMs; },
    resume() { sliceStartedAt = now(); },
  };
}

export function runToCompletion(steps) {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export async function runCooperatively(steps, pacer = createPacer()) {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    await nextTurn();
    pacer.resume();
  }
}
