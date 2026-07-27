# Plan — lo que falta del sistema de diseño

**Origen:** `AUDITORIA-DISENO-2026-07-26.md`. Fases D0, D0-bis, D1 y D2 cerradas.
**Estado al 2026-07-27:** gate en 1,249 hallazgos (arrancó en 6,333).
**Regla de trabajo:** una fase no se cierra sin su criterio verificable; un
hallazgo nuevo se documenta siempre, se resuelva o no.

---

## Punto de partida, medido

| Deuda | Cantidad |
|---|---|
| `white` (bg/text/border-white) | 692 |
| `shadow-literal` (sombras a mano) | 412 |
| `inline-color` (rgb/rgba en `style`) | 118 |
| `z-index` inline en tooltips portaleados | 20 |
| `motion` decorativo | 7 |
| `<button>` crudos | **639** en 102 archivos |
| `<input>` crudos | **112** en 39 archivos |
| Spinner como estado de vista | **133** |
| `EmptyState` copiado a mano | **32** archivos |

**Adopción de los canónicos hoy:** `Button` 0 · `Badge` 1 · `Skeleton` 0 ·
`EmptyState` 1 · `LoadingState` 3 · `PortalInput` 2.

Ese es el problema de fondo: los canónicos existen y nadie los usa. El resto
del plan es, casi entero, **adopción**.

---

## D2.5 — Cerrar el inventario por familia

Hecho: botones · badges · estados (skeleton/vacío/carga) · radios · densidad.

### D2.5b — Familias que faltan

| Familia | Situación | Entregable |
|---|---|---|
| **Inputs** | 112 crudos vs `PortalInput` (2 usos) | Inventario de variantes reales → extender `PortalInput` (tamaños, con/sin ícono, error, ayuda) |
| **Modales** | `ModalShell` y `UnifiedModal` (944 líneas) en paralelo | Decidir: extraer del `UnifiedModal` lo que le falta al canónico |
| **Tabs / filter pills** | `ViewTabBar` con 14 usos; pills copiadas a mano | Contar variantes reales, unificar |
| **Cards / KPI** | `StatCard` 1 uso real; KPI a mano en Inicio, Productos, Facturación | Definir anatomía y variantes |
| **Tooltips / toasts / avatares** | `LiquidTooltip` 2 usos vs `title=` nativo | Decidir si el nativo es aceptable y dónde |
| **Tamaños de icono** | sin escala declarada | Escala (12/14/16/20/24) atada a los tamaños de control |

**Cierre:** cada familia con su set canónico decidido y documentado en
`DESIGN.md`, y el gate verificando lo verificable.

---

## D3 — Adopción

La fase más grande. **No es un barrido mecánico**: cada vista se migra entera
y se verifica, porque tocar `<button>` en una vista también toca su sombra
literal, su color inline y su estado de carga.

### D3.1 — Estados de carga (133 spinners → skeleton)

Regla ya decidida y escrita:

> **Skeleton** donde el contenido tiene forma · **spinner solo** dentro del
> botón que disparó la acción · **ningún texto** de "cargando" como señal única.

El parpadeo ya está resuelto con `.skeleton-delayed` (250ms, activo por
defecto), así que la migración es mecánica contra la regla.

**Cierre:** 0 spinners como estado de sección; los 104 de botón intactos.

#### ✓ CERRADA (2026-07-27)

**25 estados de carga migrados en 24 archivos.** Al clasificarlos uno por uno
apareció que el conteo inicial de "133 spinners de vista" mezclaba cosas
distintas. El desglose real:

| | | |
|---|---|---|
| 12 | bloque centrado con solo un spinner | → `SkeletonText` |
| 6 | bloque "spinner + texto de cargando" | → `SkeletonText` |
| 6 | bloques con forma propia (tabla, visor, grilla) | → skeleton con **su** forma |
| 4 | inline "spinner + Cargando…" | → `SkeletonText` de 2 líneas |
| ~104 | dentro de un botón o acción | **intactos**, es el patrón correcto |
| ~8 | micro-indicadores de guardado junto a un elemento | **intactos**, misma razón |
| ~7 | dentro de los propios canónicos | **intactos**, son la implementación |

#### A12 · El tercer estado de espera

