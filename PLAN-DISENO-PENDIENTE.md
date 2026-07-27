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


### A16 · Aros — el canónico existía y nadie lo usaba (RESUELTO v2.67.0)

Al preguntar "por qué hay tantas variables" apareció algo peor que variación:
`index.css` **ya tenía** un aro de foco canónico —una regla sobre
`button/input/select/textarea/a/[role=button]/[tabindex]:focus-visible`— y
encima había **171 aros escritos a mano en 47 archivos**. Los 171 eran
redundantes: no agregaban nada, solo tapaban el canónico con un color distinto
en cada formulario (ring-4/2/1 × brand/10, /20, /25, /50, chart-9/20,
chart-3/70, success/50…).

Y el canónico estaba roto donde importa: `--focus-ring-color` era
`rgba(0,82,204,0.55)` fijo, **sin variante por tema**.

| | contraste | WCAG 1.4.11 (3:1) |
|---|---|---|
| antes, tarjeta clara | 2.61:1 | ✗ |
| antes, navy oscuro | **1.63:1** | ✗ prácticamente invisible |
| ahora, claro | 6.42:1 | ✓ |
| ahora, oscuro | 7.18:1 | ✓ |

Y **20 `focus:outline-none`** lo apagaban del todo en inputs de Pedidos,
MinMax, Promociones y el kiosco: esos campos se enfocaban sin ninguna señal
visible (WCAG 2.4.7). Retirados.

**Por qué importa el orden de los hallazgos**: el primer intento fue crear una
utilidad `ring-focus` nueva. Al verificarla en vivo apareció que competía con
una regla que ya existía — así que lo correcto no era agregar un canónico sino
**borrar los 171 que lo tapaban**. Verificar en el navegador no confirmó el
trabajo: lo cambió.

### A18 · Acciones que solo existen en hover (RESUELTO v2.67.2)

El reverso exacto de A17, encontrado al verificarlo. **16 bloques en 12
archivos** se revelan con `opacity-0 group-hover:opacity-100` y contienen
acciones reales — llamar por teléfono, abrir WhatsApp, editar, eliminar. Con
teclado se llega a ellas pero **no se ven**: el foco entra en un elemento
transparente (WCAG 2.4.7, y 2.1.1 en la práctica porque nadie activa lo que no
ve). Acá `inert` sería el error opuesto: quitaría un acceso legítimo. La
corrección es `focus-within:opacity-100` — si el teclado llega, se muestra.

### A14 · Switches — no eran 18, eran 9 (RESUELTO v2.67.2)

Corrección de un conteo mío. Al revisarlos uno por uno, de los "18" solo
**9 son switches**; los otros 10 eran badges de esquina, puntos de línea de
tiempo y píldoras deslizantes de pestaña — comparten el `bg-white` redondo pero
no son el mismo control.

Y el hallazgo real era otro: no había 9 copias sueltas sino **tres componentes
Switch locales compitiendo** —`BranchHelpers.Switch` (5 usos en 3 archivos),
`PermissionsView.Toggle` (3 usos) y `FormPlanificador.Switch`— ninguno
importable desde afuera de su archivo, más 5 copias inline. Tres canónicos
parciales es peor que ninguno: cada uno parecía "el estándar" dentro de su
carpeta.

El canónico agrega una regla que faltaba: **sin `onChange` renderiza un
`<span>`, no un `<button>`**. Tres de los nueve viven dentro de una fila que ya
es clickeable, donde un `<button>` anidado es HTML inválido y una segunda
parada de tabulación para la misma acción.

**Pendiente de verificación visual**: los 3 toggles de `PermissionsView` no se
pudieron ver en vivo — la cuenta de QA no tiene acceso a `/permissions`.

### A17 · Se tabula dentro de lo invisible (RESUELTO v2.67.1, ampliado v2.67.2)

Encontrado mientras se verificaba A16: la sonda aterrizaba una y otra vez en un
input que no podía mostrar. Era el buscador colapsado del header — y al medirlo
no eran dos sitios sino **49 regiones**. El conteo creció en dos tandas porque
la primera pasada solo miraba una forma del patrón:

| pasada | qué se le escapaba | encontradas |
|---|---|---|
| 1ª | — | 26 |
| 2ª | ramas de ternario con **comillas dobles** | +20 |
| 3ª | colapso con `h-0` / `w-0` / `max-*-0` / `scale-0` en vez de `pointer-events-none` | +4 |

Las tres formas aparecieron una tras otra al verificar en el navegador, no al
leer el código. El gate cubre las tres.

