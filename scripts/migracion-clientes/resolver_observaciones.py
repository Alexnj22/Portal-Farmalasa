"""El bucle que cierra el lazo entre Hacienda y la ficha del cliente.

Los siete pasos, acordados el 2026-08-06:

  1. validar las anuladas y las pendientes de MH   → `regularizar-dte`
  2. guardar las que quedan con observación        → `dte_mh_intentos`
  3. si la observación es conocida, sacar el erp_id del cliente
  4. leer su ficha en el ERP y corregir lo que falte → `bloque.py`
  5. espejar al portal                             → `aplicar_espejo_erp`
  6. lo mismo con las demás pendientes
  7. volver al 1

NO reimplementa nada. Cada paso llama a la pieza que ya existe y está probada:
`bloque.py` lleva 27,701 fichas en su checkpoint, y ese número ES su validación
— tres de las seis reglas de `elegir_distrito` se descubrieron midiendo esas
corridas, así que una segunda implementación "equivalente" no lo sería.

Por el mismo motivo el alcance sale de `clientes_sin_distrito_corregibles()` y
no de un filtro escrito acá: el criterio de qué ficha se puede tocar
(Consumidor o huérfana, nunca mostrador, nunca contribuyente) vive UNA vez, del
lado del servidor.

── Las tres condiciones que hacen que el bucle termine ─────────────────────
1. OBSERVACIÓN NO ES RECHAZO. Si vino con sello, la factura YA entró a Hacienda
   y no se reintenta. Solo se reprocesa lo rechazado. Sin esta distinción el
   bucle reenviaría documentos que ya están adentro.
2. SOLO SE VUELVE AL 1 SI EL PASO 4 CORRIGIÓ ALGO. Un reintento sin cambios da
   el mismo rechazo para siempre.
3. `fecEmi` NUNCA se corrige. Aparece cuando se transmite hoy una factura
   emitida antes —o sea en todo el atraso— y "arreglarla" sería alterar un dato
   fiscal. Se guarda como informativa y no dispara nada.

── Modos ───────────────────────────────────────────────────────────────────
    python3 resolver_observaciones.py --backlog       # preventivo: fichas sin
                                                      # distrito, antes de que
                                                      # Hacienda las rechace
    python3 resolver_observaciones.py                 # reactivo: el bucle 1-7
    ... --escribir                                    # sin esto, SIMULA
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque                                                    # noqa: E402,F401
from aplicar_espejo import (aplicar_lote, credenciales,          # noqa: E402
                            pedir_json, token)


def rest(url, cab, ruta):
    """GET a PostgREST. Devuelve la lista de filas."""
    req = urllib.request.Request(f'{url}/rest/v1/{ruta}', headers=cab)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def candidatos_backlog(url, cab):
    """Las fichas corregibles, según el criterio que vive en la base.

    Devuelve también dirección/departamento/municipio: no los usa el bucle
    —`bloque.py` relee la ficha del ERP, que es la fuente— pero sirven para
    entender el reporte sin abrir el ERP.
    """
    return pedir_json(f'{url}/rest/v1/rpc/clientes_sin_distrito_corregibles',
                      {}, cab)


def refrescar_catalogo():
    """Vuelve a bajar `rep_cli.html` antes de emparejar.

    NO es opcional en la corrida diaria. El volcado envejece y el ERP crea
    fichas todos los días: medido el 2026-08-06, el snapshot era del 5-ago con
    27,569 fichas y el ERP ya iba en 27,741. Con el índice viejo, 113 de 130
    dieron "sin match en el ERP"; refrescándolo bajaron a 84. O sea que 29 de
    esos "sin match" no eran un problema de datos — era el índice.
    """
    print('refrescando el índice del ERP…')
    r = subprocess.run([sys.executable, f'{D}/refrescar_catalogo.py'],
                       cwd=D, capture_output=True, text=True)
    print('  ' + (r.stdout.strip().splitlines() or ['(sin salida)'])[-1])
    if r.returncode:
        raise SystemExit(f'no se pudo refrescar el catálogo:\n{r.stderr[:400]}')


def facturas_de(url, cab, ids):
    """customer_id -> un erp_invoice_id suyo. En lotes, por el largo de la URL."""
    mapa = {}
    for i in range(0, len(ids), 100):
        trozo = ','.join(str(x) for x in ids[i:i + 100])
        for f in rest(url, cab,
                      f'sales_invoices?customer_id=in.({trozo})'
                      '&select=customer_id,erp_invoice_id'
                      '&erp_invoice_id=not.is.null&order=fecha.desc&limit=2000'):
            mapa.setdefault(f['customer_id'], f['erp_invoice_id'])
    return mapa


def erp_id_por_factura(erp_invoice_id):
    """El id_cliente que el ERP tiene asociado a esa factura.

    Es el emparejamiento que NO depende del nombre, y por eso alcanza lo que el
    índice no: las huérfanas se crearon con el nombre tal como se escribió en
    la factura —con espacios de más, encoding roto o typos— y ese texto no
    coincide con la ficha maestra del ERP. La factura, en cambio, apunta al id
    exacto. Mismo parseo que `aplicar-solicitud-facturacion`.
    """
    html_ = bloque.pedir(
        f'{bloque.BASE}/reimprimir_factura.php?id_factura={erp_invoice_id}')
    m = re.search(r'id="id_cliente"[\s\S]*?<option value=\'(\d+)\'\s+selected>',
                  html_)
    return m.group(1) if m else None


def correr_bloque(clientes, escribir):
    """Delega en bloque.py por su CLI. Sin --escribir, simula.

    Por subprocess y no por import: `bloque.main()` lee argv, mantiene estado
    global (checkpoint, revisiones, ambiguos) y vuelca archivos al terminar.
    Invocarlo como lo invoca una persona es lo que ya está probado.
    """
    entrada = f'{D}/entrada_observaciones.json'
    with open(entrada, 'w') as fh:
        json.dump(clientes, fh, ensure_ascii=False, indent=1)
    cmd = [sys.executable, f'{D}/bloque.py', '--entrada', entrada]
    if escribir:
        cmd += ['--escribir', '--una-pasada']
    print(f'\n$ {" ".join(os.path.basename(c) for c in cmd[1:3])} '
          f'{" ".join(cmd[3:])}\n')
    return subprocess.run(cmd, cwd=D).returncode


def emparejar(url, cab, clientes, verbose=True):
    """Le pone `_erp` a cada ficha que se pueda, leyendo UNA factura suya.

    Solo para las que no traen erp_id. Las que ya lo tienen se pasan tal cual y
    `bloque.py` no necesita adivinar; las que no emparejan por acá caen en su
    índice por nombre, que es el camino de siempre.
    """
    huerfanas = [c for c in clientes if not c.get('erp_id')]
    if not huerfanas:
        return clientes, 0
    facturas = facturas_de(url, cab, [c['id'] for c in huerfanas])
    resueltos = 0
    for c in huerfanas:
        fac = facturas.get(c['id'])
        if not fac:
            continue                       # ficha sin ninguna factura: nada que leer
        try:
            eid = erp_id_por_factura(fac)
        except Exception as e:             # el ERP se cae solo a veces
            if verbose:
                print(f'  · {c["name"][:40]}: {e!r}')
            continue
        if eid:
            c['erp_id'] = eid
            resueltos += 1
    return clientes, resueltos


def fichas_nuevas_del_erp(nuevas, escribir):
    """Las fichas del ERP que la migración todavía no tocó.

    ES EL ÚNICO PASO CON RIESGO FISCAL, y por eso va primero.
    El ERP crea fichas todos los días (~22 medidas el 2026-08-06) y una ficha
    sin distrito NO puede facturar: DTE 2.0 lo exige en el receptor. Nelson
    Ponce Cruz (27718) y Blanca Franco (27722) eran exactamente eso, y las dos
    las rechazó Hacienda.

    `--desde-erp` toma las que el checkpoint no tenga con las reglas actuales,
    en orden de id, así que el goteo diario entra solo.
    """
    cmd = [sys.executable, f'{D}/bloque.py', '--desde-erp', str(nuevas)]
    if escribir:
        cmd += ['--escribir', '--una-pasada']
    print(f'\n── fichas nuevas del ERP (hasta {nuevas}) ──')
    return subprocess.run(cmd, cwd=D).returncode


def espejar(url, cab, clientes, escribir):
    """Copia al portal la ficha que el ERP ya tiene.

    Hace falta un paso aparte porque `bloque.py` saltea por checkpoint todo lo
    que ya procesó, y esas fichas son justo el caso: el ERP las tiene completas
    desde la migración, pero el portal nunca las recibió porque no estaban
    emparejadas. Verificado el 2026-08-06 sobre cuatro (19624, 12793, 11967,
    18859): las cuatro con distrito y teléfono en el ERP, las cuatro sin
    distrito en el portal.

    O sea que para estas NO se escribe en el ERP: solo se copia.
    """
    conerp = [c for c in clientes if c.get('erp_id')]
    if not conerp:
        return {}
    print(f'\n── espejo al portal: {len(conerp)} fichas ──')
    filas = []
    for c in conerp:
        try:
            campos, ops = bloque.leer_ficha(c['erp_id'])
        except Exception as e:
            print(f'  · {c["name"][:40]}: {e!r}')
            continue
        fila = bloque.fila_portal({'id': f"portal:{c['id']}"}, c['erp_id'],
                                  campos, ops)
        filas.append(fila)
        if escribir:
            bloque.anotar_portal(fila)      # durable antes de mandarlo
    if not escribir:
        con_distrito = sum(1 for f in filas if f.get('distrito'))
        print(f'  {len(filas)} leídas · {con_distrito} traen distrito · '
              f'{len(filas) - con_distrito} siguen sin distrito en el ERP')
        return {}
    # `aplicar_lote` y NO un POST directo: el RPC hace un UPDATE masivo, así que
    # una violación de constraint en UNA fila aborta la sentencia y con ella el
    # lote entero. Partiendo a la mitad aísla la culpable en ~log2(n) llamadas.
    # Lo aprendí reintroduciendo el bug: la primera versión de esta función
    # llamaba a `pedir_json` derecho y murió con
    #   409 duplicate key ... customers_nit_idx  (nit 0614-031253-002-1)
    # que es EXACTAMENTE el incidente del 2026-08-02 que motivó `aplicar_lote`.
    total = {'recibidas': 0, 'actualizadas': 0, 'sin_cambio': 0,
             'sin_match': 0, 'conflictos': 0, 'campos_protegidos': 0,
             'duplicadas_omitidas': 0, 'entradas_descartadas': 0}
    rechazadas = []
    for i in range(0, len(filas), 250):
        aplicar_lote(url, filas[i:i + 250], cab, total, rechazadas)
    print('  ' + ' · '.join(f'{k}={v}' for k, v in total.items() if v))
    if rechazadas:
        print(f'  {len(rechazadas)} fichas rechazadas por la base:')
        for fila, motivo in rechazadas[:10]:
            print(f'    · erp {fila.get("erp_id")} {fila.get("match_name","")[:34]}: '
                  f'{motivo[:90]}')
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--diario', action='store_true',
                    help='la corrida de una vez al día: refresca el índice del '
                         'ERP, empareja las fichas nuevas por factura, corrige '
                         'y espeja al portal')
    ap.add_argument('--backlog', action='store_true',
                    help='igual que --diario pero sin refrescar ni emparejar: '
                         'solo lo que el índice actual ya alcanza')
    ap.add_argument('--nuevas', type=int, default=200,
                    help='tope de fichas nuevas del ERP por corrida (0 = saltar '
                         'ese paso). El goteo medido es ~22/día.')
    ap.add_argument('--escribir', action='store_true')
    ap.add_argument('--limite', type=int, default=0, help='0 = todas')
    a = ap.parse_args()

    if not (a.diario or a.backlog):
        raise SystemExit(
            'El bucle reactivo (pasos 1-7) todavía no está conectado: falta que\n'
            '`regularizar-dte` escriba en `dte_mh_intentos`.\n'
            'Por ahora: --diario (recomendado) o --backlog.')

    url, key, usuario, clave = credenciales()
    jwt = token(url, key, usuario, clave)
    cab = {'apikey': key, 'Authorization': f'Bearer {jwt}',
           'Content-Type': 'application/json'}

    if not a.escribir:
        print('MODO SIMULACIÓN — no se escribe en el ERP ni en el portal\n')

    # ── Paso 0: el índice, sin el cual todo lo demás mira datos viejos ──
    if a.diario:
        refrescar_catalogo()

    # ── Paso 1: las fichas nuevas del ERP. El único con riesgo fiscal ──
    if a.diario and a.nuevas:
        fichas_nuevas_del_erp(a.nuevas, a.escribir)

    # ── Paso 2: las huérfanas del portal. Consistencia, no riesgo ──
    clientes = candidatos_backlog(url, cab)
    if a.limite:
        clientes = clientes[:a.limite]

    sin_erp = sum(1 for c in clientes if not c.get('erp_id'))
    print(f'\n── huérfanas del portal: {len(clientes)} fichas sin distrito '
          f'({sin_erp} sin erp_id) ──')
    print('  alcance: clientes_sin_distrito_corregibles() — se saltan '
          'Contribuyente, Gran Contribuyente, Extranjero y mostrador')

    if a.diario and sin_erp:
        print(f'  emparejando {sin_erp} por su factura en el ERP…')
        clientes, emparejadas = emparejar(url, cab, clientes)
        print(f'  {emparejadas} resueltas por id de factura, '
              f'{sin_erp - emparejadas} quedan para el índice por nombre')

    # `_erp` explícito gana sobre el índice por nombre (bloque.py lo respeta).
    correr_bloque([{'id': f"portal:{c['id']}", 'name': c['name'],
                    **({'_erp': c['erp_id']} if c.get('erp_id') else {})}
                   for c in clientes], a.escribir)

    # ── Paso 3: copiar al portal lo que el ERP ya tiene ──
    # Va DESPUÉS de bloque.py para que incluya lo recién corregido, y alcanza
    # también a las que bloque.py salteó por checkpoint — que son la mayoría.
    espejar(url, cab, clientes, a.escribir)
    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
