# Auditoría: header móvil invisible en PWA standalone + franja al fondo

**Estado: RESUELTO Y CONFIRMADO POR EL USUARIO EN SU IPHONE (v2.32.1,
2026-07-23).** Safari: contenido fluye bajo las barras, sin recuadros.
PWA standalone: header/hamburguesa visibles, status bar reservado.
La solución final fue la SUMA de: body scroll en móvil (§11, v2.32.0),
auto-reload anti-zombie (§10, v2.31.1), shell sin alturas medidas y sin
fixed anidado ni blur en chrome (§9, v2.31.0), y status bar `default` en
vez de `black-translucent` (§12, v2.32.1). Pendiente de seguimiento: el
usuario ve todo "super pequeño" — ver §13 (sospecha: viewport de
escritorio/zoom por sitio en su Safari, no el CSS del portal; y la
adaptación por vista es Fase T4 del plan de tema).
Documento de traspaso — el usuario pidió continuar esta investigación con otro
agente ("Fable"). Todo lo de abajo es verificable en el código actual (`main`,
HEAD = v2.30.3, commit `94b9104`) y en los datos reales capturados vía Safari
Remote Web Inspector contra el dispositivo real del usuario (no reproducible
con Playwright/simuladores).

## 1. Síntoma reportado (usuario, en vivo, con capturas reales)

En el sitio desplegado (`portal.farmasalud.lat`), en un iPhone real
(iOS 18.7, modelo con Dynamic Island — `devicePixelRatio: 3`,
`innerWidth/innerHeight` variables según contexto, ver §3):

