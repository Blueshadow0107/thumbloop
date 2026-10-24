"use strict";
// Thumbloop playback: the scheduler, undo, bar selection, and every action the keys and buttons trigger.
// ---------- transport ----------
let T = null, timer = null;     // T = {n: step counter, next: when it sounds, countin, q: recent steps for position(), tl: lead-in timeline, mode, lead: lead-in steps}
function timeline(list){        // sections play back to back, each as long as the loop it was added with
  let t = 0;
  const items = list.map(({sec, idx}) => { const it = {sec, idx, start:t, len:sec.bars*BAR}; t += it.len; return it; });
  return {items, total:t};
}
function leadList(){            // what plays before the section you are on (scope), or instead of it (Play song)
  const all = state.song.map((sec, idx) => ({sec, idx}));
  if (state.songMode==="play") return all;
  if (state.songMode==="all") return all.slice(0, state.sec);
  if (state.songMode==="last" && state.sec>0) return [all[state.sec-1]];
  return [];
}
function sectionLetters(){      // identical sections share a letter: A A B A C
  const seen = [];
  return state.song.map(sec => { const key = JSON.stringify([sec.bars, sec.lanes, sec.vol]); let i = seen.indexOf(key); if (i<0){ seen.push(key); i = seen.length-1; } return String.fromCharCode(65 + i%26); });
}
function playEntry(ci, e, time){ entriesAt(e).forEach(n => playNote(ci, n, time)); }
function playNote(ci, e, time){
  if (e.drum) hitDrum(DRUMS.find(d=>d.id===e.drum), time);
  else { const d = e.len*stepDur()*.95, v = startVoice(ci, e.note, time, e.chord, d, e.block); v.stop(time + d); }
}
function schedSong(p, time){
  const tl = T.tl, it = tl.items.find(x => p >= x.start && p < x.start+x.len), off = p - it.start;
  state.playSec = it.idx;
  if (off===0) CHANNELS.forEach((_, ci) => applyVolAt(ci, it.sec.vol ? it.sec.vol[ci] : 1, time));       // each section plays with its own mix
  if (state.metro && off%4===0) click(time, off%BAR===0);
  it.sec.lanes.forEach((lane, ci) => { const e = lane[off]; if (e) playEntry(ci, e, time); });
}
function schedStep(n, time){
  if (n < T.countin){ if (n%4===0) click(time, n%BAR===0); return; }
  const p = n - T.countin;
  if (T.mode==="play") return schedSong(p % T.tl.total, time);
  if (p < T.lead) return schedSong(p, time);                 // the lead-in (earlier sections) plays once...
  state.playSec = -1;                                        // ...then the section you are on loops
  if (T.followed){ T.followed = false; actions.secGo(T.startSec); }     // (the view followed the lead-in; come back before reading the live lanes)
  const pos = (p - T.lead) % STEPS;
  if (pos===0) CHANNELS.forEach((_, ci) => applyVolAt(ci, state.vol[ci], time));           // the section you are on, back to its live mix
  if (pos===0 && state.armed){ state.armed = false; state.rec = true; setTimeout(refresh); }
  if (state.metro && pos%4===0) click(time, pos%BAR===0);
  state.seq.forEach((seq, ci) => { const e = seq[pos]; if (e) playEntry(ci, e, time); });
}
function pump(){
  while (T.next < ctx.currentTime + .12){
    schedStep(T.n, T.next); T.q.push({n:T.n, time:T.next}); if (T.q.length>64) T.q.shift();
    T.n++; T.next += stepDur();
  }
}
function start(countin){
  ctx.resume();
  const tl = timeline(leadList()), mode = tl.total ? state.songMode : "off";            // nothing saved yet: just the loop
  T = {n:0, next:ctx.currentTime+.06, countin, q:[], tl, mode, lead: mode==="play" ? 0 : tl.total, startSec:state.sec}; pump(); timer = setInterval(pump, 25); refresh();
}
function stop(){ clearInterval(timer); timer = null; const back = T && T.followed ? T.startSec : null; T = null; if (back!==null && state.song[back]) actions.secGo(back);     // "up to here" moves the view along the lead-in; stopping returns you to where you started
  state.rec = state.armed = false; state.playSec = -1; CHANNELS.forEach((_, ci) => applyVol(ci)); refresh(); }       // back to the mix of the section you are on
