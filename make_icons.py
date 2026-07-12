from PIL import Image, ImageDraw, ImageFont
import os

PLUM = (91, 58, 78)
LINEN = (237, 230, 218)
GOLD = (169, 139, 61)
CREAM = (248, 245, 239)
LORA = "/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf"

def font(size):
    return ImageFont.truetype(LORA, size)

def center_text(d, size, text, fnt, fill, dy=0):
    b = d.textbbox((0, 0), text, font=fnt)
    tw, th = b[2] - b[0], b[3] - b[1]
    d.text(((size - tw) / 2 - b[0], (size - th) / 2 - b[1] + dy), text, font=fnt, fill=fill)

def plate_icon(size, bg=LINEN, plate_scale=1.0):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size, size], radius=int(size * 0.22), fill=bg)
    cx = cy = size / 2
    r1 = size * 0.36 * plate_scale
    d.ellipse([cx - r1, cy - r1, cx + r1, cy + r1], fill=CREAM, outline=PLUM, width=max(2, int(size * 0.012)))
    r2 = size * 0.27 * plate_scale
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], outline=GOLD, width=max(1, int(size * 0.008)))
    center_text(d, size, "H", font(int(size * 0.34 * plate_scale)), PLUM, dy=-size * 0.005)
    return img

for s in (192, 512):
    plate_icon(s).save(f"/home/claude/recipe-app/icons/icon-{s}.png")
plate_icon(180).save("/home/claude/recipe-app/icons/apple-touch-icon.png")

mask = Image.new("RGBA", (512, 512), LINEN)
inner = plate_icon(512, bg=LINEN, plate_scale=0.72)
mask.paste(inner, (0, 0), inner)
mask.save("/home/claude/recipe-app/icons/icon-512-maskable.png")

for f in ("concept_a.png", "concept_b.png", "concept_c.png", "concepts.png"):
    p = f"/home/claude/recipe-app/icons/{f}"
    if os.path.exists(p):
        os.remove(p)
print("final icons written")
