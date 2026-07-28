import re, os, pathlib

def bloque_map(ruta, linea_btn):
    """Devuelve (ini, fin) del `{ARR.map(... )}` que contiene al <button> de esa línea."""
    t = pathlib.Path(ruta).read_text()
    off = sum(len(l)+1 for l in t.split('\n')[:linea_btn-1])
    ini = t.rfind('{', 0, off)
    # retroceder hasta la llave que abre la expresión .map
    while ini > 0:
        frag = t[ini:off]
        if '.map(' in frag and frag.count('{') >= 1:
            break
        ini = t.rfind('{', 0, ini)
    d = 0; i = ini
    while i < len(t):
        c = t[i]
        if c == '{': d += 1
        elif c == '}':
            d -= 1
            if d == 0: return ini, i+1
        elif c in '"\'`':
            q = c; i += 1
            while i < len(t) and t[i] != q:
                if t[i] == '\\': i += 1
                i += 1
        i += 1
    return None

def reemplazar_bloque(ruta, linea_btn, nuevo, quitar_wrapper=False):
    t = pathlib.Path(ruta).read_text()
    r = bloque_map(ruta, linea_btn)
    assert r, (ruta, linea_btn)
    ini, fin = r
    col = t.rfind('\n', 0, ini) + 1
    sang = ' ' * (ini - col)
    t = t[:ini] + nuevo.replace('\n', '\n'+sang) + t[fin:]
    if 'import SegmentedControl' not in t:
        l = t.split('\n')
        ult = max(k for k,x in enumerate(l) if x.startswith('import ') and x.rstrip().endswith(';'))
        rel = os.path.relpath('src/components/common/SegmentedControl', pathlib.Path(ruta).parent)
        l.insert(ult+1, f"import SegmentedControl from '{rel if rel.startswith('.') else './'+rel}';")
        t = '\n'.join(l)
    pathlib.Path(ruta).write_text(t)
    print('✓', ruta, linea_btn)
