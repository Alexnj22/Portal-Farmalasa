# Auditoría Supabase — 2026-07-29

**Proyecto**: `sacecdkdmsdvgqnrsett` (Farmalasa) · Postgres 17.6.1 · región us-east-1 · plan **Pro**
**Contexto**: el portal se convertirá en el sistema de ventas de la cadena, reemplazando el ERP de terceros.

**Inventario**: 106 tablas · 10 vistas · 3 vistas materializadas · 165 funciones · 234 policies · 364 índices · 51 cron jobs · 35 edge functions · 1,463 MB · 92 usuarios auth.

---

## Veredicto en una línea

La base está **bien fundamentada en lo estructural** (numeric para dinero, RLS en las 106 tablas, vistas invoker, FKs, historial append-only) pero tiene **una fuga de datos activa**, **21 tablas con escritura abierta**, y **~45% del CPU quemado en trabajo inútil**. Nada de eso obliga a cambiar de proveedor: obliga a arreglarlo antes de mover ventas acá.

---

# 1. Seguridad

## 🔴 S1 — `employees` es legible SIN autenticación (CRÍTICO, activo hoy)

La policy `employees_select` está definida con `roles = null`, que en Postgres significa **`TO PUBLIC`** — aplica a `anon`. Su única condición es `USING (NOT is_su)`, sin ningún gate de autenticación.

Verificado contra la API REST pública, usando solo la anon key (que está en el bundle JS del frontend, o sea es pública por diseño):

```
GET /rest/v1/employees?select=id&limit=0
→ HTTP/2 206
→ content-range: */50
```

**50 filas de empleados accesibles por cualquiera en internet.** Columnas con dato real hoy:

| columna | filas con dato | impacto |
|---|---|---|
| `kiosk_pin` | **46 / 50** | 🔴 credencial del kiosco de marcaje |
| `chronic_conditions` | 50 | dato de salud |
| `dui` | 4 | documento de identidad |
| `phone` | 3 | PII |
| `birth_date` | 2 | PII |
| `address` | 1 | PII |
| `email` | 1 | PII |

`base_salary`, `account_number`, `bank_name`, `isss_number`, `afp_number` están **vacías hoy** — pero son seleccionables. El día que se cargue planilla, se filtran solas sin que nadie toque una línea de código.

**Lo más grave son los 46 `kiosk_pin`.** No es privacidad, es autenticación: con esos PINs cualquiera marca entrada/salida como cualquier empleado. Y el esquema del PIN es débil de origen — `SHA-256(code) → base64 → 8 chars`, sin secreto: quien conoce el código del empleado deriva el PIN aunque se tape la fuga.

`employees_safe` hereda el problema completo (es `security_invoker=true` sobre la misma tabla).

**✅ APLICADO 2026-07-29** — migración `20260729_close_employees_anon_read`. Verificado
contra la API pública: pasó de `HTTP 206 · content-range: */50` a `*/0`, y
`?select=kiosk_pin` devuelve `[]`. `authenticated` sigue viendo las 50 filas.
Se corrigieron también `employees_update` y `employees_delete` (mismo defecto
`TO PUBLIC`, fallaban cerrado por accidente).

### S1-bis — El PIN no es una credencial (ABIERTO, decisión pendiente)

Cerrar la fuga a `anon` **no resuelve el problema de fondo**. Tres hallazgos
encadenados:

1. **Cualquier autenticado puede dumpear los 46 PINs.** `GET /rest/v1/employees?select=kiosk_pin`
   los devuelve a cualquier empleado con acceso al portal. El permiso
   `kiosk_pin/can_view` solo oculta el dato en la UI — RLS es por fila, no por
   columna.
2. **El PIN es una función determinista del `code`, sin secreto**
   (`EmployeeFormModal.jsx:209`): `SHA-256(code) → base64 → alfanum → UPPER → 8 chars`.
   Quien conoce el código de un empleado —el identificador visible en todo el
   portal— deriva su PIN con una línea de JS. Rotar los PINs con el mismo
   algoritmo no cambiaría nada.
3. **`get_kiosk_boot_payload` reparte los PINs en claro al rol `anon`**, con solo
   un `device_id` + `device_token`. La comparación es client-side
   (`useTimeClockEngine.js:735`) y los PINs de supervisores se cachean en
   `localStorage` (`kiosk_supervisor_pins`). Cada tablet tiene los PINs de su
   sucursal en texto plano, en memoria y en disco.

