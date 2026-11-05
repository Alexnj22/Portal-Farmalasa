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
#
# 2026-11-05: además `vercel.json` apaga los despliegues de `main`
# (`git.deploymentEnabled`). Este script los cancelaba, pero sólo cuando les
# tocaba el turno: mientras tanto esperaban en la fila de Vercel —que arma uno
# a la vez— delante de los de producción. Ese día un Preview de `main` trabado
# en «Initializing» dejó a la v2.1452.1 media hora sin arrancar.
case "$VERCEL_GIT_COMMIT_REF" in
  produccion|sesion/nucleo) exit 1 ;;
  *) exit 0 ;;
esac
