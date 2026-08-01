"""Completado de fichas del ERP por bloques.

Reglas acordadas (2026-07-31):
  · Solo se EDITA la categoría "Consumidor". Cualquier otra se lee y se guarda
    en el portal, pero no se toca en el ERP: un distrito inventado en un CCF se
    declara a Hacienda.
  · Distrito: si la dirección nombra uno del municipio, ese. Si no, pseudo-
    aleatorio DETERMINISTA — hash(id_cliente) % n. Queda repartido por toda la
    lista, pero el mismo cliente saca siempre el mismo, así que el bloque es
    reanudable y auditable.
  · Sin municipio ni distrito: default Chalatenango / Chalatenango Sur /
    CHALATENANGO (caso extremo, ficha sin dirección).
  · Teléfono 1: 8 dígitos, o código de país 503 + 8. Si no cumple -> 23010013.
  · DUI inválido -> se REPORTA, no se borra (ver planificar; --dui-invalido).
  · Nombre -> MAYÚSCULA (el 91% del catálogo ya lo está).
  · El payload se arma con TODOS los campos que la ficha muestra, no con una
    lista fija: el formulario es condicional por categoría, y un POST parcial
    borra lo que no se manda (incidente 6317).

Cambios acumulados:
  · Matcher v2 para distrito: token distintivo en vez de substring exacto. El
    ERP abrevia ("NVA CONCEPCIÓN") y la gente escribe completo; el substring no
    los unía nunca.
  · CHECKPOINT (checkpoint.json): cada ficha escrita se anota en disco ANTES de
    pasar a la siguiente, con escritura atómica. Reanudar = volver a correr.
    Solo se anota en modo --escribir: una simulación NUNCA marca nada como
    hecho, porque si lo hiciera la corrida real saltearía fichas sin tocarlas.
  · TABLA DE AMBIGUOS (ambiguos.json): nombre sin match, nombre con más de un
    erp_id, y dirección que nombra más de un distrito. Se reporta siempre.
  · Verificación completa. Tres huecos del v2, todos reales:
      1. la rama "sin municipio" escribía departamento+municipio+distrito pero
         la verificación solo miraba ('distrito','telefono1','dui'), y ni
         siquiera eso: la anotaba bajo la clave 'ubicacion', que no es un campo
         del formulario, así que no verificaba NADA de esa rama;
      2. no detectaba un campo ALTERADO (solo uno vaciado), que es justo la
         otra mitad del incidente 6317;
      3. la lista de 'perdidos' tenía una condición muerta
         (`k not in f['nuevos'].get('__', [])`, y '__' nunca es una clave).
    Ahora `cambios` va indexado por NOMBRE DE CAMPO, y la verificación exige:
    todo lo enviado quedó igual a lo enviado, nada se vació sin querer.
"""
import argparse, hashlib, html, json, os, re, time
import unicodedata, urllib.parse, urllib.request

D = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://clientesdte3.oss.com.sv/farma_salud'
CHECKPOINT = f'{D}/checkpoint.json'

# Versión del JUEGO DE REGLAS. El checkpoint guarda con cuál se procesó cada
# ficha, y solo se saltea si coincide con la actual. Sin esto, agregar una regla
# nueva no se aplicaría nunca a lo ya procesado: el checkpoint lo daría por
# hecho para siempre. SUBIRLA al cambiar cualquier regla de `planificar`.
#   1 · distrito, teléfono vacío, DUI inválido, default de ubicación
#   2 · teléfono con 8 dígitos (o 503+8) en vez de solo "vacío"
#   3 · nombre en MAYÚSCULA
#   4 · el DUI inválido ya NO se borra por defecto: se reporta
REGLAS = 4

# Por defecto NO se borra un DUI inválido (ver planificar). --dui-invalido borrar
# recupera el comportamiento original.
BORRAR_DUI_INVALIDO = False

# Sin guion: el input `.tel` del ERP filtra a dígitos en keydown, así que ese es
# el formato que produce el propio formulario.
TELEFONO_DEFECTO = '23010013'
DEFECTO = {'departamento': '4', 'municipio': '36', 'distrito': '7'}
NO_SON_CAMPOS = ('process', 'id_cliente')

