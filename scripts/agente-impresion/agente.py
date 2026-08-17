#!/usr/bin/env python3
"""
Agente de impresión de la caja — Portal Farmalasa.

Pregunta cada dos segundos si hay papel esperando para ESTA sala y lo tubea a
la ticketera con `lp -o raw`. Corre en la computadora de la caja.

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

── Lo que NO hace ───────────────────────────────────────────────────────────
No maqueta. El contenido ya viene con sus columnas y sus códigos de impresora
adentro, igual que lo que recibe el programa del sistema de facturación. Si
supiera de columnas habría dos maquetadores que mantener parecidos, y la
diferencia sólo se vería en el papel.

── Instalación ──────────────────────────────────────────────────────────────
Ver README.md en esta misma carpeta.
"""

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

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

    # El corte del final es opcional y viene apagado: la ticketera de las salas
    # ya corta sola al terminar el trabajo (medido con `lp -o raw`). Se enciende
    # sólo si el papel sale sin cortarse.
    cfg["CORTAR"] = str(cfg.get("CORTAR", "0")).lower() in ("1", "true", "si", "sí")
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


def imprimir(datos, impresora, cortar):
    """Manda los bytes a la ticketera y devuelve (ok, detalle).

    `-o raw` es el único modo probado en esa impresora: el controlador de CUPS
    para POS nunca se verificó acá, y el modo crudo ya sacó papel legible.
    """
    if cortar:
        datos += b"\x1dV\x00"       # GS V 0 — corte total
    try:
        p = subprocess.run(
            ["lp", "-d", impresora, "-o", "raw"],
            input=datos, capture_output=True, timeout=60,
        )
        if p.returncode != 0:
            return False, (p.stderr or b"").decode("utf-8", "replace")[:400] or "lp fallo"
        return True, (p.stdout or b"").decode("utf-8", "replace")[:200]
    except FileNotFoundError:
        return False, "No existe el comando `lp`: falta CUPS en esta computadora."
    except subprocess.TimeoutExpired:
        return False, "`lp` no volvio en 60 segundos."
    except Exception as e:                                   # noqa: BLE001
        return False, "{}: {}".format(type(e).__name__, e)[:400]


def main():
    cfg = config()
    print("Agente de impresion en marcha. Caja {}. Ctrl-C para salir."
          .format(cfg["DEVICE_ID"][:8]), flush=True)

    espera = INTERVALO_SEG
    while True:
        try:
            filas = rpc(cfg, "reclamar_impresion",
                        {"p_device": cfg["DEVICE_ID"], "p_token": cfg["DEVICE_TOKEN"]})
            espera = INTERVALO_SEG

            # Sin trabajos la cola contesta una lista vacia: es lo normal, no un
            # error, y no se imprime nada en la consola para que el registro no
            # crezca con 30 lineas por minuto diciendo que no pasa nada.
            if not filas:
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