function position(){          // fractional step index since transport start (or null)
  if (!T) return null; const now = ctx.currentTime; let e = null;
  for (const x of T.q) if (x.time <= now) e = x;
  return e ? e.n + (now - e.time)/stepDur() : null;
}

// ---------- actions ----------
const snapshot = () => ({bars:state.bars, vol:state.vol.slice(), oct:state.oct.slice(), lanes:state.seq.map(l => l.slice(0, STEPS).map(e => cloneEntry(e)))});
const undoStack = []; let recPushed = false;
let trace = null;        // what you just deleted, shown as a dim ghost until you play, record or switch sections: {lane index: entries}
const setTrace = t => { trace = Object.keys(t).length && Object.values(t).some(l => l.some(Boolean)) ? t : null; };
let sel = null, barClip = null;        // sel = bars you dragged over {l0,l1 lanes, a,b bars}; barClip = what Ctrl+C took
const selBars = () => sel && {l0:sel.l0, l1:sel.l1, a:Math.min(sel.a, sel.b), b:Math.max(sel.a, sel.b)};
function commit(){ if (ready && state.song[state.sec]) state.song[state.sec] = snapshot(); }       // the loop you play on is the selected section
function loadSection(i){
  const sec = state.song[i]; state.bars = sec.bars; STEPS = sec.bars*BAR; sel = null; trace = null;
  if (sec.vol) state.vol = sec.vol.slice();          // each section has its own mix and octaves
  if (sec.oct) state.oct = sec.oct.slice();
  CHANNELS.forEach((_, ci) => applyVol(ci));
  state.seq.forEach((l, ci) => { for (let k=0;k<MAX_STEPS;k++){ const e = k<STEPS && sec.lanes[ci][k]; l[k] = cloneEntry(e); } }); }
function pushUndo(){
  commit(); undoStack.push(JSON.stringify({song:state.song, sec:state.sec}));
  if (undoStack.length > 30) undoStack.shift(); }
