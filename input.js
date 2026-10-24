"use strict";
// Thumbloop input: keyboard and gamepad. Which key or button does what is in config.js.
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
const PAD_NOTES = {14:0, 13:3, 15:5, 12:7, 2:10, 0:12, 1:15, 3:17};  // dpad L,D,R,U then X,A,B,Y: minor pentatonic, no wrong notes
const PAD_DRUMS = {0:"bd", 2:"sd", 3:"hh", 1:"oh", 12:"cp", 13:"rim", 14:"lt", 15:"ht"};   // A kick, X snare, Y hat, B open hat, D-pad up clap / down rim / left low tom / right high tom
const PAD_NAMES = {0:"A", 1:"B", 2:"X", 3:"Y", 12:"\u25b2", 13:"\u25bc", 14:"\u25c0", 15:"\u25b6"};
const padNoteBtn = Object.fromEntries(Object.entries(PAD_NOTES).map(([b, semis]) => [semis, PAD_NAMES[b]]));
const padDrumBtn = Object.fromEntries(Object.entries(PAD_DRUMS).map(([b, id]) => [id, PAD_NAMES[b]]));
const pianoKey = Object.fromEntries(Object.entries(PIANO).map(([k, semis]) => [semis, k.toUpperCase()]));
const padHeld = {}, rs = {x:{dir:0,t:0}, y:{dir:0,t:0}}, ls = {x:{dir:0,t:0}};
const padTap = {};                                        // tap/hold buttons in flight: {timer, fired, used}
let padId = null, stickMoved = false;
function stickStep(a, v){          // a stick axis as a d-pad: fires once per push, then repeats while held
  const dir = v > .6 ? 1 : v < -.6 ? -1 : 0, now = performance.now();
  if (!dir){ a.dir = 0; return 0; }
  if (dir !== a.dir){ a.dir = dir; a.t = now+400; a.rep = false; return dir; }
  if (now > a.t){ a.t = now+160; a.rep = true; return dir; }
  return 0;
}
function stripNav(d, repeat){                // move along the sections; with Y held, move the section itself
  if (padHeld[3]){ const to = state.sec+d; if (to>=0 && to<state.song.length) actions.secMove(state.sec, to); return; }
  if (d>0 && state.sec===state.song.length-1){ if (!repeat) actions.secNew(); } else actions.secGo(state.sec+d);        // past the last one adds a new one (not while held)
}
function stripButton(i){                      // controller buttons while the sections row is focused
  if (i===14 || i===15) stripNav(i===15 ? 1 : -1, false);
  else if (i===0) actions.secNew();           // A: new section (a copy of this one)
  else if (i===2) actions.secDel();           // X: delete this section
  else if (i===1 || i===12) actions.focusMove(-1);   // B or D-pad up: back to the lanes
}
function pollPad(){
  const gp = [...navigator.getGamepads()].find(g => g && g.connected);
  if ((gp ? gp.id : null) !== padId){ padId = gp ? gp.id : null; $("pad").textContent = padId ? "\u{1F3AE} " + padId.replace(/\s*\(.*\)/,"") : ""; }
  if (!gp) return;
  const ly = gp.axes[1] || 0;                          // left stick: up = louder, down = quieter
  if (Math.abs(ly) > .3){ actions.vol(-ly*.015, true); stickMoved = true; setInput("pad"); }
  else if (stickMoved){ stickMoved = false; const ci = state.ch; state.vol[ci] = Math.round(state.vol[ci]/VOL_STEP)*VOL_STEP; state.vol[ci] = Math.round(state.vol[ci]*1000)/1000; applyVol(ci); refresh(); save(); }   // settle on a 5% step
  const lx = Math.abs(ly) < .5 ? stickStep(ls.x, gp.axes[0] || 0) : 0;            // left stick \u25c0\u25b6: octave
  if (lx){ setInput("pad"); actions.oct(lx); }
  const sx = stickStep(rs.x, gp.axes[2] || 0), sy = stickStep(rs.y, gp.axes[3] || 0);   // right stick
  if (sx || sy){
    setInput("pad");
    if (sy) actions.focusMove(sy);                                                     // up/down: lane, then the sections row
    if (sx && padHeld[PAD_MODIFIER]){ if (padTap[PAD_MODIFIER]) padTap[PAD_MODIFIER].used = true; actions.bpm(sx*(rs.x.rep ? 10 : 5)); }       // LB held + left/right: tempo (10 while held)
    else if (sx) stripNav(sx, rs.x.rep);                                               // left/right: section
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
    else if (!noise && i in PAD_NOTES) trigger(id, PAD_NOTES[i], null, chordFor(padHeld[7], padHeld[6]));   // RT = major, LT = minor, both = dominant 7th (lofi)
  });
}
