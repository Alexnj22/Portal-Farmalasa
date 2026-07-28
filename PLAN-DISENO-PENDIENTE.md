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

### D3.3 — `<button>` → `Button`

#### La forma la decide el TEMA, no el botón (corregido 2026-07-27)

A partir de una pregunta del usuario —"¿no deberían ser más unificados? ¿o una
versión redonda para liquid glass y otra rectangular para solid?"— se revisó, y
**eso es exactamente lo que el sistema ya hacía**:

| | `--btn-radius` | medido en vivo |
|---|---|---|
| liquid glass | `9999px` | píldora |
| sólido | `0.5rem` | 8px, rectangular |

`rounded-btn` ya rinde píldora en vidrio y rectángulo en sólido. **El eje
`shape` que agregué en v2.72.0 era un error**: clavaba `rounded-full` en 114
botones que en el tema sólido se quedaban redondos, peleando contra su propio
lenguaje de forma. Retirado.

Los seis radios distintos que había en el código no eran seis decisiones: eran
seis formas de ignorar el token.

#### Los 270 con clase dinámica, clasificados

| | | |
|---|---|---|
| **124** | 45% | **"uno de N seleccionado"** → control segmentado / tabs / chips. **Les falta un canónico propio, no son `Button`.** |
| 91 | 33% | fragmento de estilo compartido (`focusRing`, hover) — **interpolan una constante, no un estado**: son migrables, el migrador los saltó por ver `${` |
| 30 | 11% | otro |
| 20 | 7% | viewport / tema |
| 5 | 1% | estado del propio botón |


**El conteo real es 939 en 140 archivos**, no 639/102. Y antes de migrar se
midió qué formas existen — el canónico **no las cubría**:

| eje | lo que hay |
|---|---|
| forma | `rounded-xl` 186 · `rounded-full` 109 · `rounded-2xl` 82 · `rounded-btn` 50 · sin radio 48 · `rounded-lg` 32 · `rounded-3xl` 6 |
| relleno | secundario 188 · **otro color 115** · brand 95 · danger 64 · fantasma 55 |
| alto | 8 valores, pero solo ~85 de 517 declaran alguno |

Migrar a ciegas habría **cambiado el radio de 437 botones y borrado el color de
115**. Por eso primero se agregaron los dos ejes que faltaban (v2.72.0):
`shape` (box · pill — los seis radios distintos son ruido, no intención) y
`tone` para los coloreados, que expresan *categoría* (éxito, aviso, un color de
gráfico) y no jerarquía.

Reparto por tipo, para migrar por lotes:

| tipo | cuántos |
|---|---|
| botón con texto | 359 |
| otro (tarjetas/ítems que son `<button>`) | 278 |
| píldora con texto | 109 |
| ícono redondo | 97 |
| ícono cuadrado | 92 |

Los 278 "otro" son tarjetas y elementos de lista que usan `<button>` por
semántica de click, no controles con forma de botón: **no van al canónico**.

#### Original (subestimado)

Ya hay objetivo: 4 tamaños canónicos derivados de `--control-h` con piso
táctil. Arrastra `white`, `shadow-literal` y `inline-color` de esas líneas.

**Cierre:** `<button>` crudo solo dentro de los canónicos y en excepciones
documentadas.

### D3.4 — `<input>` → `PortalInput` (112 en 39 archivos)

Depende de D2.5b (definir las variantes primero).

### D3.5 — `Badge` y `StatCard`

**Cierre:** o se adoptan, o se eliminan si el patrón real resultó ser otro.
Un canónico con 1 import es peor que ninguno: aparenta un estándar que no existe.

### D3.6 — `UnifiedModal` sobre `ModalShell` · ✓ YA ESTABA HECHA

El plan asumía mal. La cadena **ya existe**:
`UnifiedModal` → `LiquidModal` → `ModalShell`, y `AlertModal` → `ModalShell`.
Las 940 líneas de `UnifiedModal` no son una implementación de modal: son un
**despachador** que carga en lazy el formulario que corresponde. No hay nada que
migrar ahí.

Lo que sí queda medido: **6 modales fuera de la cadena** —`MenuSearchModal`,
`PromptModal`, `PhotoEditorModal`, `EmployeeDetailView`, más los paneles de
`ViewTabBar` y `LiquidDatePicker` que son hojas, no modales—. Esos tres primeros
sí son candidatos reales.

#### Suposición original (incorrecta)

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

### Decisión tomada — TODO propio, con variante táctil (v2.71.0)

**No se usa nada nativo.** El razonamiento del usuario: mezclar controles
nativos con controles del tema se vería inconsistente. Y tiene razón — pero la
solución no era resignar calidad en móvil, sino construir la **variante táctil
propia** de cada control:

| | escritorio | táctil |
|---|---|---|
| panel | popover anclado, 280px | **hoja inferior**, ancho completo, respeta `safe-area-inset` |
| día | 32px | **44px** (WCAG 2.5.8) |
| rango | arrastre | **dos toques** — el primero fija inicio, el segundo fin |
| meses visibles | 1 o 2 | siempre 1 |
| acciones de la barra | en línea | **botón + hoja de filtros** |

Mismo calendario, mismos tokens, mismos 4 temas: cambia la **presentación**, no
el material.

Bugs que aparecieron al construirlo:
- Con el dedo, un toque dispara `mousedown` Y `mouseup` sobre el mismo día, así
  que el rango caía en `start === end` y **auto-calculaba 15 días** en vez de
  dejar elegir el fin.
- La hoja de filtros medía **108px de ancho en vez de 390**: la barra tiene
  `transform-gpu`, y un ancestro transformado crea bloque contenedor para
  `position: fixed`. Se resolvió con portal a `document.body`.

### ~~Decisión pendiente — nativo en móvil~~ (descartado)
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




## Cierre 2026-07-27 (segunda jornada)

### Los siete canónicos
`Switch` · `TabBarAction` · `Checkbox` · `SegmentedControl` · `Notice` ·
**`ListRow`** — cinco salieron de *medir lo que un migrador no podía convertir*,
no de una idea previa.

`ListRow` tiene una ranura `leading` que acepta **ícono, letra o imagen**. Los
tres aparecieron migrando (labs, encuestas, min/max) y los tres comparten caja,
tamaño y alineación. Cerrarla a "solo íconos" habría dejado fuera dos de tres.

