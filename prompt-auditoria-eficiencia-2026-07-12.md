# Auditoría de Eficiencia Total — Portal Farmalasa (prompt de ejecución)

Trabaja de forma autónoma, por fases commiteables (cada fase: build ✓ + bump de
`APP_VERSION` + changelog en `src/version.js` EN EL MISMO commit + push). Los
hallazgos de abajo ya fueron MEDIDOS el 2026-07-12 con datos reales de producción
(pg_stat_statements, pg_stat_user_tables, advisors, dist/) — no los re-derives:
verifica cada uno con un EXPLAIN/medición puntual antes de tocarlo y aplícalo.
Espera mi OK solo si un fix es destructivo, cambia comportamiento visible, o
escribe en prod (regla dura: TODO write a prod — dato, DDL o reset de stats —
necesita mi OK explícito en el momento).

**Objetivo final**: además de corregir, deja documentada cada regla nueva en
`CLAUDE.md` (sección corta, estilo de las reglas existentes) para que estos
patrones no se vuelvan a introducir.

---

## Contexto medido (2026-07-12) — de dónde sale cada número

- `pg_stat_statements` acumulado (incluye historia pre-fixes: los means de cosas
  ya arregladas pueden verse peor de lo que están hoy — por eso Fase 0).
- Ya RESUELTO desde la auditoría del 07-08 (no rehacer): code-splitting de rutas
  (43 `lazy()` en App.jsx, main chunk 812K+407K vs 5.1MB antes), write-churn de
  inventory (RPCs condicionales), índice `idx_inventory_sync_log_venc_synced`
  (EXPLAIN hoy: index scan, 2ms — el mean de 74.8ms es historia pre-índice).
- Seguridad 0B.7 cerrada (commits c2af0c2, cb4bc1d, 8d61757) — no tocar.

## FASE 0 — Línea base limpia

1. Correr `get_advisors` (security + performance) y guardar snapshot.
2. Con mi OK: `SELECT pg_stat_statements_reset();` para que las mediciones
   post-fix sean comparables (los means acumulados mezclan meses de historia).
   Anotar fecha/hora del reset en el informe.

## FASE 1 — Realtime: 25% de TODO el tiempo de query de la BD (el hallazgo #1)

La query de decode WAL de Realtime acumula **25.0% del tiempo total**
(238,919 calls × 9.9ms). Causa: la publicación `supabase_realtime` incluye 11
tablas y varias son calientes de escritura:

- Publicación actual: `announcements, notifications, pedido_item_eventos,
  pedido_sucursal_status, pedidos, product_stock_params, role_permissions,
  ruta_locations, ruta_pedidos, rutas, stock_config`.
- `product_stock_params`: 1.27M writes acumulados — cada write del sync de
  minmax se decodifica para Realtime aunque casi nadie esté suscrito.
- En el código hay 14 `.channel()` en 11 archivos (AuthContext, AppLayout,
  useSyncMonitor ×2, useNotificationsChannel, SidebarSyncStatus, TabRutas,
  TabPedidos ×2, TabEnCurso, RutaMapModal ×2, TabMinMax, systemSlice).

Acciones:
1. Mapear canal→tabla→vista. Sacar de la publicación toda tabla cuyo canal no
   exista o sea prescindible; para las calientes (`product_stock_params`)
   evaluar broadcast explícito o polling ligero en vez de postgres_changes.
2. Verificar cleanup de cada canal (unsubscribe en unmount) y que no haya
   suscripciones duplicadas por remount.
3. Documentar en CLAUDE.md: "tabla caliente de sync NUNCA va en
   supabase_realtime; usar broadcast o polling".

## FASE 2 — RPCs lentas (means medidos; verificar con EXPLAIN ANALYZE cada una)

| RPC | mean | calls | nota |
|---|---|---|---|
| `get_stagnant_inventory` | 6,459ms | 12 | y su variante `_jsonb` 4,441ms × 38 |
| `get_products_sold_no_minmax` | 3,160ms | 12 | `_jsonb` 1,788ms × 38 |
| `get_pedido_generar_dashboard` | 1,634ms | 56 | |
| `get_product_sales_total` | 1,234ms | 75 | |
| `get_stock_analysis_jsonb` | 1,233ms | 141 | |
| `get_product_sales_agg` | 718–1,059ms | 276 | `_jsonb` 1,210ms × 51 |
| `get_puntos_canjeados` | 461ms | 196 | puede ser historia pre-fix (ya se arregló a 12ms con CTE MATERIALIZED) — confirmar post-reset |

