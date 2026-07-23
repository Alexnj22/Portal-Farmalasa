# Portal Farmalasa — Design System

> **v1.0 — 2026-06-24**

## Cómo usar este doc

1. **Empieza por §3 (Tokens)** — todo valor visual nace ahí. Si quieres cambiar un color o blur, cámbialo en `:root` de `src/index.css`, no en el componente.
2. **Antes de crear un componente nuevo**, revisa §13–§14 (Componentes). Si uno existente puede extenderse, extiéndelo. Prohibido duplicar modales fuera de ModalShell/UnifiedModal ni selects fuera de LiquidSelect.
3. **Toda UI nueva debe pasar §24 Anti-Patterns** antes de mergearse.
4. **Los tokens viven en `src/index.css`**; los keyframes también en `src/index.css` (no existe `tailwind.config.js` desde la Fase T1, 2026-07-23 — ver §11); la lógica de tema en `src/context/ThemeContext.jsx`.

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

Four named themes, controlled by `data-theme` on `<html>`. The default (Liquid Light) has no attribute.

| Theme key | `data-theme` | Description |
|---|---|---|
| `liquid` | *(none)* | LiquidGlass Light — default |
| `dark` | `dark` | LiquidGlass Dark |
| `solid` | `solid` | Solid Light — no blur |
| `solid-dark` | `solid-dark` | Solid Dark — no blur |

**ThemeContext** (`src/context/ThemeContext.jsx`) persists choice to `localStorage` under key `portal-theme`.
Exposes `{ theme, setTheme, cycleTheme, isDark, isSolid, isLiquid, themes }`.
`cycleTheme` rotates through all four in order: liquid → dark → solid → solid-dark → liquid.

**ThemeToggle** (`src/components/common/ThemeToggle.jsx`) has two variants:
- `'sidebar'` — full label + sub-label row inside sidebar footer
- `'compact'` — icon-only square button

Icons: Layers (liquid) · Moon (dark) · Sun (solid) · Monitor (solid-dark).

---

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
--text-tertiary  : #64748b   (slate-500)
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
```
--card-shadow            : inset 0 1px 0 rgba(255,255,255,0.85), 0 8px 32px rgba(0,0,0,0.07)
--card-shadow-hover       : inset 0 1px 0 rgba(255,255,255,0.90), 0 16px 40px rgba(0,0,0,0.10)
--header-shadow           : 0 24px 50px -12px rgba(0,0,0,0.18)
--modal-shadow            : 0 32px 80px rgba(0,0,0,0.18), inset 0 2px 0 rgba(255,255,255,0.95)
--btn-brand-shadow        : 0 4px 14px rgba(0,82,204,0.28)
--btn-brand-shadow-hover  : 0 8px 20px rgba(0,82,204,0.40)
```

### Semantic color tokens (index.css `:root`)
```
--brand:        #0052CC
--brand-dark:   #003D99
--brand-purple: #6929C4
--success: #12B76A   ← used as KpiCard color prop in DashboardView; NOT a Tailwind emerald shade
--warning: #F79009
--danger:  #F04438
```
These are defined but consumed mostly as inline hex strings (e.g. `color="#12B76A"` on KpiCard). For badges and text, prefer the Tailwind semantic classes (`text-emerald-600`, `text-amber-600`, `text-red-600`) which visually match these values — until the T4 codemod migrates them to `text-success`/`text-warning`/`text-danger` (ya disponibles desde T1, ver §3.1).

### Focus ring, scrim, divisor (net-new, Fase T1)
Antes hardcodeados en cada punto de consumo — ahora son tokens únicos:
```
--focus-ring-color: rgba(0,82,204,0.55)   ← usado en la regla global :focus-visible (index.css)
--scrim:            rgba(3,11,28,0.50)    ← overlay de sidebar móvil (hoy AppLayout.jsx usa bg-[#030B1C]/50 hardcodeado — mismo valor, consumo pendiente T3)
--divider:          rgba(203,213,225,0.5) ← ~13 archivos repiten variantes de esto para el patrón `w-px h-N` (consumo pendiente T3/T4)
```

### Paleta dataviz (net-new, Fase T1)

