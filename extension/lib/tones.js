// Short audio cues (no asset files) so the mic state is audible, not just visible.
let ctx;
function beep(freq, start, dur) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.02);
}
export function tone(kind) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    if (kind === 'on') { beep(660, 0, 0.09); beep(880, 0.1, 0.12); }
    else if (kind === 'off') { beep(880, 0, 0.09); beep(540, 0.1, 0.14); }
    else if (kind === 'error') { beep(300, 0, 0.18); }
  } catch { /* audio cues are optional */ }
}