# Tokens que no distinguen ningún distrito: aparecen en media docena.
VACIAS = {'SAN', 'SANTA', 'SANTO', 'NUEVA', 'NUEVO', 'NVA', 'DE', 'DEL', 'LA',
          'EL', 'LAS', 'LOS', 'SN', 'DULCE', 'NOM', 'NOMBRE', 'JESUS'}


# ── Utilidades puras ─────────────────────────────────────────────────────────
def norm(s):
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^A-Z0-9 ]', ' ', re.sub(r'\s+', ' ', s.upper())).strip()


def dui_valido(dui):
    """Puerto de isValidDUIAlgorithm (src/utils/duiUtils.js). Vacío = no opina."""
    if not dui or not dui.strip():
        return None
    d = re.sub(r'\D', '', dui)
    if len(d) != 9:
        return False
    dig = [int(x) for x in d]
    ver = dig.pop()
    suma = sum(dig[i] * (9 - i) for i in range(8))
    calc = 10 - (suma % 10)
    return (0 if calc == 10 else calc) == ver


CODIGO_PAIS_SV = '503'


def telefono_valido(tel):
    """Ocho dígitos, con o sin código de país.

    Cuenta DÍGITOS, no caracteres, así que el formato es indiferente:
    '7538-5899', '75385899' y '(503) 7538-5899' son todos el mismo número y los
    tres valen. '7489-458' (7 dígitos) no.

    OJO: '1111-1111' PASA — son 8 dígitos. Esta regla valida la FORMA, no
    detecta relleno inventado; para eso haría falta una lista de valores basura.
    """
    d = re.sub(r'\D', '', tel or '')
    if d.startswith(CODIGO_PAIS_SV) and len(d) == len(CODIGO_PAIS_SV) + 8:
        d = d[len(CODIGO_PAIS_SV):]
    return len(d) == 8


def tokens_distintivos(etiqueta):
    return {t for t in norm(etiqueta).split() if len(t) >= 5 and t not in VACIAS}


def _guarda_chalatenango(hits, direccion):
    """"CHALATENANGO" es departamento, municipio Y distrito. Si es el único hit
    y la dirección lo usa como los otros dos, no prueba nada."""
    if len(hits) == 1 and norm(hits[0][1]) == 'CHALATENANGO' and \
       re.search(r'(MUNICIPIO|DEPARTAMENTO)', norm(direccion)):
        return []
    return hits


def por_nombre_completo(direccion, ops):
    """v1: el nombre del distrito aparece entero en la dirección. Evidencia fuerte."""
    dirn = norm(direccion)
    return _guarda_chalatenango([(v, t) for v, t in ops
                                 if norm(t) and norm(t) in dirn], direccion)


def candidatos_distrito(direccion, ops):
    """v2: distritos cuyo token distintivo aparece en la dirección.

    Alcanza lo que el substring no: el ERP abrevia ("NVA CONCEPCIÓN") y la gente
    escribe completo, así que "nueva concepcion" da 0 con v1 y 2 con v2.
    Evidencia más débil — por eso va DESPUÉS del nombre completo, no en su lugar.
    """
    palabras = set(norm(direccion).split())
    return _guarda_chalatenango([(v, t) for v, t in ops
                                 if tokens_distintivos(t) & palabras], direccion)


def elegir_distrito(portal_id, direccion, ops):
    """(value, motivo, candidatos). Siempre devuelve algo reproducible.

    Cascada, medida sobre 85 direcciones reales del departamento:
        v1 nombre completo solo -> 34 únicos (40%)
        v2 token solo           -> 24 únicos (28%)  ← NO es mejor que el v1
        cascada v1 -> v2        -> ver probar_offline.py §5
    El v2 no reemplaza al v1: lo que aporta es cobertura donde el v1 no ve nada.
    """
    if not ops:
        return None, 'sin opciones', []
    semilla = int(hashlib.sha256(str(portal_id).encode()).hexdigest()[:8], 16)

    fuertes = por_nombre_completo(direccion, ops)
    if len(fuertes) == 1:
        return fuertes[0][0], 'dirección (nombre completo)', fuertes

    debiles = candidatos_distrito(direccion, ops)
    if len(debiles) == 1:
        return debiles[0][0], 'dirección (abreviatura)', debiles

    # La dirección nombra varios. Elegir entre ESOS es estrictamente mejor que
    # sortear entre los 20 del municipio, y queda en la tabla de ambiguos.
    hits = fuertes if len(fuertes) > 1 else debiles
    if len(hits) > 1:
        return hits[semilla % len(hits)][0], f'ambiguo ({len(hits)} candidatos)', hits
    return ops[semilla % len(ops)][0], 'determinista (dirección no dice)', []


