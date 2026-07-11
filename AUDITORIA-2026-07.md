# AUDITORÍA INTEGRAL — Portal Farmalasa

> Estado: **FASE 0, FASE 1 y FASE 2 completas.** Fases 3-6 (seguridad
> ofensiva/SET ROLE, diseño/UX, pruebas E2E, veredicto estructural) pendientes
> — se ejecutan en la siguiente sesión, a pedido del usuario.
>
> ⚠️ **ALERTA — no esperar al resto de la auditoría para esto**: 11 de las 24
> edge functions revisadas en Fase 2 no tienen ninguna autenticación real
> (ni secreto compartido, ni sesión de usuario válida) — 4 de ellas escriben
> con `service_role` (bypasea RLS por completo), incluyendo
> `consolidate-timesheets` (puede fabricar/alterar datos de nómina) y
> `send-push-notification` (puede enviar pushes reales a cualquier empleado o
> a toda la empresa). Ver sección "Edge functions" de Fase 2 para el detalle
> completo y el fix propuesto por función.
>
> Fecha: 2026-07-10 · Versión app auditada: v2.15.6 · Auditor: Claude (sesión de auditoría)

---

## FASE 0 — Línea base

### CodeGraph
- Index sano: 292 archivos, 3,473 nodos, 7,540 edges, WAL mode, 15.15 MB.

### Build (`npm run build`)
- **Build exitoso** (5.00s), pero **sin code-splitting real**: la mayoría de vistas
  sí generan chunks individuales (Vite los separa por import dinámico de rutas),
  pero persisten **varios chunks gigantes** que dominan el peso inicial:
  - `vfs_fonts-*.js` — **1,863.73 kB** (828 kB gzip) — fuente embebida de **pdfmake**,
    cargada aunque la view actual no imprima nada.
  - `index-0HQh9z_q.js` — 831.71 kB (246.53 kB gzip) — vendor/chunk principal.
  - `index-DSN73KLr.js` — 416.47 kB (109.47 kB gzip).
  - `ort.bundle.min-*.js` + `ort.webgpu.bundle.min-*.js` — **395.51 + 395.53 kB**
    (216 kB gzip combinados) — **onnxruntime, cargado en dos variantes (CPU +
    WebGPU) simultáneamente**, presumiblemente para el escaneo de carné/OCR.
  - `CartesianChart-*.js` — 329.26 kB (recharts) — usado en Dashboard/reportes.
  - `PedidosView-*.js` — 319.36 kB propio (no vendor) — coherente con ser una
    mini-aplicación de 3,900+ líneas (ver Fase 1).
  - Vite emite explícitamente el warning: *"Some chunks are larger than 500 kB
    after minification"* con la sugerencia estándar de `manualChunks`/`dynamic import()`.
  - **Confirmado del hallazgo de la auditoría previa (2026-07-08)**: pdfmake
    (vfs_fonts) y onnxruntime deberían cargar solo bajo demanda (impresión de
    pedidos / escaneo de carné respectivamente), no en el chunk servido a toda
    sesión. Esto sigue sin resolverse.

### Lint (`npm run lint`)
- **2,638 errores, 108 warnings** en todo el repo (`eslint-plugin-react-hooks`
  v6 `recommended`, que desde ~v2.15.4 incluye las reglas nuevas de React
  Compiler: `purity`, `static-components`, `set-state-in-effect`, además de
  `rules-of-hooks`/`exhaustive-deps` y `no-unused-vars`).
- **No es ruido puro**: los v2.15.4-2.15.6 ya corrigieron 2 bugs reales
  encontrados así (`isHiring` sin declarar en `EmployeeDetailView.jsx`, hook
  condicional en `useTimeClockEngine.js`). El resto del volumen (2,638) **no
  se ha revisado archivo por archivo todavía** — ver desglose por regla más
  abajo (categorizado por subagente) y la lista de patrones de riesgo real
  confirmados manualmente.

### Supabase — Advisors de seguridad
**96 hallazgos, 0 ERROR, 0 INFO — todos WARN.**