**Categórica (6)** — hoy cada vista define su propio set de colores ad hoc (`MetasView.jsx` por sucursal, `AbcXyzMatrix.jsx` para ABC/XYZ). Tokenizados a partir de los colores ya más usados en ese rol; consumo real (wrapper de charts compartido) es T4:
```
--chart-1: #3b82f6   --chart-2: #10b981   --chart-3: #8b5cf6
--chart-4: #f97316   --chart-5: #06b6d4   --chart-6: #ec4899
```

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
- `--bg-page`: deep navy/purple gradient
- `--surface-card`: `rgba(20,30,70,0.50)`, `--surface-modal`: `rgba(18,26,62,0.90)`
- `--text-primary`: `rgba(255,255,255,0.92)`, secondary/tertiary: white at lower opacity
- Radii NO se redefinen (heredan de `:root`); solo sombras/superficies/bordes/texto/fondo cambian.

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

Ningún componente consume estas utilidades todavía (Fase T1 es solo infraestructura); la migración vista-por-vista es T3/T4 del plan de `AUDITORIA-TEMA-2026-07.md`.

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
| `dropdown` | LiquidSelect portal dropdown | `--surface-dropdown`. Border/shadow/radio/backdrop reusan los de `card` (`--border-card`, `--modal-shadow`, `--card-radius`, `--backdrop-card`) — no tiene tokens propios pese a lo que sugeriría el nombre; pendiente de decisión en T2/T3 si se le dan tokens dedicados. |
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
| Primary blue | `#0052CC` | CTA buttons, active states, brand accents |
| Dark blue | `#003D99` | Button hover |
| Violet-indigo gradient | `from-[#0052CC] to-[#6929C4]` | Icon squircles, accent elements |
| Active nav glow | `from-violet-500/22 via-indigo-400/14 to-blue-500/8` | Sidebar active pill |
| Sidebar accent bar | `from-violet-300 via-indigo-400 to-blue-400` | Active nav item accent |

### Semantic (applied as text / icon colors — never as card/row backgrounds)
| Role | Colors | Usage |
|---|---|---|
| Success | `text-emerald-500/600/700` | Confirmed, paid, positive delta |
| Error / Danger | `text-red-500/600/700` | Lost sales, errors, critical |
| Warning | `text-amber-500/600/700` | Pending, approaching threshold |
| Info | `text-blue-500/600/700` or `text-[#0052CC]` | Secondary brand info |
| Indigo accent | `text-indigo-400/500/600/700` | Charts, secondary accents |

### Sidebar palette (always dark regardless of theme)
- Background: `bg-[#07031a]/80`
- Nav text inactive: `text-white/60`
- Nav text active: `text-white`
- Group icon active: `text-violet-200 scale-110`
- Group icon inactive: `text-white/42`
- Accent bar gradient: `from-violet-300 via-indigo-400 to-blue-400`

---

## 7. Typography

