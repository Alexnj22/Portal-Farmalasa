#!/usr/bin/env python3
"""Clasificación honesta de los <button> a mano.

La versión anterior contaba por FORMA y se equivocó dos veces (contó filas
como tarjetas, y un `<button>` dentro de un comentario JSX). Esta abre cada
bloque, le quita los comentarios, y decide por lo que el botón CONTIENE.
"""
import pathlib, re, sys
from collections import Counter

def bloques(txt):
    """(inicio, fin, cuerpo) de cada <button …>…</button> BALANCEADO.

    Balanceado importa: contar `<button` y `</button>` por separado corta el
    bloque en el lugar equivocado cuando hay uno anidado, que es como el
    migrador de v2.97.0 rompió ProveedoresView.
    """
    out = []
    for m in re.finditer(r'<button[\s>]', txt):
        i = m.start()
        cierre = txt.find('>', i)
        if cierre == -1: continue
        if txt[cierre - 1] == '/':
            out.append((i, cierre + 1, txt[i:cierre + 1])); continue
        prof, k = 1, cierre + 1
        while k < len(txt) and prof > 0:
            a, b = txt.find('<button', k), txt.find('</button>', k)
            if b == -1: break
            if a != -1 and a < b: prof += 1; k = a + 7
            else: prof -= 1; k = b + 9
        out.append((i, k, txt[i:k]))
    return out

BESPOKE = ('LoginView', 'timeclock', 'TimeClockView')

def fin_apertura(b):
    """Índice del `>` que cierra la etiqueta de apertura.

    NO vale `b.find('>')`: la primera `>` suele ser la flecha de una arrow
    function (`onClick={e => …}`), así que la etiqueta quedaba cortada y todo
    lo que decidía por el `className` fallaba en silencio. Detectado el
    2026-07-28 al ver botones uno-de-N clasificados como "acción".
    """
    prof = 0
    i = 0
    while i < len(b):
        c = b[i]
        if c == '{': prof += 1
        elif c == '}': prof -= 1
        elif c == '>' and prof == 0 and b[i-1] not in '=/':
            return i + 1
        i += 1
    return len(b)


def limpiar(b):
    """Quita comentarios JSX y de bloque — la trampa que ya costó dos conteos."""
    b = re.sub(r'\{/\*.*?\*/\}', '', b, flags=re.S)
    b = re.sub(r'/\*.*?\*/', '', b, flags=re.S)
    return b

def clasificar(b):
    b = limpiar(b)
    corte = fin_apertura(b)
    abre, cuerpo = b[:corte], b[corte:]

    ndiv  = len(re.findall(r'<div[\s>]', cuerpo))
    nspan = len(re.findall(r'<span[\s>]', cuerpo))
    nimg  = len(re.findall(r'<img[\s>]', cuerpo))

    # ¿el className codifica "esto está seleccionado de N"?
    unoDeN = re.search(r'(isActive|active|selected|seleccionad|=== *\w+ *\?)', abre) and '?' in abre

    if ndiv >= 2 or nimg:                  return 'B · fila o tarjeta (ListRow / composición)'
    if unoDeN and ndiv == 0 and nspan <= 1: return 'C · uno de N (SegmentedControl)'
    if ndiv >= 1:                          return 'B · fila o tarjeta (ListRow / composición)'
    if nspan >= 2:                         return 'E · composición real (2+ span con estilo)'
    return 'A · acción (Button)'

res, detalle = Counter(), []
for p in sorted(pathlib.Path('src').rglob('*.jsx')):
    if 'components/common/' in str(p): continue
    bespoke = any(k in str(p) for k in BESPOKE)
    txt = p.read_text()
    for i, j, b in bloques(txt):
        # un <button> que vive dentro de un comentario no existe
        antes = txt[:i]
        if antes.count('{/*') > antes.count('*/}'): continue
        fam = 'F · superficie bespoke (no migra)' if bespoke else clasificar(b)
        res[fam] += 1
        detalle.append((str(p), txt[:i].count('\n') + 1, fam, ' '.join(limpiar(b)[:120].split())))

print('── por familia ────────────────────────────────────────')
for f, n in res.most_common(): print(f'{n:5}  {f}')
print(f'{sum(res.values()):5}  TOTAL\n')

if len(sys.argv) > 1:
    q = sys.argv[1]
    print(f'── {q} ──')
    for f, n in Counter(d[0] for d in detalle if d[2].startswith(q)).most_common(20):
        print(f'{n:4}  {f}')
    print()
    for d in detalle:
        if d[2].startswith(q): print(f'{d[0]}:{d[1]}  {d[3][:105]}')
