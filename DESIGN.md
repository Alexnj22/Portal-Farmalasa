# Portal Farmalasa — Design System

> Fuente de verdad de los patrones visuales y de interacción del portal.
> Stack: React 19 + Vite 7 + Tailwind CSS v4 (`@tailwindcss/postcss`, configuración en CSS) + material Liquid Glass propio.
> Plataforma: web (escritorio y teléfono) + iOS/Android nativo vía Capacitor 8.
> El historial de cambios vive en `CHANGELOG.md`; las crónicas de por qué cada regla es como es, en `docs/design/historia/`.

## Cómo usar este doc

1. **Antes de escribir cualquier control, mira el índice de canónicos de abajo.**
   Si el control existe, se usa; no se reescribe. Cuando se midió el proyecto
   había 940 botones, 316 chips y 3 switches escritos a mano — casi siempre
   porque quien los escribió no sabía que el canónico existía.
2. **Todo valor visual nace en §3 (Tokens).** Un color, un radio o un tamaño que
   no salga de un token es deuda, aunque hoy se vea bien.
3. Si el control **no** existe, se propone el canónico. No se resuelve inline
   «por esta vez»: así aparecieron los 316 chips.
4. Toda UI nueva pasa **§31 Anti-Patterns** y `npm run gate:design`. El mapa
   completo de categorías del gate, con la regla y la sección de cada una, está
   en **§35**.

### Índice de canónicos

| control | componente | sección |
|---|---|---|
| botón | `Button` | §15.2 |
| una de **hasta 3** opciones | `SegmentedControl` | §15.3 |
| una de **más de 3** opciones | `LiquidSelect` | §15.3 |
| encendido/apagado | `Switch` | §15.4 |
| casilla | `Checkbox` | §15.4 |
| acción en la barra de vista | `TabBarAction` (la dibuja `FilterBar`) | §15.5 |
| aviso inline | `Notice` | §15.6 |
| fila de lista | `ListRow` | §15.7 |
| adjuntar archivo | `FileField` | §15.9 |
| nota al pasar el puntero | `LiquidTooltip` | §15.10 |
| campo de formulario | `PortalInput` | §15.11 · §29.1 |
| campo de varias líneas | `PortalTextarea` | §29.2 |
| desplegable | `LiquidSelect` | §14 · §15.13 |
| desplegable de lista LARGA en táctil | `SelectorTactil` (lo abre `LiquidSelect` solo) | §14.1 |
| fecha / rango | `LiquidDatePicker` · `RangeDatePicker` | §15.13 · §25.10-quater |
| foto de una persona | `AvatarConEstado` (nunca `LiquidAvatar` suelto) | §5.4 |
| «esta tarjeta abre un detalle» | `OjoDeTarjeta` | §5.3 |
| etiqueta de estado | `Badge` | §16.1 |
| barra de vista (pestañas, buscador) | `ViewTabBar` | §14 · §24 |
| barra de filtros de la vista | `FilterBar` | §17 |
| controles de la vista en táctil | lo hace `FilterBar` solo — `BarraFlotante` no se usa a mano | §17.3 |
| correr el período (‹ etiqueta ›) | `PeriodStepper` | §17.1 |
| paginación de tabla | `TablePagination` | §17.2 |
| vacío · esqueleto · cargando | `StateViews` | §18 |
| modal | `LiquidModal` sobre `ModalShell` | §14 |

**Lo que este documento verifica de sí mismo:** `npm run gate:doc` pasa todos
los bloques de código de acá por el mismo gate que el código, exige que cada
«§N» citado exista como encabezado y que toda categoría del gate figure en §35.
Un documento no se desactualiza de golpe: se desactualiza porque nada lo revisa.

## 1. Philosophy — Liquid Glass

El portal usa un solo lenguaje, **Liquid Glass**: superficies translúcidas
esmeriladas, fondo ambiental con degradados radiales, micro-bordes claros y
sombras de varias capas. Toda superficie flota sobre el fondo en vez de estar
pintada sobre un lienzo plano. En los temas Solid se quita el desenfoque, pero
la misma arquitectura de tokens lo gobierna todo (§2.1).

**Reglas que no se doblan:**
- Ningún indicador de color en el borde izquierdo de filas, tarjetas o listas (gate `left-border`).
- El texto sobre vidrio sale de la tinta semántica: `text-content` / `text-content-2` / `text-content-3`. Nunca una paleta gris cruda (gate `color`).
- El hover sólo existe con puntero: todo CSS de hover vive dentro de `@media (hover: hover)`.
- Una sola librería de íconos, Lucide React, con el **trazo según el tamaño** (§12): la escala es `1 · 1.5 · 2 · 2.5 · 3` (gate `icono-stroke`) — los íconos chicos llevan trazo más grueso que los grandes.
- Ningún `<select>` nativo: `LiquidSelect` siempre (gate `native`).
- Toda mutación que dispara el usuario llama a `appendAuditLog` (de `staffStore`).

## 2. Themes

Cuatro temas, controlados por `data-theme` en `<html>`. `liquid` es el único sin
atributo (cae a los valores de `:root`).

| tema | `data-theme` | descripción |
|---|---|---|
| `liquid` | *(ninguno)* | Liquid Glass claro |
| `dark` | `dark` | Liquid Glass oscuro |
| `solid` | `solid` | Solid claro — sin desenfoque — **default para usuarios nuevos** |
| `solid-dark` | `solid-dark` | Solid oscuro — sin desenfoque |

**Default:** `resolveInitialTheme()` usa la preferencia guardada; si no hay,
`solid` o `solid-dark` según `prefers-color-scheme` (resuelto una sola vez al
cargar). Liquid Glass sigue siendo seleccionable y no se retira (decisión T7.5,
`AUDITORIA-TEMA-2026-07.md` §11).

**ThemeContext** (`src/plataforma/ThemeContext.jsx`) guarda la elección en
`localStorage` (`portal-theme`) y expone
`{ theme, setTheme, cycleTheme, isDark, isSolid, isLiquid, themes }`.

**ThemeToggle** (`src/components/common/ThemeToggle.jsx`) presenta los cuatro
temas como **dos ejes**: Estilo (Liquid Glass | Solid) y Modo (Claro | Oscuro),
cada uno un `data-surface="tab-track"` de dos opciones. El disparador abre un
popover por portal (`data-surface="dropdown"`, mismo posicionamiento que
`LiquidSelect`, §14); un toque aplica `setTheme(combine(style, mode))` al
instante. Variantes: `'sidebar'` (fila completa en el pie del menú) y
`'compact'` (botón cuadrado en el riel). Íconos: Layers · Monitor para Estilo;
Sun · Moon para Modo.

### 2.1 Qué separa a Liquid Glass de Solid — el contrato

No son dos paletas del mismo diseño: son **dos materiales**, y la diferencia se
ve en cinco ejes.

| eje | Liquid Glass | Solid | dónde vive |
|---|---|---|---|
| transparencia | superficies translúcidas + `backdrop-filter` | opaco, `backdrop-filter: none` | `--surface-*`, `--backdrop-*` |
| forma | píldora y tarjeta muy redondeada | rectángulo tenso | `--btn-radius`, `--card-radius` — valores en §8 |
| sombra | elevación **+ brillo interior** | sólo elevación, más corta | `--shadow-glass-*`, `--shadow-shine*` |
| color de acento | halo difuso | **aro nítido** de 1–3px | `--shadow-glow-*` |
| hover | **se levanta** | el control no se mueve; la superficie cede `-1px` | `--lift-hover`, `--lift-card` (§5) |
| movimiento | entradas, deriva ambiental | apagado | reglas `[data-theme="solid"] .animate-*` |

**Para escribir código nuevo:**

- Nunca clavar el lift: `hover:translate-y-[var(--lift-hover)]` en un control,
  `var(--lift-card)` en una superficie (gate `lift-clavado`).
- Nunca clavar un radio: `rounded-btn` / `rounded-card` cambian solos con el tema.
- `transition-all` en Solid se acota por regla de tema a color/fondo/borde/
  opacidad. Para animar geometría, nombrar las propiedades.
- Un `shadow-[var(--shadow-glow-*)]` da halo en vidrio y aro en sólido sin que el
  componente sepa en qué tema está. Ése es el punto.

Por qué: ver `docs/design/historia/02-03-temas-y-tokens.md`.

## 3. Design Tokens (CSS Custom Properties)

Todos los tokens viven en `src/index.css`: `:root` (Liquid claro) y los bloques
`[data-theme="dark"]`, `[data-theme="solid"]` y `[data-theme="solid-dark"]`.
**Los valores están allí y sólo allí**; esta sección dice qué familias existen y
cómo se consumen. Ningún componente escribe a mano un `backdrop-filter` ni un
color de superficie.

| familia | tokens | consumo |
|---|---|---|
| fondo de página | `--bg-page` (degradado en Liquid, liso en Solid) | `html, body, #root` |
| tinta | `--text-primary` · `--text-secondary` · `--text-tertiary` | `text-content` · `text-content-2` · `text-content-3` |
| desenfoque | `--backdrop-card` · `--backdrop-header` · `--backdrop-modal` · `--backdrop-dropdown` (`none` en Solid) | vía `data-surface` (§5) |
| superficie | `--surface-card(-hover)` · `--surface-header` · `--surface-modal` · `--surface-input` · `--surface-dropdown` · `--surface-tab-track` | `bg-surface-*` o `data-surface` |
| borde | `--border-card` · `--border-header` · `--border-modal` · `--border-input` · `--border-tab` · `--border-muted` | `border-border-*` |
| radio | `--card-radius` · `--card-radius-anidada` · `--modal-radius` · `--header-radius` · `--btn-radius` · `--input-radius` · `--badge-radius` | `rounded-card`, `rounded-btn`… — valores por tema en §8 |
| sombra estructural | `--card-shadow(-hover)` · `--header-shadow` · `--modal-shadow` · `--dropdown-shadow` · `--btn-brand-shadow(-hover)` | `shadow-card`, `shadow-modal`… |
| severidad y marca | `--brand` · `--success` · `--warning` · `--danger` + `-text`, `-solid`, `-hover`, `-pressed` | §6 |
| categoría | `--chart-1/3/4/6/9` + `-text` | §6.0 |
| foco, velo, divisor | `--focus-ring-color` · `--scrim` · `--divider` | `:focus-visible` global · `bg-scrim` · `bg-divider` |
| semáforos de dominio | `--stock-*` (7 estados, `STAT_CFGS` en `src/views/productos/tabminmax/constants.js`) · `--txvol-*` (4 estados de tx/hora, `DashboardView`) | `text-stock-ok`, `text-txvol-critica`… |

El valor de `--text-tertiary` en cada tema está calibrado para AA normal (4.5:1)
— ver §3.2.

### Escala canónica de sombras

Ninguna vista escribe `shadow-[0_Npx_…]` a mano (gate `shadow-literal`). La
escala, consumida como valor arbitrario —`className="shadow-[var(--shadow-elevation-md)]"`—:

| grupo | tokens | uso |
|---|---|---|
| elevación neutra | `--shadow-elevation-xs/sm/md/lg/xl` | fila/chip → tarjeta → panel flotante → modal |
| vidrio (realce interior + proyección) | `--shadow-glass-1…5` (alias `-sm/-md/-lg`), `--shadow-shine`, `--shadow-shine-lg` | superficies de vidrio; en Liquid oscuro y Solid pierden el realce blanco |
| acento | `--shadow-glow-{brand,success,warning,danger}` y `--shadow-glow-chart-N`, con escalones `-sm/-md/-lg`; `--shadow-ring-brand`; `--shadow-glow-logo-*` | halo en vidrio, aro en sólido |

Los tokens deliberadamente NO usan el namespace `--shadow-*` de `@theme` para
cosas nuevas: ese lo ocupa Tailwind para `shadow-sm/md/lg`. Quedan unas pocas
sombras literales de varias capas (≈8 el 2026-11-06), cada una con su motivo.

### 3.0 Paleta de datos

La paleta categórica es de **cinco tonos** (`chart-1`, `chart-3`, `chart-4`,
`chart-6`, `chart-9`); `chart-2/5/7/8` están retirados y son alias (gate
`chart-retirado`). La regla completa, con los tres niveles (marca, severidad,
categoría), está en **§6.0**.

**La regla de 3 baldes** decide qué color lleva algo nuevo:
- **A — severidad real** (¿bueno/malo/atención?) → `success` / `warning` / `danger` (y `Badge`).
- **B — categoría genuina** (distinguir tipos sin jerarquía) → los cinco `chart-N`, asignados por posición y **el mismo mapeo** en todos los archivos que comparten el enum.
- **C — decorativo sin valor informativo** → sin color: `bg-surface-card-hover` + `text-content-2`.

**Excepciones documentadas.** Las que existen (mapas, Recharts/canvas, plantillas
de impresión, marcas de terceros, kiosco/cámara, vistas de QA) viven en
`EXCEPTIONS` de `scripts/design-gate.mjs`, **cada una con su motivo escrito**.
Dos reglas sobre ellas:
- Una excepción es por tecnología, no exención: si el hex duplica un valor que
  YA tiene token, se consume el token como string (`'var(--txvol-pico)'`).
- Una excepción nueva va al script **y** se explica (en el comentario de la
  excepción). Nunca sólo en uno de los dos lugares.

El sidebar **no** es una superficie fija-oscura: sigue al tema con sus propios
tokens `--sidebar-*` (§25.4). La lista histórica por archivo está en
`docs/design/historia/02-03-temas-y-tokens.md`.

### Gate mecánico permanente — `npm run gate:design`

```bash
npm run gate:design
```

Debe dar 0 hallazgos sin excepción. Las excepciones están *dentro* del script,
así que un `0` significa «nada sin revisar», no «nada que el regex de turno
supiera buscar». **Antes de cerrar trabajo de tema o estandarización visual se
corre este comando.** Si aparece un hallazgo: se corrige, o va a `EXCEPTIONS`
con su motivo. Todas las categorías, con su regla y su sección, en **§35**.

Dos que no se deducen de mirar clases:
- **`prop-inexistente`** compara los props que recibe cada componente de
  `components/common/` contra los que su firma destructura. React no valida
  props: uno mal nombrado se ignora en silencio (`EmptyState` con `message` en
  vez de `title` pintaba el ícono y cero texto). Un componente con `...rest`
  queda fuera.
- **`monto-nativo`** (§15.11.1) y **`segmentado-a-mano`** (§15.3).

### 3.1 Puente Tailwind v4 — `@theme inline`

Los tokens se alían a namespaces de Tailwind en un bloque `@theme inline`
(`index.css`, después de los cuatro bloques de tema), y eso los vuelve
utilidades: `bg-surface-card`, `text-content`/`-2`/`-3`, `border-border-card`,
`rounded-card`/`rounded-modal`/`rounded-badge`, `shadow-card`/`shadow-modal`,
`bg-brand`, `text-danger`, `bg-scrim`, `bg-divider`, `bg-chart-N` (los cinco de
§6.0), `text-stock-ok`, `text-txvol-critica`… — con opacidad (`/50`), `hover:` y
breakpoints.

- **`inline` es obligatorio**: el valor se re-evalúa en cada `[data-theme]` en
  vez de resolverse una vez en el build.
- **El texto se llama `--color-content*`** y no `--color-text-*`: en Tailwind v4
  `--text-*` genera tamaños de fuente.
- **Radios y sombras tienen nombre primitivo** (`--card-radius`, no
  `--radius-card`): `--radius-*` y `--shadow-*` son los namespaces de Tailwind, y
  `--radius-card: var(--radius-card)` sería circular. Sólo el alias dentro de
  `@theme inline` usa el nombre limpio.
- **Z-index no tiene namespace `@theme`**: se resuelve con `@utility` (§9).

### 3.2 Contrato de tema ampliado (Fase T2)

- **Solid refinado**: `--bg-page` con tinte frío hacia la marca (`#f4f6fb` en
  claro); los radios de Solid están en §8.
- **Rampas de estado**: `--brand-hover/-pressed`, `--success/-warning/-danger-hover/-pressed`,
  `--state-selected-overlay`, `--state-disabled-opacity`.
- **Escala de elevación** `--elevation-0..3`: nombra `--card-shadow` /
  `--modal-shadow` como niveles 1/2 y agrega el 3 (flotantes sobre modales).
- **Contraste AA** (`scripts/tema/contrast-check.mjs`): `content-3` se mide con
  el umbral de **texto normal (4.5:1)**, no el de texto grande, porque se usa en
  rótulos de 9–11px. Los cuatro temas cumplen AA normal para las tres tintas.
  Un token de material se verifica sobre el **píxel pintado**, no sobre un fondo
  supuesto (§5.bis.1).
- **Orbes ambientales apagados** en Solid (`display:none` sobre
  `.animate-ambient-drift*`): cero composición GPU constante.
- **Densidad adaptativa**: ver §32.

Por qué: ver `docs/design/historia/02-03-temas-y-tokens.md`.

## 4. Ambient Background

El degradado de página se aplica a `html, body, #root` con `background: var(--bg-page)`.

Encima, `AppLayout` (`src/components/layout/AppLayout.jsx`) dibuja **cinco orbes**
fijos (`position: fixed`, `pointer-events-none`, `z-index: 1`), cada uno un
`rounded-full` con degradado radial, desenfoque y una de las dos animaciones
`animate-ambient-drift` / `animate-ambient-drift-reverse` (períodos de 11 a 18s,
escalonados). **Los colores son los del logo**: el verde (`rgb(142,195,15)`) y
el magenta (`rgb(152,29,151)`, `--logo-magenta`), alternados. El menú lateral
lleva tres orbes propios, más chicos, con los mismos dos colores. El login ya
no tiene fondo ambiental propio (`AmbientBG` se retiró el 2026-08-06).

En Solid los orbes no se pintan (§3.2).

## 5. Surface System

El atributo `[data-surface]` es la forma canónica de aplicar el material. El CSS
de `src/index.css` selecciona por él y aplica los tokens. Ningún componente
escribe a mano el desenfoque ni el color de las superficies estructurales
(gates `vidrio-a-mano`, `material-a-mano`, `tarjeta-a-mano`).

| valor | dónde | tokens |
|---|---|---|
| `card` | contenedores, envoltorio de `DataTable`, tarjetas de widget | `--surface-card`, `--backdrop-card`, `--border-card`, `--card-shadow`, `--card-radius` |
| `page-header` | encabezado fijo de `GlassViewLayout` en escritorio | `--surface-header`, `--backdrop-header`, `--border-header`, `--header-shadow`, `--header-radius` |
| `modal` | el panel de `ModalShell` | `--surface-modal`, `--backdrop-modal`, `--border-modal`, `--modal-shadow`, `--modal-radius` |
| `input` | disparador de `LiquidSelect` y campos | `--surface-input`, `--border-input`, `--input-radius`, `--backdrop-card`; sombra interior de campo hundido |
| `dropdown` | el menú de `LiquidSelect` y popovers anclados | `--surface-dropdown`, `--border-card`, `--dropdown-shadow`, `--card-radius`, `--backdrop-dropdown` |
| `tab-track` | carril de `ViewTabBar` y de pestañas | `--surface-tab-track`, `--border-tab`, `--tab-track-radius` |
| `tooltip` | `LiquidTooltip` y globos | material de globo flotante |
| `sheet` | la hoja de la barra flotante de `FilterBar` en táctil | como `dropdown`, sin filo (`::after`) |
| `sidebar` | el panel del menú lateral (`AppLayout`) | **sigue al tema**: `--sidebar-tint` / `--sidebar-ink` / `--sidebar-fill` / `--sidebar-pop-fill` / `--sidebar-rim` (§25.4, §25.5) |
| `sidebar-popover` | menú de Ajustes y flyouts del menú lateral | el tinte del sidebar con más relleno (flota sobre el contenido) |

**Hover de la tarjeta** (sólo con puntero):

```css
[data-surface="card"]:hover {
  transform: translateY(var(--lift-card));
  box-shadow: var(--card-shadow-hover);
}
/* Se levanta la que APUNTAS, no la que la contiene */
[data-surface="card"]:has([data-surface="card"]:hover) { transform: none; box-shadow: var(--card-shadow); }
```

- **El cuerpo de vista no es una superficie.** `GlassViewLayout` no emite
  `data-surface="card"` en su cuerpo (escritorio y teléfono), así que las
  tarjetas de una vista están en primer nivel y llevan su material completo.
  Una tarjeta dentro de otra sí existe, y se aplana (§5.bis).
- **Se levanta la tarjeta apuntada; sus contenedores se quedan quietos** — por
  eso el `:has()`. Donde `:has()` no existe, vuelve el lift acumulado: degrada,
  no rompe.
- **Dos tokens de lift, y nunca un número clavado:**

| token | quién lo usa | liquid / dark | solid / solid-dark |
|---|---|---|---|
| `--lift-card` | `data-surface="card"` | `-3px` | `-1px` |
| `--lift-hover` | `Button`, `TablePagination`, `data-surface="page-header"` | `-1px` | `0px` |

- **Nunca un `hover:-translate-y-*` en una tarjeta**: compila a la propiedad
  `translate`, distinta de `transform`, así que **se suma** al canónico y salta
  sin animar. Lo vigila `lift-clavado`, bloqueante en cero.
- **Histéresis al salir**: la transición espera `--card-espera-salida` (140ms)
  sólo al salir, para que el des-hover que produce el propio lift no haga
  parpadear la sombra. Queda una banda muerta de ~4px en el borde inferior; se
  conoce y no se cerró (exigiría `position: relative` en ~175 tarjetas).

Por qué: ver `docs/design/historia/04-05-superficies.md`.

### 5.0.1 `bg-surface-card` es el COLOR, no la tarjeta

Una superficie va por su `data-surface`, nunca por sus clases de color.
`rounded-2xl border border-border-card bg-surface-card` copia el color del
canónico y deja afuera el desenfoque, el lente, el destello al apuntar, el gel
al presionar y el radio del tema — en oscuro no se nota, en claro la tarjeta
desaparece contra la página. `bg-surface-card` está bien para lo que NO es una
tarjeta: el relleno de un envoltorio de campo, un chip.

Lo vigila **`tarjeta-a-mano`** (por ratchet: baseline en
`scripts/design-gate-baseline.json`, sólo baja). Lo que descarta a un envoltorio
de campo legítimo es su **tamaño fijo**, no el padding; el detector lee el
`className` completo con `classNameDeTag()` (también lo escrito dentro de
`${cond ? … : …}`).

> **Cuando un detector no encuentra nada, antes de creerle hay que contar a mano
> una vez.** Un gate verde prueba su detector, no la ausencia del defecto.

### 5.1 `data-tono` — la tarjeta marcada por su estado

`index.css` va sin `@layer`, así que `[data-surface="card"]` le gana a cualquier
utilidad de Tailwind: un `border-warning/40` o un `ring-2` sobre la tarjeta no
hacen nada. El estado se dice con un atributo, que sube la especificidad solo:

```jsx
<div data-surface="card" data-tono={editando ? 'warning' : undefined}>
```

| tono | cuándo |
|---|---|
| `warning` | la tarjeta que estás editando |
| `danger` | con error de validación, o urgente |
| `success` | confirmada / completada |
| `brand` | seleccionada |
| `chart-3` | la tarjeta es de una **categoría** (de qué circuito es), no de una severidad. Hay uno solo a propósito: el segundo se agrega con el segundo caso real |
| `dashed` | la tarjeta **vacía** que invita a llenarla (documento faltante, cargo sin asignar). Es ausencia, no severidad: sin color |

**Cuando el tinte es del RELLENO y no del borde, no se emite `data-surface`**
(misma razón de especificidad; es el idioma de `PortalInput` con `tono`):

```jsx
<div data-surface={d.isToday ? undefined : 'card'}
     className={d.isToday ? 'bg-brand/5 border border-brand/30 rounded-card' : ''}>
```

**No anidar tarjetas para marcar una franja.** Una franja DENTRO de una tarjeta
es `bg-surface-card-hover` + borde, no otra `data-surface="card"` (con tono
quedan dos anillos concéntricos).

### 5.2 Capa flotante — un menú abierto deja quieto lo que hay atrás

**Todo flotante ANCLADO a un disparador llama `useCapaFlotante(abierto)`**
(`src/plataforma/capaFlotante.js`):

```jsx
import useCapaFlotante from '@plataforma/capaFlotante';

const [isOpen, setIsOpen] = useState(false);
useCapaFlotante(isOpen);
```

(Desde `src/components/common/` se importa relativo:
`../../plataforma/capaFlotante`.)

Pone `data-capa-flotante` sobre **`#root`**. Los portales cuelgan de `body` —son
hermanos de `#root`—, así que el menú conserva sus hovers y **el resto de la app
no responde al puntero**: ni se mueve ni cambia de sombra. Es un contador, no un
booleano (puede haber un select abierto dentro de un modal).

| | menú cerrado | menú abierto |
|---|---|---|
| `transform` | `translateY(var(--lift-card))` | sin desplazamiento |
| `box-shadow` | `var(--card-shadow-hover)` | `var(--card-shadow)` |

- Se implementa **redefiniendo dos custom properties**
  (`--card-lift-activo` / `--card-sombra-activa`), no con un `box-shadow` más
  específico: los `data-tono` declaran su propia sombra y perderían el aro.
- **Se apagan los efectos, NO el puntero.** Un velo `fixed inset-0` resolvería el
  hover pero rompe el scroll (la app scrollea un contenedor interno, no el
  `body`).
- **No lo necesitan**: quien use `ModalShell` (su velo ya tapa el fondo) y quien
  traiga su propio velo `fixed inset-0` — `PeriodPicker`, `RangeDatePicker`,
  `FilterBar`, `InlineDayEditor`.
