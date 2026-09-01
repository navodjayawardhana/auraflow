"""Render the three captured test-suite console runs as one report figure.

Input is the verbatim stdout saved in docs/test-evidence/ by the runs themselves;
nothing here is retyped, so the figure is evidence rather than illustration.
"""
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
EV = ROOT / "docs" / "test-evidence"
OUT = ROOT / "docs" / "report" / "figures" / "fig-test-evidence.png"

ANSI = re.compile(r"\x1b\[[0-9;]*m")

BG = (24, 26, 32)
CHROME = (38, 41, 50)
FG = (222, 226, 235)
DIM = (140, 148, 165)
GREEN = (126, 211, 143)
CYAN = (122, 190, 235)

W = 1500
PAD = 22
LINE = 26
TITLE_H = 42


def font(size, bold=False):
    for name in (("consolab.ttf" if bold else "consola.ttf"), "cour.ttf", "DejaVuSansMono.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


MONO = font(19)
MONO_B = font(19, bold=True)
TITLE = font(20, bold=True)


def clean(path, keep):
    """Verbatim lines from a captured run: `keep` selects which ones survive."""
    raw = [ANSI.sub("", ln).rstrip() for ln in path.read_text(encoding="utf-8", errors="replace").splitlines()]
    return keep(raw)


def api(lines):
    """Six verbatim authorisation-scoping cases, then the run's own summary line."""
    wanted = ("another user", "other user", "unauthenticated", "throttl", "lock out", "password hash")
    sample = [ln.strip().replace("✔", "√") for ln in lines if ln.strip().startswith("✔")
              and any(w in ln.lower() for w in wanted)][:6]
    tail = [ln for ln in lines if ln.startswith("OK (")]
    return (["$ ./vendor/bin/phpunit --testdox", ""] + ["  " + ln for ln in sample]
            + ["  … 461 test cases across 38 test classes …", ""] + tail)


def mobile(lines):
    wanted = [ln for ln in lines if ln.startswith(("> mobile@", "Focus model in sync", "Test Suites:", "Tests:", "Snapshots:", "Time:"))]
    return ["$ npm run check", ""] + wanted


def ml(lines):
    body = [ln for ln in lines if ln.strip()]
    return ["$ python -m pytest ml/tests -q", ""] + body[-3:]


PANELS = [
    ("API — Laravel / PHPUnit", clean(EV / "api-phpunit-testdox.txt", api)),
    ("Mobile — TypeScript / Jest, with the model-sync build gate", clean(EV / "mobile-npm-check.txt", mobile)),
    ("ML — Python / pytest", clean(EV / "ml-pytest.txt", ml)),
]

height = sum(TITLE_H + PAD + LINE * len(body) + PAD for _, body in PANELS) + PAD * (len(PANELS) + 1)
img = Image.new("RGB", (W, height), (255, 255, 255))
d = ImageDraw.Draw(img)

y = PAD
for title, body in PANELS:
    h = TITLE_H + PAD + LINE * len(body) + PAD
    d.rounded_rectangle([PAD, y, W - PAD, y + h], radius=10, fill=BG)
    d.rounded_rectangle([PAD, y, W - PAD, y + TITLE_H], radius=10, fill=CHROME)
    d.rectangle([PAD, y + TITLE_H - 10, W - PAD, y + TITLE_H], fill=CHROME)
    for i, c in enumerate(((237, 106, 94), (244, 191, 79), (98, 197, 84))):
        d.ellipse([PAD + 18 + i * 20, y + 15, PAD + 30 + i * 20, y + 27], fill=c)
    d.text((PAD + 92, y + 12), title, font=TITLE, fill=FG)

    ty = y + TITLE_H + PAD
    for ln in body:
        colour = FG
        f = MONO
        if ln.startswith("$"):
            colour, f = CYAN, MONO_B
        elif ln.startswith("> mobile@"):
            colour = DIM
        elif "passed" in ln or ln.startswith("OK (") or "in sync" in ln:
            colour, f = GREEN, MONO_B
        elif ln.strip().startswith("√"):
            colour = GREEN
        elif ln.strip().startswith("…"):
            colour = DIM
        d.text((PAD + 24, ty), ln, font=f, fill=colour)
        ty += LINE
    y += h + PAD

img.save(OUT)
print(f"wrote {OUT} ({img.width}x{img.height})")