def planificar(cliente, campos, ops, notas=None):
    """Núcleo puro: qué se le manda al ERP y por qué. No toca la red.

    Devuelve (nuevos, cambios) donde `cambios` va indexado por NOMBRE DE CAMPO
    — es lo que después verifica la escritura, campo por campo.
    """
    nuevos, cambios = dict(campos), {}
    etiq = {k: dict(v) for k, v in ops.items()}

    # Nombre en MAYÚSCULA: el 91% del catálogo ya lo está, así que esto lo
    # empareja, no inventa un estándar. Se respetan los espacios de los
    # extremos — recortarlos es lo que hacía colisionar fichas duplicadas.
    nombre = campos.get('nombre', '')
    if nombre and nombre != nombre.upper():
        nuevos['nombre'] = nombre.upper()
        cambios['nombre'] = f'{nombre.strip()!r} -> MAYÚSCULA'

    if not campos.get('municipio'):
        nuevos.update(DEFECTO)
        for k, v in DEFECTO.items():
            cambios[k] = f'{etiq.get(k, {}).get(v, v)} (default: ficha sin municipio)'
    elif not campos.get('distrito'):
        d, motivo, _ = elegir_distrito(cliente['id'], campos.get('direccion', ''),
                                       ops.get('distrito', []))
        if d:
            nuevos['distrito'] = d
            cambios['distrito'] = f'{etiq.get("distrito", {}).get(d, d)} ({motivo})'

    # OJO: esta rama ya no solo rellena vacíos — ahora PISA un teléfono que no
    # tenga 8 dígitos. Es la primera regla que sobrescribe un dato existente.
    tel = (campos.get('telefono1') or '').strip()
    if not telefono_valido(tel):
        n_dig = len(re.sub(r'\D', '', tel))
        nuevos['telefono1'] = TELEFONO_DEFECTO
        cambios['telefono1'] = (f'vacío -> {TELEFONO_DEFECTO}' if not tel else
                                f'{tel!r} tiene {n_dig} dígitos, no 8 -> {TELEFONO_DEFECTO}')

    # El DUI inválido NO se borra por defecto (cambiado el 2026-08-01).
    #
    # La regla original decía "borrar", pensando en relleno tipo '00000003-0' o
    # en una fecha de nacimiento tecleada en el campo. Pero al simular 500 fichas
    # aparecieron 10 inválidos y TODOS tienen estructura de DUI real, en fichas
    # de personas con nombre y apellido: son casi seguro DUI buenos con un dígito
    # mal tecleado. Borrarlos destruye un dato recuperable —se le pregunta al
    # cliente y se corrige— y a escala del catálogo serían ~690 borrados.
    #
    # Con `--dui-invalido borrar` se recupera el comportamiento viejo. En
    # cualquiera de los dos modos el caso queda listado en duis_invalidos.json.
    if dui_valido(campos.get('dui', '')) is False:
        if BORRAR_DUI_INVALIDO:
            nuevos['dui'] = ''
            cambios['dui'] = f'INVÁLIDO {campos["dui"]!r} -> se borra'
        elif notas is not None:
            # Fuera de `cambios` a propósito: si entrara ahí, la ficha contaría
            # como 'listo' y se haría un POST sin nada que cambiar, y encima la
            # verificación buscaría un campo con ese nombre.
            notas.append({'erp_id': None, 'campo': 'dui',
                          'valor': campos.get('dui'),
                          'motivo': 'DUI inválido — no se tocó, requiere revisión manual'})

    return nuevos, cambios