- **Los tooltips quedan afuera a propósito** (aparecen *porque* hay hover); van a
  `EXCEPTIONS` con su motivo, por archivo y no auto-detectados.

Lo vigila **`capa-flotante`**, bloqueante en cero. La firma que busca:
`createPortal` + `document.body` + `getBoundingClientRect`.

Por qué: ver `docs/design/historia/04-05-superficies.md`.

### 5.3 `OjoDeTarjeta` — la tarjeta que se puede abrir lo DICE

En el teléfono no hay cursor ni lift: la única manera de saber si una tarjeta
abre algo es tocarla. `src/components/common/OjoDeTarjeta.jsx` es esa señal, y
va siempre **arriba a la derecha**:

```jsx
<button data-surface="card" onClick={() => abrir(x)} className="group text-left">
    <span className="text-content">{x.nombre}</span>
    <OjoDeTarjeta className="self-start mt-1" />
</button>
```

El `group` enciende el realce al apuntar; sin él el ojo se queda en su gris.

**El ojo promete «aquí hay más para VER», y nada más:**

| la tarjeta… | ¿ojo? | por qué |
|---|---|---|
| abre el detalle de lo que muestra | **sí** | es lo que el ojo dice |
| ELIGE una opción | no | el acuse es la marca de selección |
| FILTRA la vista (baldosas de métrica) | no | recorta la lista, no abre nada |
| PLIEGA un grupo | no | lo dice el chevron |
| ya tiene su botón «ver» o su chevron de entrar | no | dos afordancias se leen como dos acciones |

- `Ficha` de `DataTable` lo pone sola, desde `alTocar` (la misma condición que la
  hace `<button>`): señal y comportamiento salen del mismo dato.
- `ListRow surface="card"` **no** lo pone solo (también se usa para elegir): va
  explícito en `trailing`.
- Un chevron de expandir no sobrevive al modo ficha: va con `hidden lg:inline`.
- **No lo vigila el gate, a propósito**: «abre» o «elige» está en el handler, no
  en las clases (mismo motivo que `clickable()`, §25.8).
- **Una insignia sobre una foto va DESPUÉS de la foto, sin z-index.**
  `LiquidAvatar` es `isolate`: su `z-base` interno se queda adentro. Si hace falta
  un `z-` para que algo se vea encima de una foto, el problema es otro.

Por qué: ver `docs/design/historia/04-05-superficies.md`.

### 5.4 `AvatarConEstado` — la foto de una persona

**La foto de una persona se pinta con `AvatarConEstado`**
(`src/components/common/AvatarConEstado.jsx`). Nunca con `LiquidAvatar` suelto
—es la primitiva: WEBP, iniciales de respaldo, reintento— y nunca con un `<img>`
a mano. Regla del usuario: *todo lugar que muestre quién lo hizo lleva foto, y
por lo tanto aro.*

```jsx
<AvatarConEstado emp={emp} px={48} />
<AvatarConEstado emp={{ id: fila.registrado_por, name: fila.registrado_por_nombre }} px={20} />
```

- **Siempre redonda.** No hay prop `radio`. Para las superficies bespoke (menú
  lateral, kiosco, §25.4) existen `marco` (su clase de borde) y la variable
  `--av-fondo` (el fondo contra el que recorta el filo de las marcas).
- **`px` es un número de la escala, obligatorio**:
  `TAMANOS_DE_AVATAR = [20, 28, 36, 48, 64, 104]` (`src/utils/avatar.js`). Ningún
  otro (gate `avatar-fuera-de-escala`, cero absoluto). La app lleva un tamaño
  fuera de escala al más cercano (`tamanoDeAvatar`).

| px | papel | qué lleva |
|---|---|---|
| 20 | **firma** — al lado de un nombre escrito | foto + aro de 1.5px pegado; sin marcas |
| 28 | persona | aro de 2px separado de la foto por un filo de 2px del color del fondo (alcance 4px); torta y «!» |
| 36 | persona | lo anterior + **chip de estado** |
| 48 · 64 | persona | aro de alcance 4.5px + chip + **medalla de antigüedad** |
| 104 | **retrato** — sólo la cabecera del perfil de esa persona | todo lo anterior |

**Diseño «cuatro esquinas»** — cada marca tiene su esquina fija:

| esquina | marca | para quién |
|---|---|---|
| arriba-izquierda | torta blanca (hoy cumple años) | para todos |
| arriba-derecha | «!» — expediente incompleto, con globo de lo que falta | sólo quien puede editar personal (`staff_list` o `staff_detail` `can_edit`) |
| abajo-derecha | chip de estado: el ícono (vacaciones, incapacidad, permiso, apoyo, baja…) o la cuenta regresiva «−N» antes de que empiece | todos |
| abajo-izquierda | medalla de antigüedad: bronce (1–5 años) · plata (6–10) · oro (11–15) · platino (16+) | todos |

- **El aro va POR FUERA** (con `box-shadow`): un `ring-inset` queda debajo de la
  foto y es invisible. Cuando hay estado, el aro reemplaza al `marco`.
- **El `title` lleva la frase completa** («En vacaciones · vuelve el 2 de
  septiembre») a cualquier tamaño: el dato nunca depende de distinguir un color.
- **Acepta cualquier forma de persona** (`normalizarPersona`,
  `src/utils/estadoDePersona.js`). **Lo único imprescindible es el `id`**: con él
  la foto y el estado se resuelven contra el store o contra la base. Una
  consulta que muestra a una persona devuelve su `id`, no sólo nombre y foto.
- **El estado no depende del RLS de quien mira**: sale de
  `get_estados_de_personas(uuid[])` (`SECURITY DEFINER`, en dos niveles: motivo
  preciso para quien puede leer los eventos, `AUSENTE` a secas para el resto),
  juntado por render en `src/data/estadosDePersonas.js`. `leerEstado` (puro, para
  `useSyncExternalStore`) y `pedirEstado` son dos funciones a propósito.
- **Geometría compartida con la app**: `geometriaDeAvatar(px)` en
  `src/utils/avatar.js` define aro, filo, chip y medalla, y la usan los dos:
  `AvatarConEstado` y la app (`apps/mobile/componentes/Avatar.js`). `aro` es
  hasta dónde llega el aro desde el borde de la foto, con el filo adentro: a
  28 px, 4 de alcance − 2 de filo = 2 px de trazo.
- **Envoltorios que ya lo usan** (preferirlos en su contexto):
  `PersonaConFoto` (`components/caja/`), `FirmaConFoto` (`components/cortes/`),
  `CaraPersona` (`views/solicitudes/PersonasSolicitud.jsx`), `FirmaDeAjuste`
  (`views/productos/TabMinMax.jsx`).

**Lo vigilan cuatro categorías, todas en cero y bloqueantes:**

| categoría | qué marca |
|---|---|
| `foto-sin-aro` | `<LiquidAvatar>` fuera del canónico, o un `<img>` cuyo `src` nombra la foto de alguien (`photo`, `photo_url`, `foto`, `avatar`, `webpSignedUrl(…)`); no la foto de un comprobante o evidencia |
| `foto-condicionada` | la vista decide por `photo` si pinta el avatar (`{emp.photo ? <AvatarConEstado/> : <Icono/>}`): se condiciona sobre la PERSONA |
| `foto-sin-identidad` | una persona armada a mano sin `id`: sin él no hay aro, y se ve igual que estar presente |
| `avatar-fuera-de-escala` | un `px` literal fuera de `TAMANOS_DE_AVATAR` |

Excepciones de `foto-sin-aro`, con su motivo en `EXCEPTIONS`:
`EmployeeFormModal` (muestra el blob local recién elegido, sin guardar),
`ClienteAvatar` del chat con clientes (un cliente no es del equipo) y
`FeedbackOverlay` del kiosco.

Por qué: ver `docs/design/historia/05-avatar.md`.

## 5.bis Material — lo que cambió en agosto 2026

> Detalle completo: `docs/planes-cerrados/PLAN-MATERIALES-2026-08-02.md`. Aquí va lo
> que hay que saber para **no romperlo** al escribir una vista.

### Cada elemento es una pieza de vidrio

El canto vivo —un destello que recorre el borde al apuntar— va en **toda
superficie canónica** y en **todo control dentro de una** (`button`, `a[href]`,
`[role="button"]`). No hay lista que mantener: sale del DOM.

- `[data-interactive]` marca las **superficies** clicables que no son controles
  (una tarjeta entera). Sale de `clickable()`, no se pone a mano.
- Corre **sólo la pieza más interna** bajo el cursor (guarda `:not(:has(…))`).
- **`data-filo="ceder"`: el botón que ES la cara de su tarjeta** (como el
  encabezado de una notificación de la campana). El botón no dibuja su filo y lo
  corre la tarjeta. Son dos reglas en `index.css`. Sólo donde el botón sea la
  cara de la superficie, nunca en un control que es una pieza.
- **El destello invierte su color por tema, y su flanco también**: en claro,
  destello oscuro (`--rim-glint`) sobre flanco blanco (`--rim-sombra`); en oscuro,
  al revés; en Solid ambos igualan a `--rim-base`. Se pinta por dentro del borde
  de 1px, así que la alfa del borde decide qué realce se puede leer.

### Las reglas que se rompen solas si no se conocen

| regla | por qué |
|---|---|
| **Un token de color se define en los CUATRO temas** | `:root` + Solid y nada en `dark` = Liquid oscuro hereda un valor calibrado en claro. Lo vigila `tema-incompleto`, pero **sólo mira tokens de COLOR**. |
| **Una decisión CERRADA no es una decisión CABLEADA** | antes de dar por hecha una sección, grepear que alguien consuma sus tokens. |
| **La dirección del realce la manda el MATERIAL de abajo, no el tema** | el panel del sidebar aclara porque flota; el hover aclara siempre; la anidada oscurece sobre blanco opaco (Solid) y **aclara sobre vidrio translúcido** (§5.bis.1). |
| **Una superficie dentro de otra se aplana** | pierde el `backdrop-filter`, toma `--anidada` y `--card-radius-anidada`. Vidrio sobre vidrio queda a 1.02:1: invisible. |
| **Una superficie `sticky` tiene que ocluir** | `--thead-bg`, nunca una opacidad de acento. |
| **Un ancestro con `transform` / `filter` / `opacity<1` APAGA el vidrio de todo lo que contiene** | la regla del *backdrop root* (§5.ter). |

### 5.bis.1 El escalón anidado sobre vidrio claro aclara

En Liquid claro `--anidada` **aclara** (en Solid claro oscurece): el contenedor
translúcido ya está oscurecido por el `saturate(200%)` del propio vidrio, y
bajarle otro escalón dejaba la tarjeta más oscura que la página. Tres reglas que
salen de ahí:

1. **Un token de material se verifica sobre el PÍXEL PINTADO**, no sobre su
   valor ni sobre un fondo supuesto.
2. **`backdrop-filter: saturate()` OSCURECE un fondo de color**: en un tema claro
   sobre un ambiente saturado, el vidrio no aclara, apaga.
3. **Los `*-text` de los temas claros están calibrados a ≥4.6:1 sobre la tarjeta
   real de Liquid** (los avisos teñidos `bg-X/10` + `text-X-text`). Subir el alfa
   del tinte los **empeora**; lo que se mueve es la luminosidad del `-text`.

**Abierto:** `content-3` queda en ~4.15:1 sobre la tarjeta de Liquid claro.
Cerrarlo bien exige mover `content-2` y `content-3` juntos (cambio de escala
tipográfica del tema, no un arreglo de contraste). No se tomó.

Por qué: ver `docs/design/historia/05-material.md`.

### 5.ter El backdrop root — lo único que puede apagar el vidrio

Un elemento con `transform`, `filter`, `backdrop-filter`, `opacity < 1`, `mask`,
`mix-blend-mode`, `contain: paint` o `will-change` de cualquiera de esos se
vuelve **backdrop root**: desde ahí hacia abajo, el `backdrop-filter` de los
descendientes deja de muestrear la página. No se rompe nada — se **apaga**: una
tarjeta de Liquid claro sin su desenfoque es una mancha gris.

- **`fill-mode` de una animación de ENTRADA: `backwards`, nunca `both`.** Las de
  **salida** sí llevan `both`.
- **`transform-gpu` no va nunca en un envoltorio**, y **`will-change` de
  `transform`/`opacity`/`filter` tampoco** (es la versión permanente del mismo
  problema). El lift canónico sólo pone transform mientras el puntero está
  encima, y eso es aceptable. Esta prohibición manda también sobre los consejos
  de rendimiento (§26).
- **Ningún velo con `backdrop-filter`**, ni de 1px: apaga el vidrio de todo lo
  que cubre.
- **Vidrio dentro de vidrio no es defecto**: es la anidada que se aplana.

Cómo se verifica, en dos mitades:
- **En el fuente**: gate **`backdrop-root`** — `transform-gpu` /
  `will-change-transform` en un tag sin `data-surface`. En cero.
- **Fuera del fuente** (`fill-mode`, `opacity` heredada, `contain` implícito):
  recorrer el árbol **pintado** y, para cada `[data-surface]` con
  `backdrop-filter`, mirar si algún ancestro crea un backdrop root.

Por qué: ver `docs/design/historia/05-material.md`.

### Lo que NO es material

`Notice`, `Badge` y los chips **son tinta**: se apoyan sobre una superficie y
toman su color de la paleta semántica. Sin canto, sin lente, sin
`backdrop-filter`, sin `data-surface`.

### El reloj

Cuatro escalones: `--dur-fast` (150) · `--dur-base` (200) · `--dur-slow` (300) ·
`--dur-lento` (500), con su valor por tema. **Cero literales `duration-N` en
JSX** (gate `reloj-a-mano`). Para elegir: el escalón más cercano, y los empates
bajan. `animationDuration` de un bucle ambiental queda fuera del reloj.

### Antes de escribir vidrio a mano

No lo escribas: usa una `data-surface`. Si de verdad hace falta —una pantalla
fuera del shell, como el login o el kiosco— va a `EXCEPTIONS` **con el motivo
escrito**. Los gates `vidrio-a-mano` y `material-a-mano` lo marcan; la receta
para convertir un sitio existente está en `PLAN-MATERIALES-2026-08-02.md` §20.

## 6. Color System

> ### ⛔ La paleta es CERRADA (regla del usuario, 2026-07-28)
>
> **No se agregan colores ni variantes de color. Se usan los definidos.**
> Cuando algo necesita un color que "todavía no existe", se elige uno de los que
> ya están. Severidad → `success`/`warning`/`danger`; jerarquía →
> `primary`/`secondary`/`ghost`; sin categoría → `neutral`. Sólo si el color
> distingue una CATEGORÍA que el usuario reconoce (forma de pago, tipo de
> solicitud) va un `chart-N` de los cinco de §6.0. Gate: `paleta-cerrada`.
>
> Por qué: ver `docs/design/historia/06-color.md`.

### 6.0 La paleta, consolidada (2026-07-28)

Nueve tokens en tres niveles, con reglas distintas. **Ésta es la única lista de
la paleta**: cualquier otra mención en el documento remite acá.

#### Nivel 1 — Marca

| token | valor | dónde |
|---|---|---|
| `--brand` | `#0052CC` | El azul **funcional**: botones, enlaces, foco, CTA. Hover: `--brand-hover`. |
| `--logo-green` | `#8ec30f` | Identidad. |
| `--logo-magenta` | `#981d97` | Identidad. |

Los dos del logo aparecen **donde la app habla de sí misma** — la navegación
activa, el brillo del logo, los orbes del fondo, un estado vacío, la espera de la
IA. **Nunca en un dato ni en un estado**: eso es severidad o categoría.

Variantes: `-soft` (`#b9e05a`/`#e2a3e0`) sobre fondo oscuro; `--logo-green-solid`
`#5c7f0a` para relleno con texto blanco (el lima da 2.11:1, el magenta sirve tal
cual); `-text` para **texto** de identidad, AA en los cuatro temas — no para teñir
un saldo ni un estado. Utilidades: `text-logo-green`, `bg-logo-magenta-soft`, etc.

#### Nivel 2 — Severidad

`success` · `warning` · `danger`. Dicen **qué tan grave es**; nunca identidad ni
categoría.

**`-text`** es para texto sobre el tinte del propio token
(`bg-success/10 text-success-text`): AA y por tema. La **base** (`text-success`)
es para íconos o texto que no está sobre ese tinte. Nunca clases crudas
(`text-emerald-600`, `text-red-500`): gate `color`.

#### Nivel 3 — Categoría (cinco)

`chart-1` azul · `chart-3` violeta · `chart-4` naranja · `chart-6` rosa ·
`chart-9` verde azulado. Se asignan por posición dentro del mismo enum de
negocio, nunca "porque quedaba bien". **No hay un sexto.**

#### Los cuatro retirados

`chart-2` → `success` · `chart-8` → `neutral` · `chart-5` → `chart-9` ·
`chart-7` → `warning`. Siguen definidos como **alias** del destino (para no
reescribir los usos viejos); el gate `chart-retirado` bloquea usos nuevos.

**Qué varía por tema:** sólo `-text` (depende del fondo ya compuesto). La base
(tinte al 12%) se compone sobre la superficie, que ya cambia; `-solid` trae su
propio fondo y texto blanco.

### 6.1 El panel lateral sigue al tema

El sidebar **no** es "siempre oscuro": su material sale de los tokens
`--sidebar-*` de `index.css` (`--sidebar-tint`, `--sidebar-ink`,
`--sidebar-realce`, `--sidebar-fill`, `--sidebar-rim`, `--sidebar-bg`,
`--sidebar-pop-*`, `--sidebar-item-hover-shadow`), redefinidos en cada tema. En
`AppLayout.jsx` el texto es `text-[rgb(var(--sidebar-ink)/0.6)]` inactivo y
`text-[rgb(var(--sidebar-ink))]` activo; el ícono activo, `text-logo-magenta-soft`;
la barra de acento, `linear-gradient(180deg, var(--logo-green), var(--logo-magenta))`.
Ninguna clase de color fija (`bg-[#07031a]/80`, `text-white/60`) en el panel. Es
una de las superficies con tratamiento propio de §25.4.

## 7. Tipografía

**Una sola escala**: `text-micro` … `text-display`. Ni `text-[Npx]` (tampoco decimales ni `rem`) ni la escala de Tailwind `text-xs`…`text-xl` (gates `typography` y `texto-tailwind`). `text-2xl` y mayores quedan para cifras de despliegue.

Fuente: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.
Sin webfonts.

**El tamaño sale de un token, nunca de un `text-[Npx]`** (gate `typography`).

| token | px | para qué | token | px | para qué |
|---|---|---|---|---|---|
| `text-micro` | 9 | contadores | `text-body-xl` | 16 | input (mínimo táctil, §32) |
| `text-caption` | 10 | badges, mayúsculas | `text-title-sm` | 18 | título de modal |
| `text-label` | 11 | etiqueta de campo, chip | `text-title` | 20 | título de sección |
| `text-body-sm` | 12 | secundario, navegación | `text-title-lg` | 22 | título de vista en móvil |
| `text-body` | 13 | celda, cuerpo | `text-display` | 26 | título de vista |
| `text-body-lg` | 14 | cuerpo destacado | `text-display-lg` | 32 | KPI, cifra destacada |
| `text-subtitle` | 15 | subtítulos | `text-display-xl` | 44 | la cifra que ES la pantalla (`/mis-puntos`) |

En táctil, `--text-micro` y `--text-caption` suben un punto: 9px en un teléfono
no se lee. `text-display-xl` es el único escalón que no salió de un censo: lo
pidió `/mis-puntos`, donde la cifra se lee de pie con el teléfono en la mano. No
es el tamaño por defecto de un KPI — ése sigue siendo `text-display-lg`.

**Convenciones**
- Mayúsculas siempre con `uppercase tracking-widest font-black`.
- Nunca `font-normal` en UI interactiva — mínimo `font-medium`.
- **`tabular-nums` obligatorio** en toda columna o celda numérica.
- Contraste mínimo sobre vidrio: `text-content-2` para etiquetas, `text-content-3`
  para texto secundario. Nunca por debajo.

## 8. Escala de radios

**Ésta es la fuente única de los radios de todos los temas.** Cualquier otra
sección que hable de radios remite acá. Valores leídos de `src/index.css`
(`:root` para Liquid claro y oscuro; `[data-theme="solid"]` y
`[data-theme="solid-dark"]`, idénticos entre sí):

| token → utilidad | Liquid (claro y oscuro) | Solid (claro y oscuro) | dónde |
|---|---|---|---|
| `--btn-radius` → `rounded-btn` | `9999px` | `0.5rem` | botones, chips, controles |
| `--input-radius` | `0.75rem` | `0.5rem` | campos de formulario |
| `--card-radius` → `rounded-card` | `1.75rem` | `0.75rem` | tarjetas, widgets |
| `--card-radius-anidada` | `0.875rem` | `0.5rem` | tarjeta dentro de tarjeta |
| `--modal-radius` → `rounded-modal` | `2rem` | `1rem` | modales |
| `--header-radius` → `rounded-header` | `2.5rem` | `0.875rem` | cabeceras flotantes, sidebar |
| `--tab-track-radius` | `2.5rem` | `0.75rem` | el carril de `ViewTabBar` |

Que el sólido use radios más chicos **es el diseño**: el vidrio es redondo y
expresivo, el sólido recto y eficiente. Por eso ningún control lleva
`rounded-full` fijo — lo dejaría redondo en un tema que lo quiere recto.

`rounded-full` sólo es correcto en lo que es **geométricamente un círculo**:
avatares, puntos de estado, orbes del fondo.

## 9. Z-Index Scale

Tailwind v4 no tiene namespace `@theme` para z-index: la escala se declara con
`@utility` en `index.css` y genera clases reales. **Se usa la clase con nombre,
nunca `z-10`/`z-[N]`/`zIndex` fijo** (gate `z-index`, en cero: hoy hay ~500 usos
de las clases nombradas y ninguno numérico).

```
z-ambient 1 · orbes del fondo          z-modal 100 · ModalShell por defecto
z-base 10 · apilamiento base           z-bell-desktop 200 · campana (escritorio)
z-content 20 · contenido               z-flyout 300 · paneles flyout
z-tabs 30 · pestañas, píldoras         z-bell-dropdown 400 · desplegable de la campana
z-header 40 · cabecera de vista        z-banner 500 · banners globales
z-ribbon 45 · franja de aviso          z-tooltip 9998 · reservado a tooltips
z-sidebar 50 · sidebar (cajón móvil)   z-toast 9999 · toasts, LiquidTooltip, AlertModal
z-sidebar-desktop 60 · sidebar         z-lightbox 99998 · PhotoLightbox
z-dropdown 70 · desplegables           z-confirm 99999 · ConfirmModal, desplegable de LiquidSelect
```

Una capa nueva se agrega como `@utility` con su motivo escrito al lado en
`index.css`, no con un número en el componente.

## 10. Spacing & Layout

### Page shell

`AppLayout` (`src/components/layout/AppLayout.jsx`) envuelve todo en
`flex w-full lg:h-[100dvh] lg:overflow-hidden`.

- **< 1024px:** scroll natural del documento; el sidebar es un cajón `fixed`.
- **≥ 1024px:** alto de pantalla; el scroll vive dentro del contenedor de
  `GlassViewLayout`; el sidebar es `relative` en la fila.

Las áreas seguras del sidebar van por los tokens `--sa-*` (§32).

### Content area

`GlassViewLayout` (`src/components/GlassViewLayout.jsx`) es el envoltorio de toda
vista de administración.

Props: `icon` (Lucide), `title`, `liveIndicator` (punto pulsante),
`filtersContent` (ranura derecha), `headerLeft` (reemplaza la izquierda),
`subContent` (entre encabezado y cuerpo), `transparentBody`, `fixedScrollMode`.

**El cuerpo no lleva tarjeta.** `cuerpoConCard = false` dentro del componente:
el vidrio lo llevan las tarjetas de la vista, en primer nivel. Una vista no
envuelve su contenido en otra `data-surface="card"`.

### Max widths

Área de contenido: `max-w-[1440px] xl:max-w-[1600px] 2xl:max-w-[1800px] mx-auto`.

### Padding scale

| Contexto | Valor | Contexto | Valor |
|---|---|---|---|
| Cuerpo de vista, horizontal | `px-2 lg:px-6 xl:px-8` | Pie de modal | `p-4 sm:p-5` |
| Cuerpo de vista, arriba | `pt-4 xl:pt-5` | Interior de tarjeta | `p-4` / `p-5` / `p-6` |
| Encabezado de página | `py-6 px-10 xl:py-7 xl:px-12` | Ítem de navegación | `px-3 py-3 xl:px-4 xl:py-3.5` |
| Cuerpo de modal | `p-6 sm:p-8` | Ítem anidado | `px-2.5 py-2 ml-2 xl:px-3 xl:py-2.5` |

## 11. Animation & Motion

### Principios

1. El movimiento comunica estado, no decora. Si no aclara qué cambió, no va.
2. Easing estándar: `cubic-bezier(0.23,1,0.32,1)` (`--ease-out`).
3. Rebote: `cubic-bezier(0.34,1.56,0.64,1)` — sólo para el asentado de un
   widget, nunca para layout.
4. Presión: `active:scale-[0.97]` o `active:scale-[0.99]`. Nunca `scale-90/95`
   (gate `scale-tap`).
5. Elevación al pasar: **nunca un número clavado** (`hover:-translate-y-0.5` está
   prohibido, gate `lift-clavado`). Un control usa
   `hover:translate-y-[var(--lift-hover)]` y una superficie
   `hover:translate-y-[var(--lift-card)]`; los tokens valen `0px`/`-1px` en Solid
   y el hover se apaga solo en táctil.