- **Modo "agregado a inicio" (PWA standalone)**: el header móvil (ícono ☰,
  logo "Portal", buscador, campana, avatar) **no se ve** — en su lugar hay
  una franja gris oscura sólida donde debería estar, con el texto del
  status bar del sistema (hora, batería) en blanco sobre esa franja. Debajo
  de esa franja aparece directamente la pill de tabs ("Inicio · General ·
  Comercial · RRHH · Operación · Personalizar").
- **Franja blanca/vacía al fondo de la pantalla**, debajo del widget
  Calendario, en standalone. El usuario también reportó esto en Safari
  normal en un mensaje, pero los datos en vivo (§3) muestran que en Safari
  normal el header SÍ se ve y el shell mide correcto — no se ha podido
  confirmar la franja del fondo con datos en vivo todavía, solo con
  capturas.
- El usuario compara con el header fijo arriba + contenido a pantalla
  completa de claude.ai como referencia de lo que espera.

## 2. Intentos previos (todos insuficientes o no resolvieron el síntoma)

| Versión | Cambio | Resultado |
|---|---|---|
| v2.30.0 | Fase 1 del plan móvil: alto del shell sin condicionar a `lg:` en el div raíz de `AppLayout`; `#main-scroll` con `overflow-y-auto` real en todos los breakpoints; header y bottom-tabs pasan de `position:fixed` a flex-items normales dentro de `<main>`. | Restauró el scroll móvil (confirmado, correcto). **Causó la regresión de header/bottom-tabs** al depender del alto calculado del shell. |
| v2.30.1 | Revert: header y bottom-tabs vuelven a `position:fixed` (como antes de v2.30.0), con su spacer/padding compensatorio de siempre. `#main-scroll` se mantiene con scroll real. | El usuario confirmó que **no cambió nada** — mismos síntomas exactos. |
| v2.30.2 | Se agregó medición de altura real vía JS (`visualViewport.height`/`innerHeight`) expuesta como variable CSS `--app-100dvh` (script en `index.html`), usada en el wrapper de `App.jsx` y el div raíz + aside de `AppLayout.jsx` en vez de confiar en `100dvh` nativo. | Sin cambio reportado por el usuario. |
| v2.30.3 | Auditoría encontró que `GlobalBackground` (capa de fondo ambiental) seguía en `h-[100dvh]` crudo, no migrada. Corregido. | Sin cambio reportado (y medido en vivo que ya antes de este fix todo calculaba bien — ver §3). |

**Conclusión importante:** los primeros 3-4 intentos asumieron que el
problema era de *medición de altura* (`100dvh` calculado mal en standalone).
Los datos en vivo del §3 **contradicen esa hipótesis**: el shell mide
perfecto. El problema real parece ser de **stacking/paint order**, no de
altura — ver §4.

## 3. Datos reales capturados (Safari Remote Web Inspector, iPhone real)

Script usado (pegado en la consola del inspector remoto, con la sesión
logueada en `/overview`):

```js
(function() {
  const wrapper = document.querySelector('.fixed.inset-0.w-full.bg-\\[\\#E6F0FF\\]');
  const header = document.querySelector('button[aria-label="Abrir menú"]')?.closest('div[style]');
  const mainScroll = document.getElementById('main-scroll');
  const grid = mainScroll?.querySelector('.grid.gap-4.relative');
  const rect = el => el ? (({top,bottom,left,right,width,height}) => ({top,bottom,left,right,width,height}))(el.getBoundingClientRect()) : null;
  console.log(JSON.stringify({
    displayMode: window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
    navigatorStandalone: window.navigator.standalone,
    innerHeight: window.innerHeight, innerWidth: window.innerWidth,
    visualViewportHeight: window.visualViewport?.height,
    devicePixelRatio: window.devicePixelRatio,
    appVhVar: getComputedStyle(document.documentElement).getPropertyValue('--app-100dvh'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    wrapperRect: rect(wrapper), wrapperBg: wrapper ? getComputedStyle(wrapper).backgroundColor : null,
    headerRect: rect(header), headerExists: !!header,
    mainScrollRect: rect(mainScroll), gridRect: rect(grid),
    userAgent: navigator.userAgent,
  }, null, 2));
})();
```

### 3.1 — Modo Safari normal (`displayMode: "browser"`)

```json
{
  "innerHeight": 1592, "innerWidth": 880, "devicePixelRatio": 3,
  "appVhVar": "1592px",
  "wrapperRect": { "top": 0, "bottom": 1592, "height": 1592 },
  "wrapperBg": "rgb(230, 240, 255)",
  "headerRect": { "top": 0, "bottom": 65, "height": 65, "left": 0, "right": 880 },
  "headerExists": true,
  "mainScrollRect": { "top": 64, "bottom": 1592, "height": 1528 },
  "gridRect": { "top": 420, "bottom": 4892, "height": 4472 }
}
```

Todo correcto: wrapper llena el viewport exacto con el color esperado
(`#E6F0FF`), header en `top:0`, `#main-scroll` llena el resto, grid con
contenido scrolleable. **Coincide con la primera captura del usuario en
Safari, donde el ☰ sí se veía.**

### 3.2 — Modo PWA standalone (`displayMode: "standalone"`, `navigatorStandalone: true`)

```json
{
  "innerHeight": 1788, "innerWidth": 880, "devicePixelRatio": 3,
  "appVhVar": "1788px",
  "wrapperRect": { "top": 0, "bottom": 1788, "height": 1788 },
  "wrapperBg": "rgb(230, 240, 255)",
  "headerRect": { "top": 62, "bottom": 127, "height": 65, "left": 0, "right": 880 },
  "headerExists": true,
  "mainScrollRect": { "top": 126, "bottom": 1788, "height": 1662 },
  "gridRect": { "top": 482, "bottom": 4954, "height": 4472 }
}
```

**También correcto matemáticamente**: `--app-100dvh` mide bien (1788px =
`innerHeight` exacto), el wrapper llena el viewport real con el color
esperado, el header existe con dimensiones sanas (`top:62` = debajo del
área segura del notch/Dynamic Island, alto 65px normal), `#main-scroll`
llena el resto. **A pesar de estos números correctos, la captura de
pantalla tomada en el mismo estado (§3.3) muestra el header invisible.**

### 3.3 — Captura de pantalla (mismo estado que 3.2)

El usuario adjuntó una captura mostrando: status bar con hora/batería en
blanco sobre una **franja gris oscura sólida** (no el violeta claro
esperado `rgba(221,216,255,0.88)`), seguida inmediatamente por la pill de
tabs "Inicio · General · Comercial...". **Ningún rastro visual** del logo
"Portal", el ícono ☰, buscador, campana o avatar — a pesar de que el DOM
reporta que existen con estilos correctos (ver 3.4).

### 3.4 — Estilos computados del header (mismo estado, mismo dispositivo)

```json
{
  "headerOwnBg": "rgba(221, 216, 255, 0.88)",
  "headerOwnBackdropFilter": "blur(40px) saturate(1.8)",
  "headerOwnBoxShadow": "rgba(110, 70, 220, 0.1) 0px 4px 20px 0px"
}
```

El elemento header, consultado directamente por `querySelector`, tiene el
background y backdrop-filter **correctos**. Esto descarta que el CSS en sí
esté mal — el problema es que **algo más se está pintando por encima**, o
el header no se está pintando en la posición que `getBoundingClientRect`
reporta.

### 3.5 — `elementFromPoint` en la zona del header (mismo estado)

```js
document.elementFromPoint(300, 20)  // zona status bar
document.elementFromPoint(300, 90)  // zona header (dentro de headerRect: top 62–127)
```

```json
[
  { "point": "status-bar area (y=20)", "tag": "DIV.lg:hidden shrink-0 w-full", "bgColor": "rgba(0, 0, 0, 0)" },
  { "point": "header area (y=90)", "tag": "DIV.lg:hidden shrink-0 w-full", "bgColor": "rgba(0, 0, 0, 0)" }
]
```

**Esto es la pista más concreta.** El elemento topmost en AMBOS puntos
(incluyendo `y=90`, que cae dentro de `headerRect` 62–127) es el **spacer**
(`<div className="lg:hidden shrink-0 w-full" style={{height: 'calc(env(safe-area-inset-top, 0px) + 64px)'}} />`,
`AppLayout.jsx:1032-1035`) — **NO** el header (`AppLayout.jsx:988-996`,
`position:fixed z-40`). El spacer es transparente (`bgColor: rgba(0,0,0,0)`)
y no debería estar "encima" de nada — pero el navegador lo reporta como el
elemento en esa posición, no el header.

**Importante:** `elementFromPoint` reporta el elemento usado para
*hit-testing* (interacción), que puede diferir del elemento pintado
visualmente si hay diferencias de `pointer-events` — no es 100% prueba de
que el spacer esté pintado *encima* visualmente, pero es una señal fuerte
combinada con la captura de pantalla (§3.3) de que algo en esa zona no se
comporta como se espera de un `position:fixed z-40`.

## 4. Hipótesis actual (sin confirmar — siguiente paso)

El spacer (`AppLayout.jsx:1032-1035`) y el header fijo (`AppLayout.jsx:
988-996`) ocupan **la misma región de pantalla** en standalone: con
`env(safe-area-inset-top) ≈ 62px` en este dispositivo, el spacer mide
`62+64=126px` (0 a 126) y el header mide 65px empezando en 62 (62 a 127) —
prácticamente el mismo rango vertical.

Estructuralmente:
- `<main>` (`AppLayout.jsx:987`) tiene `position:relative z-20` — establece
  su propio contexto de apilamiento.
- El header (`AppLayout.jsx:989`) es `position:fixed z-40`, hijo de `<main>`.
- El spacer (`AppLayout.jsx:1032`) es `position:static` (sin z-index), hijo
  de `<main>`, **después** del header en el DOM.

Por las reglas de CSS, un descendiente `position:fixed` con z-index
explícito debería pintarse SIEMPRE por encima de un hermano
`position:static` dentro del mismo contexto de apilamiento,
independientemente del orden en el DOM. Que el spacer aparezca como
elemento topmost en `elementFromPoint` sugiere que **algo en esta
combinación específica (fixed dentro de un ancestro con
`position:relative + z-index` que además está dentro de un wrapper con
`overflow:hidden`) no se comporta como el modelo mental estándar**, al
menos en WebKit/iOS en modo standalone — posiblemente relacionado con cómo
Safari/WebKit maneja el *containing block* de elementos fixed dentro de
contextos de apilamiento anidados, o con algún efecto de `filter`/`blur`
en un ancestro (hay `backdrop-blur` y `blur()` en varios lugares del árbol:
`GlobalBackground`, el propio header, `blurClasses` condicional en
`<main>`) que podría estar creando un *containing block* inesperado para
el header y alterando su posición/stacking real de forma distinta a lo que
`getBoundingClientRect` mide.

## 5. Siguiente paso concreto pedido (sin completar)

Se le pidió al usuario usar la herramienta de selección de elemento del
inspector remoto (ícono de flecha/cursor en la barra de Safari Develop) y
tocar directamente sobre la franja gris en la pantalla real, para ver en
el panel **Elements** qué nodo DOM está *realmente pintado* ahí (más
confiable que `elementFromPoint` para confirmar visualmente). **Esta
respuesta no se llegó a obtener** — el usuario cortó la investigación acá
para documentar y continuar con otro agente.

## 6. Dónde seguir

1. **Completar el paso del §5** — confirmar con el selector de elementos
   del inspector qué nodo se pinta realmente en la franja gris.
2. Si se confirma que el spacer (u otro elemento) tapa el header:
   revisar por qué un `position:fixed z-40` no gana el stacking contra un
   `position:static` hermano en este árbol — sospechosos concretos:
   - `blurClasses` en `<main>` (`AppLayout.jsx:987`) — cuando
     `isOverlayActive` es true agrega `blur-[2px]` + `scale-[0.98]`
     (crea *containing block* para `position:fixed` descendientes). ¿Está
     activo por error en este estado?
   - `backdrop-filter` en el propio header y en `GlobalBackground`
     (`App.jsx`) — un `filter`/`backdrop-filter` en un ANCESTRO del header
     (no en el header mismo) crearía un *containing block* que reposiciona
     el fixed contra ESE ancestro en vez del viewport, lo cual encajaría
     con que el header "exista" en el rect esperado pero no se pinte donde
     se ve visualmente.
   - Revisar si `<main>` o algún padre tiene `transform`/`filter`/
     `will-change` activo condicionalmente en standalone que no esté
     presente en Safari normal (explicaría por qué Safari sí funciona y
     standalone no, con el MISMO código).
3. Confirmar también la franja blanca del fondo (§1) con datos en vivo —
   no se alcanzó a recolectar; probablemente relacionada con el mismo
   stacking bug si el spacer/header están alterando la altura efectiva de
   `#main-scroll` al no estar bien apilados.
4. **No repetir intentos de "medir mejor la altura"** — ya se probó 3 veces
   (v2.30.0 revert, v2.30.1 revert, v2.30.2 medición JS, v2.30.3
   consistencia) y los datos en vivo (§3) muestran que la altura YA se mide
   correctamente. El bug es de **paint/stacking order**, no de medición.

## 7. Archivos relevantes (estado actual, HEAD = `94b9104`)

- `src/components/layout/AppLayout.jsx`:
  - L987: `<main>` con `blurClasses` condicional.
  - L988-996: header fijo.
  - L1032-1035: spacer.
  - L1038: `#main-scroll`.
  - L1051: bottom-tabs fijo (mismo patrón que el header, mismo riesgo).
- `src/App.jsx`:
  - L548: wrapper autenticado (`var(--app-100dvh, 100dvh)`).
  - L761: `GlobalBackground` (fondo ambiental).
- `index.html` L36-56: script que mide `--app-100dvh` vía JS.
- `src/version.js` L8-90 aprox.: changelog completo de v2.30.0 a v2.30.3 con
  el detalle de cada intento.

## 8. Hallazgo 2026-07-23 — causa raíz probable: bug de iOS 26/26.1, NO del código

Investigación externa (Fable, 2026-07-23) encontró un bug de iOS reportado
masivamente que calza punto por punto con este caso:

**El bug**: desde iOS 26.0/26.1 (sept–nov 2025), las web apps agregadas a
inicio (PWA standalone) **pierden la capacidad de dibujar a pantalla completa
en orientación vertical**: el sistema pinta una **barra opaca arriba que tapa
el contenido** (su color varía según el sitio — de ahí el "gris oscuro"), el
efecto `black-translucent` del status bar se pierde, y **en horizontal sí
sigue funcionando**. Probaron de todo en la comunidad: **ningún workaround por
CSS, manifest.json ni viewport-fit funcionó** — es un bug del compositor del
OS, reportado a Apple vía Feedback Assistant, y **corregido en iOS 26.2**
(confirmado por usuarios: "full screen fully restored").

Fuentes: hilo de MacRumors "iOS 26.1 PWA full screen broken"
(forums.macrumors.com/threads/2470545), comunidad Glide "Webapp status bar
not transparent anymore" (afecta iOS 26 y 26.1, contenido tapado por barra
opaca, sin workaround, atribuido a Apple).

