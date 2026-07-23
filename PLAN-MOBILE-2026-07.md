# PLAN MÓVIL 2026-07 — Prompt de plan de acción

> **Cómo usar este documento**: es un prompt ejecutable. Pégalo (o referéncialo) en una
> sesión de Claude Code y dile "ejecuta la Fase N de PLAN-MOBILE-2026-07.md". Cada fase
> es autocontenida, termina con verificación en WebKit + Chromium y un commit propio
> (bump de `APP_VERSION` + changelog en `src/version.js`, como siempre).
> Auditoría origen: 2026-07-18, v2.23.2, reproducida en vivo con Playwright
> (WebKit iPhone 13 y Chromium móvil) contra `npm run dev`.

---

## 1. Síntoma reportado

En teléfono, modo vertical: **no hay scroll y el menú no aparece**; en horizontal
"funcionan las cosas". Reproducido y diagnosticado — no es un bug puntual de una vista,
es el modelo de layout móvil completo.

## 2. Hallazgos verificados (evidencia medida, no hipótesis)

### P0-1 · El shell de la app mata TODO el scroll móvil — `src/App.jsx:550`

```jsx
<div className="fixed inset-0 w-full h-[100dvh] bg-[#E6F0FF] overflow-hidden flex flex-col">
```

Este wrapper envuelve TODO el portal autenticado. Es `position:fixed` +
`overflow:hidden` + altura fija al viewport. Consecuencias medidas (iPhone 13,
390×664, /ventas):

- `#main-scroll` mide **3,842px** de contenido real, pero el wrapper lo **clipea a
  664px** y no existe NINGÚN contenedor con overflow scrolleable entre medio
  (`#main-scroll` solo tiene `lg:overflow-hidden`, en móvil no es scroll container).
- Al ser `fixed`, aporta 0px de altura al documento: `#root` computa **0px**,
  `document.scrollHeight == innerHeight` → el body no tiene nada que scrollear.
- El hack de `AppLayout.jsx` (useEffect que en móvil fuerza
  `html/body/#root { overflow:auto; height:auto } !important` inline) queda
  completamente anulado por este wrapper: el scroll de body que ese hack habilita
  no sirve porque el documento nunca crece.
- **Reproducido en WebKit Y Chromium** — no es quirk de Safari; en el teléfono real
  se percibe igual: página congelada a la altura de la pantalla.

Cadena de alturas medida (de adentro hacia afuera):
`#main-scroll 3823px → main 3887px → div AppLayout 3887px → div.relative.z-10.h-full 664px →`
`**div.fixed.overflow-hidden 664px** → div.w-full.h-full 0px → #root 0px → body 0px`.

### P0-2 · Crash intermitente en Dashboard móvil: "ALGO SALIÓ MAL"

En WebKit iPhone, `/overview` crasheó con
`Maximum update depth exceeded ... in <ForwardRef>` (atrapado por ErrorBoundary →
card "ALGO SALIÓ MAL / RECARGAR" a pantalla completa) en 2 de 3 corridas, en vertical
Y horizontal. Intermitente (carrera de timing). Hipótesis principal: un chart/momento
con `ResizeObserver`/medición dentro de la cadena de alturas colapsadas (P0-1) entra
en loop de setState — medir un contenedor cuya altura oscila entre 0 y contenido.
**Diagnóstico pendiente**: capturar el `componentStack` completo (el `<ForwardRef>`
no identifica al culpable). Es MUY probable que arreglar P0-1 lo elimine; verificar
igual tras la Fase 1 con 5+ corridas.

### P1-3 · Estrategia móvil = parche JS sobre CSS desktop-locked (frágil por diseño)

- `src/index.css:289-297`: `html, body, #root { height:100%; overflow:hidden; overscroll-behavior:none }`
  — global, sin media query. El desktop lo necesita; el móvil lo revierte con JS
  (inline `!important` desde un useEffect de AppLayout). Si React tarda, falla o el
  efecto corre tarde: pantalla congelada. El modelo correcto no depende de JS.
- `src/App.css:9-12`: `body:has([role="dialog"]) { overflow:hidden !important }` —
  cualquier `[role="dialog"]` montado (aunque sea un banner invisible) bloquea el
  scroll del body. Con el modelo actual (scroll de body en móvil) es una bomba;
  con el modelo de la Fase 1 (scroll interno) deja de ser peligroso para el layout
  pero hay que revisarlo para el scroll container nuevo.
