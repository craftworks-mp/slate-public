"""Daily Drill gate (owner OK 11/22 23:0x): decides whether a daily render may go public as a Buffer draft.

    python tiktok/drill/daily.py gate RUN_DIR DAILY_DIR episode.mp4 RUN_ID   # done.json (+ drill.mp4 when it passes)
    python tiktok/drill/daily.py failed DAILY_DIR "why" RUN_ID                # done.json for a run that stopped early

Only a render that passes every check leaves a plain drill.mp4 (it goes public on TikTok anyway); anything else stays
encrypted and done.json says why, so slate-data's draft step stops waiting and the handoff can name the reason.
Stdlib + ffprobe only."""
import json
import os
import shutil
import subprocess
import sys

MIN_S = 61  # TikTok Creator Rewards counts 1 min+ (owner 11/21)
FLOOR = 0.85  # the words check's own floor (check.py)


def duration(mp4):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def verdict(cues, transcript, length_s):
    """The reasons a render can't go public (empty = it can)."""
    words = (transcript or {}).get("match")
    why = []
    if length_s < MIN_S:
        why.append(f"{length_s:.1f} s is under {MIN_S} s")
    if words is None or words < FLOOR:
        why.append(f"words check {words if words is None else f'{words:.0%}'} under {FLOOR:.0%}")
    if (cues or {}).get("trial_names"):
        why.append("a trial name is in it")
    if not (cues or {}).get("next_last"):
        why.append("no answer saved for the next Drill")
    return why


def gate(run_dir, daily_dir, mp4, run_id):
    load = lambda f: json.load(open(os.path.join(run_dir, f))) if os.path.exists(os.path.join(run_dir, f)) else None
    cues, tr = load("cues.json"), load("transcript.json")
    length = round(duration(mp4), 1)
    why = verdict(cues, tr, length)
    done = {"ok": not why, "why": why, "run": str(run_id), "dir": run_dir, "length_s": length,
            "words": (tr or {}).get("match"), "next_last": (cues or {}).get("next_last")}
    if not why:
        shutil.copy(mp4, os.path.join(daily_dir, "drill.mp4"))
    json.dump(done, open(os.path.join(daily_dir, "done.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in done.items() if k != "next_last"}))
    return done


def failed(daily_dir, why, run_id):
    done = {"ok": False, "why": [why], "run": str(run_id)}
    os.makedirs(daily_dir, exist_ok=True)
    json.dump(done, open(os.path.join(daily_dir, "done.json"), "w"), indent=1)
    print(json.dumps(done))
    return done


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["gate"] and len(a) == 5:
        gate(*a[1:])
    elif a[:1] == ["failed"] and len(a) == 4:
        failed(*a[1:])
    else:
        sys.exit(__doc__)
