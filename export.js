"use strict";
// Thumbloop export: turns the song into Strudel code.
// ---------- export ----------
function noteLayers(seq, steps){           // split a lane into single-voice layers: a note goes on the first layer that is free when it starts
  const layers = [], ends = [];
  for (let i=0;i<steps;i++) entriesAt(seq[i]).forEach(n => {
    let k = ends.findIndex(end => end <= i);
    if (k<0){ k = layers.length; layers.push(Array(steps).fill(null)); ends.push(0); }
    layers[k][i] = n; ends[k] = i + (n.drum ? 1 : Math.max(1, n.len || 1));
  });
  return layers;
}
function stepTokens(seq, steps){           // one token per 16th step: note / [chord] / drum / ~ rest / _ held
  const out = Array(steps).fill("~");
  const starts = seq.slice(0, steps).map((e,i)=>e?i:-1).filter(i=>i>=0);
  starts.forEach((i, j) => {
    const e = seq[i];
    if (e.drum){ out[i] = e.drum; return; }
    const next = j+1<starts.length ? starts[j+1] : steps;
    const len = Math.max(1, Math.min(e.len, next-i));
    const nm = m => NOTE_NAMES[m%12] + (Math.floor(m/12)-1);
    out[i] = !e.chord ? nm(e.note) : e.block ? "["+e.chord.map(x => nm(e.note+x)).join(",")+"]"
           : "["+e.chord.map(x => nm(e.note+x)).join(" ")+"]*"+(+(stepDur()*ARP_HZ/e.chord.length*len).toFixed(2));
    for (let k=1;k<len;k++) out[i+k] = "_";
  });
  return out;
}
function laneCode(ci, seq, bars){          // one lane's patterns plus its sound (stacked when notes overlap), or null when it is silent
  const layers = noteLayers(seq, bars*BAR); if (!layers.length) return null;
  const c = CHANNELS[ci], pg = state.vol[ci]!==1 ? ".postgain("+state.vol[ci]+")" : "";
  const codes = layers.map(layer => {
    const t = stepTokens(layer, bars*BAR), groups = Array.from({length:bars}, (_, b) => t.slice(b*BAR, (b+1)*BAR).join(" "));
    const pat = groups.every(g => g===groups[0]) ? "["+groups[0]+"]" : "<"+groups.map(g => "["+g+"]").join(" ")+">";
    return (c.kind==="noise" ? "s" : "note")+'("'+pat+'")'+c.strudel+pg;
  });
  return codes.length>1 ? "stack(\n    "+codes.join(",\n    ")+"\n  )" : codes[0];
}
function toStrudel(){
  commit();
  const lines = ["// "+state.name.replace(/[^\w .,'-]/g, "")+" \u00b7 made in Thumbloop", "setcps("+state.bpm+"/60/4)", ""];
  if (state.song.length>1){                // the whole song: each distinct section once, then arranged in order
    const letters = sectionLetters(), done = new Set();
    state.song.forEach((sec, i) => {
      if (done.has(letters[i])) return; done.add(letters[i]);
      const lanes = CHANNELS.map((c, ci) => laneCode(ci, sec.lanes[ci], sec.bars)).filter(Boolean);
      lines.push("// section "+letters[i]+" ("+sec.bars+(sec.bars===1?" bar":" bars")+")",
                 "const sec"+letters[i]+" = "+(lanes.length ? "stack(\n  "+lanes.join(",\n  ")+"\n)" : "silence"), "");
    });
    lines.push("// the song, in order", "$: arrange("+state.song.map((sec, i) => "["+sec.bars+", sec"+letters[i]+"]").join(", ")+")");
    return lines.join("\n");
  }
  CHANNELS.forEach((c, ci) => {            // no song yet: export the loop you are working on
    const code = laneCode(ci, state.seq[ci], state.bars); if (!code) return;
    lines.push("// "+c.name, "$: "+code+"._scope()", "");
  });
  if (lines.length<=3) lines.push("// nothing recorded yet: hit R and play");
  return lines.join("\n");
}

// ---------- MIDI file: one track per lane, the sections in order ----------
function toMidi(){
  commit();
  const PPQ = 96, STEP = PPQ/4;                                   // a step is a 16th note
  const be = (n, bytes) => Array.from({length:bytes}, (_, i) => (n >> 8*(bytes-1-i)) & 255);
  const vlq = n => { const o = [n & 127]; while ((n >>= 7)) o.unshift((n & 127) | 128); return o; };
  const text = (type, s) => [0xFF, type, ...vlq(s.length), ...Array.from(s, ch => ch.charCodeAt(0) & 127)];
  const track = events => {                                      // events: {tick, off, bytes}; note-offs first at the same tick
    events.sort((a, b) => a.tick-b.tick || b.off-a.off);
    let last = 0; const out = [];
    events.forEach(ev => { out.push(...vlq(ev.tick-last), ...ev.bytes); last = ev.tick; });
    out.push(0, 0xFF, 0x2F, 0);
    return [0x4D,0x54,0x72,0x6B, ...be(out.length, 4), ...out];
  };
  const mpqn = Math.round(60e6/state.bpm);
  const tracks = [track([{tick:0, off:0, bytes:text(0x03, state.name.replace(/[^\w .,'-]/g, ""))}, {tick:0, off:0, bytes:[0xFF,0x51,3, ...be(mpqn, 3)]}])];
  CHANNELS.forEach((c, ci) => {
    const drums = c.kind==="noise", ch = drums ? 9 : (ci < 9 ? ci : ci+1) & 15, ev = [], vel = Math.max(1, Math.min(127, Math.round(90*state.vol[ci])));
    let at = 0;
    state.song.forEach(sec => {
      const steps = sec.bars*BAR;
      for (let i=0;i<steps;i++) entriesAt(sec.lanes[ci][i]).forEach(n => {
        const notes = n.drum ? [DRUMS.find(d => d.id===n.drum).gm] : n.chord ? n.chord.map(x => n.note+x) : [n.note];
        const len = n.drum ? 1 : Math.max(1, Math.min(n.len || 1, steps-i)), t0 = (at+i)*STEP;
        notes.forEach(m => { m = Math.max(0, Math.min(127, m));
          ev.push({tick:t0, off:0, bytes:[0x90|ch, m, vel]}, {tick:t0+(n.drum ? STEP/2 : len*STEP), off:1, bytes:[0x80|ch, m, 0]}); });
      });
      at += steps;
    });
    if (ev.length) tracks.push(track([{tick:0, off:0, bytes:text(0x03, c.name)}, ...ev]));
  });
  return new Uint8Array([0x4D,0x54,0x68,0x64, ...be(6, 4), ...be(1, 2), ...be(tracks.length, 2), ...be(PPQ, 2), ...tracks.flat()]);
}