### Keyframes (`index.css`)

Todo el movimiento vive en `@keyframes` de `index.css`. No hay
`tailwind.config.js` (el proyecto usa `@tailwindcss/postcss` sin `@config`).

`animate-kpi-enter` (280ms, entrada de KPI) · `animate-widget-settle` (550ms,
rebote) · `animate-wiggle` (400ms ∞) · `glow-danger` / `glow-warning` (2.8s /
3.2s ∞, pulso en indicadores de pérdida o atención) · `badge-pulse` (1.8s ∞) ·
`animate-ambient-drift` / `-reverse` (16s / 20s ∞, orbes) · `animate-shimmer`
(1.4s ∞, carga) · `animate-ping` / `animate-spin` de Tailwind (punto en vivo,
`Loader2`).

### `animate-in` / `animate-out` — la familia de entrada (tw-animate-css)

`animate-in fade-in zoom-in-95`, `slide-in-from-*` y sus pares de salida vienen
de **`tw-animate-css`**, importado en `index.css` después de Tailwind. Van en todo
elemento que **aparece o desaparece**: modal, dropdown, popover, panel, toast.

```jsx
// entrada estándar de un panel que aparece
<div className="animate-in fade-in zoom-in-95 duration-[var(--dur-slow)]" />
// salida (el elemento sigue montado mientras dura)
<div className="animate-out fade-out zoom-out-95 duration-[var(--dur-fast)]" />
```

En Solid duran 130ms lineales; con `prefers-reduced-motion` se anulan las
variables de geometría y queda sólo el fade. **Antes de dar por buena una clase
de animación, buscarla en el bundle** (`grep -c '\.animate-in' dist/assets/*.css`):
tres veces una familia entera estuvo escrita sin generar CSS. La clase `.sweep`
(barrido en botones) ya no existe. Por qué: ver `docs/design/historia/11-movimiento.md`.

### framer-motion — sólo lo que CSS no puede hacer

La regla es la de la categoría `motion` del gate:

- **Permitido:** `AnimatePresence` (anima el desmontaje: cuando React quita el
  nodo no queda nada que animar con CSS), `layout` / `layoutId` / `LayoutGroup`
  (transiciones FLIP entre posiciones) y `drag`.
- **Prohibido:** `motion.*` decorativo — fade/slide de entrada, hover, tap. Eso
  es `@keyframes` + Tailwind (la familia `animate-in`).
- Todo uso de framer-motion respeta la preferencia de movimiento reducido vía
  `MotionProvider` / `useMotionConfig`.

## 12. Icon System

**Librería:** `lucide-react` (^0.575) — la única. Ningún otro set.

#### Un concepto, un ícono

**El mapa es cerrado** (gate `icono-semantico`):

| Concepto | Canónico | Concepto | Canónico |
|---|---|---|---|
| Editar | `Pencil` (no `Edit`/`Edit2`/`Edit3`) | Ver | `Eye` |
| Eliminar | `Trash2` | Descargar | `Download` |
| Marca de selección | `Check` | Agregar | `Plus` |
| Estado exitoso | `CheckCircle2` | Buscar | `Search` |
| Cerrar | `X` | Filtrar | `SlidersHorizontal` |
| Anular / rechazar (no es eliminar) | `XCircle` | Advertencia / Información | `AlertTriangle` / `Info` |

`Check` y `CheckCircle2` **no son sinónimos**: uno es una marca, el otro un
estado. `CheckCheck` está retirado. El proyecto usa el nombrado viejo de Lucide
(`CheckCircle2`, `XCircle`, `AlertTriangle`, `AlertCircle`) de punta a punta y se
queda así: lo prohibido es tener **dos nombres para el mismo concepto**.

#### La rampa de tamaños

Gate `icono-rampa`:

```
8 · 9 · 10 · 11 · 12 · 13 · 14 · 15 · 16 · 18 · 20 · 22 · 24 · 26 · 28 · 32 · 36 · 40 · 48
```

Fina abajo (ahí el ícono compite con texto de 10-12px) y gruesa arriba. Si el
tamaño que querés no está, el de al lado sirve igual.

#### El trazo va con el tamaño

**Escala cerrada de cinco: `1 · 1.5 · 2 · 2.5 · 3`** (gate `icono-stroke`, que
exige la escala). Dentro de ella, el trazo se elige por banda — el trazo se
afina cuando el ícono crece:

| Banda | Trazo | Para qué |
|---|---|---|
| **Interfaz** (8-28px) | `2` reposo · **`2.5` default** · `3` énfasis | el 90% de los íconos |
| **Despliegue** (29-48px) | `1` · `1.5` | estados vacíos, wallboard, bloqueo |
| **Ilustración** (≥49px) | lo que pida la caja | ver abajo |

Dos excepciones, ambas en `EXCEPTIONS` del gate: `Checkbox` usa `4` (en una caja
de 16px el 2.5 se pierde, y el glifo *es* el estado) y la marca de agua de
`FormWfmAnalytics` usa `0.5`.

#### Arriba de 48px ya no es un ícono de interfaz

Desde 49px el tamaño lo decide la caja. Dos cosas distintas: **marca de agua**
(decorativa, opacidad ≤15%, `pointer-events-none`: `FormWfmAnalytics` 100,
`EmployeeDetailView` 80) e **ícono de despliegue** (protagonista de una pantalla o
estado vacío: `FeedbackOverlay` 96, `AttendanceMonitorView` 70, `FormLeadership` 64).

**Defaults:** suelto `16`/`2.5` · en botón o fila `14`/`2.5` · badge o chip
`10`–`12`/`2.5` · estado vacío `36`–`48`/`1.5`.

**Squircle del ícono de vista** (el de `GlassViewLayout`): glifo blanco sobre el
degradado de marca. Va en la banda de interfaz:

```jsx
<div className="bg-gradient-to-tr from-brand to-brand-purple rounded-xl
                shadow-[var(--shadow-glow-brand)] p-2 flex items-center justify-center">
  <Icon className="text-white" size={16} strokeWidth={2} />
</div>
```

En `AlertModal`/`ConfirmModal` la baldosa del ícono no lleva degradado: el color
sale del `type`/`isDestructive` y el glifo va a 36/28px con `strokeWidth={2.5}`.

Por qué: ver `docs/design/historia/12-iconos.md`.

## 13. Layout Components

### AppLayout

Archivo: `src/components/layout/AppLayout.jsx`. Raíz de las vistas autenticadas,
en este orden de apilamiento:
1. **Fondo ambiental** — orbes fijos (`z-ambient`, ver §4).
2. **Telón de móvil** — `bg-scrim` detrás del cajón abierto.
3. **Sidebar** — `data-surface="sidebar"`, sigue al tema con los tokens
   `--sidebar-*` (§6.1); fijo en escritorio, cajón en móvil.

Anchos del sidebar: colapsado `w-[4.5rem] xl:w-[5rem]`; expandido
`w-[15rem] xl:w-[16.5rem] 2xl:w-[18rem]`; móvil `w-[85%] max-w-[280px]`.

**Píldora de navegación activa:** un `div` absoluto que sigue la posición del
ítem activo (`getBoundingClientRect` en un `useLayoutEffect`) con transform CSS,
sin framer-motion. El ítem activo no pinta barra propia: la bicolor
(verde → magenta del logo) la pone la píldora.

**Flyouts:** a la derecha del sidebar colapsado, al pasar el mouse; cierre con
80ms de demora en `onMouseLeave`.

**Colapsar:** botón `ChevronLeft` en el encabezado del logo. En móvil se dispara
con `window.dispatchEvent(new CustomEvent('set-sidebar', { detail: true }))`.

**Estructura de navegación:** la fuente es `MENU_GROUPS` en
`src/constants/menuGroups.js` — no se copia acá. Un grupo con un solo módulo
visible se dibuja directo; con dos o más, como acordeón (`grid-rows` en CSS). Cada
ítem pasa por `hasPermission(moduleKey, 'can_view')`; los `comingSoon: true` se
dibujan apagados y no navegan.

**Pie del sidebar (expandido):** PIN del kiosco (+ código SU con permiso
`su_pin`), `SidebarSyncStatus`, la fila del usuario (→ `/profile`), salir y
`ThemeToggle variant="sidebar"`.

### GlassViewLayout

Archivo: `src/components/GlassViewLayout.jsx`. Envoltorio estándar de las vistas
de administración. Aporta: encabezado fijo `[data-surface="page-header"]` con el
squircle, el título y la ranura de filtros; el contenedor de scroll interno
(escritorio); el cuerpo **sin tarjeta** (§10); los botones flotantes «ir al
inicio / al final» (también en teléfono, con `--tap-min`); y el respaldo de
`BarraFlotante` cuando una vista publica un buscador y ningún `FilterBar` reclamó
el clúster (§14, ViewTabBar).

## 14. Components

### ViewTabBar

Archivo: `src/components/common/ViewTabBar.jsx`. Encabezado flotante de las vistas
con pestañas y/o buscador.

**Cuándo se dibuja qué:**

| Situación | Qué se dibuja |
|---|---|
| `tabs.length > 1` | las pestañas (fila en escritorio, `LiquidSelect` `compact bare` en el teléfono) |
| `tabs.length <= 1` | **nada de pestañas** — con una sola no hay entre qué elegir |
| `showSearch` pero **sin `onSearchChange`** | **nada de lupa** — no hay a quién avisarle |
| sin pestañas y sin lupa | **la barra entera devuelve `null`** |

El `return null` va **después de todos los hooks**, `usePublicarBuscador`
incluido: si subiera, la barra flotante dejaría de recibir el buscador.

**En táctil el buscador SIEMPRE baja al clúster flotante**, haya `FilterBar` o
no. Si una `FilterBar` lo reclama, lo dibuja ella; si no, `GlassViewLayout`
monta un `BarraFlotante` de respaldo con el buscador solo. Lo resuelve
`CanalDeVista.js` (§17.3), no la vista. Dos reglas al tocarlo: el respaldo **lee
`filtros` y escribe `barra`**, nunca al revés (si leyera lo que él publica, se
apagaría solo en bucle); y su condición es **`useLayoutCompacto()`**, la misma de
`FilterBar` (con dos cortes distintos habría anchos con dos clústeres o ninguno).

**Ancho del selector en el teléfono:** `clamp(8.75rem, 34vw, 11.875rem)` en
`style` inline — no como clase arbitraria, porque **una coma rompe el valor
arbitrario de Tailwind** sin error ni aviso.

**Anatomía:**
- Contenedor: `data-surface="tab-track"` (`--surface-tab-track`, `--border-tab`,
  `--tab-track-radius` de §8, `--tab-track-backdrop`).
- Botón de pestaña: `rounded-btn`, `h-11 min-w-[44px]` (blanco táctil de 44px).
- Las acciones de la vista **no** van acá: viven en `FilterBar` (§16.9, §17).
  `trailingActions` se retiró.

**Estados:** activa `bg-surface-tab-active text-content shadow-md`; inactiva
`bg-transparent text-content-3`, con hover `hover:bg-surface-tab-active
hover:translate-y-[var(--lift-hover)]` (nunca `hover:-translate-y-0.5`, §11);
botón buscar `bg-brand text-white`.

Nunca un buscador local dentro de una pestaña: el buscador vive acá y
`searchTerm` baja como prop.

```jsx
const [activeTab, setActiveTab] = usePestanaEnUrl(TABS, 'todos');

<ViewTabBar
  tabs={TABS}
  activeTab={activeTab}
  onTabChange={setActiveTab}
  searchTerm={searchTerm}
  onSearchChange={setSearchTerm}
  placeholder="Buscar..."
/>
```

#### El número de la pestaña — `cuenta`

Una pestaña puede llevar `cuenta` y `tono`; `ViewTabBar` los dibuja con
**`Contador`** (§16.2). En el teléfono el número va pegado al rótulo
(«En la sala · 3»). `Contador` devuelve `null` en cero. Tono por defecto: `brand`
en la activa, `neutral` en las demás.

```jsx
const TABS = [
  { key: 'sala',   label: 'En la sala',          icon: Package, cuenta: 3 },
  { key: 'camino', label: 'Esperando recepción', icon: Send,    cuenta: 2, tono: 'danger' },
];
```

> **Antes de convertir secciones en pestañas, preguntarse qué se pierde al
> esconderlas. Si es «que no se ve que hay trabajo ahí», la pestaña necesita su
> número — y el número se construye ANTES de partir la pantalla.**

La cuenta es **lo que la pestaña VA A MOSTRAR, filtros incluidos**; por eso el
buscador de una vista con contadores filtra todas las pestañas, y la fila contesta
en cuál cayó lo buscado. `medirFila` lee el DOM real, así que la burbuja entra
sola en el corte a desplegable.

#### La pestaña activa vive en la DIRECCIÓN — `usePestanaEnUrl`

**Nunca `useState` para la pestaña activa.** El hook es `usePestanaEnUrl`
(`src/plataforma/usePestanaEnUrl.js`), para toda vista con pestañas. Gate
`pestana-fuera-de-la-url`, bloqueante en cero. El hook:

1. **Valida contra las pestañas visibles AHORA** (filtradas por permiso): un
   `?tab=` inválido cae a la primera visible.
2. **Empuja al historial** en el clic y **reemplaza**
   (`setActiva(clave, { reemplazar: true })`) en las correcciones automáticas —
   empujar ahí deja a «atrás» rebotando contra la misma corrección.
3. Acepta `key` o `id` en la lista.

La lista tiene que existir ANTES de la llamada (se iza a constante de módulo o la
llamada baja después del `useMemo` que la arma). Si depende de DATOS que llegan
después, se valida contra la lista **estática**.

#### La página de una tabla también — `usePaginaEnUrl`

`usePaginaEnUrl` (`src/plataforma/usePaginaEnUrl.js`) devuelve
`{ page, pageSize, totalPages, setPage, setPageSize, resetPage }`:

1. **Reemplaza, no empuja**: la página es una posición, no un paso.
2. **El tamaño va junto y validado contra `PAGE_SIZE_OPTIONS`**: viaja como
   `p_limit` a una RPC, y un `?ver=99999` pediría una página que PostgREST
   recorta a 1000 filas en silencio.
3. **Recibe el TOTAL DE FILAS** y corrige una página fuera de rango **sólo cuando
   el total ya se sabe** (antes de la primera respuesta vale 0).

**`resetPage()` lo llaman el filtro, la búsqueda y el orden**: cambian qué lista
es. Prueba: `tests/unit/paginaEnUrl.test.jsx`.

Por qué (ViewTabBar, contadores, URL): ver `docs/design/historia/14-componentes.md`.

### DataTable

Archivo: `src/components/common/DataTable.jsx`. Tabla estándar de toda vista de
lista. El contenedor es `data-surface="card"` y su `useTokens()` interno devuelve
sólo tokens (`text-content-*`, `bg-brand/[0.04]`, `divide-divider`…): sigue al
tema.

Props: `data`, `columns`, `loading`, `skeletonRows`, `empty` (`{ icon, message }`),
`onSort`, `sortKey`, `sortDir`, paginación; y para el teléfono las de §32.8/§32.9
(`usarAccionDeFila`, `apilada`, `acciones`, `movil`).

- Orden en el cliente; columnas `sortable: true`; numéricas `align: 'center'`.
- `empty` siempre se pasa.
- **Nunca envolver `DataTable` en otra tarjeta**: ya es una. `DataTable` y
  `TablePagination` van como hermanos en el flujo `space-y-*` de la vista
  (referencia: `VentasView`); el total vive sólo en `TablePagination`.

#### La sub-tabla: `plano`, no una tabla a mano

Una tabla que vive dentro de una tarjeta usa **`plano`**, que quita **sólo** la
superficie y conserva todo lo demás (modo ficha, alto por densidad, teclado):

```jsx
<DataTable columns={COLS} plano dense movil={false} minWidth="520px" />
```

#### Cuándo un `<table>` a mano SÍ es correcto

1. **HTML que se imprime** (boleta, planilla, cotización) hacia `openPrintWindow`.
2. **La fila no es un registro: es una matriz** (bloques × poblaciones,
   empleados × siete días en `ScheduleCalendar`).
3. **Un documento con formato propio** (visores de DTE, Corte Z).

Los casos 2 y 3 se declaran en `EXCEPCIONES` de `scripts/mobile-gate.mjs` con el
motivo escrito. Si la fila es un registro pero el teléfono ya tiene su camino
(`ExpedienteMovil` con `comoPanel`), va `movil={false}` con el motivo en un
comentario arriba.

#### El ancla de una fila no puede depender del ancho de la ventana

En el teléfono el **ancla** (total, monto, saldo) va arriba a la derecha de la
ficha; en escritorio es la última columna. **Si a 1440px con el menú abierto la
última columna se sale del marco, sobran columnas**: se baja a `hideBelow` el
contexto (sucursal, método de pago) y nunca lo que **es** la fila (quién y
cuánto). ⚠️ El peldaño `1440` de `HIDE_BELOW` se cumple a 1440 y ahí no oculta
nada: para un portátil de 1440 va `2xl`. Lo vigila `npm run gate:ux` (barrido de
escritorio, en el trabajo nocturno).

### LiquidSelect

Archivo: `src/components/common/LiquidSelect.jsx`. Select completo: teclado
(↑↓ Enter Esc), se abre hacia arriba cerca del borde, desplegable por portal al
`body` (`z-confirm`). Trigger `data-surface="input"`, desplegable
`data-surface="dropdown"`; el tema sale de los tokens. Usa `AnimatePresence`
(permitido, §11). En táctil con más de 12 opciones abre `SelectorTactil` (§14.1).

Props: `value` (siempre string: `String(val)`), `onChange(value)`, `options`
(`[{ value, label }]`; el placeholder nunca va como opción), `placeholder`,
`compact`/`nano`, `clearable`, `bare`, `creatable` + `onCreateOption`,
`serverSearch` + `onSearchChange`, `isLoading`. Campo obligatorio: `compact` + `clearable={false}`. El error va en `invalid`, sin
envoltorio (§15.13).

### ModalShell

Archivo: `src/components/common/ModalShell.jsx`. Envoltura de **todo** diálogo:
portal al `body`, `z-modal` por defecto, `role="dialog"` + `aria-modal`, Escape,
trampa de foco, bloqueo de scroll que restaura la posición, y la gota de apertura.
En táctil convierte el diálogo en **hoja**; `align="pantalla"` lo vuelve un
expediente a pantalla completa.

Props: `open`, `onClose`, `maxWidthClass`, `zClass`, `align`
(`center`|`top`|`bottom`|`pantalla`), `hojaEnTactil`, `scrim`, `surface` (`null`
cuando el hijo declara la suya — si no quedan dos vidrios apilados), `ariaLabel`
(siempre el título real).

#### UN SOLO DIÁLOGO A LA VISTA

**Un diálogo sobre otro está prohibido**: dos paneles del mismo vidrio no se
distinguen. La red está en el canónico:

- `dialogosAbiertos.js` mantiene la pila; `ModalShell` sólo pinta si es el de
  encima (el resto va `display:none`, fuera del árbol de accesibilidad y del Tab).
- El de abajo **no se desmonta**: conserva estado y scroll.
- Escape y la trampa de Tab se apagan en los ocultos.

En desarrollo se imprime `[canónico] Diálogo sobre diálogo: «A» se abrió sobre «B»`:
ahí el flujo se rehace — un paso dentro del mismo diálogo, o cerrar el primero
(`SesionesView`: `open={!!detalle && !porBloquear && !porCerrar}`). Única
excepción: en táctil, `LiquidDatePicker` y `SelectorTactil` salen como hoja desde
un formulario que ya es hoja.

### LiquidModal

Archivo: `src/components/common/LiquidModal.jsx`. Envuelve `ModalShell` con
`surface={null}` y declara **él** la superficie del panel (dos
`data-surface="modal"` apilados multiplican la opacidad). Aporta la hoja táctil
(asa, esquinas rectas contra el filo, tope 88dvh, pie apilado con área segura) y
las ranuras `LiquidModal.Header` / `.Body` / `.Footer`.

**El encabezado tiene anatomía propia.** Con `titulo`, el canónico dibuja ícono,
título, subtítulo y ✕:

```jsx
<LiquidModal.Header icono={Clock} tono="brand" titulo="Horarios de atención"
    subtitulo="Sucursal: La Popular" onClose={cerrar}>
    {/* opcional: lo que va DEBAJO del título (pasos, pestañas) */}
</LiquidModal.Header>
```

`avatar` reemplaza al ícono, `compacto` trunca en el teléfono, `acciones` va a la
derecha antes de la ✕, `onVolver` pone la flecha atrás, `enfocarCierre` le da el
foco inicial a la ✕. La ranura libre ya no tiene consumidores: gate
`encabezado-de-modal-a-mano`, en cero. Dentro de `ModalConRanuras` el encabezado
se declara con `EncabezadoModal` pasando DATOS, nunca JSX. `Body` acepta `ref` y
`relleno={false}`.

### Otros canónicos de `components/common/`

| Componente | Qué es | Lo que hay que saber |
|---|---|---|
| `UnifiedModal` (`src/components/UnifiedModal.jsx`) | orquestador de 30+ formularios por la prop `type` | `getModalSize()` mapea `type` → `max-w-*`; envuelve `ModalShell` |
| `ConfirmModal` | confirmación destructiva o no | `ModalShell` con `zClass="z-confirm"`. Props: `isOpen`, `onClose`, `onConfirm`, `title`, `message`, `confirmText`, `cancelText`, `isDestructive` (default `true`), `isProcessing` (spinner, oculta cancelar) |
| `AlertModal` | un botón: info / éxito / error | `ModalShell` con `zClass="z-toast"`. Props: `isOpen`, `onClose`, `title`, `message`, `type` (`'success'\|'error'\|'info'`, decide ícono y color), `buttonText` |
| `PromptModal` | pide una nota corta antes de confirmar | reemplaza `window.prompt()` (gate `native`). Props de `ConfirmModal` + `placeholder`, `required` |
| `LiquidTooltip` | nota al pasar el puntero | portal en `z-toast`, recortado a la ventana. Props: `content`, `side`, `children`, `className`. Cuándo sí y cuándo `title=`: §15.10 |
| `TablePagination` | la píldora bajo la tabla | tamaño → navegación → rango, `<nav>` con `aria-live`; sin framer-motion; exporta `PAGE_SIZE_OPTIONS` (`[25, 50, 100]`). §17.2 |
| `LiquidToast` | notificaciones | portal en `z-toast`, entrada `animate-in`, color por tokens |
| `LiquidAvatar` | la imagen redonda (WEBP, iniciales de respaldo) | **no se usa suelto: la foto de una persona va con `AvatarConEstado`, ver §5.4** |

Todos siguen al tema por tokens; ninguno lee un prop `theme` ni usa un `z-[N]`.

### 14.1 `SelectorTactil` — la lista larga con el pulgar

En un teléfono el desplegable anclado de `LiquidSelect` hereda el ancho del
trigger (~4 opciones visibles), queda bajo el teclado del sistema y, pasado
`searchThreshold`, arranca vacío. `SelectorTactil` lo reemplaza por una hoja de
pantalla completa con buscador fijo, lista agrupada por letra con encabezado
pegajoso y **riel A–Z arrastrable**.

**No se usa a mano.** `LiquidSelect` decide: puntero grueso **y** más de **12**
opciones (o `serverSearch`). 12 es donde el desplegable anclado deja de mostrar la
lista completa en un teléfono; `searchThreshold` (80) es un número de escritorio.

**La letra del cajón no es el primer carácter** (`src/utils/alfabetico.js`): se
saltan los caracteres iniciales que no son letra (prefijos como `1-ABBOTT`), y
**el orden usa la misma clave** que el agrupado, o los grupos no quedan contiguos.

Implementación: el riel apunta a la `<section>` (no al encabezado `sticky`) y
desplaza con `getBoundingClientRect` (no `offsetTop`); `LiquidSelect` no registra
su click-afuera cuando usa la hoja (va por portal fuera de `selectRef`) — Escape
y el fondo ya los da `ModalShell`.

Por qué: ver `docs/design/historia/14-componentes.md`.

## 15. Controles canónicos

**Regla base: no se escribe un control a mano.** Si lo que hace falta no está
aquí, el paso es proponer el canónico —no resolverlo inline en la vista. Todos
viven en `src/components/common/`.

Por qué: ver `docs/design/historia/15-controles.md` (las mediciones de cada
subsección están ahí, en el mismo orden).

### 15.1 La forma la decide el TEMA, no el componente

`--btn-radius` cambia por tema (píldora en Liquid Glass, rectángulo en Solid;
valores en §8). Por eso `rounded-btn` ya rinde la forma correcta en cada tema y
**ningún control lleva un radio fijo**.

```jsx
// ❌ clava la forma y pelea con el tema sólido
<button className="rounded-full …">

// ✅ la forma sale del token
<Button>Guardar</Button>
```

### 15.2 `Button`

```jsx
// desde una vista en src/views/
import Button from '../components/common/Button';

<Button onClick={guardar}>Guardar</Button>
<Button variant="secondary" icon={X} onClick={cancelar}>Cancelar</Button>
<Button variant="destructive" size="xs" icon={Trash2} iconOnly onClick={borrar} aria-label="Borrar" />
<Button tone="success" icon={Check}>Aprobar</Button>
```

