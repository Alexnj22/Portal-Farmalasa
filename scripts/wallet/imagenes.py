"""Imágenes de la tarjeta de Puntos Salud en Apple Wallet.

Genera `supabase/functions/_shared/imagenesPase.ts` (base64) con:
  · icon / logo: el logo de la app, a los tamaños que pide Wallet;
  · strip: la FRANJA del frente (375×144 pt, @1x/@2x/@3x). Es lo que hace que
    se vea como una tarjeta: degradado de la marca, resplandor verde del logo,
    un brillo holográfico en diagonal y la cruz del logo como marca de agua.

Correr desde la raíz del repo:  python3 scripts/wallet/imagenes.py
"""
import base64, io, math
from PIL import Image, ImageDraw, ImageFilter

LOGO = 'apps/clientes/assets/icono.png'
SALIDA = 'supabase/functions/_shared/imagenesPase.ts'

def png(img):
    b = io.BytesIO(); img.save(b, 'PNG', optimize=True); return base64.b64encode(b.getvalue()).decode()

def mezclar(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def franja(escala):
    w, h = 375 * escala, 144 * escala
    # Degradado diagonal: ciruela oscuro → magenta del logo → violeta.
    paradas = [(0.0, (43, 11, 58)), (0.55, (156, 33, 156)), (1.0, (91, 30, 156))]
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / w) * 0.8 + (y / h) * 0.2
            for i in range(len(paradas) - 1):
                (t0, c0), (t1, c1) = paradas[i], paradas[i + 1]
                if t0 <= t <= t1:
                    px[x, y] = mezclar(c0, c1, (t - t0) / (t1 - t0)); break
    img = img.convert('RGBA')

    # Resplandor verde del logo, abajo a la derecha.
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    r = int(h * 1.1)
    d.ellipse((w - r * 0.9, h - r * 0.55, w + r * 0.6, h + r * 0.9), fill=(142, 195, 15, 120))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(28 * escala)))

    # Brillo holográfico: bandas de arcoíris tenues en diagonal.
    holo = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(holo)
    colores = [(255, 90, 170), (255, 214, 10), (120, 255, 160), (90, 200, 250), (175, 120, 255)]
    ancho = 22 * escala
    for i, c in enumerate(colores):
        x0 = int(w * 0.30) + i * ancho
        d.polygon([(x0, 0), (x0 + ancho, 0), (x0 + ancho - h * 0.6, h), (x0 - h * 0.6, h)], fill=c + (34,))
    img = Image.alpha_composite(img, holo.filter(ImageFilter.GaussianBlur(10 * escala)))

    # Un destello blanco suave cruzando.
    luz = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(luz)
    x0 = int(w * 0.18)
    d.polygon([(x0, 0), (x0 + 26 * escala, 0), (x0 + 26 * escala - h * 0.6, h), (x0 - h * 0.6, h)], fill=(255, 255, 255, 46))
    img = Image.alpha_composite(img, luz.filter(ImageFilter.GaussianBlur(6 * escala)))

    # La cruz del logo como marca de agua, a la derecha.
    logo = Image.open(LOGO).convert('RGBA').resize((int(h * 1.25),) * 2, Image.LANCZOS)
    a = logo.getchannel('A').point(lambda v: int(v * 0.16))
    blanco = Image.new('RGBA', logo.size, (255, 255, 255, 0)); blanco.putalpha(a)
    img.alpha_composite(blanco, (int(w - h * 1.0), int(-h * 0.12)))

    # Viñeta abajo, para que el saldo en blanco se lea siempre.
    vin = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(vin)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=(20, 4, 28, int(90 * (y / h) ** 2)))
    img = Image.alpha_composite(img, vin)
    return img.convert('RGB')

imgs = {}
base = Image.open(LOGO).convert('RGBA')
for n, s in {'icon.png': 29, 'icon@2x.png': 58, 'icon@3x.png': 87, 'logo.png': 50, 'logo@2x.png': 100, 'logo@3x.png': 150}.items():
    imgs[n] = png(base.resize((s, s), Image.LANCZOS))
for e in (1, 2, 3):
    imgs['strip.png' if e == 1 else f'strip@{e}x.png'] = png(franja(e))

with open(SALIDA, 'w') as f:
    f.write('// Imágenes de la tarjeta de Wallet. GENERADO por scripts/wallet/imagenes.py: no editar a mano.\n')
    f.write('export const IMAGENES_PASE: Record<string, string> = {\n')
    for n, b in imgs.items():
        f.write(f'  "{n}": "{b}",\n')
    f.write('};\n')
print('ok', {n: len(b) for n, b in imgs.items()})
