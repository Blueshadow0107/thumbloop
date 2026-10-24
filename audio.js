"use strict";
// Thumbloop audio: the output chain, voices (chip, synth, e-piano, bass), drums, metronome click.
// ---------- audio ----------
const ctx = new (window.AudioContext||window.webkitAudioContext)();
const master = ctx.createGain(); master.gain.value = .6;
const limiter = ctx.createDynamicsCompressor();                   // a kick, bass and chords landing together used to add up past full scale and distort; this holds the peaks down
limiter.threshold.value = -10; limiter.knee.value = 8; limiter.ratio.value = 12; limiter.attack.value = .003; limiter.release.value = .15;
master.connect(limiter); limiter.connect(ctx.destination);
const recDest = ctx.createMediaStreamDestination(); limiter.connect(recDest); let audioRecorder = null;   // tap for "Record audio"
const makeChan = () => {
  const gain = ctx.createGain(), an = ctx.createAnalyser(); an.fftSize = 2048;
  gain.connect(an); gain.connect(master);
  return {gain, an, buf:new Float32Array(an.fftSize)};
};
const chan = CHANNELS.map(makeChan);
const applyVol = ci => { const g = chan[ci].gain.gain; g.cancelScheduledValues(ctx.currentTime); g.setTargetAtTime(state.vol[ci], ctx.currentTime, .01); };     // cancel: drop any section-change already queued by the scheduler
const applyVolAt = (ci, v, time) => chan[ci].gain.gain.setTargetAtTime(v, time, .01);       // the scheduler: a section starts, so its mix takes over
let waves;
const buildWaves = () => CHANNELS.map(c => {   // band-limited pulse wave at the given duty
  if (c.kind!=="pulse") return null;
  const N = 64, re = new Float32Array(N), im = new Float32Array(N);
  for (let n=1;n<N;n++){ const k=2/(n*Math.PI); re[n]=k*Math.sin(n*Math.PI*c.duty); im[n]=k*(1-Math.cos(n*Math.PI*c.duty)); }
  return ctx.createPeriodicWave(re, im);
});
function applySound(){                         // swap every lane over to the active sound set (the set may have a different number of lanes)
  const lanes = SOUNDS[state.sound].lanes, n = lanes.length;
  while (CHANNELS.length < n) CHANNELS.push({});
  CHANNELS.length = n;
  CHANNELS.forEach((c, i) => { Object.keys(c).forEach(k => delete c[k]); Object.assign(c, lanes[i]); });
  while (chan.length < n) chan.push(makeChan());
  state.oct = Array.from({length:n}, (_, i) => state.oct[i] || 0);
  if (state.vol.length!==n) state.vol = lanes.map(l => l.vol ?? 1);
  while (state.seq.length < n) state.seq.push(Array(MAX_STEPS).fill(null));
  state.seq.length = n; state.ch = Math.min(state.ch, n-1);
  waves = buildWaves();
  if (lanesEl) buildLaneEls();
}
const noiseBuf = (() => { const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
  for (let i=0;i<d.length;i++) d[i] = Math.random()*2-1; return b; })();

