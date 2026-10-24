#!/usr/bin/env python3
"""Download the TR-909 drum samples Thumbloop uses and write them to drums.js.

The samples come from github.com/ritchse/tidal-drum-machines (the same ones Strudel plays
for .bank("RolandTR909")). That repo has no license, so they are not bundled here.
Without drums.js the page still works: the drums fall back to a synthesized noise kit.

    python3 tools/fetch-samples.py            # writes drums.js next to index.html
    python3 tools/fetch-samples.py --out x.js
"""
import argparse, base64, pathlib, sys, urllib.parse, urllib.request

BASE = "https://raw.githubusercontent.com/ritchse/tidal-drum-machines/main/machines/RolandTR909/"
SAMPLES = {  # id used in the app -> folder/file in the sample repo
    "bd": "rolandtr909-bd/Bassdrum-01.wav", "sd": "rolandtr909-sd/naredrum.wav",
    "hh": "rolandtr909-hh/hh01.wav",        "oh": "rolandtr909-oh/Hat Open.wav",
    "cp": "rolandtr909-cp/Clap.wav",        "rim": "rolandtr909-rim/Rimhot.wav",
    "lt": "rolandtr909-lt/Tom L.wav",       "ht": "rolandtr909-ht/Tom H.wav",
}

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(pathlib.Path(__file__).resolve().parent.parent / "drums.js"))
    out = pathlib.Path(ap.parse_args().out)
    lines = ["// TR-909 samples from ritchse/tidal-drum-machines, written by tools/fetch-samples.py (not part of the repo)",
             "window.DRUM_SAMPLES = {"]
    for sid, path in SAMPLES.items():
        url = BASE + urllib.parse.quote(path)
        try:
            data = urllib.request.urlopen(url, timeout=30).read()
        except Exception as e:
            print(f"failed: {sid} ({url}): {e}", file=sys.stderr); return 1
        lines.append(f'  {sid}: "data:audio/wav;base64,{base64.b64encode(data).decode()}",')
        print(f"{sid}: {len(data)//1024} KB")
    lines.append("};")
    out.write_text("\n".join(lines) + "\n")
    print(f"wrote {out}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
