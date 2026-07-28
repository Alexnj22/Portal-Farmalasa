import sys, re, os, pathlib
sys.path.insert(0,'/private/tmp/claude-501/-Users-alexnunez-Documents-Portal-Farmalasa/e56167b9-fb3a-4c60-949f-c36ef2d30f1c/scratchpad')
from btnlib import botones, partir_atributos, limpiar_comentarios

# Clases que son PRESENTACIÓN de botón: si un ternario solo contiene esto, el
# canónico lo reemplaza entero. Si contiene otra cosa (layout, posición, ancho),
# se saltea: ahí el ternario está haciendo algo que el canónico no sabe.
PRESENTACION = re.compile(
    r'^(bg-|text-|border|ring-|shadow|hover:|active:|focus|from-|to-|via-|opacity-|'
    r'cursor-|transition|duration|ease-|scale-|translate|rounded|font-|uppercase|'
    r'lowercase|capitalize|tracking-|leading-|group|backdrop|animate-|brightness)')

def clases_de(cn):
    """Todas las clases literales de un className, incluidas las de los ternarios."""
    return re.findall(r"[\w:/\[\]\.\-]+", re.sub(r'\$\{|\}', ' ', cn.strip('`"{}')))

def ternario_solo_presentacion(cn):
    for expr in re.findall(r'\$\{([^}]*)\}', cn):
        for cad in re.findall(r"'([^']*)'|\"([^\"]*)\"", expr):
            for c in (cad[0] or cad[1]).split():
                if not PRESENTACION.match(c): return False
    return True

def analiza(cn):
    props = {}
    cls = ' '.join(clases_de(cn))
    m = re.search(r'\bh-(\d+(?:\.\d+)?)\b', cls)
    if m:
        px = float(m.group(1)) * 4
        props['size'] = 'xs' if px <= 28 else 'sm' if px <= 34 else 'md' if px <= 42 else 'lg'
    elif re.search(r'\bpy-(3\.5|4|5)\b', cls): props['size'] = 'lg'
    elif re.search(r'\bpy-(1|1\.5)\b', cls):   props['size'] = 'sm'

    if re.search(r'bg-danger(-solid)?\b|from-danger', cls):        props['variant'] = 'destructive'
    elif re.search(r'bg-brand(-hover|-dark)?\b|from-brand', cls):   props['variant'] = 'primary'
    else:
        t = re.search(r'bg-(success|warning|chart-\d)(-solid)?\b', cls)
        s = re.search(r'bg-(success|warning|danger|brand|chart-\d)/[12]?\d\b', cls)
        if t:   props['tone'] = t.group(1)
        elif s: props['tone'] = s.group(1); props['soft'] = True
        elif re.search(r'bg-surface-card', cls): props['variant'] = 'secondary'
        else:                                    props['variant'] = 'ghost'
    if 'w-full' in cls or 'flex-1' in cls:
        props['className'] = 'w-full' if 'w-full' in cls else 'flex-1'
    return props

def candidatos(ruta):
    t = pathlib.Path(ruta).read_text()
    out = []
    for ini, ft, fin, cuerpo, cont in botones(ruta):
        if 'className' not in cuerpo: continue
        c2 = limpiar_comentarios(cont)
        texto = re.sub(r'<[^>]*>', '', c2).strip()
        if not texto: continue                                   # eso es familia D
        if re.search(r'<div\b', c2): continue                    # familia B
        if re.search(r"===\s*['\"]", cuerpo): continue           # familia C
        if 'w-px bg-divider' in t[max(0, ini-900):ini]: continue # filter pill
        if re.search(r'group-hover|opacity-0\b', cuerpo): continue
        cn = next((v for n, v in partir_atributos(cuerpo) if n == 'className'), '')
        if not ternario_solo_presentacion(cn): continue
        # hijos: como máximo un ícono + texto (el resto es composición real)
        if len(re.findall(r'<[A-Z]\w*', c2)) > 3: continue
        # Un ternario que devuelve JSX no se puede desarmar sacando los íconos:
        # `{editando ? <><Save/> Guardar</> : <><Plus/> Crear</>}` quedaría como
        # `{editando ?  Guardar :  Crear}`, que no compila. Detectado probando
        # en RolesView antes de correrlo sobre los 51 archivos.
        if '<>' in c2 or re.search(r'\?\s*<', c2): continue
        out.append((ini, fin, cuerpo, c2, cn))
    return t, out

def migra(ruta):
    t, objs = candidatos(ruta)
    if not objs: return 0
    for ini, fin, cuerpo, c2, cn in reversed(objs):
        props = analiza(cn)
        iconos = re.findall(r'<([A-Z]\w*)\s', c2)
        cargando = 'Loader2' in iconos
        icono = next((i for i in iconos if i != 'Loader2'), None)
        # el contenido: se quitan los íconos y queda el texto/expresión
        interior = re.sub(r'<[A-Z]\w*[^>]*/>', '', c2)
        interior = re.sub(r'<>|</>', '', interior)
        interior = re.sub(r'\{[^{}]*\?\s*<[^}]*\}', '', interior)
        interior = interior.strip()
        # REGLA: todo atributo que no sea className se copia
        otros = [f'{n}={v}' if v else n
                 for n, v in partir_atributos(cuerpo) if n != 'className']
        partes = []
        for k, v in props.items():
            if k == 'className': partes.append(f'className="{v}"')
            else: partes.append(k if v is True else f'{k}="{v}"')
        if icono:   partes.append(f'icon={{{icono}}}')
        if cargando:
            cond = next((v for n, v in partir_atributos(cuerpo) if n == 'disabled'), None)
            if cond: partes.append(f'loading={cond}')
        partes += otros
        col = t.rfind('\n', 0, ini) + 1
        sang = ' ' * (ini - col)
        cab = f'<Button {" ".join(partes)}>'
        if len(sang) + len(cab) > 118:
            cab = '<Button\n' + '\n'.join(sang + '    ' + p for p in partes) + f'\n{sang}>'
        nuevo = f'{cab}{interior}</Button>' if len(interior) < 60 and '\n' not in interior \
                else f'{cab}\n{sang}    {interior}\n{sang}</Button>'
        t = t[:ini] + nuevo + t[fin:]
    if 'import Button' not in t:
        l = t.split('\n')
        ult = max(k for k, x in enumerate(l) if x.startswith('import ') and x.rstrip().endswith(';'))
        rel = os.path.relpath('src/components/common/Button', pathlib.Path(ruta).parent)
        l.insert(ult + 1, f"import Button from '{rel if rel.startswith('.') else './' + rel}';")
        t = '\n'.join(l)
    pathlib.Path(ruta).write_text(t)
    return len(objs)
