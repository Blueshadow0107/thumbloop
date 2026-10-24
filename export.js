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