`opacity-0 pointer-events-none` esconde del ojo y del mouse, pero **no del
teclado**. Quien navega tabulando entraba en menús cerrados, buscadores
colapsados y paneles de IA apagados, y el foco desaparecía de la pantalla
(WCAG 2.4.3 y 2.4.7). Medido en `/proveedores`: 26 paradas invisibles en 60
tabulaciones. Ahora 0, verificado también en `/solicitudes`, `/facturacion`
y `/permisos`.

Lo que el conteo dice de fondo: el "modo búsqueda" está **copiado vista por
vista** en vez de salir de `ViewTabBar` — 8 de las 14 apariciones son la misma
barra reescrita. Ese es el trabajo de D3, y este bug es una de sus
consecuencias.

Gate: categoría `inert` nueva, en 0 y bloqueante.

## Revisión de los "casos únicos" (2026-07-27)

A pedido del usuario se revisó si lo excepcionado era **necesario** o eran
decisiones sueltas que después driftearon. El método: ver si cada grupo es
**consistente entre sí** (patrón real) o si cada instancia difiere (drift).

| grupo | veredicto |
|---|---|
| **Perillas de switch** (18) | El `bg-white` **sí** es necesario y es consistente en las 18 — una perilla es blanca sobre su riel en los 4 temas. **Pero todo lo demás drifteó**: 8 tamaños, 6 sombras, 8 offsets. No era una decisión, era la ausencia de un componente. → **`Switch.jsx` creado**, 3 tamaños. **A14**: migrar los 18. |
| **Barridos especulares** (8) | RESUELTO v2.67.0 — la regla faltante: va en variantes RELLENAS. Estaba en 3 de 11 botones brand y NO en el canónico. **Patrón real**: 6 de 8 comparten `w-[55%]`, `translate-x-[220%]`, `duration-700`, y solo varía el alpha según el fondo, que es correcto. Copiado 8 veces. → **utilidad `sweep`** con `--sweep-alpha`. **A15**: migrar los 8; los 2 de `TabMinMax` usan otra anatomía y hay que decidir si convergen. |
| **Sombras direccionales** (4) | **Necesarias**, y el sentido importa: columna fija → derecha, panel lateral → derecha, overlay que sube → arriba, barra inferior → arriba. Pero eran **4, no 5**: `--shadow-sticky-b` quedó sin uso y **se borró** — un token que nadie consume es la misma escala muerta que este plan vino a arreglar. |
| **Aros y superficies sueltas** (4) | Contextos distintos y reales (visor de foto, avatar, gradiente de tarjeta). Migrados a `border-card` / `card-tint-base`. |

**Conclusión del método:** de cuatro grupos "excepcionados", **dos escondían un
componente faltante**. La excepción era correcta a nivel de color pero tapaba
que nadie había nombrado el control. Revisar excepciones no es burocracia:
es donde aparecen los componentes que faltan.

---



## D3.9 — Consolidar la barra de vista · ✓ CERRADA (v2.70.0)

**13 de 13 migradas. 0 barras escritas a mano.** 28 vistas usan el canónico.

Lo que se corrigió sobre la marcha:
- Mi clasificación en 3 grupos estaba mal en dos casos: `AnnouncementsView` y
  `RequestsView` figuraban con "tercer estado" porque conté `inert` de filas
  expandibles que no tenían nada que ver con la barra. Eran swap directo.
- El tercer estado real —`AuditView` y `BranchesView`— resultó ser **un dropdown
  escrito a mano**: una píldora que se expandía en línea a 5 opciones,
  colapsando el resto de la barra. Con 5 opciones eso es un `LiquidSelect`, que
  es lo que la regla del proyecto manda y lo que ya usaban Facturación y
  Monitor. Al cambiarlo el tercer estado desapareció solo: `ViewTabBar` nunca
  necesitó modelarlo.
- `TabHistory` no usaba las dos mitades colapsables sino renderizado condicional
  (`isSearchOpen ? A : B`), por eso su forma no calzaba con las otras doce.

## D3.9 — histórico (plan original de las 9 restantes)

**Hecho (4/13)**: `EmployeeDocumentsView`, `StaffManagementView`,
`ConteoInventarioView`, `ConteoDetailView` — ~190 líneas menos.
Canónicos disponibles: `ViewTabBar` + `TabBarAction` (D3.10).

### Grupo 1 · swap directo (3)
La barra tiene los dos estados estándar; todo lo que no es buscador pasa a
`trailingActions`.

| vista | qué lleva al canónico |
|---|---|
| `FacturacionView` | 6 tabs propios + 5 `LiquidSelect` de filtro |
| `PermissionsView` | buscador de cargos + 2 selects |
| `AttendanceMonitorView` | filtro de sucursal (respeta `getScope`) |

### Grupo 2 · barra con más controles (2)
Mismos dos estados, pero el bloque normal trae media docena de controles.
Van igual, con `trailingActions` más largo.

