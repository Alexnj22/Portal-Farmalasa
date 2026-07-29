# Plan de cierre Supabase — lo que queda

Continuación de `PLAN-SUPABASE-100-2026-07-29.md`. Ahí quedaron cerrados F1, F2,
F3.1, F3.4, F4.1, F4.3, F4.4 y F4.6. Advisor de seguridad **110 → 86**;
`rls_policy_always_true` de **28 → 2**.

## Estado al 2026-07-29 (v2.209.0)

| | |
|---|---|
| ✅ Cerrado | P1, P3+P5, P4, F1, F2, F3.1/3.4, F4.1/4.3/4.4/4.6, **C1, C3, C4, C5** |
| ✅ Cerrado (v2.228.0) | **C2** — baseline verificado 15/15 contra prod + `migration repair` aplicado |
| ⏸️ Tu decisión | PITR (se hará antes de facturar) |
| ✅ Cerrado (v2.217.0) | rotar el secreto de cron |
| ✅ Cerrado (v2.209.0) | slots de conexión al 87%, `collation version mismatch` (ambos en C4) |
| 📋 Proyecto | POS |

**C2 quedó cerrado** (v2.228.0): `supabase/migrations/` tiene un baseline generado
del catálogo de prod, verificado aplicándolo a una rama limpia con las 15
categorías de la huella en md5 idéntico, y registrado en prod con
`migration repair`.

**No queda ningún punto técnico abierto en este plan.** Lo que sigue es decisión
(PITR) o proyecto (POS).

Pendiente menor aparte: borrar de Vault `admin_invoke_secret_prev_20260729`
cuando pase un día sin incidentes desde la rotación (2026-07-29 17:31 UTC).

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

### 🔬 Diagnóstico del 2026-07-29: el problema es de ORDEN, no de historia perdida

Se intentó ejecutar la Opción A de punta a punta. **No se completó, pero el
intento cambió el diagnóstico y el problema resultó mucho más chico de lo que
decía este documento.**

Lo hecho y medido:

1. **Las 708 migraciones del servidor tienen su SQL íntegro** (3.0 MB,
   `sin_sql = 0`, versiones únicas y ordenadas). Se volcaron a 708 archivos
   `<version>_<nombre>.sql` sin pérdida — el separador `array_to_string` se
   verificó (cero `;;`).
2. Se creó una rama de verificación y se aplicaron con `supabase db push`.
   **Falló en la PRIMERA migración**:
   ```
   20260404143525_create_approval_requests.sql
   ERROR: relation "employees" does not exist
   ```
3. **La causa no es que falte historia.** `employees` sí se crea en una
   migración — pero en
   `20260711201046_baseline_append_02_tables_p1.sql`, del **11 de julio**,
   mientras la migración que la referencia es del **4 de abril**. Ya hubo un
   intento de baseline (19 migraciones `baseline_*` del 2026-07-11) que se
   **añadió al final en vez de al principio**, e incluye un
   `revert_baseline_schema_metadata`, señal de que quedó a medias.
4. **Solo 2 de las 109 tablas de prod no tienen `CREATE TABLE` en ninguna
   migración**: `proveedores_maestro` y `proveedores_categorias`. El otro 98%
   sí está.

### Segundo intento (mismo día): por qué el reordenamiento tampoco alcanza

Se probó exactamente eso — mover las 19 `baseline_*` al frente y replayear. Dos
hallazgos que cierran el diagnóstico:

**1. Las `baseline_*` NO son DDL: son concatenación de texto.** Su cuerpo es

```sql
UPDATE supabase_migrations.schema_migrations
SET statements[...] = statements[...] || $chunk$ CREATE TABLE public.employees (...) $chunk$
```

El intento de julio no *ejecutaba* el esquema: iba **pegando el texto del DDL
dentro de la tabla de migraciones**, como dato. Por eso las 18 "aplican" sin
error y dejan la base con **0 tablas**. El `baseline_reset_02_tables_elem` del
medio descarta la serie `append_02` y la rehace como `fix_02`, así que el
baseline real es `append_01` + `fix_02_p0b..p6`.

