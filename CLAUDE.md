# Portal Farmalasa — Claude Code Guidelines

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

**Probar primero en staging.** Existe un branch de Supabase dedicado para esto:
**`cbnjplmnfmfsambavjce`** (nombre `staging`, persistente). Para DDL sobre las
tablas calientes listadas arriba, aplicar primero ahí con `apply_migration`
apuntando a ese `project_id`, confirmar que no rompe nada, y solo entonces
aplicar a prod. Ya se usó así para 0B.8 (RPC `verify_kiosk_device`) y 0B.2
(secretos de Vault en `cron.job.command`) — ambos sin incidentes.

⚠️ **El ref cambia cada vez que se rehace el branch.** El de julio
(`ewcmerxqjvludtgskuin`) está borrado; si encontrás ese en un doc, es viejo. El
vigente sale de `supabase branches list` o del `VITE_SUPABASE_URL` de
`.env.staging`. Su esquema es **idéntico al de prod** —verificado por huella md5
de tablas, funciones, policies e índices— y trae datos de muestra, cero PII.

**Cómo levantar el portal contra ese entorno** (ver §«Entorno de pruebas» al
final de este archivo): `npm run dev:staging`.

**Una función con parámetros se mide SEIS veces, no una** (2026-08-17). Tres
trampas de planificación, las tres descubiertas midiendo `get_ventas_receta_stats`
y ninguna visible leyendo el SQL:

1. **`plpgsql` cambia al plan GENÉRICO en la sexta ejecución.** Las cinco
   primeras llamadas daban 24 ms y la sexta 1,089 ms, con los mismos argumentos.
   Sin los valores, el planificador no sabe que el rango de fechas filtra, y
   elige el plan al revés. Cuando el plan bueno depende de los ARGUMENTOS, no
   hay genérico que sirva: `ALTER FUNCTION … SET plan_cache_mode =
   'force_custom_plan'`. Cuesta ~3 ms de planificación. Una función que se
   probó una vez y anda "bien" puede estar degradada en producción desde la
   sexta llamada de cada conexión.
2. **`LANGUAGE sql` se INLINEA en quien la llama y aplana sus CTE.** Mismo
   cuerpo: 1,011 ms inlineado contra 34 ms con `PREPARE`. `plpgsql` no se
   inlinea nunca — por eso `get_ventas_con_puntos` y las gemelas de receta lo
   son. `EXECUTE` dinámico además replanifica siempre, así que tampoco sufre (1).
3. **Un `EXISTS` correlacionado fija la dirección del join.** `EXISTS (… WHERE
   ii.invoice_id = si.id …)` obliga a entrar por las 180,000 facturas del año;
   el mismo predicado como `si.id IN (SELECT ii.invoice_id …)` deja al
   planificador entrar por los 4,013 renglones. 8,471 ms → 31 ms.

Y **medir con `EXPLAIN (ANALYZE, TIMING OFF)`**: con el timing encendido, la
instrumentación de un nested loop de 3,655 vueltas inventó 1,146 ms sobre un
trabajo de 31. El número que se reporta tiene que ser el que no miente.

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

Hardening completo aplicado 2026-07-02 (`supabase/migrations/20260702_db_hardening_*`).
Advisor de seguridad en 0 ERRORES — toda tabla/función nueva debe mantenerlo así:

1. **Toda tabla nueva**: PK + `created_at timestamptz default now()` + **RLS habilitado
   con policy explícita** (mínimo `FOR SELECT TO authenticated`). NUNCA dejar una tabla
   sin RLS — `anon` no debe ver nada.
2. **Toda FK**: con índice que la cubra (`CREATE INDEX ... ON tabla(col_fk)`), excepto
   columnas de puro audit (`*_por`, `created_by`) en tablas pequeñas.
3. **Policies de escritura**: `USING (true)` está prohibido para UPDATE/DELETE
   **y `WITH CHECK (true)` para INSERT** — el INSERT es el que faltaba en esta
   regla y por ahí se colaron dos (auditoría 2026-07-30): `attendance` y
   `audit_logs` aceptan hoy cualquier fila de cualquier usuario autenticado, o
   sea que se puede fabricar una marcación y falsificar la bitácora. Una tabla
   append-only no necesita policy de DELETE, pero **sí** necesita que su INSERT
   diga quién puede escribir qué. Usar `auth_can_edit_any(ARRAY['modulo1','modulo2'])`
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

## Fichas de clientes y envío a Hacienda: un circuito automático (2026-08-09)

Detalle completo en **`docs/RETOMAR-FACTURACION-Y-DTE-2026-08-09.md`** (el del
07-08 quedó reemplazado). Lo que hay que saber antes de tocar cualquiera de sus
piezas:

