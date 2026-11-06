# Estructura BD: las reglas y por qué

> Movido desde `CLAUDE.md` el 2026-11-06. Allá quedan las diez reglas en forma corta; acá, la versión larga con los incidentes que las explican. Las cifras son de la fecha en que se escribieron. Las migraciones del 2026-07-02 viven hoy en `supabase/migrations-legacy/`.

## Estructura BD — reglas OBLIGATORIAS al crear tablas/funciones/vistas

Hardening completo aplicado 2026-07-02 (`supabase/migrations/20260702_db_hardening_*`).
Advisor de seguridad en 0 ERRORES — toda tabla/función nueva debe mantenerlo así:

1. **Toda tabla nueva**: PK + `created_at timestamptz default now()` + **RLS habilitado
   con policy explícita** (mínimo `FOR SELECT TO authenticated`). NUNCA dejar una tabla
   sin RLS — `anon` no debe ver nada.
   Las 48 que no tienen `created_at` están declaradas con su motivo en
   `auditoria/tablas-sin-created-at.json` (2026-10-29); `gate:auditoria` falla si
   aparece otra sin declarar. Sin motivo, se le agrega la columna.
2. **Toda FK**: con índice que la cubra (`CREATE INDEX ... ON tabla(col_fk)`), excepto
   columnas de puro audit (`*_por`, `created_by`) en tablas pequeñas.
3. **Policies de escritura**: `USING (true)` está prohibido para UPDATE/DELETE
   **y `WITH CHECK (true)` para INSERT** — el INSERT es el que faltaba en esta
   regla y por ahí se colaron dos (auditoría 2026-07-30): `attendance` y
   `audit_logs` aceptaban cualquier fila de cualquier usuario autenticado, o
   sea que se podía fabricar una marcación y falsificar la bitácora. Una tabla
   append-only no necesita policy de DELETE, pero **sí** necesita que su INSERT
   diga quién puede escribir qué.

   ✅ **Los dos están CERRADOS, y este párrafo dijo lo contrario más tiempo del
   que fue cierto** (remedido el 2026-08-31): `attendance_insert` exige
   `employee_id = auth_employee_id() OR can_edit('time_audit')` —o marcás por
   vos, o tenés el permiso— y `audit_logs_insert` exige
   `user_id = auth_employee_id()`, o sea que nadie firma con el nombre de otro.
   Un barrido de TODAS las policies de escritura del esquema deja **cuatro** con
   condición `true`, y las cuatro son `TO service_role`, que salta el RLS de
   todos modos: son inertes. Es
   [[feedback_una_afirmacion_que_nadie_verifica_deja_de_ser_cierta]] otra vez —
   el hallazgo se arregló y la regla que lo denunciaba no se volvió a mirar. Usar `auth_can_edit_any(ARRAY['modulo1','modulo2'])`
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
   `GRANT ... TO authenticated, service_role`.

   **Lo que `anon` alcanza vive en `auditoria/superficie-anon.json`, no en este
   párrafo** — y esa mudanza es en sí misma el hallazgo. Hasta el 2026-08-23 acá
   decía que las únicas eran las CINCO del pre-login del kiosco y que «ninguna
   otra función del proyecto es ejecutable por `anon`». La auditoría midió **24
   funciones y 3 tablas**.

   Se abrieron tres a mano antes de escribir nada y las tres se defienden solas:
   las del kiosco entran por `kiosco_sucursal(device_id, device_token)`,
   `update_proveedor_manual` lanza `FORBIDDEN` sin `auth_can_edit_any`, y seis
   son funciones de TRIGGER —sin `NEW` no se ejecutan—. **No había ningún
   agujero.** El problema era otro y es peor: la superficie creció sola durante
   un mes, la regla escrita decía otra cosa, y nada lo miraba. Una afirmación
   sobre quién puede entrar sin credenciales que nadie verifica deja de ser
   cierta sin avisar.

   `update_proveedor_manual` muestra cómo se acumula: tiene DOS sobrecargas, y
   la revocación del 2026-07-29 alcanzó a una sola. Al cambiarle la firma a una
   función, la vieja se queda con sus permisos.

   Hoy lo vigila `npm run gate:auditoria`: cada entrada va declarada con su
   guarda y su motivo, y **producción exponiendo algo que no esté ahí FALLA el
   gate**. Al agregar una función o una policy para `anon`, se declara ahí — y
   si no tiene motivo, no se declara: se le revoca el EXECUTE.

   (Las 31 de `pg_trgm`/`pg_net` no cuentan: son internas de extensión y
   revocarles EXECUTE rompe los índices de trigram; salen del namespace público
   moviendo la extensión, no revocando.)
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