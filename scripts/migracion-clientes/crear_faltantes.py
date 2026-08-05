"""Crea en el portal los clientes del ERP que NO existen — y solo esos.

El espejo nunca crea filas: su RPC hace `JOIN customers c ON c.search_name =
e.match_name` y solo UPDATE, así que una ficha del ERP sin fila en el portal se
queda afuera para siempre. Al 2026-08-05 eran 3,747.

Pero "no existe en el portal" NO es "no está vinculada por erp_id". Medido el
2026-08-05, antes de la corrida:

    3,747 fichas del ERP sin fila
      626  SÍ existen en el portal — el join las perdía por la ñ (§4c del README)
       24  su NIT o su DUI ya es de otra fila — misma persona
        1  balde de mostrador del POS
    3,096  no existen bajo ningún nombre  -> creadas

Crear las 626 habría sido fabricar 626 duplicados. Por eso este script decide
la existencia con la CLAVE NORMALIZADA, no con el erp_id ni con el constraint.

Con el bug de la ñ ya cerrado, el cubo `existe_por_nombre` dejó de ser ese caso
y quedó siendo el que da nombre a la regla: **dos fichas del ERP para un solo
cliente**. Su fila del portal ya la tomó la otra mitad del par —la que eligió
`duplicados_resueltos.json`— y la perdedora no tiene a dónde ir. Crearla sería
partir el cliente en dos. Al 2026-08-05 quedan 19 así, y no son trabajo
pendiente: son la decisión abierta #3 del handoff.

── Por qué el constraint no alcanza para decidir "repetido" ─────────────────
El índice único de nombre es `upper(btrim(name))`, que NO quita acentos. La
columna de match, `search_name`, es una generada que SÍ los quita:

    lower(translate(name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun'))

O sea que insertar 'ABIGAIL MUÑOZ' teniendo ya 'ABIGAIL MUNOZ' **no falla**:
son distintas para el índice e iguales para el match. Entra sin error y deja
dos filas que el espejo ve como la misma — que es exactamente el duplicado que
no queremos. La base no nos va a frenar; el criterio tiene que estar acá.

Todo lo que huele a repetido se EXCLUYE y se informa. Es preferible dejar
fichas sin crear —que se ven en el informe y se pueden crear después— a
fabricar un duplicado, que ya no se ve y hay que salir a buscarlo.

    python3 crear_faltantes.py             # SIMULA: no escribe nada
    python3 crear_faltantes.py --aplicar   # crea, en lotes, vía RPC
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque          # noqa: E402
import aplicar_espejo  # noqa: E402
import verificar       # noqa: E402

# Los baldes de mostrador del POS. Espeja `public.es_cliente_mostrador`.
MOSTRADOR = {'TODOS', 'CLIENTES VARIOS', 'CLIENTE FRECUENTE', 'CLIENTE FRECUENTE NUEVO'}

COLUMNAS = ('nit', 'dui', 'nrc', 'phone', 'telefono2', 'email', 'direccion',
            'pasaporte', 'departamento', 'municipio', 'distrito', 'categoria',
            'giro', 'retencion_pct')

POR_LOTE = 200


# La clave sale de `bloque.clave_portal` — UNA sola definición en todo el
# proyecto. Tener dos copias de esta transformación es exactamente cómo nació el
# bug de la ñ: el espejo calculaba la suya y no coincidía con la columna.
clave = bloque.clave_portal


def es_mostrador(nombre, erp_id):
    return nombre.strip().upper() in MOSTRADOR or str(erp_id) in ('-1', '-2')


def datos_del_erp():
    """Los campos de cada ficha, de la cola del espejo. NO relee el ERP.

    `portal_pendiente.jsonl` es append-only y tiene una línea por ficha POR
    bloque, así que la última gana: es la versión más reciente que se leyó.
    """
    filas = {}
    with open(f'{D}/portal_pendiente.jsonl') as fh:
        for linea in fh:
            linea = linea.strip()
            if not linea:
                continue
            try:
                f = json.loads(linea)
            except ValueError:
                continue
            if f.get('erp_id'):
                filas[str(f['erp_id'])] = f
    return filas


def del_portal(url, cab):
    """Todo el portal, paginado. El cap de PostgREST es 1000."""
    filas, paso, i = [], 1000, 0
    while True:
        c = dict(cab, **{'Range': f'{i * paso}-{(i + 1) * paso - 1}'})
        req = urllib.request.Request(
            f'{url}/rest/v1/customers?select=id,name,search_name,erp_id,nit,dui', headers=c)
        with urllib.request.urlopen(req, timeout=120) as r:
            tanda = json.load(r)
        filas.extend(tanda)
        if len(tanda) < paso:
            return filas
        i += 1


def planificar(catalogo, campos, portal):
    """Qué crear y, sobre todo, qué NO. Devuelve (a_crear, excluidas)."""
    por_erp = {str(f['erp_id']) for f in portal if f.get('erp_id')}
    por_clave = {}
    for f in portal:
        por_clave.setdefault((f.get('search_name') or '').strip(), []).append(f)
    nits = {(f.get('nit') or '').strip() for f in portal if (f.get('nit') or '').strip()}
    duis = {(f.get('dui') or '').strip() for f in portal if (f.get('dui') or '').strip()}

    excl = {'mostrador': [], 'ya_vinculada': [], 'existe_por_nombre': [],
            'choca_entre_si': [], 'nit_repetido': [], 'dui_repetido': [],
            'sin_datos': []}
    candidatas, vistas = [], {}

    for eid in sorted(catalogo, key=int):
        nombre = catalogo[eid].strip()
        if es_mostrador(nombre, eid):
            excl['mostrador'].append((eid, nombre)); continue
        if eid in por_erp:
            excl['ya_vinculada'].append((eid, nombre)); continue
        k = clave(nombre)
        if k in por_clave:
            otra = por_clave[k][0]
            excl['existe_por_nombre'].append((eid, nombre, otra['name'], otra['id']))
            continue
        if k in vistas:
            excl['choca_entre_si'].append((eid, nombre, vistas[k]))
            continue
        f = campos.get(eid)
        if not f:
            excl['sin_datos'].append((eid, nombre)); continue
        nit = (f.get('nit') or '').strip()
        dui = (f.get('dui') or '').strip()
        if nit and nit in nits:
            excl['nit_repetido'].append((eid, nombre, nit)); continue
        if dui and dui in duis:
            excl['dui_repetido'].append((eid, nombre, dui)); continue

        vistas[k] = eid
        fila = {'name': nombre.upper(), 'erp_id': str(eid)}
        for c in COLUMNAS:
            fila[c] = f.get(c)
        candidatas.append(fila)
        # Reservar: dos fichas del lote no pueden traer el mismo NIT/DUI.
        if nit:
            nits.add(nit)
        if dui:
            duis.add(dui)
    return candidatas, excl


def aplicar(url, cab, filas):
    creadas = 0
    c = dict(cab, **{'Content-Type': 'application/json'})
    for i in range(0, len(filas), POR_LOTE):
        lote = filas[i:i + POR_LOTE]
        cuerpo = json.dumps({'p_filas': lote}).encode()
        req = urllib.request.Request(f'{url}/rest/v1/rpc/crear_clientes_faltantes',
                                     data=cuerpo, headers=c, method='POST')
        with urllib.request.urlopen(req, timeout=180) as r:
            n = json.load(r)
        creadas += int(n or 0)
        print(f'  lote {i // POR_LOTE + 1}: {n} creadas  (acumulado {creadas})', flush=True)
    return creadas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--aplicar', action='store_true', help='crea de verdad')
    ap.add_argument('--listar', type=int, default=8)
    a = ap.parse_args()

    _, catalogo = bloque.indice_erp()
    campos = datos_del_erp()
    url, cab = verificar.portal()
    portal = del_portal(url, cab)

    print(f'catálogo del ERP   {len(catalogo):>7,}')
    print(f'filas del portal   {len(portal):>7,}')
    print(f'fichas con datos   {len(campos):>7,}   (portal_pendiente.jsonl)')

    crear, excl = planificar(catalogo, campos, portal)

    print('\n── EXCLUIDAS (no se crean) ──')
    etiquetas = {
        'ya_vinculada':      'ya tienen fila (erp_id vinculado)',
        'existe_por_nombre': 'YA EXISTEN en el portal — su fila es de otra ficha del ERP',
        'choca_entre_si':    'dos fichas del ERP con el mismo nombre normalizado',
        'nit_repetido':      'su NIT ya es de otra fila',
        'dui_repetido':      'su DUI ya es de otra fila',
        'mostrador':         'baldes de mostrador del POS',
        'sin_datos':         'sin línea en portal_pendiente.jsonl',
    }
    for k, txt in etiquetas.items():
        print(f'  {len(excl[k]):>6,}  {txt}')

    for k in ('existe_por_nombre', 'choca_entre_si', 'nit_repetido', 'dui_repetido'):
        if excl[k]:
            print(f'\n  {etiquetas[k]}:')
            for fila in excl[k][:a.listar]:
                print('    ' + '  '.join(str(x)[:40] for x in fila))
            if len(excl[k]) > a.listar:
                print(f'    … y {len(excl[k]) - a.listar} más')

    print(f'\n── A CREAR: {len(crear):,} ──')
    con = {c: sum(1 for f in crear if f.get(c)) for c in ('distrito', 'dui', 'nit', 'direccion', 'phone')}
    print('  traen: ' + ' · '.join(f'{n:,} {c}' for c, n in con.items()))
    for f in crear[:a.listar]:
        print(f"    erp {f['erp_id']:<7} {f['name'][:40]:<42} {f.get('distrito') or '(sin distrito)'}")
    if len(crear) > a.listar:
        print(f'    … y {len(crear) - a.listar:,} más')

    if not a.aplicar:
        print('\n(SIMULACIÓN — no se escribió nada. Agregá --aplicar para crear.)')
        return
    if not crear:
        print('\nNada que crear.')
        return
    print(f'\nCreando {len(crear):,} clientes en lotes de {POR_LOTE}…')
    print(f'\nlisto: {aplicar(url, cab, crear):,} creadas.')


if __name__ == '__main__':
    main()