**Dos crons encadenados, y el orden importa.** 21:30 SV
`sincronizar-fichas-clientes` corrige las fichas; 22:30 SV `regularizar-dte`
manda a Hacienda. Al revés, el envío recibe rechazos por datos que ya estaban
arreglados. **Y desde el 09-08 el envío cierra el lazo la MISMA noche**: llama a
la corrida de fichas en alcance «rechazos» y reenvía, en vez de esperar 24 horas.

**Esa segunda vuelta se dispara por «lo puedo escribir», NO por «accionable»**
(corregido el 2026-08-16). `dte_rechazos_vigentes.accionable` significa *Hacienda
se queja de un dato del receptor* — que no es lo mismo que *esto se arregla
solo*. Con el disparador viejo, una noche entera de las dos funciones
encadenadas no cambió un dato: los 4 rechazos eran 3 de contribuyentes (a los
que no se les escribe la ficha) y uno de un campo sin regla. Hoy se le pregunta
a `fichas_para_corregir_dte()` —la MISMA lista que usa la corrida— cuántas
filas hay con `origen='rechazo' AND puede_escribir AND NOT ya_corregido`, y
además **sólo se reenvía si la corrección escribió algo**. Mandar el mismo
documento sin cambiarle un dato es pedir el mismo rechazo.

**La tabla de decisión de `sincronizar-fichas-clientes` y la lista
`campo_ficha IN (...)` de `fichas_para_corregir_dte()` son la misma lista dicha
dos veces, y se mueven juntas.** Un campo de más deja fichas dando vueltas sin
que nadie las escriba; uno de menos las vuelve **invisibles** para el proceso
hecho para arreglarlas. Pasó con `receptor.telefono`: bien clasificado, marcado
accionable, y fuera de las dos listas — la corrida informaba «3 candidatos»
sobre 4 rechazos y nadie notaba la que faltaba. Hoy la lista es distrito,
municipio, departamento, dui y phone. **Un teléfono que falta o no tiene 8
dígitos se REEMPLAZA por el de la empresa (`23010013`), no se borra como el
DUI**: un DUI inventado sería un dato falso de identidad, y Hacienda en cambio
EXIGE un teléfono con forma — sin él el documento no entra.

**«Sin sello» significa sin sello VÁLIDO — y hay que decirlo en los TRES
sitios.** `recibido_mh` es `text` con 40 caracteres: `IS NULL` y `!!valor` dan
por buena cualquier basura. Estuvo mal en el filtro del barrido, en la guarda
previa al envío y en la cola de Pendiente MH, y los tres tenían que fallar
juntos para que una factura del 16-may-2025 pasara **un año** figurando como
confirmada. Regla del usuario: lo único que NO se manda a Hacienda es lo que ya
tiene sello y su observación es de otra cosa. Ver
[[feedback_nombre_de_columna_no_es_su_tipo]] — «el tipo manda» se aplica al
CONCEPTO, no sólo a la línea donde apareció el bug.

**Al corregir una ficha se escribe en el ERP, NO en el portal.** `regularizar-dte`
le pide al ERP que arme el DTE (`creaJsonDTe`), así que el receptor sale de la
ficha del ERP; un `UPDATE` sobre `customers` es cosmético. Las dos copias
divergen y el portal a veces muestra la buena. Y los códigos de
departamento/municipio/distrito del ERP son **por departamento**: resolver por
etiqueta y escribir en cascada — ver
[[feedback_los_codigos_de_ubicacion_del_erp_son_por_departamento]].

**`_shared/distrito.ts` es una TRADUCCIÓN verificada, no código nuevo.** El
original es `elegir_distrito` de `scripts/migracion-clientes/bloque.py`, con
25,946 decisiones reales encima, y tres de sus seis reglas se descubrieron
corrigiendo errores medidos. Se enfrentaron las dos implementaciones sobre esos
25,946 casos: **iguales, 0 distintas**. **Cualquier cambio en cualquiera de las
dos exige volver a correr `comparar_matcher.mjs`** — si no, se pierde justo lo
que la hace confiable. Y ojo: la traducción reproduce los defectos del original
a propósito (`norm()` deja espacios dobles donde había una coma, y eso cambia
qué regla gana). Mejorarlo es otra decisión y va en `bloque.py` primero.

**El cliente se liga por el número del ERP, nunca por el nombre.** El nombre
sale de cómo se escribió la factura. Medido sobre 68 duplicados reales:
normalizar acentos evita 0, alfanumérico evita 3 — el 96% son nombres
genuinamente distintos (`VAQUEZ`/`VASQUEZ`). Cuando `sync-dte-sales` no
reconoce un nombre, le pregunta al ERP a qué cliente pertenece la factura
(`reimprimir_factura.php` → `id_cliente`), con tope de 25 lecturas por corrida
y degradación al comportamiento viejo si el ERP no responde.

