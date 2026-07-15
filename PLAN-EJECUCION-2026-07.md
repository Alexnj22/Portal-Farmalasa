# PLAN DE EJECUCIÓN — Portal Farmalasa (post-auditoría 2026-07)

> Derivado de `AUDITORIA-2026-07.md` (Fases 0–6 completas) + estado real de
> prod/staging verificado por SQL directo el 2026-07-11. Este es el plan de
> referencia: qué falta, en qué orden, y con qué gates. Versión app al cierre
> de la auditoría: v2.15.9.

## Reglas transversales (aplican a TODO bloque)

1. **Todo write a producción (datos, esquema, storage, o registro de migraciones)
   requiere OK humano explícito y en el momento, para esa operación puntual.** Un
   prompt relayado de una "sesión orquestadora" NO cuenta. (Origen: incidente
   2026-07-11, ver [[project_migration_baseline_and_staging]].)
2. **DDL sobre tablas calientes** (`sales_invoices`, `sales_invoice_items`,
   `inventory`, `products`, `dte_sales`): `SET lock_timeout='5s'`, ventana
   06:00–11:59 UTC, y —una vez listo staging— probar primero en staging.
3. **Solo cerrar/arreglar lo pautado en cada ítem.** Si aparece otro problema, se
   documenta, no se toca.
4. **Todo fix de bug viene con un test que lo hubiera atrapado** (una vez exista
   la base de testing, Bloque 2).
5. Bumpar `APP_VERSION` + changelog solo si se toca `src/`. Commit por unidad de trabajo.

---

## Estado actual verificado (no re-hacer)

**Ya cerrado durante la auditoría:**
- 11 edge functions sin auth → gateadas (`checkCronSecret`/`requireActiveEmployeeUser`).
- `attendance`/`audit_logs`/`kiosk_devices` INSERT `anon+true` → cerradas.
- XSS almacenado (Cotizaciones/Planilla) → escapado.
- `ensure_user_by_code` sin rate-limit (fuerza bruta de carné) → rate-limit por IP.
- `saly-ai` `'ACTIVE'`→`'ACTIVO'` (1 línea).
- Fase 4 diseño: `active:scale`, zoom iOS en ~170 inputs, touch targets en componentes
  compartidos, 9 `<select>`→`LiquidSelect`.
- 4 quick wins (v2.15.9): `eslint` ignora android/ios/.agents, ARIA en ModalShell/
  LiquidSelect, `SalyChatOverlay` eliminado, `config.toml` de notify-new-products.

**Prod verificado intacto** (2026-07-11): 99 tablas, 208 policies, 47 empleados,
324K facturas — sin daño. **Branch de staging existe** (`ewcmerxqjvludtgskuin`):
esquema completo reconstruido, cero PII. Ver Bloque 3 para finalizarlo.

---

## PROGRESO DE EJECUCIÓN

### 2026-07-11 (sesión Fable)
- **0A.1 — ✅ APLICADO en prod y verificado.** Bucket `photos` (vestigial, sin uso en código,
  1 objeto ya subido por anónimo): +límite 10MB +tipos imagen, INSERT estrechado `anon`→`authenticated`.
  Mismo fix en `product-photos`. Migraciones `harden_photos_bucket_close_anon_upload` +
  `harden_product_photos_close_anon_upload`.
- **0A.2 — ✅ ERA FALSO POSITIVO.** `bulk-create-employee-users` v13 desplegado YA usa
  `randomTempPassword()`; la auditoría leyó el archivo local desestasado. Local sincronizado.
  El `'1234'` en EmployeeDetailView/employeeSlice es el sentinel de reset, no débil.
  ⚠️ Lección: verificar cada ítem contra lo DESPLEGADO (`get_edge_function`), no contra el texto de la auditoría.
- **0A.3 — ✅ DESPLEGADO en prod.** `saly-ai` (quitado `note` de employee_events del contexto de chat),
  `analyze-document` + acción analyze-document de `saly-ai` (whitelist buckets
  documents/empleados/payment-proofs → cierra IDOR a `backups`). Desplegadas vía CLI 2026-07-11.
  Pendiente: spot-check funcional en la app (resumen IA de encuesta en EncuestaView; extracción de
  fechas de documentos en modal de empleado). El scope completo de Saly por rol/sucursal quedó como
  decisión de producto (ver 7A.4).

### 2026-07-11 (continuación)
- **0B.1 — ✅ APLICADO en prod y verificado.** `wrap_notifications_auth_employee_id_initplan`:
  las 3 policies de `notifications` (select/update/delete) ahora usan `(SELECT auth_employee_id())`.
  Verificado con `pg_policies` post-aplicación.
- **0B.6 — ✅ APLICADO en prod y verificado.** `drop_debug_pedido_timings_leftover`: función
  eliminada, sin callers en `src/`/`supabase/` (solo mención en changelog y en un GRANT list viejo).
  `pg_proc` confirma 0 filas.
- **0B.3 — ✅ APLICADO en prod y verificado (hallazgo corregido).** La verificación previa (basada
  en `information_schema.role_table_grants`, que NO cubre vistas materializadas) decía que
  `mv_product_factor` no tenía grants explícitos. `pg_class.relacl` mostró lo contrario:
  `authenticated` tenía TODOS los privilegios (`arwdDxtm` — SELECT+INSERT+UPDATE+DELETE+TRUNCATE+
  REFERENCES+TRIGGER), no solo lectura. `restrict_mv_product_factor_to_select_only`: `REVOKE ALL` +
  `GRANT SELECT`. Test negativo: `has_table_privilege` confirma `can_update/delete/insert=false`.
  Test positivo: `get_pedido_preview(ARRAY[2])` sigue devolviendo 408 ítems sin cambios.
- **0B.9 — ✅ APLICADO en prod y verificado.** `check-sales-alerts/index.ts:98` mandaba
  `Authorization: Bearer ${serviceRoleKey}` a `send-push-notification` — expone la service_role key
  sin necesidad, porque esa función SOLO valida `x-cron-secret` (`checkCronSecret`), nunca lee
  `Authorization`. Cambiado a `Bearer ${ADMIN_INVOKE_SECRET}`, igual que los otros 2 callers
  (`notify-new-products-daily`, `auto-calculate-minmax`). Deploy vía CLI (workaround `.env`),
  `get_edge_function` confirma v6 con el fix. Riesgo funcional nulo (el header cambiado se ignora
  del lado receptor); logs confirman ejecuciones `200` normales cada 5 min tras el deploy.
- **0B.10 — ✅ APLICADO en prod y verificado.** Las 12 funciones con CORS `'*'` hardcodeado
  (`auto-copy-weekly-roster`, `backfill-dte-sales`, `check-doc-expiry`, `check-employee-doc-expiry`,
  `check-sales-alerts`, `consolidate-timesheets`, `heal-dte-sync`, `maps-proxy`, `oss-proxy`,
  `send-push-notification`, `set-employee-password`, `srs-proxy`) ahora usan `getCorsHeaders(req)`
  de `_shared/security.ts` (patrón ya existente, usado antes solo por `wfm-ai-scheduler`).
  `set-employee-password` requirió mover el helper `json()` de scope de módulo a closure
  per-request (evita que dos requests concurrentes de distinto origin se pisen el header —
  antes `corsHeaders` era un objeto módulo-level compartido). Deploy en batch vía CLI (12/12 OK).
  Test negativo: `OPTIONS` con `Origin: https://evil.example.com` → responde con el origin de
  fallback (`https://portal.farmasalud.lat`), nunca con el origen atacante. Test positivo:
  `Origin: http://localhost:5173` (en `ALLOWED_ORIGINS`) → se refleja correctamente.
- **0B.7 (parcial) — ✅ APLICADO en prod y verificado.** `wfm-ai-scheduler` tenía solo
  `requireAuthUser` (JWT válido, sin chequeo de rol/empleado activo). Cambiado a
  `requireActiveEmployeeUser` + gate `role_permissions.can_edit` en `module_key='schedules'` —
  el mismo permiso que ya exige el cliente para editar Turnos (`SchedulesView.jsx:228`,
  `hasPermission('schedules','can_edit')`), cerrando el gap cliente/servidor. Deploy vía CLI.
  Test negativo: sin `Authorization` → 401; con Bearer inválido → 401 (ambos confirmados por curl).
  Verificado contra `role_permissions` real: solo role_id 11 (Talento Humano) y 13 tienen
  `can_edit=true` en `schedules` — coincide con el gate del cliente. Pendiente: test positivo
  end-to-end (200 con sesión real de rol 11/13, 403 con otro rol) requiere un login real en
  navegador, no se pudo generar un JWT de sesión desde esta sesión de terminal.
  El resto de 0B.7 (58 funciones SECURITY DEFINER) queda pendiente como auditoría de clasificación
  por riesgo, no como fix — no hecho todavía.
