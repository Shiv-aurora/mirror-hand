#!/usr/bin/env python3
"""Assemble the demo video from emulator footage.

    python3 devtools/video/build.py

Reads submission/footage/*.webm (made by devtools/record.mjs) and writes
submission/mirror-hand-demo.mp4. Needs ffmpeg and Pillow. The footage is real
app output; this script only adds title cards and captions.
"""
import os
import subprocess
import sys
import textwrap  # noqa: F401  (kept for quick edits)

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FOOTAGE = os.path.join(ROOT, "submission", "footage")
WORK = os.path.join(ROOT, "submission", "build")
OUT = os.path.join(ROOT, "submission", "mirror-hand-demo.mp4")
W, H, FPS = 1920, 1080, 30

FONT_PATHS = [
    os.path.expanduser("~/Library/Fonts/Inter-VariableFont_opsz,wght.ttf"),
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
]
INK = (246, 239, 230, 255)
SOFT = (246, 239, 230, 205)
FAINT = (246, 239, 230, 150)
ACCENT = (255, 207, 138, 255)
PANEL = (10, 13, 30, 214)


def font(size, weight="Regular"):
    for path in FONT_PATHS:
        if os.path.exists(path):
            f = ImageFont.truetype(path, size)
            try:
                f.set_variation_by_name(weight)
            except Exception:
                pass
            return f
    return ImageFont.load_default()


def wrap(draw, text, fnt, max_width):
    lines = []
    for paragraph in text.split("\n"):
        line = ""
        for word in paragraph.split(" "):
            trial = f"{line} {word}".strip()
            if line and draw.textlength(trial, font=fnt) > max_width:
                lines.append(line)
                line = word
            else:
                line = trial
        lines.append(line)
    return lines


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stderr[-3000:])
        raise SystemExit(f"ffmpeg failed: {' '.join(args[:6])} ...")


def caption_png(name, text, label=None, top=False):
    """A caption on a transparent 1920x1080 image: lower third, or the top."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    body = font(40, "Medium")
    small = font(24, "SemiBold")
    lines = wrap(draw, text, body, 1380)
    line_h = 54
    pad_x, pad_y = 44, 30
    text_w = max(draw.textlength(line, font=body) for line in lines)
    label_h = 38 if label else 0
    box_w = int(max(text_w, draw.textlength(label or "", font=small)) + pad_x * 2)
    box_h = int(len(lines) * line_h + pad_y * 2 + label_h - 8)
    x0 = (W - box_w) // 2
    y0 = 56 if top else H - 56 - box_h
    draw.rounded_rectangle((x0, y0, x0 + box_w, y0 + box_h), 26, fill=PANEL,
                           outline=(255, 207, 138, 70), width=2)
    y = y0 + pad_y - 6
    if label:
        draw.text((W / 2, y + 12), label.upper(), font=small, fill=ACCENT, anchor="mm")
        y += label_h
    for line in lines:
        draw.text((W / 2, y + line_h / 2), line, font=body, fill=INK, anchor="mm")
        y += line_h
    path = os.path.join(WORK, f"{name}.png")
    img.save(path)
    return path


def backdrop():
    """A blurred, darkened plate of the app's own scene, for the cards."""
    plate = os.path.join(WORK, "plate.png")
    run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(FOOTAGE, "two.webm"),
         "-ss", "44.2", "-frames:v", "1", plate])
    img = Image.open(plate).convert("RGB").resize((W, H))
    img = img.filter(ImageFilter.GaussianBlur(14))
    dark = Image.new("RGB", (W, H), (8, 10, 26))
    return Image.blend(img, dark, 0.58).convert("RGBA")


def card_png(name, blocks, base):
    """blocks: list of (text, size, weight, colour, gap_before, max_width)."""
    img = base.copy()
    draw = ImageDraw.Draw(img)
    laid = []
    total = 0
    for text, size, weight, colour, gap, width in blocks:
        fnt = font(size, weight)
        lines = wrap(draw, text, fnt, width)
        line_h = int(size * 1.36)
        laid.append((lines, fnt, colour, gap, line_h))
        total += gap + line_h * len(lines)
    y = (H - total) / 2
    for lines, fnt, colour, gap, line_h in laid:
        y += gap
        for line in lines:
            draw.text((W / 2, y + line_h / 2), line, font=fnt, fill=colour, anchor="mm")
            y += line_h
    path = os.path.join(WORK, f"{name}.png")
    img.convert("RGB").save(path)
    return path


