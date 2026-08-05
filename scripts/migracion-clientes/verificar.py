"""Informe del estado de las fichas: altas, bajas, renombres, calidad — y un
modo profundo que compara el ERP contra el portal ficha por ficha.

Existe porque el barrido del catálogo TERMINÓ el 2026-08-05 y el trabajo cambió
de forma: ya no es recorrer 27,701 fichas, es enterarse de lo que se mueve. Y lo
que se mueve tiene tres costos muy distintos, así que conviene no mezclarlos:

  · altas, bajas y cambios de NOMBRE ... 1 request al ERP, segundos
  · calidad de los datos del portal .... 0 requests al ERP, sale de la base
  · cambios de CUALQUIER otro campo .... 1 request POR FICHA: 27,701 = ~18 h

La tercera es cara y no hay atajo: el ERP no tiene ningún listado en bulk. El
catálogo (`reporte_clientes.php`) devuelve SOLO `<option value="id">NOMBRE`, y
`procesos/clientes.php` es el endpoint de ESCRITURA. El único lugar donde vive
el distrito de una ficha es su propia página de edición. Por eso el modo
profundo va por tandas rotativas y guarda dónde quedó: `--profundo 500` barre el
catálogo entero en ~8 semanas a ~20 min por día, en vez de pedir una jornada.

Qué detecta cada capa, dicho al revés (lo que NO detecta importa más):

  · lo barato NO ve un distrito, un DUI ni una dirección que cambió. El catálogo
    no los trae. Ve el nombre porque el catálogo ES el nombre.
  · lo profundo sí, pero solo de las fichas de la tanda.
  · ninguna de las dos ve una edición hecha EN EL PORTAL: esa viaja sola al ERP
    (`push-cliente-erp` + el cron `drain-cliente-erp-queue` cada 10 min).

    python3 verificar.py                  # lo barato
    python3 verificar.py --sin-refrescar  # sin bajar el catálogo (usa el volcado local)
    python3 verificar.py --profundo 500   # + relee 500 fichas y las compara con el portal
    python3 verificar.py --profundo 500 --desde 0   # reinicia la rotación

NO ESCRIBE NADA. Ni al ERP ni al portal ni al checkpoint. Es un informe; lo que
haya que corregir se corrige con `bloque.py` o desde el portal.
"""
import argparse
import collections
import datetime
import json
import os
import sys
import time
import urllib.parse
import urllib.request

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque          # noqa: E402
import aplicar_espejo  # noqa: E402

ROTACION = f'{D}/verificar_rotacion.json'
SNAPSHOT = f'{D}/catalogo_snapshot.json'

# ── Por qué los renombres NO se detectan contra el checkpoint ────────────────
# Era lo primero que probé y marcó las 27,701 fichas como renombradas. El
# catálogo envuelve cada nombre en espacios porque así arma el `<option>`
# (`' JOSE RUTILIO ALEMAN VASQUEZ '`), y el checkpoint guarda el value crudo del
# formulario de edición (`'JOSE RUTILIO ALEMAN VASQUEZ'`). Son dos
# RENDERIZADOS del mismo dato, no dos versiones.
#
# Y `strip()` no arregla nada: el README documenta que los nombres se guardan
# crudos justamente porque hay fichas cuya ÚNICA diferencia es un espacio al
# inicio (21807 ' NURIA…' vs 21776 'NURIA…'), y el control de duplicados del ERP
# las considera clientes distintos. Recortar borraría el caso real.
#
# Así que el renombre se detecta comparando el catálogo contra el catálogo de la
# corrida anterior: misma fuente, mismo formato, toda diferencia es real.

# Las columnas del portal que salen de una ficha del ERP. Se derivan de los
# mapas de `bloque` en vez de repetirse acá: el día que el bloque espeje un
# campo nuevo, este informe lo compara solo.
COLUMNAS = (tuple(bloque.CAMPO_A_COLUMNA.values())
            + tuple(bloque.SELECT_A_COLUMNA.values())
            + ('retencion_pct',))

# `in.(...)` viaja en la URL, así que la tanda se parte por LARGO, no por el cap
# de 1000 filas de PostgREST: 1000 ids son ~7 kB de query string y algunos
# proxies la cortan sin avisar. 200 deja margen de sobra.
POR_CONSULTA = 200


