# Portal Farmalasa — Claude Code Guidelines

**Cómo está hecho este archivo.** Las reglas críticas van acá, cortas e
imperativas. El detalle de cada dominio —las mediciones, los incidentes, el
«nació el …»— vive en `docs/reglas/` y se enlaza desde su resumen: leerlo antes
de tocar ese dominio.

**Un número que vive en un archivo NO se copia acá**: un baseline, el ref de un
branch, cuántas áreas o tablas hay, qué funciones llevan tal flag. Se nombra el
archivo o el comando que lo da. Copiado, queda viejo en silencio y este archivo
empieza a contradecir al repo — pasó con el ref del entorno de pruebas, el
baseline de diseño, el del núcleo, la cuenta de áreas y la lista de funciones de
cron.

## REGLA CRÍTICA: Límite 1000 filas PostgREST

**PostgREST (Supabase) silenciosamente trunca cualquier respuesta a 1000 filas.** Este proyecto tiene `max-rows=1000` configurado. No hay advertencia ni error — simplemente devuelve 1000 filas y para.

**Lo que NO funciona:**
- `.range(0, 9999)` — sigue devolviendo exactamente 1000 filas
- `.range(0, 4999)` — igual, sigue en 1000
- Cualquier `.select()` / `.rpc()` sin paginación explícita en tablas grandes

**Patrón A — RPC que recibe array de IDs como parámetro:**
Chunkear el *input*, no el output. Si cada chunk tiene ≤1000 IDs, la respuesta
también será ≤1000 filas: partir `ids` en tandas de 1000 y `Promise.all` de un
`.rpc()` por tanda, aplanando `r.data`.

⚠️ **Ese "también será ≤1000 filas" SÓLO vale si la columna del `.in()` es
única en la tabla destino.** Si se repite, cada id de entrada trae N filas y el
techo desaparece — acotar la entrada no acota nada. Costó el filtro «Receta
Médica» de Ventas, que vivió roto desde el día uno:
`.in('erp_product_id', <79 ids>)` sobre `sales_invoice_items` devuelve **4,013
filas**, se recibían 1000, y agosto/2026 mostraba **8 ventas de 93**. El
`npm run gate:data` estaba en verde porque daba por acotada cualquier consulta
con un `.in(`. Hoy lo vigila la categoría `in-columna-repetida`.

Y traer la lista completa tampoco es la salida: esos ids vuelven dentro de la
**URL** del `.in()` siguiente, y con un rango de un año son ~1,700. Cuando el
conjunto no cabe ni en la respuesta ni en la URL, el filtro va a la base —
`get_ventas_con_receta` es el modelo.

**Patrón B — RPC/select que pagina el output (ej. `get_stock_analysis`):**
Primero `get_X_count`, después `ceil(count / 1000)` llamadas en paralelo con
`.range(i * 1000, (i + 1) * 1000 - 1)`. Es exactamente lo que hace
`fetchAllRows` — usarlo, no reescribir el bucle.

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

**Tablas que REQUIEREN paginación**: `products`, `inventory`, `dte_sales`, `product_stock_params`, `sales_invoices`, `pedido_items`, `get_stock_analysis` (RPC).

**El helper canónico es `fetchAllRows`** (`src/utils/supabaseUtils.js`) — no
escribir el bucle de `.range()` a mano. Y **`.limit(1000)` está prohibido**: es
el cap exacto, así que el día que la tabla lo cruza trunca en silencio sin
error. Si querés un tope, que sea un número menor y deliberado.

**Y un tope se aplica ANTES del filtro, no después.** Si la consulta trae N
filas y el navegador recorta con un `.filter()`, lo que se recortó en el
servidor ya no existe para ese filtro — así que el resultado no es «los que
cumplen», es «los que cumplen entre los primeros N», y nadie lo puede notar
porque no hay error ni fila de menos visible.

Medido el 2026-08-20 en `fetchTrasladosPorRecibir`: `.range(0, 200)` sobre 205
solicitudes aprobadas, filtro en JavaScript después. **Cumplían 19 y el tablero
mostraba 16.** Tres cajas despachadas y sin recibir no salían en ninguna
pantalla, y como el corte es por antigüedad el número sólo iba a crecer.

Cuando el criterio no se puede escribir en PostgREST —el caso típico son dos
claves dentro del mismo `jsonb`— la salida es una **función**, no bajar la tabla
y filtrar acá. `get_traslados_por_recibir` es el modelo: INVOKER para que el RLS
siga decidiendo, `RETURNS json` para no volver a caer bajo el techo de las 1000,
y el predicado escrito en la verdad de **JavaScript** (ausente, `null`, `false`,
`0` y cadena vacía son todos falsos) y no en la de SQL, que es lo que hace que
el resultado sea idéntico y no sólo parecido.

---

## REGLA CRÍTICA: el tipo de la columna manda, no el nombre

Descubierto en la auditoría del 2026-07-30 (`docs/AUDITORIA-COMPLETA-2026-07-30.md`).
`sales_invoices.recibido_mh` **es `text`**: guarda el sello de recepción de
Hacienda (40 caracteres), no un booleano. Pero el nombre suena a booleano, así
que el frontend hizo las dos cosas mal:

```js
.eq('recibido_mh', true)        // text = 'true' → CERO filas, siempre
.update({ recibido_mh: true })  // escribe la cadena 'true' SOBRE el sello fiscal
```

La lista "confirmadas por Hacienda" estuvo vacía desde siempre y nadie lo notó,
porque una query que devuelve 0 filas no falla. Lo mismo con
`employees.is_admin`: la columna se eliminó, tres funciones de
`src/data/requests.js` la siguen consultando, y como son los fallbacks del
enrutador de aprobadores, una solicitud puede quedarse **sin aprobador**.

**Antes de comparar o escribir un literal `true`/`false`, verificar el tipo real
de la columna.** `scripts/db/boolean-columns.json` es el snapshot de prod y
`npm run gate:data` lo cruza contra el código. **Regenerar ese JSON al agregar o
cambiar una columna booleana** (el SQL está en su encabezado).

---

## REGLA CRÍTICA: un rótulo no es una clave (2026-08-12)

La otra cara de la regla de arriba. `UnifiedModal` resolvía el cargo de un
empleado cruzando el texto del formulario contra la tabla:

```js
const outRoleObj = roles.find(r => r.name === formData.outgoingRole);
role_id: outRoleObj ? outRoleObj.id : null,   // ← sin coincidencia: null, sin error
```

Y la lista del formulario estaba **escrita a mano**. Medido contra las 24 filas
reales: la tabla dice `Regente de Enfermeria` (id 23, **sin tilde**) y el
formulario ofrecía `Regente de Enfermería`. O sea que relevar a un regente de
enfermería guardaba al empleado con `role_id: null` — sin lanzar, sin avisar y
sin quedar en el log. Fallaba **uno de cuatro** cargos, que es exactamente por
qué sobrevivió.

Tres reglas, y las tres se rompen solas si no se conocen:

1. **Una lista de opciones que existe como tabla NO se escribe a mano.** Sale de
   la tabla, y el texto que se muestra es el de la fila. Así el valor elegido
   coincide con la base *por construcción* y no por suerte. Es
   `feedback_lista_a_mano_se_desincroniza_del_registro` aplicado a catálogos.