**Por qué calza con TODA la evidencia de este documento:**

| Evidencia local | El bug de iOS 26.x |
|---|---|
| Reporte original del plan móvil: "en vertical el menú no aparece; en horizontal funcionan las cosas" | Portrait roto, landscape sigue fullscreen |
| Franja opaca gris oscura donde va el header, status bar blanco encima | Barra opaca del sistema sobre el contenido; color varía por sitio |
| v2.30.0→v2.30.3: 4 intentos de fix por CSS/JS, ninguno cambió nada | Comunidad: cero workarounds por CSS/manifest/viewport |
| DOM, estilos computados y rects TODOS correctos (§3) — solo el paint falla | El bug es del compositor del OS, invisible para el DOM |
| `elementFromPoint` desfasado (hit en el spacer, no en el header) | Desfase frame del webview vs pantalla al perder fullscreen |
| Franja blanca/vacía al fondo | El contenido desplazado/tapado arriba "sobra" abajo |

**Sobre el "iOS 18.7" del §1 — dato NO confiable**: Apple congeló el user
agent de Safari por privacidad a partir de iOS 26: los dispositivos en iOS
26.x reportan `iPhone OS 18_6`/`18_7` en el UA (según sub-versión de Safari).
Es decir, el UA capturado no distingue entre un iPhone realmente en iOS 18.7
y uno en iOS 26.x — **el dispositivo del usuario puede estar exactamente en
iOS 26.0/26.1, la versión rota**. La versión real solo se ve en
Ajustes → General → Información → Versión de iOS.