`PortalInput` ganó `labelAction`, `compact` e `inputClassName`: sin eso, 37
inputs que **son este componente reconstruido a mano** no podían entrar.

### Números
| | inicio | ahora |
|---|---|---|
| `<button>` a mano | 940 | **331** |
| badges inline | 244 | **35** |
| casillas nativas | 16 | **0** |
| barras de búsqueda | 13 | **0** |
| copias de estado vacío | 5 | **0** |
| `DESIGN.md` vs gate | 35 | **0** |

### Los cuatro fallos silenciosos del día
Ninguno lo vio el build:

| qué | lo detectó |
|---|---|
| `title={plantilla}` serializado como string | eslint (variable huérfana) |
| atributos descartados → `key` perdido en 11 badges | eslint (índice sin usar) |
| 4 vistas con `<SegmentedControl>` sin import | abrir la vista |
| **12 bumps de `APP_VERSION` fallidos** | **una captura de pantalla** |

Tres gates nuevos cubren justo eso: `import` (categoría del gate de diseño),
`gate:doc` y `gate:version`.

**La regla que salió**: un `replace` que no encuentra su ancla no falla —
simplemente no hace nada. Toda operación automática se verifica, y las
migraciones en lote se miran en el navegador **antes** de comitear.

### Lo que queda, con su decisión pendiente
- **~17 filas** candidatas a `ListRow` — mecánicas, mismo patrón.
- **331 botones**: ~117 segmentados caso por caso, 30 botones de ícono con
  capas (composición visual, **no van**), 9 tarjetas seleccionables (decidir
  después de que `ListRow` se asiente), resto compuesto.
- **45 inputs**: 18 son `file`, que tienen su propio patrón (`FileUploader` en
  `BranchHelpers` — hay que ver si sirve como canónico); el resto son sueltos
  sin forma compartida.
- **35 badges** con hijos compuestos: varios llevan un tooltip adentro. Lo que
  falta ahí **es un tooltip canónico**, no un `Badge` más flexible.
- **`gate:design`**: `inline-color` 58 · `shadow-literal` 30 · `motion` 5.

## Cierre de la jornada 2026-07-27 — qué quedó y por qué

### Lo que se movió

| | antes | ahora |
|---|---|---|
| `<button>` a mano | 940 | **337** |
| badges inline | 244 | **72** |
| casillas nativas | 16 | **0** |
| barras de búsqueda a mano | 13 | **0** |
| copias del estado vacío | 5 | **0** |
| `DESIGN.md` contra el gate | 35 | **0** |

### Los seis canónicos que faltaban
`Switch` · `TabBarAction` · `Checkbox` · `SegmentedControl` · `Notice` ·
(`SegmentedControl` y `Notice` salieron de medir lo que los migradores no podían
convertir, no de una idea previa).

### Por qué lo que queda NO se migró

Esto no es "faltó tiempo". Cada grupo tiene una razón medida:

**D3.3 · 337 botones**
- ~117 **segmentados**: varios no son el mismo control. Los de
  `AnnouncementsView` son tarjetas de elección a ancho completo en dos columnas
  — meterlas en un segmentado compacto las encogería.
- 92 con `<div>` adentro, y al medirlos **solo 9 son tarjetas**. Los otros 53
  son **filas de lista compuestas** (ícono + etiqueta + elemento final, con
  contenido distinto en cada una) y 30 son botones de ícono con estructura
  interna. Un canónico que los cubriera a todos sería un cajón de sastre.
- El resto: composición real.

**D3.4 · 49 inputs de texto/número**
Al mirarlos: **37 son un `PortalInput` reconstruido a mano** —etiqueta con badge
de error, contenedor con ícono, input desnudo adentro—. Migrables en principio,
**pero cada uno trae extras que el canónico no tiene**: acciones dentro de la
etiqueta (`+ Agregar` en teléfono), máscaras, campos que se multiplican.
Los otros 12 son celdas numéricas densas (`h-8`, borde de color, dentro de una
grilla), donde `PortalInput` no calza.

Son formularios de RRHH y nómina. Migrarlos a ritmo de script es la forma más
rápida de romper la carga de datos de la empresa. **Requisito previo**: decidir
si `PortalInput` gana `labelAction` y una variante compacta, o si esos casos se
quedan documentados como excepción.

**D3.5 · 72 badges** con hijos compuestos (dos `<span>` con estilo propio, o un
`<div>` adentro). Caso por caso.

### Lo que aprendieron los migradores
Tres errores, los tres **atrapados por eslint y no por el build**:

| | qué pasaba |
|---|---|
| `title={\`plantilla\`}` | se serializaba como string **con backticks adentro**; se renderizaba el código crudo |
| `className` con `${}` | se descartaba entero, incluso cuando interpolaba una constante |
| atributos ≠ `className` | **se tiraban**: 11 badges de un `.map()` perdieron su `key` |

La regla que salió de ahí: **un atributo que el migrador no entiende se copia,
no se tira.**

## Estado de D3 al 2026-07-27 (medido, no estimado)

### Cerradas
| | |
|---|---|
| D3.1 estados de carga | ✓ |
| D3.2 estado vacío | ✓ 0 copias locales |
| D3.6 modales | ✓ ya estaba hecha (`UnifiedModal → LiquidModal → ModalShell`) |
| D3.7 `NotFoundView` | ✓ |

### Los cinco canónicos que faltaban
El hallazgo que se repitió toda la semana: **lo que parecía un caso especial era
un componente que nadie había nombrado.**

| componente | qué destapó |
|---|---|
| `Switch` | 3 implementaciones locales compitiendo, 8 tamaños de perilla |
| `TabBarAction` | cada vista escribía su botón de barra, con halo fijo |
| `Checkbox` | 16 casillas **nativas** — el único control sin pasar por el tema |
| `SegmentedControl` | 123 botones con `X === valor ? activo : inactivo` |
| `Notice` | 58 avisos inline; existía el modal y el banner, faltaba el del medio |

