"""Arnés offline: ejercita bloque.py entero sin tocar el ERP.

El ERP falso es DELIBERADAMENTE hostil: aplica el POST con la semántica del
incidente 6317 — la ficha queda con EXACTAMENTE los campos enviados, y todo lo
que no se mandó se vacía. Si el payload está incompleto, el arnés lo grita.

Las fichas son reales: salen de bloque_plan.json (18 fichas leídas del ERP el
2026-07-31) y las opciones de los selects salen de cli6317.html.
"""
import copy, html as H, json, os, re, shutil, sys, tempfile

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque  # noqa: E402

# El arnés no debe escribir NADA en el scratchpad real. bloque.main() escribe
# bloque_plan.json / bloque_resultado.json / ambiguos.json / checkpoint.json
# relativos a su D — y en la primera versión de este arnés se comió su propio
# archivo de fixtures. Se lo mandamos a un directorio temporal, con enlaces a
# los dos insumos que sí necesita leer del real.
TMP = tempfile.mkdtemp(prefix='bloque_test_')
for insumo in ('rep_cli.html', 'erp.env'):
    os.symlink(f'{D}/{insumo}', f'{TMP}/{insumo}')
bloque.D = TMP
bloque.CHECKPOINT = f'{TMP}/checkpoint.json'
JSONL = f'{TMP}/portal_pendiente.jsonl'

FALLOS = []


def check(nombre, cond, detalle=''):
    print(f'  {"✓" if cond else "✗"} {nombre}{"" if cond else "   <-- " + detalle}')
    if not cond:
        FALLOS.append(nombre)


# ── Fixtures reales ──────────────────────────────────────────────────────────
def cargar_ops():
    campos, ops = bloque.parsear_ficha(
        open(f'{D}/cli6317.html', encoding='utf-8', errors='replace').read())
    return ops


def cargar_fichas():
    # fixture_fichas.json: copia congelada de las 18 fichas leídas del ERP el
    # 2026-07-31. Nombre que bloque.py nunca escribe, a propósito.
    plan = json.load(open(f'{D}/fixture_fichas.json'))
    return [f for f in plan if f.get('campos') and str(f.get('erp_id', '')).isdigit()]


OPS = cargar_ops()
FICHAS = cargar_fichas()


# ── ERP falso ────────────────────────────────────────────────────────────────
class ErpFalso:
    def __init__(self, registros):
        self.reg = copy.deepcopy(registros)      # erp_id -> campos
        self.posts = []                          # payloads recibidos
        self.traza = []                          # ORDEN de las peticiones

    def render(self, campos):
        """Devuelve HTML equivalente al de la ficha, para que lo parsee el mismo
        parser que usa la corrida real."""
        partes = ['<html><body><form>']
        for k, v in campos.items():
            if k in OPS:
                continue
            partes.append(f'<input type="text" name="{k}" value="{H.escape(str(v))}">')
        for nombre, lista in OPS.items():
            partes.append(f'<select name="{nombre}">')
            partes.append('<option value="">-- elegir --</option>')
            actual = str(campos.get(nombre, ''))
            for v, t in lista:
                sel = ' selected' if v == actual and actual else ''
                partes.append(f'<option value="{v}"{sel}>{H.escape(t)}</option>')
            partes.append('</select>')
        partes.append('</form></body></html>')
        return ''.join(partes)

    def pedir(self, url, datos=None):
        if datos is None:
            eid = re.search(r'id_cliente=(-?\d+)', url).group(1)
            return self.render(self.reg[eid])
        self.posts.append(dict(datos))
        eid = str(datos['id_cliente'])
        # Semántica 6317: la ficha queda con lo enviado y NADA más.
        self.reg[eid] = {k: v for k, v in datos.items() if k not in bloque.NO_SON_CAMPOS}
        return '{"typeinfo":"Success","msg":"ok"}'


def montar(fichas):
    reg = {str(f['erp_id']): dict(f['campos']) for f in fichas}
    erp = ErpFalso(reg)
    bloque.pedir = erp.pedir
    return erp


def correr(fichas, escribir, extra=()):
    ent = f'{TMP}/_t_entrada.json'
    json.dump([{'id': f['id'], 'name': f['name'], 'sucursal': f.get('sucursal', 0)}
               for f in fichas], open(ent, 'w'), ensure_ascii=False)
    sys.argv = ['bloque.py', '--entrada', ent, '--pausa-lectura', '0',
                '--pausa-escritura', '0', '--pausa-reintento', '0',
                *extra] + (['--escribir'] if escribir else [])
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        bloque.main()
    return buf.getvalue()


# ═════════════════════════════════════════════════════════════════════════════
print('\n1. LAS TRES RAMAS QUE NUNCA SE EJECUTARON')
print('   (sobre fichas reales, verificando el payload campo por campo)\n')

crudos = [f for f in FICHAS if f['campos'].get('municipio') and f['campos'].get('telefono1')]
base = copy.deepcopy(crudos[0])
# Base LIMPIA: una ficha real, pero con las tres condiciones desactivadas, para
# poder inyectar una sola por vez y medir qué toca cada rama por separado. Sin
# esto la ficha real ya traía DUI inválido y distrito vacío, y las tres ramas
# se disparaban juntas — no se podía aislar ninguna.
base['campos']['dui'] = ''
base['campos']['distrito'] = OPS['distrito'][0][0]
base['campos']['nombre'] = base['campos']['nombre'].upper()
print(f'   ficha base: erp {base["erp_id"]} — {len(base["campos"])} campos reales '
      f'(normalizada para aislar cada rama)')
malos = [f for f in FICHAS if bloque.dui_valido(f['campos'].get('dui', '')) is False]
sin_dist = [f for f in FICHAS if f['campos'].get('municipio')
            and not f['campos'].get('distrito')]
print(f'   en las {len(FICHAS)} fichas reales de la muestra: '
      f'{len(malos)} con DUI inválido, {len(sin_dist)} sin distrito\n')