**Fusionar clientes BORRA una ficha y mueve su historial.** `fusionar_cliente_
duplicado` resuelve el destino desde el `erp_id` para que el llamador no pueda
elegirlo, y quien la llama agrega su propio freno: si los nombres no se parecen,
no fusiona — publica en «Por revisar» con motivo `fusion_dudosa`. Unir a dos
personas que no lo son mezcla sus historiales y no se deshace.

**El alcance de la escritura al ERP lo decide `alcance_escritura_ficha()`, en la
base** — no un `if` en la Edge Function. Tres valores, y ninguno es un booleano
a propósito: «se puede escribir» resultó ser una pregunta de grado.

| categoría | alcance | qué se le escribe |
|---|---|---|
| Consumidor, o ficha sin categoría | `todo` | la tabla de decisión completa |
| Contribuyente · Gran Contribuyente | `solo_distrito` | **sólo** el distrito, y sólo si falta |
| Extranjero, o una categoría nueva | `ninguno` | nada: sólo espejo |

La decisión del 2026-08-09 era «a los contribuyentes no se los toca, sus CCF
pueden trabarse y está aceptado». El usuario la abrió el **2026-08-16**: *«si es
contribuyente, permite editar el distrito si no está también»*.

**El distrito del contribuyente se DERIVA con el matcher, nunca con el triple
por defecto.** Es la parte que no se puede improvisar: de las 77 fichas de
contribuyente sin distrito, **15 viven fuera de Chalatenango** (San Salvador,
La Libertad, San Miguel, Sonsonate). El default habría mudado de departamento a
esas 15 — o sea, cambiado el domicilio de un documento fiscal. Las 77 tienen
departamento y municipio; lo único que falta es el distrito, así que
`elegirDistrito` lo elige DENTRO de los del municipio propio.

Consecuencia que hay que conocer: cuando la dirección no nombra ningún distrito,
el matcher elige uno **determinista** entre los del municipio (2 de los 3
primeros casos reales). Es un distrito del municipio correcto —que es lo que
Hacienda exige y lo que la ficha no tenía—, pero no es un dato averiguado. Si
alguna vez se decide que un contribuyente sólo se corrige con evidencia en la
dirección, el lugar es la rama `solo_distrito` de `sincronizar-fichas-clientes`.

Y `ninguno` es la falla segura: una categoría que nadie decidió NO se escribe.
Al revés, el día que aparezca una, el circuito le escribiría sin que nadie lo
haya resuelto.

**`identificacion.fecEmi` no es un dato del cliente** y NO se corrige: aparece
siempre que se transmite hoy una factura emitida antes, y cambiarla sería
alterar un dato fiscal. Solo las observaciones `receptor.*` son accionables.

**Las CUATRO funciones que invoca un cron van con `--no-verify-jwt`**
(`regularizar-dte`, `sincronizar-fichas-clientes`, `push-cliente-erp`,
`sync-dte-sales`). Un redeploy sin el flag las resetea y el cron empieza a
fallar con 401 **antes de ejecutar una línea** — ya pasó tres veces. Y el CLI se
traga el `.env` del repo: `mv .env .env.bak` primero (ver memoria
`reference_edge_function_deploy_workaround`).

**`aplicar-solicitud-facturacion` NO está en esa lista, aunque hasta el
2026-08-12 esta regla la incluía.** La llama el navegador con la sesión de quien
aprueba, no un cron: en producción está con `verify_jwt: true` y así funciona.
Desplegarla con el flag habría *abierto* una función que anula facturas.

La lección general: **el flag depende de QUIÉN la llama, no de a qué circuito
pertenece.** Cron o Postgres → `--no-verify-jwt` (no hay sesión que presentar, y
la función valida por su cuenta). Navegador → JWT. Y antes de cualquier
redeploy, leer el valor VIVO en vez de confiar en la lista — `list_edge_functions`
lo trae en `verify_jwt`, y ahí se vio que cuatro de las cinco coincidían y una
no.

## MIN·MAX: ABC/XYZ son SOLO clasificación (decisión, no bug)

Confirmado el 2026-07-29 (F4.3 de
`docs/planes-cerrados/PLAN-MINMAX-Y-CANDADO-2026-07-29.md`): en
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

## REGLA CRÍTICA: el teléfono no es la pantalla chica (canon móvil, 2026-08-21)

