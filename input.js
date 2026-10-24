"use strict";
// Thumbloop input: keyboard and gamepad. Which key or button does what is in controls.js.
// ---------- keyboard ----------
const held = {}, chordKeys = new Set();           // chord keys currently held (CHORD_KEYS)
const chordKeyFor = role => Object.keys(CHORD_KEYS).find(k => CHORD_KEYS[k]===role);
const keyChord = () => chordFor(chordKeys.has(chordKeyFor("rt")), chordKeys.has(chordKeyFor("lt")));
function noteDown(key){
  if (CHANNELS[state.ch].kind==="noise"){ const d = DRUMS.find(d=>d.key===key); if (!d) return false; trigger(key, null, d); }
  else { if (!(key in PIANO)) return false; trigger(key, PIANO[key], null, keyChord()); }
  return true;
}
function placeEntry(ci, pos, entry){      // a note at a step that already has one is added alongside it (the same note again replaces it)
  const cur = state.seq[ci][pos], same = n => entry.drum ? n.drum===entry.drum : n.note===entry.note && !n.drum;
  if (!cur){ state.seq[ci][pos] = entry; return; }
  const i = entriesAt(cur).findIndex(same);
  if (i===0){ if (cur.more) entry.more = cur.more; state.seq[ci][pos] = entry; }
  else if (i>0) cur.more[i-1] = entry;
  else (cur.more = cur.more || []).push(entry);
}
function trigger(id, semis, drum, chord){
  trace = null;      // play (and record, if armed) one note or drum hit; id = what releases it
  const ci = state.ch; let entry, voice = null;
  if (drum){ hitDrum(drum, ctx.currentTime); entry = {drum:drum.id}; }
  else { const m = midiOf(ci, semis); voice = startVoice(ci, m, ctx.currentTime, chord && chord.iv, Infinity, chord && chord.block); entry = {note:m, len:1}; if (chord){ entry.chord = chord.iv; if (chord.block) entry.block = true; } }
  let placed = false;
  if (state.rec && T){
    const p = position(); const rel = p===null ? -1 : p - T.countin - T.lead;
    if (rel >= -.5){ if (!recPushed){ pushUndo(); recPushed = true; } placeEntry(ci, ((Math.round(rel)%STEPS)+STEPS)%STEPS, entry); placed = true; save(); }
  }
  held[id] = {voice, entry, placed, t0:ctx.currentTime, ci};
}
function noteUp(key){
  const h = held[key]; if (!h) return; delete held[key];
  if (h.voice) h.voice.stop(ctx.currentTime);
  if (h.placed && h.entry.note!==undefined){ h.entry.len = Math.max(1, Math.min(STEPS, Math.round((ctx.currentTime-h.t0)/stepDur()))); save(); }
}
window.addEventListener("keydown", e => {
  if (songsUI.open) return songsKey(e);
  if (e.key==="Escape"){ closeModal(); sel = null; return; }
  if (e.key==="Backspace" && sel && !e.target.matches("input,textarea")){ actions.barsClear(); e.preventDefault(); return; }
  if ((e.ctrlKey||e.metaKey) && !e.target.matches("input,textarea")){
    const act = ctrlAction[e.key.toLowerCase()];
    if (act){ DO[act](); e.preventDefault(); return; } }
  if (e.ctrlKey||e.metaKey||e.altKey || e.target.matches("input,textarea")) return;
  ctx.resume(); setInput("kb");
  const k = e.key.toLowerCase();
  if (/^[1-9]$/.test(k) && +k<=CHANNELS.length){ actions.lane(+k-1); e.preventDefault(); return; }
  if (k in CHORD_KEYS){ chordKeys.add(k); e.preventDefault(); return; }
  const act = keyAction[k];
  if (act && (!e.repeat || KEY_REPEAT.has(act))){ DO[act](); e.preventDefault(); return; }
  if (e.repeat){ if (k in PIANO || act) e.preventDefault(); return; }
  if (noteDown(k)) e.preventDefault();
});
window.addEventListener("keyup", e => { const k = e.key.toLowerCase(); chordKeys.delete(k); noteUp(k); });
window.addEventListener("blur", () => { chordKeys.clear(); Object.keys(held).forEach(noteUp); });
window.addEventListener("pointerdown", () => ctx.resume());          // a click anywhere unlocks the sound (the browser blocks audio until then)
window.addEventListener("error", e => toast("error: "+e.message));

