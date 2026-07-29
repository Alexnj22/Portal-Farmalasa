# Plan de cierre Supabase — lo que queda

Continuación de `PLAN-SUPABASE-100-2026-07-29.md`. Ahí quedaron cerrados F1, F2,
F3.1, F3.4, F4.1, F4.3, F4.4 y F4.6. Advisor de seguridad **110 → 86**;
`rls_policy_always_true` de **28 → 2**.

## Estado al 2026-07-29 (v2.205.0)

| | |
|---|---|
| ✅ Cerrado | P1, P3+P5, P4, F1, F2, F3.1/3.4, F4.1/4.3/4.4/4.6, **C1, C3, C4, C5** |
| ⏸️ Tu decisión | **C2** (rebaseline de migraciones), rotar el secreto de cron, PITR |
| 📋 Documentado, sin ejecutar | slots de conexión al 87%, `collation version mismatch` (ambos en C4) |
| 📋 Proyecto | POS |

Queda **un solo punto técnico abierto (C2)**, y es de decisión, no de ejecución.

---

## C1 — `update_proveedor_manual`: overload muerto

Existen dos versiones (7 y 8 argumentos). La de 7 es código muerto de antes de
que se agregara un parámetro, y además es `SECURITY DEFINER`. Dropear la vieja.

**Riesgo**: bajo. Verificar primero que el frontend llame a la de 8.

---

## C2 — Deriva de migraciones (era F5) — **la más importante**

697 migraciones en el servidor contra 270 archivos locales. Sin esto no se puede
reconstruir el esquema, ni tener un staging fiel, ni hacer rollback dirigido.

**Es resoluble al 100%**: la tabla `supabase_migrations.schema_migrations` tiene
una columna `statements` (array de SQL) y **las 697 filas la tienen poblada**.
O sea el SQL real de cada migración está guardado — no hay que reconstruir nada
a mano, hay que volcarlo.

### Lo medido el 2026-07-29

Volcado completo vía `supabase db query` (2.9 MB de SQL, fuera del contexto).
**El desfase es peor de lo que decía el informe**, y de otra naturaleza:

| patrón de nombre local | archivos |
|---|---|
| `YYYYMMDD_nombre.sql` (solo fecha, escritos a mano) | **225** |
| timestamp completo de 14 dígitos | 81 |
| …de esos, que coincidan con una versión real del servidor | **14** |

O sea el repo local **no es un subconjunto de la historia real: es un set
paralelo mantenido a mano**. Solo 14 de 699 versiones tienen archivo
correspondiente. No es que falten 393 — es que 685 no están y las 306 que hay no
se corresponden 1:1 con nada.

**Por eso C2 no se puede resolver "agregando los faltantes".** Un primer intento
generó 685 archivos y dejó el directorio en 991, con duplicados del mismo DDL
bajo dos nombres — un `db reset` con eso aplicaría cosas dos veces. Se revirtió.

### C2 — decisión estructural pendiente (NO ejecutada)

**Opción A — rebaseline.** Archivar los 306 heredados en
`supabase/migrations-legacy/` y generar las 699 del servidor como historia
canónica. Es la solución estándar y resuelve el problema declarado: `db reset`
reproduce prod. Cuesta un diff de ~1,000 archivos y hay que **verificarlo
replayeando las 699 en un branch limpio** antes de confiar en él — si alguna
referencia a objetos creados fuera de migraciones, el reset falla y el
rebaseline da confianza falsa.

**Opción B — statu quo documentado.** Dejarlo como está y aceptar que el esquema
se reconstruye desde un dump, no desde la historia.

No se ejecuta ninguna sin tu decisión: toca 1,000 archivos y reescribe la
historia de migraciones del proyecto.

### 🔴 Hallazgo lateral: el secreto de cron está en claro en la BD

El escaneo previo (C2.2) encontró credenciales literales en los `statements`:

- **4 migraciones con un JWT** → decodificado, el claim es `role: anon`. **Es la
  anon key, pública por diseño** (vive en el bundle del frontend). No es fuga.
- **7 migraciones con el secreto de invocación de crons** (no-JWT), entre
  `20260606_cron_sync_purchases` y `add_cron_secret_header_check_sales_alerts`.