Al revisar los "anillos de IA" resultó que no eran spinners de carga sino un
**tercer estado** que el sistema nunca nombró:

| situación | señal |
|---|---|
| contenido con forma conocida | **skeleton** |
| acción disparada por un click | **spinner en el botón** |
| **proceso largo e indeterminado** | **`AiThinkingState`** |

Una generación de IA no tiene forma predecible —puede devolver dos párrafos o
quince, una tabla o una lista— así que un skeleton mentiría sobre lo que viene.
Y tarda segundos, no milisegundos: el usuario necesita ver que algo sigue
trabajando, no un placeholder inmóvil.

Estaba copiado a mano en 7 archivos con tamaños, colores y duraciones
distintas. Ahora es `AiThinkingState` (en `StateViews.jsx`), con los anillos
sobre `--chart-3`/`--chart-5` en vez de los morados crudos de cada copia, y
`steps` para rotar mensajes —en una espera larga un texto fijo se lee como
colgado. Adoptado en `FormAiSchedulerPreview`, `BranchesView`, `TabStaff` y
`TabHistory`.

**No se tocaron** los anillos decorativos (ícono de cabecera, efecto hover):
no son estados de espera.

### D3.2 — `EmptyState` en las vistas que lo copian

**Cierre:** 0 implementaciones locales del patrón; `DESIGN.md` §18 deja de ser
una receta para copiar y pasa a ser un componente.

#### En curso (2026-07-27) — 10 migrados

`RolesView` · `TabEnCurso` · `AttendanceAuditView` · `PermissionsView` ·
`EmployeeDetailView` · `VacationPlanView` · `EncuestaAdminView` ·
`WidgetInventorySearch` · `WidgetSrsInventory` · (más `FacturacionView`, ya
en D2.5).