// ---------- gamepad ----------
const padNoteBtn = Object.fromEntries(Object.entries(PAD_NOTES).map(([b, semis]) => [semis, PAD_NAMES[b]]));
const padDrumBtn = Object.fromEntries(Object.entries(PAD_DRUMS).map(([b, id]) => [id, PAD_NAMES[b]]));
const pianoKey = Object.fromEntries(Object.entries(PIANO).map(([k, semis]) => [semis, k.toUpperCase()]));
const padHeld = {}, padSticks = {left:{x:{}, y:{}}, right:{x:{}, y:{}}};
const padTap = {};                                        // tap/hold buttons in flight: {timer, fired, used}
let padId = null;
function stickStep(a, v){          // a stick axis as a d-pad: fires once per push, then repeats while held
  const dir = v > .6 ? 1 : v < -.6 ? -1 : 0, now = performance.now();
  if (!dir){ a.dir = 0; return 0; }
  if (dir !== a.dir){ a.dir = dir; a.t = now+400; a.rep = false; return dir; }
  if (now > a.t){ a.t = now+160; a.rep = true; return dir; }
  return 0;
}
function stripNav(d, repeat){                // move along the sections; with Y held, move the section itself
  if (padHeld[BTN[PAD_STRIP_MOVE]]){ const to = state.sec+d; if (to>=0 && to<state.song.length) actions.secMove(state.sec, to); return; }
  if (d>0 && state.sec===state.song.length-1){ if (!repeat) actions.secNew(); } else actions.secGo(state.sec+d);        // past the last one adds a new one (not while held)
}
function stripButton(i){                      // controller buttons while the sections row is focused
  const what = PAD_STRIP[Object.keys(BTN).find(n => BTN[n]===i)];
  if (what==="prev" || what==="next") stripNav(what==="next" ? 1 : -1, false);
  else if (what==="new") actions.secNew();    // a copy of this section
  else if (what==="delete") actions.secDel();
  else if (what==="back") actions.focusMove(-1);     // back to the lanes
}
function pollPad(){
  const gp = [...navigator.getGamepads()].find(g => g && g.connected);
  if ((gp ? gp.id : null) !== padId){ padId = gp ? gp.id : null; $("pad").textContent = padId ? "\u{1F3AE} " + padId.replace(/\s*\(.*\)/,"") : ""; }
  if (!gp) return;
  for (const [name, [ax, ay]] of Object.entries(PAD_STICK_AXES)){       // sticks: each direction fires its action from PAD_STICKS
    const st = padSticks[name]; let vx = gp.axes[ax] || 0, vy = gp.axes[ay] || 0;
    if (Math.abs(vy) >= Math.abs(vx)) vx = 0; else vy = 0;               // a diagonal counts as its stronger direction
    const dx = stickStep(st.x, vx), dy = stickStep(st.y, vy);
    for (const [dir, rep] of [[dy && (dy<0 ? "up" : "down"), st.y.rep], [dx && (dx<0 ? "left" : "right"), st.x.rep]]){
      if (!dir) continue;
      setInput("pad");
      const mod = Object.keys(PAD_STICK_HOLD).find(b => padHeld[BTN[b]] && PAD_STICK_HOLD[b][name] && PAD_STICK_HOLD[b][name][dir]);
      if (mod && padTap[BTN[mod]]) padTap[BTN[mod]].used = true;         // using a button as a modifier cancels its tap
      DO[mod ? PAD_STICK_HOLD[mod][name][dir] : PAD_STICKS[name][dir]](rep);
    }
  }
  gp.buttons.forEach((b, i) => {
    if (b.pressed === !!padHeld[i]) return;
    padHeld[i] = b.pressed; const id = "pad"+i;
    const row = PADMAP.find(r => r.btn===i);
    if (!b.pressed){
      const t = padTap[i]; if (t){ clearTimeout(t.timer); delete padTap[i]; if (!t.fired && !t.used) DO[row.tap](); }     // a tap acts on release
      return noteUp(id); }
    setInput("pad"); ctx.resume();
    if (row && row.act) return DO[row.act]();
    if (row){ const t = padTap[i] = {fired:false, used:false}; if (row.hold) t.timer = setTimeout(() => { t.fired = true; DO[row.hold](); }, HOLD_MS); return; }
    if (state.strip) return stripButton(i);                                            // sections row: buttons edit sections instead of playing notes
    const noise = CHANNELS[state.ch].kind==="noise";
    if (noise && i in PAD_DRUMS) trigger(id, null, DRUMS.find(d=>d.id===PAD_DRUMS[i]));
    else if (!noise && i in PAD_NOTES) trigger(id, PAD_NOTES[i], null, chordFor(padHeld[BTN[PAD_CHORD.rt]], padHeld[BTN[PAD_CHORD.lt]]));   // RT = major, LT = minor, both = dominant 7th (lofi)
  });
}