### D3.3 — botones · 940 → 337
| grupo | cuántos | qué falta decidir |
|---|---|---|
| migrados | 603 | — |
| segmentados restantes | ~117 | caso por caso: **no todos son el mismo control**. Los de `AnnouncementsView` son tarjetas de elección a ancho completo, no un segmentado compacto. |
| con `<div>` adentro | 50 | probablemente **tarjetas clickeables**, no botones. Hay que mirarlas: si son tarjetas, el canónico que falta es otro. |
| varios `<span>` con estilo | 6 | composición real |
| sin `onClick` / sin clase | 11 | triviales |

**Aprendizajes del migrador** (los tres errores que cometió y cómo se
corrigieron) están en el changelog de v2.76.0. El más importante:
`title={\`plantilla\`}` se serializaba como string con backticks adentro —
**el build pasaba igual**, lo atrapó eslint por la variable huérfana.

### D3.4 — inputs · CERO NATIVOS (2026-07-27)

**Ya no queda ningún control de formulario nativo en el portal.** Medido:

| control | nativos | canónico |
|---|---|---|
| `<select>` | 0 | `LiquidSelect` |
| `<textarea>` | 0 | `PortalTextarea` ← v2.89.0 |
| `type="checkbox"` | 0 | `Checkbox` |
| `type="date\|time"` | 0 | `LiquidDatePicker` · `TimePicker12` |
| `type="file"` | 0 | `FileField` ← v2.88.0 |
| `window.alert\|confirm\|prompt` | 0 | `AlertModal` · `ConfirmModal` |

Las 6 categorías son **cero absoluto y bloqueantes** en `gate:design`. Dos
excepciones vivas y documentadas: los selectores de **foto** (avatar de empleado
y foto de producto), donde el disparador es la imagen y el resultado va al
recortador — no son "adjuntar un documento".

Lo que sí queda: **100 `<input>` de texto/número** fuera de `PortalInput`. No es
lo mismo que lo anterior — el input nativo dentro de `PortalInput` es correcto;
lo que falta es que esos 100 pasen por el canónico. Varios son celdas numéricas
densas dentro de grillas (nómina, min/max), para las que ya existe
`compact`. Es mecánico, pero hay que medir las variantes antes de migrar: es el
error que casi se comete con los botones.

### D3.5 — `Badge` y `StatCard`

**Cierre:** o se adoptan, o se eliminan si el patrón real resultó ser otro.
Un canónico con 1 import es peor que ninguno: aparenta un estándar que no existe.

### D3.6 — `UnifiedModal` sobre `ModalShell` · ✓ YA ESTABA HECHA

El plan asumía mal. La cadena **ya existe**:
`UnifiedModal` → `LiquidModal` → `ModalShell`, y `AlertModal` → `ModalShell`.
Las 940 líneas de `UnifiedModal` no son una implementación de modal: son un
**despachador** que carga en lazy el formulario que corresponde. No hay nada que
migrar ahí.

Lo que sí queda medido: **6 modales fuera de la cadena** —`MenuSearchModal`,
`PromptModal`, `PhotoEditorModal`, `EmployeeDetailView`, más los paneles de
`ViewTabBar` y `LiquidDatePicker` que son hojas, no modales—. Esos tres primeros
sí son candidatos reales.

#### Suposición original (incorrecta)

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

### Decisión tomada — TODO propio, con variante táctil (v2.71.0)

**No se usa nada nativo.** El razonamiento del usuario: mezclar controles
nativos con controles del tema se vería inconsistente. Y tiene razón — pero la
solución no era resignar calidad en móvil, sino construir la **variante táctil
propia** de cada control:

| | escritorio | táctil |
|---|---|---|
| panel | popover anclado, 280px | **hoja inferior**, ancho completo, respeta `safe-area-inset` |
| día | 32px | **44px** (WCAG 2.5.8) |
| rango | arrastre | **dos toques** — el primero fija inicio, el segundo fin |
| meses visibles | 1 o 2 | siempre 1 |
| acciones de la barra | en línea | **botón + hoja de filtros** |

Mismo calendario, mismos tokens, mismos 4 temas: cambia la **presentación**, no
el material.

Bugs que aparecieron al construirlo:
- Con el dedo, un toque dispara `mousedown` Y `mouseup` sobre el mismo día, así
  que el rango caía en `start === end` y **auto-calculaba 15 días** en vez de
  dejar elegir el fin.
- La hoja de filtros medía **108px de ancho en vez de 390**: la barra tiene
  `transform-gpu`, y un ancestro transformado crea bloque contenedor para
  `position: fixed`. Se resolvió con portal a `document.body`.

### ~~Decisión pendiente — nativo en móvil~~ (descartado)
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




## Cierre 2026-07-27 (segunda jornada)

### Los siete canónicos
`Switch` · `TabBarAction` · `Checkbox` · `SegmentedControl` · `Notice` ·
**`ListRow`** — cinco salieron de *medir lo que un migrador no podía convertir*,
no de una idea previa.

`ListRow` tiene una ranura `leading` que acepta **ícono, letra o imagen**. Los
tres aparecieron migrando (labs, encuestas, min/max) y los tres comparten caja,
tamaño y alineación. Cerrarla a "solo íconos" habría dejado fuera dos de tres.

`PortalInput` ganó `labelAction`, `compact` e `inputClassName`: sin eso, 37
inputs que **son este componente reconstruido a mano** no podían entrar.

### Números
| | inicio | ahora |
|---|---|---|
| `<button>` a mano | 940 | **331** |
| badges inline | 244 | **35** |
| casillas nativas | 16 | **0** |
| barras de búsqueda | 13 | **0** |
| copias de estado vacío | 5 | **0** |
| `DESIGN.md` vs gate | 35 | **0** |

### Los cuatro fallos silenciosos del día
Ninguno lo vio el build:

| qué | lo detectó |
|---|---|
| `title={plantilla}` serializado como string | eslint (variable huérfana) |
| atributos descartados → `key` perdido en 11 badges | eslint (índice sin usar) |
| 4 vistas con `<SegmentedControl>` sin import | abrir la vista |
| **12 bumps de `APP_VERSION` fallidos** | **una captura de pantalla** |

Tres gates nuevos cubren justo eso: `import` (categoría del gate de diseño),
`gate:doc` y `gate:version`.

**La regla que salió**: un `replace` que no encuentra su ancla no falla —
simplemente no hace nada. Toda operación automática se verifica, y las
migraciones en lote se miran en el navegador **antes** de comitear.