Ese DDL **sí se pudo extraer** de los `$chunk$`: 55 KB, **100 `CREATE TABLE` y
41 `CREATE SEQUENCE`**, y aplicado a una rama limpia funciona — crea las 100
tablas.

**2. Pero la historia no puede replayearse encima de un baseline actual.** Con
el baseline puesto, la primera migración de abril falla con

```
column employees.is_admin does not exist
```

`is_admin` existía en abril y ya no existe. **El baseline es una foto de julio y
las migraciones esperan el esquema de abril**: son mutuamente incompatibles por
construcción. No es un bug que se arregle reordenando; es que "baseline reciente
+ historia vieja" no es una combinación válida.

**Conclusión definitiva: la única arquitectura viable es baseline SOLO, con toda
la historia archivada.** Y para eso el baseline tiene que estar completo — el
extraído solo trae tablas y secuencias; le faltan los 369 índices, 218 policies,
187 funciones, 11 triggers y 361 constraints, que venían de las migraciones que
ya no se pueden aplicar.

### Tercer intento: el baseline SÍ se puede generar sin contraseña

**Corrección de lo escrito arriba: `pg_dump` y la contraseña de producción NO
hacen falta.** `supabase db query --linked` va por la Management API y no pide
credenciales de base, así que el DDL completo se genera desde el catálogo de
prod y se vuelca a disco sin que pase por el contexto del agente.

El generador está en `scratchpad/gen_ddl.sql` y emite el esquema en orden de
dependencias, con `SET check_function_bodies = off` al inicio para que las
funciones no exijan que sus referencias existan todavía:

| ord | qué | fragmentos |
|---|---|---|
| 10 | extensiones | 8 |
| 20 | secuencias | 39 |
| 30 | tablas | 109 |
| 40 | funciones | 187 |
| 50 | vistas y matviews | 13 |
| 60 | PK y unique | 148 |
| 70 | FK y CHECK | 213 |
| 80 | índices | 221 |
| 90 | triggers | 11 |
| 95 | RLS habilitado | 109 |
| 96 | policies | 218 |

**1,276 fragmentos, ~533 KB, cero nulos.** Y los conteos cuadran EXACTO con la
huella de producción en las 7 categorías comparables: tablas 109, funciones 187,
vistas 13, policies 218, triggers 11, constraints 148+213 = **361**, índices
221+148 = **369**.

**Estado al cierre de la sesión del 2026-07-29:**

- ✅ `scratchpad/ddl.json` — los 663 KB del DDL, ya volcados de prod.
- ✅ `scratchpad/build_baseline.py` — ensambla el baseline y archiva la historia.
- ✅ `scratchpad/fingerprint.sql` — la huella para comparar rama contra prod.
- ⏸️ **Bloqueado por infraestructura**, no por diseño: el clasificador de
  seguridad de Bash de Claude Code estuvo caído (deja pasar `echo`/`ls` pero
  bloquea todo lo que tenga efectos secundarios). 8 reintentos, mismo error.

**Nada quedó a medio aplicar**: `supabase/migrations/` intacto, sin
`migrations-legacy/`, sin baseline parcial, y las dos ramas de verificación
borradas (costo total: menos de 3 centavos).

### Cuarta sesión (2026-07-29, tarde): generador y verificador TERMINADOS

**El bloqueo de tooling ya no existe**: `libpq` está instalado —`pg_dump`/`psql`
18.4 en `/opt/homebrew/opt/libpq/bin`, fuera del `PATH`— y el CLI de Supabase
funciona. No hace falta Docker.

**Se encontraron y corrigieron cuatro huecos del generador v1** que habrían
producido un baseline que *parece* correcto y no lo es:

