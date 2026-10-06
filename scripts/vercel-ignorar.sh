#!/usr/bin/env bash
# `ignoreCommand` de Vercel (vercel.json lo llama; ahí no caben más de 256
# caracteres). Salir con 0 = NO desplegar; con 1 = desplegar.
#
# · sesion/nucleo: siempre se despliega (es la rama de dev.farmasalud.lat).
# · otras sesion/*: nunca.
# · main: sólo si el commit toca algo de la WEB. Lo de las apps, las funciones
#   de Supabase, scripts, docs, la auditoría y el changelog no cambian el
#   portal: compilarlo por eso costaba minutos de compilación en vano (el
#   2026-10-06, ~20 de 24 despliegues; Vercel cobró $22.92 en el ciclo).
case "$VERCEL_GIT_COMMIT_REF" in
  sesion/nucleo) exit 1 ;;
  sesion/*) exit 0 ;;
esac
git diff --quiet HEAD^ HEAD -- . \
  ':(exclude)apps' ':(exclude)supabase' ':(exclude)scripts' ':(exclude)docs' \
  ':(exclude)auditoria' ':(exclude)CHANGELOG.md' ':(exclude)src/version.js' \
  && exit 0
exit 1
