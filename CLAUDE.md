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

**Patrón C — RPC que devuelve JSONB (no SETOF):**
El límite no aplica cuando el RPC devuelve un único objeto JSON/JSONB. Opción válida para funciones que agregan todo server-side.

**Tablas seguras para bulk load sin paginar** (siempre <1000 filas): `branches`, `roles`, `presentaciones`, `laboratorios`.

**Tablas que REQUIEREN paginación**: `products`, `inventory`, `dte_sales`, `product_stock_params`, `get_stock_analysis` (RPC).

---

## Supabase Project
- Project ID: `sacecdkdmsdvgqnrsett`
- Aplicar migraciones vía MCP tool `apply_migration` (no `supabase db push`)

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