| prop | valores | para qué |
|---|---|---|
| `variant` | `primary` · `secondary` · `ghost` · `destructive` | **jerarquía** |
| `tone` | `brand` · `success` · `warning` · `danger` · los cinco categóricos de §6.0 (`chart-1`, `chart-3`, `chart-4`, `chart-6`, `chart-9`) | **categoría**, no jerarquía. Excluyente con `variant`. Los `chart-2/5/7/8` están retirados (gate `chart-retirado`) |
| `soft` | booleano | el mismo `tone` con relleno tenue (ver abajo) |
| `size` | `xs` · `sm` · `md` · `lg` | sale de `--control-h`, con piso de 44px en táctil |
| `icon` · `iconOnly` · `loading` · `disabled` | | |

`variant` y `tone` son ejes distintos a propósito: *primary* dice **cuán
importante es**, *success* dice **de qué se trata**.

#### `soft` — el relleno tenue

```jsx
<Button tone="success" soft size="sm">Aprobar</Button>
<Button tone="danger"  soft size="sm">Rechazar</Button>
```

Los `tone` son **sólidos**; `soft` dice *"esta acción es de esta categoría,
pero no es la principal de la pantalla"*.

**Úsalo** con dos o más acciones de categoría juntas sin una que mande, junto
a un `primary` que ya está en la vista, o dentro de una tarjeta o fila. **No**
para *la* acción de la pantalla (`primary`), para lo destructivo y definitivo
(`destructive` sólido) ni sin categoría (`secondary`/`ghost`).

`soft` **solo funciona junto a `tone`** (sin `tone` se ignora) y **no lleva
barrido**. `tone`, `soft`, `size` e `iconOnly` son ejes independientes.

#### El ✕ es CROMO, no una acción de categoría

La variante la decide **qué pasa al apretarlo**, nunca dónde está dibujado:

| El ✕… | variante | por qué |
|---|---|---|
| **Cierra o cancela** una superficie — modal, hoja, panel, popover, banner, toast, buscador desplegado, edición en línea | `ghost` | Cerrar no borra nada: es cromo. |
| **Quita una fila** de algo que todavía no se guardó (un teléfono del formulario, una línea de cotización) | `ghost` | Se deshace no guardando. |
| **Limpia los filtros** aplicados | `tone="danger" soft` | Es la forma del «limpiar todo» de `FilterBar`. |
| **Borra de verdad, ya** | *no lleva ✕* | Lleva `Trash2`: **✕ = cerrar o quitar; papelera = borrar.** |

Regla mecánica, la que vigila el gate (`equis-destructiva`):
**`variant="destructive"` nunca va con `icon={X} iconOnly`.** Un ✕ de cerrar
tampoco va en `secondary`.

### 15.3 `SegmentedControl` — una de N opciones

Si el estilo depende de `X === valor`, **no es un botón con estado**: es este
control (gate `segmentado-a-mano`).

```jsx
<SegmentedControl
    value={modo} onChange={setModo} label="Modo"
    options={[
        { value: 'mes', label: 'Por mes' },
        { value: 'dia', label: 'Por días' },
    ]}
/>
```

Cada opción acepta `tone` propio cuando el color lleva información. Semántica:
`role="radiogroup"`, para que un lector anuncie "2 de 3".

**El tope son 3 opciones** (regla del usuario, 2026-08-17; gate
`segmentado-largo`, cero absoluto). El límite cuenta opciones, no anchos: tres
etiquetas largas que no entran también van a select; ante la duda, select.

**Cuándo NO**: más de 3 opciones → `LiquidSelect`. Vienen de datos →
`LiquidSelect`. Navegación entre secciones → los `tabs` de `ViewTabBar`. Cada
opción hace algo distinto → botones sueltos.

### 15.4 `Switch` y `Checkbox`

```jsx
<Switch checked={activo} onChange={setActivo} label="Notificaciones" />
<Checkbox checked={ok} onChange={setOk} label="Acepto" />
<Checkbox indeterminate={parcial} checked={todos} onChange={marcarTodos} label="Todos" />
```

**Sin `onChange` son indicadores, no controles**: renderizan un `<span>` no
enfocable. Es para los que viven dentro de una fila que ya es clickeable.

`Checkbox` reemplaza a `<input type="checkbox">` **siempre**: la casilla nativa
se pinta con el color del sistema operativo e ignora los cuatro temas.

### 15.5 `TabBarAction` — el botón de acción de una vista

**No se instancia a mano.** Lo renderiza `FilterBar` a partir de los
descriptores de `acciones` (§17); la vista describe la acción y el canónico
decide cómo se dibuja en cada tamaño:

```jsx
<FilterBar … acciones={[
    { key: 'nuevo', icon: UserPlus, label: 'Nuevo', variant: 'primary', onClick: crear },
]} />
```

- Una sola primaria por barra; el resto `quiet`, con el color reducido al
  ícono. Sin halo (`shadow-glow-*` se ve sucio en los temas sólidos).
- **Dos tamaños.** `md` (44px) y `sm` (36px), el de la píldora de escritorio de
  `FilterBar`: 36 del control + 8 de aire arriba y abajo = los 52px fijos de la
  píldora (§17). En táctil esa píldora no se dibuja: ahí `FilterBar` es la
  barra flotante, con botones de 44 y 48.
- El nombre quedó de cuando estas acciones vivían en `ViewTabBar`; ya no van
  ahí (§16.9).

#### El TONO lo decide el ícono — `TONO_POR_ICONO`

Mapa en `src/components/common/iconNames.js`, junto a `NOMBRE_POR_ICONO`:
**si el llamador no dice de qué color es, lo dice el ícono.**

| familia | íconos | tono |
|---|---|---|
| crear / confirmar | `Plus` `Check` `CheckCircle2` `Save` | `success` |
| sacar datos | `Download` `Upload` `FileOutput` | `success` |
| mirar sin tocar | `Eye` `EyeOff` `Search` `Maximize2` `Printer` | `chart-1` |
| rehacer / traer | `RefreshCw` `RotateCcw` `Copy` | `chart-1` |
| modificar | `Pencil` `SquarePen` | `warning` |
| archivar | `Archive` | `chart-4` |
| destruir | `Trash2` `Trash` | `danger` |

(`Edit2`/`Edit3` no están en el mapa: el portal usa `Pencil`/`SquarePen`, §12.)

**Se tiñe el ÍCONO, no el relleno** (`CLASE_TEXTO_POR_TONO`). Lo consumen
`TabBarAction` y `Button`, y tres cosas lo desactivan a propósito:

| desactivador | por qué |
|---|---|
| `tone` explícito | el llamador manda; el mapa es el piso, no el techo |
| variante **rellena** (`primary`, `destructive` — `VARIANTES_RELLENAS`) | el ícono va en blanco; teñirlo lo haría desaparecer |
| botón **con texto** | el color sale del papel del botón, no de su ícono |

#### `soloIcono` es un TAMAÑO, no una clase de más

`soloIcono` **reemplaza** el tamaño: pasa a cuadrado (`w-9 h-9 px-0` en `sm`),
el ícono crece de 14 a 18px y el `<svg>` lleva `shrink-0`. **Quita el rótulo
él mismo**: el texto no se pinta, pero sin `label` `children` sigue nombrando
al botón para un lector de pantalla. Nunca se intenta el mismo efecto con
clases en el `className` del llamador (pierden contra las del tamaño por orden
de hoja).

- **En táctil `soloIcono` NO existe.** `TabBarAction` lo ignora cuando se
  cumple `(hover: none)`: sin hover no hay tooltip, y el rótulo es el único
  nombre alcanzable. Se decide por **dispositivo de entrada, no por ancho**. El
  rótulo nunca lleva `hidden sm:inline`.
- **`soloIcono` lleva `LiquidTooltip`, nunca `title`.** Lo pone `FilterBar`
  solo, con `side="bottom"`; el `aria-label` sale del `label` del descriptor.

#### En táctil todo modal es una HOJA

`ModalShell` resuelve `align="center"` a `"bottom"` cuando se cumple
`(hover: none)` (manda el dispositivo de entrada, no el ancho). Corrige al hijo
con variantes de descendiente (`[&>*]:rounded-b-none`, relleno inferior con el
área segura) para no editar a los llamadores; un hijo marcado con `data-hoja`
se saltea.

- `align="top"` es **solo para el ⌘K** (quiere estar bajo los ojos). Un
  formulario no lo usa.
- `hojaEnTactil={false}` existe **solo para alertas**: una interrupción corta
  se lee como tal centrada; subiendo desde abajo se confundiría con la hoja de
  filtros.
- **El guard va afuera, nunca en `open`.** Los children de JSX se evalúan al
  crear el elemento: `open={!!fila}` no protege un cuerpo que dereferencie
  `fila`. Va `{fila && <ModalShell open …>}`.

#### `HojaMovil` — el CUERPO canónico de un modal en el teléfono

`ModalShell` resuelve *cómo entra*; `HojaMovil` *cómo se ve por dentro*: título
alineado a la izquierda con el ícono a su lado (no un ícono de 64px centrado),
y acciones apiladas a ancho completo con **la principal primero**.

```jsx
<ModalShell open={abierto} onClose={cerrar} surface={null}>
    <HojaMovil titulo="¿Recalcular MIN/MAX?" icono={Info} tono="brand"
        pie={<><Button …>Calcular</Button><Button variant="secondary" …>Cancelar</Button></>}>
        Se generarán nuevos borradores…
    </HojaMovil>
</ModalShell>
```

- **El material sale de `data-surface`, no de clases sueltas.** `HojaMovil`
  pinta `data-surface={superficie}`, cuyo valor por defecto es
  **`MATERIAL_HOJA` = `'dropdown'`** (72%: tapa lo de atrás lo suficiente para
  leer). El clúster de `BarraFlotante` usa **`MATERIAL_CLUSTER` = `'card'`**
  (16%: flota y deja ver pasar la lista). Las dos constantes se exportan de
  `HojaMovil.jsx`, el canónico de la capa móvil; nadie escribe otro material.
- `rounded-b-none!` lleva el modificador de importancia: el radio lo fija el
  selector `[data-surface]`, de igual especificidad que una clase.
- `data-hoja` marca la hoja para que el parche de `ModalShell` la saltee.
- Solo el **cuerpo** scrollea: título arriba y acciones abajo quedan fijos.
- **Sin velo en táctil.** `ModalShell` apaga el scrim en táctil (`scrim` lo
  fuerza); el diálogo sigue siendo modal: el fondo es un objetivo de cierre
  invisible.
- **`AsaHoja`** es el tirador canónico, nunca un div repetido: es la única
  señal de que eso se cierra hacia abajo.
- **El pie decide solo**: `flex-wrap` con `basis-36` y `flex-row-reverse`; dos
  rótulos cortos entran en fila, lo demás envuelve y la principal cae arriba.
  No hay prop para decidirlo.
- **Sombra hacia arriba**: `--shadow-hoja`, en el **envoltorio** de
  `ModalShell` (el `data-surface` del panel le ganaría), colgada de `esHoja`.

#### La gota: la hoja NACE del control que la abrió

La implementa `useGotaApertura` (`src/components/common/gotaApertura.js`) y la
usa **`ModalShell`**, así que todo diálogo abierto por un toque la hereda sin
que el llamador pida nada.

- **Se anima `clip-path: inset()`, no `transform: scale()`.** Escalar escala
  también el `backdrop-filter`; recortando, la hoja está a tamaño real con su
  blur desde el primer cuadro y lo único que crece es la ventana: empieza en el
  rectángulo del control, con radio de píldora, y se abre hasta el panel.
- **El origen es automático**: si nadie da un `origen`, sale de
  `leerUltimoToque()` (`src/components/common/ultimoToque.js`: un listener de
  `pointerdown` en captura, vigencia 1.2s). Se lee **al abrir**, dentro del
  efecto, y se congela para la salida (al cerrar, el último toque es el que
  cerró). Con teclado no hay gota.
- **Se recorta el elemento QUE LLEVA EL VIDRIO, nunca su envoltorio**
  (`elVidrio()` lo busca por `backdropFilter !== 'none'`): un `clip-path`,
  `transform` u `opacity` < 1 en un ancestro crea un backdrop root (§5.ter).
  Por eso `ModalShell` acepta `animacionPropia`, y **sin velo el contenedor no
  se anima**. La sombra del envoltorio se apaga mientras dura la gota.
- El clip **se retira al terminar**, y el radio final se **lee** del elemento.
- **La salida es la misma gota al revés**, más rápida (180ms contra 520).
  `ModalShell` avisa del cierre por `EstadoDialogoCtx` (contexto en su propio
  `.js`, por fast-refresh).
- **En los temas sin vidrio el gesto se queda y la técnica cambia**: la rama se
  elige por `getComputedStyle(el).backdropFilter !== 'none'`, nunca por nombre
  de tema. Sin blur que preservar, la hoja se desliza con `translate` (el
  compositor la mueve sin repintar).

#### `LiquidModal` en táctil: la misma hoja, por composición

`HojaMovil` es de **props** (`titulo`, `icono`, `pie`); `LiquidModal` es de
**composición** (`Header`/`Body`/`Footer`). En táctil `LiquidModal` toma la
anatomía de hoja por dentro —asa, esquinas rectas abajo, tope de 88dvh, pie
apilado con `flex-col-reverse` y área segura— sin tocar a sus llamadores.
`LiquidModal.Footer` es la forma que sus consumidores ya escribían a mano; se
usa el canónico.

#### La barra flotante

`BarraFlotante` es la forma táctil de `FilterBar` (§17.3). Reglas que tocan a
los controles:

- **Orden canónico: `principal · acciones · buscador`.** Lo que más se toca
  queda bajo el pulgar; lo que abre teclado va al extremo.
- **El campo de búsqueda sube ENCIMA del clúster como fila propia** y los
  botones se quedan (buscar y filtrar no son excluyentes). No se pega al
  encabezado de la pantalla, y no va en hoja: mientras se escribe hay que ver
  la lista filtrarse.
- **Una sola ranura se anuncia por su NOMBRE** («Sucursal», con el ícono del
  control — `FilterBar.Opciones` lo recibe, `FilterBar.Sucursal` lo publica en
  `Sucursal.iconoRanura`), y es un botón del clúster, no un select embebido.
- **Avisa cuánto ocupa**: publica `--alto-barra-flotante` con
  `ResizeObserver`, y el scroller de `GlassViewLayout` lo suma a su relleno
  (`pb-[max(2.5rem,calc(var(--alto-barra-flotante,0px)+0.75rem))]`). La página
  termina donde termina el contenido.

### 15.6 `Notice` — aviso inline

```jsx
<Notice variant="warning" icon={Search}>
    Resultados similares — no hubo coincidencias exactas
</Notice>
```

| prop | valores | para qué |
|---|---|---|
| `variant` | `info` (default) · `success` · `warning` · `danger` · `neutral` · `chart-3` | color y ícono por defecto |
| `icon` | componente de ícono | reemplaza el de la variante |
| `action` | nodo (p. ej. un `Button`) | acción a la derecha del texto |
| `compact` | booleano | relleno y texto menores |
| `bloque` | booleano | aviso de varios renglones: radio de tarjeta y más relleno |
| `className` · `...rest` | | van al contenedor |

El del medio entre `AlertModal` (interrumpe) y los banners de página: dice algo
*aquí*, junto a lo que se habla. `role="status"`, no `alert`: informar no es
interrumpir. **Es el aviso de error de un formulario** (§29.5), no un div
pintado a mano.

**Un aviso de varios renglones lleva `bloque`.** El radio sale de
`--btn-radius`, que en Liquid es una píldora: correcta en un renglón, un óvalo
en siete. Un `children` de texto plano más largo que 56 caracteres
(`LARGO_QUE_YA_NO_ES_PILDORA`) pasa a bloque solo; con JSX adentro el
componente no puede medirlo, así que **se declara** — igual que
`usarAccionDeFila` en `DataTable` (§32.8).

### 15.7 `ListRow` — fila de lista

```jsx
<ListRow icon={Building2} title="La Popular" subtitle="Chalatenango"
    trailing={<Badge tone="success">Abierta</Badge>} onClick={abrir} />
```

Tres densidades (`sm`/`md`/`lg`). Se dibuja como `<button>` con `onClick`, como
`<a>` con `href`, y como `<div>` sin ninguno: una fila que no hace nada no es
enfocable. La ranura `leading` acepta ícono, letra o imagen.

- **`selected` no es `active`.** `active` es *dónde estoy*; `selected` es *qué
  elegí*.
- **`tone`** tiñe la fila entera con su categoría (anulada, vencida, urgente),
  siempre suave, nunca sólido.

#### Tarjeta seleccionable = `ListRow` + `Checkbox`

No hay un `SelectableCard`, a propósito:

```jsx
<ListRow density="lg" selected={elegido === op.id} onClick={() => elegir(op.id)}
    icon={op.icon} title={op.label} subtitle={op.hint}
    trailing={<Checkbox checked={elegido === op.id} />} />
```

La casilla resuelve la ambigüedad entre "seleccionada" y "activa".

### 15.8 Cuándo NO es un botón

Hay `<button>` a mano que **no** son deuda: son el canónico equivocado. Esta
sección existe para que nadie los "arregle" de nuevo.

#### Navegar no es una acción → `<Link>`

```jsx
// ❌ pierde ⌘+clic, la vista previa de la URL, y suena como "botón"
<button onClick={() => navigate('/payroll')}>Nómina</button>

// ✅
<Link to="/payroll">Nómina</Link>
```

El `onClick` se queda **solo para el efecto secundario** (cerrar el panel en
móvil, cerrar un flyout). Navegar lo hace el `href`.

#### Los cuatro casos donde el `<button>` a mano es correcto

| caso | por qué el canónico lo rompería | ejemplo |
|---|---|---|
| **Segmento pegado** dentro de un borde común (`items-stretch` + `border-r`) | `Button` le da a cada uno su radio y su sombra | `ChipDoc` de Facturación |
| **Tarjeta rica** — avatar, contador, barra de progreso | `Button` no tiene ranuras para eso | `PanelCompletitud` de Sucursales |
| **Tres estados**, no dos | `SegmentedControl` solo distingue activo/inactivo | la rejilla de meses: *elegido* / *hoy* / *resto* |
| **Superficie bespoke** | lenguaje visual propio, declarado | login, kiosco (§25.4) |

**Si se repite, se extrae a un componente local** con nombre en el mismo
archivo (así se cerraron `ChipDoc`, `TarjetaTelefono`, `PanelCompletitud`), no
a `Button`.

#### Lo que SÍ debe tener todo control, canónico o no

| si el control… | lleva | ejemplo |
|---|---|---|
| alterna un modo | `aria-pressed` | pausar el refresco, ocultar montos |
| abre o cierra algo | `aria-expanded` | encabezado de sección plegable |
| marca dónde estás | `aria-current` | paso de un asistente, mes de hoy |
| es una de N excluyente | `role="radio"` + `aria-checked` | lo pone `SegmentedControl` |
| no tiene texto | `aria-label` o `title` | lo pone `Button` desde el ícono |

`aria-pressed` es **solo** para un interruptor de dos estados: si el botón abre
otra pantalla o su texto ya cambia con el modo, no lo lleva (se anota en el
código por qué). Si el control no responde (sin permiso, cero datos), lleva
`disabled`: un `onClick` condicional que no hace nada **simula** que responde.

**`SegmentedControl` vs `FilterBar.Chip`**: una sola activa → `SegmentedControl`
(radiogroup); varias a la vez → `<FilterBar.Chip active onToggle>` (cada chip
es un interruptor con `aria-pressed`).

**`stacked`** (`<SegmentedControl layout="block" columns={3} stacked … />`)
pone el ícono arriba del texto y el radio en `rounded-card`. Con
`layout="block"` el canónico **ya es una grilla**: no se lo envuelve en otro
`grid grid-cols-3`.

Gate `button-name`: un `<button>` de solo íconos sin `aria-label` ni `title`
falla. Cero y bloqueante, igual que `input-label`.

### 15.9 `FileField` — adjuntar un archivo

```jsx
<FileField label="Constancia (PDF/IMG)" accept=".pdf,image/*" maxSizeMB={10}
    file={archivo} url={guardado} onChange={setArchivo} />
```

Un adjunto es una **fila**, no una caja punteada: lo que más se hace es ver o
reemplazar el archivo. Se arrastra igual; la fila se ilumina **solo cuando lo
que viene son archivos** (tipos del `dataTransfer`).

| prop | para qué |
|---|---|
| `emptyState` | `neutral` (default) · `pending` (falta y debería estar) · `missing` (falta y es error) |
| `busy` + `busyLabel` | el archivo se sube al elegirlo y eso tarda |
| `maxSizeMB` | límite real; **el texto de ayuda se deriva de aquí** |
| `name` | nombre del archivo ya guardado en el servidor |

Nunca un `<input type="file">` suelto. Las dos excepciones vivas son selectores
de **foto** (avatar de empleado, foto de producto que abre el recortador).

### 15.10 `LiquidTooltip` — nota al pasar el puntero

```jsx
<LiquidTooltip content="Se sincronizó hace 3 minutos" side="top">
    <span>Sincronizado</span>
</LiquidTooltip>
```

- **Oscuro en los cuatro temas**: es una nota encima de la pantalla, no una
  superficie de ella. La forma y el material sí cambian por tema, vía
  `--tooltip-*` y `[data-surface="tooltip"]`, nunca por props.
- El texto secundario dentro usa `text-content-tooltip-2`, no `text-content-3`.
- El recorte contra el borde usa el **ancho real**, medido ya montado
  (`useLayoutEffect`). Se muestra también con el foco del teclado.

#### `LiquidTooltip` vs `title=`

`title=` **nombra** un control de solo ícono (`aria-label` es preferido;
`Button` acepta `title` como fuente, ver `nombreAuto`). `LiquidTooltip`
**explica** algo que el control no dice. Conviven; **nunca los dos con el mismo
texto** (gate `title-redundante`).

#### `title=` sobre un elemento NO interactivo — cuatro patrones

| | Qué es | Qué lleva |
|---|---|---|
| **A** | Texto visible **truncado**; el `title` tiene el completo | `title` + `truncate`. Se queda: el wrapper `inline-block` de `LiquidTooltip` rompería el truncado |
| **B** | Un **gráfico**: punto de estado, avatar en pila, ícono suelto | `role="img"` + el `title` (así el lector de pantalla lo nombra) |
| **C** | Un **contenedor de controles** con nombre | `role="group"` + `title` |
| **D** | **Prosa suplementaria** sobre texto inline | `LiquidTooltip` |

`LiquidTooltip` **no** hace alcanzable por teclado a un hijo no enfocable: sobre
un elemento no interactivo compra consistencia visual, no accesibilidad. Si la
información importa y solo vive en hover, va un botón de info o texto visible.
Un `pointer-events-none` mata el hover: el disparador va en un ancestro.
Gate: `tooltip-no-control`.

#### Tooltip ≠ hover card

| | tooltip | hover card |
|---|---|---|
| contenido | una nota, texto corto | datos con estructura: filas, barras, listas |
| interactivo | no (`pointer-events-none`) | a veces sí |
| superficie | `data-surface="tooltip"` — **oscuro siempre** | `data-surface="dropdown"` — **sigue el tema** |
| ejemplo | "Se sincronizó hace 3 min" | el desglose de Horas Hombre en `TabStaff` |

**Excepción con significado:** los tooltips de `EmployeeRequestsView` usan
`bg-danger-solid` porque el rojo *es* el mensaje. Un tooltip puede llevar color
semántico; nunca un gris crudo elegido a ojo.

### 15.11 `PortalInput` — el campo de formulario

Un campo con etiqueta se escribe **siempre** con `PortalInput` (gate
`input-a-mano`). Pone el `<label htmlFor>` asociado, el badge "Requerido", el
borde de error, `aria-required`/`aria-invalid`/`aria-describedby` y la
superficie del tema.

```jsx
// ❌ el patrón que aparecía escrito a mano
<div>
    <label className="text-caption font-black uppercase …">Monto</label>
    <input type="number" className="w-full pl-8 …" />
</div>

// ✅
<PortalInput label="Monto solicitado" name="sol-monto" prefix="$"
             inputMode="decimal" maskType="DECIMAL" value={monto} onChange={…} />
```

| ranura | qué resuelve |
|---|---|
| `label` **opcional** | la celda de grilla no lleva etiqueta visible; sin `label`, `aria-label` es obligatorio |
| `tono` | el campo tintado por semántica o categoría |
| `onDark` | superficie oscura bespoke (kiosco) |
| `className` | va al CONTENEDOR (`w-16`, `flex-1`…); para el texto está `inputClassName` |
| `icon` · `prefix` | el ícono o el `$` dentro del campo |
| `labelAction` | una acción a la derecha de la etiqueta (`+ Agregar`) |
| `compact` | 32px en vez de 40, para grillas densas |
| `required` | badge "Requerido" + `aria-required` |
| `helperText` · `inputClassName` · `...rest` | ayuda inline, clases del texto, y `min`/`max`/`inputMode`/`ref`/`onKeyDown` |

**Sin `label`**, el mensaje de error pasa a `sr-only` y la señal visible es el
borde rojo. Gate `input-sin-nombre`, cero absoluto (§25.1).

**La acción va AFUERA del campo**, como hermano en una fila, nunca posicionada
encima del `<input>`:

```jsx
<div className="flex items-end gap-2">
    <div className="flex-1"><PortalInput label="Cod. Empleado" … /></div>
    <Button iconOnly icon={RefreshCw} aria-label="Generar un código nuevo" … />
</div>
```

**`tono`** — valores `brand`, `success`, `danger`, `warning`, `chart-1`,
`chart-3`, `chart-4`, `chart-6`, `chart-9`: la paleta cerrada de §6.0, sin
excepciones. Con `tono` el contenedor NO emite `data-surface="input"` (esa
regla de `index.css` va sin `@layer` y taparía el borde tintado).

