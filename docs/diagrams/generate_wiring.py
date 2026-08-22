# -*- coding: utf-8 -*-
"""Generate the AuraFlow IoT node wiring diagram as JPG.

Matches the house style of generate_diagrams.py (same palette, same fonts, same
save path) so all three figures sit together in the report.

Redrawn 2026-08-12 for the parts that actually arrived: ESP32 **38-pin** DevKit,
MAX30102 on I2C, SSD1306 on SPI, TP4056. The DHT22 / LDR / mic / WS2812 /
MAX30205 in the previous revision never turned up and are gone from the figure
rather than left in as aspirational wiring.

Corrected again the same day: the board on the bench is the 38-pin DevKitC, not
the 30-pin DevKit v1 the first revision assumed. Same chip, same GPIO numbers,
completely different header. Three things change with it and all three are drawn
here — 3V3 sits on the *opposite* header from every signal, GPIO16/17 are
silkscreened plainly as G16/G17 rather than hidden behind RX2/TX2, and six pins
along the bottom go to the SPI flash and must be left alone.

Three rules drive the layout, and all three exist to make the picture usable
while you are actually holding the jumper wires:

  1. Pads are drawn in the module's real header order. The SSD1306's silkscreen
     runs GND VDD SCK SDA RES DC CS and so does its card, even though a
     different order would give a prettier wire fan. A figure that reorders the
     pads is a figure that gets miswired.

  2. Every net gets its own vertical lane. Both modules sit on the ESP32's right
     header, so nine wires share one channel; lanes keep them parallel and
     readable. Crossings carry no junction dot — dots appear only where a wire
     terminates.

  3. Pins the board has already spoken for are marked, not hidden. The lamp LED,
     the BOOT button and the six flash pins are all called out on the header
     itself, because "which pins can I actually use?" is the question this board
     raises and a figure that only draws the nine wires does not answer it.
"""
import os
from PIL import Image, ImageDraw, ImageFont

# Script-relative: the repo moved under auraflow/ and an absolute path silently
# wrote the figure into a directory nothing reads.
OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)

FDIR = r"C:\Windows\Fonts"


def font(name, size):
    for cand in (name, "segoeui.ttf", "arial.ttf", "calibri.ttf"):
        p = os.path.join(FDIR, cand)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def R(size):   return font("segoeui.ttf", size)
def B(size):   return font("segoeuib.ttf", size)
def SB(size):  return font("seguisb.ttf", size)


# ---------------------------------------------------------------- palette
BG    = (247, 248, 250)
INK   = (23, 30, 46)
MUTED = (108, 118, 137)
WHITE = (255, 255, 255)
DARK  = (17, 24, 39)

# Wire colours double as the jumper-wire shopping list: use these actual colours
# on the breadboard and the photo in the report matches the figure.
W_3V3  = (220, 38, 38)     # red
W_GND  = (38, 44, 58)      # black
W_SDA  = (37, 99, 235)     # blue    — I2C data
W_SCL  = (217, 119, 6)     # amber   — I2C clock
W_SCK  = (22, 163, 74)     # green   — SPI clock
W_MOSI = (124, 58, 237)    # purple  — SPI data
W_RES  = (100, 116, 139)   # slate   — SPI reset
W_DC   = (219, 39, 119)    # pink    — SPI data/command
W_CS   = (13, 148, 136)    # teal    — SPI chip select

RESERVED  = (96, 108, 130)   # used by the board itself — leave unwired
FORBIDDEN = (127, 29, 29)    # SPI flash — touching these breaks boot

CARD   = (255, 255, 255)
CARD_E = (205, 212, 224)


def rrect(d, box, r, fill=None, outline=None, width=1):
    try:
        d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)
    except Exception:
        d.rectangle(box, fill=fill, outline=outline, width=width)


