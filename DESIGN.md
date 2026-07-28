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
| desplegable | `LiquidSelect` | §14 |
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
| hover | el control **se levanta** (`--lift-hover: -1px`) | no se mueve; solo cambia de color | `--lift-hover` |
| movimiento | entradas, deriva ambiental, barrido | apagado | reglas `[data-theme="solid"] .animate-*` |

**Consecuencias para escribir código nuevo**

- Nunca clavar `hover:-translate-y-px` — usar `hover:translate-y-[var(--lift-hover)]`.
  Los 176 que ya estaban escritos así se neutralizan con una regla de tema
  (`index.css`), pero eso es un parche, no el patrón.
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
  archivo — vive dentro de un host siempre-oscuro (`SidebarSettingsMenu`)
  y usa clases bespoke `bg-white/N`, no tokens (que resolverían claros ahí
  y quedarían ilegibles).
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
| `sidebar` | AppLayout `<aside>` glass div | Always dark — `bg-[#07031a]/80 backdrop-blur-2xl`. Intentionally ignores theme CSS vars. |

Card hover (desktop only, `@media (hover: hover)`):
```css
[data-surface="card"]:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-card-hover);
}
```

---

## 6. Color System

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

### Shimmer sweep (hover on buttons)

All primary CTA buttons include an inner `<span>` shimmer overlay:
```jsx
<span className="absolute inset-0 overflow-hidden rounded-[1.5rem] pointer-events-none">
  <span className="absolute top-0 bottom-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-[var(--shimmer-sweep)] to-transparent
                   -translate-x-full group-hover:translate-x-[220%] transition-transform duration-700 ease-out" />
</span>
```

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

**Default props:**
- Rest: `size={20}` `strokeWidth={1.5}`
- Active/emphasized: `size={20}` `strokeWidth={2}`
- Inline / compact: `size={16}` or `size={14}`
- Badge / chip: `size={12}` or `size={10}`

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
- `trailingActions` (prop opcional, agregado en la consolidación de
  VentasView): ReactNode con botones extra entre los tabs y el buscador,
  separado del bloque de tabs con el mismo `dividerCls`.

**Variantes/tamaños:** `showSearch={false}` para tab-only bars.

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
§32/§23) — consolidada al componente real vía el prop `trailingActions`
(único elemento que el duplicado tenía de más: el toggle de privacidad).
Efecto colateral: sus botones de tab pasaron de `h-9 md:h-10` (36/40px, bajo
el mínimo táctil) a los `h-11` (44px) reales.

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

Base portal wrapper. `createPortal` to body. Default `z-[100]`. ESC key closes. Scroll-locks via `document.documentElement.style.overflow = "hidden"`. Has `data-surface="modal"` on inner container.

Props: `open`, `onClose`, `maxWidthClass` (`'max-w-sm'` etc.), `zClass`.

### LiquidModal

File: `src/components/common/LiquidModal.jsx`

Wraps ModalShell. Adds inner glass layer:
- **Hardcoded:** `bg-white/50 backdrop-blur-[15px] backdrop-saturate-[300%]` — **dark mode blindspot**
- **Hardcoded shadow:** `shadow-[0_40px_100px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.8)]`

### UnifiedModal

File: `src/components/UnifiedModal.jsx`

Large orchestrator with 30+ type variants controlled by `type` string prop. `getModalSize()` maps type → `max-w-*`. All form modals use this component. Wraps ModalShell.

### ConfirmModal

File: `src/components/common/ConfirmModal.jsx`

Destructive / non-destructive confirmation. `createPortal` to body directly (bypasses ModalShell). `z-[99999]`. CSS transitions (no ModalShell). Ya no lee un prop `theme` — 100% tokens (`bg-surface-card-hover`, `text-content`, etc.), la nota de "dark mode blindspot" quedó stale y se corrigió (2026-07-25).

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

### 15.5 `TabBarAction` — acciones dentro de `ViewTabBar`

```jsx
<ViewTabBar … trailingActions={
    <TabBarAction icon={UserPlus} variant="primary" onClick={crear}>Nuevo</TabBarAction>
} />
```

Una sola primaria por barra; el resto `quiet`, con el color reducido al ícono.
Sin halo: `shadow-glow-*` se dibuja igual sobre fondo claro que oscuro, así que
en los temas sólidos no se ve luminoso sino sucio.

En táctil las acciones **no van en línea** — `ViewTabBar` las guarda tras un
botón y las abre en una hoja inferior. Sin eso, a 390px quedaban controles fuera
de la pantalla.

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

### 15.8 `FileField` — adjuntar un archivo

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

### 15.9 `LiquidTooltip` — nota al pasar el puntero

```jsx
<LiquidTooltip content="Se sincronizó hace 3 minutos" side="top">
    <span>⟳ Sync</span>
</LiquidTooltip>
```

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