**Decisión tomada**: PIN aleatorio + hash en BD, verificación por RPC
SECURITY DEFINER (no derivado del código, mostrado una sola vez).

**Bloqueado por tres restricciones acopladas que hay que resolver antes de
implementar**:

- **Offline**: el kiosco marca sin red por diseño (`kioskConfig.offline`,
  ventana de gracia en `verifyDevice`). Verificación solo por RPC = sucursal sin
  marcaje durante una caída de internet.
- **Costo de bcrypt con lookup por PIN**: hoy el PIN identifica *y* prueba. Con
  hash lento hay que probarlo contra los ~50 empleados de la sucursal
  (~50 × 80 ms ≈ 4 s por marcaje). La salida estándar —identificarse por carné
  primero y validar un solo hash— cambia la UX del kiosco.
- **Boot payload**: mientras siga mandando PINs a `anon`, el hash en BD no
  aporta nada.

El credential store correcto es una tabla aparte (`kiosk_credentials`), **no** una
columna en `employees` — así no se rompe el `select('*')` de `data/system.js:37`
ni hay que hacer grants por columna, y el hash queda fuera de `employees_safe`
a propósito (excepción deliberada a la regla de paridad de columnas).

### 🔴 S1-ter — La autorización de excepciones de planilla no tiene ningún secreto

Peor que la fuga de PINs, porque tiene impacto directo en lo que se paga.

Los **tres** caminos de autorización del kiosco son derivables sin conocer nada:

```js
// src/utils/helpers.js:180 — el "PIN por hora" que autoriza horas extra
getHourlyCode   = () => Math.sin((año*365)+(día*31)+(mes*12)+(hora*60)) → 4 dígitos
getSuPinSuffix  = () => Math.sin(seed + 1337)                          → 2 dígitos
// tercer camino: kiosk_pin personal del supervisor = SHA-256(code)
```

Son funciones deterministas del reloj, calculadas **en el navegador**, y la
comparación también es client-side (`useTimeClockEngine.js:745`). Cualquiera que
abra el bundle JS —que es público— calcula el código de la hora actual y
**se autoriza sus propias horas extra**. No hay verificación de servidor en
ningún punto del flujo.

Las reglas que esto protege están bien definidas en
`src/utils/timeClock.helpers.js:130-259` — el PIN se pide solo en los 6 casos que
afectan planilla:

| caso | `authType` | condición |
|---|---|---|
| Salida especial | `SPECIAL_OUT_REQUEST` | salir con turno activo |
| Entrada en día libre | `IN_EXTRA` | `config.isOffDay` |
| Entrada anticipada | `IN_EARLY` | más de 30 min antes de `expectedIn` |
| Entrada post-turno | `IN_AFTER_SHIFT` | después de `shiftEndD` |
| Salida tardía | `OUT_LATE` | más de 15 min después de `shiftEndD` |
| Entrada extra | `IN_EXTRA` | tras `OUT` / `OUT_EXTRA` |

Todo lo demás va sin PIN, incluidos los ajustes automáticos de ±30/15 min. La
regla es sensata; lo que falla es que la credencial que la protege no es secreta.

**El código horario debe reemplazarse por uno generado en el servidor** que el
supervisor consulte desde el portal — así se preserva el flujo operativo de
"llamo al jefe y me da el código" pero con un secreto real detrás.

---

## Estado del rediseño de credenciales del kiosco

| fase | qué | estado |
|---|---|---|
| 1 | `kiosk_credentials` (hash bcrypt) + `kiosk_pin_attempts` (rate limit) + RPC `verify_kiosk_pin` / `set_kiosk_pin` + revoke de grants | ✅ **aplicado** |
| 4 | Código horario server-side: pepper en Vault, `get_kiosk_auth_code`, `verify_kiosk_authorization` | ✅ **aplicado** |
| 2 | Cutover del frontend: verificación por RPC, ventana de gracia offline, `kiosk_pin` fuera del boot payload y del `localStorage` | ✅ **aplicado** |
| 3 | Rotación: PIN aleatorio real, mostrado una vez, repartido a los 46 | 🚫 **bloqueado** — ver abajo |
| 5 | `DROP COLUMN employees.kiosk_pin` una vez que nada lo lea | bloqueado por la 3 |

### 🚫 Por qué la Fase 3 está bloqueada