### Lo que queda, con su decisión pendiente
- **~17 filas** candidatas a `ListRow` — mecánicas, mismo patrón.
- **331 botones**: ~117 segmentados caso por caso, 30 botones de ícono con
  capas (composición visual, **no van**), 9 tarjetas seleccionables (decidir
  después de que `ListRow` se asiente), resto compuesto.
- **45 inputs**: 18 son `file`, que tienen su propio patrón (`FileUploader` en
  `BranchHelpers` — hay que ver si sirve como canónico); el resto son sueltos
  sin forma compartida.
- **35 badges** con hijos compuestos: varios llevan un tooltip adentro. Lo que
  falta ahí **es un tooltip canónico**, no un `Badge` más flexible.
- **`gate:design`**: `inline-color` 58 · `shadow-literal` 30 · `motion` 5.

## Cierre de la jornada 2026-07-27 — qué quedó y por qué

### Lo que se movió

| | antes | ahora |
|---|---|---|
| `<button>` a mano | 940 | **337** |
| badges inline | 244 | **72** |
| casillas nativas | 16 | **0** |
| barras de búsqueda a mano | 13 | **0** |
| copias del estado vacío | 5 | **0** |
| `DESIGN.md` contra el gate | 35 | **0** |

### Los seis canónicos que faltaban
`Switch` · `TabBarAction` · `Checkbox` · `SegmentedControl` · `Notice` ·
(`SegmentedControl` y `Notice` salieron de medir lo que los migradores no podían
convertir, no de una idea previa).

### Por qué lo que queda NO se migró

Esto no es "faltó tiempo". Cada grupo tiene una razón medida:

**D3.3 · 337 botones**
- ~117 **segmentados**: varios no son el mismo control. Los de
  `AnnouncementsView` son tarjetas de elección a ancho completo en dos columnas
  — meterlas en un segmentado compacto las encogería.
- 92 con `<div>` adentro, y al medirlos **solo 9 son tarjetas**. Los otros 53
  son **filas de lista compuestas** (ícono + etiqueta + elemento final, con
  contenido distinto en cada una) y 30 son botones de ícono con estructura
  interna. Un canónico que los cubriera a todos sería un cajón de sastre.
- El resto: composición real.

**D3.4 · 49 inputs de texto/número**
Al mirarlos: **37 son un `PortalInput` reconstruido a mano** —etiqueta con badge
de error, contenedor con ícono, input desnudo adentro—. Migrables en principio,
**pero cada uno trae extras que el canónico no tiene**: acciones dentro de la
etiqueta (`+ Agregar` en teléfono), máscaras, campos que se multiplican.
Los otros 12 son celdas numéricas densas (`h-8`, borde de color, dentro de una
grilla), donde `PortalInput` no calza.

Son formularios de RRHH y nómina. Migrarlos a ritmo de script es la forma más
rápida de romper la carga de datos de la empresa. **Requisito previo**: decidir
si `PortalInput` gana `labelAction` y una variante compacta, o si esos casos se
quedan documentados como excepción.

**D3.5 · 72 badges** con hijos compuestos (dos `<span>` con estilo propio, o un
`<div>` adentro). Caso por caso.

### Lo que aprendieron los migradores
Tres errores, los tres **atrapados por eslint y no por el build**:

| | qué pasaba |
|---|---|
| `title={\`plantilla\`}` | se serializaba como string **con backticks adentro**; se renderizaba el código crudo |
| `className` con `${}` | se descartaba entero, incluso cuando interpolaba una constante |
| atributos ≠ `className` | **se tiraban**: 11 badges de un `.map()` perdieron su `key` |

La regla que salió de ahí: **un atributo que el migrador no entiende se copia,
no se tira.**

## Estado de D3 al 2026-07-27 (medido, no estimado)

### Cerradas
| | |
|---|---|
| D3.1 estados de carga | ✓ |
| D3.2 estado vacío | ✓ 0 copias locales |
| D3.6 modales | ✓ ya estaba hecha (`UnifiedModal → LiquidModal → ModalShell`) |
| D3.7 `NotFoundView` | ✓ |

### Los cinco canónicos que faltaban
El hallazgo que se repitió toda la semana: **lo que parecía un caso especial era
un componente que nadie había nombrado.**

| componente | qué destapó |
|---|---|
| `Switch` | 3 implementaciones locales compitiendo, 8 tamaños de perilla |
| `TabBarAction` | cada vista escribía su botón de barra, con halo fijo |
| `Checkbox` | 16 casillas **nativas** — el único control sin pasar por el tema |
| `SegmentedControl` | 123 botones con `X === valor ? activo : inactivo` |
| `Notice` | 58 avisos inline; existía el modal y el banner, faltaba el del medio |

### D3.3 — botones · 940 → 337
| grupo | cuántos | qué falta decidir |
|---|---|---|
| migrados | 603 | — |
| segmentados restantes | ~117 | caso por caso: **no todos son el mismo control**. Los de `AnnouncementsView` son tarjetas de elección a ancho completo, no un segmentado compacto. |
| con `<div>` adentro | 50 | probablemente **tarjetas clickeables**, no botones. Hay que mirarlas: si son tarjetas, el canónico que falta es otro. |
| varios `<span>` con estilo | 6 | composición real |
| sin `onClick` / sin clase | 11 | triviales |

**Aprendizajes del migrador** (los tres errores que cometió y cómo se
corrigieron) están en el changelog de v2.76.0. El más importante:
`title={\`plantilla\`}` se serializaba como string con backticks adentro —
**el build pasaba igual**, lo atrapó eslint por la variable huérfana.

### D3.4 — inputs
| tipo | cuántos | destino |
|---|---|---|
| checkbox | ✓ 0 | `Checkbox` |
| text / number / tel / password | 49 | `PortalInput` **no calza en todos**: varios son celdas numéricas densas (`h-8`, bordes de color, dentro de una grilla). Necesitan una variante compacta del canónico o quedarse. |
| file | 18 | sin canónico; existe `FileUploader` en `BranchHelpers`, hay que ver si sirve |
| radio | 2 | podrían ir a `SegmentedControl` |
| range | 2 | sin canónico, y con 2 usos probablemente no lo amerita |

