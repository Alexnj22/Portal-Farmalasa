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

**Probar primero en staging.** Existe un branch de Supabase dedicado para esto
(`ewcmerxqjvludtgskuin`, esquema reconstruido, cero PII — ver
`docs/planes-cerrados/PLAN-EJECUCION-2026-07.md` Bloque 3). Para DDL sobre las tablas calientes
listadas arriba, aplicar primero ahí con `apply_migration` apuntando a ese
`project_id`, confirmar que no rompe nada, y solo entonces aplicar a prod.
Ya se usó así para 0B.8 (RPC `verify_kiosk_device`) y 0B.2 (secretos de Vault
en `cron.job.command`) — ambos sin incidentes.

**Todo `apply_migration` necesita su archivo local en el mismo commit, nombrado
con la versión que asignó el servidor** (incidente descubierto 2026-07-15,
Bloque 3.5; resuelto en C2 el 2026-07-29). La tool `apply_migration` SOLO escribe
en el servidor (`supabase_migrations.schema_migrations`) — nunca toca el disco.
Guardar el archivo en `supabase/migrations/` es un paso manual aparte, y como
olvidarlo no da ningún error, durante meses se hizo inconsistente: al cierre de C2
el registro de prod tenía **731 migraciones contra 339 archivos locales, y solo 14
de 699 versiones coincidían**. El repo no era un subconjunto de la historia real,
era un set paralelo mantenido a mano — así que el esquema no se podía reconstruir
desde los archivos, ni tener un staging fiel.

Cómo quedó (`PLAN-SUPABASE-CIERRE.md` C2, v2.228.0):

- `supabase/migrations/` tiene **un baseline generado del catálogo de prod**
  (`20260101000000_baseline_schema.sql`, verificado aplicándolo a una rama limpia:
  0 errores y las 15 categorías de la huella con md5 idéntico a prod) **más las
  migraciones aplicadas después**. Las 339 heredadas viven en
  `supabase/migrations-legacy/`: aplicarlas sobre el baseline falla por
  construcción (esperan el esquema de abril, ej. `employees.is_admin`).
- **El archivo se nombra `<versión>_<name>.sql` con la versión de 14 dígitos que
  asignó el servidor**, no con el viejo `YYYYMMDD_nombre` (que es lo que generó la
  deriva: no se corresponde con ninguna fila real). La versión la devuelve
  `apply_migration`; si no, `select max(version) from
  supabase_migrations.schema_migrations`. El `name` del `apply_migration` debe ser
  idéntico al del archivo — sin resumir, sin combinar varias migraciones en uno — y
  el archivo se crea en la misma sesión: nunca "lo consolido después".
- **Al cerrar cualquier trabajo con migraciones, correr `npm run gate:migrations`**
  (chequeos locales, sin red) y `npm run gate:migrations -- --remote` para cruzar
  contra el registro de prod — es el que detecta la migración aplicada sin archivo.
  Existe porque el detector natural quedó ciego: `supabase migration list` y
  `db push --dry-run` arrancan listando las 731 versiones pre-baseline sin archivo
  local, así que una migración nueva sin archivo sería la fila 732 de una lista de
  ruido. `db push` no se usa en este proyecto (se aplica con `apply_migration`).
  La constante `CORTE` del gate **no se mueve** para silenciar un hallazgo: correrla
  es declarar que una migración no necesita archivo, o sea la deriva misma.

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
   `GRANT ... TO authenticated, service_role`. Únicas funciones con anon permitido
   (las 5 del pre-login del kiosco, todas validan `device_token` internamente):
   `get_kiosk_boot_payload`, `get_kiosk_coverage_employees`, `verify_kiosk_device`,
   `verify_kiosk_pin`, `verify_kiosk_authorization`.
   Las últimas tres se agregaron en las fases 1/2/4 del rediseño de credenciales
   del kiosco (2026-07-29) y son las que reemplazaron la comparación client-side.
   **La regla se aplicó retroactivamente el 2026-07-29**
   (`20260729_revoke_anon_function_surface`): ninguna otra función del proyecto
   es ejecutable por `anon`. Las 31 que quedan pertenecen a `pg_trgm`/`pg_net`
   — son internas de extensión y revocarles EXECUTE rompe los índices de trigram;
   salen del namespace público moviendo la extensión, no revocando.
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

