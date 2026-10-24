"use strict";
// Thumbloop controls: every key and controller button, in one place. Rebind things here.
// The on-screen help is generated from these tables. (Sounds, lanes and drum voices are in sounds.js.)

// ---------- actions ----------
// DO: everything a key or button can trigger. KEYMAP and PAD_BUTTONS below say which one does what.
const DO = {
  play:() => actions.play(), rec:() => actions.rec(), clearLane:() => actions.clear(), metro:() => actions.metro(), soundSet:() => actions.sound(),
  octDown:() => actions.oct(-1), octUp:() => actions.oct(1), volDown:() => actions.vol(-VOL_STEP), volUp:() => actions.vol(VOL_STEP),
  barsDown:() => actions.bars(-1), barsUp:() => actions.bars(1), tempoDown:rep => actions.bpm(rep ? -10 : -5), tempoUp:rep => actions.bpm(rep ? 10 : 5),   // rep = held: the stick repeats, and tempo speeds up
  secPrev:() => actions.secGo(state.sec-1), secNext:() => actions.secGo(state.sec+1), newSection:() => actions.secNew(), secDelete:() => actions.secDel(),
  laneUp:() => actions.focusMove(-1), laneDown:() => actions.focusMove(1), stripPrev:rep => stripNav(-1, rep), stripNext:rep => stripNav(1, rep),   // lane up/down walks the lanes, then the sections row
  hearCycle:() => actions.scope(), export:() => openModal(), undo:() => actions.undo(),
  copyBars:() => actions.barsCopy(), pasteBars:() => actions.barsPaste(), songs:() => openSongs(), backup:() => backupSong(),
};

// ---------- keyboard ----------
const PIANO = {a:0,w:1,s:2,e:3,d:4,f:5,t:6,g:7,y:8,h:9,u:10,j:11,k:12,o:13,l:14,p:15,";":16};   // key -> semitones above the lane's base note
const DRUM_KEYS = {bd:"a", sd:"s", hh:"d", oh:"f", cp:"g", rim:"h", lt:"j", ht:"k"};            // drum id (see DRUMS in sounds.js) -> key, on the drum lane
const KEYMAP = [          // keys are event.key in lower case; several keys on a row map to the actions listed in the same order
  {keys:[" "], act:["play"], label:"play"},
  {keys:["r"], act:["rec"], label:"record"},
  {keys:["c"], act:["clearLane"], label:"clear lane"},
  {keys:["m"], act:["metro"], label:"metronome"},
  {keys:["z","x"], act:["octDown","octUp"], label:"octave"},
  {keys:["[","]"], act:["volDown","volUp"], label:"volume"},
  {keys:[",","."], act:["barsDown","barsUp"], label:"loop length"},
  {keys:["-","="], act:["tempoDown","tempoUp"], label:"tempo"},
  {keys:["arrowleft","arrowright"], act:["secPrev","secNext"], label:"section"},
  {keys:["n"], act:["newSection"], label:"new section"},
  {keys:["delete"], act:["secDelete"], label:"delete section"},
  {keys:["/"], act:["hearCycle"], label:"what you hear"},
  {keys:["v"], act:["export"], label:"export"},
  {ctrl:true, keys:["z"], act:["undo"], label:"undo"},
  {ctrl:true, keys:["c","v"], act:["copyBars","pasteBars"], label:"copy / paste bars"},
  {ctrl:true, keys:["o","s"], act:["songs","backup"], label:"songs / backup file"},
];
const KEY_REPEAT = new Set(["secPrev","secNext"]);       // actions that keep firing while the key is held
const CHORD_KEYS = {q:"rt", b:"lt"};                      // hold for the major / minor chord (rt = right trigger's role, lt = left's)

// ---------- controller ----------
// Buttons have names, so the tables below read like the pad in your hands (Xbox layout; a PlayStation pad maps the same way).
const BTN = {A:0, B:1, X:2, Y:3, LB:4, RB:5, LT:6, RT:7, VIEW:8, START:9, L3:10, R3:11, UP:12, DOWN:13, LEFT:14, RIGHT:15};
const BTN_LABEL = {UP:"▲", DOWN:"▼", LEFT:"◀", RIGHT:"▶", VIEW:"View", START:"Start"};   // what the help and the note labels show (the rest show their own name)

