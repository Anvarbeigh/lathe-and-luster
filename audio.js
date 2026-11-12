// Sound: one AudioContext, a gentle bus limiter, one-shot SFX, two looping scrub layers whose volume follows how
// much the player is removing right now, and a soft music loop. Browsers allow audio only after a user gesture:
// call audio.unlock() from input handlers. suspend()/resume() are stack-safe (hidden tab, blur, ads, portal pause).

const SFX = ['buy', 'click', 'close', 'coin', 'error', 'open', 'unlock', 'whoosh', 'place', 'sold', 'reveal', 'ting', 'fanfare',
  'scrub_rust', 'scrub_polish', 'music'];
const MUSIC_GAIN = 0.5;

let ctx = null, master = null, sfxGain = null, musicGain = null;
const buffers = {};
let soundOn = true, musicOn = true, suspended = 0, loopTimer = null;
const loops = {};          // name -> { src, gain }

function makeCtx() {
  if (ctx) return;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  const ceil = ctx.createWaveShaper(); { const n = 2048, c = new Float32Array(n), L = 0.6; for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.abs(x) < 0.7 * L ? x : Math.sign(x) * (0.7 * L + (L - 0.7 * L) * Math.tanh((Math.abs(x) - 0.7 * L) / (L - 0.7 * L))); } ceil.curve = c; ceil.oversample = '4x'; }
  ceil.connect(ctx.destination);
  const brick = ctx.createDynamicsCompressor(); brick.threshold.value = -6; brick.knee.value = 0; brick.ratio.value = 20; brick.attack.value = 0.001; brick.release.value = 0.08; brick.connect(ceil);
  const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -14; lim.knee.value = 8; lim.ratio.value = 3; lim.attack.value = 0.005; lim.release.value = 0.2; lim.connect(brick);
  master = ctx.createGain(); master.gain.value = 1.0; master.connect(lim);
  sfxGain = ctx.createGain(); sfxGain.connect(master);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.0; musicGain.connect(master);
  for (const name of SFX) {
    fetch(`./assets/sfx/${name}.mp3`).then((r) => r.arrayBuffer())
      .then((b) => new Promise((ok, bad) => ctx.decodeAudioData(b, ok, bad)))
      .then((buf) => { buffers[name] = buf; }).catch(() => { /* missing sound: stay silent */ });
  }
}

function apply() {
  if (!ctx) return;
  const audible = suspended === 0;
  if (audible && ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (!audible && ctx.state === 'running') ctx.suspend().catch(() => {});
  sfxGain.gain.value = soundOn ? 1 : 0;
  musicGain.gain.setTargetAtTime(musicOn ? MUSIC_GAIN : 0, ctx.currentTime, 0.3);
}

function startLoop(name, out, vol) {
  if (loops[name] || !buffers[name] || ctx.state !== 'running') return;
  const src = ctx.createBufferSource(), gain = ctx.createGain();
  src.buffer = buffers[name]; src.loop = true; gain.gain.value = vol;
  src.connect(gain).connect(out); src.start();
  loops[name] = { src, gain };
}
function ensureLoops() {
  if (!ctx) return;
  startLoop('music', musicGain, 1);
  startLoop('scrub_rust', sfxGain, 0);
  startLoop('scrub_polish', sfxGain, 0);
}

for (const ev of ['touchend', 'pointerup', 'keydown']) {
  document.addEventListener(ev, () => { if (ctx && suspended === 0 && ctx.state !== 'running') ctx.resume().catch(() => {}); }, true);
}

export const audio = {
  unlock() {
    makeCtx(); apply();
    if (!loopTimer && ctx) loopTimer = setInterval(ensureLoops, 250);
  },
  play(name, { vol = 1, rate = 1 } = {}) {
    if (!ctx || !soundOn || suspended || !buffers[name]) return;
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buffers[name]; s.playbackRate.value = rate; g.gain.value = vol;
    s.connect(g).connect(sfxGain); s.start();
  },
  // continuous scrub: rust and polish levels 0..1, rate = playback speed (follows lathe speed)
  scrub(rust, polish, rate = 1) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const r = loops.scrub_rust, p = loops.scrub_polish;
    if (r) { r.gain.gain.setTargetAtTime(rust * 0.9, t, rust > r.gain.gain.value ? 0.015 : 0.06); r.src.playbackRate.setTargetAtTime(rate, t, 0.1); }
    if (p) { p.gain.gain.setTargetAtTime(polish * 0.8, t, polish > p.gain.gain.value ? 0.02 : 0.08); p.src.playbackRate.setTargetAtTime(0.9 + rate * 0.1, t, 0.1); }
  },
  suspend() { suspended++; apply(); },
  resume() { if (suspended > 0) suspended--; apply(); },
  setSound(on) { soundOn = on; apply(); },
  setMusic(on) { musicOn = on; apply(); },
  get soundOn() { return soundOn; },
  get musicOn() { return musicOn; },
  get muted() { return suspended > 0 || (ctx ? ctx.state !== 'running' : false); },
  get state() { return ctx ? ctx.state : 'none'; },
};