2. **`? :` sobre un `find` que puede fallar es un bug, no un default.**
   Convertir "no encontré" en `null` y seguir escribiendo es la familia de
   `feedback_sin_policy_de_update_el_write_devuelve_cero`: la escritura
   "funciona" y no hace lo que dice. O se resuelve, o no se escribe y se avisa.
   El modelo correcto ya estaba en `systemSlice.js` (lanza un error), y es el
   que se replicó.
3. **Cruzar por texto exige normalizar.** `src/utils/roles.js` (`buscarCargo`)
   prueba la coincidencia exacta primero y sólo después la normalizada —sin
   tildes, sin espacios de sobra—. Ese orden importa: con dos cargos que se
   distinguen por un acento, gana el exacto. La tolerancia es una red, no un
   permiso para seguir escribiendo listas a mano.

**Antes de cambiar el rótulo de un catálogo, averiguar si ese rótulo ES el
dato.** Si `value === label`, cambiarlo exige migración; si el `value` es un
código, el rótulo es libre. Un filtro que sólo mira "¿tiene `value:`?" clasifica
mal por construcción — y el chequeo tiene que incluir `supabase/`, porque hay
rótulos que también viven dentro de funciones de Postgres.
`docs/planes-cerrados/PLAN-CATALOGOS-QUE-SON-SU-PROPIO-ROTULO.md` tiene el mapa de los tres
grupos y qué queda abierto.

---

## REGLA: librerías pesadas SOLO por `await import()`

Una librería que sólo hace falta al apretar un botón no puede viajar en el chunk
de la vista. `pedidoPrint.js` importaba `pdfmake`+`vfs_fonts` de forma estática:
entrar a Pedidos costaba **939 kB gzip** (4× el tablero entero) aunque nadie
imprimiera, y 3 de los 4 importadores de ese archivo sólo usan su matemática
pura. Corregido en v2.280.0 → 131 kB.

El patrón correcto ya existía en el repo (`LoginView` con `@zxing`,
`PhotoEditorModal` con `@imgly`); lo que faltaba era la regla escrita:

```js
let libPromise = null;
function getLib() {
  if (!libPromise) {
    libPromise = import('la-lib')
      .then(m => m.default || m)
      .catch(err => { libPromise = null; throw err; });  // reintentar, no quedar roto
  }
  return libPromise;
}
```

Lo vigila `npm run gate:bundle` (necesita `npm run build` antes). La lista vive
en la constante `PESADAS` de `scripts/bundle-gate.mjs`, **cada una con su motivo
escrito**. El gate mide el cierre **estático** de cada ruta lazy — que es el
peso real de entrar a una vista, y es justo lo que una medición con caché
caliente no puede ver.

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

**Probar primero en el entorno de pruebas** el DDL sobre las tablas calientes
(ver «Entorno de pruebas» al final): confirmar que no rompe nada, y sólo
entonces aplicar a prod.

🔴 **En el branch se prueba con `execute_sql`, NUNCA con `apply_migration`.**
Los dos ejecutan el mismo SQL, pero `apply_migration` además escribe una fila en
el `schema_migrations` del branch que producción nunca va a tener con ese
número: la historia del branch deja de ser un prefijo de la de prod y lo que lo
mantiene al día se rompe sin decir por qué.

**Toda migración nueva que toque un cron lleva la guarda «sólo si existe»** —
`WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'x')`—: `cron.unschedule('x')`
lanza si `x` no existe (en prod hay crons creados a mano), y eso rompe la
construcción del próximo branch.
Lo mismo con un `DO` que hace `RAISE EXCEPTION` si falta un secreto de la
bóveda o un cron: el branch repite la historia en una base SIN ellos. Ahí se
sale (`RAISE NOTICE …; RETURN;`), no se lanza — lo vigila `gate:migrations`
(«falla-en-pruebas»). Pasó el 2026-11-10 y cortó 11 migraciones.

### Una función con parámetros se mide SEIS veces, no una

Lista de chequeo. Mediciones, los cuatro casos y los dos filtros de descarte:
`docs/reglas/planes-de-funciones.md`.

- **`plpgsql` pasa al plan GENÉRICO en la sexta ejecución.** Si el plan bueno
  depende de los ARGUMENTOS: `ALTER FUNCTION … SET plan_cache_mode =
  'force_custom_plan'`. Si no depende, NO forzarlo: replanificar en cada llamada
  es una regresión en una función barata y frecuente.
- **`LANGUAGE sql` sin cláusula `SET` se INLINEA** en quien la llama y aplana
  sus CTE.
- **`LANGUAGE sql` CON `SET search_path` nace genérica**: nunca ve un valor, y
  ni `MATERIALIZED` ni `force_custom_plan` a secas lo arreglan. Si el plan
  depende de los argumentos, **pasarla a `plpgsql`** y ahí sí
  `force_custom_plan`; el cuerpo no se toca. Lenta desde la primera llamada =
  esto; lenta desde la sexta = lo anterior.
- **Un `EXISTS` correlacionado fija la dirección del join**; el mismo predicado
  como `IN (SELECT …)` deja al planificador elegir.
- **Medir con `EXPLAIN (ANALYZE, TIMING OFF)`**: con el timing encendido la
  instrumentación de un nested loop inventa tiempo. Buscar el nodo donde `rows`
  estimadas y reales se separan.
- Una función `LANGUAGE sql` con parámetros y CTE se declara en
  `scripts/planes-genericos.json` (sección E de `gate:perf`), con su medición o
  `ms: null` si es deuda.

**Todo `apply_migration` necesita su archivo local en el mismo commit, nombrado
con la versión de 14 dígitos que devolvió el servidor** — `apply_migration` NUNCA
toca el disco, y olvidarlo no da ningún error. El `name` del archivo idéntico al
del `apply_migration`, creado en la misma sesión: nunca "lo consolido después". Si
el SQL se redacta antes de aplicarlo, el borrador va al **scratchpad**, no a
`supabase/migrations/`. Al cerrar, `npm run gate:migrations` y
`npm run gate:migrations -- --remote`; su constante `CORTE` **no se mueve** para
silenciar un hallazgo. El detalle —el baseline, `migrations-legacy/`, por qué el
detector natural quedó ciego— vive en la skill **`migraciones`**.

**Edge functions**: NUNCA ignorar el `error` de un query supabase-js
(`const { data } = await ...` sin chequear `error`). Un select que falla en
silencio deja Maps/lookups vacíos y el bug puede vivir semanas sin detectarse
(pasó con `presentaciones.descripcion`: columna eliminada el 2026-06-08, el
sync la siguió consultando un mes, error en logs de Postgres cada minuto).
Al eliminar/renombrar columnas: grep en `supabase/functions/` además de `src/`.

**`--no-verify-jwt` depende de QUIÉN llama a la edge function**, no de a qué
circuito pertenece. Cron o Postgres → `--no-verify-jwt` (no hay sesión que
presentar; la función valida por su cuenta). Navegador → JWT. **No hay lista
fija**: antes de cualquier redeploy, leer el valor VIVO con
`list_edge_functions` (campo `verify_jwt`). Una que llama un cron, desplegada
sin el flag, queda en 401 antes de ejecutar una línea (pasó tres veces); una que
llama el navegador, desplegada con el flag, queda abierta
(`aplicar-solicitud-facturacion` anula facturas). Y el CLI se traga el `.env`
del repo: `mv .env .env.bak` primero (memoria
`reference_edge_function_deploy_workaround`).

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

