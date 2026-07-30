# Plan de cierre de IDENTIDAD — 2026-07-29

Continuación de `planes-cerrados/PLAN-CIERRE-DISENO-2026-07-29.md`. Ese plan
cerró la **forma**: 24 categorías del gate en cero absoluto, baseline vacío,
paleta cerrada, controles canónicos, rampa de íconos reconciliada. Este plan
cierra lo que el gate **no puede ver por construcción**, porque no es forma.

## Por qué falta algo si el gate está en verde

El gate lee JSX y CSS: mide clases, atributos y estructura. Identidad también es
la **palabra** que lee el usuario, la **cifra** que le mostramos y el
**significado** que le asignamos a un ícono. Nada de eso vive en una clase de
Tailwind, así que el gate en verde no dice nada sobre ellos — y efectivamente,
al medir, los tres estaban a la deriva.

### Lo que YA está cerrado (verificado en esta sesión, no asumido)

Antes de abrir fases, descarté cuatro sospechas para no trabajar de más:

| Sospecha | Medición | Veredicto |
|---|---|---|
| Los 4 temas no tienen paridad de tokens | `dark ⊆ solid-dark` y `solid ⊆ solid-dark`, **cero asimetrías**. Los 15 tokens que solid-dark agrega sobre solid (`--*-text`, `--focus-ring-color`) son los de texto-sobre-color, que sí deben cambiar en oscuro | **Sano.** No hay token que caiga al valor claro sobre fondo oscuro |
| El preloader de `index.html` quedó fuera del tema | Define los 4 temas (`#e4e0ff` / `#0b1330` / `#f4f6fb` / `#0f172a`) | **Cerrado.** El ítem abierto de `theme_audit_2026_07_22` ya no aplica |
| 18 vistas con tabla no tienen `EmptyState` | Usan `empty={{icon, message}}`, que es la prop canónica de `DataTable` | **Falso positivo** |
| ~290 `title=` son tooltips nativos sin migrar | De 348 usos reales, ~110 son la **prop** `title` de un componente React (`EmptyState`, `GlassViewLayout`, `WidgetCard`, `IslandHeader`…) y 145 son `Button`/`button`/`ListRow`, caso que §15.10 resolvió hoy | **Mayormente cerrado.** Quedan 52 — ver F3 |

Queda también un residuo de spacing/radios arbitrarios (80 y ~15) que **no entra
al plan**: son `env(safe-area-inset-bottom)`, offsets de layout (`pt-[200px]`) y
redondeos de encabezado de tabla. Legítimos.

---

## F1 — La cifra: `$1234,56` en el Dashboard (v2.235.0)

**Prioridad máxima: es el único hallazgo que además es un defecto de
corrección, y está en la pantalla más vista del portal.**

### Hallazgo

No existe formateador canónico de moneda ni de cantidad. `src/utils/helpers.js`
exporta `formatDate`, `formatTime12h`, `formatPhoneMask` — nada de cifras. El
único `fmtMoney` del proyecto vive enterrado en `conteoInventarioPrint.js`.
Resultado medido: **50 `toFixed(2)`**, **15 combinaciones distintas de opciones
`Intl`** y **4 locales** (`es-SV` 89, `es` 69, `es-ES` 20, `en-US` 17) más un
`es-VE` suelto.

Y las locales no son equivalentes:

```
es-SV   1,234.56      ← convención de El Salvador
en-US   1,234.56
es      1234,56       ← coma decimal, SIN separador de miles
es-ES   1234,56
es-VE   1.234,56      ← punto de miles + coma decimal
```

Entonces esto, hoy, en producción:

| Archivo | Línea | Render |
|---|---|---|
| `DashboardView.jsx` | 1400, 1785, 1851, 1915 | `$1234,56` |
| `DashboardView.jsx` | 2183, 2185 | KPI "Monto cotizado" y "Facturado hoy" → `$1234` |
| `EmployeeAnnouncementsView.jsx` | 145, 508 | `$1.234,56` |

Ocho lugares donde el monto sale con la convención equivocada para El Salvador,
seis de ellos en el Dashboard. El resto del portal muestra `$1,234.56`. El mismo
número se ve distinto según la pantalla.

### Decisión

Un solo módulo `src/utils/formatNumber.js`, locale **fijo `es-SV`** en todas las
cifras (no heredar del navegador: el portal es de un solo país y un navegador en
`es-ES` cambiaría los separadores del ERP entero):