# ── rama A: teléfono vacío ───────────────────────────────────────────────────
c = dict(base['campos']); c['telefono1'] = ''
nuevos, cambios = bloque.planificar({'id': base['id']}, c, OPS)
dif = {k for k in set(c) | set(nuevos) if c.get(k) != nuevos.get(k)}
check('rama teléfono: se ejecuta con vacío', 'telefono1' in cambios, str(cambios))
check('rama teléfono: pone 23010013', nuevos['telefono1'] == '23010013')
check('rama teléfono: NO toca ningún otro campo', dif == {'telefono1'}, f'difieren {dif}')

# Regla nueva (2026-08-01): 8 dígitos o se reemplaza. Es la primera rama que
# PISA un dato existente, así que conviene fijarle los bordes con precisión.
for valor, debe_cambiar, motivo in (
        ('7538-5899', False, '8 dígitos con guion — el formato no importa'),
        ('75864254',  False, '8 dígitos sin guion'),
        ('  7586 4254  ', False, 'espacios internos y externos, 8 dígitos'),
        ('(503) 7586-4254', False, 'código de país + 8 dígitos'),
        ('+503 7586 4254', False, 'código de país con +'),
        ('50375864254', False, 'código de país pegado, sin separadores'),
        ('503748945',  True,  'empieza con 503 pero NO son 503+8'),
        ('7489-458',   True,  '7 dígitos'),
        ('123456789',  True,  '9 dígitos'),
        ('1111-1111',  False, 'relleno inventado, PERO son 8 dígitos: pasa'),
        ('sin telefono', True, 'texto sin dígitos')):
    c = dict(base['campos']); c['telefono1'] = valor
    _, cam = bloque.planificar({'id': base['id']}, c, OPS)
    cambio = 'telefono1' in cam
    check(f'teléfono {valor!r} {"se reemplaza" if debe_cambiar else "se respeta"} — {motivo}',
          cambio == debe_cambiar, f'cambios={cam.get("telefono1")}')

# ── rama B: DUI inválido ─────────────────────────────────────────────────────
DUI_MALO = '045678901'          # dígito verificador incorrecto a propósito
check('el DUI de prueba es realmente inválido', bloque.dui_valido(DUI_MALO) is False)

# Por defecto se BORRA (decisión del 2026-08-01), pero el original queda
# registrado: eso es lo que hace que borrar no sea irreversible.
c = dict(base['campos']); c['dui'] = DUI_MALO
notas = []
n_del, cam_del = bloque.planificar({'id': base['id']}, c, OPS, notas)
check('por defecto el DUI inválido se BORRA', n_del['dui'] == '')
check('y el número original queda registrado antes de vaciarlo',
      len(notas) == 1 and notas[0]['valor'] == DUI_MALO
      and notas[0]['accion'] == 'borrado', str(notas))

bloque.BORRAR_DUI_INVALIDO = False     # modo --dui-invalido reportar
notas_r = []
n_rep, cam_rep = bloque.planificar({'id': base['id']}, c, OPS, notas_r)
check('con --dui-invalido reportar NO se toca', n_rep['dui'] == DUI_MALO)
check('no cuenta como cambio (no dispara un POST vacío)', 'dui' not in cam_rep)
check('y también queda registrado, marcado como intacto',
      len(notas_r) == 1 and notas_r[0]['accion'] == 'intacto', str(notas_r))

bloque.BORRAR_DUI_INVALIDO = True
c = dict(base['campos']); c['dui'] = DUI_MALO
nuevos, cambios = bloque.planificar({'id': base['id']}, c, OPS)
dif = {k for k in set(c) | set(nuevos) if c.get(k) != nuevos.get(k)}
check('rama DUI: se ejecuta', 'dui' in cambios, str(cambios))
check('rama DUI: lo borra', nuevos['dui'] == '')
check('rama DUI: NO toca ningún otro campo', dif == {'dui'}, f'difieren {dif}')
c2 = dict(base['campos']); c2['dui'] = '045678900'
if bloque.dui_valido(c2['dui']):
    n2, cam2 = bloque.planificar({'id': base['id']}, c2, OPS)
    check('rama DUI: un DUI VÁLIDO no se toca', 'dui' not in cam2 and n2['dui'] == c2['dui'])
c3 = dict(base['campos']); c3['dui'] = ''
n3, cam3 = bloque.planificar({'id': base['id']}, c3, OPS)
check('rama DUI: un DUI VACÍO no se toca', 'dui' not in cam3)
notas_v = []
bloque.planificar({'id': base['id']}, c3, OPS, notas_v)
check('un DUI vacío tampoco se reporta', notas_v == [], str(notas_v))

# ── rama C: sin municipio ────────────────────────────────────────────────────
c = dict(base['campos'])
c['municipio'], c['distrito'], c['departamento'] = '', '', ''
nuevos, cambios = bloque.planificar({'id': base['id']}, c, OPS)
dif = {k for k in set(c) | set(nuevos) if c.get(k) != nuevos.get(k)}
check('rama sin-municipio: se ejecuta', set(cambios) == {'departamento', 'municipio', 'distrito'},
      str(list(cambios)))
check('rama sin-municipio: valores del default',
      (nuevos['departamento'], nuevos['municipio'], nuevos['distrito']) == ('4', '36', '7'))
check('rama sin-municipio: NO toca ningún otro campo',
      dif == {'departamento', 'municipio', 'distrito'}, f'difieren {dif}')
check('rama sin-municipio: la verificación ahora SÍ la cubre (bug del v2)',
      {'departamento', 'municipio', 'distrito'} <= set(cambios))

# ── las tres juntas ──────────────────────────────────────────────────────────
c = dict(base['campos'])
c.update({'municipio': '', 'distrito': '', 'departamento': '', 'telefono1': '', 'dui': DUI_MALO})
nuevos, cambios = bloque.planificar({'id': base['id']}, c, OPS)
dif = {k for k in set(c) | set(nuevos) if c.get(k) != nuevos.get(k)}
check('las tres ramas a la vez: 5 campos y ni uno más',
      dif == {'departamento', 'municipio', 'distrito', 'telefono1', 'dui'}, f'difieren {dif}')
