"""El banco de pruebas del matcher de distrito.

Existe para poder TRADUCIR `elegir_distrito` a TypeScript sin perder lo único
que lo hace confiable: que decidió sobre 25,946 fichas reales y esas decisiones
están registradas.

Una traducción "que se ve igual" no hereda nada. Una traducción que reproduce
las 25,946 decisiones, sí.

── Qué arma ────────────────────────────────────────────────────────────────
`casos_matcher.json`, con una entrada por ficha decidida:

    {"portal_id": "erp:64",          ← la semilla del determinista sale de acá
     "direccion":  "...",
     "departamento": "Chalatenango",
     "municipio":  "Chalatenango Sur",
     "ops": [["7","CHALATENANGO"], ...],   ← el combo del ERP, EN SU ORDEN
     "esperado_value":  "7",
     "esperado_motivo": "dirección (nombre completo)"}

`ops` importa en el orden exacto: el desempate determinista es
`ops[sha256(portal_id) % len(ops)]`, así que una lista reordenada da otro
distrito aunque tenga los mismos elementos. Por eso NO se derivan de
`elSalvadorGeo.js` — se leen del ERP, una ficha por municipio.

── Cómo se usa ─────────────────────────────────────────────────────────────
    python3 arnes_matcher.py            # arma casos_matcher.json
    python3 arnes_matcher.py --probar   # corre el matcher ORIGINAL contra él

El `--probar` es la prueba del arnés, no del matcher: si el original no
reproduce sus propias decisiones, el arnés está mal armado y no sirve de vara.
"""
import json
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque  # noqa: E402

CASOS = f'{D}/casos_matcher.json'
OPS_CACHE = f'{D}/ops_por_municipio.json'


def cargar_espejadas():
    """erp_id -> última fila espejada. El jsonl es append-only."""
    por_erp = {}
    with open(f'{D}/portal_pendiente.jsonl') as fh:
        for linea in fh:
            linea = linea.strip()
            if not linea:
                continue
            f = json.loads(linea)
            if f.get('erp_id'):
                por_erp[str(f['erp_id'])] = f
    return por_erp


def ops_por_municipio(erp_ids_por_municipio):
    """El combo de distritos de cada municipio, leído del ERP UNA vez.

    Se cachea en disco: son ~44 peticiones y no cambian entre corridas.
    """
    if os.path.exists(OPS_CACHE):
        return json.load(open(OPS_CACHE))
    cache = {}
    for i, (municipio, erp_id) in enumerate(sorted(erp_ids_por_municipio.items()), 1):
        print(f'  [{i}/{len(erp_ids_por_municipio)}] {municipio}…')
        try:
            _, ops = bloque.leer_ficha(erp_id)
        except Exception as e:
            print(f'    ⚠️  {e!r}')
            continue
        cache[municipio] = ops.get('distrito', [])
    json.dump(cache, open(OPS_CACHE, 'w'), ensure_ascii=False, indent=1)
    return cache


def armar():
    ck = json.load(open(f'{D}/checkpoint.json'))
    espejadas = cargar_espejadas()

    # Un erp_id de muestra por municipio, para leer su combo.
    muestra = {}
    for erp_id, f in espejadas.items():
        m = f.get('municipio')
        if m and m not in muestra:
            muestra[m] = erp_id
    print(f'municipios distintos: {len(muestra)}')
    ops = ops_por_municipio(muestra)

    casos, sin_ops, sin_espejo = [], 0, 0
    for erp_id, v in ck.items():
        if not isinstance(v, dict):
            continue
        decidido = (v.get('cambios') or {}).get('distrito')
        if not decidido:
            continue
        f = espejadas.get(str(erp_id))
        if not f:
            sin_espejo += 1
            continue
        lista = ops.get(f.get('municipio') or '')
        if not lista:
            sin_ops += 1
            continue
        # "CHALATENANGO (dirección (nombre completo))" → etiqueta y motivo.
        # Se quita UN paréntesis, no todos: `rstrip(')')` se comía también el
        # del motivo y dejaba "dirección (nombre completo", que no coincide con
        # nada. Los 25,946 casos "fallaban" por eso, no por el matcher.
        etiqueta, _, motivo = decidido.partition(' (')
        motivo = motivo[:-1] if motivo.endswith(')') else motivo
        casos.append({
            'portal_id': v.get('portal_id'),
            'direccion': f.get('direccion') or '',
            'departamento': f.get('departamento') or '',
            'municipio': f.get('municipio') or '',
            'ops': lista,
            'esperado_etiqueta': etiqueta.strip(),
            'esperado_motivo': motivo.strip(),
        })

    json.dump(casos, open(CASOS, 'w'), ensure_ascii=False)
    print(f'casos: {len(casos)}  (sin combo: {sin_ops}, sin espejo: {sin_espejo})')
    return casos


def probar():
    """Corre el matcher ORIGINAL contra el arnés. Debe dar 100%."""
    casos = json.load(open(CASOS))
    ok = fallan = 0
    ejemplos = []
    for c in casos:
        ops = [tuple(o) for o in c['ops']]
        # `ubicacion_de` toma los campos crudos de la ficha; acá ya tenemos las
        # etiquetas, así que se arma el conjunto igual que hace esa función.
        ubic = set()
        for etiqueta in (c['departamento'], c['municipio']):
            if etiqueta:
                ubic.add(bloque.norm(etiqueta))
                ubic.add(bloque.norm(etiqueta.split()[0]))
        value, motivo, _ = bloque.elegir_distrito(
            c['portal_id'], c['direccion'], ops, ubic)
        etiqueta = dict(ops).get(value, '')
        if bloque.norm(etiqueta) == bloque.norm(c['esperado_etiqueta']) \
           and motivo == c['esperado_motivo']:
            ok += 1
        else:
            fallan += 1
            if len(ejemplos) < 8:
                ejemplos.append(
                    f"  {c['portal_id']:12} dir={c['direccion'][:40]!r}\n"
                    f"      esperaba {c['esperado_etiqueta']} ({c['esperado_motivo']})\n"
                    f"      obtuvo   {etiqueta} ({motivo})")
    print(f'\nel matcher ORIGINAL contra su propio registro: {ok} ok · {fallan} distintos')
    for e in ejemplos:
        print(e)
    return fallan == 0


def salida():
    """Lo que decide el matcher ORIGINAL hoy, para comparar contra la traducción.

    Es la referencia real: no el registro histórico —que trae correcciones
    manuales posteriores y decisiones de reglas viejas— sino lo que el Python
    actual responde a las mismas entradas. Eso es lo que la traducción tiene
    que reproducir.
    """
    casos = json.load(open(CASOS))
    out = {}
    for c in casos:
        ops = [tuple(o) for o in c['ops']]
        ubic = set()
        for etiqueta in (c['departamento'], c['municipio']):
            if etiqueta:
                ubic.add(bloque.norm(etiqueta))
                ubic.add(bloque.norm(etiqueta.split()[0]))
        value, motivo, _ = bloque.elegir_distrito(
            c['portal_id'], c['direccion'], ops, ubic)
        out[c['portal_id']] = [value, motivo]
    json.dump(out, open(f'{D}/salida_python.json', 'w'), ensure_ascii=False)
    print(f'referencia del matcher original: {len(out)} decisiones '
          f'-> salida_python.json')


if __name__ == '__main__':
    if '--probar' in sys.argv:
        sys.exit(0 if probar() else 1)
    if '--salida' in sys.argv:
        salida()
    else:
        armar()
