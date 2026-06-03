// Portal Farmalasa — Version control
// Maintainer: Edwin Nunez
// Format: MAJOR.MINOR.PATCH
// - MAJOR: breaking redesigns / architecture changes
// - MINOR: new features / modules
// - PATCH: fixes, tweaks, visual adjustments

export const APP_VERSION = '1.4.31';
export const APP_AUTHOR  = 'Edwin Nunez';

// Changelog (most recent first)
// v1.4.31 — WidgetInventorySearch: Lightbox via createPortal → ya no queda cortada por transform del widget padre
// v1.4.30 — WidgetInventorySearch: glassmorphism consistente en cards de productos (single-lot y multi-lot, lista y drill-down)
// v1.4.29 — WidgetAnnulmentRequest: anulación siempre permitida (warning si fuera de gracia); ojo muestra productos; botón rojo si vencida
// v1.4.28 — WidgetAnnulmentRequest: cliente primary, correlativo+ID secondary, botón anulación directo en fila, back correcto
// v1.4.27 — WidgetAnnulmentRequest: fix sucursal_id→branch_id (columna correcta en sales_invoices)
// v1.4.26 — WidgetAnnulmentRequest: pill sucursal en header WidgetCard; fix tipo_dte→tipo_documento; cliente+tipo_pago; popup detalle; búsqueda por cliente/fecha/monto
// v1.4.25 — WidgetAnnulmentRequest: LiquidSelect de sucursal cuando scope=ALL; supervisor de sucursal seleccionada
// v1.4.24 — DashboardView: restaurar WidgetCard en los 3 widgets de Operación; quitar KPI row
// v1.4.23 — DashboardView: quitar fila de 4 KPI cards de la pestaña Operación
// v1.4.22 — DashboardView: commit pendiente — Operación tab sin WidgetCard (glass pane directo en los 3 widgets)
// v1.4.21 — WidgetInventorySearch: click producto→drill-down todas sucursales, foto miniatura + lightbox; Operación tab sin WidgetCard (glass pane)
// v1.4.20 — WidgetInventorySearch: rediseño branch-first, glassmorphism, stagger, multi-lote; fix layout merge BD→operacion
// v1.4.19 — Dashboard: pestaña Operación con widgets Inventario, Anulaciones y SRS+Inventario
// v1.4.18 — EmployeeDetailView: historial conectado a employee_timeline view (real-time, todos los eventos)
// v1.4.17 — VIEW employee_timeline: UNION ALL de hire/events/audit_logs(movimientos)/rosters publicados
// v1.4.16 — Drop system_roles+product_costs; employee_history→audit_logs; costo en product_precios_history + PRICE_FIELDS
// v1.4.15 — Bug4: align timeClock.audit.js AUDIT_SEVERITY enum with auditSlice (WARN→WARNING, ERROR→WARNING, SECURITY→CRITICAL)
// v1.4.14 — Bug fixes: Sunday key 0→7 (disability/vacation/recall), SHIFT_CHANGE UTC→local, handleSaveCell stale closure, kiosk cross-branch coverage via get_kiosk_coverage_employees
// v1.4.13 — Cross-branch coverage: schedule_coverage table, CoverageEmployeeRow, Apoyo badge, InlineDayEditor coverageMeta
// v1.4.12 — ScheduleCalendar: overflow-anchor none on scroll container (eliminates scroll jump on popup open)
// v1.4.11 — InlineDayEditor: deduplicate shifts by name+start+end (same key as TabShifts catalog)
// v1.4.10 — LiquidSelect: explicit exit objects + null child; InlineDayEditor: body-card glass config; TimePicker12: wider selects + more padding
// v1.4.9 — LiquidSelect: AnimatePresence close animation (Framer Motion); InlineDayEditor: glassmorphic bg-white/28 + motion.div enter/exit
// v1.4.8 — chart: expand btn inline (no overlap); LiquidSelect: close animation; InlineDayEditor: glassmorphic + scale/fade enter+exit
// v1.4.7 — chart: Muerta color #64748b, labels X dentro de barra, py-2 min-h-[80px]
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