Nació de un reporte de una línea —*«en facturas de compra cuando abro una card me
da información, pero muy reducida, no puedo ver los productos, no puedo ver el
pdf»*— que resultó ser **16 de las 59 tablas del portal, el 27%**. El canon
completo vive en **DESIGN.md §32.8 y §32.9**; el plan y lo que queda abierto, en
`docs/PLAN-MOVIL-2026-08-20.md`. Acá va lo que hay que saber ANTES de tocar una
vista.

**El modo de falla es el SILENCIO.** No hay error, no falta ninguna fila, y en
escritorio todo funciona. Por eso estos defectos viven meses: sólo se ven con el
teléfono en la mano, y el que lo tiene en la mano no reporta «el `onClick` no se
declaró», reporta «no me deja ver nada».

### Lo que `DataTable` no puede adivinar, y por eso lo declara la vista

En el teléfono `DataTable` **no pinta una tabla: pinta fichas**. Desde afuera un
`onClick` es una caja cerrada —no se sabe si navega o si expande un `<tr>`—, así
que el default es su hoja genérica y la vista declara el resto:

| prop | cuándo |
|---|---|
| `usarAccionDeFila: true` | la fila tiene un destino de verdad (un modal, una navegación). **Sin esto la hoja genérica le GANA al destino real.** |
| `apilada: true` | la primera celda no es un nombre sino un BLOQUE escrito para una columna. Medido en Mín·Máx: 105px recortados por ficha; en el libro de compras, 161px. |
| `acciones: 'mantener'` | la fila tiene acciones. Van detrás de mantener presionado (§32.7), no en una tira. |
| `acciones: true` | igual, pero como tira visible. Sólo con una o dos acciones. |
| `movil={false}` | **la fila no es un registro** (una matriz, un calendario). Exige motivo escrito arriba. |

**Un detalle que se olvida y rompe:** si el `onClick` expande un `<tr colSpan>`,
declarar `usarAccionDeFila` no alcanza — ese `<tr>` no se pinta en modo ficha. El
destino ahí es **`ExpedienteMovil`**, con el cuerpo del detalle escrito UNA vez
(prop `comoPanel`) y la expansión de escritorio apagada con `!enTelefono`. El
corte del teléfono sale de `useExpedienteMovil` y **nunca de un `useMediaQuery`
propio**: si divergen, hay un ancho donde la fila es ficha y el detalle intenta
expandirse dentro de una tabla que ya no está.

Y una celda de acciones **cambia de forma sola**: `useEnHojaDeAcciones()`
(`components/common/hojaDeAcciones.js`) le dice que está en la hoja, y ahí un
`Button` con `iconOnly` recupera su rótulo desde `title`. Se resolvió con
contexto y no con una prop porque una prop obligaría a rendir la celda dos veces.

### Las otras cuatro reglas del teléfono

1. **El blanco de dedo son 44pt.** `min-h-[var(--tap-min)]` / `min-w-[...]`, que
   vale **0 en escritorio** y no cambia nada ahí. Cuando el tamaño **ES el
   dato** —una barra apilada, donde el ancho codifica la proporción— estirarlo
   sería mentir: se declara `data-medida="dato"` y el barrido lo saltea.
2. **El toque tiene que ACUSAR recibo.** No hay cursor ni hover: el acuse es la
   única señal de que entró. Vale `active:scale-[0.97]` o `data-interactive`,
   que ya pone `clickable()`.
3. **Las áreas seguras van por `--sa-top/right/bottom/left`**, nunca `env()`
   escrito a mano. Con el token, una prueba puede pisarlo y **medir** si el
   marco se corre; con `env()` a mano no hay forma de distinguir el shell que
   respeta el notch del que lo ignora, porque en todo emulador vale 0. `max()`
   sólo si el inset es el ÚNICO relleno.
4. **Un formulario largo guarda borrador** — ver `gate:borradores` en
   Estándares. Y si lo que se puede perder vive en un store, **el store es el
   que tiene que persistir**: componer un traslado a tres salas se perdía entero
   porque el store era memoria pura y la sesión se cierra sola a los 5 minutos.

### Cómo se verifica, y por qué son TRES capas

- **`npm run gate:movil`** — lee el fuente. Bloqueante en cero.
- **`tests/e2e/barrido-total-movil.spec.js`** — 54 rutas en WebKit iPhone 13.
  `ORIENTACION=acostado` para la otra mitad. Correr **por tandas**.
- **`tests/e2e/dialogos-movil.spec.js`** — abre los diálogos y los mide. Corre
  contra producción, así que tiene lista de freno: **abrir no puede escribir**.

Las tres, porque **ninguna ve lo que ve la otra**. El gate lee el fuente, y una
fila envuelta en `memo(EmployeeRow)` es una caja cerrada: quitándole
`usarAccionDeFila` a Personal el gate da **verde con 0 hallazgos** y el barrido
dice **25**. Eso lo cierra `data-destino`, que `Ficha` estampa en el DOM porque
en tiempo de render sí sabe la respuesta.