Hoy **0 de los 52 cron jobs** tiene el secreto literal y 41 usan Vault: la
migración 0B.2 funcionó. Pero **mover un secreto a Vault no lo rota**, así que
ese mismo valor sigue en texto plano dentro de
`supabase_migrations.schema_migrations`.

Alcance acotado: ese schema no está expuesto por PostgREST, así que hace falta
acceso directo a la BD para leerlo. Aun así es una credencial en claro en reposo
que autoriza invocar las edge functions de sync. **Recomendación: rotar el
secreto de cron y actualizar Vault.**

---

## C3 — Las 69 funciones `SECURITY DEFINER` — ✅ CERRADO (v2.205.0)

**Resultado medido: definer-para-`authenticated` 69 → 58; sin gate 24 → 13.**

`C3.1` clasificó automáticamente: 45 de las 69 sí llaman a algún `auth_*`; 24 no.
`C3.2` separó esas 24 midiendo, para cada una, **qué RLS estaría saltando de
verdad** — que es lo que decide si importa. No alcanza con ver que es DEFINER:
una lectura DEFINER sobre una tabla cuya policy ya es `USING (true)` no salta
nada. Las policies reales resultaron ser:

| tabla | policy de SELECT para `authenticated` |
|---|---|
| `inventory`, `products`, `branches`, `roles`, `suppliers` | `USING (true)` — abierta |
| `pedidos`, `pedido_items` | `pedidos.can_view` **+ scope de sucursal** |
| `cotizaciones`, `proveedores_maestro` | permiso de módulo |
| `employees` | oculta filas de roles superusuario |

### C3.3 — lo aplicado

**8 RPCs de pedidos → `SECURITY INVOKER`**
(`20260729_c3_pedidos_rpcs_security_invoker.sql`). Eran DEFINER sin gate, así
que se saltaban la policy entera de `pedidos`.

Probado en prod dentro de `BEGIN … ROLLBACK` antes de aplicar, con empleados
reales — el agujero y su cierre en la misma transacción:

| empleado | `get_pedidos_en_curso()` | `get_pausa_razones_stats()` |
|---|---|---|
| Regente de Enfermería (**sin** permiso de pedidos) — antes | **46** | **7** |
| Regente de Enfermería — después | **0** | **0** |
| Bodega (scope ALL) | 46 | 7 |
| Sucursal (scope BRANCH) | 8 | 1 |

Ninguna falló por permisos: `authenticated` ya tenía SELECT en los 12 objetos
que estas funciones leen. Efecto en usuarios legítimos: los **26 empleados con
scope=BRANCH** pasan a ver solo su sucursal; los 12 con ALL no cambian.

*Salvedad honesta*: `get_pedido_sucursal_stats` sigue devolviendo una fila por
sucursal pedida, porque su esqueleto sale de `erp_sucursal_map`/`inventory`, que
son tablas abiertas. Lo que sí queda filtrado son sus cifras derivadas de pedidos.

**3 revocadas de `authenticated`**
(`20260729_c3_revoke_ungated_definer_rpcs.sql`) — ninguna la llama el frontend:

- `notify_missing_roster` — solo el cron `roster-missing-alert-saturday`. Expuesta,
  permitía a cualquier empleado insertar un anuncio `HIGH` a toda la empresa.
- `upsert_proveedor_from_dte` — solo `sync-purchase-emails` y
  `backfill-proveedores-dte`, ambas con `SERVICE_ROLE_KEY` (verificado).
- `validate_role_headcount` — **cero callers** en `src/`, en las edge functions,
  en otra función SQL, en constraint o en trigger. Código muerto; se revoca en
  vez de dropear por ser reversible.

### 🐛 Bug encontrado de paso

`notify_missing_roster` filtraba por `status = 'ACTIVE'`, valor que **no existe
en la tabla** (los 50 empleados son `'ACTIVO'`). `v_th_ids` salía siempre NULL,
así que el aviso de "horario no configurado" caía en el `ELSE` y se mandaba con
`target_type='ALL'` — a toda la empresa en vez de solo a Talento Humano
(`role_id=11`). Corregido en la misma migración. No llegó a dispararse nunca
(0 anuncios con `source='cron-roster-check'`), porque los horarios siempre se
configuraron a tiempo y la función retorna temprano.