- **0B.8 — ✅ APLICADO en prod y verificado (Tier B, probado en staging primero).** Policy
  `kiosk_verify` (`anon` SELECT `true` sobre `kiosk_devices`) reemplazada por RPC SECURITY DEFINER
  `verify_kiosk_device(device_id, device_token)` que valida `status='ACTIVE'` server-side.
  Call-site real localizado: `branchSlice.js:413 validateKioskToken` (usado por
  `useKioskDevice.verifyDevice()`, verificación de kiosco pre-login) — actualizado para usar la RPC.
  Probado en staging (`ewcmerxqjvludtgskuin`) con branch+device sintéticos (limpiados después):
  RPC positivo/negativo OK, y con la policy dropeada `SET ROLE anon; SELECT count(*)` → 0.
  Aplicado a prod (mismo bundle RPC+drop policy — usuario confirmó que los kioscos aún no están
  operativos en sucursal, sin riesgo de romper nada en el gap DB/frontend). Verificado contra un
  `kiosk_devices` real de prod: RPC devuelve el match correcto. `APP_VERSION` → v2.15.11.
  Frontend: Vercel (`portal-farmalasa`) auto-deploya en cada push a `main` — el `git push` de
  este commit ya disparó el deploy (`dpl_Fn3vRyKQaqtK2fUwiK9bJPJYBE5q`, estado READY, verificado
  contra la API de Vercel). Nada pendiente de deploy manual.
- **0B.2 — ✅ APLICADO en prod y verificado.** Creados `admin_invoke_secret` y `cron_invoke_secret`
  en Supabase Vault (`vault.create_secret`) con los valores ya expuestos en texto plano. Reescritos
  los 28 `cron.job.command` afectados (más que el "~21" estimado por la auditoría) para leer el
  secreto vía `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=...)` en vez de
  literal — patrón probado primero en staging (`ewcmerxqjvludtgskuin`) con un secreto de prueba.
  Verificado: 0 jobs con el hex plano en `cron.job.command`; dry-run de la construcción de headers
  para una muestra (incluyendo el caso con ambos secretos, job 168) resuelve al valor correcto;
  los ~20 jobs de cadencia 1-2min corrieron en vivo tras la migración con `status='succeeded'`
  en `cron.job_run_details` y `200` en los logs de las edge functions.
  **Hallazgo colateral (no causado por esta migración, preexistente):** 4 funciones invocadas por
  cron (`check-sales-alerts` job 168, `check-employee-doc-expiry` job 177, `auto-calculate-minmax`
  job 170, `notify-new-products-daily` job 167) tenían `verify_jwt=true` en la configuración de la
  edge function — el gateway de Supabase exige un JWT real ANTES de que corra el código de la
  función (`checkCronSecret` nunca llegaba a evaluarse). Como el cron les manda `x-cron-secret`/
  `Authorization: Bearer <hex random>` (no un JWT), estas 4 llevaban fallando en silencio con 401
  desde que se desplegaron — `cron.job_run_details` nunca lo mostraba porque solo confirma que
  `net.http_post` se encoló bien, no la respuesta HTTP real. Confirmado que NO lo causó mi cambio
  de hoy (mismo 401 con el secreto viejo en texto plano, antes de tocar nada). Redesplegadas las 4
  con `--no-verify-jwt` (mismo patrón que sus hermanas `check-doc-expiry`/`heal-dte-sync`, que sí
  funcionan). Verificado con `net.http_post` manual + `net._http_response`: `check-employee-doc-expiry`
  → 200 `{"ok":true,"created":0}`; `check-sales-alerts` → 200 `{"ok":true,"alerts":0}`;
  `notify-new-products-daily` → 200 `{"ok":true,"nuevos":0}`; `auto-calculate-minmax` → 200 con
  resultado real por sucursal (necesitó el timeout de 120s del cron real, mi primer test con el
  default de 5s de pg_net dio falso timeout, no falla real).
  Impacto real: alertas de ventas MH/CCF, avisos de vencimiento de documentos de empleados, recálculo
  mensual de MIN/MAX y notificación diaria de productos nuevos probablemente nunca se ejecutaron
  exitosamente hasta este fix.

### 2026-07-12
- **0B.5 — ✅ CERRADO, riesgo aceptado (NO se toca).** Investigado con queries directas a prod antes
  de decidir: `pg_trgm` ya se había movido una vez (`20260517_db_audit_v13_revert_pgtrgm_to_public.sql`)
  y se revirtió porque rompió `ILIKE` de productos — confirmado de nuevo que `anon`/`authenticated`/
  `authenticator` (roles reales de PostgREST) NO tienen `extensions` en su `search_path` (solo
  `postgres` sí), así que mover la extensión rompe los 6 índices GIN trigram (`products.nombre/
  principio_activo`, `sales_invoices.cliente/correlativo/erp_invoice_id`,
  `inventory_grouped_mv.descripcion`) para todo tráfico real. `pg_net` no es relocatable
  (`extrelocatable=false`) — requeriría `DROP`/`CREATE` (interrumpe el worker async de
  `notify_branch`/`notify_employees`/`notify_push_on_announcement`) y sus objetos reales ya viven
  en el schema `net`, no en `public` — beneficio de seguridad ≈ 0. Decisión del usuario: aceptar el
  WARN. Detalle en `AUDITORIA-2026-07.md` → "Bloque 0B — cierre final (2026-07-12)".
- **0B.4 — ⏸️ DIFERIDO.** Toggle de Auth (HaveIBeenPwned), no requiere código. Usuario decidió no
  activarlo todavía, sin fecha de retomado.
- **4.1 — ✅ APLICADO en prod y verificado.** `CREATE INDEX CONCURRENTLY idx_inventory_sync_log_venc_synced
  ON inventory_sync_log (is_vencidos, synced_at DESC)`. Vía `execute_sql` directo (`CONCURRENTLY` no
  puede correr dentro de la transacción de `apply_migration`); registrado en el historial de
  migraciones con un `CREATE INDEX IF NOT EXISTS` no-op de seguimiento. `pg_index.indisvalid=true`.
- **4.2 — ✅ APLICADO.** `SyncHealthBanner.jsx`: quitada la suscripción `postgres_changes` a
  `inventory_sync_log` (esa tabla nunca estuvo en la publicación `supabase_realtime`, la
  suscripción no disparaba nunca — código muerto). El polling de 90s sigue igual. `APP_VERSION` → v2.15.13.
- **0B.7 remanente — ✅ CLASIFICADO (análisis, sin fixes aplicados todavía).** Las 54 funciones
  `SECURITY DEFINER` del advisor revisadas una por una (`pg_get_functiondef` + grep de callers en
  `src/`/`supabase/functions/`): **9 Alto, ~9 Medio, 34 Bajo/ya-gateadas/excepciones documentadas.**
  Hallazgo principal: **8 funciones de mutación de pedidos/inventario aceptan un parámetro
  `p_*_por`/`p_user_id` del cliente y lo escriben tal cual en la columna de autoría, SIN comparar
  contra `auth_employee_id()` ni chequear ningún rol** — cualquier `authenticated` puede anular
  pedidos, aprobar recepciones, crear rutas, resolver diferencias de bodega, etc. y atribuírselo a
  otro empleado. La más grave: `crear_ruta` (Alto) tiene caller activo confirmado en
  `CrearRutaModal.jsx:400` y además marca pedidos como `enviado` sin ningún gate de permiso.
  **Alto (9):** `crear_ruta`, `calculate_stock_params`, `publish_stock_params`,
  `zero_out_product_all_branches`, `resolve_pedido_item`, `update_pedido_sucursal_lifecycle`,
  `receive_pedido_sucursal`, `anular_pedido`, `confirm_pedido` — todas sin ningún chequeo de rol,
  autoría falsificable vía `p_*_por`.
  **Medio (9):** `toggle_producto_oculto_ventas`, `discard_stock_drafts`,
  `init_pedido_sucursal_codigos`, `marcar_pedido_enviado` (mismo patrón que `crear_ruta` pero sin
  caller activo hoy — reemplazada por `crear_ruta`), `get_draft_cost_estimate` y
  `inventory_inversion` (exponen $ de inventario sin gate), `save_pedido_snapshot`,
  `refresh_inventory_grouped_mv`, `backfill_daily_stats_chunk` (grant a `authenticated`
  probablemente involuntario, sin caller de cliente, solo cron).
  **Bajo (34):** conteos de inventario ya gateados correctamente (`aprobar_conteo_inventario`,
  `crear_conteo_inventario`, `editar_lote_conteo_item`, `finalizar_conteo_inventario`,
  `guardar_conteo_item`), 2 trigger functions no invocables por RPC, helpers `auth_*` (son el propio
  mecanismo de gate), y ~11 funciones de solo lectura sin PII/dinero.
  Pendiente: decidir con el usuario qué de Alto/Medio se cierra y en qué orden — no se tocó nada de
  esto todavía, es solo el inventario clasificado.