**El ERP es más lento que el límite de una Edge Function.** Medido el
2026-08-01: `descargar_compras_json.php` tarda **167s en un mes de Bodega** y 68s
en 10 días, contra los **150s** que vive la respuesta de una Edge Function. Un
backfill por mes da 504 aunque el trabajo esté bien. Dos consecuencias:
`sync-erp-purchases` acepta `background: true` (responde 202 y sigue con
`EdgeRuntime.waitUntil`), y **todo backfill va en ventanas de ≤10 días**. El cron
no usa el modo background a propósito: pide 2 días, termina en segundos y quiere
el resultado en la respuesta para que un fallo se vea.

## REGLA: replicar un reporte = comparar TODAS sus columnas

Al reproducir el libro de compras del ERP (2026-08-01) verifiqué mayo 2025 en las
7 sucursales y cuadraba al centavo en documentos, total, crédito fiscal y
percepción. Escribí "verificado" en la migración, el commit y el changelog. La
quinta columna —**gravadas**— estaba mal en todas las filas con percepción, y lo
delató una captura de pantalla, no la verificación.

La causa era sistemática: el ERP manda `totales.sumas_gravadas` **con la
percepción adentro** (cumple `sumas_gravadas + iva = total_operacion`) y su libro
la resta para llegar a la base gravada. Los otros cuatro números no lo mostraban
porque el total la incluye, el crédito fiscal no la toca y la percepción cuadraba
con ella misma.

**La lista de columnas a comparar sale del encabezado del reporte destino, no de
lo que a uno se le ocurre chequear.** Recorrerlo columna por columna; si una no
se puede verificar, decirlo — no omitirla en silencio. Es la otra cara de la
regla del sello (`docs/` y memoria `feedback_el_sello_es_el_filtro_del_libro`):
allá era no redondear una diferencia, acá es no declarar "sin diferencia" cuando
ni se miró.

## REGLA: la pantalla habla del PORTAL, nunca del sistema de origen

Corregido por el usuario dos veces — el 2026-08-01 (barrido de 9 archivos,
v2.334.1) y otra vez el **2026-08-02**, en la vista de Compras Completo, que
salió a producción con una pestaña «SIN COMPRA ERP», un badge «ERP» en cada
fila y dos avisos que nombraban al ERP cuatro veces.

> «esa info no la necesito en el portal. además, ERP no saben qué es, no lo
> pongas. que todo parezca que sale del portal.»

Son **dos reglas distintas** y valen para toda la UI **y para los archivos que se
exportan**:

1. **Nunca nombrar el ERP** —ni ningún sistema de origen— en texto que ve el
   usuario. No sabe qué es. Tampoco la jerga de la tubería: "sincronizar",
   "sync", "resincronizá". Se dice en términos del negocio:
   `Sin sincronizar` → **Sin número**; "Resincronizá el mes" → **hay que
   completar el mes**; columna `ID ERP` del CSV → **ID INTERNO**;
   "Match ERP" → **Registrado como**; "Sin match ERP" → **Sin vincular**.
2. **La procedencia y la verificación no van en pantalla.** Que un libro cuadre
   contra otro sistema es una nota de quien lo construyó. El aviso tiene que
   decir **qué mira** el libro (el sello de Hacienda, las 7 sucursales, lo que
   exige el Art. 86), no de dónde viene.

**Los comentarios del código SÍ conservan la trazabilidad** — ahí sirve y no la
ve nadie que use el portal. La regla es sobre la UI y los archivos exportados.

**Grepear el fuente NO alcanza para verificarlo**: la mitad de estos textos viven
en `title`/`aria-label`/`placeholder`, y el grep los confunde con identificadores
que sí se quedan (`ERP_ORDER`, `erp_id`, `matchErpFilter`). La verificación es
**abrir la vista en el navegador** y barrer el DOM pintado más esos tres
atributos. Es la misma lección que el outage del mismo día: compilar y pasar los
gates no prueba nada sobre lo que se ve.

## Estructura BD — reglas OBLIGATORIAS al crear tablas/funciones/vistas

Hardening aplicado el 2026-07-02 (`supabase/migrations-legacy/20260702_db_hardening_rls_functions_indexes.sql`
y `…/20260702_granular_write_policies.sql`). Advisor de seguridad en 0 ERRORES —
toda tabla/función nueva debe mantenerlo así. Versión larga con los incidentes:
`docs/reglas/estructura-bd.md`.

1. **Toda tabla nueva**: PK + `created_at timestamptz default now()` + **RLS habilitado
   con policy explícita** (mínimo `FOR SELECT TO authenticated`). NUNCA dejar una tabla
   sin RLS — `anon` no debe ver nada. Las que no tienen `created_at` están
   declaradas con su motivo en `auditoria/tablas-sin-created-at.json`;
   `gate:auditoria` falla si aparece otra sin declarar. Sin motivo, se le agrega
   la columna.
2. **Toda FK**: con índice que la cubra (`CREATE INDEX ... ON tabla(col_fk)`), excepto
   columnas de puro audit (`*_por`, `created_by`) en tablas pequeñas.
3. **Policies de escritura**: prohibido `USING (true)` para UPDATE/DELETE **y
   `WITH CHECK (true)` para INSERT** (sólo es inerte `TO service_role`, que salta
   el RLS igual). Una tabla append-only no necesita policy de DELETE, pero su
   INSERT **sí** dice quién escribe qué: `attendance_insert` exige
   `employee_id = auth_employee_id() OR can_edit('time_audit')` y
   `audit_logs_insert` exige `user_id = auth_employee_id()` — nadie fabrica una
   marcación ni firma con el nombre de otro. Usar `auth_can_edit_any(ARRAY['modulo1','modulo2'])`
   (resuelve al empleado por uid/code/username y chequea can_edit en
   role_permissions).
   **CRÍTICO (incidente 2026-07-08): TODA llamada a funciones `auth_*` en una policy
   va envuelta en `(SELECT ...)`** — `(SELECT auth_has_module_permission('x','can_view'))`,
   nunca a secas. Sin el wrapper Postgres la evalúa POR FILA (en `sales_invoices`
   un count() pasó de 25,000 ms a 19 ms con el wrapper; fue el pico de CPU y el
   Disk IO del 7-8 jul). El advisor NO lo detecta, y ser STABLE no basta: sólo el
   initplan `(SELECT fn())` garantiza una evaluación.
   Historial (`employee_events`, `timesheets`, etc.) es append-only: sin policy
   de DELETE (las RPCs DEFINER y service_role no la necesitan).
4. **Funciones**: SECURITY DEFINER solo si es necesario, SIEMPRE con
   `SET search_path = public, extensions`, y `REVOKE EXECUTE ... FROM PUBLIC, anon` +
   `GRANT ... TO authenticated, service_role`.
   **Lo que `anon` alcanza vive en `auditoria/superficie-anon.json`** y lo vigila
   `npm run gate:auditoria`: producción exponiendo algo que no esté declarado
   ahí FALLA. Al agregar una función o policy para `anon`, se declara con su
   guarda y su motivo; sin motivo, se le revoca el EXECUTE. **Al cambiarle la
   firma a una función, la sobrecarga vieja se queda con sus permisos**
   (`update_proveedor_manual` quedó con dos y la revocación alcanzó a una). Las
   de `pg_trgm`/`pg_net` no cuentan: son internas de extensión, revocarles
   EXECUTE rompe los índices de trigram, y salen del namespace público moviendo
   la extensión.
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