### Las 13 que quedan sin gate — justificadas, no pendientes

- **5 del kiosco** (`get_kiosk_boot_payload`, `get_kiosk_coverage_employees`,
  `verify_kiosk_device`, `verify_kiosk_pin`, `verify_kiosk_authorization`) — su
  gate es el `device_token`, no `auth_*`. Son la excepción documentada en
  CLAUDE.md regla #4.
- **3 triggers** (`fn_psp_capture_history`, `attendance_kiosko_pedido_lifecycle`,
  `notify_push_on_announcement`) — Postgres no permite invocar una función de
  trigger directamente.
- **5 inofensivas**: `inventory_grouped` e `inventory_proximos_count` solo leen
  tablas con `USING (true)`; `get_logistics_chief_ids` y `get_minmax_approver_ids`
  devuelven UUIDs de miembros de un rol, sin PII, y **las llaman edge functions
  con service_role** — gatearlas con `auth_has_module_permission` las rompería,
  porque ese helper devuelve false sin JWT de empleado; `next_cotizacion_numero`
  solo devuelve el siguiente correlativo.

---

## C3 — apéndice: el enunciado original

Es el hallazgo más grande que queda del advisor. `SECURITY DEFINER` significa que
la función corre con los permisos del dueño, **saltándose RLS**: si no tiene un
gate interno (`auth_can_edit_any`, `auth_has_module_permission`, o similar),
cualquier autenticado puede hacer por RPC lo que la policy le prohíbe hacer
directo sobre la tabla.

Nota honesta: este número subió de 67 a 69 en la sesión anterior, y no es un
retroceso — al cerrar `anon` hubo que hacer explícitos los `GRANT` a
`authenticated`, y el advisor cuenta grants explícitos. La exposición bajó; lo
que quedó visible es que **estas 69 nunca se revisaron**.

- **C3.1** — Clasificar automáticamente: ¿el cuerpo de la función contiene una
  llamada a `auth_*`? Las que no, son las sospechosas.
- **C3.2** — De las sospechosas, separar las que son inofensivas por naturaleza
  (lecturas agregadas sin PII, funciones de trigger) de las que escriben o
  devuelven datos sensibles.
- **C3.3** — Agregar gate interno o revocar, según el caso.

---

## C4 — 18% de rollbacks — ✅ CERRADO: no es un problema activo

**La tasa actual es 0.15%, no 17.4%.** Medido tomando dos lecturas de
`pg_stat_database` separadas en el tiempo: entre ambas hubo **3 rollbacks contra
1,941 commits**.

El 17.4% (542,282 de 3.1M) es **acumulado de toda la vida del cluster**:
`stats_reset` es `NULL`, o sea que esas estadísticas nunca se reiniciaron. La
cifra está dominada por incidentes ya cerrados — con toda probabilidad el outage
del 2026-07-08, cuando el pool se agotó y toda lectura se encoló y murió. No se
puede "bajar" el número sin reiniciar las estadísticas; lo que importa es la tasa
actual, y está sana.

Descartado también como causa: **los crons** (375 fallos sobre 108,895 corridas =
0.34%) y **pg_net** (2 respuestas fallidas de 3,305).

### 🔎 Hallazgo lateral 1 — los slots de conexión están al 87%

Buscando el origen de los rollbacks aparecieron `FATAL: remaining connection
slots are reserved for roles with the SUPERUSER attribute` en los logs. Medido:

```
max_connections = 60   |   en uso 52   |   IDLE 42   |   activas 2
```

**42 de 52 conexiones están ociosas.** El reparto:

| quién | conexiones | idle |
|---|---|---|
| Storage API | 15 | 15 |
| PostgREST (`authenticator`) | 13 | 13 |
| pgbouncer | 4 | 4 |
| Realtime (5 app_names) | 7 | 6 |

Storage API sola retiene 15 slots que no usa. Cuando el burst de ~13 crons
dispara a cada `:00` de cada minuto, los ~8 slots libres se agotan y el que
llega tarde recibe el FATAL. **Esa es la causa medida de los 375 fallos de cron**
("connection failed" / "job startup timeout").

