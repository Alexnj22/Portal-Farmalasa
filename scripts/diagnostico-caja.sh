#!/usr/bin/env bash
# Diagnóstico de una computadora de sala — SÓLO LECTURA.
# No imprime, no instala, no cambia configuración. Se puede correr en producción.
#
#   bash diagnostico-caja.sh > caja-<sala>.txt 2>&1
#
# Contesta las preguntas que desde fuera de la sala no se pueden contestar:
# quién es esta máquina, por dónde llega a la ticketera, y qué hay montado
# alrededor del programa de impresión.
#
# Qué hacer con la salida: `docs/IMPRESION-EN-TICKETERA-2026-08-13.md` §5 bis
# (rearmar una caja desde cero) y §5 ter (relevamiento por sucursal).

titulo() { printf '\n\n══ %s ══\n\n' "$1"; }
hay()    { command -v "$1" >/dev/null 2>&1; }

titulo "1. QUIÉN ES ESTA COMPUTADORA"
echo "Nombre:  $(hostname)"
echo "Usuario: $(whoami)"
[ -r /etc/os-release ] && grep -E '^(PRETTY_NAME|VERSION)=' /etc/os-release
uname -a

titulo "2. RED (para saber si otra computadora puede alcanzarla)"
if hay ip; then
    ip -4 addr show scope global | grep -E 'inet |^[0-9]+:'
    echo "--- ruta por defecto ---"
    ip route | grep default
else
    ifconfig 2>/dev/null | grep -E 'inet |^[a-z]'
fi
echo "--- ¿la dirección es fija o la da el router? ---"
if hay nmcli; then
    nmcli -t -f NAME,DEVICE,TYPE connection show --active 2>/dev/null
    for c in $(nmcli -t -f NAME connection show --active 2>/dev/null); do
        echo "[$c] método: $(nmcli -g ipv4.method connection show "$c" 2>/dev/null)"
    done
else
    echo "(sin nmcli — revisar a mano)"
fi

titulo "3. LA TICKETERA — cómo la ve el sistema"
echo "--- USB conectado ---"
hay lsusb && lsusb | grep -iE 'print|pos|thermal|epson|bixolon|seiko' || echo "(sin lsusb)"
echo
echo "--- dispositivo crudo (por acá escribe el programa de facturación) ---"
ls -l /dev/usb/lp* /dev/lp* 2>/dev/null || echo "NO existe /dev/usb/lp* — la ticketera no está enchufada o el módulo usblp no cargó"
echo
echo "--- colas de CUPS ---"
if hay lpstat; then
    echo "[predeterminada del sistema]"; lpstat -d 2>&1
    echo; echo "[todas las colas y su dirección]"; lpstat -v 2>&1
    echo; echo "[estado de cada una]"; lpstat -p 2>&1
    echo; echo "[trabajos encolados ahora]"; lpstat -o 2>&1 | head -20
else
    echo "(sin lpstat — CUPS no instalado)"
fi

titulo "4. ¿CUPS PUEDE COMPARTIR LA IMPRESORA EN LA RED?"
if [ -r /etc/cups/cupsd.conf ]; then
    echo "--- líneas que deciden si escucha en la red y si comparte ---"
    grep -nE '^\s*(Listen|Port|Browsing|BrowseLocalProtocols|DefaultShared)' /etc/cups/cupsd.conf
    echo
    echo "--- quién tiene permitido entrar ---"
    awk '/<Location/,/<\/Location>/' /etc/cups/cupsd.conf | grep -vE '^\s*#' | head -40
else
    echo "(no se puede leer /etc/cups/cupsd.conf)"
fi
echo
echo "--- ¿está compartida cada cola? (Shared) ---"
[ -r /etc/cups/printers.conf ] && sudo -n grep -E '^\s*(<(Default)?Printer|Shared|DeviceURI|State)' /etc/cups/printers.conf 2>/dev/null \
    || echo "(printers.conf necesita permisos de administrador — correr con sudo si hace falta el dato)"

titulo "5. EL PROGRAMA DE IMPRESIÓN DEL SISTEMA DE FACTURACIÓN"
echo "--- ¿contesta el servidor web local? ---"
if hay curl; then
    for u in http://localhost/ http://localhost/impresion_dte/ http://localhost:631/; do
        printf '%-40s → HTTP %s\n' "$u" "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$u" 2>&1)"
    done
else
    echo "(sin curl)"
fi
echo
echo "--- ¿dónde está la carpeta en el disco? ---"
for d in /var/www/html/impresion_dte /var/www/impresion_dte /srv/http/impresion_dte \
         /opt/lampp/htdocs/impresion_dte /usr/local/apache2/htdocs/impresion_dte; do
    [ -d "$d" ] && { echo "ENCONTRADA: $d"; ls -la "$d" | head -25; }