check('las tres ramas a la vez: el payload conserva TODOS los campos originales',
      set(nuevos) >= set(c), f'faltan {set(c) - set(nuevos)}')


# ═════════════════════════════════════════════════════════════════════════════
print('\n2. ESCRITURA CONTRA UN ERP QUE BORRA LO QUE NO SE MANDA\n')

fichas = []
for i, f in enumerate(FICHAS[:6]):
    g = copy.deepcopy(f)
    g['campos']['categoria'] = next(v for v, t in OPS['categoria'] if t == 'Consumidor')
    if i % 3 == 0:
        g['campos']['telefono1'] = ''
    elif i % 3 == 1:
        g['campos']['dui'] = DUI_MALO
    else:
        g['campos']['municipio'] = g['campos']['distrito'] = ''
    fichas.append(g)

erp = montar(fichas)
antes = copy.deepcopy(erp.reg)
salida = correr(fichas, escribir=True)
print('   ' + '\n   '.join(l for l in salida.splitlines()
                           if l.startswith(('OK ', 'REVISAR', 'escritos'))))
check('el ERP falso recibió un POST por ficha', len(erp.posts) == len(fichas),
      f'{len(erp.posts)} posts')
check('ninguna ficha perdió campos pese al ERP hostil',
      'REVISAR' not in salida, 'hubo REVISAR')
for eid, orig in antes.items():
    ahora = erp.reg[eid]
    faltan = {k for k, v in orig.items() if v and not ahora.get(k)
              and k not in ('telefono1', 'dui', 'municipio', 'distrito')
              and k not in bloque.NO_SON_CAMPOS}
    check(f'ficha {eid}: cero campos perdidos', not faltan, f'perdió {faltan}')


# ═════════════════════════════════════════════════════════════════════════════
print('\n2b. LOS VALORES VIAJAN CRUDOS (regresión del 2026-08-01)\n')

# El ERP distingue clientes por el nombre TAL CUAL. Un `.strip()` nuestro hacía
# colisionar ' NURIA…' con 'NURIA…' y el ERP rechazaba el guardado ENTERO.
for _f in (bloque.CHECKPOINT, JSONL):
    os.path.exists(_f) and os.remove(_f)
sucio = copy.deepcopy(fichas[0])
sucio['campos']['nombre'] = '  NURIA ROXANA VILLANUEVA'
sucio['campos']['direccion'] = 'NUEVA CONCEPCION '
sucio['campos']['telefono1'] = ''          # para que tenga algo que corregir
erp = montar([sucio])
correr([sucio], escribir=True)
post = erp.posts[0]
check('el nombre viaja con sus espacios intactos',
      post['nombre'] == '  NURIA ROXANA VILLANUEVA', repr(post.get('nombre')))
check('la dirección también', post['direccion'] == 'NUEVA CONCEPCION ',
      repr(post.get('direccion')))
check('y aun así la corrección se aplicó', post['telefono1'] == '23010013')

html_crudo = ErpFalso({'1': {'nombre': '  con espacios  '}}).render({'nombre': '  con espacios  '})
check('parsear_ficha no recorta valores',
      bloque.parsear_ficha(html_crudo)[0]['nombre'] == '  con espacios  ',
      repr(bloque.parsear_ficha(html_crudo)[0].get('nombre')))
check('pero el espejo al portal SÍ los limpia',
      json.loads(open(JSONL).readlines()[-1])['direccion'] == 'NUEVA CONCEPCION'
      if os.path.exists(JSONL) else False)


print('\n2c. NOMBRE EN MAYÚSCULA, Y EL RECHAZO DEL ERP COMO HALLAZGO\n')

for valor, debe, motivo in (
        ('JOSE MANUEL MENJIVAR', False, 'ya está en mayúscula'),
        ('Jose manuel menjivar', True, 'mezclado'),
        ('jose manuel menjivar', True, 'todo minúscula'),
        (' JOSE MANUEL ', False, 'mayúscula con espacios: no se toca')):
    c = dict(base['campos']); c['nombre'] = valor
    n, cam = bloque.planificar({'id': base['id']}, c, OPS)
    check(f'nombre {valor!r} {"se pasa a MAYÚSCULA" if debe else "se respeta"} — {motivo}',
          ('nombre' in cam) == debe, f'quedó {n["nombre"]!r}')

c = dict(base['campos']); c['nombre'] = '  jose manuel menjivar  '
n, _ = bloque.planificar({'id': base['id']}, c, OPS)
check('al pasar a mayúscula NO se recortan los espacios',
      n['nombre'] == '  JOSE MANUEL MENJIVAR  ', repr(n['nombre']))

# Un ERP que rechaza por duplicado: el bloque debe anotarlo y NO darlo por hecho.
class ErpQueRechaza(ErpFalso):
    def pedir(self, url, datos=None):
        if datos is None:
            return super().pedir(url, datos)
        self.posts.append(dict(datos))
        return '{"typeinfo":"Error","msg":"Ya se registro un cliente con estos datos!"}'


bloque.BORRAR_DUI_INVALIDO = True      # el default vigente
for _f in (bloque.CHECKPOINT, JSONL):
    os.path.exists(_f) and os.remove(_f)
recha = copy.deepcopy(fichas[0]); recha['campos']['telefono1'] = ''
erp = ErpQueRechaza({str(recha['erp_id']): dict(recha['campos'])})
bloque.pedir = erp.pedir
salida = correr([recha], escribir=True)
amb = json.load(open(f'{TMP}/ambiguos.json'))
check('un rechazo del ERP se ve en pantalla', 'RECHAZO' in salida)
check('y queda anotado en la lista de purga',
      any(a['tipo'] == 'rechazo-erp' and a['duplicado'] for a in amb), str(amb))
check('NO se marca como hecho — hay que poder reintentarlo tras purgar',
      not os.path.exists(bloque.CHECKPOINT))
