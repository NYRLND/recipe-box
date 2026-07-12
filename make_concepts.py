from PIL import Image, ImageDraw, ImageFont
import os

PLUM = (91, 58, 78)
LINEN = (237, 230, 218)
GOLD = (169, 139, 61)
CREAM = (248, 245, 239)
LORA = "/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf"

def font(size): return ImageFont.truetype(LORA, size)

def center_text(d, w, text, fnt, fill, cy, ox=0):
    b = d.textbbox((0,0), text, font=fnt)
    tw, th = b[2]-b[0], b[3]-b[1]
    d.text(((w-tw)/2 - b[0] + ox, cy - th/2 - b[1]), text, font=fnt, fill=fill)

def tile(size, bg):
    img = Image.new("RGBA", (size,size), (0,0,0,0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0,0,size,size], radius=int(size*0.22), fill=bg)
    return img, d

# D-family refinements. All plate + serif R, varying bg / ring / detail.

# D1: original — linen tile, cream plate, gold inner ring, plum R
def d1(size):
    img,d = tile(size, LINEN); s=size; cx=cy=s/2
    r1=s*0.36; d.ellipse([cx-r1,cy-r1,cx+r1,cy+r1], fill=CREAM, outline=PLUM, width=max(2,int(s*0.012)))
    r2=s*0.27; d.ellipse([cx-r2,cy-r2,cx+r2,cy+r2], outline=GOLD, width=max(1,int(s*0.008)))
    center_text(d,s,"R",font(int(s*0.32)),PLUM,cy)
    return img

# D2: plum tile, linen plate, gold ring, plum R — richer, pops more
def d2(size):
    img,d = tile(size, PLUM); s=size; cx=cy=s/2
    r1=s*0.37; d.ellipse([cx-r1,cy-r1,cx+r1,cy+r1], fill=LINEN, width=0)
    r2=s*0.30; d.ellipse([cx-r2,cy-r2,cx+r2,cy+r2], outline=GOLD, width=max(2,int(s*0.010)))
    center_text(d,s,"R",font(int(s*0.34)),PLUM,cy)
    return img

# D3: plum tile, cream plate, double gold rings, gold R — most "fine dining"
def d3(size):
    img,d = tile(size, PLUM); s=size; cx=cy=s/2
    r1=s*0.37; d.ellipse([cx-r1,cy-r1,cx+r1,cy+r1], fill=CREAM, width=0)
    r2=s*0.30; d.ellipse([cx-r2,cy-r2,cx+r2,cy+r2], outline=GOLD, width=max(1,int(s*0.007)))
    r3=s*0.325; d.ellipse([cx-r3,cy-r3,cx+r3,cy+r3], outline=GOLD, width=max(1,int(s*0.004)))
    center_text(d,s,"R",font(int(s*0.33)),PLUM,cy)
    return img

# D4: cleaner minimal — linen tile, single thin plum ring (no fill), plum R
def d4(size):
    img,d = tile(size, LINEN); s=size; cx=cy=s/2
    r1=s*0.34; d.ellipse([cx-r1,cy-r1,cx+r1,cy+r1], outline=PLUM, width=max(2,int(s*0.014)))
    center_text(d,s,"R",font(int(s*0.36)),PLUM,cy)
    return img

concepts=[("D1 — Original","d1",d1),("D2 — Plum, linen plate","d2",d2),
          ("D3 — Double gold ring","d3",d3),("D4 — Minimal ring","d4",d4)]
for _,k,fn in concepts: fn(512).save(f"/home/claude/recipe-app/icons/concept_{k}.png")

sheet=Image.new("RGB",(512*4+100,600),(250,247,241)); dd=ImageDraw.Draw(sheet); lbl=font(26)
for i,(name,k,_) in enumerate(concepts):
    ic=Image.open(f"/home/claude/recipe-app/icons/concept_{k}.png").resize((460,460))
    x=20+i*(512-20); sheet.paste(ic,(x,20),ic)
    b=dd.textbbox((0,0),name,font=lbl); dd.text((x+(460-(b[2]-b[0]))/2,500),name,font=lbl,fill=(60,50,55))
sheet.save("/home/claude/recipe-app/icons/concepts_d.png")
print("done")