### La lección que se repitió SEIS veces, y es la más cara

> **En esta tanda, seis de los hallazgos no estaban en el portal sino en cómo se
> leía la medición.**

El informe parcial se llamaba igual que uno completo. El detector de acuse
acusaba a 36 tarjetas que hacían lo correcto y tapaba al único botón mudo. La
regla de tamaño contaba hijos `absolute` como hermanos del flex. El resumen no
contaba tres dimensiones que sí medía. El detector de desborde miraba la caja
propia y no el borde visible. Y el barrido de diálogos reportaba «no abrió» sobre
botones que nunca apretó.

**Antes de creerle un cero a un instrumento, fabricarle la regresión que debería
cazar.** Y antes de creerle un número grande, abrir tres casos a mano: acusar al
que hizo bien el trabajo es cómo un gate se termina desactivando.

---

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

**Al bumpear `APP_VERSION`: `npm run version:bump -- patch|minor|major "Título"`.**
Lee la versión, la sube y deja la entrada empezada en `CHANGELOG.md` de una
sola pasada, y **relee justo antes de escribir** por si otra sesión se llevó ese
número en el medio (pasó tres veces en una sola sesión el 2026-08-01). Nunca
asumir "el anterior + 1", y nunca editar `src/version.js` a mano.

**La entrada del changelog va en `CHANGELOG.md`, NUNCA en `src/version.js`.**
Ese archivo tiene la constante y nada más. La regla vieja —"las últimas 6
entradas en `version.js`"— se rompió sola: nada la verificaba, así que 164 de
268 entradas nunca llegaron a `CHANGELOG.md` y el archivo volvió a 7,330 líneas
en tres semanas. Pero el motivo de fondo no es el peso: con varias sesiones,
todas escribían el mismo bloque al tope del mismo archivo y colisionaban
siempre. Hoy `version-gate` exige las tres cosas — que `version.js` no tenga
entradas, que la versión suba, y que `## v<versión>` exista en `CHANGELOG.md`
**y esté preparado en el mismo commit**.

**Para trabajo largo o riesgoso, un árbol propio**: `npm run worktree -- <nombre>`
crea el worktree en `../Portal-Farmalasa-<nombre>` sobre la rama
`sesion/<nombre>`, con `node_modules` enlazado y `.env` copiado. Deja de
compartir archivos, índice y `dist/`. El costo es que hay que mergear a `main`
en vez de pushear directo, así que para un arreglo corto no vale la pena.

**El preview de QA es uno solo.** Las edge functions solo aceptan CORS de
`http://localhost:4173`, así que **una sesión a la vez** puede tenerlo
levantado; `npm run preview` lleva `--strictPort` para que un puerto ocupado
falle claro en vez de moverse solo y producir un "error de CORS" que parece otra
cosa. Para compilar sin pisar el `dist/` de otra sesión: `OUT_DIR=dist-<nombre>
npm run build`.

**El hook de pre-commit** (`.githooks/pre-commit`, se habilita una vez por clon con
`npm run hooks:install`) cubre el caso mecánico: **bloquea el commit si un archivo
está preparado y además modificado después de prepararlo** — señal de que alguien
lo siguió editando y el commit se llevaría una foto parcial. Además lista lo que
queda fuera del commit, corre `version-gate` siempre y `migration-gate` cuando el
commit toca `supabase/migrations`. `git commit --no-verify` lo saltea: es para una
emergencia real, no para silenciar un hallazgo.

## REGLA CRÍTICA: lo que ya se auditó no se toca sin preguntar (2026-08-23)

El portal está repartido en **25 áreas** (`auditoria/areas.mjs`) y cada una lleva
un % sobre **12 ejes**. Un área que llega a 100 y tiene su sello de sala queda
**CONGELADA**: `npm run gate:auditoria --hook` corre en el pre-commit y **falla**
si el commit la toca.

**Antes de tocar un área congelada: preguntarle al usuario.** No es una
formalidad del gate — es literalmente lo que pidió. Después:

```bash
npm run auditoria:desbloquear -- <area> "por qué se toca"
# … el trabajo …
npm run auditoria:sellar -- <area> "qué se corrió para verificarlo"
```

Mientras el desbloqueo esté abierto, `npm run gate:auditoria` (sin `--hook`)
**falla**. Ésa es la mitad «verificación después»: el commit puntual pasa, el
trabajo no se cierra. Son dos chequeos y no uno a propósito — uno que bloquea
cada commit del trabajo en curso enseña a escribir `--no-verify`, y uno que sólo
avisa se olvida el día que hay prisa.