check('pero sí se espeja al portal lo que la ficha tiene hoy',
      os.path.exists(JSONL) and len(open(JSONL).readlines()) == 1)


print('\n3. CHECKPOINT\n')

JSONL = f'{TMP}/portal_pendiente.jsonl'
for f in (bloque.CHECKPOINT, JSONL):
    os.path.exists(f) and os.remove(f)
erp = montar(fichas)
correr(fichas, escribir=False)
check('una SIMULACIÓN no crea el checkpoint', not os.path.exists(bloque.CHECKPOINT),
      'la simulación lo escribió — haría que la corrida real saltee fichas sin tocarlas')
check('una SIMULACIÓN tampoco espeja al portal', not os.path.exists(JSONL),
      'escribió filas de portal sin haber tocado nada')

erp = montar(fichas)
correr(fichas, escribir=True)
ck = json.load(open(bloque.CHECKPOINT))
check('la escritura sí lo crea', len(ck) == len(fichas), f'{len(ck)} entradas')
check('cada entrada dice qué cambió y si salió OK',
      all('cambios' in v and 'ok' in v and 'ts' in v for v in ck.values()))

erp2 = montar(fichas)
salida = correr(fichas, escribir=True)
check('la segunda corrida NO reescribe nada', len(erp2.posts) == 0,
      f'reescribió {len(erp2.posts)}')
check('y las reporta como YA HECHO', salida.count('YA HECHO') == len(fichas))

# Si cambian las reglas, lo ya hecho tiene que volver a pasar por el molino:
# si no, una regla nueva jamás se aplicaría a lo procesado antes.
bloque.REGLAS += 1
erp_v = montar(fichas)
correr(fichas, escribir=True)
check('al subir la versión de reglas, se reprocesa todo',
      len(erp_v.posts) > 0, 'el checkpoint viejo siguió salteando')
bloque.REGLAS -= 1

# corte a la mitad, como un timeout real
os.remove(bloque.CHECKPOINT)
erp3 = montar(fichas)
llamadas = {'n': 0}
real_pedir = erp3.pedir


def cae_a_la_mitad(url, datos=None):
    if datos is not None:
        llamadas['n'] += 1
        if llamadas['n'] > 2:
            raise urllib_error()
    return real_pedir(url, datos)


def urllib_error():
    import urllib.error
    return urllib.error.URLError('timeout simulado')


bloque.pedir = cae_a_la_mitad
try:
    correr(fichas, escribir=True)
except Exception:
    pass
ck = json.load(open(bloque.CHECKPOINT)) if os.path.exists(bloque.CHECKPOINT) else {}
check('tras una caída a mitad de bloque, el checkpoint tiene solo lo confirmado',
      len(ck) == 2, f'{len(ck)} entradas (esperaba 2)')
erp4 = montar(fichas)
correr(fichas, escribir=True)
check('al reanudar escribe SOLO lo que faltaba', len(erp4.posts) == len(fichas) - 2,
      f'escribió {len(erp4.posts)}, esperaba {len(fichas) - 2}')


# ═════════════════════════════════════════════════════════════════════════════
print('\n4. LA REGLA DEL SALTO, EN EL LAZO COMPLETO\n')

no_consumidor = []
for f, etiqueta in zip(FICHAS[6:10], ['Contribuyente', 'Gran Contribuyente',
                                      'Contribuyente', 'Gran Contribuyente']):
    g = copy.deepcopy(f)
    g['campos']['categoria'] = next(v for v, t in OPS['categoria'] if t == etiqueta)
    g['campos'].update({'telefono1': '', 'dui': DUI_MALO, 'municipio': '', 'distrito': ''})
    no_consumidor.append(g)

for f in (bloque.CHECKPOINT, JSONL):
    os.path.exists(f) and os.remove(f)
erp = montar(no_consumidor)
antes = copy.deepcopy(erp.reg)
salida = correr(no_consumidor, escribir=True)
check('con las 3 condiciones activas y categoría ≠ Consumidor: CERO POSTs',
      len(erp.posts) == 0, f'{len(erp.posts)} posts')
check('las fichas quedaron idénticas', erp.reg == antes)
check('y las reporta como SALTADO en el plan',
      sum(1 for l in salida.splitlines() if l.startswith('   SALTADO')) == len(no_consumidor))
# La regla es "no se toca en el ERP, PERO sí se guarda en el portal".
esp = [json.loads(l) for l in open(JSONL)] if os.path.exists(JSONL) else []
check('un contribuyente SÍ se espeja al portal aunque no se edite',
      len(esp) == len(no_consumidor), f'{len(esp)} filas espejadas')
check('y el espejo trae su categoría real, no "Consumidor"',
      all(e['categoria'] in ('Contribuyente', 'Gran Contribuyente') for e in esp),
      str([e.get('categoria') for e in esp]))


# ═════════════════════════════════════════════════════════════════════════════
print('\n4c. EL ESPEJO AL PORTAL\n')


for f in (bloque.CHECKPOINT, JSONL):
    os.path.exists(f) and os.remove(f)
erp = montar(fichas)
# main() fija el flag desde el argumento, así que el modo va por CLI y no por
# la global del módulo.
correr(fichas, escribir=True)
esp = [json.loads(l) for l in open(JSONL)]
check('una fila por ficha procesada', len(esp) == len(fichas), f'{len(esp)}')
COLS = {'id', 'erp_id', 'nit', 'dui', 'nrc', 'phone', 'telefono2', 'email',
        'direccion', 'pasaporte', 'departamento', 'municipio', 'distrito',
        'categoria', 'giro', 'retencion_pct'}
# `match_name` no es una columna de customers: es la llave del UPDATE cuando el
# bloque se arma desde el ERP y no se conoce el id del portal.
check('las columnas son las de `customers` más la llave de emparejamiento',
      all(set(e) == COLS | {'match_name'} for e in esp),
      str(set(esp[0]) ^ (COLS | {'match_name'})))
