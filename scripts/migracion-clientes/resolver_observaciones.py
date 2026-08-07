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


def parecidos(a, b):
    """¿Los dos nombres son la misma persona escrita distinto?

    No es un juicio de identidad — eso lo afirma el `erp_id`. Es un freno: si
    los nombres no se parecen en nada, el vínculo del ERP puede venir de una
    factura emitida al cliente equivocado, y fusionar mezclaría dos historiales
    sin vuelta atrás.

    Criterio: cada token de ≥4 letras del nombre más corto tiene que estar en
    el otro, exacto o a un carácter de distancia (VAQUEZ/VASQUEZ,
    ALVARNEGA/ALVARENGA). Se compara sobre el nombre normalizado, así que el
    mojibake `PEÃ±A` no cuenta como token distinto de `PEÑA` — se rompe en
    piezas cortas que el filtro de ≥4 descarta, y el resto (JOSE RAFAEL PINEDA)
    decide.
    """
    ta = [t for t in bloque.norm(a).split() if len(t) >= 4]
    tb = [t for t in bloque.norm(b).split() if len(t) >= 4]
    if not ta or not tb:
        return False
    corto, largo = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    def cerca(t):
        return any(t == o or _a_un_caracter(t, o) for o in largo)
    coinciden = sum(1 for t in corto if cerca(t))
    return coinciden >= max(2, len(corto) - 1) or coinciden == len(corto)


def _a_un_caracter(x, y):
    """Distancia de edición ≤1, sin traer una librería para esto."""
    if abs(len(x) - len(y)) > 1:
        return False
    if len(x) == len(y):
        return sum(1 for i, j in zip(x, y) if i != j) == 1
    corto, largo = (x, y) if len(x) < len(y) else (y, x)
    for i in range(len(largo)):
        if largo[:i] + largo[i + 1:] == corto:
            return True
    return False


