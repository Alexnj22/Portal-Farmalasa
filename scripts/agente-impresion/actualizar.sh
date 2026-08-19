#!/usr/bin/env bash
# Pone al día el agente de impresión de ESTA caja.
#
# Se corre una sola vez por computadora, de una línea, sin copiar archivos:
#
#   curl -fsSL https://portal.farmasalud.lat/agente-impresion/actualizar.sh | sudo bash
#
# De ahí en adelante el agente se actualiza solo, así que esto queda para una
# caja que quedó atrás o para forzar la puesta al día en el momento.
#
# NO toca `agente.conf`: el token, la sala y la impresora de esta caja se
# quedan como están. Sólo reemplaza el programa.
set -euo pipefail

PORTAL="${PORTAL:-https://portal.farmasalud.lat}"
DESTINO="${DESTINO:-/opt/farmalasa/agente-impresion}"
SERVICIO="${SERVICIO:-farmalasa-impresion}"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }
morir() { rojo "✗ $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || morir "Hay que correrlo con sudo: curl -fsSL $PORTAL/agente-impresion/actualizar.sh | sudo bash"
[ -f "$DESTINO/agente.py" ] || morir "Acá no hay ningún agente instalado ($DESTINO). Para instalarlo por primera vez se usa instalar.sh, que además vincula la caja con el portal."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

gris "Bajando la versión publicada…"
curl -fsSL --max-time 30 "$PORTAL/agente-impresion/agente.py"     -o "$TMP/agente.py"  || morir "No se pudo bajar el agente. ¿Tiene internet esta computadora?"
curl -fsSL --max-time 15 "$PORTAL/agente-impresion/agente.sha256" -o "$TMP/agente.sha256" || morir "No se pudo bajar la firma del agente."

# El hash se comprueba SIEMPRE. Un despliegue a medias sirve un archivo que no
# corresponde a su firma, y eso no se ve leyendo el archivo.
ESPERADO="$(tr -d ' \n\r' < "$TMP/agente.sha256" | head -c 64)"
BAJADO="$(sha256sum "$TMP/agente.py" | cut -d' ' -f1)"
[ "$ESPERADO" = "$BAJADO" ] || morir "Lo que se bajó no coincide con su firma. No se instala nada."

# Y que arranque, no sólo que compile: un error que aparece al ejecutar dejaría
# esta caja reiniciándose cada diez segundos y sin imprimir.
python3 -c "import sys; compile(open(sys.argv[1],'rb').read(), 'agente.py', 'exec')" "$TMP/agente.py" \
    || morir "El archivo publicado no compila. No se instala nada."

ACTUAL="$(sha256sum "$DESTINO/agente.py" | cut -d' ' -f1)"
if [ "$ACTUAL" = "$ESPERADO" ]; then
    verde "✓ Esta caja ya estaba al día (${ESPERADO:0:12})."
    exit 0
fi

cp -p "$DESTINO/agente.py" "$DESTINO/agente.py.anterior"
install -m 0755 "$TMP/agente.py" "$DESTINO/agente.py"
verde "✓ Programa actualizado (${ACTUAL:0:12} → ${ESPERADO:0:12})"
gris "  El anterior quedó en $DESTINO/agente.py.anterior"

systemctl restart "$SERVICIO"
sleep 3
if systemctl is-active --quiet "$SERVICIO"; then
    verde "✓ El agente volvió a arrancar"
    journalctl -u "$SERVICIO" -n 5 --no-pager | grep -i "Escribe en" || true
else
    rojo "✗ El agente no arrancó. Volviendo a la versión anterior."
    install -m 0755 "$DESTINO/agente.py.anterior" "$DESTINO/agente.py"
    systemctl restart "$SERVICIO" || true
    morir "Se dejó la versión de antes. Mirá qué pasó con: journalctl -u $SERVICIO -n 30"
fi

echo
gris "  Para verlo trabajar:  sudo journalctl -u $SERVICIO -f"