## Fichas de clientes y Hacienda: un circuito automático

Detalle: `docs/reglas/fichas-y-hacienda.md` y
`docs/RETOMAR-FACTURACION-Y-DTE-2026-08-09.md`. Lo que no se puede romper:

- **El orden de los crons importa**: 21:30 SV `sincronizar-fichas-clientes`
  corrige fichas; 22:30 SV `regularizar-dte` manda a Hacienda. La segunda vuelta
  de la misma noche se dispara por «lo puedo escribir»
  (`fichas_para_corregir_dte()` con `puede_escribir AND NOT ya_corregido`), no
  por «accionable», y sólo se reenvía si la corrección escribió algo.
- **La tabla de decisión de `sincronizar-fichas-clientes` y el `campo_ficha IN (...)`
  de `fichas_para_corregir_dte()` son la misma lista**: se mueven juntas.
- **«Sin sello» = sin sello VÁLIDO** (`recibido_mh` es `text` de 40), en los tres
  sitios: barrido, guarda previa al envío y cola de Pendiente MH. Nunca `IS NULL`
  ni `!!valor`.
- **La ficha se corrige en el ERP, NO en el portal**; ubicación resuelta por
  etiqueta y escrita en cascada. El alcance lo decide `alcance_escritura_ficha()`
  en la base (`todo` / `solo_distrito` / `ninguno`, que es la falla segura). El
  distrito de un contribuyente se DERIVA con el matcher, nunca con el triple por
  defecto. Teléfono inválido → el de la empresa; DUI inválido → se borra.
  `identificacion.fecEmi` no se corrige nunca.
- **`_shared/distrito.ts` es una traducción verificada de `bloque.py`**: cambiar
  cualquiera de los dos exige volver a correr `comparar_matcher.mjs`.
- **El cliente se liga por el número del ERP, nunca por el nombre.** Fusionar
  BORRA una ficha: si los nombres no se parecen, no se fusiona — va a «Por revisar».

## REGLA: un número de boleta sólo es único DENTRO de quien lo numera

Nunca comparar sólo número y sentido. Quién es la MISMA operación lo decide la
base, una vez: `caja_misma_operacion_de_boleta` (sobre `caja_familia_de_boleta`),
y lo leen `operar-caja`, `choqueDeBoleta` en la pantalla y la sección E de
`gate:cortes`. POS y otros tipos → mismo número **y** mismo monto (y terminales
distintas → otra operación; cada terminal en `caja_terminales_pos`, reconocida
por huella); voucher → no se juzga. Detalle:
`docs/reglas/boleta-unica-por-emisor.md`.

## Cuentas por cobrar, efectivo del cobro y cierre del día

Detalle con montos e incidentes: `docs/reglas/caja-creditos-y-cierre.md` (y
`docs/CAJA-CORTES-Y-BOLSAS.md`). Las reglas que cuestan dinero:

- **La lista sale del espejo** (`creditos_de_clientes`); **el cobro relee el
  ORIGEN** antes de abonar, y relee después para guardar el saldo que el origen
  dice. El origen no tiene forma de deshacer un abono.
- **`id_factura` lleva el ID DEL CRÉDITO**, no el de la factura. La traducción
  vive en UNA línea de `creditos-erp` y el parámetro se llama `credito` de punta
  a punta: el número equivocado abona a otra persona sin error.
- El espejo se mantiene con cuatro piezas (pasada de hoy, **barrido diario
  completo** —no es redundante—, relectura tras abonar, y lectura al abrir la
  pantalla con el tope en la BASE: `creditos_tomar_lectura`). El raspado vive
  una sola vez en `_shared/creditos.ts`. `vencio_el`/`pagado_el` se OBSERVAN
  (`COALESCE(viejo, nuevo)`), no se calculan; vencido exige saldo.
- **El efectivo cobrado desde el portal NO está en el esperado del comprobante**:
  lo sella `cortes_caja.cobros_portal_efectivo` (dos triggers) y `contraste` lo
  suma. Nunca calcularlo en cada pantalla. El corte recién hecho se traduce a
  fila en `conLaCuentaBuena` (`cortesDiagnostico.js`): **al agregarle una
  columna al juez, se agrega ahí**, preguntándole al mismo canónico
  (`cobros_portal_en_efectivo`). Lo que contó el comprobante se DERIVA de su
  suma (`total_caja − subtotal + vales`), no del renglón.
- **El cierre del día (Z) no se deshace y tiene cuatro frenos**, en
  `hacer-corte-caja` (nunca en `operar-caja`) y repetidos en la pantalla: corte
  sin resolver, sin corte confirmado, efectivo sin contar (juez único
  `caja_falta_por_contar`, que compara dos ESPERADOS, nunca esperado contra
  conteo) y preventa sin finalizar (vale también para el corte C; si no se
  puede leer la lista, frena).
- **El día que nadie cerró lo cierra `cierre-automatico-caja`**, con el juez
  `caja_cierre_automatico_decidir` consultado por el cron y otra vez antes de
  emitir, más la lectura en vivo (`ya_estaba`). En modo `automatico` no frena
  «corte sin resolver»; sí «efectivo sin contar» y «preventa». Al tocar un
  freno, mirar también la rama `automatico`.

## MIN·MAX: ABC/XYZ son SOLO clasificación (decisión, no bug)

Para todo producto: `MIN = floor(velocidad × 25)`, `MAX = ceil(velocidad × cycle_days)`.
ABC y XYZ no intervienen en ningún número. **No cambiar la fórmula ni la
config** — si una auditoría lo levanta como bug, ésta es la respuesta. Cambiar
`cycle_days` o `reorder_*_days` reescribe el MIN/MAX de todo el catálogo a la
vez (uno de los motivos del candado de mantenimiento). Detalle:
`docs/reglas/minmax.md`.

## REGLA CRÍTICA: el teléfono no es la pantalla chica (canon móvil)

Canon completo: **DESIGN.md §32** (§32.7–§32.9). Las tres capas de verificación
y las trampas de medición: `docs/reglas/canon-movil.md`. El modo de falla es el
SILENCIO: en escritorio todo funciona. En el teléfono `DataTable` pinta fichas,
y la vista declara lo que no puede adivinar:

| prop | cuándo |
|---|---|
| `usarAccionDeFila: true` | la fila tiene un destino de verdad (un modal, una navegación). **Sin esto la hoja genérica le GANA al destino real.** |
| `apilada: true` | la primera celda no es un nombre sino un BLOQUE escrito para una columna. Medido en Mín·Máx: 105px recortados por ficha; en el libro de compras, 161px. |
| `acciones: 'mantener'` | la fila tiene acciones. Van detrás de mantener presionado (§32.7), no en una tira. |
| `acciones: true` | igual, pero como tira visible. Sólo con una o dos acciones. |
| `movil={false}` | **la fila no es un registro** (una matriz, un calendario). Exige motivo escrito arriba. |

- Si el `onClick` expande un `<tr colSpan>`, `usarAccionDeFila` no alcanza: el
  destino es `ExpedienteMovil` (cuerpo escrito una vez, prop `comoPanel`;
  expansión de escritorio apagada con `!enTelefono`), y el corte sale de
  `useExpedienteMovil`, nunca de un `useMediaQuery` propio.
