# Plan de blindaje ante un tercero — sin frenar el trabajo diario

**Fecha**: 2026-08-13 · **Estado**: propuesto, nada aplicado
**Origen**: medición de la superficie real de producción (`sacecdkdmsdvgqnrsett`) el 2026-08-13.

---

## Medido contra producción — 2026-08-24

**Once días después: las cinco fases siguen en cero.** Y este archivo **nunca se
commiteó** — vivía sólo en el árbol de trabajo, o sea a un `git checkout` ajeno
de desaparecer, que es exactamente el riesgo que CLAUDE.md describe para un árbol
compartido.

Remedido hoy con mi propio criterio (no el del 13-ago, así que los números no son
comparables directamente): **67 policies** de `public` dejan leer sin preguntar
por ningún `auth_*` y sin ser de `service_role`. La Fase 0
—`set-employee-password` / `disable-employee-auth`, la única que hoy permite
tomar cualquier cuenta del portal— sigue sin tocarse.

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

## Fase 0 — Cortar la escalada de privilegios (hoy, impacto cero)

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

## Fase 1 — Ver antes de cerrar (una semana, impacto cero)

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

**Empezar por la Fase 0.** Es la única que hoy permite tomar cualquier cuenta del
portal, se arregla en dos horas y no la nota nadie.

---

## Estado

- [ ] Fase 0 — `set-employee-password`, `disable-employee-auth`
- [ ] Fase 1 — `security_config`, `export_log`, línea base
- [ ] Fase 2A/2B/2C/2D — cierre de lecturas
- [ ] Fase 3 — contención
- [ ] Fase 4 — vigilancia

**Lo verificado el 2026-08-13**: policies de RLS (246 de lectura, 54 abiertas),
`verify_jwt` de las 51 edge functions (34 en `false`), guardas internos de 8 de
ellas, triggers de `auth.users` (ninguno), reparto DEFINER/INVOKER (220/147),
referencias del frontend a las 54 tablas.
**Lo NO verificado**: policies de Storage, expiración de sesiones configurada,
grants de las RPC, y el resto de las 26 edge functions con `verify_jwt: false`.
