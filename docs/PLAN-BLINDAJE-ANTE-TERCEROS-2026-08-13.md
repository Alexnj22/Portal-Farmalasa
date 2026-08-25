# Plan de blindaje ante un tercero — sin frenar el trabajo diario

**Fecha**: 2026-08-13 · **Estado**: **Fases 0 y 1 aplicadas y verificadas el 2026-08-24**; Fases 2 a 4 sin empezar
**Origen**: medición de la superficie real de producción (`sacecdkdmsdvgqnrsett`) el 2026-08-13.

---

## Medido contra producción — 2026-08-24

**Al medir, las cinco fases estaban en cero y este archivo nunca se había
commiteado** — vivía sólo en el árbol de trabajo, o sea a un `git checkout` ajeno
de desaparecer, que es exactamente el riesgo que CLAUDE.md describe para un árbol
compartido. Ya está versionado.

**Ese mismo día se cerraron la Fase 0 y la Fase 1.** La 0 era la única que
permitía tomar cualquier cuenta del portal; la 1 instala el interruptor y el
registro de egreso, sin bloquear a nadie. Las dos están abajo, con sus pruebas y
con lo que no se pudo probar.

Lo que sigue midiéndose igual: **67 policies** de `public` dejan leer sin
preguntar por ningún `auth_*` y sin ser de `service_role` (criterio mío, no el
del 13-ago, así que el número no es comparable directamente con el de arriba).
Ésa es la Fase 2, y no se tocó.

---

## 0. La idea que hace compatibles las dos cosas

Todo control de este plan se instala **una sola vez** y después se enciende o se
apaga **cambiando una fila de una tabla**, no reescribiendo una policy.

```
observar  →  avisar  →  exigir
```

- **observar**: el control está instalado pero deja pasar todo. Cero cambio para
  quien trabaja.
- **avisar**: deja pasar y anota/alerta. Sirve para descubrir quién habría sido
  bloqueado *antes* de bloquearlo.
- **exigir**: bloquea.

Y el motivo real por el que esto importa acá: **cambiar una policy es DDL sobre
una tabla caliente**, o sea `ACCESS EXCLUSIVE`, o sea exactamente el outage del
2026-07-08 (ver CLAUDE.md). Si el interruptor fuera "editar la policy", cada
marcha atrás sería otra migración sobre `products`/`inventory` en horario, con
el pool de PostgREST encolándose detrás.

Con el interruptor en una tabla:

| acción | costo | se puede hacer a las 10am |
|---|---|---|
| instalar el control | 1 migración con lock | **no** — va en ventana |
| encender / apagar | `UPDATE` de 1 fila | **sí**, instantáneo |

**La marcha atrás nunca es una migración.** Ese es todo el truco.

---

## 1. Modelo de amenaza — qué asumimos que tiene el atacante

Lo que damos por hecho que consigue:

- **Una credencial válida de un empleado cualquiera.** Es la vía realista: un
  carné prestado, alguien que se fue, una contraseña compartida entre turnos.
- **El `anon key`.** Es público por diseño: viaja en el bundle que sirve Vercel.
  No es un secreto y no hay que tratarlo como tal.
- **Tiempo, paciencia y velocidad.** Una IA no se aburre a la fila 3,000.

Lo que **no** asumimos, y si pasa este plan no aplica porque es otro problema:

- acceso a la máquina de quien administra, al panel de Supabase, o al
  `service_role key`. Con eso no hay RLS que valga.

**Consecuencia de diseño**: el perímetro es RLS + la autorización dentro de las
edge functions. La interfaz **no** es un control de seguridad — PostgREST es una
API REST pública y se puede llamar con `curl` sin abrir el portal jamás.

---

## Fase 0 — ✅ APLICADA en producción el 2026-08-24

`set-employee-password` **v35** y `disable-employee-auth` **v10**, las dos con
`verify_jwt: false` conservado —leído VIVO después del despliegue, no supuesto—.
El permiso lo resuelve ahora `requireActiveEmployeeUser` + `permisoDeModulo` de
`_shared/security.ts`, el canónico que ya usaban catorce funciones.