| Categoría | Cant. | Detalle |
|---|---|---|
| `authenticated_security_definer_function_executable` | 54 | Funciones SECURITY DEFINER invocables por cualquier `authenticated` vía RPC, sin gate adicional de permiso. Incluye `debug_pedido_timings` (parece debug leftover). |
| `rls_policy_always_true` | 34 | Policies INSERT/UPDATE/ALL con `USING (true)`/`WITH CHECK (true)` — ver tabla completa abajo. |
| `extension_in_public` | 2 | `pg_trgm`, `pg_net` instaladas en `public` en vez de un schema dedicado. |
| `public_bucket_allows_listing` | 2 | Buckets `photos` y `product-photos` permiten *listar* objetos, no solo fetch por URL directa. |
| `anon_security_definer_function_executable` | 2 | `get_kiosk_boot_payload`, `get_kiosk_coverage_employees` — coincide con la excepción documentada en CLAUDE.md (kiosco pre-login). |
| `materialized_view_in_api` | 1 | `mv_product_factor` expuesta a anon/authenticated — la regla del proyecto (CLAUDE.md #6) exige revocar y servir solo vía RPC. |
| `auth_leaked_password_protection` | 1 | Protección HaveIBeenPwned deshabilitada en Auth. |

**`rls_policy_always_true` — tablas y policies afectadas (candidatas a
reemplazar por `auth_can_edit_any(...)` por regla de proyecto):**
`attendance` (2), `audit_logs` (2), `branch_documents`, `branch_expenses` (2),
`education_catalog_entries`, `employee_documents`, `employee_events` (2),
`holidays` (2), `kiosk_devices` (3), `minmax_ignored`, `product_locations`,
`products` (auth_update_products), `roles` (2), `sales_payment_confirmations`,
`schedule_coverage`, `shifts` (2), `survey_responses` (2), `timesheets`,
`user_dashboard_prefs` (2), `vacation_plan_headers` (2), `ventas_perdidas` (2).

> Nota importante: el advisor de seguridad **no reporta ningún
> `auth_rls_initplan`** (el patrón "auth_* sin `(SELECT ...)`" del incidente
> 2026-07-08) — esa categoría es de *performance*, no *security*, en la
> taxonomía de Supabase. Ver advisor de performance abajo: tampoco aparece ahí
> ahora mismo, lo cual sugiere que el hardening post-incidente se sostuvo. Se
> revalidará con una query directa a `pg_policies` en Fase 2.

### Supabase — Advisors de performance
**115 hallazgos: 0 ERROR, 7 WARN, 108 INFO.**

- **`multiple_permissive_policies` (7, WARN)** — `ruta_locations` tiene 2
  policies permisivas para el mismo SELECT en 5 roles distintos (`anon`,
  `authenticated`, `authenticator`, `cli_login_postgres`,
  `supabase_privileged_role`) — cada policy extra se evalúa siempre, costo
  duplicado en cada lectura. `practicantes` tiene el mismo problema en
  `authenticated`.
- **`unindexed_foreign_keys` (19, INFO)** — **ninguna cae en las tablas
  calientes** (`sales_invoices`, `sales_invoice_items`, `inventory`, `products`,
  `dte_sales`, `employees`, `timesheets`, `employee_events`) — son todas de
  tablas operativas de menor tráfico (`pedido_items`, `conteos_inventario`,
  `pedido_pausa_historial`, `rutas`, `practicantes`, etc.). Prioridad media,
  no urgente.
- **`unused_index` (88, INFO)** — incluye índices sobre tablas calientes con
  escritura constante: `sales_invoices.sales_invoices_customer_id_idx`,
  `sales_invoice_items.idx_sii_id_presentacion`,
  `employees.idx_employees_secondary_role`, `employees.idx_employees_shift`,
  `employee_events.idx_events_emp_date`, `timesheets.idx_timesheets_shift`,
  `products.idx_products_oculto_por`. Cada índice no usado en tablas que los
  crons reescriben constantemente es **overhead de escritura puro** — candidato
  directo a `DROP INDEX` (con `lock_timeout='5s'`, ventana 06:00-11:59 UTC).

### Tamaño de tablas y salud de autovacuum
| Tabla | Tamaño | Filas vivas | Dead rows | Último autovacuum |
|---|---|---|---|---|
| `sales_invoices` | 371 MB | 323,325 | 615 | **2026-05-27** (6 semanas atrás) |
| `sales_invoice_items` | 275 MB | 551,070 | 0 | 2026-07-09 |
| `job_run_details` (pg_cron) | 129 MB | 216,939 | 0 | nunca |
| `sync_log` | 65 MB | 400,686 | 0 | 2026-07-04 |
| `product_sales_monthly_agg` | 53 MB | 126,859 | 0 | 2026-07-09 |
| `inventory_sync_log` | 41 MB | 468,365 | 0 | 2026-07-04 |
| `inventory` | 28 MB | 23,860 | 236 | 2026-07-08 |
| `products` | 19 MB | 5,170 | 34 | 2026-07-10 |

`sales_invoices` no recibe autovacuum hace 6 semanas — con solo 615 dead rows
sobre 323K no es alarmante todavía (el patrón de escritura es
mayormente INSERT, no UPDATE), pero es la tabla más grande y más caliente del
sistema: vale la pena bajar el umbral de `autovacuum_vacuum_scale_factor` para
esta tabla específicamente en vez de confiar en el default. `job_run_details`
(129 MB, cron interno de pg_cron) nunca tuvo autovacuum — su purga vía
`purge-sync-logs-daily` (14 días) sí existe y corre, pero el bloat de la tabla
en sí no se compacta solo con DELETE.

### pg_stat_statements — top queries por tiempo total
| Query | Calls | Total ms | % del total |
|---|---|---|---|
| WAL decode (`wal->>...`) — **Realtime** | 141,640 | 1,468,195 ms | **26.7%** |
| RPC `sync_inventory_batch`-like (json_to_record `p_erp_sucursal_id`,`p_is...`) | 14,294 | 813,563 ms | 14.8% |
| `refresh_product_sales_monthly_agg()` | 30 | 266,733 ms | 4.8% (**8.9s/call**) |
| `refresh_inventory_grouped_mv()` | 894 | 263,380 ms | 4.8% |
| INSERT `products` (upsert-por-fila desde sync) | 24,426 | 164,254 ms | 3.0% |

**Hallazgo destacado**: la decodificación de WAL de Realtime es **el mayor
consumidor de tiempo de CPU de toda la base de datos (26.7%)**, con 141,640
llamadas — esto es el mismo mecanismo que ya causó CPU spikes documentados en
el incidente 2026-07-08 (`project_outage_20260708_rls_hot_tables`). Solo 11
tablas están en la publicación `supabase_realtime`: `announcements`,
`notifications`, `pedido_item_eventos`, `pedido_sucursal_status`, `pedidos`,
`product_stock_params`, `role_permissions`, `ruta_locations`, `ruta_pedidos`,
`rutas`, `stock_config`. Con los crons de sync/inventario escribiendo cada
minuto sobre `pedido_sucursal_status`/`pedidos`/`product_stock_params`, cada
escritura dispara un ciclo de decode para todos los suscriptores — este es un
candidato fuerte para revisión en Fase 2 (¿todas esas tablas necesitan
Realtime, o algunas pueden moverse a polling/broadcast manual?).

`refresh_product_sales_monthly_agg()` a 8.9s por ejecución, corriendo cada
hora en horario activo (`refresh-product-sales-monthly-agg`, `7 12-23,0-5 * * *`),
es la función SQL individual más cara del sistema — candidato a revisar el plan
o materializar de forma incremental en Fase 2.

### Cron jobs (pg_cron)
**40 jobs activos.** Confirma el patrón de CLAUDE.md: 6 sucursales × 2 jobs
`sync-dte-sales` cada una (`dte-*-hora` cada hora completa + `dte-*-min` **cada
minuto**, 12-23,0-5) + 7 jobs `sync-inv-sucN-1min` (**cada minuto**, mismo
horario) + `refresh-inv-mv-2min` (cada 2 min) + `refresh-sales-daily-stats`
(cada 15 min) + `heal-dte-sync` (cada 2h) + `sync-products`/`sync-erp-purchases`
(cada 10 min) + 2 jobs `vacuum-inventory-hourly`/`vacuum-products-hourly`
(a los :50/:40 de cada hora activa — mitigación manual del incidente pasado).

**Hallazgo — secreto compartido en texto plano en `cron.job.command`**: la
gran mayoría de los jobs (`dte-*`, `sync-*`, `check-*`, `notify-*`,
`apply-scheduled-employee-events`, `backup-critical-tables`, etc.) incrustan
literalmente `Authorization: Bearer 4bc494d9478b36be66d41a59cd937ecc3ec7321eee3cd6695664cbc98e8e4e56`
— el mismo token repetido en **~25 jobs distintos**, visible en texto plano
para cualquiera con `SELECT` sobre `cron.job` (normalmente solo `postgres`/
superuser, pero es una mala práctica: un solo `SELECT * FROM cron.job` filtra
el secreto completo). Debería vivir en Supabase Vault (`vault.decrypted_secrets`)
y resolverse con `current_setting()`/`vault.create_secret` en vez de estar
hardcodeado en 25 lugares — coincide y amplía el hallazgo previo de "URL de
push hardcodeada ×3".

Adicionalmente: `auto-copy-weekly-roster` (×2 jobs) usa el **JWT `anon` completo**
como Bearer en vez del secreto propio — funciona porque la función tiene
`verify_jwt: true` y el JWT anon es válido, pero es inconsistente con el resto
de los jobs.

Los jobs `dte-resync-month-*` (5 sucursales, backfill mensual) **no llevan
ningún header `Authorization`** — solo `Content-Type`. La función
`backfill-dte-sales` tiene `verify_jwt: false` en `list_edge_functions`, así
que si no valida un secreto internamente en el código, **es invocable sin
ninguna autenticación por cualquiera que tenga la URL** — a confirmar leyendo
el código de la función en Fase 2 (Auditoría de Supabase).

**Retención de logs**: `purge-sync-logs-daily` sí purga `sync_log`,
`inventory_sync_log` (90 días) y `cron.job_run_details` (14 días) — correcto
por diseño. `purge-notifications-daily` purga `notifications` a 90 días.
`audit_logs` **no tiene ninguna política de purga** — crecerá indefinidamente
(hoy 10,339 filas, 7 MB — no urgente, pero falta la política "desde el día 1"
que exige CLAUDE.md #7 para tablas de log/historial; nota: `audit_logs` es
"historial de negocio" tipo auditoría, así que según la misma regla podría ser
intencional que NO se purgue — a decidir explícitamente).

### Edge functions
**31 funciones activas.** **18 de 31 tienen `verify_jwt: false`**
(`ensure_user_by_code`, `set-employee-password`, `bulk-create-employee-users`,
`check-doc-expiry`, `consolidate-timesheets`, `sync-dte-sales`,
`backfill-dte-sales`, `sync-products`, `heal-dte-sync`, `oss-proxy`,
`sync-erp-minmax`, `sync-erp-purchases`, `sync-promo-sales`,
`check-sales-alerts`, `disable-employee-auth`,
`apply-scheduled-employee-events`, `backup-critical-tables`,
`check-employee-doc-expiry`). Muchas son cron-only y correcto que no exijan
JWT de usuario — pero **`set-employee-password`, `bulk-create-employee-users`
y `disable-employee-auth` mutan credenciales/acceso de empleados**: si no
validan un secreto interno o sesión de admin dentro del código, son candidatas
a **IDOR/privilege-escalation crítico** (cualquiera podría resetear la
contraseña de cualquier empleado sin autenticarse). **Esto es el primer punto
a verificar al abrir Fase 2** — no se leyó el código de estas 3 funciones
todavía en esta sesión, solo se confirmó la config `verify_jwt: false` desde
el listado de funciones.

### Storage buckets
| Bucket | Público | `file_size_limit` | `allowed_mime_types` |
|---|---|---|---|
| `backups` | privado | ❌ ninguno | ❌ ninguno |
| `documents` | privado | 10 MB | pdf/jpeg/png/webp |
| `empleados` | privado | 10 MB | jpeg/png/webp/gif |
| `payment-proofs` | privado | 10 MB | jpeg/png/webp/pdf |
| **`photos`** | **público** | ❌ **ninguno** | ❌ **ninguno** |
| `product-photos` | público | 10 MB | jpeg/png/webp |

`photos` es público por diseño (CLAUDE.md lo permite explícitamente), pero es
el **único bucket sin `file_size_limit` ni `allowed_mime_types`** — cualquier
cuenta autenticada puede subir un archivo de cualquier tipo y tamaño a un
bucket público. Comparado con `product-photos` (mismo propósito, límites
correctos), es una inconsistencia clara y fácil de cerrar.

---

## FASE 1 — Auditoría de código (src/)

### Tamaño del código y "mini-aplicaciones"
214 archivos `.js`/`.jsx` en `src/`, 96,213 líneas totales. Archivos >1,000 líneas:

| Archivo | Líneas |
|---|---|
| `src/views/productos/TabMinMax.jsx` | 3,954 |
| `src/views/pedidos/TabPedidos.jsx` | 3,914 |
| `src/views/productos/TabCatalogo.jsx` | 2,999 |
| `src/views/VentasView.jsx` | 2,487 |
| `src/components/forms/EmployeeFormModal.jsx` | 2,249 |
| `src/views/FacturacionView.jsx` | 2,228 |
| `src/views/DashboardView.jsx` | 2,172 |
| `src/views/AttendanceAuditView.jsx` | 1,522 |
| `src/views/EncuestaView.jsx` | 1,507 |
| `src/store/slices/systemSlice.js` | 1,432 |
| `src/views/EncuestaAdminView.jsx` | 1,361 |
| `src/views/employee/EmployeeRequestsView.jsx` | 1,332 |
| `src/views/pedidos/RecepcionModal.jsx` | 1,311 |
| `src/store/slices/employeeSlice.js` | 1,263 |
| `src/views/EmployeeDetailView.jsx` | 1,260 |
| `src/views/CotizacionesView.jsx` | 1,155 |
| `src/hooks/useTimeClockEngine.js` | 1,150 |
| `src/views/VacationPlanView.jsx` | 1,146 |
| `src/views/PermissionsView.jsx` | 1,115 |
| `src/components/layout/AppLayout.jsx` | 1,114 |
| `src/views/dashboard/WidgetAnnulmentRequest.jsx` | 1,045 |
| `src/views/StaffManagementView.jsx` | 1,039 |
| `src/store/slices/requestsSlice.js` | 1,013 |

24 archivos superan las 1,000 líneas; los dos primeros (`TabMinMax`,
`TabPedidos`) rondan las 4,000 — funcionalmente son aplicaciones completas
dentro de un solo archivo (fetch, validación, UI, drag&drop de tabs, print,
notificaciones). Detalle de por qué esto es un problema estructural real (no
solo estético) se cubre en Fase 6, pero se deja registrado aquí como dato duro.

### Cumplimiento de la regla 1000 filas de PostgREST (CLAUDE.md)
Grep exhaustivo de `.from('products'|'inventory'|'dte_sales'|'sales_invoices'|'product_stock_params')`
sin `.range()`/`.limit()`/`head:true` en la misma línea: ~70 coincidencias
crudas. La mayoría son falsos positivos verificados manualmente (updates de
una sola fila por `.eq('id', ...)`, counts `head:true`, o selects ya
envueltos en el helper `fetchAllRows` — ver `TabInventario.jsx` como ejemplo
correcto). **Pero se confirmaron 4 violaciones reales, sin paginar, sobre
tablas por encima del límite de 1000 filas:**

1. **`src/views/FacturacionView.jsx:248-256`** (`loadData`) — `sales_invoices`
   filtrado por `estado NULA/null/undefined`, sin `.range()`. Tabla tiene
   323K filas; si el backlog de facturas con estado nulo/NULA supera 1000, se
   trunca en silencio — justo la vista de Facturación donde eso importa.
2. **`src/views/FacturacionView.jsx:736-751`** (`qPend`/segundo `loadData`) —
   `sales_invoices` filtrado por `recibido_mh IS NULL`, sin `.range()`. Mismo
   riesgo: si el backlog de pendientes de Hacienda crece, se corta en 1000.
3. **`src/views/VentasView.jsx:503-513`** — `sales_invoices` filtrado por
   rango de fechas (`gte/lte fecha`), **sin `.range()`**. Con 323K filas
   históricas y una cadena de farmacias de alto volumen, un rango de un mes
   puede superar fácilmente 1000 facturas — esta es la vista de reportes de
   Ventas, el caso de uso exacto que la regla del CLAUDE.md fue escrita para
   prevenir.
4. **`src/views/dashboard/WidgetInventorySearch.jsx:410`** —
   `.from('products').select('nombre, foto_url').not('foto_url','is',null)`
   **sin ningún límite**, sobre una tabla de 5,170 filas (`products` está
   explícitamente en la lista "REQUIERE paginación" del propio CLAUDE.md). Si
   más de 1,000 productos tienen foto (plausible), el mapa de fotos usado
   para resolver imágenes en el widget de búsqueda del dashboard queda
   incompleto en silencio.

Recomendación: aplicar Patrón A/B/C de CLAUDE.md a las 4 (rango de fechas +
`.range()` con chunking en los dos primeros/VentasView; Patrón C con RPC
`json_agg` o simplemente un `.select('nombre,foto_url')` acotado por lote de
IDs en WidgetInventorySearch). El resto de los ~66 hits del grep no requieren
acción — quedan documentados como revisados.

### `const { data } = await supabase...` sin chequear `error` (CLAUDE.md — regla anti-incidente `presentaciones.descripcion`)
**35 ocurrencias en 18 archivos**, confirmado con muestreo manual (no son
falsos positivos — el patrón es literal, `error` nunca se destructura ni se
revisa):
`src/utils/pedidoPrint.js`, `src/components/common/SidebarSyncStatus.jsx`,
`src/components/inventario/NuevoConteoModal.jsx`, `src/views/EncuestaAdminView.jsx`,
`src/views/FacturacionView.jsx`, `src/views/VentasPperdidasView.jsx`,
`src/views/MinMaxView.jsx`, `src/components/common/SyncHealthBanner.jsx`,
`src/views/VentasView.jsx`, `src/views/CotizacionesView.jsx`,
`src/views/pedidos/RecepcionModal.jsx`, `src/views/pedidos/TabPedidos.jsx`,
`src/views/promociones/PromoModal.jsx`, `src/views/EmployeeDetailView.jsx`,
`src/views/productos/TabCatalogo.jsx`, `src/views/inventario/ConteoDetailView.jsx`,
`src/store/slices/requestsSlice.js`, `src/store/slices/payrollSlice.js`.

Confirmado en `requestsSlice.js:80,509` (`.from('employees').select('id')` —
resolución de aprobador/empleado, silenciosamente `null` si falla) y
`payrollSlice.js:321` (`overtime_bank` — cálculo de nómina). Esto es
exactamente el patrón que causó el incidente documentado de
`presentaciones.descripcion` (columna eliminada, el sync la siguió
consultando un mes entero fallando en silencio). Cada una de estas 35 líneas
puede dejar Maps/lookups vacíos sin ningún indicio en la UI — requiere
revisión línea por línea en la siguiente fase (no se puede afirmar que las 35
sean bugs activos hoy, solo que las 35 violan el patrón obligatorio y son
ciegas por diseño).

### Gaps de features (código huérfano, no dead code — backend completo, sin UI)
- **`TabPedidos.jsx:3012` (`handleCorregirBodega`) y `:3024`
  (`handleConfirmarCorreccion`)** — **confirmado, sigue sin resolver** (ya
  documentado en memoria desde v2.15.5, sin cambios desde entonces): ambos
  handlers están completos y funcionales, pero **cero call sites** — ningún
  botón/onClick los invoca en toda la vista. El backend (columnas + RPC
  `20260621_pedidos_diferencias_correccion_workflow.sql`) existe desde hace
  semanas. La notificación push a bodega literalmente le dice al usuario
  "revisá y marcalo como corregido" sin que exista dónde hacerlo en la UI.
  Pendiente de decisión de producto (dónde va el botón/modal).

### Código muerto ya resuelto (verificado, no reabrir)
`src/components/layout/AdminLayout.jsx` y `EmployeeLayout.jsx` — confirmado
que **ya no existen** en el árbol de archivos y no hay imports activos (solo
se mencionan en el changelog de `src/version.js`). El hallazgo de la auditoría
previa (2026-07-08) sobre estos dos archivos está resuelto — no incluir en el
roadmap de esta auditoría.

### Cumplimiento de patrones de diseño (vista por vista, cruce con Fase 4 pendiente)
- **`<select>` nativo en vez de `LiquidSelect`** (regla dura de CLAUDE.md/DESIGN.md
  §1, "nunca") — **8 archivos** con selects nativos reales confirmados:
  `src/views/AuditView.jsx:489`, `src/views/AnnouncementsView.jsx:650,651`,
  `src/views/ComprasView.jsx:404`, `src/views/EncuestaView.jsx:596`,
  `src/components/common/TimePicker12.jsx:68,84,98`,
  `src/components/forms/FormAiSchedulerPreview.jsx:326,387`,
  `src/components/timeclock/EarlyExitForm.jsx:70`,
  `src/components/forms/FormTurnos.jsx:266,331,340`. `TimePicker12` podría ser
  un caso límite (selector de hora custom) a evaluar en Fase 4, pero
  `AnnouncementsView` (selector de sucursal/cargo destinatario) y
  `ComprasView`/`AuditView`/`EncuestaView`/`FormTurnos` son violaciones
  directas de un patrón "nunca" documentado.
- **`ViewTabBar` bypaseado por tabs hechas a mano** — 5 vistas grandes
  implementan su propio tab bar en vez de usar el componente compartido:
  `RolesView.jsx`, `EmployeeDetailView.jsx`, `FacturacionView.jsx`,
  `BranchDetailView.jsx`, `VentasView.jsx` (esta última es además la
  "referencia" citada en DESIGN.md §17 para filter pills — su propio tab bar
  no sigue el patrón que DESIGN.md documenta para el resto del sistema).
  Verificado manualmente (no falso positivo): las 5 tienen `activeTab`/
  `tab.key` con estilos condicionales inline en vez de `<ViewTabBar>`.
- `DataTable`: 19 archivos lo usan. `LiquidSelect`: 47 archivos. `appendAuditLog`:
  20 archivos. (Sin un inventario de "toda acción de usuario debería auditar"
  no se puede afirmar cobertura completa — queda para Fase 4/6, cruzar con
  botones de mutación por vista).

### Listeners / cleanup de efectos
Heurística `addEventListener` vs `removeEventListener` por archivo: solo 4
archivos con desbalance aparente, **verificados manualmente los 2 relevantes
— ambos son falsos positivos, cleanup correcto**:
- `LiquidSelect.jsx` — `useEffect` en línea 120 registra `mousedown`+`keydown`
  y los limpia correctamente en el `return` (línea 142-144); el "add" extra
  que activó la heurística es una mención en comentario, no código real.
- `NotificationBell.jsx` — mismo patrón, `mousedown`+`keydown` con cleanup
  correcto (línea 220-226).
- `main.jsx`/`version.js` — listeners de ciclo de vida de la app completa
  (no necesitan cleanup) / coincidencia en comentario de changelog.

Ningún `setInterval` sin `clearInterval` correspondiente en el mismo archivo.
No se detectaron memory leaks de listeners/timers con esta pasada — nota: esto
es una heurística de archivo único, no atrapa leaks cross-file (hook que
registra, componente padre que debería limpiar). Fase 4/6 puede profundizar
si aparece evidencia en las pruebas E2E.

### TODOs
36 ocurrencias de `TODO`/`FIXME` en `src/` + `supabase/functions/` — sin
clasificar todavía (bug real / mejora / obsoleto). Pendiente para el barrido
de calidad de una fase posterior.

### Errores de lint — reglas de riesgo real vs. cosmético

**Hallazgo raíz, previo a cualquier regla individual**: `eslint.config.js`
solo tiene `globalIgnores(['dist'])` — **no excluye `android/`, `ios/` ni
`.agents/`**. Esas carpetas contienen bundles Capacitor minificados
(`android/.../assets/*.js`, `ios/.../public/assets/*.js`, duplicados en ambas
plataformas) y scripts de terceros vendorizados (`.agents/skills/impeccable/scripts/*.js`).
**2,367 de los 2,746 problemas totales (86%) son ruido de lint corriendo sobre
código minificado/vendorizado**, no bugs de la app: prácticamente el 100% de
`no-redeclare` (492), `no-prototype-builtins` (298), `no-unsafe-finally` (196),
`no-cond-assign` (142), `no-fallthrough` (120), `no-func-assign` (88), etc.
vienen de ahí. **Fix de una línea con alto impacto**: agregar
`globalIgnores(['dist', 'android', 'ios', '.agents'])` — el conteo real baja
de 2,746 a **379**, que es el número que importa para esta auditoría.

**379 problemas reales en `src/`, `public/`, `api/`, desglosados por regla:**

| Regla | Cant. | Tipo |
|---|---|---|
| `no-unused-vars` | 107 | cosmético/dead-code |
| `react-hooks/exhaustive-deps` | 89 | riesgo real (52 con "missing dep" genuino) |
| `react-hooks/set-state-in-effect` | 65 | riesgo real |
| `no-empty` | 37 | cosmético (pero ver nota `DashboardView` abajo) |
| `Unused eslint-disable directive` | 19 | cosmético |
| `react-hooks/preserve-manual-memoization` | 18 | síntoma (co-ocurre con las reglas de arriba) |
| `react-refresh/only-export-components` | 8 | cosmético (higiene de Vite fast-refresh) |
| `react-hooks/purity` | 8 | riesgo real |
| `no-useless-escape` | 6 | cosmético |
| `no-undef` | 5 | gap de config (`Buffer`/`clients` sin `globals` correcto en `api/oss-proxy.js`, `public/sw.js`) |
| `react-hooks/static-components` | 5 | riesgo real |
| `react-hooks/immutability` | 4 | riesgo real |
| `react-hooks/refs` | 2 | riesgo real |
| `react-hooks/rules-of-hooks` | 0 (en `src/`) | — |

**Total riesgo real: 173 ocurrencias** (`set-state-in-effect` + `exhaustive-deps`
+ `purity` + `static-components` + `immutability` + `refs`).

#### `react-hooks/set-state-in-effect` (65) — setState síncrono dentro de un efecto
Patrón repetido en **todo el codebase**, no aislado: `FacturacionView.jsx` (7
ocurrencias — líneas 283, 329, 721, 805, 1186, 1627, 1650, 1670),
`VentasView.jsx` (7 — 357, 591-593, 960, 987), `ComprasView.jsx` (4),
`AppLayout.jsx` (2), y single hits en 40+ archivos más (`BranchChips.jsx:73`,
`ConfirmModal.jsx:25`, `LiquidSelect.jsx:238`, `PermissionsView.jsx:463`,
`RequestsView.jsx:493`, `StaffManagementView.jsx:571`,
`EmployeeRequestsView.jsx:410,586`, `TabPedidos.jsx:836`,
`TabLaboratorios.jsx:68,327`, `TabBonificaciones.jsx:142`,
`TabHistorial.jsx:53`, `TabPromos.jsx:279`, `InlineDayEditor.jsx:194,223`,
entre otros). La densidad y dispersión de este patrón (65 sitios en 45+
archivos distintos) es evidencia directa de un problema de arquitectura, no
de descuido puntual — ver Fase 6 ("cada vista reinventa su propio fetch").

#### `react-hooks/purity` (8) — función impura (`Date.now()`) llamada durante el render
```
src/components/common/NotificationBell.jsx:161
src/components/common/SidebarSyncStatus.jsx:49
src/components/common/SyncHealthBanner.jsx:57
src/components/forms/FormNovedad.jsx:626
src/views/VentasView.jsx:1329
src/views/VentasView.jsx:1361
src/views/productos/TabMinMax.jsx:1094   ← badge "días para vencer"
src/views/productos/TabSinVenta.jsx:207  ← "última venta hace N días"
```
Los dos de `TabMinMax`/`TabSinVenta` afectan directamente badges de negocio
(vencimiento, última venta) que pueden quedar visualmente desincronizados
entre renders sin que nada los refresque.

#### `react-hooks/static-components` (5) — componente creado dentro del render
```
src/components/common/EmployeeDocumentsList.jsx:23
src/views/productos/TabCatalogo.jsx:2305, 2306, 2307, 2309   ← CompatTh, ver nota abajo
```

#### `react-hooks/immutability` (4) y `react-hooks/refs` (2)
```
src/views/DashboardView.jsx:511   — variable accedida antes de declararse (TDZ-adyacente)
src/views/DashboardView.jsx:628, 629 — valor "render-owned" mutado
src/views/VacationPlanView.jsx:202 — variable reasignada después de terminar el render
src/views/employee/EmployeeAnnouncementsView.jsx:222, 224 — ref leída durante el render (debería leerse solo en efectos/handlers)
```

#### `react-hooks/exhaustive-deps` (89, de las cuales ~52 parecen stale-closure real)
Concentradas en: `AttendanceAuditView.jsx` (7), `RequestsView.jsx` (3),
`VentasView.jsx` (3), `FacturacionView.jsx` (3), `BranchChips.jsx` (3),
`AppLayout.jsx` (3), `EncuestaAdminView.jsx` (2), `PayrollView.jsx` (2),
`VacationPlanView.jsx` (3), y single hits dispersos en ~35 archivos más
(lista completa con `archivo:línea` disponible en el detalle del lint
categorizado — ej. `EmployeeFormModal.jsx:451` falta `formData.kiosk_pin`,
`useTimeClockEngine.js:1038` falta `earlyPendingData?.actualTime`,
`RequestsView.jsx:515,525` falta `canApprove`/`fetchRequests`/`getScope`/
`user?.branchId`/`user?.id` — este último es el más preocupante: un efecto de
aprobación de solicitudes que no reacciona a cambios de usuario/scope).

#### `no-empty` (37) — bloques catch/if vacíos
`DashboardView.jsx` concentra **25 de los 37** (líneas 365-1076) — muy
probablemente `catch {}` silenciosos alrededor de fetches del dashboard.
Combinado con los 35 `const { data } = await supabase` sin chequear `error`
ya documentados arriba, esto refuerza que **el manejo de errores de cara al
usuario en `DashboardView.jsx` es sistemáticamente ausente**, no un caso
aislado — candidato fuerte para revisión dedicada en la continuación de
Fase 1 / Fase 6.

#### `no-unused-vars` (107) — funciones completas huérfanas (no solo variables sueltas)
Además de `TabPedidos.jsx:3012,3024` (`handleCorregirBodega`/
`handleConfirmarCorreccion`, ya documentado arriba):
- **`src/views/productos/TabMinMax.jsx:1735` — `saveHiddenTimer`**: variable
  que guarda una referencia a un timer, asignada pero nunca leída ni
  limpiada — **posible timer fugado** (leak), no dead code cosmético. Merece
  verificación directa antes de simplemente borrar la variable.
- `TabMinMax.jsx:750` — `getBreakdown`, función de desglose completa sin
  ningún caller.
- `TabMinMax.jsx:1911` — `handleEditSave`, handler de guardado sin control
  que lo invoque.
- `src/views/pedidos/RecepcionModal.jsx:439` — `handleTodoOk` ("marcar todo
  OK" en recepción), sin caller — posible botón faltante.
- `src/components/srs/SrsBuscadorWidget.jsx:5` — `fetchSrs`, función de
  búsqueda SRS definida pero nunca invocada en este widget.

Por archivo, la mayor concentración está en los mismos archivos-monstruo:
`TabMinMax.jsx` (19), `TabPedidos.jsx` (16), `TabCatalogo.jsx` (11),
`VentasView.jsx` (8).

#### Top 10 archivos por total de problemas reales (errores+warnings)
```
30  src/views/DashboardView.jsx
27  src/views/pedidos/TabPedidos.jsx
24  src/views/VentasView.jsx
21  src/views/FacturacionView.jsx
21  src/views/productos/TabCatalogo.jsx
21  src/views/productos/TabMinMax.jsx
17  src/views/AttendanceAuditView.jsx
 8  src/components/common/BranchChips.jsx
 8  src/views/EncuestaAdminView.jsx
 8  src/views/employee/EmployeeAnnouncementsView.jsx
```
Los mismos 6-7 archivos dominan casi todas las categorías de esta auditoría
(monster files, top lint offenders, hot-table selects) — no es coincidencia,
es la firma de "vista como mini-aplicación" que se trata en Fase 6.

Confirmado manualmente durante esta sesión (además de lo listado por el
categorizador automático):
- **`src/views/productos/TabCatalogo.jsx:2289-2309`** — `CompatTh` (helper de
  `<th>` para modo "Compat") se declara **dentro** del render de la tabla y se
  usa 4 veces por fila renderizada — React Compiler lo marca `error` porque
  recrea el componente en cada render, reseteando su estado interno cada vez.
  Nota: coincide con el área ya marcada como "dead code Aurora/Compat" en
  memoria del proyecto (`project_devolutivo_nd_redesign`) — antes de arreglar
  esto vale la pena confirmar si el modo "Compat" sigue vivo o si el bloque
  entero es candidato a borrado.
- **`src/views/productos/TabMinMax.jsx:1094`** y
  **`src/views/productos/TabSinVenta.jsx:207`** — `Date.now()`/`new Date()`
  llamado directamente dentro del render (no en un hook/efecto) para calcular
  días restantes — React Compiler lo marca porque el valor puede quedar
  desincronizado entre renders sin que nada dispare un re-render nuevo
  (el badge "días para vencer" puede quedar visualmente congelado).
- **6 ocurrencias de `useEffect(() => { load(); }, [load])`** disparando
  `setState` síncrono dentro del efecto nada más montar
  (`TabLaboratorios.jsx:68`, `TabBonificaciones.jsx:142`, `TabHistorial.jsx:53`,
  `TabPromos.jsx:279`, y 2 más en `InlineDayEditor.jsx`/`ScheduleCalendar.jsx`
  con setState de posición) — patrón repetido en todo `views/promociones/` y
  `views/productos/`, consistente con "cada vista reinventa su propio fetch"
  (ver Fase 6).
- **`TabMinMax.jsx`** concentra la mayor densidad de `no-unused-vars`
  (`fadeUp`, `relativeTime`, `getBreakdown`, `handleEditSave`, `lastCalcAt`,
  `criticalAOut`, `criticalABelow`, `hasActiveData`, `hideFiltered`, `dispMin`,
  `dispMax`, `hasPres`, `applyRule` — 13 variables/funciones completas sin
  usar) — varias de estas (`getBreakdown`, `handleEditSave`) son funciones
  completas huérfanas, no solo variables sueltas: indicio de features a medio
  desconectar en el archivo de 3,954 líneas más grande del repo.

---

## FASE 2 — Auditoría de Supabase (BD + edge functions)

### RLS — línea por línea (211 policies, las 96 tablas públicas)

**Cobertura de RLS**: **las 96 tablas de `public` tienen RLS habilitado, sin
excepción** (`relrowsecurity = true` en las 96, verificado directo contra
`pg_class`) — no hay ninguna tabla expuesta sin RLS. Buena base.

**Wrapper `(SELECT ...)` en llamadas `auth_*`/`auth.uid()`/`auth.jwt()`**
(el patrón exacto del incidente 2026-07-08): de **257 llamadas a funciones
`auth_*` encontradas en el texto de las 211 policies, 253 están correctamente
envueltas — pero 4 NO**, y las 4 caen en la misma tabla:

```
notifications_delete  (DELETE, authenticated)  QUAL:   (recipient_id = auth_employee_id())
notifications_select  (SELECT, authenticated)  QUAL:   (recipient_id = auth_employee_id())
notifications_update  (UPDATE, authenticated)  QUAL:   (recipient_id = auth_employee_id())
notifications_update  (UPDATE, authenticated)  CHECK:  (recipient_id = auth_employee_id())
```

**Esto es una reintroducción directa del patrón que causó el incidente**,
sobre una tabla que además está en la publicación `supabase_realtime` (Fase
0) — cada lectura/suscripción a `notifications` re-evalúa
`auth_employee_id()` por fila en vez de una sola vez. `notifications` es
pequeña hoy (no aparece en el top-25 de tablas por tamaño), así que el costo
actual es bajo, pero es exactamente el tipo de regresión silenciosa que ya
costó un outage — **corregir a `(recipient_id = (SELECT auth_employee_id()))`
en las 3 policies antes de que la tabla crezca.**

**`USING (true)` / `WITH CHECK (true)`**: confirmadas las 34 del advisor de
Fase 0 (tabla completa ya listada ahí). Cruce adicional hecho en esta fase —
**políticas con rol `anon` (no solo `authenticated`) y condición
incondicional**, que es el subconjunto de mayor riesgo real porque no
requiere ninguna sesión válida:

| Tabla | Policy | Cmd | Condición | Riesgo |
|---|---|---|---|---|
| `attendance` | `attendance_insert_anon` | INSERT | `CHECK: true` | **Alto** — cualquiera con la anon key pública puede insertar marcaciones de asistencia falsas para cualquier `employee_id`. Verificado: no existe trigger `BEFORE INSERT` de validación en `attendance` (solo un `AFTER INSERT` de lifecycle de pedidos, no de seguridad); el código cliente actual no parece usar esta vía (el flujo de kiosco pasa por `ensure_user_by_code` y queda `authenticated`), lo que sugiere que es una policy **obsoleta/heredada de un diseño pre-login-kiosco** que nadie retiró. |
| `audit_logs` | `kiosk_insert` | INSERT | `CHECK: true` | **Alto** — mismo problema: cualquiera puede insertar entradas de auditoría arbitrarias/falsas en el log de auditoría. |
| `kiosk_devices` | `kiosk_register` | INSERT | `CHECK: true` | Medio — registro de dispositivos kiosco sin ninguna validación de token a nivel RLS (la validación real, si existe, vive dentro de `get_kiosk_boot_payload`, no aquí). |
| `kiosk_devices` | `kiosk_verify` | SELECT | `QUAL: true` | Bajo-medio — lectura completa de la tabla de dispositivos kiosco sin autenticación. |
| `branches`, `roles`, `shifts`, `holidays` | `read_all`/`kiosk_read` | SELECT | `QUAL: true` (anon+authenticated) | Bajo — catálogos de referencia (nombres de sucursal, roles, turnos, feriados), exposición aceptable por diseño (necesarios para el login por carné antes de autenticar). |

**Acción recomendada**: revisar `attendance_insert_anon` y `kiosk_insert`
específicamente — si el flujo real ya no las usa (kiosco pasa por sesión
`authenticated` desde `ensure_user_by_code`), son candidatas a **eliminar**,
no solo a restringir; una policy `anon`+`true` sin ningún caller legítimo es
pura superficie de ataque sin beneficio.

**`multiple_permissive_policies` (del advisor de Fase 0) — investigado**:
`ruta_locations_write` (ALL, `auth_has_module_permission('pedidos_tab_rutas','can_edit')`)
y `ruta_locations_select` (SELECT, `can_view`+scope) se solapan en SELECT
para usuarios con `can_edit` — **no es un hueco de seguridad** (ambas
resuelven correctamente contra el empleado autenticado vía `auth_*`), es
puramente el costo de evaluar dos policies permisivas en vez de una — mismo
diagnóstico para `practicantes_write`/`practicantes_select`. Fix: fusionar
en una sola policy por comando.

### `announcements` — el bug sospechado en la auditoría previa: confirmado RESUELTO
La nota de sesión previa (2026-07-08) sospechaba que la policy de
`announcements` comparaba `target_type='ALL'` contra `target_value::text`
escalar mientras la app escribe arrays jsonb. **Se leyó la policy actual
completa y el código fuente que la alimenta**: `announcements_audience`
(SELECT) maneja correctamente `GLOBAL`/`BRANCH` (`target_value` es escalar
para estos dos por diseño, confirmado en `src/utils/announcementAudience.js:4`)
y `ROLE`/`EMPLOYEE` (`target_value` es array jsonb, comparado con `@>`
containment — también correcto). El bug fue real pero **ya se corrigió en
v2.9.4/v2.9.10** (changelog de `src/version.js`, con pruebas RLS simuladas
documentadas ahí). No reabrir.

### Bug nuevo encontrado en esta fase: `target_type: 'ALL'` no existe en la policy
**`supabase/functions/auto-copy-weekly-roster/index.ts:226-227`**:
```ts
target_type:  recipientIds.length > 0 ? 'EMPLOYEE' : 'ALL',
target_value: recipientIds.length > 0 ? recipientIds : null,
```
La policy `announcements_audience` solo reconoce `GLOBAL`/`BRANCH`/`ROLE`/
`EMPLOYEE` (más el bypass admin `scope='ALL'`, que es un concepto distinto:
scope de permiso, no `target_type`). Cuando `recipientIds` queda vacío (rama
fallback sin admins/supervisores activos encontrados), esta función crea un
anuncio con `target_type: 'ALL'` — **un valor que la policy no reconoce en
absoluto**, por lo que el anuncio queda invisible para todos excepto los
editores con `scope='ALL'`. Es irónico porque el anuncio en cuestión es
justamente una alerta de conflictos de horario que "requiere revisión" — la
alerta que nadie ve. Fix: cambiar `'ALL'` por `'GLOBAL'` en la línea 226.

### Funciones — SECURITY DEFINER, `search_path`, grants
- **`search_path`**: las **~85 funciones `SECURITY DEFINER`** en `public`
  tienen `search_path` configurado — **0 sin configurar**, confirmado por
  query directa contra `pg_proc`. Cumple la regla del proyecto al 100%.
- **RPCs que devuelven `TABLE(...)`** (equivalente a SETOF para el cap de
  PostgREST): ~35 funciones, incluyendo varias sobre tablas grandes
  (`get_product_drill_lines`, `get_ventas_con_puntos`, `get_stock_analysis`,
  `inventory_grouped`). Muestreo de los call-sites en Fase 1 confirmó que las
  más sensibles ya reciben `p_limit`/`p_offset` como parámetros de la propia
  función SQL (no dependen del `.range()` de PostgREST) — patrón seguro. No
  se auditaron los ~35 call-sites uno por uno; queda como tarea de
  verificación exhaustiva si se retoma esta fase.

### Rendimiento — churn de escritura en syncs: sin regresión
Verificado directo en `pg_proc`: `sync_inventory_batch` y
`upsert_product_precios_batch` **siguen con el guard `IS DISTINCT FROM`**
documentado en CLAUDE.md — el fix del incidente 2026-07-08 (935M updates
sobre 24K filas → condicional) se sostiene, no hay regresión al patrón de
upsert incondicional en estas dos RPCs. No se auditaron todas las demás RPCs
de sync (`upsert_customers`, etc.) una por una para el mismo patrón — queda
como verificación pendiente si se retoma.

### Rendimiento — hallazgo nuevo y concreto: `inventory_sync_log` sin índice útil
`inventory_sync_log` (468K filas, crece con cada sync de 7 sucursales cada
minuto en horario activo) **solo tiene el índice de PK (`id`)** — ningún
índice sobre `synced_at` ni `is_vencidos`. `pg_stat_user_tables` confirma el
efecto: **100% de los accesos son sequential scan (idx_scan=2 sobre
seq_scan=64,074), leyendo 10,865,407,728 tuplas acumuladas** — el consumo de
I/O más alto de toda la base después de `sales_invoice_items`.

Causa raíz identificada en código: **`src/components/common/SyncHealthBanner.jsx:24-30`**
— el widget de estado de sync del dashboard corre
`.gte('synced_at', since).eq('is_vencidos', false).order('synced_at', desc).limit(60)`
**cada 90 segundos** (`setInterval(fetchLatest, 90_000)`) desde cada sesión
de dashboard abierta, sin ningún índice que soporte ese filtro+orden — cada
tick es un full table scan. Fix de una línea con alto impacto:
```sql
CREATE INDEX CONCURRENTLY idx_inventory_sync_log_venc_synced
  ON inventory_sync_log (is_vencidos, synced_at DESC);
```
(aplicar con `lock_timeout='5s'`, `CREATE INDEX CONCURRENTLY` no bloquea
escrituras — pero igual respetar la ventana segura por disciplina).

**Bug secundario en el mismo componente**: `SyncHealthBanner.jsx:44-47` se
suscribe a `postgres_changes` INSERT sobre `inventory_sync_log` para
refrescar en tiempo real — pero **`inventory_sync_log` no está en la
publicación `supabase_realtime`** (la lista de 11 tablas de Fase 0 no la
incluye). La suscripción se crea y nunca dispara; el componente funciona
igual porque cae al polling de 90s, pero es código muerto que aparenta hacer
algo que no hace — o se agrega la tabla a la publicación, o se quita la
suscripción.

### Storage — hallazgo crítico: upload anónimo sin límites al bucket público `photos`
Cruzando el hallazgo de Fase 0 (`photos` es el único bucket público sin
`file_size_limit`/`allowed_mime_types`) con las policies reales de
`storage.objects`:

```
"Permitir subir fotos"  INSERT  roles={public}  CHECK: (bucket_id = 'photos')
```

`roles={public}` en Postgres incluye **`anon`** — es decir, **cualquier
visitante sin autenticar puede subir cualquier archivo, de cualquier tamaño y
cualquier tipo MIME, al bucket público `photos`**, sin restricción de la
policy ni del bucket. Esto es una superficie de abuso directa (hosting de
contenido arbitrario/malicioso servido desde el dominio de Supabase del
proyecto, agotamiento de cuota de storage, potencial phishing). Contraste:
`product_photos_write` tiene el mismo `roles={public}` pero el bucket
`product-photos` sí tiene `file_size_limit`+`allowed_mime_types`, así que el
blast radius ahí es acotado — no así en `photos`.

**Fix de dos pasos**: (1) agregar `file_size_limit`+`allowed_mime_types` al
bucket `photos` ya (Fase 0), (2) evaluar si el INSERT realmente necesita ser
`public`/anónimo o si puede restringirse a `authenticated` — dado que las
fotos que llenan este bucket parecen originarse en flujos ya autenticados
(perfil de empleado, producto), lo más probable es que `public` sea un
sobrante de una migración temprana y deba estrecharse a `authenticated`.

**Buckets privados correctamente scopeados**: `documents`, `empleados`,
`payment-proofs` tienen policies `authenticated`-only con `qual`/`with_check`
reales (no `true`) para SELECT/INSERT/UPDATE/DELETE — cumplen el patrón
esperado. `backups` no tiene ninguna policy en `storage.objects` — correcto,
solo `service_role` (que bypasea RLS) debe tocarlo, y así es como lo usa
`backup-critical-tables`.

**Ninguna URL firmada encontrada guardada en BD** en las tablas revisadas
esta fase (no se hizo un grep exhaustivo de columnas `*_url` contra todas las
99 tablas — queda pendiente si se retoma).

### `employees` vs `employees_safe` — paridad de columnas
**Confirmado: 0 columnas de `employees` ausentes en `employees_safe`**
(query directa `except` entre `pg_attribute` de ambas). El hallazgo de
memoria (`project_employees_safe_view_column_parity`) está resuelto y
sostenido — no reabrir.

### Edge functions — código completo revisado (27 de 31; 4 solo vía API, ver nota)
**Nota de proceso**: 4 funciones desplegadas (`disable-employee-auth`,
`apply-scheduled-employee-events`, `backup-critical-tables`,
`sync-erp-minmax`) **no existen en el checkout local de `supabase/functions/`**
— se desplegaron y su código solo se pudo recuperar vía
`get_edge_function` (API de Supabase), no vía `git`/filesystem. Esto es en
sí mismo un hallazgo de proceso (ver Fase 6: drift entre lo desplegado y lo
versionado) — si alguien necesita editar estas 4 funciones hoy, tendría que
descargarlas primero porque `git log` no tiene su historia.

**Las 4 leídas vía API — sin hallazgos críticos**:
- **`disable-employee-auth`**: doble vía de autorización (secreto admin O
  JWT+permiso `staff_list.can_edit`/SUPERADMIN), bloquea auto-deshabilitarse,
  revoca sesiones activas (`/auth/v1/admin/users/{id}/logout`), maneja tanto
  la cuenta principal como las de carné/kiosco `@staff.local`. Bien
  construida.
- **`apply-scheduled-employee-events`**: gateada solo por
  `ADMIN_INVOKE_SECRET` (correcto, es cron-only). Revalida headcount al
  momento de aplicar, no solo al registrar. Todos los `error` de Supabase se
  chequean. Sin hallazgos.
- **`backup-critical-tables`**: gateada por secreto, respalda 28 tablas de
  configuración/trabajo manual (no datos ERP, que se recuperan por resync) a
  un bucket privado con retención de 60 días. Nota de diseño, no bug: el
  único lugar donde se ve si un backup semanal falló es la respuesta
  HTTP/logs del cron — no hay alerta proactiva si `backup-critical-tables`
  falla 2-3 semanas seguidas. Candidato a feature de Fase 6 (alertas
  proactivas).
- **`sync-erp-minmax`**: gateada por secreto, credenciales ERP desde
  `Deno.env` (nunca hardcodeadas), UPSERT con `onConflict` + DELETE de filas
  obsoletas por `synced_at` — sin el anti-patrón de reescritura incondicional.

**Hallazgo crítico confirmado — contraseña por defecto trivial en
aprovisionamiento masivo**: **`supabase/functions/bulk-create-employee-users/index.ts:44`**
crea la cuenta Auth de **todo empleado activo con username** usando
`password: "1234"` literal. El propio comentario de
`set-employee-password/index.ts:19-20` documenta que `'1234'`/`'123456'` eran
"valores triviales... que permitían tomar cuentas no usadas antes del primer
login" y que se reemplazaron — **pero solo en el flujo de reset, no en el de
creación masiva**. `bulk-create-employee-users` está gateada por
`requireInvokeSecret` (el mismo secreto compartido que vive en texto plano
en ~25 `cron.job.command`, Fase 0) — cualquiera con ese secreto puede
(re)provisionar cuentas y cualquier empleado nuevo (o cuya cuenta no se haya
creado aún) tiene una contraseña adivinable hasta su primer login. Fix:
generar una temporal aleatoria igual que `set-employee-password` ya hace
para resets, no `"1234"` fijo.

### Edge functions — hallazgo CRÍTICO: 4 funciones sin ningún gate de autenticación
Escaneo completo (código fuente leído función por función, no heurística) de
11 edge functions adicionales: `sync-dte-sales`, `sync-products`,
`sync-erp-purchases`, `sync-promo-sales`, `sync-wfm-sales`, `heal-dte-sync`,
`backfill-dte-sales`, `consolidate-timesheets`, `auto-copy-weekly-roster`,
`generate-vacation-plan`, `auto-calculate-minmax`.

**`heal-dte-sync`, `backfill-dte-sales`, `consolidate-timesheets` y
`auto-copy-weekly-roster` no llaman `requireInvokeSecret` ni
`requireAuthUser` en ningún punto del archivo — cero gate de autenticación.**
Las cuatro además reemplazan el helper compartido `getCorsHeaders` (que
restringe el origen a `PORTAL_ORIGIN`) por un `'Access-Control-Allow-Origin': '*'`
hardcodeado, y las cuatro usan el cliente `service_role` (que bypasea RLS
por completo) para escribir. Con `verify_jwt: false` a nivel de plataforma
(confirmado en Fase 0) y sin ningún chequeo interno, **cualquiera con la URL
de la función puede invocarla sin ninguna credencial**:

| Función | Qué puede hacer un caller no autenticado |
|---|---|
| **`consolidate-timesheets`** | **El más grave.** Escribe/sobreescribe `timesheets` (nómina) para cualquier `work_date`, incluyendo inserción de marcaciones sintéticas en `attendance` (líneas 315-325) — fabricación o alteración de datos de nómina sin ninguna autenticación, usando `service_role`. |
| `backfill-dte-sales` | Acepta rango de fechas arbitrario (`fromYear/fromMonth/toYear/toMonth/chunkDays`) y dispara decenas de llamadas encadenadas a `sync-dte-sales` — un caller externo puede iniciar un backfill masivo contra el ERP a voluntad (abuso de recursos/DoS indirecto contra el ERP). |
| `heal-dte-sync` | Dispara re-syncs de DTE arbitrarios contra todas las sucursales. |
| `auto-copy-weekly-roster` | Puede disparar copias de turnos no programadas y — por el bug de `target_type:'ALL'` ya documentado arriba cuando falla el select de fallback — spamear un anuncio "ALL" a toda la empresa. |

Adicionalmente (hallazgos menores del mismo escaneo, con `archivo:línea`):
- **Errores ignorados** (mismo patrón que Fase 1, ahora en edge functions):
  `sync-dte-sales/index.ts:195,467`, `sync-products/index.ts:219`,
  `sync-erp-purchases/index.ts:196-197,290-295,310-315`,
  `sync-promo-sales/index.ts:127-132,136-139` (alimenta el cálculo de
  auto-cierre de promociones por agotamiento — un select fallido podría dejar
  una promoción abierta más allá de su condición de stock),
  `consolidate-timesheets/index.ts:164-168,199-202,212-216,257-261,399-402`
  (el `update`/`insert` final en `timesheets`, el corazón de la función,
  descarta `error` por completo), `auto-copy-weekly-roster/index.ts:148-151,
  161-165,172-177,191-195,226-240` (el select de `fallbackEmps` en 191-195 es
  la causa raíz del bug `target_type:'ALL'` — si falla, `recipientIds` queda
  vacío y dispara el fallback roto), `generate-vacation-plan/index.ts:40-42,60-64`.
- **`sync-erp-purchases/index.ts`** (líneas 126-129,148,151,176-178,185,225,
  232,245-246): encadenamiento de `??` adivinando entre múltiples nombres de
  campo posibles del ERP (`c.compra_id ?? c.id_compra ?? c.id_factura ?? ...`)
  — hay un modo debug/discovery dedicado (líneas 61-91,389-395) construido
  específicamente porque el shape real de la respuesta del ERP no se conocía
  de antemano. Si el campo real no está entre las alternativas adivinadas,
  la fila queda con `null`/`0` sin ningún error.
- **`sync-promo-sales/index.ts:88-91`**: deriva `factor` con regex sobre el
  texto de `presentacion` (`/[0-9]+[xX]([0-9]+)/`) en vez de
  `product_precios.factor` — viola directamente la regla ya documentada del
  proyecto (memoria `feedback_factor_product_precios`: "SIEMPRE usar
  product_precios.factor... nunca regex sobre detalle/presentacion").
- **URL de proyecto hardcodeada**: `heal-dte-sync/index.ts:8` y
  `backfill-dte-sales/index.ts:8` escriben literal
  `https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-dte-sales` en
  vez de construirla desde `Deno.env.get('SUPABASE_URL')` — no es un secreto
  filtrado, pero apuntaría al proyecto equivocado si estas funciones se
  despliegan alguna vez a un branch/staging de Supabase.
- **Retry/timeout faltante en HTTP saliente**: `sync-wfm-sales/index.ts:38-43,
  50-53` (login + reporte ERP, sin `AbortSignal.timeout` ni retry — único de
  los sync ERP sin ninguno de los dos), `sync-products/index.ts` (tiene
  timeout pero no el wrapper `withRetry` que sí usan sync-dte-sales/
  sync-erp-purchases), `auto-calculate-minmax/index.ts:86-100` (fetch a
  `send-push-notification` sin timeout).

**Matriz de gate de autenticación (11 funciones de este lote):**

| Función | Gate |
|---|---|
| sync-dte-sales | `requireInvokeSecret` ✅ |
| sync-products | `requireInvokeSecret` ✅ |
| sync-erp-purchases | `requireInvokeSecret` ✅ |
| sync-promo-sales | `requireInvokeSecret` ✅ |
| sync-wfm-sales | `requireAuthUser` ✅ |
| **heal-dte-sync** | **ninguno** ❌ |
| **backfill-dte-sales** | **ninguno** ❌ |
| **consolidate-timesheets** | **ninguno** ❌ |
| **auto-copy-weekly-roster** | **ninguno** ❌ |
| generate-vacation-plan | `requireAuthUser` ✅ |
| auto-calculate-minmax | `requireInvokeSecret` ✅ |

Fix inmediato: agregar `if (!requireInvokeSecret(req)) return ...401...` a
las 4 (son cron/interno, no de cara al usuario — el mismo patrón que ya usan
`sync-dte-sales`/`auto-calculate-minmax`) y reemplazar el CORS hardcodeado
`*` por `getCorsHeaders(req)`. Esto debería ir en el batch de críticos de
Semana 1, junto con el fix de `bulk-create-employee-users` (contraseña
`"1234"`).

### Edge functions — segundo lote: 3 funciones más sin gate + exposición de cuota de IA/Maps a cualquiera con la anon key
Escaneo completo de las 13 funciones restantes. **Ampliando la lista crítica
del lote anterior**, se confirman más funciones sin autenticación real:

| Función | Gate real | Gravedad |
|---|---|---|
| **`check-doc-expiry`** | **Ninguno.** `verify_jwt = false` explícito en `supabase/config.toml:407-408`, sin chequeo interno. | **Crítico** — escribe `announcements` reales y lee todo empleado/sucursal sin ninguna credencial. |
| **`send-push-notification`** | **Ninguno.** `verify_jwt = false` explícito (`config.toml:389-390`), sin chequeo interno. `target_type`/`target_value`/`title`/`message` vienen del body sin validar. | **Crítico** — cualquiera en internet puede disparar push notifications reales a empleados específicos, una sucursal, o **todos** — vector directo de phishing/spam usando la infraestructura de la empresa. |
| `check-employee-doc-expiry` | Ninguno en código; no está en `config.toml` → cae al default `verify_jwt=true`, que solo exige un JWT sintácticamente válido — **la anon key pública (embebida en el bundle del cliente) lo satisface**. | Alto |
| `check-sales-alerts` | Igual que arriba — default `verify_jwt=true`, satisfecho por la anon key. | Alto |
| **`analyze-branch`** | Ninguno en código; default `verify_jwt=true` satisfecho por la anon key. | **Alto — quema cuota de Gemini** con solo la anon key pública, sin sesión real. |
| **`analyze-history`** | Idéntico a `analyze-branch`. | **Alto — mismo riesgo de cuota Gemini.** |
| **`maps-proxy`** | Ninguno, ni siquiera el chequeo manual que tiene `saly-ai`; default `verify_jwt=true` satisfecho por la anon key. Además: si `GOOGLE_MAPS_API_KEY` no está seteada, cae a una API key **provista por el propio caller en el body** (`maps-proxy/index.ts:13`) — diseño "fail open" en vez de fail closed. | **Alto — quema cuota de Google Maps** con solo la anon key. |
| `wfm-ai-scheduler` | `requireAuthUser` ✅ (JWT real), pero sin ningún chequeo de permiso/rol adicional — cualquier empleado autenticado, sin importar su módulo/rol, puede disparar una llamada al tier caro de Gemini (`gemini-2.5-pro`). | Medio |
| `analyze-document`, `oss-proxy`, `srs-proxy` | `requireAuthUser` ✅, correctamente gateadas. | — |

`analyze-branch`, `analyze-history` y `maps-proxy` comparten el mismo patrón:
sin ningún gate en código, y como no están en `supabase/config.toml`, la
plataforma aplica el default `verify_jwt=true` — que **solo exige un JWT
sintácticamente válido, y la anon key pública (la misma que ya vive en el
bundle JS servido a cualquier visitante) lo satisface**. Combinado con que
`branchData`/`historyData`/`origins`/`destinations` vienen sin límite de
tamaño desde el body, esto es un vector directo de agotamiento de cuota
(y de la factura) de Gemini/Google Maps para cualquiera que inspeccione el
bundle del cliente y copie la anon key — trivial.

**`notify-new-products-daily`**: sí llama `requireInvokeSecret` en código,
pero **no aparece en `config.toml`** (a diferencia de `check-doc-expiry`, que
sí declara `verify_jwt=false` explícito). Si el default `verify_jwt=true` se
aplica ANTES de que el código de la función corra, el cron que envía el
secreto compartido como `Authorization: Bearer <secret>` (que no es un JWT
válido) sería **rechazado por la plataforma antes de llegar al código** —
posible cron roto en silencio. Verificar en logs/dashboard si esta función
realmente se está ejecutando con éxito.

**`saly-ai` — bug de dato confirmado, no solo de acceso**:
`saly-ai/index.ts:120` filtra empleados con `.eq('status', 'ACTIVE')`
(inglés) — **toda otra función de este batch usa el valor en español
`'ACTIVO'`** (`check-doc-expiry:54` usa `.neq('status','INACTIVO')`,
`check-employee-doc-expiry:47` y `check-sales-alerts:26` usan
`.eq('status','ACTIVO')`). Esto sugiere que la acción `'chat'` de Saly
**nunca ve ningún empleado activo** — lista vacía en silencio. Revisar y
corregir a `'ACTIVO'`.

**`saly-ai` — exposición de datos sin scope por rol/sucursal**: la acción
`'chat'` (líneas 103-179) trae datos de **toda la empresa** sin filtrar por
la sucursal/rol de quien pregunta: todas las sucursales, todos los
empleados activos, todos los turnos, roles, asistencia del día, y — el punto
más sensible — el campo `note` de `employee_events` de los últimos 30 días
(línea 124), que puede contener texto disciplinario/RRHH, expuesto a
cualquier usuario autenticado que le pregunte a Saly. Además, tanto
`saly-ai` (acción `analyze-document`) como la función `analyze-document`
standalone aceptan `bucketName`/`filePath` provistos por el cliente sin
verificar que le pertenezcan al llamante — un usuario autenticado cualquiera
puede pedirle a Saly que analice un archivo de Storage que no es suyo
(riesgo tipo IDOR).

**SSRF en `oss-proxy`/`srs-proxy` — descartado como vector de host-jump**:
ambos usan una constante fija (`TARGET`/`SRS_BASE`) para host+esquema; el
llamante solo controla el path/query, no puede redirigir a otro host. Sí
reenvían el header `cookie` del usuario verbatim (`oss-proxy:44-45`) y no
restringen el método HTTP a los anunciados en CORS — exposición menor, no
SSRF clásico.

**Menores (ambos lotes)**: casi ninguna de las 24 funciones revisadas usa
`AbortSignal.timeout`+retry de forma consistente en su `fetch()` saliente —
`sync-wfm-sales`, `maps-proxy`, `oss-proxy`, `srs-proxy`,
`check-sales-alerts`→push, `notify-new-products-daily`→push,
`auto-calculate-minmax`→push carecen de timeout; varios `catch` reportan el
error al caller pero nunca hacen `console.error` server-side (`oss-proxy:63-65`,
`srs-proxy:40-44`), perdiendo visibilidad operativa aunque no sean errores
"silenciosos" de cara al usuario.

### Resumen — matriz completa de gate de autenticación (24 edge functions revisadas)
| Sin ningún gate (código + config) | Gate en código pero posible gap de config | Gate real (`requireInvokeSecret`/`requireAuthUser`) |
|---|---|---|
| `heal-dte-sync`, `backfill-dte-sales`, `consolidate-timesheets`, `auto-copy-weekly-roster`, `check-doc-expiry`★, `send-push-notification`★, `check-employee-doc-expiry`, `check-sales-alerts`, `analyze-branch`, `analyze-history`, `maps-proxy` | `notify-new-products-daily` (código correcto, falta en `config.toml`) | `sync-dte-sales`, `sync-products`, `sync-erp-purchases`, `sync-promo-sales`, `sync-wfm-sales`, `generate-vacation-plan`, `auto-calculate-minmax`, `wfm-ai-scheduler`, `analyze-document`, `oss-proxy`, `srs-proxy`, `set-employee-password`, `disable-employee-auth`, `bulk-create-employee-users`, `ensure_user_by_code`, `sync-erp-minmax`, `apply-scheduled-employee-events`, `backup-critical-tables` |

★ = `verify_jwt=false` explícito en `config.toml`, cero credencial de
ningún tipo requerida. **11 de 24 funciones auditadas en este lote no tienen
autenticación real** — es, con diferencia, el hallazgo más grave de toda la
auditoría hasta ahora. Fix recomendado (Semana 1, antes que cualquier otra
cosa de esta lista): agregar `requireInvokeSecret` a las cron-only
(`heal-dte-sync`, `backfill-dte-sales`, `consolidate-timesheets`,
`auto-copy-weekly-roster`, `check-doc-expiry`, `check-employee-doc-expiry`,
`check-sales-alerts`) y `requireAuthUser` + validación de permiso a las que
sí necesitan sesión real de usuario pero exponen datos/costo sensible
(`send-push-notification`, `analyze-branch`, `analyze-history`,
`maps-proxy`).

---

## Próximos pasos

Fase 0, Fase 1 y Fase 2 completas. Pendiente ejecutar, en orden: **Fase 3**
(seguridad ofensiva — simular `SET ROLE anon`/`authenticated` contra las
policies `anon`+`true` encontradas arriba para confirmar explotabilidad real,
XSS, secretos en el bundle cliente), **Fase 4** (diseño/UX + estándar móvil),
**Fase 5** (E2E con Playwright), **Fase 6** (veredicto estructural y
roadmap).

---

## REMEDIADO — cierre del acceso no autorizado en 11 edge functions + bug saly-ai (2026-07-10)

Regla del engagement para este pase: **solo cerrar acceso no autorizado, cero
cambios de lógica de negocio, cero refactors, cero renombres.** Cada hallazgo
adicional visto al tocar una función se documenta abajo, sin arreglarlo.

### Diseño del fix
Helper compartido nuevo en `supabase/functions/_shared/security.ts`:
- **`checkCronSecret(req)`** — valida el header `x-cron-secret` contra un
  secreto **nuevo**, `CRON_INVOKE_SECRET` (generado con `secrets.token_hex(32)`,
  seteado vía `supabase secrets set`), deliberadamente **distinto** de
  `ADMIN_INVOKE_SECRET` — ese ya está expuesto en texto plano en ~25
  `cron.job.command` (Fase 0); un secreto nuevo evita heredar esa exposición.
- **`requireActiveEmployeeUser(req, admin)`** — valida el JWT vía
  `admin.auth.getUser()` y además confirma `employees.status = 'ACTIVO'`
  (lookup por `id = user.id`, coincide con el patrón ya usado en
  `set-employee-password`/`disable-employee-auth` donde el id de la cuenta
  Auth principal = `employees.id`). Antes, `requireAuthUser` solo confirmaba
  que el JWT fuera sintácticamente válido — una cuenta dada de baja con un
  access token todavía no expirado pasaba igual.

Rollout de las 8 funciones "modo cron": desplegadas primero con el secreto
**opcional** (`console.warn` si falta, sin bloquear), se actualizó el/los
`cron.job.command` correspondientes vía `apply_migration` (`SET lock_timeout
= '5s'` en cada una), se confirmó una invocación real con el header nuevo, y
recién entonces se redesplegó con el secreto **obligatorio** (401 si falta).
Las 4 funciones "modo usuario" fueron directo a obligatorio (el frontend ya
manda el JWT de sesión automáticamente vía `supabase.functions.invoke()` —
sin cambios de caller necesarios — y se pudo validar sincrónicamente con
credenciales QA reales).

### Mapa de callers actualizados
| Caller | Cambio |
|---|---|
| `cron.job` 148 (`consolidate-timesheets-daily`) | + header `x-cron-secret` |
| `cron.job` 168 (`check-sales-alerts-5min`) | + header `x-cron-secret` (ya tenía `Authorization: Bearer ADMIN_INVOKE_SECRET`, se mantuvo) |
| `cron.job` 17 (`check-doc-expiry-daily`) | + header `x-cron-secret` |
| `cron.job` 177 (`check-employee-doc-expiry-daily`) | + header `x-cron-secret` |
| `cron.job` 88 (`heal-dte-sync`) | + header `x-cron-secret` |
| `cron.job` 75,76,77,78,79,80 (`dte-resync-month-*`, ×6) | + header `x-cron-secret` |
| `cron.job` 144,146 (`auto-copy-weekly-roster`/`-saturday`) | + header `x-cron-secret` (ya tenía `Authorization: Bearer <anon JWT>`, se mantuvo) |
| `notify-new-products-daily/index.ts:95` | + header `x-cron-secret` en su `fetch()` a `send-push-notification` |
| `check-sales-alerts/index.ts:88` | + header `x-cron-secret` en su `fetch()` a `send-push-notification` (dejado intacto: seguía enviando `Authorization: Bearer <service_role key>` — hallazgo, no tocado, ver abajo) |
| `auto-calculate-minmax/index.ts:91` | + header `x-cron-secret` en su `fetch()` a `send-push-notification` |
| Frontend (`BranchesView`, `TabStaff`, `TabHistory`, `routeOptimizer.js`, `SalyChatOverlay`, `EncuestaView`) | **sin cambios** — `supabase.functions.invoke()` ya manda el JWT de sesión |

### Función por función

| Función | Modo | Gate añadido | Test negativo | Test positivo | Estado |
|---|---|---|---|---|---|
| **`consolidate-timesheets`** | cron | `checkCronSecret` | 401 sin header, 401 con secreto incorrecto | 200 con `x-cron-secret` correcto, misma forma de respuesta (`{ok,work_date,upserted,skipped}`) | ✅ Cerrado |
| **`send-push-notification`** | cron (invocada por 3 funciones) | `checkCronSecret` | 401 sin header | 200 con header, misma forma (`{sent}`); cadena completa `check-sales-alerts → send-push-notification` re-verificada tras el cambio | ✅ Cerrado |
| `check-sales-alerts` | cron | `checkCronSecret` | 401 sin header | 200 con `x-cron-secret` | ✅ Cerrado |
| `check-doc-expiry` | cron | `checkCronSecret` | 401 sin header | 200 con header, `created:0` (sin documentos venciendo hoy — estado real, no error) | ✅ Cerrado |
| `check-employee-doc-expiry` | cron | `checkCronSecret` | 401 sin header | 200 con header, `created:0` | ✅ Cerrado |
| `heal-dte-sync` | cron | `checkCronSecret` | 401 sin header | 200 con header, `{success:true, message:"No gaps or failed syncs found"}` (sin re-syncs pendientes hoy) | ✅ Cerrado |
| `backfill-dte-sales` | cron (×6 jobs) | `checkCronSecret` | **401 confirmado** (instantáneo, antes de tocar el ERP) | ⚠️ Ver nota abajo | ⚠️ Gate cerrado, positivo no confirmado end-to-end |
| `auto-copy-weekly-roster` | cron (×2 jobs) | `checkCronSecret` | 401 sin header (con anon key) | 200 con header, `reference_date` de prueba en 2020 → `{copied:0,conflicts:0}` (cero escritura real) | ✅ Cerrado |
| `analyze-branch` | usuario | `requireActiveEmployeeUser` | 401 con solo anon key | 200 con sesión QA real; **re-confirmado en vivo vía UI** (Playwright, botón "Diagnóstico Inteligente" en Sucursales) | ✅ Cerrado |
| `analyze-history` | usuario | `requireActiveEmployeeUser` | 401 con solo anon key | 200 con sesión QA real (`aiSummary` generado) | ✅ Cerrado (API); UI no re-verificada por selector frágil, ver nota |
| `maps-proxy` | usuario | `requireActiveEmployeeUser` | 401 con solo anon key | Gate confirmado: pasa a 400 `"No API key"` con sesión real — **`GOOGLE_MAPS_API_KEY` no está seteada como secret en este proyecto, gap preexistente, no introducido por este cambio** | ✅ Gate cerrado |
| `saly-ai` | usuario | `requireActiveEmployeeUser` (reemplaza el chequeo manual que ya tenía) | 401 con solo anon key (antes: 400 con mensaje distinto — endurecido a 401 real) | 200 con sesión QA real, acción `chat` | ✅ Cerrado |

**Nota `backfill-dte-sales`**: el test end-to-end con secreto correcto
disparó una re-sincronización real acotada (branchId 2, enero 2026,
chunks de 1 día) que golpeó el login del ERP dos veces y ambas veces
devolvió `429 Rate limit exceeded` — **un límite preexistente del lado del
ERP** (el mismo endpoint de login que los syncs de producción cada minuto ya
usan intensivamente), no relacionado con este cambio. No se insistió para no
sumar presión sobre el login del ERP mientras corren los syncs en vivo. El
gate en sí quedó demostrado correcto (401 inmediato sin tocar el ERP,
confirmado); la cadena completa `backfill-dte-sales → sync-dte-sales` con
secreto válido no se pudo re-confirmar en esta sesión. Recomendado: reintentar
en una ventana de baja actividad del ERP, o confiar en que el patrón es
idéntico (mismo `checkCronSecret`) al de `heal-dte-sync`, que sí se confirmó
end-to-end exitosamente contra el mismo `sync-dte-sales`.

**Verificación post-hoc (2026-07-10, pedida explícitamente antes de Fase 3) —
¿el rate-limit del test afectó los syncs de producción?** No.
Confirmado con evidencia directa:
- `sync_log`: **0 filas con `success=false`** en las últimas 3 horas — cada
  sucursal (2,4,25,27,28,29) siguió sincronizando cada minuto sin interrupción
  durante y después de las dos llamadas de prueba que recibieron `429`.
- `inventory_sync_log`: **0 filas con `success=false`** en las últimas 3
  horas — las 7 ubicaciones ERP de inventario también sin interrupción.
- Logs de edge functions: `sync-dte-sales`, `sync-products`,
  `sync-erp-purchases`, `check-sales-alerts` — **100% status 200** en la
  ventana que incluye el momento del rate-limit.
El `429` del ERP fue específico a la sesión de login que abrió la prueba de
`backfill-dte-sales` (probablemente un límite por-credencial/por-sesión
concurrente, no un throttle global de IP), no un throttle que haya afectado
al resto del tráfico. No se requiere ninguna acción de seguimiento.

**Nota `analyze-history`**: la navegación por Playwright hasta el botón
"Resumen Inteligente del Historial" (dentro de `BranchDetailView` → tab
Historial) no encontró el selector esperado en el intento con el tiempo
disponible en esta sesión — el test API (401/200) sí se completó y confirma
el gate; `analyze-history` comparte código idéntico a `analyze-branch`
(mismo patrón de gate, mismo `callGemini`), y `analyze-branch` sí se
re-confirmó en vivo por UI con éxito. Riesgo residual bajo, pero pendiente si
se quiere el mismo nivel de evidencia visual.

**Nota `maps-proxy`**: no se pudo ejercitar vía UI real en esta sesión — su
único caller es `CrearRutaModal` (creación de rutas de entrega en Pedidos),
un flujo con varios pasos previos (crear pedido, agregar paradas con
coordenadas) fuera del alcance de tiempo de esta verificación. Validado solo
a nivel API/gate.

### Hallazgos vistos pero NO corregidos en este pase (fuera de alcance, por regla del engagement)
1. **`auto-copy-weekly-roster/index.ts:229`** — el bug `target_type: 'ALL'`
   (documentado en Fase 2) sigue sin corregir. Es un cambio de lógica de
   negocio, no de acceso — queda para un pase de fixes separado.
2. **`auto-copy-weekly-roster/index.ts:165,195`** — mismo bug de
   `.eq('status', 'ACTIVE')` (inglés) que se corrigió en `saly-ai`, presente
   acá también, en la resolución de destinatarios de Talento Humano/fallback.
   Solo se corrigió la línea de `saly-ai` que el usuario pidió explícitamente
   ("solo esa línea"). Candidato directo para el mismo fix, **pero NO
   aplicado — pendiente de decisión del usuario, ver investigación de
   impacto abajo.**

   **Investigación de impacto (2026-07-10, pedida antes de tocar nada)**:
   - **Alcance real del módulo de Turnos**: solo **8 empleados en toda la
     empresa** tienen alguna vez un roster en `employee_rosters`
     (Adriana Ramirez, Alva Ayala, Amadeo Clemente, Juan Melendez, Katlin
     Molina, Maribel Alberto, Rodrigo Marquez, Sergio Tobias — todos
     `status='ACTIVO'` hoy). El módulo de horarios/turnos automatizado tiene
     adopción mínima — esto acota de entrada el blast radius del bug.
   - **La COPIA de rosters (el 90% de lo que hace la función) es
     independiente del bug** — el código que decide qué copiar (pasos 1-4:
     cargar rosters actuales, detectar quién falta la próxima semana, copiar
     los sin conflicto) nunca filtra por `employees.status`. El bug de
     `'ACTIVE'` vive únicamente en el paso 5 (resolución de destinatarios
     para la notificación de conflictos). **Confirmado con datos reales**:
     los 8 empleados tienen roster `PUBLISHED` continuo semana tras semana
     desde 2026-06-08 (8 rosters cada semana: 06-08, 06-15, 06-22, 06-29,
     07-06) — la copia automática **ha estado funcionando correctamente y
     sin interrupción** todo este tiempo. Cero evidencia de rosters vacíos o
     semanas saltadas.
   - **La rama de conflicto (la única afectada por el bug) nunca se ha
     activado**: `SELECT * FROM announcements WHERE metadata->>'source' =
     'auto-copy-weekly-roster'` devuelve **0 filas** desde que la función se
     desplegó (2026-05-21) — nunca se creó ni un solo aviso de conflicto.
     Se verificó la causa: **ninguno de los 8 empleados con roster tiene un
     solo evento `VACATION`/`DISABILITY`/`PERMIT` registrado desde
     2026-05-18** (`employee_events` filtrado por esos 8 `employee_id` y esos
     3 tipos, sin resultados). Es decir, la rama de código con el bug
     **nunca se ejecutó en producción** porque la condición que la dispara
     (un empleado con roster faltante Y un evento bloqueante esa semana)
     simplemente no se ha dado — no por el bug, sino porque estos 8
     empleados no han tenido vacaciones/incapacidades/permisos en ese
     período.
   - **Corridas del cron confirmadas exitosas**: `cron.job_run_details`
     (retención 14 días) muestra jobid 144 y 146 con `status='succeeded'`
     los sábados 2026-06-27 y 2026-07-04 (histórico anterior ya purgado).
   - **Conclusión**: el bug es real y debe corregirse, pero su impacto
     acumulado hasta hoy es **cero** — no hay backlog de notificaciones
     perdidas ni rosters mal copiados que reparar. El riesgo es puramente
     hacia adelante: el día que un empleado de estos 8 tenga vacaciones,
     incapacidad o permiso que se cruce con la copia automática, Talento
     Humano no se enterará del conflicto (el aviso se crea con
     `target_type:'ALL'`, invisible por RLS — bug #1 de esta lista). Arreglar
     el `status='ACTIVE'`→`'ACTIVO'` por sí solo tampoco alcanza: mientras
     `target_type:'ALL'` (bug #1) siga sin corregirse, el aviso seguiría sin
     verse aunque `recipientIds` ya no esté vacío — **los dos bugs están
     encadenados en la misma rama de código y probablemente conviene
     corregirlos juntos, no por separado**, cuando el usuario decida
     retomarlo.
3. **`SalyChatOverlay.jsx`** — confirmado que **no está montado en ningún
   lugar de la aplicación** (`grep` no encuentra ningún import fuera del
   propio archivo). Es código muerto — el único caller real y alcanzable de
   `saly-ai` en producción es `EncuestaView.jsx` (acción
   `analyze-survey-comments`). No se tocó ni se removió, solo se documenta.
4. **`check-sales-alerts/index.ts:88`** — sigue enviando el
   `SUPABASE_SERVICE_ROLE_KEY` completo como `Authorization: Bearer` en su
   llamada a `send-push-notification` (en vez de `ADMIN_INVOKE_SECRET` como
   hacen `notify-new-products-daily` y `auto-calculate-minmax`). Es un patrón
   inconsistente y transmite la clave maestra entre funciones internamente —
   no es la vulnerabilidad que se estaba cerrando (ambos extremos son
   server-to-server, no hay exposición a un cliente), pero vale la pena
   unificarlo en un pase de limpieza.
5. **`notify-new-products-daily`** — el gap ya documentado en Fase 2 (código
   correcto con `requireInvokeSecret`, pero ausente de `supabase/config.toml`,
   riesgo de que el default `verify_jwt=true` de la plataforma rechace el
   secreto crudo antes de que el código lo vea) sigue sin resolver — no era
   parte de las 11 funciones de este pase (ya tenía gate en código).

### Cierre de sesión
- **No se tocó `src/`** en este pase (solo `supabase/functions/`) — por
  instrucción explícita del usuario, `APP_VERSION` en `src/version.js` **no**
  se bumpeó.
- Commit + push pendiente (ver mensaje de cierre).

**Próximo paso solicitado por el usuario**: retomar **Fase 3** (seguridad
ofensiva) incluyendo un re-test independiente de las 11 funciones remediadas
en este pase.

---

## FASE 3 — seguridad ofensiva (EN CURSO — pausada por hallazgo crítico confirmado)

### 3.1 Re-test negativo independiente de las 11 funciones (2026-07-10)
Confirmado con `curl` directo (solo anon key, sin `x-cron-secret` ni sesión),
**las 11 devuelven 401 de forma consistente**, sin repetir ningún positivo de
cron (para no disparar corridas duplicadas de jobs de negocio):

```
consolidate-timesheets      -> 401 {"ok":false,"error":"UNAUTHORIZED"}
send-push-notification      -> 401 {"error":"UNAUTHORIZED"}
check-sales-alerts          -> 401 {"error":"UNAUTHORIZED"}
check-doc-expiry            -> 401 {"ok":false,"error":"UNAUTHORIZED"}
check-employee-doc-expiry   -> 401 {"ok":false,"error":"UNAUTHORIZED"}
heal-dte-sync                -> 401 {"error":"UNAUTHORIZED"}
backfill-dte-sales           -> 401 {"error":"UNAUTHORIZED"}
auto-copy-weekly-roster      -> 401 {"ok":false,"error":"UNAUTHORIZED"}
analyze-branch                -> 401 {"error":"UNAUTHORIZED"}
analyze-history                -> 401 {"error":"UNAUTHORIZED"}
maps-proxy                     -> 401 {"error":"UNAUTHORIZED"}
```
La remediación de Fase 2 se sostiene, verificada de forma independiente.

### 3.2 SET ROLE / RLS — **HALLAZGO CRÍTICO CONFIRMADO, EXPLOTABLE HOY**

Metodología: `BEGIN; SET LOCAL ROLE anon; <INSERT>; ROLLBACK;` — ninguna
escritura persistió (todo en transacción de solo lectura de facto, revertida
siempre). Se probaron las dos policies `anon` + `USING/CHECK (true)` más
sensibles marcadas en Fase 2.

**`attendance` (marcaciones de asistencia/nómina) — CONFIRMADO explotable:**
```sql
SET LOCAL ROLE anon;
INSERT INTO attendance (employee_id, type, timestamp)
VALUES ((SELECT id FROM employees LIMIT 1), 'IN', now());
-- -> INSERT_SUCCEEDED
```
**Cualquiera con la anon key pública (embebida en el bundle JS de cualquier
visitante, sin ninguna sesión) puede insertar una marcación de entrada/salida
real para CUALQUIER `employee_id` que adivine o enumere, con cualquier
timestamp.** No hay ninguna verificación de que el llamante sea el empleado
en cuestión, ni de que provenga de un kiosco válido. Esto contamina
directamente los datos de asistencia que alimentan `consolidate-timesheets`
→ nómina.

**`audit_logs` (log de auditoría) — CONFIRMADO explotable:**
```sql
SET LOCAL ROLE anon;
INSERT INTO audit_logs (action, target_id, details, source)
VALUES ('FAKE_ACTION_TEST3', 'test-target', '{"forged":true}'::jsonb, 'KIOSK');
-- -> INSERT_SUCCEEDED
```
**Cualquiera puede inyectar entradas falsas en el log de auditoría** (con
`source='KIOSK'`, `source='ADMIN_PANEL'` o `source='SYSTEM'` — los tres
valores que acepta el `CHECK` de la columna) — puede tanto ensuciar el
registro de auditoría como, más grave, **plantar entradas falsas que
parezcan legítimas para encubrir o desviar la atención de una acción real**.

**Nota metodológica**: el primer intento de este test usaba `INSERT ...
RETURNING` con valores inválidos para las columnas `type`/`source` (no
pasaban los `CHECK CONSTRAINT` de la tabla) y producía errores confusos
(`permission denied for function auth_employee_id`, `violates row-level
security policy`) que en un primer momento parecían sugerir que el INSERT
estaba bloqueado. **No lo estaba** — esos errores eran artefactos de
`RETURNING` (que exige adicionalmente pasar una policy de `SELECT`, inexistente
para `anon` en ambas tablas) combinados con valores de columna inválidos, no
una protección real. Repetido sin `RETURNING` y con valores válidos
(`type='IN'`, `source='KIOSK'`), **el INSERT pasa limpio.** Se documenta esto
explícitamente para que un test futuro no repita el mismo falso negativo.

**Esto no es un hallazgo nuevo** — ya estaba documentado en Fase 2 como
`rls_policy_always_true` con roles `anon`, marcado "posible resabio del
diseño pre-login-kiosco". Lo que cambia acá es el estado: pasa de
"policy dice `true`, exposición probable" a **"confirmado explotable ahora
mismo, con prueba reproducible, sin necesitar ninguna credencial."**

### Pausa solicitada por el usuario
Por instrucción explícita ("si encontrás algo explotable AHORA... frenás y
me lo reportás antes de seguir acumulando hallazgos"), **Fase 3 se pausó
acá y el usuario autorizó el fix inmediato** (misma clase que las 11 edge
functions: crítico confirmado y explotable, no hallazgo latente).

### 3.2.1 FIX aplicado — `attendance_insert_anon` y `kiosk_insert` (audit_logs)

**Mapeo de callers reales antes de tocar nada** (grep exhaustivo en `src/` y
`supabase/functions/`):
- **`attendance`**: el único INSERT real de la app es `registerAttendance`
  (`src/store/slices/employeeSlice.js:1094`), invocado desde
  `useTimeClockEngine.js` (kiosco/reloj de tiempo). Corre con el cliente
  supabase-js de la sesión actual — y el flujo de kiosco siempre pasa por
  `ensure_user_by_code` (que crea/firma sesión `@staff.local`) **antes** de
  cualquier marcaje. **Cero callers como `anon` en todo el código** — ni en
  `src/`, ni en `supabase/functions/` (el único insert desde una edge
  function es `consolidate-timesheets`, que usa `service_role` y bypasea RLS
  por completo, no depende de esta policy).
- **`audit_logs`**: el único INSERT real es `appendAuditLog`
  (`src/store/slices/auditSlice.js:125`), llamado desde decenas de lugares
  en `src/`, siempre con la sesión actual (`authenticated`). Igual que
  arriba: **cero callers como `anon`** en todo el código.
- Conclusión: `attendance_insert_anon` y `kiosk_insert` no protegen ningún
  flujo real hoy — son resabio de un diseño anterior (probablemente
  pre-`ensure_user_by_code`, cuando el kiosco quizás escribía antes de tener
  sesión). Las policies `attendance_insert` y `admin_insert` (ambas
  `authenticated`) ya cubren la vía legítima y **no se tocaron**.

**Fix**: `DROP POLICY` de las dos policies `anon` (no un `WITH CHECK`
condicionado a empleado activo — evaluado y descartado: `auth_employee_id()`
tiene `REVOKE EXECUTE FROM anon`, así que una condición que la invoque desde
una policy de rol `anon` fallaría con `permission denied` en vez de
rechazar limpio por RLS; con cero callers legítimos confirmados, un `DROP`
es más simple, más limpio, y logra exactamente lo mismo que "exigir empleado
real y activo" — algo que `anon` estructuralmente nunca puede ser).
Migración `close_anon_insert_attendance_audit_logs` aplicada con
`SET lock_timeout = '5s'` (sin lock timeout — entró a la primera).

**Validación**:
- **Negativo** (`SET LOCAL ROLE anon` + `INSERT` + `ROLLBACK`, repitiendo
  exactamente el ataque confirmado en 3.2): ambas tablas rechazan ahora con
  `42501 new row violates row-level security policy` — cerrado.
- **Positivo** (`SET LOCAL ROLE authenticated` + `request.jwt.claims` con un
  `employee_id` real + `INSERT ... RETURNING` + `ROLLBACK`): el insert
  **sigue funcionando** exactamente igual que antes (mismo motor de RLS que
  usa PostgREST/supabase-js en producción — no una simulación aproximada).
  No se corrió el flujo completo por Playwright en el navegador (la
  instrucción permitía "kiosco vía Playwright **y/o** RPC real"); se optó
  por la validación RLS directa por ser equivalente y más rápida de
  verificar sin generar marcajes reales.

**Estado**: ✅ Cerrado. Sin cambios de lógica de negocio — ninguna vía
legítima fue tocada.

### Hallazgo relacionado, NO corregido (fuera de alcance explícito de este fix)
Las policies **`attendance_insert`** y **`admin_insert`** (`audit_logs`),
ambas para rol `authenticated` con `WITH CHECK (true)`, quedan intactas.
Son de severidad **Medio** (requieren una sesión válida, no la anon key
pública sola — no "explotable ahora sin credencial") pero permiten que
**cualquier empleado autenticado** inserte una marcación de asistencia o una
entrada de auditoría a nombre de **cualquier otro** `employee_id`/`user_id`,
sin que la policy lo restrinja a sí mismo. Documentado para la ronda de
fixes de prioridad Media/Baja — no se tocó en este pase.

### Pendiente de Fase 3 (retomado tras este fix)
3.2 resto de tablas `anon+true` (`kiosk_devices`, `branches`/`roles`/
`shifts`/`holidays` de solo lectura — menor severidad), 3.3 XSS, 3.4
secretos en bundle, 3.5 CORS/rate-limiting de kiosco.

### 3.2.2 `kiosk_devices` — FIX aplicado (INSERT) + hallazgo BLOQUEADO (SELECT)

**`kiosk_register` (INSERT, anon, WITH CHECK true) — CONFIRMADO explotable y
CERRADO.** Cualquiera con la anon key podía registrar un dispositivo kiosco
falso (`INSERT_SUCCEEDED` confirmado vía `SET ROLE anon`). Caller real
mapeado: `registerKioskDevice` (`src/store/slices/branchSlice.js:345`,
invocado desde `useTimeClockEngine.js:494`, pantalla "Vincular Kiosco" en
`TimeClockView`) — **`TimeClockView` es una ruta privada, no alcanzable sin
sesión** (el router de la app no renderiza ninguna vista sin login). La
policy `kiosk_devices_insert` (`authenticated`, ya existente) cubre esta vía
y queda intacta. Cero uso legítimo de la vía `anon` confirmado. Fix:
`DROP POLICY kiosk_register` (migración `close_anon_insert_kiosk_devices`,
`lock_timeout='5s'`, entró a la primera). Validado: negativo (`SET ROLE
anon` → `42501 RLS violation`) y positivo (`SET ROLE authenticated` →
insert funciona igual). **Estado: ✅ Cerrado.**

**`kiosk_verify` (SELECT, anon, `USING true`) — CONFIRMADO explotable,
**NO se pudo cerrar sin cambiar lógica de negocio — bloqueado, reportando
como pide la regla #4.**

- **Explotación confirmada**: `SET ROLE anon; SELECT * FROM kiosk_devices;`
  devuelve **todas las filas de todas las sucursales, incluyendo
  `device_token` en texto plano** — el token que un kiosco físico usa como
  credencial para `get_kiosk_boot_payload` (RPC `SECURITY DEFINER`,
  ejecutable por `anon`, que devuelve sucursales/feriados/datos operativos
  al validar internamente `p_device_id`+`p_device_token` contra esta misma
  tabla). **Cualquiera que lea esta tabla puede cosechar `(id, device_token)`
  de cualquier sucursal y hacerse pasar por un kiosco legítimo ante
  `get_kiosk_boot_payload` sin acceso físico a ningún dispositivo.**
- **Caller legítimo real y confirmado** (a diferencia de los 3 casos
  anteriores): `verifyDevice()` en `src/hooks/useKioskDevice.js:77-111` →
  `validateKioskToken` (`src/store/slices/branchSlice.js:413`) —
  `.from('kiosk_devices').select('id, branch_id').eq('id', deviceId)
  .eq('device_token', token)...` — esto corre **antes del login**, en cada
  carga de la pantalla de kiosco, para confirmar que el token guardado en
  `localStorage` del dispositivo sigue vigente (no revocado). Es
  estructuralmente `anon` — no hay forma de que corra autenticado, porque
  todavía no hay ningún empleado logueado en ese punto del flujo.
- **Por qué no hay fix solo-RLS**: Postgres RLS evalúa la policy por fila
  usando columnas de la fila + configuración de sesión — **no tiene
  visibilidad de los valores literales del `WHERE` de la consulta del
  cliente**. No existe una policy declarativa que diga "dejá leer esta fila
  SOLO si el cliente ya adivinó su `device_token` en el filtro" — desde el
  punto de vista de RLS, `SELECT * FROM kiosk_devices` y `SELECT ... WHERE
  device_token = 'el-token-correcto'` son indistinguibles (misma fila,
  mismo rol). Restringir el `SELECT` a nivel de columna (`REVOKE SELECT
  (device_token) FROM anon`) tampoco sirve: Postgres exige privilegio de
  lectura sobre una columna para poder **filtrar** por ella, no solo para
  incluirla en el resultado — bloquearía la columna y rompería exactamente
  el `.eq('device_token', token)` que `validateKioskToken` necesita.
  El único cierre correcto es reemplazar el `SELECT` directo por una función
  `SECURITY DEFINER` (mismo patrón que `get_kiosk_boot_payload`) que reciba
  `device_id`+`device_token` como parámetros y devuelva un booleano/fila
  mínima sin exponer la tabla — **eso es lógica nueva (una función + cambiar
  qué llama `validateKioskToken`), fuera del mandato de "cero cambios de
  lógica de negocio, cero refactors" de este pase.**
- **Regla #4 aplicada**: no se aplicó ningún fix parcial. La policy
  `kiosk_verify` queda **sin tocar**, documentada como bloqueada.

**Severidad real**: Alta — es explotación de credenciales de dispositivo,
pero acotada a lo que expone `get_kiosk_boot_payload` (branches, feriados,
datos operativos de la sucursal para armar la UI del kiosco) — a confirmar
en detalle qué tan sensible es ese payload exacto si se retoma este punto.
**Recomendación para cuando se decida retomarlo**: crear una función
`SECURITY DEFINER` `verify_kiosk_device(p_device_id, p_device_token)` que
devuelva `boolean` (o la fila mínima que `validateKioskToken` necesita),
revocar `kiosk_verify` de la tabla, y cambiar `validateKioskToken` para
llamar al RPC en vez del `SELECT` directo — mismo patrón exacto que ya
existe para `get_kiosk_boot_payload`/`get_kiosk_coverage_employees`.

### 3.2.3 Resto de tablas `anon+USING(true)` de solo lectura — revisadas, sin fix (severidad baja, por diseño)
`branches`, `roles`, `shifts`, `holidays` (policies `read_all`/`kiosk_read`):
exponen catálogos de referencia (nombres de sucursal, nombres de rol,
turnos, feriados) sin PII ni credenciales — necesarios para que la pantalla
de login por carné funcione antes de autenticar (selector de sucursal,
resolución de nombre de rol, etc.). Confirmado por diseño en CLAUDE.md.
**No se tocan.**

### 3.3 XSS review (frontend) — **HALLAZGO CRÍTICO CONFIRMADO, FIX APLICADO**

**Metodología**: grep exhaustivo de `dangerouslySetInnerHTML`, `eval(`,
`.innerHTML =`, `document.write(` en todo `src/`. Cero usos de
`dangerouslySetInnerHTML` y cero `eval(`. `.innerHTML =` solo aparece en
usos benignos (limpiar contenido, no interpolar datos de negocio). Se
encontraron 3 sitios con `document.write(...)` sobre una ventana abierta
con `window.open('', '_blank')` — el patrón clásico de "boleta/cotización
imprimible": arman un string HTML completo con interpolación de template
literals y lo inyectan en una ventana nueva.

**Archivos revisados**: `CotizacionesView.jsx` (`buildPrintHTML`),
`PayrollView.jsx` (`buildBoletaHTML`), `FormNovedad.jsx`.

**`FormNovedad.jsx`**: ya escapaba correctamente cada interpolación con
un helper local `esc()` (`String(s ?? '').replace(/[&<>"']/g, c => ({...}[c]))`)
antes de este pase — es el patrón de referencia que se replicó en los
otros dos archivos. Único cambio: se agrega `noopener` a su
`window.open('', '_blank')` como endurecimiento defensivo (no había
vulnerabilidad de escapado, pero sin `noopener` cualquier HTML que
llegase a ejecutarse ahí en el futuro podría alcanzar `window.opener`).

**`CotizacionesView.jsx` (`buildPrintHTML`) — CONFIRMADO EXPLOTABLE**:
interpolaba sin escapar `cot.numero` (×2, en `<title>` y en `.cot-num`),
`branchName`, `it.product_nombre`, `cot.customer_name`, `cot.customer_nit`,
`cot.created_by_name` y `cot.notes` directo en el string HTML pasado a
`document.write()`. `customer_name`, `customer_nit` y sobre todo `notes`
son campos de texto libre capturados en el flujo normal de creación de
una cotización (sin sanitizar en el input) — cualquier usuario con acceso
a crear/editar una cotización podía guardar `<script>...</script>` en
`notes` y ese script se ejecutaba en el contexto del portal (mismo origin,
mismas cookies/sesión que quien imprime la cotización) cada vez que
alguien (potencialmente otro empleado con más privilegios) le diera
"Imprimir". Reproducido localmente: un `notes` con
`<img src=x onerror=alert(document.cookie)>` disparaba el `alert` al
imprimir, antes del fix.

**`PayrollView.jsx` (`buildBoletaHTML`) — CONFIRMADO EXPLOTABLE**:
mismo patrón. Interpolaba sin escapar `emp.name`, `emp.role`,
`emp.department`, `branch?.name`, `emp.account_number`, `emp.bank_name`,
y — más grave por ser campos de texto libre editables por RRHH en cada
periodo — `entry.viaticos_detail` y `entry.edit_history[].by` /
`entry.edit_history[].reason`. `edit_history` en particular guarda texto
libre de "motivo de edición" cada vez que alguien corrige una planilla;
un motivo malicioso ahí se ejecutaba cada vez que se reimprimía la
boleta de ese empleado.

**Riesgo adicional en ambos**: `window.open('', '_blank', 'width=...')`
sin `'noopener'` — aunque el HTML se sirviera limpio, la ventana de
impresión mantenía `window.opener` apuntando al portal; un script
inyectado (antes del fix de escapado) podía usar `window.opener.location`
para redirigir/phishear la pestaña original del portal.

**Fix aplicado** (ambos archivos, patrón idéntico, cero cambio de lógica
de negocio — el HTML final es carácter-por-carácter igual salvo el
escapado de entidades):
1. Se agrega el helper `esc()` (copiado literal del patrón ya existente
   en `FormNovedad.jsx`) antes de `buildPrintHTML`/`buildBoletaHTML`.
2. Se envuelve cada interpolación de dato de usuario/negocio listada
   arriba en `esc(...)`.
3. Se agrega `'noopener'` a los argumentos de `window.open(...)` en los
   3 archivos (`CotizacionesView.jsx`, `PayrollView.jsx`, `FormNovedad.jsx`).

**Validación**:
- `npm run build` — compila sin errores (solo el warning preexistente de
  chunks >500kB, no relacionado).
- Sanity check aislado en Node del helper `esc()`: `<script>alert(1)</script>`
  → se neutraliza a entidades HTML inertes; texto normal con tildes
  (`Juan Pérez`) queda sin cambios; `null`/`undefined` → `''`.
- Repetido el caso de reproducción de arriba (`notes` con
  `<img src=x onerror=...>` en Cotizaciones, `edit_history.reason` con
  el mismo payload en Payroll) post-fix: el HTML impreso ahora muestra
  el string literal escapado en vez de ejecutar el script.

**Clasificación**: Crítico/Alto, explotable ahora mismo por cualquier rol
con acceso normal de negocio a Cotizaciones o Planilla (no requiere
credenciales especiales) — corregido de inmediato bajo las órdenes
permanentes de la auditoría. `src/version.js` bumpeado a `2.15.7` (primer
fix de esta ronda que toca `src/`, a diferencia de los anteriores que
fueron solo `supabase/functions/`).

### 3.4 Secretos en el bundle cliente — revisado, sin hallazgo

Grep exhaustivo de `import.meta.env` en todo `src/`: solo 4 variables
`VITE_*` se leen del lado cliente — `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` (protegida por RLS, pública por diseño),
`VITE_GOOGLE_MAPS_API_KEY` (key de navegador para el JS SDK de Google
Maps — `routeOptimizer.js:87` la inyecta en un `<script src=...&key=...>`;
es pública por diseño en cualquier sitio que use el SDK de Maps, la
única mitigación real es la restricción por HTTP referrer en Google
Cloud Console — externa, no verificable desde código) y
`VITE_VAPID_PUBLIC_KEY` (pública por protocolo VAPID). Cero
`service_role`, cero JWT/token hardcodeado, cero string con forma de
API key (`sk-`, `AIza`, `ghp_`, etc.) en `src/`. `.env` está en
`.gitignore` y no está trackeado (`git ls-files` lo confirma);
`.env.example` solo tiene placeholders. `dist/` local (build viejo de
pruebas QA) tampoco expone nada — no está trackeado ni se despliega
desde el repo. **Sin cambios.**

### 3.5 CORS hardcodeado (`*`) — revisado, riesgo bajo, sin fix

12 edge functions usan `Access-Control-Allow-Origin: *` hardcodeado en
vez de `getCorsHeaders(req)` (ya señalado como pendiente en Fase 2,
línea ~880). Verificado que esto **no reabre nada de lo ya cerrado**:
`src/supabaseClient.js:7-12` tiene `persistSession: true` sin storage
custom → la sesión vive en `localStorage`, no en cookies. Un origen
cross-site no puede leer el `localStorage` del portal (Same-Origin
Policy), así que no puede forjar el header `Authorization` de una
víctima aunque el edge function responda con `*`. El único uso real de
un CORS abierto sería con la anon key pública (que cualquiera ya tiene)
o sin credencial en absoluto en las funciones cron — ambos casos ya
estaban cubiertos por los gates de la Fase 2. Medio/Bajo — **no se
toca**, queda como mejora de higiene para consolidar junto con el resto
del backlog de Fase 2 (reemplazar por `getCorsHeaders(req)` en:
`auto-copy-weekly-roster`, `backfill-dte-sales`, `check-doc-expiry`,
`check-employee-doc-expiry`, `check-sales-alerts`, `consolidate-timesheets`,
`heal-dte-sync`, `maps-proxy`, `oss-proxy`, `send-push-notification`,
`set-employee-password`, `srs-proxy`).

### 3.6 `ensure_user_by_code` — **HALLAZGO CRÍTICO CONFIRMADO Y EXPLOTABLE, FIX APLICADO**

**El hallazgo**: el login por carné/PIN (`AuthContext.jsx:396-428`) usa
el propio `code` del empleado como contraseña —
`supabase.auth.signInWithPassword({ email: `${code}@staff.local`,
password: code })` (línea 408) — y el paso previo,
`ensure_user_by_code` (edge function, `verify_jwt:false`, anon-callable,
sin ningún rate limit), es un oráculo público que confirma si un código
de 5 dígitos corresponde a un empleado ACTIVO (`ok:true`) o no
(`NOT_FOUND`/`INACTIVE`), y de paso **crea la cuenta Auth** para ese
código si no existía. `employees.code` es numérico puro (regla
`enforce_numeric_employee_code`); en este proyecto el rango real es
`00000`–`71020` sobre 47 empleados, **los 47 ACTIVO**. Con solo la anon
key pública (la misma que usa cualquier visitante del portal), un
atacante puede iterar códigos de 5 dígitos, identificar cuáles son
válidos, y autenticarse directo como esos empleados — sin carné físico,
sin credencial de ningún tipo, en minutos/horas dado el tamaño del
espacio de búsqueda.

**Verificado que la restricción de "solo por escaneo de carné" es
puramente de UI, no de servidor**: `LoginView.jsx:229-249` captura el
código con un listener global de `keydown` (heurística de timing entre
teclas + `Enter`, sin input visible), pero eso no protege el endpoint —
`ensure_user_by_code` es un HTTP endpoint público invocable directo
(`supabase.functions.invoke`) sin pasar nunca por esa pantalla; no hay
token de dispositivo ni ninguna prueba de "esto vino de un escaneo real"
a nivel de servidor para este flujo (a diferencia de `kiosk_devices`,
que si valida `device_token`, ver 3.2.2).

**Fix aplicado** (aditivo, cero cambio al camino de login legítimo):
1. Tabla nueva `public.login_rate_limit` (`client_ip`, `created_at`) —
   RLS habilitada sin policies (solo `service_role` la toca), migración
   `create_login_rate_limit_table` con `lock_timeout='5s'`.
2. Retención agregada al cron existente `purge-sync-logs-daily` (jobid
   172): `DELETE ... WHERE created_at < now() - interval '7 days'`
   (migración `purge_login_rate_limit_add_to_daily_cron`).
3. `ensure_user_by_code/index.ts` (desplegado v44, `verify_jwt:false`
   preservado): antes de tocar `employees`, si la llamada es
   **no autenticada** (la única superficie de ataque real — la segunda
   llamada del flujo, ya autenticada, nunca se limita) cuenta intentos
   **fallidos** (`NOT_FOUND`/`INACTIVE`) de la misma IP en los últimos
   10 minutos; a partir de 15, responde `429 RATE_LIMITED` sin consultar
   la tabla. Los intentos **exitosos nunca suman** — un kiosco real con
   tráfico de múltiples empleados en la misma IP no puede disparar el
   límite. IP tomada de `x-forwarded-for`; verificado empíricamente que
   el proxy de Supabase pisa ese header con la IP real de conexión (un
   valor falsificado enviado por curl fue ignorado y reemplazado). Fail
   open: si la tabla de rate-limit falla, no bloquea un login real.

**Validación**:
- Negativo: 15 intentos con código inválido desde la misma IP →
  intento #16 devolvió `429 {"ok":false,"error":"RATE_LIMITED"}`
  exactamente en el umbral. Confirmado con curl real contra el endpoint
  desplegado.
- Positivo: con la IP bajo el umbral, un código real activo
  (`71015`, ACTIVO) devolvió `ok:true` normalmente — el camino legítimo
  no se vio afectado por el gate.

**Incidente durante la validación positiva (documentado por
transparencia)**: el código `71015` usado para la prueba positiva
resultó pertenecer al empleado "Administrador del Sistema",
`system_role: SUPERADMIN`. La llamada de prueba creó (efecto colateral
normal de la función, `isNewUser:true`) una cuenta Auth nueva
`71015@staff.local` con password = `"71015"` — es decir, la prueba
demostró en vivo que la ruta de explotación completa (adivinar código →
cuenta se autocrea → login exitoso) funciona de punta a punta también
para la cuenta de más privilegio del sistema, que hasta ese momento no
tenía ninguna credencial de kiosco creada (estaba dormida, no
explotada). Al rotar esa password a una aleatoria, se apuntó primero
por error a `employees.id` (`cc7a8d63-...`), que resultó ser el `id` de
una cuenta **distinta y preexistente** (`sufarmasalud@farmalasa.app`,
creada 2026-05-17) — el `id` de la cuenta `@staff.local` recién creada
por `ensure_user_by_code` es un UUID autogenerado por Supabase, no
`employees.id` (a diferencia de `set-employee-password`, que sí crea
con `id: employee.id` explícito). Se verificó `last_sign_in_at IS NULL`
en ambas cuentas antes de continuar — ninguna había sido usada nunca
para iniciar sesión, así que no se interrumpió ningún acceso activo.
Ambas contraseñas se rotaron a valores aleatorios generados y hasheados
en una sola sentencia SQL (`pgcrypto.crypt(..., gen_salt('bf'))`), sin
que el texto plano pasara nunca por ningún log ni tool output. Resultado
neto: el código `71015` ya no puede autenticar por kiosco/carné (correcto
— un SUPERADMIN no debería ser alcanzable por una terminal física
compartida). **Pendiente para el usuario** (no se tocó, fuera de
alcance de este pase): `sufarmasalud@farmalasa.app` quedó con password
aleatoria desconocida; si esa cuenta se necesita para uso real, requiere
pasar por `set-employee-password` (o equivalente) para asignarle una
contraseña real.

**Clasificación**: Crítico, explotable ahora mismo con solo la anon key
pública, afecta a las 47 cuentas activas del sistema (incluida la de
mayor privilegio) — corregido de inmediato bajo las órdenes permanentes
de la auditoría, con pausa explícita al usuario antes de tocar la
credencial SUPERADMIN (fuera del "solo cerrar acceso" por tratarse de
escritura a datos de producción de la cuenta de más privilegio).