---

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

### 16.2 Contador sobre un ícono

El único caso que se escribe inline, porque es **posición**, no estilo: el
contador vive pegado a la esquina de su ícono.

```jsx
<span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1
    bg-danger-solid text-white text-micro font-black
    rounded-full flex items-center justify-center border-2 border-surface-card">
  {n > 9 ? '9+' : n}
</span>
```

El `border-2 border-surface-card` no es decorativo: recorta el contador del
fondo que tenga detrás. Por eso va del color de la superficie, **no blanco fijo**
—en oscuro un borde blanco dibuja un halo—.

### 16.3 Punto de estado en vivo

```jsx
<span className="relative flex h-2 w-2">
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
  <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
</span>
```

`animate-ping` es decorativo: el tema sólido lo apaga solo, y también
`prefers-reduced-motion`.

---

## 16.9 Las dos píldoras de una vista — cuál es cuál (2026-07-27)

Una vista tiene **dos** contenedores en píldora, y confundirlos fue lo que me
hizo escribir mal §17. No son intercambiables:

| | píldora del **header** | píldora del **cuerpo** |
|---|---|---|
| canónico | **`ViewTabBar`** | **`FilterBar`** |
| qué lleva | pestañas de la vista + buscador global + acciones | los filtros que recortan los datos |
| dónde | fila del título, vía `filtersContent` | bajo el título, a la derecha |
| responde | *¿qué sección estoy viendo?* | *¿qué recorte de esa sección?* |

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
<FilterBar onClear={limpiar} activo={hayFiltro}>
    <FilterBar.Section><LiquidSelect value={suc} onChange={setSuc} options={sucs} /></FilterBar.Section>
    <FilterBar.Section><PeriodPicker value={rango} onChange={setRango} /></FilterBar.Section>
    <FilterBar.Section compact><SegmentedControl value={estado} onChange={setEstado} options={estados} /></FilterBar.Section>
</FilterBar>
```

**La píldora donde vive TODO el filtro de la vista actual** — fecha, categoría,
sucursal, estado. No es una decoración: es el lugar único donde el usuario mira
para saber qué está filtrando y para soltarlo.

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
    <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl
                    bg-warning/10 border border-warning/30 text-label text-warning font-semibold">
        <Search size={12} strokeWidth={2.5} className="shrink-0" />
        Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
    </div>
)}
```

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

Coverage gap: glass inputs carry `outline-none` in their className, which excludes them from this rule. Those inputs implement their own visual ring via `focus:shadow-[0_0_0_4px_rgba(0,82,204,0.15)]` — they have a visible indicator but it is not `focus-visible`-gated (fires on mouse click too). `.virtual-caret-blue/orange` inputs suppress the ring entirely via `:focus { outline: none }`.

### Touch targets

| Element | Padding | Computed height | Status |
|---|---|---|---|
| Nav top-level button | `px-3 py-3` + icon 20px | ≈ 44px | ✅ |
| Nav group header | `px-3 py-2.5` + icon 20px | ≈ 40px | ⚠️ borderline |
| Nav indented button | `px-2.5 py-2` + icon 16px | ≈ 36px | ❌ below 44px |
| Mobile bottom tab | `px-3 py-2` + icon 20px + label 9px | ≈ 45px | ✅ |
| Sidebar collapsed buttons | `w-11 h-11` = 44px | 44px | ✅ |

The 44px minimum follows WCAG 2.5.8 (AA, WCAG 2.2). Nav indented items do not meet it.

### ARIA