`EmployeeFormModal.jsx:2125` dice, debajo del PIN:

> *"Este es el valor del código de barras del carné."*

Si eso es literal, el `kiosk_pin` **va impreso como código de barras en el carné
físico**, y entonces rotar los PIN no cuesta "avisarle a 46 personas": cuesta
**reimprimir 46 carnés**.

Pero contradice al propio kiosco, que identifica al empleado comparando el
escaneo contra `employees.code` y **nunca** contra `kiosk_pin`
(`useTimeClockEngine.js:890`). Si el código de barras fuera el PIN, ningún carné
haría match y el marcaje no funcionaría — y funciona en producción todos los
días. Así que lo más probable es que el barcode lleve el `code` y esa leyenda
esté vieja.

`ApoioScanModal` agrega ruido: su mensaje de error habla de "carnet" pero busca
por `kiosk_pin` (`data/pedidos.js`). Se dejó aceptando **ambos** —estrictamente
más permisivo, no puede romper lo que hoy anda— justamente porque no se pudo
resolver la ambigüedad leyendo el código.

**Qué hace falta para desbloquear**: mirar un carné físico y confirmar qué
número lleva el código de barras. Es un dato del mundo real, no del repositorio,
y de él dependen tanto el costo de la rotación como si se puede borrar la
columna.

### Lo que ya NO puede pasar (verificado)

- El boot payload no reparte PIN: `get_kiosk_boot_payload` pasó de 2 referencias
  a `kiosk_pin` a **0**.
- Las tablets no guardan credenciales: `kiosk_supervisor_pins` se borra del
  `localStorage`; la ventana de gracia (`utils/kioskGrace.js`) solo persiste ids
  y fechas.
- La autorización no se puede falsificar desde el cliente: se verifica en
  `verify_kiosk_authorization`, con rate limit de 10 fallos / 5 min por
  dispositivo.
- El código de autorización ya no es adivinable: HMAC con pepper de Vault, rota
  cada hora, y **es distinto por sucursal** — uno de La Popular no autoriza en
  La Salud.
- `audit_logs` ya no guarda el valor tecleado en un intento fallido (era legible
  por cualquier autenticado); guarda solo su longitud y el motivo.

Probado contra un dispositivo de kiosco de prueba creado y borrado en el mismo
statement: código correcto → `ok=true HOURLY_CODE`; código de la hora anterior →
aceptado (tolerancia de borde); código inventado → rechazado; código de otra
sucursal → rechazado; token inválido → excepción. La primera corrida encontró un
bug real de shadowing en PL/pgSQL (`record "r" is not assigned yet`) que habría
hecho fallar **toda** autorización de excepción en producción.

### Deuda conocida que queda

`getHourlyCode()` sigue vivo en `helpers.js`, pero **solo** para la llave maestra
que abre el configurador del kiosco (`${código}geofls`). Ese flujo corre en
tablets todavía sin vincular, donde no hay `device_token` contra el cual
validar, así que no se puede mover al servidor con el mismo mecanismo. Sigue
siendo derivable desde el bundle público. Está acotado y anotado en el propio
`helpers.js`; hay que resolverlo aparte.

**Fase 1 verificada**: 46 hashes generados, los 46 validan contra su PIN actual
(round-trip bcrypt OK), device falso rechazado con `KIOSK_DEVICE_INVALID`, y la
API pública responde `permission denied for table kiosk_credentials`.
Es **aditiva**: el kiosco sigue funcionando igual hasta la Fase 2.

Decisiones tomadas para las fases siguientes:
- **Identidad**: carné primero, PIN solo confirma (1 comparación bcrypt, ~80 ms).
- **Offline**: híbrido — ventana de gracia por empleado/dispositivo (la tablet
  guarda solo IDs y fechas, cero material del PIN); quien nunca marcó en ese
  kiosco cae en estado `PENDIENTE` y recibe notificación al confirmarse.
  El marcaje offline **nunca se muestra como OK** hasta verificarse.

## 🔴 S2 — 21 tablas con escritura abierta a cualquier autenticado

30 policies con `USING (true)` / `WITH CHECK (true)`. El hardening del 2026-07-02 cubrió las **lecturas** con `auth_can_edit_any` / `auth_has_module_permission`, pero dejó INSERT/UPDATE en `true`. Cualquier empleado con el rol más bajo puede:

| tabla | operación abierta | consecuencia |
|---|---|---|
| `audit_logs` | INSERT | 🔴 **falsificar la bitácora** — rompe la no-repudiación de todo el sistema de auditoría |
| `roles` | INSERT + UPDATE | 🔴 crear o modificar roles (escalada de privilegios vía datos) |
| `products` | UPDATE | modificar el catálogo maestro |
| `kiosk_devices` | INSERT + UPDATE | registrar un dispositivo kiosco propio |
| `timesheets` | UPDATE | alterar horas trabajadas propias o ajenas |
| `employee_events` | INSERT + UPDATE | alterar el expediente laboral |
| `attendance`, `holidays`, `shifts`, `schedule_coverage` | INSERT/UPDATE/ALL | |
| `branch_expenses`, `branch_documents`, `employee_documents` | INSERT/UPDATE | |
| `survey_responses`, `ventas_perdidas`, `vacation_plan_headers` | INSERT/UPDATE | |
| `product_locations` | ALL | |
| `sales_payment_confirmations`, `education_catalog_entries`, `user_dashboard_prefs` | INSERT/UPDATE | |

`audit_logs` y `roles` son las dos que hay que cerrar hoy. Las demás pueden ir por lotes.

## 🟠 S3 — Policies `TO PUBLIC` que solo fallan cerrado por accidente

`sales_invoices_select`, `employees_update`, `employees_delete`, y las de `pedidos`, `payroll_entries`, `branch_hourly_sales` también son `TO PUBLIC`. **Hoy no filtran** — pero no por diseño: filtran porque `anon` no tiene `EXECUTE` sobre `auth_has_module_permission`, así que la consulta revienta con *permission denied* en vez de devolver filas.

Es una defensa accidental. Un solo `GRANT EXECUTE ... TO PUBLIC` de más —fácil de escribir sin querer en una migración— convierte eso en fuga total de ventas y planilla. Deben ser `TO authenticated` explícito.

Comprobado: `sales_invoices`, `pedidos`, `payroll_entries` y `branch_hourly_sales` devuelven *BLOQUEADO: permission denied for function auth_has_module_permission* al consultarlas como `anon`.

## 🟠 S4 — Otras exposiciones a `anon`

- **`roles`** — `read_all TO {anon,authenticated} USING (true)`: 23 filas del catálogo de roles, visible sin login.
- **`branches`** — `kiosk_read TO anon USING (true)`: las 8 sucursales completas. Es intencional (kiosco pre-login) pero innecesariamente amplio: ya existe `get_kiosk_boot_payload` para eso; el kiosco no necesita la tabla entera.
- **38 funciones ejecutables por `anon`** (34 INVOKER + 4 SECURITY DEFINER), contra la regla #4 del propio `CLAUDE.md` ("REVOKE EXECUTE ... FROM PUBLIC, anon"). Incluye `close_ventas_month`, `upsert_customers`, `generate_wfm_snapshot`, `get_ventas_stats`, `get_vendedores_resumen`. Ninguna filtra hoy —RLS y gates internos las paran— pero es superficie de ataque y DoS gratuito: cualquiera puede invocarlas en loop sin login.
- **`update_proveedor_manual`** es SECURITY DEFINER con EXECUTE para `anon` y `PUBLIC`. Tiene gate interno (`auth_can_edit_any` → `RAISE FORBIDDEN`), así que **no es explotable**, pero viola la regla. Bonus: existen **dos overloads** (7 y 8 argumentos) — el viejo es código muerto que hay que dropear.

## 🟡 S5 — Resto

- `job_watermarks` y `login_rate_limit` tienen RLS activo y **cero policies**. Fallan cerrado ✓, pero verificar que `login_rate_limit` se escriba con service_role — si el cliente no puede escribir ahí, **el rate limiting de login no existe**.
- **Protección de contraseñas filtradas (HIBP) desactivada** en Auth. Un toggle.
- Buckets públicos `photos` y `product-photos` con policy SELECT amplia → **listables** (se puede enumerar todos los archivos, no solo acceder por URL conocida). El bucket `backups` no tiene `file_size_limit` ni `allowed_mime_types`, contra la regla #10.
- **92 usuarios en `auth.users` para 50 empleados** — 42 cuentas huérfanas, solo 22 con login en los últimos 30 días. Cuentas de ex-empleados sin revocar es la vía de acceso indebido más común que existe.
- `pg_trgm` y `pg_net` instaladas en el schema `public` — contaminan el namespace de la API REST.