| hueco en v1 | por qué importa |
|---|---|
| **ACLs ausentes** (188 relaciones + 189 funciones con grants explícitos) | En `public` hay `ALTER DEFAULT PRIVILEGES` que le da ALL a `anon` sobre cada tabla nueva. Reconstruir sin ACLs **reabre exactamente la superficie de `anon` que el proyecto cerró** (CLAUDE.md regla #4). Es el hueco grave. |
| **Publicaciones ausentes** | Las 13 tablas de `supabase_realtime` perdían Realtime en silencio. |
| **`reloptions` de tablas ausentes** | Se perdía el autovacuum agresivo de `sales_invoices` / `sales_invoice_items`. |
| **Secuencias sin parámetros** | `CREATE SEQUENCE` a secas descartaba tipo/increment/start de 16 secuencias. |

Y dos bugs de correctitud, ambos detectados midiendo, no leyendo:

1. **Las claves se truncaban a 63 caracteres.** `ext.extname` es de tipo `name` y
   es la primera rama del `UNION`, así que **todo** el `UNION` se casteaba a
   `name`: 188 claves colisionaban y el `ORDER BY` quedaba ambiguo entre
   overloads. Un re-volcado podía reordenarlos y producir un diff fantasma.
   Corregido con `::text` en la primera rama.
2. **Las 31 funciones de `pg_trgm` se emitían como propias.** Su dueño es
   `supabase_admin`; un `CREATE OR REPLACE` las saca de la extensión o falla por
   permisos, y el `GRANT`/`REVOKE` falla por no ser dueño. Ahora se excluyen los
   miembros de extensión (`pg_depend.deptype='e'`) del DDL, de los ACLs y de la
   huella. Verificado: ninguna tabla/vista/secuencia de `public` es miembro de
   extensión, así que la exclusión solo aplica a funciones — 190 → **159 propias**.

**Estado del tooling — los tres artefactos están terminados y validados**, en
`~/.claude/projects/-Users-alexnunez-Documents-Portal-Farmalasa/c2-baseline/`
(fuera del repo a propósito, para no colisionar con trabajo en curso):

| archivo | qué hace | estado |
|---|---|---|
| `gen_ddl2.sql` | vuelca el DDL de prod en 15 secciones ordenadas por dependencia | ✅ corre contra prod, **1,666 fragmentos, cero nulos, cero claves duplicadas** |
| `build_baseline2.py` | ensambla el baseline | ✅ **735 KB, 12,685 líneas**; aborta solo si hay fragmentos vacíos o claves duplicadas |
| `fingerprint2.sql` | huella de 15 categorías para comparar rama vs prod | ✅ corre contra prod; huella t0 en `fp_prod.csv` |

`build_baseline2.py` **por defecto no toca el repo** (v1 movía los 333 archivos
*antes* de verificar nada). Solo archiva con `--apply`.

Conteos del baseline, todos cuadrados contra la huella de prod: tablas 110,
columnas 1,284, funciones 159, vistas 13, policies 219, RLS 110, constraints 362
(149+213), índices 372 (223+149), triggers 11, ACLs 4,519 filas de privilegio
sobre 188 relaciones + 464 sobre 159 funciones, publicaciones 13, comentarios 49.

### ✅ EJECUTADO Y VERIFICADO (v2.228.0, commit `114068b7`)

`supabase/migrations/` quedó con **un** archivo —
`20260101000000_baseline_schema.sql`, 1,671 sentencias, 737 KB— y las **339**
anteriores en `supabase/migrations-legacy/`. Git lo registró como 334 renombres
puros (`R100`) + 5 archivos que nunca habían estado trackeados.

**Verificación medida en una rama limpia** (`verif-baseline-c2`, ya borrada):

| | |
|---|---|
| sentencias aplicadas | 1,671 |
| errores | **0** (6 notices de `extension already exists`) |
| índices inválidos | **0** |
| categorías de la huella con md5 idéntico a prod | **15 de 15** |
| deriva de prod durante la comparación | **ninguna** (re-medido t0 → t2) |

Las 15: tablas 110, columnas 1,285, secuencias 65, reloptions 12, índices 373,
funciones 160, vistas 13, constraints 363, triggers 11, RLS 110, policies 219,
privilegios de relación 4,519, privilegios de función 467, publicaciones 13,
comentarios 49.

**`create_branch` confirmó el diagnóstico de paso**: la rama quedó en
`MIGRATIONS_FAILED` porque intentó replayear la historia local. O sea el CLI
tampoco puede reconstruir prod desde esos archivos — que era justamente la tesis.

**Seis correcciones hicieron falta para que el baseline fuera fiel.** Las cuatro
primeras estaban en el generador v1 y ninguna daba error: producían un archivo que
parece correcto. Las dos últimas salieron de los dos ciclos de verificación:

| # | hallazgo | cómo salió |
|---|---|---|
| 1 | **ACLs ausentes** — sin ellos se reabre la superficie de `anon` | leyendo el catálogo antes de generar |
| 2 | publicaciones de Realtime y `reloptions` ausentes | ídem |
| 3 | claves truncadas a 63 chars (`name` en la 1ª rama del `UNION`) | chequeo de claves duplicadas |
| 4 | las 31 funciones de `pg_trgm` emitidas como propias | medición de dueños |
| 5 | **funciones después de las tablas** — 5 tablas tienen columnas `GENERATED` que llaman a `norm_search()` | 1er intento: 122 errores |
| 6 | `pg_get_viewdef()` ya trae el `;` → el `WITH NO DATA` quedaba suelto | ídem |

Y **dos "diferencias" del 2º intento resultaron ser hallazgos sobre prod, no bugs
del baseline** — vale la pena registrarlas porque volverán a aparecer:

- **`product_presentations_id_seq`**: la tabla se renombró a `product_precios` y
  `ALTER TABLE ... RENAME` **no renombra la secuencia asociada**. El nombre viejo
  quedó fosilizado en prod. Se reproduce con un `ALTER SEQUENCE ... RENAME TO`
  (ord 32), sin tocar prod. Arrastraba además 12 privilegios que fallaban.
- **18 comentarios "distintos" con el md5 de la descripción idéntico**: prod tiene
  columnas borradas, que dejan huecos en `attnum`; una tabla recién creada numera
  compacto. Era un bug del **verificador**, que comparaba por número de columna en
  vez de por nombre — medía el layout físico, no el esquema.

### ✅ `migration repair` aplicado (con OK explícito)

`supabase migration repair --status applied 20260101000000`. El registro de prod
pasó de 731 a **732 filas**; la nueva es `20260101000000 / baseline_schema`, con
los 2,867 statements del baseline guardados. **Verificado que no tocó el
esquema**: la huella de prod quedó idéntica a t0 en las 15 categorías, medida
después del repair.

Con eso el footgun está cerrado por el mecanismo correcto: `db push` solo aplica
versiones locales que **no** estén en el registro remoto, y ésta ya está.

### 🔎 Consecuencia medida: `db push` queda inutilizable (y no importa)

`supabase db push --dry-run` ahora falla con **"Remote migration versions not
found in local migrations directory"** y lista las 731 versiones viejas. Es
esperado: existen en el registro de prod y ya no tienen archivo local.

**No afecta el flujo del proyecto**, que aplica migraciones con `apply_migration`
(MCP), no con `db push` — ver CLAUDE.md. Y no reabre ningún riesgo.

Para que `db push` vuelva a funcionar habría que marcar las 731 como revertidas
(`migration repair --status reverted <731 versiones>`, que **borra** esas filas).
**Recomendado NO hacerlo tal cual**: la columna `statements` de esas filas es el
**único registro fiel de lo que realmente se aplicó** — los 339 archivos de
`migrations-legacy/` son el set paralelo mantenido a mano, que no se corresponde
1:1 (solo 14 de 699 coincidían). Si alguna vez se quiere `db push` operativo, el
orden correcto es: **volcar primero esas 731 filas con su SQL a
`migrations-legacy/servidor/`, y solo después marcarlas revertidas.**

### Nota histórica: por qué se pausó a mitad

Mientras se generaba el baseline, **otra sesión aplicó
`20260729_module_locks_panel_soporte` a prod** (registrada 21:24:00 UTC, archivo
escrito 15:23:36 local). Se detectó porque el conteo de funciones subió 189 → 190
entre dos volcados separados por 3 minutos, y se rastreó hasta esa migración.

El siguiente paso movía los 333 archivos de `supabase/migrations/` a
`migrations-legacy/` — **incluyendo ese archivo recién escrito**, que habría
quedado archivado como "historia previa" mientras se estaba creando. Se paró ahí
por decisión del usuario.

**Nada quedó a medias**: repo sin cambios (334 archivos en `migrations/`, sin
`migrations-legacy/`, sin baseline), `.env` intacto, **cero ramas creadas**, cero
costo.

**El procedimiento, si alguna vez hay que regenerarlo.** Requisito: que no haya
otra sesión aplicando migraciones, porque el baseline es una foto de prod.
`verificar.sh` automatiza los pasos 3 y 4.

```sh
D=~/.claude/projects/-Users-alexnunez-Documents-Portal-Farmalasa/c2-baseline
```

1. **Re-volcar** (la foto de hoy queda vieja apenas entra otra migración):
   `supabase db query --linked -f $D/gen_ddl2.sql -o json > $D/ddl2.json`
   y `-f $D/fingerprint2.sql -o csv > $D/fp_prod.csv` (huella t0).
2. **Ensamblar**: `python3 $D/build_baseline2.py $D/ddl2.json --out $D/base.sql`
   (dry-run, no toca el repo).
3. **Rama de verificación**: `create_branch` (~$0.0134/hora) y esperar
   `ACTIVE_HEALTHY`. La rama nace **vacía** — `create_branch` no aplica nada.
   Aplicar con `psql -v ON_ERROR_STOP=1 -f $D/base.sql`.
4. **Comparar** `fingerprint2.sql` en la rama contra `fp_prod.csv`. Las 15 filas
   deben coincidir. Después re-medir prod: si su huella se movió respecto a t0,
   entró una migración concurrente y hay que volver al paso 1.
5. Solo si coincide: `--apply` para archivar la historia, commitear, y
   **`supabase migration repair --status applied 20260101000000`** para que prod
   registre el baseline sin ejecutarlo.

⚠️ El paso 5 no es opcional. El baseline lleva una versión anterior a todo lo
aplicado; sin el `repair`, el próximo `db push` intentaría correrlo contra la
base viva.

Recordar en todos los pasos: mover el `.env` fuera del camino antes de invocar el
CLI (el CLI lo lee y falla), y borrar la rama al terminar.

**Datos operativos aprendidos** (para no re-descubrirlos):
- `create_branch` **NO** aplica las migraciones: la rama nace vacía. Hay que
  hacer `supabase db push --db-url ...`.
- El host directo `db.<ref>.supabase.co` resuelve a **IPv6** y desde acá no hay
  ruta. Hay que usar el pooler:
  `postgresql://postgres.<ref>:<pass>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`.
- `supabase branches get <nombre>` devuelve host/usuario/contraseña de la rama.
- Costo real de la rama de verificación: **menos de un centavo** (~25 min a
  $0.0134/hora). El costo no es el obstáculo; el tooling sí.
- Toda invocación del CLI necesita mover el `.env` fuera del camino
  (ver [[reference_edge_function_deploy_workaround]]).

**El árbol se dejó limpio**: los 708 archivos generados se revirtieron y los 316
heredados volvieron a su lugar. Un rebaseline sin verificar no se commitea.

### 🔎 Hallazgo lateral: otro overload muerto, igual que C1

`get_puntos_canjeados` tiene dos versiones —3 args y 4 args (agrega
`p_hora_corte`)— exactamente el mismo patrón que el `update_proveedor_manual` de
C1. Salió al chequear claves duplicadas en el volcado. No se tocó: hay que
verificar primero cuál llama el frontend. Vale revisar si hay más pares así.

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
que autoriza invocar las edge functions de sync.

### ✅ ROTADO el 2026-07-29 (v2.217.0)

`ADMIN_INVOKE_SECRET` rotado a un valor nuevo de 96 caracteres
(`openssl rand -hex 48`). Es el secreto que 13 edge functions validan como
`Authorization: Bearer` y que ~25 `cron.job.command` leen de Vault.

**El valor nuevo nunca pasó por el contexto del agente ni quedó en el
transcript**: vivió solo en una variable de shell (`$NEW`), y los comandos
llevan la referencia a la variable, no el valor. Se aplicó a los dos lados con
el mismo `$NEW`:
1. `supabase secrets set ADMIN_INVOKE_SECRET="$NEW"` (lo que validan las funciones)
2. `vault.update_secret('<uuid>', '$NEW')` (lo que mandan los crons)

`update_secret` se llamó con 2 argumentos a propósito: su cuerpo usa
`coalesce(new_name, s.name)` y `coalesce(new_description, s.description)`, así
que nombre y descripción se preservan — verificado leyendo la definición antes
de tocar producción.

**Rollback**: el valor viejo quedó respaldado dentro de Vault como
`admin_invoke_secret_prev_20260729`, copiado de `decrypted_secrets` sin salir
nunca de la BD. **Borrarlo cuando haya pasado un día sin incidentes** — ya no
sirve para nada, y dejarlo es acumular una credencial muerta.

**Verificación medida**: las 14 respuestas HTTP posteriores a la rotación
(17:31:34 UTC) fueron **200, cero 401** — no hubo siquiera ventana de fallo, las
funciones tomaron el valor nuevo de inmediato. Y no solo respondieron: 6
corridas de `dte` y 8 de `inventory` posteriores escribieron datos con
`success = true`.

Nota: lo que sigue en claro en `schema_migrations` es el valor **viejo**, que ya
no autoriza nada. El nuevo nunca tocó una migración.

`CRON_INVOKE_SECRET` **no se rotó y no hace falta**: se creó justamente para no
heredar esta exposición (header propio `x-cron-secret`, secreto propio) y nunca
estuvo en texto plano en un `cron.job.command`.

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

### ✅ Ambos hallazgos CERRADOS (v2.209.0)

**Slots** — `20260729_c4_consolidar_crons_sync_1min.sql`. Los 13 jobs compartían
el horario **exacto** `* 12-23,0-5 * * *`, sin desfase, y `cron.max_running_jobs=32`,
así que pg_cron los lanzaba a los 13 a la vez — cada uno un background worker con
su propia conexión. Los 13 llamaban a la **misma** edge function, solo cambiaba el
body. Consolidados en un job que hace los 13 `net.http_post` en una sesión:
funciona porque `net.http_post` es asíncrono (encola en `net.http_request_queue`
y retorna; el worker de pg_net hace el HTTP). **Medido: `succeeded`, 13 rows en
53 ms, una conexión.** La frecuencia no cambió.

**Collation** — `20260729_c4_refresh_collation_version.sql`, en tres pasos y en
este orden (invertirlo apaga el aviso sin arreglar nada):
1. `REINDEX ... CONCURRENTLY` de los 71 índices colacionables (151 MB, 37 tablas):
   34 tablas frías por tabla, después `products` e `inventory`, y `sales_invoices`
   (355 MB) índice por índice, dejando al final los tres trigram `_norm`.
   `CONCURRENTLY` no corre dentro de transacción → no pasa por `apply_migration`,
   va por `execute_sql` una sentencia por llamada.
2. Verificar que ninguno quedó inválido — un `CONCURRENTLY` interrumpido deja un
   índice que Postgres **deja de usar en silencio**. `NOT indisvalid` → 0,
   `%_ccnew%` → 0.
3. `ALTER DATABASE postgres REFRESH COLLATION VERSION`.

**Resultado medido:**

| | antes | después |
|---|---|---|
| conexiones libres | 8 | **18** |
| en uso / idle | 52 / 42 | **42 / 32** |
| crons fallando (ventana 15 min) | — | **0** |
| `datcollversion` | 153.120 ≠ 153.121 | **153.121 = 153.121** |
| índices inválidos | — | **0 de 71** |

La búsqueda de facturas sigue sobre el trigram reconstruido
(`Bitmap Index Scan on idx_si_cliente_norm_trgm`, 84 ms en caliente).

**Lo que sigue pendiente y NO es de código:** los 15 slots idle de Storage API y
los 13 de PostgREST son pools internos de Supabase, no configurables por SQL. Se
atacan con **Supavisor en modo transacción** (Dashboard → Settings → Database →
Connection pooling): es cambio de cadena de conexión + redeploy, no migración.

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
