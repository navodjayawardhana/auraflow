"""Score System Usability Scale responses (Brooke, 1996) and print §5.3's numbers.

Usage:
    python docs/report/score_sus.py docs/report/sus-responses.csv

The CSV holds one row per participant: an id, then q1..q10 as integers 1-5 on
Brooke's original agreement scale. Odd items are positively worded and even items
negatively worded, so they are scored in opposite directions before the sum is
scaled to 0-100. A SUS score is not a percentage and is never reported as one.
"""
import csv
import statistics
import sys
from pathlib import Path


def score(answers: list[int]) -> float:
    """One participant's 0-100 SUS score."""
    if len(answers) != 10 or not all(1 <= a <= 5 for a in answers):
        raise ValueError(f"need ten answers in 1-5, got {answers}")
    odd = sum(answers[i] - 1 for i in range(0, 10, 2))
    even = sum(5 - answers[i] for i in range(1, 10, 2))
    return (odd + even) * 2.5


def main(path: Path) -> None:
    scores, ids = [], []
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            answers = [int(row[f"q{i}"]) for i in range(1, 11)]
            ids.append(row["participant"])
            scores.append(score(answers))

    n = len(scores)
    if n == 0:
        raise SystemExit(f"{path} has no responses yet")

    mean = statistics.mean(scores)
    sd = statistics.stdev(scores) if n > 1 else float("nan")

    print(f"n = {n}")
    for pid, s in zip(ids, scores):
        print(f"  {pid:12s} {s:5.1f}")
    print(f"\nMean SUS  {mean:.1f}")
    print(f"SD        {sd:.1f}")
    print(f"Range     {min(scores):.1f}-{max(scores):.1f}")
    print(f"\nAgainst the 68 benchmark: {mean - 68:+.1f}")
    print("Paste into §5.3; report the SD and the range, never the mean alone at n = 5.")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "docs/report/sus-responses.csv"))