### Impacto cero, medido antes de tocar nada

Las **5 personas** que pasaban el control lo siguen pasando: 1 SUPERADMIN y 4 con
`staff_list.can_edit` por su **rol principal**. Ninguna depende del rol
secundario, así que la rama que el helper agrega respecto del código viejo no le
concede nada a nadie. Los 49 empleados están en `ACTIVO`, así que el chequeo de
estado que `requireActiveEmployeeUser` añade tampoco deja a nadie afuera.

### Las cuatro pruebas, contra producción

| | qué se pidió | qué contestó |
|---|---|---|
| 1 · positivo | admin real, username inexistente | `EMPLOYEE_NOT_FOUND` — la autorización pasó **sin escribirle la contraseña a nadie** |
| 2 · **espejo** | el mismo admin con el token falseado a `roleId: -999`, `systemRole: 'NADIE'` | `EMPLOYEE_NOT_FOUND` — **pasó igual**, o sea que el permiso ya NO sale del token |
| 3 · negativo | token basura, las dos funciones | `INVALID_TOKEN` en las dos |
| 4 · negativo | la llave anónima como sesión | `INVALID_TOKEN` |
| 5 · positivo | admin real en `disable-employee-auth` sin `employeeId` | `MISSING_FIELDS` — pasó la autorización **sin desactivar a nadie** |

La **2** es la que prueba el arreglo, y hay que leerla al revés de como suena: el
token decía *«no puedo»* y la función lo dejó pasar igual. Con el código viejo
eso era `INSUFFICIENT_PERMISSIONS`, porque el permiso salía justamente de ahí. El
metadata se restauró a su valor original y se confirmó.

Las **3** y **4** están para que el resultado signifique algo: un control que
sólo sabe decir que sí no es un control.

### Lo que NO se pudo probar, y se dice

- **La negación por FALTA DE PERMISO** (no por identidad). Haría falta una cuenta
  con sesión válida y **sin** `staff_list.can_edit`, y no hay ninguna a mano: las
  49 fichas activas son o de los 5 con permiso o de gente sin cuenta de prueba.
  Lo que sí está probado es que el helper niega —lo usan catorce funciones en
  producción— y que la identidad se rechaza bien.
- **El camino del cron.** `apply-scheduled-employee-events-daily` (11:00 UTC,
  activo) invoca `disable-employee-auth` con `ADMIN_INVOKE_SECRET`. Esa rama **no
  se tocó** —sigue siendo `token === adminSecret` antes de mirar nada—, pero no
  se ejercitó: la primera corrida real es la de mañana.

### Y de paso, un candado que no cerraba

`CANNOT_DISABLE_SELF` comparaba `caller.id` —el usuario de `auth.users`— contra
`employeeId`, que es la **ficha**. Para 33 de las 42 personas que usan el portal
esos dos ids **no son el mismo valor**: entran por una cuenta `*@staff.local`
ligada en `employee_auth_accounts`. O sea que el freno contra desactivarse a uno
mismo daba `false` casi siempre y no frenaba a casi nadie. Ahora `caller.id` ES
la ficha, resuelta igual que `auth_employee_id()` en la base.

---

### El plan original de esta fase, para el registro

**El problema**: `set-employee-password` y `disable-employee-auth` deciden el
permiso leyendo `caller.user_metadata`, que **lo escribe el propio navegador**
con `supabase.auth.updateUser({ data: … })`. Verificado: no hay trigger en
`auth.users` que lo impida. Tres llamadas y cualquier cuenta activa cambia la
contraseña de cualquier otra.

**El arreglo**: el JWT dice **quién** sos (eso lo firma Supabase, no se
falsifica); el **permiso** se resuelve leyendo `employees` + `role_permissions`
con el service role. Es lo que ya hace `regularizar-dte` bien.

