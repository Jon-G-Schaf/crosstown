export type SingleFlightOptions = {
  intervalMs: number;
  run: () => Promise<void>;
  onError: (err: unknown) => void;
};

// Keep the measured start-to-start cadence when work is fast, but never let a
// slow request overlap the next one. A failed run follows the same cadence so a
// transient outage does not turn into a tight retry loop.
export function startSingleFlight({ intervalMs, run, onError }: SingleFlightOptions) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    const startedAt = Date.now();
    try {
      await run();
    } catch (err) {
      onError(err);
    }
    if (stopped) return;
    const elapsed = Date.now() - startedAt;
    timer = setTimeout(tick, Math.max(0, intervalMs - elapsed));
  };

  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