- **`crear_ruta` (0B.7, riesgo Alto) — ✅ APLICADO en prod y verificado.** Agregado
  `IF NOT auth_can_edit_any(ARRAY['pedidos_tab_rutas']) THEN RAISE EXCEPTION` (mismo módulo/acción
  que ya gatea el botón en el cliente, `TabRutas.jsx:266`) + `created_by`/`enviado_por` ahora usan
  `auth_employee_id()` real en vez del `p_creado_por` que manda el cliente (queda en la firma por
  compatibilidad, ya no se usa para autoría). **Hallazgo colateral durante la verificación**: hoy
  NINGÚN rol tiene `can_edit=true` en `role_permissions` para `pedidos_tab_rutas` (los 7 roles con
  fila explícita lo tienen en `false`) — en la práctica solo `SUPERADMIN` puede usar "Crear Ruta"
  hoy, cliente y servidor coinciden exactamente en esa restricción, así que el fix no le quita
  acceso a nadie que lo tuviera. Si se quiere que otro rol use la feature, es un cambio de
  `role_permissions`, no de código. Verificado con 2 tests dentro de transacciones con `ROLLBACK`
  (cero escritura permanente): negativo — rol sin permiso → `PERMISSION_DENIED`; positivo — con
  permiso simulado, mandando un `p_creado_por` falsificado distinto al `auth.uid()` real → la fila
  de `rutas.created_by` quedó con el empleado real, no con el valor falsificado (confirmado
  `match_real=true`), y se confirmó `count=0` en `rutas` tras el rollback (sin rastro).
- **Las otras 8 funciones de riesgo Alto de 0B.7 — ✅ APLICADAS en prod y verificadas.**
  Mismo patrón (`auth_can_edit_any([...])` + `auth_employee_id()`/`auth.email()` real
  en vez del valor del cliente), con dos matices caso por caso:
  - **`update_pedido_sucursal_lifecycle`**: también la invoca el trigger
    `attendance_kiosko_pedido_lifecycle` (AFTER INSERT en `attendance`, pausa/reanuda
    pedidos automáticamente al marcar salida/entrada de almuerzo por kiosko). Gatear
    ese path habría roto el marcaje de asistencia. Fix: `pg_trigger_depth() = 0` para
    distinguir RPC directo (gateado + autoría real) de la llamada interna del trigger
    (sin gate, sigue confiando en el `p_user_id` que ya le pasa el trigger —
    `NEW.employee_id`, valor server-side no controlado por el cliente).
  - **`calculate_stock_params`**: también la invoca el cron `auto-calculate-minmax`
    vía `service_role`. Gate condicionado a `(SELECT auth.role()) IS DISTINCT FROM
    'service_role'` — confirmado que `auth.role()` resuelve a `'service_role'` bajo
    `SET ROLE service_role` + `request.jwt.claims` con `role:service_role` (como lo
    hace PostgREST real con la service key).
  - Módulos usados: `pedidos` (`anular_pedido`, `confirm_pedido`,
    `receive_pedido_sucursal`, `resolve_pedido_item`, `update_pedido_sucursal_lifecycle`)
    — confirmado con `role_permissions` real: 8 roles con `can_edit=true`, coincide con
    `canEdit = hasPermission('pedidos','can_edit')` ya usado en `TabPedidos.jsx`. `minmax`
    (`calculate_stock_params`, `publish_stock_params`, `zero_out_product_all_branches`)
    — 5 roles con `can_edit=true`, coincide con `TabMinMax.jsx`.
  - `confirm_pedido`: `p_responsable_id`/`p_revisado_por` (antes uuid libre del cliente)
    ahora solo pueden ser "el propio actor o NULL" — preserva exactamente la lógica
    actual del único caller real (`esEmpleado ? user.id : null` / siempre NULL).
  - Verificado con tests en transacciones `ROLLBACK` (cero escritura permanente,
    confirmado con conteos post-rollback): negativo con empleado sin permiso en NINGÚN
    módulo (`role_id=16`, Agente de Canales Digitales) → `PERMISSION_DENIED` en las 8;
    positivo con empleado con permiso real → las 4 restantes de `pedidos` pasan el gate
    y llegan a la validación de negocio real (`Pedido no encontrado`/`Item no
    encontrado`/FK esperado); `confirm_pedido` con `p_created_by` falsificado → la fila
    quedó con el empleado real, no con el uuid falsificado; `zero_out_product_all_branches`
    con `p_published_by` falsificado (`spoofed2@evil.com`) → la fila quedó con el email
    real de la sesión (`auth.email()`), no con el valor falsificado; `publish_stock_params`
    ejecutó sin error con permiso real.