- Blanco de dedo de 44pt (`min-h-[var(--tap-min)]`; `data-medida="dato"` cuando
  el tamaño ES el dato). El toque acusa recibo (`active:scale-[0.97]` o
  `data-interactive`). Áreas seguras por `--sa-top/right/bottom/left`, nunca
  `env()` a mano. Un formulario largo guarda borrador, y si vive en un store,
  persiste el store.
- Se verifica con tres capas, porque ninguna ve lo de la otra:
  `npm run gate:movil`, `tests/e2e/barrido-total-movil.spec.js` (por tandas) y
  `tests/e2e/dialogos-movil.spec.js` (corre contra producción: abrir no puede
  escribir).

## REGLA: un día de horario se resuelve en UN solo sitio

`src/utils/turnoDelDia.js` y su gemelo `public.turno_del_dia(jsonb, jsonb)`. Si
estás por escribir `dayData.shiftId ? … : …` o `dayData.customStart || shift.start_time`,
**ya existe**. Son seis las formas de decir «no trabaja» (incluida
`shiftId: 'LIBRE'`), y el día sin la clave `isOff` **trabaja**. Cambiar un gemelo
exige cambiar el otro y volver a enfrentarlos con `tests/unit/turnoDelDia.test.js`.
Las constantes del reglamento (jornadas y descansos, con su artículo) viven ahí.
**Guardar una celda NO toca el estado de publicación** (`guardar_dia_de_horario`).
Detalle: `docs/reglas/horario-del-dia.md` y
`docs/HORARIOS-LA-SEMANA-EL-DIA-Y-LA-COPIA-AUTOMATICA-2026-08-24.md`.

## Cuando el portal no responde: `npm run portal:lento`

El síntoma nunca nombra la causa («no se puede iniciar sesión», «Timed out
acquiring connection from connection pool»). En orden:

1. `npm run portal:lento` (sólo lectura).
2. Si hay una consulta viva de más de 3 s, **es ésa** — la más vieja.
3. Si no, el listado por BLOQUES (no milisegundos: bajo saturación todo tarda),
   cruzado con cuántas veces corre.
4. Sobre la candidata, `EXPLAIN (ANALYZE, TIMING OFF, BUFFERS)` y buscar dónde
   se separan filas estimadas y reales — casi nunca está en el SQL. Un booleano
   casi todo igual se arregla con un índice parcial sobre la condición rara, no
   con un `ANALYZE`.
5. Corregir, y borrar sólo su estadística para verificar:
   `SELECT extensions.pg_stat_statements_reset(userid, dbid, queryid) FROM extensions.pg_stat_statements WHERE query LIKE '%<funcion>%';`
6. Para parar la sangre YA: `UPDATE cron.job SET active = false WHERE jobname = '<el cron>';`
   — reversible; un portal caído en horario de sala, no.

Un reinicio de Postgres es consecuencia, no causa. Si un número parece absurdo,
sospechar del instrumento. Lo vigila la sección F de `gate:perf`
(`scripts/bloques-por-llamada.json`). Detalle: `docs/reglas/portal-lento.md`.

---

## REGLA CRÍTICA: hay OTRAS sesiones trabajando en este mismo árbol

El árbol de trabajo es compartido y no avisa: otras sesiones editan, commitean
y pushean en el medio. Historia y mediciones:
`docs/reglas/sesiones-ramas-y-publicacion.md`.

- **Antes de editar un archivo que no tocaste en esta sesión**: `git status --short`.
  Si aparece modificado y no es tuyo, leerlo antes de escribirlo: un `Write`
  encima borra trabajo ajeno que no está en ningún commit.
- **Prohibido barrer el árbol.** Nunca `git add -A` / `git add .` / `git commit -a` /
  `git stash` / `git checkout .` / `git restore .` / `git reset --hard`. Siempre
  paths explícitos, y **`git status` después del `add`** — un pathspec que falla
  aborta TODO el add.
- **Commitear lo propio en cuanto compila**, con paths explícitos. `git fetch`
  antes de pushear: el remoto puede haberse movido.
- **El `main` de este árbol se queda atrás solo** (`git pull` se niega con el
  árbol sucio y `stash`/`reset --hard` están prohibidos). `npm run main:al-dia`
  (`-- --aplicar` para hacerlo) lo pone al día sin perder nada: se niega si hay
  algo sin gemelo arriba, respalda en `.git/respaldos-main/` y usa
  `reset --keep`. El pre-commit bloquea un commit en `main` atrasado respecto de
  `origin/main`.
- **Versión: `npm run version:bump -- patch|minor|major "Título"`.** Sube
  `APP_VERSION`, deja empezada la entrada en `CHANGELOG.md` y relee justo antes
  de escribir. Nunca "el anterior + 1", nunca editar `src/version.js` a mano, y
  la entrada va en `CHANGELOG.md`, NUNCA en `src/version.js`: `version-gate`
  exige que la versión suba y que `## v<versión>` esté preparado en el mismo
  commit.
- **Trabajo largo o riesgoso, árbol propio**: `npm run worktree -- <nombre>`
  crea `../Portal-Farmalasa-<nombre>` en la rama `sesion/<nombre>`, nacida de
  `origin/main`, con `node_modules` enlazado y `.env` copiado; hay que mergear a
  `main`. **Al terminar, se borra**: `npm run limpiar:worktrees` (`-- --borrar`)
  quita los que no tienen nada sin commitear, ni commits fuera de `origin/main`,
  ni uso reciente, ni un proceso adentro. Un worktree con trabajo sin commitear
  nunca se borra solo.
- **`sesion/nucleo` NO es un `sesion/<nombre>` descartable**: es la rama de
  integración de dev (`dev.farmasalud.lat`), y el usuario une ahí trabajo que
  todavía no va a producción (la distribuidora). **Nunca `push -f` a
  `sesion/nucleo`**, nunca `npm run worktree -- nucleo` ni borrarla al limpiar,
  y **nunca `push HEAD:main` desde ella** (llevaría a producción lo que no va).
  El trabajo para producción va en una rama sobre `origin/main` y se publica con
  `git push origin HEAD:main`; después `sesion/nucleo` se pone al día con
  `git merge origin/main` + push normal.
- **El preview de QA es uno solo**: las edge functions sólo aceptan CORS de
  `http://localhost:4173`, y `npm run preview` lleva `--strictPort` para que un
  puerto ocupado falle claro. Para compilar sin pisar el `dist/` de otra
  sesión: `OUT_DIR=dist-<nombre> npm run build`. Las `dist-*` viejas las borra
  el `prebuild` (`npm run limpiar:dist` a mano); nunca `dist`/`dist-staging`, el
  `OUT_DIR` en curso ni una que nombre un proceso vivo.
- **El hook de pre-commit** (`.githooks/pre-commit`; `npm run hooks:install` una
  vez por clon) bloquea si un archivo preparado se modificó después de
  prepararlo, lista lo que queda fuera y corre los gates locales (tabla en
  «Estándares»). `git commit --no-verify` es para una emergencia real, no para
  silenciar un hallazgo.

## REGLA: pushear a `main` NO publica el portal — `npm run publicar`

