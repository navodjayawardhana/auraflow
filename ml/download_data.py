"""Fetch the public research datasets AuraFlow's productivity model is trained on.

Raw data is deliberately NOT committed to the repository. It is fetched from the
canonical source so that provenance stays verifiable and the licence chain is
unbroken: a reviewer can re-run this script and confirm they receive byte-for-byte
the same data the model was trained on.

Datasets
--------
LifeSnaps (primary)   Yfantidou et al. (2022), Scientific Data 9, 663.
                      71 participants, 4+ months, Fitbit Sense.
                      Licence: CC BY 4.0                    -> commercial use permitted

PMData (secondary)    Thambawita et al. (2020), ACM MMSys '20, pp. 231-236.
                      16 participants, 5 months, Fitbit Versa 2 + PMSys.
                      Licence: CC BY-NC 4.0                 -> NON-COMMERCIAL ONLY

    The NC clause is why LifeSnaps is the primary cohort. PMData is used solely
    for academic cross-dataset validation; the report's commercial viability
    argument rests on the CC BY-licensed LifeSnaps cohort. See docs/DATASET.md.

Usage
-----
    python ml/download_data.py                  # both datasets
    python ml/download_data.py --dataset lifesnaps
    python ml/download_data.py --verify-only    # re-check what is already on disk

Interrupted downloads resume automatically on the next run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from tqdm import tqdm

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
PROVENANCE = RAW_DIR / "PROVENANCE.json"
CHUNK = 1024 * 1024  # 1 MiB

# ---------------------------------------------------------------------------
# Manifest
#
# `checksum` is the value published by the source repository. Where a source
# serves a dynamically-built archive it cannot publish one; those entries use
# checksum=None and are pinned on first download instead (trust-on-first-use),
# recorded in PROVENANCE.json so later runs detect any change.
# ---------------------------------------------------------------------------
DATASETS: dict[str, dict] = {
    "lifesnaps": {
        "citation": "Yfantidou et al. (2022) Scientific Data 9, 663",
        "licence": "CC BY 4.0",
        "doi": "10.5281/zenodo.7229547",
        "files": [
            {
                "name": "lifesnaps_rais_anonymized.zip",
                "url": "https://zenodo.org/api/records/7229547/files/rais_anonymized.zip/content",
                "bytes": 615_037_493,
                "checksum": ("md5", "726afe263ab4b900a721eac19b2ca13a"),
            }
        ],
    },
    "pmdata": {
        "citation": "Thambawita et al. (2020) ACM MMSys '20, 231-236",
        "licence": "CC BY-NC 4.0  (NON-COMMERCIAL)",
        "doi": "10.17605/OSF.IO/VX4BK",
        "files": [
            {
                # Small file with a published hash - an integrity anchor proving
                # we reached the real OSF node before trusting the bulk archive.
                "name": "pmdata_license.txt",
                "url": "https://osf.io/download/ywdvx/",
                "bytes": 266,
                "checksum": (
                    "sha256",
                    "5286eaa9817ddf25ad61158793c91ca2d4097220160d9f4be678d29d8db260ba",
                ),
            },
            {
                # OSF builds this archive on demand, so no upstream hash exists.
                "name": "pmdata.zip",
                "url": "https://files.osf.io/v1/resources/vx4bk/providers/osfstorage/?zip=",
                "bytes": None,
                "checksum": None,  # trust-on-first-use, pinned in PROVENANCE.json
            },
        ],
    },
}


def digest(path: Path, algorithm: str) -> str:
    """Hash a file in streaming fashion - these archives do not fit comfortably in RAM."""
    h = hashlib.new(algorithm)
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def load_provenance() -> dict:
    if PROVENANCE.exists():
        return json.loads(PROVENANCE.read_text(encoding="utf-8"))
    return {}


def save_provenance(record: dict) -> None:
    PROVENANCE.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")


def download(url: str, dest: Path, expected_bytes: int | None) -> None:
    """Stream `url` to `dest`, resuming a partial `.part` file if one exists."""
    part = dest.with_suffix(dest.suffix + ".part")
    have = part.stat().st_size if part.exists() else 0

    headers = {}
    if have:
        headers["Range"] = f"bytes={have}-"
        print(f"    resuming from {have / 1e6:.1f} MB")

    with requests.get(url, stream=True, headers=headers, timeout=60) as response:
        if have and response.status_code == 200:
            # Server ignored the Range header - start over rather than corrupt the file.
            print("    server does not support resume, restarting")
            have = 0
            part.unlink(missing_ok=True)
        elif have and response.status_code != 206:
            response.raise_for_status()
        else:
            response.raise_for_status()

        remaining = response.headers.get("content-length")
        total = (have + int(remaining)) if remaining else expected_bytes

        mode = "ab" if have else "wb"
        with part.open(mode) as fh, tqdm(
            total=total,
            initial=have,
            unit="B",
            unit_scale=True,
            unit_divisor=1024,
            desc=f"    {dest.name}",
        ) as bar:
            for chunk in response.iter_content(CHUNK):
                fh.write(chunk)
                bar.update(len(chunk))

    part.replace(dest)


def fetch(key: str, verify_only: bool) -> bool:
    """Download and verify one dataset. Returns True if everything checks out."""
    spec = DATASETS[key]
    print(f"\n{key}  -  {spec['licence']}")
    print(f"  {spec['citation']}  doi:{spec['doi']}")

    provenance = load_provenance()
    entry = provenance.setdefault(key, {"licence": spec["licence"], "doi": spec["doi"], "files": {}})
    ok = True

    for spec_file in spec["files"]:
        dest = RAW_DIR / spec_file["name"]

        if not dest.exists():
            if verify_only:
                print(f"  MISSING  {spec_file['name']}")
                ok = False
                continue
            print(f"  fetching {spec_file['name']}")
            download(spec_file["url"], dest, spec_file["bytes"])

        published = spec_file["checksum"]
        recorded = entry["files"].get(spec_file["name"], {}).get("sha256")

        if published:
            algorithm, expected = published
            actual = digest(dest, algorithm)
            if actual != expected:
                print(f"  FAIL     {spec_file['name']}: {algorithm} mismatch")
                print(f"           expected {expected}")
                print(f"           actual   {actual}")
                print("           Delete the file and re-run. Do NOT train on it.")
                ok = False
                continue
            print(f"  ok       {spec_file['name']}  ({algorithm} matches published value)")

        sha = digest(dest, "sha256")
        if recorded and recorded != sha:
            print(f"  FAIL     {spec_file['name']}: differs from the pinned copy")
            print(f"           pinned {recorded}")
            print(f"           now    {sha}")
            print("           The upstream archive changed. Re-verify before training.")
            ok = False
            continue
        if not recorded and not verify_only:
            print(f"  pinned   {spec_file['name']}  sha256={sha[:16]}...")

        entry["files"][spec_file["name"]] = {
            "url": spec_file["url"],
            "sha256": sha,
            "bytes": dest.stat().st_size,
            "retrieved": entry["files"].get(spec_file["name"], {}).get("retrieved")
            or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }

    if not verify_only:
        provenance[key] = entry
        save_provenance(provenance)

    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dataset", choices=[*DATASETS, "all"], default="all")
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="re-check files already on disk without downloading",
    )
    args = parser.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    keys = list(DATASETS) if args.dataset == "all" else [args.dataset]

    results = [fetch(key, args.verify_only) for key in keys]

    print()
    if all(results):
        print(f"All datasets verified. Provenance: {PROVENANCE}")
        print("Reminder: PMData is CC BY-NC 4.0 - academic evaluation only.")
        return 0
    print("One or more datasets failed verification - see above.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