```ts
// ❌ antes — el navegador escribe esto
const meta = caller.user_metadata || {};
if (meta.systemRole === 'SUPERADMIN') { /* … */ }

// ✅ después — la base es la autoridad
const { data: emp } = await admin
  .from('employees')
  .select('id, status, system_role, role_id')
  .eq('id', caller.id)
  .single();
if (!emp || emp.status !== 'ACTIVO') return json({ error: 'UNAUTHORIZED' }, 401);
const permitido = emp.system_role === 'SUPERADMIN' || (await tienePermiso(emp.role_id, 'staff_list', 'can_edit'));
```

**Por qué no interrumpe a nadie**: quien hoy tiene el permiso de verdad lo sigue
teniendo — la base dice lo mismo que decía el token cuando el token era honesto.
Lo único que deja de funcionar es el camino falsificado. **Ningún usuario
legítimo nota nada.**

**Regla que queda**: `user_metadata` puede **pintar la pantalla**; nunca puede
**autorizar una escritura**. Es [[feedback_user_metadata_lo_escribe_el_navegador]]
aplicado donde faltaba.

**Alcance**: 2 funciones. Las otras dos que mencionan `user_metadata`
(`ensure_user_by_code`, `bulk-create-employee-users`) lo *escriben*, no autorizan
con él — no hace falta tocarlas.

**Verificación**: en staging, con la cuenta `pruebas`, intentar la secuencia de
3 pasos y confirmar el 401. Después en prod. No requiere ventana horaria: es
deploy de edge function, sin DDL.

> Recordar el flag al redesplegar: `disable-employee-auth` va con
> `--no-verify-jwt` (la invoca el cron `apply-scheduled-employee-events` con
> `ADMIN_INVOKE_SECRET`). `set-employee-password` también está hoy en
> `verify_jwt: false`. Y `mv .env .env.bak` antes de desplegar.

---

## Fase 1 — ✅ INSTALADA en producción el 2026-08-24

Migración `20260825033558`. **Nada bloquea a nadie**: los cuatro interruptores
nacieron en `observar` y ahí siguen.

| | |
|---|---|
| `security_config` | 4 filas, las cuatro en `observar` · 5 policies · RLS activo |
| `export_log` | append-only · 3 policies · RLS activo |
| `sec_exige` / `sec_avisa` | `STABLE`, `search_path` fijo, `EXECUTE` revocado a `anon` |

### Se probó primero en el entorno de pruebas, y se le pidió que FALLE

`qvctarsqvlhbzgvwbbbt`, con `execute_sql` y todo dentro de `BEGIN…ROLLBACK`,
cambiando de rol de verdad (`SET LOCAL role authenticated` + el JWT simulado):
sin cambiar de rol, RLS ni se evalúa y la prueba no prueba nada.

**Los tres estados se distinguen** — que es la razón de que no sea un booleano:

| estado | `sec_exige` | `sec_avisa` |
|---|---|---|
| clave inexistente | false | false |
| `observar` | false | false |
| `avisar` | false | **true** ← anota sin bloquear |
| `exigir` | **true** | **true** |

**Y las policies niegan:**

| se intentó | resultado |
|---|---|
| que un NO-superusuario mueva un interruptor | **0 filas** cambiadas |
| anotar una salida a nombre de OTRO | rechazado |
| anotar una salida **sin dueño** (`employee_id` nulo) | rechazado |
| anotar la salida propia | **entró** ← si esto fallara, el registro no serviría |
| editar o borrar la propia fila del registro | **0 filas**, las dos |
| `anon` leyendo cualquiera de las dos tablas | **0 filas**, las dos |

Las dos últimas líneas de la tabla de arriba y la fila «anotar la salida propia»
están para que el resto signifique algo: **un control que sólo sabe decir que no
es tan inútil como uno que sólo sabe decir que sí.**

### Las once salidas ya escriben en el registro (mismo día)

Migración `20260825034152` + `src/data/egreso.js`.

**El registro NO recibe quién exporta**, y es la parte que no se puede saltear:
`export_log.employee_id` tiene que ser la **ficha** (`employees.id`) y el
navegador conoce la **cuenta** (`auth.users.id`). Para **33 de las 42 personas**
que usan el portal esos dos ids no son el mismo valor. Un `INSERT` que mandara
`session.user.id` habría sido rechazado por la policy **justamente para la
mayoría de la gente, y en silencio** — la línea base habría salido sesgada hacia
las nueve personas cuyos ids coinciden, sin que nada fallara. La firma la pone
`registrar_egreso` leyendo `auth_employee_id()` adentro.

