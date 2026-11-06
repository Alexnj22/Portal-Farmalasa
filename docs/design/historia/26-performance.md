# Performance, navegadores y estados de página — historia

> Historia de DESIGN.md §26–28. Copia fiel del texto que vivía en DESIGN.md hasta el 2026-11-06, cuando el documento se condensó: allá quedaron la regla, el canónico, un ejemplo corto y el gate; acá, las mediciones y los incidentes que explican por qué. Las citas a líneas de código y los números de sección son los de ESA época (la Voz era §26, hoy §34).

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
