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
# · main: TRANSICIÓN — mientras Vercel siga publicando `main` como producción,
#   despliega sólo si el commit toca la web. Cuando «Production Branch» en
#   Vercel sea `produccion`, esta rama pasa a `exit 0` (no se despliega sola).
# · el resto de sesion/*: nunca.
case "$VERCEL_GIT_COMMIT_REF" in
  produccion|sesion/nucleo) exit 1 ;;
  main) ;;
  *) exit 0 ;;
esac
git diff --quiet HEAD^ HEAD -- . \
  ':(exclude)apps' ':(exclude)supabase' ':(exclude)scripts' ':(exclude)docs' \
  ':(exclude)auditoria' ':(exclude)CHANGELOG.md' ':(exclude)src/version.js' \
  && exit 0
exit 1