**Plan de acción (en orden):**

1. **Ver la versión real de iOS** en el iPhone del usuario: Ajustes →
   General → Información. (Alternativa remota por consola del inspector:
   `CSS.supports('text-wrap','pretty')` → `true` = Safari/iOS 26+,
   `false` = iOS 18 real.)
2. Si está en iOS 26.0/26.1 → **actualizar el iPhone a la última versión de
   iOS** (a 2026-07 ya va por 26.5+; el fix entró en 26.2), reabrir la web
   app y reprobar en vertical. Recomendado además borrar el ícono de inicio
   y volver a "Agregar a inicio" tras actualizar (el web clip cachea chrome
   del modo standalone).
3. Si tras actualizar persiste, o si el dispositivo resulta estar en iOS 18.7
   genuino (sin reportes conocidos de este bug en 18.x) → reabrir la
   investigación de código retomando el paso §5 (selector de elementos del
   inspector sobre la franja). Hasta entonces, **no aplicar más "fixes"
   especulativos de CSS** — los datos del §3 ya demostraron que el código
   mide y estila todo correctamente.
4. La franja blanca del fondo (§1) se re-evalúa DESPUÉS de la actualización
   del OS: es consistente con el mismo bug (contenido desplazado), así que
   probablemente desaparezca junto con la franja superior.