check('la llave de emparejamiento es el nombre en minúsculas y sin bordes',
      all(e['match_name'] == e['match_name'].strip().lower() for e in esp))
check('NO manda `name` (es la clave del match, no se pisa)',
      all('name' not in e for e in esp))
check('los selects van por ETIQUETA, no por value',
      all(e['categoria'] in (None, 'Consumidor', 'Contribuyente', 'Gran Contribuyente')
          for e in esp), str([e['categoria'] for e in esp]))
por_erp = {str(e['erp_id']): e for e in esp}
tel = [f for f in fichas if not f['campos'].get('telefono1')][0]
check('el espejo refleja el teléfono YA corregido, no el vacío original',
      por_erp[str(tel['erp_id'])]['phone'] == '23010013',
      str(por_erp[str(tel['erp_id'])]['phone']))
dui = [f for f in fichas if f['campos'].get('dui') == DUI_MALO][0]
check('un DUI borrado llega al portal como NULL, no como la basura',
      por_erp[str(dui['erp_id'])]['dui'] is None,
      str(por_erp[str(dui['erp_id'])]['dui']))
check('los vacíos van NULL, nunca cadena vacía',
      all(v != '' for e in esp for v in e.values()))


# ═════════════════════════════════════════════════════════════════════════════
print('\n4b. LOS PSEUDO-CLIENTES DEL COMBO (baldes del POS)\n')

idx, nombres_erp = bloque.indice_erp()
todos_ids = [v for lista in idx.values() for v in lista]
check('el índice no contiene ningún id no positivo',
      all(v.isdigit() and int(v) > 0 for v in todos_ids),
      str([v for v in todos_ids if not (v.isdigit() and int(v) > 0)][:5]))
for balde in ('CLIENTE FRECUENTE NUEVO', 'CLIENTES VARIOS', 'Todos los clientes'):
    check(f'"{balde}" ya no matchea contra nada', not idx.get(bloque.norm(balde)),
          str(idx.get(bloque.norm(balde))))
print(f'   fichas reales indexadas: {len(todos_ids)}')


print('\n5. MATCHER v2 Y DETERMINISMO\n')

# OJO: OPS['distrito'] son los 20 distritos de UN municipio (Chalatenango Sur,
# que es el de la ficha 6317). Para medir el matcher hay que usar la lista
# completa del departamento — si no, se mide contra un universo recortado.
CHALA = [('2', 'ARCATAO'), ('3', 'AZACUALPA'), ('5', 'COMALAPA'),
         ('6', 'CONCEPCIÓN QUEZALTEPEQUE'), ('7', 'CHALATENANGO'),
         ('9', 'EL CARRIZAL'), ('11', 'LA LAGUNA'), ('14', 'LAS VUELTAS'),
         ('15', 'NOMBRE DE JESUS'), ('17', 'NUEVA TRINIDAD'),
         ('18', 'OJOS DE AGUA'), ('19', 'POTONICO'), ('20', 'SAN ANT LA CRUZ'),
         ('21', 'SAN ANT RANCHOS'), ('23', 'SAN FRANCISCO LEMPA'),
         ('25', 'SAN I LABRADOR'), ('26', 'SAN J CANCASQUE'),
         ('27', 'SAN JOSE FLORES'), ('28', 'SAN LUIS CARMEN'),
         ('29', 'SN MIG MERCEDES'), ('1', 'AGUA CALIENTE'),
         ('8', 'DULCE NOM MARÍA'), ('10', 'EL PARAÍSO'), ('13', 'LA REINA'),
         ('16', 'NVA CONCEPCIÓN'), ('22', 'SAN FERNANDO'),
         ('24', 'SAN FRANCISCO MORAZÁN'), ('31', 'SAN RAFAEL'),
         ('32', 'SANTA RITA'), ('33', 'TEJUTLA')]

cand = bloque.candidatos_distrito('nueva concepcion', CHALA)
check('el caso que falló con el matcher v1: "nueva concepcion" alcanza NVA CONCEPCIÓN',
      any('NVA' in t.upper() for _, t in cand), str(cand))


def v1_substring(direccion, ops):
    """El matcher viejo, para poder comparar de verdad."""
    dirn = bloque.norm(direccion)
    return [(v, t) for v, t in ops if bloque.norm(t) and bloque.norm(t) in dirn]


clientes_ccf = json.load(open(f'{D}/ccf_erp.json'))['clientes']
dirs = [c['direccion'] for c in clientes_ccf if c.get('direccion')]
u1 = sum(1 for d in dirs if len(v1_substring(d, CHALA)) == 1)
u2 = sum(1 for d in dirs if len(bloque.candidatos_distrito(d, CHALA)) == 1)
motivos = {}
for i, d in enumerate(dirs):
    motivos.setdefault(bloque.elegir_distrito(i, d, CHALA)[1].split(' (')[0], 0)
    motivos[bloque.elegir_distrito(i, d, CHALA)[1].split(' (')[0]] += 1
casc = sum(v for k, v in motivos.items() if k == 'dirección')
print(f'   sobre {len(dirs)} direcciones reales del departamento:')
print(f'      v1 nombre completo solo : único {u1:>3} ({u1*100//len(dirs)}%)')
print(f'      v2 token solo           : único {u2:>3} ({u2*100//len(dirs)}%)')
print(f'      cascada v1 -> v2        : {motivos}')
check('la cascada resuelve por dirección al menos tanto como el v1 solo',
      casc >= u1, f'cascada {casc} vs v1 {u1}')
check('la cascada alcanza casos que el v1 solo no veía',
      casc > u1 or any('abreviatura' in bloque.elegir_distrito(i, d, CHALA)[1]
                       for i, d in enumerate(dirs)),
      'el v2 no aportó ni un caso')

a1 = bloque.elegir_distrito(12345, 'sin ninguna pista aqui', CHALA)
a2 = bloque.elegir_distrito(12345, 'sin ninguna pista aqui', CHALA)
check('determinista: el mismo cliente saca siempre el mismo distrito', a1 == a2)
check('reparte: dos clientes distintos no salen iguales por construcción',
      len({bloque.elegir_distrito(i, 'x', CHALA)[0] for i in range(60)}) > 5)