Al buscarlos aparecieron **49 bloques con forma "ícono + texto"**, pero no
todos son estados vacíos: varios son cabeceras decorativas (*"Accesos
rápidos"*), sugerencias (*"Plaza Sugerida"*) o estados de carga. El filtro
correcto no es la forma sino la **semántica del texto** — "Sin…", "No hay…",
"No se encontraron…".

`EmptyState` ganó uso real de su variante `compact` (min-h 200px en vez de
400px), que es la que sirve dentro de paneles y widgets: la versión completa
solo funciona cuando el vacío ocupa la vista entera.

### D3.3 — `<button>` → `Button` (639 en 102 archivos)

Ya hay objetivo: 4 tamaños canónicos derivados de `--control-h` con piso
táctil. Arrastra `white`, `shadow-literal` y `inline-color` de esas líneas.

**Cierre:** `<button>` crudo solo dentro de los canónicos y en excepciones
documentadas.

### D3.4 — `<input>` → `PortalInput` (112 en 39 archivos)

Depende de D2.5b (definir las variantes primero).

### D3.5 — `Badge` y `StatCard`

**Cierre:** o se adoptan, o se eliminan si el patrón real resultó ser otro.
Un canónico con 1 import es peor que ninguno: aparenta un estándar que no existe.

### D3.6 — `UnifiedModal` sobre `ModalShell`

Decisión ya tomada. Lo que el canónico no cubra se le agrega, no se resuelve
inline.

### D3.7 — `NotFoundView` · ✓ CERRADA (2026-07-27)

Antes el catch-all hacía `<Navigate to={defaultRedirect} replace />`: un
redirect **silencioso** al primer módulo con permiso. El usuario tecleaba una
URL vieja y aterrizaba en otra pantalla sin saber si el enlace estaba roto o
si le faltaba acceso.

Construida sobre el `EmptyState` compartido en vez de inventar un layout
propio — una ruta inexistente **es** un estado vacío, y el sistema ya resolvió
cómo se ve eso. Muestra la ruta pedida, que es el dato que convierte "algo
falló" en "este enlace está mal".

Estrena `Button` en una vista: **primera adopción real del canónico**, que
hasta ahora solo importaba `DataTable`.

### D3.8 — Cerrar el baseline del gate

#### La sombra tenía DOS ejes, no uno (2026-07-27)

400 sombras a mano con **269 valores distintos** parecían 269 decisiones de
diseño. No lo eran: eran **5 elevaciones × N brillos × retoques sueltos**.

| eje | estado |
|---|---|
| **Elevación** — cuánto se despega de la superficie | Ya tokenizado (`--shadow-elevation-xs…xl`). Al agrupar los 400 literales por radio de blur caen casi exactos en esas bandas: 7-14px, 15-24, 25-34, 35-49, 50+. |
| **Brillo** — el inset que hace que lea como vidrio | **Nunca se tokenizó.** 154 de los 400 usos son *solo* inset, con 112 valores distintos para la misma idea. |

Por eso T7.3 había dejado fuera las combinadas: sin el segundo eje, forzarlas
a un token de una capa las aplanaba. Con los dos ejes nombrados, la
consolidación deja de tener pérdida.

**Escala de vidrio de 5 niveles** (`--shadow-glass-1…5`), cada uno con su par
elevación+brillo, más `--shadow-shine` / `-lg` para el brillo solo y
`--shadow-glass-dark` para superficie oscura (el brillo blanco al 85% delata
el borde en dark). No reemplaza a `--shadow-elevation-*`: eso sigue sirviendo
para lo que no es vidrio.

**242 literales migrados** por su banda de blur. `shadow-literal` de 412 a
165. Lo que queda son sombras de color (glows de marca/estado) y casos
realmente únicos.

Al migrar vistas caen solas: `white` 692 · `shadow-literal` 412 ·
`inline-color` 118. Lo que quede al final se excepciona con motivo o se cierra.

**Cierre de D3:** las 5 categorías del ratchet en 0 y bloqueantes, o con
excepción documentada. Y re-correr el escáner de contraste: 0/0 como en D1.

### Hallazgos que se resuelven dentro de D3

- **A1** — la densidad no comprime filas: `h-[var(--row-h)]` en `<td>` es
  mínimo, no máximo, y el contenido (avatar 36px + dos líneas) lo excede.
  Se arregla al migrar la anatomía de fila.
- **A10** — `Skeleton` con 0 adopciones.
- **A11** — skeleton en 36 de 59 vistas con carga.

---

## D4 — Reescribir `DESIGN.md`

Solo cuando D3 esté cerrada: antes, el doc describiría algo que aún cambia.

1. Corregir las 36 prescripciones prohibidas y las 5 afirmaciones falsas.
2. Documentar los 8 componentes que no aparecen, más los nuevos
   (`StateViews`, `MotionProvider`).
3. Agregar lo que falta para un sistema terminado: escala tipográfica,
   contrato de estados por componente, plantilla de ficha, guía de densidad,
   tokens de motion, y la regla de los **dos gates de movimiento**.
4. Gobernanza: **toda sección que prescriba clases debe estar cubierta por el
   gate**. Si no se puede verificar, es una convención, no un estándar.

**Cierre:** un script extrae los bloques de código de `DESIGN.md` y los pasa
por `gate:design`. Si el doc prescribe algo prohibido, falla.

---

## Aceptados, no se tocan

| # | Motivo |
|---|---|
| **A4** | 20 `zIndex:` inline en tooltips portaleados que ya necesitan `style` para su `top`/`left` computado. |
| **A7** | `ctx.fillStyle` de canvas no resuelve `var()`. Único límite técnico real del barrido de color. |
| Perillas de switch | 18 `bg-white` en perillas redondas: blancas sobre su riel en los 4 temas, igual que iOS. |
| Superficies bespoke | Sidebar y kiosco siempre-oscuros; `LoginView` fuerza claro. |

---

## Trampas de verificación (no repetirlas)

- **Compilar no es verificar.** Cinco fallos silenciosos en una sesión que el
  `✓ built` no detectó: un bucle de template literals que no emitió CSS, dos
  ediciones de `@theme` que no generaron la clase, un import faltante que
  habría reventado en runtime, y un hook mal insertado. Confirmar siempre en
  el bundle o con eslint.
- **Tailwind escanea strings LITERALES.** Nada de `` `bg-${x}-solid` ``.
- **Lightning CSS quita las comillas del atributo.** Grepear
  `[data-theme=solid]`, no `[data-theme="solid"]`.
- **`backgroundImage` rompe el cálculo de contraste** — da falsos positivos.
- **`rounded-full` es literal, no token.**
- **El movimiento tiene DOS gates**: tema y accesibilidad. Una regla nueva
  entra en los dos.