```js
export const formatMoney = (n, { decimales = 2, signo = true } = {}) => …  // $1,234.56
export const formatQty   = (n, { decimales = 0 } = {}) => …                // 1,234
export const formatPct   = (n, { decimales = 1 } = {}) => …                // 12.3%
```

`formatMoney(null)` / `undefined` / `NaN` → `'—'`, no `'$NaN'`. Hoy cada sitio
resuelve el nulo a su manera y hay `$NaN` alcanzable.

### Alcance

1. Crear `formatNumber.js` con las tres funciones + tests de mesa en el header del archivo.
2. Corregir los 8 sitios de la tabla de arriba (el bug real).
3. Migrar los 50 `toFixed(2)` de moneda a `formatMoney`. **No** los `toFixed()`
   que son cálculo, ni los de `csvExport.js` (un CSV con separador de miles se
   rompe al abrirlo).
4. Dejar las fechas para el final del alcance: `formatDate` ya existe y es
   canónico; solo unificar el locale de los `toLocaleDateString` sueltos a `es-SV`.

### Gate nuevo: `formato-cifra` — bloqueante en 0

Falla ante `toLocaleString(` con locale que no sea `'es-SV'`, y ante
`` `$${…toFixed(2)}` `` (plantilla de moneda a mano). `EXCEPTIONS`: `csvExport.js`,
`conteoInventarioPrint.js`, `pedidoPrint.js` (plantillas de impresión, con motivo escrito).

### Verificación

`npm run gate:design` verde · build + lint · captura del Dashboard mostrando
`$1,234.56` en los dos KPI corregidos.

---

## F2 — La palabra: microcopy sin estándar (v2.236.0)

### Hallazgo

`DESIGN.md` tiene 3,370 líneas y **cero** sobre voz, tono o capitalización. Es
la única primitiva del sistema sin doc. Medido en un solo slot —el mensaje de
vacío— hay cuatro gramáticas conviviendo:

| Forma | Ejemplos reales |
|---|---|
| `Sin X` | `Sin resultados`, `Sin productos para este filtro`, `Sin pagos confirmados` |
| `Sin X` **con punto final** | `Sin facturas en el período.`, `Sin proveedores registrados todavía.`, `Sin productos con historial de compras.` |
| `No hay X` | `No hay registros`, `No hay nadie aquí`, `No hay productos ocultos` |
| `Aún no hay X` / `No se encontraron X` | `Aún no hay cotizaciones`, `No se encontraron productos`, `Sin corridas registradas todavía` |

Más Title Case dentro de slots de oración: `Sin Horarios`, `Datos Incompletos`.

Es la misma deriva que tenían los colores antes de la paleta cerrada: cada quien
resolvió lo mismo a su manera porque no había dónde mirar.

### Decisión — nueva §26 de `DESIGN.md`, "Voz"

1. **Vacío: `Sin <sustantivo plural>`**, sin punto final, sin "aún", sin
   "todavía", sin "registrados". `Sin ventas para este período`, no
   `Aún no hay ventas registradas en el período.` — el "aún" promete algo que la
   app no sabe, y el punto final en una frase de 3 palabras es ruido.
2. **Búsqueda sin resultados ≠ vacío.** Son dos estados distintos y el usuario
   necesita distinguirlos: `Sin resultados para "<término>"` cuando hay filtro
   activo, `Sin <sustantivo>` cuando la tabla está genuinamente vacía. Varias
   vistas ya lo hacen (`VentasView`); se vuelve regla.
3. **Sentence case en todo texto de interfaz.** Mayúscula inicial y ya. La
   ÚNICA excepción es la etiqueta en versalitas de `text-caption`
   (`uppercase tracking-widest`), que ya está en §7.
4. **Sin punto final** en etiquetas, botones, badges, encabezados y mensajes de
   una sola oración. Sí lo llevan los párrafos de dos oraciones o más.
5. **Botón = verbo en infinitivo**: `Guardar`, `Agregar producto`, `Confirmar
   conteo`. No `Guardado`, no `¡Guardar!`, no `OK`.
6. **Segunda persona, sin "por favor" ni signos de exclamación.** El portal es
   una herramienta de trabajo: informa, no anima.
7. **Error = qué pasó + qué hacer.** `No se pudo guardar el conteo. Revisá la
   conexión e intentá de nuevo.` Nunca el código crudo del error al usuario.

### Alcance

Reescribir los ~40 mensajes de vacío del inventario medido + los toasts que
violen 4/5/6. Es cambio de strings: sin riesgo estructural, se hace en una pasada.

### Gate nuevo: `copy-vacio` — bloqueante en 0

