// Portal Farmalasa — Version control
// Maintainer: Edwin Nunez
// Format: MAJOR.MINOR.PATCH
// - MAJOR: breaking redesigns / architecture changes
// - MINOR: new features / modules
// - PATCH: fixes, tweaks, visual adjustments

export const APP_VERSION = '1.4.6';
export const APP_AUTHOR  = 'Edwin Nunez';

// Changelog (most recent first)
// v1.4.6 — chart min-h 90px, labels X 8px/black/slate-500; GlassViewLayout body flex-1 (no empty space)
// v1.4.5 — Horarios: barras más gruesas (gap-[3px]), min-h-[120px], labels abajo, botón expandir
// v1.4.4 — Horarios: chart compacto h-full sin min-h, se adapta al alto del pill (flex-1 bars)
// v1.4.3 — Horarios: chart izq + pill der misma altura, fondo chart = pill glass, leyenda al header
// v1.4.2 — Horarios: chart de barras restaurado, pill de filtros propia arriba del chart
// v1.4.1 — Horarios: heatmap chart (días/horas) con controles integrados en un solo card glassmorphic
// v1.4.0 — Horarios: chart shorter + glassmorphic, publish btn solid blue, week text contrast, Personal header height fix
// v1.3.9 — Horarios: chart left + pill (with publish) right inside body; weekIsPublished some() fix
// v1.3.8 — Horarios: chart full-width above body (subContent), filter pill inside body right-aligned
// v1.3.6 — Horarios: glassmorphic filter pill + chart moved to subContent (between header/body)
// v1.3.5 — Horarios: calendar controls wrapped in Ventas filter pill standard
// v1.3.4 — Fix JSX fragment/div mismatch in AppLayout sidebar footer (build error)
// v1.3.3 — Version label in sidebar menu; controls pill moved to body (below header)
// v1.3.2 — Fix TDZ error (validBranches before initialization) in SchedulesView
// v1.3.1 — Controls pill back in header, employee cards 20% narrower, glassmorphic photo bg
// v1.3.0 — Horarios redesign: ViewTabBar tabs+search, remove SALY, improved Feriados panel
// v1.2.x — LiquidSelect ghost-sizer fix (size stability on open), iOS Safari scroll fixes
// v1.1.x — AppLayout flicker fix, mobile unrestricted access, DTE sync v15 fixes
// v1.0.0 — Initial production release
