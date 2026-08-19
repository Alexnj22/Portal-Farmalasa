#!/usr/bin/env python3
"""
Agente de impresión de la caja — Portal Farmalasa.

Pregunta cada dos segundos si hay papel esperando para ESTA sala y le escribe
los bytes a la ticketera. Corre en la computadora de la caja.

── Por qué existe ────────────────────────────────────────────────────────────
El portal imprime mandando el ticket a `http://localhost` de la computadora que
tiene el navegador abierto. Eso alcanza sólo a esa máquina y **no puede alcanzar
otra**: apuntar a la IP de la caja es contenido mixto y el navegador lo corta;
la exención vale sólo para `localhost` y no se hereda a una IP.

Consecuencia: quien confirma un corte desde el teléfono —que es donde llega el
aviso— no tenía forma de que saliera papel, y quien resuelve una diferencia
desde la oficina imprimía ahí el comprobante que debía firmarse en la sala.

Con este agente, el portal deja el documento en una cola con su sucursal y el
papel sale acá. Y de paso cierra el lazo del acuse: por el camino directo, un
«ok» significa «el programa recibió el pedido», nunca «salió papel». Acá se
contesta si el comando funcionó.

── Por dónde escribe, y por qué NO por CUPS ─────────────────────────────────
**El sistema de facturación escribe directo a `/dev/usb/lp0`**, sin CUPS y sin
cola —está leído en su propio código—. Y esa misma ticketera no se puede tener
abierta de las dos maneras: cuando CUPS manda un trabajo, su backend `usb`
RECLAMA la interfaz USB y desengancha el módulo `usblp` del kernel, que es
justamente el que crea `/dev/usb/lp0`. Al terminar debería devolverlo y muchas
veces no lo hace: el archivo queda muerto y **el otro sistema deja de imprimir
hasta que alguien apaga y prende la ticketera**, que es lo que la vuelve a
enumerar.

Reportado en Salud 1 el 2026-08-19, la mañana que se instaló el agente ahí:
«si imprimo desde el portal, deja de imprimir el ERP». No era un byte del
ticket — era el canal.

Por eso el agente escribe al MISMO archivo que el otro programa y CUPS queda
sólo de respaldo, para una caja donde ese dispositivo no exista o no se pueda
escribir. Es el canal que el sistema de facturación usa todos los días en esas
cajas, así que no hay que probarlo desde cero.

── Lo que NO hace ───────────────────────────────────────────────────────────
No maqueta. El contenido ya viene con sus columnas y sus códigos de impresora
adentro, igual que lo que recibe el programa del sistema de facturación. Si
supiera de columnas habría dos maquetadores que mantener parecidos, y la
diferencia sólo se vería en el papel.

── Instalación ──────────────────────────────────────────────────────────────
Ver README.md en esta misma carpeta.
"""

import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

# Los archivos de la ticketera, en orden. Se usa el PRIMERO que exista: el
# número depende de en qué puerto la enchufaron y de qué otras impresoras vio
# antes esa computadora, así que buscar uno solo falla en la caja que no lo
# tiene en cero. `DISPOSITIVO=` vacío en agente.conf lo apaga y fuerza CUPS.
DISPOSITIVO_POR_DEFECTO = "/dev/usb/lp0,/dev/usb/lp1,/dev/usb/lp2,/dev/lp0"

# De dónde se baja la versión nueva de este mismo archivo. Es el portal, servido
# por HTTPS desde su propio dominio: quien controle esa dirección puede correr
# código en las cajas, así que no puede ser un lugar cualquiera.
PORTAL_POR_DEFECTO = "https://portal.farmasalud.lat"
RUTA_PUBLICADA = "/agente-impresion/"
# Cada cuánto se pregunta si hay versión nueva. No hace falta más seguido: el
# día que sale una corrección, media hora de demora no cambia nada, y una
# consulta cada 15 minutos por caja no se nota en ningún registro.
INTERVALO_ACTUALIZAR_SEG = 900
# Piso de tamaño para no instalar una respuesta truncada o una página de error
# que igual traiga el hash correcto por casualidad. El agente pesa ~14 KB.
MINIMO_BYTES_AGENTE = 4000

