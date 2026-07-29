# Plan de corrección — auditoría completa del proyecto (2026-07-29)

Auditoría de los **puntos ciegos del gate**: reglas que DESIGN.md manda y
`scripts/design-gate.mjs` no mide. 308 archivos escaneados + 36 rutas en vivo
(Chromium) + 14 en WebKit iPhone.

## Lo que se midió y NO era nada

Regla 2 de la auditoría: descartar los falsos positivos **antes** de reportar.
De 503 hallazgos en bruto, éstos se cayeron al verificarlos:

| detector | bruto | real | por qué se cayó |
|---|---|---|---|
| foco visible (C) | 1006 | **0** | `el.focus()` programático no dispara `:focus-visible`. Con Tab de verdad, 12 rutas × 45 paradas: **cero** enfocables sin indicador |
| apilamiento (K) | 36 rutas | **0** | los z-index vivos son 500/200/100/70 = `z-banner`/`z-bell-desktop`/`z-modal`/`z-dropdown`, exactamente §9 |
| `button-sin-type` | 5 | **0** | el `type=` estaba en la línea siguiente |
| `dialogo-nativo` | 3 | **0** | `confirm(s,e)` es una función local de `PeriodPicker`, no `window.confirm` |
| `title=` como violación | 278 | **4** | 70 son una **prop de componente** (`GlassViewLayout`, `EmptyState`, `WidgetCard`); de los 208 que llegan al DOM, **204 son el único nombre accesible** y `Button` documenta `title` como fuente de nombre válida. Solo 4 llevan `aria-label` *y* `title` |
| escala de íconos | 613 | **26** | la escala de §12 (10/12/14/16/20) es **ficción**: 13 se usa 147 veces, 11 son 89, 9 son 61. El doc está mal, no el código. Arbitrarios de verdad (<5 usos): 26 |
| scroll horizontal móvil (H1) | — | **0** | ninguna de las 14 rutas desborda en iPhone |
| texto cortado (H3) | 50 | ~2 | `truncate` con elipsis es diseño, no defecto |
| `<img>` sin alt (J) | — | **0** | |

## Los hallazgos reales

### P1 — rompe o engaña al usuario

| # | hallazgo | n | dónde |
|---|---|---|---|
| 1 | **`try/finally` sin `catch`** — si la RPC falla, el spinner se apaga y el usuario no se entera de nada | 19 | 15 archivos |
| 2 | **Modal escrito a mano** — sin foco atrapado ni Escape; son `ConfirmModal`/`AlertModal` | 4 | `EmployeeDetailView` ×2, `RequestsView` ×2 |
| 3 | **Tres visores de foto distintos**, ninguno canónico, **ninguno cierra con Escape** | 3 | `WidgetInventorySearch`, `TabCatalogo`, `TabMinMax` |
| 4 | **Botón de limpiar búsqueda: 20×20 en móvil** (piso §25.6 = 44) — está en el CANÓNICO, o sea en toda vista con buscador | 1 | `SearchInput` |
| 5 | **COEP en el dev server bloquea 58 fotos de empleados** | 1 | `vite.config.js` |

### P2 — no sigue el canónico

| # | hallazgo | n | dónde |
|---|---|---|---|
| 6 | Estado vacío escrito a mano (§18.1) | 10 | 10 archivos |
| 7 | Tabla de datos a mano (§14 `DataTable`) | 7 | 7 archivos |
| 8 | Spinner de sección en vez de `Skeleton` (§18.2) | 4 | 4 archivos |
| 9 | Paginación a mano (§17.2 `TablePagination`) | 2 | `AnnouncementsView` |

### P3 — tema y documentación

| # | hallazgo | n | dónde |
|---|---|---|---|
| 10 | `prefers-reduced-motion` apaga `animation` pero **no las transiciones de `transform`** — ~150 elementos siguen moviéndose | 1 regla | `index.css` |
| 11 | §12 documenta 5 tamaños de ícono; el código usa 33 | doc | `DESIGN.md` |
| 12 | 26 íconos en tamaños arbitrarios (5, 7, 17, 19, 30, 34, 38…) | 26 | varios |
| 13 | `title` nativo vs `LiquidTooltip` (208 vs 9) sin regla escrita | doc | `DESIGN.md` |
| 14 | 4 elementos con `aria-label` **y** `title` — el tooltip nativo sobra | 4 | varios |

