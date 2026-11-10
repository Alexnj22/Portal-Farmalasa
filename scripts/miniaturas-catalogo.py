#!/usr/bin/env python3
"""Prepara UNA vez las fotos que ya estaban, para no usar el servidor de imágenes.

2026-11-10 (docs/PLAN-MEMORIA-DE-LA-BASE-2026-11-10.md, anexo de fotos): el
render del almacenamiento (`/render/image/…`) cobra por cada foto distinta que
achica en el mes; el plan trae 100 y se llegó a 208 con el tope de gasto
encendido. Desde ahora la copia chica se hace al subir
(src/plataforma/fotoConMiniatura.js). Esto completa lo anterior:

  (por defecto)  product-photos/<ruta>  →  product-photos/chicas/<ruta>
                 JPEG, 400 px de lado mayor, calidad 80, fondo blanco.
                 Sólo crea las que faltan (o todas con --rehacer).
  --empleados    las fotos de personal en PNG/JPEG se reescriben EN SU LUGAR
                 como WebP (400 px de ancho, 85 %), igual que las nuevas
                 (`comprimirFotoDeEmpleado`). La dirección guardada no cambia.
                 Copia de cada original en --respaldo antes de escribir.

Uso (la llave se pasa por entorno, nunca se escribe en un archivo):
  SUPABASE_SERVICE_KEY=… python3 -I scripts/miniaturas-catalogo.py [--empleados] [--seco]
"""
import argparse, io, json, os, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

BASE = "https://sacecdkdmsdvgqnrsett.supabase.co"
LLAVE = os.environ.get("SUPABASE_SERVICE_KEY", "")
LADO = 400


def pedir(metodo, ruta, cuerpo=None, tipo=None, extra=None):
    h = {"Authorization": f"Bearer {LLAVE}", "apikey": LLAVE}
    if tipo: h["Content-Type"] = tipo
    h.update(extra or {})
    req = urllib.request.Request(BASE + ruta, data=cuerpo, headers=h, method=metodo)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def listar(bucket, prefijo):
    """Todos los objetos bajo `prefijo` (recorre carpetas)."""
    salida, offset = [], 0
    while True:
        cuerpo = json.dumps({"prefix": prefijo, "limit": 1000, "offset": offset,
                             "sortBy": {"column": "name", "order": "asc"}}).encode()
        filas = json.loads(pedir("POST", f"/storage/v1/object/list/{bucket}", cuerpo, "application/json"))
        for f in filas:
            ruta = f"{prefijo}{f['name']}"
            if f.get("id") is None:          # carpeta
                salida += listar(bucket, ruta + "/")
            else:
                salida.append(ruta)
        if len(filas) < 1000: return salida
        offset += 1000


def subir(bucket, ruta, datos, tipo):
    pedir("POST", f"/storage/v1/object/{bucket}/{ruta}", datos, tipo,
          {"x-upsert": "true", "cache-control": "3600"})


def chica_de_producto(ruta, existentes, rehacer, seco):
    destino = f"chicas/{ruta}"
    if destino in existentes and not rehacer: return "ya estaba"
    img = Image.open(io.BytesIO(pedir("GET", f"/storage/v1/object/public/product-photos/{ruta}")))
    img.load()
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        fondo = Image.new("RGB", img.size, (255, 255, 255))
        fondo.paste(img, mask=img.split()[-1])
        img = fondo
    else:
        img = img.convert("RGB")
    img.thumbnail((LADO, LADO), Image.LANCZOS)
    b = io.BytesIO(); img.save(b, "JPEG", quality=80, optimize=True, progressive=True)
    if not seco: subir("product-photos", destino, b.getvalue(), "image/jpeg")
    return f"{len(b.getvalue()) // 1024} kB"


def webp_de_empleado(ruta, respaldo, seco):
    orig = pedir("GET", f"/storage/v1/object/empleados/{ruta}")
    img = Image.open(io.BytesIO(orig)); img.load()
    if img.format == "WEBP": return "ya era WebP"
    if img.width > LADO:
        img = img.resize((LADO, round(img.height * LADO / img.width)), Image.LANCZOS)
    img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
    b = io.BytesIO(); img.save(b, "WEBP", quality=85, method=6)
    nuevo = b.getvalue()
    if len(nuevo) >= len(orig): return "no achica, se deja"
    destino = os.path.join(respaldo, ruta)
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, "wb") as f: f.write(orig)
    if not seco: subir("empleados", ruta, nuevo, "image/webp")
    return f"{len(orig) // 1024} → {len(nuevo) // 1024} kB"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--empleados", action="store_true")
    ap.add_argument("--rehacer", action="store_true")
    ap.add_argument("--seco", action="store_true", help="calcula todo y no escribe nada")
    ap.add_argument("--respaldo", default="respaldo-fotos-empleados")
    a = ap.parse_args()
    if len(LLAVE) < 40: sys.exit("Falta SUPABASE_SERVICE_KEY en el entorno.")

    if a.empleados:
        filas = json.loads(pedir("GET", "/rest/v1/employees?select=photo_url&photo_url=like.*%2Fempleados%2F*"))
        rutas = sorted({f["photo_url"].split("/empleados/", 1)[1].split("?")[0] for f in filas})
        trabajo = lambda r: webp_de_empleado(r, a.respaldo, a.seco)
    else:
        todas = listar("product-photos", "")
        existentes = {r for r in todas if r.startswith("chicas/")}
        rutas = [r for r in todas if not r.startswith("chicas/") and r.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
        trabajo = lambda r: chica_de_producto(r, existentes, a.rehacer, a.seco)

    print(f"{len(rutas)} fotos{' (en seco)' if a.seco else ''}")
    cuenta = {}
    def uno(r):
        try: res = trabajo(r)
        except Exception as e: res = f"ERROR {e}"
        clave = res if not res[0].isdigit() else "hecha"
        cuenta[clave.split(' ')[0] if clave.startswith('ERROR') else clave] = cuenta.get(clave.split(' ')[0] if clave.startswith('ERROR') else clave, 0) + 1
        if res.startswith("ERROR"): print(f"  {r}: {res}")
    with ThreadPoolExecutor(6) as ex: list(ex.map(uno, rutas))
    print(json.dumps(cuenta, ensure_ascii=False))
    if cuenta.get("ERROR"): sys.exit(1)


if __name__ == "__main__":
    main()