Sobre los slots conocidos (`empty={{…message}}`, `<EmptyState title/subtitle>`,
`message:` de `AlertModal`/`ConfirmModal`): falla si el texto termina en `.` y
tiene una sola oración, si empieza con `No hay`/`Aún no`/`No se encontraron`, o
si tiene ≥2 palabras capitalizadas seguidas (Title Case).

Un gate de copy tiene falsos positivos por naturaleza. Por eso mide solo los
slots enumerados —no todo string del proyecto— y por eso `EXCEPTIONS` acá se usa
sin culpa cuando el texto es correcto y el regex se confunde.

### Verificación

`npm run gate:design` verde · recorrer las 6 vistas con más mensajes de vacío
(`StaffManagementView`, `VentasView`, `AuditView`, `ProveedoresView`,
`FacturasCompraView`, `TabCatalogo`) con la tabla vacía y captura de cada una.

---

## F3 — Los 52 `title=` que no nombran nada (v2.237.0)

### Hallazgo

§15.10 resolvió hoy el caso del **botón**: `title=` nombra un control de solo
ícono, `LiquidTooltip` explica, y conviven. Correcto y ya aplicado. Pero esa
medición no separó por tipo de elemento. Al hacerlo:

| Destino del `title=` | Usos | Estado |
|---|---|---|
| Prop `title` de componente React (`EmptyState` 40, `GlassViewLayout` 39, `WidgetCard` 15, `IslandHeader` 4, `Card` 4, `ConfirmModal` 4, `AiThinkingState` 5…) | ~110 | No es un tooltip. Nada que hacer |
| `Button` 112, `button` 14, `ListRow` 13, `a` 3, `label` 3 | 145 | Nombre de control — sancionado por §15.10 |
| **`span` 25, `div` 13, `h4`/`th`/`td`/`p` 12** | **50** | **Abierto** |
| `iframe` 2 | 2 | Requerido por accesibilidad |

Los 50 son el caso "explicar" de la tabla de §15.10, resuelto con el mecanismo
del caso "nombrar". Y sobre un `<span>` no focusable el `title` es peor que en un
botón: no lo alcanza el teclado (nunca recibe foco), no existe en táctil, y
tampoco hay lector de pantalla que lo rescate — el argumento que justifica el
`title` del botón acá no aplica. Es información que 0% de los usuarios de dedo y
0% de los de teclado ven nunca.

Concentrados en: `StaffManagementView` (8), `FacturasCompraView` (6),
`EncuestaView` (5), `ProveedoresView` (5), `AppLayout` (3), `EncuestaAdminView` (3),
y 1-2 en otros nueve archivos.

### Decisión

Caso por caso, tres salidas — y la primera es la más probable:

1. **Borrar.** Si el `title` repite el texto que el `<span>` ya muestra, sobra.
2. **`LiquidTooltip`.** Si agrega información real. Ojo con el coste que el
   propio doc marca: envuelve el elemento y puede mover el layout — verificar
   cada uno, no envolver a ciegas.
3. **Mover al control.** Si el `span` está dentro de un botón, el nombre va en
   el botón.

Aparte, ampliar la tabla de §15.10 con la fila que faltaba: **`title=` solo sobre
elementos interactivos.**

### Gate nuevo: `tooltip-no-control` — bloqueante en 0

Falla ante `title=` sobre tag HTML en minúscula que no sea
`button|a|input|select|textarea|label|iframe|img|area`.

### Verificación

`npm run gate:design` verde · los que pasen a `LiquidTooltip`, capturados
abiertos (el tooltip se posiciona con `getBoundingClientRect` y el doc advierte
que se cierra al hacer scroll — hay que verlo, no deducirlo).

---

## F4 — El trazo del ícono: el doc describe lo que el código no hace (v2.238.0)

### Hallazgo

Hoy se reconcilió la **rampa de tamaños** contra la medición real, con el
criterio correcto: un doc que describe algo que el código no hace se arregla
diciendo la verdad, no migrando 613 íconos. Pero quedó a medias en tres puntos.

**a) La rampa recién escrita ya se contradice.** Se documentó
`8·10·11·12·13·14·16·18·20·22·24·26·28·32·36·40·48·56`, pero de la misma
medición que la generó quedaron afuera **`size={9}` (61 usos)** y **`size={15}`
(55 usos)** — 116 íconos en 49 archivos, fuera de una rampa escrita hace horas.
Más residuos de 1 uso: `5`, `17`, `30`, `34`, y `42` (×6).

