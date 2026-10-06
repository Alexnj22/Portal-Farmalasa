#!/usr/bin/env bash
# `ignoreCommand` de Vercel (vercel.json lo llama; ahí no caben más de 256
# caracteres). Salir con 0 = NO desplegar; con 1 = desplegar.
#
# Producción se publica A PROPÓSITO, no con cada commit (decisión del usuario,
# 2026-10-06: el ciclo iba en $22.92 de minutos de compilación con ~24
# despliegues al día). La rama `produccion` es la que Vercel publica en
# portal.farmasalud.lat, y se mueve con `npm run publicar`
# (scripts/publicar.mjs), que la adelanta a `main` sólo si hay cambios de la
# web.
#
# · produccion:    siempre (llegar ahí ya es la decisión de publicar).
# · sesion/nucleo: siempre (es la rama de dev.farmasalud.lat).
# · main y todo lo demás: nunca. `main` es donde se integra; desde el
#   2026-10-06 la rama de producción en Vercel es `produccion`.
case "$VERCEL_GIT_COMMIT_REF" in
  produccion|sesion/nucleo) exit 1 ;;
  *) exit 0 ;;
esac