Font stack: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`. No web fonts loaded. Set on `html` and via Tailwind `font-sans`.

### Scale

| Role | Size | Weight | Example |
|---|---|---|---|
| View title (desktop) | 24–28px | `font-semibold` | `text-[24px] xl:text-[26px] 2xl:text-[28px] font-semibold tracking-tight` |
| View title (mobile) | 16px | `font-bold` | `text-[16px] font-bold tracking-tight truncate` |
| Section heading / modal title | 18–20px | `font-black` | `text-[18px] sm:text-[20px] font-black uppercase tracking-tight` |
| Nav label | 12–13px | `font-medium` / `font-semibold` (active) | `text-[12px] xl:text-[13px]` |
| Table cell / body | 13px | `font-medium` | `text-[13px] font-medium` |
| Label / caption | 11–12px | `font-semibold` | `text-[11px] font-semibold` |
| Badge / pill | 9–11px | `font-black uppercase tracking-widest` | `text-[10px] font-black uppercase tracking-widest` |
| PIN / code | 12px | `font-black tracking-widest font-mono` | `text-[12px] font-black tracking-widest font-mono` |
| Button label | 11–13px | `font-black uppercase tracking-widest` | `text-[11px] font-black uppercase tracking-widest` |
| Dato numérico | Ídem su contexto (tabla/KPI/badge) | — | Siempre + `tabular-nums`. Ya es el estándar de facto (229 usos en 47 archivos, verificado 2026-07-23) — no un gap, documentar para que se mantenga al migrar a tokens en T4. |

**Conventions:**
- All-caps labels always use `uppercase tracking-widest font-black`.
- Never `font-normal` in interactive UI — minimum `font-medium`.
- Minimum contrast on glass: `text-slate-600` for labels, `text-slate-500` for secondary text.
- **`tabular-nums` obligatorio en toda columna/celda numérica** (montos, conteos, porcentajes) — evita el "jitter" de anchos variables por dígito. Ya es la práctica real dominante, no una regla nueva.

---

## 8. Border Radius Scale

Values in use across the codebase (pixel-equivalent approximate):

| ~px | Value | Used on |
|---|---|---|
| ~11px | `rounded-[0.7rem]` | Icon inner containers (ThemeToggle) |
| ~14px | `rounded-[0.875rem]` | Nav item buttons, small controls |
| ~16px | `rounded-[1rem]` | Nav group headers |
| ~19px | `rounded-[1.2rem]` | Modal icon squircles (ConfirmModal) |
| ~20px | `rounded-[1.25rem]` | Logo container, filter pills, dropdown |
| ~24px | `rounded-[1.5rem]` | GlassViewLayout body, buttons in login |
| ~28px | `rounded-[1.75rem]` | Stat cards, widget cards |
| ~32px | `rounded-[2rem]` | AlertModal, ConfirmModal |
| ~40px | `rounded-[2.5rem]` | Sidebar, page header, UnifiedModal |
| pill | `rounded-full` | Badges, dot indicators, ambient orbs |

`rounded-glass`/`rounded-glassMd`/`shadow-glass`/`shadow-glassSm`/`backdrop-blur-glass` (antes en `tailwind.config.js`) se eliminaron en la Fase T1 (2026-07-23): confirmado con grep que ninguna vista los consume — código muerto, no una utilidad viva que migrar.

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
  <span className="absolute top-0 bottom-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-white/[0.16] to-transparent
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
<div className="bg-gradient-to-tr from-[#0052CC] to-[#6929C4] rounded-2xl
                shadow-[0_4px_12px_rgba(0,82,204,0.25)] p-2.5
                flex items-center justify-center">
  <Icon className="text-white" size={20} strokeWidth={1.5} />
</div>

// Mobile
<div className="bg-gradient-to-tr from-[#0052CC] to-[#6929C4] rounded-xl
                shadow-[0_4px_12px_rgba(0,82,204,0.3)] p-2 flex-shrink-0
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

**Pill surface:** `bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%]` — **hardcoded, dark mode blindspot.**

**Tab states:** Active: `bg-white text-slate-800`. Inactive: `bg-transparent text-slate-500`.

**Search pattern:** Search button (hardcoded `bg-[#0052CC]`) expands an input via `isSearchMode` state. Close via `ChevronRight`. Never add local search inputs inside tab components — search lives here only.

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

Destructive / non-destructive confirmation. `createPortal` to body directly (bypasses ModalShell). `z-[99999]`. CSS transitions (no ModalShell). Reads `theme` prop — **dark mode blindspot**.

Props: `isOpen`, `onClose`, `onConfirm`, `title`, `message`, `confirmText`, `cancelText`, `isDestructive` (default `true`), `isProcessing`, `theme` (`'light'|'dark'`).

Processing state: replaces text with spinner, hides cancel button.

### AlertModal

File: `src/components/common/AlertModal.jsx`

Single-button info/success/error. Uses ModalShell. `z-[9999]`. Reads `theme` prop — **dark mode blindspot**.

Props: `isOpen`, `onClose`, `title`, `message`, `type` (`'success'|'error'|'info'`), `buttonText`, `theme`.

Type determines icon (CheckCircle2 / AlertCircle / Info), glow color, button color.

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

## 15. Buttons

No shared button component — patterns are inline.

### Primary CTA (blue gradient)
```jsx
className={`relative overflow-hidden group
  bg-gradient-to-b from-[#0052CC]/72 to-[#003D99]/78
  backdrop-blur-xl
  border border-white/22 hover:border-white/36
  text-white rounded-[1.5rem]
  font-black text-[13px] uppercase tracking-widest
  shadow-[0_6px_22px_rgba(0,82,204,0.28),inset_0_1px_0_rgba(255,255,255,0.18)]
  hover:shadow-[0_12px_36px_rgba(0,82,204,0.44),inset_0_1px_0_rgba(255,255,255,0.24)]
  flex items-center justify-center gap-2
  transition-all duration-200 active:scale-[0.97]
  disabled:opacity-55 disabled:shadow-none disabled:cursor-not-allowed`}
```
Always include the shimmer `<span>` overlay (see §11 Shimmer sweep).

### Secondary / ghost
```
text-slate-600 bg-white border-slate-200 hover:bg-slate-50 hover:-translate-y-0.5 shadow-sm rounded-xl
font-black text-[11px] uppercase tracking-widest
```

### Destructive
```
bg-red-500 hover:bg-red-600 shadow-[0_4px_15px_rgba(239,68,68,0.3)] text-white rounded-2xl
font-black text-[11px] uppercase tracking-widest
```

### Nav item (inactive state)
```
text-white/60 hover:text-white/95 hover:bg-white/[0.08] hover:-translate-y-[1px]
hover:shadow-[0_4px_16px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.08)]
active:scale-[0.99] active:translate-y-0
```

All interactive elements: `transition-all duration-200` or `transition-[specific,props] duration-150/200`.

---

## 16. Badges & Notification Indicators

### Notification count badge
```jsx
<span className="min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-black
                 rounded-full flex items-center justify-center">
  {count > 9 ? '9+' : count}
</span>
```

### Alert dot (pulsing)
```jsx
<span className="relative flex h-2 w-2">
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
</span>
```

### Live indicator (on view icon, larger)
```jsx
<span className="absolute -top-1 -right-1 flex h-3 w-3">
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-white" />
</span>
```

### "Próximamente" badge (nav items)
```
text-[9px] font-black uppercase tracking-wider text-amber-600/70
bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full
```

### Semantic status badge
```jsx
// Success
"px-2.5 py-0.5 bg-emerald-500/10 text-emerald-700 border border-emerald-500/25 rounded-full text-[10px] font-bold"
// Warning
"px-2.5 py-0.5 bg-amber-500/10 text-amber-700 border border-amber-500/25 rounded-full text-[10px] font-bold"
// Error
"px-2.5 py-0.5 bg-red-500/10 text-red-700 border border-red-500/25 rounded-full text-[10px] font-bold"
// Info / brand
"px-2.5 py-0.5 bg-[#0052CC]/10 text-[#0052CC] border border-[#0052CC]/25 rounded-full text-[10px] font-bold"
```

---

## 17. Filter Pills

All view-level filters live in a pill container, never as loose controls scattered in the content body.

**Standard pill anatomy:**
```
rounded-2xl bg-white/80 border border-slate-200/70
```
Dividers between filter controls: `h-5 w-px bg-slate-100`.

**Placement: body, not header.** The filter pill renders in the view **body**, in the same row as the stat cards — stat cards in a `flex-1 min-w-0` group on the left, filter pill `shrink-0` on the right:
```jsx
<div className="flex items-start gap-3 flex-wrap">
  <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
    {/* stat cards */}
  </div>
  <div className="rounded-2xl bg-white/80 border border-slate-200/70 ... shrink-0">
    {/* branch select, period picker, toggles, individual clear buttons */}
  </div>
</div>
```
`GlassViewLayout`'s `filtersContent` prop is a **different** slot — it renders in the page header (right slot on desktop, below the mobile title) and is reserved for the search toggle, tab buttons, and primary actions (export, "Nuevo X"), not for the filter pill itself. Do not put branch/period/status filters there.

Reference implementation: `VentasView` — see `FilterControls` (`src/views/VentasView.jsx:118`), rendered inline in each tab body (`TabVentas`/`TabVendedores`/`TabProductos`) immediately after the stat cards row, never passed through `filtersContent`. Same pattern in the Productos tabs (`TabInventario`, `TabCatalogo`, `TabSinVenta`) and `StaffManagementView`.

---

## 18. Empty States

Required on every view or tab that can have zero data. Standard Glassmorphism pattern:

```
glass squircle icon + bold title + sub-title
```

**Glass squircle:**
```
w-16 h-16 rounded-[1.5rem] bg-white/50 border border-white/80
shadow-[0_8px_30px_rgba(0,0,0,0.06),inset_0_2px_10px_rgba(255,255,255,0.9)]
flex items-center justify-center mb-6
```
Icon inside: `size={32}` Lucide icon in semantic color.

**Title:** `font-black text-slate-700 text-[20px] uppercase tracking-tight mb-2`
**Subtitle:** `text-slate-500 text-[13px] font-medium leading-relaxed text-center`

Optional action button below subtitle.

DataTable provides `empty` prop: `{ icon: LucideIcon, message: string }` — renders inline in table body.

---

## 19. Loading & Skeleton States

**Skeleton shimmer:** CSS class `.skeleton` defined in `src/index.css`. Applied to placeholder `div` with estimated dimensions. Used in stat cards, table rows.

```jsx
// Stat card skeleton
<div className="w-6 h-6 rounded-lg skeleton shrink-0" />
<div className="h-3 skeleton" style={{ width: estimatedWidth * 0.45 }} />
```

**Inline spinner (action buttons):**
```jsx
<Loader2 size={16} strokeWidth={2.5} className="animate-spin shrink-0" />
```
Use only inside buttons during async processing. Never center a full-page spinner.

DataTable: `loading` prop + `skeletonRows` prop renders shimmer rows in table body.

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

## 22. Known Dark Mode Blindspots

Components that hardcode light-only values or read a manually-passed `theme` prop instead of consuming CSS vars from ThemeContext. These do not automatically respond to `[data-theme="dark"]`:

| Component | Blindspot |
|---|---|
| `LiquidModal` inner glass layer | `bg-white/50 backdrop-blur-[15px] backdrop-saturate-[300%]` hardcoded |
| `LiquidModal` shadow | Hardcoded light shadow |
| `DataTable` `useTokens()` hook | All values hardcoded — entire table ignores theme |
| `LiquidToast` | Reads `theme` from `toastStore`, not ThemeContext |
| `LiquidSelect` | `isDark` is caller-provided via `theme` prop |
| `AlertModal` | `theme` prop → manual `isDark = theme === 'dark'` |
| `ConfirmModal` | `theme` prop → manual `isDark = theme === 'dark'` |
| `ViewTabBar` pill | `bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%]` hardcoded |
| `GlassViewLayout` body card | Hardcoded Tailwind classes, not `[data-surface="card"]` CSS var |

These are the next wave of work to complete dark mode coverage.

---

## 23. Known Inconsistencies

1. **Framer-motion** — present in 14 files. Standard is CSS keyframes + Tailwind transitions. No new framer-motion usage. Existing usages are noted per-component above.

2. **Dark mode blindspots** — listed in §22. Migration path: replace `theme` prop logic with CSS custom property consumption everywhere.

3. **GlassViewLayout body card** — uses hardcoded `bg-white/[0.12] backdrop-blur-[44px]` instead of `[data-surface="card"]`. Should adopt the attribute selector.

4. **ConfirmModal / AlertModal scroll lock** — both have own `document.body.style.overflow = 'hidden'` logic separate from ModalShell's scroll lock. Two scroll-lock paths exist. Acceptable given their `z-[99999]` requirement but worth unifying.

5. **Sidebar always dark** — `data-surface="sidebar"` intentionally deviates from the theme system. The sidebar is always dark glass regardless of app theme. By design.

6. **Hardcoded `#0052CC`** — brand blue appears as literal hex throughout. Should eventually become `--color-brand` CSS variable.

7. **Three validation error patterns coexist** — inline text (FormSetPassword), "Requerido" glow badge next to label (BranchTabInmueble), and banner with AlertCircle (FormRegisterPayment). The standard defined in §28 is: inline text under the field + global banner. The glow badge is deprecated.

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
Input:  rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm
        text-slate-700 placeholder:text-slate-400
        focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 focus:bg-white
Ícono:  <Search> text-[#0052CC] strokeWidth={2.5}  — izquierda
Clear:  <X>     hover:text-red-500 strokeWidth={2.5} — aparece solo cuando value truthy
```

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
                    bg-amber-50 border border-amber-200 text-[11px] text-amber-700 font-semibold">
        <Search size={12} strokeWidth={2.5} className="shrink-0" />
        Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
    </div>
)}
```

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

### Input patterns

Two distinct input styles exist in the codebase depending on context:

**Glass input** — used inside `LiquidModal` / glass card contexts:
```jsx
// Reference: src/components/forms/BranchHelpers.jsx:155
className="w-full py-3.5
  bg-white/50 border border-white/60 rounded-[1.25rem]
  text-[13px] font-bold text-slate-700 placeholder-slate-400
  outline-none transition-all duration-300
  shadow-[inset_0_2px_10px_rgba(255,255,255,0.5)]
  focus:bg-white focus:border-[#0052CC]/30
  focus:shadow-[0_0_0_4px_rgba(0,82,204,0.15)]"
```

**Solid input** — used in standalone forms or white-background contexts:
```jsx
// Reference: src/components/forms/FormSetPassword.jsx:78
className="w-full h-[44px] pl-10 pr-4
  bg-white border border-slate-200/80 rounded-[1rem]
  text-[13px] font-bold text-slate-700 outline-none
  transition-all hover:border-[#0052CC]/30
  focus:ring-4 focus:ring-[#0052CC]/10 focus:border-[#0052CC]/50"
```

Both patterns:
- Minimum height 44px (solid) / `py-3.5` ≈ 44px (glass)
- `font-bold text-[13px]` on value text
- `placeholder-slate-400` on placeholder
- `outline-none` with custom focus ring

### Disabled state

Buttons: `disabled:bg-slate-300 disabled:opacity-55 disabled:shadow-none disabled:cursor-not-allowed`
Inputs: `disabled:bg-slate-50 disabled:opacity-50`

### Validation error standard

Three patterns coexist in the codebase today (inconsistency documented in §23 item 7). The defined standard going forward:

**(a) Inline field error** — appears below the field, shown when a field-level rule fails:
```jsx
<p className="text-[11px] font-black text-red-600 mt-1">
  {fieldError}
</p>
```
Must be paired with `aria-invalid="true"` on the input and `aria-describedby` pointing to the error element's `id`.

**(b) Global / submit banner** — appears above the submit button, shown for server errors or cross-field validation failures:
```jsx
// Reference: src/components/forms/FormRegisterPayment.jsx:185
<div className="flex items-center gap-3 text-red-700
  bg-red-50/80 backdrop-blur-sm px-4 py-3 rounded-2xl
  border border-red-200 shadow-[0_4px_15px_rgba(239,68,68,0.1)]
  animate-in fade-in slide-in-from-top-2">
  <AlertCircle size={18} className="shrink-0 text-red-500" strokeWidth={2.5} />
  <span className="text-[12px] font-bold">{globalError}</span>
</div>
```

**(c) Required field indicator** — asterisk `*` in the label, never a glow badge:
```jsx
<label className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
  Nombre del Arrendador *
</label>
```

**Deprecated:** the inline "Requerido" badge with `shadow-[0_0_8px_rgba(239,68,68,0.5)]` next to labels (currently in `src/components/forms/BranchTabInmueble.jsx:75–133`). Use asterisk in label + inline error text instead.

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
| v1.0 | 2026-06-24 | Initial audit — Phases A, B, C complete. 4-theme architecture, full component inventory, accessibility/performance/cross-browser audit. |
| v1.1 | 2026-07-10 | Fase 4 design/UX audit (`AUDITORIA-2026-07.md`). Added §32 Mobile & Responsive Standard (did not exist before). Fixed project-wide: `active:scale-90/95` → `active:scale-[0.97]` (§31 compliance, ~300 sites), input font-size floor 16px (~170 inputs, iOS zoom fix), touch targets in `ViewTabBar`/`AppLayout` header to 44px, 9 native `<select>` → `LiquidSelect` swaps. Found but NOT fixed (documented only, too large/risky for a mechanical pass): ~1,288 `text-slate-300/400`-on-light-surface contrast violations across 127 files. |
| v1.2 | 2026-07-23 | Fase T1 de `AUDITORIA-TEMA-2026-07.md` — puente Tailwind v4 (`@theme inline` en `index.css`): tokens de color/radio/sombra existentes ahora son utilidades reales (`bg-surface-card`, `text-content-2`, `rounded-card`, `shadow-modal`, `bg-brand`…). Renombrados los primitivos crudos de radio/sombra (`--radius-card`→`--card-radius` etc.) para evitar autorreferencia circular con el namespace de Tailwind. Tokens net-new: focus-ring, scrim, divisor, paleta dataviz categórica (6), semáforo de riesgo de stock (7 estados reales de `tabminmax/constants.js`, corrige la mención errónea de "MUERTA/NORMAL/PICO/CRÍTICA" — ese es en realidad un semáforo *distinto*, de volumen de transacciones/hora en `DashboardView.jsx`, también tokenizado ahora). Z-index canónico (16 clases) vía `@utility` (Tailwind v4 no tiene namespace `@theme` para z-index). Corregidos de paso: `tailwind.config.js` estaba muerto (el proyecto usa `@tailwindcss/postcss` sin `@config` — confirmado porque Tailwind escaneaba el repo completo, no solo `src/`, incluyendo strings de archivos `.md`); sus 3 animaciones realmente usadas (`wiggle`, `kpi-enter`, `widget-settle`) no generaban NINGÚN CSS en producción (bug silencioso pre-existente en `NotificationBell`/`DashboardView`) — migradas a `@keyframes` nativos en `index.css`, archivo eliminado. `App.jsx:529/545` (`bg-[#E6F0FF]` hardcodeado, rompía dark/solid) → `bg-surface-page`; `AppLayout.jsx:710` scrim hardcodeado → `bg-scrim` (ambos same-value, cero cambio visual, corregidos de inmediato en vez de diferirse a T3 — ver `feedback_fix_violations_immediately` en memoria). §5, §9, §11 corregidos para reflejar el CSS real (tokens de `dropdown`/`input`/`tab-track` que no existían, keyframes fantasma). Cero componentes/vistas migrados a las nuevas utilidades — eso es T3/T4. |

---

## 31. Anti-Patterns (Never Do)

- Left-border color indicators (`border-l-4 border-red-500`) on rows, cards, or lists.
- `transition-all` — use specific property transitions. Excepción válida: animaciones multi-propiedad sin shorthand CSS (ej. search expand en ViewTabBar) pueden usar `transition-all`.
- `active:scale-90/95` — minimum `active:scale-[0.97]`.
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

Single breakpoint: Tailwind `md:` (768px). Below it = phone layout; at/above it = tablet/desktop. There is no separate `sm:`/`lg:` tier for layout decisions — `sm:` is used only for minor spacing/type-size nudges, never for structural layout switches. Audited viewports: **390×844** (phone) and **768×1024** (tablet).

### Touch targets — 44×44px minimum (WCAG 2.5.8)

Applies to every `button`, `a[href]`, checkbox/radio, and any `[role="button"]`. This is now enforced in the two components nearly every view depends on:
- `ViewTabBar.jsx` — tab pills, search-open button, search-close button all `h-11` (44px) with `min-w-[44px]` on tab pills (short single-word labels like "General"/"RRHH" would otherwise fall under 44px in width even at 44px height).
- `AppLayout.jsx` — the header hamburger button uses the `p-3 -m-3` pattern (padding grows the hit area, negative margin cancels the visual shift) to hit 44px without changing the icon's rendered size or the header's layout.

**Update 2026-07-15 (Bloque 5.3, `PLAN-EJECUCION-2026-07.md`):** re-audited with Playwright (25 routes × 2 viewports, real viewport-intersection check). Fixed 36 real hit-box bugs across 24 files — mainly the 22 views duplicating `ViewTabBar`'s search-open/close button with the pre-Fase-4-fix size (`w-10 h-10 md:w-11 md:h-11`) instead of the already-fixed `w-11 h-11`, plus 7 Dashboard "Ver" links and a handful of standalone CTAs a few px short of 44 (`p-X -m-X` padding pattern where the element was a bare text/icon control, direct height bump where it was already a real pill/button).

**Known residual gaps, not fixed, deliberate trade-off** (same reasoning as the `PushPromptBanner` precedent below — re-verified 2026-07-15, still applies): filter/tab pills with visible text (TODOS/ARCHIVO/ACTIVOS/ANULADAS/etc., ~130 instances) are the established Filter Pill/Tab Bar Standard used everywhere in the app on purpose — resizing them to 44px tall would be a systemic redesign of that shared visual pattern, not a bug fix. Dense icon-button groups inside cards (e.g. RolesView's Editar/Eliminar/Ver Empleados, BranchesView's Copiar/Diagnóstico/Ver Perfil/Ajustes) were left alone because growing their invisible hit-box risks overlapping a neighbor's click zone (real mis-click risk, not mechanical to fix safely). Small fixed-size hover-reveal badge icons (Dashboard's "Cambiar tamaño", `ScheduleChart`'s "Expandir Análisis") have their box sized 1:1 with their visible circle, so enlarging the hit-box necessarily enlarges the visible badge — a visual character change, same class of decision as `PushPromptBanner`'s "Activar" button (deliberately compact, raising it to 44px would meaningfully change that banner's low-profile character). `LiquidSelect`'s internal clear (X) / chevron buttons were also left alone — they're secondary controls nested inside an already-44px trigger used in ~30+ places; changing their hit-box has high blast radius for uncertain benefit. Sidebar indented nav items (~36px) were already a known gap before this audit (§25).

### Inputs — 16px minimum font-size (iOS Safari zoom)

**This was the single highest-impact bug found in the Fase 4 audit.** Any `<input>`/`<textarea>` (excluding `checkbox/radio/range/color/file`) with a computed `font-size < 16px` triggers an automatic page zoom on focus in iOS Safari — jarring, and the user has to manually zoom back out every time. This was found on ~170 inputs across ~60 files (search boxes at 13px was the single most repeated instance, via both `ViewTabBar.jsx`'s shared search input and several views that hand-roll their own duplicate search input instead of using `ViewTabBar`). Fixed project-wide: every text-entry input's font-size floor is now `text-[16px]`. **Rule going forward: never set a text-entry input below `text-[16px]`, full stop** — there is no valid reason to go smaller, since 16px is also comfortably readable at any density this app ships at.

### Search pattern duplication (structural finding, not fixed)

Multiple views (`BranchesView`, `ConteoDetailView`, and others) hand-roll their own local copy of the floating search-pill + input instead of using the shared `ViewTabBar` component (see [[feedback_global_search_pattern]] — this is already a documented house rule being violated in practice). Every duplicate carries its own copy of whatever bugs `ViewTabBar` has (or had) independently. This audit patched the *symptom* (font-size, button size) in each duplicate found, but the *cause* (component duplication instead of reuse) is a larger refactor out of scope for a design-pass fix — flagged for a future consolidation pass. **2026-07-15 update:** the button-size symptom recurred — 22 files still had the pre-fix size (see Touch targets update above) — and was patched again. The *cause* is still open; the next view built with a hand-rolled search pill will carry the same bug forward until the consolidation refactor happens.

### Table → cards pattern

`DataTable` (§14) does not currently reflow into a card list on narrow viewports — it stays tabular with horizontal scroll/column hiding (`hideBelow` prop) as the primary narrow-viewport strategy. No separate card-list mobile variant exists. This was not flagged as broken in the audit (no horizontal page overflow was found on any of the 27 top-level routes checked, at either 390px or 768px — `hideBelow` columns keep tables usable), but it is worth noting as a design choice rather than an oversight: a true table→cards reflow was not built.

### Safe areas / gestures

No `env(safe-area-inset-*)` usage was found in the codebase. Given the app targets a native Capacitor shell (§21) as well as mobile web, notch/home-indicator safe-area handling is a gap for the native build specifically — not verified as broken (no physical-device test was performed in this audit, only Chromium viewport emulation), but also not confirmed handled. Flagged for verification on an actual device.

### Viewport meta

**Update 2026-07-15 (Bloque 5.7b):** the static `maximum-scale=1.0, user-scalable=no` in `index.html`'s `<meta name="viewport">` blocked pinch-zoom unconditionally — a real WCAG 1.4.4 (Resize Text) violation for anyone using the portal as a normal website. Resolved by making it conditional instead of choosing one side: a small inline script in `index.html` (runs synchronously before React mounts, so there's no flash of different zoom behavior) checks — native Capacitor build (`Capacitor.isNativePlatform()`), installed/standalone PWA (`display-mode: standalone` / `navigator.standalone`), or the `/kiosk` route — and only in those cases keeps `user-scalable=no`. Everywhere else (a regular browser tab, including on mobile) the meta tag is rewritten to drop `maximum-scale`/`user-scalable`, restoring full pinch-zoom. `viewport-fit=cover` is unaffected either way, and is correctly set up for safe-area CSS to work, once/if that's implemented (see above).

---