```jsx
<PortalInput label="Nuevo Salario Base Mensual" tono="success" icon={DollarSign} … />
```

#### 15.11.1 Un campo de DINERO nunca es `type="number"`

El separador decimal de `input[type=number]` lo decide el idioma de cada
computadora, y la tecla que no espera **se la come** sin avisar.

```jsx
// ❌ el separador lo pone el idioma del navegador
<PortalInput label="Cuánto" prefix="$" type="number" step="0.01" min="0" … />

// ✅ acepta punto Y coma, y deja siempre punto
<PortalInput label="Cuánto" prefix="$" inputMode="decimal" maskType="DECIMAL" … />
```

`maskType="DECIMAL"` (`src/utils/inputStyles.js`) acepta las dos teclas, guarda
con punto y recorta a dos decimales; `inputMode="decimal"` da el teclado
numérico. `min`/`max`/`step` son inertes en texto y se quitan (el tope de dinero
lo pone el servidor). **Donde sí trabajan —cantidades, no dinero— el campo se
queda nativo** (horas extra contra `otBank.diurnal`, «Días Trabajados» contra
16).

Gate `monto-nativo` (cero absoluto): reconoce el dinero por `prefix="$"`,
`icon={DollarSign}`, `placeholder="0.00"` o un `name`/`label` del vocabulario
del dinero. `step="0.01"` no cuenta como señal.

#### 15.11.2 Un monto con máximo se LLEVA al máximo, no se bloquea

Cuando un campo de dinero tiene un máximo conocido (lo que se debe, lo que
queda por explicar, el saldo), el `onChange` pasa por **`hastaElTope(valor,
tope)`** (`src/utils/hastaElTope.js`): quien escribe 100 sobre 47.50 ve 47.50.
La ayuda dice el tope («Hasta $47.50»). Sin avisos rojos ni botones trabados.

Aplicado en Cuentas por Cobrar, causa y responsables de una diferencia de caja,
abonos de un faltante, abono de una reserva, pago por factura de Cuentas por
Pagar y reparto de un depósito al banco.

**NO va** en un conteo a ciegas (bolsas, cortes: lo contado es el dato), en una
salida contra el efectivo de la sala (el tope revelaría el cajón), ni cuando el
tope se mueve DESPUÉS de escribir (se avisa o se toma el mínimo al calcular).
El servidor sigue rechazando: el tope es la cortesía del campo, no el control.

### 15.12 Cuándo un `<input>` a mano es correcto — CUATRO casos

| # | dónde | por qué |
|---|---|---|
| 1-2 | `LoginView` (dos campos) | Superficie **bespoke**: corre antes de que exista sesión. Sigue el modo **claro/oscuro del sistema** (`prefers-color-scheme`: estampa `solid` o `solid-dark`) y su material sale de variables propias (`--lgn-*`) declaradas en la vista (§25.4) |
| 3 | `AuthPromptPanel` — el PIN del kiosco | Su borde lleva el **caret virtual animado** (indicador anti-fraude); el canónico dibuja la caja en el contenedor y lo ocultaría |
| 4 | `MenuSearchModal` | La barra del encabezado de ⌘K: fila a todo el ancho con divisor abajo |

**Ninguna otra.** Si vas a escribir un `<input>`, la respuesta es una de estas:

```
<PortalInput label="Monto" … />                    campo con etiqueta
<PortalInput aria-label="Cantidad" compact … />     celda de grilla, sin etiqueta
<PortalInput aria-label="PIN" onDark … />           sobre superficie oscura
<SearchInput … /> · <SearchInput expandable … />    buscar (§24)
```

Las celdas de grilla **son** `PortalInput compact`; las que navegan con flechas
(`data-qty-row`/`data-qty-col`) mantienen su `onKeyDown`, que el canónico
reenvía. Ninguna está exenta del nombre accesible (§25.1).

### 15.13 `LiquidSelect` no se envuelve — el error va en `invalid`

`LiquidSelect` se pinta **entero** (`data-surface="input"` y
`min-h-[max(40px,var(--tap-min))]`). **No se envuelve en un div que le dibuje
una caja**: el control es más alto que la caja y con otro radio, y el fondo
asoma alrededor.

```jsx
// ❌ dos cajas que no coinciden
<div className={`rounded-2xl h-[40px] ${inputHoverClass} ${!v ? '!border-danger !bg-danger/10' : ''}`}>
    <LiquidSelect value={v} … />
</div>

// ✅ el canónico se pinta solo; el error es una prop
<LiquidSelect invalid={!v} value={v} … />
```

`invalid` usa **`outline`** (`border`/`bg` pierden por cascade layers contra
`data-surface="input"`) y emite `aria-invalid`. El foco gana sobre el error
mientras se elige.

**`LiquidDatePicker` es el caso contrario: su envoltorio SÍ va** — su
contenedor es `h-full` y sin padre colapsa.

Gate `select-con-envoltorio` (cero y bloqueante): detecta por la forma (div de
alto fijo que contiene un `LiquidSelect`), no por la clase.

## 16. Badges, avisos e indicadores

Un "chip" escrito a mano casi nunca es una sola cosa. Antes de escribirlo,
decidir cuál es:

| qué es | canónico |
|---|---|
| etiqueta corta de estado | `Badge` (§16.1) |
| aviso con ícono y texto | `Notice` (§15.6) |
| número pegado a un ícono | `Contador` (§16.2) |

Lo vigila `chip-a-mano` en `gate:design`. Por qué: ver
`docs/design/historia/16-badges-y-pildoras.md`.

### 16.1 `Badge` — etiqueta de estado

```jsx
import Badge from '../common/Badge';

<Badge variant="success">Activo</Badge>
<Badge variant="danger" tone="solid">Vencido</Badge>
<Badge variant="warning" size="sm">Por vencer</Badge>
```

`variant` es semántico (`success` · `warning` · `danger` · `info` · `neutral` y
la paleta categórica de §6.0), `tone` elige teñido o relleno. Los colores salen
de los tokens, así que responden a los cuatro temas. **Nunca** `bg-red-500`,
`bg-emerald-500/10` ni un hex: el color de un badge dice *qué significa*, y eso
vive en el token semántico.

### 16.2 `Contador` — la burbuja con un número

```jsx
import Contador from '../common/Contador';

// rojo y chico, los defaults
<Contador valor={sinLeer} aria-label={`${sinLeer} sin leer`} />

// "99+" al pasarse, en color de marca
<Contador valor={n} max={99} tono="brand" aria-label={`${n} filtros aplicados`} />

// pegado a la esquina de un ícono: la POSICIÓN la pone el llamador
<Contador valor={n} className="absolute -top-1.5 -right-1.5 z-content"
          aria-label={`${n} sin leer`} />
```

- Devuelve `null` cuando `valor <= 0`: no hace falta `{n > 0 && …}`.
- **`aria-label` es obligatorio.** Sólo el llamador sabe si son avisos, filtros
  o pedidos; sin él un lector anuncia "3" suelto.
- **No es un `Badge`**: un chip crece con su texto; el contador es circular con
  un dígito y ovalado con dos (ancho mínimo y alto fijos).
- Su borde es del color de la superficie (`border-surface-card`), no blanco:
  recorta la burbuja del fondo sin dibujar un halo en tema oscuro.

### 16.3 Punto de estado en vivo

```jsx
<span role="img" title="En línea" className="relative flex h-2 w-2">
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
  <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
</span>
```

`animate-ping` es decorativo: lo apagan el tema sólido y
`prefers-reduced-motion`.

**El punto necesita nombre.** Un punto de color es información, y un `<span>`
sin `role` el lector lo salta. Va `role="img"` con el texto en `title` o
`aria-label`; con `role="img"` el `title` **es** el nombre accesible, así que no
se duplica en `aria-label`. Vale para todo indicador puramente gráfico: el punto
de estado, el avatar en pila, el punto por sucursal, la burbuja del cumpleaños.
Ver §15.10, patrón (B).

### 16.9 Las dos píldoras de una vista — cuál es cuál

Una vista tiene **dos** contenedores en píldora y no son intercambiables:

| | píldora del **header** | píldora del **cuerpo** |
|---|---|---|
| canónico | **`ViewTabBar`** (§14) | **`FilterBar`** (§17) |
| qué lleva | pestañas de la vista + buscador global | los filtros que recortan los datos **+ las acciones** |
| dónde | fila del título, vía `filtersContent` de `GlassViewLayout` | bajo el título, a la derecha |
| responde | *¿qué sección estoy viendo?* | *¿qué recorte, y qué hago con él?* |

- **Las acciones son de la píldora del CUERPO.** `ViewTabBar` ya no tiene
  `trailingActions`: si algo recorta datos o actúa sobre ellos, va a
  `FilterBar`. En el header sólo se navega y se busca.
- **`filtersContent` está mal nombrado**: lo que recibe es un `ViewTabBar`, no
  filtros. Ese nombre ya hizo leer mal el código una vez; `headerContent` sería
  el honesto si algún día se renombra.
- **Nunca escribir el contenedor del header a mano** (hoy no hay ninguna vista
  que lo haga). `ViewTabBar` trae el contrato de buscador toggleable de §24 y el
  colapso táctil de las acciones; escribirla a mano pierde las dos cosas. Si
  falta algo, se le agrega a `ViewTabBar`.

## 17. Filter Pills — canónico `FilterBar`

```jsx
import FilterBar from '../common/FilterBar';

{/* La píldora va a la DERECHA de su fila. El `flex-1` de la izquierda es lo
    que la empuja — con carril es el `CarrilCards` (§17.0); sin carril, un div
    vacío. Las dos mitades son obligatorias en los dos casos. */}
<div className="flex flex-col lg:flex-row lg:items-center gap-3">
    <div className="flex-1" />
    <div className="flex justify-end min-w-0">
        <FilterBar
            onClear={limpiar}
            activeCount={n}
            acciones={[
                { key: 'nuevo',  icon: Plus,     label: 'Nuevo empleado', variant: 'primary', onClick: crear },
                { key: 'export', icon: Download, label: 'Exportar', tone: 'success', soloIcono: true, onClick: exportar },
            ]}
        >
            <FilterBar.Section label="sucursal"><FilterBar.Sucursal value={suc} onChange={setSuc} options={sucs} /></FilterBar.Section>
            <FilterBar.Section label="período"><PeriodPicker value={rango} onChange={setRango} /></FilterBar.Section>
            <FilterBar.Section label="estado"><FilterBar.Opciones value={estado} onChange={setEstado} label="Estado" options={estados} /></FilterBar.Section>
        </FilterBar>
    </div>
</div>
```

**La píldora es el lugar único de TODO el filtro de la vista** —fecha,
categoría, sucursal, estado— **y de todas sus acciones**. Es donde el usuario
mira para saber qué está filtrando, para soltarlo y para ver qué puede hacer.

- **Va en el CUERPO, bajo el título, a la derecha. Nunca en el header** (ahí
  vive `ViewTabBar`, §16.9).
- **Filtros sueltos sin contenedor: prohibido.** Sin píldora no hay orden de
  ranuras, ni limpiar-todo, ni cuenta de filtros en el teléfono. El divisor
  entre ranuras lo pone el contenedor.
- **Un filtro que afecta a UNA sección igual va en la píldora.** Si el recorte
  sólo tiene sentido para una sección, que filtre la vista entera; si eso no
  tiene sentido, no era un filtro sino un selector de contenido (pestañas o un
  `SegmentedControl` dentro de la tarjeta).
- **El ejemplo de arriba es el canon**: quien crea una vista copia el ejemplo,
  no lee las subsecciones. Si cambia una regla, cambia el ejemplo.

Por qué: ver `docs/design/historia/17-filterbar.md`.

#### Las acciones son DESCRIPTORES, no JSX

`acciones` es un array, no un ReactNode: el mismo botón se dibuja como
`TabBarAction size="sm"` en escritorio y como botón de clúster en la barra
flotante táctil (§17.3).

| campo | qué hace |
|---|---|
| `key` `icon` `label` `onClick` | lo obvio |
| `variant` | `'primary'` (una sola por barra) o `'quiet'` |
| `tone` | color del ícono en `quiet` |
| `disabled` | |
| `activo` | es un interruptor: emite `aria-pressed` y se ve encendido en el clúster |
| `principal` | fuerza (o niega) el botón grande del clúster táctil; por defecto lo es el `variant: 'primary'` |
| `as` `href` `target` `rel` | para la acción que NAVEGA — un enlace sigue siendo un enlace |
| `soloEscritorio` | no aparece en el teléfono |
| `soloIcono` | sin texto **en escritorio** (el rótulo sigue en `label` para aria y tooltip); para la secundaria reconocible —Exportar con `Download`—. En el clúster táctil sigue rotulada |
| `rotuloFijo` | **opt-in y rara**: ver abajo |

**`rotuloFijo` invierte quién cede el ancho.** Lo normal es que el texto de la
acción sea lo primero en soltarse (el ícono identifica, el rótulo queda en el
tooltip). Con `rotuloFijo` el texto no cede nunca y lo que se estrecha es el
cupo de ranuras. Sólo cuando un ícono mudo dejaría sin saber qué se aprieta y la
consecuencia es cara: el caso legítimo es `MiCajaView` (sus acciones mueven
dinero). No es un adorno de énfasis; en la duda, no se pone.

`accionesExtra` es la escotilla ReactNode para lo que no es un botón (un `Badge`
de estado, un `LiquidSelect` de "copiar desde"): va al final de la píldora y a
la hoja de acciones en táctil.

#### `FilterBar.Opciones` — uno de N, sin elegir el control

**Hasta 3 opciones es `SegmentedControl`; de 4 en adelante, `LiquidSelect`.**
El umbral es del canónico, no del llamador.

```jsx
<FilterBar.Section active={estado !== ''} onClear={() => setEstado('')} label="estado">
    <FilterBar.Opciones value={estado} onChange={setEstado} label="Estado" icon={FileCheck}
        options={opcionesDeEstado} />
</FilterBar.Section>
```

- `umbral` baja a 2 si las etiquetas son larguísimas; subirlo, casi nunca.
- `tone` se reenvía al segmentado. **Antes de escribir un control a mano,
  mirar si lo que falta es una prop del canónico**: una prop de menos empujó a
  una vista a saltarse el componente y, con él, el umbral.
- Al estimar si un riel entra, contar MAYÚSCULAS con tracking, no caracteres:
  `SegmentedControl` pinta `font-black uppercase tracking-widest
  whitespace-nowrap`.
- **Un conteo que vive en una opción APAGADA se pierde al plegar a select.** Si
  se pliega, el conteo va a la etiqueta de la opción PUESTA, con una palabra que
  diga de qué lado está.
- Antes de esconder algo por defecto, probar si alcanza con poder filtrarlo.

#### Muchos chips en una ranura: casi siempre son UN select