**b) `strokeWidth` sigue siendo el problema que `size` ya no es.** §12 declara
`1.5` en reposo y `2` activo. La realidad: **`2.5` con 386 usos** (la mayoría
absoluta), `2` con 125, `3` con 63, `1.5` con 51, y luego `1.8` (10), `2.2` (6),
`2.25` (5), `2.75` (2), `4` (2). Diez valores.

Y no es descuido de las vistas: **los canónicos no se ponen de acuerdo entre
ellos** — `Button` y `ListRow` y `FileField` y `MenuSearchModal` usan `2.25`,
`TabBarAction` y `FilterBar` usan `2.75`. El peso óptico del portal cambia según
qué componente te toque.

**c) Las "tres marcas de agua" no son tres.** §12 lista 100/80/64. Medido: el
`64` de `FormLeadership` **no es marca de agua** (no tiene opacidad, es la
ilustración de un estado vacío, `text-content-3 mb-4`), y hay dos sin listar —
`FeedbackOverlay` 96 y `AttendanceMonitorView` 70.

### Decisión

- **Rampa:** agregar `9` y `15`. Son 116 usos en la escala fina, donde un punto
  se ve; excluirlos era un error de transcripción, no una decisión. Los residuos
  de 1 uso (`5`, `17`, `30`, `34`) se migran al vecino. `42` (×6) → `40`.
- **Trazo:** escala cerrada de **cuatro** valores, y la verdad como default:
  `1.5` (marca de agua e ilustración) · `2` (reposo) · `2.5` (**default real**,
  ícono de interfaz) · `3` (énfasis). `1.8`/`2.2`/`2.25`/`2.75` se migran al
  vecino — son 25 sitios, listados en la medición. **Dos excepciones con motivo
  escrito:** el `4` de `Checkbox` (un check fino dentro de una caja de 16px no
  se ve) y el `0.5` de la marca de agua de `FormWfmAnalytics`.
- **Los canónicos primero.** `Button`, `ListRow`, `FileField`, `FilterBar`,
  `TabBarAction`, `MenuSearchModal` al `2.5` de la escala. Eso solo ya alinea la
  mayor parte del portal, porque casi todo pasa por ellos.
- **Marcas de agua:** corregir la lista a las tres reales (100, 96, 70) y sacar
  a `FormLeadership`, que es otra cosa.

### Gate nuevo: `icono-rampa` + `icono-stroke` — bloqueantes en 0

`size={n}` fuera de la rampa; `strokeWidth={n}` fuera de `{1.5, 2, 2.5, 3}`.
La marca de agua se reconoce por `opacity-` ≤15 en el mismo elemento, o va a
`EXCEPTIONS` con su motivo.

### Verificación

`npm run gate:design` verde · captura comparada antes/después de una vista
densa (`TabMinMax`) y del `ViewTabBar`, donde el cambio de trazo de los
canónicos se ve concentrado.

---

## F5 — Un concepto, un ícono (v2.239.0)

### Hallazgo

§12 fija la librería (Lucide, única) y ahora los tamaños, pero nunca **qué ícono
significa qué**. Medido:

| Concepto | Íconos en uso |
|---|---|
| Editar | `Edit3` (33) · `Pencil` (19) · `Edit2` (10) · `Edit` (9) |
| Eliminar | `Trash2` (39) · `XCircle` (30) |
| Confirmar / OK | `CheckCircle2` (142) · `Check` (100) · `CheckCircle` (18) · `CheckCheck` (7) |

`Edit`, `Edit2` y `Edit3` son además **alias deprecados** de Lucide para
`Pencil`/`SquarePen` — deuda que se arrastra desde antes de la v0.575.

### Decisión

Mapa semántico en §12, y la parte no obvia es que **`Check` y `CheckCircle2` no
son sinónimos**: uno es una marca, el otro es un estado.

| Concepto | Canónico | Nota |
|---|---|---|
| Editar | `Pencil` | los 3 `Edit*` son alias deprecados |
| Eliminar | `Trash2` | `XCircle` es *cerrar/anular*, no borrar |
| Marca de selección | `Check` | dentro de checkbox, opción elegida, ítem tildado |
| Estado exitoso | `CheckCircle2` | badge, toast, resultado de una operación |
| Cerrar | `X` | |
| Anular / rechazar | `XCircle` | |
| Ver | `Eye` | |
| Descargar | `Download` | `openStoredFile` vs `downloadStoredFile`, ver memoria |
| Agregar | `Plus` | |
| Buscar | `Search` | |
| Filtrar | `SlidersHorizontal` | |
| Advertencia | `AlertTriangle` | |
| Información | `Info` | |