def refrescar_catalogo():
    """Baja `rep_cli.html`. Un request. Es lo mismo que hace
    `refrescar_catalogo.py`; acá va inline para que el informe sea un comando."""
    h = bloque.pedir(f'{bloque.BASE}/reporte_clientes.php')
    if 'password' in h.lower()[:4000]:
        raise SystemExit('SESIÓN CAÍDA: refrescá la cookie en erp.env (ver README).')
    with open(f'{D}/rep_cli.html', 'w') as fh:
        fh.write(h)


def clasificar_cambio(antes, ahora):
    """Por qué difieren dos versiones del mismo nombre.

    Separar los grados importa: 'solo espacios' es casi siempre el control de
    duplicados del ERP (hay fichas cuya única diferencia es un espacio al
    inicio), y 'nombre distinto' es una persona que editó la ficha.
    """
    if antes.strip() == ahora.strip():
        return 'solo espacios'
    if antes.strip().upper() == ahora.strip().upper():
        return 'solo mayúsculas/minúsculas'
    if bloque.norm(antes) == bloque.norm(ahora):
        return 'solo acentos o puntuación'
    return 'nombre distinto'


def duplicados_conocidos():
    """Los erp_id que el ERP rechaza por duplicado. NUNCA se checkpointean, así
    que sin esta lista aparecerían como 'altas' para siempre."""
    ruta = f'{D}/ambiguos.json'
    if not os.path.exists(ruta):
        return set()
    return {str(a['erp_id']) for a in json.load(open(ruta))
            if a.get('duplicado') and a.get('erp_id')}


# ── El portal ────────────────────────────────────────────────────────────────
def portal():
    url, key, usuario, clave = aplicar_espejo.credenciales()
    jwt = aplicar_espejo.token(url, key, usuario, clave)
    return url, {'apikey': key, 'Authorization': f'Bearer {jwt}'}


def contar(url, cab, filtro):
    """Cuenta sin traer filas: `count=exact` + `Range: 0-0`, el total viene en
    la cabecera. Evita el cap de 1000 filas por completo."""
    c = dict(cab, **{'Prefer': 'count=exact', 'Range': '0-0'})
    req = urllib.request.Request(f'{url}/rest/v1/customers?select=id&{filtro}', headers=c)
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers.get('content-range', '/0').split('/')[-1])


def hace(horas):
    d = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=horas)
    return d.strftime('%Y-%m-%dT%H:%M:%SZ')


def calidad(url, cab):
    """Qué le falta al portal para poder facturar. Cero requests al ERP.

    `categoria=neq.Consumidor` NO incluye las de categoría nula, igual que el
    `<>` de SQL: son las filas que nunca se espejaron y no tiene sentido
    exigirles NIT.
    """
    return {
        'total':          contar(url, cab, 'id=gt.0'),
        'con_erp':        contar(url, cab, 'erp_id=not.is.null'),
        'sin_distrito':   contar(url, cab, 'distrito=is.null'),
        'fiscal_sin_nit': contar(url, cab, 'categoria=neq.Consumidor&nit=is.null'),
        'fiscal_sin_nrc': contar(url, cab, 'categoria=neq.Consumidor&nrc=is.null'),
        'nuevos_24h':     contar(url, cab, f'created_at=gte.{hace(24)}'),
        'tocados_24h':    contar(url, cab, f'updated_at=gte.{hace(24)}'),
    }


def filas_portal(url, cab, erp_ids):
    """Las filas del portal de esos erp_id, partiendo por largo de URL."""
    filas = {}
    cols = ','.join(('erp_id', 'name') + COLUMNAS)
    for i in range(0, len(erp_ids), POR_CONSULTA):
        tanda = erp_ids[i:i + POR_CONSULTA]
        lista = ','.join(f'"{e}"' for e in tanda)
        q = urllib.parse.urlencode({'erp_id': f'in.({lista})', 'select': cols})
        req = urllib.request.Request(f'{url}/rest/v1/customers?{q}', headers=cab)
        with urllib.request.urlopen(req, timeout=120) as r:
            for f in json.load(r):
                filas[str(f['erp_id'])] = f
    return filas