- Las vistas son desktop-first: definen su scroll interno solo con `lg:*`; bajo
  1024px delegan en un scroll de body que hoy no existe.

### P2-4 · Código muerto engañoso — `src/App.jsx:691-721`

`MobileConstructionScreen` ("Versión Móvil en Desarrollo... accede desde una
computadora", `sm:hidden fixed inset-0 z-[99999]`): se montó en el commit
"Desktop 1.0" y se desmontó en `b01bf8f`, pero la definición sigue. Eliminar.

### P2-5 · Gaps de estándares móviles detectados en la pasada

- Botón colapsar sidebar `w-8 h-8` (32px) y otros controles < 44×44pt (mínimo iOS
  HIG; Android Material: 48×48dp). Los tabs inferiores y el hamburger sí cumplen.
- Foto de perfil devuelve 400 en móvil (ruido de `signPhotosDeep`/URL firmada
  vencida) — se ve un avatar roto en el header móvil. Investigar por separado.
- `overscroll-behavior: none` global mata pull-to-refresh Y el rebote nativo en
  TODO; el estándar es `contain` en el scroll container de la app (evita el
  pull-to-refresh accidental sin matar el feel nativo interno).
- No hay `-webkit-tap-highlight-color` definido ni estados `active:` consistentes
  en las vistas (sí en el nav) — en Android el tap flashea el highlight default.

## 3. Modelo objetivo (decisión de arquitectura)

**App-shell con scroll interno** (patrón estándar de PWA/app iOS+Android), NO scroll
de body:

- El wrapper `fixed inset-0` **se queda** (da el fondo estable, evita el bounce de
  body y el resize del URL-bar de Safari), pero el scroll vive en `#main-scroll`:
  `flex-1 min-h-0 overflow-y-auto` **en todos los breakpoints**, con
  `-webkit-overflow-scrolling: touch` y `overscroll-behavior: contain`.
- Header móvil y bottom-tabs quedan fijos por estructura flex (ya no `position:fixed`
  flotando sobre un body que scrollea), como una app nativa.
- Se ELIMINA el useEffect-hack de AppLayout (inline styles sobre html/body/#root) y
  los spacers manuales de 64px — la estructura flex los vuelve innecesarios.
- `html, body, #root { overflow:hidden }` global deja de necesitar excepción móvil.

Por qué no body-scroll: requeriría des-fijar el shell, re-introducir los quirks del
URL-bar dinámico de iOS, y el hack JS seguiría siendo necesario. El scroll interno es
lo que hacen las apps que el PRODUCT.md pone de referencia (apps nativas de Apple).

## 4. Fases

### Fase 1 — Restaurar el scroll móvil (el fix estructural) ✅ APLICADA (v2.30.0, 2026-07-22)

**Hallazgo real vs. hipótesis original**: el punto 1 de abajo asumía que el problema
"terminaba en `#main-scroll`", pero el causante real estaba un nivel más arriba: el
`<div>` raíz de `AppLayout` solo fijaba `h-[100dvh]`/`overflow-hidden` bajo `lg:` — en
móvil no tenía altura acotada, así que ningún hijo (tampoco `#main-scroll` con el fix
del punto 2) podía calcular `flex-1/min-h-0` contra algo real. Se corrigió quitando el
prefijo `lg:` de esa clase (aplica siempre). Verificado con Playwright/WebKit iPhone 13
contra dev server: `#main-scroll` pasó de `scrollHeight === clientHeight` (0% de scroll
posible) a `clientHeight` acotado al viewport con `scrollTop` sostenible tras swipe.
Puntos 3-6 aplicados tal cual estaban planeados. Ver commit `c2440f7`.

### Fase 1 (original) — Restaurar el scroll móvil (el fix estructural) 🎯

1. `src/App.jsx:550`: mantener el wrapper pero garantizar que la cadena interna
   transmita altura: el hijo `div.relative.z-10.w-full.h-full.flex.flex-col` está OK;
   el problema termina en `#main-scroll`.
2. `src/components/layout/AppLayout.jsx` — `#main-scroll`: cambiar
   `lg:flex-1 lg:min-h-0 lg:overflow-hidden` → `flex-1 min-h-0 overflow-y-auto
   lg:overflow-hidden` (+ `WebkitOverflowScrolling:'touch'`,
   `overscroll-behavior-y: contain`). En desktop el comportamiento actual NO cambia
   (las vistas manejan su scroll interno con `lg:*`); en móvil se convierte en EL
   scroll container.
3. `<main>`: quitar la dependencia del header `fixed` — convertir el header móvil en
   flex-item normal (primer hijo de `main`, `shrink-0`) y ELIMINAR el spacer de
   `calc(env(safe-area-inset-top) + 64px)`. El safe-area-top pasa como `padding-top`
   del propio header.
4. Bottom-tabs (`hasSelfOnly`): de `fixed bottom-0` a flex-item final de `main`
   (`shrink-0`, con `padding-bottom: env(safe-area-inset-bottom)`), y eliminar el
   padding compensatorio en `#main-scroll`.
5. Eliminar el useEffect de AppLayout que inyecta estilos inline en html/body/#root
   (líneas ~186-207) y el strip de vidrio del safe-area-bottom si queda redundante.
6. `src/App.jsx`: borrar `MobileConstructionScreen` (dead code).
7. **Verificar** (protocolo §6): scroll vertical con swipe en /ventas, /overview,
   /dashboard y /home en WebKit iPhone vertical y horizontal + Chromium; hamburger
   visible y abre el drawer; `document.scrollHeight` puede seguir == innerHeight
   (el scroll es interno ahora — la métrica pasa a ser `#main-scroll.scrollHeight >
   clientHeight` y `scrollTop` móvil tras swipe > 0).

### Fase 2 — Crash del Dashboard ✅ CERRADA (2026-07-22) — no era un bug de producción

Reproducido post-Fase 1 (persistía igual, 4/5 corridas — Fase 1 NO lo eliminó, contra
la hipótesis original). `componentStack` completo capturado con un listener de consola
que extrae `jsonValue()` en vez de solo el texto plano: el culpable es el widget
"Tendencia de Asistencia" (`ResponsiveContainer`/`AreaChart` de `recharts@3.8.0`,
`DashboardView.jsx` ~1191). Confirmado por aislamiento: 0/5 crashes con el widget
deshabilitado, 4/5 con él presente — independiente del fix de scroll.

Se probaron los dos mitigantes estándar de la comunidad recharts (quitar `<Tooltip>`,
`width="99%"` + `debounce={50}`) — **ninguno lo resolvió**, así que no es el bug
"clásico" de redondeo sub-píxel de ResizeObserver.

**Causa real: artefacto de React StrictMode en dev, NO un bug de producción.**
`src/main.jsx:46` envuelve la app en `<React.StrictMode>`, que en DEV invoca los
efectos dos veces (mount→cleanup→mount) — recharts v3 inicializa su estado interno
(`RechartsStoreProvider`) vía un efecto que no tolera esa doble invocación en
combinación con su `ResizeObserver`, entrando en loop. **En build de producción
(`vite build` + `vite preview`, sin doble-invocación de StrictMode) el mismo flujo
corrió 8/8 veces sin crashear.** Como Vercel sirve el build de producción, los
usuarios reales nunca ven este error — el `ErrorBoundary` que lo atrapaba en dev
nunca dispara en el portal desplegado.

**Sin acción de código.** No se toca `ResponsiveContainer` ni se agrega
`debounce`/`width="99%"` (no resolvían nada y son complejidad sin beneficio real).
Si en el futuro se ve este mismo `Maximum update depth` en logs de producción real
(no en `npm run dev`), tratarlo como un bug distinto — este diagnóstico específico
solo cubre el dev-only false positive.

### Fase 2 (protocolo original, para referencia)

1. Reproducir en WebKit iPhone post-Fase 1 (5+ corridas de login → /overview).
2. Si persiste: capturar `componentStack` completo del `Maximum update depth`
   (console listener en el script de QA), identificar el `<ForwardRef>` culpable
   (sospechosos: charts del Dashboard con ResizeObserver, framer-motion LayoutGroup)
   y arreglar la causa (medición estable, debounce del observer, o key fija).
3. El ErrorBoundary actual reemplaza la vista pero deja el nav — correcto; mantener.

### Fase 3 — Estándares iOS/Android del shell

1. **Safe areas completas**: header móvil `padding-top: max(env(safe-area-inset-top), 12px)`;
   bottom-tabs `padding-bottom: max(env(safe-area-inset-bottom), 16px)`; drawer del
   menú ya lo maneja. Verificar también `env(safe-area-inset-left/right)` en
   landscape con notch.
2. **Touch targets**: pasada por AppLayout + vistas: todo control interactivo ≥44×44pt
   (efectivo, con padding cuenta). Lista corta ya detectada: botón colapsar (32px),
   íconos de acción en tablas.
3. **Teclado**: inputs con `font-size ≥ 16px` en móvil (iOS hace zoom automático si
   es menor — auditar LiquidSelect y SearchInput); en vistas con input + botón fijo
   inferior, usar `visualViewport` o `interactive-widget=resizes-content` en el
   viewport meta.
4. **Gestos**: `overscroll-behavior: contain` en `#main-scroll` y en todo modal/sheet
   scrolleable (evita scroll-chaining); `-webkit-tap-highlight-color: transparent` +
   estados `active:scale-[0.98]` consistentes (ya son el patrón del nav).
5. **Modales**: en <640px los UnifiedModal deben comportarse como bottom-sheets
   (100% ancho, pegados abajo, drag-handle visual, max-h con scroll interno y
   safe-area-bottom) — patrón estándar iOS/Android. Auditar `body:has([role="dialog"])`
   de App.css: con scroll interno ya no aplica al body; mover el lock al
   `#main-scroll` si hace falta.

### Fase 4 — Pasada por vistas (adaptación de contenido)

Por cada vista principal (orden: las que el personal usa en tienda primero —
/home, /my-requests, /monitor, /pedidos, /minmax, /ventas):

1. Tablas anchas: contenedor propio `overflow-x-auto` (nunca desbordar el viewport;
   la página no debe scrollear horizontal) o colapso a cards en <640px según DESIGN.md.
2. Filter pills: wrap a 2 filas o scroll horizontal de la pill, sin romper §17.
3. Headers de vista (`ViewTabBar`): verificar que el modo búsqueda deslizante
   funciona con teclado móvil abierto.
4. Verificación visual barata por vista (1-2 screenshots WebKit iPhone) — regla de
   memoria: la verificación visual NO es opcional.

### Fase 5 — Matriz de verificación final + limpieza

- Matriz: {WebKit iPhone 13 vertical, WebKit iPhone 13 horizontal, WebKit iPad Mini
  vertical (744px→layout móvil), Chromium Android-like 412×915, Chromium desktop
  1440} × {login, /overview, /ventas, /home, /pedidos, menú drawer, un modal}.
- Probar en el teléfono real del usuario (el reporte original) antes de cerrar.
- Actualizar memoria (`project_*`) con el modelo de scroll nuevo para que ninguna
  vista futura reintroduzca `lg:`-only scroll.

## 5. Reglas del proyecto que aplican (no saltarse)

- Bump `APP_VERSION` + changelog en CADA commit; commit+push por fase (Vercel
  auto-deploya: no pushear una fase a medias que rompa desktop).
- Desktop NO debe cambiar visualmente: toda modificación de clases debe preservar el
  comportamiento `lg:` actual. Screenshot desktop antes/después en cada fase.
- React Compiler: los handlers no pueden capturar refs ni leer state fuera del
  updater (ver memoria `react-compiler-refs-in-handlers`); `npx eslint` sobre cada
  archivo tocado antes de commitear.
- LiquidSelect, DataTable, ViewTabBar, filter pills: usar los estándares existentes
  (DESIGN.md) — la adaptación móvil no inventa componentes nuevos.

## 6. Protocolo de reproducción/QA (ya montado, reusable)

- WebKit instalado: `npx playwright install webkit` (scratchpad npm project con
  `playwright`). Chromium local:
  `~/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
  como `executablePath`.
- Emular: `devices['iPhone 13']` (vertical); mismo descriptor con
  `viewport:{width:844,height:390}` (horizontal).
- Credenciales QA: `.env` → `portal-user` / `portal-password`; login form
  `#username`/`#password`/"Ingresar al Portal".
- Métricas que definen "scroll funciona" (post-Fase 1): en `#main-scroll`,
  `scrollHeight > clientHeight` y tras swipe `scrollTop > 0`; y
  `page.mouse` swipe simulado mueve el contenido en screenshot.
- Listeners `pageerror` + `console` filtrando `Maximum update depth` para el crash.

## 7. Criterios de aceptación (cierre del plan)

1. Teléfono vertical: menú hamburguesa visible, abre el drawer, y toda vista con
   contenido largo scrollea con el dedo (WebKit + dispositivo real).
2. Cero "ALGO SALIÓ MAL" en 5 logins consecutivos a /overview en WebKit iPhone.
3. Sin scroll horizontal de página en ninguna vista a 390px.
4. Touch targets ≥44pt en shell + vistas de Fase 4; inputs sin zoom forzado iOS.
5. Desktop pixel-igual (diff de screenshots antes/después por fase).