done
echo "(si no apareció ninguna, buscar con: sudo find / -maxdepth 6 -type d -name impresion_dte 2>/dev/null)"
echo
echo "--- quién sirve el puerto 80 ---"
if hay ss; then ss -lntp 2>/dev/null | grep -E ':80\s|:631\s' || echo "(nada escuchando en 80/631)"
elif hay netstat; then netstat -lntp 2>/dev/null | grep -E ':80\s|:631\s'; fi
echo
echo "--- versión de PHP ---"
hay php && php -v | head -1 || echo "(sin php en la ruta)"

titulo "6. CORTAFUEGOS (¿deja entrar a otra computadora?)"
hay ufw       && sudo -n ufw status 2>/dev/null || echo "(ufw: sin dato o sin permisos)"
hay firewall-cmd && sudo -n firewall-cmd --list-all 2>/dev/null
hay iptables  && sudo -n iptables -L INPUT -n 2>/dev/null | head -15 || echo "(iptables: sin permisos — no es concluyente)"

titulo "7. PERMISOS PARA ESCRIBIRLE A LA IMPRESORA"
echo "Grupos de $(whoami): $(id -Gn)"
echo "(para escribir a /dev/usb/lp0 hace falta pertenecer al grupo dueño del dispositivo — ver punto 3)"

titulo "8. ¿POR QUÉ SE TRABA? — falla intermitente que se cura apagando la impresora"
echo "IMPORTANTE: esta sección sólo sirve si se corre MIENTRAS está fallando,"
echo "ANTES de apagar y prender la ticketera. El reinicio borra la evidencia."
echo
echo "--- ¿LA TICKETERA SE LLAMA lp0? (la causa de Salud 4, 2026-08-18) ---"
echo "El programa de facturación escribe a /dev/usb/lp0 con ese nombre FIJO, y ese"
echo "nombre NO está garantizado: los lp* comparten el mayor 180 y sus menores con"
echo "hiddev* (receptores inalámbricos, teclados USB). El que se enumera primero se"
echo "lleva el 0; si lo gana un HID, la ticketera cae en lp1 y el programa escribe a"
echo "un archivo que no existe — sin error, sin log. Los dos sistemas mudos a la vez."
ls -l /dev/usb/ 2>&1
echo
if [ -e /etc/udev/rules.d/99-ticketera.rules ]; then
    echo "[OK] La regla de udev que fija el nombre está instalada:"
    cat /etc/udev/rules.d/99-ticketera.rules
else
    echo "[FALTA] No está /etc/udev/rules.d/99-ticketera.rules — si el listado de"
    echo "        arriba NO muestra 'lp0 -> lp1', instalarla (ver la memoria de"
    echo "        impresión en ticketera). Sin ella el nombre es una lotería."
fi
echo
echo "--- QUIÉN TIENE TOMADO EL DISPOSITIVO ---"
echo "Si cupsd u otro proceso lo tiene abierto, la escritura falla en silencio."
if [ -e /dev/usb/lp0 ]; then
    if hay fuser; then sudo -n fuser -v /dev/usb/lp0 2>&1 || fuser -v /dev/usb/lp0 2>&1; fi
    if hay lsof;  then sudo -n lsof /dev/usb/lp0 2>&1  || lsof /dev/usb/lp0 2>&1;  fi
    hay fuser || hay lsof || echo "(sin fuser ni lsof instalados)"
else
    echo "/dev/usb/lp0 NO EXISTE en este momento — ESE es el hallazgo."
    echo "Si el listado de arriba muestra un lp1 (u otro número), la ticketera ESTÁ"
    echo "conectada y lo que falta es la regla de udev. Si no muestra ningún lp*,"
    echo "el sistema perdió la impresora: cable, corriente o el módulo usblp."
fi
echo
echo "--- ¿hay una cola de CUPS apuntando a la MISMA ticketera? ---"
echo "(si la hay y tiene trabajos pendientes, cupsd toma el USB y le gana al programa)"
if hay lpstat; then
    lpstat -v 2>&1 | grep -i usb || echo "(ninguna cola por USB)"
    echo; echo "[trabajos pendientes ahora]"; lpstat -o 2>&1 | head -20
fi
echo
echo "--- el USB, ¿se cae y vuelve sola? ---"
echo "Dos firmas OPUESTAS con el mismo síntoma, y sólo dmesg las separa:"
echo "  · 'USB disconnect' ANTES de 'usblp: removed'  → físico: cable/puerto/corriente"
echo "  · 'usblp: removed' SIN disconnect, y re-engancha con el MISMO número de"
echo "    dispositivo                                  → software: CUPS tomando el aparato"
{ sudo -n dmesg 2>/dev/null || dmesg 2>/dev/null; } \
    | grep -iE 'usblp|usb .*(disconnect|new full|new high|reset)|lp[0-9]' | tail -30 \
    || echo "(dmesg necesita permisos de administrador — correr el script con sudo)"
echo
echo "--- qué anotó CUPS la última vez que falló ---"
sudo -n tail -40 /var/log/cups/error_log 2>/dev/null \
    || echo "(error_log necesita permisos de administrador)"

titulo "FIN"
echo "Mandá este archivo completo. Nada de lo de arriba modificó la computadora."