### D3.5 — Badge · 249 pendientes
Los 316 "chips" se separaron en 249 badges reales, 58 avisos (→ `Notice`, ya
creado) y 9 contadores flotantes. Los 249 son mecánicos pero **hay que verificar
que `Badge` cubra sus variantes**: el mismo error que casi se comete con los
botones sería migrarlos sin medir primero.

### D3.8 — baseline del gate
`inline-color` 59 · `shadow-literal` 32 · `motion` 5. Diez categorías en 0 y
bloqueantes.

### Abiertos que NO son de D3
- **`MenuSearchModal`** reportado como "siempre claro" — medido en los 4 temas y
  resuelve bien. No reproducido.
- **3 modales fuera de la cadena** `ModalShell`: `MenuSearchModal`,
  `PromptModal`, `PhotoEditorModal`.
- **`useThemeSync`** tiene un `set-state-in-effect` que el lint marca desde antes
  de esta sesión.

## D3.3 — los botones, reclasificados bien (2026-07-27)

La tabla que publiqué en el artefacto decía **"31 se quedan: composición rica y
posicionados"**. Era falso, y salió a la luz cuando el usuario preguntó
simplemente *"esos 31 ¿por qué son excepción?"*.

Mi clasificador tenía dos bugs:

1. **Contaba las ramas de un ternario como hermanos.** `{cargando ? <Loader2/> :
   guardado ? <Check/> : <Save/>}` son tres etiquetas en el archivo y **una sola
   en pantalla**. Los conté como "composición rica de 3+ hijos" cuando son
   exactamente `<Button loading>` — que el canónico ya tiene.
2. **Contaba etiquetas dentro de comentarios JSX.** En `DashboardView:2051` el
   comentario dice *"un `<button>` anidado sería HTML inválido"*, y el regex
   leyó ese `<button>` como un hijo real.

Reclasificado sobre el mismo universo, resolviendo ternarios y limpiando
comentarios:

| | cuántos | destino |
|---|---|---|
| ícono + texto | 127 | `Button icon` |
| solo ícono | 22 | `Button iconOnly` |
| con estado de carga | 16 | `Button loading` |
| composición real | 1 | resultó ser `ListRow` (`MenuSearchModal:106`) |
| anida un control | 1 | `ListRow` con `trailing` (`DashboardView:2051`) |

**Excepciones que sobreviven: cero.** Los dos que parecían irreducibles son
filas —ícono en caja, título, subtítulo—, o sea el canónico que ya existe.

Que un elemento esté `absolute` tampoco lo hacía excepción: la posición es
layout, y `Button` acepta `className`. Un `<Button iconOnly icon={ChevronLeft}
className="absolute left-2 top-1/2" />` es perfectamente válido.

## D3.3 — estado de la migración al 2026-07-27 (medido)

**276 → 246 botones a mano.** Cinco lotes, cada uno verificado en navegador con
sesión real antes de commitear.

| lote | qué | versión |
|---|---|---|
| 1 | 8 "guardar con carga", incluidos los dos de `UnifiedModal` | v2.90.1 |
| 2 | 12 grupos uno-de-N → `SegmentedControl` | v2.90.2 |
| 3 | 4 segmentados más | v2.90.3 |
| 4 | 6 de `className` literal, 2 estrenan `soft` | v2.90.4 |
| 5 | 2 tarjetas clickeables → `ListRow surface="card"` | v2.90.5 |

**Lo que sigue pendiente, con su forma real:**

| forma | cuántos | por qué no está hecho |
|---|---|---|
| tarjeta con 3+ `<div>` anidados | 36 | estructura propia; hay que leer cada una |
| tarjeta/fila con ícono y dos líneas | ~24 | mecánico, va a `ListRow` |
| condicional múltiple en `className` | ~60 | el ternario codifica semántica distinta en cada uno |
| toggles y acordeones | 12 | no son uno-de-N; falta decidir si hay canónico |
| dentro del contenedor de filter pill (§17) | 3 | **se quedan**, tienen su propio estándar |
| navegación (`AppLayout` sidebar y barra móvil) | 2 | **se quedan**: flyouts, refs, indentación |

**Por qué no se automatizó en una pasada.** 150 de 167 tienen `className`
dinámica —al revés que los `<textarea>`, donde 31 de 37 eran literales y un
migrador automático funcionó—. Acá el ternario codifica *semántica*: si es
deshabilitado, si es activo, si es uno-de-N. Un migrador a ciegas habría metido
37 segmentados dentro de `Button`.

**Dos trampas que costaron reversiones** (las dos del mismo matcher de llaves):
agarró el `.map()` interno cuando el array de opciones tenía otro `.map()`
anidado, y contó el `${}` de un template literal como bloque. Los dos archivos
se rehicieron por rango de líneas exacto.

## D3.3 — estado al cierre del 2026-07-27 · **276 → 178**

Ocho lotes, cada uno verificado en navegador con sesión real antes de commitear.

| familia | antes | ahora | estado |
|---|---|---|---|
| **D · ícono suelto** | 21 | **0** | ✅ cerrada |
| **C · uno de N** | 56 | **14** | 21 migrados a `SegmentedControl` |
| **A · acción** | 111 | **85** | 24 archivos migrados |
| **B · fila/tarjeta** | 78 | **71** | apenas empezada |
| **E · filter pill** | 8 | **8** | se quedan (§17) |

### Por qué B casi no avanzó

Probé un filtro de "estructura simple (1-2 `<div>`)" y dio 22 candidatos. Al
abrirlos, **ninguno era una fila**: son encabezados de sección plegables
(`FacturacionView:426`), sub-filas dentro de una tarjeta (`BranchesView:434`) y
títulos con línea divisoria (`TabLaboratorios:153`). La cantidad de `<div>` no
identifica la anatomía de `ListRow` —caja de ícono + título + subtítulo—, así
que **esta familia necesita lectura caso por caso**. No hay atajo.

### Las herramientas quedan versionadas

En `scripts/migradores/` con su `LEEME.md`. Lo caro no fue escribirlas sino
descubrir sus cinco filtros, cada uno nacido de un caso que rompió — sobre todo
el quinto: *si tras migrar queda un `isActive` huérfano, revertir*, porque ese
botón era un segmentado disfrazado y perdió su estado activo. El build no lo ve.

### Canónicos construidos en esta tanda