**El % no se escribe a mano.** Sale de `auditoria/puntuar.mjs`, que tiene las
reglas del cálculo adentro. El gate rechaza un `pct` que no derive de los ejes,
y rechaza un eje en 90 o más **sin evidencia escrita** — un puntaje sin
evidencia es una opinión, y una opinión se hereda de la sesión anterior sin que
nadie pueda volver a mirarla.

**El sello de sala es un TOPE, no un sumando.** Doce ejes en verde topan en 95;
el 100 lo desbloquea una corrida real con datos de producción. Si fuera un
sumando, un área podría compensar la falta de prueba real con puntaje de otro
lado — que es exactamente la confusión entre «construido» y «funciona». Hoy hay
catorce ítems en memoria que dicen «falta probarlo en sala».

**Un archivo, tabla, función o cron sin área hace fallar el gate.** No es
contabilidad: lo que no está mapeado no entra en ningún porcentaje, y el día que
alguien agregue una vista sin mapearla el portal diría «88% auditado» sobre un
denominador viejo. Al crear una vista o una tabla, agregarla a `areas.mjs`.

El informe completo —los 221 hallazgos, qué está bien, y las tres veces que el
instrumento mintió antes de acertar— en `docs/AUDITORIA-PORTAL-2026-08-23.md`.

---

## Estándares del proyecto
- Ver `DESIGN.md` para patrones de UI (glassmorphism, filter pills, tabs, search)
- Siempre usar `LiquidSelect` en lugar de `<select>` nativo
- Badges `es_antibiotico=true` → "Bajo Receta" (NUNCA "Abx")
- Toda acción de usuario → `appendAuditLog` (staffStore → `audit_logs`)
- **Impresión en ticketera: `await imprimirDocumento(ticket)` de
  `src/utils/ticketPrint.js`**, y nada más — intenta el envío sin diálogo y cae al
  diálogo del navegador si esta computadora no lo tiene. **No elegir el camino a
  mano ni escribir un segundo maquetador.** El ancho del rollo NO se pasa: es un
  ajuste de la computadora (`leerAjustesDeImpresion`), porque la ticketera está
  enchufada a un equipo concreto. `ok: true` significa *recibido*, nunca *salió
  papel*: la respuesta del programa de la caja es opaca y no se puede prometer en
  pantalla lo que no se sabe. Cuatro cosas que se rompen solas: **sólo ASCII** (el
  rollo no lee UTF-8 — «NUÑEZ» salió `NUÆEZ`), **54 columnas** en letra chica y 40
  en normal, **alinear rellenando y nunca con `ESC a`** (sus códigos no mandan en
  esa impresora), y **el papel no tiene tema** — sólo negro, sin fondos rellenos,
  sin tokens ni `rounded-*`. La receta completa, campo por campo, en la §5 de
  `docs/IMPRESION-EN-TICKETERA-2026-08-13.md`; la geometría está anclada en
  `tests/unit/ticketPrint.test.js` contra un ticket real. Prueba de papel en
  Sistema → Prueba de impresión.
- Bumpar la versión en cada commit con `npm run version:bump` (la entrada del
  changelog va en `CHANGELOG.md`, nunca en `src/version.js`)
- **Un formulario largo se guarda solo: `npm run gate:borradores`.** El portal
  cierra la sesión sola cuando nadie usa la pantalla, y desde v2.647.0 ese plazo
  se configura por cargo (los de sala están en 5 minutos). Un formulario vive en
  memoria: cuando la sesión se cierra se pierde todo lo escrito y no queda
  rastro. El aviso «¿Sigues ahí?» evita la SORPRESA, no la PÉRDIDA — nadie
  vuelve a tiempo si se fue diez minutos. A partir de **6 controles de captura**,
  el archivo guarda borrador con `saveDraft`/`loadDraft` de
  `src/utils/draftUtils.js`, o va a `EXCEPCIONES` de `scripts/draft-gate.mjs`
  **con su motivo escrito** (el único que hay hoy: el conteo cíclico, que guarda
  renglón por renglón). El baseline es la deuda del día que se escribió el gate
  y **sólo baja**: no se regenera para tapar un hallazgo nuevo.