INTERVALO_SEG = 2.0
# Al fallar la red no se pregunta más rápido: si el portal está caído, mil
# consultas por minuto no lo levantan y sí llenan su registro.
INTERVALO_ERROR_SEG = 15.0
TIMEOUT_SEG = 20


def config():
    """Los cuatro datos que necesita. Salen del entorno o de agente.conf."""
    cfg = {}
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agente.conf")
    if os.path.exists(ruta):
        with open(ruta, "r", encoding="utf-8") as f:
            for linea in f:
                linea = linea.strip()
                if not linea or linea.startswith("#") or "=" not in linea:
                    continue
                k, v = linea.split("=", 1)
                cfg[k.strip()] = v.strip()

    for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "DEVICE_ID", "DEVICE_TOKEN"):
        if os.environ.get(k):
            cfg[k] = os.environ[k]

    faltan = [k for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "DEVICE_ID", "DEVICE_TOKEN")
              if not cfg.get(k)]
    if faltan:
        sys.exit("Falta configurar: " + ", ".join(faltan) + "\nVer README.md")

    # El corte del final es opcional y viene apagado **porque el ticket ya trae
    # el suyo**: desde v2.661.9 el portal cierra los bytes de la cola con
    # `GS V '1'` (corte parcial), que es el mismo que usan los tickets del otro
    # sistema en esas cajas. Encender esto agrega un SEGUNDO corte, y ademas
    # total (`GS V 0`). Queda solo por si alguna caja recibe tickets de una
    # version vieja del portal, que no lo traian.
    cfg["CORTAR"] = str(cfg.get("CORTAR", "0")).lower() in ("1", "true", "si", "sí")

    # Sin la clave escrita se usan los archivos de siempre. Escrita y vacía
    # (`DISPOSITIVO=`) se apaga a proposito y todo va por CUPS — es la escotilla
    # para una caja donde la ticketera no cuelgue de USB.
    cfg["DISPOSITIVO"] = [r.strip() for r
                          in cfg.get("DISPOSITIVO", DISPOSITIVO_POR_DEFECTO).split(",")
                          if r.strip()]

    # `PORTAL_URL=` vacío apaga la actualización sola. Existe para una caja que
    # no deba tocarse sin aviso, no para "probar sin actualizar".
    cfg["PORTAL_URL"] = cfg.get("PORTAL_URL", PORTAL_POR_DEFECTO).strip().rstrip("/")
    return cfg


