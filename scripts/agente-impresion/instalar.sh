#!/bin/bash
# Instalador del agente de impresión — Portal Farmalasa.
#
# Se corre UNA vez en la computadora de la caja. Lo único que hay que tener a
# mano es el código de 8 letras que muestra el portal.
#
#     bash instalar.sh
#
# Hace todo lo demás: comprueba que la computadora sirva, encuentra la
# ticketera, canjea el código, escribe la configuración, deja el agente
# encendido para siempre y manda una hoja de prueba.
set -u

# ── Estos dos NO son secretos ────────────────────────────────────────────────
# La llave `anon` viaja en el propio portal (está dentro del JavaScript que
# descarga cualquiera que abra la página). Lo que autoriza a esta caja es su
# token, y ése lo entrega el canje del código — nunca está escrito acá.
URL="https://sacecdkdmsdvgqnrsett.supabase.co"
ANON="sb_publishable_cdFHhrbNAqfoA7FIsEgL3A_COHXzBoz"

DESTINO="/opt/farmalasa/agente-impresion"
SERVICIO="farmalasa-impresion"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }
titulo(){ printf '\n\033[1m%s\033[0m\n' "$*"; }

morir() { rojo "✗ $*"; exit 1; }

titulo "Agente de impresión · Portal Farmalasa"
gris "Esta computadora va a imprimir lo que se le mande desde el portal."

# ── 1. ¿Sirve esta computadora? ──────────────────────────────────────────────
titulo "1) Revisando la computadora"

command -v python3 >/dev/null || morir "Falta Python 3. Instalalo con: sudo apt install python3"
verde "  ✓ Python 3"

command -v lp >/dev/null || morir "Falta el sistema de impresión. Instalalo con: sudo apt install cups-client"
verde "  ✓ Sistema de impresión"

# Son DOS preguntas distintas y hay que contestarlas por separado, porque
# confundirlas manda a revisar el lugar equivocado:
#
#   ¿llegó la red?      → curl falla en el TRANSPORTE (DNS, conexión, timeout) y
#                         no hay código HTTP. Eso, y sólo eso, es "sin internet".
#   ¿la aceptaron?      → hubo respuesta; el código dice si el portal la tomó.
#
# La primera versión probaba `GET /rest/v1/` —el índice de la API— con la llave
# publishable. Ese extremo hoy sólo lo abre una llave SECRETA, así que contestaba
# 401 en TODA computadora y el instalador lo anunciaba como falta de internet.
# `/auth/v1/health` tampoco sirve de prueba de red: también exige la llave.
HTTP="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    "$URL/rest/v1/branches?select=id&limit=1" \
    -H "apikey: $ANON" -H "Authorization: Bearer $ANON" 2>/dev/null)"
FALLA_RED=$?
[ "$FALLA_RED" -eq 0 ] || morir "Esta computadora no llega al portal. Revisá la conexión a internet. (curl $FALLA_RED)"
[ "$HTTP" = "200" ] || morir "Hay internet y el portal contestó, pero rechazó a esta computadora (código $HTTP). Pedí una copia nueva de esta carpeta."
verde "  ✓ Llega al portal"

# ── 2. ¿Cuál es la ticketera? ────────────────────────────────────────────────
titulo "2) Buscando la ticketera"