Para cada una: EXPLAIN ANALYZE con parámetros reales; buscar (a) plan genérico
por `(param IS NULL OR ...)` → fence con CTE MATERIALIZED (patrón ya probado en
get_puntos_canjeados 923ms→12ms), (b) seq scans por índice faltante, (c) trabajo
repetido que debería leer de un agregado/MV existente. Las de inventario
estancado y sold_no_minmax son las peores y se llaman desde MinMax/Productos.

También estas queries PostgREST directas:
- `sales_invoice_nulls` select: 1,323ms × 110 — ver si es vista sin índice.
- `sales_invoices` select (FacturacionView, 10 columnas): 1,369ms × 110.
- `sync_log WHERE success=$1 AND fini>=$2 ORDER BY fini`: 1,011ms × 48 —
  falta índice `(success, fini)`; hoy solo hay `(branch_id, fini)` y `(ran_at)`.

## FASE 3 — Agregados y MVs: churn de escritura masivo

1. **`refresh_product_sales_monthly_agg(3)`**: 9,266ms por corrida, cada hora
   (cron job 138). La tabla `product_sales_monthly_agg` acumula **264M writes
   sobre 127K filas** = reescritura completa en cada refresh. Convertir a
   refresh incremental/condicional: `INSERT ... ON CONFLICT DO UPDATE ... WHERE
   (cols) IS DISTINCT FROM (EXCLUDED.cols)` y/o refrescar solo el mes corriente
   (los meses cerrados no cambian; ya existe `close_ventas_month`).
2. **`refresh_inventory_grouped_mv`**: cada 2 min × 272ms (job 137) = 5.4% del
   tiempo total de BD. Evaluar bajar frecuencia (¿5 min?) o refresh condicional
   (solo si hubo sync de inventario desde el último refresh — consultar
   `inventory_sync_log`).
3. **`refresh_sales_daily_stats(3)`** cada 15 min × 284ms — mismo análisis.
4. Crons 179/180 (`VACUUM ANALYZE inventory/products` cada hora) eran parche
   del write-churn ya corregido — medir n_dead_tup real y probablemente
   eliminarlos o bajarlos a 1×/día.

## FASE 4 — Retención y espacio

1. **`cron.job_run_details`: 174MB / 216K filas** — no hay cron de purga.
   Crear: `DELETE FROM cron.job_run_details WHERE end_time < now() - interval
   '7 days'` diario (con los crons de cada minuto se generan ~10K filas/día).
2. **`net._http_response`: 54MB para 2,289 filas vivas** — bloat de pg_net.
   Verificar TTL de pg_net y si el espacio se recupera con vacuum normal.
3. `sync_log` 68MB/413K filas e `inventory_sync_log` 57MB/484K: la purga de 90
   días existe (job 172) pero con syncs por minuto son ~475K filas/90d cada una.
   Evaluar bajar a 30 días (consultar antes: ¿algún reporte usa >30d?).
4. Índices sin uso (88 en advisors, la mayoría INFO): revisar y dropear los
   claramente muertos — p.ej. `sales_invoices_customer_id_idx` (7.6MB, 0 scans).
   NO tocar índices de constraints únicos (`sales_invoices_codigo_generacion_key`
   respalda la unicidad aunque tenga 0 scans) ni los recién creados.
5. Advisors WARN: `multiple_permissive_policies` en `ruta_locations` (×6 roles)
   y `practicantes` — consolidar las policies `_select`/`_write` solapadas en
   una sola por acción (cada policy extra se evalúa por fila).

## FASE 5 — Edge functions: write-churn y errores silenciosos

1. **`sync-erp-purchases` (cada 10 min, job 166)** repite el patrón prohibido
   que ya causó el incidente de inventory:
   - `index.ts:188`: pone `updated_at: new Date().toISOString()` en el payload
     de products → toda fila "cambia" siempre.
   - `index.ts:195` (suppliers) y `:206` (products): upsert incondicional con
     `ignoreDuplicates: false` y SIN chequear `error` (regla CLAUDE.md violada
     dos veces en la misma línea). `products` acumula 160M writes.
   - Fix: detección de cambios como ya hace `sync-products` (cargar existentes,
     upsertar solo diffs) o RPC condicional `IS DISTINCT FROM`; chequear `error`
     de TODO await.
2. Barrido de las 27 functions locales (`supabase/functions/`): grep de todo
   `await supabase...` cuyo `error` no se chequea, y de todo `.upsert(` sin
   detección de cambios en crons recurrentes (revisar también `sync-wfm-sales`,
   `sync-promo-sales`, `check-sales-alerts` que corre cada 5 min).