- **La pestaña activa de una vista vive en la DIRECCIÓN, nunca en `useState`.**
  El hook canónico es `usePestanaEnUrl` (`src/hooks/usePestanaEnUrl.js`) y vale
  también para las vistas nuevas. Una pestaña en memoria se pierde con cualquier
  recarga: F5 —o volver por el historial, o abrir el enlace que alguien pasó—
  devuelve a la primera sin decir nada, y como no falla nada nadie lo reporta
  como bug sino como «la pantalla se movió sola». Medido el 2026-08-20: de las
  29 vistas con pestañas, **9 lo hacían bien y 20 no**. Lo vigila la categoría
  `pestana-fuera-de-la-url` de `npm run gate:design`, bloqueante en cero. El
  detalle —por qué valida contra las pestañas visibles y no contra la lista
  entera, y cuándo se REEMPLAZA en vez de empujar al historial— en DESIGN.md
  §14 · ViewTabBar.
- **Antes de cerrar trabajo que toque consultas, índices o pantallas de
  consulta: `npm run gate:perf`.** Mide contra producción. Nació el 2026-08-18,
  después de que un reporte de sala («al buscar se traba») destapara **siete**
  problemas de velocidad que llevaban meses vivos: un buscador que salía con la
  primera tecla y traía 16,722 filas, un `Parallel Seq Scan` de 775,868 filas
  para devolver 30, una vista que normalizaba fila por fila **dos veces**, la
  tabla más grande de la base sin VACUUM programado, y tres índices que faltaban.
  Ninguno dio error, ninguno apareció en un log, ninguno falló un gate — porque
  no había ninguno que midiera velocidad. **Se enteró un usuario antes que el
  repo.**

  Tiene cuatro secciones y sólo una mira el reloj: constantes del código,
  existencia de índices/columnas/crons, **forma del plan** (`EXPLAIN` sin
  `ANALYZE`, determinista: ¿entra por índice o barre?) y recién después los
  tiempos. La protección real es la estructural — los tiempos contra producción
  compartida son ruidosos, así que sus techos están ~5× sobre lo medido a
  propósito: vigilan que algo no vuelva a costar 700 ms, no que baje de 10 a 8.
  Un gate que falla al azar se termina ignorando.

  **El presupuesto NO se sube para que calle.** `--update-baseline` sólo BAJA
  números, después de una mejora medida. En el hook de pre-commit corre sólo la
  sección local (`--hook`), y únicamente si el commit toca los tres archivos
  donde viven esas constantes: un gate de commit que necesita red falla sin
  conexión y enseña a usar `--no-verify`.
- **Antes de cerrar trabajo que agregue un cron, cambie una cadencia o toque una
  edge function que habla con el sistema de origen: `npm run gate:eficiencia`.**
  Nació el 2026-08-20 preguntándose si un barrido nuevo saturaba el sistema:
  era 1 disparo al día, y el que pedía de verdad era la vigilancia de los cortes
  —2.863 disparos, 13 peticiones cada uno, ~25.000 al día— que llevaba semanas
  así sin que nadie lo mirara, porque **la cadencia vive en producción y el
  costo por corrida vive en el código, y nada los juntaba**.

  No mide velocidad (eso es `gate:perf`): mide **volumen y silencio**. Su
  manifiesto `CRONS` declara, por cron, cuántas peticiones cuesta una corrida
  **con su motivo escrito**; el gate suma peticiones/día contra el baseline
  —que **sólo baja**—, y contra producción comprueba que ningún cron esté sin
  declarar, que ninguna cadencia se haya apretado, que lo declarado siga vivo
  (`backup-critical-tables` estuvo 17 días muerto) y que las llamadas salientes
  contesten 200 (un redeploy sin `--no-verify-jwt` las deja en 401 **antes de
  ejecutar una línea**, y ya pasó tres veces).

  Un cron que falla se mide por **tasa, no por tropiezo**: un `job startup
  timeout` suelto es un aviso, el 5% es rojo. Y un cron nuevo se mide antes de
  entrar: `sistema: null` es deuda declarada, no un número inventado.
- **Antes de cerrar trabajo que toque una tabla, una ficha o un diálogo:
  `npm run gate:movil`** (bloqueante en cero) y el barrido de la ruta que
  tocaste. El canon completo está arriba, en «el teléfono no es la pantalla
  chica»: lo que hay que recordar acá es que **un gate en verde no dice que la
  vista se vea bien** — lee el fuente, y hay filas que desde el fuente son una
  caja cerrada. Eso lo cierra el barrido, y las dos capas juntas no cubren los
  diálogos: ésos los abre `dialogos-movil`.