| salida | módulo |
|---|---|
| Libros de IVA (CSV) · retención sobre ventas · ZIP del mes | `libros_iva`, `libros_iva_retencion` |
| Libro de compras completo · declarable | `libro_compras_completo`, `libro_compras_declarable` |
| ZIP de un DTE de venta · de compra · la descarga masiva | `dte_venta`, `dte_compra` |
| **Planilla del banco** | `planilla_banco` |
| Directorio de personal | `personal` |
| Asistencia por quincena | `asistencia` |
| Mín·Máx · Sin venta · Ventas perdidas · Ajuste de conteo | `minmax`, `inventario_sin_venta`, `ventas_perdidas`, `conteo_inventario` |

Dos cosas que aparecieron al cablearlo y que valen más que el cableado:

1. **Cuatro de las salidas no usaban el `exportCsv` canónico** — se armaban el
   CSV a mano, y entre ellas las dos más sensibles: la **planilla del banco**
   (nombre, banco y número de cuenta) y el **directorio de personal** (DUI,
   teléfono, fecha de nacimiento). Se les puso el registro donde están; migrarlas
   al canónico es otra decisión, porque el archivo del banco lo consume un banco
   y su formato no se toca de paso.
2. **La planilla anota `cuentas_visibles`.** Quien no puede aprobar se lleva los
   números de cuenta como `****`; sin ese dato las dos descargas se ven iguales
   en el registro y no lo son.

`exportCsv` ahora pide el módulo. Si falta, el archivo **se descarga igual**
—cortarle la descarga a alguien por un descuido de programación sería peor— pero
el egreso queda como `sin-declarar`, que es un hallazgo visible en la propia
tabla en vez de un hueco silencioso.

### El portal avisa solo cuando la línea base sirve

Migración `20260825035442`, cron `recordar-linea-base-egreso-mensual`
(día 1, 15:00 UTC = 9:00 SV). Un mes es exactamente el plazo en el que uno se
olvida, y sin este aviso el trabajo de hoy quedaría esperando a que alguien se
acuerde.

**Se apaga cuando alguien DECIDE, no cuando alguien lo LEE.** La condición de
corte es `security_config.techo_exportacion.updated_by IS NOT NULL`: las filas
nacieron sembradas por la migración, con autor nulo, así que un autor puesto
significa que una persona movió ese interruptor —en la dirección que sea, y
decidir que **no** va techo también es decidir—. Un aviso que se apaga al leerlo
vuelve a aparecer y se termina ignorando; uno que se apaga con la decisión
desaparece cuando el trabajo está hecho.

Verificado en el entorno de pruebas, los cinco casos:

| situación | avisos |
|---|---:|
| nadie exportó nada todavía | 0 |
| línea base de 1 día | 0 |
| **línea base de 31 días** | **1** |
| corrida repetida el mismo día | 0 |
| alguien ya movió el interruptor | 0 |

**Y la primera corrida de esa prueba dio 0 en el caso que tenía que avisar.** No
era el código: en el entorno de pruebas **nadie tenía el permiso**, así que todo
daba cero por falta de destinatario. Cero hallazgos y cero datos se ven igual —
hubo que darle un destinatario para que la prueba probara algo.

### Lo que falta de esta fase

**Un mes de datos**, y ahora el portal lo dice solo. El techo de la Fase 3.3 sale
de ahí y de ningún otro lado: el §1.3 de abajo explica por qué un umbral ingenuo
de volumen apagaría el portal —`fetchAllRows` pagina 20,000+ filas como
comportamiento normal—.

---

### El plan original de esta fase, para el registro

Nada bloquea todavía. Se instala lo que permite decidir con datos.

### 1.1 La tabla de interruptores

```sql
create table security_config (
  key         text primary key,
  estado      text not null default 'observar'
              check (estado in ('observar','avisar','exigir')),
  nota        text,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
alter table security_config enable row level security;
-- lectura: cualquier autenticado (las policies la consultan)
-- escritura: solo SUPERADMIN
```