# ═════════════════════════════════════════════════════════════════════════════
print('\n6. LA VERIFICACIÓN DETECTA LO QUE DEBE\n')

c = {'nombre': 'X', 'telefono1': '', 'dui': '045678901', 'correo': 'a@b.c'}
n = {**c, 'telefono1': '2301-0013', 'dui': ''}
check('detecta un campo PERDIDO', 'correo' in
      bloque.verificar(c, n, {**n, 'correo': ''})['perdidos'])
check('detecta un campo ALTERADO (hueco del v2)',
      bloque.verificar(c, n, {**n, 'nombre': 'OTRO'})['alterados'] != [])
check('detecta que el cambio pedido NO se aplicó',
      not bloque.verificar(c, n, {**n, 'telefono1': ''})['ok'])
check('no se queja cuando todo salió bien', bloque.verificar(c, n, dict(n))['ok'])
check('borrar el DUI a propósito no cuenta como pérdida',
      'dui' not in bloque.verificar(c, n, dict(n))['perdidos'])

# ═════════════════════════════════════════════════════════════════════════════
print('\n7. REINTENTO DEL GLITCH DEL ERP\n')

# El caso real: en 365 escrituras el ERP contestó UNA vez esto —en texto plano,
# ni siquiera su JSON— y el mismo payload entró a la primera al reintentarlo.
GLITCH = 'Proceso no encontrado'
DUPLICADO = '{"typeinfo":"Error","msg":"Ya se registro un cliente con estos datos!"}'


def limpiar():
    for f in (bloque.CHECKPOINT, JSONL, f'{TMP}/ambiguos.json',
              f'{TMP}/revision_manual.json', f'{TMP}/bloque_resultado.json'):
        os.path.exists(f) and os.remove(f)


for cuerpo, reintentable, motivo in (
        ('{"typeinfo":"Success","msg":"ok"}', False, 'salió bien'),
        (GLITCH, True, 'no es su formato: falló su router, no su lógica'),
        ('', True, 'respuesta vacía'),
        ('<html>502 Bad Gateway</html>', True, 'se cayó el proxy'),
        ('[1,2,3]', True, 'JSON válido pero no es su objeto'),
        (DUPLICADO, False, 'el ERP ya decidió: insistir da lo mismo'),
        ('{"typeinfo":"Error","msg":"Ya se registró un cliente"}', False,
         'el mismo rechazo, con acento'),
        ('{"typeinfo":"Error","msg":"Falla temporal de la base"}', True,
         'error JSON desconocido: ante la duda, reintentar')):
    _r, _rein = bloque.clasificar_respuesta(cuerpo)
    check(f'{cuerpo[:36]!r:<40} {"se reintenta " if reintentable else "NO se reintenta"}'
          f' — {motivo}', _rein == reintentable,
          f'quedó reintentable={_rein}, typeinfo={_r.get("typeinfo")}')


class ErpConGlitch(ErpFalso):
    """Falla las primeras `fallas` escrituras de CADA ficha, después aplica."""

    def __init__(self, registros, fallas=1, cuerpo=GLITCH):
        super().__init__(registros)
        self.fallas, self.cuerpo, self.vistos = fallas, cuerpo, {}

    def pedir(self, url, datos=None):
        if datos is None:
            return super().pedir(url, datos)
        eid = str(datos['id_cliente'])
        self.vistos[eid] = self.vistos.get(eid, 0) + 1
        if self.vistos[eid] <= self.fallas:
            self.posts.append(dict(datos))   # llegó al ERP, aunque conteste mal
            return self.cuerpo
        return super().pedir(url, datos)


uno = copy.deepcopy(fichas[0])
uno['campos']['telefono1'] = ''
uno['campos']['categoria'] = next(v for v, t in OPS['categoria'] if t == 'Consumidor')

limpiar()
erp = ErpConGlitch({str(uno['erp_id']): dict(uno['campos'])}, fallas=1)
bloque.pedir = erp.pedir
salida = correr([uno], escribir=True)
check('un glitch se reintenta, y la ficha entra al segundo intento',
      len(erp.posts) == 2, f'{len(erp.posts)} POSTs')
check('el reintento se ve en pantalla', 'reintento 1 de 2' in salida, salida[-300:])
check('la corrección quedó aplicada pese al glitch',
      erp.reg[str(uno['erp_id'])]['telefono1'] == '23010013')
check('y la ficha se marca como hecha',
      os.path.exists(bloque.CHECKPOINT) and len(json.load(open(bloque.CHECKPOINT))) == 1)
res = [f for f in json.load(open(f'{TMP}/bloque_resultado.json')) if f.get('respuesta')]
check('el resultado deja anotado que costó 2 intentos',
      res and res[0]['respuesta'].get('intentos') == 2,
      str(res[0].get('respuesta') if res else 'sin respuesta'))

limpiar()
erp = ErpConGlitch({str(uno['erp_id']): dict(uno['campos'])}, fallas=99)
bloque.pedir = erp.pedir
correr([uno], escribir=True)
check('un glitch que no cede corta a los 3 intentos, no insiste para siempre',
      len(erp.posts) == 3, f'{len(erp.posts)} POSTs')
check('y NO se marca como hecho — hay que poder reintentarlo en otra corrida',
      not os.path.exists(bloque.CHECKPOINT))
amb = json.load(open(f'{TMP}/ambiguos.json'))
check('queda anotado, con los intentos que costó y sin confundirlo con un duplicado',
      any(x['tipo'] == 'rechazo-erp' and x.get('intentos') == 3 and not x['duplicado']
          for x in amb), str(amb))

limpiar()
erp = ErpQueRechaza({str(uno['erp_id']): dict(uno['campos'])})
bloque.pedir = erp.pedir
correr([uno], escribir=True)
check('un rechazo razonado NO se reintenta (serían 3 peticiones para la misma respuesta)',
      len(erp.posts) == 1, f'{len(erp.posts)} POSTs')


