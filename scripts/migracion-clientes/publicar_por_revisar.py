"""Publica en el portal las fichas que la migración NO tocó, con su motivo.

Hasta el 2026-08-05 esta información existía solo como archivos JSON de esta
carpeta —`checkpoint.json`, `ambiguos.json`, más las exclusiones que calcula
`crear_faltantes.py`—, o sea que nadie que use el portal podía verla. Y es
justamente la que necesita una persona para decidir: son fichas congeladas por
regla o no creadas para no duplicar, no cosas que un script pueda resolver.

Dos familias:

  fiscal_congelado   las de categoría fiscal. El bloque las lee y las espeja
                     pero NUNCA las escribe, por decisión del usuario: detrás
                     de cada dato fiscal tiene que haber una persona.

  *_repetido         las que no se crearon porque su cliente ya existe en el
                     portal, o porque su NIT/DUI ya es de otra ficha. La mayoría
                     NO existe en `customers`, así que se guarda el snapshot de
                     sus datos: sin eso, decidir "¿la creo o la descarto?"
                     obligaría a salir del portal.

Es idempotente y no borra nada: el RPC hace ON CONFLICT y solo escribe las
filas que realmente cambiaron. Un descarte hecho en el portal sobrevive a que
esto se vuelva a correr.

    python3 publicar_por_revisar.py             # SIMULA
    python3 publicar_por_revisar.py --aplicar
"""
import argparse
import collections
import json
import os
import sys
import urllib.request

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque             # noqa: E402
import verificar          # noqa: E402
import crear_faltantes as cf   # noqa: E402

POR_LOTE = 200


def congelados(catalogo, campos):
    """Las fichas que el bloque saltea por ser de categoría fiscal.

    El checkpoint las marca `SALTADO (categoría X)` pero NO guarda qué
    corrección quedó pendiente —`cambios` viene vacío—, así que el detalle se
    arma con la categoría y con lo que le falta para poder facturar, que es la
    pregunta que una persona se hace al abrirla.
    """
    ck = bloque.cargar_checkpoint()
    faltan = {}
    ruta = f'{D}/faltantes_dte.json'
    if os.path.exists(ruta):
        faltan = {k: v.get('faltan', []) for k, v in json.load(open(ruta)).items()}

    filas = []
    for eid, v in ck.items():
        estado = v.get('estado') or ''
        if not estado.startswith('SALTADO'):
            continue
        categoria = estado.split('categoría ')[-1].split(')')[0].strip() or '—'
        pendientes = faltan.get(eid) or []
        detalle = f'Categoría {categoria}. '
        detalle += (f'Le falta: {", ".join(pendientes)}.' if pendientes
                    else 'La ficha está completa; se congela por ser fiscal.')
        filas.append({
            'erp_id': str(eid),
            'name': (v.get('name') or catalogo.get(eid) or '').strip(),
            'motivo': 'fiscal_congelado',
            'detalle': detalle,
            'datos': campos.get(str(eid)),
        })
    return filas


def repetidos(excl, catalogo, campos):
    """Las que no se crearon para no duplicar. El detalle dice CONTRA QUÉ choca:
    sin eso la lista es una lista de nombres y no se puede decidir nada."""
    filas = []
    for eid, nombre, otro_nombre, otro_id in excl['existe_por_nombre']:
        filas.append({
            'erp_id': str(eid), 'name': nombre.strip(), 'motivo': 'nombre_repetido',
            'detalle': f'Ya existe «{otro_nombre}» (ficha #{otro_id}) con este mismo nombre.',
            'datos': campos.get(str(eid)),
        })
    for clave, motivo, etq in (('dui_repetido', 'dui_repetido', 'DUI'),
                               ('nit_repetido', 'nit_repetido', 'NIT')):
        for eid, nombre, valor in excl[clave]:
            filas.append({
                'erp_id': str(eid), 'name': nombre.strip(), 'motivo': motivo,
                'detalle': f'Su {etq} {valor} ya es de otra ficha.',
                'datos': campos.get(str(eid)),
            })

    # Los rechazos por nombre duplicado. Van con el mismo motivo que las de
    # arriba —para la persona es el mismo problema— pero el detalle dice que la
    # ficha SÍ existe y que el duplicado está en el origen.
    ruta = f'{D}/ambiguos.json'
    if os.path.exists(ruta):
        vistos = {f['erp_id'] for f in filas}
        for a in json.load(open(ruta)):
            eid = str(a.get('erp_id') or '')
            if not eid or eid in vistos:
                continue
            filas.append({
                'erp_id': eid, 'name': (a.get('name') or '').strip(),
                'motivo': 'nombre_repetido',
                'detalle': 'Hay dos fichas con este mismo nombre y no se puede '
                           'saber cuál corresponde: hay que unificarlas.',
                'datos': campos.get(eid),
            })
    return filas


def aplicar(url, cab, filas):
    n = 0
    c = dict(cab, **{'Content-Type': 'application/json'})
    for i in range(0, len(filas), POR_LOTE):
        cuerpo = json.dumps({'p_filas': filas[i:i + POR_LOTE]}).encode()
        req = urllib.request.Request(f'{url}/rest/v1/rpc/upsert_clientes_por_revisar',
                                     data=cuerpo, headers=c, method='POST')
        with urllib.request.urlopen(req, timeout=120) as r:
            n += int(json.load(r) or 0)
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--aplicar', action='store_true')
    a = ap.parse_args()

    _, catalogo = bloque.indice_erp()
    campos = cf.datos_del_erp()
    url, cab = verificar.portal()
    portal = cf.del_portal(url, cab)
    _, excl = cf.planificar(catalogo, campos, portal)

    filas = congelados(catalogo, campos) + repetidos(excl, catalogo, campos)
    por_motivo = collections.Counter(f['motivo'] for f in filas)
    con_ficha = {str(f['erp_id']) for f in portal if f.get('erp_id')}

    print(f'a publicar: {len(filas)}')
    for m, n in por_motivo.most_common():
        enportal = sum(1 for f in filas if f['motivo'] == m and f['erp_id'] in con_ficha)
        print(f'  {n:>4}  {m:<18} con ficha en el portal: {enportal}')
    sin_datos = sum(1 for f in filas if not f['datos'])
    if sin_datos:
        print(f'  ojo: {sin_datos} sin snapshot de datos (no estaban en portal_pendiente.jsonl)')

    if not a.aplicar:
        print('\n(SIMULACIÓN — no se escribió nada. Agregá --aplicar.)')
        return
    print(f'\nescritas/actualizadas: {aplicar(url, cab, filas)}')


if __name__ == '__main__':
    main()