Hoy no tumba el portal porque los crons reintentan al minuto siguiente, pero es
el mismo mecanismo del outage del 2026-07-08 y no tiene margen. La salida es
pooling (ya recomendado abajo) y/o recortar los pools ociosos de Storage y
PostgREST — **no** subir compute, que no agrega slots proporcionalmente.

### 🔎 Hallazgo lateral 2 — `collation version mismatch`

El log de Postgres está inundado con `database "postgres" has a collation
version mismatch`, decenas por minuto. Confirmado en catálogo:

```
datcollversion = 153.120   |   glibc real = 153.121
```

Es el efecto de que Supabase actualizó la imagen base y con ella glibc, sin que
la BD registre la nueva versión. Dos consecuencias:

1. **Ruido**: la advertencia se emite en *cada conexión nueva*, lo que hace
   inservible el log para encontrar cualquier otra cosa.
2. **Riesgo latente de orden**: los índices B-tree sobre columnas `text` se
   construyeron con las reglas de ordenamiento viejas. Si el salto de glibc
   cambió el orden de alguna cadena, esos índices pueden devolver resultados
   incompletos en comparaciones de rango. El salto acá es de *patch*
   (153.120 → 153.121), donde históricamente el orden no cambia — por eso no es
   una emergencia, pero tampoco algo para dejar indefinido.

Arreglo: `REINDEX` de los índices de texto y después
`ALTER DATABASE postgres REFRESH COLLATION VERSION`. Toca tablas calientes, así
que va en la ventana 06:00–11:59 UTC. **No ejecutado — documentado por decisión
del usuario el 2026-07-29.**

---

## C5 — `pg_trgm` y `pg_net` en `public` — ✅ CERRADO como deuda aceptada

**La premisa del enunciado era incorrecta en dos puntos, y medirla cambia la
conclusión.**

**1. `pg_net` no está contaminando `public`.** Sus 12 funciones viven en el
schema `net`; lo único registrado en `public` es el namespace de la extensión.
No aporta ni una función ejecutable por `anon`.

**2. Las 31 funciones de `pg_trgm` que `anon` puede ejecutar no son un agujero.**
De las 36 que `anon` alcanza en `public`, 31 son de `pg_trgm` y 5 son las del
kiosco ya documentadas. Las de `pg_trgm` son `similarity()`, `show_trgm()`,
`word_similarity()` y compañía: **funciones puras de comparación de cadenas, sin
acceso a ninguna tabla**. Pasarles texto no revela nada que el que llama no
tuviera ya.

**3. El riesgo de moverla era menor al supuesto, pero el beneficio es cero.**
Ninguna función del proyecto usa operadores ni funciones de trigram por nombre
(el grep sobre los cuerpos solo devuelve las 4 de la propia extensión), y los 9
índices GIN referencian `gin_trgm_ops` por OID, que no cambia al mover la
extensión de schema. Aun así, esos 9 índices suman ~52 MB sobre
`sales_invoices` (tabla caliente, escrita cada minuto), `inventory_grouped_mv` y
`products`, e incluyen los tres `_norm` que sostienen la búsqueda de facturas en
313 ms.

**Decisión: no se mueve.** Cambiar de schema una extensión con 47 objetos
dependientes, sobre una tabla que seis crons escriben cada minuto, a cambio de
sacar del namespace unas funciones de comparación de cadenas sin acceso a datos,
no se justifica. Queda cerrado como deuda aceptada, no como pendiente.

---

## Fuera de este plan (decisión o proyecto)

- **PITR** — add-on de pago, decisión del usuario. Recomendado antes de facturar.
- **Compute** — **no subir ahora**: los ~30 crons/minuto desaparecen cuando el
  portal reemplace al ERP. Dimensionar contra la carga del POS cuando exista.
  Pooling sí conviene ya.
- **HIBP** — **desactivado por decisión explícita del usuario.** No es pendiente.
- **Arquitectura POS** — `stock_movements`, `sale_payments`, `cash_sessions`,
  emisión DTE, particionado, offline. Proyecto de semanas.

---

## Reglas de ejecución

Staging antes que prod, `lock_timeout = '5s'`, archivo local con el mismo nombre
que `apply_migration`, y verificación **medida** antes de cerrar cada punto.
