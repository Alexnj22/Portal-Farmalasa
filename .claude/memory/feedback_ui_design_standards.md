---
name: UI Design Standards — Portal Farmalasa
description: Visual design standards for all modules — filter bars, stat cards, tables, headers, color palette
type: feedback
---

## Filter Bar Standard (Ventas pattern — use everywhere)

### Architecture rule: TWO separate elements, different positions

The Ventas pattern has TWO distinct elements — do NOT merge them into one:

1. **`filtersContent` (floating glass header)** = ONE glass pill containing ONLY tabs + search button. Nothing else.
   - Class: `relative flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 ... rounded-[2.5rem] h-[4rem] md:h-[4.5rem] overflow-hidden`
   - See `VentasView.jsx` lines 1895–1943 or `ProductosView.jsx`

2. **White filter pill (tab body top)** = `hidden lg:flex` pill with `bg-white/80 backdrop-blur-sm` — rendered at the TOP of the tab body, in a `flex items-start gap-3 flex-wrap` row alongside stat cards (stat cards left, filter pill right).
   - See `VentasView.jsx` line 501 (`FilterControls`) inside `TabVentas`'s return
   - See `TabCatalogo.jsx` — filter pill at the top of the return block

Filter state IS lifted to the View level (e.g. `ProductosView`, `VentasView`), passed as props to tab components, and the tab renders the pill itself.

### White filter pill JSX (exact class string):

```jsx
<div className="hidden lg:flex group items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 shrink-0 overflow-visible">
    {/* Sections separated by: */}
    <div className="h-5 w-px bg-slate-100 shrink-0" />
</div>
```

- Use **`LiquidSelect`** (`src/components/common/LiquidSelect.jsx`) for ALL dropdowns — never native `<select>`
- Each filter section gets its own individual **X clear button**: `w-[18px] h-[18px] rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white`
- Add a **global "clear all"** button (red circle X) only when any filter is non-default
- Sections separated by `h-5 w-px bg-slate-100` dividers
- Dynamic width for LiquidSelect: `Math.max(150, Math.min(260, 90 + label.length * 7))`
- Stat cards (e.g. "Pérdida N / Margen bajo N") live in the SAME `flex items-start gap-3 flex-wrap` row, on the left

**Why:** User was frustrated that having TWO different-style pills in the glass header was visually inconsistent. The real Ventas pattern has one glass pill in the header, and the white filter pill is inside the tab body.

**How to apply:** Check `VentasView.jsx` line 501 and `TabCatalogo.jsx` body start for the exact tab-body pattern. `filtersContent` must only contain the glass tabs+search pill.

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
