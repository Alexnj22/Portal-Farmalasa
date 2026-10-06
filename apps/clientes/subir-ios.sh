#!/usr/bin/env bash
# Compila Puntos Salud en esta Mac y la sube a TestFlight, sin EAS.
# La receta vive en scripts/subir-ios.mjs (la misma para la app del personal).
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node scripts/subir-ios.mjs apps/clientes clientes