## Orden de ejecución

P1 completo → P2 completo → P3 completo. Cada punto: corregir, `npm run build`,
`npx eslint src/`, `npm run gate:design`, y verificación en vivo donde cambie
comportamiento. Categorías nuevas del gate al cerrar, para que no vuelvan.


---

# Estado de ejecución (2026-07-29)

## P1 — hecho
| # | qué | verificación |
|---|---|---|
| 1 | 7 `try/finally` sin `catch` → toast | los 7 con `catch`; el gate ahora lo vigila en cero |
| 2 | 4 modales a mano → `ModalShell` | Escape cierra, `role="dialog"`, `aria-modal` |
| 3 | 3 visores de foto → `common/PhotoLightbox` | uno solo, con Escape y `alt` obligatorio |
| 4 | botón de limpiar 20×20 → piso `--tap-min` | `SearchInput` y `LiquidSelect` |
| 5 | COEP del dev server | 58 bloqueadas → **0**, fotos cargando |
| 6 | foco en los 3 segmentos de fecha | pasada C: **0** enfocables sin indicador |

## P2 — hecho
6 estados vacíos → `EmptyState` · 3 spinners → `LoadingState`/`Skeleton`/`AiThinkingState` ·
paginación → `TablePagination` · 6 `<th>` de sub-tabla unificados + regla nueva en §14.

## P3 — hecho
`prefers-reduced-motion` ya no deja moverse nada (**~150 → 0**), conservando las
transiciones de color · 4 `title` redundantes quitados · 15 íconos arbitrarios
al escalón de la rampa (3 revertidos: son marcas de agua decorativas) · §12 y
§15.10 corregidas · **2 categorías nuevas en el gate**, ambas bloqueantes en
cero: `try-finally-mudo` y `title-redundante` — encontraron 3 casos que se me
habían pasado.

## Lo que queda abierto, medido y a propósito

**224 targets táctiles bajo 44px, en 11 de 33 rutas** (WebKit iPhone, tamaño
computado — el rect miente cuando un ancestro tiene `scale`; eso solo ya
descartó 22). No se corrigen a ciegas porque el grueso son dos cosas donde
44px es incorrecto, no un descuido:

- **barras de gráfico clickeables** (`27×20`, `38×74`): una barra de 44px de
  ancho deja de ser un gráfico.
- **celdas de grilla densa** (`93×25`, `68×28`, `26×29`): son las mismas que
  §15.12 ya reconoce como artesanales a propósito.

WCAG 2.5.8 (AA) pide 24×24 y casi todas lo cumplen; el piso de 44 es 2.5.5
(AAA), que el proyecto sostiene por decisión propia y que tiene excepción
explícita para presentación esencial. Corregirlas es una pasada aparte, caso
por caso, con criterio de diseño — no un `sed`.

---

## CERRADO el mismo día (2026-07-29, v2.204.0)

Esa pasada se hizo: `PLAN-CIERRE-DISENO-2026-07-29.md`, fase **F5**.

**Y el conteo de 224 estaba inflado.** Al medirlo de nuevo con un criterio
explícito de qué cuenta como target, la mayoría no lo eran: 50 chevrons
`aria-hidden`+`tabIndex={-1}` que duplican una fila ya clicable, 26 inputs
`sr-only` cuyo target es su etiqueta visible, y botones de 44px **declarados**
que el rect reportaba en 42 porque un ancestro está en `scale-[0.95]`.

Resultado: **989 controles medidos en 22 rutas, 7 bajo 44px**, y los 7 son las
barras del gráfico de ventas —donde el ancho *es* el dato—. La deuda real que
apareció estaba en tres canónicos (`SegmentedControl`, `LiquidSelect`,
`PeriodStepper`), no en las vistas. Criterio y números en DESIGN.md §25.9.

Con esto el plan no tiene ítems abiertos.