# ── Las tres capas ───────────────────────────────────────────────────────────
def barato(nombres, ck):
    """Qué falta procesar. Sale de comparar el catálogo con el CHECKPOINT.

    Acá el checkpoint es la referencia correcta porque lo que se compara son
    CLAVES (qué ids conoce cada uno), no nombres. Los nombres se comparan en
    `renombres()`, contra el catálogo anterior — ver la nota de arriba.
    """
    dup = duplicados_conocidos()
    en_erp, en_ck = set(nombres), set(ck)

    altas = sorted(en_erp - en_ck - dup, key=int)
    bloqueadas = sorted((en_erp - en_ck) & dup, key=int)
    bajas = sorted(en_ck - en_erp, key=int)
    viejas = sorted((e for e in en_erp & en_ck
                     if ck[e].get('reglas') != bloque.REGLAS), key=int)
    return altas, bloqueadas, bajas, viejas


def renombres(nombres):
    """Nombres que cambiaron desde la corrida anterior, y el nuevo snapshot.

    Devuelve `None` la primera vez: sin línea de base no hay nada que comparar,
    y decir "0 renombres" cuando en realidad no se miró sería justo el tipo de
    silencio que se lee como éxito.
    """
    previo = None
    if os.path.exists(SNAPSHOT):
        try:
            previo = json.load(open(SNAPSHOT))
        except ValueError:
            previo = None

    with open(SNAPSHOT, 'w') as fh:
        json.dump(nombres, fh, ensure_ascii=False)

    if previo is None:
        return None
    cambios = []
    for e in sorted(set(previo) & set(nombres), key=int):
        antes, ahora = previo[e], nombres[e]
        if antes != ahora:
            cambios.append((e, antes, ahora, clasificar_cambio(antes, ahora)))
    return cambios


def cargar_rotacion():
    if os.path.exists(ROTACION):
        return json.load(open(ROTACION)).get('pos', 0)
    return 0


