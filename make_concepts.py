from PIL import Image, ImageDraw, ImageFont
import math, os

PLUM = (91, 58, 78)
LINEN = (237, 230, 218)
GOLD = (169, 139, 61)
CREAM = (248, 245, 239)

LORA = "/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf"
BASK = "/usr/share/fonts/truetype/baskerville/GFSBaskerville.otf"

def font(path, size):
    return ImageFont.truetype(path, size)

def tile(size, bg=PLUM, radius=0.22):
    img = Image.new("RGBA", (size, size), (0,0,0,0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0,0,size,size], radius=int(size*radius), fill=bg)
    return img, d

def center_text(d, size, text, fnt, fill, dy=0):
    b = d.textbbox((0,0), text, font=fnt)
    tw, th = b[2]-b[0], b[3]-b[1]
    d.text(((size-tw)/2 - b[0], (size-th)/2 - b[1] + dy), text, font=fnt, fill=fill)

# ---------- Concept A: refined HS monogram with gold rule ----------
def concept_a(size):
    img, d = tile(size)
    inset = size*0.12
    d.rounded_rectangle([inset,inset,size-inset,size-inset], radius=int(size*0.09),
                        outline=GOLD, width=max(1,int(size*0.010)))
    center_text(d, size, "HS", font(LORA, int(size*0.38)), LINEN)
    return img

# ---------- Concept B: single serif "H" on a plate ----------
def concept_b(size):
    img, d = tile(size, bg=LINEN)
    # plate: two concentric circles
    cx = cy = size/2
    r1 = size*0.36
    d.ellipse([cx-r1,cy-r1,cx+r1,cy+r1], fill=CREAM, outline=PLUM, width=max(2,int(size*0.012)))
    r2 = size*0.27
    d.ellipse([cx-r2,cy-r2,cx+r2,cy+r2], outline=GOLD, width=max(1,int(size*0.008)))
    center_text(d, size, "H", font(LORA, int(size*0.34)), PLUM, dy=-size*0.005)
    return img

# ---------- Concept C: fork + spoon crossed over plum, minimal ----------
def concept_c(size):
    img, d = tile(size)
    cx, cy = size/2, size*0.52
    L = size*0.26
    # simple crossed fork & knife as thin linen lines
    lw = max(2, int(size*0.028))
    # knife (left, angled)
    d.line([cx-size*0.10, cy+L, cx-size*0.10, cy-L], fill=LINEN, width=lw)
    d.line([cx-size*0.10, cy-L, cx-size*0.055, cy-L*0.55], fill=LINEN, width=lw)  # blade hint
    # fork (right, angled)
    fx = cx+size*0.10
    d.line([fx, cy+L, fx, cy-L*0.3], fill=LINEN, width=lw)
    for off in (-0.05, 0, 0.05):
        d.line([fx+size*off, cy-L*0.3, fx+size*off, cy-L], fill=LINEN, width=max(2,int(size*0.016)))
    d.line([fx-size*0.05, cy-L*0.3, fx+size*0.05, cy-L*0.3], fill=LINEN, width=max(2,int(size*0.016)))
    # gold dot above
    dr = size*0.03
    d.ellipse([cx-dr, cy-L-size*0.10-dr, cx+dr, cy-L-size*0.10+dr], fill=GOLD)
    return img

for name, fn in [("a", concept_a), ("b", concept_b), ("c", concept_c)]:
    fn(512).save(f"/home/claude/recipe-app/icons/concept_{name}.png")

# contact sheet
sheet = Image.new("RGB", (512*3+80, 560), (250,247,241))
d = ImageDraw.Draw(sheet)
lbl = font(LORA, 30)
for i,(name,_) in enumerate([("A — Monogram",0),("B — Plate",0),("C — Fork & spoon",0)]):
    ic = Image.open(f"/home/claude/recipe-app/icons/concept_{'abc'[i]}.png").resize((460,460))
    x = 20 + i*(512+10)
    sheet.paste(ic, (x, 20), ic)
    b = d.textbbox((0,0), name, font=lbl)
    d.text((x + (460-(b[2]-b[0]))/2, 495), name, font=lbl, fill=(60,50,55))
sheet.save("/home/claude/recipe-app/icons/concepts.png")
print("done")