**ACTUALIZACIÓN 2026-07-23 (mismo día): hipótesis DESCARTADA por el
usuario** — confirmó estar en versión nueva de iOS con el error intacto, y
que otros sitios como PWA funcionan perfecto en el mismo teléfono. El
problema es del portal. Ver §9.

## 9. Fix estructural aplicado — v2.31.0 (2026-07-23)

Con el OS descartado, la causa queda acotada a lo que el portal hace
distinto de una PWA normal: header `position:fixed z-40` anidado dentro de
`<main relative z-20>` dentro del wrapper `fixed overflow-hidden` con altura
medida por JS, más `backdrop-filter` sobre ese fixed — una combinación con
historial de bugs de compositor en WebKit standalone (paint ≠ layout,
exactamente lo medido en §3). En vez de seguir aislando cuál pieza exacta
rompe el paint (no reproducible localmente), se eliminó la clase entera de
problema reestructurando al patrón app-shell estándar:

1. **Shell sin altura medida**: wrapper, `GlobalBackground` y raíz de
   AppLayout ya no usan `--app-100dvh` (script de index.html eliminado);
   `fixed inset-0` define la caja — es el viewport por definición, no puede
   medir mal en ningún contexto.
2. **Header móvil = flex-item normal** (no `position:fixed`), primer hijo
   de `<main>`, con `padding-top: env(safe-area-inset-top)` pintando su
   propio fondo bajo el status bar (patrón claude.ai). Spacer eliminado.
