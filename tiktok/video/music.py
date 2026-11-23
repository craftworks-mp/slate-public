"""Music beds for the Drill video (owner 11/22): CC0 tracks from OpenGameArt.org, one per part, fetched on the runner
at render time, so no track file sits in this repo.

    python tiktok/video/music.py fetch tiktok/video/music.json OUT_DIR

Writes OUT_DIR/music.json (part -> local file + gain) for make.py --music, or nothing when no part has a track yet.
Each page must still show the CC0 license when fetched; a track that changed license fails the step instead of
going out under the wrong terms."""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

PARTS = ("opener", "question", "clock", "reveal")
CC0 = re.compile(r"publicdomain/zero/1\.0|>\s*CC0\s*<")
AUDIO = re.compile(r"""href=["']([^"']+?\.(?:ogg|mp3|wav|flac))["']""", re.I)
UA = {"User-Agent": "Mozilla/5.0 (TrendBettors TikTok Drill renderer)"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def pick(html, want=None):
    """The track file linked on the page: the named one when given, else the first ogg/mp3 (wav/flac last)."""
    links = [urllib.parse.unquote(x) for x in AUDIO.findall(html)]
    if want:
        hit = [x for x in links if os.path.basename(x) == want]
        assert hit, f"{want} isn't linked on the page"
        return hit[0]
    rank = {".ogg": 0, ".mp3": 1, ".wav": 2, ".flac": 3}
    assert links, "no audio file linked on the page"
    return sorted(links, key=lambda x: rank[os.path.splitext(x)[1].lower()])[0]


def fetch(cfg_path, out):
    cfg = json.load(open(cfg_path))
    parts = {k: v for k, v in cfg.get("parts", {}).items() if v and v.get("page")}
    bad = set(parts) - set(PARTS)
    assert not bad, f"unknown parts: {bad}"
    if not parts:
        print("no music picked yet: voice only")
        return None
    os.makedirs(out, exist_ok=True)
    res = {"parts": {}}
    for part, t in parts.items():
        html = get(t["page"]).decode("utf-8", "replace")
        assert CC0.search(html), f"{part}: {t['page']} no longer shows CC0"
        link = urllib.parse.urljoin(t["page"], urllib.parse.quote(pick(html, t.get("file")), safe="/:"))
        name = f"{part}{os.path.splitext(link)[1].lower()}"
        open(os.path.join(out, name), "wb").write(get(link))
        res["parts"][part] = {"file": name, "gain_db": t.get("gain_db", -18)}
        print(f"{part}: {t.get('title', '')} <- {link}")
    p = os.path.join(out, "music.json")
    json.dump(res, open(p, "w"), indent=1)
    return p


if __name__ == "__main__":
    assert sys.argv[1] == "fetch", __doc__
    fetch(sys.argv[2], sys.argv[3])
