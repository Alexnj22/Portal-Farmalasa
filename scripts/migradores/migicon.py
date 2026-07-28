import sys, re, os, pathlib
sys.path.insert(0,'/private/tmp/claude-501/-Users-alexnunez-Documents-Portal-Farmalasa/e56167b9-fb3a-4c60-949f-c36ef2d30f1c/scratchpad')
from btnlib import botones, partir_atributos, limpiar_comentarios

def analiza(cuerpo):
    cn = ' '.join(v or '' for n,v in partir_atributos(cuerpo) if n=='className')
    m = re.search(r'\bw-(\d+(?:\.\d+)?)\b', cn)
    px = float(m.group(1))*4 if m else 32
    size = 'xs' if px<=28 else 'sm' if px<=34 else 'md' if px<=40 else 'lg'
    props = {}
    if re.search(r'bg-danger(-solid)?\b', cn):                        props['variant']='destructive'
    elif re.search(r'bg-(brand|gradient-to-\w+ from-brand)\b', cn):   props['variant']='primary'
    else:
        t = re.search(r'bg-(success|warning|danger|brand|chart-\d)/[12]?\d\b', cn)
        if t:                                    props['tone']=t.group(1); props['soft']=True
        elif re.search(r'bg-surface-card\b', cn): props['variant']='secondary'
        else:                                     props['variant']='ghost'
    return size, props

def migra(ruta, aplicar=True):
    t = pathlib.Path(ruta).read_text()
    # 1) recolectar TODOS los rangos de una sola pasada
    objetivos = []
    for ini, ft, fin, cuerpo, cont in botones(ruta):
        if 'className' not in cuerpo: continue
        c2 = limpiar_comentarios(cont)
        if re.sub(r'<[^>]*>','',c2).strip(): continue
        if not re.search(r'<[A-Z]\w*', c2): continue
        if 'w-px bg-divider' in t[max(0,ini-900):ini]: continue
        objetivos.append((ini, fin, cuerpo, c2))
    if not objetivos: return 0
    # 2) aplicar de ATRÁS hacia adelante para que los offsets sigan siendo válidos
    for ini, fin, cuerpo, c2 in reversed(objetivos):
        icono = re.search(r'<([A-Z]\w*)', c2).group(1)
        size, props = analiza(cuerpo)
        # REGLA: todo atributo que no sea className se COPIA tal cual
        otros = [f'{n}={v}' if v else n
                 for n, v in partir_atributos(cuerpo) if n not in ('className','type')]
        partes = [f'icon={{{icono}}}', 'iconOnly', f'size="{size}"']
        for k, v in props.items():
            partes.append(k if v is True else f'{k}="{v}"')
        partes += otros
        col = t.rfind('\n', 0, ini) + 1
        sang = ' ' * (ini - col)
        nuevo = f'<Button {" ".join(partes)} />'
        if len(sang) + len(nuevo) > 120:
            nuevo = '<Button\n' + '\n'.join(sang + '    ' + p for p in partes) + f'\n{sang}/>'
        t = t[:ini] + nuevo + t[fin:]
    if 'import Button' not in t:
        l = t.split('\n')
        ult = max(k for k, x in enumerate(l) if x.startswith('import ') and x.rstrip().endswith(';'))
        rel = os.path.relpath('src/components/common/Button', pathlib.Path(ruta).parent)
        l.insert(ult + 1, f"import Button from '{rel if rel.startswith('.') else './' + rel}';")
        t = '\n'.join(l)
    if aplicar: pathlib.Path(ruta).write_text(t)
    return len(objetivos)