---

# 2. Rendimiento

## 🔴 P1 — El 27% del CPU de la base es un upsert que no cambia nada

Query #1 por tiempo total en `pg_stat_statements`:

```
INSERT INTO products(id, nombre, updated_at) ...   125,632 llamadas · 8,160 s · 65 ms media · 27.0%
```

Y en `pg_stat_user_tables`:

| tabla | filas vivas | UPDATEs acumulados | INSERTs |
|---|---|---|---|
| `laboratorios` | 356 | **425,459** | 1 |
| `presentaciones` | 232 | **277,704** | 0 |
| `products` | 5,191 | **160,828** | 15 |
| `purchase_receipt_items` | 35,838 | **184,099** (solo 29% HOT) | 1,038 |

356 filas reescritas 425 mil veces. Es **exactamente el antipatrón que `CLAUDE.md` prohíbe** ("PROHIBIDO el upsert incondicional de tablas completas") — el mismo que ya causó el problema de `inventory` con 935M de updates. Se arregló para `inventory` y quedó vivo en todo lo demás:

- `sync-products/index.ts:83` → `.upsert(labRows, { onConflict: 'id' })`
- `sync-products/index.ts:103` → `.upsert([...presMap.values()], { onConflict: 'id' })`
- `sync-products/index.ts:171` → `.upsert(productRowsToUpsert, { onConflict: 'id' })`
- `sync-erp-purchases/index.ts:195,206,261` → `suppliers`, `products`, `purchase_receipt_items`

Además el payload manda `updated_at`, que también está explícitamente prohibido en `CLAUDE.md` (hace que toda fila "cambie" siempre).

**Fix**: RPC con `ON CONFLICT DO UPDATE ... WHERE (cols) IS DISTINCT FROM (EXCLUDED.cols)`, igual que `sync_inventory_batch`. Es el arreglo de mayor retorno de toda esta auditoría.

`purchase_receipt_items` con 29% HOT es el peor caso: 71% de los updates tocan índices.

## 🔴 P2 — 275 fallos de cron en 7 días por conexiones agotadas

Todos con `return_message = "connection failed"`. El más reciente: hoy 04:40 UTC. Reparto:

```
sync-inv-suc5-1min      32      dte-popular-min      22
sync-inv-suc1-1min      28      refresh-inv-mv-2min  20
sync-inv-suc2-1min      28      dte-salud2-min       18
sync-inv-suc4-1min      25      dte-salud3-min       17   (+11 jobs más)
```

Con `max_connections = 60` y ~30 jobs disparando **cada minuto**, pg_cron compite con el pool de PostgREST, Auth, Realtime y Storage, y pierde. **Cada fallo es un minuto de ventas o inventario no sincronizado** — no es cosmético, es pérdida de datos operativos.

## 🟠 P3 — 150 índices sin un solo uso = 140 MB

En `sales_invoices` sola hay **~117 MB tirados** (la tabla son 137 MB y sus índices 279 MB):

| índice | peso | scans |
|---|---|---|
| `idx_si_cliente_trgm` | 31 MB | 0 |
| `idx_si_cliente_norm_trgm` | 28 MB | 0 |
| `idx_si_correlativo_trgm` | 13 MB | 0 |
| `idx_sales_invoices_branch_fecha` | 11 MB | 21 — prefijo duplicado de `idx_si_branch_fecha_full` |
| `idx_si_correlativo_norm_trgm` | 10 MB | 0 |
| `idx_si_erp_invoice_trgm` | 9.3 MB | 0 |
| `idx_sales_invoices_cod_vendedor` | 7.7 MB | 0 |
| `idx_si_erp_invoice_norm_trgm` | 7.1 MB | 0 |
| `idx_si_branch_fecha_no_anulada` | 2.7 MB | 0 |

Los 6 GIN de trigram son deuda del proyecto de normalización de búsqueda: se creó la variante cruda **y** la `_norm`, y no se usa ninguna de las dos. Cada índice es amplificación de escritura en una tabla que recibe inserts cada minuto desde 6 sucursales.

⚠️ **NO dropear `sales_invoices_codigo_generacion_key`** (18 MB, 0 scans): es la restricción UNIQUE del UUID del DTE. Es integridad de datos, no optimización — el `idx_scan=0` no significa que no sirva.