- Producción es la rama **`produccion`** (portal.farmasalud.lat). Se mueve con
  **`npm run publicar`** (`scripts/publicar.mjs`): la adelanta a `origin/main`
  sólo si hay cambios de la web, sin tocar el árbol. `-- --ver` dice qué saldría.
- **Un despliegue cada 30 minutos como mucho** (2026-11-10, lo pidió el usuario
  por el sobrecargo de compilación de Vercel). Si el anterior fue hace menos,
  `publicar` no despliega y dice desde qué hora sale: lo de ahora queda en
  `main` y va en la próxima. Saltearlo SÓLO por emergencia o error crítico:
  `npm run publicar -- --urgente "qué se rompió"`. Nunca para apurar un ajuste.
- **Después de un arreglo de web verificado, `npm run publicar` sin
  preguntar; los commits de una misma tarea se juntan en una publicación** (cada
  despliegue cuesta minutos de compilación: no uno por commit). Avisar después
  qué se publicó. Si el clasificador de permisos lo bloquea, decirlo en una
  línea y reintentar en cuanto el usuario confirme.
- Lo que no es web (`apps/`, `supabase/`, `scripts/`, `docs/`, `auditoria/`,
  `CHANGELOG.md`, `src/version.js`) no se despliega por Vercel. Las funciones van
  por `supabase functions deploy`. Las apps se compilan en esta Mac, sin EAS:
  `node scripts/subir-ios.mjs <carpeta> <perfil>` y
  `node scripts/subir-android.mjs <carpeta> <perfil>` (p. ej. `apps/mobile interna`,
  `apps/clientes clientes`); la app de clientes además se actualiza por aire con
  `npm run app:actualizar -- "Qué cambia"`.
- `sesion/nucleo` también despliega (es dev). La regla vive en
  `scripts/vercel-ignorar.sh` (el `ignoreCommand` de `vercel.json` no admite más
  de 256 caracteres).

## REGLA CRÍTICA: lo que ya se auditó no se toca sin preguntar

El portal está repartido en áreas (`auditoria/areas.mjs`), cada una con un %
sobre sus ejes. Un área que llega a 100 y tiene su sello de sala queda
**CONGELADA**: `npm run gate:auditoria -- --hook` corre en el pre-commit y
**falla** si el commit la toca.

**Antes de tocar un área congelada: preguntarle al usuario.** Después:

```bash
npm run auditoria:desbloquear -- <area> "por qué se toca"
# … el trabajo …
npm run auditoria:sellar -- <area> "qué se corrió para verificarlo"
```

Mientras el desbloqueo esté abierto, `npm run gate:auditoria` (sin `--hook`)
**falla**: el commit puntual pasa, el trabajo no se cierra.

- **El % no se escribe a mano**: sale de `auditoria/puntuar.mjs`. Un eje en 90 o
  más exige evidencia escrita.
- **El sello de sala es un TOPE, no un sumando**: sin él, un área no pasa de
  `TOPE_SIN_SELLO` (`areas.mjs`); el 100 lo da una corrida real con datos de
  producción.
- **Un archivo, tabla, función o cron sin área hace fallar el gate.** Al crear
  una vista o una tabla, agregarla a `areas.mjs`.

Informe completo: `docs/AUDITORIA-PORTAL-2026-08-23.md`.

---

## Estándares del proyecto

- Ver `DESIGN.md` para patrones de UI (glassmorphism, filter pills, tabs, search)
- Siempre usar `LiquidSelect` en lugar de `<select>` nativo
  - **El placeholder NUNCA va como opción** (2026-10-08). `{ value: '', label: '¿De qué sucursal?' }`
    al tope de `options` es el rótulo del campo copiado en la lista, y salía
    como si se pudiera elegir. El rótulo va en `placeholder`; para volver a
    vacío está `clearable` (o la fila «Todos»). `LiquidSelect` ya descarta la
    opción vacía cuyo texto es IGUAL al `placeholder` y, si el select no es
    `clearable` (los filtros), pone la fila de vuelta. Una opción vacía con
    texto PROPIO («Todas», «Consumidor Final») sí es una elección y se queda.
  - **Un sólido es sólido**: un `Badge tone="solid"` o una pastilla con
    `text-white` no lleva fondo con `/NN` ni borde `transparent` — el anillo
    transparente dejaba ver el borde del campo de atrás y el «-1» de
    recepción se leía translúcido. Y si va montado sobre un campo, lleva
    `z-tabs`: `PortalInput` es `relative z-base`, así que sin eso el borde y
    el relleno del campo se pintan ENCIMA del contador y parece vidrio aunque
    el color sea opaco. Verificar con lupa, no con `getComputedStyle`.
- Badges `es_antibiotico=true` → "Bajo Receta" (NUNCA "Abx")
- Toda acción de usuario → `appendAuditLog` (staffStore → `audit_logs`)
- **Impresión en ticketera: `imprimirDocumento(ticket)`, y ningún otro camino.**
  Se importa de `src/utils/imprimirDiferido.js` —desde una pantalla
  `@nucleo/utils/imprimirDiferido`, desde un hook del núcleo
  `../utils/imprimirDiferido`—: misma firma, y carga la ticketera recién al
  imprimir (regla de librerías pesadas). `src/utils/ticketPrint.js` es la
  implementación: importarlo estático desde una pantalla la mete en el chunk de
  la vista; directo, sólo desde código que ya se carga diferido o desde las
  pruebas. Intenta el
  envío sin diálogo y cae al diálogo del navegador. **No elegir el camino a mano
  ni escribir un segundo maquetador.** El ancho del rollo NO se pasa: es un
  ajuste de la computadora (`leerAjustesDeImpresion`). `ok: true` significa
  *recibido*, nunca *salió papel*. Cuatro cosas que se rompen solas: **sólo
  ASCII** («NUÑEZ» salió `NUÆEZ`), **54 columnas** en letra chica y 40 en
  normal, **alinear rellenando y nunca con `ESC a`**, y **el papel no tiene
  tema** (sólo negro, sin fondos, sin tokens ni `rounded-*`). Receta campo por
  campo: §5 de `docs/IMPRESION-EN-TICKETERA-2026-08-13.md`; geometría anclada en
  `tests/unit/ticketPrint.test.js`. Prueba de papel en Sistema → Prueba de
  impresión.
- **La pestaña activa de una vista vive en la DIRECCIÓN, nunca en `useState`.**
  Hook canónico: `usePestanaEnUrl` (`src/plataforma/usePestanaEnUrl.js`), también
  para vistas nuevas. Detalle en DESIGN.md §14 · ViewTabBar.
- **Un formulario largo se guarda solo.** La sesión se cierra sola por
  inactividad (plazo por cargo) y lo escrito se pierde. A partir de 6 controles
  de captura, el archivo guarda borrador con `saveDraft`/`loadDraft` de
  `src/utils/draftUtils.js`, o va a `EXCEPCIONES` de `scripts/draft-gate.mjs` con
  su motivo escrito.
- **Toda salida de datos se ANOTA, y el que exporta no firma**: por
  `registrar_egreso(modulo, formato, filas, detalle)` (en el frente,
  `registrarEgreso` de `src/data/egreso.js`, que nunca lanza), nunca con un
  `INSERT` del cliente — la firma sale de `auth_employee_id()` y para la mayoría
  de la gente la ficha y la cuenta son ids distintos. Una salida nueva usa
  `exportCsv`, y `exportCsv` exige el módulo.