# ═════════════════════════════════════════════════════════════════════════════
print('\n8. MODO --UNA-PASADA\n')


class ErpConTraza(ErpFalso):
    """Anota el ORDEN de las peticiones: es lo único que distingue los dos modos."""

    def pedir(self, url, datos=None):
        if datos is None:
            eid = re.search(r'id_cliente=(-?\d+)', url).group(1)
            self.traza.append(f'lee {eid}')
        else:
            self.traza.append(f'escribe {datos["id_cliente"]}')
        return super().pedir(url, datos)


tres = []
for f in FICHAS[:3]:
    g = copy.deepcopy(f)
    g['campos']['categoria'] = next(v for v, t in OPS['categoria'] if t == 'Consumidor')
    g['campos']['telefono1'] = ''
    tres.append(g)
registros = {str(f['erp_id']): dict(f['campos']) for f in tres}

limpiar()
dos_fases = ErpConTraza(registros)
bloque.pedir = dos_fases.pedir
correr(tres, escribir=True)
ck_dos = json.load(open(bloque.CHECKPOINT))
esp_dos = [json.loads(l) for l in open(JSONL)]
reg_dos = copy.deepcopy(dos_fases.reg)

limpiar()
una = ErpConTraza(registros)
bloque.pedir = una.pedir
salida = correr(tres, escribir=True, extra=['--una-pasada'])
check('ni una petición más que en dos fases',
      len(una.traza) == len(dos_fases.traza),
      f'{len(una.traza)} vs {len(dos_fases.traza)}')
check('el ERP queda exactamente igual', una.reg == reg_dos)
check('el checkpoint también', json.load(open(bloque.CHECKPOINT)).keys() == ck_dos.keys()
      and all(v['ok'] for v in json.load(open(bloque.CHECKPOINT)).values()))
check('y el espejo al portal', [json.loads(l) for l in open(JSONL)] == esp_dos)
check('el encabezado dice en qué modo corre', 'UNA PASADA' in salida)

# El punto de todo el modo: en dos fases la ficha 1 se lee y recién se escribe
# después de leer las 500 — hasta 15 minutos de hueco en el que otra persona
# puede editarla en el ERP y el POST (que manda los 21 campos) le pasa por
# encima. En una pasada ese hueco es una petición.
check('en dos fases se leen TODAS antes de escribir ninguna',
      dos_fases.traza[:3] == [f'lee {f["erp_id"]}' for f in tres], str(dos_fases.traza))
esperado = [p for f in tres for p in
            (f'lee {f["erp_id"]}', f'escribe {f["erp_id"]}', f'lee {f["erp_id"]}')]
check('en una pasada cada ficha se cierra antes de abrir la siguiente',
      una.traza == esperado, str(una.traza))

# En dos fases revision_manual.json se escribe entero al terminar de planear, o
# sea antes del primer POST. En una pasada ese momento no existe: si el DUI
# original no está en disco ANTES de borrarlo, un corte lo pierde para siempre.
limpiar()
con_dui = []
for f in FICHAS[:3]:
    g = copy.deepcopy(f)
    g['campos']['categoria'] = next(v for v, t in OPS['categoria'] if t == 'Consumidor')
    g['campos']['dui'] = DUI_MALO
    con_dui.append(g)

erp = ErpConTraza({str(f['erp_id']): dict(f['campos']) for f in con_dui})
_real, _n = erp.pedir, {'posts': 0}


def cae_al_segundo_post(url, datos=None):
    if datos is not None:
        _n['posts'] += 1
        if _n['posts'] > 1:
            raise urllib_error()
    return _real(url, datos)


bloque.pedir = cae_al_segundo_post
try:
    correr(con_dui, escribir=True, extra=['--una-pasada'])
except Exception:
    pass
rev = json.load(open(f'{TMP}/revision_manual.json')) \
    if os.path.exists(f'{TMP}/revision_manual.json') else []
check('el DUI original queda en disco ANTES del POST que lo borra',
      len(rev) >= 2 and all(r['valor'] == DUI_MALO for r in rev), str(rev))
check('y la ficha que sí entró quedó en el checkpoint',
      os.path.exists(bloque.CHECKPOINT) and len(json.load(open(bloque.CHECKPOINT))) == 1,
      str(json.load(open(bloque.CHECKPOINT)) if os.path.exists(bloque.CHECKPOINT) else {}))

limpiar()
erp = ErpConTraza(registros)
bloque.pedir = erp.pedir
salida = correr(tres, escribir=False, extra=['--una-pasada'])
check('--una-pasada sin --escribir sigue siendo una simulación',
      len(erp.posts) == 0, f'{len(erp.posts)} POSTs')
check('no crea el checkpoint', not os.path.exists(bloque.CHECKPOINT))
check('y lo dice en el encabezado', 'SIMULACIÓN' in salida and 'UNA PASADA' not in salida)


# ═════════════════════════════════════════════════════════════════════════════
print('\n8b. UN BLOQUE NUEVO NO BORRA LOS DUI QUE ANOTÓ EL ANTERIOR\n')

# El agujero real, encontrado en el bloque erp 283-1000: revision_manual.json se
# escribía de cero cada corrida. Ahí vive el ÚNICO registro del DUI original
# antes de vaciarlo — o sea la razón entera por la que borrarlo se considera
# reversible — y el bloque nuevo se llevaba puestos los números del anterior.
# Las 10 entradas previas solo se recuperaron del git.
#
# No es autorreparable: un DUI borrado SÍ queda en el checkpoint, así que
# ninguna corrida futura vuelve a mirar esa ficha.
REV = f'{TMP}/revision_manual.json'
limpiar()
con_dui = []
for f in FICHAS[:2]:
    g = copy.deepcopy(f)
    g['campos']['categoria'] = next(v for v, t in OPS['categoria'] if t == 'Consumidor')
    g['campos']['dui'] = DUI_MALO
    con_dui.append(g)