# ── Espejo al portal ─────────────────────────────────────────────────────────
# El ERP guarda los selects por VALUE ('4'); el portal guarda la ETIQUETA
# ('Chalatenango'), que es lo que ya tienen las 93 fichas portadas. La fuente es
# la ficha RELEÍDA después de corregir: el portal debe reflejar lo que el ERP
# tiene ahora, incluido un DUI borrado o un distrito recién puesto.
CAMPO_A_COLUMNA = {
    'nit': 'nit', 'dui': 'dui', 'nrc': 'nrc', 'telefono1': 'phone',
    'telefono2': 'telefono2', 'correo': 'email', 'direccion': 'direccion',
    'pasaporte': 'pasaporte',
}
SELECT_A_COLUMNA = {
    'departamento': 'departamento', 'municipio': 'municipio',
    'distrito': 'distrito', 'categoria': 'categoria', 'sel_giro': 'giro',
}


def fila_portal(cliente, erp_id, campos, ops):
    """La fila que va a `customers`. NO toca `name`: es la clave del match.

    `match_name` es la llave para el UPDATE cuando el bloque se arma desde el
    ERP y no conocemos el id del portal: `customers.search_name` es el nombre en
    minúsculas y los 24,502 son únicos, así que empareja sin ambigüedad.
    """
    fila = {'id': cliente.get('id'), 'erp_id': str(erp_id),
            'match_name': (campos.get('nombre') or '').strip().lower()}
    for campo, col in CAMPO_A_COLUMNA.items():
        v = (campos.get(campo) or '').strip()
        fila[col] = v or None
    for campo, col in SELECT_A_COLUMNA.items():
        etiquetas = dict(ops.get(campo, []))
        fila[col] = etiquetas.get(campos.get(campo, '')) or None
    pct = re.sub(r'\D', '', dict(ops.get('porcentaje', [])).get(campos.get('porcentaje', ''), ''))
    fila['retencion_pct'] = int(pct) if pct and int(pct) <= 100 else None
    return fila


def anotar_portal(fila):
    """Append durable, una línea por cliente, apenas se confirma la ficha."""
    with open(f'{D}/portal_pendiente.jsonl', 'a') as fh:
        fh.write(json.dumps(fila, ensure_ascii=False) + '\n')
        fh.flush()
        os.fsync(fh.fileno())


def verificar(campos, nuevos, despues):
    """Compara la ficha releída contra lo que se envió.

    perdidos  : tenía valor, quedó vacío, y NO lo vaciamos a propósito.
    alterados : el ERP guardó algo distinto de lo enviado (incluye los campos
                que ni tocamos — la otra mitad del incidente 6317).
    """
    perdidos = [k for k, v in campos.items()
                if k not in NO_SON_CAMPOS         # plomería del form, no dato
                and v and not despues.get(k) and nuevos.get(k, '') != '']
    alterados = [f'{k}: envié {nuevos[k]!r}, quedó {despues.get(k)!r}'
                 for k in nuevos
                 if k not in NO_SON_CAMPOS and despues.get(k, '') != nuevos[k]]
    return {'ok': not perdidos and not alterados,
            'perdidos': perdidos, 'alterados': alterados,
            'aplicados': {k: despues.get(k) for k in nuevos if k not in NO_SON_CAMPOS}}


# ── Checkpoint (atómico: temp + fsync + rename) ──────────────────────────────
def cargar_checkpoint():
    if os.path.exists(CHECKPOINT):
        with open(CHECKPOINT) as fh:
            return json.load(fh)
    return {}


def anotar_checkpoint(ck, erp_id, registro):
    ck[str(erp_id)] = registro
    tmp = CHECKPOINT + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(ck, fh, ensure_ascii=False, indent=1, default=str)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, CHECKPOINT)


# ── Red ──────────────────────────────────────────────────────────────────────
def cookie():
    return open(f'{D}/erp.env').read().split('=', 1)[1].strip()