const actions = {
  play(){ ctx.resume(); T ? stop() : start(BAR); },          // always 4 empty count-in beats before bar 1
  rec(){ recPushed = false; ctx.resume();
    if (state.songMode==="play") return toast("hearing the whole song: press LB to pick another mode, then record");
    if (state.rec || state.armed){ state.rec = state.armed = false; refresh(); }
    else if (!T){ state.rec = true; start(BAR); }
    else { state.armed = true; refresh(); } },                // already playing: start recording at bar 1 of the next pass
  undo(){
    const u = undoStack.pop(); if (!u) return toast("nothing to undo");
    const d = JSON.parse(u); state.song = d.song; state.sec = d.sec; loadSection(state.sec);
    save(); refresh(); toast("undone"); },
  clear(){ pushUndo(); setTrace({[state.ch]:state.seq[state.ch].slice(0, STEPS)}); state.seq[state.ch].fill(null); save(); toast(CHANNELS[state.ch].name+" cleared"); },
  oct(d){ state.oct[state.ch] = Math.max(-2, Math.min(2, state.oct[state.ch]+d)); refresh(); save(); },
  bpm(d){ state.bpm = Math.max(60, Math.min(220, Math.round(state.bpm/5)*5 + d)); refresh(); save(); toast("bpm "+state.bpm); },
  metro(){ state.metro = !state.metro; refresh(); },
  vol(d, quiet){ const ci = state.ch; state.vol[ci] = Math.max(0, Math.min(VOL_MAX, Math.round((state.vol[ci]+d)*1000)/1000));
                 applyVol(ci); refresh(); if (!quiet) save(); },
  bars(d){ const i = Math.max(0, Math.min(BAR_OPTIONS.length-1, BAR_OPTIONS.indexOf(state.bars)+d)); if (BAR_OPTIONS[i]===state.bars) return;
           pushUndo(); state.bars = BAR_OPTIONS[i]; STEPS = state.bars*BAR; refresh(); save(); },
  sound(){ const same = Object.keys(SOUNDS).filter(k => laneCount(k)===CHANNELS.length), next = same[(same.indexOf(state.sound)+1)%same.length];
           if (next===state.sound) return toast("no other sound set has "+CHANNELS.length+" lanes: start a new song in it (Songs panel)");
           if (state.bpm===SOUNDS[state.sound].bpm) state.bpm = SOUNDS[next].bpm;       // follow the new set's usual tempo unless you changed it
           state.sound = next; applySound(); CHANNELS.forEach((_, ci) => applyVol(ci)); save(); renderHelp(); refresh(); toast("sound set: "+SOUNDS[next].label); },
  lane(i){ state.ch = (i+CHANNELS.length)%CHANNELS.length; state.strip = false; refresh(); },
  focusMove(d){ const n = CHANNELS.length, at = state.strip ? n : state.ch, to = (at+d+n+1)%(n+1);       // lanes, then the sections row, then back to the first lane
                state.strip = to===n; if (!state.strip) state.ch = to; refresh(); },
  // song: the loop you play on IS the selected section; switching saves it back first
  secGo(i){ i = Math.max(0, Math.min(state.song.length-1, i)); if (i===state.sec) return; commit(); state.sec = i; loadSection(i); save(); refresh(); },
  secNew(){ pushUndo(); state.song.splice(state.sec+1, 0, snapshot()); state.sec++; loadSection(state.sec); save(); refresh();
            toast("section "+(state.sec+1)+" added, a copy of the one before (RB clears a lane)"); },
  secDup(i){ pushUndo(); commit(); state.song.push(JSON.parse(JSON.stringify(state.song[i]))); save(); refresh();
             toast("section "+(i+1)+" copied to the end (section "+state.song.length+")"); },
  secMove(from, to){ if (from===to) return; pushUndo(); commit(); const [sec] = state.song.splice(from, 1); state.song.splice(to, 0, sec);
                     state.sec = to; loadSection(to); save(); refresh(); toast("section moved to "+(to+1)); },
  secDel(){ pushUndo();
    if (state.song.length<2){ const gone = Object.fromEntries(state.seq.map((l, ci) => [ci, l.slice(0, STEPS)])); state.seq.forEach(l => l.fill(null)); setTrace(gone); save(); refresh(); return toast("cleared: a song keeps at least one section"); }
    const [gone] = state.song.splice(state.sec, 1); state.sec = Math.min(state.sec, state.song.length-1); loadSection(state.sec);
    setTrace(Object.fromEntries(gone.lanes.map((l, ci) => [ci, l]))); save(); refresh(); toast("section deleted"); },
  scope(){ state.songMode = MODES[(MODES.indexOf(state.songMode)+1)%MODES.length]; save();
    if (T){ const rec = state.rec; stop(); start(0); state.rec = rec; }       // a running transport picks up the new mode right away
    refresh(); toast("playback: "+MODE_LABEL[state.songMode]); },
  audioRec(){             // record what you hear to a file in Downloads (so a song can be shared)
    if (audioRecorder){ audioRecorder.stop(); return; }
    const type = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"].find(t => MediaRecorder.isTypeSupported(t));
    if (!type) return toast("this browser can't record audio");
    ctx.resume(); const chunks = []; audioRecorder = new MediaRecorder(recDest.stream, {mimeType:type});
    audioRecorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    audioRecorder.onstop = () => {
      const a = document.createElement("a"), d = new Date(), pad = n => String(n).padStart(2,"0");
      a.href = URL.createObjectURL(new Blob(chunks, {type})); a.download = "thumbloop-"+slug(state.name)+"-"+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+"-"+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds())+".webm";
      a.click(); audioRecorder = null; refresh(); toast("saved "+a.download+" to Downloads"); };
    audioRecorder.start(); refresh(); toast("recording audio: play, then press the button again to stop"); },
  // bars: drag over bars in the lanes (Shift = every lane), then copy / paste / clear
  barsCopy(){ const r = selBars(); if (!r) return toast("drag over some bars first (Shift = every lane)");
    barClip = {l0:r.l0, n:r.b-r.a+1, lanes:state.seq.slice(r.l0, r.l1+1).map(l => l.slice(r.a*BAR, (r.b+1)*BAR).map(e => cloneEntry(e)))};
    toast("copied "+barClip.n+(barClip.n===1?" bar":" bars")+" \u00b7 pick a bar (any section) and Ctrl+V"); },
  barsPaste(){ if (!barClip) return toast("nothing copied yet: drag over bars, then Ctrl+C");
    const r = selBars(), start = r ? r.a : 0, l0 = barClip.lanes.length===1 ? (r ? r.l0 : state.ch) : barClip.l0;
    if (l0+barClip.lanes.length > CHANNELS.length) return toast("no room for those lanes");
    for (let k=0;k<barClip.lanes.length;k++) if ((CHANNELS[l0+k].kind==="noise") !== (CHANNELS[barClip.l0+k].kind==="noise")) return toast("drum bars only go on the drums lane");
    pushUndo(); let clipped = false;
    barClip.lanes.forEach((steps, k) => steps.forEach((e, i) => { const d = start*BAR+i; if (d>=STEPS){ if (e) clipped = true; return; } state.seq[l0+k][d] = cloneEntry(e); }));
    sel = {l0, l1:l0+barClip.lanes.length-1, a:start, b:Math.min(state.bars-1, start+barClip.n-1)}; save(); refresh();
    toast("pasted"+(clipped ? " (the end didn't fit in this section)" : "")); },
  barsClear(){ const r = selBars(); if (!r) return; pushUndo();
    const gone = {}; for (let l=r.l0;l<=r.l1;l++) gone[l] = state.seq[l].slice(0, STEPS).map((e, i) => i>=r.a*BAR && i<(r.b+1)*BAR ? e : null); setTrace(gone);
    for (let l=r.l0;l<=r.l1;l++) for (let i=r.a*BAR;i<(r.b+1)*BAR;i++) state.seq[l][i] = null;
    save(); refresh(); toast("cleared the selected bars"); },
  // clips: one lane's loop, saved for reuse
  clipSlot(i, ev){ state.cur = i; if (ev.shiftKey || !state.clips[i]) actions.clipSave(); else actions.clipLoad(); },
  clipClear(i){ if (!state.clips[i]) return; state.clips[i] = null; save(); refresh(); toast("slot "+(i+1)+" emptied"); },
  clipSave(){
    const ci = state.ch, steps = state.seq[ci].slice(0, STEPS).map(e => cloneEntry(e));
    if (!steps.some(Boolean)) return toast("this lane is empty, nothing to save");
    state.clips[state.cur] = {lane:CHANNELS[ci].name, drums:CHANNELS[ci].kind==="noise", bars:state.bars, steps};
    save(); refresh(); toast("saved to slot "+(state.cur+1)); },
  clipLoad(){
    const ci = state.ch, c = CHANNELS[ci], slot = state.clips[state.cur], isDrums = c.kind==="noise";
    if (!slot) return toast("slot "+(state.cur+1)+" is empty");
    if (slot.drums !== isDrums) return toast(slot.drums ? "drum clips only go on the drums lane" : "melody clips can't go on the drums lane");
    pushUndo();
    const len = slot.steps.length; if (len > STEPS){ state.bars = len/BAR; STEPS = len; }
    for (let i=0;i<MAX_STEPS;i++){ const e = i<STEPS && slot.steps[i%len]; state.seq[ci][i] = cloneEntry(e); }   // shorter clips repeat to fill the loop
    save(); refresh(); toast("slot "+(state.cur+1)+" loaded onto "+c.name); },
};
const slotText = i => state.clips[i] ? "slot "+(i+1)+" · "+state.clips[i].lane+" · "+state.clips[i].bars+"b" : "slot "+(i+1)+" (empty)";
