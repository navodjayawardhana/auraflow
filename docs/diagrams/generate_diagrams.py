# -*- coding: utf-8 -*-
"""Generate AuraFlow feature-map and architecture diagrams as JPG."""
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
BG      = (247, 248, 250)
INK     = (23, 30, 46)
MUTED   = (108, 118, 137)
LINE    = (219, 224, 232)
WHITE   = (255, 255, 255)

TIERS = {
    "A": {"main": (79, 70, 229),  "soft": (238, 238, 253), "edge": (199, 197, 246)},
    "B": {"main": (13, 148, 136), "soft": (232, 248, 246), "edge": (168, 224, 218)},
    "C": {"main": (217, 119, 6),  "soft": (254, 245, 231), "edge": (247, 214, 160)},
    "D": {"main": (190, 24, 93),  "soft": (253, 236, 244), "edge": (246, 190, 217)},
}


def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def rrect(d, box, r, fill=None, outline=None, width=1):
    try:
        d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)
    except Exception:
        d.rectangle(box, fill=fill, outline=outline, width=width)


def save(img, name):
    path = os.path.join(OUT, name)
    img.convert("RGB").save(path, "JPEG", quality=94, subsampling=0)
    print("wrote", path, os.path.getsize(path) // 1024, "KB")


# ================================================================ DIAGRAM 1
def feature_map():
    W, H = 2400, 1690
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    M = 64
    # ---- header
    rrect(d, (M, 44, W - M, 250), 22, fill=(17, 24, 39))
    d.text((M + 46, 78), "AuraFlow — AI-Driven Smart Lifestyle Companion",
           font=B(60), fill=WHITE)
    d.text((M + 48, 158), "CMP 7003  ·  PRAC1 Practical Project  ·  Feature Design Map",
           font=R(31), fill=(163, 176, 199))
    badge = "14 FEATURES  /  4 TIERS"
    bw = d.textlength(badge, font=B(24))
    rrect(d, (W - M - bw - 64, 96, W - M - 32, 156), 30, fill=(79, 70, 229))
    d.text((W - M - bw - 48, 112), badge, font=B(24), fill=WHITE)

    # ---- columns
    cols = [
        ("A", "TIER A  ·  Core AI Engine", "Innovation (20) + Technical (20)", [
            ("1", "Circadian Productivity Model",
             "Keras MLP on watch + focus data → TFLite on-device, self-personalising via online learning"),
            ("2", "Recovery Score (0-100)",
             "Weighted composite of sleep quality, resting-HR delta, stress and activity load"),
            ("3", "Illness Early Warning",
             "Rolling 7-day z-score on resting HR + sleep quality anomaly detection"),
            ("4", "NLP Quick-Add",
             "Claude Haiku 4.5 parses natural language into a structured task object"),
            ("5", "Environmental Awareness",
             "Weather + air-quality APIs feed real-time context rules and suggestions"),
        ]),
        ("D", "TIER A2  ·  AR & Vision", "Emerging tech — implemented, not future work", [
            ("13", "AR Posture Coach",
             "Live camera → MoveNet pose model on-device → skeleton and neck-angle drawn over the viewfinder"),
            ("14", "AR Breathing Orb",
             "Watch stress > 65 anchors a 3D orb to the desk, pacing a 4-4-6 breath cycle (Three.js on expo-gl)"),
        ]),
        ("B", "TIER B  ·  Learning Outcome Cover", "LO2 — mandatory, do not drop", [
            ("6", "Activity Heatmap",
             "react-native-maps plots visited locations against productivity  →  MAPPING"),
            ("7", "Voice Journal + Mood",
             "Record, transcribe and sentiment-score a daily note  →  MULTIMEDIA"),
            ("8", "Offline-First Sync",
             "SQLite / WatermelonDB local store reconciled with Laravel  →  PERSISTENT STORAGE"),
        ]),
        ("C", "TIER C  ·  Direct Rubric Points", "Security · UI/UX · Evaluation", [
            ("9", "Weekly AI Digest",
             "Claude vs Gemini benchmarked on the same prompt  →  evaluation evidence"),
            ("10", "Geofence Automation",
             "Location + time triggers drive smart, batched notifications  →  GEOLOCATION"),
            ("11", "Security Pack",
             "Biometric lock, encrypted storage, GDPR data export and delete"),
            ("12", "Accessibility Pack",
             "Screen-reader labels, font scaling, WCAG AA contrast, dark mode, Sinhala i18n"),
        ]),
    ]

    gap = 26
    cw = (W - 2 * M - 3 * gap) // 4
    top = 300

    for ci, (tier, title, sub, items) in enumerate(cols):
        c = TIERS[tier]
        x = M + ci * (cw + gap)

        # column header
        rrect(d, (x, top, x + cw, top + 118), 18, fill=c["main"])
        d.text((x + 22, top + 22), title, font=B(26), fill=WHITE)
        d.text((x + 23, top + 64), sub, font=R(20), fill=(240, 240, 255))

        y = top + 118 + 26
        for num, name, desc in items:
            lines = wrap(d, desc, R(21), cw - 118)
            ch = 32 + 38 + len(lines) * 29 + 24

            rrect(d, (x, y, x + cw, y + ch), 16,
                  fill=WHITE, outline=c["edge"], width=3)
            rrect(d, (x, y + 14, x + 8, y + ch - 14), 4, fill=c["main"])

            # number badge
            rrect(d, (x + 22, y + 22, x + 76, y + 72), 13, fill=c["soft"])
            nw = d.textlength(num, font=B(25))
            d.text((x + 49 - nw / 2, y + 33), num, font=B(25), fill=c["main"])

            d.text((x + 90, y + 27), name, font=B(26), fill=INK)
            ty = y + 72
            for ln in lines:
                d.text((x + 90, ty), ln, font=R(21), fill=MUTED)
                ty += 29
            y += ch + 18

    # ---- footer strip
    fy = H - 296
    rrect(d, (M, fy, W - M, fy + 236), 20, fill=WHITE, outline=LINE, width=3)
    d.text((M + 40, fy + 28), "How the design maps to assessment",
           font=B(34), fill=INK)

    chips = [
        ("Innovation  20", TIERS["A"]["main"], TIERS["A"]["soft"]),
        ("Technical Impl.  20", TIERS["A"]["main"], TIERS["A"]["soft"]),
        ("Architecture  10", TIERS["B"]["main"], TIERS["B"]["soft"]),
        ("UI / UX  10", TIERS["C"]["main"], TIERS["C"]["soft"]),
        ("Security / Perf  10", TIERS["C"]["main"], TIERS["C"]["soft"]),
        ("Testing & Eval  10", TIERS["B"]["main"], TIERS["B"]["soft"]),
    ]
    cx = M + 40
    cy = fy + 92
    for label, fg, bg in chips:
        w = d.textlength(label, font=B(25)) + 56
        rrect(d, (cx, cy, cx + w, cy + 62), 31, fill=bg, outline=fg, width=2)
        d.text((cx + 28, cy + 15), label, font=B(25), fill=fg)
        cx += w + 20

    d.text((M + 40, fy + 174),
           "Golden rule of the design:  numeric prediction runs on-device (private, offline, free)  "
           "·  natural language runs on the LLM",
           font=SB(26), fill=(79, 70, 229))

    save(img, "01-feature-map.jpg")


# ================================================================ DIAGRAM 2
def architecture():
    W, H = 2400, 1750
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    M = 64

    rrect(d, (M, 44, W - M, 210), 22, fill=(17, 24, 39))
    d.text((M + 46, 74), "AuraFlow — System Architecture", font=B(58), fill=WHITE)
    d.text((M + 48, 148), "React Native (Expo)  ·  Laravel 11 on DigitalOcean  ·  On-device ML  ·  LLM services",
           font=R(29), fill=(163, 176, 199))

    LAYERS = [
        dict(title="1 · WEARABLE  &  SENSOR LAYER", c=(190, 24, 93),
             soft=(253, 236, 244), edge=(246, 190, 217),
             boxes=[("Huawei Watch Fit", "HR · Resting HR · Sleep stages · Stress · SpO2"),
                    ("Huawei Health App", "Vendor sync bridge (BLE, proprietary)"),
                    ("Phone Sensors", "GPS · Pedometer · Microphone · Camera")]),
        dict(title="2 · MOBILE APPLICATION  —  React Native (Expo) + TypeScript", c=(79, 70, 229),
             soft=(238, 238, 253), edge=(199, 197, 246),
             boxes=[("HealthProvider", "Health Connect (Android) | HealthKit (iOS) adapter"),
                    ("ML Engine", "TFLite: our focus model + MoveNet pose"),
                    ("AR Layer", "Vision Camera → expo-gl / Three.js overlay"),
                    ("Scoring Engine", "Recovery score · z-score anomaly detector"),
                    ("Offline Store", "WatermelonDB / SQLite + sync queue"),
                    ("UI Layer", "Zustand · React Query · a11y")]),
        dict(title="3 · CLOUD BACKEND  —  Laravel 11 on DigitalOcean", c=(13, 148, 136),
             soft=(232, 248, 246), edge=(168, 224, 218),
             boxes=[("Sanctum Auth", "Tokens · rate limit · cert pinning"),
                    ("REST Controllers", "/tasks  /health-samples  /insights  /me/export"),
                    ("Laravel Reverb", "WebSocket broadcast → real-time sync"),
                    ("Redis", "Cache · queue · Reverb backplane"),
                    ("LLM Service", "ClaudeDriver | GeminiDriver (benchmarked)")]),
        dict(title="4 · DATA  &  EXTERNAL SERVICES", c=(217, 119, 6),
             soft=(254, 245, 231), edge=(247, 214, 160),
             boxes=[("Managed MySQL 8", "users · tasks · health_samples · focus_logs"),
                    ("Claude API", "Haiku 4.5 (parse) · Sonnet 5 (digest)"),
                    ("Gemini API", "Benchmark comparison arm"),
                    ("Weather · AQI · MQTT", "Environment feed + IoT smart-light trigger")]),
    ]

    y = 262
    lh = 300
    for i, L in enumerate(LAYERS):
        x0, x1 = M, W - M
        rrect(d, (x0, y, x1, y + lh), 20, fill=WHITE, outline=L["edge"], width=3)
        rrect(d, (x0, y, x0 + 12, y + lh), 6, fill=L["c"])
        d.text((x0 + 40, y + 24), L["title"], font=B(31), fill=L["c"])

        n = len(L["boxes"])
        inner = x1 - x0 - 80
        g = 22
        bw = (inner - (n - 1) * g) // n
        bx = x0 + 40
        by = y + 84
        for name, desc in L["boxes"]:
            rrect(d, (bx, by, bx + bw, by + lh - 118), 14,
                  fill=L["soft"], outline=L["edge"], width=2)
            d.text((bx + 22, by + 20), name, font=B(27), fill=INK)
            ty = by + 62
            for ln in wrap(d, desc, R(22), bw - 44):
                d.text((bx + 22, ty), ln, font=R(22), fill=MUTED)
                ty += 30
            bx += bw + g

        # connector arrow
        if i < len(LAYERS) - 1:
            ay = y + lh
            cx = W // 2
            d.line([(cx, ay + 6), (cx, ay + 34)], fill=(150, 160, 180), width=5)
            d.polygon([(cx - 16, ay + 30), (cx + 16, ay + 30), (cx, ay + 52)],
                      fill=(150, 160, 180))
            labels = ["Health Connect API", "HTTPS / TLS 1.3 · cert pinning · Sanctum · Reverb WS", "Eloquent ORM / HTTPS"]
            lb = labels[i]
            tw = d.textlength(lb, font=SB(23))
            rrect(d, (cx + 34, ay + 12, cx + 34 + tw + 36, ay + 54), 21,
                  fill=WHITE, outline=LINE, width=2)
            d.text((cx + 52, ay + 21), lb, font=SB(23), fill=MUTED)
        y += lh + 58

    d.text((M + 6, H - 74),
           "Offline ML pipeline (one-off):  Huawei data export + focus logs  →  Python / pandas  →  Keras MLP  →  .tflite bundled into the app",
           font=SB(26), fill=(79, 70, 229))

    save(img, "02-architecture.jpg")


feature_map()
architecture()
