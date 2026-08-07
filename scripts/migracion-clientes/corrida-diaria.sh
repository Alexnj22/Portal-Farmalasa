#!/bin/bash
# La corrida diaria de fichas de clientes. La dispara launchd a las 21:30 SV,
# una hora antes del barrido de facturas de las 22:30 — así el barrido encuentra
# las fichas ya corregidas y no rechaza documentos por un dato que faltaba.
#
# Instalación (una vez por máquina):
#     npm run fichas:instalar-cron
# Ver si está armado:      launchctl list | grep farmalasa
# Correrla a mano ahora:   launchctl start com.farmalasa.fichas-clientes
# Desarmar:                launchctl unload ~/Library/LaunchAgents/com.farmalasa.fichas-clientes.plist
#
# ── Por qué acá y no en el cron de la base ──────────────────────────────────
# `pg_cron` solo sabe hacer POST a edge functions, y esta corrida usa
# `bloque.py` —Python, 27,701 fichas de validación encima— que no vive en el
# servidor. Portarlo a TypeScript o SQL tiraría esa validación a la basura, así
# que corre acá. El costo: si la Mac está apagada a las 21:30, ese día no corre;
# la corrida siguiente lo levanta porque todo el proceso es reanudable.
#
# ── Por qué el instalador lo COPIA a ~/Library ──────────────────────────────
# macOS no deja que launchd EJECUTE un archivo dentro de ~/Documents: da
# "Operation not permitted" (TCC), y el agente muere antes de la primera línea.
# Leer Documents sí puede — comprobado el 2026-08-06 con un agente de prueba
# desde ~/Library, que leyó el repo sin problema. Así que el instalador copia
# este script y el plist a `~/Library/Application Support/farmalasa/`, y desde
# ahí el script trabaja contra el repo.
#
# El archivo versionado es ÉSTE. Editar la copia de ~/Library no sirve de nada:
# el próximo `npm run fichas:instalar-cron` la pisa.
set -u

# Ruta al repo, absoluta: el script corre desde su copia en ~/Library, así que
# `dirname $0` apunta ahí y no al proyecto.
D="/Users/alexnunez/Documents/Portal-Farmalasa/scripts/migracion-clientes"
LOG_DIR="$D/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/diaria-$(date +%Y-%m-%d).log"

{
  echo "════════════════════════════════════════════════════════"
  echo "corrida diaria de fichas · $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "════════════════════════════════════════════════════════"
  /usr/bin/python3 "$D/resolver_observaciones.py" --diario --escribir
  echo "── fin ($?) · $(date '+%H:%M:%S') ──"
} >> "$LOG" 2>&1

# Las corridas viejas no se acumulan para siempre: 30 días alcanzan para
# entender qué pasó y no dejan el repo creciendo solo.
find "$LOG_DIR" -name 'diaria-*.log' -mtime +30 -delete 2>/dev/null

exit 0
