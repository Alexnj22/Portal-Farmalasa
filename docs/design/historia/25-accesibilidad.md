# Accesibilidad — historia

> Historia de DESIGN.md §25. Copia fiel del texto que vivía en DESIGN.md hasta el 2026-11-06, cuando el documento se condensó: allá quedaron la regla, el canónico, un ejemplo corto y el gate; acá, las mediciones y los incidentes que explican por qué. Las citas a líneas de código y los números de sección son los de ESA época (la Voz era §26, hoy §34).

## 25. Accessibility

### Focus visible

Global rule exists in `src/index.css:430–437`:

```css
button:focus-visible,
input:not(.outline-none):focus-visible,
select:not(.outline-none):focus-visible,
textarea:not(.outline-none):focus-visible,
a:focus-visible,
[role="button"]:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid rgba(0,82,204,0.55);
  outline-offset: 2px;
}
```

Los campos glass llevan `outline-none` y quedan fuera de esa regla a propósito:
dibujan su propio anillo sobre el **contenedor**, no sobre el `<input>` —
`inputHoverClass` (`src/utils/inputStyles.js`) pone
`focus-within:outline-2 outline-brand/30`, que es lo que hace que se ilumine la
caja entera y no solo el texto.

**Esto NO es un hueco, aunque durante meses estuvo documentado como tal**
(verificado el 2026-07-28). La nota vieja decía que ese anillo "no está gateado
por `focus-visible`, se dispara también con clic de mouse", con la idea de que
gatearlo lo dejaría solo para teclado. Medido: no cambiaría nada.

| elemento | clic de mouse | Tab |
|---|---|---|
| `<input type="text">` | anillo ✓ | anillo ✓ |
| `<button>` | sin anillo | anillo ✓ |
| `<input type="checkbox">` | sin anillo | anillo ✓ |

**Un campo de texto matchea `:focus-visible` aunque lo enfoques con el mouse** —
está en la especificación, no es una particularidad del portal: en cuanto hiciste
clic ahí lo siguiente que va a pasar es que escribas, y el navegador te muestra
dónde va a caer eso. La condición que agregaríamos ya se cumple siempre.
Comprobado además sobre el campo real: las capturas con clic y con Tab son el
mismo archivo byte por byte.

`focus-within` y `focus-visible` solo se separarían si dentro del contenedor
hubiera **otro** control enfocable — ahí el anillo del campo se encendería al
clickear ese botón. Hoy no pasa, y §15.11 fija la regla de que la acción va
AFUERA del campo, no encima. Si algún día se rompe esa regla, esto vuelve a ser
un hueco de verdad.

**El caso del PIN del kiosco** (`AuthPromptPanel`) también estaba mal descrito.
La nota vieja decía que `.virtual-caret-blue/orange` "suprimen el anillo por
completo". No: ese `outline: none` era letra muerta — la regla global de arriba
es `input:not(.outline-none):focus-visible`, que le out-especifica, así que el
campo siempre tuvo anillo. Se quitó la declaración muerta.

Lo que sí había ahí era un bug real, encontrado al ir a verificar esto: el pulso
del borde es un **bucle infinito de 1.5s que seguía corriendo con
`prefers-reduced-motion: reduce`** (medido: `animationName` seguía dando
`border-pulse-orange`), pese a que §11 dice que los bucles infinitos se apagan.
No se podía apagar a secas —en ese campo la animación *es* el indicador de foco,
porque el cursor nativo está oculto con `caret-transparent`—, así que ahora se
**congela en el estado encendido**: borde marcado, sin movimiento.

De paso: `.virtual-caret-blue` y su `@keyframes border-pulse-blue` no los usaba
nadie. Eliminados.

### Touch targets

| Element | Padding | Computed height | Status |
|---|---|---|---|
| Nav top-level button | `px-3 py-3` + icon 20px | ≈ 44px | ✅ |
| Nav group header | `px-3 py-2.5` + icon 20px | ≈ 40px | ⚠️ borderline |
| Nav indented button | `px-2.5 py-2` + icon 16px | ≈ 36px | ❌ below 44px |
| Mobile bottom tab | `px-3 py-2` + icon 20px + label 9px | ≈ 45px | ✅ |
| Sidebar collapsed buttons | `w-11 h-11` = 44px | 44px | ✅ |

El mínimo de 44px es **WCAG 2.5.5 Target Size (Enhanced), AAA** —y la guía de Apple—, no 2.5.8: ese es 24×24 y es AA. El proyecto sostiene 44 a propósito. Desde 2026-07-28 lo garantiza `--tap-min` (§25.6) y no la buena voluntad de cada tamaño; la tabla de arriba es de antes de ese cambio.

### ARIA

