// Portal Farmalasa — Version control
// Maintainer: Edwin Nunez
// Format: MAJOR.MINOR.PATCH
// - MAJOR: breaking redesigns / architecture changes
// - MINOR: new features / modules
// - PATCH: fixes, tweaks, visual adjustments

export const APP_VERSION = '2.2.36';
export const APP_AUTHOR  = 'Edwin Nunez';

// Changelog (most recent first)
// v2.2.36 — MinMax fix: get_last_sale_dates .range(0,9999) elimina cap 1000 filas PostgREST (fechas faltantes en productos >1000); validateEditForRow agrega checks MAX=0/MIN>0 y MIN>0/MAX=0 que antes pasaban silenciosamente
// v2.2.35 — MinMax: validación diferida MIN→MAX (Tab/ArrowRight no bloquea en transición; pendingMin propaga valor para validación final); get_last_sale_dates RPC + fecha última venta junto a "N vend." en fila principal; get_product_last_sales RPC + panel expandido con dos columnas Compras/Ventas
// v2.2.34 — Pedidos FASE 2: receive_pedido_sucursal guard (anulado/completado + solo items pendientes); anular_pedido registra anulado_por/at/motivo; confirm_pedido valida array no vacío/qty>=0/sucursal válida; RLS pedidos+pedido_items+dispatch_rules
// v2.2.33 — Pedidos FASE 1: inv_dedup DISTINCT ON (5585 grupos duplicados ERP corregidos); pending_committed descuenta bodega de pedidos activos; get_pedido_preview/stats/sin_bodega/count actualizados
// v2.2.32 — notify-new-products-daily: edge fn + cron lun-sáb 8am; RPC get_logistics_chief_ids con fallback a Administrador si vacaciones/incapacidad
// v2.2.31 — sync-erp-purchases: cron diario → cada 10 min (ayer+hoy); items upsert para todas las recepciones (no solo nuevas); productos ignoreDuplicates:false
// v2.2.30 — MinMax: tab vs ERP eliminada; get_stock_analysis Branch 4 — productos sin presencia en sucursal (is_catalog_only=true); ocultos por defecto, visibles al buscar o filtrar "Sin historial"; chip Sin historial restaurado en STAT_CFGS
// v2.2.29 — MinMax: tab vs ERP eliminada (TabMinMaxComparacion)
// v2.2.28 — TabReglas: tipo de regla único (solo_cajas/multiplo/blister) con radio visual; AnimatePresence + motion.div en panel edición; guardar limpia campos del tipo no activo; validación de múltiplo requerido antes de guardar
// v2.2.27 — TabReglas: fix 0 productos (created_at no existe en products_with_lab); DataRow+DataCell estándar; LiquidSelect labs con bare mode; stat cards estilo TabCatalogo; nuevos este mes startOfMonth; excluye labs ocultar_en_minmax igual que MinMax; filtro nuevo usa .in(newIds) server-side; TablePagination estándar
// v2.2.26 — TabReglas: rediseño completo — cards info izq + pill filtros der; columnas ordenables (lab/producto); click en fila abre panel edición inline; panel redesignado con toggle Solo Cajas prominente + pill-selectors; solo_cajas=true por defecto; badge "Nuevo" + filtro+contador para productos añadidos en los últimos 30 días
// v2.2.25 — Pedidos: distribución bodega en unidades de despacho (multiplo) desde el inicio; fase complemento redistribuye packs sobrantes a mayor necesidad insatisfecha; solo_cajas=true+CAJA preserva en Bodega; presentaciones UNIDAD/BLISTER siempre envían complemento para evitar stock muerto
// v2.2.24 — Pedidos: urgencia_pct ≥min→100 (crítico); loadMore aplica filtros fecha; StatCards desde DB (totalCounts); audit log ELIMINAR_BORRADOR_PEDIDO; TabReglas filtros server-side + paginación siempre; TabGenerar notifica sucursales al confirmar; drop get_pedido_sin_bodega_count
// v2.2.23 — MinMax: Ocultar/Ocultos integrados como chips al final de Row1 (sin fila separada); whileHover en pill glass + amber pill; Publicar con whileHover scale+y+shadow floating; dot de estado pulsa al activarse
// v2.2.22 — MinMax: rediseño completo zona filtros+borradores — 2 filas separadas: Row1 pill liquid glass (filtros estado + pocos datos); Row2 amber glass pill (borradores+toggles+descartar) + Publicar CTA elevado con sombra azul independiente; sin elementos cargados en una sola línea
// v2.2.21 — MinMax: Ocultar/Ocultos movidos al espacio entre matrix y pill de filtros; pill de filtros rediseñada igual que pill de sucursal (bg-white/80 border-slate-200/70 h-5 dividers); Publicar azul como cap derecho separado
// v2.2.20 — MinMax: pill de filtros unificada y glassmorphic — status chips, pocos datos, borradores y Publicar en una sola pill; chips más grandes (px-3 py-2 text-[11px]); colores activos por categoría (chipActive); sección draft entra animada desde la derecha cuando hay borradores; X badge animado con AnimatePresence
// v2.2.19 — fix(DB): get_stock_analysis Branch 3 ahora devuelve dead_stock+is_dead_stock=true — antes emitía out_of_stock/ok, por eso "Sin historial" siempre daba 0; ahora aparecen bajo "Sin movimiento"
// v2.2.18 — MinMax: DraftCostCard igualada en altura a CostCards (una sola línea de valores, gap-0.5, text-[14px]); "Sin historial" eliminado de STAT_CFGS (redundante con Sin movimiento); pills aún más compactas (px-2 py-1 text-[10px])
// v2.2.17 — MinMax: cálculo mensual automático (edge fn auto-calculate-minmax + pg_cron día 1 a las 3am); notificación push al Supervisor de Ventas con fallback a jefe inmediato; RPC discard_stock_drafts; botón "Descartar todo" con confirm modal; botón Trash2 por fila para descartar borrador individual
// v2.2.16 — MinMax: cards (Total retenido/Inventario útil/etc.) muestran skeleton al cambiar sucursal; pills de filtro más compactas (px-2.5 py-1.5); botón Ocultar rosa, botón Historial azul
// v2.2.15 — MinMax: filtros de estado unidos en una sola pill contenedor (rounded-2xl); "Pocos datos" movido dentro de la pill de estado; borradores+publicar en pill separada (solo visible cuando hay borradores); mensaje badge sparse mejorado (mayorista vs rotación mínima)
// v2.2.14 — MinMax: skeleton al cambiar sucursal (setData([]) antes de fetch); spinner en botón Ocultar mientras espera DB; historial audit_logs limpiado
// v2.2.13 — Sidebar: scroll automático al ítem activo al abrir submenú (espera 330ms a que termine la animación, luego scrollea la nav)
// v2.2.12 — MinMax: fix tab "Sin movimiento" mostraba 0 (alert_status era 'no_data' en vez de 'dead_stock' desde calc_columns); filtro "pocos datos" ahora es toggle independiente (filterSparse) — muestra solo sparse sin mezclar borradores
// v2.2.11 — MinMax: "Calcular todas" llama por sucursal en secuencia (muestra progreso "La Popular 1/7"); DB: work_mem 128MB elimina disk spill, data-modifying CTEs fusionan sparse+main en un solo scan, ranked filtra dias>=3
// v2.2.10 — MinMax: todos los mensajes usan LiquidToast — error de carga, calcular éxito/error, aviso bodega; eliminado banner inline de error
// v2.2.9  — MinMax: detección de productos con datos insuficientes (< 3 días de venta) — badge "POCOS DATOS", MIN/MAX con borde punteado naranja "⚠ Confirmar", guardado siempre como borrador; botón de filtro en barra; calculate_stock_params excluye estos del cálculo automático
// v2.2.8  — MinMax: fix timeout al cambiar sucursal — eliminado subquery d2 inutilizado en get_stock_analysis (escaneaba toda sales_invoice_items sin filtro); índice en erp_sucursal_map(branch_id); errores DB traducidos al español
// v2.2.7  — MinMax: labels con bajo contraste en glassmorphism corregidos — velocidad/día, separador ·, vend., laboratorio, N act. bajo MIN/MAX, ≈ cantidad bajo inputs; todos legibles
// v2.2.6  — MinMax: todo via LiquidToast (publicar, restaurar, errores); banner fijo de publicación eliminado; error DB muestra mensaje real en lugar de hardcoded
// v2.2.5  — MinMax: modal historial MIN/MAX por producto — foto producto + foto empleado + fecha/hora + campo + valor anterior→nuevo; audit log enriquecido (product, field_label, old_value, new_value)
// v2.2.4  — MinMax: avisos LiquidToast con nombre del producto; warn si valor guardado es 4× mayor/menor al calculado (warnIfOutrageous); errores de validación y DB via LiquidToast
// v2.2.3  — MinMax: fix raíz del toast invisible — backdrop-filter del body card creaba containing block para position:fixed; ahora el toast usa createPortal→document.body; skipBlurSave en todos los error paths; toast fallback en error DB
// v2.2.2  — MinMax: fix definitivo toast validación usando validateEditForRow(row) puro sin closure de data; botón Restaurar verde; skipBlurSave en path de error para evitar doble-fire
// v2.2.1  — MinMax: fix toast de validación (validateEdit síncrono en cada handler antes de navegar); backfill calc_min/calc_max en 17k filas; texto "act." más visible (slate-400)
// v2.2.0  — MinMax: validación MIN/MAX muestra LiquidToast con el error y revierte al valor anterior; botón Restaurar (RotateCcw) en acciones devuelve al valor originalmente calculado por Calcular (calc_min/calc_max en DB)
// v2.1.9  — MinMax: error de validación (MAX>MIN, regla 0/x) se muestra inline debajo del input en rojo; el input permanece abierto para corrección
// v2.1.8  — MinMax: permisos can_edit/can_approve/can_view; modo live post-publicación (edits van directo a min_units/max_units); filtro "Solo cambios" auto al recalcular con datos publicados; validación inline MAX>MIN y regla 0/x (MIN=0→MAX solo 0 o 1); tabla product_stock_params limpiada para inicio fresco
// v2.1.7  — Widget Ajuste Min/Max: aviso reformulado ("MIN y MAX se ingresan en unidades. 30 und = 1 CAJA" + "Factor calculado: 1x30"); se quita el equivalente bajo los inputs MIN/MAX; foto del producto y principio activo en el header del formulario y en los resultados de búsqueda
// v2.1.6  — Widget Ajuste Min/Max: deja claro que MIN/MAX son en UNIDADES (no presentaciones) — aviso con el factor de la presentación dominante (ej: 1 CAJA = 100 und (1x100)), labels "Nuevo MIN/MAX (und)", y equivalente en vivo bajo cada input y en "En uso ahora" (≈ N CAJA). Carga presentaciones de product_precios
// v2.1.5  — Reset de contraseña: al restablecer (EmployeeDetailView) ahora se muestra la contraseña temporal aleatoria que genera el edge function en un modal con botón de copiar ("no se volverá a mostrar"); antes solo salía un toast y la temporal quedaba invisible
// v2.1.4  — MinMax solicitudes: el empleado ve el estado de sus solicitudes de ajuste en "Mis Solicitudes" (EmployeeRequestsView lee minmax_change_requests propias; card MinMaxStatusCard con estado pendiente/aprobada/rechazada + respuesta del supervisor), bajo las pestañas Pendientes/Aprobadas/Rechazadas. Antes la confirmación solo llegaba por push
// v2.1.3  — MinMax solicitudes: ruteo de notificación al rol Supervisor/a de Ventas (RPC get_minmax_approver_ids), con fallback al jefe inmediato (rol padre) si está de vacaciones/incapacidad/permiso hoy. Rediseño visual de la pestaña Solicitudes: filter pill estándar (sucursal + Aprobar todas/filtradas), grid de cards glassmorphic multi-columna con foto del solicitante, ventas 6m, actual→propuesto, aprobar/rechazar con razón inline; historial filtrable por sucursal con estado
// v2.1.2  — MinMax solicitudes: widget muestra ventas últimos 6 meses de la sucursal (contexto para proponer); columna current_sales_6m guarda el snapshot; cola de aprobación (pestaña Solicitudes) con filtro por sucursal (chips con conteo) + ventas 6m en cada tarjeta
// v2.1.1  — MinMax widget: ahora aparece en Permisos (dash_minmax_req con scope) y respeta alcance — scope ALL muestra selector de sucursal ERP en el header (como Anulaciones), scope limitado fija la sucursal del empleado (mapeo branch_id→ERP por nombre). RLS de solicitudes gateada por dash_minmax_req (operación puede proponer sin acceso al módulo). Selector de sucursal interno del widget eliminado (viene del header)
// v2.1.0  — MinMax workflow de solicitudes de ajuste: tabla minmax_change_requests + RLS (can_edit propone / can_approve aprueba) + RPCs approve/reject_minmax_request (aplican override manual atómico); WidgetMinMaxRequest en Dashboard/Operación (busca producto, propone MIN/MAX, push a aprobadores); pestaña "Solicitudes" en MinMax (cola + historial, aprobar/rechazar con push al solicitante); PermissionsView minmax hasApprove:true. Integridad: CHECK max>=min en product_stock_params (manual/calc/draft) + guard en publish_stock_params + 1 draft corrupto saneado. Item 5 visual: border-l ámbar eliminado de EditDraftRow, transition-all→transition-colors en hovers de color, text-[7px]→[9px]
// v2.0.3  — Edge functions hardening: sync-products a secret ERP_PRODUCTS_CREDS + requireInvokeSecret; set-employee-password reset a contraseña temporal aleatoria; ensure_user_by_code búsqueda parametrizada; fix 401 heal-dte-sync/backfill (usaban service key en vez de ADMIN_INVOKE_SECRET → redes de seguridad caídas); paginación >1000 filas (dte/purchases/promo); helper Gemini compartido (sin listar modelos por request); check-doc-expiry UTC-6 real; sync-promo auto-cierre filtra por período; cookie ERP cacheada por invocación; UPDATE en lote en desactivación de presentaciones; heal sin re-sync por huecos (falsos positivos)
// v2.0.2  — sync-products v23: fix raíz — presentaciones upsert solo tipo (factor/descripcion eliminados); precios upsert directo sin carga masiva en memoria; paginación con .order('id'); laboratorio_id y product_precios ahora correctos para APITENA/NEUROBION ADVANCE/FARSENTAL/IMATION
// v2.0.1  — PromoModal: deduplicar presentaciones por tipo+descripción (no por id); mantener pasos montados (fecha y producto en progreso no se pierden al navegar); header gradiente azul-violeta, body blanco sólido; selector presentación con factor (CAJA · 1X10); búsqueda productos server-side (sin cap 1000); pills filtro alineadas a derecha en los 3 tabs de Promociones
// v2.0.0  — Módulo Promociones: 6 tablas DB (promotions, branches, products, bonifications, payments, sales_cache); PromocionesView 3 tabs (Activas/Bonificaciones/Historial); edge function sync-promo-sales + cron 4:30am; MinMax excluye ventas de períodos en promo (calculate_stock_params actualizado)
// v1.8.1  — Compras: aviso global + filtro "Sin proveedor" + ícono ⚠ en filas sin supplier_id; edge function v11 fallback por nombre
// v1.8.0  — Módulo Compras: vista dedicada /compras con tab Facturas (expandible por ítems) y tab Productos (product_purchase_summary); filtros por fecha y proveedor
// v1.7.0  — MinMax: panel expandido muestra "Últimas compras (Bodega)" — fecha, cantidad, precio, proveedor, lote
// v1.6.9  — MinMax: denominador dinámico para productos nuevos (days_since_first_purchase vs analysis_days fijo); badge "Xd DATOS"; tabla suppliers + vista product_purchase_summary; cron sync-purchases-daily
// v1.6.8  — Nueva edge function sync-erp-purchases + tablas purchase_receipts/items/sync_log (compras ERP con discover mode)
// v1.6.7  — MinMax: Bodega draft = trigger DB en tiempo real (Σ efectivos de sucursales al editar draft); publish_stock_params sin auto-update Bodega
// v1.6.6  — MinMax: fix banner Bodega (edición sí permitida); backfill draft Bodega existente; toast al editar MIN/MAX en Bodega
// v1.6.5  — MinMax: Bodega borrador auto-actualiza al publicar sucursal (draft_min/max = Σ, draft_status pending); banner violet explicativo; toast al editar celda en Bodega
// v1.6.4  — MinMax: Bodega Opción A — al publicar sucursal, Bodega MIN/MAX = Σ min/max publicados de todas las sucursales (automático, sin paso extra)
// v1.6.3  — MinMax: winsorización P95 de outliers de demanda (configurable en stock_config.outlier_percentile)
// v1.6.2  — MinMax: panel Labs glassmorphic con toggle ocultar_en_minmax, buscador, limpieza is_hidden al desocultar lab
// v1.6.1  — MinMax: filtro "Ocultos" → ver y mostrar ocultos individualmente o en lote ("Mostrar todos")
// v1.6.0  — MinMax: Labs panel — ocultar_en_minmax en laboratorios; productos de labs ocultos no se contabilizan como ocultos individuales
// v1.5.9  — MinMax: ocultar por laboratorio — SARITA/CONSTANCIA/BEBIDAS/RECARGAS/NEVERIA excluidos por defecto
// v1.5.8  — MinMax: errores de calcular/publicar → toast rojo en español; timeout → mensaje claro sugiere recalcular por sucursal
// v1.5.7  — MinMax: todos los productos activos visibles (no_data UNION ALL en get_stock_analysis); MIN/MAX editable para dead-stock y sin-historial; warning ⚠ 6m
// v1.5.6  — MinMax: ocultar usa upsert — dead-stock products (sin fila en product_stock_params) ahora persisten ocultos tras reload
// v1.5.5  — MinMax: get_draft_cost_estimate excluye is_hidden=true — conteo y costos ahora correctos sin ocultos
// v1.5.4  — MinMax: botón "Ocultar filtrados (N)" — oculta en lote todos los productos visibles con el filtro activo
// v1.5.3  — MinMax: ocultar → is_hidden en DB (compartido), draft 0/0, excluido de recálculos; card "Inversión borrador"
// v1.5.2  — MinMax: búsqueda por laboratorio (además de nombre de producto)
// v1.5.1  — MinMax: card "Objetivo borrador" — costo estimado MIN→MAX del inventario calculado (RPC get_draft_cost_estimate)
// v1.5.0  — MinMax: onFocus select() en celdas MIN/MAX — al entrar se selecciona el valor para reemplazarlo de inmediato
// v1.4.99 — MinMax: Enter/↓ en celda MIN o MAX guarda y salta al siguiente producto; ↑ salta al anterior; Tab/→ sigue abriendo MAX del mismo producto
// v1.4.98 — MinMax vs ERP: agrega Bodega (ID 6) al selector de sucursal — faltaba en ERP_NAMES/ERP_ORDER
// v1.4.97 — MinMax vs ERP: chunked fetch (range 1000) — PostgREST cap silencioso cortaba a 1000 filas (sucursales tienen 1500–2000+ productos)
// v1.4.96 — MinMax vs ERP: rediseño visual — selector sucursal a la derecha, pill estándar izq (Borrador/Publicado + filtros); sucursal con ERP_NAMES hardcoded (no useAuth)
// v1.4.95 — MinMax vs ERP: fix TypeError — TablePagination recibía totalRows/onPage/onPageSize en vez de total/onPageChange/onPageSizeChange
// v1.4.94 — MinMax vs ERP: fix TypeError (columns/sortKey/empty props incorrectos en DataTable) + DeltaCell defensivo
// v1.4.93 — MinMax: tab "vs ERP" — compara borrador/publicado contra MIN/MAX del ERP por sucursal
// v1.4.92 — MinMax CSV: quita columna XYZ separada (Clase ya muestra AX/BY/CZ)
// v1.4.91 — MinMax CSV: quita Estado/Stock/Cobertura/Pedir/Ingresos; agrega Laboratorio y Clase completa (ABC+XYZ)
// v1.4.90 — get_product_sales_agg: mes parcial de inicio desde invoice_items (no monthly_agg) → cantidad exacta al día igual que MinMax
// v1.4.89 — PeriodPicker: "Últimos 6 meses" = hoy−180 días (rolling, igual que MinMax) en vez de inicio de mes calendario
// v1.4.88 — fix: GlassViewLayout overflow-x-hidden — scroll horizontal ya no mueve el body bajo el menú
// v1.4.87 — MinMax: formatDominant CEIL (floor→ceil) + símbolo ≥ — cajas indivisibles, cantidad cubre el umbral en unidades
// v1.4.86 — MinMax: Equiv. siempre visible — cajas/blisters en amber/blue, sin presentación en slate-400 "N und", dead=—
// v1.4.85 — MinMax: MIN/MAX muestran número puro; columna Equiv. con formatDominant (amber=MIN, blue=MAX); "—" si sin presentaciones
// v1.4.84 — MinMax: fix TDZ 2 — draftCount movido antes de requestPublish (segunda referencia circular en dep arrays)
// v1.4.83 — MinMax: fix TDZ — handlePublish declarado antes de startDeferredPublish (dep array evaluado en cada render)
// v1.4.82 — MinMax: quita Cobertura+Stock columnas; stock inline bajo nombre; MIN/MAX botón-pill clickeable (amber/blue); input w-20 + Tab→MAX, ArrowLeft→MIN; XCircle tooltip; quita "und" subtítulos
// v1.4.81 — MinMax: CostCards sin hero-metric (14px vs 20px); blur 20px→4px en matriz; Publicar con ConfirmModal + toast cancelable 5s
// v1.4.80 — MinMax: hiddenIds → Supabase user_metadata (cross-device); fix DataTable key (no remount on filter); collapse expanded row al editar MIN/MAX
// v1.4.79 — MinMax: hiddenIds persiste en localStorage por sucursal (minmax_hidden_{erp})
// v1.4.78 — MinMax: animaciones fluidas — easeOutExpo, presets chipAnim/ctaAnim/iconAnim/fadeUp, sin spring en hover
// v1.4.77 — MinMax: spring hover/tap en chips+pills+controles+acciones; glass inactivo backdrop-blur; active glass tinted
// v1.4.76 — MinMax: quita fila D de matriz ABC×XYZ (nunca tiene datos)
// v1.4.75 — MinMax: sort default laboratorio, ocultar productos, XCircle visible, matriz compacta, motion chips+tabla
// v1.4.74 — MinMax: columna Clase ordenable (AX→DZ, usa draft si existe)
// v1.4.73 — MinMax: columna Laboratorio ordenable (sortable + localeCompare 'es')
// v1.4.72 — MinMax: draft pill = glass idéntico a pill controles, publicar azul #0052CC, motion enter/exit + AnimatePresence
// v1.4.71 — MinMax: borradores/publicar en pill contenedor (sección blanca + cap ámbar), push right con ml-auto
// v1.4.70 — MinMax: borradores/publicar como pills junto a chips de estado; matriz más compacta; "Todas las sucursales"
// v1.4.69 — MinMax: fix TDZ — filteredDraftIds/filterLabel movidos debajo de filtered (ReferenceError antes de inicialización)
// v1.4.68 — MinMax: MIN floor — si MAX>1, MIN mínimo 1; solo (0,1) válido con MIN=0 (calculate_stock_params actualizado en DB)
// v1.4.67 — MinMax: publicar filtrados — botón "Publicar Clase A (N)" / "Publicar filtrados (N)" en banner cuando hay filtro activo con borradores
// v1.4.66 — MinMax auditoría: formatDominant CEIL→FLOOR+~, EditRow border-l eliminado, validación MIN+MAX obligatorio par, calculate_stock_params usa erp_sucursal_map
// v1.4.65 — MinMax tabla: ventas bajo nombre (no columna separada), columna Laboratorio, Stock actual = Faltan/Exceso en texto (sin barra), DB get_stock_analysis v3 + laboratorio_nombre
// v1.4.64 — MinMax tabla: foto producto, columna Ventas (und/día + vend 6m + tendencia), StockBar en Stock, columna Acciones separada, quita border-l color, employee photo en banners/toast
// v1.4.63 — MinMax: botón XCircle pone draft MIN/MAX en 0; matriz activa usa outline (no intersección con vecinos); quita Edit3
// v1.4.62 — MinMax: MIN/MAX borrador muestran presentación dominante + und (igual que publicados); input muestra hint ≈ cajas mientras se escribe
// v1.4.61 — MinMax: pill Calcular como sibling (visual fix), Toda la red, Publicar inline con badge, matrix glassmorphism+hover z-index, cards se actualizan al editar draft
// v1.4.60 — MinMax: 6 fixes — toast para calcResult, edición inline MIN/MAX borrador, matrix/filtro usan draft, badges solo draft, get_inventory_cost_summary draft fallback
// v1.4.59 — MinMax: cards glassmorphic grandes, pill unificada (branch+CSV+cfg+todas+recalcular), sin leyenda ni ABC/XYZ duplicados en pill
// v1.4.58 — MinMax: redesign visual — cards compactas izq, pill filtro der, chips alertas sobre tabla, skeleton matriz, botones min-w+active:scale, sin AZ ni Ciclo
// v1.4.57 — MinMax: edición de borrador inline (EditDraftRow) — editar draft_min/draft_max antes de publicar, muestra valor en uso como referencia
// v1.4.56 — MinMax: CSV+sucursal, banner config→recalc, alerta clase A críticos, filtro AZ, proyección 30/60/90d, acciones dead stock, traslados en Red, orden defecto visible, pg_cron 3am diario
// v1.4.55 — MinMax: workflow Borrador/Publicar — calcular genera borradores; diff live→draft en tabla; Publicar por fila o todo; get_stock_analysis VOLATILE; TabMinMaxNetwork chunked fetch; fix indexOf O(n²)
// v1.4.54 — MinMax: fix MAX > MIN siempre — MAX = GREATEST(CEIL(v×cycle), MIN+1, 1); 0 casos inválidos en 17k registros
// v1.4.53 — MinMax: fix pisos MIN/MAX — slow movers usan FLOOR+0 y MAX≥1 (no más MAX=2 para ventas esporádicas)
// v1.4.52 — MinMax: fix 1000-row cap en get_stock_analysis (chunked fetch hasta agotar resultados)
// v1.4.51 — MinMax: umbrales XYZ corregidos (X≤150, Y≤400) + recálculo completo red; fix La Popular sin AX/AY
// v1.4.50 — MinMax: DataTable estándar + TablePagination (25/50/100) + filter pill (Ventas standard) en Sucursal y Red
// v1.4.49 — MinMax: tab Red (TabMinMaxNetwork), ExpandedPanel → Pedir+Traslado+Vencimientos+Historial, EditRow → lead_time_days por producto
// v1.4.48 — MinMax: corrige todo — approaching_pct configurable, velocity_30d + tendencia, sort columnas, Pedir, audit log, buffer days config, fmtMoney, keys React, lastCalcAt, CSV Pedir, branch cards números base
// v1.4.47 — MinMax: ExpandedPanel → vista consolidada multi-sucursal (7 cards con stock/MIN/MAX/StockBar + totales red)
// v1.4.46 — MinMax: Bodega con MIN/MAX real (demanda consolidada todas sucursales); botón Recalcular todas; quita bloqueo Bodega
// v1.4.45 — VentasPerdidas: foto del empleado en lugar de ícono User; fallback a inicial si no tiene foto
// v1.4.44 — VentasPerdidas: fix tabs (key en TABS); WidgetInventorySearch: botón Reportar inline junto a badge ACTIVO
// v1.4.43 — Ventas Perdidas: botón reportar en cada card SRS (con nombre/lab/principio); vista rediseñada, tabs sin traba
// v1.4.42 — PermissionsView: agregar módulo ventas_perdidas al grupo Inventario
// v1.4.41 — Ventas Perdidas: módulo + badge realtime + botón reportar en widget (sin stock → cantidad → BD)
// v1.4.40 — WidgetInventorySearch: sin stock → auto SRS + alternativas en inventario por principio activo
// v1.4.39 — WidgetInventorySearch: total sucursal más visible (coloreado, 12px); búsqueda por principio activo
// v1.4.38 — Fix definitivo factor: presentaciones solo guarda tipo; factor/descripcion siempre desde product_precios
// v1.4.37 — Ventas/Productos: cantidad en unidades base (cantidad×factor ERP); RPC incluye factor por presentación
// v1.4.36 — MinMax: clasificación ABC×XYZ, ciclo uniforme 45 días, panel de configuración (stock_config), CoverageBar, matriz filtrable
// v1.4.35 — AuthContext: Realtime subscription a role_permissions → menú y PermissionGuard reactivos al instante
// v1.4.34 — MinMaxView: módulo independiente en menú Inventario (/minmax); removido de ProductosView tabs
// v1.4.33 — WidgetInventorySearch: overscroll-contain (no body scroll bleed); glass card separation (shadow+border, no colored left border)
// v1.4.32 — WidgetInventorySearch: left accent border per product (branch color), space-y-2, input bg-white/80 (glass container visible)
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
