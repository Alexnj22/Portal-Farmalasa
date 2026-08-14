# Portal Farmalasa — Design System

> **v2.0 — 2026-07-24** — refleja el cierre de T7 (`AUDITORIA-TEMA-2026-07.md`):
> color 100% tokenizado (T7.1, 119 archivos), sombras consolidadas al 56%
> en 19 tokens canónicos (T7.3), matriz de QA de 4 temas verificada (T7.2).
> Decisión sobre Liquid Glass ya tomada (T7.5): se mantienen los 4 temas,
> reestructurados como 2 ejes (Estilo/Modo) en `ThemeToggle` — ver §2.

## Cómo usar este doc

1. **Antes de escribir cualquier control, mirá el índice de canónicos de abajo.**
   Si el control existe, se usa; no se reescribe. Cuando se midió el proyecto,
   había 940 botones, 316 chips y 3 implementaciones de switch escritas a mano
   — casi siempre porque quien las escribió no sabía que el canónico existía.
2. **Todo valor visual nace en §3 (Tokens).** Un color, un radio o un tamaño que
   no salga de un token es deuda, aunque hoy se vea bien.
3. Si el control **no** existe: se propone el canónico. No se resuelve inline
   "por esta vez" — así es como aparecieron los 316 chips.
4. Toda UI nueva pasa **§31 Anti-Patterns** y `npm run gate:design`.

### Índice de canónicos

| control | componente | §ectión |
|---|---|---|
| botón | `Button` | §15.2 |
| una de N opciones | `SegmentedControl` | §15.3 |
| encendido/apagado | `Switch` | §15.4 |
| casilla | `Checkbox` | §15.4 |
| acción en la barra de vista | `TabBarAction` | §15.5 |
| aviso inline | `Notice` | §15.6 |
| fila de lista | `ListRow` | §15.7 |
| barra de filtros de la vista | `FilterBar` | §17 |
| correr el período (‹ etiqueta ›) | `PeriodStepper` | §17.1 |
| paginación de tabla | `TablePagination` | §17.2 |
| adjuntar archivo | `FileField` | §15.8 |
| nota al pasar el puntero | `LiquidTooltip` | §15.9 |
| etiqueta de estado | `Badge` | §16.1 |
| campo de formulario | `PortalInput` | §29.1 |
| campo de varias líneas | `PortalTextarea` | §29.2 |
| desplegable | `LiquidSelect` | §14 · §15.13 |
| desplegable de lista LARGA en táctil | `SelectorTactil` (lo abre `LiquidSelect` solo) | §14.1 |
| controles de la vista en táctil | lo hace `FilterBar` solo — `BarraFlotante` no se usa a mano | §17.3 |
| fecha / rango | `LiquidDatePicker` · `RangeDatePicker` | §14 |
| barra de vista con buscador | `ViewTabBar` | §24 |
| vacío · esqueleto · cargando | `StateViews` | §18 |
| modal | `LiquidModal` sobre `ModalShell` | §14 |

**Lo que este documento verifica de sí mismo:** `npm run gate:doc` pasa todos
los ejemplos de código de acá por el mismo gate que el código. Se agregó en D4
porque el documento tenía 21 menciones de radios fijos y 10 de `shadow-glow` —
enseñaba exactamente lo que el gate prohíbe. Un documento no se desactualiza de
golpe: se desactualiza porque nada lo revisa.

---

> Source of truth for all visual and interaction patterns.
> Stack: React 18 + Vite + Tailwind CSS v4 (`@tailwindcss/postcss`, CSS-first config) + custom Liquid Glass CSS.
> Platform: Web (desktop/mobile) + native iOS/Android via Capacitor v8.2.0.

---

## 1. Philosophy — Liquid Glass

Portal uses a single design language called **Liquid Glass**: frosted translucent surfaces, radial-gradient ambient backgrounds, white micro-borders, and multi-layer shadows. Every surface floats over the gradient background rather than being painted on a flat canvas. On Solid themes the blur is removed, but the same token architecture drives everything.

**Rules that never bend:**
- No left-border color indicators on rows, cards, or lists (ever).
- Text on glass always ≥ `text-slate-600` (labels) / `text-slate-500` (sub-text). Never `text-slate-300/400` over a light surface.
- Hover effects only fire on pointer devices — all hover CSS lives inside `@media (hover: hover)`.
- One icon library: Lucide React (`strokeWidth={1.5}` at rest, `2` when active).
- No `<select>` elements — use `LiquidSelect` everywhere.
- Audit log call required on every user-triggered mutation (`appendAuditLog` from `staffStore`).

---

## 2. Themes

Four named themes, controlled by `data-theme` on `<html>`. `liquid` is the
only one with no attribute (falls through to `:root` defaults).

| Theme key | `data-theme` | Description |
|---|---|---|
| `liquid` | *(none)* | LiquidGlass Light |
| `dark` | `dark` | LiquidGlass Dark |
| `solid` | `solid` | Solid Light — no blur — **default para usuarios nuevos (Fase T6)** |
| `solid-dark` | `solid-dark` | Solid Dark — no blur |

**Default cambió en Fase T6 (2026-07-23):** `resolveInitialTheme()` en
`ThemeContext.jsx` usa la preferencia guardada si existe; si no,
`solid`/`solid-dark` según `prefers-color-scheme` del SO (resuelto una
sola vez al cargar, no reactivo a cambios posteriores del SO) —
**Liquid Glass ya NO es el default**, sigue existiendo como opción
seleccionable vía `ThemeToggle`, montado permanentemente en el sidebar
(footer expandido + rail colapsado) desde T6.

**Decisión tomada (2026-07-24, T7.5)**: Liquid Glass sobrevive como tema
seleccionable — no se retira. Ver `AUDITORIA-TEMA-2026-07.md` §11.

**ThemeContext** (`src/context/ThemeContext.jsx`) persists choice to `localStorage` under key `portal-theme`.
Exposes `{ theme, setTheme, cycleTheme, isDark, isSolid, isLiquid, themes }`. `cycleTheme` (rotates
liquid → dark → solid → solid-dark → liquid) still exists but `ThemeToggle` no longer calls it —
see below.

**ThemeToggle** (`src/components/common/ThemeToggle.jsx`, rediseñado T7.5 2026-07-24) expone los 4
temas como **2 ejes independientes** en vez de un ciclo de 4 pasos — Estilo (Liquid Glass | Solid)
y Modo (Claro | Oscuro), cada uno un `data-surface="tab-track"` de 2 opciones (mismo patrón visual
que `ViewTabBar`). El trigger abre un popover portaled a `document.body` (`data-surface="dropdown"`,
mismo mecanismo de posicionamiento con tracking continuo vía `requestAnimationFrame` que
`LiquidSelect` — ver §17). Un tap en cualquier opción aplica `setTheme(combine(style, mode))` al
instante, sin paso "siguiente". Dos variantes:
- `'sidebar'` — fila completa (ícono + label de 2 líneas + chevron) en el footer del sidebar
- `'compact'` — botón cuadrado en el rail; el popover se posiciona a la derecha del botón (mismo
  criterio que los flyouts de navegación del rail)

Iconos: Layers (Liquid Glass) · Monitor (Solid) para Estilo; Sun (Claro) · Moon (Oscuro) para Modo.

---


### 2.1 Qué separa a Liquid Glass de Solid — el contrato (2026-07-27)

No son dos paletas del mismo diseño. Son **dos materiales**, y la diferencia
tiene que verse en cinco ejes. Escrito acá porque al medirlo el 2026-07-27
resultó que **75 de los 93 tokens de sombra/brillo eran idénticos entre los
dos**: Solid solo apagaba animaciones y blur, y seguía pintando halos de 40px y
`inset 0 1px 0 rgba(255,255,255,.85)` — un brillo blanco interior, que es
literalmente el artefacto que hace que algo lea como vidrio.

| eje | Liquid Glass | Solid | dónde vive |
|---|---|---|---|
| transparencia | superficies translúcidas + `backdrop-filter` | opaco, `backdrop-filter: none` | `--surface-*`, `--backdrop-*` |
| forma | píldora (`9999px`), tarjeta muy redondeada | rectángulo tenso (8–12px) | `--btn-radius`, `--card-radius` |
| sombra | doble eje: elevación **+ brillo interior** | solo elevación, y más corta | `--shadow-glass-*`, `--shadow-shine*` |
| color de acento | halo difuso de 8–40px | **aro nítido** de 1–3px | `--shadow-glow-*` |
| hover | **se levanta**: el control `-1px`, la superficie `-3px` | el control no se mueve; la superficie cede **`-1px`** — un guiño, no un salto | `--lift-hover`, `--lift-card` |
| movimiento | entradas, deriva ambiental, barrido | apagado | reglas `[data-theme="solid"] .animate-*` |

**Consecuencias para escribir código nuevo**

- Nunca clavar el lift — `hover:translate-y-[var(--lift-hover)]` en un control,
  `var(--lift-card)` en una superficie (§5). Los 176 que ya estaban escritos a
  mano se neutralizan con una regla de tema (`index.css`), pero eso es un parche,
  no el patrón — y sólo alcanza a las clases Tailwind: el canónico de la tarjeta
  estaba clavado en `-2px` y por eso se levantaba **también en Solid** hasta el
  2026-08-01.
- Nunca clavar un radio. `rounded-btn` / `rounded-card` ya cambian solos.
- `transition-all` en Solid se acota por regla de tema a color/fondo/borde/
  opacidad. Si necesitás animar geometría, nombrá las propiedades.
- Un `shadow-[var(--shadow-glow-*)]` da halo en vidrio y aro en sólido, sin que
  el componente sepa en qué tema está. Ese es el punto.

## 3. Design Tokens (CSS Custom Properties)

All tokens live in `:root` in `src/index.css` and are overridden by `[data-theme]` blocks. Every surface and backdrop value is consumed via `var()` — no component should hardcode backdrop-filter or surface background values.

### Page background
```
--bg-page: radial-gradient(ellipse at 38% 28%, #ddd8ff 0%, #e4e0ff 22%, #eae8ff 50%, #e2deff 100%)
```

### Text (light theme)
```
--text-primary   : #1e293b   (slate-800)
--text-secondary : #475569   (slate-600)
--text-tertiary  : #526279   (2026-07-25: bajado de #64748b/slate-500 — ver §22.1)
```

### Surface backdrops
```
--backdrop-card  : blur(44px) saturate(200%)
--backdrop-header: blur(32px) saturate(280%)
--backdrop-modal : blur(48px) saturate(160%)
```

### Surface backgrounds
```
--surface-page      : transparent
--surface-card      : rgba(230,245,255,0.16)
--surface-card-hover: rgba(230,245,255,0.26)
--surface-header    : rgba(210,235,255,0.12)
--surface-modal     : rgba(240,248,255,0.85)
--surface-input     : rgba(230,245,255,0.40)
--surface-dropdown  : rgba(240,248,255,0.72)
--surface-tab-track : rgba(210,235,255,0.35)
```

### Borders
```
--border-card  : rgba(255,255,255,0.72)
--border-header: rgba(255,255,255,0.75)
--border-modal : rgba(255,255,255,0.90)
--border-input : rgba(255,255,255,0.78)
--border-tab   : rgba(255,255,255,0.70)
--border-muted : rgba(0,82,204,0.06)
```

### Radii tokens (nombres primitivos — ver §3.1 sobre por qué no se llaman `--radius-*`)
```
--card-radius  : 1.75rem
--modal-radius : 2rem
--header-radius: 2.5rem
--btn-radius   : 9999px
--input-radius : 0.75rem
--badge-radius : 9999px
```

### Shadow tokens (nombres primitivos — mismo motivo, ver §3.1)

Sombras estructurales de layout (card/header/modal, consumidas vía `@theme
inline` como `shadow-card`/`shadow-modal` etc.):
```
--card-shadow            : inset 0 1px 0 rgba(255,255,255,0.85), 0 8px 32px rgba(0,0,0,0.07)
--card-shadow-hover       : inset 0 1px 0 rgba(255,255,255,0.90), 0 16px 40px rgba(0,0,0,0.10)
--header-shadow           : 0 24px 50px -12px rgba(0,0,0,0.18)
--modal-shadow            : 0 32px 80px rgba(0,0,0,0.18), inset 0 2px 0 rgba(255,255,255,0.95)
--btn-brand-shadow        : 0 4px 14px rgba(0,82,204,0.28)
--btn-brand-shadow-hover  : 0 8px 20px rgba(0,82,204,0.40)
```

### Escala canónica de sombras (Fase T7.3, 2026-07-24)

Antes de T7.3, cada vista escribía su propio `shadow-[0_Npx_Mpx_rgba(...)]`
a mano — auditoría encontró **974 usos, 556 valores únicos** sin ningún
sistema detrás (el mismo problema que T7.1 resolvió para color). Estos 14
tokens (+5 agregados en la 2ª pasada para glows categóricos) reemplazan la
fragmentación real — **542 de 967 usos (56%) ya migrados**. Deliberadamente
NO usan el namespace `--shadow-*` de `@theme` (ese lo ocupa Tailwind para
generar `shadow-sm`/`md`/`lg` nativos — 960 usos sanos que no se tocan) —
se consumen vía arbitrary value: `className="shadow-[var(--shadow-md-token)]"`.

```
/* Elevación neutra — reemplaza ~295 usos de sombra negra pura */
--shadow-elevation-xs: 0 2px 8px rgba(0,0,0,.04)    /* reposo: fila, chip */
--shadow-elevation-sm: 0 4px 16px rgba(0,0,0,.06)   /* tarjeta pequeña */
--shadow-elevation-md: 0 8px 28px rgba(0,0,0,.08)   /* tarjeta / hover, la más común */
--shadow-elevation-lg: 0 16px 48px rgba(0,0,0,.12)  /* panel flotante, dropdown */
--shadow-elevation-xl: 0 24px 64px rgba(0,0,0,.16)  /* modal, overlay principal */

/* Glass compound (inset claro + sombra exterior) — ~72 usos */
--shadow-glass-sm: inset 0 1px 0 rgba(255,255,255,.9), 0 2px 10px rgba(0,0,0,.06)
--shadow-glass-md: inset 0 2px 10px rgba(255,255,255,.4), 0 8px 24px rgba(0,0,0,.08)
--shadow-glass-lg: inset 0 2px 15px rgba(255,255,255,.7), 0 8px 30px rgba(0,0,0,.04)

/* Glow de marca + severidad (hover/focus) — ~208 + ~141 usos */
--shadow-glow-brand:   0 6px 20px rgba(0,82,204,.4)
--shadow-glow-success: 0 4px 15px rgba(18,183,106,.35)
--shadow-glow-warning: 0 4px 15px rgba(247,144,9,.35)
--shadow-glow-danger:  0 4px 15px rgba(240,68,56,.35)
--shadow-ring-brand:   0 0 0 4px rgba(0,82,204,.15)

/* Glow de acento categórico — mismo patrón, agregado en la 2ª pasada
   de T7.3 al descubrir que existían glows de chart-N no cubiertos por
   el mockup original (violeta/naranja/azul/dorado/pizarra) */
--shadow-glow-chart-1: 0 4px 15px rgba(59,130,246,.35)  /* azul */
--shadow-glow-chart-3: 0 4px 15px rgba(139,92,246,.35)  /* violeta */
--shadow-glow-chart-4: 0 4px 15px rgba(249,115,22,.35)  /* naranja */
--shadow-glow-chart-7: 0 4px 15px rgba(234,179,8,.35)   /* dorado */
--shadow-glow-chart-8: 0 4px 15px rgba(100,116,139,.3)  /* pizarra */
```

**Qué queda sin tocar (~426 usos, decisión deliberada):** shadows de
**varias capas combinadas** (p.ej. un anillo de foco + glow + highlight de
glass en una sola declaración con 3-4 grupos separados por coma). Forzar
esos a un solo token aplanaría una composición que hoy tiene más de una
intención visual superpuesta — eso es rediseño, no consolidación de
duplicados, y no estaba dentro del alcance aprobado. Mismo criterio que el
resto de excepciones documentadas en este archivo: no mecanizar lo que
requiere criterio caso por caso.

### Semantic color tokens (index.css `:root`) — MIGRACIÓN COMPLETA (Fase T7.1, 2026-07-24)
```
--brand:        #0052CC
--brand-dark:   #003D99
--brand-purple: #6929C4
--success: #12B76A
--warning: #F79009
--danger:  #F04438
--success-text/--warning-text/--danger-text: variantes theme-aware (ver §6)
```
Migración cerrada: **119 archivos, ~1,400+ usos de color crudo (`bg-emerald-500`, `text-red-600`, etc.) reemplazados** por `bg-success`/`text-warning-text`/etc. — ya no hay una fase "pendiente", esto es el estado real del código. Ver §6 (Color System) para la regla de 3 buckets que gobernó la migración y las excepciones documentadas.

### Focus ring, scrim, divisor (net-new, Fase T1)
Antes hardcodeados en cada punto de consumo — ahora son tokens únicos:
```
--focus-ring-color: rgba(0,82,204,0.55)   ← usado en la regla global :focus-visible (index.css)
--scrim:            rgba(3,11,28,0.50)    ← overlay de sidebar móvil, `bg-scrim` consumido en AppLayout.jsx desde T1 (v2.33.0)
--divider:          rgba(203,213,225,0.5) ← `bg-divider` consumido en el patrón `w-px h-N` de ~37 archivos (T7.5)
```

### Paleta dataviz — categórica, EN USO ACTIVO (Fase T7.1, extendida de 6 a 9)

9 hues, cada uno con su variante `-text` (AA-safe para texto sobre el
propio tinte de fondo, theme-aware: oscuro en temas claros, claro en
temas oscuros — mismo patrón que success/warning/danger):
```
--chart-1: #3b82f6  --chart-1-text: #1d4ed8  /* azul */
--chart-2: #10b981  --chart-2-text: #047857  /* esmeralda */
--chart-3: #8b5cf6  --chart-3-text: #6d28d9  /* violeta */
--chart-4: #f97316  --chart-4-text: #c2410c  /* naranja */
--chart-5: #06b6d4  --chart-5-text: #0e7490  /* cian */
--chart-6: #ec4899  --chart-6-text: #be185d  /* rosa */
--chart-7: #eab308  --chart-7-text: #854d0e  /* dorado, T7.1 */
--chart-8: #64748b  --chart-8-text: #334155  /* pizarra, T7.1 */
--chart-9: #14b8a6  --chart-9-text: #0f766e  /* teal, T7.1 — RequestsView necesitaba 9 categorías reales */
```

**La regla de 3 buckets** que gobernó toda la migración de T7.1 (aplica a
cualquier color nuevo que se agregue de aquí en adelante):
- **Bucket A — severidad real** (¿es un estado bueno/malo/atención?) →
  `success`/`warning`/`danger` (y variantes `Badge` component).
- **Bucket B — categórico genuino** (¿necesito distinguir varios
  tipos/categorías en la misma vista, sin jerarquía de severidad entre
  ellos?) → `chart-1`..`chart-9`, asignados por posición y reusados
  consistentemente entre archivos que comparten el mismo enum (p.ej.
  `RequestsView.jsx` y `EmployeeProfileView.jsx` usan el mismo mapeo de
  `VACATION`/`PERMIT`/`DISABILITY`/etc.).
- **Bucket C — decorativo sin valor informativo** → quitar el color, usar
  `bg-surface-card-hover` + `text-content-2` (neutro).