def rpc(cfg, nombre, cuerpo):
    """Llama una función del portal. El agente NUNCA usa la llave de servicio:
    se identifica con dispositivo + token, igual que el kiosco."""
    url = cfg["SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/" + nombre
    datos = json.dumps(cuerpo).encode("utf-8")
    req = urllib.request.Request(url, data=datos, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("apikey", cfg["SUPABASE_ANON_KEY"])
    req.add_header("Authorization", "Bearer " + cfg["SUPABASE_ANON_KEY"])
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEG) as r:
        cuerpo_resp = r.read().decode("utf-8") or "null"
    return json.loads(cuerpo_resp)


def bytes_del_ticket(job):
    """Los bytes que van a la ticketera.

    Viajan en base64 porque **un ticket es un flujo de bytes, no un texto**: la
    letra normal se pide con `ESC ! \\x00` y ese NUL no cabe en una columna
    `text` de Postgres. Hasta el 17-ago-2026 la cola guardaba texto, asi que
    PostgREST rechazaba TODO documento con 400 («unsupported Unicode escape
    sequence») y la cola nunca llego a tener una sola fila — el portal caia al
    dialogo del navegador y el papel salia en la computadora equivocada.

    `contenido` en texto plano es el formato viejo y se sigue aceptando a
    proposito: asi este agente funciona tambien contra una base todavia sin
    migrar, y la caja se puede actualizar ANTES de tocar el portal sin que
    quede ni un minuto tirando papel en blanco. Se puede borrar cuando todas
    las cajas esten al dia.
    """
    b64 = job.get("contenido_b64")
    if b64:
        return base64.b64decode(b64)
    # latin-1: el rollo interpreta un codepage de un byte y el portal ya
    # transcribio todo a ASCII antes de encolarlo. `errors="replace"` es la red
    # por si algo se escapo — un signo de pregunta se ve, una excepcion dejaria
    # el ticket sin salir.
    return (job.get("contenido") or "").encode("latin-1", errors="replace")


def elegir_dispositivo(rutas):
    """El primer archivo de ticketera que exista, o None."""
    for r in rutas:
        if r and os.path.exists(r):
            return r
    return None


def rescatar_dispositivo(rutas):
    """Le devuelve el dispositivo al kernel cuando CUPS se lo quedó.

    **Esto es lo que rompe el círculo.** El backend `usb` de CUPS desengancha el
    módulo `usblp` para hablarle a la impresora, y al terminar no siempre lo
    devuelve: el archivo `/dev/usb/lp0` desaparece. Entonces este agente no lo
    encuentra, cae a CUPS, y CUPS se lo vuelve a quedar. La sala sale de ahí
    apagando y prendiendo la ticketera — que es re-enumerar el aparato a mano.

    Recargar el módulo hace lo mismo sin tocar el aparato, y se puede porque
    este agente corre como servicio del sistema. Si falla —el módulo está en
    uso, no hay `modprobe`, la computadora no lo permite— no pasa nada: se anota
    y se sigue por CUPS, igual que antes.

    Medido en Salud 1 el 2026-08-19: el agente ya actualizado seguía informando
    `CUPS` porque el archivo no existía al arrancar, y el sistema de facturación
    seguía sin imprimir hasta que alguien apagaba la ticketera.
    """
    try:
        subprocess.run(["modprobe", "-r", "usblp"], capture_output=True, timeout=15)
        subprocess.run(["modprobe", "usblp"], capture_output=True, timeout=15)
    except Exception as e:                                    # noqa: BLE001
        return None, "no se pudo recargar usblp ({})".format(e)[:200]
    # El kernel crea el archivo un instante despues de cargar el modulo.
    for _ in range(10):
        ruta = elegir_dispositivo(rutas)
        if ruta:
            return ruta, "se recupero {} (lo tenia tomado CUPS)".format(ruta)
        time.sleep(0.3)
    return None, None


def escribir_al_dispositivo(datos, ruta):
    """Los bytes al archivo de la ticketera. Devuelve (ok, detalle).

    Va por `dd` y no por un `open()` de Python **para poder ponerle plazo**: una
    escritura a un dispositivo que no responde se queda colgada para siempre, y
    con ella la cola entera de la sala. Un subproceso se puede matar; un
    `write()` bloqueado adentro de este proceso, no.

    `conv=notrunc` porque un archivo de dispositivo no se trunca, y pedirlo
    seria pedirle algo que no significa nada.
    """
    try:
        p = subprocess.run(
            ["dd", "of=" + ruta, "conv=notrunc", "status=none"],
            input=datos, capture_output=True, timeout=30,
        )
        if p.returncode != 0:
            return False, (p.stderr or b"").decode("utf-8", "replace")[:300] or "dd fallo"
        return True, "escrito en " + ruta
    except subprocess.TimeoutExpired:
        return False, "la ticketera no acepto los bytes en 30 segundos"
    except Exception as e:                                   # noqa: BLE001
        return False, "{}: {}".format(type(e).__name__, e)[:300]


def imprimir_por_cups(datos, impresora):
    """El respaldo. Devuelve (ok, detalle).

    `-o raw` es el único modo probado en esa impresora: el controlador de CUPS
    para POS nunca se verificó acá, y el modo crudo ya sacó papel legible.

    **No es el camino preferido**, y no por velocidad: el backend `usb` de CUPS
    desengancha el `usblp` del kernel y deja sin `/dev/usb/lp0` al sistema de
    facturación, que imprime por ahí. Ver el encabezado del archivo.
    """
    try:
        p = subprocess.run(
            ["lp", "-d", impresora, "-o", "raw"],
            input=datos, capture_output=True, timeout=60,
        )
        if p.returncode != 0:
            return False, (p.stderr or b"").decode("utf-8", "replace")[:400] or "lp fallo"
        return True, "por CUPS ({}) {}".format(
            impresora, (p.stdout or b"").decode("utf-8", "replace")[:150]).strip()
    except FileNotFoundError:
        return False, "No existe el comando `lp`: falta CUPS en esta computadora."
    except subprocess.TimeoutExpired:
        return False, "`lp` no volvio en 60 segundos."
    except Exception as e:                                   # noqa: BLE001
        return False, "{}: {}".format(type(e).__name__, e)[:400]


def imprimir(datos, impresora, cortar, rutas):
    """Manda los bytes a la ticketera y devuelve (ok, detalle).

    Primero el archivo del dispositivo —el mismo al que le escribe el sistema de
    facturación—, y sólo si eso no se puede, CUPS. El orden importa y está
    explicado en el encabezado del archivo: al reves, imprimir desde el portal
    deja al otro sistema sin ticketera hasta que alguien la apaga y la prende.

    Y si el archivo no está, **primero se intenta recuperarlo**. No estar es el
    sintoma normal de que CUPS se lo quedó, y caer a CUPS en ese momento es
    justamente lo que lo mantiene tomado.
    """
    if cortar:
        datos += b"\x1dV\x00"       # GS V 0 — corte total

    aviso = None
    ruta = elegir_dispositivo(rutas)
    if not ruta and rutas:
        ruta, aviso = rescatar_dispositivo(rutas)

    if ruta:
        ok, detalle = escribir_al_dispositivo(datos, ruta)
        if ok:
            return True, " · ".join(x for x in (detalle, aviso) if x)
        # El motivo del dispositivo VIAJA con el del respaldo: si un dia todas
        # las cajas terminan imprimiendo por CUPS, eso tiene que poder leerse en
        # el portal en vez de descubrirse cuando el otro sistema se cae.
        ok2, detalle2 = imprimir_por_cups(datos, impresora)
        return ok2, "{} (fallo {}: {})".format(detalle2, ruta, detalle)[:400]

    ok2, detalle2 = imprimir_por_cups(datos, impresora)
    falta = aviso or "no hay ningun archivo de ticketera ({})".format(", ".join(rutas) or "ninguno")
    return ok2, "{} — {}".format(detalle2, falta)[:400]


# ── Actualizarse solo ────────────────────────────────────────────────────────
#
# Por qué existe: los agentes NO se pueden actualizar a distancia por ningún
# otro camino — lo único que ejecutan es el comando de imprimir, y eso es a
# propósito (un ticket no puede convertirse en una orden). La primera vez hay
# que tocar cada caja; con esto, es la última.
#
# Lo que se compara es el HASH del archivo, no un número de versión escrito a
# mano: un número hay que acordarse de subirlo, y el día que alguien no lo sube
# las cajas creen estar al día con código viejo. El hash no se puede olvidar.


def hash_de(datos):
    return hashlib.sha256(datos).hexdigest()


def mi_hash():
    """El hash del archivo que se está ejecutando AHORA."""
    with open(os.path.abspath(__file__), "rb") as f:
        return hash_de(f.read())


def bajar(url, timeout=30):
    req = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def instalar_version_nueva(cfg, actual):
    """Baja el agente publicado y lo instala si es otro. Devuelve (cambio, aviso).

    Cuatro frenos, y ninguno es de más — una actualización mala llega a las
    cinco cajas a la vez:

      1. El hash de lo bajado tiene que ser el publicado (un despliegue a medias
         sirve un archivo que no corresponde a su hash).
      2. Tiene que pesar algo: una página de error no se instala.
      3. Tiene que COMPILAR.
      4. Tiene que ARRANCAR: se corre el archivo nuevo con `--autoprueba`, que
         carga la configuración y sale. Sin esto, un error que sólo aparece al
         ejecutar deja a la caja reiniciándose cada diez segundos para siempre,
         y sin imprimir.

    La versión anterior queda al lado como `.anterior`, para poder volver con un
    `cp` desde la terminal de la sala.
    """
    base = cfg["PORTAL_URL"] + RUTA_PUBLICADA
    publicado = bajar(base + "agente.sha256", timeout=15).decode("ascii", "replace").strip()[:64]
    if not publicado or publicado == actual:
        return False, None

    datos = bajar(base + "agente.py")
    if hash_de(datos) != publicado:
        return False, "la copia publicada no coincide con su hash; no se instala"
    if len(datos) < MINIMO_BYTES_AGENTE:
        return False, "el archivo publicado pesa {} bytes; no se instala".format(len(datos))
    try:
        compile(datos, "agente.py", "exec")
    except SyntaxError as e:
        return False, "el archivo publicado no compila ({}); no se instala".format(e)

    ruta = os.path.abspath(__file__)
    tmp = os.path.join(tempfile.gettempdir(), "agente-nuevo-{}.py".format(publicado[:12]))
    with open(tmp, "wb") as f:
        f.write(datos)
    # La configuracion viaja por ENTORNO y no por el archivo: el ejemplar de
    # prueba vive en /tmp y ahi no hay ningun `agente.conf`, asi que sin esto la
    # prueba fallaria SIEMPRE y ninguna caja se actualizaria nunca. (El token va
    # en el entorno del hijo, no en su linea de comando: la linea la ve
    # cualquiera con un `ps`.)
    entorno = dict(os.environ)
    for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "DEVICE_ID", "DEVICE_TOKEN"):
        entorno[k] = cfg[k]
    try:
        p = subprocess.run([sys.executable, tmp, "--autoprueba"],
                           capture_output=True, timeout=30, env=entorno,
                           cwd=os.path.dirname(ruta))
        if p.returncode != 0:
            return False, "la version nueva no arranca ({}); no se instala".format(
                (p.stderr or b"").decode("utf-8", "replace").strip()[:200])
    except Exception as e:                                    # noqa: BLE001
        return False, "no se pudo probar la version nueva ({}); no se instala".format(e)
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass

    try:
        with open(ruta, "rb") as f:
            anterior = f.read()
        with open(ruta + ".anterior", "wb") as f:
            f.write(anterior)
        # A un archivo abierto no se le escribe encima mientras corre: se escribe
        # al lado y se renombra, que es atomico.
        provisorio = ruta + ".nuevo"
        with open(provisorio, "wb") as f:
            f.write(datos)
        os.chmod(provisorio, os.stat(ruta).st_mode)
        os.replace(provisorio, ruta)
    except OSError as e:
        return False, "no se pudo escribir la version nueva ({})".format(e)

    return True, "version nueva instalada ({} → {})".format(actual[:12], publicado[:12])


