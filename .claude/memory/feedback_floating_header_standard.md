---
name: Floating Header Search Standard
description: The standard pattern for the floating header with tabs, branch filter, and sliding search in this project
type: feedback
originSessionId: 02d464e3-41d3-4e74-b3d6-f29d7b197bc7
---
All views using GlassViewLayout must use the **sliding search mode** pattern, not an inline open/close approach.

**Standard pattern (copy from VentasView `filtersContent`):**
- Outer container: `bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px...] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3`
- Two inner divs that slide via `max-w-0 opacity-0 pointer-events-none` ↔ `max-w-[600px] opacity-100` / `max-w-[900px]`
- State: `isSearchMode` (boolean) + `searchInputRef` with `.focus()` on open
- Close button: `ChevronRight` icon (not X)
- Search button: blue pill `bg-[#007AFF]` with red dot badge when `rawSearch` has content
- Tab pills: `bg-white shadow-md scale-[1.02]` when active, transparent + hover:bg-white when inactive

**Why:** The user flagged that FacturacionView's search didn't match the standard — the slide animation and visual language must be consistent across all views.

**How to apply:** Every new view with a search should use this exact pattern, not a simple toggle input.