def deduplicar(url, cab, clientes, escribir):
    """Une cada ficha huérfana con la real y borra la huérfana.

    Una huérfana NO es un cliente nuevo: es una segunda ficha del mismo cliente,
    que `upsert_customers` creó desde el nombre tal como se escribió en una
    factura. La buena tiene los datos y ninguna factura; la rota tiene el
    historial y ningún dato:

        3197766  JOSE RAFAEL PEÑA PINEDA    erp 11967  COMALAPA   0 facturas
        1990     JOSE RAFAEL PEÃ±A PINEDA   —          —          7 facturas

    Se detecta sin adivinar: la factura de la huérfana apunta, EN EL ERP, a un
    `id_cliente`; si el portal ya tiene una ficha con ese `erp_id`, son la misma
    persona y lo afirma el ERP, no un parecido de nombres.

    Si NO hay ficha con ese erp_id, la huérfana no es duplicado — es un cliente
    que el portal todavía no tenía, y se resuelve espejando, no borrando.
    """
    huerfanas = [c for c in clientes if not c.get('erp_id')]
    if not huerfanas:
        print('\n── deduplicación: no hay huérfanas ──')
        return
    print(f'\n── deduplicación: {len(huerfanas)} huérfanas ──')

    # 1 · el erp_id que el ERP asocia a cada una, leyendo una factura suya
    huerfanas, resueltos = emparejar(url, cab, huerfanas, verbose=False)
    conerp = [c for c in huerfanas if c.get('erp_id')]
    print(f'  {resueltos} con erp_id resuelto por factura, '
          f'{len(huerfanas) - resueltos} sin factura que leer')

    # 2 · ¿ese erp_id ya pertenece a otra ficha del portal?
    ocupados = {}
    ids = sorted({c['erp_id'] for c in conerp})
    for i in range(0, len(ids), 100):
        lote = ','.join(f'"{x}"' for x in ids[i:i + 100])
        for f in rest(url, cab, f'customers?erp_id=in.({lote})&select=id,name,erp_id'):
            ocupados[f['erp_id']] = f

    candidatas = [c for c in conerp if c['erp_id'] in ocupados
                  and ocupados[c['erp_id']]['id'] != c['id']]
    nuevas = [c for c in conerp if c['erp_id'] not in ocupados]

    # Fusionar BORRA una ficha y mueve su historial. El vínculo lo afirma el
    # ERP, que es fuerte, pero no infalible: si en el ERP se facturó al cliente
    # equivocado, fusionar mezcla el historial de dos personas y eso no se
    # deshace. Así que los nombres muy distintos se apartan para que los mire
    # alguien.
    #
    # Casos reales del 2026-08-06 que motivan el corte:
    #   "ABEL ENOC VAQUEZ"  → "ABEL ENOC VASQUEZ"    typo, evidente
    #   "IRENE PASTORA"     → "IRENE PINEDA"         ¿la misma persona?
    #   "NORMA … DE HERNANDEZ" → "NORMA … MEJIA"     ¿cambió de apellido?
    # Los dos últimos son plausibles —la ficha del ERP pudo renombrarse
    # DESPUÉS de emitida la factura— pero plausible no alcanza para borrar.
    claras, dudosas = [], []
    for c in candidatas:
        (claras if parecidos(c['name'], ocupados[c['erp_id']]['name'])
         else dudosas).append(c)

    print(f'  {len(candidatas)} son duplicados (el erp_id ya tiene ficha)')
    print(f'    · {len(claras)} con nombres claramente equivalentes → se fusionan')
    print(f'    · {len(dudosas)} con nombres muy distintos → NO se tocan, van a revisión')
    print(f'  {len(nuevas)} no tienen ficha con ese erp_id → se emparejan, no se borran')

    if dudosas:
        print('\n  a revisar a mano (no se fusionan):')
        for c in dudosas:
            d = ocupados[c['erp_id']]
            print(f'    ? "{c["name"][:36]}" (id {c["id"]}) '
                  f'→ "{d["name"][:36]}" (erp {c["erp_id"]})')
        # A la bandeja «Por revisar» del portal, no solo a la consola: un
        # hallazgo que vive en la salida de un script se pierde al cerrar la
        # terminal. El motivo cae solo en la familia "repetido" — la vista
        # deriva 'congelado' de `fiscal_congelado` y todo lo demás es repetido.
        if escribir:
            filas = []
            for c in dudosas:
                d = ocupados[c['erp_id']]
                filas.append({
                    'erp_id': c['erp_id'],
                    'name': c['name'],
                    'motivo': 'fusion_dudosa',
                    # Sin nombrar el sistema de origen: esto se ve en pantalla.
                    'detalle': (f'El número interno {c["erp_id"]} corresponde a '
                                f'«{d["name"]}», pero esta ficha se llama '
                                f'«{c["name"]}». Podrían ser dos personas '
                                f'distintas: no se unieron.'),
                    'datos': {'ficha_suelta_id': c['id'],
                              'ficha_suelta_nombre': c['name'],
                              'ficha_destino_id': d['id'],
                              'ficha_destino_nombre': d['name']},
                })
            try:
                n = pedir_json(f'{url}/rest/v1/rpc/upsert_clientes_por_revisar',
                               {'p_filas': filas}, cab)
                print(f'  → {len(filas)} publicadas en «Por revisar» ({n} nuevas o cambiadas)')
            except Exception as e:
                print(f'  ⚠️  no se pudieron publicar en «Por revisar»: {str(e)[:120]}')

    duplicadas = claras
    if not escribir:
        print('\n  se fusionarían:')
        for c in duplicadas[:8]:
            d = ocupados[c['erp_id']]
            print(f'    · "{c["name"][:34]}" (id {c["id"]}) → '
                  f'"{d["name"][:34]}" (id {d["id"]}, erp {c["erp_id"]})')
        if len(duplicadas) > 8:
            print(f'    … y {len(duplicadas) - 8} más')
        return

    movidas = fusionadas = 0
    fallos = []
    for c in duplicadas:
        try:
            r = pedir_json(f'{url}/rest/v1/rpc/fusionar_cliente_duplicado',
                           {'p_huerfana': c['id'], 'p_erp_id': c['erp_id']}, cab)
            fusionadas += 1
            movidas += r.get('facturas_movidas', 0)
        except Exception as e:
            fallos.append((c['name'], str(e)[:110]))
    print(f'  fusionadas: {fusionadas} · facturas movidas: {movidas}')
    for n, m in fallos[:10]:
        print(f'    ✗ {n[:38]}: {m}')
    if fallos:
        print(f'  {len(fallos)} fallaron')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--deduplicar', action='store_true',
                    help='une las fichas huérfanas con la real y borra la huérfana')
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

    if not (a.diario or a.backlog or a.deduplicar):
        raise SystemExit(
            'El bucle reactivo (pasos 1-7) todavía no está conectado: falta que\n'
            '`regularizar-dte` escriba en `dte_mh_intentos`.\n'
            'Por ahora: --deduplicar, --diario o --backlog.')

    url, key, usuario, clave = credenciales()
    jwt = token(url, key, usuario, clave)
    cab = {'apikey': key, 'Authorization': f'Bearer {jwt}',
           'Content-Type': 'application/json'}

    # La deduplicación va SOLA y primero: mientras haya huérfanas duplicadas,
    # el diario intenta emparejarlas todas las noches y la base las rechaza
    # (`erp_id already exists`) — 73 de 76 en la corrida del 2026-08-06. Un cron
    # que arranca fallando así tapa el fallo real cuando aparezca.
    if a.deduplicar:
        if not a.escribir:
            print('MODO SIMULACIÓN — no se borra ni se mueve nada\n')
        refrescar_catalogo()
        deduplicar(url, cab, candidatos_backlog(url, cab), a.escribir)
        return 0

    if not a.escribir:
        print('MODO SIMULACIÓN — no se escribe en el ERP ni en el portal\n')

    # ── Paso 0: el índice, sin el cual todo lo demás mira datos viejos ──
    if a.diario:
        refrescar_catalogo()

    # ── Paso 1: las fichas nuevas del ERP. El único con riesgo fiscal ──
    if a.diario and a.nuevas:
        fichas_nuevas_del_erp(a.nuevas, a.escribir)

    # ── Paso 2: limpiar las fichas sueltas que se colaron ──
    # Va ANTES de emparejar y espejar: una ficha suelta que en realidad es un
    # duplicado no se puede emparejar (su número ya tiene dueño) y la base la
    # rechaza. Fusionarla primero evita ese error y deja menos trabajo abajo.
    if a.diario:
        deduplicar(url, cab, candidatos_backlog(url, cab), a.escribir)

    # ── Paso 3: las huérfanas que quedan. Consistencia, no riesgo ──
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
