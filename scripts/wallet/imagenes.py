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

FONDO = (52, 14, 66)   # = backgroundColor del pase (_shared/pase.ts): la franja se funde con él.

# Un tema por nivel (2026-10-08): la tarjeta de Wallet cambia con el nivel, igual
# que la de la app. `fondo` es el backgroundColor del pase para ese nivel
# (NIVELES en _shared/pase.ts): la franja nace y muere en él.
TEMAS = {
    'vip':     {'fondo': (52, 14, 66),  'luz': (170, 40, 175, 150), 'brillo': (142, 195, 15, 85),   'sombra': (91, 30, 156, 120), 'holo': 30},
    'plata':   {'fondo': (58, 64, 74),  'luz': (200, 210, 224, 120), 'brillo': (235, 240, 248, 70), 'sombra': (40, 46, 56, 120),  'holo': 18},
    'oro':     {'fondo': (74, 46, 6),   'luz': (230, 172, 60, 150),  'brillo': (255, 222, 130, 90), 'sombra': (110, 66, 0, 120),  'holo': 16},
    'platino': {'fondo': (10, 11, 14),  'luz': (70, 78, 96, 130),    'brillo': (200, 210, 230, 40), 'sombra': (0, 0, 0, 140),     'holo': 42},
}

def franja(escala, tema=None):
    """La franja sin bordes: nace y muere en el color del fondo del pase, así
    que la tarjeta se lee como UNA pieza (la primera versión era un rectángulo
    pegado, con una cruz cortada a la derecha — probado en el iPhone el
    2026-10-06). Adentro: luz magenta, un resplandor verde del logo, el brillo
    holográfico en diagonal y un fino patrón de líneas, como el grabado de una
    tarjeta de verdad."""
    tema = tema or TEMAS['vip']
    FONDO = tema['fondo']
    w, h = 375 * escala, 144 * escala
    img = Image.new('RGBA', (w, h), FONDO + (255,))

    def capa(dibujar, desenfoque):
        c = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        dibujar(ImageDraw.Draw(c))
        return c.filter(ImageFilter.GaussianBlur(desenfoque * escala)) if desenfoque else c

    # Luz magenta del logo, amplia, centrada un poco a la derecha.
    img = Image.alpha_composite(img, capa(lambda d: d.ellipse((w * 0.15, -h * 0.6, w * 1.15, h * 1.5), fill=tema['luz']), 46))
    # Resplandor verde, abajo a la derecha.
    img = Image.alpha_composite(img, capa(lambda d: d.ellipse((w * 0.62, h * 0.35, w * 1.1, h * 1.4), fill=tema['brillo']), 34))
    # Violeta arriba a la izquierda, para que el degradado tenga profundidad.
    img = Image.alpha_composite(img, capa(lambda d: d.ellipse((-w * 0.2, -h * 0.8, w * 0.45, h * 0.7), fill=tema['sombra']), 40))

    # Brillo holográfico: bandas de arcoíris tenues en diagonal.
    colores = [(255, 90, 170), (255, 214, 10), (120, 255, 160), (90, 200, 250), (175, 120, 255)]
    ancho = 18 * escala
    def holo(d):
        for i, c in enumerate(colores):
            x0 = int(w * 0.42) + i * ancho
            d.polygon([(x0, 0), (x0 + ancho, 0), (x0 + ancho - h * 0.7, h), (x0 - h * 0.7, h)], fill=c + (tema['holo'],))
    img = Image.alpha_composite(img, capa(holo, 9))
    # Destello blanco fino.
    def destello(d):
        x0 = int(w * 0.30)
        d.polygon([(x0, 0), (x0 + 10 * escala, 0), (x0 + 10 * escala - h * 0.7, h), (x0 - h * 0.7, h)], fill=(255, 255, 255, 60))
    img = Image.alpha_composite(img, capa(destello, 4))

    # Grabado: líneas diagonales finísimas, como el guilloché de una tarjeta.
    def grabado(d):
        paso = 7 * escala
        for x in range(-h, w + h, paso):
            d.line([(x, 0), (x - h * 0.7, h)], fill=(255, 255, 255, 10), width=max(1, escala // 2))
    img = Image.alpha_composite(img, capa(grabado, 0))

    # Fundido arriba y abajo hacia el color del fondo: sin bordes.
    fundido = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(fundido)
    for y in range(h):
        t = y / (h - 1)
        a = max(0.0, 1 - t / 0.22) if t < 0.22 else max(0.0, (t - 0.72) / 0.28)
        d.line([(0, y), (w, y)], fill=FONDO + (int(255 * min(1.0, a) ** 1.4),))
    img = Image.alpha_composite(img, fundido)
    return img.convert('RGB')

imgs = {}
base = Image.open(LOGO).convert('RGBA')
for n, s in {'icon.png': 29, 'icon@2x.png': 58, 'icon@3x.png': 87, 'logo.png': 50, 'logo@2x.png': 100, 'logo@3x.png': 150}.items():
    imgs[n] = png(base.resize((s, s), Image.LANCZOS))
for e in (1, 2, 3):
    imgs['strip.png' if e == 1 else f'strip@{e}x.png'] = png(franja(e))

# Las franjas de los otros niveles (sin @1x: ningún iPhone con Wallet la usa).
franjas = {}
for clave, tema in TEMAS.items():
    if clave == 'vip':
        continue
    for e in (2, 3):
        franjas[f'{clave}|strip@{e}x.png'] = png(franja(e, tema))

with open(SALIDA, 'w') as f:
    f.write('// Imágenes de la tarjeta de Wallet. GENERADO por scripts/wallet/imagenes.py: no editar a mano.\n')
    f.write('export const IMAGENES_PASE: Record<string, string> = {\n')
    for n, b in imgs.items():
        f.write(f'  "{n}": "{b}",\n')
    f.write('};\n')
    f.write('// Franjas por nivel: clave «nivel|archivo».\n')
    f.write('export const FRANJAS_NIVEL: Record<string, string> = {\n')
    for n, b in franjas.items():
        f.write(f'  "{n}": "{b}",\n')
    f.write('};\n')
print('ok', {n: len(b) for n, b in imgs.items()})