## 🟠 P4 — 400 MB de los 1,463 MB (27%) son basura operativa

| objeto | peso | filas | ¿se purga? |
|---|---|---|---|
| `cron.job_run_details` | **197 MB** | 215,434 | ❌ **no** |
| `net._http_response` | **202 MB** | 4,722 | pg_net rota, pero la tabla está inflada |

Existe `purge-sync-logs-daily` para `sync_log` / `inventory_sync_log`, y `purge-notifications-daily`. Nadie purga el historial de cron. Contra la regla #7 del proyecto ("Tablas de log/historial: definir retención desde el día 1").

## 🟠 P5 — La instancia es la mínima

```
max_connections       60          ← indica instancia de ~1 GB RAM
shared_buffers        256 MB
effective_cache_size  768 MB
work_mem              3.5 MB
```

Base de datos: **1,463 MB** — más grande que la RAM. El cache hit es 99.87% porque el working set caliente es chico, pero ya se acumularon **7.7 GB de temp files**: consultas que spillean a disco por `work_mem` insuficiente. Las RPCs de analítica más lentas (7,669 ms y 4,084 ms de media) son justamente esas.

## 🟡 P6 — Realtime es el segundo consumidor de CPU

La decodificación de WAL de Realtime: **628,352 llamadas, 5,612 s, 18.6%** del tiempo total de BD. Hay 10 tablas en la publicación `supabase_realtime`, incluidas `role_permissions` y `stock_config`, que casi nunca cambian pero obligan a decodificar el WAL igual.

Entre P1 (27%) y P6 (18.6%), **~45% del CPU de la base no produce valor**.

## 🟡 P7 — Otros

- **18% de rollbacks** (535,671 de 2.98M transacciones). Alto; vale la pena rastrear la fuente.
- **FK sin índice en `sales_invoices.customer_id → customers`** sobre 336K filas. Las otras 20 FKs sin índice son columnas de auditoría (`*_por`, `created_by`), exentas por la regla del proyecto — esa no lo es.

---

# 3. Estructura y gobierno

## ✅ Lo que está bien

- **Dinero en `numeric` en todas las columnas monetarias.** Cero `float`/`double` en importes — solo `ruta_locations.lat/lng`, que es correcto. Sin sorpresas de punto flotante en plata.
- **RLS habilitado en las 106 tablas** de `public`.
- **Las 10 vistas con `security_invoker = true`** ✓, y las 3 MV revocadas de `anon` ✓.
- **Todas las llamadas a `auth_*` dentro de policies usan el wrapper `(SELECT ...)`** — verificado sobre las 113 policies que las invocan. La lección del outage del 2026-07-08 sí quedó aplicada.
- Constraints: 148 FK · 106 PK · 59 CHECK · 38 UNIQUE. Cobertura razonable.
- PKs `integer` solo en tablas de bajo volumen; las grandes son `bigint`. Sin riesgo de agotamiento.
- Vault en uso para secretos de cron; `lock_timeout` documentado.

## 🔴 G1 — La deriva de migraciones empeoró

| | julio (documentado en CLAUDE.md) | hoy |
|---|---|---|
| servidor | 584 | **663** |
| archivos locales | 180 | **270** |
| faltantes | 404 | **393** |

La regla existe, está escrita, y no se está cumpliendo. Consecuencia concreta y ya conocida: **no se puede reconstruir el esquema desde cero**, ni crear un staging fiel, ni hacer rollback dirigido. Para un sistema que va a facturar, esto pasa de incómodo a inaceptable.

---

# 4. Lo que falta para ser el ERP/POS

Esta es la pregunta de fondo, y la respuesta está en el esquema: **hoy la base es un espejo de solo lectura del ERP de terceros, no un sistema de registro.**

```
inventory: (erp_sucursal_id, erp_product_id, lote, fecha_vencimiento, cantidad, synced_at, sync_key)
```

Es una **foto**, no un libro mayor.