Y el helper, **STABLE**, para que envuelto en `(SELECT …)` se evalúe una sola vez
por consulta y no por fila (CLAUDE.md §policies — es la diferencia entre 19ms y
25,000ms):

```sql
create or replace function sec_exige(p_key text)
returns boolean language sql stable
set search_path = public, extensions as $$
  select coalesce((select estado = 'exigir' from security_config where key = p_key), false);
$$;
```

Ojo: el `default false` importa. Si la fila no existe, **no exige**. Un control
mal escrito nunca deja a nadie afuera por accidente.

### 1.2 Registro de egreso

Tabla `export_log`: quién, qué módulo, cuántas filas, cuándo. Se escribe desde
cada exportación (CSV, ZIP de DTE, impresión masiva). Es puramente aditivo, no
bloquea nada, y es **la única forma de saber cómo se ve un mes normal** antes de
poner un techo. Sin esta línea base, cualquier umbral que elijamos es inventado.

### 1.3 Línea base de volumen

Acá hay una trampa específica de este proyecto: **el portal se comporta como un
scraper.** `fetchAllRows` pagina `products`, `inventory` y `product_stock_params`
de a 1000 filas — 20,000+ filas por carga es el **comportamiento normal** de la
aplicación. Un umbral ingenuo de "muchas filas = ataque" apaga el portal.

Lo que sí distingue: **qué tablas** barre una sesión, **en qué orden**, y si eso
coincide con los módulos que esa persona tiene asignados. Un cajero que lee
`proveedores` completo no está usando ninguna vista suya.

Durante esta fase sólo se **mide**. El umbral se elige en la Fase 3, con los
datos de este período.

---

## Fase 2 — Cerrar la lectura masiva (por tandas, con interruptor)

Hoy **54 tablas** son legibles enteras por cualquier cuenta autenticada. Incluyen
costos, precios, proveedores y las ventas de las 7 sucursales. Es el paquete que
se le lleva a la competencia.

La forma de la policy nueva — el `OR` es el interruptor:

```sql
create policy products_select on products for select to authenticated
using (
  not (select sec_exige('rls_comercial'))          -- apagado: pasa todo, como hoy
  or (select auth_has_module_permission('inventory','can_view'))
);
```

### El orden de las tandas sale de la medición, no del gusto

Conté cuántos archivos del frontend tocan cada tabla:

| tanda | tablas | archivos que las tocan | riesgo |
|---|---|---|---|
| **A** | `sales_daily_stats`, `wfm_snapshots`, `sales_alert_log`, `purchase_claim_lines`, `purchase_claim_rules`, `product_sales_rollup`, `product_sales_monthly_agg`, `product_last_sale`, `presentaciones`, `mv_refresh_state`, `espejo_conflictos` | **0** | mínimo |
| **B** | las ~30 con 1 sola referencia (`proveedores`, `metas_sucursal`, `ventas_perdidas`, `stock_config`, …) | 1 | bajo |
| **C** | `suppliers`, `sales_invoice_items`, `product_precios_history`, `holidays`, `employee_branches`, … | 2 | medio |
| **D** | `products` (12), `product_precios` (8), `roles` (4), `inventory` (4), `branches` (4) | muchos | alto |

**La tanda A no la lee ningún archivo del frontend.** Se cierra primero y casi no
puede romper nada.

**El catálogo compartido no se cierra**: `roles`, `branches`, `laboratorios`,
`presentaciones` los necesita medio portal para pintar cualquier selector. Ahí el
riesgo no es la fuga (no hay nada sensible en una lista de sucursales) — cerrarlos
sería puro costo sin beneficio.

### El detalle que puede morder: las 147 funciones INVOKER

De 367 funciones en `public`, **220 son SECURITY DEFINER** (se saltan RLS: cerrar
la tabla no las afecta) y **147 son INVOKER** (respetan RLS: si la policy cierra,
la función devuelve cero **sin lanzar error**).

