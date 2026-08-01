"""Completado de fichas del ERP por bloques.

Reglas acordadas (2026-07-31, revisadas el 2026-08-01 por DTE 2.0):
  · Consumidor: se completa con las reglas de abajo.
  · Cualquier OTRA categoría: se completa el distrito SOLO si la dirección lo
    nombra, nunca por sorteo, y nada más se toca. Hasta DTE 2.0 estas fichas se
    salteaban enteras porque un distrito inventado en un CCF se declara a
    Hacienda — eso sigue siendo cierto. Lo que cambió es que ahora el receptor
    EXIGE distrito, así que dejarla vacía tampoco es neutral: la deja inválida
    para facturar. Se completa con evidencia, y lo que no, va a una persona
    (faltantes_dte.json).
  · Distrito: si la dirección nombra uno del municipio, ese. Si no, pseudo-
    aleatorio DETERMINISTA — hash(id_cliente) % n. Queda repartido por toda la
    lista, pero el mismo cliente saca siempre el mismo, así que el bloque es
    reanudable y auditable.
  · Sin municipio ni distrito: default Chalatenango / Chalatenango Sur /
    CHALATENANGO (caso extremo, ficha sin dirección).
  · Teléfono 1: 8 dígitos, o código de país 503 + 8. Si no cumple -> 23010013.
  · DUI inválido -> se borra, registrando el original en revision_manual.json.
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
  · REINTENTO del glitch del ERP (`escribir_ficha`). En 365 escrituras el ERP
    contestó una vez "Proceso no encontrado" en texto plano, y el mismo payload
    entró a la primera al reintentarlo. A 20,000 escrituras eso son ~55 cortes
    que hoy piden una persona. Se reintenta lo que no es su formato; NO se
    reintenta un rechazo razonado ("Ya se registro un cliente…"), que no cambia
    por insistir y encima es un hallazgo, no un fallo.
  · MODO --una-pasada: leer, corregir, verificar y espejar cada ficha antes de
    mirar la siguiente. Cuesta exactamente las mismas peticiones (1,230 por
    bloque de 500) y cierra el hueco entre la lectura y la escritura, que en dos
    fases llega a 15 minutos. Como el POST manda los 21 campos, ese hueco es la
    única forma en que la corrida podría pisar una edición hecha por otra
    persona en el ERP.
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
#   4 · el DUI inválido dejó de borrarse por defecto (revertida en 5)
#   5 · vuelve a borrarse, pero el valor original SIEMPRE queda registrado
#   6 · DTE 2.0: las fichas que NO son Consumidor dejan de saltearse en seco
REGLAS = 6

# ── Qué exige el DTE 2.0 en el receptor ──────────────────────────────────────
# DTE 2.0 (ya vigente) pide distrito y teléfono en el receptor. Eso cambia el
# cálculo de esta migración: hasta ahora, no tocar una ficha era la opción
# neutral. Ya no — una ficha sin distrito queda INVÁLIDA para facturar.
#
# Medido en las 992 fichas ya espejadas: los consumidores cumplen (0 sin
# teléfono, 16 sin distrito), pero el 100% de los 82 contribuyentes está sin
# distrito, y precisamente porque la regla los salteaba.
#
# Nombres tal como los llama el formulario del ERP.
REQUIERE_DTE = ('nombre', 'telefono1', 'departamento', 'municipio', 'distrito')
REQUIERE_DTE_FISCAL = REQUIERE_DTE + ('nit', 'nrc', 'sel_giro', 'correo', 'direccion')


def faltantes_para_dte(campos, categoria):
    """Los campos que le faltan a esta ficha para que el DTE sea válido.

    Se evalúa sobre el estado FINAL (lo que va a quedar tras la corrección), no
    sobre el original: si la regla del distrito ya lo llenó, no falta.
    """
    req = REQUIERE_DTE if categoria == 'Consumidor' else REQUIERE_DTE_FISCAL
    return [k for k in req if not str(campos.get(k) or '').strip()]

# El DUI inválido se borra (decisión del 2026-08-01). Es seguro porque
# `planificar` registra el número original en revision_manual.json antes de
# vaciarlo: la ficha queda limpia y el dato sigue disponible para corregirlo.
# `--dui-invalido reportar` lo deja intacto.
BORRAR_DUI_INVALIDO = True

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

    # Un DUI que no pasa el verificador está mal, y eso es aritmética, no
    # heurística. Se borra.
    #
    # Lo que hizo falta discutir no fue el diagnóstico sino el costo: al simular
    # 500 fichas aparecieron 10 inválidos y, a diferencia del relleno tipo
    # '00000003-0' o de la fecha '13071979-0', todos tenían estructura de DUI
    # real. Son typos, y 8 de sus 9 dígitos probablemente están bien. Por eso el
    # valor original se registra SIEMPRE antes de vaciarlo — borrar dejó de ser
    # irreversible. Con `--dui-invalido reportar` no se toca.
    #
    # Dato que acotó el riesgo: esas 10 fichas son consumidor final exclusivo
    # (0 CCF), y en un DTE de consumidor final el DUI del receptor no es campo
    # requerido, así que el número incorrecto no viajaba a Hacienda.
    if dui_valido(campos.get('dui', '')) is False:
        # El valor se registra SIEMPRE, se borre o no. Eso es lo que hace que
        # "borrar" deje de ser irreversible: la ficha queda limpia y el número
        # sigue disponible para corregirlo con el cliente.
        #
        # Va por `notas` y no por `cambios` a propósito: si entrara en `cambios`
        # la ficha contaría como 'listo', se haría un POST sin nada que cambiar,
        # y la verificación buscaría un campo del formulario con ese nombre.
        if notas is not None:
            notas.append({'erp_id': None, 'campo': 'dui',
                          'valor': campos.get('dui'),
                          'accion': 'borrado' if BORRAR_DUI_INVALIDO else 'intacto',
                          'motivo': 'DUI inválido — requiere revisión manual'})
        if BORRAR_DUI_INVALIDO:
            nuevos['dui'] = ''
            cambios['dui'] = f'INVÁLIDO {campos["dui"]!r} -> se borra'

    return nuevos, cambios


def planificar_fiscal(cliente, campos, ops):
    """Para las categorías que NO son Consumidor. Núcleo puro, no toca la red.

    Antes estas fichas se salteaban enteras. Con DTE 2.0 eso dejó de ser
    neutral: el receptor necesita distrito, así que dejarla intacta la deja
    inválida para facturar. Pero el motivo por el que se salteaban sigue siendo
    cierto — un distrito SORTEADO en un CCF se declara a Hacienda.

    La salida no es elegir entre las dos: es completar SOLO lo que la dirección
    prueba. `elegir_distrito` devuelve el motivo, y acá se aceptan únicamente
    los que empiezan con 'dirección' (nombre completo o abreviatura). El
    'determinista' —que en consumidores resuelve el 78%— queda expresamente
    afuera, y esas fichas van a que las mire una persona.

    Nada más se toca: ni el teléfono, ni el DUI, ni el nombre. En una ficha
    fiscal, un dato de relleno es peor que un dato ausente.
    """
    nuevos, cambios = dict(campos), {}
    if campos.get('municipio') and not campos.get('distrito'):
        d, motivo, _ = elegir_distrito(cliente['id'], campos.get('direccion', ''),
                                       ops.get('distrito', []))
        if d and motivo.startswith('dirección'):
            etiq = dict(ops.get('distrito', []))
            nuevos['distrito'] = d
            cambios['distrito'] = f'{etiq.get(d, d)} ({motivo})'
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
def volcar_json(ruta, datos):
    """Escritura atómica. Un corte deja el archivo anterior entero, nunca uno a
    medias — y con fsync, lo que se dio por escrito sobrevive a un cierre duro.

    Importa más de lo que parece para `revision_manual.json`: ahí queda el DUI
    original ANTES de borrarlo, y es lo único que hace que borrarlo no sea
    irreversible.
    """
    tmp = f'{ruta}.tmp'
    with open(tmp, 'w') as fh:
        json.dump(datos, fh, ensure_ascii=False, indent=1, default=str)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, ruta)


def cargar_checkpoint():
    if os.path.exists(CHECKPOINT):
        with open(CHECKPOINT) as fh:
            return json.load(fh)
    return {}


def cargar_revisiones():
    """Las revisiones de las corridas ANTERIORES.

    `revision_manual.json` se escribía de cero en cada bloque, y ahí vive el
    único registro del DUI original de una ficha antes de vaciarlo — o sea, la
    razón entera por la que borrarlo se considera reversible. Un bloque nuevo
    borraba los números del anterior. No es autorreparable como `ambiguos.json`:
    un rechazo del ERP no se anota en el checkpoint y por eso se vuelve a
    encontrar solo, pero un DUI borrado SÍ se anota, así que nadie lo vuelve a
    mirar nunca. Se detectó en el bloque erp 283-1000: el archivo quedó con 12
    entradas y las 10 anteriores solo se recuperaron del git.
    """
    ruta = f'{D}/revision_manual.json'
    if os.path.exists(ruta):
        with open(ruta) as fh:
            return json.load(fh)
    return []


def cargar_faltantes():
    """El acumulado de fichas incompletas de todas las corridas.

    Es un diccionario por erp_id, no una lista: reprocesar una ficha reemplaza
    su entrada en vez de duplicarla, y una que se completó desaparece sola.
    """
    ruta = f'{D}/faltantes_dte.json'
    if os.path.exists(ruta):
        with open(ruta) as fh:
            return json.load(fh)
    return {}


def anotar_faltantes(faltantes, eid, name, categoria, nuevos):
    """Lo que le sigue faltando a la ficha para poder facturarle, tras corregir.

    Va a `faltantes_dte.json` y NO a `revision_manual.json`: ese otro archivo es
    la red del DUI borrado —el único registro de un número que se destruyó— y
    mezclarle una lista de campos vacíos le diluye el propósito.

    Es la lista de trabajo de una persona: un NIT o un NRC que no está no se
    puede deducir de nada, hay que pedírselo al cliente.
    """
    if faltantes is None:
        return
    faltan = faltantes_para_dte(nuevos, categoria)
    if not faltan:
        # Si ya no le falta nada, sale de la lista: si no, una ficha completada
        # en un bloque posterior quedaría reportada como incompleta para siempre.
        faltantes.pop(str(eid), None)
        return
    faltantes[str(eid)] = {'erp_id': str(eid), 'name': name, 'categoria': categoria,
                           'faltan': faltan}


def anotar_revision(revisiones, nota):
    """Agrega sin duplicar: la clave es (ficha, campo).

    Reprocesar una ficha —al subir REGLAS, por ejemplo— reescribe su entrada en
    vez de sumar una segunda.
    """
    clave = (str(nota.get('erp_id')), nota.get('campo'))
    for i, previa in enumerate(revisiones):
        if (str(previa.get('erp_id')), previa.get('campo')) == clave:
            revisiones[i] = nota
            return
    revisiones.append(nota)


def anotar_checkpoint(ck, erp_id, registro):
    ck[str(erp_id)] = registro
    volcar_json(CHECKPOINT, ck)


# ── Red ──────────────────────────────────────────────────────────────────────
_COOKIE = None


def _entorno():
    """Credenciales del ERP. Dos modos, y se prefiere el primero:

        ERP_USUARIO=...  +  ERP_PASSWORD=...   se re-loguea solo, no caduca
        ERP_COOKIE=PHPSESSID=...               caduca a las pocas horas

    Se leen del `.env` del repo y de `erp.env` de esta carpeta, en ese orden —
    el segundo pisa al primero. Los dos están en .gitignore.
    """
    env = {}
    for ruta in (os.path.join(D, '..', '..', '.env'), f'{D}/erp.env'):
        if not os.path.exists(ruta):
            continue
        with open(ruta) as fh:
            for linea in fh:
                linea = linea.strip()
                if linea and not linea.startswith('#') and '=' in linea:
                    k, v = linea.split('=', 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class _SinRedireccion(urllib.request.HTTPRedirectHandler):
    """El login responde 302 y la cookie viaja en el Set-Cookie de ESA respuesta.
    Si se sigue el redirect, se pierde."""

    def redirect_request(self, *a, **k):
        return None


def login():
    """Cambia usuario+contraseña por una cookie de sesión. None si no hay credenciales."""
    env = _entorno()
    usuario, clave = env.get('ERP_USUARIO'), env.get('ERP_PASSWORD')
    if not (usuario and clave):
        return None
    cuerpo = urllib.parse.urlencode(
        {'username': usuario, 'password': clave, 'm': '1'}).encode()
    req = urllib.request.Request(
        f'{BASE}/login.php', data=cuerpo,
        headers={'Content-Type': 'application/x-www-form-urlencoded',
                 'User-Agent': 'Mozilla/5.0'})
    try:
        r = urllib.request.build_opener(_SinRedireccion).open(req, timeout=45)
        cabeceras = r.headers
    except urllib.error.HTTPError as e:
        cabeceras = e.headers          # el 302 llega como "error" sin seguir el redirect
    sc = cabeceras.get('Set-Cookie')
    if not sc:
        raise SystemExit('LOGIN FALLIDO: el ERP no devolvió cookie. '
                         '¿usuario o contraseña incorrectos en erp.env?')
    return sc.split(';')[0]


def cookie():
    global _COOKIE
    if _COOKIE is None:
        _COOKIE = login() or _entorno().get('ERP_COOKIE')
        if not _COOKIE:
            raise SystemExit('erp.env no tiene ERP_USUARIO+ERP_PASSWORD ni ERP_COOKIE.')
    return _COOKIE


def _es_login(h):
    return 'password' in h.lower()[:4000]


def pedir(url, datos=None, _reintentar=True):
    cab = {'Cookie': cookie(), 'User-Agent': 'Mozilla/5.0',
           'X-Requested-With': 'XMLHttpRequest', 'Referer': f'{BASE}/admin_cliente.php'}
    cuerpo = urllib.parse.urlencode(datos).encode() if datos else None
    if cuerpo:
        cab['Content-Type'] = 'application/x-www-form-urlencoded'
    with urllib.request.urlopen(urllib.request.Request(url, data=cuerpo, headers=cab),
                                timeout=45) as r:
        h = r.read().decode('utf-8', 'replace')

    # Sesión caída a mitad de corrida: si hay credenciales, se rehace el login y
    # se repite. Un POST que devolvió el login NO se aplicó, así que reintentarlo
    # es correcto y no duplica nada. Sin credenciales, cae al mensaje de siempre.
    if _reintentar and _es_login(h) and _entorno().get('ERP_USUARIO'):
        global _COOKIE
        _COOKIE = None
        return pedir(url, datos, _reintentar=False)
    return h


# ── Escritura con reintento ──────────────────────────────────────────────────
# El ERP falla de DOS maneras y hay que tratarlas distinto:
#
#   GLITCH   contestó algo que no es su formato. Pasó una vez en 365 escrituras
#            —devolvió "Proceso no encontrado" en texto plano— y el MISMO
#            payload entró a la primera al reintentarlo. A escala de 20,000
#            escrituras son del orden de 55 cortes que hoy piden una persona
#            delante de la terminal. Se reintenta.
#   DECISIÓN contestó su JSON diciendo que no. "Ya se registro un cliente con
#            estos datos!" no cambia por insistir: reintentarlo son tres
#            peticiones para llegar a la misma respuesta, y encima tapa el
#            hallazgo (ese rechazo ES la detección de un duplicado). No se
#            reintenta.
#
# Reintentar es seguro porque el POST es idempotente: `process=edit` con un
# id_cliente fijo y los 21 campos deja la ficha igual se aplique una vez o tres.
# Y si el glitch ocurrió DESPUÉS de aplicar, el segundo intento reescribe lo
# mismo. Por eso el criterio puede ser generoso: ante la duda, reintentar.
RECHAZOS_DEFINITIVOS = ('YA SE REGISTRO', 'YA EXISTE', 'DUPLICAD')
REINTENTOS = 3
PAUSA_REINTENTO = 2.0


def clasificar_respuesta(cruda):
    """(respuesta, reintentable) a partir del cuerpo crudo que devolvió el POST.

    `norm()` para comparar el mensaje: quita acentos y puntuación, así que
    "Ya se registró" y "Ya se registro un cliente con estos datos!" caen las dos
    en el mismo patrón.
    """
    try:
        r = json.loads(cruda)
    except ValueError:
        r = None
    if not isinstance(r, dict):
        return {'typeinfo': 'NO-JSON', 'msg': (cruda or '')[:200].strip()}, True
    if r.get('typeinfo') == 'Success':
        return r, False
    return r, not any(p in norm(r.get('msg') or '') for p in RECHAZOS_DEFINITIVOS)


def escribir_ficha(payload, intentos=REINTENTOS, pausa=PAUSA_REINTENTO):
    """POST a la ficha, reintentando el glitch. Anota `intentos` en la respuesta.

    Los intentos quedan en `bloque_resultado.json`: un rechazo que sobrevivió
    tres intentos no se lee igual que uno que el ERP contestó a la primera.
    """
    respuesta = None
    for n in range(1, intentos + 1):
        cruda = pedir(f'{BASE}/procesos/clientes.php', payload)
        # `pedir` ya rehace el login una vez. Si aun así vuelve el formulario,
        # las credenciales no sirven: seguir sería escribir al vacío 500 veces.
        if _es_login(cruda):
            raise SystemExit('SESIÓN CAÍDA en plena escritura: el ERP devolvió el '
                             'login y el re-login automático no alcanzó. Revisá '
                             'ERP_USUARIO/ERP_PASSWORD en erp.env — el checkpoint '
                             'retoma donde quedó.')
        respuesta, reintentable = clasificar_respuesta(cruda)
        respuesta['intentos'] = n
        if not reintentable:
            return respuesta
        if n < intentos:
            print(f'          glitch del ERP: {respuesta.get("msg", "")[:56]!r} '
                  f'— reintento {n} de {intentos - 1}')
            time.sleep(pausa * n)      # backoff: 2s, 4s
    return respuesta


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


# ── El trabajo de UNA ficha ──────────────────────────────────────────────────
# Partido en dos mitades —planear (lee) y aplicar (escribe, verifica, espeja)—
# porque los dos modos las combinan distinto: en dos fases se planean las 500 y
# después se aplican las 500; en una pasada se planea y se aplica cada una antes
# de mirar la siguiente. El trabajo por ficha es idéntico en ambos.
def imprimir_ficha(f):
    print(f'\n{f["name"][:52]}  (portal {f["id"]}, erp {f.get("erp_id","–")})')
    print(f'   {f["estado"]}')
    for k, v in f.get('cambios', {}).items():
        print(f'      · {k}: {v}')


def planear_ficha(c, eid, marca, ambiguos, revisiones, faltantes=None):
    """Lee la ficha del ERP y decide qué se le va a mandar. Una petición."""
    campos, ops = leer_ficha(eid)
    cat = dict(ops.get('categoria', [])).get(campos.get('categoria', ''), '?')
    fila = {**c, **marca, 'erp_id': eid, 'categoria': cat,
            'campos': dict(campos), 'cambios': {},
            'portal': fila_portal(c, eid, campos, ops), 'ops': dict(ops)}

    if cat != 'Consumidor':
        # Ya no se saltea en seco: DTE 2.0 exige distrito y una ficha sin él no
        # se puede facturar. Pero solo se completa con lo que la dirección
        # PRUEBA — nunca por sorteo. Ver planificar_fiscal().
        nuevos, cambios = planificar_fiscal(c, campos, ops)
        fila['nuevos'], fila['cambios'] = nuevos, cambios
        fila['estado'] = ('listo' if cambios else
                          f'SIN EVIDENCIA (categoría {cat}) — no se inventa nada')
        anotar_faltantes(faltantes, eid, c['name'], cat, nuevos)
        return fila

    # La semilla del distrito determinista es el id del PORTAL, así que dos
    # fichas duplicadas del mismo cliente sacan el mismo distrito. Es lo que se
    # quiere: son la misma persona.
    notas_ficha = []
    nuevos, cambios = planificar(c, campos, ops, notas_ficha)
    for n in notas_ficha:
        n['erp_id'] = eid
        n['name'] = c['name']
        anotar_revision(revisiones, n)
    if 'ambiguo' in cambios.get('distrito', ''):
        _, _, hits = elegir_distrito(c['id'], campos.get('direccion', ''),
                                     ops.get('distrito', []))
        ambiguos.append({'tipo': 'distrito', 'portal_id': c['id'], 'erp_id': eid,
                         'direccion': campos.get('direccion', ''),
                         'candidatos': [t for _, t in hits],
                         'elegido': cambios['distrito']})
    fila['nuevos'], fila['cambios'] = nuevos, cambios
    fila['estado'] = 'listo' if cambios else 'sin cambios'
    anotar_faltantes(faltantes, eid, c['name'], cat, nuevos)
    return fila


def aplicar_ficha(f, ck, ambiguos, a):
    """Escribe, verifica, espeja y anota en el checkpoint. Dos peticiones más.

    Tres caminos, y los TRES espejan al portal: se corrige, ya estaba bien, o es
    contribuyente y no se toca en el ERP — en los tres casos el dato del ERP
    tiene que quedar en el portal.
    """
    estado = f.get('estado', '')
    if estado == 'listo':
        payload = {**f['nuevos'], 'process': 'edit', 'id_cliente': f['erp_id']}
        # `procesos/clientes.php` responde JSON con typeinfo/msg. Ignorarlo
        # costó una tarde: el ERP venía contestando "Ya se registro un cliente
        # con estos datos!" y nosotros lo leíamos como "el distrito no se
        # aplicó", persiguiendo un problema que no existía.
        f['respuesta'] = escribir_ficha(payload, pausa=a.pausa_reintento)
        if f['respuesta'].get('typeinfo') != 'Success':
            msg, n = f['respuesta'].get('msg', ''), f['respuesta'].get('intentos', 1)
            print(f'RECHAZO   {f["name"][:44]:<46} {msg[:60]}'
                  f'{"" if n == 1 else f"   ({n} intentos)"}')
            # Un rechazo por duplicado es un HALLAZGO, no solo un fallo: el ERP
            # acaba de decirnos que esta ficha choca con otra. Va a la lista de
            # purga, que así detecta también los duplicados que nuestro índice
            # por nombre no ve (los que el ERP resuelve por DUI o NIT).
            ambiguos.append({
                'tipo': 'rechazo-erp', 'portal_id': f['id'], 'name': f['name'],
                'erp_id': f['erp_id'], 'motivo': msg, 'intentos': n,
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
    elif estado == 'sin cambios' or estado.startswith(('SALTADO', 'SIN EVIDENCIA')):
        v = {'ok': True, 'perdidos': [], 'alterados': []}
        print(f'ESPEJO   {f["name"][:44]:<46} {estado[:34]}')
    else:
        return

    # El espejo va siempre: aunque el ERP haya rechazado la corrección, lo que
    # la ficha tiene HOY es dato válido para el portal.
    anotar_portal(f['portal'])
    # Pero un rechazo NO se marca como hecho: cuando se purgue el duplicado hay
    # que poder reintentarlo, y el checkpoint es lo único que decide eso.
    if f.get('respuesta', {}).get('typeinfo', 'Success') != 'Success':
        return
    # El checkpoint se anota DESPUÉS de verificar y espejar, ANTES de la siguiente.
    anotar_checkpoint(ck, f['erp_id'], {
        'portal_id': f['id'], 'name': f['name'], 'ok': v['ok'], 'estado': estado,
        'cambios': f.get('cambios', {}), 'perdidos': v['perdidos'],
        'alterados': v['alterados'], 'espejado': True, 'reglas': REGLAS,
        'ts': time.strftime('%Y-%m-%d %H:%M:%S')})


# ── Corrida ──────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--entrada', default=f'{D}/bloque_entrada.json')
    ap.add_argument('--desde-erp', type=int, default=0,
                    help='arma el bloque con las N fichas del ERP que faltan, '
                         'en vez de leer una lista del portal')
    ap.add_argument('--escribir', action='store_true')
    ap.add_argument('--limite', type=int, default=0, help='0 = todos')
    ap.add_argument('--dui-invalido', choices=('borrar', 'reportar'),
                    default='borrar',
                    help='qué hacer con un DUI que no pasa la validación')
    ap.add_argument('--una-pasada', action='store_true',
                    help='leer, corregir, verificar y espejar cada ficha antes '
                         'de pasar a la siguiente, en vez de planear el bloque '
                         'entero y después escribirlo. Mismas peticiones; cierra '
                         'el hueco entre la lectura y la escritura')
    ap.add_argument('--pausa-lectura', type=float, default=0.4)
    ap.add_argument('--pausa-escritura', type=float, default=1.0)
    ap.add_argument('--pausa-reintento', type=float, default=PAUSA_REINTENTO)
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

    # Una pasada solo tiene sentido escribiendo: es justo el hueco entre leer y
    # escribir lo que cierra. En simulación no hay escritura que acercar, así
    # que el modo se ignora y la corrida es la de siempre.
    una_pasada = a.una_pasada and a.escribir
    titulo = ('UNA PASADA — leer, corregir, verificar y espejar ficha por ficha'
              if una_pasada else 'PLAN DEL BLOQUE')
    print('═' * 78)
    print(f'{titulo} — {len(clientes)} clientes   '
          f'({"ESCRITURA" if a.escribir else "SIMULACIÓN"})')
    print('═' * 78)

    # `ambiguos` arranca vacío a propósito: sus hallazgos son autorreparables
    # (un rechazo del ERP no se anota en el checkpoint, así que la próxima
    # corrida lo vuelve a encontrar). `revisiones` NO — ver cargar_revisiones().
    plan, ambiguos, revisiones = [], [], cargar_revisiones()
    faltantes = cargar_faltantes()
    if revisiones:
        print(f'revisión manual: {len(revisiones)} casos de corridas anteriores '
              f'(se conservan)\n')
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

            f = planear_ficha(c, eid, marca, ambiguos, revisiones, faltantes)
            plan.append(f)
            if una_pasada:
                imprimir_ficha(f)
                # A disco ANTES de tocar el ERP. En dos fases estos dos archivos
                # se escriben enteros al terminar de planear, o sea antes de la
                # primera escritura; acá no existe ese momento, así que se
                # vuelcan por ficha. No es cosmético: `revision_manual.json` es
                # donde queda el DUI original antes de borrarlo, y un corte
                # entre el POST y el volcado lo perdería para siempre.
                volcar_json(f'{D}/revision_manual.json', revisiones)
                volcar_json(f'{D}/ambiguos.json', ambiguos)
                volcar_json(f'{D}/faltantes_dte.json', faltantes)
                aplicar_ficha(f, ck, ambiguos, a)
            time.sleep(a.pausa_lectura)

    # ── Reporte ──────────────────────────────────────────────────────────────
    if not una_pasada:
        for f in plan:
            imprimir_ficha(f)

    volcar_json(f'{D}/ambiguos.json', ambiguos)
    volcar_json(f'{D}/revision_manual.json', revisiones)
    volcar_json(f'{D}/faltantes_dte.json', faltantes)
    print(f'\ntabla de ambiguos: {len(ambiguos)} casos -> ambiguos.json')
    print(f'para revisión manual: {len(revisiones)} casos -> revision_manual.json')
    fisc = sum(1 for v in faltantes.values() if v['categoria'] != 'Consumidor')
    print(f'incompletas para DTE 2.0: {len(faltantes)} fichas '
          f'({fisc} de ellas fiscales) -> faltantes_dte.json')

    if not a.escribir:
        volcar_json(f'{D}/bloque_plan.json', plan)
        print('(simulación — no se escribió nada, y el checkpoint quedó intacto)')
        return

    # ── Escritura + verificación + checkpoint ────────────────────────────────
    # En una pasada ya está todo aplicado: cada ficha se escribió al leerla.
    if not una_pasada:
        print('\n' + '═' * 78)
        print('ESCRITURA Y VERIFICACIÓN')
        print('═' * 78)
        for f in plan:
            aplicar_ficha(f, ck, ambiguos, a)

    # Se reescribe: la escritura pudo agregar rechazos del ERP.
    volcar_json(f'{D}/ambiguos.json', ambiguos)
    for f in plan:
        f.pop('ops', None)          # solo hacía falta para armar el espejo
    volcar_json(f'{D}/bloque_resultado.json', plan)
    ok = sum(1 for f in plan if f.get('verificacion', {}).get('ok'))
    mal = sum(1 for f in plan if f.get('verificacion') and not f['verificacion']['ok'])
    esp = sum(1 for f in plan if f.get('portal') and (
        f.get('estado') == 'listo' or f.get('estado') == 'sin cambios'
        or str(f.get('estado')).startswith('SALTADO')))
    print(f'\ncorregidos OK: {ok} · a revisar: {mal}'
          f' · sin evidencia: {sum(1 for f in plan if "SIN EVIDENCIA" in str(f.get("estado")))}'
          f' · sin cambios: {sum(1 for f in plan if f.get("estado") == "sin cambios")}'
          f' · ya hechos: {sum(1 for f in plan if "YA HECHO" in str(f.get("estado")))}'
          f' · ambiguos: {len(ambiguos)}')
    print(f'espejados al portal: {esp} filas en portal_pendiente.jsonl '
          f'(pendientes de aplicar a `customers`)')
    print(f'checkpoint: {len(ck)} fichas anotadas -> {CHECKPOINT}')


if __name__ == '__main__':
    main()
