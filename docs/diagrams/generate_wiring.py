# -*- coding: utf-8 -*-
"""Generate the AuraFlow IoT node wiring diagram as JPG.

Matches the house style of generate_diagrams.py (same palette, same fonts, same
save path) so all three figures sit together in the report.

Two rules drive the layout, and both exist to make the picture usable while you
are actually holding the jumper wires:

  1. Sides match the board. Everything on the ESP32's RIGHT pin header
     (3V3, D21, D22, D4, D5) is drawn to the right; everything on the LEFT
     header (D34, D35, D13, GND, VIN) to the left. Wires leave the drawing on
     the same side they leave the real board.

  2. Each I2C rail runs only as far as it has to. A trunk starts at its board
     pin (or its topmost pad, whichever is higher) and stops at its lowest pad,
     which drops the bus down to a single wire crossing in the whole figure.
     Crossings carry no junction dot; dots appear only where a wire terminates.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"E:\MSC\Emerging Mobile Applications\docs\diagrams"
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
W_3V3 = (220, 38, 38)     # red
W_GND = (38, 44, 58)      # black
W_SDA = (37, 99, 235)     # blue
W_SCL = (217, 119, 6)     # amber
W_SIG = (13, 148, 136)    # teal — any GPIO signal
W_5V  = (124, 58, 237)    # purple — 5 V rail

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


# ---------------------------------------------------------------- ESP32 pinout
# DevKit v1, 30-pin, USB at the top.
LEFT_PINS = ["EN", "VP 36", "VN 39", "D34", "D35", "D32", "D33", "D25",
             "D26", "D27", "D14", "D12", "GND", "D13", "VIN"]
RIGHT_PINS = ["3V3", "GND", "D15", "D2", "D4", "RX2", "TX2", "D5",
              "D18", "D19", "D21", "RX0", "TX0", "D22", "D23"]

USED = {
    "D34": W_SIG, "D35": W_SIG, "D13": W_SIG, "GND": W_GND, "VIN": W_5V,
    "3V3": W_3V3, "D4": W_SIG, "D5": W_SIG, "D21": W_SDA, "D22": W_SCL,
}


def module(d, box, title, sub, pads, accent):
    """A breakout-board card with labelled pads.

    pads: list of (label, colour, side) where side is 'L' or 'R'. Each side is
    distributed down the card independently, so a card can take power on one
    edge and hand a signal out of the other without the two interleaving.

    Returns {label: (x, y)} so wires can be routed to each pad.
    """
    x0, y0, x1, y1 = box
    rrect(d, (x0 + 5, y0 + 6, x1 + 5, y1 + 6), 14, fill=(232, 235, 241))
    rrect(d, box, 14, fill=CARD, outline=CARD_E, width=2)
    rrect(d, (x0, y0, x1, y0 + 8), 4, fill=accent)

    d.text((x0 + 24, y0 + 24), title, font=B(31), fill=INK)
    d.text((x0 + 24, y0 + 64), sub, font=R(23), fill=MUTED)

    out = {}
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
    W, H = 2600, 2200
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    M = 60

    # ---------------------------------------------------------------- header
    rrect(d, (M, 44, W - M, 236), 22, fill=DARK)
    d.text((M + 46, 74), "AuraFlow — IoT Wellbeing Node · Wiring",
           font=B(58), fill=WHITE)
    d.text((M + 48, 152),
           "CMP 7003  ·  PRAC1  ·  ESP32 DevKit v1 (30-pin)  ·  three sensors on one I2C bus",
           font=R(30), fill=(163, 176, 199))
    badge = "3.3 V LOGIC  /  NO LEVEL SHIFTER"
    bw = d.textlength(badge, font=B(23))
    rrect(d, (W - M - bw - 62, 96, W - M - 32, 152), 28, fill=(13, 148, 136))
    d.text((W - M - bw - 47, 110), badge, font=B(23), fill=WHITE)

    # ---------------------------------------------------------------- board
    bx0, bx1 = 1120, 1470
    by0, by1 = 300, 1500
    rrect(d, (bx0 + 6, by0 + 7, bx1 + 6, by1 + 7), 18, fill=(228, 231, 238))
    rrect(d, (bx0, by0, bx1, by1), 18, fill=(31, 41, 55),
          outline=(15, 20, 30), width=3)

    # USB socket drawn inside the outline, so the wire that has to cross above
    # the board (3V3 to the left-hand modules) has clear air to run through.
    rrect(d, (bx0 + 112, by0 + 14, bx1 - 112, by0 + 62), 7, fill=(148, 156, 170))
    d.text((bx0 + 136, by0 + 22), "USB", font=B(24), fill=(31, 41, 55))

    d.text((bx0 + 100, by0 + 92), "ESP32", font=B(46), fill=WHITE)
    d.text((bx0 + 88, by0 + 146), "DevKit v1", font=R(26), fill=(148, 163, 184))

    rrect(d, (bx0 + 60, by0 + 196, bx1 - 60, by0 + 300), 8,
          fill=(75, 85, 99), outline=(120, 130, 145), width=2)
    d.text((bx0 + 92, by0 + 228), "ESP-WROOM-32", font=SB(22), fill=(226, 232, 240))

    # ---- pin headers: 15 per side, kept inside the board outline
    # Keyed by (side, name): GND appears on both headers, and letting the second
    # one overwrite the first is how you end up with a wire drawn diagonally
    # across the board to the wrong pin.
    top, step = 650, 56
    pin = {}
    for col, pins in (("L", LEFT_PINS), ("R", RIGHT_PINS)):
        px = bx0 if col == "L" else bx1
        for i, name in enumerate(pins):
            py = top + i * step
            key = name.split()[0]
            colour = USED.get(key)

            rrect(d, (px - 26, py - 14, px + 26, py + 14), 6,
                  fill=colour if colour else (60, 68, 82),
                  outline=(15, 20, 30), width=2)

            fnt = B(22) if colour else R(20)
            tw = d.textlength(name, font=fnt)
            tx = px + 40 if col == "L" else px - 40 - tw
            d.text((tx, py - 13), name, font=fnt,
                   fill=WHITE if colour else (130, 140, 155))
            pin[(col, key)] = (px - 26 if col == "L" else px + 26, py)

    # ================================================================ RIGHT: I2C
    mx0, mx1 = 1800, 2400
    pads_i2c = [("VIN", W_3V3, "L"), ("GND", W_GND, "L"),
                ("SDA", W_SDA, "L"), ("SCL", W_SCL, "L")]

    i2c = []
    for box, title, sub, accent in (
            ((mx0, 380, mx1, 640),  "MAX30102", "HR + SpO2   ·   0x57", (190, 24, 93)),
            ((mx0, 680, mx1, 940),  "MAX30205", "skin temperature   ·   0x48", (217, 119, 6)),
            ((mx0, 980, mx1, 1240), "SSD1306 OLED", "0.96\"  128x64   ·   0x3C", (79, 70, 229))):
        i2c.append(module(d, box, title, sub, pads_i2c, accent))

    # One trunk per rail, spanning only from its board pin (or topmost pad) down
    # to its lowest pad. Ordering them by pin depth leaves a single crossing.
    # anchor: an extra y the trunk must reach — the 3V3 trunk has to climb to
    # the over-the-top wire that feeds the left-hand modules.
    rails = [("VIN", "3V3", 1560, W_3V3, 268),
             ("GND", "GND", 1595, W_GND, None),
             ("SDA", "D21", 1630, W_SDA, None),
             ("SCL", "D22", 1665, W_SCL, None)]

    for pad_label, pin_key, tx, colour, anchor in rails:
        ys = [m[pad_label][1] for m in i2c]
        px, py = pin[("R", pin_key)]
        ends = ys + [py] + ([anchor] if anchor else [])
        d.line([(tx, min(ends)), (tx, max(ends))], fill=colour, width=7)
        wire(d, [(px, py), (tx, py)], colour)
        for y in ys:
            wire(d, [(tx, y), (mx0, y)], colour, w=6)

    rrect(d, (1700, 296, 1924, 340), 10, fill=(238, 242, 248),
          outline=CARD_E, width=2)
    d.text((1714, 304), "I2C BUS · 400 kHz", font=B(22), fill=INK)

    # ---- GND trunk continues below the bus to feed the button and the ring
    d.line([(1595, max(m["GND"][1] for m in i2c)), (1595, 1780)],
           fill=W_GND, width=7)

    # ---- push button (D4)
    btn = module(d, (1800, 1290, 2180, 1490), "Push button",
                 "manual lamp override",
                 [("leg 1", W_SIG, "L"), ("leg 2", W_GND, "L")], (13, 148, 136))
    px, py = pin[("R", "D4")]
    wire(d, [(px, py), (1506, py), (1506, btn["leg 1"][1]), btn["leg 1"]], W_SIG)
    wire(d, [btn["leg 2"], (1595, btn["leg 2"][1])], W_GND)

    # ---- WS2812 ring (D5 + VIN)
    led = module(d, (1800, 1560, 2320, 1800), "WS2812B ring",
                 "8 px circadian lamp",
                 [("DIN", W_SIG, "L"), ("5V", W_5V, "L"), ("GND", W_GND, "L")],
                 (190, 24, 93))
    px, py = pin[("R", "D5")]
    wire(d, [(px, py), (1534, py), (1534, led["DIN"][1]), led["DIN"]], W_SIG)

    # 330R in series with the data line — omitting it is the classic first
    # WS2812 failure, so it gets drawn rather than buried in a footnote. Placed
    # below the board edge, where the lane has clear air.
    rrect(d, (1500, 1520, 1568, 1580), 8, fill=(254, 245, 231),
          outline=(217, 119, 6), width=3)
    d.text((1510, 1532), "330R", font=B(20), fill=(146, 64, 14))

    px, py = pin[("L", "VIN")]
    wire(d, [(px, py), (1020, py), (1020, led["5V"][1]), led["5V"]], W_5V)
    wire(d, [led["GND"], (1595, led["GND"][1])], W_GND)

    # ================================================================ LEFT: env
    lx0, lx1 = 230, 810
    r_gnd, r_3v3 = 100, 170

    dht = module(d, (lx0, 300, lx1, 520), "DHT22",
                 "room temp + humidity  ·  4k7 DATA to 3V3",
                 [("VCC", W_3V3, "L"), ("GND", W_GND, "L"), ("DATA", W_SIG, "R")],
                 (13, 148, 136))
    ldr = module(d, (lx0, 570, lx1, 790), "LDR + 10k",
                 "ambient light divider",
                 [("3V3", W_3V3, "L"), ("GND", W_GND, "L"), ("mid", W_SIG, "R")],
                 (217, 119, 6))
    mic = module(d, (lx0, 840, lx1, 1060), "Electret mic",
                 "night-time noise",
                 [("VCC", W_3V3, "L"), ("GND", W_GND, "L"), ("AO", W_SIG, "R")],
                 (79, 70, 229))

    d.line([(r_gnd, 400), (r_gnd, 1322)], fill=W_GND, width=7)
    d.line([(r_3v3, 268), (r_3v3, 1030)], fill=W_3V3, width=7)

    for m in (dht, ldr, mic):
        for label, (px, py) in m.items():
            if label == "GND":
                wire(d, [(px, py), (r_gnd, py)], W_GND, w=6)
            elif label in ("VCC", "3V3"):
                wire(d, [(px, py), (r_3v3, py)], W_3V3, w=6)

    # The 30-pin board has exactly one 3V3 pin, on the right header, so the
    # left-hand modules genuinely do have to be fed over the top of the board.
    wire(d, [(r_3v3, 280), (r_3v3, 268), (1560, 268)], W_3V3)

    # Left header GND, not the right one — the board's two GND pins are the same
    # net internally, so each side gets its own and no wire has to cross.
    wire(d, [(r_gnd, 1322), pin[("L", "GND")]], W_GND)

    # Signal lanes: the wire with the longest vertical run sits nearest the
    # board, which is what keeps these three from tangling.
    wire(d, [dht["DATA"], (1070, dht["DATA"][1]),
             (1070, pin[("L", "D13")][1]), pin[("L", "D13")]], W_SIG)
    wire(d, [ldr["mid"], (980, ldr["mid"][1]),
             (980, pin[("L", "D34")][1]), pin[("L", "D34")]], W_SIG)
    wire(d, [mic["AO"], (1010, mic["AO"][1]),
             (1010, pin[("L", "D35")][1]), pin[("L", "D35")]], W_SIG)

    # ---------------------------------------------------------------- power
    py0 = 1850
    rrect(d, (M, py0, 1500, py0 + 290), 18, fill=(253, 251, 246),
          outline=(232, 220, 196), width=3)
    d.text((M + 30, py0 + 20), "Battery power  —  optional, USB-only works too",
           font=B(30), fill=INK)
    d.text((M + 30, py0 + 64),
           "The 18650 gives 3.0-4.2 V but the board's AMS1117 needs ~1 V of headroom.",
           font=R(23), fill=MUTED)
    d.text((M + 30, py0 + 98),
           "Straight into VIN = a node that browns out below ~4.4 V, mid-demo.",
           font=R(23), fill=MUTED)

    chain = [("18650", "3.0-4.2 V"), ("TP4056", "charge + protect"),
             ("MT3608", "boost to 5.0 V"), ("ESP32 VIN", "5 V in")]
    cw, cgap, cx, cy = 300, 42, M + 34, py0 + 152
    for i, (t, s) in enumerate(chain):
        rrect(d, (cx, cy, cx + cw, cy + 108), 12, fill=WHITE,
              outline=CARD_E, width=2)
        d.text((cx + 20, cy + 20), t, font=B(27), fill=INK)
        d.text((cx + 20, cy + 60), s, font=R(21), fill=MUTED)
        if i < len(chain) - 1:
            ax = cx + cw + 8
            d.line([(ax, cy + 54), (ax + cgap - 16, cy + 54)], fill=W_5V, width=6)
            d.polygon([(ax + cgap - 16, cy + 44), (ax + cgap - 16, cy + 64),
                       (ax + cgap + 2, cy + 54)], fill=W_5V)
        cx += cw + cgap

    # ---------------------------------------------------------------- legend
    lgx = 1560
    rrect(d, (lgx, py0, W - M, py0 + 290), 18, fill=WHITE,
          outline=CARD_E, width=2)
    d.text((lgx + 30, py0 + 20), "Wire colours", font=B(30), fill=INK)
    d.text((lgx + 30, py0 + 62),
           "use these on the breadboard so the report photo matches the figure",
           font=R(21), fill=MUTED)

    legend = [(W_3V3, "3V3  —  sensor power"), (W_GND, "GND  —  common ground"),
              (W_SDA, "SDA  —  GPIO 21"), (W_SCL, "SCL  —  GPIO 22"),
              (W_SIG, "GPIO signal"), (W_5V, "5 V rail")]
    for i, (c, t) in enumerate(legend):
        ex = lgx + 30 + (i % 2) * 470
        ey = py0 + 118 + (i // 2) * 56
        d.line([(ex, ey + 14), (ex + 54, ey + 14)], fill=c, width=9)
        d.text((ex + 70, ey), t, font=SB(23), fill=INK)

    # ---------------------------------------------------------------- footnote
    d.text((M, H - 44),
           "Crossing wires are not joined — only the dots are connections.   "
           "Mount the MAX30205 against skin beside the MAX30102 pad; flat on the "
           "breadboard it reports room temperature.   "
           "Run iot/i2c-scanner first: 0x3C, 0x48 and 0x57 must all appear.",
           font=R(23), fill=MUTED)

    save(img, "03-wiring.jpg")


if __name__ == "__main__":
    wiring()
