/** One replay time source; animation, captions, overlays and playhead sample it. */
export function createReplayClock(now) {
  let position = 0, startedAt = 0, running = false;
  const time = (duration) => Math.max(0, Math.min(duration, position + (running ? (now() - startedAt) / 1000 : 0)));
  return {
    time,
    start(at) { position = at; startedAt = now(); running = true; },
    seek(at) { position = at; startedAt = now(); },
    pause(duration) { position = time(duration); running = false; return position; },
  };
}