3. **Bottom-tabs = flex-item final** con safe-area-bottom; padding
   compensatorio de `#main-scroll` y strip de vidrio inferior eliminados.
4. **Cero `backdrop-filter` en el chrome móvil** (header, tabs, backdrop
   del drawer, cara del sidebar `<lg`): fondos casi opacos. Desktop
   pixel-igual (blur solo `lg:`).
5. **Drawer**: altura por `top-0 bottom-0` + márgenes (antes:
   `calc(medido - 16px)` que en standalone desbordaba el viewport al sumar
   el margen safe-area-top de 62px).

Diferencia clave con v2.30.0 (que también probó flex-items y falló): aquí
el alto del shell NO depende de `100dvh` ni de JS — `inset-0` es exacto—,
y el chrome móvil no usa blur. Verificado con Playwright (WebKit iPhone 13
+ Chromium 1440): header visible en top:0 estático, scroll interno
funcional (scrollTop sostenido), drawer OK, sin overflow horizontal,
desktop intacto. **Falta la única verificación que importa: el dispositivo
real del usuario en modo standalone** (recomendado: borrar el ícono de
inicio y re-agregar tras el deploy, el web clip cachea).

## 10. Descubrimiento crítico (2026-07-23, post-v2.31.0): la PWA era una sesión zombie

El usuario reportó "sigue igual" con capturas PWA vs Safari tomadas el
mismo minuto (7:34am) — y las capturas prueban otra cosa: **la PWA mostraba
los datos del día anterior** (775 documentos / $7,953, gráficas del día
completo) mientras Safari mostraba los de hoy (18 docs / $205). Una app
recién cargada habría traído datos frescos ⇒ iOS estaba **resumiendo la
sesión suspendida de ayer** (código v2.30.x congelado), no recargando.
Las web apps standalone de iOS nunca recargan solas al reabrirse ni tienen
botón de refresh — **ningún fix desde v2.30.0 llegó a ejecutarse en la
instancia del usuario**. Esto invalida todos los "no cambió nada" como
evidencia contra los fixes (incluido v2.31.0, aún sin probar realmente).

- **Fix preventivo (v2.31.1)**: script inline en `index.html` que, solo en
  standalone/nativo, recarga al volver a primer plano tras >30 min oculta.
  Los deploys futuros llegan solos.
- **Paso único pendiente del usuario**: matar la instancia zombie — borrar
  el ícono, force-quit en el app switcher, re-agregar desde Safari — y
  recién entonces evaluar v2.31.0 en standalone.
- El SW (`public/sw.js`) fue auditado y descartado: network-first, solo
  fallback offline, no cachea el bundle.