## MIN·MAX: ABC/XYZ son SOLO clasificación (decisión, no bug)

Confirmado el 2026-07-29 (F4.3 de `PLAN-MINMAX-Y-CANDADO-2026-07-29.md`): en
`stock_config`, `reorder_x_days = reorder_y_days = reorder_z_days = 25`,
`buffer_x/y/z_days = 0`, y `lead_time_days` es NULL en las 18,364 filas de
`product_stock_params`. Entonces la fórmula real es, para **todo** producto:

```
MIN = floor(velocidad × 25)      MAX = ceil(velocidad × cycle_days)
```

ABC y XYZ **no intervienen en ningún número**. Es intencional: sirven para
filtrar, para el badge y para la matriz, nada más. **No cambiar la fórmula ni la
config** — si una auditoría futura lo levanta como bug, esto es la respuesta.

Dos consecuencias que conviene tener presentes:

1. Como el `reorder` es plano, cualquier cambio en `cycle_days` o en
   `reorder_*_days` reescribe el MIN/MAX de **todo el catálogo a la vez**. Es uno
   de los motivos por los que existe el candado de mantenimiento por módulo.
2. `xyz_x_cv_max` / `xyz_y_cv_max` (150/400) son restos muertos de la era
   pre-percentiles: hoy manda `xyz_x_percentile`/`xyz_y_percentile`. Ya no se
   editan desde `ConfigPanel` (verificado: no hay ni una referencia a `cv_max` en
   `src/`), así que no hay riesgo de que alguien toque un número que no hace nada.

Detalle del mismo cálculo, anotado para que no sorprenda: `velocity` usa unidades
**winsorizadas** al percentil `outlier_percentile`, pero `velocity_30d` usa las
crudas. Y desde F2.3 el denominador de `velocity` ya no es `analysis_days` fijo:
es `data_days`, o sea los días desde la **primera venta histórica** del producto
en esa sucursal (tope `analysis_days`, piso 30 días). Eso solo cambia algo para
los productos realmente nuevos — medido en Salud 1: 45 de 1,765.

## REGLA CRÍTICA: hay OTRAS sesiones trabajando en este mismo árbol

No es hipotético ni excepcional. Medido el 2026-07-29 en una sola sesión: el
`git status` pasó de 2 a 8 archivos modificados en 40 minutos sin que esta sesión
tocara ninguno de los 6 nuevos, y otra sesión commiteó **y pusheó** v2.234.0 en el
medio. El árbol de trabajo es compartido y no avisa.

**Antes de editar un archivo que no tocaste en esta sesión**: `git status --short`.
Si aparece modificado y el cambio no es tuyo, es de otra sesión — leerlo antes de
escribirlo. Un `Write` encima de cambios ajenos los borra sin dejar rastro: no
están en ningún commit del que recuperarlos.

**Prohibido barrer el árbol.** Nunca `git add -A` / `git add .` / `git commit -a` /
`git stash` / `git checkout .` / `git restore .` / `git reset --hard`: todos se
llevan trabajo ajeno sin commitear. Siempre paths explícitos, y **verificar
`git status` después del `add`** — un pathspec que falla aborta TODO el add.

**Commitear lo propio en cuanto compila**, con paths explícitos. Es la única
protección real: lo commiteado se recupera, lo demás no. Y `git fetch` antes de
pushear — el remoto puede haberse movido.

**Al bumpear `APP_VERSION`**: leer `src/version.js` en el momento, nunca asumir
"el anterior + 1". Otra sesión puede haber usado ese número ya.

**El hook de pre-commit** (`.githooks/pre-commit`, se habilita una vez por clon con
`npm run hooks:install`) cubre el caso mecánico: **bloquea el commit si un archivo
está preparado y además modificado después de prepararlo** — señal de que alguien
lo siguió editando y el commit se llevaría una foto parcial. Además lista lo que
queda fuera del commit, corre `version-gate` siempre y `migration-gate` cuando el
commit toca `supabase/migrations`. `git commit --no-verify` lo saltea: es para una
emergencia real, no para silenciar un hallazgo.