Ese silencio es el peligro real de esta fase — es
[[feedback_un_rpc_invoker_reusado_para_otro_publico_devuelve_cero]]. Antes de
cerrar cada tanda:

```sql
-- ¿qué funciones INVOKER mencionan esta tabla?
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and not p.prosecdef
  and pg_get_functiondef(p.oid) ilike '%<tabla>%';
```

### Procedimiento por tanda

1. Instalar las policies **en `observar`** (nadie nota nada) — en ventana
   **06:00–11:59 UTC**, con `SET lock_timeout = '5s'`, **staging primero**
   (`cbnjplmnfmfsambavjce`).
2. En staging: poner `exigir` y barrer **cada vista** con la cuenta `pruebas` en
   varios roles. Anotar lo que se rompe. Arreglar.
3. En prod: `UPDATE security_config SET estado='exigir'` — un martes por la
   mañana, con alguien mirando.
4. Si algo se rompe: `UPDATE … SET estado='observar'`. **Segundos, sin migración,
   sin lock.**

Una tanda por semana. No hay apuro y el apuro es lo que rompe producción.

---

## Fase 3 — Contención (lo que limita el daño de una credencial robada)

Ordenado por relación valor/fricción.

### 3.1 Segundo humano en lo irreversible — fricción baja, valor alto

Ya existe el patrón (candado de doble decisión). Extenderlo a: escribir al ERP,
transmitir a Hacienda, anular facturas, **cambiar la contraseña de otro**, y
exportar masivo.

**Cómo no nos frena**: el aprobador es **cualquiera de N personas con el
permiso**, nunca una persona concreta. Nadie queda esperando a que alguien vuelva
de almorzar. Una IA con una credencial puede hacer una acción; no puede
convertirse en dos personas.

### 3.2 Dispositivo conocido — empieza **avisando**, no bloqueando

El patrón ya está hecho para el kiosco (`verify_kiosk_device` + `device_token`).
Llevarlo al portal, pero:

- **estado `avisar` para todos**: dispositivo nuevo → entrada en `audit_logs` +
  notificación al administrador. **No bloquea.**
- **estado `exigir` sólo para roles de alto privilegio** (SUPERADMIN, quien tenga
  `staff_list.can_edit`), y con un camino de aprobación de un minuto.

Así el personal de sucursal que cambia de teléfono no se queda afuera un sábado,
y la cuenta que puede hacer daño de verdad sí está atada a un aparato.

### 3.3 Techo de exportación

Con la línea base de la Fase 1 ya medida: por encima del techo la exportación no
se bloquea, **pide confirmación y queda anotada con el conteo**. Una IA puede
confirmar un diálogo, pero no puede evitar el registro — y el registro es lo que
convierte una fuga silenciosa en una fuga que se descubre el mismo día.

### 3.4 Sesiones y revocación

- Reducir la vida del refresh token (hoy Supabase por defecto es generoso).
- Un botón **"cerrar todas las sesiones de esta persona"** en la ficha del
  empleado. Hoy, si una credencial se filtra, no hay forma rápida de cortar.
  `disable-employee-auth` ya revoca refresh tokens: falta exponerlo como acción
  deliberada, no sólo como efecto de una baja.

---

## Fase 4 — Vigilancia continua

Un cron diario que revisa y **avisa**, nunca bloquea:

- cuentas activas sin actividad en 60 días (candidatas a baja),
- sesiones que leyeron tablas fuera de sus módulos asignados,
- exportaciones por encima de la línea base,
- dispositivos nuevos en cuentas de alto privilegio,
- actividad fuera del horario de la sucursal,
- **cambios en `security_config`** — si alguien apaga un control, eso mismo es la
  alerta.

Y un `npm run gate:seguridad` que falle si aparece una policy nueva con
`USING (true)` para `authenticated`, o una edge function que autorice leyendo
`user_metadata`. Es la lección de
[[feedback_la_regla_que_solo_vive_en_prosa_se_rompe]]: lo que no verifica una
máquina, se rompe solo.

---

## Cómo seguimos trabajando sin interrupción

**El personal de las farmacias**

