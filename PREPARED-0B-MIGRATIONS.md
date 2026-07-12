# Migraciones 0B preparadas — listas para `apply_migration`

> Preparado 2026-07-11 (Fable), verificado contra el estado real de prod. Cada bloque va
> por la MCP tool `apply_migration` (NO `supabase db push`). Pedir OK del usuario antes de
> cada una. Después de aplicar, correr la query de verificación.

---

## ✅ LISTA — 0B.1 · Envolver `auth_employee_id()` en `(SELECT ...)` en las 3 policies de `notifications`

**Por qué**: reintroduce el patrón del outage 2026-07-08 (auth_* evaluado por fila). `notifications`
está en la publicación realtime, así que cada lectura/suscripción re-evalúa la función por fila.
Verificado: las 3 policies (select/update/delete) usan `(recipient_id = auth_employee_id())` sin wrap.

`apply_migration` name: `wrap_notifications_auth_employee_id_initplan`
```sql
SET lock_timeout = '5s';

DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_id = (SELECT auth_employee_id()));

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_id = (SELECT auth_employee_id()))
  WITH CHECK (recipient_id = (SELECT auth_employee_id()));

DROP POLICY IF EXISTS notifications_delete ON public.notifications;
CREATE POLICY notifications_delete ON public.notifications
  FOR DELETE TO authenticated
  USING (recipient_id = (SELECT auth_employee_id()));
```

**Verificación** (debe mostrar `(SELECT auth_employee_id())` en cada fila):
```sql
SELECT policyname, qual, with_check FROM pg_policies
WHERE schemaname='public' AND tablename='notifications' ORDER BY policyname;
```
**Test positivo**: loguear como un empleado y confirmar que la campana de notificaciones sigue
cargando SUS notificaciones (no las de otros, no vacío).

---

## ✅ LISTA — 0B.6 · Eliminar `debug_pedido_timings` (función debug leftover)

**Por qué**: SECURITY DEFINER, sin ningún caller (solo aparece en un GRANT de una migración vieja
ya corrida; grep en `src/` y `supabase/` sin resultados). Es superficie muerta.

`apply_migration` name: `drop_debug_pedido_timings_leftover`
```sql
DROP FUNCTION IF EXISTS public.debug_pedido_timings(integer[]);
```

**Verificación** (debe devolver 0 filas):
```sql
SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='debug_pedido_timings';
```

---

## ✅ CERRADO (2026-07-12) — 0B.5 · `pg_trgm`/`pg_net` fuera de `public`: riesgo aceptado, no se toca

Investigado a fondo antes de decidir (no es un "no pre-escribir" genérico, es un análisis
completo con evidencia de prod):

- **`pg_trgm`**: ya se intentó mover una vez (`20260517_db_audit_v13_revert_pgtrgm_to_public.sql`)
  y se revirtió porque rompió `ILIKE` de productos en prod. Confirmado de nuevo: `anon`/
  `authenticated`/`authenticator` (los roles reales de PostgREST) NO tienen `extensions` en su
  `search_path` — solo el rol `postgres` sí. Mover la extensión rompe los 6 índices GIN trigram
  (`products.nombre/principio_activo`, `sales_invoices.cliente/correlativo/erp_invoice_id`,
  `inventory_grouped_mv.descripcion`) para todo tráfico real de la app.
- **`pg_net`**: `extrelocatable = false` — no se puede mover con `ALTER EXTENSION ... SET SCHEMA`,
  requeriría `DROP`/`CREATE` (interrumpe el worker async que usan `notify_branch`/`notify_employees`/
  `notify_push_on_announcement`). Además sus objetos reales ya viven en el schema `net`, no en
  `public` — solo el registro de `pg_extension` queda ahí. Beneficio de seguridad ≈ 0.

Decisión del usuario: aceptar el WARN del advisor, no reabrir salvo cambio de diseño futuro
(fijar `search_path` a nivel de rol para anon/authenticated, probado primero en staging).
Ver `AUDITORIA-2026-07.md` → "Bloque 0B — cierre final (2026-07-12)".

## ⏸️ DIFERIDO — 0B.4 · Protección de contraseñas filtradas (HaveIBeenPwned)

Toggle de config de Supabase Auth (dashboard/Management API), NO SQL — no requiere código.
El usuario decidió no activarlo todavía (2026-07-12). Sin fecha de retomado.

## ⚠️ NO pre-escribir — requieren análisis o no son migraciones simples

- **0B.3 · `mv_product_factor` REVOKE — NO hacer a ciegas.** Verificado: anon/authenticated ya
  NO tienen grants explícitos, y CLAUDE.md #6 la documenta como **excepción aceptada** porque
  `get_pedido_preview` (SECURITY INVOKER) la lee. Revocar puede **romper el preview de pedidos**.
  Analizar cómo la lee get_pedido_preview antes de tocar; probablemente dejar como está.
- **0B.2 · Mover `ADMIN_INVOKE_SECRET` a Vault** — no es una migración simple: crear secreto en
  `vault`, reescribir ~25 `cron.job.command` para resolverlo con `current_setting()`. Cada reescritura
  de cron.job es DDL con lock; hacer con cuidado, uno por uno, verificando que el cron sigue corriendo.
- **0B.7 · 54 funciones SECURITY DEFINER + gate de rol en `wfm-ai-scheduler`** — revisión caso por caso, no un migration único.
- **0B.8 · `kiosk_devices.kiosk_verify`** — requiere RPC SECURITY DEFINER nueva (cambio de lógica).
- **0B.9 · `check-sales-alerts` service_role Bearer** y **0B.10 · CORS `*` en 12 functions** — cambios
  de EDGE FUNCTIONS, van con el batch de deploy (mismo camino bloqueado que 0A.3: usar CLI).
- **0B.11 · password de `sufarmasalud@farmalasa.app`** — decisión del usuario (solo si se reactiva la cuenta).
