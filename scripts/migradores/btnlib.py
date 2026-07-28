import re, pathlib

def limpiar_comentarios(s):
    s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
    return re.sub(r'/\*.*?\*/', '', s, flags=re.S)

def cierre_tag(t, desde):
    """Devuelve el índice del '>' que cierra el tag abierto en `desde`."""
    i, d = desde, 0
    while i < len(t):
        c = t[i]
        if c == '{': d += 1
        elif c == '}': d -= 1
        elif c in '"\'`':
            q = c; i += 1
            while i < len(t) and t[i] != q:
                if t[i] == '\\': i += 1
                i += 1
        elif c == '>' and d == 0:
            return i
        i += 1
    return None

def partir_atributos(txt):
    out=[]; i=0; n=len(txt)
    while i < n:
        while i<n and txt[i].isspace(): i+=1
        if i>=n: break
        ini=i
        while i<n and (txt[i].isalnum() or txt[i] in '-_'): i+=1
        nombre=txt[ini:i]
        if not nombre: i+=1; continue
        while i<n and txt[i].isspace(): i+=1
        if i<n and txt[i]=='=':
            i+=1
            while i<n and txt[i].isspace(): i+=1
            if txt[i]=='{':
                d=0; j=i
                while j<n:
                    if txt[j]=='{': d+=1
                    elif txt[j]=='}':
                        d-=1
                        if d==0: j+=1; break
                    elif txt[j] in '"\'`':
                        q=txt[j]; j+=1
                        while j<n and txt[j]!=q:
                            if txt[j]=='\\': j+=1
                            j+=1
                    j+=1
                out.append((nombre, txt[i:j])); i=j
            else:
                q=txt[i]; j=i+1
                while j<n and txt[j]!=q: j+=1
                out.append((nombre, txt[i:j+1])); i=j+1
        else:
            out.append((nombre, None))
    return out

def botones(ruta):
    """Itera (inicio, fin_tag, fin_total, cuerpo, contenido) de cada <button>."""
    t = pathlib.Path(ruta).read_text()
    for m in re.finditer(r'<button\b', t):
        fin = cierre_tag(t, m.end())
        if fin is None: continue
        cuerpo = t[m.end():fin].rstrip()
        auto = cuerpo.endswith('/')
        if auto:
            yield m.start(), fin, fin+1, cuerpo[:-1], ''
        else:
            c = t.find('</button>', fin)
            if c == -1: continue
            yield m.start(), fin, c+len('</button>'), cuerpo, t[fin+1:c]