- **Un control de seguridad nuevo se instala UNA vez y se enciende con una
  fila** de `security_config` (`observar` → `avisar` → `exigir`; helpers
  `sec_exige(key)` / `sec_avisa(key)`, envueltos en `(SELECT …)`). La marcha
  atrás nunca puede ser una migración (DDL sobre tabla caliente). Sin fila, NO
  exige. Detalle: `docs/SEGURIDAD-Y-ACCESO.md`.
- **«¿Cuenta como venta?» = `public.venta_valida(estado)`; «¿entra al libro?» =
  `public.venta_fiscal(estado, recibido_mh)`.** Nunca el filtro de estados a
  mano: `migration-gate` lo rechaza salvo `-- venta-a-mano: <motivo>`. Las dos
  van sin `SET search_path` a propósito (se inlinean). Al reescribir una función
  que lee `sales_invoices`, partir de su definición VIVA (`pg_get_functiondef`).
- **El nombre de una persona sale de `shortEmployeeName`** (`src/utils/nameUtils.js`):
  primer nombre + primer apellido. Excepciones —Personal, lo que SALE del portal
  (CSV, planilla, papel), quien no es empleado— en `EXCEPCIONES` de
  `scripts/nombre-gate.mjs` con motivo y cuenta.
- **La lógica no conoce al navegador**: `src/{data,utils,store,hooks,context,constants}`
  no usa `window`/`document`/`localStorage`/`import.meta.env` ni importa
  pantallas o íconos (el navegador se pide por `@plataforma/…`; un ícono se
  devuelve por su NOMBRE). Desde una pantalla, el núcleo se importa como
  `@nucleo/…`, nunca `../../utils/…` (`node scripts/nucleo-alias.mjs --escribir`
  lo corrige). Plan: `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`.
- **Un módulo nuevo del portal nace también nativo en la app**: su pantalla en
  `apps/mobile` (iOS con SwiftUI/`@expo/ui`, Android con las piezas `.android.js`)
  registrada en `apps/mobile/pantallas.js`, o en `EXCEPCIONES` de
  `scripts/app-nativa-gate.mjs` con su motivo.
- **La base es un CONTRATO**: `src/types/database.ts` son los tipos de
  producción. Al cambiar la base, `npm run tipos:base` y commitear los tipos con
  la migración.
- **`src/constants/tokens.json` no se edita a mano**: sale de `src/index.css`
  con `npm run tokens:exportar`.
- **El libro bajo receta no es «todo antibiótico»**: son las moléculas del
  listado de SRS más todo antibiótico inyectable, y el gate detecta por
  PRINCIPIO ACTIVO, nunca por marca.
- **Toda edge function nueva, y toda función de la base que reciba una
  sucursal, se declara en `scripts/alcance-manifest.json` con su guarda**
  (`alcance`, `modulo-de-red`, `sin-sala`, `cron`, `publica`, `solo-servidor`).
  `modulo-de-red` se comprueba contra `role_permissions`: darle ese módulo a un
  cargo de sala pone el gate en rojo. Declarar `alcance` es una afirmación sobre
  CADA acción del archivo.
  Un bucket privado cuya policy de lectura sea `bucket_id = '…'` a secas va en
  `buckets_abiertos` con su motivo.
- **Un cron nuevo o una cadencia apretada** se declara en el manifiesto `CRONS`
  de `gate:eficiencia` con cuántas peticiones cuesta, y su motivo
  (`sistema: null` es deuda declarada, no un número inventado).

### Los gates — una sola tabla

Dos reglas valen para todos: **un baseline es un trinquete y sólo BAJA** —nunca
se regenera ni se sube un presupuesto para tapar un hallazgo nuevo—, y **un gate
que necesita red no va en el pre-commit**: falla sin conexión y enseña a
escribir `--no-verify`. Esos se corren a mano al cerrar el trabajo que tocan.
Antes de creerle un cero a un gate, fabricarle la regresión que debería cazar.
Por qué existe cada uno: `docs/reglas/gates.md` y el encabezado de su script.

| gate | qué vigila | pre-commit | red | detalle |
|---|---|---|---|---|
| `gate:version` | `APP_VERSION` sube y `## v<versión>` está en `CHANGELOG.md` | siempre | no | `scripts/version-gate.mjs` |
| `gate:auditoria` | áreas congeladas; todo mapeado en `areas.mjs`; superficie `anon`; tablas sin `created_at` | `-- --hook`, siempre | completo: sí | `auditoria/` |
| `gate:migrations` | cada `apply_migration` tiene su archivo con la versión del servidor; `CORTE` no se mueve | si toca `supabase/migrations` | `-- --remote`: sí | skill `migraciones` |
| `gate:data` | techo de 1000 filas, `.limit(1000)`, `in-columna-repetida`, literales booleanos contra `scripts/db/boolean-columns.json`, errores tragados | si toca `src/` o `supabase/functions/` | no | — |
| `gate:alcance` | nadie toca otra sucursal cambiando un número; `alcance-manifest.json`; buckets abiertos | si toca `supabase/functions/` | completo: sí | `docs/planes-cerrados/PLAN-ALCANCE-POR-SUCURSAL-2026-10-02.md` |
| `gate:seguridad` | una edge function no decide permisos con `user_metadata`; policies abiertas | si toca `supabase/functions/` | completo: sí | `docs/SEGURIDAD-Y-ACCESO.md` |
| `gate:eficiencia` | peticiones/día al sistema de origen por cron (baseline), `fetch` sin plazo, crons vivos, salientes en 200; un cron que falla se mide por tasa, no por tropiezo | si toca funciones o migraciones | completo: sí | `scripts/eficiencia-gate.mjs` |
| `gate:perf` | constantes del buscador, índices, forma del plan, tiempos (D), planes genéricos (E), bloques por llamada (F) | `--hook` sólo si toca sus 3 archivos | completo: sí | `docs/reglas/portal-lento.md` |
| `gate:undefinidos` | variable que no existe (`no-undef`) | si toca `src/` | no | — |
| `gate:tdz` | variable leída antes de su `const` en la misma pasada (lanza en cada render): al mover un hook o un `useMemo`, comprobar que lo que lee ya esté declarado | si toca `src/` | no | `scripts/tdz-baseline.json` |
| `gate:busqueda` | buscadores fuera de la regla única (`src/utils/busqueda.js` y `busqueda_*`) | si toca `src/` | no | `docs/planes-cerrados/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md` |
| `gate:permisos` | registro de permisos contra el código que los consulta | si toca `src/` | no | `scripts/permissions-gate.mjs` |
| `gate:alias` | el núcleo cruza su borde por `@nucleo/…` / `@plataforma/…` | si toca `src/` o `tests/` | no | `scripts/nucleo-alias.mjs` |
| `gate:hora` | toda hora visible en 12 horas y desde `src/utils/hora.js` | si toca `src/` o `supabase/functions/` | no | `scripts/hora-gate.mjs` |
| `gate:nombre` | nombre de persona por `shortEmployeeName` | si toca un `.jsx` | no | `scripts/nombre-gate.mjs` |
| `gate:nucleo` | la lógica no gana usos del navegador | si toca `src/{data,utils,store,hooks,context,constants}` | no | `scripts/nucleo-baseline.json` |
| `gate:consultas` | las pantallas no le hablan a la base (va a `src/data` o `src/hooks`) | si toca `src/views` o `src/components` | no | `scripts/consultas-gate.mjs` |
| `gate:movil` | elementos con variante móvil canónica escritos a mano | si toca `src/views` o `src/components` | no | DESIGN.md §32 |
| `gate:rutas` | direcciones en español, título de pestaña, ningún ítem del menú al 404 | si toca `App.jsx` o `moduleMap.js` | no | DESIGN.md §33 |
| `gate:app-nativa` | todo módulo tiene pantalla nativa o excepción | si toca `moduleMap.js`, `App.jsx` o `apps/mobile/pantallas.js` | no | `scripts/app-nativa-gate.mjs` |
| `gate:app-secciones` | en la app del personal, las secciones de una pantalla (`Segmentos`) van fijas arriba en `FijoArriba`, no dentro de la lista | si toca `apps/mobile/app` o `componentes` | no | `apps/mobile/componentes/FijoArriba.js` |
| `gate:app-colores` | en la app del personal, el azul de la marca y `colorSistema` se leen al pintar: ni escritos a mano ni congelados al cargar el módulo (en Android no seguirían al color del sistema) | si toca `apps/mobile/app` o `componentes` | no | `scripts/app-colores-gate.mjs` |
| `gate:tokens` | `tokens.json` igual a lo que dice `index.css`; ningún token a una variable inexistente | si toca `index.css` o `tokens.json` | no | — |
| `gate:pdf` | el PDF del Corte Z ocupa una hoja por sucursal | si toca `src/utils/corteZPrint.js` | no | — |
| (vitest `anexoColumnas`) | la forma de los anexos de Hacienda | si toca lo que los produce | no | `docs/ANEXOS-HACIENDA-2026-08-11.md` |
| `gate:design` | colores crudos, elementos nativos, vidrio y materiales a mano (ratchet contra `scripts/design-gate-baseline.json`) | no | no | skill `design-gate`, DESIGN.md §6/§14 |
| `gate:doc` | los bloques de código de DESIGN.md pasan el mismo gate que el código | no | no | `scripts/design-doc-gate.mjs` |
| `gate:borradores` | formularios de 6+ controles sin borrador | no | no | `scripts/draft-gate.mjs` |
| `gate:bundle` | librerías pesadas fuera del cierre estático de cada ruta (`PESADAS`) | no (necesita `npm run build`) | no | `scripts/bundle-gate.mjs` |
| `gate:edge` | `deno check` de `supabase/functions/` | no | no | `scripts/edge-gate.mjs` |
| `gate:ux` | ratchet del barrido de escritorio (lee su informe) | no | no | `scripts/ux-gate.mjs` |
| `gate:tipos` | consultas contra los tipos de la base; `--remoto` compara con producción | no (~20 s) | `--remoto`: sí | `scripts/tipos-baseline.json` |
| `gate:cortes` | el efectivo que entró al cajón está en el esperado de algún corte; días cerrados con efectivo sin contar | no | sí | `docs/reglas/caja-creditos-y-cierre.md` |
| `gate:receta` | el libro bajo receta ve todo lo que la norma manda; `principio_activo` faltante es deuda | no | sí | `scripts/receta-baseline.json` |

