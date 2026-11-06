# §11 Movimiento — historia

## `tailwind.config.js` no se leía (Fase T1, 2026-07-23)

`tailwind.config.js` se eliminó en T1: el proyecto usa `@tailwindcss/postcss`
sin `@config`, así que ese archivo llevaba tiempo sin leerse — `animate-wiggle`,
`animate-kpi-enter` y `animate-widget-settle` no generaban NINGÚN CSS (bug
silencioso en `NotificationBell.jsx`/`DashboardView.jsx`; verificado con build
antes/después). Se migraron a `@keyframes` en `index.css`.
`animate-widget-enter` y `animate-table-row-enter` existían en el config pero
ninguna vista los usaba — se descartaron.

## `animate-in` sin CSS (hasta 2026-07-29)

Las clases `animate-in`/`fade-in`/`zoom-in-95` estaban escritas en **223
lugares de 73 archivos —incluidos `ModalShell` y `LiquidModal`— y no generaban
ni una línea de CSS**: son del plugin `tailwindcss-animate` (Tailwind v3), que
nunca estuvo instalado. Todo modal del portal aparecía de golpe. Tercera vez
del mismo fallo (T1 con `tailwind.config.js`, §8 con `rounded-full`). De ahí la
regla: antes de dar por buena una clase, buscarla en el bundle.

## El barrido de los botones (removido 2026-08-05)

`.sweep` era una animación de 700 ms que recorría el botón sin comunicar ningún
estado. Se removió junto con sus seis `<span>` (apagarla habría dejado nodos
que existen, cuestan y no significan nada). En Solid ni siquiera se ejecutaba.
Ver `docs/planes-cerrados/PLAN-MATERIALES-2026-08-02.md` §2.1.

## framer-motion: de «no agregar más» a la regla del gate (D0.5, 2026-07-26)

La regla vieja ("no new framer-motion usage") baneaba la librería entera sin
distinguir para qué se usaba, y por eso se incumplía: 20 de los 25 archivos la
usaban para lo que CSS no puede hacer — `AnimatePresence` anima el desmontaje y
`layout`/`layoutId` hace transiciones FLIP. La regla nueva permite esas
capacidades y prohíbe sólo `motion.*` decorativo. `TablePagination` dejó de
usar `layoutId="activePage"` en su reescritura del 2026-07-27: hacía que la
píldora azul volara entre dos paginaciones en pantalla.