Si media docena de chips contestan **la misma pregunta** ("¿qué recorte quiero
ver?"), son un `FilterBar.Opciones` con `umbral={0}`, no seis interruptores: los
chips rompen el cupo de la píldora (cuentan como una sola ranura enorme) y
mienten sobre cómo se usan (parecen combinables). Cada opción lleva **su conteo
en la etiqueta** (`261 Excesos`) y las que dan cero no se listan.

**La acción que sólo sirve dentro de una opción se muestra sólo ahí** (p. ej.
"Restaurar ocultos" aparece con la opción "Ocultos" puesta).

#### `FilterBar.Sucursal` — la ranura de ámbito

```jsx
<FilterBar.Sucursal value={sucursal} onChange={setSucursal} options={branchOptions} />
```

La primera del orden. Texto canónico **"Sucursales"**: nombra el filtro, se lee
igual puesto o no, y ocupa la mitad. Normaliza también la opción "todas" que
venga dentro de `options` (el valor no se toca, sólo cómo se lee). El divisor la
separa de los filtros.

### 17.0 Medidas fijas: la tarjeta, el carril y el cupo de ranuras

| pieza | medida |
|---|---|
| `StatCard` | mínimo **148**, máximo **200**, separación 8, cupo **5** |
| detalle de la tarjeta | cede bajo **176** |
| `CarrilCards` | **una sola fila**, siempre; lo que no entra se desliza |
| ranura de `FilterBar` | 150 (el control) + 8 de relleno |
| píldora | sin techo: **lo que mida mostrando todo** |

**Quién cede el ancho, en orden:** (1) el **detalle** de la tarjeta; (2) el
**texto** de las acciones —sólo lo reclama de vuelta si el carril ya muestra las
cinco—; (3) el **carril** se desliza; (4) las **ranuras vacías** van al panel de
desborde (`PanelDesborde`, tras un ícono con `Contador`); (5) **nunca** una
ranura aplicada. Las ranuras se **eligen** por prioridad pero se **dibujan** en
su orden original (ámbito → entidad → tiempo → estado). El resultado es
monótono: al agrandar la ventana nunca se ve menos que antes.

#### El carril y la píldora van en UNA fila

```jsx
<div className="flex flex-col lg:flex-row lg:items-center gap-3">
  <CarrilCards className="flex-1" ariaLabel="Resumen">{tarjetas}</CarrilCards>
  <div className="flex justify-end min-w-0"><FilterBar onClear={limpiar}>{ranuras}</FilterBar></div>
</div>
```

Canónico: `StaffManagementView.jsx`. Las **dos** mitades son obligatorias: el
`lg:flex-row` del contenedor y el `flex-1` del carril.

- **No es estética.** `useMedidaFila` (`FilterBar.jsx`) busca el carril en la
  fila y le descuenta `RESERVA_CARRIL` (2×148+8+10 = 314px). Con la píldora en
  otro renglón lo encuentra igual y le roba 314px **en silencio**.
- **La píldora NO baja de renglón, nunca — el que cede es el carril** (regla
  del usuario). Nada de `flex-wrap`/`lg:flex-wrap` en esa fila. Un carril
  recortado al lado de la píldora no es un defecto: su piso son esos 314px.
- **Una excepción medida no se copia.** `ClientesView` separa carril y píldora
  con una medición propia; antes de separar otros, medir *esa* píldora.
- **Verificar a dos anchos**: a 1280 el carril desliza y la acción queda en
  ícono; a 1600 todo entra.

Lo vigila **`carril-pildora`** de `gate:design`, en cero y bloqueante
(`flex-wrap` descalifica aunque esté `lg:flex-row`).

#### El cupo es de la VISTA, no del dato

**Cuántas tarjetas hay lo fija la vista, nunca el dato.** Un carril de largo
variable es un desglose por categoría disfrazado de métricas; su lugar es una
ranura de la píldora (`FilterBar.Opciones`, `umbral={0}`) con el conteo en cada
opción. Lo vigila un `console.warn` de desarrollo en `CarrilCards` (el conteo
sólo existe en ejecución); avisa en vez de recortar.

#### El ancho se MIDE, no se estima

`FilterBar` mide las piezas reales en un `useLayoutEffect` (antes del pintado) y
guarda la medida hasta que cambian los rótulos; el ancho de una acción es el de
su rótulo y ninguna constante lo representa. Lo único constante es la forma
degradada: un botón sin rótulo mide `w-9` (36px). **Se observa la FILA, no el
envoltorio de la píldora**: el envoltorio ajusta al contenido y medirlo es un
bucle.

#### Cuándo lleva color una tarjeta

**Por defecto NO.** Todas las tarjetas comparten `data-surface="card"`.

| pieza | ¿color? | por qué |
|---|---|---|
| el **número** (`valueCls`) | sí | rojo si es pérdida, verde si es meta: el color ES el dato |
| el **ícono** (`iconBg`+`iconCls`) | sí | identifica la categoría de un vistazo |
| el **fondo** y el **borde** | **no** | sólo el estado seleccionado, vía `tono` |

`tono` marca la tarjeta SELECCIONADA con `data-tono` (§5.1); paleta cerrada:
`brand`, `success`, `warning`, `danger`. `activeBg`/`inactiveBg` están
retirados.

#### El rótulo y el número

- **Rótulo: dos palabras, tres a lo sumo.** El matiz va al `sub`
  ("Modificados" + sub "precios o datos cambiados"). El `sub` lleva UN dato
  (§25.7).
- **El número encoge antes que cortarse**: baja a `text-body-lg` sobre 6
  caracteres y a `text-body` sobre 9, sin cambiar el ancho de la tarjeta.

#### `CarrilCards`

Una fila que desliza, en vez de un `flex-wrap` (que envolvía distinto en cada
ancho y estiraba a la huérfana). El sobrante **no se tira**: se ve como el borde
de la próxima tarjeta ("hay más"); **las flechas flotan**, no ocupan; y la
reserva mínima es de 2 tarjetas.

### 17.0.1 El rango de fechas se escribe compacto

En `PeriodPicker` **el año se escribe una vez y sólo si hace falta**:

| rango | se muestra |
|---|---|
| dentro del año en curso | `01/07 → 30/07` |
| otro año | `01/03 → 30/06/25` |
| cruza de año | `01/12/25 → 15/01/26` |

Los presets ganan: un rango que coincide con "Este mes" o con un mes entero se
muestra por su nombre.

### 17.1 `PeriodStepper` — correr el período

```jsx
import PeriodStepper from '../common/PeriodStepper';

<PeriodStepper
    unit="quincena" label="16 – 31 julio de 2026"
    isCurrent={esActual} nextDisabled={esActual}
    onPrev={anterior} onNext={siguiente} onReset={irAHoy} />
```

Va **dentro de una `FilterBar.Section`** cuando filtra la vista, o en la
cabecera de un widget con `size="sm"`.

| | |
|---|---|
| `unit` | **obligatorio**: arma el nombre accesible de las flechas |
| `onReset` + `isCurrent` | **la etiqueta ES el atajo de vuelta** al período actual. Sin `onReset` el rótulo es un `<span>`, no un botón muerto |

No confundir con `TablePagination` (paginar es navegar una lista) ni con
`PeriodPicker` (elegir un rango arbitrario).

### 17.1.1 Escanear un código — `onEscanear`

`ViewTabBar` acepta `onEscanear` y lo publica con el buscador por el canal de
vista: el botón de cámara aparece dentro del campo del header en escritorio y
dentro del campo de la barra flotante en táctil. **No se cablea a mano.**

- El lector es `LectorDeCodigo` (`components/common/`), montado **sólo mientras
  está abierto**, detrás de `lazy` + `Suspense`.
- **Escanear escribe en el buscador, no salta al producto**: el resultado se ve
  con el mismo filtro y se puede corregir a mano.
- Su vista de cámara es una excepción de color (`white` y `shadow-literal` en
  `EXCEPTIONS`): el `<video>` muestra la cámara, no el tema.

### 17.2 `TablePagination` — paginación

```jsx
import TablePagination from '../common/TablePagination';

<TablePagination page={pagina} totalPages={paginas} onPageChange={setPagina}
    pageSize={tam} onPageSizeChange={setTam} total={1284} unit="ventas" />
```

- Una sola píldora, en orden de lectura: **rango → navegación → tamaño**;
  `<nav aria-label>` con `aria-live` en el rango; el hover sale de
  `--lift-hover` (en Solid no se levanta). Sin animación de `framer-motion`.
- **El rango, no el total**: `1–25 de 1,284` dice dónde estoy y cuánto hay.
- **Sin números de página.** "pág. 1/52" es clickeable y se vuelve un campo.
- **Primera y última** aparecen con más de una página (en el teléfono, con más
  de dos).
- **Móvil (<720px):** una fila de ancho completo, flechas de 40px en los bordes,
  estado al centro; sin selector de tamaño.
- **Nunca escribir la paginación a mano.** Y no es un `SegmentedControl`:
  paginar es navegar, no elegir de un grupo (`role="radiogroup"` sería
  incorrecto).

### 17.3 `BarraFlotante` — los controles al alcance del pulgar (solo táctil)

En una pantalla de captura larga, la píldora del cuerpo desaparece tras el
scroll. En táctil `FilterBar` **es** un clúster fijo abajo a la derecha que se
esconde al bajar y vuelve al subir. **No se usa a mano ni se cablea**: el
canónico decide, igual que `LiquidSelect` abre `SelectorTactil`.

| elemento | de dónde sale |
|---|---|
| buscador | lo publica `ViewTabBar` por `CanalDeVista.js` (`buscador` en `FilterBar` sólo como override) |
| filtros | los `FilterBar.Section` de la propia píldora |
| acción principal | el `acciones[]` con `variant: 'primary'` |

Reglas de la anatomía (la misma que describe §15.5):

- **Orden `principal · acciones · buscador`.** Lo más tocado bajo el pulgar; lo
  que abre teclado, al extremo.
- **El buscador abre una fila PROPIA encima del clúster**, y los botones se
  quedan: buscar y filtrar no son excluyentes. No va en hoja (mientras se
  escribe hay que ver la lista filtrarse); los filtros sí, porque se aplican y
  se cierran.
- **La principal se ve distinta** (rellena y más grande) y **los disclosures
  llevan su estado**: el buscador muestra el término, las acciones un
  `Contador`.
- **Los rótulos bajo el ícono aparecen solos con más de un botón**, son de
  **una palabra** y llevan `truncate` (el ícono ya dice el verbo). Lo vigila
  `tests/e2e/rotulos-cluster-movil.spec.js`.
- **Cupo**: la principal aparte, UNA secundaria con botón propio; de dos para
  arriba se agrupan tras "Acciones" en hoja. Máximo cuatro columnas.
- **Material**: `MATERIAL_CLUSTER` (`card`) para el clúster, que flota y se
  queda en vidrio; `MATERIAL_HOJA` (`dropdown`) para lo que despliega, donde se
  lee. Ambos exportados por `HojaMovil.jsx`; el material sale de `data-surface`,
  nunca de clases `bg-surface-*`. No se agrega una superficie nueva (§6.0).
- **Capa `z-tabs` (30)**: debajo de cualquier hoja (`z-modal`) y del scrim del
  sidebar; encima del encabezado pegajoso de una tabla.

Detalles de implementación que no se re-descubren:

- **Portal al `body`, obligatorio**: un `fixed` dentro de un ancestro con
  `transform`/`filter`/`z-index` queda contenido por él.
- **El corte lo decide `useLayoutCompacto`**, el mismo hook que usa
  `FilterBar` (incluye el teléfono acostado). Si divergen, queda una franja con
  las dos cosas visibles o ninguna.
- **`type="text"` con `inputMode="search"`, nunca `type="search"`** (WebKit le
  dibuja su propia ✕).
- **El contenedor `fixed` NO se transforma**: un `translate` en un ancestro crea
  un backdrop root y el vidrio muestrea vacío (§5.ter). La animación va en el
  elemento que lleva el `data-surface`; `transition-transform` como utilidad.
- **Una sola barra a la vez**: `FilterBar` deja un ancla de 1px en el flujo y un
  `IntersectionObserver` decide cuál se muestra (las pestañas ocultas con
  `hidden` no intersectan).
- `flotante={false}` vuelve al botón + hoja inline, para un `FilterBar` dentro
  de un modal.

#### `CanalDeVista.js` — el cable entre las dos píldoras

`ViewTabBar` (por `filtersContent`) y `FilterBar` (por `children`) son
hermanas: el proveedor lo monta `GlassViewLayout`, su único ancestro común. Dos
canales en sentidos opuestos:

- **buscador** — `ViewTabBar` publica → `FilterBar` consume.
- **barra** — `FilterBar` publica → `ViewTabBar` consume, y con eso el header
  **no dibuja su lupa en táctil** (un solo acceso al buscador).

Sin proveedor (un `FilterBar` dentro de un modal) los hooks devuelven `null`.
Dos reglas del canal: **un `Map` por publicador, no un `useState`**
(`filtersContent` se monta dos veces, escritorio y móvil), y **el alta y la baja
van en efectos SEPARADOS** (juntas, la limpieza corre en cada render y los dos
canales entran en bucle: React #185).

## 18. Estados de vista — `StateViews`

Todo vive en `src/components/common/StateViews.jsx` (exporta `EmptyState`,
`Skeleton`, `SkeletonText`, `LoadingState`, `AiThinkingState`). Nunca se
reescribe el patrón con clases sueltas.

### 18.1 `EmptyState` — obligatorio donde puede haber cero datos

```jsx
import { EmptyState } from '../common/StateViews';

<EmptyState
    icon={FolderOpen}
    title="Sin documentos"
    subtitle="Aquí aparecerán tus constancias y boletas."
    action={<Button icon={Plus} onClick={crear}>Subir el primero</Button>}
/>
```

| prop | para qué |
|---|---|
| `icon` · `title` · `subtitle` | el contenido (el texto sigue §34.1–§34.3) |
| `action` | **la salida**. Sin ella es una pantalla muerta |
| `compact` | dentro de un panel o tarjeta, no a página completa |
| `iconClass` · `glowClass` | color semántico cuando el vacío tiene un matiz |

Distinguir **"no hay nada todavía"** de **"tu filtro no encontró nada"**: el
mensaje y la salida son distintos (crear el primero vs. limpiar el filtro).
`DataTable` tiene su propia prop `empty`.

### 18.2 `Skeleton` y `SkeletonText` — nunca un spinner de sección

```jsx
import { Skeleton, SkeletonText } from '../common/StateViews';

<Skeleton w={48} h={48} rounded="1rem" />
<SkeletonText lines={2} />
```

- **El spinner sólo va dentro de un botón** mientras una acción está en curso
  (`Button` ya lo hace con `loading`). Una sección que carga lleva esqueleto.
- `delayed` (por defecto) espera 250 ms antes de aparecer, para no parpadear en
  una carga rápida.
- `DataTable` acepta `loading` + `skeletonRows`.

### 18.3 `LoadingState` y `AiThinkingState`

**Una vista no escribe su spinner.** Sección → `LoadingState`, dentro de una línea → `variant="inline"`, botón → `Button loading`. `animate-spin` sólo vive en `components/common/` (gate `cargando-a-mano`, trinquete).

`LoadingState` cubre tres escalas —`route`, `content`, `inline`— para cuando
todavía no se sabe la forma del contenido. `AiThinkingState` es el estado de las
vistas con resumen generado.

## 20. Scrollbar

La barra del navegador no se ve nunca. Definición en `src/index.css`:
`html, body` llevan `scrollbar-width: none` (y `body::-webkit-scrollbar`
oculto), y la utilidad `.scrollbar-hide` hace lo mismo para cualquier
contenedor con `overflow-*-auto` (el `<nav>` del sidebar, el scroll de
`GlassViewLayout`, carriles). Si alguna vez hace falta una barra visible, tiene
que seguir el material del tema; no se expone la del navegador.

## 21. Platform & Native (Capacitor)

`capacitor.config.json`: `appId` `lat.farmasalud.portal`, `webDir` `dist`;
Capacitor 8.

- **Lo nativo se pide por la plataforma**, no desde una vista:
  `src/plataforma/ubicacion.js` carga `@capacitor/geolocation` con
  `await import()` sólo en la app (`esNativo()`), y registra
  `BackgroundGeolocation` para el rastreo en segundo plano. En el navegador la
  ubicación está apagada (`vercel.json` manda `geolocation=()`).
- Los dos plugins de ubicación están fuera del bundle web
  (`optimizeDeps.exclude` + `build.rollupOptions.external` en `vite.config.js`).
- Detección: `esMovilOApp()` de `src/plataforma/dispositivo.js` (reexportado
  como `isMobileOrApp` en `src/utils/helpers.js`). La lógica del núcleo no toca
  `window`/`navigator` directo (`gate:nucleo`).
- Antes de un APK: subir `versionCode` y `versionName` en
  `android/app/build.gradle`.

## 24. Search Patterns

Tres tipos de buscador en el portal. Toda búsqueda se mapea a uno de estos — nunca un cuarto patrón. Por qué: ver `docs/design/historia/24-buscadores.md`.

### 24.1 Tipo 1 — Header de vista (`ViewTabBar`)

**Dónde:** toda vista `GlassViewLayout` con pestañas. Cubierto en §14 ViewTabBar. El `searchTerm` vive en la vista y baja como prop a las pestañas. Nunca un input local dentro de una pestaña: el buscador de la vista vive en el header.

### 24.2 Tipo 2 — Inline / widget (`SearchInput`)

**Dónde:** tarjetas del tablero, cuerpo de modales, widgets internos y cualquier búsqueda fuera del header. **Componente:** `src/components/common/SearchInput.jsx`.

```
Input:  data-surface="input" (borde + fondo del tema activo)
        focus:outline-solid focus:outline-1 focus:outline-offset-[-1px] focus:outline-brand/60
        — 1px con offset negativo: se dibuja EXACTO sobre el borde, se lee como
          un cambio de color del borde, nunca como un anillo aparte
Ícono:  <Search> text-brand strokeWidth={2.5} — izquierda
Clear:  <X> hover:text-danger strokeWidth={2.5} — sólo con value
```

- **El foco va por `outline`, no por `border`.** La regla de `data-surface="input"` vive fuera de `@layer` y le gana siempre a un `focus:border-*` de Tailwind; `outline` es otra propiedad y no compite.
- **Gotcha de Tailwind v4:** con `outline-none` en la clase, un `focus:outline` no pinta nada (`--tw-outline-style: none` gana). Hace falta `focus:outline-solid` explícito. Vale también para `LiquidSelect` y cualquier anillo propio.
- `SearchInput` acepta `ref` (al `<input>` real), `disabled` y `onKeyDown`.
- En la variante `expandable` abierta el borde toma `accentColor` por `style` inline (un inline gana a la regla sin capa, y el color es dinámico).

| `size` | Altura | Usar en |
|---|---|---|
| `"sm"` | ~32px | cabecera compacta dentro de tarjetas, pickers |
| `"md"` | ~40px | buscador principal de widget o modal |

```jsx
import SearchInput from '../components/common/SearchInput';

<SearchInput value={search} onChange={setSearch} placeholder="Buscar producto..." size="sm" />
```

**Reglas:** nunca `<input type="text">` crudo para buscar; siempre con `smartFilter` o `tokenMatch` (§24.5); siempre el aviso fuzzy cuando `isFuzzy && searchTerm`.

### 24.3 Tipo 2b — Buscador expandible de widget (`SearchInput expandable`)

El criterio no es el espacio disponible sino el **rol** del buscador:

| Contexto | Componente |
|---|---|
| Un **control aparte** dentro de un widget, modal o pestaña | `SearchInput expandable` — **arranca colapsado siempre**, aunque sobre ancho |
| Pegado a una **lista de selección ya abierta** (picker, Tipo 3): campo y lista son una pieza | `SearchInput` estático |
| Filtra el **contenido principal de la vista** | buscador de `ViewTabBar` (Tipo 1) |

Comportamiento:
- Colapsado es un cuadrado de 32px (sólo ícono); se abre **hacia la izquierda**. El llamador lo pone en una fila `flex items-center justify-end gap-1.5` con los filtros DESPUÉS en el DOM, así quedan anclados a la derecha.
- Colapsa sólo si está vacío y se hace clic afuera.
- El ícono colapsado usa el `accentColor` de la categoría del widget, nunca `bg-brand` genérico.

```jsx
<div className="flex items-center justify-end gap-1.5 shrink-0">
  <SearchInput expandable accentColor="var(--warning)" value={search} onChange={setSearch} placeholder="Buscar producto..." />
</div>
```

### 24.4 Tipo 3 — Picker / selección

| Tamaño de la lista | Componente | Patrón |
|---|---|---|
| > 100 ítems (base) | `LiquidSelect` con `serverSearch` + `onSearchChange` | `normSearch()` antes del `ilike` |
| ≤ 100 ítems (memoria) | `SearchInput size="sm"` al tope de un `div` con scroll | `tokenMatch` en el cliente |

Nunca `<input>` crudo para un picker.

### 24.5 Lógica de búsqueda estándar

Todas las búsquedas usan `src/utils/searchUtils.js`:

| Función | Usar cuando |
|---|---|
| `normSearch(str)` | normalizar antes de un `ilike` — quita acentos, puntuación, mayúsculas |
| `tokenMatch(query, ...fields)` | listas chicas en memoria (pickers, < 200 ítems) |
| `smartFilter(query, data, getFields)` | cuerpos de pestañas y widgets — con fallback fuzzy |

```js
const { results, isFuzzy } = !searchTerm.trim()
    ? { results: base, isFuzzy: false }
    : smartFilter(searchTerm, base, r => [r.campo1, r.campo2]);
```

El aviso fuzzy va justo antes de la tabla/lista, y **es `Notice`** (§15.6), nunca un `<div>` con `bg-warning/10` a mano: el texto de un aviso usa el token `-text` de su color (`text-warning` sobre `bg-warning/10` da 2.16:1 y falla AA).

```jsx
{isFuzzy && searchTerm && (
    <Notice variant="warning" icon={Search} className="mb-3">
        Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
    </Notice>
)}
```

### 24.6 Contrato de apertura/cierre — obligatorio en todo buscador toggleable

Regla del usuario: *«TODOS deben funcionar así siempre.»* Vale para el Tipo 1, el 2b y cualquier toggle propio:

1. **Al abrir, foco automático** en el input.
2. **Escape cierra Y limpia** — nunca sólo una de las dos.
3. **Clic afuera cierra SÓLO si está vacío**; con texto se queda abierto.

**Canónico:** el hook `useSearchToggle`, en `src/plataforma/useSearchToggle.js`.

```jsx
import { useSearchToggle } from '@plataforma/useSearchToggle';

const { containerProps } = useSearchToggle({
    active: isSearchMode,
    value: searchTerm,
    onClear: () => setSearchTerm(''),
    onClose: () => setIsSearchMode(false),
});

<div {...containerProps}>…</div>
```

- `containerProps` se esparce en el contenedor que delimita «adentro», **botón que lo abre incluido** (si no, el clic en el botón cuenta como afuera y hace doble toggle).
- Es un atributo `data-search-toggle-id` y **no un `ref`** a propósito: `GlassViewLayout` monta `filtersContent` dos veces (escritorio y móvil), y un `ref` compartido apunta sólo a una copia — el clic en la visible se leía como «afuera» y cerraba el buscador.
- El hook se llama **antes** de cualquier `return` temprano (reglas de hooks).
- `LiquidSelect` tiene su propio Escape/clic-afuera y limpia SIEMPRE: ahí el texto es un filtro de la lista abierta, no un resultado que se pueda perder.

**Gate:** categoría `search-toggle` — un `useState(false)` cuyo nombre termina en `Search{Open,Mode,Active,Expanded,Visible}` o empieza con `showSearch`, en un archivo que no importa `useSearchToggle`. Es una heurística de nombre: un toggle con otro nombre se le escapa, y eso se arregla ampliando el regex o con una excepción documentada (hoy: `AppLayout.jsx`, el modal ⌘K, que cierra como modal).

## 25. Accessibility

Por qué de cada regla de esta sección (mediciones e incidentes): ver `docs/design/historia/25-accesibilidad.md`.

### 25.0 Foco visible

Una sola regla global en `src/index.css` (bloque «ACCESSIBILITY — FOCUS RINGS»):

```css
button:focus-visible,
input:not(.outline-none):focus-visible,
select:not(.outline-none):focus-visible,
textarea:not(.outline-none):focus-visible,
a:focus-visible,
[role="button"]:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}
```

- **Una vista no escribe su propio aro ni lo apaga** (ver §29.1). El color sale de `--focus-ring-color`, que tiene valor por tema.
- **Los campos canónicos sí llevan `outline-none`, a propósito**: `PortalInput`, `SearchInput`, `LiquidSelect` dibujan el anillo sobre el **contenedor** (`inputHoverClass` de `src/utils/inputStyles.js`, `focus-within`), para que se ilumine la caja entera. No es un hueco: un campo de texto matchea `:focus-visible` también con clic de mouse (especificación), así que `focus-within` y `focus-visible` sólo se separarían si hubiera **otro** control enfocable dentro del campo — y §15.11 manda que la acción vaya afuera.
- Dentro del sidebar el anillo va hacia adentro (el panel es `overflow-hidden`).
- El PIN del kiosco (`.virtual-caret-orange`): el pulso del borde ES el indicador de foco (el cursor está oculto); con movimiento reducido se congela encendido.

### 25.0.1 Blancos táctiles

El mínimo de **44px** es WCAG **2.5.5 Target Size (Enhanced), AAA** —y la guía de Apple—, no 2.5.8 (que es 24×24, AA). El proyecto sostiene 44 a propósito, y lo garantiza `--tap-min` (§25.6), no la buena voluntad de cada tamaño.

### 25.0.2 ARIA en los canónicos

- `ModalShell`: `role="dialog"`, `aria-modal="true"`, `aria-label`. `LiquidModal` pasa `ariaLabel`; **todo modal lo recibe con su título real** (sin él se anuncia el genérico «Ventana modal»).
- `LiquidSelect`: patrón combobox/listbox completo — `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; opciones con `role="option"` + `aria-selected`. El disparador es un `<div>` (contiene un `<input>`), así que lleva `tabIndex`, abre con Enter/Espacio/Flecha-abajo y **devuelve el foco** al cerrar. **Poner el `role` es la mitad fácil:** un `role` sobre un `<div>` promete un contrato de teclado que hay que implementar entero.
- Grupos del sidebar (`AppLayout`): `aria-expanded` + `aria-controls`.
- `PortalInput`: `id`/`<label htmlFor>`, `aria-required`, `aria-invalid` y `aria-describedby` al badge de Requerido/error. Lo usan **~162 archivos**: por eso arreglar el canónico arregla todos los formularios.

### 25.1 Nombre accesible

**Todo control interactivo necesita un nombre.** Dos categorías del gate, en **cero absoluto**:

| categoría | qué marca |
|---|---|
| `button-name` | `<button>` cuyo contenido son sólo íconos, sin `aria-label` ni `title` |
| `input-sin-nombre` | `<input>` sin `aria-label` y sin `<label htmlFor>` que lo apunte |

**El `placeholder` no es un nombre accesible**: desaparece con contenido y varios lectores no lo exponen. `SearchInput`, `ViewTabBar` y `CatalogOtherInput` ponen `aria-label={ariaLabel ?? placeholder}`. Una celda de grilla densa sin etiqueta visible igual necesita su `aria-label`.

### 25.2 Cuál atributo de estado, y cuándo

| atributo | cuándo | cuándo NO |
|---|---|---|
| `aria-pressed` | interruptor de dos estados que se queda puesto | una acción que se ejecuta y ya (ocultar ESTE producto) |
| `aria-expanded` | algo que se despliega (grupo del menú, combobox) | — |
| `aria-current` | dónde estás (`"page"` en el nav, `"step"` en un asistente) | selección dentro de un control (`aria-pressed`/`aria-selected`) |
| `aria-sort` | el `<th>` por el que está ordenada la tabla | los demás `<th>`: se omite |
| `aria-busy` | contenedor que recarga sin desmontarse | — |

Un botón que actúa sobre una fila no tiene estado propio: es una acción.

### 25.3 Teclado en tablas (`DataTable`)

- **Fila clicable** (`DataRow` con `onClick`): `tabIndex={0}`, responde a Enter/Espacio, con la guardia `if (e.target !== e.currentTarget) return;`.
- **Columna ordenable**: el rótulo va en un `<button>` real dentro del `<th>`, con `aria-label` que dice qué va a pasar («Ordenar por Sucursal, ascendente») y `aria-sort` en el `<th>`; `flex-row-reverse` si la columna alinea a la derecha.

### 25.3.1 `prefers-reduced-motion`

Implementado en `src/index.css` (bloque antes de `@media print`):

- **Apagadas** (bucles infinitos / desplazamiento grande): `animate-ambient-drift(-reverse)`, `animate-shimmer`, `glow-danger`, `glow-warning`, `badge-pulse`, `animate-wiggle`, `animate-tab-enter/exit-*`, `animate-stagger-child`, `animate-input-reveal`, `animate-route-enter`, `animate-view-enter`.
- **Reducidas** a `rm-fade-in` 120ms de opacidad: `animate-kpi-enter`, `animate-widget-enter`, `animate-widget-settle`, `animate-table-row-enter`.
- **Skeleton**: sin animación, fondo sólido.
- **Congelada encendida**: `.virtual-caret-orange:focus` (ver §25.0).
- El lift de hover (`hover:translate-y-[var(--lift-*)]`) no se toca: vive en `@media (hover: hover)`. **Nunca se escribe con el número clavado** (`hover:-translate-y-0.5`): gate `lift-clavado`; en un control va `var(--lift-hover)`, en una superficie `var(--lift-card)`.

Se verifica midiendo, no leyendo la lista:

```js
const page = await browser.newPage({ reducedMotion: 'reduce' });
getComputedStyle(el).animationName   // debe dar 'none'
```

### 25.4 Las DOS superficies bespoke — lista CERRADA

**El cuerpo de toda vista sigue el tema, sin excepción**: modales, tarjetas, paneles, chips, gráficos. Sólo dos superficies quedan fuera, y la lista **no se amplía**:

| superficie | por qué |
|---|---|
| **Kiosco** (`components/timeclock/`) | tablet de pared con luz fuerte: el contraste alto sobre negro es parte de que se lea de lejos, y nadie elige tema ahí |
| **Login** | no sabe todavía quién es el usuario, así que no puede seguir SU tema: sigue `prefers-color-scheme` del sistema con los temas sólidos (`solid` / `solid-dark`, `LoginView`) y devuelve el tema previo al salir |

**El sidebar NO es bespoke: sigue el tema** por sus tokens `--sidebar-*` (`AppLayout`). En Liquid claro es un panel claro con texto oscuro. Sus popovers anclados usan la paleta del sidebar (`--sidebar-pop-tint`/`--sidebar-pop-fill`) y no `data-surface="dropdown"`: son parte del chrome. Al cambiar un token del sidebar, el texto de este documento cambia en el mismo commit.

Agregar una tercera superficie exige decisión explícita del usuario, no un `bg-slate-900` puesto al pasar. «Cuidado, esto es peligroso» se dice con **color semántico** (un `Notice` `warning`, un borde `danger`), que el tema sabe adaptar.

**Excepción dentro de la excepción:** la consola de log de `TabStaff` (salida del motor de sincronización) se queda oscura con texto mono verde: ahí lo oscuro es lo que la hace leerse como terminal.

### 25.5 Bespoke en COLOR no es bespoke en MATERIAL

Que una superficie tenga color propio (hoy el kiosco y el login) no la exime del material del tema. El sidebar hereda `--backdrop-card` —su vidrio ES el de la tarjeta— y `--card-shadow`; su relleno de 0.72 es un límite medido de contraste, no una preferencia. **En móvil va opaco y sin blur, y no es regresión**: se desliza con `transform`, que lo vuelve backdrop root (§5.ter).

### 25.6 `--tap-min`: el piso del dedo

`--tap-min` vale `0px` con puntero fino y `44px` con puntero grueso — va por **puntero, no por ancho** (una laptop táctil también tiene dedos). Todo tamaño que se deriva restando de `--control-h` lleva el piso **dentro** del `max()`:

```jsx
// ❌ el piso se pierde al restar
sm: 'h-[max(34px,calc(var(--control-h)-6px))]'
// ✅ el piso va DENTRO del max()
sm: 'h-[max(34px,var(--tap-min),calc(var(--control-h)-6px))]'
```

- `Button iconOnly` tiene altura propia (`ICON_ONLY_SIZE` reemplaza a `SIZE_CLASSES`, no lo complementa).
- El botón de ordenar de `DataTable` ocupa la celda con `-my-2 py-2 min-h-[var(--tap-min)]`.
- Un control que **no puede crecer** (el chevron de `LiquidSelect`, el aspa, la flecha del carril) agranda sólo el área tocable con `.blanco-tactil`: se ve chico y se toca como uno de 44px. No es una técnica para repartir.

### 25.7 Texto que no puede envolver, se corta

`StatCard` envuelve etiqueta y subtítulo bajo 560px (`max-[560px]:whitespace-normal`); el **valor** mantiene `nowrap` en todo ancho.

**El `sub` de una `StatCard` lleva UN dato, dos como mucho y cortos.** La tarjeta topa en 200px: quedan ~22 caracteres en `text-micro`.

- Un dato por `sub`; si hay dos que importan, el segundo es otra tarjeta.
- Dos sólo si caben en el **peor caso** (el número más largo que puede tomar).
- Nunca «se ve en el tooltip»: la tarjeta no tiene tooltip; el `aria-label` lleva el texto entero para el lector de pantalla.
- Lo que no entra va a la nota del panel que lo explica.

Lo verifica `barrido-escritorio.spec.js`: reporta cualquier `[data-texto-metrica]` cuyo `scrollWidth` supere su ancho.

### 25.8 `clickable()`

`src/utils/clickable.js` le da el contrato de teclado a un elemento que se comporta como botón sin serlo (fila, celda, tarjeta que envuelve otros controles):

```jsx
<div {...clickable(abrirEditor)} className="flex items-center gap-2">…</div>
```

Devuelve `role="button"`, `tabIndex={0}`, **`onClick`** y un `onKeyDown` que dispara con Enter/Espacio e **ignora las teclas que burbujean** desde adentro.

- Un helper que **recibe** el handler cablea los dos caminos (clic y teclado).
- **No todo `onClick` sobre un `<div>` es un botón**: `onClick={e => e.stopPropagation()}` es una barrera de evento y va pelado, sin `clickable`.
- **Una migración masiva que reescribe JSX sólo se da por buena si se ejercita el resultado**: build + lint + gate en verde significa que compila, no que el control sigue haciendo lo que hacía.

### 25.9 Qué cuenta como target

Antes de contar un control como target, preguntar si es *el* control o el adorno de otro. No cuentan:

| se excluye | por qué |
|---|---|
| `aria-hidden="true"` + `tabIndex={-1}` | duplica una acción de un control mayor (el chevron de `LiquidSelect`) |
| `.sr-only` con etiqueta visible | el `<input>` 1×1 emparejado por `peer`: el target es la etiqueta |
| caja ≥44 encogida por un `scale` de ancestro oculto | medir la caja, no el rect transformado |
| el `<input>` interno de `PortalInput` (42px) | `elementFromPoint` sobre el borde devuelve el input: el target es el contenedor de 44 |

Las barras de un gráfico quedan bajo 44 a propósito: el ancho de la barra ES el dato (excepción de presentación esencial de 2.5.5; 2.5.8 se cumple).

### 25.10 Los canónicos no escriben su altura como literal

Un canónico va por `max(<altura de diseño>, var(--tap-min))` —o por `--control-h`, que ya lo incluye—:

| canónico | altura |
|---|---|
| `SegmentedControl` | `h-[max(28px,var(--tap-min))]` / `max(36px,…)` |
| `LiquidSelect` | `min-h-[max(40px,var(--tap-min))]` |
| `PortalInput` | `h-[max(40px,var(--tap-min))]` |

Las variantes densas (`compact`, `nano`) se quedan en 32/26px y reciben el área tocable por `.blanco-tactil`.

### 25.10-bis Bajo una altura declarada, el contenido no lleva relleno vertical

Un `min-h` no compite con un relleno: se suman (`LiquidSelect` medía 46.3px junto a un `PortalInput` de 40). Cuando la altura está declarada —`h-`, `min-h-` o `--control-h`—, el centrado es del contenedor (`flex items-center`), no del padding. Lo ancla `tests/unit/altoDeLosControles.test.js`. Y un recuadro con `h-[40px]` literal al lado de un canónico coincide en escritorio y **no** en un teléfono (el canónico sube a 44).

### 25.10-ter El rótulo de un campo mide siempre lo mismo

**El alto del rótulo lo fija el rótulo, no su contenido**: 20px, con `rotuloCampo()` de `src/utils/rotuloDeCampo.js`.

- Una insignia dentro del rótulo va `size="sm"`.
- Una acción va `Button size="rotulo"` — el único tamaño que no crece con `--tap-min`; se toca como uno de 44 por `.blanco-tactil`.
- El espaciado lo trae el canónico: un rótulo dentro de un padre con `gap` no agrega el suyo.
- No envuelve ni se sale: cede el TEXTO del rótulo (puntos suspensivos), nunca el aviso.
- Un icono y su rótulo son UNA cosa: van juntos en el span de la izquierda.

**Gate:** `rotulo-de-campo-a-mano` (cero). Un rótulo es rótulo por tamaño y peso, no por su `tracking`. El limpiador de comentarios del gate es `scripts/lib/blanquearComentarios.mjs` (sabe cuándo está dentro de una cadena): **antes de creerle un cero a una categoría nueva, fabricarle la regresión que debería cazar.**

### 25.10-quater Canónico quiere decir en todas partes

- **Campo, select y fecha miden lo mismo**: 40px (32 en `compact`), en el mismo píxel. `LiquidDatePicker` dibuja su propia caja; el tinte de error/aviso entra por prop (`hasError`, `tono`), nunca por un envoltorio.
- `RangeDatePicker` va al alto canónico; `compact` conserva la FORMA de píldora, no una altura aparte.
- **`bare` queda fuera de la reducción**: significa «la caja la dibuja otro» (`FilterBar`, paginación, `TimePicker12`); el alto es del anfitrión y achicarlo sólo recorta el blanco sin que se vea.

### 25.11 Toda capa que se monta sobre la pantalla es un diálogo

Una capa que cubre la pantalla, atrapa el clic de afuera y contiene controles **es un diálogo**, aunque se llame hoja, panel o popover. Se monta con `ModalShell` (`role="dialog"`, `aria-modal`, Escape, bloqueo de scroll con restauración, animación). Anclajes: `center` (default), `top` (paletas de comandos), `bottom` (hojas táctiles). `ConfirmModal` incluido: cancelar con Escape es obligatorio.

No es diálogo un `LiquidSelect` abierto: es `role="listbox"` con `role="option"`.

## 26. Performance

Historia y mediciones: `docs/design/historia/26-performance.md`.

### 26.1 Capas de `backdrop-filter`

Una vista típica apila: orbes ambientales de `AppLayout` (`filter: blur(28–40px)`), el sidebar, el header de `GlassViewLayout` y la tarjeta del cuerpo — cuatro capas de composición antes de abrir un modal o un menú. Es manejable en un teléfono de gama alta y es la fuente principal de tirones en gama media. **Los temas sólidos lo resuelven solos**: `--backdrop-*: none` quita todo el vidrio sin tocar componentes.

### 26.2 Orbes ambientales

Cuatro orbes `position: fixed` en `AppLayout`, con los colores del logo (verde y magenta, §4). No repintan con el scroll, pero son capas de GPU persistentes; los temas sólidos los apagan.

### 26.3 Qué se anima

**Sólo `transform` y `opacity`.** Excepciones aceptadas, sin agregar nuevas:

| Animación | Propiedad | Costo |
|---|---|---|
| `glow-danger-anim`, `glow-warning-anim` | `box-shadow` | pintado por cuadro |
| píldora activa del sidebar | `top` | layout durante 320ms |
| acordeón de `TabMinMax` | `height` (`willChange: 'height'`) | reflow |

### 26.4 `will-change` y `transform-gpu`: regidos por §5.ter

Un `will-change` de `transform`/`opacity`/`filter` o un `transform-gpu` vuelven al elemento **backdrop root** y apagan el vidrio de todo lo que tiene adentro. Por eso:

- **Nunca en un envoltorio.** Gate `backdrop-root` (cero): `transform-gpu` / `will-change-transform` en un tag sin `data-surface`.
- Lo que existe hoy es puntual y no envuelve vidrio: `willChange: 'backdrop-filter'` en el header sticky de `GlassViewLayout` y `willChange: 'height'` del acordeón de `TabMinMax`.
- El lift de hover pone `transform` sólo mientras el puntero está encima: aceptable.

### 26.5 Carga diferida

- Las fotos de persona se cargan diferidas dentro de `AvatarConEstado` (§5.4).
- `BranchesView`: `contentVisibility: 'auto'` + `containIntrinsicSize` en las tarjetas fuera de pantalla.
- Las librerías pesadas, sólo por `await import()` (regla de `CLAUDE.md`, gate `gate:bundle`).

## 27. Cross-Browser

- **Safari:** toda regla `[data-surface]` de `src/index.css` lleva `-webkit-backdrop-filter` junto a `backdrop-filter`, y los `style` inline usan `WebkitBackdropFilter`.
- **Reset:** `@import "tailwindcss"` trae Preflight. No hay otra capa de normalize.
- **Sin `backdrop-filter`:** no hay bloque `@supports` automático; esas superficies se ven translúcidas sin desenfoque. El respaldo manual son los temas sólidos. Si algún día hace falta uno automático, va como `@supports not (…)` que sube la opacidad de las superficies — hoy no existe.

## 28. Page States

### 28.1 Sin conexión

`src/components/common/OfflineBanner.jsx`, montado una vez en `AppLayout`. Escucha `navigator.onLine` y los eventos `online`/`offline`; pinta un aviso fijo arriba al centro (`z-banner`) con `WifiOff` «Sin conexión», y «Conexión restaurada» que se va solo a los 3 s. No bloquea la UI; `role="status"` + `aria-live="polite"`.

### 28.2 Ruta inexistente

`<Route path="*">` pinta `NotFoundView` (`src/App.jsx`), con el patrón de estado vacío (§18) y su botón de volver al inicio. Además: `AccessDeniedView` cuando falla el permiso de una ruta conocida, y `NoAccessView` en `/no-access` para quien no tiene ningún módulo.

### 28.3 Error de render

`src/components/common/ErrorBoundary.jsx` (componente de clase, `getDerivedStateFromError` + `componentDidCatch`) envuelve las rutas autenticadas. Al fallar: `console.error`, `appendAuditLog('ERROR_RENDER', …)` vía `useStaffStore.getState()`, y una tarjeta canónica (`data-surface="card"`) con `AlertTriangle`, «Algo salió mal» y el botón «Recargar». Sigue el tema activo.

## 29. Forms & Validation

Historia (las versiones anteriores de esta sección y por qué cambiaron): `docs/design/historia/29-formularios.md`.

### 29.1 Inputs — `PortalInput`

```jsx
import PortalInput from '../common/PortalInput';

<PortalInput name="dui" label="DUI" icon={CreditCard}
    value={form.dui} onChange={handle} required maskType="dui" />
```

Trae etiqueta (opcional), badge de **Requerido**, borde de error, máscara, ícono y `compact`. Todo formulario lo reusa; ranuras en §15.11.

**En una vista, el aro de foco NO se escribe ni se apaga.** Lo pinta la regla global (§25.0). Un `outline-none focus:ring-*` en una vista reinventa el aro y deja el campo sin foco visible (WCAG 2.4.7). Los únicos que llevan `outline-none` son los **canónicos** que dibujan su anillo en el contenedor (§25.0).

```jsx
// ❌ en una vista: reinventa el aro, y además lo apaga
className="outline-none focus:ring-4 focus:ring-brand/10"
```

### 29.2 `PortalTextarea` — campo de varias líneas

```jsx
<PortalTextarea label="Motivo" name="motivo" rows={3} required
    value={motivo} onChange={e => setMotivo(e.target.value)}
    placeholder="Describe la solicitud…" />
```

Comparte con `PortalInput` etiqueta, badge, borde de error y `data-surface="input"`; sólo crece en alto.

- **`rows`, no una altura en píxeles**: el alto de un texto se mide en líneas.
- **`resize-none` a propósito**: el tirador nativo no sigue el tema.
- **La etiqueta es opcional.**

`<textarea>` nativo es bloqueante en el gate (categoría `native`), igual que `<select>` y `window.confirm`.

### 29.3 Casillas y opciones

`<input type="checkbox">` **nunca** — `Checkbox` (§15.4). Una de pocas opciones (3 como máximo): `SegmentedControl` (§15.3); más, o de datos: `LiquidSelect`.

### 29.4 Estado deshabilitado

Sale del componente (`disabled` en `Button`, `PortalInput`, `Checkbox`). No se escriben clases `disabled:` a mano.

### 29.5 Validación — tres cosas distintas

El **indicador de requerido** y el **error de envío** no compiten: son dos problemas, y cada uno tiene su canónico.

**(a) Campo requerido** — lo dibuja `PortalInput`: el badge «Requerido» aparece cuando el campo es `required` y está vacío, con `aria-invalid` y `aria-describedby` ya resueltos. No se escribe a mano.

```jsx
<PortalInput label="Nombre" name="nombre" value={nombre} onChange={handle} required />
```

**(b) Error de un campo** — también del canónico: `hasError` + `errorMessage` reemplazan el badge por el mensaje y marcan el borde.

```jsx
<PortalInput label="Correo" name="correo" value={correo} onChange={handle}
    hasError={!!errores.correo} errorMessage={errores.correo} />
```

**(c) Error de envío o de servidor** — arriba del botón de enviar, con `Notice` (§15.6). Un mensaje largo pasa solo a forma de bloque.

```jsx
{globalError && <Notice variant="danger">{globalError}</Notice>}
```

## 30. Governance

### 30.1 Extender, no crear

Antes de crear un componente, verificar:

| Necesidad | Canónico |
|---|---|
| Overlay / modal | `ModalShell`, `LiquidModal`, `UnifiedModal`, `ConfirmModal`, `AlertModal` (§14) |
| Select / desplegable | `LiquidSelect` |
| Tooltip | `LiquidTooltip` (§15.10) |
| Tabla de datos | `DataTable` (§14) |
| Envoltorio de vista | `GlassViewLayout` + `ViewTabBar` (§13, §14) |
| Foto de una persona | `AvatarConEstado` (§5.4) — nunca `LiquidAvatar` suelto |
| Toast | `useToastStore` (vía `LiquidToast`) |
| Campo de formulario | `PortalInput` / `PortalTextarea` (§15.11) — `label` es opcional |
| Tarjeta / contenedor | `data-surface="card"` (§5), con `data-tono` si lleva estado (§5.1) |
| Buscador | `ViewTabBar` · `SearchInput` · `SearchInput expandable` (§24) |
| Botón | `Button` (§15.2). Las acciones de una vista se declaran como descriptores de `FilterBar` (§17), que las dibuja con `TabBarAction` (§15.5) |
| Una de N opciones | `SegmentedControl` **hasta 3** (§15.3, gate `segmentado-largo`) · `LiquidSelect` arriba de 3 · `FilterBar.Chip` si es un filtro (§17) |
| Etiqueta de estado | `Badge` (§16.1) |
| Contador sobre un ícono | `Contador` (§16.2) |
| Aviso inline | `Notice` (§15.6) |
| Fecha | `LiquidDatePicker` — nunca `<input type="date">` |

Crear un componente paralelo está prohibido: se extiende el existente o se discute antes.

**El hueco casi siempre está en el canónico, no en la vista.** Cuando alguien escribió un control a mano, casi siempre fue porque al canónico le faltaba una ranura: se agrega la ranura. **Antes de migrar una vista al canónico, leer sus props** — migrar sin mirar borra atributos reales sin que falle nada.

### 30.2 Changelog

El historial de cambios del portal vive en `CHANGELOG.md`; el de este documento, en git. La tabla de versiones que vivía acá está archivada en `docs/design/historia/30-gobierno.md`.

## 31. Anti-Patterns (Never Do)

El mapa completo regla → categoría del gate está en §35.

- Indicador de color de borde izquierdo (`border-l-4 border-red-500`) en filas, tarjetas o listas. Gate `left-border` (`border-l-{2,4,8}` sin `border-r` en la misma línea; el par es un spinner).
- `transition-all` — transiciones por propiedad. Excepción: animaciones multi-propiedad sin shorthand (la expansión del buscador de `ViewTabBar`).
- `active:scale-90/95` — mínimo `active:scale-[0.97]`. Gate `scale-tap`.
- `hover:-translate-y-*` con número clavado — `var(--lift-hover)` / `var(--lift-card)`. Gate `lift-clavado`.
- `font-normal` o `font-light` en elementos interactivos.
- `text-slate-300/400` (o cualquier gris crudo) como texto. Gate `color`.
- `animate-bounce` decorativo sin propósito. Usos legítimos, y sólo estos: puntos de «escribiendo…», el pastel de cumpleaños, el ícono de error del kiosco (`FeedbackOverlay`).
- **framer-motion decorativo.** Permitidos `AnimatePresence`, `layout`, `layoutId` y `drag` (lo que CSS no puede hacer); prohibido `motion.*` decorativo, que se hace con `@keyframes` + Tailwind. Gate `motion`.
- `<select>` nativo — `LiquidSelect`. Gate `native`.
- Métrica héroe: un número grande solo con una etiqueta mínima y sin contexto.
- Tarjetas con el mismo peso visual en una grilla (sin jerarquía).
- `backdrop-filter` o fondo de superficie escrito en un componente cuando `[data-surface]` cubre el caso. Gate `vidrio-a-mano` / `material-a-mano`.
- Fuentes web por `@import` o `<link>` — sólo la pila del sistema.
- Envolver `DataTable` en una segunda tarjeta: ya dibuja la suya (§14).

## 32. Mobile & Responsive Standard

El estándar móvil de toda vista nueva. El canon que hay que conocer antes de
tocar una tabla, una ficha o un diálogo está en §32.7–§32.9; los gates son
`npm run gate:movil` (lee el fuente), `tests/e2e/barrido-total-movil.spec.js` y
`tests/e2e/dialogos-movil.spec.js` (ver `CLAUDE.md`, «el teléfono no es la
pantalla chica»). Por qué: ver `docs/design/historia/32-movil.md`.

### 32.1 Breakpoints y densidad

| Breakpoint | Rol |
|---|---|
| `lg:` (1024px) | **Frontera de shell y de teléfono.** Por debajo: layout móvil (sidebar overlay, body scroll), `DataTable` en fichas, `ExpedienteMovil`. En código el corte es `CORTE_TELEFONO = '(max-width: 1023.98px)'` (`components/common/usarExpediente.js`), el mismo que usa `DataTable`. |
| `md:` (768px) | Ajustes de **layout interno** (columnas de formulario, tamaño de controles). Nunca decide el modo. |
| `sm:` | Sólo retoques de espaciado o tipografía. |
| `1152px` / `1440px` + alto `<820h`/`<700h` | **Niveles de densidad**, ortogonales al shell. |

Los niveles de densidad son tokens en `:root` de `index.css`, iguales en los
cuatro temas:

| Token | Cómoda (≥1440w y ≥820h) | Compacta (<1440w o <820h) | Ultra (<1152w o <700h) | Táctil (`pointer: coarse`) |
|---|---|---|---|---|
| `--space-card-padding` | 24px | 16px | 12px | 14px |
| `--control-h` | 40px | 36px | 32px | 44px |
| `--row-h` | 44px | 38px | 32px | 44px |
| `--header-h` | 72px | 56px | 44px | 56px |

Compacta y ultra sólo aplican con `pointer: fine`. Se consumen como valor
arbitrario (`p-[var(--space-card-padding)]`, `h-[var(--control-h)]`). En ultra
el sidebar colapsa a rail (`isUltraDensity` en `AppLayout.jsx`). 1024×768, el
mínimo soportado, cae en ultra.

### 32.2 La tabla del canon — qué usa cada necesidad en el teléfono

| Necesidad de la vista | Escritorio | En el teléfono (<1024px) |
|---|---|---|
| Lista de registros | `DataTable` + `DataRow`/`DataCell` | **el mismo**: cae solo a fichas (§32.5) |
| Detalle de una fila | fila expandida o modal | **`ExpedienteMovil`** — `variante="auto"` (hoja que crece) o `"pantalla"` |
| Cuerpo de un modal | `LiquidModal` / `ModalShell` | **`HojaMovil`** (entra desde abajo) + **`AsaHoja`** de tirador |
| Controles de la vista | header + botones | **`BarraFlotante`**, al alcance del pulgar. Sólo táctil |
| Filtros | `FilterBar` | **el mismo**: publica sus ranuras en `BarraFlotante` |
| Pestañas de la vista | `ViewTabBar` | **el mismo**: bajo `lg:` colapsa a `LiquidSelect` |
| Elegir de una lista larga | `LiquidSelect` | **`SelectorTactil`** |
| Métricas de cabecera | fila de `StatCard` | **`CarrilCards`** — desliza; dos por pantalla |
| Elegir 1 de N | `SegmentedControl` | **el mismo**: envuelve y sube a 44pt |
| Interruptor | `Switch` | **el mismo** + área de impacto de 44 |
| Control cuyo tamaño **es** el diseño | — | **`.blanco-tactil`**: separa el área de impacto del tamaño pintado |
| Tabla que **no** es una lista de registros | `DataTable` | `movil={false}` → carril. Es la excepción y se justifica |

El checklist paso a paso de una vista nueva, con sus gates, está en
`docs/CHECKLIST-VISTA-NUEVA.md`.

**Variante de `ExpedienteMovil`:** si el detalle son secciones e historiales,
`pantalla`; si es una lista de líneas, la hoja (`auto`, el default). Adentro del
panel, **cero tablas** en los dos casos.

### 32.3 El encabezado de una vista en el teléfono: DOS COLUMNAS

En `<lg` el encabezado de `GlassViewLayout` es **una sola fila**: título a la
izquierda, `filtersContent` (casi siempre el `ViewTabBar`) a la derecha. Tres
piezas, en orden:

1. **`basis-0` + `grow` en la columna del título.** Pide 0 por adelantado, así
   que nunca fuerza el salto de línea, y después crece hasta el hueco.
2. **`line-clamp-2` + `leading-tight` en el `h2`, nunca `truncate`.** Dos
   renglones de `text-body-xl` (40px) entran en los 48 de la barra de pestañas:
   el encabezado no crece por partir el título. Recortar el nombre de la vista
   está prohibido.
3. **El selector cede ancho** (`ViewTabBar`, `clamp(8.75rem, 34vw, 11.875rem)`).

Por qué: ver `docs/design/historia/32-movil.md`.

### 32.4 Blancos táctiles e inputs

**44×44pt para todo blanco** (`button`, `a[href]`, checkbox/radio,
`[role="button"]`) — WCAG 2.5.8. Se escribe con `min-h-[var(--tap-min)]` /
`min-w-[var(--tap-min)]`, que vale 0 en escritorio (§25.6). Tres reglas:

- **Cuando el tamaño pintado es el diseño**, no se agranda el control: se separa
  el área de impacto con `.blanco-tactil`. Cuando el tamaño ES el dato (una
  barra cuyo ancho codifica una proporción) se declara `data-medida="dato"`.
- **Lo que no cabe se mide, y lo que cabe también — ninguno se declara.** Siete
  columnas de gráfico en 390px no dan 44: el medidor lo resuelve con aritmética
  —`(ancho − huecos) / columnas < 44`—, no con una lista de excepciones atada a
  un texto que hay que acordarse de escribir.
- **El tamaño de blanco se decide por `(pointer: coarse)`, nunca por el ancho.**
  `useLayoutCompacto` responde «¿hay sitio?», no «¿hay dedo?».

**Ningún campo de texto bajo 16px.** Un `<input>`/`<textarea>` (salvo
checkbox/radio/range/color/file) con `font-size` < 16px hace que iOS Safari
amplíe la página al enfocar. El piso es **`text-body-xl`** (16px, §7) — nunca
`text-[16px]` ni otro `text-[Npx]`. Lo vigila `small-input` de
`npm run gate:design`: falla `text-xs`/`text-sm`/`text-[Npx]` (N<16) en la
apertura de un campo real, salvo bajo `placeholder:` (sólo afecta al
placeholder y no dispara el zoom).

El buscador de vista vive en `ViewTabBar` y su contrato en §24; los buscadores
escritos a mano los vigila `search-toggle`.

### 32.5 Tabla → fichas

`DataTable` cae solo a **fichas** por debajo de `lg:`. La vista sigue declarando
`columns` + `DataRow`/`DataCell`. **Los papeles se INFIEREN de `columns`** — una
prop opt-in es una prop olvidada:

| Papel | Cómo se elige | Dónde aparece en la ficha |
|---|---|---|
| **identidad** | primera columna útil que no sea el ancla | título, arriba a la izquierda |
| **ancla** | última columna `align: 'right'` | el número, arriba a la derecha |
| **contexto** | las dos siguientes, priorizando las que no tengan `hideBelow` | línea tenue debajo, separada por `·` |
| **resto** | todo lo demás | la hoja que abre al tocar |
| **acciones** | rótulo vacío **o** clave `acciones`/`actions` | no se dibuja, salvo `movil={{ acciones: … }}` |

`movil={{ … }}` es un objeto de **overrides**, no un reemplazo:

| prop | cuándo |
|---|---|
| `ancla`, `identidad`, `chips` | fijar papeles a mano |
| `usarAccionDeFila: true` | la fila tiene un destino propio (§32.8) |
| `apilada: true` | la identidad es un bloque, no un nombre (§32.9) |
| `acciones: 'mantener'` | acciones detrás de la mantenida (§32.9) |
| `acciones: true` | tira visible al pie; sólo con una o dos acciones |
| `movil={false}` | la fila no es un registro (matriz, calendario). Exige motivo escrito |

**Lo que la ficha NO hace:** una fila que no sea `DataRow` —un `<tr colSpan>` de
detalle— no se pinta; si el número de celdas no coincide con el de columnas, la
fila se apila sin rótulos en vez de adivinar.

### 32.6 Áreas seguras (notch / barra de gestos)

`index.css` deriva `--sa-top`, `--sa-right`, `--sa-bottom` y `--sa-left` de
`env(safe-area-inset-*)`, y **eso es lo que se consume** — nunca `env()` escrito
a mano. Con el token una prueba puede pisarlo y medir si el marco se corre; con
`env()` a mano no, porque vale 0 en todo emulador. `max()` sólo si el inset es
el único relleno.

**Sigue abierto:** verificarlo en un teléfono real con notch y el shell nativo
de Capacitor (§21). Guion en `docs/PRUEBA-EN-TELEFONO-REAL.md`.

### 32.7 Acciones de fila en el teléfono: mantener presionado

Cuando una fila del teléfono tiene más de una acción, el gesto canónico es
**mantener presionado**, no deslizar.

**El criterio:** ¿el gesto puede *consumar* la acción? Si es irreversible lleva
confirmación, y deslizar cuesta los mismos toques que mantener sin sus
ventajas; además deslizar sobre una fila que no puede ejecutar la acción se lee
como pantalla colgada, pelea el eje con el scroll vertical y sostiene una sola
acción. Para algo barato y reversible (archivar, marcar leído) deslizar sí es
correcto.

- **El hook es `usePulsacionLarga` (`src/hooks/usePulsacionLarga.js`)** y
  resuelve el toque **y** la mantenida juntos: al soltar, el navegador dispara
  `click` igual, así que separarlos deja la fila navegando además de abrir la
  hoja. Trae `pointercancel`, la tolerancia de 10px y el apagado del menú
  contextual. La fila suma `select-none [-webkit-touch-callout:none]`.
- **El destino es `HojaMovil` dentro de `ModalShell`** (`align="bottom"`,
  `surface={null}`), que nace en gota del punto mantenido. Se ofrece sólo si hay
  más de una opción real, y la lista lleva una línea al pie que anuncia el
  gesto: un gesto que no se ve no existe.
- **El acuse es el FILO del canto, y no se escribe por vista.** El hook marca
  `data-manteniendo="true"` y `index.css` §1.6 («La mantenida») corre
  `filo-corre` sobre el `::after`. Una vuelta dura lo que la mantenida
  (`--pulsacion-retardo`, inyectado desde la misma constante del `setTimeout`):
  el barrido **es** la cuenta regresiva. Con `prefers-reduced-motion` el filo
  queda puesto y quieto.
- **No se anima `transform`** sobre un elemento con `backdrop-filter`: obliga a
  re-muestrear el fondo cada cuadro. El filo es `opacity`. Es la misma regla por
  la que `components/common/gotaApertura.js` anima `clip-path`.
- **El filo se declara con los TRES selectores** de `index.css` §1.6 más el
  atributo; con uno solo pierde en especificidad y barre un pseudo invisible.
- **La salida de la gota se anima con la WAAPI** (los dos extremos en los
  keyframes) y el desmontaje cuelga de su `onfinish`; el `setTimeout` es sólo un
  techo. Un cierre que se reporta «sin animación» y en WebKit de escritorio se
  mide perfecto es, casi seguro, este caso.
- **Un modal no hace `if (!isOpen) return null`**: `ModalShell` ya devuelve
  `null` al terminar de salir, y esa línea le quita la salida.
- **Una hoja que se cierra necesita DOS estados**: el registro se conserva
  mientras dura la salida y lo pisa la próxima apertura. `open={!!item}` con el
  cuerpo bajo `{item && …}` hace que la hoja desaparezca en vez de cerrarse.
- **Una fila suelta sobre la página va con `ListRow surface="card"`**, nunca con
  `bg-surface-card` a mano (copia el relleno y deja afuera vidrio, sombra y filo,
  §5).

Por qué: ver `docs/design/historia/32-movil.md`.

### 32.8 El toque de la ficha tiene que ir al MISMO sitio que el clic de la fila

En el teléfono el toque de una ficha abre, por default, una **hoja genérica**
con las columnas que no entraron. Si la fila tiene un destino propio (un modal,
un panel, una navegación), la hoja lo tapa. `DataTable` no puede distinguirlo
—un `onClick` es una caja cerrada—, así que **la vista lo declara**:

```jsx
<DataTable columns={columnas} movil={{ usarAccionDeFila: true }} />
```

| el `onClick` de la fila… | qué hace falta |
|---|---|
| abre un modal, un panel o navega | `movil={{ usarAccionDeFila: true }}` y nada más |
| expande un `<tr colSpan>` hermano | además, `ExpedienteMovil` — ese `<tr>` no se pinta en el teléfono |

La receta del segundo caso:

1. `const { enTelefono, abierto } = useExpedienteMovil(filas, expandedId)`
   (`components/common/usarExpediente.js`). El corte sale de ahí, **nunca** de un
   `useMediaQuery` propio, para que no diverja del de `DataTable`. `campoId`
   acepta una función cuando la clave no es una columna.
2. El cuerpo del detalle se escribe **una vez** — componente con prop
   `comoPanel`, o función local.
3. La expansión de escritorio se apaga en el teléfono:
   `{isExpanded && !enTelefono && <tr>…</tr>}`.
4. El expediente va **fuera** de la tabla, montado siempre (devuelve `null` sin
   fila abierta). `variante="pantalla"` cuando el detalle ES una pantalla.

Lo vigila **`toque-de-ficha-sin-destino`** de `npm run gate:movil`, bloqueante
en cero. **Lo que no ve:** filas envueltas en un componente propio
(`memo(EmployeeRow)`); eso lo cierra el barrido, gracias a `data-destino`, que
`Ficha` estampa en el DOM. Por qué: ver `docs/design/historia/32-movil.md`.

### 32.9 La ficha con celda rica: apilarla, y las acciones detrás de la mantenida

**`apilada`** — cuando la celda de identidad es un **bloque escrito para una
columna** (foto, nombre, insignias, existencias…), el reparto izquierda/derecha
la recorta. Con `apilada` la identidad usa el ancho completo y el ancla baja a
su propio renglón, separada por un filete. Es opt-in a propósito: desde afuera
no se puede medir si una celda es un nombre o un bloque, y el default es el
correcto para la mayoría.

```jsx
<DataTable columns={columnas} movil={{ apilada: true, acciones: 'mantener' }} />
```

**`acciones: 'mantener'`** — el gesto de §32.7 en la ficha canónica. La tarjeta
sigue siendo un botón (el toque abre su detalle) y **mantenerla presionada**
abre una `HojaMovil` con las acciones. Toque y mantenida salen del mismo
`usePulsacionLarga`. La lista lleva al pie «Mantén presionada una tarjeta para
ver sus opciones». `acciones: true` (tira visible) sólo sirve con una o dos.

**Lo que NO se surfacea**: una acción cuyo botón despliega un `<tr colSpan>`
hermano — su destino no existe en modo ficha. Va por `ExpedienteMovil` (§32.8).

**La celda de acciones cambia de forma sola.** `useEnHojaDeAcciones()`
(`components/common/hojaDeAcciones.js`) le dice a la celda que está en la hoja;
la presencia del contexto ES la señal (mismo contrato que `FichaCtx`). Se
resolvió con contexto y no con prop para no rendir la celda dos veces, y vive
fuera de `DataTable` porque `DataTable` importa `Button` y un ciclo ESM deja un
`undefined` en ejecución. Lo consultan:

- **`Button`** — un `iconOnly` recupera su rótulo desde `title`/`aria-label` y
  se dibuja como renglón de ancho completo.
- **`RowActions`** de Mín·Máx — lista las acciones completas, sin el desplegable
  «Más» que depende de `hover`.

La hoja además fuerza visibles las acciones envueltas en
`opacity-0 group-hover:opacity-100` y apila el contenedor de la celda. **Un
`<button>` escrito a mano no participa**: sale sin nombre. Por qué: ver
`docs/design/historia/32-movil.md`.

### 32.10 Viewport meta

El `<meta name="viewport">` de `index.html` lleva `viewport-fit=cover` siempre.
Un script en línea que corre antes de montar React conserva
`user-scalable=no` **sólo** en el build nativo de Capacitor
(`Capacitor.isNativePlatform()`), en la PWA instalada (`display-mode:
standalone` / `navigator.standalone`) y en `/kiosk`; en cualquier pestaña del
navegador lo reescribe sin `maximum-scale`/`user-scalable`, para no bloquear el
pellizco (WCAG 1.4.4).

## 33. Cómo se llama una vista

El nombre de una vista vive en varios lugares a la vez y nada los cruzaba: cambiar
uno solo deja a los otros contradiciéndolo. Por qué: ver
`docs/design/historia/33-nombres-de-vista.md`.

### 33.1 Dónde vive el nombre de una vista, y la regla de cada lugar

| dónde se lee | de dónde sale | quién lo ve |
|---|---|---|
| **el encabezado** (`GlassViewLayout title=`) | es el nombre **canónico**: los demás se derivan de él | dentro de la pantalla |
| **la pestaña del navegador** (`ROUTE_TITLES` en `App.jsx`) | **copiado del encabezado, letra por letra** | entre otras veinte pestañas |
| **el menú** (`MODULE_MAP.label` en `constants/moduleMap.js`; grupos en `constants/menuGroups.js`) | puede abreviar, porque se lee dentro de su grupo | en el menú lateral |
| **la pantalla de Permisos** (`constants/permissionModules.js`) | el mismo nombre del menú | en Permisos |
| **la dirección** (`<Route path>`) | el encabezado, en minúsculas y con guiones | en la barra de direcciones y en lo que se comparte |

Además dependen del nombre el vocabulario del cuerpo de la pantalla (§33.5) y el
mapa de precarga (§33.6).

1. **La pestaña se copia del ENCABEZADO, no del menú.** El menú puede abreviar
   («Listado» bajo Personal); la pestaña se lee sola.
2. **Toda ruta tiene título de pestaña.** Sin él dice «Portal FarmaSalud».
3. **La dirección va en español y nombra lo que abre** — la misma regla de §34
   (el portal no habla en la jerga de adentro) aplicada a la barra de
   direcciones, que se lee, se copia y se pega.
4. **La excepción es la ficha de detalle.** `/personal/empleado/:id` no tiene
   título fijo: lo arma `AppWithToast` con el nombre de lo que se abrió. No va en
   `ROUTE_TITLES`.
5. **Sentence case (§34.4) vale también para estos nombres**, con las excepciones
   de siempre: siglas (`IVA`, `MH`, `iOS`), nombres propios (`Corte Z`,
   `Min / Max`, `Portal FarmaSalud`) y términos ya decididos (`Sistema de
   Ventas` —nunca «ERP»—, `Bajo Receta`).
6. **Antes de renombrar una etiqueta, preguntarse si ese texto ES el dato.** Si
   es el `value` de un catálogo, cambiarlo exige migración; si el `value` es un
   código, el rótulo es libre. Ver «un rótulo no es una clave» en `CLAUDE.md` y
   `docs/planes-cerrados/PLAN-CATALOGOS-QUE-SON-SU-PROPIO-ROTULO.md`.

### 33.2 Renombrar una ruta: la vieja no se borra, redirige

Un favorito del navegador no vive en ninguna tabla, y las notificaciones ya
enviadas llevan rutas viejas. **La ruta vieja queda como redirección**, y si
tenía parámetros **la redirección los conserva**: un `<Navigate to="/personal">`
suelto desde `/dashboard/empleado/:id` deja a quien guardó un expediente mirando
el listado — peor que un 404, porque parece que funcionó. La receta completa
—los seis lugares que hay que tocar, incluida la consulta a `notifications`—
está al pie de `scripts/rutas-gate.mjs`.

### 33.3 Lo vigila `npm run gate:rutas`

Corre en el pre-commit cuando el commit toca `src/App.jsx` o
`src/constants/moduleMap.js`. Comprueba las reglas de §33.1, el espejo de §33.5,
el mapa de §33.6, y además **que ningún ítem del menú apunte a una ruta que ya
no existe**.

`HEREDADAS` (rutas en inglés pendientes) está **vacía y sólo baja**: agregar una
entrada también hace fallar el gate. Es la estructura que hace fallar a una ruta
nueva en inglés. `/monitor` se quedó porque «monitor» es español; `/roles` pasó a
`/cargos` porque el portal dice **cargo** (§34).

### 33.4 Un cero sin regresión fabricada no significa nada

En la primera corrida, dos de tres hallazgos eran del detector (una ficha de
detalle sin título, a propósito, y el tooltip de la flecha de volver leído como
encabezado). Los falsos positivos y las cinco regresiones que el gate tiene que
cazar están fabricados en `tests/unit/rutasGate.test.js`: al tocar el gate, se
corren.

### 33.5 El cuerpo de la pantalla tiene que hablar como su encabezado

Un encabezado que no comparte vocabulario con su propio cuerpo no es un título:
es una etiqueta que alguien puso una vez. Hoy: `/avisos` → «Gestión de avisos»,
`/cargos` → «Cargos y organigrama».

**El candado es el espejo:** el menú y el encabezado tienen que compartir al
menos una palabra. Corre en `gate:rutas`; las excepciones legítimas (hoy sólo
`/personal`, «Listado» bajo el grupo «Personal») van en `MENU_ABREVIA` con su
motivo. Contar la palabra del encabezado dentro del archivo **no** sirve como
gate: acusa a vistas correctas.

### 33.6 El mapa de precarga falla en silencio

`IMPORTADOR_POR_RUTA` (`src/routeImporters.js`) mapea el **primer segmento de la
ruta** (no la clave del módulo) a su vista, para empezar a bajarla cuando el
mouse pasa por el menú. Si la clave falta, `prefetchRuta` no hace nada: la vista
carga lento la primera vez, sin error ni log. **Se escribe a mano** —no hay
generador—, así que al agregar o renombrar una ruta se actualiza; `gate:rutas`
lo comprueba.

## 34. Voz — cómo escribe el portal

La palabra es la mitad de la identidad y la única primitiva que el gate no ve
mirando clases. Sin regla, cada quien escribe el mismo hueco a su manera. Por
qué: ver `docs/design/historia/34-voz.md`.

### 34.1 El vacío se escribe `Sin <sustantivo plural>`

Título, **sin punto final**, sin muletas:

```
✅ Sin cotizaciones          ❌ Aún no hay cotizaciones
✅ Sin proveedores           ❌ Sin proveedores registrados todavía.
✅ Sin registros             ❌ No hay registros
✅ Sin conteos de inventario ❌ Sin conteos de inventario registrados
```

`aún` y `todavía` prometen algo que la app no sabe; `registrados` es ruido.

### 34.2 Búsqueda sin resultados **no** es un vacío

Uno se arregla borrando el filtro, el otro creando el primer registro:
confundirlos manda a crear algo que ya existe. El título es siempre
`Sin resultados`; el término va en el subtítulo, entre comillas.

```jsx
// tabla vacía de verdad
<DataTable columns={columnas} empty={{ icon: Package, message: 'Sin productos' }} />

// hay filtro o término activo
<EmptyState compact icon={Search} title="Sin resultados"
            subtitle={`Ningún producto coincide con "${termino}".`} />
```

### 34.3 El vacío feliz es una tercera forma, y se respeta

Cuando «no hay nada» es buena noticia, se dice que ganó: `Todo está al día`,
`Expediente impecable`, `Sin saltos detectados`. La prueba: ¿el usuario quería
encontrar algo, o quería que estuviera vacío?

### 34.4 Sentence case en todo

Mayúscula en la primera palabra y ya: `Sin horarios`, `Datos incompletos`.
Nombres propios y siglas (`MH`, `SRS`, `ABC × XYZ`, `MIN/MAX`) como corresponde.
La única excepción es la etiqueta en versalitas de `text-caption` (§7), que va en
mayúsculas por tipografía, no por redacción.

### 34.5 El punto final: etiqueta o prosa

- **Etiqueta → sin punto.** Títulos, botones, badges, encabezados de columna,
  vacíos.
- **Prosa → con punto.** Subtítulos, mensajes de modal, errores: tienen verbo
  conjugado y le hablan a alguien.
- **Fragmento que continúa el título:** sin punto y en minúscula
  (`Selecciona un cargo` / `para modificar sus permisos de acceso`).

El gate aproxima «etiqueta» con ≤6 palabras y una sola oración; es un proxy, la
regla es la de arriba.

### 34.6 Los botones son verbos en infinitivo

`Guardar`, `Agregar producto`, `Confirmar conteo`. No `Guardado`, no `¡Guardar!`,
no `OK`: un botón dice qué va a pasar.

### 34.7 Tuteo, sin «por favor» y sin signos de exclamación

El portal usa **tuteo** (`Selecciona`, `Intenta`, `Crea`), nunca voseo. Nada de
`por favor`: la herramienta informa, no pide permiso.

```
✅ Selecciona un cargo               ❌ Seleccioná un cargo
✅ Revisa la conexión                ❌ Por favor revisá la conexión
✅ Conteo guardado                   ❌ ¡Conteo guardado!
✅ El cargo necesita un nombre.      ❌ ¡Ey! No puedes dejar el cargo sin nombre.
```

Los `¡…!` se prohíben en el **feedback del sistema** (toast, error,
confirmación, botón, vacío, badge), no en los momentos humanos. La lista completa
de excepciones: `FeedbackOverlay` (cumpleaños y aviso urgente del kiosco),
`LoginView` (`¡Acceso concedido!`) y `EmployeeProfileView` (`¡Hoy! 🎉`).

### 34.7b «Vitrina» o «estante» — nunca «anaquel»

Decisión del usuario (2026-08-25). **estante** es la genérica (bodega sólo tiene
estantes; una sala los tiene además de vitrinas); **vitrina** es el mueble de
exhibición de la sala; **las dos** cuando se habla del recorrido completo. Lo
vigila `copy-anaquel`, bloqueante en cero, fuera de comentarios.

### 34.7c «Aquí», nunca «acá»

Decisión del usuario (2026-08-26). Lo vigila `copy-aqui`, bloqueante en cero,
sobre texto de pantalla; los comentarios del repo no cuentan.

**Ninguna regla de vocabulario ve el texto que vive en Postgres.** Al cambiar
vocabulario, la búsqueda incluye `supabase/`, las funciones vivas
(`pg_proc.prosrc`) y los datos sembrados — no sólo `src/`.

### 34.7d Cómo se mide un gate de redacción

- `copy-vacio` acepta cualquier arranque `No <algo>` **menos los errores**
  (`No se pudo…`, `No puedes…`), que §34.8 manda escribir así.
- Las reglas de vocabulario **recortan el comentario dentro del renglón**
  (`// …`, `/** … */`, `{/* … */}`) antes de buscar.
- La lista de voseo de `copy-trato` se completa con un barrido de agudas en
  á/é/í sobre texto de pantalla, descartando el futuro de indicativo
  (`confirmará`).

**Antes de creerle un cero a un detector de redacción, fabricarle la regresión
que debería cazar.**

### 34.8 Un error dice qué pasó y qué hacer

```
✅ No se pudo guardar el conteo. Revisa la conexión e intenta de nuevo.
❌ Error: PGRST204 column "x" does not exist
❌ Algo salió mal
```

El código crudo va al log, nunca al usuario: un `error.message` se envuelve en
`mensajeAmigable()` (`utils/errorMessages`). Lo vigila `error-crudo`.

### 34.9 Qué vigila el gate, y qué no

`copy-vacio` y `copy-trato` miran **sólo los slots enumerados** —
`empty={{…message}}`, `<EmptyState title/subtitle>`, `message:` de
`AlertModal`/`ConfirmModal`— más el voseo en cualquier string de UI. Detectan:
punto final en un slot de una oración (§34.1, §34.5), arranques de vacío
prohibidos (§34.1), Title Case (§34.4) y voseo (§34.7). Lo que no pueden ver es
si el texto es *correcto* (un `Sin productos` con filtro activo viola §34.2):
por eso `EXCEPTIONS` se usa sin culpa cuando el texto está bien y el patrón se
confunde.

### 34.10 El gate de diseño no ve el estilo guardado en una constante

`gate:design` escanea atributos `className`. Un estilo sacado a una constante
sale de su alcance sin aviso:

```js
// ❌ vidrio a mano escondido en una constante
const GLASS = 'rounded-2xl border border-divider bg-surface-card backdrop-blur-sm shadow-[…]';
```

Eso es lo que `vidrio-a-mano` prohíbe (§5.bis). Antes de cerrar una auditoría de
estilo, grepear las constantes de clases
(`const [A-Z_]* = '.*(rounded-|bg-surface|backdrop-blur|shadow-)`). `shadow-sm`
suelto no es deuda: la sombra utilitaria es el idioma aceptado; el vidrio tiene
canónico (`data-surface`) y la sombra no.

## 35. Anexo — categorías del gate

Cada categoría de `scripts/design-gate.mjs` con la regla que vigila y la
sección donde está explicada. **Ninguna regla vive sólo en el gate**:
`npm run gate:doc` falla si aparece una categoría que no tenga fila aquí. Todas
están en cero y son bloqueantes salvo `tarjeta-a-mano`, que conserva deuda vieja
en `scripts/design-gate-baseline.json` (el número sólo baja). Las excepciones
por archivo viven en `EXCEPTIONS`, cada una con su motivo escrito.

| categoría | qué prohíbe (o exige) | § |
|---|---|---|
| `native` | `alert`/`confirm`/`prompt`, `<select>`, `<textarea>` e `<input type="date\|time\|…">` del navegador | §14, §15.12 |
| `input-a-mano` | un `<input>` de texto fuera de `PortalInput` | §15.11 |
| `monto-nativo` | un campo de dinero con `type="number"` — va `maskType="DECIMAL"` | §15.11.1 |
| `small-input` | un input o textarea con letra menor a 16px (iOS hace zoom al enfocar) | §29.1 |
| `select-con-envoltorio` | `LiquidSelect` metido en un div de alto fijo; el error va en `invalid` | §15.13 |
| `rotulo-de-campo-a-mano` | el rótulo de un campo escrito a mano — usar `rotuloCampo()` | §25.10-ter |
| `input-label` | input de texto sin nombre accesible | §25.1 |
| `input-sin-nombre` | input sin `aria-label` ni `<label htmlFor>` (el placeholder no cuenta) | §25.1 |
| `button-name` | botón de sólo ícono sin `aria-label` | §25.1 |
| `title-redundante` | un `title=` que repite el `aria-label` | §15.10 |
| `tooltip-no-control` | `title=` sobre un elemento no interactivo: gráfico → `role="img"`, prosa → `LiquidTooltip` | §15.10 |
| `inert` | región colapsada sin `inert`: el tabulador entra a lo invisible | — (esta fila) |
| `ring` | aro de foco o de borde con un alfa fuera del canon (`/30` en 1px, `/45` en 2px) | — (esta fila) |
| `scale-tap` | `active:scale-90`/`95` — el mínimo es `active:scale-[0.97]` | §31 |
| `left-border` | `border-l-*` decorativo como indicador de color | §31 |
| `color` | grises crudos de Tailwind (`slate`/`gray`/`zinc`/`neutral`/`stone`) | §6 |
| `white` | `bg-white`/`text-black` y similares crudos — van tokens | §6 |
| `hex` | un hex escrito en `className` o `style` | §6 |
| `inline-color` | `rgb()`/`hsl()` literal fuera de un token | §6 |
| `paleta-cerrada` | un color fuera de la paleta: marca, severidad y cinco categóricos | §6.0 |
| `chart-retirado` | `chart-2`/`5`/`7`/`8`, retirados — el gate dice cuál usar | §6.0 |
| `relleno-sin-solid` | `text-white` sobre un relleno de severidad sin la variante `-solid` | §6 |
| `tema-incompleto` | un token de color fuerte que Solid redefine y `[data-theme="dark"]` no | §2.1 |
| `typography` | tamaño de letra a mano (`text-[Npx]`, decimales o `rem`) o bajo el piso legible | §7 |
| `texto-tailwind` | `text-xs`…`text-xl` de Tailwind en vez de la escala del portal (cero absoluto) | §7 |
| `z-index` | `z-[N]`, `z-50` sin nombre o `zIndex` inline fijo — van los `z-*` con nombre | §9 |
| `shadow-literal` | una sombra literal fuera de la escala `--shadow-*` | §3 |
| `tarjeta-a-mano` | una tarjeta armada con clases sueltas — va `data-surface="card"` | §5 |
| `lift-clavado` | `hover:-translate-y-N` con el número escrito, o sumado sobre una tarjeta que ya se levanta — `--lift-card` en superficies, `--lift-hover` en controles | §5, §2.1 |
| `vidrio-a-mano` | `backdrop-blur` y fondo translúcido fuera de una superficie canónica | §5.bis |
| `material-a-mano` | desenfoque arbitrario, `backdrop-filter` inline o realce interior blanco a mano | §5.bis |
| `backdrop-root` | `transform-gpu`/`will-change-transform` en un envoltorio: apaga el vidrio de lo que contiene | §5.ter |
| `reloj-a-mano` | duraciones de transición literales — salen de los tokens de tiempo | §11 |
| `motion` | `motion.*` de framer-motion decorativo; sólo `AnimatePresence`, `layout`/`layoutId` y `drag` | §11 |
| `capa-flotante` | un flotante anclado sin `useCapaFlotante`: lo de atrás sigue reaccionando al puntero | §5.2 |
| `puntero-lista` | un handler de puntero que recorre una lista o lee el layout por evento sin `requestAnimationFrame` | — (esta fila) |
| `scroll-encadenado` | un scroller de widget sin `overscroll-contain`: al terminar mueve el tablero | — (esta fila) |
| `icono-semantico` | un ícono retirado — un concepto, un ícono | §12 |
| `icono-rampa` | `size={N}` fuera de la rampa | §12 |
| `icono-stroke` | `strokeWidth` fuera de la escala 1 · 1.5 · 2 · 2.5 · 3 | §12 |
| `boton-sin-icono` | `<Button iconOnly>` sin `icon=` | §15.2 |
| `valor-inexistente` | `<Button variant\|size="…">` con un valor que no existe (se pinta el de por defecto) | §15.2 |
| `equis-destructiva` | el ✕ con `variant="destructive"`: cierra o quita, no borra — `ghost` | §15.2 |
| `cancelar-destructivo` | «Cancelar» con `variant="destructive"` — es `secondary` | §15.2 |
| `segmentado-a-mano` | una-de-N hecha con botones que comparan `=== valor` — es `SegmentedControl` | §15.3 |
| `segmentado-largo` | `SegmentedControl` con más de 3 opciones — va `LiquidSelect` | §15.3 |
| `chip-a-mano` | una píldora de estado escrita a mano — va `Badge` | §16.1 |
| `carril-pildora` | la fila del carril de tarjetas que envuelve, o `CarrilCards` sin `flex-1` | §17.0 |
| `celda-a-mano` | `<td>` a mano dentro de `<DataRow>` — va `DataCell` | §14 |
| `encabezado-de-modal-a-mano` | `LiquidModal.Header` sin `titulo` — el encabezado lo arma el canónico | §14 |
| `pestana-fuera-de-la-url` | la pestaña activa en `useState` — va `usePestanaEnUrl` | §14 |
| `prop-inexistente` | un prop que el canónico no acepta, o que pisa después de `{...rest}` | §14 |
| `import` | un canónico usado sin importarlo (el build no lo detecta) | §14 |
| `search-toggle` | un buscador que se abre y cierra sin `useSearchToggle` | §24 |
| `foto-sin-aro` | la foto de una persona fuera de `AvatarConEstado` | §5.4 |
| `foto-condicionada` | `photo ? <Avatar/> : …` — se condiciona sobre la persona, no sobre la foto | §5.4 |
| `foto-sin-identidad` | `AvatarConEstado` sin `id`: sin él no hay estado | §5.4 |
| `avatar-fuera-de-escala` | un tamaño de foto fuera de `TAMANOS_DE_AVATAR` (20, 28, 36, 48, 64, 104) | §5.4 |
| `aviso-a-mano` | `{error && <p className="…text-danger…">{error}</p>}` en vez de `<Notice variant="danger">` (cero absoluto) | §29 |
| `cargando-a-mano` | `animate-spin` en una vista en vez de `LoadingState` / `Button loading` (trinquete) | §18.3 |
| `editor-dos-veces` | abrir el editor de foto sin mirar `yaPreparado`: la foto del teléfono se cuadra dos veces | — (esta fila) |
| `copy-vacio` | un vacío que no dice `Sin <sustantivo>`, Title Case o punto final en una etiqueta | §34.1, §34.4, §34.5 |
| `copy-trato` | voseo — el portal tutea | §34.7 |
| `copy-anaquel` | «anaquel» — se dice «vitrina» o «estante» | §34.7 |
| `copy-aqui` | «acá» — se dice «aquí» | §34.7 |
| `error-crudo` | `error.message` crudo a la pantalla — va `mensajeAmigable()` | §34.8 |
| `try-finally-mudo` | `try/finally` sin `catch` en una acción: si falla, nadie se entera | — (esta fila) |
| `formato-cifra` | un `toLocaleString` con locale ajeno o `$${x.toFixed(2)}` — va `formatMoney`/`formatNumber` de `utils/formatNumber` | — (esta fila) |
| `ventana-noopener` | `window.open(…, '_blank')` sin `noopener` | — (esta fila) |

