# Portal Farmalasa — Claude Code Guidelines

## REGLA CRÍTICA: Límite 1000 filas PostgREST

**PostgREST (Supabase) silenciosamente trunca cualquier respuesta a 1000 filas.** Este proyecto tiene `max-rows=1000` configurado. No hay advertencia ni error — simplemente devuelve 1000 filas y para.

**Lo que NO funciona:**
- `.range(0, 9999)` — sigue devolviendo exactamente 1000 filas
- `.range(0, 4999)` — igual, sigue en 1000
- Cualquier `.select()` / `.rpc()` sin paginación explícita en tablas grandes

**Patrón A — RPC que recibe array de IDs como parámetro:**
Chunkear el *input*, no el output. Si cada chunk tiene ≤1000 IDs, la respuesta también será ≤1000 filas:
```js
const CHUNK = 1000;
const chunks = [];
for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
const results = await Promise.all(
    chunks.map(c => supabase.rpc('mi_funcion', { p_ids: c }))
);
const rows = results.flatMap(r => r.data || []);
```

**Patrón B — RPC/select que pagina el output (ej. `get_stock_analysis`):**
```js
const CHUNK = 1000;
// Primero el count, luego todos los chunks en paralelo
const { data: count } = await supabase.rpc('get_X_count', params);
const numChunks = Math.max(1, Math.ceil(count / CHUNK));
const results = await Promise.all(
    Array.from({ length: numChunks }, (_, i) =>
        supabase.rpc('get_X', params).range(i * CHUNK, (i + 1) * CHUNK - 1)
    )
);
const rows = results.flatMap(r => r.data || []);
```

**Patrón C — RPC que devuelve JSON (no SETOF) — PREFERIDO para cargas grandes:**
El límite no aplica cuando el RPC devuelve un único objeto JSON. Además evita re-ejecutar
la función por chunk (PostgREST aplica `limit/offset` SOBRE el resultado de una función:
con Patrón B, N chunks = N ejecuciones completas). **CRÍTICO: usar `json_agg(to_json(t))`
con `RETURNS json`, NUNCA `jsonb_agg`/`RETURNS jsonb` para payloads grandes** — jsonb
construye el valor binario completo en memoria y spillea a disco (medido en
`get_stock_analysis_jsonb`, 4,226 filas / 4.6MB: jsonb_agg = 1,963ms con temp spill;
json_agg = 402ms). El cliente recibe JSON idéntico. Plantilla:
```sql
CREATE FUNCTION get_X_jsonb(...) RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) FROM public.get_X(...) t;
$$;
```

**Tablas seguras para bulk load sin paginar** (siempre <1000 filas): `branches`, `roles`, `presentaciones`, `laboratorios`.

**Tablas que REQUIEREN paginación**: `products`, `inventory`, `dte_sales`, `product_stock_params`, `get_stock_analysis` (RPC).

---

## Supabase Project
- Project ID: `sacecdkdmsdvgqnrsett`
- Aplicar migraciones vía MCP tool `apply_migration` (no `supabase db push`)

## REGLA CRÍTICA: migraciones sobre tablas calientes (incidente 2026-07-08)

Los crons escriben en `sales_invoices`/`sales_invoice_items`/`inventory`/`products`
**cada minuto** (sync-dte-sales × 6 sucursales + inventario × 7). Cualquier
`CREATE/DROP POLICY`, `ALTER TABLE`, `CREATE TRIGGER` sobre esas tablas necesita
lock ACCESS EXCLUSIVE: si en ese momento hay un sync o un RPC de analytics en
vuelo, la migración se encola, TODA lectura posterior de la tabla se encola detrás,
el pool de PostgREST/Auth se agota y el portal entero cae con 504 (el navegador lo
muestra como error de CORS "access control checks" — engañoso, no es CORS).
Eso fue exactamente el outage del 2026-07-08 15:48–16:02 UTC (migraciones RLS
v2.9.23/24 aplicadas en horario mientras corrían los syncs).

**Obligatorio en TODA migración** (DDL de cualquier tipo):

```sql
SET lock_timeout = '5s';
-- ... el DDL ...
```

Si la migración falla con `canceling statement due to lock timeout`, NO congeló
producción: reintentar (2-3 veces con pausa) hasta que entre. Preferible a un
freeze global. Para DDL sobre las tablas calientes listadas arriba, además
considerar aplicar entre 06:00–11:59 UTC (crons de sync inactivos: corren
`12-23,0-5`).

**Edge functions**: NUNCA ignorar el `error` de un query supabase-js
(`const { data } = await ...` sin chequear `error`). Un select que falla en
silencio deja Maps/lookups vacíos y el bug puede vivir semanas sin detectarse
(pasó con `presentaciones.descripcion`: columna eliminada el 2026-06-08, el
sync la siguió consultando un mes, error en logs de Postgres cada minuto).
Al eliminar/renombrar columnas: grep en `supabase/functions/` además de `src/`.

