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
  Pendiente: deploy normal del frontend (fuera del alcance de este agente) para que
  `branchSlice.js` actualizado llegue a producción.

### Camino de deploy de edge functions (resuelto)
Bash `supabase functions deploy` funciona CON permiso, pero el CLI se traga un `.env` con un nombre
de variable inválido (un `-`). Solución: apartar `.env` durante el deploy y restaurarlo
(`mv .env .env.bak; deploy; mv .env.bak .env`). La MCP `deploy_edge_function` falla con bug de
import_map en estas funciones — NO usarla; usar el CLI con ese workaround.

---

## BLOQUE 0 — Seguridad que sigue ABIERTA (máxima prioridad)

Estos NO se cerraron durante la auditoría. Cada write a prod requiere tu OK.

### 0A — Explotable / alto impacto
| # | Ítem | Ubicación | Fix |
|---|---|---|---|
| 0A.1 | Bucket `photos`: INSERT `anon` + sin `file_size_limit`/`allowed_mime_types` — cualquiera sin sesión sube cualquier archivo/tamaño | storage.objects "Permitir subir fotos"; Fase 2 §Storage | Agregar límites al bucket + estrechar INSERT a `authenticated` |
| 0A.2 | `bulk-create-employee-users` crea cuentas con `password:"1234"` literal | `functions/bulk-create-employee-users/index.ts:44` | Temporal aleatoria (igual que `set-employee-password`) |
| 0A.3 | `saly-ai` chat expone datos de toda la empresa sin scope por rol/sucursal, incl. `employee_events.note` (texto disciplinario RRHH) a cualquier autenticado; y acepta `bucketName`/`filePath` del cliente sin verificar pertenencia (IDOR) | `functions/saly-ai/index.ts:103-179,124`; `analyze-document` | Scope por rol/sucursal del llamante; validar ownership del archivo |