def pedir(url, datos=None):
    cab = {'Cookie': cookie(), 'User-Agent': 'Mozilla/5.0',
           'X-Requested-With': 'XMLHttpRequest', 'Referer': f'{BASE}/admin_cliente.php'}
    cuerpo = urllib.parse.urlencode(datos).encode() if datos else None
    if cuerpo:
        cab['Content-Type'] = 'application/x-www-form-urlencoded'
    with urllib.request.urlopen(urllib.request.Request(url, data=cuerpo, headers=cab),
                                timeout=45) as r:
        return r.read().decode('utf-8', 'replace')


def parsear_ficha(h):
    """Todos los campos que la ficha realmente muestra: inputs, textareas, selects.

    LOS VALORES VAN CRUDOS, sin `.strip()`. Parece un detalle y no lo es: el
    control de duplicados del ERP compara el nombre tal cual, y hay fichas cuya
    ÚNICA diferencia es un espacio al inicio (21807 ' NURIA…' vs 21776 'NURIA…').
    Recortarlo hacía colisionar los nombres y el ERP rechazaba el guardado
    ENTERO con {"typeinfo":"Error","msg":"Ya se registro un cliente con estos
    datos!"} — no solo el campo que queríamos cambiar. Diagnosticado el
    2026-08-01 después de perseguirlo como si fuera un problema de distritos.

    El navegador manda el value crudo; nosotros también. Quien necesite el valor
    limpio (validaciones, matcher, espejo al portal) que haga su propio strip.
    Las ETIQUETAS de los <option> sí se recortan: son para mostrar, no viajan.
    """
    campos, opciones = {}, {}
    for m in re.finditer(r'<input([^>]*)>', h):
        a = m.group(1)
        if re.search(r'type\s*=\s*["\'](submit|button)', a):
            continue
        n = re.search(r'name\s*=\s*["\']([^"\']+)', a)
        if not n:
            continue
        v = re.search(r'value\s*=\s*["\']([^"\']*)', a)
        campos[n.group(1)] = html.unescape(v.group(1)) if v else ''
    for m in re.finditer(r'<textarea([^>]*)>(.*?)</textarea>', h, re.S):
        n = re.search(r'name\s*=\s*["\']([^"\']+)', m.group(1))
        if n:
            campos[n.group(1)] = html.unescape(m.group(2))
    for m in re.finditer(r'<select([^>]*)>(.*?)</select>', h, re.S):
        n = re.search(r'name\s*=\s*["\']([^"\']+)', m.group(1))
        if not n:
            continue
        nombre, cuerpo = n.group(1), m.group(2)
        ops = [(re.search(r'value\s*=\s*["\']([^"\']*)', a).group(1)
                if re.search(r'value\s*=\s*["\']([^"\']*)', a) else '',
                html.unescape(t).strip(), 'selected' in a.lower())
               for a, t in re.findall(r'<option([^>]*)>\s*([^<]*)', cuerpo)]
        opciones[nombre] = [(v, t) for v, t, _ in ops if v not in ('', '-1')]
        sel = [v for v, _, s in ops if s]
        campos[nombre] = sel[0] if sel else ''
    return campos, opciones


def leer_ficha(erp_id):
    h = pedir(f'{BASE}/editar_cliente.php?id_cliente={erp_id}')
    if 'password' in h.lower()[:4000]:
        raise SystemExit('SESIÓN CAÍDA: el ERP devolvió el login. '
                         'Refrescá la cookie en erp.env y volvé a correr — '
                         'el checkpoint retoma donde quedó.')
    return parsear_ficha(h)


def indice_erp():
    """nombre normalizado -> [erp_id]. Del combo de clientes del reporte.

    El combo NO es solo fichas: trae tres pseudo-clientes que el POS usa como
    baldes de mostrador — TODOS, -1 "CLIENTES VARIOS", -2 "CLIENTE FRECUENTE
    NUEVO". El portal tiene un cliente con ese mismo nombre, así que matcheaba
    contra el -2 y un POST habría ido a un registro sintético. Solo id > 0.
    """
    idx, nombres = {}, {}
    crudo = open(f'{D}/rep_cli.html', encoding='utf-8', errors='replace').read()
    for vid, txt in re.findall(r'<option value="([^"]*)"[^>]*>([^<]*)', crudo):
        v = vid.strip()
        if v.isdigit() and int(v) > 0:
            idx.setdefault(norm(txt), []).append(v)
            nombres[v] = html.unescape(txt)      # crudo: los espacios importan
    return idx, nombres