function startRhodes(ci, midi, when){         // FM electric piano: soft tine attack, mellow decay, slow tremolo
  const c = CHANNELS[ci], f = 440*2**((midi-69)/12);
  const car = ctx.createOscillator(), mod = ctx.createOscillator(), modG = ctx.createGain(), bell = ctx.createOscillator(), bellG = ctx.createGain();
  car.frequency.value = f; mod.frequency.value = f; bell.frequency.value = f*14;
  modG.gain.setValueAtTime(f*1.4, when); modG.gain.exponentialRampToValueAtTime(f*.12, when+.9);       // brightness fades as it rings
  bellG.gain.setValueAtTime(f*.45, when); bellG.gain.exponentialRampToValueAtTime(.01, when+.1);       // the "tine" at the start
  mod.connect(modG).connect(car.frequency); bell.connect(bellG).connect(car.frequency);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(c.level, when+.006);
  g.gain.exponentialRampToValueAtTime(c.level*.35, when+.7); g.gain.setTargetAtTime(c.level*.1, when+.7, 1.4);
  const tg = ctx.createGain(); tg.gain.value = .9;
  const trem = ctx.createOscillator(), tremAmt = ctx.createGain(); trem.frequency.value = 4.6; tremAmt.gain.value = .1; trem.connect(tremAmt).connect(tg.gain);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = Math.min(5000, f*7);
  car.connect(g).connect(tg).connect(lp).connect(chan[ci].gain);
  [car, mod, bell, trem].forEach(o => o.start(when));
  return { stop(t){ g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, .14); [car, mod, bell, trem].forEach(o => o.stop(t+1)); } };
}
function startBass(ci, midi, when){             // warm sine bass with a hint of triangle, rolled off up top
  const c = CHANNELS[ci], f = 440*2**((midi-69)/12), a = ctx.createOscillator(), b = ctx.createOscillator(), bg = ctx.createGain(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
  a.frequency.value = f; b.type = "triangle"; b.frequency.value = f; bg.gain.value = .25; lp.type = "lowpass"; lp.frequency.value = 520;
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(c.level, when+.012); g.gain.setTargetAtTime(c.level*.7, when+.012, .25);
  a.connect(g); b.connect(bg).connect(g); g.connect(lp).connect(chan[ci].gain); a.start(when); b.start(when);
  return { stop(t){ g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, .08); a.stop(t+.6); b.stop(t+.6); } };
}
function startSynth(ci, midi, when){            // configurable synth: a few oscillators through a lowpass and an envelope (settings in the lane's `synth`)
  const c = CHANNELS[ci], p = c.synth, f = 440*2**((midi-69)/12), env = p.env, total = p.osc.reduce((t, o) => t+(o.gain ?? 1), 0);
  const g = ctx.createGain(), lp = ctx.createBiquadFilter(), oscs = [];
  lp.type = "lowpass"; lp.frequency.value = Math.min(p.lp || 18000, f*40); lp.Q.value = p.q || .7;
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(c.level, when+env.a); g.gain.setTargetAtTime(c.level*env.s, when+env.a, env.d/3);
  p.osc.forEach(o => {
    const x = ctx.createOscillator(), og = ctx.createGain(); x.type = o.type; x.frequency.value = f*(o.ratio || 1); x.detune.value = o.detune || 0;
    og.gain.value = (o.gain ?? 1)/total; if (o.decay) og.gain.setTargetAtTime(0, when+.002, o.decay);       // a partial that fades (bell overtones)
    x.connect(og).connect(g); x.start(when); oscs.push(x);
  });
  g.connect(lp).connect(chan[ci].gain);
  return { stop(t){
    g.gain.cancelScheduledValues(t);                                                  // (this also drops the fade-in, so a note released early would stay silent)
    if (t < when+env.a) g.gain.linearRampToValueAtTime(c.level*Math.max(0, t-when)/env.a, t);   // rebuild the fade-in up to the release point
    g.gain.setTargetAtTime(0, t, env.r/3); oscs.forEach(x => x.stop(t+env.r+.1)); } };
}
function startVoice(ci, midi, when, chord, dur=Infinity, block=false){
  if (chord && block){ const vs = chord.map(i => startVoice(ci, midi+i, when, null, dur)); return { stop(t){ vs.forEach(v => v.stop(t)); } }; }
  return (VOICES[CHANNELS[ci].kind] || startChip)(ci, midi, when, chord, dur);
}
function startChip(ci, midi, when, chord, dur){   // NES-style voice: pulse or triangle, chords as fast arpeggios
  const c = CHANNELS[ci], o = ctx.createOscillator(), g = ctx.createGain();
  const freqs = (chord || [0]).map(i => 440*2**((midi+i-69)/12));
  o.frequency.value = freqs[0];
  if (c.kind==="pulse") o.setPeriodicWave(waves[ci]); else o.type = "triangle";
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(c.level, when+c.env.a);
  g.gain.setTargetAtTime(c.level*c.env.s, when+c.env.a, c.env.d/3);
  o.connect(g).connect(chan[ci].gain); o.start(when);
  let stopAt = Infinity, tNext = when, k = 0;
  const arp = () => {                         // chord = arpeggio, scheduled a little ahead and topped up while the note lasts
    if (freqs.length<2) return;
    const end = Math.min(when+dur, stopAt), lim = Math.min(end, ctx.currentTime+.4);
    while (tNext < lim){ o.frequency.setValueAtTime(freqs[k++ % freqs.length], tNext); tNext += 1/ARP_HZ; }
    if (tNext < end) setTimeout(arp, 150);
  };
  arp();
  return { stop(t){ stopAt = t; g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, .02); o.stop(t+.2); } };
}
const VOICES = {pulse:startChip, tri:startChip, synth:startSynth, rhodes:startRhodes, bass:startBass};     // voice kinds a lane can use
const drumBufs = {};   // TR-909 samples, the same ones Strudel's .bank("RolandTR909") plays
Object.entries(window.DRUM_SAMPLES || {}).forEach(async ([id, uri]) => {
  try { drumBufs[id] = await ctx.decodeAudioData(await (await fetch(uri)).arrayBuffer()); } catch(e){ console.warn("drum sample", id, e); }
});
function hitDrum(d, when){
  if (drumBufs[d.id]){
    const s = ctx.createBufferSource(); s.buffer = drumBufs[d.id]; s.connect(chan[drumLane()].gain); s.start(when); return;
  }                      // fallback while samples load: the synthesized noise hit below
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true; f.type = d.filter; f.frequency.value = d.freq;
  g.gain.setValueAtTime(d.level*.5, when); g.gain.exponentialRampToValueAtTime(.001, when+d.dur);
  s.connect(f).connect(g).connect(chan[drumLane()].gain); s.start(when); s.stop(when+d.dur+.05);
}
function click(when, accent){
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent?1500:1000; g.gain.setValueAtTime(.12, when); g.gain.exponentialRampToValueAtTime(.001, when+.05);
  o.connect(g).connect(master); o.start(when); o.stop(when+.06);
}
const drumLane = () => CHANNELS.findIndex(c => c.kind==="noise");
// a step holds one entry; notes played at the same step ride along in entry.more, so a step can hold several notes
const entriesAt = e => e ? [e, ...(e.more || [])] : [];
const cloneEntry = e => e && {...e, ...(e.more ? {more:e.more.map(m => ({...m}))} : {})};
const midiOf = (ci, semis) => CHANNELS[ci].base + state.oct[ci]*12 + semis;
