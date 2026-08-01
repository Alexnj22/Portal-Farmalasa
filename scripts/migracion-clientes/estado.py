"""Regenera el estado del README a partir de los datos vivos.

Existe porque el estado escrito a mano envejece SOLO. El 2026-08-01 el README
decía "1,085 fichas procesadas" cuando iban 2,073, y el prompt de retomada decía
585 — cuatro bloques atrás. Nadie lo notó porque un número viejo se lee igual que
uno correcto.

    python3 estado.py              # muestra el estado, no toca nada
    python3 estado.py --escribir   # reescribe el bloque del README

Reescribe SOLO lo que está entre los marcadores del README:

    <!-- ESTADO:INICIO -->  ...generado...  <!-- ESTADO:FIN -->

Todo lo demás del README es prosa escrita por una persona y no se toca. La
regla es: los NÚMEROS se generan, las DECISIONES se escriben.
"""
import argparse
import collections
import json
import os
import re
import sys
import urllib.request

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque          # noqa: E402
import aplicar_espejo  # noqa: E402

INICIO, FIN = '<!-- ESTADO:INICIO -->', '<!-- ESTADO:FIN -->'


def del_portal():
    """Cuántos clientes del portal ya traen datos del ERP. Devuelve None si no
    se puede consultar — el estado local sigue sirviendo sin la base."""
    try:
        url, key, usuario, clave = aplicar_espejo.credenciales()
        jwt = aplicar_espejo.token(url, key, usuario, clave)
        cab = {'apikey': key, 'Authorization': f'Bearer {jwt}',
               'Prefer': 'count=exact', 'Range': '0-0'}
        def contar(filtro):
            req = urllib.request.Request(f'{url}/rest/v1/customers?select=id&{filtro}',
                                         headers=cab)
            with urllib.request.urlopen(req, timeout=60) as r:
                return int(r.headers.get('content-range', '/0').split('/')[-1])
        return {'con_erp': contar('erp_id=not.is.null'),
                'con_distrito': contar('erp_id=not.is.null&distrito=not.is.null'),
                'total': contar('id=gt.0')}
    except Exception as e:
        print(f'  (no se pudo consultar el portal: {e})', file=sys.stderr)
        return None


def frente(ck):
    """Hasta dónde llegó la migración SECUENCIAL, y cuántas quedan sueltas.

    Se deduce del checkpoint y no de una lista escrita a mano: una lista a mano
    se desincroniza del registro, que es una lección ya aprendida acá.

    La distinción importa porque el primer bloque se armó desde el PORTAL, por
    nombre, así que dejó fichas dispersas por todo el catálogo. Listar los 35
    tramos resultantes es ruido; lo que se quiere saber es por dónde va el
    frente y cuánto hay fuera de él.
    """
    ids = sorted(int(k) for k in ck)
    if not ids:
        return 0, 0
    tope = ids[0]
    for i in ids:
        if i - tope > 200:            # hueco grande: se terminó el tramo corrido
            break
        tope = i
    return tope, sum(1 for i in ids if i > tope)


def generar():
    ck = bloque.cargar_checkpoint()
    _, nombres = bloque.indice_erp()
    pendientes = [e for e in nombres if ck.get(e, {}).get('reglas') != bloque.REGLAS]
    rev = json.load(open(f'{D}/revision_manual.json')) if os.path.exists(f'{D}/revision_manual.json') else []
    falt = json.load(open(f'{D}/faltantes_dte.json')) if os.path.exists(f'{D}/faltantes_dte.json') else {}
    fiscales = sum(1 for v in falt.values() if v.get('categoria') != 'Consumidor')
    portal = del_portal()

    ok = sum(1 for v in ck.values() if v.get('ok'))
    mal = sum(1 for v in ck.values() if v.get('ok') is False)
    tope, sueltas = frente(ck)

    L = []
    L.append('```')
    L.append(f'catálogo del ERP        {len(nombres):>6,} fichas')
    L.append(f'procesadas              {len(ck):>6,} fichas    (checkpoint.json)')
    if portal:
        L.append(f'portadas al portal      {portal["con_erp"]:>6,} de {portal["total"]:,}'
                 f'  (customers.erp_id no nulo)')
        L.append(f'  de ellas con distrito {portal["con_distrito"]:>6,}')
    L.append(f'pendientes              {len(pendientes):>6,}'
             f'          ({-(-len(pendientes) // 500)} bloques de 500)')
    L.append('```')
    L.append('')
    L.append(f'**Verificadas OK: {ok:,} · a revisar: {mal}.** El frente secuencial va '
             f'por `erp_id {tope:,}`; hay {sueltas:,} fichas ya hechas más adelante, '
             f'del primer bloque que se armó por nombre desde el portal.')
    L.append('')
    L.append(f'`revision_manual.json`: **{len(rev)} DUI** borrados con su número '
             f'original guardado (acumula entre bloques; si alguna vez baja, algo '
             f'se rompió).')
    L.append('')
    L.append(f'`faltantes_dte.json`: **{len(falt)} fichas** no se pueden facturar '
             f'todavía bajo DTE 2.0, {fiscales} de ellas fiscales.')
    if falt:
        porcampo = collections.Counter(c for v in falt.values() for c in v['faltan'])
        L.append('Les falta: ' + ' · '.join(f'{c} {n}' for c, n in porcampo.most_common()) + '.')
    L.append('')
    L.append('<sub>Generado por `python3 estado.py --escribir`. No editar a mano: '
             'los números se generan, las decisiones se escriben.</sub>')
    return '\n'.join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--escribir', action='store_true')
    a = ap.parse_args()

    texto = generar()
    print(texto)
    if not a.escribir:
        print('\n(no se escribió el README — agregá --escribir)', file=sys.stderr)
        return

    ruta = f'{D}/README.md'
    s = open(ruta).read()
    if INICIO not in s or FIN not in s:
        raise SystemExit(f'El README no tiene los marcadores {INICIO} / {FIN}.')
    nuevo = re.sub(f'{re.escape(INICIO)}.*?{re.escape(FIN)}',
                   f'{INICIO}\n{texto}\n{FIN}', s, flags=re.S)
    bloque.volcar_json  # (mismo módulo; acá se escribe texto, no json)
    with open(ruta, 'w') as fh:
        fh.write(nuevo)
    print('\nREADME actualizado.', file=sys.stderr)


if __name__ == '__main__':
    main()
