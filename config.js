"use strict";
// Thumbloop config: sound sets, drums, piano keys, and every key / button binding. This is the file to edit.
// ---------- data ----------
const CLIP_SLOTS = 8;
const VOL_STEP = .05;                        // keyboard volume steps (the left stick is smooth, then settles on the nearest step)
const VOL_MAX = 1.5;                         // lane volume goes to 150% so quiet voices can be pushed up (the output limiter catches peaks)
const BAR = 16, BAR_OPTIONS = [1,2,4,8], MAX_STEPS = 8*BAR;   // 16th-note steps
let STEPS = 32;                              // loop length in steps (state.bars * BAR)
const SOUNDS = {
  // A sound set is data: a name, a tempo, how chords sound, and its lanes. Add an entry here and it shows up in the Sound button and
  // the Songs panel. A lane has a name, colour, kind (pulse / tri / synth / rhodes / bass / noise = drums), base note (MIDI), level
  // (loudness), optional default volume `vol`, and `strudel` = the sound chain used when exporting. kind "synth" is built from
  // the lane's `synth` settings: oscillators (type, detune in cents, ratio to the note's pitch, gain, decay), lowpass, envelope.
  nes: {label:"NES chiptune", bpm:120, chords:{block:false, rt:{iv:[0,4,7], name:"major chord"}, lt:{iv:[0,3,7], name:"minor chord"}, both:{iv:[0,4,7], name:"major chord"}}, lanes:[
    {name:"Pulse 1",  color:"#c4a7ff", kind:"pulse", duty:.25,  base:60, level:.22, env:{a:.003,d:.15,s:.5},
     strudel:'.s("pulse").pw(.25).crush(6).decay(.15).sustain(.4)'},
    {name:"Pulse 2",  color:"#ff8fcf", kind:"pulse", duty:.125, base:48, level:.18, env:{a:.003,d:.10,s:.4},
     strudel:'.s("pulse").pw(.125).crush(6).gain(.45).decay(.08).sustain(.2)'},
    {name:"Triangle", color:"#7fe3c8", kind:"tri",   base:36, level:.5, env:{a:.003,d:.05,s:1},
     strudel:'.s("triangle")'},
    {name:"Drums",    color:"#ffd37a", kind:"noise", strudel:'.bank("RolandTR909")'}]},
  lofi: {label:"Lofi", bpm:80, chords:{block:true, rt:{iv:[0,4,7,11], name:"maj7"}, lt:{iv:[0,3,7,10], name:"min7"}, both:{iv:[0,4,7,10], name:"dom7"}}, lanes:[
    {name:"Keys",     color:"#ffb48a", kind:"rhodes", base:60, level:.2,
     strudel:'.s("gm_epiano1").lpf(3500).room(.3).gain(.8)'},
    {name:"Keys high", color:"#e8a0bf", kind:"rhodes", base:72, level:.14,
     strudel:'.s("gm_epiano1").lpf(3500).room(.3).gain(.55)'},
    {name:"Bass",     color:"#8fc9a9", kind:"bass",   base:36, level:.4,
     strudel:'.s("sine").lpf(500).gain(.9)'},
    {name:"Drums",    color:"#ffd37a", kind:"noise", strudel:'.bank("RolandTR909")'}]},
  synthwave: {label:"Synthwave", bpm:100, chords:{block:true, rt:{iv:[0,4,7,11], name:"maj7"}, lt:{iv:[0,3,7,10], name:"min7"}, both:{iv:[0,4,7,10], name:"dom7"}}, lanes:[
    {name:"Lead", color:"#ff7edb", kind:"synth", base:72, level:.16,
     synth:{osc:[{type:"sawtooth", detune:-7}, {type:"sawtooth", detune:7}, {type:"square", gain:.5}], lp:4200, q:3, env:{a:.01, d:.25, s:.6, r:.2}},
     strudel:'.s("sawtooth").lpf(4200).gain(.5).delay(.25)'},
    {name:"Pad", color:"#9d7bff", kind:"synth", base:48, level:.12,
     synth:{osc:[{type:"sawtooth", detune:-12}, {type:"sawtooth"}, {type:"sawtooth", detune:12}], lp:1800, env:{a:.35, d:.8, s:.8, r:.7}},
     strudel:'.s("supersaw").lpf(1800).attack(.3).release(.7).gain(.45)'},
    {name:"Bass", color:"#5be3ff", kind:"synth", base:36, level:.34,
     synth:{osc:[{type:"sawtooth"}, {type:"square", ratio:.5, gain:.6}], lp:700, q:2, env:{a:.005, d:.18, s:.6, r:.08}},
     strudel:'.s("sawtooth").lpf(700).gain(.8)'},
    {name:"Drums", color:"#ffd37a", kind:"noise", strudel:'.bank("RolandTR909")'}]},
  ambient: {label:"Ambient", bpm:70, chords:{block:true, rt:{iv:[0,4,7,11], name:"maj7"}, lt:{iv:[0,3,7,10], name:"min7"}, both:{iv:[0,2,7], name:"sus2"}}, lanes:[
    {name:"Pad", color:"#8fd3ff", kind:"synth", base:48, level:.16,
     synth:{osc:[{type:"triangle", detune:-6}, {type:"triangle", detune:6}, {type:"sine", ratio:2, gain:.4}], lp:1400, env:{a:1.1, d:1.5, s:.85, r:1.8}},
     strudel:'.s("triangle").lpf(1400).attack(1).release(2).room(.8).gain(.5)'},
    {name:"Bells", color:"#ffe3a0", kind:"synth", base:72, level:.16,
     synth:{osc:[{type:"sine"}, {type:"sine", ratio:3.5, gain:.35, decay:.5}, {type:"sine", ratio:5.4, gain:.2, decay:.3}], env:{a:.003, d:1.6, s:0, r:1.2}},
     strudel:'.s("gm_celesta").room(.7).gain(.6)'},
    {name:"Drone", color:"#c9a7ff", kind:"synth", base:36, level:.26,
     synth:{osc:[{type:"sine"}, {type:"sine", ratio:2, gain:.8}, {type:"triangle", ratio:3, gain:.35}], lp:900, env:{a:1.8, d:2, s:.9, r:3}},
     strudel:'.s("sine").lpf(500).attack(1.5).release(3).room(.6).gain(.6)'},
    {name:"Percussion", color:"#9be8c6", kind:"noise", vol:.55, strudel:'.bank("RolandTR909").gain(.6)'}]},
};
const CHANNELS = SOUNDS.nes.lanes.map(c => ({...c}));     // mutated in place by applySound() so every reference stays valid
const DRUMS = [  // key -> TR-909 hit (synth fallback while samples load); gm = General MIDI drum note for the .mid export
  {id:"bd", gm:36, key:"a", label:"kick",       filter:"lowpass",  freq:260,  dur:.16, level:1.0},
  {id:"sd", gm:38, key:"s", label:"snare",      filter:"bandpass", freq:1800, dur:.13, level:.8},
  {id:"hh", gm:42, key:"d", label:"hat",        filter:"highpass", freq:7000, dur:.04, level:.5},
  {id:"oh", gm:46, key:"f", label:"open hat",   filter:"highpass", freq:6000, dur:.22, level:.45},
  {id:"cp", gm:39, key:"g", label:"clap",       filter:"bandpass", freq:1200, dur:.16, level:.8},
  {id:"rim", gm:37, key:"h", label:"rim",       filter:"highpass", freq:3000, dur:.04, level:.6},
  {id:"lt", gm:45, key:"j", label:"low tom",    filter:"lowpass",  freq:180,  dur:.25, level:.9},
  {id:"ht", gm:50, key:"k", label:"high tom",   filter:"lowpass",  freq:320,  dur:.2,  level:.8},
];
const PIANO = {a:0,w:1,s:2,e:3,d:4,f:5,t:6,g:7,y:8,h:9,u:10,j:11,k:12,o:13,l:14,p:15,";":16};
const NOTE_NAMES = ["c","c#","d","d#","e","f","f#","g","g#","a","a#","b"];
const ARP_HZ = 30;                            // arpeggiated chords (NES): one voice cycling the chord tones, ~30 times a second
const chordFor = (rt, lt) => { if (!rt && !lt) return null; const set = SOUNDS[state.sound].chords; return {iv:set[rt&&lt ? "both" : rt ? "rt" : "lt"].iv, block:set.block}; };   // hold RT / LT
const MODES = ["off","last","all","play"];     // what you hear (LB cycles it): this section / previous + this / the song up to here / the whole song
const MODE_LABEL = {off:"this section", last:"previous + this", all:"song up to here", play:"whole song"};
// ---------- controls: rebind things here ----------
// DO: every action a key or button can trigger. KEYMAP / PADMAP below say which key or button does what,
// and the on-screen help is generated from them. (Piano keys are PIANO above, drum keys are DRUMS above.)
const DO = {
  play:() => actions.play(), rec:() => actions.rec(), clearLane:() => actions.clear(), metro:() => actions.metro(), soundSet:() => actions.sound(),
  octDown:() => actions.oct(-1), octUp:() => actions.oct(1), volDown:() => actions.vol(-VOL_STEP), volUp:() => actions.vol(VOL_STEP),
  barsDown:() => actions.bars(-1), barsUp:() => actions.bars(1), tempoDown:() => actions.bpm(-5), tempoUp:() => actions.bpm(5),
  secPrev:() => actions.secGo(state.sec-1), secNext:() => actions.secGo(state.sec+1), newSection:() => actions.secNew(), secDelete:() => actions.secDel(),
  hearCycle:() => actions.scope(), export:() => openModal(), undo:() => actions.undo(),
  copyBars:() => actions.barsCopy(), pasteBars:() => actions.barsPaste(), songs:() => openSongs(), backup:() => backupSong(),
};
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
const PAD_BTN = {4:"LB", 5:"RB", 8:"View", 9:"Start", 10:"L3", 11:"R3"};
const PADMAP = [          // press: act. tap/hold: tap on release, hold after HOLD_MS. (notes, chords and sticks are in the controller code below)
  {btn:9, act:"rec", label:"record"}, {btn:8, act:"play", label:"play"},
  {btn:10, act:"soundSet", label:"sound set"}, {btn:11, act:"metro", label:"metronome"},
  {btn:5, tap:"clearLane", hold:"undo", label:"tap clear lane \u00b7 hold undo"},
  {btn:4, tap:"hearCycle", label:"tap what you hear \u00b7 hold + right stick \u25c0\u25b6 tempo"},
];
const PAD_MODIFIER = 4, HOLD_MS = 500;                    // hold LB + right stick left/right = tempo
const PAD_STICK_HELP = ["right stick \u25b2\u25bc lane, then the sections row \u00b7 \u25c0\u25b6 section (past the last = new)", "left stick \u25b2\u25bc volume \u00b7 \u25c0\u25b6 octave", "on the sections row: D-pad \u25c0\u25b6 pick \u00b7 A new \u00b7 X delete \u00b7 hold Y + \u25c0\u25b6 move \u00b7 B back"];
const keyAction = {}, ctrlAction = {};
KEYMAP.forEach(r => r.keys.forEach((k, i) => { (r.ctrl ? ctrlAction : keyAction)[k] = r.act[i]; }));