| falta | por qué importa |
|---|---|
| **`stock_movements` (kardex append-only)** | Sin libro de movimientos no podés reconstruir el stock, no hay trazabilidad de quién movió qué, no hay costeo (PEPS/promedio), y un descuadre es inauditable. **Es lo primero que hay que construir**: `inventory` pasa a ser vista/MV derivada del ledger, no la fuente. |
| **`sale_payments`** | `sales_invoices.tipo_pago` es un `text` único → no representa pago mixto (efectivo + tarjeta + puntos), que en farmacia es lo normal. |
| **`cash_sessions` (caja)** | No hay apertura/cierre de turno ni arqueo. Sin eso no hay control de efectivo en 6 sucursales. |
| **Emisión DTE** | Lo que existe (`purchase_dte_*`) es para facturas de compra **recibidas**. Para *emitir* falta: JSON firmado almacenado, `sello_recepcion` de Hacienda, control de correlativos con bloqueo (`FOR UPDATE` o secuencia por punto de venta), y manejo de contingencia y anulación. `recibido_mh text` no alcanza. Referencia obligatoria: Decreto 487 (ya está en `docs/legal/`). |
| **Idempotencia de venta** | Si el POS reintenta por timeout, no hay clave que evite duplicar la venta. |
| **RLS de escritura en ventas** | `sales_invoices` tiene una sola policy (SELECT). Hoy escribe solo el sync con service_role. Para POS hay que diseñar escritura desde el cliente con RLS por sucursal. |
| **Particionado** | 336K facturas / 416 MB **siendo espejo**. Como sistema de registro crece mucho más rápido. `sales_invoices` y `sales_invoice_items` necesitan particionado por fecha — `pg_partman` ya está disponible. |
| **Modo offline** | Si Supabase se cae, hoy no se puede *consultar*; mañana no se puede **vender**. Cola local + reconciliación en el POS, independiente del proveedor. |

---

# 5. ¿Aguanta Supabase o hay que migrar?

**Quedarse en Supabase/Postgres — pero no en esta configuración.**

Postgres sobra para 6-8 sucursales; el problema no es el motor. El problema es que la instancia es la mínima, la base quema ~45% del CPU en trabajo inútil, y no hay red de seguridad. **Migrar de proveedor no arregla nada de eso — te lo llevás igual, y encima perdés Auth, Storage, RLS y edge functions que ya funcionan.**

Lo que sí hay que resolver antes de mover ventas:

1. **PITR (Point-in-Time Recovery) — obligatorio, no opcional.** El plan Pro trae backups diarios con 7 días de retención, **sin PITR** (es add-on, ~$100/mes). Hoy, ante corrupción, el mejor caso es **perder hasta 24 horas de ventas**. Para un sistema de facturación eso no es aceptable, y en El Salvador hay obligación de conservación fiscal. → Confirmar en el dashboard si el add-on está activo; si no, activarlo antes que cualquier otra cosa de esta lista.
2. **Subir el compute** a Small/Medium como mínimo. Resuelve P2 (fallos de cron), P5 (temp files) y da aire para el POS.
3. **Read replica** para analítica, para que el POS no compita con los dashboards por CPU.
4. **Modo offline en el POS** — el riesgo real no es de datos, es de disponibilidad.

---

# 6. Orden de ejecución sugerido

### Hoy (seguridad activa)
1. `employees_select` → `TO authenticated` — corta la fuga de 50 empleados y 46 PINs.
2. Rotar el esquema de `kiosk_pin` (pepper de Vault; hoy es derivable del `code`).
3. Cerrar `audit_logs` INSERT y `roles` INSERT/UPDATE.
4. Activar protección de contraseñas filtradas (un toggle).
5. Auditar y revocar las 42 cuentas `auth.users` huérfanas.

### Esta semana (estabilidad y costo)
6. Arreglar los upserts incondicionales de `sync-products` y `sync-erp-purchases` → **la mayor ganancia de todas** (~27% de CPU).
7. Purgar `cron.job_run_details` + cron de retención (90 días) → ~197 MB.
8. Dropear los 6 GIN de trigram muertos y los 3 índices redundantes de `sales_invoices` → ~117 MB y menos amplificación de escritura.
9. Subir compute → resuelve los 275 fallos de cron.
10. Confirmar/activar PITR.

### Antes del POS (arquitectura)
11. Cerrar las 30 policies `USING (true)` restantes y las `TO PUBLIC`.
12. Poner al día la deriva de migraciones (393 faltantes) — **antes** de empezar a construir el POS, no después.
13. Diseñar `stock_movements`, `sale_payments`, `cash_sessions`, y el módulo de emisión DTE.
14. Particionado de `sales_invoices` / `sales_invoice_items`.

---

*Todos los hallazgos fueron verificados en producción con consultas de solo lectura. No se aplicó ningún cambio.*