`CheckCheck` (7) queda retirado: no hay concepto de "doble confirmación" en el
portal.

### Alcance

Migración mecánica de nombre de ícono (import + JSX). Riesgo bajo pero **es un
migrador de JSX**, y ya hubo tres regresiones con build+lint+gate en verde
haciendo exactamente esto: se ejercita en la vista antes de dar por cerrado, no
solo se compila.

### Gate nuevo: `icono-semantico` — bloqueante en 0

Falla ante `Edit`/`Edit2`/`Edit3`/`CheckCheck`/`CheckCircle` importados de
`lucide-react`.

---

## F6 — La fuga de excepciones del gate (v2.240.0)

### Hallazgo

Encontrado de rebote en F1. El gate hace:

```js
if (!hasException(path, 'color') && !hasException(path, 'hex')) { … }
```

**Una excepción de `color` desactiva también el chequeo de `hex`.** Son dos
categorías distintas y en el JSON se cuentan separadas, pero comparten la
compuerta. `DashboardView.jsx` está excepcionado para `color` (panel oscuro,
motivo legítimo) y por eso mismo puede llevar hex crudos sin que nadie lo vea:
`color="#12B76A"`, `color="#F79009"` en los KPI — verdes y ámbares que **no
están en la paleta cerrada**.

Son 9 hex en 3 archivos: poco. Lo que importa es el mecanismo: una excepción
escrita para una razón está tapando una categoría que nadie decidió tapar, y es
justo el tipo de hueco que el ratchet no ve porque nunca contó esos hallazgos.

### Decisión

Separar las compuertas (`hex` chequea solo su propia excepción), reencontrar los
hallazgos que aparezcan y resolverlos. Auditar el resto del gate buscando el
mismo patrón de compuerta compartida.

**Este es el hallazgo con más valor a futuro del plan.** Los otros cinco son
deuda de una vez; éste es la razón por la que podría haber más deuda invisible.

---

## Orden y cierre

| Fase | Qué | Versión | Gate nuevo | Estado |
|---|---|---|---|---|
| F1 | Cifras: `formatMoney`/`formatQty`/`formatPct`/`formatMoneyCorto` + el bug del Dashboard | 2.237.0 | `formato-cifra` | **APLICADA** |
| F2 | Voz: §26 + ~45 strings | 2.239.0 | `copy-vacio`, `copy-trato` | **APLICADA** |
| F3 | Los 50 `title=` no interactivos | 2.241.0 | `tooltip-no-control` | **APLICADA** |
| F4 | Rampa + trazo + marcas de agua | 2.243.0 | `icono-rampa`, `icono-stroke` | **APLICADA** |
| F5 | Mapa semántico de íconos | 2.244.0 | `icono-semantico` | |
| F6 | Fuga de excepciones del gate | 2.245.0 | — (arregla el gate) | |

> Las versiones se corrieron una vez: el plan reservó 2.235.0–2.240.0, pero otra
> sesión commiteó 2.235.0, 2.235.1 y 2.236.0 mientras F1 estaba en curso. **Este
> árbol es compartido** — leer `APP_VERSION` del disco al empezar cada fase en
> vez de asumir la siguiente.

F1 primero porque es el único con un defecto de corrección en producción. F6
podría ir primero por valor estructural, pero va al final a propósito: va a
destapar hallazgos nuevos, y conviene que las cinco fases estén cerradas para
que lo que aparezca no se mezcle con deuda en movimiento.

Las 7 categorías nuevas **no van al baseline** — una categoría ausente del JSON
arranca bloqueante sola (`baseline[c] ?? 0`). Al terminar, el gate tiene **31
categorías, todas en cero absoluto**.

### Reglas de ejecución

- `EXCEPTIONS` es objeto literal: cada archivo en **una** entrada con todas sus
  categorías. Una clave repetida pisa a la anterior en silencio (`assertSinClavesDuplicadas` lo cubre).
- Cada excepción nueva va **con su motivo escrito**. Tolerar por número es más
  débil que tolerar por razón.
- `npm run gate:design` **entre** la edición y la captura: build y lint en verde
  no significan que la vista carga.
- Bump de `APP_VERSION` + entrada de changelog por fase.
- Commitear al cerrar cada fase, no al final del plan.

### Definición de terminado

`npm run gate:design` en verde con 31 categorías bloqueantes en cero · build y
lint limpios · `DESIGN.md` con §26 (Voz), §12 con trazo y mapa semántico, §15.10
con la fila de elementos interactivos · capturas de verificación de F1, F2, F3 y
F4 · este documento movido a `docs/planes-cerrados/`.