def reclamar(cfg, version, canal):
    """Pide trabajos y, de paso, cuenta qué versión corre y por dónde escribe.

    El agente puede quedar más nuevo que la base —es el orden que se usó siempre
    acá: primero la caja, después el portal—, así que si la función todavía no
    acepta esos dos datos se la llama como antes. Un agente que no puede
    informar su versión igual tiene que imprimir.
    """
    cuerpo = {"p_device": cfg["DEVICE_ID"], "p_token": cfg["DEVICE_TOKEN"],
              "p_version": version[:12], "p_canal": canal}
    try:
        return rpc(cfg, "reclamar_impresion", cuerpo)
    except urllib.error.HTTPError as e:
        if e.code not in (400, 404):
            raise
        return rpc(cfg, "reclamar_impresion",
                   {"p_device": cfg["DEVICE_ID"], "p_token": cfg["DEVICE_TOKEN"]})


def main():
    # `--autoprueba` es lo que corre la version en curso ANTES de instalar
    # ésta: carga la configuracion y sale. Si algo revienta al arrancar, revienta
    # acá y la version vieja se queda donde está.
    if "--autoprueba" in sys.argv:
        config()
        print("autoprueba ok", flush=True)
        return 0

    cfg = config()
    version = mi_hash()
    print("Agente de impresion en marcha. Caja {}. Version {}. Escribe en: {}. "
          "Ctrl-C para salir."
          .format(cfg["DEVICE_ID"][:8], version[:12],
                  elegir_dispositivo(cfg["DISPOSITIVO"]) or "CUPS (no hay dispositivo)"),
          flush=True)

    espera = INTERVALO_SEG
    # Se revisa apenas arranca: una caja que se prende a la mañana se pone al
    # dia sola antes del primer ticket del dia.
    proxima_revision = 0.0
    while True:
        try:
            # El canal se mira EN CADA VUELTA y no una vez al arrancar: el
            # archivo del dispositivo aparece y desaparece con quien lo tenga
            # tomado, asi que una foto del arranque miente en la pantalla — y
            # justamente miente en el caso que importa.
            filas = reclamar(cfg, version,
                             elegir_dispositivo(cfg["DISPOSITIVO"]) or "CUPS")
            espera = INTERVALO_SEG

            # Sin trabajos la cola contesta una lista vacia: es lo normal, no un
            # error, y no se imprime nada en la consola para que el registro no
            # crezca con 30 lineas por minuto diciendo que no pasa nada.
            if not filas:
                # La actualizacion se mira SOLO con la cola vacia: cambiar el
                # archivo con un ticket en la mano es reiniciar en medio de una
                # impresion.
                if cfg["PORTAL_URL"] and time.monotonic() >= proxima_revision:
                    proxima_revision = time.monotonic() + INTERVALO_ACTUALIZAR_SEG
                    try:
                        cambio, aviso = instalar_version_nueva(cfg, version)
                    except Exception as e:                    # noqa: BLE001
                        # Que el portal no conteste no es motivo para dejar de
                        # imprimir: se anota y se sigue con la version de hoy.
                        cambio, aviso = False, "no se pudo revisar la version: {}".format(e)[:200]
                    if aviso:
                        print("  " + aviso, flush=True)
                    if cambio:
                        # Salir con 0 alcanza: systemd tiene Restart=always y lo
                        # levanta en diez segundos con el archivo nuevo.
                        print("Reiniciando con la version nueva.", flush=True)
                        return 0
                time.sleep(espera)
                continue

            for job in filas:
                try:
                    datos = bytes_del_ticket(job)
                except Exception as e:                        # noqa: BLE001
                    # Un documento ilegible no se imprime en blanco ni se
                    # reintenta tres veces: se confiesa, y queda a la vista en
                    # el portal con su motivo.
                    ok, detalle = False, "Documento ilegible: {}".format(e)[:400]
                else:
                    ok, detalle = imprimir(
                        datos, job.get("impresora") or "pos-80", cfg["CORTAR"],
                        cfg["DISPOSITIVO"],
                    )
                print("[{}] {} — {}".format(
                    job.get("id"), job.get("titulo"),
                    "impreso" if ok else "FALLO: " + detalle), flush=True)

                # El acuse va SIEMPRE, salga bien o mal. Un trabajo que se
                # imprimio y no se confirma vuelve a la cola a los dos minutos y
                # sale dos veces; uno que fallo y no se confirma queda trabado.
                try:
                    rpc(cfg, "confirmar_impresion", {
                        "p_device": cfg["DEVICE_ID"], "p_token": cfg["DEVICE_TOKEN"],
                        "p_id": job.get("id"), "p_ok": bool(ok),
                        "p_error": None if ok else detalle,
                    })
                except Exception as e:                        # noqa: BLE001
                    print("  no se pudo avisar al portal: {}".format(e), flush=True)

        except KeyboardInterrupt:
            print("\nAgente detenido.", flush=True)
            return 0
        except urllib.error.HTTPError as e:
            cuerpo = e.read().decode("utf-8", "replace")[:300]
            print("Error del portal ({}): {}".format(e.code, cuerpo), flush=True)
            espera = INTERVALO_ERROR_SEG
        except Exception as e:                                # noqa: BLE001
            print("Sin conexion con el portal: {}: {}".format(type(e).__name__, e), flush=True)
            espera = INTERVALO_ERROR_SEG

        time.sleep(espera)


if __name__ == "__main__":
    sys.exit(main())