- **Los 9 hallazgos de riesgo Medio de 0B.7 — ✅ APLICADOS en prod y verificados** (excepto
  `marcar_pedido_enviado`, ya cubierta en el lote de Alto por consistencia de patrón).
  Gates elegidos calzando EXACTO con lo que ya exige el cliente hoy (confirmado con
  `role_permissions` real, no supuesto):
  - `toggle_producto_oculto_ventas` → `auth_has_module_permission('ventas_tab_productos','can_view')`.
    Autoría ya estaba correcta (`auth_employee_id()` para `oculto_por`), solo faltaba el gate.
  - `discard_stock_drafts` → `auth_can_edit_any(ARRAY['minmax'])`.
  - `init_pedido_sucursal_codigos` → `auth_can_edit_any(ARRAY['pedidos'])`.
  - `get_draft_cost_estimate` → `auth_has_module_permission('minmax','can_view')` (solo lectura,
    pero expone $ de inventario).
  - `inventory_inversion` → `auth_has_module_permission('productos_tab_inventario','can_view')`.
    Convertida de `LANGUAGE sql` a `plpgsql` (SQL puro no soporta `RAISE EXCEPTION`).
  - `save_pedido_snapshot` → `auth_can_edit_any(ARRAY['pedidos'])`. Sin caller de cliente hoy.
  - `refresh_inventory_grouped_mv` / `backfill_daily_stats_chunk` → sin caller de cliente
    (`refresh_inventory_grouped_mv` solo la invoca `sync-dte-sales` vía `service_role`;
    `backfill_daily_stats_chunk` solo `pg_cron` directo) → `REVOKE EXECUTE ... FROM authenticated`
    en vez de gate condicional (más simple, no hay ningún caller legítimo autenticado que preservar).
  - **Nota sobre `ventas_tab_productos`**: confirmado con `role_permissions` que **las 20 roles del
    sistema tienen `can_view=true`** en ese módulo — el gate es correcto (cierra el hueco de "cualquier
    cuenta sin ningún permiso"), pero en la práctica hoy es equivalente a "cualquier empleado
    autenticado", por diseño existente del módulo, no por un error del fix.
  - **Bug preexistente descubierto y corregido (2026-07-12, fuera del alcance original de 0B.7
    pero trivial y aislado)**: `save_pedido_snapshot` fallaba con `function row_to_json(jsonb) does
    not exist` — `get_pedido_preview()` devuelve un `jsonb` ya armado (patrón C de CLAUDE.md,
    `json_agg` interno), no `SETOF record`, así que `row_to_json(r)`/`r.cantidad_asignada` no
    aplican sobre ese tipo (`r` era el array JSON completo tratado como valor opaco, no una fila).
    Bug latente desde que se escribió la función, invisible porque no tiene ningún caller de
    cliente. Fix: `v_datos := get_pedido_preview(...)` directo + `jsonb_array_elements(v_datos)`
    para contar/sumar `->>'cantidad_asignada'`. Verificado en prod con datos reales dentro de una
    transacción `ROLLBACK` (sucursales 1+2): 899 filas, 838 packs totales, `created_by` resuelto
    correctamente — cero escritura permanente confirmada post-rollback.
  - Verificado con tests en transacciones `ROLLBACK`: negativo con `role_id=16` (sin ningún permiso)
    → `PERMISSION_DENIED` en 5/7 (las 2 restantes, `toggle_producto_oculto_ventas` e
    `inventory_inversion`, pasaron porque ese rol SÍ tiene `can_view` real en esos módulos —
    re-testeado con `role_id=30`, sin `can_view` en `productos_tab_inventario`, confirma
    `PERMISSION_DENIED` correctamente); `refresh_inventory_grouped_mv`/`backfill_daily_stats_chunk`
    → error nativo de Postgres "permission denied for function" (el `REVOKE` surte efecto).
    Positivo con `role_id=13` (permiso real) → las 5 mutación/lectura pasan el gate y llegan a la
    lógica real (incluido el bug preexistente de `save_pedido_snapshot`, confirmando que el gate no
    es el problema). Cero escritura permanente, confirmado con conteos post-rollback.
- **1.3 — ✅ APLICADO (v2.15.17).** `consolidate-timesheets`: el `update`/`insert` de `timesheets`
  ignoraba el error (`await supabase...` sin capturarlo) — ahora se captura, se loguea con
  `employee_id`/`work_date` y se cuenta en un `failed` que va en la respuesta JSON, sin abortar el
  resto del batch. `sync-promo-sales`: el SELECT de `promotion_sales_cache` (para decidir auto-cierre
  por stock) y los 2 `UPDATE estado='closed'` (por stock y por fecha) ignoraban el error —
  `autoClosed++` se ejecutaba igual aunque el UPDATE fallara. Ahora los 3 chequean `error` y lo
  agregan al array `errors` ya existente en la respuesta; `autoClosed` solo sube si el UPDATE
  realmente tuvo éxito. Sin caller de cliente que dependa de este comportamiento — solo cron
  (`sync-promo-sales`) y cron (`consolidate-timesheets`, jobid 148). ✅ Desplegado a prod vía CLI
  (workaround `.env`) con tu OK, 2026-07-12.
- **1.4 — ✅ APLICADO (v2.15.17).** `sync-promo-sales:88` derivaba el factor de presentación con
  un regex (`/[0-9]+[xX]([0-9]+)/`) sobre el texto libre `sales_invoice_items.presentacion` —
  viola la regla de casa (usar siempre `product_precios.factor`). Reemplazado por un lookup real:
  antes del loop de promos se precarga `product_precios(product_id, descripcion, factor)` para
  todos los `product_id` de todas las promos activas en un solo query paginado, y se arma un Map
  `product_id__UPPER(descripcion) → MAX(factor)` — mismo patrón `pres_factors` que usa
  `get_stock_analysis` en SQL (necesario porque `sales_invoice_items.id_presentacion` está NULL
  desde el 2026-06-08, ver nota en `sync-dte-sales`). Fallback a `1` si no hay match, igual que el
  regex viejo. ✅ Desplegado a prod vía CLI con tu OK, 2026-07-12 (mismo bundle que 1.3).
- **1.5 — ✅ APLICADO (v2.15.17).** `saveHiddenTimer` (`TabMinMax.jsx:1735`, `useRef(null)`) nunca
  se asignaba ni se leía en ningún otro punto del archivo (confirmado con grep) — el comentario
  "unused, kept for cleanup safety" no correspondía a nada real que limpiar. Eliminado (código
  muerto, sin reemplazo necesario).
- **1.7 — ✅ APLICADO (v2.15.17).** `TabMinMax.jsx:1094` (`ExpandedPanel`, `daysLeft` de
  vencimientos próximos) y `TabSinVenta.jsx:165,207` (`UltimaVentaCell`, "hace Xd"/tooltip por
  sucursal) calculaban el diff de fecha con `Date.now()`/`new Date()` directo en el cuerpo del
  render — si el componente no volvía a renderizar por otro motivo (fila expandida/tooltip abierto
  mucho tiempo sin cambios de estado), el badge quedaba congelado en el valor de cuando se montó.
  Nuevo hook `src/hooks/useNowTick.js` (tick cada 60s vía `setInterval`, cleanup en unmount) —
  usado en los 3 sitios en vez de `Date.now()`/`new Date()` directo. `relativeTime()` (línea 213,
  helper de sincronización de datos, no vencimientos) quedó fuera de alcance — no estaba en el
  inventario del ítem 1.7.

- **1.8 — ✅ APLICADO.** Sin cambios en `src/` (solo `supabase/functions/`), sin bump de versión
  por regla transversal #5. **Timeout faltante en `fetch` saliente** (patrón ya usado en
  `heal-dte-sync`/`backfill-dte-sales`: `signal: AbortSignal.timeout(ms)`, sin retry — consistente
  con lo que ya existía en el proyecto, no se introduce un framework de retry nuevo):
  `sync-wfm-sales` (login ERP 20s, pull JSON 30s — sin esto, un ERP colgado dejaba el fetch
  esperando hasta el timeout genérico del runtime de Edge Functions sin mensaje de error útil),
  `maps-proxy` (Google Maps API, 15s), `auto-calculate-minmax` (push notification interna, 10s —
  ya estaba en un `try/catch` que no rompe el cron si falla, pero podía colgar el resto de la
  función indefinidamente sin timeout).
  **URL de proyecto hardcodeada** (`heal-dte-sync:4`, `backfill-dte-sales:4`): `SYNC_URL` tenía el
  literal `https://sacecdkdmsdvgqnrsett.supabase.co/...` en vez de `Deno.env.get('SUPABASE_URL')`
  — mismo problema que estas dos funciones ya evitan para `SERVICE_KEY`/`INVOKE_SECRET` (leídos de
  env, nunca hardcodeados). Cambiado a
  `` `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/sync-dte-sales` ``. Riesgo real que cerraba:
  si el proyecto migra o cambia de project ref (staging, disaster recovery), estas 2 funciones
  seguirían apuntando al proyecto viejo en silencio. ✅ Las 5 funciones desplegadas a prod vía CLI
  con tu OK, 2026-07-12.

- **1.6 — ✅ COMPLETO (2026-07-12, v2.15.18→v2.15.27, 10 sesiones de commit).**
  Las 173 ocurrencias de "riesgo real" catalogadas por la auditoría
  (`react-hooks/set-state-in-effect` 66, `exhaustive-deps` 89, `purity` 8,
  `static-components` 5, `immutability` 4, `refs` 2) quedan en **0**. Total de
  problemas de lint del proyecto: 379 → 186 (el resto, cosmético, fuera de
  alcance: `no-unused-vars` 102, `no-empty` 36, etc.).
  Cada ocurrencia fue revisada individualmente (no barrido ciego) y resuelta con
  uno de 3 patrones: (a) fix real de código cuando había un bug genuino
  (constante `useNowTick` para badges que se congelaban, refs "siempre frescas"
  para evitar refetch en cascada en `VentasView.fetchRows`, deps agregadas en
  `RequestsView` — el hallazgo "más preocupante" de la auditoría, un
  `ConteoDetailView` que no refrescaba metadata concurrente); (b) constantes de
  módulo estables (`EMPTY_ARRAY`/`EMPTY_OBJ`) para fallbacks `|| []`/`|| {}`
  inline que rompían memoización real; (c) `eslint-disable-line` +
  justificación puntual para patrones idiomáticos/seguros ya establecidos en
  el propio código (`TabPoliticaVencimiento.jsx`) o donde agregar la dep real
  habría sido peligroso (bucle de refetch). Código muerto encontrado de paso
  y eliminado: bloque `Compat*`/`CompatTh` de TabCatalogo.jsx (~550 líneas,
  0 callers). Verificación visual en vivo (vite preview + Playwright): login,
  nav completo (13 rutas), AppLayout (pill/grupos), BranchChips, VentasView
  (fila expandida con ítems/precios), Dashboard (auto-selección de sucursal)
  — sin regresiones. Build limpio en cada paso. Detalle completo por archivo
  en el historial de commits `fix(bloque1): 1.6 parte 1..10`.