mapfile -t COLAS < <(lpstat -a 2>/dev/null | awk '{print $1}')
[ ${#COLAS[@]} -gt 0 ] || morir "No hay ninguna impresora configurada en esta computadora."

# La ticketera se reconoce por el nombre: pos, tick, tm-, zj-, rp- son los
# prefijos que usan estas impresoras. Si no aparece ninguna, se pregunta.
IMPRESORA=""
for c in "${COLAS[@]}"; do
    if [[ "${c,,}" =~ (pos|tick|tm-|zj|rp[0-9]) ]]; then IMPRESORA="$c"; break; fi
done

if [ -n "$IMPRESORA" ]; then
    verde "  ✓ Encontrada: $IMPRESORA"
    read -r -p "  ¿Es ésa la ticketera? [S/n] " ok
    [[ "${ok,,}" == "n" ]] && IMPRESORA=""
fi

if [ -z "$IMPRESORA" ]; then
    echo "  Impresoras de esta computadora:"
    for i in "${!COLAS[@]}"; do echo "    $((i+1))) ${COLAS[$i]}"; done
    read -r -p "  ¿Cuál es la ticketera? (número) " n
    IMPRESORA="${COLAS[$((n-1))]:-}"
    [ -n "$IMPRESORA" ] || morir "No se eligió ninguna impresora."
fi

# ── 3. El código del portal ──────────────────────────────────────────────────
titulo "3) Vinculando con el portal"
gris "  En el portal: Sistema → Prueba de impresión → Cajas de las salas"
gris "  Ahí sale un código de 8 letras. Dura 15 minutos."
echo

CODIGO=""
for intento in 1 2 3; do
    read -r -p "  Código: " CODIGO
    CODIGO="$(echo "$CODIGO" | tr -d ' -' | tr '[:lower:]' '[:upper:]')"

    RESP="$(curl -fsS --max-time 20 -X POST "$URL/rest/v1/rpc/canjear_codigo_de_vinculacion" \
        -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
        -H "Content-Type: application/json" \
        -d "{\"p_codigo\":\"$CODIGO\",\"p_equipo\":\"$(hostname)\",\"p_impresora\":\"$IMPRESORA\"}" 2>/dev/null)" || RESP=""

    DEV_ID="$(echo "$RESP"  | grep -o '"device_id":"[^"]*' | cut -d'"' -f4)"
    DEV_TOK="$(echo "$RESP" | grep -o '"device_token":"[^"]*' | cut -d'"' -f4)"
    SALA="$(echo "$RESP"    | grep -o '"sala":"[^"]*' | cut -d'"' -f4)"

    if [ -n "$DEV_ID" ] && [ -n "$DEV_TOK" ]; then break; fi
    rojo "  ✗ Ese código no sirvió. Puede haber vencido o ya haberse usado."
    [ "$intento" = 3 ] && morir "Generá un código nuevo en el portal y volvé a correr esto."
done

verde "  ✓ Vinculada a $SALA"

# ── 4. Dejarla lista ─────────────────────────────────────────────────────────
titulo "4) Instalando"

SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

$SUDO mkdir -p "$DESTINO" || morir "No se pudo crear $DESTINO"
$SUDO cp "$AQUI/agente.py" "$DESTINO/"

# El archivo lleva el token: sólo lo lee quien corre el agente.
$SUDO tee "$DESTINO/agente.conf" >/dev/null <<EOF
# Escrito por instalar.sh — no hace falta editarlo a mano.
SUPABASE_URL=$URL
SUPABASE_ANON_KEY=$ANON
DEVICE_ID=$DEV_ID
DEVICE_TOKEN=$DEV_TOK
# CORTAR=1   # sólo si el papel sale sin cortarse
EOF
$SUDO chmod 600 "$DESTINO/agente.conf"
verde "  ✓ Configuración escrita"

$SUDO tee "/etc/systemd/system/$SERVICIO.service" >/dev/null <<EOF
[Unit]
Description=Agente de impresion de la caja — Portal Farmalasa
After=network-online.target cups.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DESTINO
ExecStart=/usr/bin/python3 $DESTINO/agente.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable --now "$SERVICIO" >/dev/null 2>&1
sleep 3

if $SUDO systemctl is-active --quiet "$SERVICIO"; then
    verde "  ✓ El agente quedó encendido (se prende solo al reiniciar)"
else
    rojo "  ✗ El agente no arrancó. Mirá qué pasó con:"
    echo "      sudo journalctl -u $SERVICIO -n 30"
    exit 1
fi

# ── 5. La prueba de verdad es el papel ───────────────────────────────────────
titulo "5) Probando"
printf '\x1b@PORTAL FARMALASA\n\nEsta caja quedo lista.\n%s\n%s\n\n\n\n' \
    "$SALA" "$(date '+%d/%m/%Y %H:%M')" | lp -d "$IMPRESORA" -o raw >/dev/null 2>&1 \
    && verde "  ✓ Se mandó una hoja de prueba" \
    || rojo "  ✗ No se pudo imprimir la prueba (el agente igual quedó instalado)"

titulo "Listo."
echo "  Sala:      $SALA"
echo "  Ticketera: $IMPRESORA"
echo
gris "  ¿Salió el papel de prueba? Entonces ya está."
gris "  Para verlo trabajar:  sudo journalctl -u $SERVICIO -f"