| vista | qué lleva |
|---|---|
| `TabHistory` | botón de IA, menú de descarga, select de tipo, rango de fechas, reset |
| `RolesView` | tabs propios; hay que ver por qué tiene un solo estado colapsable |

### Grupo 3 · tercer estado (4)
**No son swap.** Tienen un selector de filtro que se expande *dentro* de la
misma barra — un estado que el canónico no modela. Para estas hay que decidir
antes: o `ViewTabBar` gana un modo `filterPicker`, o se quedan aparte con la
razón escrita.

| vista | estados colapsables |
|---|---|
| `AnnouncementsView` | 3 |
| `RequestsView` | 4 |
| `AuditView` | 5 |
| `BranchesView` | 7 |

### Regla de cierre
Cada vista migrada: `npm run build` + `eslint` en verde, la barra abierta y
cerrada verificada en vivo, y 0 paradas de foco invisibles en su ruta. Al
terminar, `gate:design` en verde y una pasada por las 25 rutas.


## D3.11 — Selectores de fecha (auditoría 2026-07-27)

### Corregido
- **`TeclaFecha` estaba definido DENTRO de `RangeDatePicker`.** React trata cada
  render como un tipo de componente nuevo → desmontaba y remontaba el input en
  cada tecla → **el foco se perdía al primer caracter**. Medido: tras escribir
  `15/07/2026`, `activeElement` era `BODY`. Eso era lo que se sentía como
  "lento y no renderiza bien". Ahora está afuera y sincroniza el prop durante el
  render, no en un `useEffect` (que además disparaba un render en cascada por
  cada cambio del calendario).

### Abierto — móvil
- **La barra se sale de la pantalla.** En `/auditview` a 390px quedan
  **10 controles fuera del viewport**: el segundo campo de fecha y el botón de
  buscar son inalcanzables. Lo causé al mover todo a `trailingActions` sin
  estrategia móvil.
- **El panel de rango no cabe de alto**: 557px en una ventana útil de 664px.
  Con el teclado abierto, no entra.

### Decisión pendiente — nativo en móvil
Propuesta híbrida **por trabajo, no por plataforma**:

| caso | escritorio | móvil |
|---|---|---|
| una fecha en formulario | calendario propio | **rueda nativa** |
| una fecha en filtro | calendario + atajos | hoja propia |
| rango | un mes + atajos | **hoja a pantalla completa** |
| barra de vista | todo en línea | **un botón "Filtros"** |

Razonamiento: la rueda nativa aparece *encima* de la app, como el teclado —
nadie le reclama al teclado que no combine con el tema, porque se lee como capa
del sistema. Gana en familiaridad y accesibilidad gratis. **Pero para un rango
se cae**: el sistema no tiene el concepto, serían dos ruedas separadas, sin ver
los extremos juntos, sin atajos, sin feriados.

## Observaciones sin confirmar (2026-07-27)

No son hallazgos: son cosas que vi una vez y **no pude reproducir**. Se anotan
para no perderlas, marcadas como lo que son.

- ~~Solape en el filtro de fechas de Historia de Sucursal~~ → **RESUELTO
  (v2.69.0)**: las cajas eran de 90px cuando el componente declara
  `min-w-[140px]` propio. La causa de fondo era el texto de 16px en negrita en
  una toolbar; se resolvió con el modo `compact`, no con más ancho. Texto
  original del hallazgo: En una captura a
  1600px los dos `DD/MM/AAAA` del rango se pisaban. Al volver a medirlo la
  barra no llega a renderizar: en este entorno de preview el historial falla
  con `fetchAllRows error: TypeError: Failed to fetch`, así que no hay campos
  que medir. Queda pendiente verificarlo contra un entorno donde esos datos
  carguen.
- ~~`ALGO SALIÓ MAL` en `/branches/2`~~ → **RESUELTO y explicado (v2.69.0)**.
  No era la red: `BranchesView` llamaba a `BranchCardSkeleton`, un componente
  que no existe ni definido ni importado. Reventaba con `ReferenceError` cada
  vez que la carga duraba lo suficiente para pintar esa rama. La red lenta solo
  era lo que mantenía viva la rama.

## Verificado por código, no en vivo

- Los **5 switches de sucursal** (`BranchHelpers.Switch`). El formulario con
  las pestañas Horarios/Inmueble/Legal no se alcanza ni desde `/branches` ni
  desde el detalle: el modal de "Nueva Sucursal" solo trae la sección general.
  Los 5 call sites pasan `on`/`onToggle`/`disabled`, que es exactamente lo que
  acepta el alias. Al revisarlos apareció que ninguno pasaba nombre accesible
  — corregido en los 5 (v2.67.3).

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