`soft` en `Button` · `tone` y `surface="card"` en `ListRow` · `PortalTextarea` ·
`FileField` · `FilterBar` · `TablePagination` reescrito · `useMediaQuery`.
Más el contrato Liquid/Solid (DESIGN.md §2.1) y las reglas de la barra (§17).

## §17 · Auditoría de filtros — el alcance real (2026-07-27)

Preguntado por el usuario: *"¿ya todos los filter pill están completos, en
todas las vistas?"*. La respuesta es **no**, y el conteo que yo venía dando
(«quedan 13 barras») estaba mal: contaba solo la escritura
`h-5 w-px bg-divider`. Auditado por **filtros que de verdad recortan datos**:

| forma | vistas |
|---|---|
| `FilterBar` | 4 |
| píldora a mano | 7 |
| **sueltos, sin contenedor** | **17** |

**El hallazgo no era de estilo sino de arquitectura.** Convivían tres patrones,
y el tercero —filtros en `filtersContent`, 37 vistas— no lo veía ningún grep
porque escribe el divisor distinto (`w-px h-6` en vez de `h-5 w-px`).

**Me equivoqué al resolverlo la primera vez y el usuario me corrigió.** Vi 37
vistas usando la prop `filtersContent` de `GlassViewLayout` y concluí que ése
era el lugar canónico. Al mirar QUÉ le pasan, **22 le pasan un `ViewTabBar`**:
son las pestañas, no filtros. La prop está mal nombrada y ese nombre fue lo que
me hizo leer mal el código.

Resuelto en DESIGN.md §17: **la barra de filtros va en el CUERPO**, bajo el
título. El header es de las pestañas. Las 3 vistas que comentaban *"vive en el
body, no en el header"* tenían razón desde el principio, y las 4 que migré
quedaron bien.

### La OTRA píldora: la del header

Señalado por el usuario tras la corrección. Una vista tiene **dos** píldoras y
las dos necesitan canónico:

| | header | cuerpo |
|---|---|---|
| canónico | `ViewTabBar` | `FilterBar` |
| lleva | pestañas + buscador global | filtros que recortan |
| estado | 22 lo usan · **12 a mano** | 4 lo usan · 7 a mano · 17 sueltas |

Las 12 reconstruyen el contenedor (`rounded-header h-[4rem]`, blur, sombra) y
meten adentro un `SegmentedControl` y un buscador. Al hacerlo pierden dos cosas
que no son cosméticas: el contrato de buscador toggleable de §24 y el colapso
táctil de las acciones en hoja inferior.

### Lo que falta, en orden

1. **17 vistas con filtros sueltos** — las de mayor impacto: sin píldora no hay
   orden de ranuras, ni limpiar-todo, ni cuenta en móvil.
2. **7 píldoras a mano** → `FilterBar`.
3. Revisar si las 4 ya migradas deben volver a `filtersContent` o quedarse en
   el cuerpo por ancho (medir, no suponer).

### Tanda 1 · cuatro vistas (v2.99.0)

`AttendanceAuditView` · `SchedulesView` · `VacationPlanView` ·
`EmployeeDocumentsView`. **`FilterBar` pasa de 6 a 10 adopciones.**

Lo que apareció al abrirlas —ninguno era un problema de estilo—:

| vista | lo que estaba roto de verdad |
|---|---|
| `AttendanceAuditView` | filtros en un `<div flex flex-wrap>` sin contenedor de ningún tipo, y el selector de sucursal era **un dropdown escrito a mano** (estado abierto/cerrado + ref + listener de clic afuera) donde la regla del proyecto manda `LiquidSelect` desde siempre |
| `SchedulesView` | la píldora era `hidden lg:flex`: **bajo 1024px no había ni sucursal ni navegador de semana**. Y las flechas solo aparecían al pasar el mouse (`w-0 group-hover/week:w-8`) — con dedo o teclado, invisibles. "Publicar" vivía dentro de la píldora, leyéndose como un filtro |
| `VacationPlanView` | reimplementaba el buscador toggleable entero; al migrarlo el `ref` quedó huérfano — la prueba de que era duplicado, no personalización |
| `EmployeeDocumentsView` | filtros en un panel desplegable propio tras un botón "Filtrar", que empujaba la lista al abrirse. `FilterBar` ya trae ese colapso, y en móvil lo hace mejor |

#### El canónico que faltaba: `PeriodStepper`

Otra vez el patrón de la semana. El control «‹ etiqueta ›» estaba **escrito a
mano 7 veces con 5 anatomías**: quincena (`AttendanceAudit`), semana
(`Schedules`, `EmployeeSchedule`), año (`VacationPlan`), y en `Dashboard` la
tendencia, el calendario y los cumpleaños. No es `TablePagination` (paginar es
navegar una lista) ni `PeriodPicker` (elegir un rango): el período dura siempre
lo mismo y solo se corre.

La regla que agrega: **la etiqueta ES el atajo de vuelta**. En las tres vistas
donde uno podía alejarse del período actual había tres formas distintas de
volver —un botón aparte, una × de reset, nada—. Y `unit` es obligatorio: sin él
las dos flechas se anuncian como "botón, botón".

Quedan **4 usos sin migrar en `Dashboard`** (cabeceras de widget) y 1 en
`EmployeeScheduleView` — mecánicos, con `size="sm"`.

#### El bug lo encontró el navegador, no la lectura

En `VacationPlanView` el valor "sin filtrar" de la sucursal es la cadena
`'ALL'`, no `''`. Con `!!branchFilter` la ranura se pintaba **filtrada
siempre**: chip azul y × sobre un select que dice *Todas las sucursales*.

Es el mismo error de `StaffManagementView` en v2.97.0. Dos veces seguidas ya no
es despiste: **`FilterBar` no puede deducir el valor neutro** —a veces es `''`,
a veces `'ALL'`, a veces el mes en curso— y eso hay que mirarlo *en cada*
migración, no confiar en que el `!!` alcanza.

### Tanda 2 · ocho vistas (v2.99.1) — `FilterBar` 10 → 18

Dos formas del mismo incumplimiento, y ninguna era cosmética:

| forma | vistas |
|---|---|
| **filtros en el header** (§16.9: el header es de las pestañas) | `AuditView` · `AttendanceMonitorView` · `BranchesView` · `FacturacionView` |
| **acciones dentro de la píldora** (§17: la barra filtra, no actúa) | `FacturasCompraView` · `TabMinMaxRequests` · `TabCatalogo` · `TabMinMax` |

**Tres píldoras eran `hidden lg:flex`.** `TabInventario`, `TabCatalogo` y
`SchedulesView`: bajo 1024px esas pestañas no tenían **ningún** filtro. No es
que se vieran apretados — no estaban. Es el argumento más fuerte a favor del
canónico: `FilterBar` colapsa a hoja inferior, no desaparece.

#### Deuda que cayó de rebote

| | |
|---|---|
| `AuditView` | paginación a mano → `TablePagination`. Su tamaño de página era **15**, que no existe en `PAGE_SIZE_OPTIONS`: el selector del canónico se veía vacío. |
| `AuditView` | un `isDatePickerOpen` con listener global de Escape que era **mecanismo fingido**: cerrar ese estado no cierra el calendario, porque el calendario es dueño de su propio abierto/cerrado y `onOpenChange` solo avisa. |
| `TabMinMax` | 5 `motion.button` con tres escalas de hover/tap propias → `Button`. §11 marca framer-motion como "no agregar más", y esas escalas **no pasaban por los dos gates de movimiento**. |
| `TabSinVenta` | un objeto `tk` de 11 clases literales que ya no usaba nadie |
| 2 vistas | uno-de-N a mano → `SegmentedControl` |

`TabBarAction` ganó `as`: en `FacturacionView` había un `<a>` que reconstruía
las 9 clases de `BASE` a mano, solo porque el canónico estaba clavado a
`<button>`. Un enlace que se ve como botón tiene que seguir siendo un enlace.

#### Dos trampas nuevas, las dos vistas en la captura y no leyendo

- **`flex-1` como espaciador se queda en la primera línea al envolver.** El
  grupo de filtros aparecía pegado a la **izquierda** — lo contrario de §17.
  Se resuelve con `ml-auto` en el grupo, no con el espaciador.
- **eslint no ve un componente JSX sin import.** Solo pesca identificadores en
  expresiones (`icon={X}`), así que `<FilterBar>` sin su `import` pasa el lint
  **y el build**, y revienta al abrir la vista. Es el fallo de "4 vistas con
  `<SegmentedControl>` sin import" de v2.76.0. Por eso existe la categoría
  `import` del gate, y por eso cada tanda se abre en el navegador.

#### Hallazgo abierto — familia B, no se tocó

`AttendanceAuditView`: la fila de empleado es un `<button>` que **contiene** el
`<Button>` de "Aprobar todo". HTML inválido y una segunda parada de tabulación
para la misma fila; React lo avisa en consola. Se arregla con la anatomía de
`ListRow` + `trailing`, que es familia B de D3.3 — no de rebote mientras se
migra la barra de filtros.

## Móvil — cuatro reportes del usuario, los cuatro reproducidos (v2.100.0)

Reproducidos en **WebKit con un iPhone 13**, no en Chromium con el viewport
angosto. La diferencia no es un detalle: tres de los cuatro bugs **solo
existen en WebKit**, y el barrido con Chromium móvil los daba todos en verde.

### 1 · El Inicio reventaba en Safari móvil

`ALGO SALIÓ MAL` apenas cargaba. El error, capturado interceptando
`console.error` (no llega como `pageerror`):

```
Maximum update depth exceeded
  commitHookPassiveMountEffects → recharts dispatch ×5 → forceStoreRerender
```

Un bucle infinito **dentro de recharts**. Medido en los cuatro entornos antes
de tocar nada, porque *"es el móvil"* habría sido la conclusión fácil y falsa:

| | |
|---|---|
| WebKit móvil | ✗ bucle |
| Chromium móvil | ✓ (contenedor 308×142) |
| WebKit 1500px | ✓ |
| Chromium 1500px | ✓ |

La causa está en `useReportScale` de recharts:
`getBoundingClientRect().width / offsetWidth` — una medida fraccionaria
dividida por una entera— y despacha al store si el cociente cambia. Con un
ancestro transformado (las tarjetas del Inicio entran con `staggerEnter`),
WebKit devuelve un rect distinto en cada frame y no converge.

**`ChartContainer` nuevo**: mide él el contenedor, pasa **píxeles enteros** al
gráfico y no lo monta mientras un ancestro esté animando.

**Tres intentos, y por qué los dos primeros no bastaron** — vale más que el
arreglo:

| intento | resultado |
|---|---|
| `debounce={80}` (lo que recharts documenta) | bajó la frecuencia, dejó el bug **intermitente** |
| medir yo y pasar enteros | 0/5 pantallas rotas, pero 3/5 seguían con bucle |
| esperar a que no haya animación en curso | ← el guard correcto |

Lo importante del intermedio: **intermitente es peor que reproducible**. Dos
corridas seguidas daban resultados distintos, y una de ellas parecía la
confirmación del arreglo. Por eso la verificación pasó a ser 5 corridas, no
una.

Y un bug **propio** encontrado al arreglarlo: la primera versión encolaba un
`requestAnimationFrame` por llamada sin cancelar el anterior, y como el
`ResizeObserver` también llama a medir, los frames se multiplicaban en vez de
sustituirse. Un arreglo que se apoya en rAF tiene que traer su propio cancel;
si no, es otro bucle con distinto nombre.

### 2 · "El menú en móvil no funciona correctamente"

Dos cosas distintas bajo el mismo reporte:

- **El vidrio.** El sidebar tenía `bg-[#07031a]/95 lg:bg-[#07031a]/80
  lg:backdrop-blur-2xl`. Ese `lg:` era el bug: en un teléfono **no había blur**
  pero el fondo seguía translúcido al 95%, así que ese 5% dejaba ver el texto
  de la vista **nítido** a través del menú. Es peor que cualquiera de los dos
  extremos — opaco se ve limpio, vidrio con blur se ve vidrio; opaco-al-95%
  sin blur se ve sucio.
- **La mitad del menú era invisible.** 47 ítems, **23 visibles** en un iPhone
  13, y el nav usa `scrollbar-hide`: no había ninguna señal de que hubiera
  más. Ahora un desvanecido aparece solo cuando queda lista por debajo.