erp = montar(con_dui)
correr(con_dui, escribir=True)
primera = json.load(open(REV))
check('el primer bloque anota sus DUI', len(primera) == 2, str(len(primera)))

# Un segundo bloque, con fichas DISTINTAS: las del primero no se pueden perder.
otras = []
for f in FICHAS[2:4]:
    g = copy.deepcopy(f)
    g['campos']['categoria'] = next(v for v, t in OPS['categoria'] if t == 'Consumidor')
    g['campos']['dui'] = '045678901'
    otras.append(g)
erp = montar(otras)
correr(otras, escribir=True)
segunda = json.load(open(REV))
check('el segundo bloque CONSERVA los del primero y suma los suyos',
      len(segunda) == 4, f'{len(segunda)} entradas (esperaba 4)')
check('y los números originales del primer bloque siguen ahí',
      {x['erp_id'] for x in primera} <= {x['erp_id'] for x in segunda},
      str([x['erp_id'] for x in segunda]))

# Reprocesar la misma ficha (subir REGLAS) reescribe su entrada, no suma otra.
bloque.REGLAS += 1
erp = montar(con_dui)
correr(con_dui, escribir=True)
tercera = json.load(open(REV))
bloque.REGLAS -= 1
check('reprocesar una ficha no duplica su entrada', len(tercera) == 4,
      f'{len(tercera)} entradas (esperaba 4)')

r = [{'erp_id': '1', 'campo': 'dui', 'valor': 'A'}]
bloque.anotar_revision(r, {'erp_id': '1', 'campo': 'dui', 'valor': 'B'})
check('la clave es (ficha, campo): mismo par -> reemplaza',
      len(r) == 1 and r[0]['valor'] == 'B', str(r))
bloque.anotar_revision(r, {'erp_id': '1', 'campo': 'nit', 'valor': 'C'})
check('otro campo de la misma ficha -> entrada nueva', len(r) == 2, str(r))


# ═════════════════════════════════════════════════════════════════════════════
print('\n9. QUÉ FICHA GANA CUANDO UN NOMBRE ESTÁ DUPLICADO\n')

import revisar_duplicados as dup  # noqa: E402

BASE_DUP = {'dui': '04958064-7', 'nit': '', 'nrc': '', 'pasaporte': '',
            'telefono1': '75385899', 'telefono2': '', 'correo': '',
            'direccion': 'BARRIO EL CENTRO', 'departamento': '4',
            'municipio': '36', 'distrito': '7', 'categoria': '1'}


def par(a, b):
    return {'100': {**BASE_DUP, **a}, '200': {**BASE_DUP, **b}}


v, g, _ = dup.comparar(par({}, {}))
check('datos idénticos: no hay nada que decidir, gana la original (id más bajo)',
      (v, g) == ('IDÉNTICAS', '100'), f'{v} -> {g}')

v, g, _ = dup.comparar(par({'nombre': ' JOSE '}, {'nombre': 'jose'}))
check('el nombre crudo NO decide: es justo lo que difiere en todos estos casos',
      (v, g) == ('IDÉNTICAS', '100'), f'{v} -> {g}')

v, g, _ = dup.comparar(par({'telefono2': '', 'correo': ''},
                           {'telefono2': '22334455', 'correo': 'a@b.c'}))
check('una tiene todo lo de la otra y algo más: gana la más completa',
      (v, g) == ('SUPERSET', '200'), f'{v} -> {g}')

v, g, d = dup.comparar(par({'dui': '04958064-7'}, {'dui': '01094815-7'}))
check('dos DUI distintos: CONFLICTO, y no lo resuelve el script',
      (v, g) == ('CONFLICTO', None), f'{v} -> {g}')
check('y dice en qué campo chocan', 'dui' in d, str(d))

v, g, _ = dup.comparar(par({'nit': '1234-567890-123-4'},
                           {'nit': '9999-999999-999-9'}))
check('dos NIT distintos también son CONFLICTO', (v, g) == ('CONFLICTO', None),
      f'{v} -> {g}')

# Que una lo tenga y la otra no NO es un choque: es la mitad del punto de
# fusionarlas. Choque es que las dos tengan valor y sean distintos.
v, g, _ = dup.comparar(par({'dui': ''}, {'dui': '01094815-7'}))
check('una con DUI y la otra vacía no es conflicto: es la más completa',
      (v, g) == ('SUPERSET', '200'), f'{v} -> {g}')

v, g, _ = dup.comparar(par({'dui': '  04958064-7  '}, {'dui': '04958064-7'}))
check('el mismo DUI con espacios alrededor no es conflicto',
      v != 'CONFLICTO', f'{v} -> {g}')

# Ninguna contiene a la otra y no chocan en los identificadores: difieren en un
# dato blando. Es el caso real de YNES ANTONIO ARDON (dos distritos distintos).
v, g, d = dup.comparar(par({'distrito': '16', 'telefono2': '22112233'},
                           {'distrito': '1', 'correo': 'x@y.z'}))
check('difieren solo en datos blandos: se elige, pero queda el detalle',
      v == 'MÁS COMPLETA' and g in ('100', '200') and 'distrito' in d,
      f'{v} -> {g}, detalle={list(d)}')

# El desempate importa: a igual completitud gana la original, que es la que
# viene arrastrando el historial de ventas.
v, g, _ = dup.comparar(par({'telefono2': '22112233'}, {'telefono2': '33445566'}))
check('a igual completitud gana la de id más bajo', g == '100', f'{v} -> {g}')


intactos = sorted(os.listdir(TMP))
shutil.rmtree(TMP)
print(f'\n   (el arnés escribió solo en {os.path.basename(TMP)}: {intactos})')

print('\n' + '═' * 70)
print(f'{"TODO VERDE" if not FALLOS else "FALLARON: " + ", ".join(FALLOS)}')
print('═' * 70)
sys.exit(1 if FALLOS else 0)
