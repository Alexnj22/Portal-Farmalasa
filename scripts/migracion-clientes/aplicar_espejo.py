"""Aplica portal_pendiente.jsonl a `customers`, vía el RPC aplicar_espejo_erp.

`customers` no tiene policy de escritura: la única es `customers_select`. El RPC
(migración 20260801044543) es SECURITY DEFINER y está concedido a
`authenticated`, así que basta con loguearse como un usuario cualquiera del
portal — no hace falta la service-role key.

Credenciales en el `.env` del repo: `portal-user` / `portal-password`
(o `E2E_USER` / `E2E_PASSWORD` como alternativa).

    python3 aplicar_espejo.py            # muestra qué haría
    python3 aplicar_espejo.py --aplicar  # lo aplica
"""
import json
import os
import sys
import urllib.error
import urllib.request

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque  # noqa: E402  (reusa el lector de .env)

APLICAR = '--aplicar' in sys.argv
LOTE = 250          # filas por llamada


def credenciales():
    env = bloque._entorno()
    url = env.get('VITE_SUPABASE_URL')
    key = env.get('VITE_SUPABASE_ANON_KEY')
    usuario = env.get('portal-user') or env.get('E2E_USER')
    clave = env.get('portal-password') or env.get('E2E_PASSWORD')
    faltan = [n for n, v in (('VITE_SUPABASE_URL', url), ('VITE_SUPABASE_ANON_KEY', key),
                             ('portal-user', usuario), ('portal-password', clave)) if not v]
    if faltan:
        raise SystemExit(f'faltan en .env: {", ".join(faltan)}')
    # El portal arma el correo de Supabase como `usuario@farmalasa.app`
    # (AuthContext.jsx). En .env se guarda el usuario pelado, así que se completa.
    if '@' not in usuario:
        usuario = f'{usuario.strip().lower()}@farmalasa.app'
    return url.rstrip('/'), key, usuario, clave


def pedir_json(url, cuerpo, cabeceras):
    datos = json.dumps(cuerpo).encode()
    req = urllib.request.Request(url, data=datos, headers=cabeceras, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{url}\n  HTTP {e.code}: {e.read().decode()[:400]}')


def token(url, key, usuario, clave):
    r = pedir_json(f'{url}/auth/v1/token?grant_type=password',
                   {'email': usuario, 'password': clave},
                   {'apikey': key, 'Content-Type': 'application/json'})
    if not r.get('access_token'):
        raise SystemExit(f'login al portal falló: {r}')
    return r['access_token']


# ── Payload ──────────────────────────────────────────────────────────────────
filas = [json.loads(l) for l in open(f'{D}/portal_pendiente.jsonl')]
# Solo las que traen la llave de emparejamiento; las viejas ya se aplicaron por id.
# Y de cada ficha del ERP, su última versión: el archivo es append-only.
por_erp = {}
for f in filas:
    if 'match_name' in f:
        por_erp[f['erp_id']] = f

# Dos fichas del ERP pueden normalizar al MISMO nombre, y `customers` tiene una
# fila por cliente: no hay a dónde mandar las dos. El RPC las omite, pero lo
# hace en silencio del lado del servidor — así que el corte se hace acá, donde
# se puede decir cuáles y por qué.
#
# `duplicados_resueltos.json` (lo produce revisar_duplicados.py) dice qué
# `erp_id` gana para cada nombre. Sin resolución, el par no se manda: mandar
# cualquiera de los dos sería elegir a dedo qué datos ve el portal.
RESUELTOS = f'{D}/duplicados_resueltos.json'
resueltos = json.load(open(RESUELTOS)) if os.path.exists(RESUELTOS) else {}

por_nombre = {}
for f in por_erp.values():
    por_nombre.setdefault(f['match_name'], []).append(f)

elegidas, sin_resolver = [], []
for nombre, grupo in por_nombre.items():
    if len(grupo) == 1:
        elegidas.append(grupo[0])
        continue
    gana = resueltos.get(nombre)
    ganadora = next((f for f in grupo if str(f['erp_id']) == str(gana)), None)
    if ganadora:
        elegidas.append(ganadora)
    else:
        sin_resolver.append((nombre, [f['erp_id'] for f in grupo]))

pendientes = [{k: v for k, v in f.items() if v is not None and k != 'id'}
              for f in elegidas]

print(f'{len(filas)} líneas en la cola · {len(pendientes)} fichas a espejar')
if sin_resolver:
    print(f'\n{len(sin_resolver)} nombre(s) con más de una ficha en el ERP y sin '
          f'resolver — no se mandan:')
    for nombre, ids in sin_resolver:
        print(f'   {nombre[:52]:<54} {ids}')
    print('   corré `python3 revisar_duplicados.py` para decidir cuál gana.')
if not APLICAR:
    print('\n(simulación — nada se aplicó; agregá --aplicar)')
    raise SystemExit

url, key, usuario, clave = credenciales()
jwt = token(url, key, usuario, clave)
print(f'autenticado como {usuario}\n')

cab = {'apikey': key, 'Authorization': f'Bearer {jwt}',
       'Content-Type': 'application/json'}
total = {'recibidas': 0, 'actualizadas': 0, 'sin_match': 0, 'duplicadas_omitidas': 0}
for i in range(0, len(pendientes), LOTE):
    lote = pendientes[i:i + LOTE]
    r = pedir_json(f'{url}/rest/v1/rpc/aplicar_espejo_erp', {'p_filas': lote}, cab)
    print(f'  lote {i // LOTE + 1}: {r}')
    for k in total:
        total[k] += r.get(k, 0)

print(f'\nTOTAL: {total}')
if total['sin_match']:
    print(f"  ojo: {total['sin_match']} fichas del ERP no existen en el portal "
          f"(no se crean, solo se reportan)")