def still_with_caption(name, still, caption):
    base = Image.open(still).convert("RGBA").resize((W, H))
    base.alpha_composite(Image.open(caption))
    path = os.path.join(WORK, f"{name}.png")
    base.convert("RGB").save(path)
    return path


ENCODE = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
          "-r", str(FPS), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]


def bed(duration):
    """A quiet pad like the app's own (the same three notes), for the cards."""
    expr = ("0.030*(sin(2*PI*110*t)+0.8*sin(2*PI*164.81*t)+0.55*sin(2*PI*220.7*t))"
            "*(0.85+0.15*sin(2*PI*0.07*t))")
    return ["-f", "lavfi", "-t", f"{duration}", "-i",
            f"aevalsrc='{expr}|{expr}':s=48000"]


def still_segment(name, image, duration):
    out = os.path.join(WORK, f"{name}.mp4")
    fade = 0.45
    run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-t", f"{duration}", "-i", image,
         *bed(duration),
         "-vf", f"fps={FPS},fade=t=in:st=0:d={fade},fade=t=out:st={duration - fade}:d={fade}",
         "-af", f"lowpass=f=520,afade=t=in:st=0:d=0.6,afade=t=out:st={duration - 0.6}:d=0.6",
         "-t", f"{duration}", *ENCODE, out])
    return out


def clip_segment(name, source, start, end, caption, crop=None):
    out = os.path.join(WORK, f"{name}.mp4")
    duration = end - start
    fade = 0.3
    chain = f"[0:v]fps={FPS},"
    if crop:
        cw, ch, cx, cy = crop
        scaled_w = int(round(cw * H / ch / 2) * 2)
        chain += (f"crop={cw}:{ch}:{cx}:{cy},scale={scaled_w}:{H}:flags=lanczos,"
                  f"pad={W}:{H}:(ow-iw)/2:0:black,")
    else:
        chain += f"scale={W}:{H}:flags=lanczos,"
    chain += ("setsar=1[v0];[v0][1:v]overlay=0:0[v1];"
              f"[v1]fade=t=in:st=0:d={fade},fade=t=out:st={duration - fade}:d={fade}[v]")
    # Seek on the input so every clip's timestamps start at zero.
    run(["ffmpeg", "-v", "error", "-y",
         "-ss", f"{start}", "-t", f"{duration}",
         "-i", os.path.join(FOOTAGE, source), "-loop", "1", "-i", caption,
         "-filter_complex", chain, "-map", "[v]", "-map", "0:a",
         "-af", f"afade=t=in:st=0:d=0.25,afade=t=out:st={duration - 0.3}:d=0.3",
         "-t", f"{duration}", *ENCODE, out])
    return out


