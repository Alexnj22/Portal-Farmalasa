---
name: UI Design Standards — Portal Farmalasa
description: Visual design standards for all modules — filter bars, stat cards, tables, headers, color palette
type: feedback
---

## Filter Bar Standard (Ventas pattern — use everywhere)

### Architecture rule: filter state lives in the VIEW, renders in `filtersContent`

Filter state must be lifted to the **View-level component** (e.g. `ProductosView`, `VentasView`) and passed as `filtersContent` to `GlassViewLayout` so it renders in the **floating header** — NOT inside the tab/body component. The body component receives filter values as **props**.

- `VentasView` → `FilterControls` component passed as `filtersContent`
- `ProductosView` → filter pill built inline, passed as `filtersContent`, filter state lifted out of `TabCatalogo`

### Filter pill JSX (exact class string):

```jsx
<div className="group flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 shrink-0 overflow-visible">
    {/* Sections separated by: */}
    <div className="h-5 w-px bg-slate-100 shrink-0" />
</div>
```

- **Filter pill is `hidden lg:flex`** — only visible on desktop. Mobile gets the stats/content without the filter pill in the header.
- Use **`LiquidSelect`** (`src/components/common/LiquidSelect.jsx`) for ALL dropdowns — never native `<select>`
- Each filter section gets its own individual **X clear button**: `w-[18px] h-[18px] rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white`
- Add a **global "clear all"** button (red circle X) only when any filter is non-default
- Sections separated by `h-5 w-px bg-slate-100` dividers
- Dynamic width for LiquidSelect: `Math.max(150, Math.min(260, 90 + label.length * 7))`

### What stays in the body (not the header):
- **Stat cards** (e.g. "Pérdida N / Margen bajo N") — these are content-level metric cards that also act as filters. They stay in the body of the tab component.
- Sortable column headers — in the table, not the header.

**Why:** User explicitly said filters must be in the same position as Ventas — in the floating glass header. Filters inside the body content area break the standard.

**How to apply:** Before implementing any filter bar in a new module, look at `ProductosView.jsx` (filter pill pattern) and `VentasView.jsx` lines 110–173. Import `LiquidSelect` from `src/components/common/`.

---

## Stat Cards Standard

Large metric cards shown above the table, used as clickable filters. Pattern from `VentasView`:

```jsx
// Card container
<button className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[160px] ...">
    {/* Icon square */}
    <div className="w-9 h-9 rounded-xl flex items-center justify-center ...">
        <Icon size={15} />
    </div>
    {/* Numbers + label */}
    <div className="text-left">
        <div className="text-[22px] font-black leading-none tabular-nums">{count}</div>
        <div className="text-[10px] font-bold text-slate-600">{label}</div>
        <div className="text-[9px] text-slate-400">{sub}</div>
    </div>
</button>
```

Active card: colored bg + border + `shadow-md -translate-y-px` + X icon on right edge.

---

## Table Standard

- Container: `rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm`
- Sticky header: `bg-slate-50/95 backdrop-blur-xl border-b border-slate-200/60`
- Header text: `text-[10px] font-black uppercase tracking-widest text-slate-400`
- Row hover: `hover:bg-slate-50/70`, expanded row: `bg-blue-50/50`
- Expanded row background: `bg-gradient-to-br from-blue-50/40 via-white/60 to-slate-50/30`
- Inactive rows (in "Todos" mode): `opacity-55` + nombre with `line-through decoration-slate-300`
- Sortable header uses `↑ ↓ ↕` text indicators and turns `text-[#007AFF]` when active

---

## Color Palette

- Primary blue: `#007AFF` (hover: `#0055CC`)
- Success/active: `emerald-100 text-emerald-700`
- Warning/low margin: `amber-100 text-amber-700`
- Error/loss: `red-100 text-red-700`
- Antibiótico: `orange-50 text-orange-600 border-orange-100`
- Receta: `red-50 text-red-600 border-red-100`
- Principio activo text: `text-violet-500/70`
- Badge pills: `text-[9px] font-bold px-1.5 py-0.5 rounded-full border`

---

## Glass Header Standard

All views use `GlassViewLayout` with `filtersContent` for the floating top-right controls. The standard header pill pattern (search + tabs) is in `ProductosView.jsx`. For new views, follow `VentasView.jsx` or `ProductosView.jsx`.

**Why:** User said explicitly "debemos mantener un diseño visual estándar para todo" — enforce these patterns across all new modules.