**Al cerrar** trabajo que toque consultas, índices o pantallas de consulta →
`gate:perf`; un cron, una cadencia o una función que habla con el origen →
`gate:eficiencia`; cortes, cobros o movimientos de caja → `gate:cortes`; el
libro bajo receta o el catálogo de antibióticos → `gate:receta`; el núcleo o la
base → `gate:tipos`; tema o estandarización visual → `gate:design`; una tabla,
ficha o diálogo → `gate:movil` y el barrido de la ruta
(`docs/CHECKLIST-VISTA-NUEVA.md`); una librería pesada → `npm run build` y
`gate:bundle`; una edge function → `gate:alcance` y `gate:seguridad` completos;
migraciones → `gate:migrations -- --remote`.

---

## Entorno de pruebas — probar sin miedo a producción

**Por defecto, `npm run dev` y `npm run preview` hablan con PRODUCCIÓN**: un
clic en el navegador local escribe en la base real. El otro camino:

```bash
npm run dev:staging      # el portal contra el branch de pruebas
npm run build:staging    # compilar apuntando ahí (sale a dist-staging/)
```

- Usuario **`pruebas`**, contraseña **`pruebas2026`** (Gerente General). El
  marco y la píldora «ENTORNO DE PRUEBAS» se derivan de la URL de Supabase
  (`src/entorno.js`), no de una bandera que se pueda olvidar.
- **El ref vigente: `.env.staging` (`VITE_SUPABASE_URL`) o `supabase branches list`.**
  Cambia cada vez que el branch se rehace: nunca copiarlo a un documento.
  `.env.staging` está en `.gitignore`; `npm run pruebas:env` lo reescribe (en un
  clon nuevo, además `VITE_VAPID_PUBLIC_KEY` y `VITE_GOOGLE_MAPS_API_KEY` del `.env`).
- **Se mantiene solo**: `.github/workflows/entorno-pruebas.yml` corre
  `scripts/entorno-pruebas/mantener_al_dia.mjs` todos los días a las 04:30 SV.
  Compara migraciones, aplica las que faltan y, si eso falla, lo rehace; después
  apaga los crons que llaman a producción, corre las fechas a hoy, da los
  permisos de la cuenta de pruebas y, si el ref cambió, apunta las variables
  Preview de Vercel al nuevo y recompila `dev.farmasalud.lat` (sin
  `VERCEL_TOKEN` la corrida sale en ROJO). A mano: `npm run pruebas:al-dia`, o
  «Run workflow» con `solo_vercel`. No hay que rehacerlo a mano; `reset` no
  sirve (reconstruye con la historia propia del branch).
- **Antes de creerle a una medición hecha contra el branch, comparar**:
  `node scripts/entorno-pruebas/comparar_con_produccion.mjs`.
- **Lo siembran cuatro migraciones, no-op en producción**: `20260729223031`
  (roles, sucursales, permisos), `20260729223032` (buckets y sus policies),
  `20260812160000` (productos de muestra y la cuenta de pruebas) y
  `20260903185033` (apaga los crons que llaman por HTTP). **La cuenta de pruebas
  sólo nace si la base no tiene ni un empleado** — no quitar esa guarda; la de
  los crons exige que falte `admin_invoke_secret` en el vault y ≤2 fichas. Una
  semilla que nadie necesita temprano va al final: al sembrar, la tabla tiene la
  forma de ESE punto de la historia.
- **Las edge functions NO están desplegadas ahí, a propósito**: varias escriben
  en el ERP real y transmiten a Hacienda. Si hace falta probar una sin efectos
  externos, se despliega esa sola.
- **Desde esta Mac sólo se llega por el MCP** (`execute_sql`): los branches son
  sólo IPv6 y sin pooler, y esta máquina no tiene IPv6, así que `psql`,
  `supabase db push` y `db dump` no llegan desde acá. El workflow de GitHub sí
  actualiza el branch porque usa la API de administración de Supabase, no una
  conexión directa. Memoria `reference_branches_de_supabase_son_solo_ipv6`.

Historia, mediciones y los refs que ya no existen:
`docs/reglas/entorno-de-pruebas.md`.
