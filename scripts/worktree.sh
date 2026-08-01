#!/usr/bin/env bash
# Crea un árbol de trabajo aparte para una sesión, listo para usar.
#
#   npm run worktree -- clientes          → ../Portal-Farmalasa-clientes, rama sesion/clientes
#   npm run worktree -- clientes main     → parte de main en vez de HEAD
#
# ── Por qué ─────────────────────────────────────────────────────────────────
# Este repo se trabaja con 2-3 sesiones a la vez sobre el MISMO directorio, y
# eso comparte cuatro cosas que no deberían compartirse: los archivos (una
# sesión edita lo que otra está leyendo), el índice de git, `dist/` (una compila
# mientras otra mide en el navegador, y la medición es del código equivocado) y
# `src/version.js`.
#
# Los gates ya no bloquean por el árbol ajeno y el changelog salió de
# `version.js`, pero eso son paliativos: mientras el directorio sea uno solo, dos
# sesiones sobre el MISMO módulo se siguen pisando. Un worktree lo resuelve de
# raíz — archivos, índice y `dist/` propios, compartiendo solo el repositorio.
#
# El costo, dicho de frente: git no deja tener la misma rama en dos worktrees,
# así que la sesión trabaja en `sesion/<nombre>` y hay que mergear a main. Hoy
# todo va directo a main y Vercel deploya en el push; acá hay un paso más.
# Por eso esto es OPT-IN: conviene para trabajo largo o riesgoso, no para un
# arreglo de dos líneas.
set -euo pipefail

NOMBRE="${1:-}"
BASE="${2:-HEAD}"
if [ -z "$NOMBRE" ]; then
  echo "  uso: npm run worktree -- <nombre> [rama-base]" >&2
  exit 1
fi

RAIZ="$(git rev-parse --show-toplevel)"
DESTINO="$(dirname "$RAIZ")/$(basename "$RAIZ")-$NOMBRE"
RAMA="sesion/$NOMBRE"

if [ -e "$DESTINO" ]; then
  echo "  ✗ Ya existe $DESTINO" >&2
  exit 1
fi

git -C "$RAIZ" worktree add -b "$RAMA" "$DESTINO" "$BASE"

# `node_modules` por symlink: son 558 MB y reinstalarlos por sesión no aporta
# nada — las dependencias son las mismas, están en .gitignore y nadie las edita.
if [ -d "$RAIZ/node_modules" ]; then
  ln -s "$RAIZ/node_modules" "$DESTINO/node_modules"
  echo "  · node_modules enlazado (no duplicado)"
fi

# `.env` está en .gitignore, así que el worktree nace sin credenciales y la app
# no arranca. Se copia, no se enlaza: si una sesión lo edita, no se lo cambia a
# las demás.
if [ -f "$RAIZ/.env" ]; then
  cp "$RAIZ/.env" "$DESTINO/.env"
  echo "  · .env copiado"
fi

PUERTO=$(( 4173 + ( $(echo -n "$NOMBRE" | cksum | cut -d' ' -f1) % 3 ) + 1 ))

cat <<FIN

  ✓ $DESTINO   (rama $RAMA)

    cd "$DESTINO"
    npm run build && npm run preview

  Sobre el puerto de QA: las edge functions solo aceptan CORS de
  http://localhost:4173, así que el preview sigue en 4173 y **una sola sesión
  puede tenerlo levantado a la vez** (por eso lleva --strictPort: si está
  ocupado falla claro, en vez de moverse a otro puerto y dar un error de CORS
  que parece otra cosa). Si querés compilar sin tocar el dist de nadie:

    OUT_DIR=dist-$NOMBRE npm run build
    OUT_DIR=dist-$NOMBRE npm run preview     # cuando 4173 esté libre

  Para cerrar cuando termines:

    git -C "$RAIZ" worktree remove "$DESTINO"
    git -C "$RAIZ" branch -d "$RAMA"

FIN