## 11. Modelo definitivo — v2.32.0: body scroll en móvil (2026-07-23)

El usuario aclaró el requisito real: no quiere el app-shell "enjaulado"
entre la isla dinámica y la barra de URL de Safari — quiere que el
contenido FLUYA por debajo de las barras (y que la barra de Safari se
colapse al scrollear), como una página normal. Eso es imposible con
scroll interno: Safari solo lo hace con scroll de documento. Cambio de
modelo en `<1024px` (v2.32.0, commit `bf8f881`):

- `index.css`: media query estática — `html/body/#root` con
  `overflow:visible; height:auto; overscroll-behavior-y:auto` en móvil.
- Wrapper autenticado: `relative min-h-[100dvh]` en móvil;
  `fixed inset-0 overflow-hidden` solo `lg:`.
- Header móvil: `sticky top-0 z-30` (sin fixed, sin blur, fondo sólido
  con safe-area-top).
- `#main-scroll`: deja de ser scroll container en móvil; el documento
  es el scroll. `ScrollToTop` resetea window + #main-scroll siempre.
- Bottom-tabs: `fixed bottom-0` como HERMANO directo del root de
  AppLayout (cero ancestros con z-index/overflow — la lección del bug
  standalone), padding compensatorio en #main-scroll para hasSelfOnly.
- Desktop `lg+`: intacto (app-shell fijo + scroll interno).

Verificado Playwright: móvil documento scrolleable (4,986px), sticky
header estable tras scroll, sin overflow horizontal, desktop sin
cambios. Pendiente: confirmación en iPhone real (Safari + standalone
fresco post-zombie).

## 12. v2.32.1 — status bar reservado (fix de la hamburguesa tapada en PWA)

Con v2.32.0 el usuario confirmó Safari OK, pero en la PWA fresca el header
quedaba bajo la isla dinámica: `env(safe-area-inset-top)` devolvía 0 (la
zombie de ayer medía 62px — el iOS se actualizó entre medio; iOS 26 tiene
regresiones conocidas de safe-area en standalone). Fix robusto sin
depender de env(): `apple-mobile-web-app-status-bar-style` pasó de
`black-translucent` a `default` (iOS RESERVA la franja del status bar; el
contenido nunca queda debajo), padding env() del header conservado como
respaldo, `theme-color` = color exacto del header (#e2defc). OJO: iOS
captura estos meta al crear el web clip — cambiarlos exige borrar y
re-agregar el ícono. **Confirmado funcionando por el usuario.**

## 13. Seguimiento abierto: "veo todo pero super pequeño"

Tras el cierre, el usuario reporta que todo se ve muy pequeño en el
teléfono. Dos pistas a separar:

1. **Sospecha principal — viewport de escritorio en SU Safari**: los datos
   en vivo del §3 midieron `innerWidth: 880` con DPR 3 en un iPhone (lo
   normal sería ~390-440). 880 ≈ el layout renderizando a ancho doble y
   escalado a la mitad = "todo pequeño". Causa típica: "Solicitar sitio
   web de escritorio" activado por sitio (herencia de la era
   MobileConstructionScreen, cuando el móvil estaba bloqueado) o zoom de
   página <100% recordado por Safari. Verificar en el iPhone: aA en la
   barra de Safari → zoom al 100% y "Solicitar sitio web de escritorio"
   desactivado para portal.farmasalud.lat → borrar y re-agregar el web
   clip. Esto NO se puede corregir desde el código.
2. **Adaptación por vista (sí es del código)**: las vistas son
   desktop-first y a 390px reales quedan densas. Eso es exactamente la
   **Fase T4 de AUDITORIA-TEMA-2026-07.md** (fusión de la Fase 4 móvil):
   pase vista por vista con tokens + responsive (tablas→cards <640px,
   pills en wrap, inputs ≥16px, touch targets ≥44pt), en orden de vistas
   de tienda primero. El shell (Fases 1-3 móviles) queda CERRADO con esta
   auditoría; T4 es el siguiente tramo.