#### El sidebar es bespoke en color, no en material

Esa distinción es la que faltaba, y es la respuesta a *"aplicalo según tema,
lo que no es el color"*. El sidebar es oscuro en los cuatro temas a propósito
—igual que el kiosco—, pero eso no lo hace dueño de su **material**. Ahora sale
de `--sidebar-bg` / `--sidebar-backdrop` / `--sidebar-border`, verificado en
los cuatro:

| tema | fondo | vidrio |
|---|---|---|
| liquid · dark | `rgba(7,3,26,.80)` | `blur(28px) saturate(1.8)` |
| solid · solid-dark | `#0B1020` | **none** |

### 3 · "En móvil el selector de fecha abre el teclado"

Literal: los tres campos DD/MM/AAAA **son `<input>`**, así que tocarlos enfoca
y el sistema levanta el teclado numérico — que tapa media pantalla y, con
ella, la hoja del calendario que acababa de abrirse. Con el dedo nadie teclea
`15/07/2026` teniendo días de 44px al lado.

En táctil los tres se renderizan como **texto** y el control entero es el
disparador de la hoja. Misma regla que ya aprendió `Switch`: **si algo no se va
a usar como campo, no debe SER un campo** — un `readOnly` se seguiría
enfocando. Igual en `RangeDatePicker`, donde además el panel medía 557px en
una ventana útil de 664px y con el teclado no entraba.

#### Y al abrirlo apareció otra superficie sin nombrar: la hoja

Con el teclado fuera del camino se vio el problema de abajo: **la hoja del
calendario dejaba leer la hoja de filtros que tenía debajo**. En la captura se
leían *"Filtros"*, *"DD/MM/AAAA"* y los cuatro estados del segmentado a través
del calendario, todo encimado.

Las tres hojas del portal —selector de fecha, de rango y `FilterBar`— usaban
`--surface-dropdown`, al **72% de opacidad**. Y ahí está el error de
clasificación: un dropdown de escritorio se apoya sobre *un control* y dejar
entrever el fondo es parte del material; una hoja táctil **tapa la app entera**
y a veces se apila sobre otra hoja. Son dos superficies distintas con el mismo
nombre.

`--surface-sheet` + `data-surface="sheet"`: sigue siendo vidrio —el blur está—
pero a una opacidad donde lo de atrás es luz, no texto. Opaco en los dos temas
Solid, como corresponde.

Y de paso: los cinco atajos (*Hoy · Ayer · Hace 7 días…*) eran cinco
**rellenos azules** seguidos, cada uno gritando ser la acción principal, y sin
`key` porque salen de un `.map()`. Son atajos: secundarios y chicos. El mismo
par de fallos estaba en `RangeDatePicker`.

### 4 · "Al abrir las notificaciones se corta"

El panel era `absolute right-0` con ancho `100vw - 2rem`. Como la campana no
está pegada al borde derecho, el panel se extendía hacia la izquierda y se
salía: medido en iPhone 13, **x = -36px** — el título se leía *"otificaciones"*.
Ahora en móvil es `fixed` anclado a los bordes de la **pantalla**, con `max-h`
y scroll propio. Verificado: x=8, derecha=382 de 390.

### El barrido que confirma que no hay más

8 rutas en WebKit móvil: **0 errores de JS, 0 scroll horizontal, 0 elementos
recortados**. Los 6 que reporta el escáner en cada ruta son los blobs
ambientales decorativos y el `<aside>` cerrado — los dos fuera de pantalla a
propósito.

### El gate aprendió algo

Su lista de canónicos estaba **escrita a mano**, así que al crear `FilterBar`,
`PeriodStepper` y `ChartContainer` el gate seguía mirando los 16 viejos — y un
`<FilterBar>` sin import volvía a pasar el lint, el build **y** el gate. Ahora
sale de `readdirSync('components/common')`. Un diccionario a mano siempre
termina desactualizado; la carpeta no. Probado quitando un import a propósito.

### Vidrio que el contrato Solid todavía no alcanza — medido, no resuelto

La regla `[data-theme="solid"] [class*="bg-surface-"][class*="backdrop-blur"]`
exige **las dos** subcadenas en la misma clase. Al medirlo hoy:

| | |
|---|---|
| blur sobre fondo translúcido crudo (el blur sostiene la legibilidad) | 4 |
| blur **sin** fondo translúcido en la misma clase → costo sin efecto en Solid | **92** |

Los 92 no se arreglan ampliando el selector: eso rompería los 4. Se arreglan
migrando **el fondo** a `bg-surface-*`, y entonces la regla que ya existe los
cubre sola. O sea que no es deuda de vidrio: es la misma deuda `white` del
baseline, vista desde otro ángulo.

## Abiertos sin resolver

- **`TabStaff.jsx:243` — panel "Motor de Sincronización WFM" en oscuro fijo.**
  `bg-slate-900` + `border-slate-700` + `bg-slate-800` + `from-blue-500`, con
  `text-content-3` adentro (token que sigue el tema, sobre un fondo que no lo
  sigue: el mismo bug de contraste que tenían los tooltips). Encontrado el
  2026-07-27 al migrar los dos hover cards de ese archivo.
  **No lo toqué a propósito**: convertirlo a `data-surface="card"` lo volvería
  claro en tema claro, y eso es un cambio de aspecto que hay que decidir, no
  aplicar de rebote mientras se arregla otra cosa. Dos salidas posibles —
  (a) que siga el tema como cualquier tarjeta, o (b) que se quede oscuro a
  propósito usando la paleta bespoke del sidebar, como los flyouts anclados.
  Es un panel de administración, así que (b) es defendible. **Falta que el
  usuario elija.**


- **`MenuSearchModal` — NO REPRODUCIDO.** Reportado como "siempre claro".
  Medido en vivo en los 4 temas contra el build actual: el fondo del modal
  resuelve correctamente en cada uno (`rgba(240,248,255,.72)` claro ·
  `rgba(10,15,38,.88)` oscuro · blanco sólido · `rgb(30,41,59)` sólido oscuro).
  Dos explicaciones posibles: o lo arregló de rebote alguno de los cambios de
  tema de esta sesión, o lo que se vio fue el acceso **móvil**, que se eliminó
  en v2.71.1 junto con la lupa del header. Queda anotado por si reaparece.

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