**Implemented:**
- `ModalShell` (`src/components/common/ModalShell.jsx`): `role="dialog"`, `aria-modal="true"`, `aria-label={ariaLabel}` ✅. **2026-07-15 update**: the `ariaLabel` prop existed but nothing ever passed it — every modal in the app announced as the generic default ("Ventana modal"), including `UnifiedModal` (the app's highest-traffic modal system, ~40 form types). Wired through `LiquidModal`'s new `ariaLabel` prop and set on all 9 real `<LiquidModal>`/`<ModalShell>` call sites with each modal's real title (`UnifiedModal` uses its existing `getModalTitle()`).
- `BranchHelpers` toggle (`src/components/forms/BranchHelpers.jsx:54`): `aria-pressed={on}` ✅
- `LiquidSelect` (`src/components/common/LiquidSelect.jsx`) — **2026-07-15**: full combobox/listbox pattern added — trigger gets `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls` (pointing to the open dropdown's `id`, via `useId()`), and `aria-activedescendant` (pointing to the keyboard-highlighted option); the dropdown gets `role="listbox"` + matching `id`; each option gets `role="option"` + `id` + `aria-selected`. One component, ~30+ usages across the app get this for free.
- Sidebar collapsible groups (`AppLayout.jsx`) — **2026-07-15**: group header button gets `aria-expanded`/`aria-controls`; submenu container gets the matching `id` (`nav-group-{key}`).
- `PortalInput` (`src/components/common/PortalInput.jsx`) — **2026-07-15**: the canonical shared text-input component (see house rule above the component) now sets `id`/`<label htmlFor>` association, `aria-required`, `aria-invalid`, and `aria-describedby` pointing to the inline "Requerido"/error badge. Only 4 files use it today (`EmployeeFormModal`, `PracticanteModal`) — fixing the shared component is what makes this correct by default for any future form that reuses it, per the existing house rule.

**Still missing** (out of scope for the 2026-07-15 pass — see `PLAN-EJECUCION-2026-07.md` Bloque 5.6):
- The large majority of the app's inputs are hand-rolled per-view (not `PortalInput`) and still lack `aria-invalid`/`aria-describedby` — fixing all of them individually is a much larger, view-by-view effort, not a single shared-component fix like the ones above.
- Glass inputs with `outline-none` still fall outside the global `focus-visible` rule (§ Focus visible above) — they have their own visible ring, but it isn't `focus-visible`-gated.

### prefers-reduced-motion

**Implemented** — `src/index.css` (block added before `@media print`).

**Disabled entirely** (infinite loops / large displacement):
`animate-ambient-drift`, `animate-ambient-drift-reverse`, `animate-shimmer`, `glow-danger`, `glow-warning`, `badge-pulse`, `animate-wiggle`, `animate-tab-enter-right/left`, `animate-tab-exit-right/left`, `animate-stagger-child`, `animate-input-reveal`, `animate-route-enter`, `animate-view-enter`. `will-change` also reset to `auto` for disabled classes.

**Reduced to `rm-fade-in` 120ms opacity-only:**
`animate-kpi-enter`, `animate-widget-enter`, `animate-widget-settle`, `animate-table-row-enter`.

**Skeleton** — animation stopped; background becomes a solid `rgba(148,163,184,0.15)`.

Hover lifts (`hover:-translate-y-*`) remain unaffected — they are already scoped to `@media (hover: hover)` which only fires on pointer devices.

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
<div className="flex items-center gap-3 text-danger-text
  bg-danger/10 backdrop-blur-sm px-4 py-3 rounded-2xl
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

Creating a parallel component that duplicates functionality is prohibited. Extend the existing one or open a design discussion first.

### Changelog

| Version | Date | Notes |
|---|---|---|
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

### Touch targets — 44×44px minimum (WCAG 2.5.8)

Applies to every `button`, `a[href]`, checkbox/radio, and any `[role="button"]`. This is now enforced in the two components nearly every view depends on:
- `ViewTabBar.jsx` — tab pills, search-open button, search-close button all `h-11` (44px) with `min-w-[44px]` on tab pills (short single-word labels like "General"/"RRHH" would otherwise fall under 44px in width even at 44px height).
- `AppLayout.jsx` — the header hamburger button uses the `p-3 -m-3` pattern (padding grows the hit area, negative margin cancels the visual shift) to hit 44px without changing the icon's rendered size or the header's layout.

**Update 2026-07-15 (Bloque 5.3, `PLAN-EJECUCION-2026-07.md`):** re-audited with Playwright (25 routes × 2 viewports, real viewport-intersection check). Fixed 36 real hit-box bugs across 24 files — mainly the 22 views duplicating `ViewTabBar`'s search-open/close button with the pre-Fase-4-fix size (`w-10 h-10 md:w-11 md:h-11`) instead of the already-fixed `w-11 h-11`, plus 7 Dashboard "Ver" links and a handful of standalone CTAs a few px short of 44 (`p-X -m-X` padding pattern where the element was a bare text/icon control, direct height bump where it was already a real pill/button).

**Known residual gaps, not fixed, deliberate trade-off** (same reasoning as the `PushPromptBanner` precedent below — re-verified 2026-07-15, still applies): filter/tab pills with visible text (TODOS/ARCHIVO/ACTIVOS/ANULADAS/etc., ~130 instances) are the established Filter Pill/Tab Bar Standard used everywhere in the app on purpose — resizing them to 44px tall would be a systemic redesign of that shared visual pattern, not a bug fix. Dense icon-button groups inside cards (e.g. RolesView's Editar/Eliminar/Ver Empleados, BranchesView's Copiar/Diagnóstico/Ver Perfil/Ajustes) were left alone because growing their invisible hit-box risks overlapping a neighbor's click zone (real mis-click risk, not mechanical to fix safely). Small fixed-size hover-reveal badge icons (Dashboard's "Cambiar tamaño", `ScheduleChart`'s "Expandir Análisis") have their box sized 1:1 with their visible circle, so enlarging the hit-box necessarily enlarges the visible badge — a visual character change, same class of decision as `PushPromptBanner`'s "Activar" button (deliberately compact, raising it to 44px would meaningfully change that banner's low-profile character). `LiquidSelect`'s internal clear (X) / chevron buttons were also left alone — they're secondary controls nested inside an already-44px trigger used in ~30+ places; changing their hit-box has high blast radius for uncertain benefit. Sidebar indented nav items (~36px) were already a known gap before this audit (§25).

### Inputs — 16px minimum font-size (iOS Safari zoom)

**This was the single highest-impact bug found in the Fase 4 audit.** Any `<input>`/`<textarea>` (excluding `checkbox/radio/range/color/file`) with a computed `font-size < 16px` triggers an automatic page zoom on focus in iOS Safari — jarring, and the user has to manually zoom back out every time. This was found on ~170 inputs across ~60 files (search boxes at 13px was the single most repeated instance, via both `ViewTabBar.jsx`'s shared search input and several views that hand-roll their own duplicate search input instead of using `ViewTabBar`). Fixed project-wide: every text-entry input's font-size floor is now `text-[16px]`. **Rule going forward: never set a text-entry input below `text-[16px]`, full stop** — there is no valid reason to go smaller, since 16px is also comfortably readable at any density this app ships at.

**Sin gate, esto vuelve a driftar** — re-auditado 2026-07-26 (grep estructural, no manual) y encontradas 11 instancias reales nuevas en 8 archivos (`FormRegisterPayment`, `FormAddCustomDocument`, `KioskConfigModal`, `EarlyExitForm`, `FacturacionView` ×3, `AttendanceMonitorView` ×2, `TabLaboratorios`) — todas corregidas. **Gated automáticamente** desde esa misma sesión (`gate:design`, categoría `small-input`) — cualquier `text-xs`/`text-sm`/`text-[Npx]` (N<16) en la línea de apertura de un `<input>`/`<textarea>` real falla el gate, excepto dentro de `placeholder:` (solo afecta al placeholder, no dispara el zoom — falso positivo real encontrado en `AuthPromptPanel.jsx`, un PIN gigante con placeholder chico aparte).

### Search pattern duplication (structural finding, not fixed)

Multiple views (`BranchesView`, `ConteoDetailView`, and others) hand-roll their own local copy of the floating search-pill + input instead of using the shared `ViewTabBar` component (see [[feedback_global_search_pattern]] — this is already a documented house rule being violated in practice). Every duplicate carries its own copy of whatever bugs `ViewTabBar` has (or had) independently. This audit patched the *symptom* (font-size, button size) in each duplicate found, but the *cause* (component duplication instead of reuse) is a larger refactor out of scope for a design-pass fix — flagged for a future consolidation pass. **2026-07-15 update:** the button-size symptom recurred — 22 files still had the pre-fix size (see Touch targets update above) — and was patched again. The *cause* is still open; the next view built with a hand-rolled search pill will carry the same bug forward until the consolidation refactor happens.

### Table → cards pattern

`DataTable` (§14) does not currently reflow into a card list on narrow viewports — it stays tabular with horizontal scroll/column hiding (`hideBelow` prop) as the primary narrow-viewport strategy. No separate card-list mobile variant exists. This was not flagged as broken in the audit (no horizontal page overflow was found on any of the 27 top-level routes checked, at either 390px or 768px — `hideBelow` columns keep tables usable), but it is worth noting as a design choice rather than an oversight: a true table→cards reflow was not built.

### Safe areas / gestures

No `env(safe-area-inset-*)` usage was found in the codebase. Given the app targets a native Capacitor shell (§21) as well as mobile web, notch/home-indicator safe-area handling is a gap for the native build specifically — not verified as broken (no physical-device test was performed in this audit, only Chromium viewport emulation), but also not confirmed handled. Flagged for verification on an actual device.

### Viewport meta

**Update 2026-07-15 (Bloque 5.7b):** the static `maximum-scale=1.0, user-scalable=no` in `index.html`'s `<meta name="viewport">` blocked pinch-zoom unconditionally — a real WCAG 1.4.4 (Resize Text) violation for anyone using the portal as a normal website. Resolved by making it conditional instead of choosing one side: a small inline script in `index.html` (runs synchronously before React mounts, so there's no flash of different zoom behavior) checks — native Capacitor build (`Capacitor.isNativePlatform()`), installed/standalone PWA (`display-mode: standalone` / `navigator.standalone`), or the `/kiosk` route — and only in those cases keeps `user-scalable=no`. Everywhere else (a regular browser tab, including on mobile) the meta tag is rewritten to drop `maximum-scale`/`user-scalable`, restoring full pinch-zoom. `viewport-fit=cover` is unaffected either way, and is correctly set up for safe-area CSS to work, once/if that's implemented (see above).

---