## Estándares del proyecto
- Ver `DESIGN.md` para patrones de UI (glassmorphism, filter pills, tabs, search)
- Siempre usar `LiquidSelect` en lugar de `<select>` nativo
- Badges `es_antibiotico=true` → "Bajo Receta" (NUNCA "Abx")
- Toda acción de usuario → `appendAuditLog` (staffStore → `audit_logs`)
- Bumpar `APP_VERSION` en `src/version.js` en cada commit
- **Antes de cerrar cualquier trabajo de tema/estandarización visual (colores
  crudos, elementos nativos del navegador), correr `npm run gate:design`.**
  Debe pasar en verde — las excepciones legítimas viven en
  `scripts/design-gate.mjs` (const `EXCEPTIONS`) y en `DESIGN.md` §6/§14. Este
  gate reemplaza los regex ad-hoc de sesiones anteriores que se perdían y
  dejaban huecos reales sin detectar (ver
  `docs/planes-cerrados/AUDITORIA-TEMA-2026-07.md` y memoria
  `project_theme_audit_2026_07_22`).

  **Desde D0 de la auditoría de diseño (2026-07-26) el gate funciona por
  ratchet, no por cero absoluto**
  (`docs/planes-cerrados/AUDITORIA-DISENO-2026-07-26.md`): falla si
  una categoría SUBE respecto a `scripts/design-gate-baseline.json`, no por
  tenerla en rojo. Un gate permanentemente rojo no lo mira nadie — que es
  exactamente cómo se acumuló esta deuda.

  **Estado al 2026-07-29 (cierre del plan `PLAN-CIERRE-DISENO-2026-07-29.md`):
  el baseline está VACÍO y las 24 categorías son bloqueantes en cero absoluto.**
  Las cinco que arrancaron con deuda en D0 (`white` 1094, `typography` 4490,
  `z-index` 552, `hex` 32, `motion` 30) se cerraron en D1/D2; la última con
  ratchet era `input-a-mano`, cerrada al pasar sus 3 archivos —login, kiosco y
  el campo del ⌘K, todas superficies bespoke de DESIGN.md §25.4— a `EXCEPTIONS`
  **con su motivo escrito**, que es más fuerte que tolerarlos por número: ahora
  un `<input>` a mano en cualquier OTRO archivo falla el gate.

  Categoría nueva del mismo cierre: **`celda-a-mano`** (un `<td>` crudo dentro
  de un `<DataRow>` — saltea `DataCell` y con él la densidad de fila).

  **Cuidado con `EXCEPTIONS`:** es un objeto literal, así que una clave repetida
  hace que la segunda pise a la primera **en silencio**. Había 4 duplicados sin
  detectar. Lo verifica `assertSinClavesDuplicadas` al arrancar el gate: cada
  archivo va en UNA entrada con todas sus categorías.

  `chart-retirado` y `chip-a-mano` llegaron a **0 el 2026-07-28** y quedaron
  bloqueantes: los 3 categóricos retirados se migraron a su destino (424
  referencias en 51 archivos) y los 7 chips restantes se resolvieron uno por
  uno. `chart-8` salió de la lista de retirados porque no lo estaba: es el
  NEUTRO de la paleta y está vivo (`--chart-8-solid` tiene valor propio, el
  `neutral` de `Badge` se apoya en él, y tiene familia completa de glows).

  Las tres bloqueantes agregadas en D3/D4 — `button-name`, `paleta-cerrada`,
  `input-sin-nombre` — no van al baseline: una categoría que no figura en el
  JSON arranca bloqueante sola (`baseline[c] ?? 0`).

  Al BAJAR deuda (cada fase del plan baja la suya), regenerar con
  `npm run gate:design -- --update-baseline` y commitear el JSON. **Nunca
  regenerarlo para tapar un hallazgo nuevo**: si una categoría subió, es
  código nuevo que hay que arreglar. Cuando una categoría llega a 0 queda
  bloqueante para siempre.
