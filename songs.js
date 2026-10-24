"use strict";
// Thumbloop songs: the library of named songs in localStorage, cleaning imported songs, save / persist.
// ---------- songs: a library of named songs in localStorage ----------
const LIB_KEY = "thumbloop", OLD_KEY = "nes-keys";            // OLD_KEY: the single unnamed save from before songs had names
const lib = {current:null, songs:{}, clips:Array(CLIP_SLOTS).fill(null)};     // clips are shared by every song
const laneCount = sound => SOUNDS[sound].lanes.length;
const blankSection = (sound, bars=2) => ({bars, lanes:Array.from({length:laneCount(sound)}, () => Array(bars*BAR).fill(null))});
const newId = () => Date.now().toString(36)+Math.random().toString(36).slice(2, 6);
const cleanName = n => String(n||"").replace(/\s+/g, " ").trim().slice(0, 60);
const newSong = (name, sound) => ({id:newId(), name, sound, bpm:SOUNDS[sound].bpm, vol:SOUNDS[sound].lanes.map(l => l.vol ?? 1), song:[blankSection(sound)], sec:0, songMode:"off", updated:Date.now()});
const validSong = r => !!(r && SOUNDS[r.sound] && Array.isArray(r.song) && r.song.length && r.song.every(x => x && BAR_OPTIONS.includes(x.bars) && Array.isArray(x.lanes) && x.lanes.length===laneCount(r.sound)));
const clampInt = (v, lo, hi, d) => Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : d;
function cleanEntry(e, noise){                                   // rebuild an entry from typed fields only: songs from files end up inside generated Strudel code
  if (!e || typeof e!=="object") return null;
  let out = null;
  if (noise){ if (DRUMS.some(d => d.id===e.drum)) out = {drum:e.drum}; }
  else if (Number.isInteger(e.note) && e.note>=0 && e.note<=127){
    out = {note:e.note, len:clampInt(e.len, 1, MAX_STEPS, 1)};
    if (Array.isArray(e.chord)){ const iv = e.chord.slice(0, 6).filter(x => Number.isInteger(x) && x>=-24 && x<=48); if (iv.length){ out.chord = iv; if (e.block) out.block = true; } }
  }
  if (out && Array.isArray(e.more)){ const m = e.more.slice(0, 8).map(x => cleanEntry(x, noise)).filter(Boolean); if (m.length) out.more = m; }
  return out;
}
function sanitizeSong(r){                                         // a stored or imported song, or null when it can't be used
  if (!validSong(r)) return null;
  const n = laneCount(r.sound), lanesDef = SOUNDS[r.sound].lanes;
  return {id:/^[a-z0-9]{4,24}$/.test(r.id) ? r.id : newId(), name:cleanName(r.name) || "Untitled", sound:r.sound,
    bpm:clampInt(r.bpm, 60, 220, SOUNDS[r.sound].bpm),
    vol:Array.from({length:n}, (_, i) => Number.isFinite(+(r.vol||[])[i]) ? Math.max(0, Math.min(VOL_MAX, +r.vol[i])) : 1),
    song:r.song.map(sec => ({bars:sec.bars, lanes:sec.lanes.map((l, ci) => Array.from({length:sec.bars*BAR}, (_, k) => cleanEntry(Array.isArray(l) ? l[k] : null, lanesDef[ci].kind==="noise")))})),
    sec:clampInt(r.sec, 0, r.song.length-1, 0), songMode:MODES.includes(r.songMode) ? r.songMode : "off", updated:Number.isFinite(+r.updated) ? +r.updated : Date.now()};
}
function legacySong(o){                                          // the old single save becomes a song: its sections, plus the loop you were working on
  const sound = SOUNDS[o.sound] ? o.sound : "nes", n = laneCount(sound), bars = BAR_OPTIONS.includes(o.bars) ? o.bars : 2;
  const song = (Array.isArray(o.song) ? o.song : []).filter(x => x && BAR_OPTIONS.includes(x.bars) && Array.isArray(x.lanes) && x.lanes.length===n);
  if (Array.isArray(o.seq) && o.seq.length===n){
    const cur = {bars, lanes:o.seq.map(l => Array.from({length:bars*BAR}, (_, k) => (l && l[k]) || null))}, last = song[song.length-1];
    if (!last || (cur.lanes.some(l => l.some(Boolean)) && JSON.stringify(last.lanes)!==JSON.stringify(cur.lanes))) song.push(cur);
  }
  if (!song.length) song.push(blankSection(sound));
  return {id:newId(), name:"Untitled 1", sound, bpm:o.bpm||SOUNDS[sound].bpm, vol:Array.isArray(o.vol) && o.vol.length===n ? o.vol : Array(n).fill(1), song, sec:song.length-1, songMode:MODES.includes(o.songMode) ? o.songMode : "off", updated:Date.now()};
}
function adoptSong(r){                                           // make a stored song the live one (no audio work here)
  state.id = r.id; state.name = r.name; state.sound = r.sound; state.bpm = r.bpm || SOUNDS[r.sound].bpm;
  state.vol = r.vol.slice(); state.song = JSON.parse(JSON.stringify(r.song)); state.sec = Math.max(0, Math.min(state.song.length-1, r.sec|0));
  state.songMode = MODES.includes(r.songMode) ? r.songMode : "off"; state.clips = lib.clips;
}
const songRec = () => ({id:state.id, name:state.name, sound:state.sound, bpm:state.bpm, vol:state.vol, song:state.song, sec:state.sec, songMode:state.songMode, updated:Date.now()});
function persist(){
  lib.clips = state.clips;
  try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); saveFailed = false; const el = document.getElementById("saved"); if (el) el.textContent = "saved \u2713"; }
  catch(e){ if (!saveFailed) toast("couldn't save: browser storage is full or blocked. Ctrl+S keeps a backup file."); saveFailed = true; }
}
const save = () => { commit(); lib.songs[state.id] = songRec(); lib.current = state.id; persist(); };
const stepDur = () => 60/state.bpm/4;