def clasificar_duplicado(crudos):
    """Por qué dos fichas con el mismo nombre normalizado son distintas.

    'solo espacios' es el caso que rompió la ficha 21807: el ERP las considera
    clientes distintos, pero para cualquier persona son el mismo. Son las que
    conviene purgar primero.
    """
    if len({c.strip() for c in crudos}) == 1:
        return 'solo espacios'
    if len({c.strip().upper() for c in crudos}) == 1:
        return 'solo mayúsculas/minúsculas'
    return 'difieren en acentos o puntuación'


# ── Corrida ──────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--entrada', default=f'{D}/bloque_entrada.json')
    ap.add_argument('--desde-erp', type=int, default=0,
                    help='arma el bloque con las N fichas del ERP que faltan, '
                         'en vez de leer una lista del portal')
    ap.add_argument('--escribir', action='store_true')
    ap.add_argument('--limite', type=int, default=0, help='0 = todos')
    ap.add_argument('--dui-invalido', choices=('reportar', 'borrar'),
                    default='reportar',
                    help='qué hacer con un DUI que no pasa la validación')
    ap.add_argument('--pausa-lectura', type=float, default=0.4)
    ap.add_argument('--pausa-escritura', type=float, default=1.0)
    a = ap.parse_args()
    global BORRAR_DUI_INVALIDO
    BORRAR_DUI_INVALIDO = (a.dui_invalido == 'borrar')

    (erp, nombres_erp), ck = indice_erp(), cargar_checkpoint()
    if a.desde_erp:
        # Bloque armado desde el ERP: las siguientes N fichas que el checkpoint
        # no tenga con las reglas actuales, en orden de id. No hace falta
        # consultar el portal para armarlo — el espejo empareja por nombre.
        pendientes = [e for e in sorted(nombres_erp, key=int)
                      if ck.get(e, {}).get('reglas') != REGLAS]
        clientes = [{'id': f'erp:{e}', 'name': nombres_erp[e].strip(), '_erp': e}
                    for e in pendientes[:a.desde_erp]]
        print(f'catálogo: {len(nombres_erp)} fichas · pendientes: {len(pendientes)} · '
              f'este bloque: {len(clientes)}\n')
    else:
        clientes = json.load(open(a.entrada))
        if a.limite:
            clientes = clientes[:a.limite]
    if ck:
        print(f'checkpoint: {len(ck)} fichas ya resueltas en corridas anteriores\n')

    plan, ambiguos, revisiones = [], [], []
    for c in clientes:
        ids = [c['_erp']] if '_erp' in c else erp.get(norm(c['name']), [])
        if not ids:
            plan.append({**c, 'estado': 'AMBIGUO — sin match en el ERP', 'candidatos': []})
            ambiguos.append({'tipo': 'nombre', 'portal_id': c['id'], 'name': c['name'],
                             'motivo': 'sin match en el ERP', 'candidatos': []})
            continue

        # Un nombre con varias fichas se corrige EN TODAS, no se saltea: la
        # deduplicación se hace después desde el portal, y para decidir cuál
        # sobrevive conviene que las dos estén completas. Igual quedan anotadas
        # en ambiguos.json, que es la lista de trabajo de esa limpieza.
        if len(ids) > 1:
            crudos = [nombres_erp.get(i, '') for i in ids]
            ambiguos.append({'tipo': 'duplicado', 'portal_id': c['id'], 'name': c['name'],
                             'motivo': f'{len(ids)} fichas con el mismo nombre',
                             'difieren_en': clasificar_duplicado(crudos),
                             'candidatos': ids,
                             'nombres_crudos': crudos})

        for n, eid in enumerate(ids, 1):
            marca = {} if len(ids) == 1 else {'duplicado': f'{n} de {len(ids)}'}
            hecho = ck.get(str(eid))
            if hecho and hecho.get('reglas') == REGLAS:
                plan.append({**c, **marca, 'erp_id': eid, 'estado': 'YA HECHO (checkpoint)',
                             'checkpoint': hecho})
                continue

            campos, ops = leer_ficha(eid)
            cat = dict(ops.get('categoria', [])).get(campos.get('categoria', ''), '?')
            fila = {**c, **marca, 'erp_id': eid, 'categoria': cat,
                    'campos': dict(campos), 'cambios': {},
                    'portal': fila_portal(c, eid, campos, ops), 'ops': dict(ops)}

            if cat != 'Consumidor':
                fila['estado'] = f'SALTADO (categoría {cat}) — solo se guarda en el portal'
                plan.append(fila)
                time.sleep(a.pausa_lectura)
                continue

            # La semilla del distrito determinista es el id del PORTAL, así que
            # dos fichas duplicadas del mismo cliente sacan el mismo distrito.
            # Es lo que se quiere: son la misma persona.
            notas_ficha = []
            nuevos, cambios = planificar(c, campos, ops, notas_ficha)
            for n in notas_ficha:
                n['erp_id'] = eid
                n['name'] = c['name']
                revisiones.append(n)
            if 'ambiguo' in cambios.get('distrito', ''):
                _, _, hits = elegir_distrito(c['id'], campos.get('direccion', ''),
                                             ops.get('distrito', []))
                ambiguos.append({'tipo': 'distrito', 'portal_id': c['id'], 'erp_id': eid,
                                 'direccion': campos.get('direccion', ''),
                                 'candidatos': [t for _, t in hits],
                                 'elegido': cambios['distrito']})
            fila['nuevos'], fila['cambios'] = nuevos, cambios
            fila['estado'] = 'listo' if cambios else 'sin cambios'
            plan.append(fila)
            time.sleep(a.pausa_lectura)

    # ── Reporte antes de escribir ────────────────────────────────────────────
    print('═' * 78)
    print(f'PLAN DEL BLOQUE — {len(clientes)} clientes   '
          f'({"ESCRITURA" if a.escribir else "SIMULACIÓN"})')
    print('═' * 78)
    for f in plan:
        print(f'\n{f["name"][:52]}  (portal {f["id"]}, erp {f.get("erp_id","–")})')
        print(f'   {f["estado"]}')
        for k, v in f.get('cambios', {}).items():
            print(f'      · {k}: {v}')

    json.dump(ambiguos, open(f'{D}/ambiguos.json', 'w'), ensure_ascii=False, indent=1)
    json.dump(revisiones, open(f'{D}/revision_manual.json', 'w'), ensure_ascii=False, indent=1)
    print(f'\ntabla de ambiguos: {len(ambiguos)} casos -> ambiguos.json')
    print(f'para revisión manual: {len(revisiones)} casos -> revision_manual.json')

    if not a.escribir:
        json.dump(plan, open(f'{D}/bloque_plan.json', 'w'),
                  ensure_ascii=False, indent=1, default=str)
        print('(simulación — no se escribió nada, y el checkpoint quedó intacto)')
        return

    # ── Escritura + verificación + checkpoint ────────────────────────────────
    print('\n' + '═' * 78)
    print('ESCRITURA Y VERIFICACIÓN')
    print('═' * 78)
    for f in plan:
        estado = f.get('estado', '')
        # Tres caminos, y los TRES espejan al portal: se corrige, ya estaba bien,
        # o es contribuyente y no se toca en el ERP — en los tres casos el dato
        # del ERP tiene que quedar en el portal.
        if estado == 'listo':
            payload = {**f['nuevos'], 'process': 'edit', 'id_cliente': f['erp_id']}
            # `procesos/clientes.php` responde JSON con typeinfo/msg. Ignorarlo
            # costó una tarde: el ERP venía contestando "Ya se registro un
            # cliente con estos datos!" y nosotros lo leíamos como "el distrito
            # no se aplicó", persiguiendo un problema que no existía.
            cruda = pedir(f'{BASE}/procesos/clientes.php', payload)
            try:
                f['respuesta'] = json.loads(cruda)
            except ValueError:
                f['respuesta'] = {'typeinfo': 'NO-JSON', 'msg': cruda[:200]}
            if f['respuesta'].get('typeinfo') != 'Success':
                msg = f['respuesta'].get('msg', '')
                print(f'RECHAZO   {f["name"][:44]:<46} {msg}')
                # Un rechazo por duplicado es un HALLAZGO, no solo un fallo: el
                # ERP acaba de decirnos que esta ficha choca con otra. Va a la
                # lista de purga, que así detecta también los duplicados que
                # nuestro índice por nombre no ve (los que el ERP resuelve por
                # DUI o NIT, por ejemplo).
                ambiguos.append({
                    'tipo': 'rechazo-erp', 'portal_id': f['id'], 'name': f['name'],
                    'erp_id': f['erp_id'], 'motivo': msg,
                    'duplicado': 'registro' in msg.lower() or 'duplicad' in msg.lower(),
                    'cambios_intentados': f.get('cambios', {}),
                    'ts': time.strftime('%Y-%m-%d %H:%M:%S')})
            time.sleep(a.pausa_escritura)
            despues, _ = leer_ficha(f['erp_id'])
            v = verificar(f['campos'], f['nuevos'], despues)
            v['despues'] = despues
            f['verificacion'] = v
            # La fuente del espejo es la ficha RELEÍDA, no lo que quisimos escribir.
            f['portal'] = fila_portal(f, f['erp_id'], despues, f['ops'])
            print(f'{"OK " if v["ok"] else "REVISAR"}  {f["name"][:44]:<46} '
                  f'perdidos={v["perdidos"] or "ninguno"} alterados={len(v["alterados"])}')
            for x in v['alterados']:
                print(f'          ! {x}')
        elif estado == 'sin cambios' or estado.startswith('SALTADO'):
            v = {'ok': True, 'perdidos': [], 'alterados': []}
            print(f'ESPEJO   {f["name"][:44]:<46} {estado[:34]}')
        else:
            continue

        # El espejo va siempre: aunque el ERP haya rechazado la corrección, lo
        # que la ficha tiene HOY es dato válido para el portal.
        anotar_portal(f['portal'])
        # Pero un rechazo NO se marca como hecho: cuando se purgue el duplicado
        # hay que poder reintentarlo, y el checkpoint es lo único que decide eso.
        if f.get('respuesta', {}).get('typeinfo', 'Success') != 'Success':
            continue
        # El checkpoint se anota DESPUÉS de verificar y espejar, ANTES de la siguiente.
        anotar_checkpoint(ck, f['erp_id'], {
            'portal_id': f['id'], 'name': f['name'], 'ok': v['ok'], 'estado': estado,
            'cambios': f.get('cambios', {}), 'perdidos': v['perdidos'],
            'alterados': v['alterados'], 'espejado': True, 'reglas': REGLAS,
            'ts': time.strftime('%Y-%m-%d %H:%M:%S')})

    # Se reescribe: la fase de escritura pudo agregar rechazos del ERP.
    json.dump(ambiguos, open(f'{D}/ambiguos.json', 'w'), ensure_ascii=False, indent=1)
    for f in plan:
        f.pop('ops', None)          # solo hacía falta para armar el espejo
    json.dump(plan, open(f'{D}/bloque_resultado.json', 'w'),
              ensure_ascii=False, indent=1, default=str)
    ok = sum(1 for f in plan if f.get('verificacion', {}).get('ok'))
    mal = sum(1 for f in plan if f.get('verificacion') and not f['verificacion']['ok'])
    esp = sum(1 for f in plan if f.get('portal') and (
        f.get('estado') == 'listo' or f.get('estado') == 'sin cambios'
        or str(f.get('estado')).startswith('SALTADO')))
    print(f'\ncorregidos OK: {ok} · a revisar: {mal}'
          f' · saltados: {sum(1 for f in plan if "SALTADO" in str(f.get("estado")))}'
          f' · sin cambios: {sum(1 for f in plan if f.get("estado") == "sin cambios")}'
          f' · ya hechos: {sum(1 for f in plan if "YA HECHO" in str(f.get("estado")))}'
          f' · ambiguos: {len(ambiguos)}')
    print(f'espejados al portal: {esp} filas en portal_pendiente.jsonl '
          f'(pendientes de aplicar a `customers`)')
    print(f'checkpoint: {len(ck)} fichas anotadas -> {CHECKPOINT}')


if __name__ == '__main__':
    main()