3. `receipts`/`items` de purchases (upsert cada 10 min de ventanas completas):
   confirmar si re-escriben filas idénticas y aplicar mismo patrón condicional.

## FASE 6 — Frontend

1. **Cap 1000 PostgREST**: hay 80 queries sobre tablas grandes (`products`,
   `inventory`, `sales_invoices`, `product_stock_params`, `customers`) —
   concentradas en TabMinMax (21), TabCatalogo (10), FacturacionView (8),
   WidgetInventorySearch (5), SrsEnriquecerModal (5), TabInventario (4).
   Auditar cada una: ¿puede devolver ≥1000 filas? → aplicar Patrón A/B/C del
   CLAUDE.md. Reportar cuáles eran bugs reales vs. falsos positivos.
2. **Bundle restante** (el splitting grueso ya está): `vfs_fonts` 1.8MB
   (fuentes pdfmake — confirmar que solo se carga al imprimir; evaluar subset
   de fuentes), `ort` 386K ×2 variantes (verificar que solo carga una según
   webgpu), `CartesianChart` (recharts) 322K. Total dist/assets: 32MB.
3. **fetchBoot** (`systemSlice.js:128-149`): carga eager holidays, branches,
   roles, shifts, rosters, employees_safe+eventos+documentos, announcements,
   employee_branches. Medir peso real (KB y ms) y diferir lo que solo usan
   vistas específicas (documents/events pueden cargarse al entrar a Personal).
4. **Re-renders en archivos monstruo**: TabMinMax (3,954 líneas), TabPedidos
   (3,914), TabCatalogo (2,999), VentasView (2,487), FacturacionView (2,228),
   DashboardView (2,172). Revisar selectores zustand anchos y memoización.
   NO refactorizar los archivos todavía — solo optimizar selectores y listar
   qué conviene partir.
5. Los 34 TODO/FIXME restantes: clasificar (bug real / mejora / obsoleto).

## FASE 7 — Deuda confirmada de la auditoría 07-08 (verificar si siguen abiertas)

1. RLS de `announcements` desalineada con la app (GLOBAL/BRANCH/EMPLOYEE con
   arrays jsonb vs. policy con 'ALL' y cast a text).
2. "Borrar todas" en NotificationBell solo borra las 100 cargadas.
3. Solicitudes con `approver_id null` invisibles para aprobadores.
4. URL de push hardcodeada ×3 en BD (trigger + notify_employees + notify_branch).
5. Realtime de notifications con logins por carné (auth.uid() ≠ employees.id).

## Reglas duras (no negociables)

- `SET lock_timeout = '5s'` en TODA migración; DDL sobre tablas calientes
  (`sales_invoices`, `sales_invoice_items`, `inventory`, `products`) preferible
  06:00–11:59 UTC (crons duermen). Si falla por lock timeout: reintentar, no
  congeló nada.
- Toda policy que llame funciones `auth_*` va envuelta en `(SELECT ...)`.
- Migraciones vía MCP `apply_migration` (nunca `supabase db push`).
- Cualquier write a prod (dato, DDL, reset de stats, fila de registro): pedir
  mi OK explícito en el momento, uno por uno.
- Bump `APP_VERSION` + changelog en CADA commit; commit + push por fase.
- No romper: flujo de pedidos (dispatch/factores), sync DTE, kiosco, login por
  carné. `LiquidSelect` siempre; `es_antibiotico` = "Bajo Receta"; sin
  border-left de color; texto sobre glass ≥ slate-500/600; toda acción de
  usuario → `appendAuditLog`.

## Entregables

1. **Informe inicial** (antes de tocar nada): tabla de hallazgos verificados con
   severidad, evidencia (EXPLAIN/números), y fix propuesto — incluye lo que
   encuentres ADEMÁS de lo listado.
2. Fixes por fases, un commit por fase, con números antes/después (mean de las
   RPCs, % del decode de Realtime, writes/hora de las tablas de agregados,
   tamaño de job_run_details).
3. Sección nueva en `CLAUDE.md` con las reglas anti-regresión que salgan de
   esto (realtime en tablas calientes, retención de logs desde el día 1 ya
   existe, upserts condicionales en TODO sync — reforzar con los casos nuevos).
4. Al final: `get_advisors` (seguridad debe seguir en 0 errores) +
   `/code-review` del diff de la sesión y resolver lo que salga.