1. Ningún control nace bloqueando. Todo entra en `observar`.
2. La marcha atrás es un `UPDATE`, no una migración: segundos, sin lock, sin
   ventana horaria.
3. Cada tanda se prueba en staging con la cuenta `pruebas` **antes** de prod.
4. Los cambios se encienden **martes por la mañana**, nunca un viernes ni a fin
   de mes (cierre contable).
5. El DDL va en **06:00–11:59 UTC** con `lock_timeout = '5s'`, porque los crons
   de sync corren `12-23,0-5`.

**Nosotros desarrollando**

6. `npm run dev:staging` para todo lo que sea probar estos controles. El `.env`
   del repo apunta a **producción**: probar ahí un control de seguridad es
   probarlo sobre la base de la que vive la empresa.
7. La sesión de trabajo con IA sobre la base va por **MCP con service_role**, que
   está fuera de RLS. Nada de este plan estorba el desarrollo — y conviene tenerlo
   presente al revés: **ese canal no está cubierto por ninguno de estos
   controles.** Su protección es que la llave vive en una sola máquina.
8. La cuenta `pruebas` es Gerente General en staging: sirve para verificar el
   camino permitido. Para verificar el camino **denegado** hace falta una segunda
   cuenta de rol bajo — crearla en staging en la Fase 1.

---

## Qué NO vamos a hacer, y por qué

| descartado | motivo |
|---|---|
| Bloquear por "puntaje de anomalía" | falsos positivos sobre gente trabajando; el costo cae en quien atiende al cliente |
| Límite duro de filas en PostgREST | el propio portal pagina 20,000 filas con `fetchAllRows`; se apagaría solo |
| MFA en cada ingreso | 7 sucursales, turnos rotativos, teléfonos compartidos. Reservarlo para roles de alto privilegio |
| Lista blanca de IPs | hay trabajo desde casa y datos móviles; deja gente afuera sin avisar |
| Intentar detectar "si es una IA" | presenta el mismo JWT que la persona. No hay señal fiable, y creer que la hay es peor que no tenerla |
| CAPTCHA | un agente moderno lo resuelve; sólo molesta a la persona |

---

## Resumen de esfuerzo

| fase | qué | esfuerzo | interrumpe |
|---|---|---|---|
| 0 | cortar la escalada | ~2h | **no** |
| 1 | interruptores + registro + línea base | ~1 día | **no** |
| 2 | cerrar 54 lecturas, 4 tandas | ~1 día + 4 semanas de reloj | sólo si falla staging |
| 3 | contención | ~3 días | fricción diseñada, medida |
| 4 | vigilancia + gate | ~1 día | **no** |

~~**Empezar por la Fase 0.**~~ ~~Lo siguiente es la **Fase 1**.~~ **Las dos,
hechas el 2026-08-24.**

Lo siguiente es **escribirle a `export_log` desde cada exportación** y dejar
pasar un mes. No es la Fase 2: sin línea base, el techo de la Fase 3.3 sería un
número inventado, y la Fase 2 —cerrar la lectura masiva— tiene su propia trampa
escrita en el §1.3, que es que este portal se comporta como un scraper por
diseño.

---

## Estado

- [x] **Fase 0** — `set-employee-password`, `disable-employee-auth` · **aplicada y verificada el 2026-08-24** (v35 / v10)
- [x] **Fase 1** — `security_config`, `export_log` y las **once salidas cableadas**, verificados el 2026-08-24 (`20260825033558`, `20260825034152`) · falta juntar un mes de línea base
- [ ] Fase 2A/2B/2C/2D — cierre de lecturas
- [ ] Fase 3 — contención
- [ ] Fase 4 — vigilancia

**Lo verificado el 2026-08-13**: policies de RLS (246 de lectura, 54 abiertas),
`verify_jwt` de las 51 edge functions (34 en `false`), guardas internos de 8 de
ellas, triggers de `auth.users` (ninguno), reparto DEFINER/INVOKER (220/147),
referencias del frontend a las 54 tablas.
**Lo NO verificado**: policies de Storage, expiración de sesiones configurada,
grants de las RPC, y el resto de las 26 edge functions con `verify_jwt: false`.