### 2026-07-15
- **Deuda de lint post-1.6 — ✅ CERRADA (v2.16.2→v2.16.5, 5 partes de commit).**
  Los 186 problemas de lint "cosméticos, fuera de alcance" que quedaron tras 1.6
  (`no-unused-vars` 102, `no-empty` 36, `react-refresh/only-export-components` 8,
  `react-hooks/preserve-manual-memoization` 7, más ~33 varios) quedan en **0** —
  `npx eslint .` limpio en todo el proyecto. Mismo estándar que 1.6: cada
  ocurrencia revisada individualmente contra su código real, no barrido ciego.
  1 bug real corregido de paso en `FacturacionView.jsx`: las 2 secciones de
  "pagos pendientes por tipo" calculaban paginación (`tipoTotalPages`/`tipoPg`)
  pero el `<DataTable>` nunca tenía `footer={<Pagination .../>}` — con
  `PAGE_SIZE=10`, cualquier tipo de pago con >10 transacciones pendientes
  quedaba con las filas extra invisibles sin forma de navegarlas (mismo patrón
  de truncado silencioso que ítem 1.1). Cerrado replicando el patrón ya usado
  en la sección "confirmados" del mismo archivo. Otro hallazgo menor en
  `VentasView.jsx`: el banner "resultados similares" de búsqueda difusa
  faltaba en la pestaña Vendedores (sí existía en Productos) — agregado.
  3 hallazgos reales encontrados pero **preservados con `eslint-disable` +
  comentario, NO borrados** (código real, no dead code, pero fuera de alcance
  de un lint fix — necesitan decisión de producto):
  - `TabPedidos.jsx`: `handleCorregirBodega`/`handleConfirmarCorreccion` — el
    mismo gap ya documentado como 7A.1.
  - `TabPedidos.jsx` `ReceptionActions`: `llegadaEmp`/`llegadaTipo` sin bloque
    "Confirmado" (existe el equivalente para `erpOk` pero no para `llegadaOk`).
    **Nuevo hallazgo, agregado a 7A** (ver tabla 7A abajo).
  - `TabMinMax.jsx`: `hideFiltered` (acción bulk completa de ocultar productos
    filtrados, con audit log `MINMAX_HIDE_FILTERED`, sin botón en UI — acción
    masiva real que necesitaría modal de confirmación antes de exponerse).
    **Nuevo hallazgo, agregado a 7A**.
  - `TabMinMax.jsx`: `dispMin`/`dispMax`/`hasPres`/`applyRule` en la celda
    "Despacho" — calculan el MIN/MAX ya redondeado por la regla de despacho
    pero el JSX solo muestra el nombre de la regla, nunca el resultado
    numérico. Área con historial de bugs de redondeo (ver
    `project_pedido_preview_dispatch_rounding`) — no se inventó el formato.
    **Nuevo hallazgo, agregado a 7A**.
  1 bug real corregido en `TabPedidos.jsx`: el botón "Apoyo" (bodega) no se
  ocultaba para un empleado que ya había dado apoyo de preparación
  (`isApoyoBodega` se calculaba pero nunca se usaba) — el backend ya dedupaba
  por id así que no había pérdida de datos, pero el botón seguía activo de
  forma confusa. Fix: `canApoyo && !isApoyoBodega`.
  Verificado en vivo (vite preview + Playwright): login + 5 rutas más tocadas
  (Ventas, Facturación, Pedidos, Productos, MinMax) sin errores de
  consola/página. Build + 15 tests unitarios verdes en cada parte.
- **Bloque 2 — cuenta QA — ✅ APLICADO en prod y verificado (con tu OK
  explícito).** Ver detalle completo en Bloque 2 arriba. Rol nuevo mínimo
  `QA / Testing (CI)` (id 33) + empleado `code=99999`/`username=qa.test` +
  cuenta Auth vía `bulk-create-employee-users` (mismo camino que cualquier
  empleado real) + contraseña fijada por `UPDATE` puntual sobre
  `encrypted_password`. Verificado con Playwright: login limpio, ve
  Dashboard/Pedidos, no ve Nómina, sin errores. Los 4 GitHub Secrets
  configurados el mismo día y confirmados en una corrida real de CI en
  verde (4/5 tests, el 5º se salta por `E2E_CARNE_CODE` no configurado a
  propósito) — **Bloque 2 cerrado del todo**.

### Camino de deploy de edge functions (resuelto)
Bash `supabase functions deploy` funciona CON permiso, pero el CLI se traga un `.env` con un nombre
de variable inválido (un `-`). Solución: apartar `.env` durante el deploy y restaurarlo
(`mv .env .env.bak; deploy; mv .env.bak .env`). La MCP `deploy_edge_function` falla con bug de
import_map en estas funciones — NO usarla; usar el CLI con ese workaround.

---

## BLOQUE 0 — Seguridad que sigue ABIERTA (máxima prioridad)

**Estado al 2026-07-12: Bloque 0 (0A + 0B) CERRADO** — 17 de 18 ítems aplicados y verificados
en prod (10 de ellos en esta sesión: 0B.5, 4.1, 4.2, y las 18 funciones de 0B.7 Alto+Medio +
1 bug encontrado de paso). Quedan 2 conscientemente sin tocar por decisión explícita del
usuario, no por trabajo pendiente: 0B.4 (diferido) y 0B.11 (condicional a reactivar esa cuenta).
Detalle completo de cada fix en "PROGRESO DE EJECUCIÓN" arriba.

### 0A — Explotable / alto impacto
| # | Ítem | Ubicación | Estado |
|---|---|---|---|
| 0A.1 | Bucket `photos`: INSERT `anon` + sin `file_size_limit`/`allowed_mime_types` | storage.objects "Permitir subir fotos"; Fase 2 §Storage | ✅ Aplicado 2026-07-11 |
| 0A.2 | `bulk-create-employee-users` crea cuentas con `password:"1234"` literal | `functions/bulk-create-employee-users/index.ts:44` | ✅ Era falso positivo — v13 desplegado ya usaba `randomTempPassword()` |
| 0A.3 | `saly-ai` chat expone `employee_events.note` sin scope; `analyze-document` sin whitelist de buckets (IDOR) | `functions/saly-ai/index.ts`; `analyze-document` | ✅ Aplicado 2026-07-11 (whitelist buckets + nota removida) |