- **Antes de cerrar cualquier trabajo de tema/estandarización visual (colores
  crudos, elementos nativos del navegador), correr `npm run gate:design`.**
  Debe pasar en verde — las excepciones legítimas viven en
  `scripts/design-gate.mjs` (const `EXCEPTIONS`) y en `DESIGN.md` §6/§14. Este
  gate reemplaza los regex ad-hoc de sesiones anteriores que se perdían y
  dejaban huecos reales sin detectar (ver
  `docs/planes-cerrados/AUDITORIA-TEMA-2026-07.md` y memoria
  `project_theme_audit_2026_07_22`).

  **Nunca regenerar el baseline para tapar un hallazgo nuevo** — si una
  categoría subió, es código nuevo que hay que arreglar. El ratchet, el estado
  de las 47 categorías y cuándo sí se regenera: skill **`design-gate`**.

  **El baseline volvió a estar VACÍO el 2026-08-06**: las 47 categorías en cero
  y bloqueantes. Empezó ese día con tres —`vidrio-a-mano` (135),
  `material-a-mano` (18), `carril-pildora` (15)— y las tres se bajaron con la
  receta de §20 de `docs/planes-cerrados/PLAN-MATERIALES-2026-08-02.md`.
  O sea que hoy **cualquier hallazgo nuevo falla el gate**, no suma al ratchet.

---

## Entorno de pruebas — probar sin miedo a producción (2026-08-12)

**Por defecto, `npm run dev` y `npm run preview` hablan con PRODUCCIÓN.** El
`.env` del repo apunta al proyecto real, así que cualquier clic en el navegador
local escribe en la base de la que vive la empresa. Eso no cambió: lo que se
agregó es un segundo camino.

```bash
npm run dev:staging      # el portal contra el branch de pruebas
npm run build:staging    # compilar apuntando ahí (sale a dist-staging/)
```

Usuario **`pruebas`**, contraseña **`pruebas2026`** (rol Gerente General). El
portal pinta un marco y una píldora «ENTORNO DE PRUEBAS» — **derivados de la URL
de Supabase**, no de una bandera aparte: una bandera se olvida al armar un
`.env` nuevo, y olvidarla significa creerse en pruebas mientras se escribe en
producción. El aviso vive fuera de `<Routes>` para aparecer también en el login,
antes de que alguien escriba una credencial. Lógica en `src/entorno.js`.

**`.env.staging` está en `.gitignore`** (patrón `.env.*`), así que en un clon
nuevo hay que crearlo: `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` del branch
—panel de Supabase, o `supabase branches list`— más `VITE_VAPID_PUBLIC_KEY` y
`VITE_GOOGLE_MAPS_API_KEY` copiadas del `.env`.

### El branch se construye solo

Para uno limpio: borrarlo y crearlo de nuevo. Sale con el esquema completo,
sembrado y con la cuenta puesta. Lo hacen tres migraciones, **las tres no-op en
producción** (verificado ejecutándolas contra prod y comparando conteos):

| migración | qué siembra | por qué en esa posición |
|---|---|---|
| `20260729223031` | `roles`, `branches`, `role_permissions` | 25 migraciones insertan permisos con `role_id` fijos; sin las filas, la FK corta el replay |
| `20260729223032` | los 9 buckets de Storage y sus policies | se crearon desde el panel, no por migración: un `ALTER POLICY` no encontraba qué alterar |
| `20260812160000` | 300 productos con existencias, precios, MIN·MAX + la cuenta de pruebas | va al final: nada depende de productos, y ahí las tablas ya tienen su forma definitiva |

**La cuenta de pruebas sólo nace si la base no tiene ni un empleado.** Es lo
único que separa «sembrar un branch» de «abrir un Gerente General en la base
real». No quitar esa guarda.

**Al sembrar temprano, la tabla tiene la forma de ESE punto de la historia, no
la de hoy.** Sembrar `role_permissions` con `scope='MINE'` abortó el replay
entero: ese valor lo acepta un CHECK de agosto. Por eso las semillas que nadie
necesita van al final.

### Las edge functions NO están desplegadas ahí, a propósito

Cinco (`sync-dte-sales`, `regularizar-dte`, `push-cliente-erp`,
`sincronizar-fichas-clientes`, `aplicar-solicitud-facturacion`) escriben en el
ERP real y transmiten a Hacienda. Con credenciales de producción convertirían el
entorno seguro en uno capaz de tocar el sistema real. El login por usuario **no
las necesita** (verificado). Si hace falta probar una sin efectos externos, se
despliega esa sola.

### A los branches sólo se llega por el MCP

Sus bases son **solo IPv6 y sin entrada en el pooler**, y esta máquina no tiene
IPv6: ni `psql`, ni `supabase db push`, ni `db dump` llegan. El único canal es
`execute_sql`/`apply_migration`. Para mover SQL grande sin gastarlo en contexto:
generarlo en prod y escribirlo a disco con
`supabase db query --linked -o json | node -e '...' > archivo`, meterlo en
`schema_migrations` con SQL server-side, y **crear el branch de nuevo** — lo
replica solo. Detalle en la memoria `reference_branches_de_supabase_son_solo_ipv6`.