**Implemented:**
- `ModalShell` (`src/components/common/ModalShell.jsx`): `role="dialog"`, `aria-modal="true"`, `aria-label={ariaLabel}` ✅. **2026-07-15 update**: the `ariaLabel` prop existed but nothing ever passed it — every modal in the app announced as the generic default ("Ventana modal"), including `UnifiedModal` (the app's highest-traffic modal system, ~40 form types). Wired through `LiquidModal`'s new `ariaLabel` prop and set on all 9 real `<LiquidModal>`/`<ModalShell>` call sites with each modal's real title (`UnifiedModal` uses its existing `getModalTitle()`).
- `BranchHelpers` toggle (`src/components/forms/BranchHelpers.jsx:54`): `aria-pressed={on}` ✅
- `LiquidSelect` (`src/components/common/LiquidSelect.jsx`) — **2026-07-15**: patrón combobox/listbox — el disparador lleva `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls` (el `id` del desplegable abierto, vía `useId()`) y `aria-activedescendant` (la opción resaltada); el desplegable lleva `role="listbox"` + el `id` que coincide; cada opción lleva `role="option"` + `id` + `aria-selected`.

  **Corrección 2026-07-28 — los roles estaban, el teclado no.** El disparador
  es un `<div>` (tiene que serlo: al abrirse se le superpone el input de
  búsqueda, y un `<button>` no puede contener un `<input>`), y no llevaba
  `tabIndex` ni `onKeyDown`. Medido en `/staff`: **2 combobox en la vista, 0
  alcanzables con Tab.** Como `LiquidSelect` reemplaza a todo `<select>` nativo
  del portal (70 archivos), ningún desplegable — filtros, formularios, modales
  — se podía abrir sin mouse. Los atributos ARIA describían un widget que no
  funcionaba.

  La lección es la que se repitió toda la auditoría: **poner el `role` es la
  mitad fácil.** Un `role` promete un contrato de teclado que el navegador solo
  cumple gratis con el elemento nativo. Cuando el elemento es un `<div>`, hay
  que implementarlo entero: foco (`tabIndex`), apertura (`Enter`/`Espacio`/
  `Flecha-abajo`), y devolver el foco al disparador al cerrar — si no, cae al
  `<body>` y el siguiente Tab arranca desde el principio de la página.

  Dos trampas al implementarlo:
  - El `Enter` del input de búsqueda **burbujea** hasta el disparador y lo
    reabre. Guardia: `if (e.target !== e.currentTarget) return;` (el mismo de
    `DataRow`).
  - El anillo de foco necesita `outline-solid` explícito: en Tailwind v4 un
    `focus-visible:outline-2` sin él no pinta nada.
- Sidebar collapsible groups (`AppLayout.jsx`) — **2026-07-15**: group header button gets `aria-expanded`/`aria-controls`; submenu container gets the matching `id` (`nav-group-{key}`).
- `PortalInput` (`src/components/common/PortalInput.jsx`) — **2026-07-15**: the canonical shared text-input component (see house rule above the component) now sets `id`/`<label htmlFor>` association, `aria-required`, `aria-invalid`, and `aria-describedby` pointing to the inline "Requerido"/error badge. Only 4 files use it today (`EmployeeFormModal`, `PracticanteModal`) — fixing the shared component is what makes this correct by default for any future form that reuses it, per the existing house rule.

### 25.1 Nombre accesible: la regla que ahora vigila el gate (2026-07-28)

**Todo control interactivo necesita un nombre.** Sin él, un lector de pantalla
anuncia "botón" o "cuadro de edición, en blanco" y no hay forma de saber qué
hace. Dos categorías del `design-gate` lo vigilan, ambas en **cero absoluto**:

| categoría | qué marca |
|---|---|
| `button-name` | `<button>` cuyo contenido son solo íconos, sin `aria-label` ni `title` |
| `input-sin-nombre` | `<input>` sin `aria-label` y sin un `<label htmlFor>` que lo apunte |

**El `placeholder` no es un nombre accesible** y la regla no lo mira. Desaparece
apenas el campo tiene contenido — justo cuando alguien vuelve a revisar lo que
escribió — y varios lectores no lo exponen. Por eso `SearchInput`, `ViewTabBar`
y `CatalogOtherInput` ponen `aria-label={ariaLabel ?? placeholder}`: el
placeholder sirve de default razonable, pero como atributo de verdad.

Medido al cerrar D3.4: **45 campos anónimos en 30 archivos**, más uno que el
barrido manual no vio y el gate sí (`LazyInput`, un helper compartido).

**Un campo artesanal no está exento.** Son dos cosas distintas:
`input-a-mano` tolera por ratchet los campos que legítimamente no son
`PortalInput` — celdas de una grilla densa, que no llevan etiqueta visible
porque el encabezado de su columna ya dice qué son, y `PortalInput` siempre
dibuja un `<label>` arriba. `input-sin-nombre` no tolera nada: esa celda igual
necesita su `aria-label`.

### 25.2 Cuál atributo de estado, y cuándo

| atributo | cuándo | cuándo NO |
|---|---|---|
| `aria-pressed` | interruptor de dos estados que se queda puesto (modo privacidad, mostrar ocultos) | una acción que se ejecuta y ya (ocultar ESTE producto) — el estado no vive en el botón |
| `aria-expanded` | algo que se despliega y se repliega (grupo del menú, combobox) | — |
| `aria-current` | dónde estás (`"page"` en el nav, `"step"` en un asistente) | selección dentro de un control — eso es `aria-pressed`/`aria-selected` |
| `aria-sort` | el `<th>` por el que la tabla está ordenada, `"ascending"`/`"descending"` | los demás `<th>`: se omite, no se pone `"none"` en todos |
| `aria-busy` | contenedor mientras recarga sin desmontarse | — |

El error propio que vale documentar: le puse `aria-pressed={!showHidden}` al
botón de ocultar un producto en `/ventas`. `showHidden` filtra la tabla entera,
así que **todas** las filas habrían anunciado el mismo estado. Un botón que
actúa sobre una fila no tiene estado propio: es una acción.

### 25.3 Teclado en tablas (`DataTable`)

- **Fila clicable** (`DataRow` con `onClick`): lleva `tabIndex={0}` y responde a
  `Enter`/`Espacio`. Con la guardia `if (e.target !== e.currentTarget) return;`
  — si no, la tecla de un botón interno de la fila dispara también la fila.
- **Columna ordenable**: el rótulo del `<th>` va dentro de un `<button>` real
  (no un `<th onClick>`), con `aria-label` que dice qué va a pasar
  ("Ordenar por Sucursal, ascendente"), y el `<th>` lleva `aria-sort`. Con
  `flex-row-reverse` cuando la columna es de alineación derecha, para que la
  flechita quede del lado del número. Arreglado en el canónico: **62 columnas
  en 12 vistas** de una sola vez.

**Sin pendientes abiertos.** Lo que esta lista decía sobre los campos glass y
`focus-visible` estaba mal — ver § Focus visible arriba, donde está la medición.

### prefers-reduced-motion

**Implemented** — `src/index.css` (block added before `@media print`).

**Disabled entirely** (infinite loops / large displacement):
`animate-ambient-drift`, `animate-ambient-drift-reverse`, `animate-shimmer`, `glow-danger`, `glow-warning`, `badge-pulse`, `animate-wiggle`, `animate-tab-enter-right/left`, `animate-tab-exit-right/left`, `animate-stagger-child`, `animate-input-reveal`, `animate-route-enter`, `animate-view-enter`. `will-change` also reset to `auto` for disabled classes.

**Reduced to `rm-fade-in` 120ms opacity-only:**
`animate-kpi-enter`, `animate-widget-enter`, `animate-widget-settle`, `animate-table-row-enter`.

**Skeleton** — animation stopped; background becomes a solid `rgba(148,163,184,0.15)`.

**Congelada en el estado encendido** (2026-07-28): `.virtual-caret-orange:focus`,
el pulso del borde del campo de PIN del kiosco. Es el único caso donde la
animación **es** el indicador de foco —el cursor nativo está oculto con
`caret-transparent`—, así que apagarla a secas dejaría el campo sin marca. Se
detiene el movimiento y se deja el borde en su estado más visible. Estuvo fuera
de esta lista desde que se escribió: era un bucle infinito de 1.5s corriendo con
la preferencia puesta.

**Cómo verificarlo**, porque leer la lista no alcanza —este caso llevaba meses
faltando y el documento decía que estaba cubierto—:

```js
// Playwright: el navegador con la preferencia puesta
const page = await browser.newPage({ reducedMotion: 'reduce' });
// …y después, sobre el elemento:
getComputedStyle(el).animationName   // debe dar 'none'
```

Hover lifts (`hover:-translate-y-*`) remain unaffected — they are already scoped to `@media (hover: hover)` which only fires on pointer devices.

---

## 25.4 Las DOS superficies bespoke — lista CERRADA (2026-07-28, reducida 2026-08-06)

Regla: **el cuerpo de toda vista sigue el tema, sin excepción.** Modales,
tarjetas, paneles, chips, gráficos — todo. Un fondo pintado con color fijo y
texto adentro con tokens de tema es un bug de contraste esperando el tema
contrario; pasó siete veces y se cerraron todas.

Solo dos superficies quedan fuera, y esta lista **no se amplía**:

| superficie | por qué |
|---|---|
| **Kiosco** (`components/timeclock/`) | Es una tablet montada en pared, muchas veces en sala con luz fuerte: el contraste alto sobre negro es parte de que se lea de lejos. Además nadie elige tema ahí — no hay sesión con preferencia. |
| **Login** | Fuerza claro antes de que exista sesión. No puede seguir "el tema del usuario" porque todavía no sabe quién es. |

> **⚠️ El sidebar SALIÓ de esta lista.** `PLAN-MATERIALES` §12.1 lo decidió el
> 2026-08-05 —*«el sidebar sigue el tema»*— y sus tokens ya lo aplican: en Liquid
> claro `--sidebar-tint` vale `236 234 250` con tinta `15 23 42`, o sea **un
> sidebar claro con texto oscuro**. Este texto siguió diciendo *«oscuro es su
> identidad»* durante un día entero después de que dejara de ser cierto, que es
> exactamente el contrato-que-nadie-sabe-si-manda que §12.1 quería evitar
> pidiendo cambiar token y texto **en el mismo commit**. Corregido el 2026-08-06.
>
> Lo que **sí** sigue valiendo del párrafo viejo: sus popovers anclados usan la
> paleta del sidebar (`--sidebar-pop-tint`/`--sidebar-pop-fill`) y no
> `data-surface="dropdown"` — son parte del chrome, aunque el chrome ya no sea
> siempre-oscuro.

Agregar una cuarta necesita decisión explícita, no un `bg-slate-900` puesto al
pasar. La señal de "cuidado, esto es peligroso" se transmite con **color
semántico** —un `Notice` de tono `warning`, un borde `danger`—, que el tema sabe
adaptar; una superficie oscura fija no la transmite y además deja de leerse.

**Excepción dentro de la excepción:** una consola de log (`TabStaff`, salida del
motor de sincronización) se queda oscura con texto mono verde. Ahí lo oscuro no
es decoración: es lo que la hace leerse como salida de terminal.

### 25.5 Bespoke en COLOR no es bespoke en MATERIAL

*(El ejemplo de abajo es histórico: el sidebar dejó de ser oscuro en los cuatro
temas — ver el aviso de §25.4. La lección **sí** sigue en pie, y ahora vale para
el kiosco y el login: que una superficie tenga color propio no la exime del
material del tema.)*

El sidebar era oscuro en los cuatro temas, y eso no lo eximía del material del
tema. Hasta el 2026-07-28 tenía las dos cosas: en liquid glass era un relleno
del 80% con blur de 28px y un borde de `rgba(255,255,255,0.10)`, al lado de
tarjetas del 16% con blur de 44px y borde de 0.72. Se leía como una losa opaca
pegada a la izquierda, no como parte del mismo mundo.

Ahora hereda `--backdrop-card`: **el vidrio del sidebar ES el de la tarjeta**, y
afinar uno afina el otro.

El relleno bajó a **0.72, y ese número es un límite medido, no una preferencia**.
Con el punto más claro del degradado de la página detrás:

| relleno | deja pasar | opacidad mínima del texto para AA 4.5:1 |
|---|---|---|
| 0.80 | 20% | `white/51` |
| **0.72** | **28%** | **`white/59`** ← el texto del menú es `white/60` |
| 0.66 | 34% | `white/68` |
| 0.60 | 40% | `white/79` |

Bajar más obliga a subir el texto casi a blanco, y ahí se aplana la diferencia
entre el ítem activo y el resto. 0.72 es el máximo de vidrio que la jerarquía
del texto aguanta.

El borde subió a **0.42** — comparados 0.10 / 0.28 / 0.42 / 0.60 en captura a 3×
contra la tarjeta que queda a su derecha: en 0.10 el borde derecho no existe, el
panel simplemente termina; en 0.42 el canto responde a la luz igual que el de la
tarjeta. Y el sidebar toma `--card-shadow`: sin ella quedaba pegado al fondo
aunque el vidrio ya fuera el mismo.

**En móvil sigue opaco y sin blur, y eso no es una regresión** — el panel se
desliza con `transform`, y un ancestro transformado crea contexto de
apilamiento: el "backdrop" que el filtro difumina es el de ESE contexto, no la
página. Medido en un iPhone 13: el filtro se declara, el navegador lo acepta, y
el texto de la vista se sigue leyendo nítido a través del menú. Un menú que tapa
la app entera no tiene nada que dejar entrever.

### 25.6 `--tap-min`: el piso del dedo

`--control-h` sube a 44px en táctil, pero los tamaños chicos de `Button` se
derivan **restándole** (`sm` = `control-h - 6`, `xs` = `control-h - 12`). O sea
que en un teléfono daban 38px y 32px, por debajo del mínimo — aunque el
comentario del componente afirmara lo contrario desde que se escribió.

```jsx
// ❌ el piso se pierde al restar
sm: 'h-[max(34px,calc(var(--control-h)-6px))]'

// ✅ el piso va DENTRO del max()
sm: 'h-[max(34px,var(--tap-min),calc(var(--control-h)-6px))]'
```

`--tap-min` vale `0px` con puntero fino y `44px` con puntero grueso, así que en
escritorio los tamaños siguen escalando con la densidad y en táctil ninguno baja
del mínimo. Va por **puntero, no por ancho de viewport**: una laptop táctil
también tiene dedos.

Medido en un iPhone 13, `/productos`: **20 de 87 controles por debajo de 44px →
0**. Lo que apareció al arreglarlos:

- **`iconOnly` no tenía altura.** `ICON_ONLY_SIZE` *reemplaza* a `SIZE_CLASSES`,
  no lo complementa, y solo traía `w-` y `px-0`. Donde el contenedor padre
  estiraba el botón se veía cuadrado y nadie lo notó; donde no, quedaba una
  pastilla de 44×15. Afectaba a los 194 `iconOnly` del portal.
- **El botón de ordenar de `DataTable`** medía el alto del texto (15px). Con
  `-my-2 py-2 min-h-[var(--tap-min)]` el área tocable ocupa la celda entera sin
  mover el encabezado.
- **Un control que NO puede crecer**: el chevron de `LiquidSelect` vive dentro
  del campo y agrandarlo le comería el texto. Ahí se agranda solo el área
  tocable con un pseudo-elemento centrado de `var(--tap-min)` — se ve igual de
  chico y se toca como uno de 44px. Es el único caso del portal que necesita
  esto; no es una técnica para repartir.

**Corrección de esta misma sección:** §25 decía que el mínimo de 44px "sigue
WCAG 2.5.8 (AA)". No: **2.5.8 Target Size (Minimum) es 24×24 y es AA**; 44×44 es
**2.5.5 Target Size (Enhanced), AAA**, y coincide con la guía de Apple. El
proyecto sostiene 44 a propósito — es un estándar más alto que el exigido, no el
exigido.

### 25.7 Texto que no puede envolver, se corta

`StatCard` llevaba `whitespace-nowrap` en la etiqueta y el subtítulo, con este
razonamiento: la tarjeta tiene `flex-1 basis-0`, así que en vez de truncar
**crece**. Es correcto mientras la FILA tenga de dónde crecer. En un teléfono no
la tiene, y ahí el `nowrap` deja de empujar el ancho para pasar a cortar:
"precios o datos cambiados" y "< 15% en algún precio" salían partidos a mitad de
palabra.

Bajo 560px el texto envuelve (`max-[560px]:whitespace-normal`). El **valor**
mantiene `nowrap` en todo ancho: un número partido no comunica nada.

#### El `sub` de una `StatCard` lleva UN dato, dos como mucho y cortos (2026-09-25)

La tarjeta topa en **200px**, y descontando el ícono al texto le quedan ~124:
**unos 22 caracteres** en `text-micro`. Por encima de eso el `truncate` corta, y
con números adentro el largo lo decide el dato, no el código — el mismo `sub`
entra un día y al siguiente no.

En Puntos, `«$17,423.76 · 11,295 clientes»` salía `«$17,423.76 · 11,295 client…»`.
Y el aviso fue del usuario, no del instrumento: la sección 3 del barrido de
escritorio medía `th`, títulos, botones y pestañas, y los textos de la tarjeta
son `<span>`. Hoy llevan `data-texto-metrica` y el barrido los mide igual.

Regla:

- **Un dato por `sub`.** Si hay dos que importan, el segundo es otra tarjeta.
- Dos sólo si juntos caben en el peor caso: el número más largo que puede tomar
  ese dato, no el de hoy. `$47.95 · 380 ventas` sí; `ventas · mes 146,487`, no.
- **Nunca «se ve en el tooltip»**: la tarjeta no tiene tooltip. El `aria-label`
  lleva el texto entero para un lector de pantalla, no para quien mira.
- Lo que no entra en la fila de tarjetas va a la nota del panel que lo explica
  (en Puntos, el mes va en el encabezado de «Este mes, por sala»).

Se verifica con el barrido de escritorio (`barrido-escritorio.spec.js`), que
ahora reporta cualquier `[data-texto-metrica]` cuyo `scrollWidth` supere su ancho.

### 25.8 `clickable()` — y qué se rompió al aplicarlo

`src/utils/clickable.js` le da el contrato de teclado a un elemento que se
comporta como botón pero no lo es (una fila, una celda, una tarjeta que envuelve
otros controles):

```jsx
<div {...clickable(abrirEditor)} className="…">
```

Devuelve `role="button"`, `tabIndex={0}`, **`onClick`** y un `onKeyDown` que
dispara con Enter/Espacio y **ignora las teclas que burbujean desde adentro**
(`e.target !== e.currentTarget`), para que el Enter de un input interno no
active además la acción del contenedor.

**Las dos cosas que rompió su primera aplicación (2026-07-29), que valen más que
el helper:**

1. **Devolvía el teclado pero no el clic.** El migrador que lo aplicó reemplazó
   el `onClick={fn}` de cada sitio por el spread, y como el helper no devolvía
   `onClick`, los **34 controles quedaron alcanzables con teclado y muertos con
   mouse**. Build, lint y `gate:design` en verde. Se vio en min/max: tocar la
   caja MIN expandía la fila en vez de abrir el editor. → *un helper que RECIBE
   el handler tiene que cablear los dos caminos.*

2. **No todo `onClick` sobre un `<div>` es un botón.** Cinco sitios eran
   `onClick={e => e.stopPropagation()}` — barreras de evento, no controles.
   Convertirlas les dio `role="button"` y una parada de tabulación que no hace
   nada. Esas van con `onClick` pelado.

**Y la tercera, del mismo día y del mismo tipo de migración automática:** el
migrador de `PortalInput` extraía props con un regex que soporta dos niveles de
llaves anidadas. Los dos `onKeyDown` de la grilla de min/max (3.7KB y 6.5KB, con
la navegación tipo hoja de cálculo: `→` de MIN a MAX, `Enter`/`↓` guarda y salta
al siguiente producto, `←` vuelve, `Esc` cancela) anidan mucho más, así que se
**descartaron en silencio** — el input migró sin ellos y nada falló. Se
recuperaron de `git show aca2ef0f^`.

Las tres comparten causa: **una migración masiva que reescribe JSX solo se puede
dar por buena si se ejercita el resultado**. Verde en build + lint + gate
significa que compila, no que el control sigue haciendo lo que hacía.

### 25.9 Qué cuenta como target — y por qué 224 eran 46 (2026-07-29)

La auditoría anterior dejó **"224 targets bajo 44px"** abiertos. Al volver a
medirlos en iPhone 13 sobre 22 rutas, la mayoría **no eran targets**. Tres
exclusiones, y las tres son criterio, no conveniencia:

| se excluye | por qué |
|---|---|
| `aria-hidden="true"` + `tabIndex={-1}` | Duplican una acción que ya tiene un control mayor — el chevron de `LiquidSelect` sobre su propio combobox, el de `AttendanceAuditView` sobre una fila entera clicable. **50 de los 224 eran esto en una sola vista.** No están en el árbol de accesibilidad ni reciben foco: el target es el control que envuelven. |
| `.sr-only` con etiqueta visible | Un `<input>` de 1×1 emparejado por `peer` con una etiqueta que sí se ve. Es el patrón accesible correcto; el target es la etiqueta. **26 en `/proveedores`.** |
| Caja CSS ≥44 encogida por un `scale` de ancestro | El botón de tamaño del widget mide 44px declarados y 42 en pantalla porque su panel está en `scale-[0.95]` **mientras está oculto** (`opacity-0`). Medir el rect y no la caja inventa un hallazgo. |

Lo que quedó después de eso: **989 controles medidos, 7 bajo 44px**, y los 7 son
las **barras del gráfico de ventas** (38×68). Ahí 44px de ancho no es una
mejora: el ancho de la barra *es* el dato. WCAG 2.5.5 tiene excepción explícita
para presentación esencial, y 2.5.8 (AA, 24×24) se cumple.

Lo que sí era deuda y se corrigió: `SegmentedControl` (28/36px fijos →
`max(…, var(--tap-min))`), `LiquidSelect` (40px fijos → ídem; `nano` se queda en
26 porque vive en grillas densas y ya recibe su área tocable por
pseudo-elemento), `PeriodStepper` (el rótulo es un atajo real, no decoración),
los botones de `/branches` y el chip de tres segmentos de `/facturacion`.

**La regla que sale de acá:** antes de contar un control como target, preguntar
si es *el* control o el adorno de otro. Un conteo que no distingue eso manda a
agrandar cosas que no se tocan y esconde las que sí.

Una cuarta exclusión apareció midiendo **dentro de los modales**: el `<input>`
de `PortalInput` mide 42px mientras su contenedor `data-surface="input"` mide
44 — los 2px son el borde. **No se resolvió bajando el umbral sino con una
prueba de impacto**: `elementFromPoint` sobre el borde del contenedor devuelve
el propio `<input>`, o sea que los 44px son zona viva. El target es el
**control**, no su elemento interno.

### 25.10 Los canónicos con altura escrita a mano (2026-07-29)

Tres canónicos llevaban su altura como literal, y los tres quedaban bajo el
piso del dedo en táctil sin que nadie lo notara — porque en escritorio se ven
perfectos:

| canónico | tenía | ahora |
|---|---|---|
| `SegmentedControl` | `h-7` / `h-9` | `h-[max(28px,var(--tap-min))]` / `max(36px,…)` |
| `LiquidSelect` | `min-h-[40px]` | `min-h-[max(40px,var(--tap-min))]` |
| `PortalInput` | `h-[40px]` | `h-[max(40px,var(--tap-min))]` |

`--tap-min` vale 0 con puntero fino, así que **en escritorio no cambia nada**.
Las variantes densas (`compact`, `nano`) se quedan en 32/26px a propósito: son
las celdas de grilla de §15.12, y ya reciben su área tocable por
pseudo-elemento sin ocupar ese espacio en pantalla.

**La regla:** un canónico nunca escribe su altura como literal. Va por
`max(<altura de diseño>, var(--tap-min))` — o por `--control-h`, que ya lo
incluye.

### 25.10-bis El `min-h` correcto con el relleno viejo encima (2026-08-26)

La unificación de arriba **no se completó en `LiquidSelect`**, y nadie lo notó
durante un mes porque el gate lee el fuente y ahí las dos líneas se ven bien: el
disparador declaraba `min-h-[max(40px,var(--tap-min))]`, que es lo que pide
§25.10, **y además conservaba el `py-3.5` de la versión vieja**. Un mínimo no
compite con un relleno: se suman.

Medido con Chromium sobre el CSS compilado:

| control | medía |
|---|---:|
| `PortalInput` | **40.0px** |
| `LiquidSelect` | **46.3px** |

O sea que los dos controles más usados del portal **nunca** quedaron a la misma
altura, en ninguna pantalla. Lo reportó el usuario mirando el alta de personal:
*«no me gusta que hay distintos tamaños en los inputs, que no están alineados»*.

**La regla, ampliada:** cuando la altura de un control ya está declarada —por
`h-`, por `min-h-` o por `--control-h`—, **su contenido no lleva relleno
vertical**. El centrado es del contenedor (`flex items-center`), no del padding.
Un relleno debajo de una altura declarada es invisible en el fuente y sólo
aparece midiendo.

Lo ancla `tests/unit/altoDeLosControles.test.js`, que vigila la FORMA que
produjo el defecto —relleno vertical encima de un alto ya declarado— y no el
número: jsdom no calcula layout, así que la medición se hace con un navegador de
verdad y la prueba es la red para la regresión. Se le fabricó el defecto para
confirmar que lo caza.

**Y el otro lado del mismo problema:** un recuadro con `h-[40px]` literal al
lado de un canónico coincide en escritorio y **no en un teléfono**, donde el
canónico sube a 44 y el literal se queda en 40. El alta de personal tenía 20.
Quedan **21 en otros seis archivos**, medidos: `BranchTabGeneral` (9),
`FormNovedad` (4), `PracticanteModal` (3), y uno cada uno en `RangeDatePicker`,
`CatalogSelect`, `FormRehireEmployee` y `ScheduleCalendar`.

### 25.10-ter El rótulo también tiene que medir siempre lo mismo (2026-08-26)

Arreglado el alto del select, el usuario volvió con la misma queja sobre otra
fila: *«teléfono y correo tiene distinto tamaño»*. Esta vez el que se movía no
era el campo sino **el rótulo de arriba**, y con él, dónde empieza el campo.

Medido con Chromium sobre el CSS compilado, en el alta de personal:

| el rótulo llevaba | medía | cuántos |
|---|---:|---:|
| sólo texto | 15px | 42 |
| «Requerido» | 25px | 18 |
| un botón `xs` | 28px | 1 |
| un botón normal | 36px (y margen −2 en vez de 6) | 1 |

O sea que dos campos vecinos arrancaban hasta **21px** desalineados, y la
diferencia no la decidía el diseño: la decidía si a ese campo le tocaba una
insignia. Sumado a un caso aparte —un rótulo con `mb-1.5` propio **dentro** de
un padre con `gap-2`, que suma 14px contra 6— eso es exactamente lo que se veía
entre teléfono y correo.

**La regla: el alto del rótulo lo fija el rótulo, no su contenido.** Son 20px
(`rotuloCampo()` en `src/utils/rotuloDeCampo.js`), y lo que entra tiene límite:

- una insignia va `size="sm"` (19.5px) — la normal mide 25 y no cabe;
- una acción va `size="rotulo"`, el único tamaño de `Button` que **no** crece
  con `--tap-min`: se ve de 20px y se toca como uno de 44 por `.blanco-tactil`,
  que es la misma salida que ya usaban el aspa del select y la flecha del
  carril;
- el espaciado lo trae el canónico. Un rótulo dentro de un padre con `gap`
  **no** agrega el suyo.

**Y el alto fijo solo no alcanza.** Con el alto puesto y nada más, un aviso
largo parte en dos líneas y se sale del rótulo *hacia abajo, encima del campo*:
medido, caja 20 y contenido 27. Eso cambia un desalineado por un encimado, que
es peor porque tapa un dato. Por eso el canónico además no deja envolver ni
salirse, y el que cede es el TEXTO del rótulo —con puntos suspensivos— y no el
aviso: el nombre del campo se adivina por su lugar, el aviso no.

Lo vigila la categoría `rotulo-de-campo-a-mano` de `npm run gate:design`, con
**113 de deuda declarada en 30 archivos** el día que nació. El alta de personal
está en cero.

#### El gate estaba ciego sobre dos tercios de ese archivo

La categoría nueva daba **cero** sobre el formulario más grande del repo, y era
mentira. Su limpiador de comentarios era
`text.replace(/\/\*[\s\S]*?\*\//g, …)`, y en la línea 1754 hay
`accept="image/*"`: ese `/*` está **dentro de una cadena**, el regex lo tomó
como apertura de comentario y blanqueó **154,304 caracteres** — el archivo
entero de ahí para abajo.

O sea que `input-sin-nombre`, `input-a-mano`, `tarjeta-a-mano`,
`select-con-envoltorio` y `relleno-sin-solid` venían dando cero sobre ese
archivo. Al arreglarlo aparecieron **15 hallazgos reales**, todos corregidos:
cinco campos escritos a mano y sin nombre accesible, cuatro selects dentro de un
envoltorio de 38px, y un relleno sólido sin su token.

El reemplazo (`scripts/lib/blanquearComentarios.mjs`) no es un regex sino un
recorrido que sabe cuándo está dentro de una cadena, y blanquea conservando los
saltos de línea para que los números que reporta el gate sigan siendo los del
archivo. Lo usa también la categoría `import`, que tenía el defecto hermano:
blanqueaba `/* */` pero no `//`, así que una mención en prosa —«las iniciales se
fueron con el `<LiquidAvatar>` suelto»— se contaba como un uso sin importar, o
sea un error inventado sobre código correcto.

**La lección es la de siempre y esta vez le tocó al instrumento:** un gate que
falla avisa; uno que se quedó ciego da verde, y el verde es indistinguible del
verde de verdad. Antes de creerle un cero a una categoría nueva, fabricarle la
regresión que debería cazar — que es como se encontró esto.

### 25.10-quater Canónico quiere decir en todas partes (2026-08-27)

Cerrado el alta de personal, el usuario preguntó lo obvio: *«¿quedó así para
todos lados?»*. No. Y al medirlo salió el mapa completo.

| | antes | ahora |
|---|---:|---:|
| rótulos de campo escritos a mano | **171** en 30 archivos | **0** |
| recuadros de campo a mano | 24 | 1 (una caja de sólo lectura, no es un campo) |
| envoltorios del campo de fecha | 30 formas, **cinco alturas** (32/36/40/42/token) | 0 |

**El campo de fecha no tenía altura propia.** `LiquidDatePicker` salía con
`w-full h-full`, o sea que la tomaba de quien lo envolviera — y sus **61
llamadores** lo envolvieron de 30 maneras distintas. Ahora dibuja su caja, mide
lo mismo que `PortalInput`, y el tinte de error o de aviso entra por prop
(`hasError`, `tono`): desde afuera no hay forma de acertarle al radio ni al alto
sin repetirlos.

**`compact` significaba dos alturas.** `PortalInput` compacto medía 32px y
`LiquidSelect` compacto medía 40, porque no tenía mínimo propio y caía en el de
un campo normal. Con 125 controles compactos en el portal, el que estaba fuera
de fila era el select. Hoy los tres miden 32, y el piso del dedo sale de
`.blanco-tactil` — el área crece a 44 sin agrandar lo pintado, que es lo que
§25.6 documenta y lo que ese mismo archivo ya hacía con su aspa.

Medido después, con Chromium sobre el CSS compilado: campo, select y fecha en
**40px** y en el mismo píxel; compactos, **32** los tres.

#### El cuarto control, y la mitad que le faltaba a `compact`

`RangeDatePicker` no comparte código con los otros tres y tenía **tres alturas
propias**: 48px el de un rango suelto, 40 el de varios rangos y 44 el compacto.
Los 48 son los que se veían — sus tres usos en formulario lo ponen al lado de
campos de 40. Hoy los tres van al alto canónico; lo que `compact` conserva es la
FORMA de píldora, que es lo suyo dentro de una barra de filtros, no una altura
aparte.

Y alinear `compact` destapó su otra mitad: **`bare` queda fuera de la
reducción.** `bare` significa «la caja la dibuja otro» —la píldora de
`FilterBar`, la barra de paginación, `TimePicker12`—, así que ahí el alto es
asunto del anfitrión y lo nuestro es sólo el blanco donde se hace clic. Medido:
de los **46 `bare`** del portal, **28 viven en una píldora de filtro**.
Encogerlos a 32 no movía un píxel en pantalla —la píldora mide 52 fijos y el
control va centrado y transparente— pero les recortaba el blanco de 40 a 32 **sin
que se viera**. Ése es justo el tipo de daño que un barrido de consistencia puede
hacer creyendo que ordena.

`PeriodPicker` y `PeriodStepper` se miraron y no entran: no tienen campo cerrado
propio. `SegmentedControl` tampoco — es un riel con opciones y su altura está en
§25.10.

#### Dos veces se equivocó el barrido, no el portal

- **El detector pedía `tracking-widest`.** Con eso encontró 114 rótulos. Un diff
  mostró rótulos idénticos escritos con `tracking-[0.15em]`, con `tracking-wide`
  o sin tracking: **57 más en 17 archivos**, invisibles para el barrido *y para
  el gate*. Un rótulo es rótulo por su **tamaño y su peso**, no por cómo le
  espaciaron las letras. Se ensanchó la regla y se le fabricó la forma vieja
  para confirmar que ahora la caza.
- **`justify-between` separó un icono de su texto.** El canónico manda a los
  extremos lo que va a cada lado; un icono y su rótulo son UNA cosa. En 27
  rótulos el icono se fue a la izquierda y el texto a la derecha. Van agrupados
  en el span de la izquierda, que además es el que el canónico recorta cuando no
  entra.

Los dos los encontró mirar el diff, no el gate en verde.

### 25.11 Toda capa que se monta sobre la pantalla es un diálogo

Una capa que cubre la pantalla, atrapa el clic de afuera y contiene controles
**es un diálogo**, aunque se llame hoja, panel o popover. Se monta con
`ModalShell`, que da `role="dialog"`, `aria-modal`, Escape, bloqueo de scroll
con restauración y la animación de entrada/salida.

`ModalShell` tiene tres anclajes: `center` (default), `top` (paletas de
comandos) y `bottom` (hojas táctiles, que entran deslizando y llegan a los
bordes).

**Encontrado al auditar con los modales abiertos (2026-07-29):** cinco capas se
montaban a mano y ninguna era un diálogo — `MenuSearchModal`, `PromptModal`,
`PhotoEditorModal`, la hoja de filtros de `ViewTabBar` (en 28 vistas) y la hoja
de fecha de `LiquidDatePicker`. Y la peor: **`ConfirmModal`**, el diálogo que
pregunta antes de borrar, que además **no cerraba con Escape** — el único sitio
del portal donde no poder cancelar con el teclado tiene consecuencias.

**No cuenta como diálogo** un `LiquidSelect` abierto: eso es un `listbox`, y su
rol correcto es `role="listbox"` con `role="option"` en los ítems.

---