def main():
    os.makedirs(WORK, exist_ok=True)
    base = backdrop()
    parts = []

    # --- opening cards -----------------------------------------------------
    parts.append(still_segment("00-title", card_png("card-title", [
        ("A THREE-MINUTE DAILY PRACTICE", 30, "SemiBold", ACCENT, 0, 1500),
        ("Mirror Hand", 150, "SemiBold", INK, 18, 1700),
        ("Move the hand that moves easily. Watch the other one follow.",
         46, "Regular", SOFT, 26, 1500),
        ("WebXR  ·  hands only  ·  Meta Quest and Meta VR Glasses",
         30, "Medium", FAINT, 70, 1500),
    ], base), 5.0))

    parts.append(still_segment("01-why", card_png("card-why", [
        ("After a stroke, one hand is often\nweak or hard to move.",
         60, "SemiBold", INK, 0, 1500),
        ("Mirror therapy is a rehabilitation technique. You watch the mirror image "
         "of your stronger hand, in the place of the weaker one, so it looks as "
         "though the weaker hand is moving.", 40, "Regular", SOFT, 44, 1420),
        ("A 2018 Cochrane review of 62 trials found moderate-quality evidence "
         "that it improves movement after stroke.", 40, "Regular", SOFT, 30, 1420),
        ("A headset can be the mirror.", 52, "SemiBold", ACCENT, 50, 1500),
        ("Thieme et al., Cochrane Database of Systematic Reviews, 2018",
         24, "Regular", FAINT, 56, 1500),
    ], base), 11.0))

    cap = caption_png("cap-landing", "It is a web page. Open the link in the headset "
                      "browser — nothing to install, no account.", top=True)
    parts.append(still_segment(
        "02-landing",
        still_with_caption("still-landing", os.path.join(FOOTAGE, "landing-before.png"), cap),
        4.0))

    # --- the session -------------------------------------------------------
    clips = [
        ("10-choose", "one.webm", 0.0, 5.9, "Choose",
         "Hold up the hand that moves more easily."),
        ("11-mirror", "one.webm", 5.9, 10.9, "The mirror",
         "That hand now drives both. The left hand you see is a live mirror image "
         "of the right, built from 25 tracked joints."),
        ("12-reveal", "one.webm", 10.9, 16.6, "Shown for this video only",
         "The blue outline is where the left hand really is: resting in the lap."),
        ("13-bloom", "one.webm", 16.6, 29.4, "1 of 3 · Open and close",
         "Open and close, slowly. Two water lilies follow. You try to move the "
         "weaker hand along with what you see."),
        ("14-chimes", "one.webm", 33.9, 45.2, "2 of 3 · Finger touches",
         "Thumb to each fingertip. Every touch rings a lantern."),
        ("15-reach", "two.webm", 0.3, 12.4, "3 of 3 · Reach",
         "Reach for pairs of fireflies. They appear around where this person "
         "first held their hand, never further."),
        ("16-turn", "two.webm", 12.5, 28.6, "Your turn",
         "Then the mirror switches off and the weaker hand tries on its own. "
         "(Here the emulator's left hand is scripted to close part of the way.)"),
        ("17-summary", "two.webm", 33.4, 39.8, "Progress",
         "How far it moved, as a share of your own stronger hand. Saved on the "
         "device only. Earlier sessions here were also run in the emulator."),
    ]
    for name, source, start, end, label, text in clips:
        parts.append(clip_segment(name, source, start, end,
                                  caption_png(f"cap-{name}", text, label)))

    cap = caption_png("cap-return", "Tomorrow, the number to beat is your own.", top=True)
    parts.append(still_segment(
        "18-return",
        still_with_caption("still-return", os.path.join(FOOTAGE, "landing-after.png"), cap),
        4.0))

    # The glasses view: 37 degrees left and right, 25 up, 43 down, cut out of
    # the emulator's 90-degree frame (focal length 540 px at 1080 px tall).
    parts.append(clip_segment(
        "19-glasses", "glasses.webm", 3.0, 11.5,
        caption_png("cap-glasses", "The same session inside the narrower view of Meta VR "
                    "Glasses. Buttons work by looking and pinching, or by resting a "
                    "fingertip on them.", "Meta VR Glasses field of view"),
        crop=(814, 756, 553, 288)))

    # --- closing card ------------------------------------------------------
    parts.append(still_segment("20-end", card_png("card-end", [
        ("Mirror Hand", 96, "SemiBold", INK, 0, 1700),
        ("Hands only  ·  seated  ·  either hand can lead", 40, "Medium", SOFT, 36, 1500),
        ("Every instruction is text  ·  no time limits  ·  nothing to fail",
         40, "Medium", SOFT, 12, 1500),
        ("No account. Nothing uploaded. Progress stays on the device.",
         40, "Medium", SOFT, 12, 1500),
        ("Built and tested in the Immersive Web SDK emulator. Not a medical device, "
         "and not yet tested with patients or clinicians.",
         32, "Regular", FAINT, 56, 1300),
        ("shiv-aurora.github.io/mirror-hand", 44, "SemiBold", ACCENT, 56, 1500),
    ], base), 9.0))

    # --- join --------------------------------------------------------------
    listing = os.path.join(WORK, "parts.txt")
    with open(listing, "w") as handle:
        for part in parts:
            handle.write(f"file '{part}'\n")
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listing,
         "-c", "copy", "-movflags", "+faststart", OUT])
    print("wrote", OUT)


if __name__ == "__main__":
    main()