def profundo(n, desde, pausa, nombres, url, cab):
    """Relee `n` fichas del ERP y las compara contra la fila del portal.

    Rota: arranca donde terminó la corrida anterior y da la vuelta al final del
    catálogo. Guarda la posición en `verificar_rotacion.json` — es el único
    archivo que este script escribe, y no es un dato de negocio.
    """
    ids = sorted(nombres, key=int)
    pos = cargar_rotacion() if desde is None else desde
    pos = pos % len(ids) if ids else 0
    tanda = [ids[(pos + i) % len(ids)] for i in range(min(n, len(ids)))]

    print(f'\n── PROFUNDO: releyendo {len(tanda)} fichas del ERP '
          f'(desde la posición {pos:,} de {len(ids):,}) ──')
    leidas, fallidas = {}, []
    for i, eid in enumerate(tanda, 1):
        try:
            campos, ops = bloque.leer_ficha(eid)
            leidas[eid] = bloque.fila_portal({}, eid, campos, ops)
        except SystemExit:
            raise
        except Exception as e:                      # una ficha rota no corta el barrido
            fallidas.append((eid, str(e)[:80]))
        if i % 50 == 0:
            print(f'   {i}/{len(tanda)}…', flush=True)
        time.sleep(pausa)

    del_portal = filas_portal(url, cab, list(leidas))
    difs, sin_fila = [], []
    for eid, fila in leidas.items():
        p = del_portal.get(eid)
        if not p:
            sin_fila.append(eid)
            continue
        for col in COLUMNAS:
            a = fila.get(col)
            b = p.get(col)
            a = a if col == 'retencion_pct' else (a or '').strip() or None
            b = b if col == 'retencion_pct' else (b or '').strip() or None
            if a != b:
                difs.append((eid, nombres[eid], col, a, b))

    nueva = (pos + len(tanda)) % len(ids) if ids else 0
    with open(ROTACION, 'w') as fh:
        json.dump({'pos': nueva, 'ts': hace(0)}, fh)
    return difs, sin_fila, fallidas, nueva


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--sin-refrescar', action='store_true',
                    help='no baja el catálogo; usa el rep_cli.html que haya')
    ap.add_argument('--profundo', type=int, metavar='N',
                    help='relee N fichas del ERP y las compara con el portal')
    ap.add_argument('--desde', type=int, default=None,
                    help='posición donde arrancar la rotación del modo profundo')
    ap.add_argument('--pausa', type=float, default=0.4,
                    help='segundos entre lecturas del ERP (default: el mismo '
                         '0.4 que usa bloque.py, para no subir el ritmo)')
    ap.add_argument('--listar', type=int, default=15,
                    help='cuántas filas mostrar de cada hallazgo')
    a = ap.parse_args()

    if not a.sin_refrescar:
        refrescar_catalogo()
    _, nombres = bloque.indice_erp()
    ck = bloque.cargar_checkpoint()
    tope = a.listar

    print(f'\ncatálogo del ERP   {len(nombres):>7,} fichas')
    print(f'checkpoint         {len(ck):>7,} fichas')

    altas, bloqueadas, bajas, viejas = barato(nombres, ck)
    renombradas = renombres(nombres)

    print('\n── BARATO (1 request al ERP) ──')
    print(f'  altas sin procesar        {len(altas):>5}')
    print(f'  bloqueadas por duplicado  {len(bloqueadas):>5}   (decisión abierta #3, no son trabajo)')
    print(f'  bajas del ERP             {len(bajas):>5}')
    print(f'  con reglas viejas         {len(viejas):>5}   (REGLAS={bloque.REGLAS})')
    if renombradas is None:
        print('  renombradas                   —   (primera corrida: se guardó la línea de base)')
    else:
        print(f'  renombradas               {len(renombradas):>5}   (contra el catálogo de la corrida anterior)')

    if altas:
        print(f'\n  ALTAS — las levanta un bloque (`bloque.py --desde-erp 500 --escribir --una-pasada`):')
        for e in altas[:tope]:
            print(f'    {e:>7}  {nombres[e].strip()[:60]}')
        if len(altas) > tope:
            print(f'    … y {len(altas) - tope} más')
    if bajas:
        print(f'\n  BAJAS — estaban en el checkpoint y ya no están en el ERP:')
        for e in bajas[:tope]:
            print(f'    {e:>7}  {(ck[e].get("name") or "")[:60]}')
        if len(bajas) > tope:
            print(f'    … y {len(bajas) - tope} más')
    if renombradas:
        porq = collections.Counter(r[3] for r in renombradas)
        print(f'\n  RENOMBRADAS — {" · ".join(f"{n} {q}" for q, n in porq.most_common())}:')
        for e, antes, ahora, q in renombradas[:tope]:
            print(f'    {e:>7}  {antes.strip()[:34]:<34} -> {ahora.strip()[:34]:<34} ({q})')
        if len(renombradas) > tope:
            print(f'    … y {len(renombradas) - tope} más')

    url, cab = portal()
    c = calidad(url, cab)
    print('\n── CALIDAD DEL PORTAL (0 requests al ERP) ──')
    print(f'  clientes                  {c["total"]:>7,}')
    print(f'  con id del origen         {c["con_erp"]:>7,}')
    print(f'  sin distrito              {c["sin_distrito"]:>7,}   ← no se pueden facturar bajo DTE 2.0')
    print(f'  fiscales sin NIT          {c["fiscal_sin_nit"]:>7,}')
    print(f'  fiscales sin NRC          {c["fiscal_sin_nrc"]:>7,}')
    print(f'  creados en 24 h           {c["nuevos_24h"]:>7,}')
    print(f'  modificados en 24 h       {c["tocados_24h"]:>7,}')

    if a.profundo:
        difs, sin_fila, fallidas, nueva = profundo(
            a.profundo, a.desde, a.pausa, nombres, url, cab)
        print(f'\n  diferencias ERP vs portal {len(difs):>5}')
        print(f'  sin fila en el portal     {len(sin_fila):>5}')
        print(f'  no se pudieron leer       {len(fallidas):>5}')
        if difs:
            porcampo = collections.Counter(d[2] for d in difs)
            print(f'\n  POR CAMPO: {" · ".join(f"{n} {c_}" for c_, n in porcampo.most_common())}')
            print('  (ojo: una edición hecha en el PORTAL que todavía no drenó al ERP '
                  'aparece acá\n   como diferencia y no lo es — el cron corre cada 10 min)')
            for e, nom, col, en_erp, en_portal in difs[:tope]:
                print(f'    {e:>7}  {nom.strip()[:26]:<26} {col:<14} '
                      f'ERP={str(en_erp)[:20]!r:<22} portal={str(en_portal)[:20]!r}')
            if len(difs) > tope:
                print(f'    … y {len(difs) - tope} más')
        if fallidas:
            for e, err in fallidas[:5]:
                print(f'    no leída {e}: {err}')
        print(f'\n  la próxima tanda arranca en la posición {nueva:,}')

    print()


if __name__ == '__main__':
    main()