### 0B — Hardening (bajo riesgo, alto valor de higiene)
| # | Ítem | Fuente | Fix |
|---|---|---|---|
| 0B.1 | 3 policies de `notifications` con `auth_employee_id()` SIN `(SELECT ...)` — reintroduce el patrón del outage 2026-07-08 | Fase 2 §RLS | Envolver en `(recipient_id = (SELECT auth_employee_id()))` |
| 0B.2 | `ADMIN_INVOKE_SECRET` en texto plano en ~25 `cron.job.command` | Fase 0 | Mover a Supabase Vault, resolver con `current_setting()` |
| 0B.3 | `mv_product_factor` expuesta a la API (viola CLAUDE.md #6) | Advisor | REVOKE de anon/authenticated, servir solo por RPC |
| 0B.4 | Protección de contraseñas filtradas (HaveIBeenPwned) deshabilitada | Advisor | Habilitar en Auth |
| 0B.5 | `pg_trgm`/`pg_net` en schema `public` | Advisor | Mover a schema dedicado |
| 0B.6 | `debug_pedido_timings` (función debug leftover) | Advisor | Evaluar y borrar |
| 0B.7 | 54 funciones SECURITY DEFINER invocables por cualquier `authenticated` sin gate de permiso; `wfm-ai-scheduler` sin chequeo de rol (Gemini caro) | Advisor; Fase 2 | Revisar caso por caso, agregar gate de permiso donde exponga datos/costo |
| 0B.8 | `kiosk_devices.kiosk_verify` (SELECT `anon+true`) | Fase 3.2.2 | RPC SECURITY DEFINER que valide device_token (cambio de lógica) |
| 0B.9 | `check-sales-alerts:88` manda `service_role` key como Bearer | Fase 2 REMEDIADO #4 | Unificar a `ADMIN_INVOKE_SECRET` |
| 0B.10 | CORS `*` hardcodeado en 12 functions | Fase 3.5 | `getCorsHeaders(req)` con `PORTAL_ORIGIN` |
| 0B.11 | `sufarmasalud@farmalasa.app` (SUPERADMIN) con password aleatoria tras 3.6 | Fase 3.6 | Asignar password real vía `set-employee-password` SI se necesita la cuenta |

---

## BLOQUE 1 — Bugs de correctitud que fallan en silencio

No necesitan staging. Priorizar los que tocan nómina/dinero.

| # | Ítem | Ubicación |
|---|---|---|
| 1.1 | 4 selects sobre tablas >1000 filas sin paginar (truncado silencioso) | `FacturacionView.jsx:248,736`; `VentasView.jsx:503`; `WidgetInventorySearch.jsx:410` |
| 1.2 | 35 `const { data } = await supabase` sin chequear `error` (empezar por nómina/aprobador) | `requestsSlice.js:80,509`; `payrollSlice.js:321`; +16 archivos |
| 1.3 | Edge functions ignoran `error` en escrituras críticas (el `update`/`insert` de `timesheets`; auto-cierre de promos) | `consolidate-timesheets:164-402`; `sync-promo-sales:127-139` |
| 1.4 | `sync-promo-sales:88` deriva `factor` por regex en vez de `product_precios.factor` (viola regla de casa) | `functions/sync-promo-sales/index.ts:88` |
| 1.5 | `saveHiddenTimer` asignado pero nunca leído/limpiado — posible timer fugado | `TabMinMax.jsx:1735` |
| 1.6 | 173 lint reales de riesgo (`set-state-in-effect` 65, `exhaustive-deps` ~52 reales, `purity` 8, etc.) — barrido por archivo, empezar por top-7 monstruo | Fase 1 §lint |
| 1.7 | `Date.now()`/`new Date()` en render → badges desincronizados | `TabMinMax.jsx:1094`; `TabSinVenta.jsx:207` |
| 1.8 | Retry/timeout faltante en `fetch` saliente de varias edge functions; URL de proyecto hardcodeada | `sync-wfm-sales`, `maps-proxy`, `auto-calculate-minmax`; `heal-dte-sync:8`, `backfill-dte-sales:8` |

---

## BLOQUE 2 — Fundación de testing (ANTES de los refactors)

No necesita staging. Es la red para el Bloque 6.

- Instalar Vitest + testing-library. Tests para lógica pura que YA rompió:
  factor de presentación, dispatch rounding 40%, `inv_dedup`.
- Playwright smoke de los flujos de Fase 5 (login normal+carné, race condition del
  modal de empleado, Pedidos, Dashboard) versionado en `tests/e2e/smoke.spec.js`.
- CI que corra ambos en cada PR a `main`.

---

## BLOQUE 3 — Finalizar staging + arreglar el drift de migraciones

Staging ya existe (Bloque D de Fase 6, parcialmente hecho). Falta:

| # | Ítem | Notas |
|---|---|---|
| 3.1 | Volver el branch `persistent` | Para que Supabase no lo borre; op sobre el branch, no prod |
| 3.2 | Sembrar catálogos de referencia (roles/branches/shifts/holidays/presentaciones/laboratorios) — NUNCA employees/ventas | Solo si se quiere correr la app en staging, no solo DDL |
| 3.3 | **Drift de baseline**: el registro del servidor no reconstruye el esquema (tablas fundacionales sin migración de creación). Decidir si se squashea el registro de prod (borrar entradas viejas + baseline como única) para que crear branch desde cero funcione limpio | Requiere writes a registro de prod → tu OK. Opcional: el branch persistente ya funciona con setup manual |
| 3.4 | Limpiar las 19 filas bookkeeping inertes en el registro de prod | Cosmético, inerte → recomendado NO tocar salvo que estorbe |
| 3.5 | Drift local vs servidor: 180 archivos locales vs ~569 entradas servidor | Adoptar workflow de migraciones disciplinado |
| 3.6 | 4 edge functions desplegadas pero NO en git (`disable-employee-auth`, `apply-scheduled-employee-events`, `backup-critical-tables`, `sync-erp-minmax`) | Descargar y versionar |
| 3.7 | Agregar a CLAUDE.md la regla "DDL sobre tablas calientes se prueba en staging primero" | |

---

## BLOQUE 4 — Rendimiento (DB, casi todo prod → tu OK, bajo riesgo)

| # | Ítem | Fuente | Fix |
|---|---|---|---|
| 4.1 | `inventory_sync_log` sin índice: `SyncHealthBanner` hace full scan cada 90s (10.8B tuplas leídas) | Fase 2 | `CREATE INDEX CONCURRENTLY ... (is_vencidos, synced_at DESC)` |
| 4.2 | `SyncHealthBanner` suscrito a realtime de tabla que no está en la publicación (código muerto) | Fase 2 | Quitar la suscripción o agregar la tabla |
| 4.3 | Realtime WAL decode = 26.7% del CPU de la DB | Fase 0 | Revisar si las 11 tablas necesitan realtime o pueden ir a polling |
| 4.4 | `refresh_product_sales_monthly_agg()` 8.9s/call cada hora | Fase 0 | Revisar plan / refresh incremental |
| 4.5 | 88 índices sin uso sobre tablas calientes = overhead de escritura puro | Advisor | `DROP INDEX` (lock_timeout, ventana segura) |
| 4.6 | `multiple_permissive_policies` (ruta_locations, practicantes) | Advisor | Fusionar en 1 policy por comando |
| 4.7 | `sales_invoices` sin autovacuum hace 6 semanas | Fase 0 | Bajar `autovacuum_vacuum_scale_factor` para esa tabla |

---

## BLOQUE 5 — Diseño/UX pendiente

| # | Ítem | Severidad | Notas |
|---|---|---|---|
| 5.1 | **DataTable arrastra overflow del contenedor en móvil: en `/pedidos` el usuario NO puede seleccionar Salud 1/3/5; `/productos` pierde columnas** | 🔴 **Funcional, no cosmético** | Diagnóstico raíz primero (¿por qué `hideBelow` no lo resolvió?), decidir wrapper por vista vs. fix del componente compartido (19 vistas lo usan) |
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