// Playing: what each button plays. note = semitones above the lane's base note (minor pentatonic, so there are no wrong notes);
// drum = the hit on the drums lane (ids from DRUMS in sounds.js).
const PAD_PLAY = {
  LEFT:  {note: 0,  drum:"lt"},
  DOWN:  {note: 3,  drum:"rim"},
  RIGHT: {note: 5,  drum:"ht"},
  UP:    {note: 7,  drum:"cp"},
  X:     {note: 10, drum:"sd"},
  A:     {note: 12, drum:"bd"},
  B:     {note: 15, drum:"oh"},
  Y:     {note: 17, drum:"hh"},
};
const PAD_CHORD = {rt:"RT", lt:"LT"};                     // hold to play chords (RT = major, LT = minor, both = see the sound set's chords)

// Commands: press = act; tap / hold = tap on release, or hold for HOLD_MS.
const PAD_BUTTONS = [
  {btn:"START", act:"rec",       label:"record"},
  {btn:"VIEW",  act:"play",      label:"play"},
  {btn:"L3",    act:"soundSet",  label:"sound set"},
  {btn:"R3",    act:"metro",     label:"metronome"},
  {btn:"RB",    tap:"clearLane", hold:"undo", label:"tap clear lane · hold undo"},
  {btn:"LB",    tap:"hearCycle", label:"tap what you hear"},
];
const HOLD_MS = 500;                                 // how long a hold takes, for the tap / hold buttons above

// On the sections row (right stick down past the last lane) the buttons edit sections instead of playing notes.
const PAD_STRIP = {LEFT:"prev", RIGHT:"next", A:"new", X:"delete", B:"back", UP:"back"};
const PAD_STRIP_MOVE = "Y";                               // hold + LEFT / RIGHT to move the section itself

// Sticks: each direction is a d-pad press (once per push, then repeating while held) that fires an action from DO above.
const PAD_STICK_AXES = {left:[0, 1], right:[2, 3]};      // gamepad axis numbers (x, y) of each stick; change them if your pad reports differently
const PAD_STICKS = {
  left:  {up:"volUp",   down:"volDown",  left:"octDown",   right:"octUp"},
  right: {up:"laneUp",  down:"laneDown", left:"stripPrev", right:"stripNext"},   // stripPrev / stripNext: section back / forward (past the last = new)
};
const PAD_STICK_HOLD = {                                  // with this button held, these stick directions do something else (the rest work as normal)
  LB: {right:{left:"tempoDown", right:"tempoUp"}},
};
const STICK_LABEL = {volUp:"volume up", volDown:"volume down", octDown:"octave down", octUp:"octave up", laneUp:"lane up", laneDown:"lane down",
  stripPrev:"section back", stripNext:"section forward", tempoDown:"tempo down", tempoUp:"tempo up"};   // names for the help

// ---------- derived lookups (the code reads these; nothing to edit below) ----------
DRUMS.forEach(d => { d.key = DRUM_KEYS[d.id]; });
const keyAction = {}, ctrlAction = {};
KEYMAP.forEach(r => r.keys.forEach((k, i) => { (r.ctrl ? ctrlAction : keyAction)[k] = r.act[i]; }));
const PAD_NOTES = Object.fromEntries(Object.entries(PAD_PLAY).map(([n, p]) => [BTN[n], p.note]));
const PAD_DRUMS = Object.fromEntries(Object.entries(PAD_PLAY).map(([n, p]) => [BTN[n], p.drum]));
const PAD_NAMES = Object.fromEntries(Object.entries(PAD_PLAY).map(([n]) => [BTN[n], BTN_LABEL[n] || n]));
const PADMAP = PAD_BUTTONS.map(r => ({...r, btn:BTN[r.btn]}));
const PAD_BTN = Object.fromEntries(Object.entries(BTN).map(([n, i]) => [i, BTN_LABEL[n] || n]));   // button number -> name, for the help
const PAD_STICK_HELP = [                                  // the help lines for the sticks and the sections row
  ...Object.entries(PAD_STICKS).map(([n, d]) => n+" stick "+["up","down","left","right"].map(k => BTN_LABEL[k.toUpperCase()]+" "+STICK_LABEL[d[k]]).join(" \u00b7 ")),
  ...Object.entries(PAD_STICK_HOLD).flatMap(([b, sticks]) => Object.entries(sticks).map(([n, d]) => "hold "+b+" + "+n+" stick "+Object.entries(d).map(([k, a]) => BTN_LABEL[k.toUpperCase()]+" "+STICK_LABEL[a]).join(" \u00b7 "))),
  "on the sections row: D-pad \u25c0\u25b6 pick \u00b7 A new \u00b7 X delete \u00b7 hold Y + \u25c0\u25b6 move \u00b7 B back"];