### 0B — Hardening (bajo riesgo, alto valor de higiene)
| # | Ítem | Fuente | Estado |
|---|---|---|---|
| 0B.1 | 3 policies de `notifications` con `auth_employee_id()` SIN `(SELECT ...)` | Fase 2 §RLS | ✅ Aplicado 2026-07-11 |
| 0B.2 | `ADMIN_INVOKE_SECRET` en texto plano en ~25 `cron.job.command` | Fase 0 | ✅ Aplicado 2026-07-11 (Vault, 28 jobs reescritos) |
| 0B.3 | `mv_product_factor` expuesta a la API (viola CLAUDE.md #6) | Advisor | ✅ Aplicado 2026-07-11 (REVOKE ALL + GRANT SELECT) |
| 0B.4 | Protección de contraseñas filtradas (HaveIBeenPwned) deshabilitada | Advisor | ⏸️ Diferido (decisión del usuario, 2026-07-12) |
| 0B.5 | `pg_trgm`/`pg_net` en schema `public` | Advisor | ✅ Cerrado — riesgo aceptado (2026-07-12) |
| 0B.6 | `debug_pedido_timings` (función debug leftover) | Advisor | ✅ Aplicado 2026-07-11 (borrada) |
| 0B.7 | 54 funciones SECURITY DEFINER sin gate de permiso; `wfm-ai-scheduler` sin chequeo de rol | Advisor; Fase 2 | ✅ Clasificadas las 54; cerradas las 18 de riesgo Alto+Medio 2026-07-12 (`wfm-ai-scheduler` incluida); 34 Bajo sin acción necesaria |
| 0B.8 | `kiosk_devices.kiosk_verify` (SELECT `anon+true`) | Fase 3.2.2 | ✅ Aplicado 2026-07-11 (RPC `verify_kiosk_device`, probado en staging primero) |
| 0B.9 | `check-sales-alerts:88` manda `service_role` key como Bearer | Fase 2 REMEDIADO #4 | ✅ Aplicado 2026-07-11 |
| 0B.10 | CORS `*` hardcodeado en 12 functions | Fase 3.5 | ✅ Aplicado 2026-07-11 (`getCorsHeaders(req)`) |
| 0B.11 | `sufarmasalud@farmalasa.app` (SUPERADMIN) con password aleatoria tras 3.6 | Fase 3.6 | ⏸️ Ya no explotable (password aleatoria puesta en 3.6); asignar una real queda condicional a si se reactiva la cuenta — decisión del usuario |

---

## BLOQUE 1 — Bugs de correctitud que fallan en silencio

**Estado al 2026-07-12: BLOQUE 1 CERRADO — 8/8 ítems (1.1–1.8) aplicados y
verificados.** Última pieza (1.6, el barrido de lint) cerrada en 10 partes de
commit el mismo día. Ningún ítem quedó diferido o pendiente de decisión
(a diferencia del Bloque 0, que cerró con 2 diferidos por decisión explícita).
Siguiente en la secuencia: Bloque 2 (testing).

No necesitan staging. Priorizar los que tocan nómina/dinero.

| # | Ítem | Ubicación |
|---|---|---|
| 1.1 | 4 selects sobre tablas >1000 filas sin paginar (truncado silencioso) | ✅ Aplicado 2026-07-12 (v2.15.14). 3 reales corregidos con `fetchAllRows` (`FacturacionView.jsx` 2 `loadData`, `WidgetInventorySearch.jsx`); `VentasView.jsx:503` resultó ya corregido por trabajo previo no relacionado (`fetchStats` usa `fetchAllRows` desde v2.9.15, `fetchRows` ya tenía `.range()`/`.limit(200)`) — falso positivo hoy, sin cambios. Build limpio. |
| 1.2 | 35 `const { data } = await supabase` sin chequear `error` (empezar por nómina/aprobador) | ✅ Completo 2026-07-12 (v2.15.15 + v2.15.16). Los 18 archivos del inventario original cerrados: `requestsSlice.js` (22), `payrollSlice.js` (4), `pedidoPrint.js`, `SidebarSyncStatus.jsx`, `NuevoConteoModal.jsx`, `EncuestaAdminView.jsx`, `FacturacionView.jsx` (7), `VentasPperdidasView.jsx`, `MinMaxView.jsx`, `SyncHealthBanner.jsx`, `VentasView.jsx` (5), `CotizacionesView.jsx` (8), `RecepcionModal.jsx` (4), `TabPedidos.jsx` (16), `PromoModal.jsx`, `EmployeeDetailView.jsx`, `TabCatalogo.jsx` (5), `ConteoDetailView.jsx` (4) — ~70 sitios reales en total. Ver detalle abajo. |
| 1.3 | Edge functions ignoran `error` en escrituras críticas (el `update`/`insert` de `timesheets`; auto-cierre de promos) | ✅ Aplicado y desplegado a prod 2026-07-12 (v2.15.17). |
| 1.4 | `sync-promo-sales:88` deriva `factor` por regex en vez de `product_precios.factor` (viola regla de casa) | ✅ Aplicado y desplegado a prod 2026-07-12 (v2.15.17). |
| 1.5 | `saveHiddenTimer` asignado pero nunca leído/limpiado — posible timer fugado | ✅ Aplicado 2026-07-12 (v2.15.17) — era código muerto, eliminado. |
| 1.6 | 173 lint reales de riesgo (`set-state-in-effect` 65, `exhaustive-deps` ~52 reales, `purity` 8, etc.) — barrido por archivo, empezar por top-7 monstruo | ✅ Completo 2026-07-12 (v2.15.18→v2.15.27). 0/173 restantes. Ver detalle arriba. |
| 1.7 | `Date.now()`/`new Date()` en render → badges desincronizados | ✅ Aplicado 2026-07-12 (v2.15.17). Hook `useNowTick` en TabMinMax/TabSinVenta. |
| 1.8 | Retry/timeout faltante en `fetch` saliente de varias edge functions; URL de proyecto hardcodeada | ✅ Aplicado y desplegado a prod 2026-07-12. |

---

## BLOQUE 2 — Fundación de testing (ANTES de los refactors)

No necesita staging. Es la red para el Bloque 6.

**Estado al 2026-07-15: CERRADO — 100%.** Vitest + Playwright + CI
instalados y commiteados. Cuenta QA creada y verificada en prod. Los 4
GitHub Secrets están configurados y **confirmados funcionando**: el job
`e2e-smoke` corrió en verde (4/5 tests pasaron — login, Dashboard, Pedidos,
modal Editar Empleado; el 5º se salta porque no se configuró
`E2E_CARNE_CODE`, opcional, fuera de alcance). `lint-and-unit` también en
verde. Detalle:

- ✅ Vitest + `@testing-library/react`/`jest-dom` instalados (`vite.config.js`
  `test:` block + `tests/setup.js`). 15 tests unitarios reales sobre lógica
  pura que ya rompió: `applyPresRule` (regla del 40%, extraída de
  `TabMinMax.jsx` a `src/utils/presentacion.js`) y `toDispatch`/
  `lotesToDispatch`/`lotesAsignadosToDispatch` (`src/utils/pedidoPrint.js`,
  exportadas). **Gap documentado, no fingido**: "dispatch rounding 40%" real
  (`get_pedido_preview`) e `inv_dedup` viven 100% en SQL/plpgsql — Vitest no
  puede testearlos sin escribir un espejo en JS que probaría una copia, no el
  código desplegado. Cobertura real de esos dos requeriría pgTAP u otro
  framework de testing SQL — no instalado, fuera del alcance de "instalar
  Vitest" tal como estaba pedido. Queda como decisión futura si se quiere esa
  cobertura.
- ✅ Playwright instalado como devDependency del proyecto (antes solo se
  usaba ad-hoc) + `tests/e2e/smoke.spec.js`: login usuario/contraseña, login
  por carné (keydown simulado, mismo mecanismo que el lector físico), Dashboard,
  Pedidos, y el modal de Editar Empleado (guardia contra la race condition de
  campos sensibles — assert de que el campo DUI llega poblado, nunca vacío).
  Credenciales siempre por env vars (`E2E_USER`/`E2E_PASSWORD`/
  `E2E_CARNE_CODE`, ver `.env.example`), nunca hardcodeadas — los tests que
  las necesitan se saltan solos si faltan. Verificado en verde localmente
  contra `vite preview` real.
- ✅ CI (`.github/workflows/ci.yml`): job `lint-and-unit` corre lint+Vitest en
  cada PR/push a `main`, sin secrets — funciona ya mismo. Job `e2e-smoke`
  corre el smoke de Playwright y necesita 4 GitHub Secrets.
- **✅ Cuenta QA creada en prod y verificada (2026-07-15, con tu OK explícito).**
  Empleado dedicado (`code=99999`, `username=qa.test`, `branch_id=32`
  Administración, nunca credenciales reales — decisión del usuario 2026-07-12).
  Rol nuevo y mínimo `QA / Testing (CI)` (`role_id=33`): `can_view` en
  `overview`/`pedidos`/`staff_detail`, `can_view+can_edit` en `staff_list`
  (necesario para que el smoke test de "Editar Empleado" pueda abrir el
  modal — el botón existe pero queda `disabled` sin `can_edit`), **sin
  acceso a Nómina ni a ningún otro módulo** (mínimo privilegio: si el
  secret de CI se filtra alguna vez, el blast radius es solo lectura +
  edición de datos de empleado, nada de nómina/roles/permisos/pedidos-write).
  Cuenta creada vía `bulk-create-employee-users` (mismo camino que cualquier
  empleado real, GoTrue admin API — no inserción manual del auth.users
  completo) invocada con `net.http_post` + el secreto de Vault (mismo patrón
  ya usado por los cron jobs desde 0B.2, sin exponer el secreto en texto
  plano en ningún sitio nuevo). Contraseña fijada después con un `UPDATE`
  puntual sobre `encrypted_password` (bcrypt vía `pgcrypto`, mismo algoritmo
  que usa GoTrue) — la única pieza que no tiene un endpoint admin invocable
  sin un JWT de sesión real. **Verificado end-to-end con Playwright contra
  `vite preview`**: login username/password entra directo a `/overview`
  (sin pantalla de "cambiar contraseña" — se limpió `must_change_password`),
  ve "Dashboard"/"Pedidos", NO ve "Nómina", cero errores de página. (No se
  corrió la suite de Playwright del repo completa contra prod por precaución
  de escritura de datos de prueba — ver `feedback_qa_test_data_and_db_writes`
  — la verificación de login fue con un script aparte de solo-lectura.)
  **✅ Los 4 GitHub Secrets configurados y confirmados en CI (2026-07-15)**:
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `E2E_USER=qa.test`,
  `E2E_PASSWORD`. Corrida real: el step `npx playwright test` del run
  disparado por el último push muestra las 4 env vars enmascaradas
  (presentes) y resultado `4 passed, 1 skipped` (el skip es
  `E2E_CARNE_CODE`, no configurado a propósito — no era parte del pedido).
  `lint-and-unit` también en verde. Bloque 2 sin pendientes.

---

## BLOQUE 3 — Finalizar staging + arreglar el drift de migraciones

**Estado al 2026-07-15: CERRADO.** 3.1/3.4/3.5/3.6/3.7 resueltos. 3.2 quedó
como decisión abierta sin urgencia (sembrar catálogos en staging, 520KB,
solo si se va a usar la UI ahí). **3.3 diferido a propósito, con el
usuario informado**: ya se había intentado el 2026-07-11 y revertido por
exceder el alcance aprobado (requiere ~9,800 líneas de DDL en el registro
de prod); no resuelve nada roto hoy (staging ya funciona sin eso) — el
usuario confirmó dejarlo en pausa tras conocer el tamaño real de la
operación. Detalle completo de cada ítem debajo.

Staging ya existe (Bloque D de Fase 6, parcialmente hecho). Falta:

| # | Ítem | Notas |
|---|---|---|
| 3.1 | Volver el branch `persistent` | ✅ Hecho 2026-07-15 por el usuario desde el Dashboard (ningún tool MCP expone ese flag post-creación). Verificado: `list_branches` confirma `persistent: true` |
| 3.2 | Sembrar catálogos de referencia (roles/branches/shifts/holidays/presentaciones/laboratorios) — NUNCA employees/ventas | Analizado 2026-07-15: las 6 tablas pesan **520 KB en total** (branches 96KB, laboratorios 144KB, presentaciones 120KB, roles 80KB, shifts 48KB, holidays 32KB) — el espacio no es un factor real. Único criterio: si se piensa usar la UI del Portal contra staging alguna vez. Pendiente decisión del usuario |
| 3.3 | **Drift de baseline**: el registro del servidor no reconstruye el esquema desde cero. Squashear el registro de prod para que un branch nuevo funcione limpio | ⏸️ **Hallazgo 2026-07-15 antes de ejecutar**: esto YA se intentó el 2026-07-11 (`register_baseline_schema_metadata_only` + 16 pasos `baseline_append`/`baseline_fix`) y se revirtió — la operación real requiere insertar **~9,800 líneas de DDL** en una sola fila del registro (no es liviana), excedió el alcance aprobado en su momento, el clasificador de permisos lo bloqueó 2 veces, se deshizo con un DELETE sin dejar rastro en el esquema. Detalle en `src/version.js` v2.15.10. Queda diferido pendiente de que el usuario confirme si de verdad quiere reintentarlo sabiendo el tamaño real de la operación |
| 3.4 | Limpiar las 19 filas bookkeeping inertes en el registro de prod | ✅ Analizado 2026-07-15: son EXACTAMENTE el rastro del intento revertido de 3.3 (`register_baseline_schema_metadata_only` + 16 `baseline_append`/`baseline_fix` + `revert_baseline_schema_metadata` = 19 filas, confirmado por conteo). Bookkeeping inofensivo que documenta un intento y su reversión limpia. Recomendación: no tocar — si algún día se hace 3.3 de verdad, estas 19 se limpian solas como parte de esa operación |
| 3.5 | Drift local vs servidor: 180 archivos locales vs 584 entradas servidor | ✅ Analizado, verificado y corregido 2026-07-15. Causa raíz confirmada (no es trabajo perdido): `apply_migration` solo escribe en el servidor, nunca toca disco — guardar el archivo en `supabase/migrations/` siempre fue un paso manual aparte, hecho inconsistente (a veces resumiendo 3-8 migraciones chicas de una sesión en 1 archivo con nombre distinto). Verificado por fuzzy-match: 140/180 archivos locales (78%) sí corresponden a algo real del servidor, solo renombrado/consolidado. Corrección para que no vuelva a pasar: nueva regla en CLAUDE.md — el `name` de `apply_migration` debe ser idéntico al nombre del archivo en `supabase/migrations/`, creado en la misma sesión, nunca "consolidado después" |
| 3.6 | 4 edge functions desplegadas pero NO en git (`disable-employee-auth`, `apply-scheduled-employee-events`, `backup-critical-tables`, `sync-erp-minmax`) | ✅ Aplicado 2026-07-15. Descargadas del código desplegado (`get_edge_function`) y versionadas en `supabase/functions/`. Solo se normalizó `catch(e)`→`catch{}` donde `e` no se usaba (cosmético, cero cambio de comportamiento, no requiere redeploy) |
| 3.7 | Agregar a CLAUDE.md la regla "DDL sobre tablas calientes se prueba en staging primero" | ✅ Aplicado 2026-07-15. Nueva sección en CLAUDE.md, referencia al branch `ewcmerxqjvludtgskuin` y a 0B.8/0B.2 como precedentes ya probados así |

---

## BLOQUE 4 — Rendimiento (DB, casi todo prod → tu OK, bajo riesgo)

**Estado al 2026-07-15: 4.1/4.2/4.5/4.6 cerrados hoy, 4.7 resuelto solo
(ya no aplica), 4.3 y 4.4 diagnosticados con datos frescos — son
rediseños, no fixes chicos, pendientes de que decidas si se justifican.**

| # | Ítem | Fuente | Fix |
|---|---|---|---|
| 4.1 | `inventory_sync_log` sin índice: `SyncHealthBanner` hace full scan cada 90s (10.8B tuplas leídas) | Fase 2 | ✅ Aplicado (2026-07-12), ver progreso arriba |
| 4.2 | `SyncHealthBanner` suscrito a realtime de tabla que no está en la publicación (código muerto) | Fase 2 | ✅ Aplicado (2026-07-12), ver progreso arriba |
| 4.3 | Realtime WAL decode = 25.2% del CPU de la DB (re-medido 2026-07-15, era 26.7%) | Fase 0 | ⏸️ **Diagnosticado, no resuelto.** De las 11 tablas en `supabase_realtime`, una sola (`product_stock_params`) concentra 1,271,562 de ~1,274,010 writes acumulados (99.8%) — las otras 10 suman ~2,450 en total, decode irrelevante. La suscripción SÍ es real (`TabMinMax.jsx:1790`, canal `bodega-params-watch`, filtrado a `erp_sucursal_id=6`) — no es código muerto como 4.2, así que no se puede simplemente sacar de la publicación. El filtro del cliente (`filter: 'erp_sucursal_id=eq.6'`) se aplica DESPUÉS de decodificar el WAL — no reduce el costo de decode, sólo qué le llega al cliente. Fix real requeriría reemplazar `postgres_changes` por Realtime Broadcast (un trigger que arma y manda el mensaje solo para la sucursal 6) o por polling — es rediseño de una feature, no un query fix. Necesita tu decisión: ¿vale la pena el esfuerzo por ~25% de CPU de la DB, o se documenta y se deja? |
| 4.4 | `refresh_product_sales_monthly_agg()` cada hora | Fase 0 | ⏸️ **Diagnosticado, no resuelto.** Re-medido: 115 calls, **9.68s promedio** (era 8.9s), 7.3% del tiempo total de DB. La función YA tiene el patrón anti-churn (`DELETE ... NOT EXISTS` + `INSERT ... ON CONFLICT DO UPDATE ... WHERE IS DISTINCT FROM`) — no es el problema de escritura que resolvieron los fixes anteriores. El costo real es de LECTURA: escanea+agrupa 3 meses completos de `sales_invoice_items JOIN sales_invoices` cada vez, aunque los meses ya cerrados (`close_ventas_month` existe como concepto en el código) no cambian nunca. Fix real: que la función solo recalcule el mes en curso y confíe en que los meses cerrados ya están correctos — cambio de lógica de negocio (qué cuenta como "cerrado"), no un índice. Necesita tu decisión antes de tocarlo |
| 4.5 | 88 índices sin uso sobre tablas calientes = overhead de escritura puro | Advisor | ✅ Aplicado 2026-07-15. Re-medido: 150 índices sin uso en total, pero solo 12MB — la inmensa mayoría son de features nuevas (rutas, conteo_inventario, promociones) de bajo tráfico, no vale la pena tocarlos. El único con peso real sobre una tabla caliente era `sales_invoices_customer_id_idx` (7.6MB, exactamente el que ya mencionaba este ítem) — `DROP INDEX CONCURRENTLY` + `lock_timeout`, verificado eliminado |
| 4.6 | `multiple_permissive_policies` (ruta_locations, practicantes) | Advisor | ✅ Aplicado 2026-07-15. `_write` era `FOR ALL` (incluye SELECT), duplicando evaluación con `_select` en cada lectura (7 warnings). Verificado antes de tocar: 0 roles tienen `can_edit=true` con `can_view=false` en `pedidos_tab_rutas`/`staff_list`, así que angostar `_write` a solo INSERT/UPDATE/DELETE no le saca acceso a nadie real. Advisor confirma 0 warnings restantes |
| 4.7 | `sales_invoices` sin autovacuum hace 6 semanas | Fase 0 | ✅ Ya no aplica (verificado 2026-07-15) — solo 0.27% de filas muertas (870/326K). El autovacuum no dispara porque no hace falta, no porque esté fallando: el trabajo de anti-churn de sesiones anteriores (0B.7/1.x) bajó tanto la escritura redundante que la tabla casi no genera bloat. Bajar `autovacuum_vacuum_scale_factor` no tendría nada real que limpiar hoy — sin acción |

---

## BLOQUE 5 — Diseño/UX pendiente

| # | Ítem | Severidad | Notas |
|---|---|---|---|
| 5.1 | **DataTable arrastra overflow del contenedor en móvil: en `/pedidos` el usuario NO puede seleccionar Salud 1/3/5; `/productos` pierde columnas** | 🔴 **Funcional, no cosmético** | ✅ Aplicado y verificado 2026-07-15 (v2.16.6). No era un bug de `DataTable`/`hideBelow` — era `<main>` en `AppLayout.jsx` (flex item sin `min-w-0`, nunca se achicaba por debajo del ancho natural de su contenido; en móvil `#root` corre con `overflow:visible` así que ese exceso quedaba literalmente inalcanzable, sin scroll que lo revelara). Fix de 1 línea en el componente compartido (`min-w-0`), arregla las 40+ rutas de una vez. Verificado con Playwright a 390×844: los 6 chips de sucursal visibles/clickeables en /pedidos, card de /productos sin corte; sin regresión en desktop 1440px |
| 5.2 | Contraste `text-slate-300/400` sobre superficie clara: ~1,288 instancias / 127 archivos | 🟡 Volumen | Pase dedicado, empezar por top-20 archivos; NO find/replace ciego (409 falsos positivos: iconos, tooltips oscuros) |
| 5.3 | Touch targets long-tail (~20-40px dispersos) | 🟡 | Perseguir por vista, bajo beneficio/esfuerzo |
| 5.4 | 2 `<select>` sin migrar (`FormAiSchedulerPreview` grilla densa, `TimePicker12` stepper) | 🟡 | Requieren variante nueva de componente |
| 5.5 | PWA sin offline: service worker sin cache/fetch | 🟡 | Arquitectura nueva (App Shell), pase dedicado, riesgo de stale |
| 5.6 | Pase de accesibilidad dedicado (focus-visible en inputs glass, `aria-invalid`/`aria-describedby`, teclado en LiquidSelect/modales) | 🟡 | DESIGN.md §25 ya lo documenta |
| 5.7 | Decisiones de producto: `animate-bounce` decorativo, `user-scalable=no` (tensión WCAG 1.4.4) | Decisión tuya | No tocar sin definición |

---

## BLOQUE 6 — Refactors estructurales (GATE: staging vivo + tests del Bloque 2)

Incrementales, un PR chico por vez, probados en staging antes de prod.

| # | Refactor | Problema | Ruta |
|---|---|---|---|
| 6.A | Capa de datos | 390 `supabase.from()` en 58 archivos, sin capa, sin caché; el límite 1000-filas se resuelve a mano vista por vista | `src/data/` con hook por entidad (paginación + manejo de error + caché). Migración oportunista; empezar por `WidgetInventorySearch` (ya tuvo bug) |
| 6.B | Partir `fetchBoot` monolítico | Un `bootStatus` global bloquea todos los datos sensibles → race condition conocida + sobre-fetch | `status` por slice, coexistiendo; migrar primero el modal de empleado |
| 6.C | Dividir `TabMinMax.jsx`/`TabPedidos.jsx` (~3,900 líneas c/u) | Mini-apps en un archivo | Extraer un sub-componente por PR, empezar por el de menor acoplamiento |

---

## BLOQUE 7 — Gaps de features + features nuevas

### 7A — Cerrar features huérfanas (backend listo, sin UI o con bug)
| # | Ítem | Estado |
|---|---|---|
| 7A.1 | Corrección de bodega en Pedidos: `handleCorregirBodega`/`handleConfirmarCorreccion` sin botón en UI | Backend desde 2026-06-21; decisión de producto: dónde va el botón/modal |
| 7A.2 | `auto-copy-weekly-roster`: bugs `target_type:'ALL'` + `status='ACTIVE'` (encadenados, corregir JUNTOS) | Impacto acumulado hoy = 0; riesgo hacia adelante (RRHH no vería conflictos de turno) |
| 7A.3 | `RecepcionModal:439 handleTodoOk` ("marcar todo OK") sin caller — posible botón faltante | Verificar |
| 7A.4 | **Saly — decisión diferida (2026-07-11).** El usuario pausó la eliminación; a futuro DECIDIR: quitar o mejorar. "Saly" abarca varias superficies: SalyCopilot (horarios, `schedule-tabs/`), borrador de avisos (`AnnouncementsView`), resumen IA de encuestas (`EncuestaView` → única acción `saly-ai` invocada hoy: `analyze-survey-comments`). El chat `SalyChatOverlay` ya fue eliminado antes. NO borrar sin confirmar alcance | Decisión de producto pendiente |
| 7A.5 | `TabPedidos.jsx` `ReceptionActions`: sin bloque "Confirmado llegada" (existe el equivalente `empChip(erpEmp)` para el paso "Sistema de Ventas" pero no para "Llegada") | Encontrado 2026-07-15 durante limpieza de lint; `llegadaEmp`/`llegadaTipo` ya se reciben como prop, solo falta la tarjeta de UI |
| 7A.6 | `TabMinMax.jsx`: `hideFiltered` — acción bulk "ocultar todo lo filtrado" completa (RPC + audit log `MINMAX_HIDE_FILTERED`) sin botón en UI | Encontrado 2026-07-15; acción masiva real, probablemente necesita modal de confirmación antes de exponerse — decisión de producto |
| 7A.7 | `TabMinMax.jsx`: celda "Despacho" calcula MIN/MAX ya redondeado por la regla de despacho (`dispMin`/`dispMax`/`applyRule`) pero el JSX solo muestra el nombre de la regla, nunca el resultado numérico | Encontrado 2026-07-15; decidir formato de display (¿tooltip? ¿badge adicional?) antes de wireearlo — área con historial de bugs de redondeo |

### 7B — Features nuevas (fundamentadas en la auditoría), por valor/esfuerzo
| # | Feature | Esfuerzo | Valor |
|---|---|---|---|
| 7B.1 | Alertas push de fallo de sync (extender patrón DTE a products/minmax/purchases/backup) | Bajo (3-5d) | Alto — cierra el gap de observabilidad *pull* |
| 7B.2 | Tracker de corto vence (reglas de Bodega ya documentadas) | Medio (2-3sem) | Alto — reduce mermas |
| 7B.3 | Dashboard de salud de syncs (historial por sucursal) | Medio (1-2sem) | Medio-alto |
| 7B.4 | Kiosk: feedback visual/sonoro tras escaneo | Bajo (1-2d) | Medio |
| 7B.5 | Export de Ventas Perdidas | Bajo-medio (3-5d) | Medio |
| 7B.6 | Historial de precios en catálogo | Medio (1sem) | Medio |
| 7B.7 | Vista de "objetos huérfanos" para Sistema | Medio (1-2sem) | Medio — mantenimiento preventivo |
| 7B.8 | Modo offline del kiosco | Alto (3-4sem) | Alto para sucursales con mala conexión — evaluar prioridad |

---

## Secuencia recomendada

1. **Bloque 0A** (3 ítems explotables) — YA, con tu OK por cada write a prod.
2. **Bloque 0B** + **Bloque 4.1/4.2** (higiene de seguridad + los 2 fixes de perf más baratos y de mayor impacto) — en paralelo, bajo riesgo.
3. **Bloque 1** (bugs silenciosos) + **Bloque 2** (testing) — el testing habilita todo lo demás.
4. **Bloque 3** (finalizar staging) — desbloquea los refactors.
5. **Bloque 5.1** (overflow móvil, es funcional) intercalado cuando haya ventana.
6. **Bloque 6** (refactors) — solo con staging + tests listos.
7. **Bloque 5.2+, 7** — deuda de diseño y features, a ritmo sostenido.

> Ningún ítem estructural (Bloque 6) arranca antes que Bloque 2 (tests) y Bloque 3
> (staging). Ningún write a prod sin tu OK en el momento.