def save(img, name):
    path = os.path.join(OUT, name)
    img.convert("RGB").save(path, "JPEG", quality=94, subsampling=0)
    print("wrote", path, os.path.getsize(path) // 1024, "KB")


def wire(d, pts, color, w=7, dots=True):
    """Manhattan-routed wire. Endpoint dots only — crossings stay dotless."""
    d.line(pts, fill=color, width=w, joint="curve")
    if dots:
        for p in (pts[0], pts[-1]):
            d.ellipse((p[0] - 8, p[1] - 8, p[0] + 8, p[1] + 8), fill=color)


def dashed(d, a, b, color, w=5, dash=22, gap=16):
    """Straight dashed segment — used for 'this connection is already on the
    board, do not run a wire for it'."""
    x0, y0 = a
    x1, y1 = b
    span = max(abs(x1 - x0), abs(y1 - y0))
    if span == 0:
        return
    n = int(span // (dash + gap)) + 1
    for i in range(n):
        s = (i * (dash + gap)) / span
        e = min(1.0, (i * (dash + gap) + dash) / span)
        d.line([(x0 + (x1 - x0) * s, y0 + (y1 - y0) * s),
                (x0 + (x1 - x0) * e, y0 + (y1 - y0) * e)], fill=color, width=w)


# ---------------------------------------------------------------- ESP32 pinout
# 38-pin DevKitC / NodeMCU-32S, USB at the top, read off the board on the bench.
# Note 3V3 is on the LEFT header while every signal we need is on the RIGHT —
# that asymmetry is the reason the build uses the breadboard power rails.
LEFT_PINS = ["3V3", "EN", "SP 36", "SN 39", "G34", "G35", "G32", "G33", "G25",
             "G26", "G27", "G14", "G12", "GND", "G13", "SD2", "SD3", "CMD", "V5"]
RIGHT_PINS = ["GND", "G23", "G22", "TXD", "RXD", "G21", "GND", "G19", "G18",
              "G5", "G17", "G16", "G4", "G0", "G2", "G15", "SD1", "SD0", "CLK"]

USED = {
    "3V3": W_3V3, "GND": W_GND,
    "G21": W_SDA, "G22": W_SCL,
    "G18": W_SCK, "G23": W_MOSI, "G17": W_RES, "G16": W_DC, "G5": W_CS,
}
# Spoken for by the board itself, or held back deliberately.
RESERVED_PINS = {"G2", "G0", "G34"}
# Wired to the SPI flash inside the module. Pulling one of these low at boot, or
# driving it at all, stops the chip finding its own firmware.
FLASH_PINS = {"SD0", "SD1", "SD2", "SD3", "CMD", "CLK"}


def module(d, box, title, sub, pads, accent, dashed_edge=False):
    """A breakout-board card with labelled pads.

    pads: list of (label, colour, side) where side is 'L' or 'R'. Each side is
    distributed down the card independently, so a card can take power on one
    edge and hand a signal out of the other without the two interleaving.

    Returns {label: (x, y)} so wires can be routed to each pad.
    """
    x0, y0, x1, y1 = box
    if dashed_edge:
        rrect(d, box, 14, fill=(250, 250, 252), outline=None)
        for seg in ((x0, y0, x1, y0), (x0, y1, x1, y1),
                    (x0, y0, x0, y1), (x1, y0, x1, y1)):
            dashed(d, (seg[0], seg[1]), (seg[2], seg[3]), CARD_E, w=3, dash=16, gap=12)
    else:
        rrect(d, (x0 + 5, y0 + 6, x1 + 5, y1 + 6), 14, fill=(232, 235, 241))
        rrect(d, box, 14, fill=CARD, outline=CARD_E, width=2)
        rrect(d, (x0, y0, x1, y0 + 8), 4, fill=accent)

    d.text((x0 + 24, y0 + 24), title, font=B(31), fill=INK)
    d.text((x0 + 24, y0 + 64), sub, font=R(23), fill=MUTED)

    out = {}
    if not pads:
        return out
    span = (y1 - y0) - 112
    for side in ("L", "R"):
        group = [p for p in pads if p[2] == side]
        for i, (label, colour, _) in enumerate(group):
            py = y0 + 102 + span * (i + 0.5) / len(group)
            px = x0 if side == "L" else x1
            d.ellipse((px - 9, py - 9, px + 9, py + 9),
                      fill=colour, outline=WHITE, width=3)
            tw = d.textlength(label, font=SB(22))
            tx = px + 22 if side == "L" else px - 22 - tw
            d.text((tx, py - 14), label, font=SB(22), fill=INK)
            out[label] = (px, py)
    return out


def wiring():
    W, H = 2600, 2150
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    M = 60

    # ---------------------------------------------------------------- header
    rrect(d, (M, 44, W - M, 236), 22, fill=DARK)
    d.text((M + 46, 74), "AuraFlow — IoT Wellbeing Node · Wiring",
           font=B(58), fill=WHITE)
    d.text((M + 48, 152),
           "CMP 7003  ·  PRAC1  ·  ESP32 DevKitC (38-pin)  ·  MAX30102 on I2C  ·  SSD1306 on SPI",
           font=R(30), fill=(163, 176, 199))
    badge = "3.3 V LOGIC  /  NO LEVEL SHIFTER"
    bw = d.textlength(badge, font=B(23))
    rrect(d, (W - M - bw - 62, 96, W - M - 32, 152), 28, fill=(13, 148, 136))
    d.text((W - M - bw - 47, 110), badge, font=B(23), fill=WHITE)

    # ---------------------------------------------------------------- board
    bx0, bx1 = 1120, 1470
    by0, by1 = 300, 1640
    rrect(d, (bx0 + 6, by0 + 7, bx1 + 6, by1 + 7), 18, fill=(228, 231, 238))
    rrect(d, (bx0, by0, bx1, by1), 18, fill=(31, 41, 55),
          outline=(15, 20, 30), width=3)

    rrect(d, (bx0 + 112, by0 + 14, bx1 - 112, by0 + 62), 7, fill=(148, 156, 170))
    d.text((bx0 + 136, by0 + 22), "USB", font=B(24), fill=(31, 41, 55))

    d.text((bx0 + 104, by0 + 90), "ESP32", font=B(44), fill=WHITE)
    d.text((bx0 + 76, by0 + 142), "DevKitC · 38-pin", font=R(24), fill=(148, 163, 184))

    rrect(d, (bx0 + 60, by0 + 186, bx1 - 60, by0 + 282), 8,
          fill=(75, 85, 99), outline=(120, 130, 145), width=2)
    d.text((bx0 + 92, by0 + 212), "ESP-WROOM-32", font=SB(22), fill=(226, 232, 240))

    # ---- pin headers: 19 per side, kept inside the board outline
    # Keyed by (side, name). GND appears twice on the right header, so the
    # second one is stored as "GND#2" instead of overwriting the first — letting
    # it overwrite is how you end up with a wire drawn to the wrong pin.
    top, step = 560, 54
    pin = {}
    for col, pins in (("L", LEFT_PINS), ("R", RIGHT_PINS)):
        px = bx0 if col == "L" else bx1
        for i, name in enumerate(pins):
            py = top + i * step
            key = name.split()[0]
            colour = USED.get(key)
            reserved = key in RESERVED_PINS
            flash = key in FLASH_PINS

            if colour:
                fill = colour
            elif flash:
                fill = FORBIDDEN
            elif reserved:
                fill = RESERVED
            else:
                fill = (60, 68, 82)

            rrect(d, (px - 26, py - 13, px + 26, py + 13), 6,
                  fill=fill, outline=(15, 20, 30), width=2)

            strong = bool(colour) or reserved or flash
            fnt = B(21) if strong else R(19)
            tw = d.textlength(name, font=fnt)
            tx = px + 38 if col == "L" else px - 38 - tw
            d.text((tx, py - 12), name, font=fnt,
                   fill=WHITE if strong else (130, 140, 155))

            slot = key if (col, key) not in pin else key + "#2"
            pin[(col, slot)] = (px - 26 if col == "L" else px + 26, py)

    # ================================================================ RIGHT: modules
    mx0, mx1 = 1990, 2520

    # Pads in each module's own silkscreen order — see rule 1 in the docstring.
    max3 = module(d, (mx0, 380, mx1, 640), "MAX30102",
                  "HR + SpO2   ·   I2C 0x57",
                  [("VIN", W_3V3, "L"), ("SDA", W_SDA, "L"),
                   ("SCL", W_SCL, "L"), ("GND", W_GND, "L")], (190, 24, 93))

    oled = module(d, (mx0, 700, mx1, 1180), "SSD1306 OLED",
                  "0.96\"  128x64   ·   7-pin SPI",
                  [("GND", W_GND, "L"), ("VDD", W_3V3, "L"),
                   ("SCK", W_SCK, "L"), ("SDA", W_MOSI, "L"),
                   ("RES", W_RES, "L"), ("DC", W_DC, "L"),
                   ("CS", W_CS, "L")], (79, 70, 229))

    rrect(d, (1880, 296, 2104, 340), 10, fill=(238, 242, 248),
          outline=CARD_E, width=2)
    d.text((1894, 304), "I2C BUS · 400 kHz", font=B(22), fill=INK)
    rrect(d, (1880, 654, 2166, 696), 10, fill=(238, 242, 248),
          outline=CARD_E, width=2)
    d.text((1894, 660), "VSPI · 8 MHz · write-only", font=B(22), fill=INK)

    # ---- 3V3 comes over the top: it is the one pin we need that sits on the
    # far header, which is exactly why the build feeds both modules from the
    # breadboard rail instead of running two wires around the board.
    lane_3v3 = 1530
    px, py = pin[("L", "3V3")]
    wire(d, [(px, py), (1040, py), (1040, 268), (lane_3v3, 268)], W_3V3)
    pads_3v3 = [max3["VIN"], oled["VDD"]]
    d.line([(lane_3v3, 268), (lane_3v3, max(p[1] for p in pads_3v3))],
           fill=W_3V3, width=7)
    for pxp, pyp in pads_3v3:
        wire(d, [(lane_3v3, pyp), (pxp, pyp)], W_3V3, w=6)

    # ---- GND: the right header carries two, and the lower one sits between the
    # two cards' ground pads, so it makes the shortest trunk.
    lane_gnd = 1568
    px, py = pin[("R", "GND#2")]
    pads_gnd = [max3["GND"], oled["GND"]]
    ys = [p[1] for p in pads_gnd] + [py]
    d.line([(lane_gnd, min(ys)), (lane_gnd, max(ys))], fill=W_GND, width=7)
    wire(d, [(px, py), (lane_gnd, py)], W_GND)
    for pxp, pyp in pads_gnd:
        wire(d, [(lane_gnd, pyp), (pxp, pyp)], W_GND, w=6)

    # ---- one signal per lane, ordered so the fan stays readable
    signals = [
        ("G21", 1606, W_SDA,  max3["SDA"]),
        ("G22", 1644, W_SCL,  max3["SCL"]),
        ("G18", 1682, W_SCK,  oled["SCK"]),
        ("G23", 1720, W_MOSI, oled["SDA"]),
        ("G17", 1758, W_RES,  oled["RES"]),
        ("G16", 1796, W_DC,   oled["DC"]),
        ("G5",  1834, W_CS,   oled["CS"]),
    ]
    for pin_key, lane, colour, pad in signals:
        px, py = pin[("R", pin_key)]
        wire(d, [(px, py), (lane, py), (lane, pad[1]), pad], colour)

    # ================================================================ LEFT: on-board
    lx0, lx1 = 250, 900

    module(d, (lx0, 420, lx1, 620), "Lamp  —  onboard LED",
           "G2  ·  LEDC PWM  ·  no wire needed", [], (37, 99, 235),
           dashed_edge=True)
    module(d, (lx0, 700, lx1, 900), "Override  —  BOOT button",
           "G0  ·  active LOW  ·  leave G0 unwired", [], (13, 148, 136),
           dashed_edge=True)
    module(d, (lx0, 980, lx1, 1180), "G34  —  left unwired",
           "reserved for the HW-477 module", [], (148, 163, 184),
           dashed_edge=True)

    # G34 is a real left-header pin and needs no crossing, so it gets a proper
    # pointer. G2 and G0 live on the far header; pointing at them from here
    # would drag a line across the board, so the pin chips carry that instead.
    for seg in (((lx1, 1080), (1040, 1080)),
                ((1040, 1080), (1040, pin[("L", "G34")][1])),
                ((1040, pin[("L", "G34")][1]), pin[("L", "G34")])):
        dashed(d, seg[0], seg[1], (170, 178, 192))

    rrect(d, (lx0, 260, lx1, 372), 14, fill=(240, 249, 255),
          outline=(147, 197, 253), width=3)
    d.text((lx0 + 24, 280), "Already on the DevKit", font=B(28), fill=(30, 64, 118))
    d.text((lx0 + 24, 322), "grey pins are spoken for — leave them empty",
           font=R(22), fill=(59, 100, 160))

    # The six flash pins are the trap unique to the 38-pin board: the 30-pin
    # version simply does not break them out, so nobody can reach them there.
    rrect(d, (lx0, 1250, lx1, 1440), 14, fill=(254, 242, 242),
          outline=(185, 90, 90), width=3)
    d.text((lx0 + 24, 1272), "Six pins are not yours", font=B(28), fill=(127, 29, 29))
    d.text((lx0 + 24, 1320), "SD0  SD1  SD2  SD3  CMD  CLK", font=B(24),
           fill=(127, 29, 29))
    d.text((lx0 + 24, 1360), "these run to the SPI flash inside the module.",
           font=R(21), fill=(150, 60, 60))
    d.text((lx0 + 24, 1390), "drive one and the chip cannot boot.",
           font=R(21), fill=(150, 60, 60))

    # ---------------------------------------------------------------- power
    py0, ph = 1740, 275
    rrect(d, (M, py0, 1500, py0 + ph), 18, fill=(253, 251, 246),
          outline=(232, 220, 196), width=3)
    d.text((M + 30, py0 + 20), "Power  —  USB only on this build",
           font=B(30), fill=INK)
    d.text((M + 30, py0 + 64),
           "The TP4056 arrived but the 18650 and the MT3608 boost did not, so the",
           font=R(23), fill=MUTED)
    d.text((M + 30, py0 + 98),
           "battery chain is incomplete. Run the node from the USB cable.",
           font=R(23), fill=MUTED)

    chain = [("18650", "missing", False), ("TP4056", "have it", True),
             ("MT3608", "missing", False), ("ESP32 V5", "5 V in", False)]
    cw, cgap, cx, cy = 300, 42, M + 34, py0 + 146
    for i, (t, s, have) in enumerate(chain):
        rrect(d, (cx, cy, cx + cw, cy + 96), 12,
              fill=WHITE if have else (246, 246, 248),
              outline=(34, 160, 110) if have else CARD_E, width=3 if have else 2)
        d.text((cx + 20, cy + 16), t, font=B(27),
               fill=INK if have else (150, 158, 172))
        d.text((cx + 20, cy + 54), s, font=R(21),
               fill=(34, 140, 100) if have else (170, 178, 192))
        if i < len(chain) - 1:
            ax = cx + cw + 8
            dashed(d, (ax, cy + 48), (ax + cgap - 6, cy + 48), (190, 196, 208),
                   w=5, dash=10, gap=8)
        cx += cw + cgap

    # ---------------------------------------------------------------- legend
    lgx = 1560
    rrect(d, (lgx, py0, W - M, py0 + ph), 18, fill=WHITE,
          outline=CARD_E, width=2)
    d.text((lgx + 30, py0 + 20), "Wire colours", font=B(30), fill=INK)
    d.text((lgx + 30, py0 + 62),
           "use these on the breadboard so the report photo matches the figure",
           font=R(21), fill=MUTED)

    legend = [(W_3V3, "3V3  —  left header"), (W_GND, "GND  —  right header"),
              (W_SDA, "SDA  —  G21"),         (W_SCL, "SCL  —  G22"),
              (W_SCK, "SCK  —  G18"),         (W_MOSI, "SDA/MOSI  —  G23"),
              (W_RES, "RES  —  G17"),         (W_DC, "DC  —  G16"),
              (W_CS,  "CS  —  G5")]
    for i, (c, t) in enumerate(legend):
        ex = lgx + 30 + (i % 3) * 320
        ey = py0 + 112 + (i // 3) * 46
        d.line([(ex, ey + 12), (ex + 44, ey + 12)], fill=c, width=9)
        d.text((ex + 58, ey), t, font=SB(20), fill=INK)

    # ---------------------------------------------------------------- footnote
    d.text((M, H - 88),
           "Crossing wires are not joined — only the dots are connections.   "
           "The OLED module's pin marked SDA is SPI MOSI, not I2C data: it goes to "
           "G23, never to G21.",
           font=R(23), fill=MUTED)
    d.text((M, H - 48),
           "3V3 is the only pin we need on the left header — feed both modules from "
           "the breadboard + rail. Run iot/i2c-scanner first: exactly one address, "
           "0x57. The OLED is on SPI and never appears in that scan.",
           font=R(23), fill=MUTED)

    save(img, "03-wiring.jpg")


if __name__ == "__main__":
    wiring()