**Syncs recurrentes: PROHIBIDO el upsert incondicional de tablas completas.**
Un `.upsert(todasLasFilas)` en un cron reescribe cada fila aunque nada cambie
(inventory acumuló 935M de updates sobre 24K filas: churn de WAL, Disk IO
budget agotado, CPU de Realtime decodificando WAL, autovacuum constante).
Patrón obligatorio: RPC con `INSERT ... ON CONFLICT DO UPDATE ... WHERE
(cols) IS DISTINCT FROM (EXCLUDED.cols)` — ver `sync_inventory_batch` y
`upsert_product_precios_batch`. No usar un `synced_at` bumpeado por fila para
detectar stale rows (obliga a escribir todo); borrar por diferencia de keys.
Tampoco poner `updated_at: now()` en el payload del sync — hace que toda fila
"cambie" siempre; el RPC lo asigna solo cuando el dato real cambió.

## Estructura BD — reglas OBLIGATORIAS al crear tablas/funciones/vistas

Hardening completo aplicado 2026-07-02 (`supabase/migrations/20260702_db_hardening_*`).
Advisor de seguridad en 0 ERRORES — toda tabla/función nueva debe mantenerlo así:

1. **Toda tabla nueva**: PK + `created_at timestamptz default now()` + **RLS habilitado
   con policy explícita** (mínimo `FOR SELECT TO authenticated`). NUNCA dejar una tabla
   sin RLS — `anon` no debe ver nada.
2. **Toda FK**: con índice que la cubra (`CREATE INDEX ... ON tabla(col_fk)`), excepto
   columnas de puro audit (`*_por`, `created_by`) en tablas pequeñas.
3. **Policies de escritura**: usar `auth_can_edit_any(ARRAY['modulo1','modulo2'])`
   (helper que resuelve al empleado por uid/code/username y chequea can_edit en
   role_permissions) — NUNCA `USING (true)` para UPDATE/DELETE en tablas sensibles.
   **CRÍTICO (incidente 2026-07-08): TODA llamada a funciones `auth_*` en una policy
   debe ir envuelta en `(SELECT ...)`** — ej. `(SELECT auth_has_module_permission('x','can_view'))`,
   nunca `auth_has_module_permission('x','can_view')` a secas. Sin el wrapper, Postgres
   la evalúa POR FILA (cada llamada consulta employees+role_permissions): en
   sales_invoices (548K filas) un count() de 27K filas pasó de 25,000ms a 19ms con el
   wrapper. Fue la causa del pico de CPU 65→78% del 7-8 jul y del Disk IO budget
   consumido. El advisor de Supabase NO detecta esto (solo linta auth.uid() directo).
   Nota: ser STABLE no basta — solo el initplan `(SELECT fn())` garantiza 1 evaluación.
   Historial (`employee_events`, `timesheets`, etc.) es append-only: sin policy
   de DELETE (las RPCs DEFINER y service_role no la necesitan). Aplicado a las
   35 tablas expuestas el 2026-07-02 (`20260702_granular_write_policies.sql`).
4. **Funciones**: SECURITY DEFINER solo si es necesario, SIEMPRE con
   `SET search_path = public, extensions`, y `REVOKE EXECUTE ... FROM PUBLIC, anon` +
   `GRANT ... TO authenticated, service_role`. Únicas funciones con anon permitido:
   `get_kiosk_boot_payload`, `get_kiosk_coverage_employees` (pre-login kiosco, validan
   device token internamente).
5. **Vistas**: SIEMPRE `WITH (security_invoker = true)` (o `ALTER VIEW ... SET`).
6. **Vistas materializadas**: no exponerlas a la API — `REVOKE ALL FROM anon, authenticated`
   y acceso solo vía RPC SECURITY DEFINER. Excepción actual: `mv_product_factor`
   (la lee `get_pedido_preview` que es INVOKER).
7. **Tablas de log/historial**: definir retención desde el día 1 (cron de purga tipo
   `purge-sync-logs-daily`, 90 días). El historial de negocio (precios, minmax, eventos
   de empleados) NO se purga.
8. **Nombres**: snake_case; español para dominio de negocio (`pedidos`, `ventas_perdidas`),
   inglés para infra (`sync_log`); sufijos `*_history`/`*_log`/`*_changelog` para auditoría.
9. **Employee code**: SOLO números (trigger `enforce_numeric_employee_code`); el kiosk_pin
   se deriva SHA-256(code)→base64→alfanumérico→8 chars uppercase.
10. **Storage**: bucket nuevo → PRIVADO por defecto + `file_size_limit` + `allowed_mime_types`
   + policies por bucket en storage.objects. Para mostrar archivos usar
   `getSignedFileUrl`/`openStoredFile`/`signPhotosDeep` de `src/utils/storageFiles.js`
   (agregar el bucket a PRIVATE_BUCKETS). En BD SIEMPRE se guarda la URL formato-public
   como identificador — NUNCA una URL firmada (expira). Fotos de empleados: `photo` =
   firmada (se genera en fetchBoot/login), `photo_url` = cruda; todo select directo de
   photo_url debe pasar por `signPhotosDeep()`. Públicos permitidos: solo product-photos/photos.

## Estándares del proyecto
- Ver `DESIGN.md` para patrones de UI (glassmorphism, filter pills, tabs, search)
- Siempre usar `LiquidSelect` en lugar de `<select>` nativo
- Badges `es_antibiotico=true` → "Bajo Receta" (NUNCA "Abx")
- Toda acción de usuario → `appendAuditLog` (staffStore → `audit_logs`)
- Bumpar `APP_VERSION` en `src/version.js` en cada commit