**Excepciones documentadas** (no se tokenizan, no son "color suelto sin
revisar" — fueron evaluadas y decididas explícitamente):
- **Superficies fijas-oscuras** (sidebar de AppLayout, paneles de kiosco,
  tooltips flotantes con `bg-slate-900/95`, el wallboard `isDarkConcept`
  de `AttendanceMonitorView.jsx`): usan la variante **base** de los tokens
  (`text-success`, no `text-success-text`) porque no seguían el tema activo
  — usar la variante `-text` ahí perdería contraste si el tema real fuera
  claro.
- **Shimmer decorativo de IA** (gradiente `indigo→purple→cyan`, idéntico en
  6+ archivos: `TabStaff.jsx`, `TabHistory.jsx`, `BranchesView.jsx`,
  `TabExpediente.jsx`, `FormAiSchedulerPreview.jsx`): es una identidad
  visual ya estandarizada por repetición exacta, no una duplicación por
  resolver.
- **`KpiCard`** (`color + '18'` string-concat para alpha): limitación
  técnica, no puede usar `var()` en ese contexto.
- **Leaflet/Google Maps markers, Recharts/canvas, plantillas de impresión
  PDF** (`CotizacionesView.jsx`, `PayrollView.jsx`, `CrearRutaModal.jsx`,
  `RutaMapModal.jsx`, props SVG de Recharts en `DashboardView.jsx`/
  `TabExpenses.jsx` — `stopColor`/`stroke`/`fill`/`tick`): colores hex
  directos, fuera del sistema de tokens CSS por naturaleza de la
  tecnología. **Excepción — no exención**: si el hex duplica un valor que
  YA tiene token (ej. el semáforo de volumen de transacciones), sigue
  debiendo consumir el token vía `var(--token)` como string — ver el caso
  de `DashboardView.jsx`/`SchedulesView.jsx`/`FormWfmAnalytics.jsx`/
  `ScheduleCalendar.jsx` corregido 2026-07-25 (5 archivos duplicaban
  `--txvol-*` a mano, sin sincronía si el token cambiaba).
- **Tooltips flotantes dark** (mismo patrón que el punto anterior, ahora
  con la lista completa de archivos): `FormWfmAnalytics.jsx`,
  `FormEditPayrollEntry.jsx`, `SidebarSyncStatus.jsx`,
  `LifecycleTimeline.jsx`, `ScheduleChart.jsx`, `EmployeeDetailView.jsx`,
  `AttendanceAuditView.jsx`, `VentasView.jsx`, `VacationPlanView.jsx`,
  `StaffManagementView.jsx`, `DashboardView.jsx` — solo la franja
  `bg-slate-800/900/950` + `text-white` del tooltip en sí, el resto de
  cada archivo SÍ está tokenizado.
- **Caja de IA siempre-oscura** (mismo criterio que el shimmer): `SalyCopilot.jsx`,
  `TabShifts.jsx`.
- **Superficies kiosco/cámara/editor** (pantallas que fuerzan
  `data-theme="dark"` en `<html>` mientras están montadas, o que son
  herramientas técnicas — canvas, video — donde el fondo oscuro no es
  negociable): `KioskConfigModal.jsx`, `FeedbackOverlay.jsx`,
  `PhotoEditorModal.jsx`, `LoginView.jsx` (solo el scanner de cámara + el
  fondo splash bespoke, comparte gradiente con `App.jsx`). `TimeClockView.jsx`
  ya NO cuenta como excepción de fondo/blobs (2026-07-25: migrado a
  `bg-surface-page` + los 5 blobs verde/magenta de `AppLayout.jsx`, mismos
  tokens que el resto del proyecto) — la excepción restante solo cubre los 3
  micro-acentos azules bespoke de la card del reloj (`from-blue-950/[0.30]`,
  `from-blue-400/[0.04]`, `via-blue-400/12`), un hero accent deliberado.
- **`ThemeToggle.jsx`** variante `dark`: documentado inline en el propio
  archivo — vivía dentro de un host siempre-oscuro (`SidebarSettingsMenu`).
  **Desactualizado desde 2026-08-05**: el sidebar dejó de ser siempre-oscuro y
  sigue al tema (PLAN-MATERIALES §12.1). Sus `bg-white/N` pasaron a
  `rgb(var(--sidebar-ink)/N)`, que conserva la alfa exacta y sólo invierte la
  base — en los temas oscuros la tinta vale `255 255 255`, o sea idéntico a lo
  que había.
- **Ilustraciones/branding de terceros**: `FormAuditDetail.jsx` (semáforo
  real de ventana macOS — colores exactos de Apple), `AccessDeniedView.jsx`
  / `NoAccessView.jsx` (verde real de marca WhatsApp `#25D366`),
  `ThemeMigrationRibbon.jsx` (franja rayada ámbar/naranja bespoke, texto
  fijo, no reactiva al tema).
- **Vistas de diagnóstico/QA** (no son UI real de negocio, mismo criterio
  que el archivo de preview): `RawTestView.jsx`, `IOSTestView.jsx`.

### Gate mecánico permanente (`scripts/design-gate.mjs`, desde 2026-07-25)

Todo lo anterior (T7.1 + T7.1c + esta pasada) se auditó a mano con regex de
una sola sesión que luego se perdían — la razón real por la que
`border-slate-*`, `ring-*`/`via-*`, y toda la paleta cromática (purple/
green/orange/pink/blue/etc., no solo grises) se filtraron sin detectar
durante meses (ver `feedback_shadow_color_gate_lessons` y este mismo
hallazgo repetido). Ahora existe un script versionado que corre las DOS
familias de chequeo (nativo + color) sobre TODO `src/`, no solo un
grep ad-hoc de la sesión:

```bash
npm run gate:design
```

Debe dar `0 hallazgos` — las excepciones de esta sección están *dentro*
del script (constante `EXCEPTIONS`), así que un `0` real significa "nada
sin revisar", no "nada que el regex de turno supiera buscar". **Regla
obligatoria: antes de dar por cerrado cualquier trabajo de
tema/estandarización visual, correr este comando.** Si aparece un
hallazgo nuevo: o se corrige, o se agrega a `EXCEPTIONS` en el script Y a
esta lista (nunca solo uno de los dos lugares).

**El gate también vigila que el canónico se use con SU firma (2026-08-14).**
La categoría `prop-inexistente` compara los props que recibe cada componente de
`components/common/` contra los que su firma destructura de verdad. Existe
porque **React no valida props: uno con el nombre equivocado se ignora en
silencio** — `EmptyState` con `message`/`subtext` (espera `title`/`subtitle`)
pintaba el ícono y cero texto, en dos pantallas, sin error y sin que nada lo
viera. El barrido del día que se agregó encontró otros 29: `LiquidDatePicker`
recibía `placeholder` en 28 sitios sin aceptarlo, y un `ConfirmModal` pasaba
`hideCancel`, o sea que el diálogo de «Entendido» venía con un «Cancelar» de
regalo. La firma se lee del componente, nunca de una tabla a mano; un
componente con `...rest` queda fuera del chequeo.

Su hermana `segmentado-a-mano` cubre §15.3: un `.map()` de opciones cuyo
`<Button>` decide su `variant`/`tone` comparando contra el parámetro del map es
un `SegmentedControl` escrito a mano. Un botón suelto que cambia de tono según
la acción **no** lo es, y por eso el detector mira el parámetro y no el `===`.

**Semáforo de riesgo de stock (7 estados)** — el real de `src/views/productos/tabminmax/constants.js` (`STAT_CFGS`), no el que se mencionaba antes en este documento:
```
--stock-out: #ef4444          --stock-below-min: #f97316
--stock-approaching: #fbbf24  --stock-ok: #10b981
--stock-overstocked: #60a5fa  --stock-dead: #cbd5e1
--stock-no-data: #fde047
```

**Semáforo de volumen de transacciones/hora (4 estados)** — el gráfico "Ventas por día" de `DashboardView.jsx:880-882,1305` (clasifica cada hora del día según tx/hr):
```
--txvol-muerta: #64748b (≤4 tx/hr)   --txvol-normal: #0052CC (5-12 tx/hr, = brand)
--txvol-pico: #F79009 (>12 tx/hr, = warning)   --txvol-critica: #FF2D55 (>18 tx/hr)
```

### Dark theme overrides — `[data-theme="dark"]`
- `--bg-page`: navy real anclado al kiosco (2026-07-25 — antes era un
  gradiente que mezclaba azul con bastante rojo y leía "morado"; ahora
  `radial-gradient(... #10193b 0%, #0b1330 22%, #060b18 50%, #0a0f28 100%)`,
  el mismo `#060B18` de `TimeClockView.jsx`)
- `--surface-card`: `rgba(13,20,48,0.58)`, `--surface-modal`: `rgba(12,17,43,0.90)`
- `--text-primary`: `rgba(255,255,255,0.92)`, secondary/tertiary: white at lower opacity
- Radii NO se redefinen (heredan de `:root`); solo sombras/superficies/bordes/texto/fondo cambian.
- El kiosco (`TimeClockView.jsx`) fuerza este tema mientras está montado y
  ahora CONSUME estos tokens en vez de duplicarlos a mano — ver excepción
  arriba en §7.1.

### Solid Light — `[data-theme="solid"]`
- `--backdrop-*`: all `none` — disables all blur for performance
- `--surface-card`: `rgba(255,255,255,1.00)` (opaque), `--surface-header`: `rgba(255,255,255,0.96)`
- `--bg-page`: `#f1f5f9` (slate-100)
- Tighter radii: card `0.875rem`, header `0.875rem`, modal `1.25rem`

### Solid Dark — `[data-theme="solid-dark"]`
- `--backdrop-*`: `none`
- `--surface-card`: `rgba(30,41,59,1.00)` (slate-800), `--surface-modal`: `rgba(30,41,59,1.00)`
- `--bg-page`: `#0f172a` (slate-900)
- `--text-primary/secondary/tertiary`: white variants

### 3.1 Puente Tailwind v4 — `@theme inline` (Fase T1, 2026-07-23)

Todos los tokens de arriba se alían a namespaces de Tailwind v4 en un bloque `@theme inline` (`index.css`, justo después de los 4 bloques de tema), lo que los convierte en utilidades reales: `bg-surface-card`, `text-content`/`text-content-2`/`text-content-3`, `border-border-card`, `rounded-card`/`rounded-modal`/`rounded-badge`, `shadow-card`/`shadow-modal`, `bg-brand`/`text-danger`, `bg-scrim`, `bg-divider`, `bg-chart-1`…`bg-chart-6`, `text-stock-ok`…, `text-txvol-critica`… — todas con soporte nativo de opacidad (`/50`), `hover:`, breakpoints, etc.

`inline` es obligatorio: el valor debe re-evaluarse en cada `[data-theme]` en vez de resolverse una sola vez en build (necesario para que el tema reaccione en runtime vía el atributo `data-theme`, no solo en el primer paint).

**Por qué el texto se llama `--color-content*` y no `--color-text-primary`**: en Tailwind v4 el namespace `--text-*` genera utilidades de **tamaño de fuente** (`text-sm`, `text-lg`), no de color — reusar ese prefijo para color habría chocado con font-size.

**Por qué radios y sombras tienen nombres primitivos distintos** (`--card-radius` en vez de `--radius-card` en el token crudo): `--radius-*` y `--shadow-*` SÍ son justo los namespaces de Tailwind para `rounded-*`/`shadow-*`. Si el token crudo y la clave del `@theme` se llamaran igual, `--radius-card: var(--radius-card)` sería una autorreferencia circular que CSS no resuelve. Por eso el token crudo vive como `--card-radius`/`--card-shadow` etc., y solo el alias dentro de `@theme inline` usa el nombre "limpio" (`--radius-card`, `--shadow-card`) que Tailwind necesita.

**Z-index no tiene namespace `@theme`** en Tailwind v4 — se resuelve con `@utility` (ver §9).

**Actualización T7 (2026-07-24):** en el momento de escribir esto (Fase T1) ningún componente consumía estas utilidades todavía. Eso ya no es cierto — `bg-success`/`bg-chart-N`/`shadow-[var(--shadow-*)]` etc. están en uso activo en 119+ archivos tras el cierre de T7.1/T7.3. Ver §6 y la sección de sombras más abajo para el estado real.

### 3.2 Fase T2 — refinamiento "Solid Modern" + contrato de tema ampliado

- **`solid`/`solid-dark` refinados** por spec §7: `--bg-page` con tinte frío
  hacia el brand (`#f4f6fb` en light), radios `--card-radius`/`--modal-radius`
  ajustados a 12px/16px (antes 14px/20px).
- **Ramps de estado** (`--brand-hover/-pressed`, `--success/-warning/-danger-
  hover/-pressed`, `--state-selected-overlay`, `--state-disabled-opacity`):
  derivadas de valores ya usados en el código (brand-hover = brand-dark ya
  era el hover real; success/warning/danger toman el siguiente escalón
  Tailwind 600/700). `--state-selected-overlay` es la única decisión
  genuinamente nueva (no derivada) — revisar en el gate.
- **Escala de elevación** `--elevation-0..3`: nombra `--card-shadow`/`--modal-
  shadow` existentes como niveles 1/2, agrega nivel 3 (flyouts sobre modales).
- **Script de contraste AA** (`docs/audits/tema-2026-07/contrast-check.mjs`,
  JS puro sin dependencias): corrigió un fallo real encontrado en Fase T2 —
  `--text-tertiary` en `solid` (`#94a3b8`, 2.56:1) y `solid-dark`
  (`rgba(100,116,139,.9)`, 2.76:1) no cumplían AA contra `surface-card`
  opaco; corregidos a `#64748b`/`rgba(148,163,184,.9)` (4.76:1/4.92:1).
  **2026-07-25 — segunda vuelta real:** el script mismo tenía un hueco
  metodológico — trataba `content-3` como "siempre texto grande" (umbral
  3:1) sin verificar que en la práctica se usa en badges/labels de 9-11px,
  que NO califican para la excepción de texto grande de WCAG (requiere
  18px+, o ~19px+ en negrita). Con el umbral real (4.5:1), `liquid`
  (`#64748b`, 3.80:1) y `dark` (`rgba(255,255,255,.42)`, 4.00:1) fallaban
  — nadie los había revisado porque `solid`/`solid-dark` fueron los únicos
  "fallos" que el script marcó en su momento. Corregidos a `#526279`
  (4.96:1) y `rgba(255,255,255,.50)` (5.14:1) respectivamente. Los 4 temas
  cumplen AA_NORMAL real para las 3 variantes de texto — ver mockup
  aprobado por el usuario antes de aplicar (cambia el tono de TODO lo que
  use `text-content-3`, token global).
- **Blobs ambient apagados** en `solid`/`solid-dark` (`display:none` sobre
  `.animate-ambient-drift*`) — cero composición GPU constante, cumple §7.2.
- **Densidad adaptativa** — ver tabla completa en §32.

---

## 4. Ambient Background

The full-screen radial gradient background is set on `html, body, #root` via `background: var(--bg-page)`.

On top, **AppLayout** (`src/components/layout/AppLayout.jsx:593–599`) renders 5 fixed `div` elements — `position: fixed`, `pointer-events-none`, `z-index: 1` — each a large `rounded-full` with radial-gradient fill:

```
Orb 1: 70vw × 70vw  top:-15% left:-15%  purple rgba(110,70,230,0.45)  blur(35px)  animate-ambient-drift
Orb 2: 55vw × 55vw  top:-5%  right:-20% blue   rgba(60,100,240,0.38)  blur(30px)  animate-ambient-drift-reverse
Orb 3: 80vw × 80vw  bottom:-35% left:-10% lavender rgba(150,80,240,0.35) blur(40px) animate-ambient-drift 18s delay 4s
Orb 4: 45vw × 45vw  top:25%  right:5%   sky    rgba(90,150,255,0.32)  blur(28px)  animate-ambient-drift-reverse 14s delay 2s
Orb 5: 30vw × 30vw  top:50%  left:38%   violet rgba(200,120,255,0.28) blur(22px)  animate-ambient-drift 11s delay 6s
```

The sidebar has its own 3 internal orbs following the same pattern. LoginView has its own `AmbientBG` sub-component plus 6 small floating glass particles (`rounded-full`, `backdropFilter: blur(8px)`, `border: 1px solid rgba(255,255,255,0.88)`).

---

## 5. Surface System

The `[data-surface]` attribute is the canonical way to apply Liquid Glass styling. CSS in `src/index.css` selects on it and applies the CSS var tokens. No component should hardcode backdrop-filter or surface color for the main structural surfaces.

| Value | Used on | Tokens applied |
|---|---|---|
| `card` | Content containers, DataTable wrapper, widget cards | `--surface-card`, `--backdrop-card`, `--border-card`, `--card-shadow`, `--card-radius` |
| `page-header` | GlassViewLayout sticky desktop header | `--surface-header`, `--backdrop-header`, `--border-header`, `--header-shadow`, `--header-radius` |
| `modal` | ModalShell inner div | `--surface-modal`, `--backdrop-modal`, `--border-modal`, `--modal-shadow`, `--modal-radius` |
| `input` | LiquidSelect trigger | `--surface-input`, `--border-input`, `--input-radius`. Backdrop/shadow reusan `--backdrop-card` (no existe un `--backdrop-input` propio; box-shadow es un inset hardcodeado). |
| `dropdown` | LiquidSelect portal dropdown | `--surface-dropdown`. Border/shadow/radio/backdrop reusan los de `card` (`--border-card`, `--modal-shadow`, `--card-radius`, `--backdrop-card`) por decisión — el dropdown es visualmente una extensión del `card`/`input` que lo abre, sin necesidad de identidad propia; no se agregan tokens dedicados salvo que aparezca un caso real que lo requiera. |
| `tab-track` | ViewTabBar / filter pill track | `--surface-tab-track`, `--border-tab`. Radio hardcodeado `1.25rem` (no token), backdrop reusa `--backdrop-card`. |
| `sidebar` | AppLayout, el panel del menú | Oscuro en los cuatro temas. Sale de cuatro perillas: `--sidebar-tint` / `--sidebar-fill` / `--sidebar-pop-fill` / `--sidebar-rim` (§25.5) |
| `sidebar-popover` | Menú de Ajustes y flyouts del sidebar | Mismo tinte que el sidebar, más relleno (flota sobre el contenido, no sobre el fondo de página) |

Card hover (solo escritorio, `@media (hover: hover)`):
```css
[data-surface="card"]:hover {
  transform: translateY(var(--lift-card));
  box-shadow: var(--card-shadow-hover);
}
```

**El lift se queda — es la sensación Liquid Glass, y es el canónico para toda
superficie** (decisión del usuario, 2026-08-01, tras comparar tres opciones en
un mockup con los tokens reales). Lo que cambió es de dónde sale el número:

**`--lift-card` es el lift de las SUPERFICIES; `--lift-hover` el de los
CONTROLES.** Son dos tokens a propósito: un botón de 32px y una tarjeta de
1080px no necesitan el mismo desplazamiento — 2px en el botón se lee como
salto, 1px en la tarjeta no se ve.

| token | quién lo usa | liquid / dark | solid / solid-dark |
|---|---|---|---|
| `--lift-card` | `data-surface="card"` | `-3px` | `-1px` |
| `--lift-hover` | `Button`, `TablePagination`, `data-surface="page-header"` | `-1px` | `0px` |

Existe porque el lift de la tarjeta estaba **clavado en `-2px`**, y por eso no
se apagaba en Solid: la neutralización de tema (`index.css`) sólo alcanza a las
clases Tailwind `[class*="hover:-translate-y"]`, nunca a una regla de
`data-surface`. Medido antes del arreglo: `dy=-2` en los tres temas, incluido el
que entonces prometía no moverse.

**Los valores de hoy son otros, y por dos razones distintas** (`PLAN-MATERIALES`
§1.1 y §1.4, aplicados el 2026-08-06): Liquid subió a **`-3px`** porque con el
material nuevo `-2` casi no se leía, y Solid **dejó de valer `0`**: cede
**`-1px`**. Ese `-1` es una decisión, no un descuido — un guiño de que la pieza
responde, sin el salto que contradiría la promesa de eficiencia del material.
El texto de arriba decía «no se mueve» un día más que el código, que es el
mismo desfase que este bloque existe para contar.

> **Nunca clavar el número.** Una superficie nueva usa `var(--lift-card)`; un
> control, `var(--lift-hover)`. Clavar `-2px` es exactamente el bug que esto
> arregla, y no hay tema que lo pueda rescatar después.

**El lift mueve la caja de hit-testing, y eso tiene un costo conocido.** Al
entrar por el borde INFERIOR la tarjeta se levanta y su borde pasa por encima
del cursor, así que `:hover` se apaga sola y vuelve a encenderse — el ojo lo ve
como *"se activa, se quita y se activa"*. Medido en el tablero: con el puntero a
1, 2 y 3px del borde inferior la tarjeta queda hovereada el **0%** del tiempo; a
5px, el 100%. Es una **banda muerta de ~4px** en el borde inferior.

Lo que hay hoy es **histéresis**: la transición espera `--card-espera-salida`
(140ms) sólo al SALIR, así que el des-hover momentáneo que produce el propio
lift se agota antes de que la sombra empiece a volver. Verificado: una salida de
60ms o 120ms mueve la sombra **0px**; una salida real de 400ms la devuelve
completa. Entrar sigue siendo inmediato (30ms medidos), porque la transición que
manda es la del estilo DESPUÉS del cambio y al entrar esa es la de `:hover`.

**La banda muerta sigue ahí.** Cerrarla requiere compensar el área de impacto
con un pseudo-elemento que extienda la caja hacia abajo `var(--lift-card)`, y eso
exige `position: relative` en las **175** tarjetas que hoy no declaran posición
—con riesgo de re-anclar sus hijos absolutos—. No se hizo por eso; queda escrito
para que la próxima vez la decisión arranque con el número.

**Y nunca agregarle un `hover:-translate-y-*` a una tarjeta: no la reemplaza,
se SUMA.** En Tailwind v4 esas clases compilan a la propiedad `translate`, que
es distinta de `transform` —donde vive el canónico—, así que las dos aplican.
Medido el 2026-08-01 sobre el mismo elemento, quitándole la clase: **4.00px con
ella, 2.00px sin ella.** Eran 11 tarjetas moviéndose entre 3 y 6px mientras la
de al lado se movía 2, y encima `translate` no está en la transición del
canónico, así que ese sobrante saltaba sin animar. Corregidas las 11; lo vigila
la categoría **`lift-clavado`** de `npm run gate:design`, bloqueante en cero.

### 5.0.1 `bg-surface-card` es el COLOR, no la tarjeta (2026-08-07)

Reportado así: *«el modo oscuro se ve perfecto, pero el modo claro no»*, y sobre
la misma pieza: *«no tiene el brillo del borde al entrar a la card, ni los
efectos de click»*. Las dos cosas eran el mismo error.

Las baldosas del tablero estaban escritas
`rounded-2xl border border-border-card bg-surface-card` sobre un `<button>`
pelado. **Todos los tokens correctos, y aun así mal**: esas tres clases copian
el color del canónico y dejan afuera todo lo demás —

| lo que trae `[data-surface="card"]` | lo que da la clase suelta |
|---|---|
| `backdrop-filter: var(--backdrop-card)` | — |
| `--card-shadow` + los 4 `inset` del lente | — |
| el `::after` que destella al apuntarla | — |
| el gel al presionar (con `data-interactive`) | — |
| `--card-radius` del tema | el radio que uno escribió |

En **oscuro no se nota**: el color solo ya separa de un fondo oscuro. En claro
la tarjeta desaparece contra la página, porque lo que la despegaba era la
escarcha y el lente, no el relleno. Medido en la baldosa antes y después:
`backdrop-filter` pasó de `none` a `blur(44px) saturate(2)` y la sombra de 1
capa a 6.

**La regla:** una superficie va por su `data-surface`, nunca por sus clases de
color. `bg-surface-card` está bien para lo que NO es una tarjeta —el relleno de
un envoltorio de input, un chip— y para eso existe.

**Esto no lo puede vigilar un gate.** Se probaron dos señales: `bg-surface-card`
+ borde + radio da **133** coincidencias en el repo y `hover:translate-y-[var(--lift-*)]`
a mano da **78**, casi todas legítimas (envoltorios de campo con alto fijo). Un
detector con esa tasa de falsos positivos se silencia a la semana. Queda escrito
acá y en la memoria, que es donde sí se sostiene.

### 5.1 `data-tono` — la tarjeta marcada por su estado (2026-07-28)

**El canónico era INDECORABLE, y eso explicaba las últimas tarjetas escritas a
mano.** `index.css` va sin `@layer`, así que `[data-surface="card"]` le gana a
cualquier utilidad de Tailwind. Medido en el navegador:

| lo que se intenta | resultado |
|---|---|
| `data-surface="card"` | borde del tema |
| `+ border-warning/40` | **sin cambio** |
| `+ border-2 border-warning/40` | **sin cambio** |
| `+ ring-2 ring-warning/40` | **sin cambio** — el ring es un `box-shadow` y acá ya se declara uno |

O sea que para marcar una tarjeta *en edición* o *con error* no quedaba más que
renunciar al canónico y pintarla entera a mano. No era descuido de quien la
escribió: era la única salida.

Con un atributo la especificidad sube sola —`[data-surface][data-tono]` es
(0,2,0) contra (0,1,0)— y el estado se lee en el marcado en vez de en una
ristra de clases condicionales:

```jsx
<div data-surface="card" data-tono={editando ? 'warning' : undefined}>
```

| tono | cuándo |
|---|---|
| `warning` | la tarjeta que estás editando |
| `danger` | con error de validación, o urgente |
| `success` | confirmada / completada |
| `brand` | seleccionada |
| `dashed` | la tarjeta **vacía** que invita a llenarla (documento faltante, cargo sin asignar). No es severidad, es ausencia — por eso no lleva color |

**Cuando el tinte es del RELLENO y no del borde, no se emite `data-surface`** —
por la misma razón de especificidad. Es el mismo idioma que `PortalInput` usa
con `tono`:

```jsx
<div data-surface={d.isToday ? undefined : 'card'}
     className={`… ${d.isToday ? 'bg-brand/5 border-brand/30' : ''}`}>
```

**No anides tarjetas.** El pie de la tarjeta de rol también era "tarjeta", y al
darle tono quedaban dos anillos concéntricos. Una franja DENTRO de una tarjeta
es `bg-surface-card-hover` + borde, no otra `data-surface="card"`.

---

### 5.2 Capa flotante — un menú abierto deja quieto lo que hay atrás (2026-08-01)

**Un menú anclado se dibuja por portal encima del contenido, pero el contenido
sigue recibiendo el puntero.** Al moverse sobre el menú, la tarjeta que quedó
debajo entra y sale de `:hover` — y con el lift de arriba, salta un bloque de
media pantalla. Medido cruzando el borde del menú de a 2px en el tablero: la
tarjeta de 532×256 de atrás pasaba de `dy=-2` a `dy=0`. Se leía como un rebote
entre el select y la tarjeta.

**Todo flotante ANCLADO a un disparador llama `useCapaFlotante(abierto)`**
(`src/utils/capaFlotante.js`):

```jsx
import useCapaFlotante from '../../utils/capaFlotante';
const [isOpen, setIsOpen] = useState(false);
useCapaFlotante(isOpen);
```

Pone `data-capa-flotante` sobre **`#root`**, y ahí está la gracia: los portales
cuelgan de `body`, o sea que son **hermanos** de `#root` y los selectores no los
alcanzan. **El menú abierto conserva sus propios hovers y el resto de la app se
queda quieto, sin una sola excepción escrita a mano.** Es un contador y no un
booleano, porque puede haber un select abierto dentro de un modal.

**Con una capa abierta, la superficie de atrás NO responde al puntero:** ni se
mueve ni cambia de sombra.

| | menú cerrado | menú abierto |
|---|---|---|
| `transform` | `translateY(var(--lift-card))` | sin desplazamiento |
| `box-shadow` | `var(--card-shadow-hover)` | `var(--card-shadow)` — la de reposo |

**Apagar sólo el movimiento no alcanzaba** (corregido 2026-08-02). La primera
versión conservaba la sombra de hover a propósito. Se veía cortado, y la
medición explicó por qué: apagar el `transform` no apaga el `:hover`, y ese
estado **sigue alternando** cuando el puntero cruza el borde del menú. Medido
cruzándolo 4 veces: **8 cambios de `:hover` y 96 de `box-shadow`** — la sombra de
la tarjeta de atrás encendiéndose y apagándose, con su transición de 200ms
cortada a la mitad cada vez, mientras uno elige una opción. Tras el arreglo, los
mismos 4 cruces dan **0 cambios de `box-shadow`**.

La lección: el mockup con el que se eligió tenía la tarjeta hovereada de forma
continua, así que el artefacto no aparecía. **Con el menú encima, cualquier
respuesta al puntero es mentira** — el puntero está operando el menú, no el
fondo.

Se implementa **redefiniendo dos custom properties**
(`--card-lift-activo` / `--card-sombra-activa`), no escribiendo `box-shadow` en
una regla más específica: los `data-tono` declaran box-shadow propio y subir la
especificidad acá les borraría el aro de color.

**Se apagan los efectos, NO el puntero.** El reflejo es un velo `fixed inset-0`
—lo que ya hace `ModalShell`— y resuelve el hover de un saque, pero **rompe el
scroll**: esta app no scrollea el `body` sino un contenedor interno, y el velo
cuelga de `body`, así que la rueda se queda sin ancestro scrolleable. Verificado
con el menú abierto: el scroller interno clavado en 400 mientras que con el menú
cerrado sí se movía. En `ModalShell` no se nota porque ahí bloquear el fondo es
lo que se quiere. La regla toca `transform`/`box-shadow` y nada más, así que el
hit-testing queda intacto y un menú que abre por `mouseenter` sigue funcionando.

**Quién NO lo necesita**, y por qué el gate los deja pasar solos: quien use
`ModalShell` (su velo real ya tapa el fondo) y quien traiga su propio velo
`fixed inset-0` — hoy `PeriodPicker`, `RangeDatePicker`, `FilterBar`,
`InlineDayEditor`.

**Los tooltips quedan afuera a propósito.** Un tooltip aparece *porque* estás
hovereando algo y se va al salir: apagarle el hover del fondo sería pelearse
consigo mismo. Van a `EXCEPTIONS` con su motivo escrito —no auto-detectados—
porque un archivo puede tener un tooltip **y** un menú (`DashboardView` tiene
los dos) y exentar el archivo entero dejaría pasar el menú de al lado.

Lo vigila la categoría **`capa-flotante`** de `npm run gate:design`, bloqueante
en cero. La firma estructural que busca son las tres cosas juntas —
`createPortal` + `document.body` + `getBoundingClientRect`— o sea "sale del
árbol y se posiciona contra un disparador". Un modal centrado no mide un
disparador, así que no entra solo.

## 5.bis Material — lo que cambió en agosto 2026

> Detalle completo y mediciones: `docs/planes-cerrados/PLAN-MATERIALES-2026-08-02.md`. Acá va lo
> que hay que saber para **no romperlo** al escribir una vista.

### Cada elemento es una pieza de vidrio

El canto vivo —un destello que recorre el borde al apuntar— va en **toda superficie
canónica** y en **todo control dentro de una** (`button`, `a[href]`, `[role="button"]`).
No hay lista que mantener: sale del DOM. Si escribís un control dentro de una
`data-surface`, ya lo tiene.

- `[data-interactive]` marca las **superficies** clicables que no son controles (una
  tarjeta entera). Sale de `clickable()`, no se pone a mano.
- Corre **sólo la pieza más interna** bajo el cursor. Si agregás una superficie nueva,
  no hace falta hacer nada: la guarda `:not(:has(…))` ya la contempla.
- **`data-filo="ceder"`: el botón que ES la cara de su tarjeta** (2026-08-11). «La pieza
  más interna» asume que un botón dentro de una superficie es *una parte* de ella. A
  veces no lo es: es su cara. En la campana, el encabezado de cada notificación es un
  botón que ocupa el 80% de la tarjeta y deja afuera Aprobar/Rechazar — el filo corría
  el rectángulo del encabezado y **cortaba la tarjeta en dos**, justo arriba de los
  botones («la animación hover no pasa por el borde de la card»). Con el atributo, el
  botón no dibuja su filo y lo corre la tarjeta, que es la forma que el ojo reconoce.
  Son **dos** reglas en `index.css` —el `content: none` del botón y el `:has(> …:hover)`
  de la tarjeta—, porque la guarda `:not(:has(…))` también hay que levantarla. Va sólo
  donde el botón sea la cara de la superficie, nunca en un control que es una pieza.
- **El destello invierte su color por tema, y su flanco también.** En claro el destello
  es oscuro (`--rim-glint`) sobre flanco blanco (`--rim-sombra`); en oscuro, al revés;
  en los dos Solid ambos igualan a `--rim-base` y el anillo queda plano. El canto se
  pinta contra la caja de *padding*, o sea **por dentro** del borde de 1px: el borde
  nunca se tapa, así que su alfa decide qué dirección de realce se puede leer. En claro
  `--border-card` vale `.72`, y por eso un destello blanco ahí no se ve.

### Cuatro reglas que se rompen solas si no se conocen

| regla | por qué |
|---|---|
| **Un token de color se define en los CUATRO temas** | `:root` + Solid y nada en `dark` = Liquid oscuro hereda un valor calibrado en claro. Pasó **cinco** veces: las tres de siempre, más `--rim-sombra` y los 21 tokens de material de §3-§5, que salteaban `dark` entero. Lo vigila el gate `tema-incompleto`, **pero sólo mira tokens de COLOR** — alfas, longitudes y duraciones pasan de largo. |
| **Una decisión CERRADA no es una decisión CABLEADA** | §2 a §5 estaban ✅ CERRADO y describían un material que el portal no tenía: 21 tokens escritos sin un solo `var()` que los leyera. Antes de dar por hecha una sección, grepear que alguien consuma sus tokens. |
| **La dirección del realce la manda el ROL de la superficie** | la anidada **oscurece** porque se hunde; el panel del sidebar **aclara** porque flota; el hover **aclara siempre**. «En claro oscurecer» es falso. |
| **Una superficie dentro de otra se aplana** | pierde el `backdrop-filter`, toma `--anidada` y `--card-radius-anidada`. Un vidrio sobre vidrio queda a 1.02:1 de su contenedor: invisible. |
| **Una superficie `sticky` tiene que ocluir** | `--thead-bg`, nunca una opacidad de acento. Lo que pasa por debajo se lee a través. |
| **Un ancestro con `transform` / `filter` / `opacity<1` APAGA el vidrio de todo lo que contiene** | Es la regla del *backdrop root*, y es la que hacía que el tema se viera «gris sucio». Ver §5.ter. |

### 5.ter El backdrop root — lo único que puede apagar el vidrio (2026-08-09)

Un elemento con `transform`, `filter`, `backdrop-filter`, `opacity < 1`, `mask`,
`mix-blend-mode`, `contain: paint` o `will-change` de cualquiera de esos se vuelve
**backdrop root**. Desde ahí hacia abajo, el `backdrop-filter` de sus descendientes
**deja de muestrear la página**: no desenfoca, no satura, no hace nada. El elemento
sigue pintando su color de fondo, así que no se rompe — se **apaga**. Una tarjeta de
Liquid claro sin su `blur(44px) saturate(200%)` es `rgba(230,245,255,.16)` sobre un
degradado lavanda, o sea una mancha gris.

Medido el 2026-08-09 en Inicio: **38 de 41** superficies canónicas con vidrio no lo
estaban ejecutando. Tres causas, las tres arregladas:

| causa | dónde estaba | por qué se coló |
|---|---|---|
| `backdrop-filter: blur(1px)` en el **velo** del modal | `[data-velo]` | un píxel invisible a ojo, que costaba el vidrio de **todos** los modales |
| `animation-fill-mode: both` en las animaciones de **entrada** | 6 clases de `index.css` | `to { transform: none }` se interpola como matriz identidad, y `both` la sigue aplicando para siempre |
| `transform-gpu` / `will-change-transform` en **envoltorios** | 30 tags de 15 archivos | hábito pre-`will-change`; con el lift de hover no hace falta |

Las reglas que quedan:

- **`fill-mode` de una animación de ENTRADA: `backwards`, nunca `both`.** `backwards`
  sostiene el primer fotograma durante el retardo —que es para lo único que servía—
  y al terminar devuelve el elemento a su estilo base. Las de **salida** sí llevan
  `both`: ahí el último fotograma no es el estilo base y el elemento se está yendo.
- **`transform-gpu` no va nunca en un envoltorio.** Sobre la superficie misma es
  inocuo *para ella*; sobre un `<div>` que envuelve, apaga todo lo de adentro. El
  lift canónico (`hover:translate-y-[var(--lift-*)]`) sólo pone transform mientras
  el puntero está encima, y eso es aceptable; declararlo permanente no.
- **`will-change` de `transform`/`opacity`/`filter` tampoco.** Es la versión
  permanente del mismo problema.
- **Vidrio dentro de vidrio no es defecto.** Una tarjeta dentro de un modal, o el
  carril de pestañas dentro del encabezado, no pueden desenfocar a través de algo ya
  desenfocado: es la regla de «una superficie dentro de otra se aplana», y su forma
  se la da su opacidad sobre el material de abajo.

Cómo se verifica, en dos mitades:

- **Lo que se ve en el fuente** lo vigila el gate, categoría `backdrop-root`:
  `transform-gpu` / `will-change-transform` en un tag que no declara `data-surface`.
  Arranca en **0** (se barrieron los 30 que había), así que cualquiera nuevo falla.
- **Lo que no se ve en el fuente** —el `fill-mode` de una animación, un `opacity`
  heredado, un `contain` implícito— sólo aparece recorriendo el árbol **pintado**:
  para cada `[data-surface]` con `backdrop-filter`, mirar si algún ancestro crea un
  backdrop root. Verificado así sobre 30 rutas: **0 superficies apagadas**, y lo que
  queda son las anidadas, que es el caso legítimo.

### Lo que NO es material

`Notice`, `Badge` y los chips **son tinta**: se apoyan sobre una superficie y toman su
color de la paleta semántica. No llevan canto, ni lente, ni `backdrop-filter`. **No
declarar `data-surface` es lo correcto para ellos.**

### El reloj

Cuatro escalones: `--dur-fast` (150) · `--dur-base` (200) · `--dur-slow` (300) ·
`--dur-lento` (500), con su valor por tema. **Cero literales `duration-N` en JSX**, y el
gate `reloj-a-mano` lo mantiene así. Para elegir escalón: **el más cercano, y los
empates bajan**.

`animationDuration` queda **fuera** del reloj: el período de un bucle ambiental
—shimmer, blobs escalonados— no es una duración de interacción.

### Antes de escribir vidrio a mano

No lo escribas. Usá una `data-surface`. Si de verdad hace falta —una pantalla que vive
fuera del shell, como el login o el kiosco— va a `EXCEPTIONS` **con el motivo escrito**.
Los gates `vidrio-a-mano` y `material-a-mano` lo marcan, y la receta para convertir un
sitio existente está en `PLAN-MATERIALES` §20.

---

## 6. Color System

> ### ⛔ La paleta es CERRADA (regla del usuario, 2026-07-28)
>
> **No se agregan colores ni variantes de color. Se usan los definidos.**
>
> Cuando algo necesita un color que "todavía no existe", la respuesta correcta
> es **elegir uno de los que ya están**, no crear el número siguiente. Un color
> nuevo por concepto es cómo se llega a tener nueve categóricos donde cuatro
> alcanzan.
>
> El estado medido el 2026-07-28 muestra por qué la regla hace falta —
> el uso está muy desparejo:
>
> | variante | usos | |
> |---|---|---|
> | `chart-3` | 76 | en uso real |
> | `chart-1` | 43 | en uso real |
> | `chart-4` | 21 | en uso real |
> | `chart-9` | 18 | en uso real |
> | `chart-6` | 12 | en uso real |
> | `chart-2` · `chart-5` · `chart-7` · `chart-8` | 7 · 7 · 6 · 4 | **un color por caso** |
>
> Los cuatro de abajo no son categorías del negocio: son "hacía falta otro
> color" resuelto agregando uno. No se borran acá —eso cambiaría el aspecto de
> varias vistas y es decisión aparte— pero **no se usan para nada nuevo**.
>
> **Qué hacer en su lugar:** severidad → `success`/`warning`/`danger`;
> jerarquía → `primary`/`secondary`/`ghost`; sin categoría → `neutral`. Solo
> si el color de verdad distingue una CATEGORÍA que el usuario reconoce
> (forma de pago, tipo de solicitud) se usa un `chart-N`, y de los que ya
> están arriba.

### 6.0 La paleta, consolidada (2026-07-28)

Eran trece tokens. Se midió la distancia perceptual (ΔE, CIELAB) entre los 78
pares posibles y **cuatro no eran categorías: eran el mismo color con otro
nombre**. Quedan **nueve**, en tres niveles con reglas distintas.

#### Nivel 1 — Marca

| token | valor | dónde |
|---|---|---|
| `--brand` | `#0052CC` | El azul **funcional**: botones, enlaces, foco, CTA. |
| `--logo-green` | `#8ec30f` | Identidad. |
| `--logo-magenta` | `#981d97` | Identidad. |

Los dos del logo aparecen **donde la app habla de sí misma** — la navegación
activa, el brillo del logo, un estado vacío, la pantalla de espera de la IA.
**Nunca en un dato ni en un estado**: eso es severidad o categoría. Confundirlos
es lo que hace que un color deje de significar.

> El verde es **lima**: con texto blanco da 2.11:1 y no pasa AA. Para un
> relleno sólido existe `--logo-green-solid` `#5c7f0a` (4.67:1). El magenta sí
> sirve tal cual (7.10:1).

#### Nivel 2 — Severidad

`success` · `warning` · `danger`. Dicen **qué tan grave es**. Nunca se usan
para identidad ni para distinguir categorías.

#### Nivel 3 — Categoría (cinco)

`chart-1` azul · `chart-3` violeta · `chart-4` naranja · `chart-6` rosa ·
`chart-9` verde azulado. Solo cuando el color distingue una categoría que el
usuario reconoce. **No hay un sexto.**

#### Los cuatro retirados

Siguen **definidos como alias** — 343 referencias en 88 archivos los usan hoy,
y apuntando al destino el color queda unificado sin reescribir nada. El gate
(`chart-retirado`) bloquea usos nuevos.

| retirado | → | por qué |
|---|---|---|
| `chart-2` | `success` | ΔE 11.6 y su `-solid` era **el mismo hex** (`#047857`) |
| `chart-8` | `neutral` | `Badge` ya usaba `chart-8-solid` como su neutro |
| `chart-5` | `chart-9` | cian y verde azulado; nunca aparecen juntos |
| `chart-7` | `warning` | dorado y ámbar; los dos leen "atención" |

#### Por qué NO todos los tokens necesitan variante por tema

Es la pregunta correcta y la respuesta tiene tres capas:

| capa | ¿varía por tema? | por qué |
|---|---|---|
| base (el tinte al 12%) | **no** | Se **compone** sobre la superficie, y la superficie sí cambia: el mismo hex da `#f3e4f3` sobre blanco y `#21193b` sobre oscuro. |
| `-text` | **sí** | Es lo único que depende del fondo ya compuesto. Tiene su par claro/oscuro. |
| `-solid` | **no** | Es autocontenido: trae su propio fondo y texto blanco, así que no depende de la superficie. |

Medidas las 32 combinaciones (8 colores × 4 temas) contra AA: **31 pasaban, 1
no** — `chart-4` en liquid, 4.32:1. Su `-text` bajó de `#c2410c` a `#9a3412`.

### Brand
| Name | Value | Usage |
|---|---|---|
| Primary blue | `#0052CC` | CTA buttons, active states, brand accents — **funcional**, no cambia |
| Dark blue | `#003D99` | Button hover |
| Violet-indigo gradient | `from-brand to-brand-purple` | Icon squircles, accent elements — legado, no derivado del logo real |
| Active nav glow (legado) | `from-violet-500/22 via-indigo-400/14 to-blue-500/8` | Pre-2026-07-23; ver reemplazo abajo |
| Sidebar accent bar (legado) | `from-violet-300 via-indigo-400 to-blue-400` | Pre-2026-07-23; ver reemplazo abajo |

### Colores reales del logo — identidad decorativa (2026-07-23)

`--logo-green: #8ec30f` y `--logo-magenta: #981d97` (+ variantes suaves
`--logo-green-soft`/`--logo-magenta-soft`), muestreados por pixel de
`public/Logo512.png` (arco superior verde, cruz + arco inferior magenta) —
**no inventados, ni el violeta/índigo genérico de arriba**. Decisión: estos
son los acentos DECORATIVOS/de identidad del proyecto de aquí en adelante —
glows ambientales, estado activo de navegación, hover de personalización.
`--brand` (#0052CC) sigue siendo el azul FUNCIONAL (botones/CTAs/enlaces/
focus) y no se toca. Aplicado primero al sidebar (prototipo de esta sesión,
ver `AUDITORIA-TEMA-2026-07.md` §7.7); pendiente extender a los blobs
ambientales de `AppLayout.jsx` (hoy violeta/azul genérico) y cualquier otro
glow decorativo nuevo.

| Token | Valor | Uso previsto |
|---|---|---|
| `--logo-green` | `#8ec30f` | Glow ambiental superior, acentos secundarios |
| `--logo-magenta` | `#981d97` | Glow ambiental inferior, estado activo dominante |
| `--logo-green-soft` | `#b9e05a` | Íconos/texto sobre fondo oscuro (variante clara) |
| `--logo-magenta-soft` | `#e2a3e0` | Íconos/texto sobre fondo oscuro (variante clara) |

Utilidades Tailwind ya disponibles vía `@theme inline`: `text-logo-green`,
`bg-logo-magenta`, `text-logo-green-soft`, `bg-logo-magenta-soft`, etc.

### Semantic — severidad real (Fase T7.1, reemplaza la tabla de clases crudas de abajo)
| Role | Token | Uso |
|---|---|---|
| Success | `bg-success`/`text-success`/`text-success-text` | Confirmado, pagado, delta positivo, "cumplió" |
| Danger | `bg-danger`/`text-danger`/`text-danger-text` | Ventas perdidas, errores, vencido, crítico |
| Warning | `bg-warning`/`text-warning`/`text-warning-text` | Pendiente, acercándose a umbral, atención |

La variante **`-text`** (no la base) es la que se usa para texto sobre el
propio tinte de fondo del token (`bg-success/10 text-success-text`) — es
AA-safe y theme-aware (oscuro en temas claros, claro en temas oscuros). La
variante **base** (`text-success` sin sufijo) es para íconos o texto que
NO está sobre un tinte del mismo color, y es la que corresponde en
superficies fijas-oscuras (ver excepciones en §3, "Paleta dataviz").
Este fue el bug real que tenía `Badge.jsx` antes de T7.1: usaba hex
hardcodeado en vez del token `-text`, invisible porque el componente no
tenía usos reales en ese momento.

### Categórico — 9 acentos `chart-N` (Fase T7.1)
Ver tabla completa + regla de 3 buckets en §3 ("Paleta dataviz"). Resumen:
`chart-1` azul, `chart-2` esmeralda, `chart-3` violeta, `chart-4` naranja,
`chart-5` cian, `chart-6` rosa, `chart-7` dorado, `chart-8` pizarra,
`chart-9` teal — asignados por posición dentro del mismo enum de negocio,
NUNCA "porque quedaba bien" (esa era la causa raíz de tener 30+ colores
sin sistema antes de T7.1).

### ~~Semantic (legado, clases crudas — YA NO USAR)~~
La tabla original de este documento recomendaba `text-emerald-500/600/700`,
`text-red-500/600/700`, etc. directos de Tailwind. Esa fue exactamente la
causa del problema que T7.1 cerró (119 archivos, ~1,400 usos de color
crudo sin sistema). No usar clases de color crudo para severidad o
categoría — siempre los tokens de arriba.

### Sidebar palette (always dark regardless of theme)
- Background: `bg-[#07031a]/80`
- Nav text inactive: `text-white/60`
- Nav text active: `text-white`
- Group icon active: `text-white/42` inactive → **`text-logo-magenta-soft` cuando activo** (antes `text-violet-200` — reemplazado 2026-07-23, ver arriba)
- Accent bar gradient: **`linear-gradient(180deg, var(--logo-green), var(--logo-magenta))`** (antes `from-violet-300 via-indigo-400 to-blue-400`)
- Ambient glow del sidebar: verde arriba / magenta abajo (eco de la composición real del logo — antes violeta genérico sin relación con la marca)
- Logo del header del sidebar: la imagen real (`Logo192.png`) sobre un contenedor `bg-white/10` con borde `border-[#981d97]/22` (antes `border-violet-300/20`)

---

## 7. Tipografía

> Reescrita el 2026-07-27 (D4). La versión anterior daba la escala en píxeles
> arbitrarios (`text-[13px]`, `text-[11px]`…). Eso es lo que produjo **22 tamaños
> distintos** en el código para lo que en realidad son 13 roles.

Fuente: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.
Sin webfonts.

**El tamaño sale de un token, nunca de un `text-[Npx]`.**

| token | px | para qué |
|---|---|---|
| `text-micro` | 9 | contadores, superíndices |
| `text-caption` | 10 | badges, etiquetas en mayúsculas |
| `text-label` | 11 | etiquetas de campo, chips |
| `text-body-sm` | 12 | texto secundario, navegación |
| `text-body` | 13 | celda de tabla, cuerpo |
| `text-body-lg` | 14 | cuerpo destacado |
| `text-subtitle` | 15 | subtítulos |
| `text-body-xl` | 16 | input (mínimo en móvil, ver §32) |
| `text-title-sm` | 18 | título de modal |
| `text-title` | 20 | título de sección |
| `text-title-lg` | 22 | título de vista en móvil |
| `text-display` | 26 | título de vista |
| `text-display-lg` | 32 | KPI, cifra destacada |

En táctil, `--text-micro` y `--text-caption` suben un punto: 9px en un teléfono
no se lee.

**Convenciones**
- Mayúsculas siempre con `uppercase tracking-widest font-black`.
- Nunca `font-normal` en UI interactiva — mínimo `font-medium`.
- **`tabular-nums` obligatorio** en toda columna o celda numérica: sin eso los
  dígitos bailan al actualizarse.
- Contraste mínimo sobre vidrio: `text-content-2` para etiquetas, `text-content-3`
  para texto secundario. Nunca por debajo.

---

## 8. Escala de radios

> Reescrita el 2026-07-27 (D4). La versión anterior era un **inventario** de los
> radios que existían en el código (`rounded-[0.7rem]`, `rounded-[1.2rem]`,
> `rounded-[2.5rem]`…). Documentar el desorden lo convierte en norma: cada quien
> elegía uno de la lista.

**El radio sale de un token y el token cambia por tema.** No se escribe un radio
arbitrario.

| token | liquid glass | sólido | dónde |
|---|---|---|---|
| `--btn-radius` → `rounded-btn` | `9999px` | `0.5rem` | botones, chips, controles |
| `--card-radius` → `rounded-card` | `1.75rem` | `0.75rem` | tarjetas, widgets |
| `--modal-radius` → `rounded-modal` | | | modales |
| `--header-radius` → `rounded-header` | | | cabeceras flotantes, sidebar |

Que el sólido use radios más chicos **es el diseño**, no una excepción: el vidrio
es redondo y expresivo, el sólido es recto y eficiente. Por eso ningún componente
lleva `rounded-full` fijo — eso deja el control redondo en un tema que lo quiere
recto.

`rounded-full` solo es correcto en lo que es **geométricamente un círculo**:
avatares, puntos de estado, orbes del fondo.

---

## 9. Z-Index Scale

Tailwind v4 no tiene namespace `@theme` para z-index (a diferencia de color/radius/
shadow) — la escala canónica se declara con `@utility` en `index.css` (Fase T1,
2026-07-23), generando clases reales:

```
z-ambient          — 1      — Ambient background orbs (fixed, behind all content)
z-base             — 10     — Baseline stacking (280 usos hoy vía z-10)
z-content          — 20     — Main content layer (72 usos hoy vía z-20)
z-tabs             — 30     — Tab bars / floating pills (22 usos hoy vía z-30)
z-header           — 40     — GlassViewLayout sticky desktop header / mobile header
z-sidebar          — 50     — Sidebar (mobile: fixed overlay)
z-sidebar-desktop  — 60     — Sidebar (desktop: lg:z-[60])
z-dropdown         — 70     — Dropdowns sobre header/sidebar
z-modal            — 100    — ModalShell default (most overlays, modals)
z-bell-desktop     — 200    — Campana de notificaciones (desktop)
z-flyout           — 300    — Flyout panels
z-bell-dropdown    — 400    — Dropdown de la campana
z-banner           — 500    — Banners globales
z-tooltip          — 9998   — LiquidTooltip
z-toast            — 9999   — LiquidToast
z-confirm          — 99999  — ConfirmModal (highest — never covered by toasts)
```

**Estado de adopción**: estas 16 clases existen y generan CSS real, pero
ningún componente las consume todavía — el código sigue usando los ~501
usos de `z-10`/`z-20`/`z-[…]` dispersos en ~95 archivos. La migración vista-
por-vista/componente-por-componente a estas clases nombradas es T3/T4
(`AUDITORIA-TEMA-2026-07.md`), no un cambio mecánico de una sola vez —
requeriría revisar cada punto de apilamiento contra sus vecinos.

---

## 10. Spacing & Layout

### Page shell

`AppLayout` (`src/components/layout/AppLayout.jsx`) wraps everything in `flex w-full lg:h-[100dvh] lg:overflow-hidden`.

- **Mobile (< 1024px):** Natural document scroll. Sidebar slides over content as `fixed` overlay. `AppLayout` forces `overflow: auto !important` on `html/body/#root` via `useEffect`.
- **Desktop (≥ 1024px):** Full-viewport height. Scroll lives inside `GlassViewLayout`'s inner scroll container. Sidebar is `relative` in the flex row.

Safe-area insets on sidebar:
```
my-[max(env(safe-area-inset-top,8px),8px)]
mb-[max(env(safe-area-inset-bottom,8px),8px)]
ml-[max(env(safe-area-inset-left,8px),8px)]
```

### Content area

`GlassViewLayout` (`src/components/GlassViewLayout.jsx`) is the standard view wrapper for all admin/manager views.

Props:
| Prop | Type | Effect |
|---|---|---|
| `icon` | Lucide component | Shown in header icon squircle |
| `title` | string | View heading |
| `liveIndicator` | boolean | Red ping dot on icon |
| `filtersContent` | JSX | Rendered in header right slot |
| `headerLeft` | JSX | Override for entire left slot |
| `subContent` | JSX | Between header and body (charts, filter pills) |
| `transparentBody` | boolean | Body card is transparent (DashboardView) |
| — | — | **En teléfono (<768px) la card del cuerpo no se dibuja**, sin importar esta prop: ver la nota abajo |
| `fixedScrollMode` | boolean | Disables y-scroll on container |

### Max widths
Content area: `max-w-[1440px] xl:max-w-[1600px] 2xl:max-w-[1800px] mx-auto`.

### Padding scale
| Context | Value |
|---|---|
| View body horizontal | `px-2 lg:px-6 xl:px-8` |
| View body vertical top | `pt-4 xl:pt-5` |
| Desktop page header | `py-6 px-10 xl:py-7 xl:px-12` |
| Modal body | `p-6 sm:p-8` |
| Modal footer | `p-4 sm:p-5` |
| Card inner | `p-4` / `p-5` / `p-6` |
| Nav item (top-level) | `px-3 py-3 xl:px-4 xl:py-3.5` |
| Nav item (indented) | `px-2.5 py-2 ml-2 xl:px-3 xl:py-2.5` |

---

## 11. Animation & Motion

### Principles

1. Movement communicates state, not decoration. If the effect doesn't clarify what changed, it doesn't exist.
2. Standard ease: `cubic-bezier(0.23,1,0.32,1)` — fast ease-out, physical response feel.
3. Spring bounce: `cubic-bezier(0.34,1.56,0.64,1)` — only for widget-settle, never layout.
4. Press state: `active:scale-[0.97]` or `active:scale-[0.99]`. Never `scale-90/95`.
5. Hover lift: only inside `@media (hover: hover)` — never on touch devices.

### CSS keyframes (index.css — todo vive aquí desde la Fase T1, 2026-07-23)

`tailwind.config.js` se eliminó en T1: el proyecto usa `@tailwindcss/postcss`
sin `@config`, así que ese archivo llevaba tiempo sin leerse — `animate-wiggle`,
`animate-kpi-enter` y `animate-widget-settle` no generaban NINGÚN CSS (bug
silencioso pre-existente en `NotificationBell.jsx`/`DashboardView.jsx`, no
introducido por T1; verificado con build antes/después). Migrados a
`@keyframes` nativos en `index.css`. `animate-widget-enter` y
`animate-table-row-enter` (base) existían en el config pero ninguna vista
los usaba — se descartaron en vez de migrarse (código muerto).

| Class | Duration | Easing | Usage |
|---|---|---|---|
| `animate-kpi-enter` | 280ms | `cubic-bezier(0.23,1,0.32,1)` | KPI / stat card entrance |
| `animate-widget-settle` | 550ms | `cubic-bezier(0.34,1.56,0.64,1)` | Spring settle |
| `animate-wiggle` | 400ms infinite | ease-in-out | Icon wiggle |
| `glow-danger` | 2.8s infinite | ease-in-out | Red glow pulse on loss/danger indicators (TabCatalogo) |
| `glow-warning` | 3.2s infinite | ease-in-out | Amber glow pulse on warning indicators |
| `badge-pulse` | 1.8s infinite | ease-in-out | Badge scale pulse |
| `animate-ambient-drift` | 16s infinite | ease-in-out | Slow ambient orb float (primary) |
| `animate-ambient-drift-reverse` | 20s infinite | ease-in-out | Slow ambient orb float (reverse) |
| `animate-shimmer` | 1.4s infinite | `--ease-out` | Linear sweep on sidebar borders / top edge |
| `animate-ping` *(Tailwind)* | | | Live indicator dot, alert dot |
| `animate-spin` *(Tailwind)* | | | Loader2 spinner |

### `animate-in` / `animate-out` — la familia de entrada (tw-animate-css)

`animate-in fade-in zoom-in-95`, `slide-in-from-*` y sus pares de salida vienen
de **`tw-animate-css`**, importado en `index.css` justo después de Tailwind.
Cúbrelos siempre que un elemento **aparezca o desaparezca**: modal, dropdown,
popover, panel, toast. Es el movimiento que D2.4 clasifica como *funcional*.

```jsx
// entrada estándar de un panel que aparece
className="animate-in fade-in zoom-in-95 duration-[var(--dur-slow)]"
// salida (el elemento tiene que seguir montado mientras dura)
className="animate-out fade-out zoom-out-95 duration-[var(--dur-fast)]"
```

La duración sale de `duration-*` de Tailwind (`--tw-duration`), o sea que se
escribe al lado como en cualquier transición. Los dos gates de movimiento ya
los alcanzan: en Solid duran 130ms lineales, y con `prefers-reduced-motion` se
les anulan las variables de geometría (`--tw-enter-scale`, `-translate-x/y`,
`-rotate`, `-blur`) y queda solo el fade.

> **Tercera vez que pasa lo mismo.** Hasta el 2026-07-29 estas clases estaban
> escritas en **223 lugares de 73 archivos —incluidos `ModalShell` y
> `LiquidModal`— y no generaban ni una línea de CSS**: son del plugin
> `tailwindcss-animate` (Tailwind v3), que nunca estuvo instalado. Todo modal
> del portal aparecía de golpe. Es el mismo fallo que esta sección ya
> documenta para `tailwind.config.js` en T1 y que §7 documenta para
> `rounded-full`. **Antes de dar por buena una clase, buscarla en el bundle**:
> `grep -c '\.animate-in' dist/assets/*.css`.

### Barrido en botones — REMOVIDO (2026-08-05)

La clase `.sweep` **ya no existe**. No se apagó: se removió, junto con sus seis
`<span>` en el DOM — apagarla habría dejado nodos que existen, cuestan y no
significan nada.

Motivo: era una animación de 700 ms que recorría el botón sin comunicar **ningún
estado**. Lo funcional del hover es el cambio de fondo, y el material del vidrio lo
aporta el canto. En Solid ni siquiera se ejecutaba — la mitad de los temas ya vivían
sin ella sin que nadie lo notara, que es la mejor prueba de que no hacía falta.
Ver `docs/planes-cerrados/PLAN-MATERIALES-2026-08-02.md` §2.1.

### Framer-motion (inconsistency — do not add more)

`framer-motion` v12 is installed but designated as an architectural inconsistency. The correct standard is CSS keyframes + Tailwind transitions. **Do not add new framer-motion usage.**

Current files using framer-motion:
- `GlassViewLayout.jsx` — floating scroll-nav (AnimatePresence + motion.div/button)
- `LiquidSelect.jsx` — dropdown open/close (AnimatePresence + motion.div)
- `TablePagination.jsx` — page indicator (layoutId) + whileHover/whileTap
- `AppLayout.jsx` — LayoutGroup wrapper
- `SchedulesView.jsx`, `RecepcionModal.jsx`, `RutaEnCursoCard.jsx`, `TabPedidos.jsx`, `TabReglas.jsx`
- `TabLaboratorios.jsx`, `TabMinMax.jsx`
- `InlineDayEditor.jsx`, `ScheduleCalendar.jsx`

---

## 12. Icon System

**Library:** Lucide React v0.575.0 — sole icon library. No other sets.

#### Un concepto, un ícono (F5, 2026-07-29)

La sección fijaba la librería y los tamaños, pero nunca **qué ícono significa
qué**. Medido: `Editar` se dibujaba con cuatro íconos (`Edit3` 32 · `Pencil` 21 ·
`Edit2` 10 · `Edit` 3) y `Confirmar` con cuatro (`CheckCircle2` · `Check` ·
`CheckCircle` · `CheckCheck`).

Y no era sólo el nombre. Abriendo el paquete, los cuatro "lápices" son **cuatro
dibujos distintos**:

| Import | Glifo real | Qué se ve |
|---|---|---|
| `Edit` | `SquarePen` | lápiz dentro de una caja |
| `Edit2` | `Pen` | pluma sin punta |
| `Edit3` | `PenLine` | pluma con subrayado |
| `Pencil` | `Pencil` | lápiz con punta |

Lo mismo con el check: `CheckCircle` es `CircleCheckBig` (círculo abierto, la
marca se desborda) y `CheckCircle2` es `CircleCheck` (círculo cerrado, marca
adentro). O sea que la deriva no era de nomenclatura sino **de dibujo**: el mismo
botón "Editar" se veía distinto según la vista.

**El mapa. Es cerrado, y lo vigila la categoría `icono-semantico` del gate:**

| Concepto | Canónico | Nota |
|---|---|---|
| Editar | `Pencil` | `Edit`, `Edit2`, `Edit3` retirados — eran otros tres glifos |
| Eliminar | `Trash2` | |
| Marca de selección | `Check` | checkbox, opción elegida, ítem tildado, acción de confirmar |
| Estado exitoso | `CheckCircle2` | badge, toast, resultado de una operación |
| Cerrar | `X` | |
| Anular / rechazar | `XCircle` | *no* es eliminar: cancelar, invalidar, poner en cero |
| Ver | `Eye` | |
| Descargar | `Download` | ver §Storage sobre ver vs descargar |
| Agregar | `Plus` | |
| Buscar | `Search` | |
| Filtrar | `SlidersHorizontal` | |
| Advertencia | `AlertTriangle` | |
| Información | `Info` | |

`Check` y `CheckCircle2` **no son sinónimos**: uno es una marca, el otro es un
estado. Una fila tildada lleva `Check`; un toast de "guardado" lleva
`CheckCircle2`.

`CheckCheck` queda retirado — no existe el concepto de "doble confirmación" en el
portal. Sus 3 usos (marcar notificaciones leídas, confirmar apoyo, aprobar en
bloque) son todos la marca simple.

`XCircle` se auditó de paso porque figuraba en la medición como segundo ícono de
"eliminar": **no lo es en ningún sitio**. Sus 14 usos son cancelar, invalidar,
revocar y "poner 0" — que es justo lo que dice el mapa.

**Sobre el nombrado:** `CheckCircle2`, `XCircle`, `AlertTriangle` y `AlertCircle`
son a su vez alias de los nombres nuevos de Lucide (`CircleCheck`, `CircleX`,
`TriangleAlert`, `CircleAlert`). El proyecto habla el nombrado viejo de punta a
punta y se queda así: cambiarlo es un renombre sin ningún cambio visual, y
mezclar las dos convenciones sería reabrir el problema que esta sección cierra.
Lo que se prohíbe es tener **dos nombres para el mismo concepto**, no el estilo
del nombre.

#### La rampa, medida de verdad (F4, 2026-07-29)

La versión anterior de esta sección decía "se midieron 1,287 íconos y hay 33
tamaños distintos". **Los dos números estaban mal**, y por el mismo motivo: la
medición contaba props `size` de componentes que no son íconos.
`<VendorAvatar size={5}>` es una clave de escala (`5 → w-5 h-5`), no píxeles, y
`<PersonAvatar size={34}>` tampoco es un ícono. De ahí salían los `5`, `30` y `34`
que figuraban como "fuera de rampa" y que nunca existieron.

Contando solo componentes importados de `lucide-react`: **1,249 íconos, 24
tamaños**. La rampa es ésta:

```
8 · 9 · 10 · 11 · 12 · 13 · 14 · 15 · 16 · 18 · 20 · 22 · 24 · 26 · 28 · 32 · 36 · 40 · 48
```

Fina abajo —de 8 a 16 va de uno en uno, porque ahí el ícono compite con texto de
10-12px y un punto de diferencia se ve— y gruesa arriba, donde ya no. `9` (61
usos) y `15` (55) **entran**: la rampa anterior los excluía sin decir por qué,
dejando 116 íconos reales fuera de una escala escrita el mismo día. `56` **sale**:
cero usos, y una rampa que ofrece un valor que nadie eligió nunca es el mismo
defecto que esta sección tenía.

Si el tamaño que querés no está, casi siempre es que el de al lado sirve igual.

#### El trazo va con el tamaño

`strokeWidth` tenía **14 valores distintos** (`1.2`, `1.6`, `1.75`, `1.8`, `2.2`,
`2.25`, `2.75`…) y el doc declaraba `1.5` como el default de reposo. La medición
dice lo contrario, y con claridad:

| tamaño | trazos en uso | dominante |
|---|---|---|
| 8-14 | 1.5(2) · 2(57) · **2.5(197)** · 3(57) | `2.5` |
| 15-20 | 1.5(12) · 2(31) · **2.5(146)** · 3(5) | `2.5` |
| 21-28 | **1.5(14)** · 2(15) · 2.5(28) | transición |
| 29-48 | 1(1) · **1.5(21)** · 2(16) | `1.5` |
| ≥49 | 0.5 · 1 · 1.5 | fino |

En el tramo 15-20px el `2.5` le gana al `1.5` **146 a 12**. O sea que el "default
1.5" no describía nada. Lo que sí es un sistema —y es óptica, no gusto— es que
**el trazo se afina cuando el ícono crece**: a 12px un trazo de 1.5 desaparece; a
40px uno de 2.5 se ve tosco.

La escala es cerrada, cinco valores:

| Banda | Trazo | Para qué |
|---|---|---|
| **Interfaz** (8-28px) | `2` reposo · **`2.5` default** · `3` énfasis | el 90% de los íconos del portal |
| **Despliegue** (29-48px) | `1` · `1.5` | estados vacíos, wallboard, pantallas de bloqueo |
| **Ilustración** (≥49px) | lo que pida la caja | ver abajo |

Dos excepciones, ambas con motivo y ambas en `EXCEPTIONS` del gate:

- **`Checkbox` usa `4`.** Dentro de una caja de 16px un trazo de 2.5 se pierde, y
  ese glifo *es* el estado del control: si no se ve, el checkbox no comunica nada.
- **La marca de agua de `FormWfmAnalytics` usa `0.5`.** A 100px un trazo de la
  escala se lee como un dibujo en vez de una textura.

#### Arriba de 48px ya no es un ícono de interfaz

A partir de 49px el tamaño lo decide la caja que llena, no la rampa. Son cinco en
todo el portal, y la sección anterior los describía mal —decía "tres marcas de
agua: 100, 80 y 64"—. Son **dos** cosas distintas:

| | Qué es | Dónde |
|---|---|---|
| **Marca de agua** | Decorativa: opacidad ≤15%, `pointer-events-none`, detrás del contenido. Es una textura | `FormWfmAnalytics` 100 (`/15`) · `EmployeeDetailView` 80 (`opacity-10`) |
| **Ícono de despliegue** | El protagonista de una pantalla o de un estado vacío. Se ve, no decora | `FeedbackOverlay` 96 (kiosco) · `AttendanceMonitorView` 70 (wallboard) · `FormLeadership` 64 (estado vacío) |

El `64` de `FormLeadership` figuraba como marca de agua y no lo es: no tiene
opacidad propia, es la ilustración de "Esperando candidato", con título y
subtítulo debajo. Y el 96 y el 70 no estaban listados.

**Defaults, ahora que la rampa es real:**
- Interfaz suelto: `size={16}` `strokeWidth={2.5}`
- Dentro de un botón o una fila: `size={14}` `strokeWidth={2.5}`
- Badge / chip / contador: `size={10}` o `size={12}`, `strokeWidth={2.5}`
- Estado vacío: `size={36}`–`48`, `strokeWidth={1.5}`

**Icon squircle** (standard container for view/module icons):
```jsx
// Desktop
<div className="bg-gradient-to-tr from-brand to-brand-purple rounded-2xl
                shadow-[var(--shadow-glow-brand-md)] p-2.5
                flex items-center justify-center">
  <Icon className="text-white" size={20} strokeWidth={1.5} />
</div>

// Mobile
<div className="bg-gradient-to-tr from-brand to-brand-purple rounded-xl
                shadow-[var(--shadow-glow-brand-md)] p-2 flex-shrink-0
                flex items-center justify-center">
  <Icon className="text-white" size={16} strokeWidth={1.5} />
</div>
```

Modal icon squircle (AlertModal): `w-20 h-20 rounded-[1.5rem]`
Modal icon squircle (ConfirmModal): `w-14 h-14 rounded-[1.2rem]`
Color comes from `type` prop semantic color, not from gradient.

---

## 13. Layout Components

### AppLayout

File: `src/components/layout/AppLayout.jsx`

Root shell for authenticated views. Renders in this order (z-index ascending):
1. **Ambient background** — 5 fixed radial orbs (z-1, see §4)
2. **Mobile backdrop** — `bg-[#030B1C]/40 backdrop-blur-sm` overlay behind open sidebar
3. **Sidebar** — always dark glass, always visible on desktop, drawer on mobile

Sidebar sizes:
- Collapsed: `w-[4.5rem] xl:w-[5rem]`
- Expanded: `w-[15rem] xl:w-[16.5rem] 2xl:w-[18rem]`
- Mobile: `w-[85%] max-w-[280px]`

Sidebar surface: `data-surface="sidebar"` → `bg-[#07031a]/80 backdrop-blur-2xl border-white/[0.10]`

**Active nav pill:** Absolutely-positioned `div` that tracks the active item's `getBoundingClientRect()` position via `useLayoutEffect`. Runs a 320ms animation loop on route change. Pure CSS transform, no framer-motion. Gradient: `from-violet-500/22 via-indigo-400/14 to-blue-500/8`. Left accent stripe: `bg-gradient-to-b from-violet-300 via-indigo-400 to-blue-400 shadow-[0_0_10px_rgba(139,92,246,0.8)]`.

**Flyout menus:** Appear to the right of collapsed sidebar on mouse hover. State: `flyout = { type:'item'|'group', label, x, y, ... }`. 80ms close delay on `onMouseLeave`.

**Collapse toggle:** `ChevronLeft` button in logo header. Mobile: dispatched externally via `window.dispatchEvent(new CustomEvent('set-sidebar', { detail: true/false }))`.

**Navigation structure** (14 groups in `MENU_GROUPS`):

| Group | Modules |
|---|---|
| Dashboard | overview |
| Inicio | emp_home, emp_schedule |
| Personal | staff_list, payroll |
| Horarios y Turnos | schedules |
| Solicitudes | emp_requests, requests |
| Avisos | emp_announcements, announcements |
| Documentos | emp_documents |
| Asistencia | monitor, time_audit |
| Planificación | vacation_plan |
| Estructura | branches, roles |
| Sistema | permissions, auditview, ios_test |
| Comercial | ventas, metas, facturacion, cotizaciones, promociones, bonificaciones |
| RRHH | entrevistas, encuesta_admin |
| Inventario | productos, laboratorios, pedidos, minmax, ventas_perdidas, compras |

Groups with 1 visible module render directly. Groups with ≥ 2 render as collapsible accordion (CSS `grid-rows` animation, no framer-motion). RBAC: `hasPermission(moduleKey, 'can_view')` gates each item. Items with `comingSoon: true` render as greyed non-interactive with "Próximamente" badge.

**Sidebar footer (expanded):**
- PIN display (kiosk hourly code, copies on click) + SU code (if `su_pin` permission)
- `SidebarSyncStatus` widget
- User avatar + name row → navigates to `/profile`
- Logout button
- `ThemeToggle variant='sidebar'`

### GlassViewLayout

File: `src/components/GlassViewLayout.jsx`

Standard content wrapper for all admin/manager views (not employee-facing). Provides:
- Sticky desktop `[data-surface="page-header"]` with icon squircle + title + filters slot
- Internal scroll container (desktop only)
- Body `[data-surface="card"]` (or transparent with `transparentBody`)
- Floating scroll nav (framer-motion, appears after 150px scroll)

Note: body card uses hardcoded Tailwind classes, not the `[data-surface="card"]` CSS var system — known dark mode blindspot.

---

## 14. Components

### ViewTabBar

File: `src/components/common/ViewTabBar.jsx`

Floating header for views with tabs and/or search. Always rendered above the view body.

**Migrado a tokens en Fase T2 (2026-07-23)** — primer componente documentado
con la plantilla de anatomía/variantes/estados (§8.5). Ya no es el blindspot
de dark mode que describía §22 (pill blanco puro sobre glass oscuro,
corregido con el token net-new `--surface-tab-active`).

**Responsive (2026-07-23, v2.35.0)**: la fila de botones de tabs solo se
muestra en desktop (`hidden lg:flex`). En móvil (`flex lg:hidden`) se
reemplaza por un `LiquidSelect` compacto (`compact bare`, sin `clearable`)
mostrando el tab activo con su ícono — evita que 4-5 tabs (o labels largos
como "Reglas de despacho" en Pedidos a Sucursales) compitan por ancho
horizontal o se trunquen. Nunca un `<select>` nativo ni un dropdown nuevo —
regla del proyecto, `LiquidSelect` en todas partes.

**La barra existe sólo si tiene algo adentro (2026-08-09, v2.546.1).** Dos
reglas, las dos medidas antes de escribirlas:

| Situación | Qué se dibuja |
|---|---|
| `tabs.length > 1` | las pestañas (fila en escritorio, `LiquidSelect` en el teléfono) |
| `tabs.length <= 1` | **nada de pestañas** — con una sola no hay a dónde ir |
| `showSearch` pero **sin `onSearchChange`** | **nada de lupa** — no hay a quién avisarle |
| sin pestañas y sin lupa | **la barra entera devuelve `null`** |

La fila de `onSearchChange` es la que menos se ve venir: `showSearch` vale `true`
por defecto, así que una vista que sólo quería pestañas dibujaba igual la lupa, y
esa lupa no filtraba nada. Con las pestañas de una sola opción ya retiradas quedó
a la vista en Corte Z — una píldora de vidrio de 70px en escritorio con un botón
que no hace nada. La condición ya existía en `usePublicarBuscador` (sin
`onSearchChange` no se publica); faltaba en la lupa.

**En el teléfono el buscador SIEMPRE baja al clúster flotante, haya `FilterBar`
o no (2026-08-09).** La regla estaba escrita desde que existe `CanalDeVista`,
pero sólo se cumplía donde había un `FilterBar`, porque **la barra flotante la
dibujaba únicamente él**. Medido en WebKit iPhone 13, en todas sus pestañas, 5
vistas se quedaban con la lupa arriba —donde se va con el scroll—: Pedidos (5
pestañas), Laboratorios (2), Roles (2), Avisos (3) y Mantenimiento (sin
pestañas).

Hoy `GlassViewLayout` dibuja un **respaldo**: si se publicó un buscador y ningún
`FilterBar` reclamó el clúster, monta un `BarraFlotante` con el buscador solo.
Ninguna vista tiene que enterarse — es el mismo principio de siempre, *el
canónico decide, no el llamador*.

Los dos errores que hay que no cometer al tocarlo:

- **El respaldo lee `filtros` y escribe `barra`, nunca al revés.** Si leyera lo
  que él mismo publica, la condición se apagaría sola: dibuja → publica → «ya hay
  barra» → deja de dibujar → … Es la misma forma del bucle que ya tiró la vista
  al ErrorBoundary una vez (React #185).
- **La condición es `useLayoutCompacto()`, la misma que usa `FilterBar`.** Con
  dos cortes distintos habría anchos con dos clústeres o con ninguno.

Verificado sobre 28 rutas: 25 con buscador lo tienen abajo, **0 duplicados**, y
en escritorio **0 barras flotantes** en las 8 rutas comprobadas.

El umbral es `> 1` y no `> 0`: lo que justifica la barra es que haya **entre qué
elegir**, no que exista una pestaña. Con una sola, el desplegable abría una lista
de un elemento y la fila dibujaba un botón permanentemente activo; en Corte Z era
además una repetición literal del título de la vista.

Y el `return null` importa más de lo que parece: **16 vistas montan `ViewTabBar`
sin una sola pestaña**, sólo por el buscador. Cuando ese buscador se va —en
táctil se lo lleva `FilterBar` por el canal de `CanalDeVista`— quedaba un vidrio
**vacío** de 48px con su borde y su sombra arriba de la vista. El `return` va
**después de todos los hooks**, `usePublicarBuscador` incluido: si subiera, la
barra flotante dejaría de recibir el buscador que esta barra ya no dibuja y
desaparecería de las dos.

**El ancho del selector en el teléfono es elástico.** Era `w-[150px]
sm:w-[190px]`, y esos 150 fijos dejaban al título de Pedidos con 75px — sin
sitio ni para dos renglones. Hoy es `clamp(8.75rem, 34vw, 11.875rem)` en `style`
inline: cede en las pantallas angostas y recupera los 190 apenas hay lugar. Va en
`style` y no en una clase arbitraria porque `clamp()` lleva comas y **una coma
rompe el parseo del valor arbitrario de Tailwind** — la utilidad no se genera,
sin error y sin aviso.

**Anatomía:**
- Contenedor: `data-surface="tab-track"` (nuevo primitivo — `background:
  var(--surface-tab-track)`, `border: var(--border-tab)`, `border-radius:
  var(--tab-track-radius)` = 2.5rem, `backdrop-filter: var(--tab-track-backdrop)`).
  Su sombra flotante (`shadow-[inset_0_2px_10px_...]`) queda como clase
  bespoke — no forma parte del sistema `data-surface` (es un efecto
  "pill flotante", no un nivel de elevación del contrato §8.1).
- Botón de tab: pill `rounded-full`, `h-11 min-w-[44px]` (touch target de
  44px, único tamaño desde la consolidación de VentasView — ver abajo).
- Divisor (`dividerCls`, `bg-divider`) y botón de búsqueda (`bg-brand`)
  quedan como clases bespoke (no forman parte del contrato de superficies).
- ~~`trailingActions`~~ — **retirada el 2026-07-30.** Las acciones de la vista
  viven en `FilterBar` (§16.9, §17). Acá quedan pestañas y buscador.

**Variantes/tamaños:** `showSearch={false}` para tab-only bars.

**En táctil el buscador se va abajo.** Si la vista tiene una `FilterBar` flotante,
ella se queda con el buscador y esta barra no dibuja su lupa — el header se va con
el scroll, así que un segundo acceso al mismo buscador allá arriba es un acceso
que a los tres deslizamientos ya no existe. Lo resuelve el canal de
`CanalDeVista.js` (§17.3), no la vista.

**Matriz de estados:**
| Estado | Clases |
|---|---|
| Tab activo | `bg-surface-tab-active text-content border-surface-tab-active shadow-md scale-[1.02]` |
| Tab inactivo | `bg-transparent text-content-3 border-transparent` |
| Tab inactivo, hover | `hover:bg-surface-tab-active hover:text-content hover:-translate-y-0.5 hover:shadow-md hover:border-surface-tab-active` |
| Botón buscar | `bg-brand text-white`, hover implícito vía `--brand-hover` (T2) |
| Input de búsqueda | `text-content-2 placeholder:text-content-3` |
| Botón limpiar (×) | `text-content-3 hover:text-danger` |
| Botón cerrar búsqueda | `text-content-3 hover:bg-surface-tab-active hover:text-brand` |

**Duplicado — RESUELTO (2026-07-24):** `VentasView.jsx` tenía su propia copia
hand-rolled de este mismo pill (el "structural finding" documentado en
§32/§23) — consolidada al componente real. Efecto colateral: sus botones de tab
pasaron de `h-9 md:h-10` (36/40px, bajo el mínimo táctil) a los `h-11` (44px)
reales. Su único agregado propio, el toggle de privacidad, era un `<button>` a
mano con 11 clases; hoy es un descriptor de `FilterBar.acciones` con `activo`,
así que lo dibuja el canónico y emite `aria-pressed` (2026-07-30).

**Search pattern:** Search button (`bg-brand`) expands an input via `isSearchMode` state. Close via `ChevronRight`. Never add local search inputs inside tab components — search lives here only.

**Usage:**
```jsx
<ViewTabBar
  tabs={[{ key: 'todos', label: 'Todos' }, ...]}
  activeTab={activeTab}
  onTabChange={setActiveTab}
  searchTerm={searchTerm}
  onSearchChange={setSearchTerm}
  showSearch={true}          // false for tab-only bars
  placeholder="Buscar..."
/>
```
Pass `searchTerm` down as prop to tab components. Never duplicate local search state.

### DataTable

File: `src/components/common/DataTable.jsx`

Standard table for all list views. Has own `useTokens()` hook — **all values hardcoded** (dark mode blindspot).

Hardcoded values:
- `cardBg: 'bg-white/55 backdrop-blur-xl'`
- `rowHover: 'hover:bg-[#0052CC]/[0.032]'`
- `headerBg: 'bg-white/[0.15] backdrop-blur-sm'`

Props: `data`, `columns`, `loading`, `skeletonRows`, `empty` (`{ icon, message }`), `onSort`, `sortKey`, `sortDir`, pagination props.

**Sort pattern:** Client-side. Column headers with `sortable: true` are clickable. Numeric columns always `align: 'center'`.

**Empty state:** Rendered inline in table body using `empty.icon` squircle + `empty.message`. Must always be provided.

**Never wrap `DataTable` in an extra card container.** `DataTable` already renders its own `rounded-2xl` card via `tk.cardBg`/`cardBorder`/`cardShadow` — wrapping it in a second `data-surface="card"` div (or any custom `bg-white/... backdrop-blur... rounded-[Nrem]` wrapper) double-cards it and makes the view look inconsistent with every other table view in the app (visible regression fixed in `StaffManagementView` v2.4.2 — it had grown a `data-surface="card"` wrapper with its own internal `overflow-y-auto` scroll region, which also fought `GlassViewLayout`'s own scroll container). Reference implementation: `VentasView` — `<DataTable>...</DataTable>` and `<TablePagination>` are plain siblings directly in the page's `space-y-*` flow, no wrapping div, no toolbar row for a row-count label (the count lives only in `TablePagination`'s own total badge).

#### La sub-tabla: `plano`, no una tabla a mano (2026-08-09)

> **Reemplaza la regla del 2026-07-29**, que decía lo contrario: «una tabla que
> ya vive dentro de una tarjeta **no puede ser `DataTable`**, porque quedaría
> doble-tarjeta», y a cambio daba una receta de `<th>` para escribirla a mano.
> El diagnóstico era correcto —dos capas del mismo material se suman— pero la
> conclusión salía cara: esas tablas no heredaban **nada** del canónico. Ni el
> modo ficha, ni el alto de fila por densidad, ni el contrato de teclado del
> encabezado ordenable. Y la receta de `<th>` no se podía verificar: seguían
> apareciendo variantes nuevas.

La salida es **`plano`**, que quita **sólo** la superficie:

```jsx
<DataTable columns={COLS} plano dense movil={false} minWidth="520px">
```

Todo lo demás sigue siendo del canónico. Con eso, las cinco sub-tablas que
quedaban escritas a mano —el detalle de ubicaciones de Inventario y los tres
historiales de Catálogo, más el resumen por sucursal de Pedidos— pasaron al
canónico y `tabla-a-mano` llegó a **0** el 2026-08-09.

#### Cuándo un `<table>` a mano SÍ es correcto

Tres casos, y ninguno es «esta tabla es chiquita»:

1. **HTML que se imprime.** Una boleta de pago, una planilla, una cotización
   impresa. Van en literales de plantilla hacia `openPrintWindow` y no llegan
   nunca al DOM de la app; `gate:movil` los ignora desde v2.531.1 porque
   neutraliza el contenido de los backticks antes de mirar.
2. **La fila no es un registro: es una matriz.** Una entidad cruzada con sus
   columnas —bloques × poblaciones en Encuesta, empleados × bloques,
   empleados × siete días en `ScheduleCalendar` y en el previsor de horarios—.
   El modo ficha no tiene qué mostrar ahí: una ficha por fila repetiría el
   nombre y listaría las columnas debajo, o sea la misma tabla otra vez y más
   larga.
3. **Un documento con formato propio.** Los visores de DTE y el Corte Z: sus
   columnas son las del documento fiscal y cambiarlas sería mostrar otro
   documento.

Los casos 2 y 3 se declaran en `EXCEPCIONES` de `scripts/mobile-gate.mjs`, **con
el motivo escrito**. Una excepción dice «esto está bien así»; el baseline dice
«esto hay que bajarlo». No se mezclan.

Y si la fila **sí** es un registro pero el teléfono ya tiene su propio camino
—`ExpedienteMovil` con `comoPanel`, como en Compras y Catálogo—, va
`movil={false}` con su motivo en un comentario justo arriba: el modo ficha ahí
sería una tercera forma de lo mismo compitiendo con la que ya se aprobó.

#### El ancla de una fila no puede depender del ancho de la ventana (2026-08-09)

En el teléfono, `DataTable` pone el **ancla** —el número por el que se entra a la
lista: total, monto, saldo— arriba a la derecha de cada ficha. En escritorio ese
mismo dato es la última columna, y ahí nadie lo protegía.

Medido en Ventas: a **1440×900 con el menú abierto** quedan ~1080px de marco
útil, sus ocho columnas pedían más, y la que se salía era **Total**. Se leía
`$3.`, `$28.`, `$8.`, cortado a media cifra. O sea que el dato central de la
pantalla era legible en el celular e ilegible en la computadora.

**La regla:** si a 1440 con el menú abierto la última columna se sale del marco,
**sobran columnas, no falta scroll**. Se baja a `hideBelow` lo que es contexto
—sucursal, método de pago, un identificador secundario— y nunca lo que **es** la
fila: quién y cuánto.

⚠️ **El peldaño `1440` de `HIDE_BELOW` no sirve para esto.** Se implementa como
`min-[1440px]:table-cell`, o sea que **se cumple a 1440** y a ese ancho exacto no
oculta nada. Para que la columna desaparezca en un portátil de 1440 hay que usar
`2xl`. Ya costó una iteración completa, con una medición propia que dijo «entra»
mientras la captura mostraba lo contrario.

Lo vigila `npm run gate:ux`, que lee el barrido de escritorio
(`tests/e2e/barrido-escritorio.spec.js`). No corre en pre-commit —necesita el
navegador y unos 20 minutos— sino en el trabajo nocturno, junto al barrido móvil.

### LiquidSelect

File: `src/components/common/LiquidSelect.jsx`

Full-featured select. Keyboard navigation (↑↓ Enter Esc). Smart flip positioning (opens up when near viewport bottom). Dropdown via `createPortal` to body.

- Trigger: `data-surface="input"`
- Dropdown: `data-surface="dropdown"`
- Dropdown animation: framer-motion AnimatePresence (inconsistency)
- Has own `isDark` prop (not ThemeContext) — **dark mode blindspot**

**Props:**
| Prop | Type | Notes |
|---|---|---|
| `value` | string | Must be string. Use `String(val)`. |
| `onChange` | fn(value) | Called with selected string value |
| `options` | `[{value: string, label: string}]` | value must be string |
| `compact` | boolean | Smaller height |
| `clearable` | boolean | Shows X to clear. Use `false` for required fields. |
| `bare` | boolean | Minimal styling |
| `creatable` | boolean | Allows typing new values |
| `serverSearch` | boolean | Disables client-side filtering |
| `onSearchChange` | fn(q) | Called on input change when serverSearch |
| `isLoading` | boolean | Shows spinner in dropdown |

**Standard usage for required field:** `compact + clearable={false}`.

### ModalShell

File: `src/components/common/ModalShell.jsx`

Envoltura de **todo** diálogo del portal. `createPortal` al `body`, `z-modal` por
defecto, `role="dialog"` + `aria-modal`, cierre con Escape, trampa de foco, bloqueo
de scroll que restaura la posición previa, y la gota de apertura. En táctil convierte
el diálogo en **hoja** (inferior de pie, lateral acostado); `align="pantalla"` lo
vuelve un expediente a pantalla completa con su barra y su botón de volver.

Props principales: `open`, `onClose`, `maxWidthClass`, `zClass`, `align`
(`center`|`top`|`bottom`|`pantalla`), `hojaEnTactil`, `scrim`, `surface`
(`null` cuando el hijo ya declara la suya — si no quedan **dos vidrios apilados**),
`ariaLabel` (pasar **siempre** el título real).

#### UN SOLO DIÁLOGO A LA VISTA (2026-08-09)

**Un diálogo sobre otro está prohibido.** No es preferencia: dos paneles del mismo
vidrio no se distinguen entre sí, así que el de abajo se lee **entero** a través del
de encima —nombre, párrafos y botones encimados—. Reportado sobre Conexiones, con el
diálogo de bloqueo abierto sobre el detalle de la persona.

La regla se sostiene desde el canónico, no desde cada vista:

- `dialogosAbiertos.js` mantiene la **pila** de diálogos abiertos.
- `ModalShell` pregunta si es el de encima; **si no lo es, no pinta** (`display:none`,
  para salir también del árbol de accesibilidad y del recorrido de Tab).
- El de abajo **no se desmonta**: conserva su estado y su scroll, y vuelve intacto
  cuando el de encima se va. Por eso «Cancelar» devuelve la pantalla como estaba.
- El teclado le pertenece al que se ve: Escape y la trampa de Tab se apagan en los
  ocultos.

**Eso es la red, no el diseño.** En desarrollo, abrir un diálogo sobre otro imprime
`[canónico] Diálogo sobre diálogo: «A» se abrió sobre «B»`. Cuando aparezca, el flujo
hay que rehacerlo: un **paso dentro del mismo diálogo**, o cerrar el primero al abrir
el segundo (`SesionesView` lo hace derivando el `open` del detalle:
`open={!!detalle && !porBloquear && !porCerrar}`).

Excepción legítima y única: en **táctil**, `LiquidDatePicker` y `SelectorTactil` se
presentan como hoja y pueden salir desde un formulario que ya es hoja. Ahí el
comportamiento correcto es justamente el del canónico —el formulario se aparta
mientras se elige y vuelve al terminar—, que es como se comporta el sistema operativo.
En escritorio ninguno de los dos es diálogo (uno es popover anclado, el otro
desplegable), así que el caso no existe.

### LiquidModal

File: `src/components/common/LiquidModal.jsx`

Envuelve `ModalShell` con `surface={null}` y declara **él** la superficie del panel
(dos `data-surface="modal"` apilados no suman: multiplican lo que dejan pasar, y a
0.51 daban ≈0.76 — o sea un modal casi opaco). Aporta la anatomía de hoja en táctil
(asa que arrastra de verdad, esquinas rectas contra el filo, tope de 88dvh, pie con
los botones apilados y su área segura) y las tres ranuras de composición:
`LiquidModal.Header` / `.Body` / `.Footer`.

### UnifiedModal

File: `src/components/UnifiedModal.jsx`

Large orchestrator with 30+ type variants controlled by `type` string prop. `getModalSize()` maps type → `max-w-*`. All form modals use this component. Wraps ModalShell.

### ConfirmModal

File: `src/components/common/ConfirmModal.jsx`

Confirmación destructiva / no destructiva. **Usa `ModalShell`** (la nota vieja decía
que lo saltaba con su propio `createPortal` y un `z-[99999]`: dejó de ser cierto y
enseñaba a escribir diálogos a mano). Ya no lee un prop `theme` — 100% tokens.

Props: `isOpen`, `onClose`, `onConfirm`, `title`, `message`, `confirmText`, `cancelText`, `isDestructive` (default `true`), `isProcessing`.

Processing state: replaces text with spinner, hides cancel button.

### AlertModal

File: `src/components/common/AlertModal.jsx`

Single-button info/success/error. Uses ModalShell. `z-[9999]`. Ya no lee un prop `theme` — 100% tokens, nota stale corregida (2026-07-25).

Props: `isOpen`, `onClose`, `title`, `message`, `type` (`'success'|'error'|'info'`), `buttonText`.

Type determines icon (CheckCircle2 / AlertCircle / Info), glow color, button color.

### PromptModal

File: `src/components/common/PromptModal.jsx`

Nuevo (2026-07-25, regla cero-nativo §9.0 — reemplaza `window.prompt()`). Mismo shell visual que `ConfirmModal` (glass modal, glow, footer 2 botones), con un `<textarea>` para pedir una nota corta antes de confirmar.

Props: `isOpen`, `onClose`, `onConfirm` (recibe el texto), `title`, `message`, `placeholder`, `confirmText`, `cancelText`, `isProcessing`, `required` (si `true`, el botón de confirmar queda deshabilitado hasta que haya texto).

### LiquidTooltip

File: `src/components/common/LiquidTooltip.jsx`

Hover-only tooltip (mouse, not touch). `createPortal` to body. `z-[9999]`. Positions via `getBoundingClientRect()`. Clamps to prevent viewport edge clipping.

Props: `content` (JSX or string), `side` (`'top'|'bottom'`), `children`, `className`.

Glass style: `bg-white/85 backdrop-blur-2xl backdrop-saturate-[180%] border-white/90 rounded-2xl px-5 py-3.5`.

### TablePagination

File: `src/components/common/TablePagination.jsx`

Pagination bar used under DataTable. Uses framer-motion `motion.button` + `layoutId="activePage"` (inconsistency).

### LiquidToast

File: `src/components/common/LiquidToast.jsx`

Toast notifications. `createPortal` to body. `z-[9999]`. Reads `theme` from `useToastStore` (separate from ThemeContext) — **dark mode blindspot**.

### BranchChips

File: `src/components/common/BranchChips.jsx`

Horizontal scrolling branch selector. Container uses `.glass-surface` CSS class. ResizeObserver for responsive overflow.

### LiquidAvatar

File: `src/components/common/LiquidAvatar.jsx`

User avatar with skeleton shimmer preloader, lazy image load, fallback to initials or `User` Lucide icon.

---

### 14.1 `SelectorTactil` — la lista larga con el pulgar

`LiquidSelect` abre un dropdown ANCLADO al trigger. Con mouse está bien; en un
teléfono se rompe de tres maneras a la vez, medidas el 2026-07-30 en WebKit con
perfil de iPhone sobre el filtro de laboratorio del conteo (220 opciones):

| | |
|---|---|
| el dropdown hereda el ancho del trigger | **190 × 216px** → ~4 opciones visibles de 220 |
| se abre pegado al trigger | si el trigger está abajo (dentro de una hoja de filtros), **el teclado del sistema lo tapa** |
| pasado `searchThreshold` la lista arranca vacía | dice "Escribe para buscar" y el campo es invisible, superpuesto al trigger |

O sea que no era un problema de tamaño: el patrón anclado no es el correcto para
táctil. `SelectorTactil` lo reemplaza por una hoja de pantalla completa con
buscador fijo, lista agrupada por letra con encabezado pegajoso, y **riel A–Z
arrastrable** con burbuja de letra.

**No se usa a mano.** `LiquidSelect` decide: puntero grueso **y** más de **12**
opciones (o `serverSearch`). El corte no es `searchThreshold` (80) porque ése es
un número de escritorio —cuándo conviene escribir en vez de mirar— y en un
teléfono dejaba un hueco malo entre 13 y 80: dropdown de ~4 filas y sin buscador,
porque el buscador también aparecía a los 80. **12 es donde el dropdown anclado
deja de mostrar la lista completa en un teléfono.** Por debajo se recorre de un
vistazo y una hoja de pantalla completa sería desproporcionada.

**La letra del cajón no es el primer carácter** (`src/utils/alfabetico.js`, con
prueba unitaria). En el catálogo real 71 de 356 laboratorios traen prefijo del
ERP (`1-ABBOTT NUTRICIONAL`, `3-*BONIN`, `1.1-INSUMOS`): agrupar por el primer
carácter manda a Abbott al cajón "1", donde nadie lo busca. Se saltan todos los
caracteres iniciales que no son letra, y **el orden usa la misma clave** — si se
ordena por el nombre crudo y se agrupa por la letra limpia, los grupos no quedan
contiguos y el índice aterriza en cualquier parte.

Dos cosas que costaron encontrar, anotadas para el próximo:

- **El riel apunta a la `<section>`, no al encabezado.** El encabezado es
  `sticky`: cuando está pinchado arriba su rect coincide con el del contenedor y
  el delta sale 0, así que el índice no movía nada. Y el desplazamiento va por
  `getBoundingClientRect`, no por `offsetTop` — `offsetTop` se mide contra el
  ancestro POSICIONADO más cercano, que no es el contenedor scrolleable.
- **`LiquidSelect` no registra su cierre por click-afuera cuando usa la hoja.**
  La hoja va por portal al `body`, o sea fuera de `selectRef`, así que cada toque
  dentro de ella contaba como "afuera": arrastrar el índice cerraba el selector.
  Escape y el fondo ya los da `ModalShell`.


## 15. Controles canónicos

> Reescrito el 2026-07-27 (D4). La versión anterior decía *"No shared button
> component — patterns are inline"* y mostraba hex crudos y radios fijos. Eso
> dejó de ser cierto y era lo que hacía que la deuda volviera: cada persona que
> leía este documento escribía otro botón a mano.

**Regla base: no se escribe un control a mano.** Si lo que necesitás no está
acá, el paso es proponer el canónico —no resolverlo inline en la vista.

### 15.1 La forma la decide el TEMA, no el componente

`--btn-radius` cambia por tema: **`9999px` en liquid glass, `0.5rem` en sólido**.
Por eso `rounded-btn` ya rinde píldora en vidrio y rectángulo en sólido, y por
eso **ningún control lleva un radio fijo**.

```jsx
// ❌ clava la forma y pelea con el tema sólido
<button className="rounded-full …">

// ✅ la forma sale del token
<Button>Guardar</Button>
```

Cuando se midió, había seis radios distintos en botones (`rounded-xl` 186,
`rounded-full` 109, `rounded-2xl` 82, `rounded-btn` 50, sin radio 48,
`rounded-lg` 32). No eran seis decisiones: eran seis formas de ignorar el token.

### 15.2 `Button`

```jsx
import Button from '@/components/common/Button';

<Button onClick={guardar}>Guardar</Button>
<Button variant="secondary" icon={X} onClick={cancelar}>Cancelar</Button>
<Button variant="destructive" size="xs" icon={Trash2} iconOnly onClick={borrar} />
<Button tone="success" icon={Check}>Aprobar</Button>
```

| prop | valores | para qué |
|---|---|---|
| `variant` | `primary` · `secondary` · `ghost` · `destructive` | **jerarquía** |
| `tone` | `success` · `warning` · `chart-1…9` | **categoría**, no jerarquía. Excluyente con `variant`. |
| `size` | `xs` · `sm` · `md` · `lg` | sale de `--control-h`, con piso de 44px en táctil |
| `icon` · `iconOnly` · `loading` · `disabled` | | |

`variant` y `tone` son ejes distintos a propósito: *primary* dice **cuán
importante es**, *success* dice **de qué se trata**. Mezclarlos en un solo eje
fue el error que se corrigió al medir los 115 botones coloreados.


#### `soft` — el relleno tenue (2026-07-27)

```jsx
<Button tone="success" soft size="sm">Aprobar</Button>
<Button tone="danger"  soft size="sm">Rechazar</Button>
```

Salió de medir 37 botones a mano con `bg-success/10`, `bg-danger/10`,
`bg-warning/10`. No eran capricho: los `tone` del canónico son todos **sólidos**,
y un relleno sólido grita. Dos sólidos juntos compiten por ser el principal; el
tenue dice *"esta acción es de esta categoría, pero no es la acción principal de
la pantalla"*. Migrarlos a sólido habría perdido ese dato.

**Cuándo usarlo**

- Hay **dos o más acciones de categoría juntas y ninguna manda**. Aprobar /
  Rechazar en una fila de solicitud: las dos importan igual, ninguna es "la"
  acción.
- La acción es de categoría pero **secundaria a un primario que ya está en la
  misma vista**. Un `primary` azul y un `soft success` conviven; un `primary` y
  un `tone success` sólido pelean.
- Va **dentro de una tarjeta o una fila**, no en la barra de acciones principal.

**Cuándo NO**

- Es *la* acción de la pantalla → `variant="primary"`.
- Es **destructiva y definitiva** (borrar de verdad) → `variant="destructive"`
  sólido. Atenuar una acción irreversible es mentirle al usuario sobre su peso.
- No tiene categoría, solo jerarquía → `secondary` o `ghost`.

`soft` **solo funciona junto a `tone`**: es la misma categoría con menos peso, no
una categoría distinta. Sin `tone` se ignora. Y **no lleva barrido**: el fondo es
un tinte translúcido, no hay superficie que refleje la luz — misma regla que ya
dejaba fuera a `ghost` y `secondary`.

Se combina con `iconOnly`: un botón de ícono puede ser `tone="success" soft`
para confirmar o `tone="danger" soft` para cerrar. `tone`, `soft`, `size` e
`iconOnly` son ejes independientes.

#### El ✕ es CROMO, no una acción de categoría (2026-08-05)

Salió de una pregunta del usuario sobre el ✕ del toast —«no se ve bien, ¿es
canónico?»— y la respuesta era que no había canónico. Al medirlo: **66 botones
`icon={X} iconOnly` repartidos en tres variantes** (19 `destructive`, 19
`secondary`, 28 `ghost`) para lo que son **tres trabajos** distintos, y la
variante no seguía al trabajo. `FinalizarCajasModal` tenía las dos formas en el
mismo archivo, a nueve líneas una de otra; `EmployeeFormModal` quitaba siete
filas de lista en `destructive` y la octava en `ghost`.

La variante la decide **qué pasa al apretarlo**, nunca dónde está dibujado:

| El ✕… | variante | por qué |
|---|---|---|
| **Cierra o cancela** una superficie — modal, hoja, panel, popover, banner, toast, buscador desplegado, edición en línea | `ghost` | Cerrar no borra nada y no es la acción de la pantalla: es cromo. |
| **Quita una fila** de algo que el usuario está armando y todavía no guardó — un teléfono del formulario, una línea de la cotización | `ghost` | Se deshace no guardando. Tampoco destruye nada todavía. |
| **Limpia los filtros** aplicados | `tone="danger" soft` | Es la forma que `FilterBar` ya dibuja para su «limpiar todo». |
| **Borra de verdad, ya** | *no lleva ✕* | Lleva `Trash2`. El glifo distingue los dos: **✕ = cerrar o quitar; papelera = borrar.** |

De ahí la regla mecánica, y es la que vigila el gate: **`variant="destructive"`
nunca va con `icon={X} iconOnly`.** Una pastilla roja sólida para cerrar miente
sobre lo que pasa al apretarla, y en un toast de error competía con el rojo del
ícono a 300px de distancia. Si de verdad hace falta un borrado sólido, el ícono
correcto no es el ✕.

Lo mismo con `secondary`: sigue siendo legítimo en un botón cualquiera, pero un
✕ de cerrar en `secondary` es un botón con relleno y borde para un control que
solo debe estar cuando se lo busca. Los 19 se unificaron a `ghost`.

### 15.3 `SegmentedControl` — una de N opciones

Si el estilo depende de `X === valor`, **no es un botón con estado**: es este
control. Se midieron 123 botones escritos así.

```jsx
<SegmentedControl
    value={modo} onChange={setModo} label="Modo"
    options={[
        { value: 'mes', label: 'Por mes' },
        { value: 'dia', label: 'Por días' },
    ]}
/>
```

Cada opción acepta `tone` propio cuando el color lleva información (ej. el
alcance de permisos, donde el color separa "Todos" de "Mi Sucursal").
Semántica: `role="radiogroup"`, para que un lector anuncie "2 de 3".

**Cuándo NO**: muchas opciones o vienen de datos → `LiquidSelect`. Navegación
entre secciones → los `tabs` de `ViewTabBar`. Cada opción hace algo distinto →
son botones sueltos.

### 15.4 `Switch` y `Checkbox`

```jsx
<Switch checked={activo} onChange={setActivo} label="Notificaciones" />
<Checkbox checked={ok} onChange={setOk} label="Acepto" />
<Checkbox indeterminate={parcial} checked={todos} onChange={marcarTodos} label="Todos" />
```

**Sin `onChange` son indicadores, no controles**: renderizan un `<span>` en vez
de un control enfocable. Es para los que viven dentro de una fila que ya es
clickeable, donde un segundo control sería otra parada de tabulación hacia la
misma acción.

`Checkbox` reemplaza a `<input type="checkbox">` **siempre**: la casilla nativa
se pinta con el color del sistema operativo e ignora los cuatro temas. Es la
misma regla que ya existía para `<select>`.

### 15.5 `TabBarAction` — el botón de acción de una vista

**No se instancia a mano.** Desde el 2026-07-30 lo renderiza `FilterBar` a partir
de los descriptores de `acciones` (§17); la vista describe la acción, el canónico
decide cómo se dibuja en cada tamaño:

```jsx
<FilterBar … acciones={[
    { key: 'nuevo', icon: UserPlus, label: 'Nuevo', variant: 'primary', onClick: crear },
]} />
```

Una sola primaria por barra; el resto `quiet`, con el color reducido al ícono.
Sin halo: `shadow-glow-*` se dibuja igual sobre fondo claro que oscuro, así que
en los temas sólidos no se ve luminoso sino sucio.

**Dos tamaños.** `md` (44px) es el de siempre. `sm` (36px) es el que usa
`FilterBar` en su píldora de escritorio, y existe por el contrato de altura de
§17 —"son 52px tenga una ranura o cinco": 36 del control + 8 de aire arriba y
abajo—. Un botón de 44 la estiraría a 60 y la desalinearía de todas las demás.
No baja del mínimo táctil porque en táctil esa píldora no se dibuja: ahí
`FilterBar` es la barra flotante, donde los botones miden 44 y 48.

El nombre quedó de cuando estas acciones vivían en `ViewTabBar`; ya no van ahí
(§16.9).

#### El TONO lo decide el ícono — `TONO_POR_ICONO` (2026-07-30)

Auditados los **193 botones `iconOnly`** del proyecto: **18 íconos se dibujan con
2 a 4 colores distintos**. El ojo aparece sin tono, `chart-1`, `success` y
`secondary`; `Download` es `success` en Personal y `chart-1` en Facturas de
Compra. El mismo ícono significa lo mismo y se ve distinto según la pantalla.

El arreglo es un mapa y no N ediciones — mismo principio que `NOMBRE_POR_ICONO`,
y en el mismo archivo (`iconNames.js`): **si el llamador no dice de qué color es,
lo dice el ícono.**

| familia | íconos | tono |
|---|---|---|
| crear / confirmar | `Plus` `Check` `CheckCircle2` `Save` | `success` |
| sacar datos | `Download` `Upload` `FileOutput` | `success` |
| mirar sin tocar | `Eye` `EyeOff` `Search` `Maximize2` `Printer` | `chart-1` |
| rehacer / traer | `RefreshCw` `RotateCcw` `Copy` | `chart-1` |
| modificar | `Edit2` `Edit3` `Pencil` `SquarePen` | `warning` |
| archivar | `Archive` | `chart-4` |
| destruir | `Trash2` `Trash` | `danger` |

**Se tiñe el ÍCONO, no el relleno.** `TONE_CLASSES` de `Button` es relleno sólido
con texto blanco, así que aplicar el tono como fondo habría convertido cada fila
de acciones discretas en una hilera de bloques de color. En una superficie neutra
el color identifica la categoría sin gritar — es la regla que `TabBarAction quiet`
ya seguía, y la que se ve en la píldora de Ventas: fondo neutro, ojo azul.

**Lo consumen `TabBarAction` y `Button`** (2026-07-30). Tres cosas lo desactivan,
y las tres a propósito:

| desactivador | por qué |
|---|---|
| `tone` explícito | el llamador manda; esto es el piso, no el techo |
| variante **rellena** (`primary`, `destructive`) | el fondo ya es del color y el ícono va en blanco; teñirlo lo haría desaparecer |
| botón **con texto** | ahí el color sale del papel del botón en el formulario, no de su ícono |

La segunda es la que preserva el `Check` en `destructive` de un "confirmar
borrado" —va en rojo aunque el mapa diga que un check es verde—, y la primera la
que deja en pie los clústeres de acción por fila (Facturas de Compra pinta
Eye/Download/FileJson/Archive de `chart-1` a la vez).

**Medido al aplicarlo**: de los 193 `iconOnly`, **20 pasaron a llevar color** y
172 quedaron igual — 41 de ellos por decisión explícita. El tono explícito suele
codificar la ACCIÓN y no el ícono, y eso es correcto: `Eye` + `success` es
"restaurar sugerencia", `RefreshCw` + `success` es "recontratar", `RotateCcw` +
`chart-3` es "regenerar con IA" (`chart-3` es el color de IA del portal).

#### `soloIcono` es un TAMAÑO, no una clase de más

`soloIcono` **reemplaza** el tamaño del botón, no lo complementa: pasa a cuadrado
(`w-9 h-9 px-0` en `sm`) y el ícono crece de 14 a 18px. Los 14 están calibrados
para ir al lado de un texto —ahí el ícono acompaña—; sin rótulo el ícono ES el
botón y necesita su proporción.

Es la misma lección que `Button` ya tenía escrita para su `iconOnly`, y volver a
tropezarla costó: se intentó apagar el relleno con un `px-0` en el `className` del
llamador y **perdió contra el `px-3.5` del tamaño** — entre dos utilidades de
Tailwind el ganador lo decide el orden de la hoja de estilos, no el del atributo
`class`. Resultado medido: un botón de 36px con 28 de relleno y el SVG aplastado
a **6×18** en vez de 18×18. El usuario lo reportó como "el ícono es demasiado
pequeño". El `<svg>` lleva además `shrink-0`: es un elemento flex más y se deja
aplastar.

Y **quita el rótulo él mismo** (2026-07-30). Hasta esa fecha `soloIcono` solo
cambiaba el relleno y el tamaño del ícono: el texto se seguía pintando, así que
cada llamador tenía que acordarse de pasar `children={null}` *además* de la prop.
`FilterBar` lo hacía en su renderer de `acciones`; nadie más lo sabía, porque no
estaba escrito en ningún lado. El primer llamador directo que no lo supo dibujó
"RESTAURAR 10 OCULTOS" encima del select de al lado. Una prop que promete "sin
rótulo" tiene que ser la que lo quite — si no, es una convención, y las
convenciones se olvidan.

El texto no se pierde: sin `label`, `children` es lo que nombra al botón para un
lector de pantalla.

#### En táctil todo modal es una HOJA

Centrado y con *zoom* es la gramática del escritorio. En un teléfono deja los
botones a media pantalla, lejos del pulgar, y cuando abre el teclado el panel
sube y se recorta. La hoja nace pegada al borde donde está la mano — y es la
misma gramática que ya usaban la hoja de filtros y la de acciones de
`BarraFlotante`, así que sin esto **dos cosas que hacen lo mismo** (tapar la
vista hasta que la cierres) entraban de dos maneras distintas.

`ModalShell` resuelve `align="center"` a `"bottom"` cuando se cumple
`(hover: none)` — mismo criterio que `soloIcono`: manda el dispositivo de
entrada, no el ancho. `align="top"` se respeta siempre: es el ⌘K, que quiere
estar bajo los ojos y no bajo el pulgar.

Las dos correcciones del contenido van al hijo con variantes de descendiente
(`[&>*]:rounded-b-none`, `[&>*]:pb-[max(16px,env(safe-area-inset-bottom))]`) para
no editar los 18 llamadores: lo que cada uno rendea fue escrito para un panel
centrado, así que trae esquinas redondeadas abajo —contra el filo de la pantalla
se ven como un error— y ningún respeto por el área segura. Medido en un iPhone:
"Cancelar" quedaba debajo del indicador de inicio.

La única salida es `hojaEnTactil={false}`, y existe para **las alertas**. Un
aviso corto con un botón no es un panel con el que se trabaja: es una
interrupción. Centrado en medio de la pantalla se lee como tal; subiendo desde
abajo se confundiría con la hoja de filtros, que es algo que se usa y se
descarta. No es una excepción de conveniencia — el gesto de entrada dice de qué
tipo de cosa se trata.

`align="top"` no es un permiso para quedarse arriba en el teléfono. `ConfigPanel`
y `LabsPanel` lo tenían y ahí dejaba el panel flotando a 10vh del borde superior,
que es el antipatrón que este cambio vino a quitar. Se lo sacaron: no son paletas
de comandos, son formularios. `top` queda solo para el ⌘K.

**El guard va afuera, nunca en `open`.** Los children de JSX se evalúan al crear
el elemento, no al montarlo, así que `open={!!fila}` no protege un cuerpo que
dereferencie `fila` — revienta con null antes de que `ModalShell` decida nada. Va
`{fila && <ModalShell open …>}`, o todo el cuerpo con encadenamiento opcional.

#### `HojaMovil` — el CUERPO canónico de un modal en el teléfono

`ModalShell` resuelve *cómo entra* (desde abajo, en táctil). `HojaMovil` resuelve
*cómo se ve por dentro*, que era lo que faltaba: cada modal seguía rendeando el
cuerpo escrito para un panel centrado de escritorio, y en una hoja eso falla por
tres razones concretas.

* **El título centrado no tiene con qué alinearse.** Una hoja ocupa el ancho
  entero y el ojo entra por el borde izquierdo. La hoja de filtros y la de
  acciones ya ponen su título ahí.
* **Los botones en fila se reparten el ancho**: en 390px quedan dos blancos de
  ~180px con el texto apretado. Apilados son dos objetivos de ancho completo
  (medido: 356px), que es lo que el pulgar acierta sin mirar. **La acción
  principal va primera** — queda arriba, lejos del borde.
* **El ícono de 64px centrado** se come la mitad del alto útil de una hoja corta.
  Al lado del título dice lo mismo en una línea.

```jsx
<ModalShell open={abierto} onClose={cerrar} surface={null}>
    <HojaMovil titulo="¿Recalcular MIN/MAX?" icono={Info} tono="brand"
        pie={<><Button …>Calcular</Button><Button variant="secondary" …>Cancelar</Button></>}>
        Se generarán nuevos borradores…
    </HojaMovil>
</ModalShell>
```

El material sale de **`data-surface="modal"`**, no de clases sueltas: fondo,
borde, sombra, radio y `backdrop-filter` vienen de `index.css`, así que la hoja
responde a los cuatro temas sola. Medido: `blur(24px)` real, y el fondo pasa de
`rgba(240,248,255,.85)` a `rgba(12,17,43,.9)` sin tocar nada.

Dos detalles que costaron una corrida cada uno:

* **`rounded-b-none!` con el modificador de importancia.** El radio lo fija
  `[data-surface="modal"]`, que es un selector de atributo —misma especificidad
  que una clase— y le gana por orden de hoja. Sin el `!`, las cuatro esquinas
  quedaban en 32px y las de abajo curvaban contra el filo de la pantalla.
* **`data-hoja`** marca la hoja para que el parche de `ModalShell`
  (`:not([data-hoja])`) la saltee: ese parche existe para los cuerpos heredados,
  no para el canónico.

Solo el **cuerpo** scrollea. El título se queda arriba y las acciones abajo, así
que en una hoja larga nunca hay que scrollear para recordar qué se está
decidiendo ni para confirmarlo.

#### El modal de MÓVIL es un canónico distinto al de escritorio

No es una adaptación: son dos piezas con reglas propias, porque el tamaño de
pantalla y la forma de tocar son otras. `HojaMovil` es el de móvil.

**Sin velo.** El scrim es una convención de escritorio: ahí el diálogo es una
ventana flotando sobre un lienzo grande y hay que decir cuál manda. En un
teléfono la hoja ya ocupa el borde inferior entero y llega desde el control que
la abrió — se entiende sin atenuar nada, y oscurecer la vista la hace leerse como
*otra pantalla* en vez de como la misma que se desplegó. `ModalShell` lo apaga
solo en táctil (`scrim` lo fuerza si hiciera falta). El diálogo **sigue siendo
modal**: el fondo es un objetivo de cierre invisible, no ausente.

#### `AsaHoja` — el tirador es canónico, no un div repetido

Estaba escrito a mano en **seis** sitios, en dos variantes distintas (`w-9`/`/40`
y `w-10`/`/30`), así que dos hojas del mismo portal tenían tiradores diferentes.

No es decoración: es **la única señal de que eso se cierra hacia abajo.** En una
hoja sin asa la salida es el fondo —que no se ve— o `Escape`, que en un teléfono
no existe. Por eso va en un canónico y no como opción de cada hoja: un elemento
que entra desde abajo tiene que decir cómo se sale, y eso no puede depender de
que su autor se acuerde.

#### El pie decide solo: fila cuando entran, apilados cuando no

Apilar cuesta ~52px de alto, y con el teclado abierto en un teléfono de 844px eso
es el **11% del área útil** — justo en las hojas que abren teclado, que son las
que más necesitan el espacio. Pero en fila, tres acciones o un rótulo largo se
aprietan.

Así que no se elige por modal: `flex-wrap` con `basis-36` deja que el layout
resuelva cada caso. Dos rótulos cortos entran en fila; una tercera acción o un
rótulo largo empujan el salto solos. Una prop para decidirlo sería una prop que
alguien olvida.

`flex-row-reverse`: en escritorio la principal va a la derecha, o sea que es la
última del DOM. Invertida, en fila queda a la derecha igual, y **al envolver cae
arriba** — que es donde llega el pulgar.

#### La gota es de `ModalShell`, no de las hojas

El gesto no es de las hojas: es de **cualquier cosa que se abra por un toque**.
Una alerta centrada y el ⌘K también salen de un botón, y decir de dónde salieron
vale igual en las tres posiciones. Por eso `useGotaApertura` lo usa `ModalShell`
y lo hereda todo el portal sin que ningún llamador pida nada.

**El origen se lee al ABRIR, dentro del efecto — no al montar.** `ModalShell` no
se desmonta entre aperturas: vive mientras viva la vista. Congelarlo en el primer
render lo dejaba en `null` para siempre, porque ahí el usuario todavía no había
tocado nada. En `HojaMovil` no se notaba porque esa sí se remonta en cada
apertura, y por eso el defecto apareció recién al subir la gota al canónico.

**Se recorta el elemento QUE LLEVA EL VIDRIO, nunca su envoltorio.**
`clip-path` en un ancestro crea un backdrop root, igual que `transform` y que
`opacity`. Medido: con el clip en el envoltorio de `ModalShell`, el texto de la
lista se leía **nítido** a través de la hoja durante toda la apertura y el vidrio
aparecía recién al terminar. El clip PROPIO no rompe nada — por eso la primera
versión, que vivía dentro de `HojaMovil`, funcionaba, y el defecto apareció justo
al generalizarla.

Es la séptima vez que esta familia de reglas muerde en el proyecto y la primera
por `clip-path`. La forma de no volver a pisarla: **animar siempre el elemento
que tiene el material, nunca uno que lo contenga.** `objetivoVidrio()` lo
resuelve; la sombra, que vive en el envoltorio y no se recorta, se apaga mientras
dura la gota para que la hoja no proyecte su sombra entera siendo todavía una
gota.

#### La hoja NACE del control que la abrió — y se RECORTA, no se escala

Un `@keyframes` fijo solo sabe escalar "un poco desde abajo": no conoce la
posición ni el tamaño del botón, así que se lee como *algo entró*, no como *esto
se abrió*. Se probó y no alcanzaba.

Tampoco sirve un FLIP con `transform: scale()`, y el motivo es específico del
vidrio: **el `backdrop-filter` se escala con el elemento.** A `scale(0.14)` los
24px de blur valen ~3, así que la hoja arrancaba casi transparente y ganaba el
efecto recién al llegar a su tamaño. Se ve exactamente como lo que es: el vidrio
llegando tarde.

Lo que se anima es **`clip-path: inset()`**. La hoja está siempre a tamaño real
—con su blur a 24px desde el primer cuadro— y lo único que crece es la ventana
por la que se la ve: empieza en el rectángulo exacto del control, con radio de
píldora, y se abre hasta el panel. De paso el contenido nunca se deforma, porque
nunca se escala. Medido: `transform: none` y `blur(24px)` en todos los cuadros.

**Y no hace falta pasarle nada.** Si nadie da un `origen`, `HojaMovil` lo toma de
`leerUltimoToque()` —un listener de `pointerdown` en fase de captura, con una
vigencia de 1.2s—, así que **toda** hoja del portal nace del control que se tocó.
La primera versión lo pedía por prop y solo la tenían las hojas de
`BarraFlotante`: una prop opcional es una prop que alguien va a olvidar, que es
la misma lección del `buscador` que 1 de 22 vistas pasaba.

Con teclado no hay gota: el foco no es un gesto espacial, y hacer nacer la hoja
de un sitio que nadie tocó contaría algo falso.

El clip se **retira al terminar**: dejarlo puesto recortaría cualquier sombra o
popover que la hoja quiera sacar fuera de su caja.

**La animación va en la hoja, nunca en el envoltorio**, y por eso `ModalShell`
acepta `animacionPropia`. Un `transform` propio no rompe el `backdrop-filter`;
uno **ancestro** sí.

Y por la misma razón, **cuando no hay velo el contenedor no se anima**.
`animate-in fade-in` le pone `opacity` entre 0 y 1 durante 500ms, y un ancestro
con opacidad < 1 **también** es un backdrop root: medido `0 → 0.29 → 0.68 → 0.90`
mientras la hoja se abría, o sea el vidrio muerto durante toda la entrada y
apareciendo de golpe al terminar. Es la misma regla que ya mordió por
`transform`, ahora por `opacity`. Sin velo no hay nada que desvanecer, así que la
animación del contenedor no solo sobra: era la que rompía el efecto.

**La salida es la misma gota al revés**, y más rápida (180ms contra 520): abrir
es una invitación y admite demorarse, cerrar es una respuesta y cualquier demora
ahí se siente lenta. El contenido se va primero para no verse aplastado.
`ModalShell` avisa del cierre por `EstadoDialogoCtx` — un contexto en su propio
`.js`, porque un módulo que exporta un componente y además otra cosa rompe el
fast-refresh.

**El origen se congela en el primer render.** Al cerrar hay que volver al mismo
sitio del que se salió, y para entonces `leerUltimoToque()` ya devuelve el toque
que CERRÓ —el fondo, o el botón de cancelar—, no el que abrió.

**El radio final del recorte se lee del elemento, no se escribe.** Estaba quemado
en 28px, y eso solo es cierto en los temas de vidrio: en `solid` el token baja a
12px y las esquinas del recorte no coincidían con las del panel.

#### Un solo material para toda la capa móvil

`MATERIAL_HOJA` vive en `HojaMovil` —el canónico de la capa— y lo importa
`BarraFlotante` para su clúster. La barra y lo que la barra despliega son la
misma capa; con superficies distintas se leían como piezas de dos sistemas.

Se llegó a esto por un reporte: "Calcular" y "Parámetros" no se veían igual que
la hoja de la barra. Era literal — esas usaban `modal` (85%) y la de la barra
`card` (16%). **Un canónico con dos materiales no es un canónico.**

#### Sombra hacia ARRIBA: el eje que a la escala le faltaba

`--shadow-elevation-*` baja siempre, y una hoja inferior tiene un solo borde
visible —el de arriba— contra una lista que sigue viva detrás. Sin sombra ahí el
corte se lee plano. `--shadow-hoja` es ese eje (más corta y dura en los temas
sólidos, como el resto de la escala en ese tema).

Va en el **envoltorio** de `ModalShell`, no en la hoja: `data-surface` fija el
`box-shadow` del panel y le ganaría por orden de hoja — la misma trampa de
especificidad que el radio. Y cuelga de **`esHoja`**, no de `autoHoja`: las hojas
que ya pedían `align="bottom"` no pasan por la conversión automática, así que
atarla a `autoHoja` la dejaba fuera justo de las que más se ven.

#### En los temas sólidos: el gesto se queda, el material no — y la animación es OTRA

`solid` y `solid-dark` son temas deliberadamente sin vidrio, así que la hoja
entra **con el mismo gesto** sobre un panel opaco: la animación es *información*
—de dónde salió esto— y el vidrio es *material*. Un tema puede renunciar al
segundo sin renunciar al primero.

Pero **la técnica cambia**. `clip-path` existe solo para preservar el
`backdrop-filter`; sin vidrio esa razón desaparece y queda el costo — animar
`clip-path` obliga a rasterizar cada cuadro. Ahí se usa `transform` + `opacity`,
que son las dos propiedades que el compositor mueve sin volver a pintar. Es el
camino barato, en el tema que justamente eligió no pagar por el vidrio.

**La condición no es el nombre del tema**: es `getComputedStyle(el).backdropFilter
!== 'none'`. Así no hay una lista de temas que actualizar cuando aparezca el
quinto, y la regla se lee sola — *si no hay blur que preservar, usá lo barato*.

#### La hoja de la barra NACE del control que la abrió

La barra flotante y sus hojas son **una sola pieza**: la hoja es la barra
desplegándose, no un diálogo aparte. Dos consecuencias en el canónico:

* **Mismo material.** El clúster y sus hojas leen el mismo `data-surface` desde
  una constante única (`MATERIAL` en `BarraFlotante`). Con dos superficies
  distintas se leían como dos piezas apiladas — y tenerlo en un solo sitio hace
  que cambiar el material sea una línea, no una búsqueda.
* **Misma animación de origen.** `HojaMovil` recibe `origenX` —la x real del
  botón tocado, medida del DOM— y se despliega desde ahí con
  `@keyframes hoja-desde-origen`. Lo que se lee es "este botón se abrió", no
  "algo entró por abajo".

La animación va **en la hoja, no en el envoltorio**, y por eso `ModalShell`
acepta `animacionPropia`. Un `transform` PROPIO no rompe el `backdrop-filter` del
elemento; uno **ancestro** sí. Si la animación viviera en el panel de
`ModalShell`, la hoja perdería el vidrio justo mientras se abre — es la quinta
vez que esta regla aparece en el proyecto.

#### `LiquidModal` en táctil: la misma hoja, por composición

`HojaMovil` es de **props** (`titulo`, `icono`, `pie`); `LiquidModal` es de
**composición** (`Header`/`Body`/`Footer` con JSX arbitrario de cada consumidor).
Convertir el segundo al primero obligaría a reescribir sus 6 llamadores, así que
en táctil se le da la anatomía de hoja **por dentro** —asa, esquinas rectas
contra el filo, tope de 88dvh y el pie apilado con su área segura— y los cubre a
todos sin tocar ninguno. Las dos formas producen la misma hoja.

El pie apila con **`flex-col-reverse`**, no `flex-col`: en escritorio la acción
principal va a la derecha, o sea que es la última del DOM. En orden natural
quedaba abajo del todo, contra el filo, con "Cancelar" arriba. Invertido, "la de
más a la derecha" se vuelve "la de más arriba" — la misma jerarquía leída de otra
manera.

**Y `LiquidModal.Footer` adoptó la forma que sus consumidores ya tenían escrita a
mano.** El canónico existía y lo usaba 1 de 6; los otros 5 repetían el mismo div
carácter por carácter (`flex-none px-6 md:px-10 py-5 border-t flex
justify-between items-center`). Se adoptó esa forma real en vez de imponer otra y
romperlos — un canónico que nadie usa no es un canónico, es una opinión.

#### Una sola ranura se anuncia por su NOMBRE, y con la anatomía del clúster

En el teléfono, si la vista tiene **exactamente un filtro**, el botón no dice
"Filtros" —rótulo genérico para algo que ya tiene el suyo— sino **"Sucursal"**, y
lleva el ícono de ese control. Se sabe qué hay adentro sin abrirlo.

Y es un **botón del clúster**, no un select estirado ahí adentro: en la barra
todo lo demás es un círculo con su rótulo debajo, y un select embebido era la
única pieza con otra anatomía.

El ícono se lee del propio control y no de una prop nueva en cada vista:
`FilterBar.Opciones` ya recibe el suyo y `FilterBar.Sucursal` lo publica como
estático (`Sucursal.iconoRanura`). **Una prop opcional es una prop que alguien va
a olvidar** — es la misma lección del `buscador` que solo 1 de 22 vistas pasaba.

#### La barra flotante avisa cuánto ocupa

Está en `position: fixed`, así que no empuja nada: el final de la lista quedaba
**debajo** del clúster y las últimas filas eran inalcanzables. La barra publica
`--alto-barra-flotante` midiéndose con `ResizeObserver` —el alto cambia con los
rótulos, con el campo de búsqueda abierto y con el área segura— y el contenedor
de scroll de `GlassViewLayout` lo suma a su relleno inferior:
`pb-[max(2.5rem,calc(var(--alto-barra-flotante,0px)+0.75rem))]`. El `max` deja el
relleno de escritorio intacto donde la barra no existe.

Los 12px y no más: **la página tiene que terminar donde termina el contenido.**
El primer intento sumaba la barra a los 40px que ya había y dejaba 50px de vacío
después del paginador, que se lee como que la vista siguiera. Medido a 430×932:
relleno 111px, hueco visible 22px.

#### En la barra flotante el campo sube ENCIMA, y el buscador va último

Orden canónico: **`principal · acciones · buscador`**. Lo que más se toca queda
bajo el pulgar; lo que abre teclado se va al extremo, porque un toque accidental
ahí cuesta media pantalla de teclado.

Al tocarlo, el campo aparece como **fila propia arriba del clúster** y los cuatro
botones se quedan. Antes se estiraba *dentro* del clúster y expulsaba a los
otros, así que buscar y filtrar eran excluyentes.

Se eligió sobre cuatro variantes con maqueta. La descartada de cerca era el campo
pegado al **encabezado de la pantalla**: el teclado ocupa la mitad de abajo, así
que el dedo teclea abajo y el ojo salta ~500px en cada letra, justo a la zona que
el pulgar no alcanza. Arriba de la barra el texto sale a dos dedos de donde se
escribe.

#### En táctil `soloIcono` NO existe

Un botón sin texto apuesta todo su significado al tooltip, y **un tooltip se abre
con el mouse encima**: en un teléfono no hay "encima". Ahí el rótulo deja de ser
un lujo y pasa a ser el único nombre que el botón llega a tener — un ícono sin
nombre alcanzable es un botón adivinanza.

Por eso `TabBarAction` ignora `soloIcono` cuando la media query `(hover: none)`
se cumple, y el llamador no tiene que hacer nada. Se decide por **dispositivo de
entrada, no por ancho**: una tablet ancha tampoco tiene hover, y una ventana
angosta de escritorio sí lo tiene.

Del mismo arreglo (2026-07-30): el rótulo ya no lleva `hidden sm:inline`. Esa
clase lo escondía bajo 640px, que es justo donde más falta hace —en la hoja de
filtros del teléfono los botones son de ancho completo y salían con un ícono
suelto y 300px de vacío al lado—, y arriba de 720px, el único sitio donde la
píldora de escritorio se dibuja, no llegaba a aplicarse nunca. Solo hacía daño.

#### `soloIcono` lleva `LiquidTooltip`, nunca `title`

Un botón sin texto necesita que su rótulo sea **descubrible**, y el `title` del
navegador no sirve: es cromo nativo —no se estiliza, tarda un segundo largo en
aparecer y en táctil no existe—, justo lo que la regla cero-nativo evita. Lo pone
`FilterBar` solo, con `side="bottom"` para no tapar la fila de arriba. El
`aria-label` sale igual del `label` del descriptor.

### 15.6 `Notice` — aviso inline

```jsx
<Notice variant="warning" icon={Search}>
    Resultados similares — no hubo coincidencias exactas
</Notice>
```

El del medio entre `AlertModal` (interrumpe) y los banners de página. Dice algo
*acá*, junto a lo que se habla. `role="status"`, no `alert`: informar no es
interrumpir.

---

### 15.7 `ListRow` — fila de lista

```jsx
<ListRow icon={Building2} title="La Popular" subtitle="Chalatenango"
    trailing={<Badge tone="success">Abierta</Badge>} onClick={abrir} />
```

Tres densidades (`sm`/`md`/`lg`), sacadas de los tres grupos que ya existían en
el código, no de una escala inventada. Se dibuja como `<button>` si recibe
`onClick`, como `<a>` si recibe `href`, y como `<div>` si no: una fila que no
hace nada no debería ser enfocable. La ranura `leading` acepta ícono, letra o
imagen.

**`selected` no es `active`.** `active` es *dónde estoy* (la fila del menú de la
ruta actual); `selected` es *qué elegí*. Se veían igual cuando la única señal
era el borde.


**`tone`** tiñe la fila entera con su categoría (2026-07-27). Una fila que
representa algo anulado, vencido o urgente **es** de esa categoría, y antes eso
solo se podía decir tiñendo el ícono. El tinte es suave a propósito, nunca
sólido: una fila es un contenedor de contenido, no una acción — misma razón por
la que existe `soft` en `Button`.

#### Tarjeta seleccionable = `ListRow` + `Checkbox`

No hay un `SelectableCard`, y es a propósito (decisión 3b, 2026-07-27). Las 9
"tarjetas seleccionables" del portal eran esta composición:

```jsx
<ListRow density="lg" selected={elegido === op.id} onClick={() => elegir(op.id)}
    icon={op.icon} title={op.label} subtitle={op.hint}
    trailing={<Checkbox checked={elegido === op.id} />} />
```

La casilla es lo que resuelve la ambigüedad — sin ella, "seleccionada" y
"activa" se dibujan igual y no significan lo mismo.

---

### 15.8 Cuándo NO es un botón (cierre de D3.3, 2026-07-28)

Se abrieron los **137** `<button>` escritos a mano que quedaban. Migraron 77;
los otros 60 **no** eran deuda: eran el canónico equivocado. Esta sección
existe para que nadie los "arregle" de nuevo.

#### Navegar no es una acción → `<Link>`

```jsx
// ❌ pierde ⌘+clic, la vista previa de la URL, y suena como "botón"
<button onClick={() => navigate('/payroll')}>Nómina</button>

// ✅
<Link to="/payroll">Nómina</Link>
```

Los **nueve** ítems del menú principal eran botones. Eso costaba tres cosas que
la gente usa todos los días: ⌘/Ctrl+clic y el botón del medio no abrían en otra
pestaña, el navegador no mostraba a dónde lleva, y un lector de pantalla
anunciaba "botón" para los 36 enlaces del menú.

El `onClick` se queda **solo para el efecto secundario** (cerrar el panel en
móvil, cerrar un flyout). Navegar lo hace el `href`.

#### Los cuatro casos donde el `<button>` a mano es correcto

| caso | por qué el canónico lo rompería | ejemplo |
|---|---|---|
| **Segmento pegado** dentro de un borde común (`items-stretch` + `border-r`) | `Button` le da a cada uno su radio y su sombra: se ve la costura | `ChipDoc` de Facturación |
| **Tarjeta rica** — avatar, contador, barra de progreso | `Button` no tiene ranuras para eso | `PanelCompletitud` de Sucursales |
| **Tres estados**, no dos | `SegmentedControl` solo distingue activo/inactivo | la rejilla de meses: *elegido* / *hoy* / *resto* — migrarla borra el aro del día de hoy |
| **Superficie bespoke** | tiene su propio lenguaje visual, declarado | login, kiosco |

**Si se repite, se extrae a un componente local.** No a `Button` — a un
componente con nombre en el mismo archivo. Así se cerraron `ChipDoc` (4 copias),
`TarjetaTelefono` (2) y `PanelCompletitud` (3).

#### Lo que SÍ debe tener todo control, canónico o no

Un botón sin esto **no dice lo que es**: su estado vive en el color del borde y
en un chevron girado, o sea que no existe para quien no lo ve.

| si el control… | lleva | ejemplo |
|---|---|---|
| alterna un modo | `aria-pressed` | pausar el refresco, ocultar montos |
| abre o cierra algo | `aria-expanded` | encabezado de sección plegable |
| marca dónde estás | `aria-current` | paso de un asistente, mes de hoy |
| es una de N excluyente | `role="radio"` + `aria-checked` | lo pone `SegmentedControl` |
| no tiene texto | `aria-label` o `title` | lo pone `Button` desde el ícono |

**Y la distinción que más se equivoca**: `aria-pressed` es para un **interruptor
de dos estados**. Si el botón abre otra pantalla, agrega algo y se cierra, o su
texto ya cambia según el modo, **no lleva `aria-pressed`** — sería mentir sobre
lo que es. Se anota en el código por qué, porque el próximo barrido lo va a
volver a marcar.

Si el control no responde (sin permiso, con cero datos), lleva `disabled`. Un
`onClick` condicional que no hace nada **simula** que responde.

#### `SegmentedControl` vs `FilterBar.Chip`

```jsx
// una sola activa  → radiogroup, anuncia "2 de 4"
<SegmentedControl value={estado} onChange={setEstado} options={…} />

// varias a la vez  → cada chip es un interruptor independiente
<FilterBar.Chip active={sel} onToggle={…}>Sucursal</FilterBar.Chip>
```

Confundirlos da un `radiogroup` que anuncia **"1 de 6"** para algo donde pueden
estar las seis. Se apagan al volver a pulsarlos y dibujan su × cuando están
activos.

#### `stacked` — tarjeta de elección vertical

```jsx
<SegmentedControl layout="block" columns={3} stacked options={…} />
```

`layout="block"` ya existía para las tarjetas de elección, pero solo horizontal.
`stacked` pone el ícono **arriba** del texto y cambia el radio a `rounded-card`:
una tarjeta alta con `rounded-btn` sale con forma de pastilla.

> **Trampa al migrar a `layout="block"`**: el canónico **ya es una grilla**. Si
> se deja el `<div className="grid grid-cols-3">` original envolviéndolo, las
> tarjetas quedan metidas en una sola celda, a un tercio del ancho y con las
> etiquetas encimadas. Build, lint y gate pasan en verde — solo se ve mirando.

#### El gate lo sostiene

`button-name` falla si aparece un `<button>` cuyo contenido son solo íconos y no
tiene `aria-label` ni `title`. Nace en **0 y bloqueante**, igual que
`input-label`.

---

### 15.9 `FileField` — adjuntar un archivo

```jsx
<FileField label="Constancia (PDF/IMG)" accept=".pdf,image/*" maxSizeMB={10}
    file={archivo} url={guardado} onChange={setArchivo} />
```

Un adjunto es una **fila**, no una caja punteada (decisión 2c, 2026-07-27). En
estos formularios el archivo casi siempre ya está y lo que más se hace es verlo
o reemplazarlo; una zona de arrastre de 120px optimiza el caso menos frecuente y
en un formulario con seis adjuntos deja una pared de cajas.

Se arrastra igual. La fila se ilumina **solo cuando lo que viene son archivos** —
se leen los tipos del `dataTransfer`, que el navegador sí expone durante el
arrastre — y se queda quieta si es texto o un link.

| prop | para qué |
|---|---|
| `emptyState` | `neutral` (opcional) · `pending` (falta y debería estar) · `missing` (falta y es error) |
| `busy` + `busyLabel` | el archivo se sube al elegirlo y eso tarda |
| `maxSizeMB` | límite real; **el texto de ayuda se deriva de acá**, no se escribe aparte |
| `name` | nombre del archivo ya guardado en el servidor |

Nunca un `<input type="file">` suelto. Las dos excepciones vivas son selectores
de **foto** (avatar de empleado, foto de producto que abre el recortador): ahí
el disparador es la imagen misma y el resultado va a otro flujo.

---

### 15.10 `LiquidTooltip` — nota al pasar el puntero

```jsx
<LiquidTooltip content="Se sincronizó hace 3 minutos" side="top">
    <span>⟳ Sync</span>
</LiquidTooltip>
```

**El recorte contra el borde usa el ancho REAL** (2026-07-30). Antes se recortaba
contra un medio-ancho fijo —140px el de texto, 180 el rico— sin importar cuánto
midiera. Un tooltip corto cerca del borde derecho se corría hacia adentro más de
100px y quedaba flotando lejos de su botón, con la flecha apuntando al aire. El
cuerpo es `w-max`: su ancho depende del texto y ninguna constante lo representa,
así que se mide ya montado (`useLayoutEffect`) y recién ahí se recorta.

**El tooltip es oscuro en los cuatro temas** (decisión 1a, 2026-07-27). No es
una superficie de la pantalla, es una nota flotando encima, y esa distancia
visual es lo que deja leerla de un vistazo.

Lo que sí cambia por tema es la forma y el material, igual que en `Button`:
redondeado y con blur en Liquid Glass, rectangular y opaco en Solid. Eso vive en
`--tooltip-*` y `[data-surface="tooltip"]`, **no en props** — un radio fijo acá
sería el mismo error que los 54 botones con `rounded-full`. En los dos temas
oscuros el fondo se levanta un escalón: dos oscuros iguales no se separan.

El texto secundario *dentro* del tooltip usa `text-content-tooltip-2`, no
`text-content-3`. Los tokens normales siguen el tema; el tooltip no. Escribir
`text-content-3` sobre él daba gris oscuro sobre fondo oscuro en tema claro —
bug real, estaba en varios de los 30 tooltips escritos a mano.

Se muestra también con el foco del teclado, no solo con el puntero.

#### `LiquidTooltip` vs `title=` — la regla que faltaba (2026-07-29)

Al medir salió una desproporción que el doc nunca explicó: **9 `LiquidTooltip`
contra 208 atributos `title=`**. La lectura fácil sería "hay 208 tooltips sin
migrar", y es falsa — de esos 208, **204 son el único nombre accesible del
control**, y `Button` documenta `title` como fuente de nombre válida (mirá
`nombreAuto` en `Button.jsx`). Quitarlos dejaría 204 controles sin nombre.

Son dos cosas distintas y conviven:

| | `title=` | `LiquidTooltip` |
|---|---|---|
| para qué | **nombrar** un control que solo muestra un ícono | **explicar** algo que el control no dice |
| qué se ve | tooltip del sistema operativo, ~1s de espera, ignora los 4 temas | superficie del portal, inmediata, sigue el tema |
| en táctil | no existe | tampoco, pero ahí el nombre lo lee el lector de pantalla |
| coste | cero | envuelve el elemento (puede afectar el layout) |

- Un botón de solo ícono necesita **un nombre**: `aria-label` (preferido) o
  `title`. Con eso alcanza; no hace falta envolverlo.
- Si además hay que **explicar** —"se sincronizó hace 3 minutos", "este cálculo
  excluye las bonificaciones"—, eso es `LiquidTooltip`.
- **Nunca los dos con el mismo texto.** Había 4 así; el `title` sobraba y solo
  agregaba un tooltip del sistema encima del nombre que ya existía.

#### `title=` sobre un elemento NO interactivo — cuatro patrones (F3, 2026-07-29)

La medición de arriba separó por componente pero no por **tipo de elemento**. Al
hacerlo aparecieron 50 `title=` sobre elementos no interactivos (`span`, `div`,
`th`, `td`, `p`), y la lectura fácil —"son 50 tooltips sin migrar"— es falsa otra
vez. Son cuatro patrones y solo uno se resuelve con `LiquidTooltip`.

| | Qué es | Qué lleva | Cuántos |
|---|---|---|---|
| **A** | El texto visible está **truncado** y el `title` tiene el completo | `title` + `truncate`. Se queda | 12 |
| **B** | Un **gráfico**: punto de estado, avatar en pila, dot por sucursal, ícono suelto | `role="img"` + el `title` de siempre | 22 |
| **C** | Un **contenedor de controles** con nombre | `role="group"` + `title` | 1 |
| **D** | **Prosa suplementaria** sobre texto inline | `LiquidTooltip` | 15 |

**Por qué (A) no se migra.** `LiquidTooltip` envuelve a su hijo en un
`<span className="inline-block">`. Eso rompe exactamente el truncado que el
`title` existe para salvar, y descoloca a un hijo de flex o a un elemento
posicionado en absoluto. En (A) el `title` no es decoración: es el escape del
desborde, y es el markup correcto.

**Por qué (B) es el hallazgo que importa.** Un `<span className="w-3.5 h-3.5
rounded-full bg-success" title="Disponible">` no lo anuncia **nada**: sin `role`,
un lector de pantalla salta el elemento entero y ese `title` no existe para nadie
que no use mouse. Con `role="img"`, el mismo `title` pasa a ser su nombre
accesible —`title` es fuente de nombre válida— así que **un solo atributo le da
nombre al lector de pantalla sin quitarle el hover a nadie**. Cero riesgo de
layout. Migrar esos 22 a `LiquidTooltip` habría roto la pila de avatares
(`margin-left: -6px`) y el posicionamiento del punto de estado, y no habría
arreglado nada de accesibilidad — ver abajo.

**Lo que `LiquidTooltip` NO arregla, y conviene no prometerlo.** Su wrapper es un
`<span>` sin `tabIndex`: **no es focusable**. Sus `onFocus`/`onBlur` solo
disparan si el HIJO lo es. Envolver un texto o un gráfico deja el tooltip igual
de inalcanzable por teclado que el `title`, y en táctil tampoco hay `mouseenter`.
Sobre un elemento no interactivo, `LiquidTooltip` compra **consistencia visual**
(la superficie del portal, sin la espera de ~1 s del sistema), no accesibilidad.
Si la información *importa* y hoy solo vive en hover, la respuesta no es un
tooltip más lindo: es un botón de info o texto visible. Queda anotado como deuda,
no resuelto.

**Un `pointer-events-none` mata el hover.** `CajaFecha` de `ConteoDetailView`
explica en su `title` *por qué* la caja está inerte — y cuando lo está lleva
`pointer-events-none`, así que ningún evento de mouse entra: el texto es
inalcanzable justo en el estado que explica. Ahí `role="group"` al menos se lo da
al lector de pantalla. Arreglar el hover requiere mover el disparador a un
ancestro, y eso es un cambio de esa vista.

#### Tooltip ≠ hover card — dónde termina la regla 1a

Al terminar la migración quedaron 9 elementos que aparecen al pasar el puntero y
que **no** son tooltips. La distinción no es cosmética, decide el color:

| | tooltip | hover card |
|---|---|---|
| contenido | una nota, texto corto | datos con estructura: filas, barras, listas |
| interactivo | no (`pointer-events-none`) | a veces sí |
| superficie | `data-surface="tooltip"` — **oscuro siempre** | `data-surface="dropdown"` — **sigue el tema** |
| ejemplo | "Se sincronizó hace 3 min" | el desglose de Horas Hombre en `TabStaff` |

Una hover card oscura sobre tema claro sería un panel de datos flotando en
negativo — ahí la coherencia con la pantalla pesa más que la separación. Los que
quedan como hover card: los 3 de `FacturacionView`, `EncuestaView`,
`TabExpediente` y los 2 de `TabStaff`.

**Excepción con significado:** los tooltips de `EmployeeRequestsView` usan
`bg-danger-solid`. Ahí el rojo *es* el mensaje ("las fechas se solapan"), y
pintarlos de navy quitaría información. Un tooltip puede llevar color semántico;
lo que no puede es llevar un gris crudo elegido a ojo.

### 15.11 `PortalInput` — el campo de formulario (cierre de D3.4, 2026-07-28)

Un campo con etiqueta se escribe **siempre** con `PortalInput`. Él pone el
`<label htmlFor>` asociado, el badge "Requerido", el borde de error,
`aria-required`/`aria-invalid`/`aria-describedby`, y la superficie del tema.
Escrito a mano, en la práctica, nunca sale con todo eso: de los ~20 campos con
etiqueta que quedaban en julio, **ninguno asociaba su `<label>` con el campo** —
hacer clic en la etiqueta no enfocaba nada.

```jsx
// ❌ el patrón que apareció ~20 veces
<div>
    <label className="text-caption font-black uppercase …">Monto</label>
    <div className="relative">
        <span className="absolute left-4 …">$</span>
        <input type="number" className="w-full pl-8 …" />
    </div>
</div>

// ✅
<PortalInput label="Monto solicitado" name="sol-monto" prefix="$"
             type="number" value={monto} onChange={…} />
```

**Ranuras, para que no haya que salirse.** Cada una existe porque su ausencia
mandó campos a escribirse a mano; el número es lo que se recuperó al agregarla:

| ranura | qué resuelve | rescató |
|---|---|---|
| `label` **opcional** | la celda de grilla no lleva etiqueta visible — el encabezado de su columna ya dice qué es. Era lo ÚNICO que dejaba 43 campos afuera | **43** |
| `tono` | el campo tintado por semántica o categoría (salario en verde, MIN en naranja) | 33 |
| `onDark` | superficie oscura bespoke: kiosco. Anatomía del canónico, paleta bespoke — igual que en `ListRow` y `Badge` | 1 |
| `className` | va al CONTENEDOR (para `inputClassName` está el otro): lo necesitan las celdas de ancho fijo `w-16`, `w-32`, `flex-1` | — |
| `icon` · `prefix` | el ícono o el `$` que si no se posicionan en absoluto ENCIMA del campo | — |
| `labelAction` | una acción a la derecha de la etiqueta (`+ Agregar`) | 37 |
| `compact` | 32px en vez de 40, para grillas densas | — |
| `helperText` · `inputClassName` · `...rest` | ayuda inline, clases del texto, y `min`/`max`/`step`/`inputMode`/`ref` | — |

**Sin `label` el `aria-label` es obligatorio** y el mensaje de error pasa a
`sr-only`: la señal visible sigue siendo el borde rojo. El gate lo verifica en
`input-sin-nombre`, cero absoluto (§25.1).

**La acción va AFUERA del campo.** El ojo de ver/ocultar contraseña y el botón
de regenerar código estaban posicionados en absoluto encima del `<input>`. Van
como hermanos, en una fila:

```jsx
<div className="flex items-end gap-2">
    <div className="flex-1"><PortalInput label="Cod. Empleado" … /></div>
    <Button iconOnly icon={RefreshCw} aria-label="Generar un código nuevo" … />
</div>
```

**`tono` — el campo tintado.** Cuando el campo lleva un color semántico o de
categoría (el salario nuevo en verde, el MIN propuesto en naranja y el MAX en
azul, las cantidades recibidas en el color de su fila):

```jsx
<PortalInput label="Nuevo Salario Base Mensual" tono="success" icon={DollarSign} … />
```

Valores: `brand`, `success`, `danger`, `warning`, `chart-1`, `chart-3`,
`chart-4`, `chart-6`, `chart-9` — **la paleta cerrada de §6.0, sin excepciones**.
Con `tono`, el contenedor NO emite `data-surface="input"`: esa regla de
`index.css` va sin `@layer` y le ganaría a las utilidades de Tailwind, así que
el borde tintado no se vería.

### 15.12 Cuándo un `<input>` a mano es correcto — **CUATRO casos**

> Reescrito el 2026-07-28. La versión anterior decía que el caso legítimo era
> "la celda de una grilla densa" y contaba 61. Preguntado por el usuario —*"¿por
> qué son excepción? ¿qué criterio tomaste?"*— fui a verificar el criterio que
> yo mismo había escrito, ancestro por ancestro. **No aguantó.** De los 56, 43
> eran el campo del canónico sin etiqueta, y de los 7 finales, 4 tampoco eran
> excepción: dos eran `PortalInput` reconstruido a mano y dos eran
> `SearchInput expandable` reconstruido. Quedan **4**, y son estos:

| # | dónde | por qué |
|---|---|---|
| 1-2 | `LoginView` (dos campos) | Superficie **bespoke**: fuerza tema claro porque corre antes de que exista sesión — no hay tema de usuario que seguir (§25.4) |
| 3 | `AuthPromptPanel` — el PIN del kiosco | Su borde lleva el **caret virtual animado**, que es el indicador anti-fraude. El canónico dibuja la caja en el CONTENEDOR, no en el `<input>`, así que la animación quedaría invisible |
| 4 | `MenuSearchModal` | La barra del encabezado de ⌘K. No es un campo en una caja: es una fila a todo el ancho con divisor abajo |

**Ninguna otra.** Si estás por escribir un `<input>`, la respuesta es una de
estas cuatro cosas:

```jsx
<PortalInput label="Monto" … />                    // campo con etiqueta
<PortalInput aria-label="Cantidad" compact … />     // celda de grilla, sin etiqueta
<PortalInput aria-label="PIN" onDark … />           // sobre superficie oscura
<SearchInput … />  ·  <SearchInput expandable … />  // buscar (§24)
```

**Las celdas de grilla NO son excepción — son `PortalInput compact`.** Lo que
las mantenía afuera era que el canónico dibujaba el `<label>` siempre, no una
decisión de diseño. Las dos con navegación por flechas (`data-qty-row`/
`data-qty-col`, la hoja de cálculo de recepción) mantienen su `onKeyDown`
propio, que el canónico reenvía por `...rest`.

**Y ninguna está exenta del nombre accesible** — ver §25.1. `aria-label`
obligatorio, y el gate lo verifica en cero absoluto.

---

### 15.13 `LiquidSelect` no se envuelve — el error va en `invalid` (2026-07-29)

`LiquidSelect` se pinta **entero**: lleva `data-surface="input"` (fondo, borde,
radio, sombra) y `min-h-[max(40px,var(--tap-min))]`. **No se envuelve en un div
que le dibuje una caja.**

Hasta v2.219.0 había **46 sitios** que sí lo hacían, para darle borde o marcar el
estado de error. Se veía roto y nadie lo había medido. Los números, tomados del
navegador:

| | El envoltorio | El control real |
|---|---|---|
| Alto | 40 px | **46 px** |
| Radio | 10 px | 8 px |
| Borde | 0 px | 1 px |
| Fondo | rojo 10% (error) | blanco opaco |

El control es 6 px más alto que su caja y con otro radio, así que **el fondo del
envoltorio asoma alrededor** — el select se ve cortado. Y el
`hover:border-brand/40` que el envoltorio traía pintaba color sobre un borde de
ancho cero: nunca se vio nada.

```jsx
// ❌ dos cajas que no coinciden
<div className={`rounded-2xl h-[40px] ${inputHoverClass} ${!v ? '!border-danger !bg-danger/10' : ''}`}>
    <LiquidSelect value={v} … />
</div>

// ✅ el canónico se pinta solo; el error es una prop
<LiquidSelect invalid={!v} value={v} … />
```

`invalid` usa **`outline`**, no `border`/`bg`: en un elemento con
`data-surface="input"` esas dos pierden por cascade layers (misma razón que el
anillo de foco, ver `inputStyles.js`). Y emite `aria-invalid` — el rojo solo se
veía; ahora también se anuncia.

El foco/apertura gana sobre el error: mientras se elige manda el anillo azul, y
el rojo vuelve al cerrar si sigue vacío.

**`LiquidDatePicker` es el caso contrario y su envoltorio SÍ va.** Su contenedor
usa `h-full` — toma la altura del padre, no tiene mínimo propio. Quitárselo lo
colapsa. Pasó al migrar esto: el script desenvolvió por la clase del div sin
mirar qué había adentro y se llevó 3 datepickers; lo detectó leer el diff, no el
gate. La regla del gate exige `LiquidSelect` en el cuerpo por eso mismo.

Lo vigila la categoría **`select-con-envoltorio`** de `scripts/design-gate.mjs`,
en cero y bloqueante. Detecta por la forma (un div con alto fijo que contiene un
`LiquidSelect`), no por la clase exacta: un grep por `inputHoverClass` se saltaba
`FormRehireEmployee`, que usaba un alias local — y así se escapan los casos en
una migración a mano.

## 16. Badges, avisos e indicadores

> Reescrita el 2026-07-27 (D4). La versión anterior enseñaba `bg-red-500`,
> `bg-emerald-500/10`, `#0052CC` y `text-[10px]` — colores de Tailwind y
> tamaños a mano que **ignoran los cuatro temas**. Era el ejemplo más directo de
> cómo el documento generaba deuda.

Al medirlos aparecieron **316 "chips"** escritos a mano, y no eran una sola cosa:

| | | |
|---|---|---|
| 249 | 78% | chip inline corto → `Badge` |
| 58 | 18% | aviso con ícono → `Notice` (§15.6) |
| 9 | 2% | contador pegado a un ícono → se queda inline, es geometría |

### 16.1 `Badge` — etiqueta de estado

```jsx
import Badge from '@/components/common/Badge';

<Badge variant="success">Activo</Badge>
<Badge variant="danger" tone="solid">Vencido</Badge>
<Badge variant="warning" size="sm">Por vencer</Badge>
```

`variant` es semántico (`success` · `warning` · `danger` · `info` · `neutral` y
la paleta de gráficos), `tone` elige teñido o relleno. Los colores salen de los
tokens, así que responden a los cuatro temas.

**Nunca** `bg-red-500`, `bg-emerald-500/10` ni un hex. El color de un badge dice
*qué significa*, y eso vive en el token semántico.

### 16.2 `Contador` — la burbuja con un número

> Reescrito el 2026-07-28 (D3.5). Antes decía *"el único caso que se escribe
> inline"* y mostraba el `<span>` a copiar. Se copió nueve veces, y **cuatro de
> ellas dentro de componentes canónicos** (`NotificationBell` ×2, `FilterBar`,
> el del menú lateral). Ahora tiene su propio canónico.

```jsx
// rojo y chico, los defaults
<Contador valor={sinLeer} aria-label={`${sinLeer} sin leer`} />

// "99+" al pasarse, en azul de marca
<Contador valor={n} max={99} tono="brand" aria-label={`${n} filtros aplicados`} />

// pegado a la esquina de un ícono: la POSICIÓN la pone el llamador
<Contador valor={n} className="absolute -top-1.5 -right-1.5 z-content"
          aria-label={`${n} sin leer`} />
```

Devuelve `null` cuando `valor <= 0` — no hace falta envolverlo en `{n > 0 && …}`.

**`aria-label` no es opcional.** Sin él, un lector anuncia "3" suelto y no se
sabe 3 de qué. El componente no lo puede adivinar: solo el llamador sabe si son
avisos, filtros o pedidos.

**Por qué no es un `Badge`:** un chip crece con su texto; un contador tiene que
ser **circular con un dígito y ovalado con dos**, o sea ancho mínimo fijo y alto
fijo. Metido en `Badge` habría dado burbujas de anchos distintos según el número.

El borde del componente va del color de la superficie (`border-surface-card`),
no blanco fijo: recorta el contador del fondo que tenga detrás, y en tema oscuro
un borde blanco dibujaría un halo.

### 16.3 Punto de estado en vivo

```jsx
<span className="relative flex h-2 w-2">
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
  <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
</span>
```

`animate-ping` es decorativo: el tema sólido lo apaga solo, y también
`prefers-reduced-motion`.

**El punto necesita nombre (F3, 2026-07-29).** Un punto de color es información
—verde disponible, ámbar ausente— y un `<span>` sin `role` no lo anuncia: el
lector de pantalla lo salta completo. Va `role="img"` con el texto en `title` o
`aria-label`:

```jsx
<span role="img" title="Disponible"
      className="w-3.5 h-3.5 rounded-full bg-success …" />
```

Con `role="img"` el `title` **es** el nombre accesible, así que no hace falta
duplicarlo en `aria-label` y el hover del mouse sigue funcionando igual. Aplica a
todo indicador puramente gráfico: el punto de estado, el avatar en pila, el dot
por sucursal, la burbuja del cumpleaños. Ver §15.10, patrón (B).

---

## 16.9 Las dos píldoras de una vista — cuál es cuál (2026-07-27)

Una vista tiene **dos** contenedores en píldora, y confundirlos fue lo que me
hizo escribir mal §17. No son intercambiables:

| | píldora del **header** | píldora del **cuerpo** |
|---|---|---|
| canónico | **`ViewTabBar`** | **`FilterBar`** |
| qué lleva | pestañas de la vista + buscador global | los filtros que recortan los datos **+ las acciones** |
| dónde | fila del título, vía `filtersContent` | bajo el título, a la derecha |
| responde | *¿qué sección estoy viendo?* | *¿qué recorte, y qué hago con él?* |

**Las acciones son de la píldora del CUERPO (2026-07-30).** `ViewTabBar` tuvo una
prop `trailingActions` y se volvió un cajón de sastre: además de acciones de
verdad ("Nuevo Empleado", "Publicar", "Exportar") guardaba **filtros** —el rango
de fechas y el tipo de `TabHistory`, el `SegmentedControl` de
`EmployeeAnnouncementsView`, el selector "Copiar desde…" de `PermissionsView`—.
O sea que el header terminó filtrando, que es exactamente lo que §17 dice que no
hace. La prop se retiró: si algo recorta datos o actúa sobre ellos, va a
`FilterBar`. En el header solo queda navegar y buscar.

**La prop está mal nombrada.** `GlassViewLayout` la llama `filtersContent`, pero
**22 de las 34 vistas que la usan le pasan un `ViewTabBar`** — o sea pestañas,
no filtros. Ese nombre me hizo concluir que el header era el lugar de los
filtros, y estaba mal. Si algún día se renombra, `headerContent` sería honesto.

### Estado medido de la píldora del header

| | vistas |
|---|---|
| usan `ViewTabBar` | 22 |
| **escriben la píldora a mano** | **12** |

Las 12 reconstruyen el contenedor —`rounded-header h-[4rem] md:h-[4.5rem]`,
`backdrop-blur-2xl`, sombra y hover propios— y meten adentro un
`SegmentedControl` y un buscador. Todo eso ya lo hace `ViewTabBar`, incluido el
contrato de buscador toggleable de §24 (Escape cierra y limpia; clic afuera
cierra solo si está vacío) y el colapso táctil de las acciones en hoja inferior.
Escribirla a mano significa perder esas dos cosas, no solo verse distinto.

**Nunca escribir el contenedor del header a mano.** Si falta algo, se le agrega
a `ViewTabBar`.

## 17. Filter Pills — canónico `FilterBar` (2026-07-27)

```jsx
<FilterBar
    onClear={limpiar}
    activeCount={n}
    acciones={[
        { key: 'nuevo',  icon: Plus,     label: 'Nuevo Empleado', variant: 'primary', onClick: crear },
        { key: 'export', icon: Download, label: 'Exportar', tone: 'success', onClick: exportar },
    ]}
>
    <FilterBar.Section label="sucursal"><LiquidSelect value={suc} onChange={setSuc} options={sucs} /></FilterBar.Section>
    <FilterBar.Section label="período"><PeriodPicker value={rango} onChange={setRango} /></FilterBar.Section>
    <FilterBar.Section label="estado"><SegmentedControl value={estado} onChange={setEstado} options={estados} /></FilterBar.Section>
</FilterBar>
```

**La píldora donde vive TODO el filtro de la vista actual** — fecha, categoría,
sucursal, estado — **y todas sus acciones**. No es una decoración: es el lugar
único donde el usuario mira para saber qué está filtrando, para soltarlo y para
ver qué puede hacer con lo que quedó.

**Un filtro que solo afecta a UNA sección de la vista igual va en la píldora**
(corregido por el usuario, 2026-08-05). En el Tablero de Metas puse un selector
de sala suelto en el encabezado de la sección de gráficas, razonando que era «de
esa sección y no de la vista». Es la excusa exacta que rompe el canon: el usuario
no sabe que hay un filtro puesto hasta que hace scroll hasta ese encabezado, y la
píldora —que es donde mira— dice que no hay ninguno.

Si el recorte de verdad solo tiene sentido para una sección, entonces **que
filtre la vista entera**: en Metas, elegir una sala deja su tarjeta y sus
gráficas, que es más coherente que un recorte a media pantalla. Y si filtrar
todo no tiene sentido, entonces no era un filtro — era un selector de contenido,
y eso se resuelve con pestañas o con un `SegmentedControl` adentro de la tarjeta,
no con un control que parece un filtro y no está donde viven los filtros.

#### Las acciones son DESCRIPTORES, no JSX

`acciones` es un array, no un ReactNode, y eso no es capricho: el mismo botón se
dibuja de dos maneras muy distintas — `TabBarAction size="sm"` en la píldora de
escritorio, botón de clúster en la barra flotante táctil. Con JSX suelto la barra
flotante solo podría re-renderizarlo tal cual, que es como se llegó a tener
controles de 44px fuera del viewport a 390px.

| campo | qué hace |
|---|---|
| `key` `icon` `label` `onClick` | lo obvio |
| `variant` | `'primary'` (una sola por barra) o `'quiet'` |
| `tone` | color del ícono en `quiet` |
| `disabled` | |
| `activo` | es un interruptor: emite `aria-pressed` y se ve encendido en el clúster |
| `principal` | fuerza (o niega) el botón grande del clúster táctil. Por defecto lo es el `variant: 'primary'` |
| `as` `href` `target` `rel` | para la acción que NAVEGA — un enlace tiene que seguir siendo un enlace |
| `soloEscritorio` | no aparece en el teléfono |

`accionesExtra` es la escotilla ReactNode para lo que no es un botón: un `Badge`
de estado, un `LiquidSelect` de "copiar desde". Va al final de la píldora y a la
hoja de acciones en táctil.

`soloIcono: true` deja el botón sin texto **en escritorio** (el rótulo sigue vivo
en `label`/`title` para el aria y el tooltip). Es para la acción secundaria y
reconocible —Exportar, con el `Download` que ya es el ícono canónico de exportar
en el portal— que con texto le come a la píldora el ancho que necesitan los
filtros. En el clúster táctil sigue rotulado: ahí hay sitio y no hay hover que lo
revele.

#### `FilterBar.Opciones` — uno de N, sin elegir el control

**Hasta 3 opciones es `SegmentedControl`; de 4 en adelante, `LiquidSelect`.** Los
dos son lo mismo semánticamente y la diferencia es de ancho: un segmentado de 5
se come la píldora entera y deja al resto de las ranuras sin sitio. El umbral es
del canónico y no del llamador por el motivo de siempre — una decisión que se
toma vista por vista se toma distinto en cada vista.

```jsx
<FilterBar.Section active={estado !== ''} onClear={() => setEstado('')} label="estado">
    <FilterBar.Opciones value={estado} onChange={setEstado} label="Estado" icon={FileCheck}
        options={[{ value: '', label: 'Todos' }, …]} />
</FilterBar.Section>
```

Se lleva por delante los apaños de móvil: `ConteoDetailView` y
`ConteoInventarioView` forzaban `layout="block" columns={2}` porque el riel de
cuatro no entraba en la hoja del teléfono y arrastraba scroll horizontal. Y con
listas dinámicas —los subfiltros de "Mis Avisos" van de 2 a 6— el control se
adapta solo. `umbral` baja a 2 si las etiquetas son larguísimas; subirlo, casi
nunca.

#### Muchos chips en una ranura: casi siempre son UN select

Cuando una ranura junta media docena de chips, la pregunta previa es si son de
verdad filtros independientes. Casi nunca lo son: si todos contestan **la misma
pregunta** —"¿qué recorte de la lista quiero ver?"— entonces son un
`FilterBar.Opciones` con `umbral={0}`, no seis interruptores.

Se probaron las dos formas en MIN·MAX el 2026-07-30 y la de chips falla en dos
planos a la vez:

* **Rompe el cupo de la píldora.** El reparto cuenta *ranuras*, y ocho chips son
  UNA sola de ~700px: la píldora crecía hasta llenar la fila sin que el desborde
  llegara a activarse. Medido: 809px de píldora contra 1159 de fila.
* **Miente sobre cómo se usan.** Dibujados como ocho interruptores, dicen que se
  combinan; en la práctica nadie mira "excesos" y "sin historial" a la vez, y
  elegir uno apaga a los otros. El select dice eso, y ocupa 185px en vez de 700.

Cada opción lleva **su conteo en la etiqueta** (`261 Excesos`), que es el dato
por el que se elige, y las que dan cero no se listan.

**La acción que solo sirve dentro de una opción se muestra solo ahí.**
"Restaurar ocultos" salía en la píldora siempre que hubiera alguno oculto — o
sea, una acción permanente sobre filas que no están en pantalla, que es un
cambio a ciegas. Ahora aparece cuando la opción "Ocultos" está puesta.

#### `FilterBar.Sucursal` — la ranura de ámbito

La primera del orden y la que más se reescribía: estaba a mano en **9 vistas con
4 textos distintos** ("Todas las Sucursales", "Todas las sucursales", "Todas",
ninguno) y anchos de 150 a 220px, así que la misma ranura se veía diferente en
cada pantalla.

```jsx
<FilterBar.Sucursal value={sucursal} onChange={setSucursal} options={branchOptions} />
```

El texto canónico es **"Sucursales"**: nombra el filtro en vez de describir su
estado vacío, así se lee igual esté puesto o no, y ocupa la mitad — que es el
espacio que la píldora le devuelve a los filtros. **Normaliza también la opción
"todas" que venga dentro de `options`**, que es la mitad del arreglo: casi todas
las vistas la traen ahí con su propio texto, así que el select mostraba ese label
y no el placeholder, y "Todas las Sucursales" en 150px se corta a "Todas las
Suc…". El valor no se toca, solo cómo se lee.

**El divisor las separa de los filtros**, y por eso ahora pueden convivir: lo que
en su día echó a "Publicar" de acá fue que, mezclado entre las ranuras, leía como
un filtro más.

#### Dónde va — resuelto (2026-07-27)

**La barra de filtros va en el CUERPO de la vista, bajo el título. Nunca en el
header.** El header ya tiene su ocupante: la barra de pestañas.

Esto costó una corrección del usuario y vale documentar por qué me equivoqué,
porque la trampa sigue ahí para el próximo:

`GlassViewLayout` tiene una prop llamada **`filtersContent`**, y renderiza su
contenido en la fila del título con `justify-end`. Al ver 37 vistas usándola
concluí que ése era el lugar canónico de los filtros. **Falso**: al mirar qué
le pasan, **22 de ellas le pasan un `ViewTabBar`** — o sea las pestañas de la
vista, no filtros. La prop está mal nombrada, y ese nombre fue exactamente lo
que me hizo leer mal el código.

| ranura | qué va | dónde |
|---|---|---|
| `filtersContent` de `GlassViewLayout` | **`ViewTabBar`** (pestañas) y el buscador | fila del título |
| `FilterBar` | los filtros de la vista | **cuerpo**, bajo el título, a la derecha |

Las 3 vistas que comentaban *"Filter pill — vive en el body, no en el header"*
tenían razón desde el principio. Ventas, Compras, Proveedores y Staff quedaron
bien.

**Filtros sueltos sin contenedor: prohibido.** Son 17 vistas hoy. Sin píldora no
hay orden de ranuras, no hay limpiar-todo y en móvil no hay cuenta de filtros
aplicados.

El divisor también tenía dos escrituras —`h-5 w-px bg-divider` y `w-px h-6
bg-divider`— y por eso una auditoría por grep veía la mitad. Con `FilterBar` el
divisor lo pone el contenedor y esa divergencia deja de ser posible.

### 17.3 `BarraFlotante` — los controles al alcance del pulgar (solo táctil)

`FilterBar` vive en el cuerpo de la vista, y en una pantalla de captura larga
—el conteo son 2,500 renglones— eso significa que después de tres pantallas de
scroll el filtro y el botón de agregar **dejaron de existir**. Con mouse no pasa:
la píldora está a la vista junto con la tabla.

Un clúster fijo abajo a la derecha con **buscador, acciones y la acción
principal**, que se esconde al bajar y vuelve al subir.

**No se usa a mano, y no hay que cablearle nada.** En táctil `FilterBar` **es**
esta barra — el canónico decide, igual que `LiquidSelect` abre `SelectorTactil`
solo. Los tres elementos aparecen sin que la vista escriba una línea:

| elemento | de dónde sale |
|---|---|
| buscador | lo publica `ViewTabBar` por el canal de `CanalDeVista.js` |
| filtros | los `FilterBar.Section` de la propia píldora |
| acción principal | el `acciones[]` con `variant: 'primary'` |

**El buscador NO se pasa dos veces.** Hasta el 2026-07-30 había que dárselo
también a `FilterBar` con `buscador={{…}}`, y de 22 vistas lo hacía **1**. No fue
descuido: el mismo dato había que escribirlo en dos sitios y la copia que falta no
se ve rota hasta abrir la vista en un teléfono. En las 5 pestañas de Productos era
además **imposible** — el estado del buscador vive en `ProductosView` y las
pestañas solo reciben el término ya rebotado, nunca el setter.

`buscador` sigue existiendo como override explícito, para la vista cuyo buscador
no sea el del header.

#### `CanalDeVista.js` — el cable entre las dos píldoras

Las dos píldoras son **hermanas**, no una descendiente de la otra:
`GlassViewLayout` recibe `ViewTabBar` por `filtersContent` y `FilterBar` por
`children`. Un contexto declarado en cualquiera de las dos no llega a la otra, así
que el proveedor lo monta `GlassViewLayout`, el único ancestro común. Dos canales,
en sentidos opuestos:

- **buscador** — `ViewTabBar` publica → `FilterBar` consume.
- **barra** — `FilterBar` publica → `ViewTabBar` consume, y con eso el header
  **no dibuja su lupa en táctil**. Dos accesos al mismo buscador, uno de ellos
  arriba y que se va con el scroll, es peor que uno solo bien puesto.

Sin proveedor (un `FilterBar` dentro de un modal) los hooks devuelven `null` y
todo se comporta como antes.

Dos trampas del canal, las dos costaron:

- **Un `Map` por publicador, no un `useState`.** `filtersContent` se renderiza
  DOS VECES en `GlassViewLayout` (rama de escritorio y rama de móvil, y está
  bien — ahí está documentado por qué), así que hay **dos `ViewTabBar` montados
  publicando a la vez**. Con un `useState`, desmontar la copia oculta al cruzar
  el breakpoint borraría lo que publicó la copia viva.
- **El alta y la baja van en efectos SEPARADOS.** Juntas, en un efecto sin array
  de dependencias, la limpieza corre en cada render — y borrar del `Map` siempre
  lo cambia, así que siempre notifica. Con dos canales apuntándose entre sí eso
  es un bucle cerrado: React #185 ("Maximum update depth exceeded") y la vista
  entera al ErrorBoundary. La baja lleva deps `[canal, id]` y corre solo al
  desmontar.

`flotante={false}` vuelve al botón + hoja inline. Hace falta si un `FilterBar`
vive DENTRO de un modal: la barra va por portal al `body` en capa 40 y quedaría
detrás del modal (capa 100). Hoy ninguno lo hace — los tres usos en modales son de
`FilterBar.Chip`, no del contenedor.

**Elegida sobre cinco anatomías mockupeadas.** Gana por ser la más compacta (94px
con rótulos, pegada a la derecha) y por lo tanto la que menos lista tapa. Dos
reglas la sacan de ser el antipatrón de "tres íconos iguales":

| | |
|---|---|
| **La principal se ve distinta** | Rellena y más grande. Crea algo; las otras ABREN algo. Dibujarlas iguales las hace leer como pares cuando una es la principal. |
| **Los disclosures llevan su estado** | Un ícono dice dónde está el control, no qué está aplicado. El buscador se estira a campo con el término visible; las acciones llevan `Contador`. Sin esto la barra muestra la puerta y esconde el contenido. |

**Los rótulos bajo el ícono aparecen solos cuando hay más de un botón** — con uno
el ícono no compite con nada y el rótulo es ruido. Van debajo y no en un `title`:
en táctil no hay hover, así que un `title` no existe.

**El buscador se estira, no cambia de modo.** El campo crece en el lugar y los
otros botones se quedan; la alternativa (una fila propia arriba) se descartó por
lo mismo que otra variante: dos anatomías en la misma barra. Medido, el área de
tecleo es **160px a 390px de viewport y 90px a 320px** — los 90 de un iPhone SE
son ~6 caracteres, y es lo que da la física con tres controles rotulados. Alcanza
porque es búsqueda incremental. Y el buscador **no** va en hoja: mientras se
escribe hay que ver la lista filtrarse, o no se sabe cuándo parar de teclear. Los
filtros sí, porque se aplican y se cierran.

Tres cosas que costaron y conviene no re-descubrir:

- **Portal al `body`, obligatorio.** Un `fixed` dentro de un ancestro con
  `transform`, `filter` o `z-index` queda contenido por ese ancestro. El
  comentario de la nav inferior de `AppLayout` ya lo decía: *"hermano directo del
  root … el fixed anidado era lo que standalone no pintaba"*.
- **El corte es 719px, el de `FilterBar`** — no `md` (768). Si divergen queda una
  franja de 50px con las dos cosas visibles, o ninguna.
- **`type="text"` con `inputMode="search"`, nunca `type="search"`:** WebKit le
  dibuja al segundo su propia ✕ y salían **dos** botones de limpiar, el nativo
  gris y el del portal. Es la regla cero-nativo — el cromo del navegador no se
  estiliza, se evita.
- **El material sale de `data-surface`, no de clases Tailwind.** Con
  `bg-surface-card border border-border-card` el clúster salía SIN vidrio en Liquid
  Glass: las clases dan el color, pero el `backdrop-filter` lo aplica
  `data-surface` en index.css. Es la misma lección que ya estaba escrita en
  `GlassViewLayout`.
- **El contenedor `fixed` NO se transforma — era el bug del vidrio (2026-07-30).**
  Animaba su entrada con `translate-y-*`, y un ancestro con `translate` establece
  un *backdrop root*: el `backdrop-filter` del clúster muestreaba un fondo VACÍO y
  no difuminaba nada. El usuario lo reportó como *"el liquidglass del filterpill no
  es liquidglass, no se ve a través de él como el header u otra card"*. Tercera vez
  que el proyecto se tropieza con esta regla — index.css ya la documenta para el
  sidebar móvil, con el mismo síntoma medido en un iPhone 13. La animación se movió
  al elemento que lleva el vidrio: un `transform` **propio** no crea backdrop root,
  solo uno **ancestro**. Es por eso que el vidrio de `ViewTabBar` sí funciona
  teniendo `transform-gpu` en el mismo div que su `data-surface`.
- **Y la superficie es `dropdown`, no `card` — medido, no heredado.** Con el blur
  ya vivo se compararon las tres superficies existentes sobre la lista de empleados
  a 390px, con las filas pasando por detrás:

  | | resultado |
  |---|---|
  | `card` (16%) | "SALUD 2" se lee ENTERO y cae encima de "ACCIONES". Es vidrio, pero ilegible |
  | `dropdown` (72%) | lo de atrás queda fantasma, los rótulos del clúster limpios |
  | `modal` (85%) | ya no deja ver nada; es un panel |

  O sea que `dropdown` era la elección correcta **por la razón equivocada**: se
  había subido a 72% para compensar un blur que no existía. Con el blur andando el
  72% es vidrio esmerilado de verdad —se ve el color y el movimiento de la lista a
  través— y cumple el criterio que index.css ya fija para lo que flota sobre
  contenido: que lo de atrás sea LUZ, no texto. `sheet` (98.5%) no sirve acá:
  **su radio es 0**, está pensada para una hoja que llega a los bordes.

  **No agregar una superficie nueva para esto.** La paleta es CERRADA (§6.0).
- **`transition-transform` va como utilidad de Tailwind.** `dropdown` no declara
  `transition` propia en index.css, así que la utilidad manda sin pelearse con
  nada. Y tiene que ser `transition-transform` y no `transition` a secas: en
  Tailwind v4 esa utilidad cubre `translate` además de `transform` —son
  propiedades CSS independientes y `translate-y-*` compila a la segunda—, así que
  sin ella la barra saltaría en vez de deslizarse.
- **El rótulo del botón va a dos líneas, no `truncate`.** En los 60px de la
  columna, "NUEVO EMPLEADO" salía "NUEVO E…", y un rótulo cortado a la mitad no
  dice qué hace el botón — que es justo para lo que está. `line-clamp-2` acota el
  peor caso.
- **El clúster no crece sin límite.** A 320px entran tres columnas de 60px y poco
  más, así que: la principal se dibuja aparte, UNA acción secundaria puede tener su
  propio botón, y de dos para arriba se agrupan tras un botón "Acciones" que las
  abre en hoja. Máximo cuatro columnas.
- **Una sola barra a la vez.** Los tabs de Productos se montan TODOS y se ocultan
  con `hidden`, así que había **tres** clústeres apilados: el portal al `body` los
  saca del subárbol oculto, que es lo que los volvía visibles. `FilterBar` deja un
  ancla de 1px en el flujo normal y un `IntersectionObserver` decide — un elemento
  en `display:none` no intersecta, y cambiar de tab no desmonta nada, así que hace
  falta enterarse en los dos sentidos.

### 17.0 Medidas fijas: la tarjeta, el carril y el cupo de ranuras (2026-07-30)

**Aprobado sobre mockup antes de escribir código.** Las tres piezas y su orden
de prioridad salieron de simular la vista más cargada del portal (Personal: 5
tarjetas, 3 filtros, 3 acciones) entre 1024 y 2560px.

| pieza | medida |
|---|---|
| `StatCard` | mínimo **148**, máximo **200**, separación 8, cupo **5** |
| detalle de la tarjeta | cede bajo **176** |
| `CarrilCards` | **una sola fila**, siempre; lo que no entra se desliza |
| ranura de `FilterBar` | 150 (el control) + 8 de relleno |
| píldora | sin techo: **lo que mida mostrando todo** |

**Quién cede el ancho, en orden:**

1. el **detalle** de la tarjeta (dato terciario)
2. el **texto** de las acciones — y solo lo reclama de vuelta si el carril ya
   muestra las cinco
3. el **carril** se desliza
4. las **ranuras vacías** van al control de desborde
5. **nunca** una ranura aplicada

Medido después de implementarlo, en Personal: 1280→2 tarjetas · 1440→3 ·
1512→4 · 1728→5 · 1920→5 con detalle. Monótono: al agrandar la ventana nunca se
ve menos que antes.

#### El carril y la píldora van en UNA fila — y hay un gate (2026-08-05)

```jsx
<div className="flex flex-col lg:flex-row lg:items-center gap-3">
  <CarrilCards className="flex-1" ariaLabel="…">…</CarrilCards>
  <div className="flex justify-end min-w-0"><FilterBar …>…</FilterBar></div>
</div>
```

Canónico: `StaffManagementView.jsx`. Las **dos** mitades son obligatorias — el
`lg:flex-row` del contenedor y el `flex-1` del carril.

**No es estética, y ahí está la trampa.** `useMedidaFila` (`FilterBar.jsx`) mira
al **abuelo** de la píldora y busca el carril con `querySelector('[role="group"]')`.
Con la píldora en su propio renglón lo **encuentra igual** —es hermano dentro del
mismo contenedor— y le descuenta `RESERVA_CARRIL` (2×148+8+10 = **314px**) por un
carril que no está a su lado. O sea: **el layout equivocado no falla, le roba
314px a la píldora en silencio**, y todo el reparto de arriba asume la fila
compartida.

**Una excepción medida NO se copia.** `ClientesView` tiene el carril y la píldora
en renglones separados con un comentario que lo justifica por medición (su
píldora son 975px con tres ranuras y tres chips, y a 1440px no entran junto a
cinco tarjetas). Ese razonamiento vale **para esa píldora**. El 2026-08-05 se
copió ese layout a una pestaña nueva cuya píldora son **dos chips** —entraba de
sobra— y se heredó la excepción sin el motivo. Antes de separarlos hay que
volver a medir *esta* píldora; si no se midió, va el canónico.

**Y verificar a dos anchos, siempre**: a 1280 el carril debe deslizar y la
acción quedar en ícono; a 1600 todo entra. El cambio de layout destapa
truncamientos que antes no se veían, porque la tarjeta se angosta a 148px.

**La píldora NO baja de renglón, nunca — el que cede es el carril** (regla del
usuario, 2026-08-09). Nada de `flex-wrap`/`lg:flex-wrap` en esa fila, y el
carril se queda con `flex-1` (base cero). Si el ancho no alcanza, lo que se
esconde son las **tarjetas**, que para eso el carril desliza. Ese día se probó
lo contrario —`lg:basis-auto` en `CarrilCards` y `lg:flex-wrap` en las 17 filas,
para que el carril arrancara en el ancho de su contenido y los filtros bajaran
cuando no entraban— porque un instrumento contaba 18 «carriles recortados». Un
carril recortado al lado de la píldora **no es un defecto**: su piso real son los
314px que `FilterBar` le reserva, o sea dos tarjetas enteras y la tercera
asomando. Dos consecuencias para quien vuelva a medirlo:

* el detector de `gate:design` daba `lg:flex-row lg:flex-wrap` por buena (la
  primera rama del OR se cumplía y no miraba el wrap) — corregido: `flex-wrap`
  descalifica aunque esté el `lg:flex-row`;
* la regla 2 de `tests/e2e/medicion-escritorio.js` exceptúa al carril que
  comparte fila con `[data-pildora]`, porque su pregunta —«¿habría entrado en la
  ventana?»— siempre da que sí cuando lo que aprieta es la píldora de al lado.

Lo vigila la categoría **`carril-pildora`** de `gate:design`, agregada el
2026-08-05 justamente porque la regla ya estaba escrita en tres lugares —acá, en
la memoria del proyecto y en el comentario de `ConteoInventarioView`— y se
rompió igual. Arrancó con **15 hallazgos en 10 vistas** de deuda preexistente,
así que va por ratchet: no se puede agregar uno nuevo, y los 15 se bajan vista
por vista con verificación visual (cada una necesita sus dos anchos, no es un
cambio mecánico).

#### El cupo es de la VISTA, no del dato (2026-07-31)

Las otras tres medidas de la tabla son de la tarjeta y viven en sus clases
(`basis-[148px]`, `max-w-[200px]`, `gap-2`). **El cupo de 5 no es una medida: es
un presupuesto del llamador**, y por eso era la única que se podía romper sin
que nada avisara — la escribía la vista, no el canónico.

La regla, dicha entera: **cuántas tarjetas hay lo fija la vista, nunca el dato.**
Un carril de largo variable es un desglose por categoría disfrazado de métricas,
y un desglose contesta **una sola pregunta** —qué recorte quiero ver— dibujada
como N preguntas independientes. Su lugar es una ranura de la píldora
(`FilterBar.Opciones`, `umbral={0}`) **con el conteo en cada opción**, que además
le da la función que como tarjeta no tenía: filtrar.

Ya se resolvió así dos veces, y las dos midiendo:

| vista | antes | después |
|---|---|---|
| MIN·MAX (v2.261.0) | 8 chips de estado, ranura de ~700px | select: píldora 809→640, carril 338→474 (2→3 tarjetas visibles) |
| Facturación · Observaciones (v2.314.0) | 1 + una tarjeta por código de anomalía (6, techo abierto) | 2 tarjetas fijas + ranura "Observación" |

Lo vigila un `console.warn` de dev en `CarrilCards` y no el `design-gate`: el
conteo real sólo existe en ejecución — un `.map()` sobre datos no se cuenta
leyendo el JSX. Avisa en vez de recortar; quedarse con las primeras cinco
escondería métricas en silencio.

#### El ancho se MIDE, no se estima

El primer intento modelaba cada acción en 150px y **se equivocaba por 62 en una
sola píldora**: las medidas reales en Personal son "Nuevo Empleado" 166, "Nuevo
Practicante" 186, "Exportar" (solo ícono) 36. El ancho de una acción es el de su
rótulo, así que ninguna constante lo representa.

`FilterBar` mide las piezas reales en un `useLayoutEffect` —que corre **antes**
del pintado, así que el usuario nunca ve el estado sin degradar— y guarda la
medida hasta que cambien los rótulos. Lo único que sí es constante es la forma
degradada: un botón sin rótulo mide `w-9` = 36px siempre.

**Se observa la FILA, no el envoltorio de la píldora.** El padre ajusta al
contenido —o sea a la píldora—, así que medirlo es un bucle: crece, se mide más
grande, entra otra ranura, crece otra vez. Medido con el padre: la píldora
quedaba clavada en 748px y 2 ranuras de 1280 a 2240px.

#### Cuándo lleva color una tarjeta

**Por defecto NO lleva.** Todas las tarjetas del portal comparten el mismo
vidrio: `data-surface="card"`, siempre. Que una fila mezcle fondos hace que se
lea como cinco componentes distintos en vez de una métrica repetida cinco veces.

| pieza | ¿color? | por qué |
|---|---|---|
| el **número** (`valueCls`) | sí | rojo si es pérdida, verde si es meta: ahí el color ES el dato |
| el **ícono** (`iconBg`+`iconCls`) | sí | identifica la categoría de un vistazo |
| el **fondo** y el **borde** | **no** | solo el estado seleccionado, vía `tono` |

`tono` marca la tarjeta SELECCIONADA y nada más. Se dibuja con `data-tono`
(§5.1) — un anillo del color pegado al borde, no un relleno— y su paleta es
cerrada: `brand`, `success`, `warning`, `danger`.

**Se retiraron `activeBg` e `inactiveBg`**, que recibían clases sueltas de cada
vista: 19 call sites, cada uno con su tinte de fondo y de hover. Y cuando una
vista pasaba `inactiveBg` la tarjeta **perdía `data-surface`**, así que en la
misma fila había tarjetas con vidrio y tarjetas casi transparentes.

#### El rótulo: dos palabras, tres a lo sumo

El rótulo nombra la métrica; el matiz va al `sub`. "Modificados este mes" en una
tarjeta de 148px sale "Modificados e…", que no nombra nada — es `Modificados` +
sub `precios o datos cambiados`.

#### El número encoge antes que cortarse

`$249,456.38` no entra a `text-title-sm` en 148px, y truncado queda `$249,4…`.
El cuerpo baja a `text-body-lg` sobre 6 caracteres y a `text-body` sobre 9: el
número se lee **entero** sin que la tarjeta cambie de ancho, que es lo que
mantiene la fila pareja.

#### `CarrilCards`

Las tarjetas vivían en un `flex-wrap` y eso hacía dos cosas mal: envolvían
—Ventas daba 1, 2, 3 y 4 por fila entre 1280 y 1920— y **la huérfana de la
última fila crecía hasta llenarla sola** (en Personal a 1920: cuatro de 172px y
una de **726**).

- El sobrante **no se tira**: la pista ocupa todo el carril, así que lo que queda
  después de las tarjetas enteras se ve como el borde de la próxima. Un asomo
  dice "hay más" mejor que las flechas solas.
- **Las flechas flotan**, no ocupan. En el flujo se comían 64px de los 438
  disponibles a 1512px: media tarjeta.
- Reserva fija de 2 tarjetas: una sola cortada parece un error de maquetación,
  no un carril.

### 17.0.0 Medidas fijas — versión anterior (2026-07-30)

**La `StatCard` mide 200px SIEMPRE.** Antes era `flex-1 basis-0 min-w-[150px]`,
o sea que se repartía el espacio disponible — y la MISMA tarjeta medía distinto
en cada vista y en cada monitor. Medido antes del cambio:

| ancho | Ventas (4 tarjetas) | Personal (5) |
|---|---|---|
| 1280 | 1 por fila | 2 por fila |
| 1512 | 2 | 2 |
| 1728 | 3 | 3 |
| 1920 | 4 | 4 |
| 2240 | 4 | 5 |

Y la tarjeta **huérfana** de la última fila crecía hasta llenarla sola: en
Personal a 1920px había cuatro de 172px y **una de 726px**. Con ancho fijo, si no
caben envuelven y si sobran deja espacio — pero todas se ven iguales.

**La píldora tiene un cupo fijo de 3 ranuras** (`MAX_RANURAS`); el resto va tras
un `···` que las despliega en un panel anclado. Antes crecía con lo que cada
vista le metiera: medida a 1512px iba de 189px a 782px, así que le robaba a las
tarjetas un ancho distinto en cada pantalla.

**Las ranuras APLICADAS nunca se esconden.** Es lo que hace que el cupo no rompa
la premisa de §17 —"el lugar único donde el usuario mira para saber qué está
filtrando"—: esconder un filtro activo dejaría la vista recortada sin nada
visible que lo explicara. Se esconden las vacías, y el botón lleva un `Contador`
con cuántas de las guardadas están aplicadas.

Y se **eligen** por prioridad pero se **dibujan** en su orden original: el orden
de ranuras (ámbito → entidad → tiempo → estado) es el orden en que una persona lo
diría en voz alta, y reordenarlo al aplicar un filtro haría que la píldora
cambiara de forma con cada clic.

### 17.0.1 El rango de fechas se escribe compacto

`PeriodPicker` mostraba `01/07/2026 → 30/07/2026`: 23 caracteres, ~250px, para
decir dos días del mismo mes — la ranura más ancha de la vista con más ranuras
del portal. **El año se escribe una vez y solo si hace falta**: dentro del año en
curso no se escribe (nadie lee "2026" para enterarse de que estamos en 2026), en
otro año va corto y una sola vez al final, y solo si el rango cruza de año se
escribe en los dos extremos — que es cuando de verdad desambigua.

| rango | antes | ahora |
|---|---|---|
| dentro del año en curso | `01/07/2026 → 30/07/2026` | `01/07 → 30/07` |
| otro año | `01/03/2025 → 30/06/2025` | `01/03 → 30/06/25` |
| cruza de año | `01/12/2025 → 15/01/2026` | `01/12/25 → 15/01/26` |

Los presets siguen ganando: un rango que coincide con "Este mes" o con un mes
entero se muestra por su nombre, no por sus fechas.

### 17.1 `PeriodStepper` — correr el período

```jsx
<PeriodStepper
    unit="quincena" label="16 – 31 julio de 2026"
    isCurrent={esActual} nextDisabled={esActual}
    onPrev={anterior} onNext={siguiente} onReset={irAHoy} />
```

Va **dentro de una `FilterBar.Section`** cuando filtra la vista, o en la
cabecera de un widget con `size="sm"`.

Salió de medir, no de una idea previa: el mismo control estaba escrito a mano
**siete veces con cinco anatomías distintas** —quincena, semana (×2), año, y
tres variantes en el Inicio—, cada una con su tamaño de flecha, su ancho de
etiqueta y su forma de contenedor.

| | |
|---|---|
| `unit` | **obligatorio**. Arma el nombre accesible de las dos flechas; sin él un lector de pantalla anuncia "botón, botón". |
| `onReset` + `isCurrent` | **la etiqueta ES el atajo de vuelta**. En las tres vistas donde uno podía alejarse del período actual había tres formas distintas de volver: un botón aparte, una × de reset, y nada. Sin `onReset` el rótulo es un `<span>`, no un botón muerto. |

**No confundir con:** `TablePagination` (paginar es navegar una lista, no
correr el tiempo) ni `PeriodPicker` (elegir un rango arbitrario). Acá el
período dura siempre lo mismo y solo se mueve hacia atrás o hacia adelante.

### 17.2 `TablePagination` — paginación

```jsx
<TablePagination page={pagina} totalPages={paginas} onPageChange={setPagina}
    pageSize={tam} onPageSizeChange={setTam} total={1284} unit="ventas" />
```

Existe desde antes y lo usan 17 vistas; se **reescribió el 2026-07-27** sobre
siete problemas medidos:

1. El orden estaba al revés — "¿cuántos hay?" vivía en el extremo derecho.
2. Eran **tres islas** separadas por `justify-between`: en pantalla ancha leían
   como tres controles sin relación.
3. El tamaño de página y la página activa usaban **el mismo `bg-brand`**, así
   que competían por significar "activo".
4. **13 paradas de tabulación** para pasar de página.
5. `framer-motion` (§11 dice "no agregar más"), y su `layoutId="activePage"`
   hacía que la píldora **volara entre dos paginaciones** si había dos en
   pantalla.
6. Sin `<nav>` ni `aria-live`.
7. En móvil se partía en tres filas y empujaba la tabla fuera de la pantalla.

**Ahora:** una sola píldora de 52px, orden de lectura (rango → navegación →
tamaño), **4 controles en vez de 13**, `<nav aria-label>` con `aria-live` en el
rango, y el hover sale de `--lift-hover` — en Solid no se levanta.

- **El rango, no el total.** `1–25 de 1,284` responde "dónde estoy" y "cuánto
  hay" a la vez; el total solo no decía dónde estabas.
- **Sin números de página.** En 52 páginas nadie salta a la 37 mirando. El
  "pág. 1/52" es clickeable y se vuelve un campo — así el viejo "Ir a" deja de
  ocupar espacio permanente para una acción rara.
- **Móvil (<720px):** una fila de ancho completo, flechas de 40px pegadas a los
  bordes donde llega el pulgar, estado al centro en dos líneas. El selector de
  tamaño desaparece: nadie cambia cuántas filas ve desde un teléfono.

**Nunca escribir la paginación a mano.** Y no es un `SegmentedControl`: aunque
se comporta como uno-de-N, `role="radiogroup"` es incorrecto para un lector de
pantalla — paginar es navegar, no elegir una opción de un grupo.

## 18. Estados de vista — `StateViews`

> Reescrito el 2026-07-27 (D4). La versión anterior describía el patrón con
> clases sueltas (`w-16 h-16 rounded-[1.5rem] bg-white/50 …`) y por eso se
> reescribió a mano en cada vista. **Existe un componente desde hace tiempo y
> este documento no lo mencionaba** — así es como se acumuló la deuda.

Todo vive en `src/components/common/StateViews.jsx`.

### 18.1 `EmptyState` — obligatorio donde puede haber cero datos

```jsx
import { EmptyState } from '@/components/common/StateViews';

<EmptyState
    icon={FolderOpen}
    title="Sin documentos aún"
    subtitle="Aquí aparecerán tus constancias y boletas."
    action={<Button icon={Plus} onClick={crear}>Subir el primero</Button>}
/>
```

| prop | para qué |
|---|---|
| `icon` · `title` · `subtitle` | el contenido |
| `action` | **la salida**. Sin esto es una pantalla muerta: el usuario ve que no hay nada y no sabe qué hacer. |
| `compact` | dentro de un panel o una tarjeta, no a página completa |
| `iconClass` · `glowClass` | color semántico cuando el vacío tiene un matiz (aviso, error) |

Distinguir **"no hay nada todavía"** de **"tu filtro no encontró nada"**: son
mensajes distintos y la salida también (crear el primero vs. limpiar el filtro).

`DataTable` tiene su propia prop `empty` para el vacío dentro de la tabla.

### 18.2 `Skeleton` y `SkeletonText` — nunca un spinner de sección

```jsx
import { Skeleton, SkeletonText } from '@/components/common/StateViews';

<Skeleton w={48} h={48} rounded="1rem" />
<SkeletonText lines={2} />
```

**El spinner solo va dentro de un botón** mientras una acción está en curso
(`<Loader2 className="animate-spin" />`, y `Button` ya lo hace con `loading`).
Para una sección que está cargando va el esqueleto, que muestra la *forma* de lo
que viene en vez de un girito sin información.

`delayed` (activo por defecto) espera 250 ms antes de aparecer: sin eso, una
carga rápida produce un parpadeo peor que no mostrar nada.

`DataTable` acepta `loading` + `skeletonRows`.

### 18.3 `LoadingState` y `AiThinkingState`

`LoadingState` cubre las tres escalas —`route`, `content`, `inline`— para cuando
todavía no se sabe la forma del contenido. `AiThinkingState` es el estado propio
de las vistas con resumen generado.

---

## 19. Loading & Skeleton States

Fusionado en **§18.2**. Se mantiene el número para no romper referencias
externas.

---

## 20. Scrollbar

Hidden everywhere. Authoritative definition in `src/index.css`:
```css
.scrollbar-hide::-webkit-scrollbar { display: none; }
.scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
```
(Removed duplicate that was in `App.css`.)

Applied to: sidebar nav (`<nav>`), all `overflow-y-auto` containers, GlassViewLayout scroll container.

Never expose the browser scrollbar. If a custom scrollbar is ever needed, it must match the Liquid Glass aesthetic.

---

## 21. Platform & Native (Capacitor)

App ID: `lat.farmasalud.portal`. Web dir: `dist`. Capacitor v8.2.0.

Native-only plugins (no web bundle):
- `@capacitor/geolocation` v8.2.0 — foreground GPS
- `@capacitor-community/background-geolocation` v1.2.26 — background GPS

Both excluded from Vite bundling via `optimizeDeps.exclude` + `rollupOptions.external` in `vite.config.js`. All imports use `/* @vite-ignore */` dynamic import inside an `isNative` guard:

```js
if (isNative) {
  import(/* @vite-ignore */ '@capacitor/geolocation').then(m => { CapGeo = m.Geolocation; }).catch(() => {});
  import(/* @vite-ignore */ '@capacitor-community/background-geolocation').then(m => { BgGeo = m.BackgroundGeolocation; }).catch(() => {});
}
```

Platform detection: `isMobileOrApp()` in `src/utils/helpers.js` — checks `Capacitor.isNativePlatform()`, mobile UA, modern iPad. Gates camera, GPS, and touch-specific UI behaviors.

Before first APK build: update `versionCode` and `versionName` in `android/app/build.gradle`.

---

## 22. Known Dark Mode Blindspots — RESUELTO (verificado 2026-07-25)

Esta sección quedó completamente stale: los 7 puntos que listaba ya
estaban corregidos en el código (la migración real pasó, el doc nunca se
actualizó — el mismo patrón que motivó el gate mecánico de §6). Verificado
línea por línea contra el código actual el 2026-07-25:

| Componente | Estado real verificado |
|---|---|
| `LiquidModal` inner glass layer | Usa clase `modal-glass-layer`, color por tema definido en `index.css` (no hardcoded) |
| `DataTable` `useTokens()` | Devuelve tokens reactivos (`bg-brand/[0.04]`, `text-content-3`, etc.), container con `data-surface="card"` |
| `LiquidToast` | Solo lee `{isOpen,title,message,type,hideToast}` de `toastStore` — sin campo `theme`, 100% tokens |
| `LiquidSelect` | Sin prop `isDark`/`theme` en absoluto |
| `AlertModal` / `ConfirmModal` | Sin prop `theme`, sin `isDark` — 100% tokens (`text-danger`, `bg-brand`, `text-content-3`) |
| `ViewTabBar` pill | Usa `data-surface="tab-track"`, mapeado a `--surface-tab-track` por tema en `index.css` |
| `GlassViewLayout` body card | Ya usa `data-surface={transparentBody ? undefined : 'card'}` |

**En teléfono la card del cuerpo no va (2026-07-30).** Medida la cadena de anchos
en un iPhone de 320px, del viewport al primer texto se iban **92px (29%)** en
cromo anidado: `px-2` del shell, `px-2` del cuerpo, el borde de la card, el
padding de la vista y el de la tarjeta del contenido. Y esa card envuelve
contenido que casi siempre trae su propia card —las tarjetas por producto del
conteo, los widgets del Inicio—, o sea el doble borde y doble radio que este
documento ya llama "una isla dentro de otra isla".

Con mouse la card sí sirve: delimita el área de trabajo dentro de una pantalla
ancha. **En un teléfono la pantalla ES el área de trabajo.** Debajo de 768px el
cuerpo pierde la card y el gutter horizontal; de 768 para arriba no cambia nada
(verificado en 1440/900/768/767).

`data-surface` es un atributo, no una clase, así que no se apaga con un
breakpoint de Tailwind: la decisión pasa por `useMediaQuery`. Y tiene que ser el
atributo AUSENTE, no una clase que lo pise — el material de `data-surface` gana
la cascada contra cualquier clase equivalente (T2).


No queda ninguna acción pendiente de esta lista. Si aparece un blindspot
real nuevo, documentarlo aquí con fecha — no reabrir esta tabla completa
sin verificar cada punto contra el código primero.

---

## 23. Known Inconsistencies

1. **Framer-motion** — present in 14 files. Standard is CSS keyframes + Tailwind transitions. No new framer-motion usage. Existing usages are noted per-component above.

2. ~~Dark mode blindspots~~ — RESUELTO, ver §22.

3. ~~GlassViewLayout body card~~ — RESUELTO, ver §22 (ya usa `data-surface`).

4. **ConfirmModal / AlertModal scroll lock** — both have own `document.body.style.overflow = 'hidden'` logic separate from ModalShell's scroll lock. Two scroll-lock paths exist. Acceptable given their `z-[99999]` requirement but worth unifying.

5. **Sidebar always dark** — `data-surface="sidebar"` intentionally deviates from the theme system. The sidebar is always dark glass regardless of app theme. By design.

6. **Hardcoded `#0052CC`** — ACOTADO (2026-07-25): la duplicación real (el semáforo de volumen de transacciones — `DashboardView.jsx`×2, `SchedulesView.jsx`, `FormWfmAnalytics.jsx`, consumido por `ScheduleCalendar.jsx`) se migró a `var(--txvol-normal)` etc. Lo que queda crudo son casos ya cubiertos por la excepción de Recharts/canvas (`DashboardView.jsx` Area/gradient SVG, `TabExpenses.jsx` BarChart SVG) y por la excepción de `KpiCard` (`color` prop, string-concat de alpha) — ambas ya documentadas en §6, no son deuda nueva.

7. ~~Three validation error patterns coexist~~ — **RESUELTO 2026-07-25.** Resultó ser 2 problemas distintos, no 1 con 3 estilos: el badge "Requerido" (campo vacío) y el banner de error de envío/servidor nunca competían entre sí. Decisión (con mockup mostrado al usuario — badge vs asterisco sobre los mismos 3 campos reales): el badge se queda como estándar, ya no está deprecado (26+ campos reales vía `PortalInput.jsx`, a11y ya correcta). Lo único que sí era inconsistente — `FormSetPassword.jsx`/`LoginView.jsx` mostraban el error de envío como texto plano en vez del banner con caja+ícono de los otros 8 archivos — ya migrado. Ver §28 "Validation error standard".

---

## 24. Search Patterns

Tres tipos de buscador en el Portal. Toda búsqueda debe mapearse a uno de estos — nunca crear un cuarto patrón.

---

### Tipo 1 — Header de vista (ViewTabBar)

**Dónde:** todas las vistas GlassViewLayout con tabs.

Cubierto en §14 ViewTabBar. El `searchTerm` vive en la vista y se pasa como prop a los tabs. Nunca agregar un input local dentro de un tab — el search siempre vive en el header.

---

### Tipo 2 — Inline / Widget (SearchInput)

**Dónde:** cards de dashboard, cuerpo de modales, RecepcionModal, widgets internos, y cualquier search fuera del header de vista.

**Componente:** `SearchInput` — `src/components/common/SearchInput.jsx`

**Visual spec:**
```
Input:  data-surface="input" (borde + fondo vidrio del tema activo)
        text-content placeholder:text-content-3
        focus:outline-solid focus:outline-1 focus:outline-offset-[-1px] focus:outline-brand/60
        — 1px, offset negativo = se dibuja EXACTO sobre el borde existente
          (mismo grosor), se ve como un simple cambio de color de borde,
          nunca como un ring/línea aparte
Ícono:  <Search> text-brand strokeWidth={2.5}  — izquierda
Clear:  <X>     hover:text-danger strokeWidth={2.5} — aparece solo cuando value truthy
```

**Foco — decisión 2026-07-26 (mockup aprobado, 4 opciones comparadas):** el estilo previo (`focus:outline focus:outline-2 focus:outline-offset-0`) dibujaba un outline de 2px por FUERA del borde de 1px ya existente — dos líneas concéntricas, se leía como una "línea interna" fea. La opción elegida (mockup "A": cambio de color de borde puro, sin ring/glow/lift) se implementa con `outline-solid outline-1 outline-offset-[-1px]` en vez de `border-*`: el input tiene `data-surface="input"`, y esa regla vive fuera de cualquier `@layer` de Tailwind (ver comentario en `src/utils/inputStyles.js:6-8`) — un unlayered `border` de stylesheet le gana SIEMPRE a un `focus:border-*` de Tailwind (capa `utilities`), sin importar especificidad. `outline` es una propiedad distinta que no compite por esa regla, y con offset `-1px`/ancho `1px` queda dibujado exactamente sobre el borde existente — visualmente idéntico a "cambiarle el color al borde", sin las dos líneas del bug original. Mismo criterio que `inputHoverClass` (`src/utils/inputStyles.js`), que ya usaba outline por la misma razón.

**Gotcha de Tailwind v4 encontrado al implementar esto:** `outline-none` fija la custom property compartida `--tw-outline-style: none`, y la utilidad simple `outline`/`outline-1` en foco solo LEE esa variable (`outline-style: var(--tw-outline-style)`) — no la sobreescribe. Como `.outline-none` no tiene pseudo-clase, sigue matcheando incluso con el input enfocado y su `--tw-outline-style: none` gana por especificidad, así que un `focus:outline` de foco quedaba con `outline-style: none` computado pese a tener color/ancho/offset seteados (verificado con `getComputedStyle` — el outline nunca se pintaba). Hace falta `focus:outline-solid` explícito, que sí escribe `--tw-outline-style: solid` con la especificidad de `:focus` y gana la cascada.

**Auditoría 2026-07-26 — mismo bug encontrado en `LiquidSelect` (Tipo 3, `serverSearch`):** el pill trigger (`src/components/common/LiquidSelect.jsx`, `pillBaseClasses`) también combinaba `outline-none` (unconditional) con `outline outline-2 outline-offset-0 outline-brand/30` (condicional a `isOpen`, sin `-solid`) — mismo gotcha, pero con el efecto opuesto al de `SearchInput`: en vez de verse feo, el anillo de foco simplemente **nunca se pintaba** (confirmado con `getComputedStyle`: `outlineStyle: "none"` estando abierto). Corregido con el mismo patrón (`outline-solid outline-1 outline-offset-[-1px] outline-brand/60`), verificado en vivo contra el picker de productos de `CotizacionesView` — ahora se ve un borde de acento limpio, sin doble línea. Afecta a los ~30 usos de `LiquidSelect` en el proyecto (cualquiera con `serverSearch`/combobox abierto, no bare). Fix aplicado con confirmación explícita del usuario por el cambio de comportamiento visual (algo que nunca se vio se vuelve visible en todos esos lugares).

**Cierre del gap — 2026-07-26, misma sesión:** los 5 buscadores hand-rolled detectados en la auditoría (`AnnouncementsView.jsx:687` picker de destinatarios, `RecepcionModal.jsx:909` buscador de producto extra, `RecepcionModal.jsx:1042` buscador de producto, `ScheduleCalendar.jsx:853` cobertura entre sucursales, `ItemSections.jsx:252` filtro por sección de ítems) se migraron a `SearchInput`, ninguno quedó pendiente. Ninguno tenía el bug de línea/ring roto, pero todos violaban "nunca `<input>` crudo para búsquedas" — no se dejaron como deuda.

Para poder migrarlos, `SearchInput.jsx` ganó 3 capacidades que antes le faltaban (todas necesarias por casos reales, no especulativas):
- **`ref` (forwardRef, vía `useImperativeHandle`)** — resuelve al `<input>` real. Necesario porque varios callers enfocan el buscador programáticamente desde un botón externo (`searchRef.current?.focus()` en `RecepcionModal`/`ItemSections` al togglear visibilidad).
- **`disabled`** — necesario en `AnnouncementsView` (picker deshabilitado mientras `isSubmitting`).
- **`onKeyDown`** (pass-through al input real) — necesario en `ItemSections` para cerrar el buscador con Escape.

Verificado en vivo con Playwright: `AnnouncementsView` (picker de destinatarios, tipeo + filtrado + botón "+" funcionando). Los otros 4 no se pudieron verificar con captura en vivo en esta sesión (requieren estado de datos — un pedido pendiente de recepción, o una semana de horario editable — que no existía en el entorno de prueba; no es un bug introducido, confirmado revisando que los archivos bloqueantes, ej. `TabPedidos.jsx`, no fueron tocados). Se verificaron por revisión de diff (props/refs cableados 1:1 con el original) + `eslint` limpio + `gate:design` en 0.

En la variante `expandable` abierta, el borde toma el `accentColor` del widget (o `--brand` si no se pasa uno) vía estado `isFocused` + `style` inline en el wrapper — un inline `style` sí gana sobre la regla unlayered de `data-surface="input"` (los estilos inline superan cualquier CSS de hoja de estilos, con o sin capas), así que ahí no hace falta el truco del outline; el color además es un hex dinámico que no puede resolverse con una clase Tailwind estática de todos modos.

**Sizes:**

| `size` | Altura | Usar en |
|--------|--------|---------|
| `"sm"` | ~32px | Cabecera compacta dentro de cards, listas picker |
| `"md"` | ~40px | Search principal de widget o modal |

**Uso mínimo:**
```jsx
import SearchInput from '../components/common/SearchInput';

<SearchInput
  value={search}
  onChange={setSearch}
  placeholder="Buscar producto..."
  size="sm"
/>
```

**Reglas:**
- Nunca usar `<input type="text">` crudo para búsquedas inline — siempre `SearchInput`.
- Siempre emparejar con `smartFilter` o `tokenMatch` (ver §24 Lógica de búsqueda).
- Siempre mostrar el banner fuzzy cuando `isFuzzy && searchTerm` (solo con `smartFilter`).

---

### Tipo 2b — Buscador expandible de widget (`SearchInput expandable`)

**Origen:** mockup aprobado 2026-07-25 para los 4 widgets de Operación del Dashboard (`WidgetInventorySearch`, `WidgetMinMaxRequest`, `WidgetAnnulmentRequest`, `WidgetSrsInventory`) — antes cada uno tenía su propio `<input>` a mano apilado sobre los filtros, compitiendo por el mismo ancho angosto de la card.

**Cuándo usar esto en vez de un `SearchInput` normal — no es una cuestión de espacio disponible, es de qué rol cumple el buscador ahí:**

| Contexto | Componente |
|---|---|
| El buscador es un **control aparte** dentro de un widget, modal o cuerpo de tab — no importa si sobra ancho o no | `SearchInput expandable` — **siempre arranca colapsado por defecto**, incluso con espacio de sobra. El espacio disponible no es el criterio. |
| El buscador vive **pegado a una lista de selección que ya está abierta en pantalla** (Tipo 3 — picker más abajo): la lista y el campo son una sola pieza, no un control que tenga sentido ocultar | `SearchInput` estático (`size="sm"`/`"md"`) |
| Filtra el **contenido principal de toda la vista** (la tabla/lista que el usuario vino a ver a esta página) | Buscador de `ViewTabBar` en el header (Tipo 1) — nunca un input local dentro de un tab |

Regla corta: si el buscador es un control que se puede mostrar/ocultar sin romper nada a su alrededor, arranca colapsado, punto — un modal ancho con espacio de sobra no es excusa para dejarlo abierto por defecto. Solo se muestra siempre abierto cuando el campo y la lista que filtra son la misma pieza visual (picker). Si filtra la vista entera, es del header.

**Comportamiento:**
- Arranca colapsado a un cuadrado de 32px (solo ícono) — no un input vacío ocupando ancho.
- Se abre **hacia la izquierda** al tocarlo (mismo espíritu que el buscador de `ViewTabBar`, adaptado a un espacio angosto) — el caller lo ubica DENTRO de una fila `flex items-center justify-end gap-1.5`, con los chips de filtro (`LiquidDatePicker`, `LiquidSelect`, etc.) DESPUÉS en el DOM, así quedan siempre anclados a la derecha y el buscador crece hacia el espacio vacío sin taparlos.
- Colapsa solo si está vacío y se hace click afuera — una búsqueda con texto se queda abierta hasta que el usuario la borra explícitamente (no perder el resultado por accidente).
- El ícono colapsado usa `accentColor` (hex de `CATEGORY_META` del widget — naranja `productos`, verde `ventas`, etc.), **nunca `bg-brand`/azul genérico** — se integra con el color de categoría que ya tiene el header de la card en vez de leerse como un botón de acción aparte.

**Uso mínimo:**
```jsx
<div className="flex items-center justify-end gap-1.5 shrink-0">
  <SearchInput expandable accentColor="var(--warning)" value={search} onChange={setSearch} placeholder="Buscar producto..." />
  {/* filtros después, si los hay — quedan a la derecha del buscador */}
</div>
```

---

### Tipo 3 — Picker / Selección

**Dónde:** selección de destinatarios (AnnouncementsView), selección de productos en modales.

| Tamaño lista | Componente | Patrón |
|---|---|---|
| > 100 ítems (DB) | `LiquidSelect` con `serverSearch={true}` + `onSearchChange` | `normSearch()` antes de enviar a `ilike` |
| ≤ 100 ítems (memoria) | `SearchInput size="sm"` al tope de `div` scrollable | Filtrar con `tokenMatch` client-side |

Nunca usar `<input>` crudo para pickers.

---

### Lógica de búsqueda estándar

Todas las búsquedas usan `src/utils/searchUtils.js`:

| Función | Usar cuando |
|---------|-------------|
| `normSearch(str)` | Normalizar antes de DB `ilike` — quita acentos, puntuación, lowercase |
| `tokenMatch(query, ...fields)` | Listas pequeñas en memoria (pickers, < 200 items) |
| `smartFilter(query, data, getFields)` | Cuerpos de tabs y widgets — incluye fallback fuzzy automático |

**Patrón two-pass con smartFilter:**
```js
const { results, isFuzzy } = !searchTerm.trim()
    ? { results: base, isFuzzy: false }
    : smartFilter(searchTerm, base, r => [r.campo1, r.campo2]);
```

**Banner fuzzy estándar** — inmediatamente antes de la tabla/lista, cuando `isFuzzy && searchTerm`:
```jsx
{isFuzzy && searchTerm && (
    <Notice variant="warning" icon={Search} className="mb-3">
        Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
    </Notice>
)}
```

> **Corregido el 2026-07-30.** Esta sección enseñaba el banner como un `<div>` a
> mano —`bg-warning/10 border border-warning/30 text-label text-warning
> font-semibold`— mientras §15.6 dice que un aviso inline con ícono **es**
> `Notice`, y usa esta misma frase como su ejemplo. El documento se contradecía, y
> el snippet de acá ganó: se copió en **15 vistas**, ninguna usaba `Notice`. Es el
> mismo modo de falla que el snippet de §16.2, que llegó a 9 copias — un doc
> desactualizado no es un doc incompleto, es un doc que **enseña la deuda**.
>
> Y el snippet traía un error propio: `text-warning`, que es el color de RELLENO.
> Sobre `bg-warning/10` da **2.16:1** — falla AA, que pide 4.5. `Notice` usa
> `text-warning-text` (5.98:1), y su propio comentario documenta esa medición.
> Curiosamente las 12 copias vivas escribieron `-text` por su cuenta: acá las
> vistas estaban mejor que el documento, y quien lo hubiera copiado tal cual
> habría publicado el fallo de contraste.
>
> Lo vigila la categoría **`aviso-a-mano`** del gate.

---

### Contrato de apertura/cierre — OBLIGATORIO en todo buscador toggleable

**Regla del usuario, 2026-07-26: "TODOS deben funcionar así siempre."** Aplica
a cualquier buscador que se puede mostrar/ocultar (Tipo 1 header, Tipo 2b
widget, o un toggle hand-rolled con su propio show/hide) — sin excepción,
sin ir caso por caso:

1. **Al abrir, foco automático** en el input (cada caller ya lo hacía con
   `autoFocus` o `inputRef.current?.focus()` tras el timeout de su propia
   animación de apertura — eso no cambia).
2. **Escape cierra Y limpia** — nunca solo una de las dos cosas.
3. **Click afuera cierra SOLO si está vacío** — con texto se queda abierto
   (no se pierde un resultado por accidente, mismo criterio que el
   buscador expandible de widget).

**Implementación:** hook compartido `useSearchToggle` en `src/hooks/useSearchToggle.js`.

```jsx
import { useSearchToggle } from '../hooks/useSearchToggle';

const { containerProps } = useSearchToggle({
    active: isSearchMode,        // bool — el buscador está abierto
    value: searchTerm,           // string actual del input
    onClear: () => setSearchTerm(''),
    onClose: () => setIsSearchMode(false),
});

// spread en el contenedor que delimita "adentro" del buscador (incluye el
// botón que lo abre/cierra, así un click en ese botón nunca cuenta como
// "afuera" y dispara un doble toggle)
<div {...containerProps}>...</div>
```

**Gotcha de reglas de hooks:** varios componentes con esta necesidad tienen
`return` tempranos por pantalla/condición (`RecepcionModal` por
screen, `ItemSection` por `if (!count) return null`). El hook SIEMPRE debe
llamarse antes de esos returns — nunca después — o se salta en algunos
renders y rompe las reglas de hooks de React.

**Bug crítico real (2026-07-26, reportado por el usuario: "no funciona el
buscador" en Nómina y Plan de Vacaciones) — por qué es `containerProps`
(atributo data-*) y NO `containerRef` (ref de nodo DOM), como se implementó
originalmente:** `GlassViewLayout` renderiza `filtersContent` DOS VECES —
una copia desktop y una copia móvil, cada una oculta por CSS según
breakpoint pero AMBAS montadas en el DOM simultáneamente. Un `ref` es un
objeto con un solo `.current` — si la misma pieza de JSX (creada una vez en
el padre, con el ref ya adjunto) se monta dos veces, ambas copias comparten
el MISMO objeto ref, y solo la última en commitear se queda con `.current`.
Resultado: clickear DENTRO de la copia visible se comparaba contra
`containerRef.current`, que apuntaba a la copia OCULTA → se leía como
"click afuera" → cerraba el buscador antes de poder escribir la primera
letra. `ViewTabBar`/`SearchInput` nunca tuvieron este bug porque el hook se
llama DENTRO del componente reutilizable — cada copia montada crea su
propio ref interno, no uno compartido desde afuera. Fix: un atributo
`data-search-toggle-id` (vía `useId()`) en vez de un ref — ambas copias
montadas lo llevan por igual, y `e.target.closest(selector)` encuentra
cualquiera de las dos sin importar cuál se clickeó. Ver `src/hooks/useSearchToggle.js`
para la implementación completa y el comentario in-line con el mismo
razonamiento.

**Migrado 2026-07-26, en dos pasadas** — la primera (8 archivos) se hizo
grepeando por placeholder de texto (`"Buscar..."`) y sampleando resultados
a mano; el usuario preguntó explícitamente si se había revisado archivo
por archivo, y la respuesta honesta fue no — un caso real
(`EmployeeDocumentsView.jsx`, `/my-documents`) quedó afuera pese a estar en
el mismo grep original. Segunda pasada: grep estructural por el NOMBRE del
state (`const [xSearchOpen/Mode/Active/Expanded, ...] = useState(false)`
en vez de por texto de placeholder) encontró **22 archivos reales en
total**, 14 más que la primera pasada.

Lista completa: `SearchInput` (`expandable`), `ViewTabBar` (Tipo 1
canónico — antes solo cerraba con el botón, sin Escape ni click-afuera),
`BranchesView`, `AnnouncementsView` (header), `PayrollView`, `RequestsView`,
`TabHistory`, `FacturacionView`, `ConteoInventarioView`, `RolesView`,
`PermissionsView`, `AuditView`, `StaffManagementView`, `VacationPlanView`,
`AttendanceMonitorView` (dos copias del mismo buscador — variante clara y
variante "dark concept" — mismo `containerProps` spreadeado en ambas, solo
una está montada a la vez, sin conflicto porque es un atributo data-*, no un
ref), `EmployeeDocumentsView`, `EmployeeAnnouncementsView`,
`ConteoDetailView`, `EmployeeDetailView` (`ausenciasSearchOpen`),
`TabExpediente` — estos eran duplicados hand-rolled del patrón de
`ViewTabBar`/`SearchInput expandable` con Escape parcial o nada; y
`RecepcionModal` (`showSearch`), `ScheduleCalendar` (`showCoverageSearch`),
`ItemSections` (`searchOpen`, ya tenía Escape+clear, le faltaba
click-afuera). Verificado en vivo con Playwright (tipeo, Escape,
click-afuera con y sin texto) en el widget Ajuste de Min/Max, en
`ViewTabBar`/Productos, y en `/my-documents`; el resto por revisión de
diff + eslint limpio + `gate:design` en 0.

**Gate automático (`npm run gate:design`), agregado en la misma sesión
para que esto no vuelva a pasar:** una tercera categoría de chequeo en
`scripts/design-gate.mjs` detecta cualquier `useState(false)` cuyo nombre
termina en `Search{Open,Mode,Active,Expanded,Visible}` o empieza con
`showSearch`, y falla si ese archivo no importa `useSearchToggle`. Es una
heurística de nombre (no un parser), documentada con su propio falso
positivo real encontrado al escribirla (`isSearching`/`productSearching` —
un flag de "estoy buscando ahora", no "el buscador está abierto" — el
regex exige el sufijo Open/Mode/Active/Expanded/Visible, no solo que el
nombre contenga "search", para no confundir los dos). Excepción
documentada: `AppLayout.jsx` (`searchOpen` del modal ⌘K — ya tiene su
propio Escape/click-en-backdrop vía el patrón de modal estándar, semántica
distinta a la de "no perder texto por accidente"). Cualquier buscador
toggleable nuevo que el gate no detecte porque su variable no contiene
"search" en el nombre es un hueco conocido de esta heurística, no un
`gate:design` en verde falso — si aparece uno así, agregar el nombre al
regex o una excepción documentada, no ignorarlo.

`LiquidSelect` (Tipo 3 combobox) ya tenía Escape+click-afuera propios desde
antes (2026-07-15, ver §25 ARIA) — cierra y limpia el filtro SIEMPRE al
click afuera, sin la excepción de "si tiene texto" — eso es intencional:
ahí el texto es un filtro de la lista abierta, no un resultado de búsqueda
que se pueda perder, así que no aplica el mismo criterio. No se tocó.

---

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

## 26. Performance

### Backdrop-filter layers — typical admin view

A standard admin view (e.g. VentasView) stacks the following compositor layers simultaneously:

| Layer | Source | Blur radius |
|---|---|---|
| 5 ambient orbs | `AppLayout` fixed divs | `filter: blur(35–40px)` each |
| Sidebar surface | `data-surface="sidebar"` | `backdrop-blur-2xl` ≈ 40px |
| Page header | `GlassViewLayout` `data-surface="page-header"` | `blur(32px) saturate(280%)` |
| Body card | `data-surface="card"` | `blur(44px) saturate(200%)` |

= **4 stacked compositor layers** before any modal, dropdown, or tooltip opens. Each open `LiquidModal` adds `blur(48px)` and an inner `blur(15px)` layer.

On flagship mobile hardware (iPhone 12+) this is manageable. On mid-range Android or older iPads, compositing cost is the primary source of jank.

**Solid theme (`[data-theme="solid"]`) mitigates this completely:** sets `--backdrop-*: none` across all surface tokens, removing every backdrop-filter at once. No code changes needed in components.

### Ambient orbs

5 orbs in `AppLayout` + 3 inside the sidebar + 6 glass particles in `LoginView`. All are `position: fixed`, which means they are painted outside the scroll container and do not cause scroll-triggered repaints. They do however create persistent GPU layers for the lifetime of the app.

### Animation compositing

All animations run on `transform` and/or `opacity` only — compositable without layout or paint — **except**:

| Animation | Property | Cost |
|---|---|---|
| `glow-danger-anim`, `glow-warning-anim` | `box-shadow` | **Paint** — not compositable; triggers repaint on every frame in Chromium |
| Sidebar active pill | `top` (inline style via JS) | **Layout recalc** — `top` is not compositable; runs for 320ms on route change |
| `TabMinMax` accordion | `willChange: 'height'` (`src/views/productos/TabMinMax.jsx:3812`) | **Layout** — height animation always triggers reflow |

The standard rule: **only animate `transform` and `opacity`**. Exceptions above are documented and accepted; do not add new ones.

### `will-change` usage

| Location | Value | Purpose |
|---|---|---|
| `.animate-ambient-drift/reverse` (`index.css:356–357`) | `transform` | Pre-promote orb layers ✅ |
| `GlassViewLayout` header (`src/components/GlassViewLayout.jsx:68`) | `backdrop-filter` | Compositor hint for sticky blur ✅ |
| `LiquidModal` (`src/components/common/LiquidModal.jsx:43`) | `transform` + `translateZ(0)` | Force composited layer ✅ |
| `TabMinMax` expand (`src/views/productos/TabMinMax.jsx:3812`) | `height` | ⚠️ Triggers layout — consider `transform: scaleY` alternative |

### Lazy loading

- `LiquidAvatar` — lazy-loads images with a skeleton shimmer placeholder ✅
- `BranchesView` branch cards — `contentVisibility: 'auto'` + `containIntrinsicSize: '350px'` for CSS-level virtualization of off-screen cards ✅
- No other explicit lazy loading found. Heavy views (TabMinMax, TabCatalogo) load all rows eagerly.

---

## 27. Cross-Browser

### -webkit-backdrop-filter (Safari)

All `[data-surface]` rules in `src/index.css` include the `-webkit-` prefix alongside `backdrop-filter` (lines 206, 223, 240, 249, 258, 266). Inline `style` objects in components use `WebkitBackdropFilter` alongside `backdropFilter` (GlassViewLayout, AppLayout, TabMinMax, AttendanceMonitorView). **Safari coverage is complete.**

### Reset / normalize baseline

`src/index.css` opens with `@import "tailwindcss"`, which applies Tailwind Preflight (a Normalize.css derivative). `:root` sets `color-scheme: light`. No additional normalize layer.

### @supports fallback

⚠️ **No automatic fallback exists.** There is no `@supports (backdrop-filter: ...)` block anywhere in the stylesheet. Browsers that do not support `backdrop-filter` (e.g. Firefox < 103) render surfaces with no blur — surfaces become semi-transparent colored boxes without the frosted effect.

The Solid theme (`[data-theme="solid"]`) is the **manual fallback**: setting `--backdrop-*: none` removes all blur and makes surfaces opaque. Users must activate it through ThemeToggle.

**Proposed addition to `src/index.css`** (automatic opacity fallback — does not force Solid theme, preserves translucency):

```css
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  :root {
    --surface-card    : rgba(255,255,255,0.95);
    --surface-header  : rgba(255,255,255,0.97);
    --surface-modal   : rgba(255,255,255,0.98);
    --surface-input   : rgba(255,255,255,0.92);
    --surface-dropdown: rgba(255,255,255,0.98);
  }
}
```

This block would only fire on browsers without any backdrop-filter support, making surfaces fully opaque while keeping the rest of the design intact.

---

## 28. Page States

### Offline / no connection

**Implemented** — `src/components/common/OfflineBanner.jsx`. Mounted once in `AppLayout` (`src/components/layout/AppLayout.jsx`), just before `</LayoutGroup>`.

Listens to `navigator.onLine` + `window` events `'online'`/`'offline'`. Shows a fixed top-center banner (`z-[500]`, below toasts at `z-[9999]`):
- **Offline:** amber palette (`bg-amber-50/90 border-amber-200/80 text-amber-700`) + `WifiOff` icon + "Sin conexión"
- **Restored:** emerald palette + `Wifi` icon + "Conexión restaurada" (auto-disappears after 3 s)

Does not block the UI. Banner has `role="status"` + `aria-live="polite"` for screen readers.

### 404 / route not found

**Current behavior** (`src/App.jsx:605`): catch-all route `path="*"` redirects to `defaultRedirect` (the user's first allowed route). No dedicated not-found page exists.

Two access-denial views exist:
- `AccessDeniedView` — rendered when a known route guard fails (`hasPermission` returns false, `src/App.jsx:142`)
- `NoAccessView` — rendered at `/no-access` for authenticated users with no accessible modules (`src/App.jsx:506`)

**Optional improvement:** replace `<Navigate to={defaultRedirect} replace />` with a `NotFoundView` that shows the empty-state pattern (§18) with a "Volver al inicio" button. Reduces silent redirect confusion.

### Error boundary

**Implemented** — `src/components/common/ErrorBoundary.jsx`. Wraps `<Routes>` inside `AppLayout` in `src/App.jsx` (authenticated tree only; login and `/no-access` routes are outside the boundary).

Class component with `getDerivedStateFromError` + `componentDidCatch`. On error:
- Logs to `console.error`.
- Calls `appendAuditLog('ERROR_RENDER', null, { message, stack })` via `useStaffStore.getState()` (store-singleton pattern, safe from class component).
- Renders a Liquid Glass fallback card (`[data-surface="modal"]` style: `bg-white/[0.18] backdrop-blur-[48px]`) with `AlertTriangle` squircle, "Algo salió mal" title, and a primary CTA "Recargar" → `window.location.reload()`.

Fallback uses only existing CSS tokens — respects active theme (transparent background, no hardcoded light color).

---

## 29. Forms & Validation

### 29.1 Inputs — `PortalInput`

> Reescrito el 2026-07-27 (D4). La versión anterior documentaba **dos estilos de
> input que compiten** (glass y solid) con hex crudos, `text-[13px]` y su propio
> aro de foco. Los dos estaban a mano, y el aro propio era una de las 171
> reescrituras del foco que se borraron ese día.

```jsx
import PortalInput from '@/components/common/PortalInput';

<PortalInput
    name="dui" label="DUI" icon={CreditCard}
    value={form.dui} onChange={handle}
    required maskType="dui"
/>
```

Trae etiqueta en mayúsculas, badge de **Requerido**, borde de error, máscara e
íconos. Todo formulario nuevo lo reusa.

**El aro de foco NO se escribe.** Existe una sola regla en `index.css` sobre
`button/input/select/textarea/a/[role=button]/[tabindex]:focus-visible`. Cuando
se midió, había 171 aros a mano en 47 archivos, cada uno de otro color — y el
canónico estaba en `rgba(0,82,204,.55)` sin variante por tema, que da **1.63:1
sobre el navy oscuro** contra el 3:1 que pide WCAG 1.4.11. Escribir el propio
tapaba el problema en vez de arreglarlo.

```jsx
// ❌ reinventa el aro, y además lo apaga
className="… outline-none focus:ring-4 focus:ring-brand/10"

// ✅ no se escribe nada: el canónico lo pinta
```

`focus:outline-none` está **prohibido**: apaga el aro canónico y deja el campo
sin foco visible (WCAG 2.4.7).


### 29.2 `PortalTextarea` — campo de varias líneas

```jsx
<PortalTextarea label="Motivo" name="motivo" rows={3} required
    value={motivo} onChange={e => setMotivo(e.target.value)}
    placeholder="Describe la solicitud…" />
```

Era **el último control de formulario sin canónico** (2026-07-27). `<select>` ya
iba a `LiquidSelect`, la casilla a `Checkbox`, el archivo a `FileField`, la fecha
a `LiquidDatePicker` — y quedaban **37 `<textarea>` nativos** que nadie había
mirado, con cuatro radios (`rounded-xl` 4 · `lg` 4 · `2xl` 3 · `3xl` 1).

El efecto se veía en pantalla: en el mismo formulario, el campo de una línea y el
de varias no compartían ni borde ni radio, porque uno pasaba por `PortalInput` y
el otro no pasaba por nada.

Comparte con `PortalInput` la etiqueta, el badge "Requerido", el borde rojo de
error, el glow de marca y `data-surface="input"` — no está reimplementado, es la
misma superficie. Lo único distinto es que crece en alto.

- **`rows`, no una altura en píxeles.** El alto de un campo de texto se mide en
  líneas, que es lo que el usuario ve; un `h-24` deja de calzar apenas cambia el
  tamaño de fuente del tema.
- **`resize-none` a propósito.** El tirador de la esquina es el mismo elemento
  nativo que ya sacamos de todos los demás controles: no sigue el tema y al
  arrastrarlo se sale de la caja del formulario.
- **La etiqueta es opcional.** Muchos de los 37 ya tenían su `<label>` afuera;
  obligar a moverla habría encimado dos cambios en la misma pasada.

`<textarea>` nativo es ahora **bloqueante en el gate** (categoría `native`, cero
absoluto), igual que `<select>` y `window.confirm`.

### 29.2 Casillas y opciones

`<input type="checkbox">` **nunca** — usar `Checkbox` (§15.4). La casilla nativa
se pinta con el color del sistema operativo e ignora los cuatro temas.

Para elegir una de pocas opciones, `SegmentedControl` (§15.3); para muchas o
cuando vienen de datos, `LiquidSelect`.

### 29.3 Estado deshabilitado

Sale del componente (`disabled` en `Button`, `PortalInput`, `Checkbox`). No se
escriben clases `disabled:` a mano.

### Validation error standard — REVISADO 2026-07-25

Esta sección describía "3 patrones que compiten por el mismo problema" y
recomendaba deprecar el badge. Al re-auditar (con mockup mostrado al
usuario, decisión tomada 2026-07-25) resultó que eran **2 problemas
distintos mal etiquetados como uno solo**:

- El **indicador de campo requerido** (badge) y el **error de envío/
  servidor** (banner) no compiten entre sí — nunca fueron la misma cosa.
- El badge de campo requerido no estaba "deprecado" en la práctica: es el
  estándar real, vive en el componente compartido `PortalInput.jsx` y se
  usa en 26+ campos (`EmployeeFormModal`, `PracticanteModal`) más 4
  archivos que lo replican a mano (`BranchTabInmueble`,
  `BranchTabGeneral`, `FormRehireEmployee`, `NuevoConteoModal`). Ya trae
  `aria-invalid`/`aria-describedby` bien resueltos. **Decisión: se queda,
  ya no es "deprecado".**
- Lo único real que sí era inconsistente: el error de *envío* se veía
  como banner con caja+ícono en 8 archivos y como texto plano sin caja en
  2 (`FormSetPassword.jsx`, `LoginView.jsx`) — corregido, ambos ahora
  usan el mismo tratamiento.

**(a) Indicador de campo requerido — el badge, componente `PortalInput`:**
```jsx
<span className="text-danger font-bold bg-danger/10 px-2 py-0.5 rounded-md border border-danger/30 shadow-sm">
  Requerido
</span>
```
Solo se muestra cuando el campo es requerido y está vacío (`isMissing && !hasError`). Con `aria-invalid="true"` + `aria-describedby` apuntando al `id` del badge/mensaje.

**(b) Inline field error** — appears below the field, shown when a field-level rule fails:
```jsx
<p className="text-label font-black text-danger mt-1">
  {fieldError}
</p>
```
Must be paired with `aria-invalid="true"` on the input and `aria-describedby` pointing to the error element's `id`.

**(c) Global / submit banner** — appears above the submit button, shown for server errors or cross-field validation failures. Mensajes cortos tipo label → `uppercase tracking-widest`; oraciones completas (ej. "Las contraseñas no coinciden.") → case normal, sin uppercase:
```jsx
// Referencia: src/components/forms/FormRegisterPayment.jsx:185,
// src/components/forms/FormSetPassword.jsx, src/views/LoginView.jsx
{/* Sin `backdrop-filter`: un aviso es TINTA, no material — PLAN-MATERIALES
    §18.2. Este ejemplo lo llevaba y los dos archivos que cita también, hasta
    que la bajada de §20 se los quitó (v2.433.0). */}
<div className="flex items-center gap-3 text-danger-text
  bg-danger/10 px-4 py-3 rounded-2xl
  border border-danger/30 shadow-[var(--shadow-glow-danger)]
  animate-in fade-in slide-in-from-top-2">
  <AlertCircle size={18} className="shrink-0 text-danger" strokeWidth={2.5} />
  <span className="text-body-sm font-bold leading-relaxed">{globalError}</span>
</div>
```

---

## 30. Governance & Changelog

### Extend-vs-create rule

Before creating a new component, verify:

| Need | Check first |
|---|---|
| Any overlay / modal | `ModalShell`, `UnifiedModal`, `LiquidModal`, `ConfirmModal`, `AlertModal` |
| Any select / dropdown | `LiquidSelect` |
| Any tooltip | `LiquidTooltip` |
| Any data table | `DataTable` |
| Any view wrapper | `GlassViewLayout` + `ViewTabBar` |
| Any avatar | `LiquidAvatar` |
| Any toast | `useToastStore` (via `LiquidToast`) |
| Un campo de formulario | `PortalInput` / `PortalTextarea` (§15.11) — sin etiqueta visible también: `label` es opcional |
| Una tarjeta / contenedor | `data-surface="card"` (§5), con `data-tono` si lleva estado (§5.1). **Nunca** `bg-surface-card + border + rounded` a mano |
| Un buscador | `ViewTabBar` (header de vista) · `SearchInput` (widget/modal/tab) · `SearchInput expandable` (toolbar de widget) — §24 |
| Un botón, de cualquier forma | `Button` (§15.2) · `TabBarAction` dentro de `ViewTabBar` (§15.5) |
| Una de N opciones | `SegmentedControl` (§15.3) · `FilterBar.Chip` si es un filtro (§17) |
| Una etiqueta de estado | `Badge` (§16.1) |
| Un contador sobre un ícono | `Contador` (§16.2) |
| Una fecha | `LiquidDatePicker` — nunca `<input type="date">` |

Creating a parallel component that duplicates functionality is prohibited. Extend the existing one or open a design discussion first.

**El hueco casi siempre está en el canónico, no en la vista.** Es el hallazgo
que más se repitió en la auditoría de julio: cuando alguien escribió un control
a mano, en la enorme mayoría de los casos fue porque al canónico le faltaba una
ranura. Nueve encontrados y tapados en D3: `Badge` y `PortalInput` tiraban en
silencio todo prop que no estuviera en su lista fija (`title`, `min`/`max`/
`step`, 22 `aria-label`); `Button`/`TabBarAction` no daban nombre accesible a
los `iconOnly` (102 de 194 no tenían); `SegmentedControl` no sabía apilar ícono
sobre etiqueta; `PortalInput` no sabía tintarse; `DataRow` y el `<th>` ordenable
de `DataTable` no respondían al teclado; `LiquidSelect` no era enfocable.

**Antes de migrar una vista al canónico, leé las props del canónico.** Tres de
los cuatro hallazgos del 2026-07-28 estaban ahí y no en la vista. Migrar sin
mirar habría borrado atributos reales sin que fallara el build, ni el lint, ni
el gate.

### Changelog

| Version | Date | Notes |
|---|---|---|
| v2.2 | 2026-07-28 | **Cierre de la estandarización.** `tarjeta-a-mano` 184→**0** e `input-a-mano` 60→**4**, las dos categorías nuevas del gate. Tres ranuras nuevas en los canónicos, y las tres salieron de la misma pregunta —*¿por qué esto está escrito a mano?*—: `label` OPCIONAL en `PortalInput` (rescató 43 campos: era lo único que los dejaba fuera), `onDark` (kiosco: anatomía del canónico, paleta bespoke) y `data-tono` en la tarjeta (§5.1 — el canónico era INDECORABLE: ni un `border-*` ni un `ring-*` le ganaban, así que marcar una tarjeta en edición obligaba a renunciar a él). Reescritas §15.11 (tabla de ranuras con lo que rescató cada una), §15.12 (de "61 celdas de grilla" a **4 excepciones reales**, nombradas y justificadas), §5 (tabla de superficies + §5.1 `data-tono` + la regla de no anidar tarjetas). Lo que se recuperó no es solo dejar de repetir clases: la forma volvió a ser del TEMA — medido, el radio de tarjeta da 28px en Liquid y 12px en Sólido, cuando 150 tarjetas lo tenían fijo en 24px. |
| v2.1 | 2026-07-28 | **D3/D4** — cierre de `AUDITORIA-DISENO-2026-07-26.md`. Reescritos §15 (agrega §15.8 "cuándo NO es un botón", §15.11 `PortalInput` con `tono`, §15.12 cuándo un `<input>` a mano es correcto), §6.0 (paleta consolidada de 13→9 categóricos, los retirados quedan como ALIAS y no como valores, más los colores del logo integrados), §25 (agrega §25.1 nombre accesible, §25.2 qué atributo de estado y cuándo, §25.3 teclado en tablas; corrige la afirmación de que `LiquidSelect` tenía el patrón combobox completo — tenía los roles, no el teclado) y §30 (tabla extend-vs-create ampliada + la regla de leer las props del canónico antes de migrar). Migrado: 276→60 botones a mano (137 abiertos en D3.3, 77 migrados y 60 que eran el canónico equivocado — §15.8), 101→8 chips, 99→61 inputs, 4 buscadores. Arreglado en el canónico, que es donde estaba el hueco 9 de cada 10 veces: `Badge`/`PortalInput` que tiraban props, 102 `iconOnly` sin nombre, `DataRow` y 62 columnas ordenables sin teclado, `LiquidSelect` inalcanzable con Tab en los 70 archivos que lo usan. Gate: 5 categorías nuevas, 3 de ellas en cero absoluto (`button-name`, `paleta-cerrada`, `input-sin-nombre`). |
| v2.0 | 2026-07-24 | **T7.4** — cierre de `AUDITORIA-TEMA-2026-07.md` T7. Reescribe §3 (paleta dataviz: 6→9 chart-N, regla de 3 buckets, excepciones documentadas; escala canónica de sombras nueva, 542/967 usos consolidados en 19 tokens) y §6 (tabla "Semantic" de clases crudas reemplazada por los tokens reales de severidad — esa tabla vieja era literalmente la causa del problema que T7.1 cerró). Corrige §2 (default cambió a Solid Modern en T6, ya no es Liquid). Migración de color: 119 archivos, ~1,400+ usos de color crudo → tokens. Decisión de si Liquid Glass sobrevive como tema sigue diferida — ver §2. |
| v1.0 | 2026-06-24 | Initial audit — Phases A, B, C complete. 4-theme architecture, full component inventory, accessibility/performance/cross-browser audit. |
| v1.1 | 2026-07-10 | Fase 4 design/UX audit (`AUDITORIA-2026-07.md`). Added §32 Mobile & Responsive Standard (did not exist before). Fixed project-wide: `active:scale-90/95` → `active:scale-[0.97]` (§31 compliance, ~300 sites), input font-size floor 16px (~170 inputs, iOS zoom fix), touch targets in `ViewTabBar`/`AppLayout` header to 44px, 9 native `<select>` → `LiquidSelect` swaps. Found but NOT fixed (documented only, too large/risky for a mechanical pass): ~1,288 `text-slate-300/400`-on-light-surface contrast violations across 127 files. |
| v1.5 | 2026-07-23 | Los cambios de v1.4 pasaron de prototipo a **código real** en `AppLayout.jsx` (v2.35.0): los 3 blobs ambientales del sidebar, shimmer, glow/borde del logo, ícono de nav activo y barra de acento ya usan `--logo-green`/`--logo-magenta`. De paso: `ViewTabBar.jsx` y el duplicado de `VentasView.jsx` ganan un modo responsive — fila de tabs solo en desktop, `LiquidSelect` compacto con el tab activo en móvil (resuelve el caso de 5 tabs/labels largos de Pedidos a Sucursales). Verificado con Playwright en desktop y móvil (iPhone 13, drawer incluido), cero errores de consola. Pendiente: los 5 blobs ambientales GLOBALES de `AppLayout.jsx` (fondo detrás de `<main>`) siguen en violeta/azul genérico, fuera del alcance de esta sesión. |
| v1.4 | 2026-07-23 | Colores reales del logo (`--logo-green: #8ec30f`, `--logo-magenta: #981d97` + variantes suaves), muestreados por pixel de `public/Logo512.png` — a pedido del usuario, se adoptan como los acentos DECORATIVOS/de identidad del proyecto de aquí en adelante (glows ambientales, estado activo de nav, hover de personalización), reemplazando el violeta/índigo genérico (`--brand-purple`, blobs de `AppLayout.jsx`) que no tenía relación real con la marca. `--brand` (#0052CC) sigue siendo el azul funcional, sin cambios. Tokens agregados a `index.css` + bridge `@theme inline`. Aplicado primero al prototipo interactivo del sidebar (ver §7.7 de `AUDITORIA-TEMA-2026-07.md`); pendiente extender a los blobs ambientales globales y cualquier glow decorativo nuevo. |
| v1.3 | 2026-07-23 | Fase T2 de `AUDITORIA-TEMA-2026-07.md` — refinamiento "Solid Modern" (`solid`/`solid-dark`: `--bg-page` tinte frío, radios 12px/16px) + contrato de tema ampliado: ramps de estado (hover/pressed por semántica, derivadas de valores ya usados en el código), escala de elevación 0-3, densidad adaptativa (3 niveles, tokens `--space-card-padding`/`--control-h`/`--row-h`/`--header-h`, sidebar auto-colapsa a rail en nivel "ultra" vía `isUltraDensity` en `AppLayout.jsx`), blobs ambient apagados en solid/solid-dark. Script de contraste AA nuevo (`contrast-check.mjs`, sin dependencias) encontró y corrigió un fallo real: `--text-tertiary` en solid/solid-dark no cumplía AA (2.56:1/2.76:1) contra `surface-card` opaco — corregido a 4.76:1/4.92:1. `ViewTabBar.jsx` migrado de verdad a tokens (primer componente con la plantilla de doc §8.5) — cierra el blindspot de dark mode de §22 vía el token net-new `--surface-tab-active`; su duplicado hand-rolled en `VentasView.jsx` (ya documentado en §32/§23) recibió la misma migración. `GlassViewLayout.jsx` limpiado de clases muertas (confirmado con Playwright que `data-surface="card"`/`"page-header"` ya ganaban la cascada sobre las clases Tailwind hardcodeadas coexistentes — CSS Cascade Layers: lo no-layered de `index.css` siempre gana sobre `@layer utilities` de Tailwind, sin importar orden ni especificidad). §32 resuelve la contradicción de breakpoints (`md:768` vs `lg:1024` real). Corrección de §5 (tokens de `dropdown`/`input`/`tab-track` documentados vs reales). Capturas del gate en `docs/audits/tema-2026-07/shots-t2-gate/` — pendiente aprobación del usuario antes de T3. |
| v1.2 | 2026-07-23 | Fase T1 de `AUDITORIA-TEMA-2026-07.md` — puente Tailwind v4 (`@theme inline` en `index.css`): tokens de color/radio/sombra existentes ahora son utilidades reales (`bg-surface-card`, `text-content-2`, `rounded-card`, `shadow-modal`, `bg-brand`…). Renombrados los primitivos crudos de radio/sombra (`--radius-card`→`--card-radius` etc.) para evitar autorreferencia circular con el namespace de Tailwind. Tokens net-new: focus-ring, scrim, divisor, paleta dataviz categórica (6), semáforo de riesgo de stock (7 estados reales de `tabminmax/constants.js`, corrige la mención errónea de "MUERTA/NORMAL/PICO/CRÍTICA" — ese es en realidad un semáforo *distinto*, de volumen de transacciones/hora en `DashboardView.jsx`, también tokenizado ahora). Z-index canónico (16 clases) vía `@utility` (Tailwind v4 no tiene namespace `@theme` para z-index). Corregidos de paso: `tailwind.config.js` estaba muerto (el proyecto usa `@tailwindcss/postcss` sin `@config` — confirmado porque Tailwind escaneaba el repo completo, no solo `src/`, incluyendo strings de archivos `.md`); sus 3 animaciones realmente usadas (`wiggle`, `kpi-enter`, `widget-settle`) no generaban NINGÚN CSS en producción (bug silencioso pre-existente en `NotificationBell`/`DashboardView`) — migradas a `@keyframes` nativos en `index.css`, archivo eliminado. `App.jsx:529/545` (`bg-[#E6F0FF]` hardcodeado, rompía dark/solid) → `bg-surface-page`; `AppLayout.jsx:710` scrim hardcodeado → `bg-scrim` (ambos same-value, cero cambio visual, corregidos de inmediato en vez de diferirse a T3 — ver `feedback_fix_violations_immediately` en memoria). §5, §9, §11 corregidos para reflejar el CSS real (tokens de `dropdown`/`input`/`tab-track` que no existían, keyframes fantasma). Cero componentes/vistas migrados a las nuevas utilidades — eso es T3/T4. |

---

## 31. Anti-Patterns (Never Do)

- Left-border color indicators (`border-l-4 border-red-500`) on rows, cards, or lists. **Gated automáticamente** desde 2026-07-26 (`gate:design`, categoría `left-border`) — `border-l-{2,4,8}` sin un `border-r` emparejado en la misma línea (el `border-r` es la señal de que es un spinner vía `animate-spin`, no un indicador).
- `transition-all` — use specific property transitions. Excepción válida: animaciones multi-propiedad sin shorthand CSS (ej. search expand en ViewTabBar) pueden usar `transition-all`.
- `active:scale-90/95` — minimum `active:scale-[0.97]`. **Gated automáticamente** desde 2026-07-26 (categoría `scale-tap`).
- `font-normal` or `font-light` on interactive UI elements.
- `text-slate-300/400` as text color over light surfaces.
- `animate-bounce` on a decorative element with **no semantic purpose** (e.g. a "look here" arrow with nothing to point at). **Clarified 2026-07-15 (Bloque 5.7a)** after auditing all 16 existing uses — none were this anti-pattern. Three uses are legitimate and should stay `animate-bounce`: (1) loading/typing indicator dots (`App.jsx`, 3-4 sequenced dots — the same industry-standard pattern as iMessage/Slack "escribiendo…"), (2) the birthday cake/confetti badge (`AppLayout.jsx`, `StaffManagementView.jsx`, `EmployeeHomeView.jsx` — a deliberate, consistent celebration, not random motion), (3) the red error icon in `FeedbackOverlay.jsx` (kiosk clock-in/out feedback — draws the eye to an error on a screen used quickly and often unattended). If a new use doesn't fit one of these three categories, don't add it without checking here first.
- New framer-motion imports.
- `<select>` native element — use LiquidSelect.
- Hero metric: large number alone with tiny label and no context.
- Cards with identical visual weight in a grid (no hierarchy).
- `backdrop-filter` or surface background hardcoded in component when `[data-surface]` covers the case.
- Web fonts loaded via `@import` or `<link>` — system font stack only.
- Wrapping `DataTable` in a second card div (`data-surface="card"` or custom `bg-white/... backdrop-blur...`) — it already renders its own card. See §14 DataTable.

---

## 32. Mobile & Responsive Standard

> Added 2026-07-10 during the Fase 4 design/UX audit (see `AUDITORIA-2026-07.md`). Before this, the project had no single documented mobile standard — patterns existed ad hoc per component. This section codifies what was verified and fixed during that audit, and is now the baseline for any new UI.

### Breakpoints

**Corregido en Fase T2 (2026-07-23)** — esta sección decía "un solo breakpoint
`md:768`", pero el shell real (`AppLayout.jsx`) usa `lg:1024` como frontera
móvil/desktop desde el rediseño del shell móvil (v2.30–v2.32.x). Tabla
canónica única, sin contradicción:

| Breakpoint | Rol |
|---|---|
| `lg:` (1024px) | **Frontera de shell**: por debajo, layout móvil (sidebar overlay, body scroll); en/por encima, app-shell fijo de escritorio. Ésta es la decisión estructural, no `md:`. |
| `md:` (768px) | Ajustes de **layout interno** dentro de una vista ya en modo desktop o ya en modo móvil (columnas de formulario, tamaño de controles) — nunca decide el modo shell. |
| `sm:` | Solo nudges menores de spacing/tamaño de tipografía, nunca cambios estructurales. |
| `1152px` / `1440px` + media queries de **alto** (`<820h`/`<700h`) | **Niveles de densidad** (Fase T2, ver "Densidad Adaptativa" abajo) — cómoda/compacta/ultra, ortogonal al breakpoint de shell. 1024×768 (mínimo soportado) cae en el nivel "ultra". |

Audited viewports (Fase 4, 2026-07-10): **390×844** (phone) y **768×1024** (tablet). Verificados en Fase T2: **1024×768** (ultra), **1366×768 zoom 125%** (~1093×614), **1440×900** (cómoda).

### Densidad Adaptativa (Fase T2, §7.4 `AUDITORIA-TEMA-2026-07.md`)

Tokens en `:root` de `index.css`, reactivos a `@media` de ancho Y alto —
independientes del tema de color (aplican igual en los 4 temas):

| Token | Cómoda (≥1440w y ≥820h) | Compacta (<1440w o <820h) | Ultra (<1152w o <700h) |
|---|---|---|---|
| `--space-card-padding` | 24px | 16px | 12px |
| `--control-h` | 40px | 36px | 32px |
| `--row-h` | 44px | 38px | 32px |
| `--header-h` | 72px | 56px | 44px |
| `--font-data` | 14px | 14px | 13px |

Se consumen vía sintaxis arbitraria (`p-[var(--space-card-padding)]`,
`h-[var(--control-h)]`) — no necesitan bridge `@theme` (no son colores/
radios/sombras, y Tailwind soporta `var()` en valores arbitrarios de forma
nativa). El sidebar en nivel "ultra" colapsa automáticamente a rail (72-80px,
`AppLayout.jsx` — `isUltraDensity` fuerza `isSidebarOpen=false` igual que
`isMobile`, reutilizando el ancho colapsado `w-[4.5rem] xl:w-[5rem]` que ya
existía como toggle manual).

### La tabla del canon — qué usa cada necesidad en el teléfono

> Agregada el 2026-08-07. Los canónicos móviles ya existían —son nueve— y
> **ninguna lista decía cuál corresponde a qué**: se descubrían leyendo el
> componente, así que cada vista nueva volvía a decidirlo. Verificada contra el
> código, no de memoria. El plan que la originó:
> `docs/PLAN-CANON-MOVIL-2026-08-07.md`.

| Necesidad de la vista | Escritorio | En el teléfono (<1024px) |
|---|---|---|
| Lista de registros | `DataTable` + `DataRow`/`DataCell` | **el mismo**: cae solo a fichas (arriba) |
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

> Al construir una vista nueva, el checklist que recorre esta tabla paso a paso
> —y los gates que hay que correr— está en `docs/CHECKLIST-VISTA-NUEVA.md`.

### El encabezado de una vista en el teléfono: DOS COLUMNAS

> Agregada el 2026-08-09 por pedido del usuario: *«el selector de tab está abajo
> del título, mejor que esté a la par, así se tienen 2 columnas en móvil, se
> ahorra espacio vertical»*.

En `<lg` el encabezado de `GlassViewLayout` es **una sola fila**: título a la
izquierda, `filtersContent` (casi siempre el `ViewTabBar`) a la derecha.

Antes eran dos renglones **siempre**, y no por falta de sitio: el título llevaba
`basis-[60%]`, y el reparto de líneas de un `flex-wrap` se decide con el tamaño
**hipotético** de cada hijo. 60% de 374px son 224 que, más los ~168 del selector
y el hueco, dan 404 > 358 — o sea que el selector bajaba aunque el título midiera
75px y sobrara media pantalla.

Las tres piezas de la regla, en orden:

1. **`basis-0` + `grow` en la columna del título.** Pide 0 por adelantado, así
   que nunca fuerza el salto de línea, y después crece hasta el hueco que deja el
   selector.
2. **`line-clamp-2` + `leading-tight` en el `h2`, nunca `truncate`.** El título
   que no entra en una línea se parte en dos, centrado contra el ícono y el
   selector. Dos renglones de `text-body-xl` miden 40px y entran dentro de los 48
   que ya mide la barra de pestañas: **el encabezado no crece por partir el
   título.** `truncate` es lo que producía «Pedidos a Sucur…» y está prohibido
   acá — recortar el nombre de la vista para ganar alto es exactamente lo que A2
   corrigió en 2026-07-26.
3. **El selector cede ancho** (ver `ViewTabBar`, `clamp(8.75rem, 34vw,
   11.875rem)`). Sin esto el título de Pedidos se quedaba con 85px y «Sucursales»
   no entraba ni partido.

Medido en WebKit iPhone 13 sobre 18 rutas: **18 de 18 en una fila, 0 títulos
recortados, 0 rótulos de pestaña recortados.** El encabezado mide **84px** en las
vistas con pestañas y **68px** en las que no las tienen. Como referencia de lo que
cuesta el renglón extra: en la variante intermedia que dejaba caer el selector,
esas mismas rutas medían **124px**.

**Cómo elegir la variante de `ExpedienteMovil`:** si el detalle son secciones e
historiales, `pantalla`; si es una lista de líneas, la hoja (`auto`, el default).
Los dos errores no cuestan lo mismo — quedarse corto con la hoja cuesta un
scroll; pasarse con la pantalla completa deja media pantalla vacía y esconde la
vista de atrás sin necesidad. Y adentro del panel, **cero tablas** en los dos
casos.

### Touch targets — 44×44px minimum (WCAG 2.5.8)

Applies to every `button`, `a[href]`, checkbox/radio, and any `[role="button"]`. This is now enforced in the two components nearly every view depends on:
- `ViewTabBar.jsx` — tab pills, search-open button, search-close button all `h-11` (44px) with `min-w-[44px]` on tab pills (short single-word labels like "General"/"RRHH" would otherwise fall under 44px in width even at 44px height).
- `AppLayout.jsx` — the header hamburger button uses the `p-3 -m-3` pattern (padding grows the hit area, negative margin cancels the visual shift) to hit 44px without changing the icon's rendered size or the header's layout.

**Update 2026-07-15 (Bloque 5.3, `PLAN-EJECUCION-2026-07.md`):** re-audited with Playwright (25 routes × 2 viewports, real viewport-intersection check). Fixed 36 real hit-box bugs across 24 files — mainly the 22 views duplicating `ViewTabBar`'s search-open/close button with the pre-Fase-4-fix size (`w-10 h-10 md:w-11 md:h-11`) instead of the already-fixed `w-11 h-11`, plus 7 Dashboard "Ver" links and a handful of standalone CTAs a few px short of 44 (`p-X -m-X` padding pattern where the element was a bare text/icon control, direct height bump where it was already a real pill/button).

**Known residual gaps, not fixed, deliberate trade-off** (same reasoning as the `PushPromptBanner` precedent below — re-verified 2026-07-15, still applies): filter/tab pills with visible text (TODOS/ARCHIVO/ACTIVOS/ANULADAS/etc., ~130 instances) are the established Filter Pill/Tab Bar Standard used everywhere in the app on purpose — resizing them to 44px tall would be a systemic redesign of that shared visual pattern, not a bug fix. Dense icon-button groups inside cards (e.g. RolesView's Editar/Eliminar/Ver Empleados, BranchesView's Copiar/Diagnóstico/Ver Perfil/Ajustes) were left alone because growing their invisible hit-box risks overlapping a neighbor's click zone (real mis-click risk, not mechanical to fix safely). Small fixed-size hover-reveal badge icons (Dashboard's "Cambiar tamaño", `ScheduleChart`'s "Expandir Análisis") have their box sized 1:1 with their visible circle, so enlarging the hit-box necessarily enlarges the visible badge — a visual character change, same class of decision as `PushPromptBanner`'s "Activar" button (deliberately compact, raising it to 44px would meaningfully change that banner's low-profile character). `LiquidSelect`'s internal clear (X) / chevron buttons were also left alone — they're secondary controls nested inside an already-44px trigger used in ~30+ places; changing their hit-box has high blast radius for uncertain benefit. Sidebar indented nav items (~36px) were already a known gap before this audit (§25).

**Actualización 2026-08-07 — varios de esos «gaps residuales» ya no existen, y la
salida fue siempre la misma.** Barrido de las **37** vistas en WebKit iPhone 13:
**cero** blancos táctiles por debajo de 44pt. Lo que los cerró no fue agrandar
los controles, sino separar el **área de impacto** del **tamaño pintado** con
`.blanco-tactil` — que es justo lo que el párrafo de arriba daba por imposible
(«agrandar la caja invisible arriesga solaparse con el vecino»). Casos cerrados:
las 50 cajas de MIN·MAX (36×23 cada una, dos por fila), el interruptor `sm`
(32×16), el aspa y el chevron internos de `LiquidSelect`. El encabezado de
sección de Laboratorios sí creció, porque ahí el tamaño no era el diseño: era un
descuido (`min-h-[var(--tap-min)]`, que en escritorio vale 0).

**Y lo que de verdad no cabe se MIDE, no se declara.** Siete columnas de un
gráfico en 390px dan 40px cada una y no pueden dar 44 sin solaparse. El medidor
las separa de la deuda con aritmética —`(ancho − huecos) / columnas < 44`— y no
con una lista de excepciones. La versión anterior de esa regla las excluía por un
`aria-label` que empezara con «Día: », un rótulo que **ningún archivo del
proyecto escribe**: la excepción nunca corrió y las 14 columnas entraban como
deuda en cada corrida. Una excepción escrita contra un texto que hay que
acordarse de poner es una excepción que no existe.

**Actualización 2026-08-08 — el riesgo de solaparse se midió, y no existía.** El
párrafo de los «gaps residuales» dejaba fuera a varios controles con el argumento
de que *«agrandar su caja invisible arriesga solaparse con el vecino»*. Eso era
una suposición: el hueco nunca se había medido. Medido en iPad Mini sobre el
último caso abierto —`TabBarAction size="sm"`— al botón le faltan **4px por lado**
y el hueco hasta su vecino más cercano es de **12px**. No hay solapamiento
posible, y el mismo número deja pasar al resto de la familia.

La regla que queda es simétrica a la de las columnas de gráfico: **lo que no cabe
se mide, y lo que sí cabe también.** Ninguna de las dos se declara.

**Y `useLayoutCompacto` responde «¿hay sitio?», no «¿hay dedo?».** Son dos
preguntas y el código las tenía mezcladas: el comentario de `TabBarAction` decía
que `sm` no necesitaba piso táctil *«porque en táctil esta píldora no se
dibuja»*, y a 768px con puntero grueso **sí se dibuja**. El corte
(`max-width: 719px`, o `hover: none` con `max-height: 500px`) está bien para lo
que decide —si entra la barra de filtros de escritorio—; lo que no se sigue de
ahí es que no haya dedo. Un tamaño de blanco táctil se decide por `(pointer:
coarse)`, nunca por el ancho.

**Estado al 2026-08-08 — la foto completa, con su instrumento.** Barrido de las
**37 rutas × 4 temas** (148 pantallas, WebKit iPhone 13) más la matriz de
**5 perfiles × 7 escenarios**:

```
desbordes 0 · recortes 0 · zoom de iOS 0 · scroll lateral 0 · sin acuse 0
ninguna vista reventada · matriz: 0 de 35 celdas con hallazgo
```

Dos cosas que ese cero **no** dice, y conviene tener presentes:

1. **El tema no cambia el layout.** `liquid`, `dark`, `solid` y `solid-dark` dan
   números idénticos. Era una pregunta abierta desde siempre —todo lo medido
   hasta el 2026-08-07 fue en el tema por defecto— y la respuesta es que no hace
   falta volver a medir por tema.
2. **Las áreas seguras siguen sin verificarse en un teléfono real**, y no por
   descuido: `env(safe-area-inset-*)` vale 0 en todo emulador. El guion de esa
   prueba está en `docs/PRUEBA-EN-TELEFONO-REAL.md`.

### Inputs — 16px minimum font-size (iOS Safari zoom)

**This was the single highest-impact bug found in the Fase 4 audit.** Any `<input>`/`<textarea>` (excluding `checkbox/radio/range/color/file`) with a computed `font-size < 16px` triggers an automatic page zoom on focus in iOS Safari — jarring, and the user has to manually zoom back out every time. This was found on ~170 inputs across ~60 files (search boxes at 13px was the single most repeated instance, via both `ViewTabBar.jsx`'s shared search input and several views that hand-roll their own duplicate search input instead of using `ViewTabBar`). Fixed project-wide: every text-entry input's font-size floor is now `text-[16px]`. **Rule going forward: never set a text-entry input below `text-[16px]`, full stop** — there is no valid reason to go smaller, since 16px is also comfortably readable at any density this app ships at.

**Sin gate, esto vuelve a driftar** — re-auditado 2026-07-26 (grep estructural, no manual) y encontradas 11 instancias reales nuevas en 8 archivos (`FormRegisterPayment`, `FormAddCustomDocument`, `KioskConfigModal`, `EarlyExitForm`, `FacturacionView` ×3, `AttendanceMonitorView` ×2, `TabLaboratorios`) — todas corregidas. **Gated automáticamente** desde esa misma sesión (`gate:design`, categoría `small-input`) — cualquier `text-xs`/`text-sm`/`text-[Npx]` (N<16) en la línea de apertura de un `<input>`/`<textarea>` real falla el gate, excepto dentro de `placeholder:` (solo afecta al placeholder, no dispara el zoom — falso positivo real encontrado en `AuthPromptPanel.jsx`, un PIN gigante con placeholder chico aparte).

### Search pattern duplication (structural finding, not fixed)

Multiple views (`BranchesView`, `ConteoDetailView`, and others) hand-roll their own local copy of the floating search-pill + input instead of using the shared `ViewTabBar` component (see [[feedback_global_search_pattern]] — this is already a documented house rule being violated in practice). Every duplicate carries its own copy of whatever bugs `ViewTabBar` has (or had) independently. This audit patched the *symptom* (font-size, button size) in each duplicate found, but the *cause* (component duplication instead of reuse) is a larger refactor out of scope for a design-pass fix — flagged for a future consolidation pass. **2026-07-15 update:** the button-size symptom recurred — 22 files still had the pre-fix size (see Touch targets update above) — and was patched again. The *cause* is still open; the next view built with a hand-rolled search pill will carry the same bug forward until the consolidation refactor happens.

### Tabla → fichas — **existe desde v2.480.0**

> Esta sección decía lo contrario hasta el 2026-08-07: *«`DataTable` no se
> convierte en lista de fichas en viewports angostos; no existe una variante
> móvil de lista de tarjetas»*. Se construyó, y el documento no se enteró. Un
> canon desactualizado **enseña la deuda**: quien lo leyera para hacer una vista
> nueva escribiría su propia lista a mano.

`DataTable` cae solo a **fichas** por debajo de `lg:` (1024px). No hay que
escribir nada: la vista sigue declarando `columns` + `DataRow`/`DataCell` y la
misma tabla se dibuja como lista de tarjetas en el teléfono.

**Los papeles se INFIEREN de `columns`, no se piden por prop** — una prop opt-in
es una prop olvidada:

| Papel | Cómo se elige | Dónde aparece en la ficha |
|---|---|---|
| **identidad** | primera columna útil que no sea el ancla | título, arriba a la izquierda |
| **ancla** | última columna `align: 'right'` (la convención de los números) | el número, arriba a la derecha |
| **contexto** | las dos siguientes, priorizando las que no tengan `hideBelow` | línea tenue debajo, separada por `·` |
| **resto** | todo lo demás | la hoja que abre al tocar |
| **acciones** | rótulo vacío **o** clave `acciones`/`actions` | no se dibuja, salvo `movil={{ acciones: true }}` |

`movil={{ … }}` es un objeto de **overrides**, no un reemplazo: quien declara
`ancla` no renuncia a que se infiera la identidad.

- `movil={{ ancla, identidad, chips }}` — fija papeles a mano.
- `movil={{ usarAccionDeFila: true }}` — el toque usa el `onClick` de la fila en
  vez de abrir la hoja. Sólo si ese manejador **navega**; en la mitad de las
  vistas expande un `<tr>` hermano que en modo ficha no existe.
- `movil={{ acciones: true }}` — dibuja la columna de acciones dentro de la
  ficha. Sólo si esos botones abren un modal o disparan una mutación de verdad.
- `movil={false}` — vuelve a la tabla con carril. **Es la excepción** y se
  justifica en el código: la fila no es un registro (un calendario, una matriz).

**Lo que la ficha NO hace:** una fila que no sea `DataRow` —un `<tr colSpan>` de
detalle expandido— no se pinta; y si el número de celdas no coincide con el de
columnas, esa fila se apila sin rótulos en vez de adivinar.

### Áreas seguras (notch / barra de gestos)

> También desactualizado hasta el 2026-08-07: decía *«no se encontró uso de
> `env(safe-area-inset-*)` en el código»*. Hoy sí se usa, y de forma canónica.

`index.css` deriva cuatro tokens de los insets del sistema —`--sa-top`,
`--sa-right`, `--sa-bottom`, `--sa-left`— y **eso es lo que se consume**. Antes
estaban escritos a mano en 14 sitios, cada uno con su propia combinación de
`max()`, así que el mismo borde medía distinto según quién lo escribiera.

Lo que **sigue abierto** es la verificación en un **dispositivo real**: todo lo
medido hasta hoy es emulación (WebKit iPhone 13 en Playwright), y
`env(safe-area-inset-*)` vale **0 en todo emulador** — o sea que el emulador no
puede distinguir «está bien resuelto» de «no está resuelto». Esa comprobación
necesita un teléfono con notch y el shell nativo de Capacitor (§21).

### §32.7 · Acciones de fila en el teléfono: mantener presionado (2026-08-08)

Una fila del teléfono suele tener **una** acción —el toque, que navega— y las
demás quedan en la tabla, que debajo de `md` no se pinta. Cuando eso deja una
función sin camino (fue el caso de eliminar un conteo desde su lista), el gesto
canónico es **mantener presionado**, no deslizar.

**El criterio, para no volver a discutirlo por gusto:** ¿el gesto puede
*consumar* la acción? Si la acción es irreversible lleva confirmación
obligatoria, y entonces deslizar cuesta los mismos toques que mantener
(gesto → tocar → confirmar) sin ninguna de sus ventajas. Además deslizar
(a) sobre una fila que no puede ejecutar la acción sólo puede no hacer nada,
que se lee como que la pantalla se colgó; (b) obliga a arbitrar el eje contra el
scroll vertical de la lista; y (c) sostiene una sola acción, mientras que una
hoja crece a la siguiente. Para algo barato y reversible (archivar, marcar
leído) deslizar sí cobra su ventaja — ahí es la elección correcta.

**El hook es `usePulsacionLarga` (`src/hooks/`)** y resuelve el toque **y** la
mantenida juntos a propósito: al soltar, el navegador dispara `click` igual, así
que separarlos deja la fila navegando *además* de abrir la hoja. Trae también el
`pointercancel` (la señal buena de que empezó el scroll), la tolerancia de 10px
y el apagado del menú contextual. Se le suma en la fila
`select-none [-webkit-touch-callout:none]`, o el callout de iOS levanta la lupa
sobre la hoja recién abierta.

**El destino es `HojaMovil` dentro de `ModalShell`** (`align="bottom"`,
`surface={null}`), que nace en gota del punto mantenido sin que haya que pasarle
nada. Se ofrece sólo si hay más de una opción real: un gesto que abre un menú
con lo único que el toque ya hace es peor que no tenerlo. Y como un gesto que no
se ve no existe, la lista lleva una línea al pie que lo anuncia.

**El acuse visual es canónico y no se escribe por vista: es el FILO del canto.**
El hook marca `data-manteniendo="true"` en el elemento y `index.css` (§1.6, «La
mantenida») corre `filo-corre` sobre su `::after` — mismo contrato que
`data-surface` para el material y `data-interactive` para el gel. Una vuelta
completa del filo dura lo que dura la mantenida, así que el barrido **es** la
cuenta regresiva, no un adorno. La duración entra por `--pulsacion-retardo`, que
el hook inyecta desde la misma constante que gobierna su `setTimeout` — una sola
fuente de verdad, empujada de JS a CSS (el camino inverso es lo que ya se pagó
en `ModalShell`, v2.238.0). Con `prefers-reduced-motion` el filo queda puesto,
marcado y quieto: el acuse no se puede apagar del todo, porque **es** el
indicador de que el gesto está corriendo.

**No se anima `transform`, y el motivo es medido.** La primera versión encogía la
tarjeta hasta `scale(.96)` durante la mantenida, y el usuario reportó las dos
cosas que estaban mal: que no decía nada nuevo —encoger más es el mismo gesto del
`:active`, más grande— y que producía **un destello en toda la vista**. Animar
`transform` cuadro a cuadro sobre un elemento con `backdrop-filter` obliga al
motor a re-muestrear el fondo en cada uno, y con los blobs de ambiente detrás eso
repinta la capa entera. Es la misma familia de reglas por la que `gotaApertura.js`
anima `clip-path` y no `transform`. El filo, en cambio, es `opacity` — una de las
dos propiedades que el compositor mueve sin repintar.

**El filo hay que declararlo con los TRES selectores** de §1.6 más el atributo.
Escrito sólo como `[data-manteniendo="true"]::after` —(0,1,0)— pierde contra
`[data-surface]:not([data-surface="sheet"])::after`, que es (0,2,0): la regla
existe, la animación corre, y `opacity` se queda en 0, o sea que el filo barre un
pseudo invisible. Medido así antes de corregirlo. Es el mismo motivo por el que
el bloque de `:hover` de §1.6 también repite los tres.

**Y un gesto táctil era justo lo que le faltaba al filo.** `filo-corre` colgaba
sólo de `:hover`, dentro de `@media (hover: hover)` — o sea que en un teléfono el
canto no corría nunca.

Medido en WebKit/iPhone 13 el 2026-08-08: `animationName` = `filo-corre` con
`animation-duration` de `0.5s` leída del var, `opacity` del `::after` en 1
durante la mantenida y 0 en reposo, y **ninguna animación propia** en el
elemento (la de escala se retiró).

**La salida de la gota se anima con la WAAPI, no con una transición de CSS**, y
el desmontaje cuelga de su `onfinish`. Las dos cosas salen del mismo reporte
—«se cierra sin animación, sólo desaparece»— con un A/B que señaló el punto
exacto: **arrastrando sí animaba, tocando afuera no**. Esa es la diferencia entre
continuar desde un recorte que ya existe y tener que *sembrar* uno, y sembrar
dependía de que el navegador fijara un estado intermedio dentro de la misma
tarea. `gotaApertura.js` ya tenía escrito que en el Safari de iOS ese apretón «no
siempre» alcanza, y cuando no alcanza el motor junta los dos extremos y salta al
final. Con la WAAPI los dos extremos se declaran en los keyframes: no hay estado
intermedio que confirmar. **El emulador de escritorio no puede ver este bug** —
ahí el apretón sí alcanza, y la medición daba `transitionend` con su `elapsedTime`
completo. Corolario: un cierre que el usuario reporta como «no anima» y que en
WebKit de escritorio se mide perfecto es, muy probablemente, este.
Y el `setTimeout` que desmontaba pasó a ser un **techo**: 60ms de margen sonaban
holgados hasta medir que 54 se iban sólo en arrancar la transición.

**Un modal que hace `if (!isOpen) return null` no tiene animación de salida.** Se
arranca del árbol en el mismo tick en que se cierra, así que `ModalShell` nunca
llega a ver `open=false`. Medido en `NuevoConteoModal`: desmontaba a los **23ms**
contra los ~260 de una hoja que sí hace su recorrido. `ModalShell` ya devuelve
`null` cuando está cerrado y terminó de salir — esa línea no hace falta y además
rompe justo lo que parece proteger.

**Una hoja que se cierra necesita DOS estados, no uno.** `open={!!item}` con el
cuerpo bajo `{item && …}` acopla «qué registro» con «está abierta»: al cerrar, el
cuerpo se desmonta en el acto mientras `ModalShell` sigue montado animando su
salida, así que la hoja no se cierra — desaparece. Arrastrándola no se nota,
porque el asa ya movió el panel bajo el dedo antes de soltar; **tocando afuera el
salto queda a la vista**, y así se reportó. Es la lección ya escrita en
`ModalShell` (v2.238.0), y vale para todo llamador: el registro se conserva
mientras dura la salida y lo pisa la próxima apertura.

**Una fila suelta sobre la página va con `surface="card"`.** `ListRow` nace como
fila *dentro* de un contenedor —menú, flyout—, así que en reposo no pinta fondo
ni borde y toma el radio del botón. Sin contenedor alrededor el resultado es
texto flotando («no parece card, sólo es texto»). Va por la prop y nunca por
`bg-surface-card` a mano: esas clases copian el relleno y dejan afuera el
`backdrop-filter`, la sombra y el lente del filo (§5, y la nota del tablero del
2026-08-07).

### Viewport meta

**Update 2026-07-15 (Bloque 5.7b):** the static `maximum-scale=1.0, user-scalable=no` in `index.html`'s `<meta name="viewport">` blocked pinch-zoom unconditionally — a real WCAG 1.4.4 (Resize Text) violation for anyone using the portal as a normal website. Resolved by making it conditional instead of choosing one side: a small inline script in `index.html` (runs synchronously before React mounts, so there's no flash of different zoom behavior) checks — native Capacitor build (`Capacitor.isNativePlatform()`), installed/standalone PWA (`display-mode: standalone` / `navigator.standalone`), or the `/kiosk` route — and only in those cases keeps `user-scalable=no`. Everywhere else (a regular browser tab, including on mobile) the meta tag is rewritten to drop `maximum-scale`/`user-scalable`, restoring full pinch-zoom. `viewport-fit=cover` is unaffected either way, and is correctly set up for safe-area CSS to work, once/if that's implemented (see above).

---

---

## 26. Voz — cómo escribe el portal (F2 de PLAN-IDENTIDAD, 2026-07-29)

Esta sección faltaba entera. Hasta hoy el doc tenía 3,370 líneas sobre la
**forma** y ni una sobre la **palabra**, que es la mitad de la identidad y la
única primitiva que el gate no puede ver mirando clases de Tailwind. El
resultado, medido en los 73 slots de copy del portal: cuatro gramáticas
conviviendo en el mismo hueco.

| Forma | Ejemplos que había |
|---|---|
| `Sin X` | `Sin resultados`, `Sin pagos confirmados` |
| `Sin X` **con punto** | `Sin facturas en el período.`, `Sin proveedores registrados todavía.` |
| `No hay X` | `No hay registros`, `No hay empleados en esta categoría` |
| `Aún no hay X` / `No se encontraron X` | `Aún no hay cotizaciones`, `No se encontraron productos` |

Es la misma deriva que tenían los colores antes de la paleta cerrada: cada quien
resolvió lo mismo a su manera porque no había dónde mirar.

### 26.1 El vacío se escribe `Sin <sustantivo plural>`

Título, **sin punto final**, y sin las muletas que no agregan nada:

```
✅ Sin cotizaciones          ❌ Aún no hay cotizaciones
✅ Sin proveedores           ❌ Sin proveedores registrados todavía.
✅ Sin registros             ❌ No hay registros
✅ Sin conteos de inventario ❌ Sin conteos de inventario registrados
```

`aún` y `todavía` prometen algo que la app no sabe (¿va a haber?). `registrados`
es ruido: si la lista está vacía, ya se entiende que no hay ninguno registrado.
Y un punto final en una frase de tres palabras no cierra nada.

### 26.2 Búsqueda sin resultados **no** es un vacío

Son dos estados distintos y el usuario necesita distinguirlos: uno se arregla
borrando el filtro, el otro creando el primer registro. Confundirlos manda a
alguien a crear algo que ya existe.

```jsx
// tabla vacía de verdad
empty={{ icon: Package, message: 'Sin productos' }}

// hay filtro o término activo
<EmptyState compact icon={Search} title="Sin resultados"
            subtitle={`Ningún producto coincide con "${termino}".`} />
```

`VentasView` y `TabExpediente` ya lo hacían bien y ahora es la regla. El título
es siempre `Sin resultados`; el término va en el subtítulo, entre comillas.

### 26.3 El vacío feliz es una tercera forma, y se respeta

Cuando "no hay nada" es una **buena** noticia, forzar `Sin X` tira la
información al piso: `Sin documentos vencidos` informa; `Expediente impecable`
felicita, y es lo que la persona necesita leer. Los que existen hoy y quedan
como están:

```
Todo está al día            (no hay anulaciones pendientes)
Expediente impecable        (no hay alertas ni documentos por vencer)
Sin saltos detectados       (los correlativos están completos)
```

La prueba para saber si aplica: ¿el usuario quería encontrar algo acá, o quería
que estuviera vacío? Si quería que estuviera vacío, se le dice que ganó.

### 26.4 Sentence case en todo

Mayúscula en la primera palabra y ya. `Sin horarios`, no `Sin Horarios`.
`Datos incompletos`, no `Datos Incompletos`. Los nombres propios y las siglas
(`MH`, `SRS`, `ERP`, `ABC × XYZ`, `MIN/MAX`) van como corresponde.

**La única excepción** es la etiqueta en versalitas de `text-caption`
(`uppercase tracking-widest font-black`), que ya está en §7 y va en mayúsculas
por diseño tipográfico, no por redacción.

### 26.5 El punto final: etiqueta o prosa

La pregunta no es cuántas oraciones tiene, sino **si es una etiqueta o si es
prosa**. Una etiqueta nombra algo; la prosa le habla a alguien.

- **Etiqueta → sin punto.** Títulos, botones, badges, encabezados de columna,
  mensajes de vacío. Son frases nominales, no oraciones: `Sin facturas en el
  período`, no `Sin facturas en el período.`
- **Prosa → con punto.** Subtítulos, mensajes de modal, errores. Tienen verbo
  conjugado y le dicen algo al usuario: `Los correlativos están en orden. No hay
  brechas.` · `Alguien ya leyó este aviso. Por seguridad no puedes eliminarlo.`
- **Fragmento que continúa el título:** sin punto y en minúscula
  (`Selecciona un cargo` / `para modificar sus permisos de acceso`). Es un
  patrón válido: título y subtítulo se leen como una sola frase.

El gate aproxima "etiqueta" con **≤6 palabras y una sola oración**, porque un
texto con verbo conjugado y subordinadas ya dejó de ser una etiqueta. Es un
proxy, no la regla: la regla es la de arriba.

### 26.6 Los botones son verbos en infinitivo

`Guardar`, `Agregar producto`, `Confirmar conteo`. No `Guardado`, no `¡Guardar!`,
no `OK`. Un botón dice qué va a pasar cuando lo apretás, no qué pasó.

### 26.7 Tuteo, sin "por favor" y sin signos de exclamación

**Decisión del 2026-07-29.** El portal usa **tuteo** (`Selecciona`, `Intenta`,
`Crea`), que además era lo que ya dominaba: 89 usos contra 22 de voseo. El voseo
suena más salvadoreño pero mezclarlos es peor que cualquiera de los dos, y
unificar hacia el mayoritario cuesta 22 strings en vez de 89.

Nada de `por favor`: el portal es una herramienta de trabajo, informa y no pide
permiso. Un `por favor` en un error además suena a que la app se disculpa por
algo que el usuario no hizo.

```
✅ Selecciona un cargo               ❌ Seleccioná un cargo
✅ Revisa la conexión                ❌ Por favor revisá la conexión
✅ Conteo guardado                   ❌ ¡Conteo guardado!
✅ El cargo necesita un nombre.      ❌ ¡Ey! No puedes dejar el cargo sin nombre.
```

**Los `¡...!` se prohíben en el feedback del sistema, no en los momentos
humanos.** La primera versión de esta regla los prohibía a secas, y al aplicarla
quedó claro que era una regla que el código tenía razón en violar en tres
lugares. Un `¡Guardado!` en un botón es la app festejando su propio CRUD; un
`🎉 ¡Celebración!` el día del cumpleaños de alguien es otra cosa.

| | Exclamación |
|---|---|
| Toast, error, confirmación, botón, estado vacío, badge | **Nunca.** `Guardado`, `Copiado`, `Todo en orden` |
| El saludo del kiosco, el cumpleaños, el acceso concedido | **Sí.** Es una persona frente a una pantalla, no un log |

Los tres que quedan, y son la lista completa: `FeedbackOverlay` (cumpleaños y
aviso urgente del kiosco), `LoginView` (`¡Acceso concedido!` al escanear el
carné) y `EmployeeProfileView` (`¡Hoy! 🎉` en el cumpleaños propio).

### 26.8 Un error dice qué pasó y qué hacer

```
✅ No se pudo guardar el conteo. Revisa la conexión e intenta de nuevo.
❌ Error: PGRST204 column "x" does not exist
❌ Algo salió mal
```

El código crudo del error nunca llega al usuario — va al log. `Algo salió mal`
no es un error, es un encogimiento de hombros: no dice qué falló ni qué hacer.

### 26.9 Qué vigila el gate, y qué no

`copy-vacio` y `copy-trato` (2026-07-29) miran **solo los slots enumerados** —
`empty={{…message}}`, `<EmptyState title/subtitle>`, `message:` de
`AlertModal`/`ConfirmModal`— y no todo string del proyecto. Un gate de redacción
tiene falsos positivos por naturaleza; limitarlo a los huecos donde la regla es
inequívoca es lo que lo hace confiable. Detecta:

- punto final en un slot de una sola oración (26.1, 26.5);
- los arranques `No hay` / `Aún no` / `No se encontraron` / `Ningún` (26.1);
- Title Case: una segunda palabra capitalizada que no es sigla (26.4);
- las formas de voseo imperativo en cualquier string de UI (26.7).

Lo que **no** puede ver: si el texto es *correcto*. Que un vacío diga
`Sin productos` cuando había un filtro activo pasa el gate y es un error de
26.2 — eso lo agarra una persona leyendo, no un regex. Por eso `EXCEPTIONS` acá
se usa sin culpa cuando el texto está bien y el patrón se confunde.

### 26.10 Un nombre por pantalla, y de dónde se copia (2026-08-12)

El nombre de un módulo vive en **cinco registros**, y nada los cruza:

| registro | qué es |
|---|---|
| `title=` de la vista | el encabezado que confirma que llegaste |
| `constants/moduleMap.js` | la etiqueta del menú lateral |
| `constants/permissionModules.js` | el nombre en la pantalla de Permisos |
| `components/layout/AppLayout.jsx` | los grupos del menú |
| `ROUTE_TITLES` en `App.jsx` | el título del navegador |

Cambiar uno solo deja los otros cuatro contradiciéndolo. Medido antes de
unificarlos: **13 rutas se llamaban distinto según el registro**, y tres decían
el nombre de OTRA pantalla — `/dashboard` decía «Dashboard» (resto de cuando el
tablero se llamaba así, y encima esa ruta es el listado de personal),
`/payroll` decía «Planilla» con el menú diciendo «Nómina», y `/monitor` decía
«Asistencia», que es un grupo del menú.

**La regla: la pestaña del navegador se copia del ENCABEZADO de la vista, no del
menú.** El menú puede abreviar porque se lee dentro de su grupo («Listado» bajo
Personal); la pestaña se lee sola, entre otras veinte abiertas. Y una ruta sin
entrada en `ROUTE_TITLES` cae al genérico «Portal FarmaSalud»: al agregar una
vista, agregarle su título.

**Sentence case (26.4) vale también para estos nombres**, con las excepciones de
siempre: siglas (`IVA`, `MH`, `iOS`), nombres propios (`Corte Z`, `Min / Max`,
`Portal FarmaSalud`) y los términos ya decididos del portal (`Sistema de
Ventas` —nunca «ERP»—, `Bajo Receta`).

**Antes de renombrar una etiqueta, preguntarse si ese texto ES el dato.** Si es
el `value` de un catálogo, cambiarlo lo desincroniza de lo guardado; si el
`value` es un código, el rótulo es libre. Ver la regla «un rótulo no es una
clave» en `CLAUDE.md` y `docs/planes-cerrados/PLAN-CATALOGOS-QUE-SON-SU-PROPIO-ROTULO.md`.

### 26.11 El gate de diseño no ve el estilo guardado en una constante

`gate:design` escanea atributos `className`. Un estilo sacado a una constante
—que además parece buena práctica, porque des-duplica— **sale de su alcance sin
que nada avise**:

```js
const GLASS = 'rounded-2xl border border-divider bg-surface-card backdrop-blur-sm shadow-[…]';
```

Eso es exactamente lo que `vidrio-a-mano` prohíbe (§5.bis) y estuvo en verde en
tres pestañas de Pedidos a la vez. **Un gate verde no cierra una auditoría de
estilo**: antes de darla por buena, grepear las constantes de clases
(`const [A-Z_]* = '.*(rounded-|bg-surface|backdrop-blur|shadow-)`).

Ojo con el corolario falso: `shadow-sm` y `shadow-lg` sueltos tampoco los ve el
gate (sólo caza `shadow-[literal]`), pero ahí **no hay deuda** — 322 usos de
`shadow-sm` dicen que la utilidad es el idioma aceptado. La diferencia es que el
vidrio tiene canónico (`data-surface`) y la sombra no.
