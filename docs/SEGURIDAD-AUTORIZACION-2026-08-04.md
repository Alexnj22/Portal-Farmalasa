# Autorización — qué se cerró y dónde retomar (2026-08-04)

## Estado en una línea

**El agujero grande está cerrado y verificado en producción.** Lo que queda es un
barrido del mismo patrón —*confiar en un dato que manda el cliente*— en el resto
de la superficie: los RPC que reciben identidad por parámetro.

---

## Cómo apareció

El usuario reportó que al entrar con usuario y contraseña salía
«Usuario no encontrado en el sistema.» y **acto seguido el portal abría igual**.

Ese síntoma era un bug chico, pero tirando del hilo apareció otro mucho mayor. Los
dos ya están cerrados (v2.370.4 y v2.371.0).

---

## Lo que quedó hecho

### 1. El bug del login — `v2.370.4`

`employees_select` escondía a todo empleado con un cargo `roles.is_su = true`
**sin exceptuar al titular**. Como `loginWithUsername` lee su propio perfil de
`employees_safe` (vista `security_invoker`, o sea con RLS), recibía 0 filas.

La sesión ya estaba creada por `signInWithPassword` una línea antes, y el perfil lo
terminaba armando el otro camino (`ensure_user_by_code`, service_role, sin RLS): de
ahí el error seguido del ingreso.

La policy ahora lleva `OR id = (SELECT auth_employee_id())` — uno siempre se ve a sí
mismo. Migración `20260804165205`. Verificado en las dos direcciones: el titular se
ve (1 fila), otro empleado no lo ve (0 de 49 visibles).

### 2. El hallazgo real — `v2.371.0`

**Siete funciones decidían permisos leyendo `user_metadata` del JWT**, que el propio
navegador escribe con `supabase.auth.updateUser({ data })`. La prueba de que el
cliente puede escribirlo no hubo que buscarla afuera: el portal mismo lo hace en
`LoginView.jsx:356`.

| Función | Qué leía del metadata |
|---|---|
| `auth_has_module_permission` | `systemRole = 'SUPERADMIN'` → acceso total |
| `auth_can_edit_any` | ídem |
| `auth_can_edit_scope_all` | ídem |
| `auth_employee_id` | `code` → **qué empleado sos** |
| `auth_employee_role_id` | ídem |
| `auth_employee_secondary_role_id` | ídem |
| `auth_employee_branch_id` | ídem |

Medido en producción **antes** de tocar nada, con la cuenta del empleado código 163
(cargo 30, Dependiente de Farmacia):

```
metadata REAL                              → auditview/can_view = false, can_edit('compras') = false
metadata + {"systemRole":"SUPERADMIN"}     → auditview/can_view = TRUE,  can_edit('compras') = TRUE
```

Una llamada desde la consola del navegador alcanzaba. No hacía falta pasar por
ninguna edge function.

`ensure_user_by_code` tenía la otra mitad: con **cualquier** sesión válida aceptaba
el `code` de otro empleado, devolvía su perfil completo (nombre, cargo, sucursal,
teléfono, correo) y además le copiaba `roleId`/`systemRole`/`branchId` **al metadata
de quien preguntaba** — que es como se conseguía el `SUPERADMIN` sin escribirlo a
mano.

**Cómo quedó:**

- La identidad sale de `auth.uid()` (claim firmado, no manipulable) y, para las
  cuentas de kiosco/carné cuyo uid no es el del empleado, de la tabla nueva
  `employee_auth_accounts` — solo `service_role` escribe en ella. Migración
  `20260804170358`, poblada con 29 vínculos.
- El bypass de superadministrador lee `employees.system_role` de la tabla, vía la
  función nueva `auth_employee_system_role()`. Migración `20260804170500`.
- El correo tampoco participa: las 50 cuentas del portal tienen `uid = employees.id`
  por construcción (`bulk-create-employee-users` y `set-employee-password` llaman a
  `createUser` con `id: employee.id` — verificado).
- `ensure_user_by_code` (v48 desplegada) con sesión ignora el `code` del cuerpo y
  resuelve por el token. El camino **sin** sesión sigue igual: es el único que de
  verdad necesita el código, y solo devuelve el correo con el que completar el
  ingreso, nunca datos del empleado.

**Verificación:**

| Prueba | Resultado |
|---|---|
| Permisos de las 86 cuentas × 6 módulos contra la fuente de verdad | 516/516 correctos |
| Cuentas que cambian de empleado resuelto | 0 de 86 |
| Suplantación: metadata falsificado / código ajeno / correo ajeno | 4/4 rechazadas |
| Contra la función desplegada, con sesión real de la cuenta QA | devuelve su propio perfil |
| Advisor de seguridad de Supabase | 0 errores |

El **único** cambio de comportamiento en todo el padrón: `71015@staff.local` (la
cuenta de carné del Administrador del Sistema) pasó a tener el bypass que su
`system_role` real siempre dijo. Antes no lo tenía solo porque su metadata estaba
vacío — y en cuanto hubiera entrado una vez, la función se lo habría escrito.

---

## Pendientes, por urgencia

### 1. El mismo patrón en los RPC que reciben identidad por parámetro

**No barrido.** Es la razón principal de esta nota.

Las funciones `auth_*` ya no aceptan identidad del cliente, pero cualquier RPC que
reciba un `p_employee_id` / `p_user_id` / `p_code` y lo use **sin cruzarlo contra
`auth_employee_id()`** tiene la misma forma del bug: el cliente elige de quién son
los datos. Es [[feedback_rpc_authorship_never_trust_client_param]] a escala.

Punto de partida sugerido (no ejecutado):

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
  and pg_get_function_identity_arguments(p.oid) ~* '(employee|user|staff)_id|p_code'
order by p.proname;
```

Para cada una: ¿el parámetro decide **de quién** son los datos que devuelve o
escribe? Si sí, tiene que contrastarse contra `auth_employee_id()` adentro, no
confiar en lo que llegó.

### 2. La UI todavía lee `user_metadata` — cosmético, no es un agujero

Los 4 usos que quedan en `src/` están todos en `AuthContext.jsx` (líneas 439, 486,
569, 655) y ninguno gobierna permisos: derivan el `code` para llamar a
`ensure_user_by_code` (que ahora lo ignora cuando hay sesión) y leen
`must_change_password` / `kiosk` para el flujo de contraseña temporal.

Alguien que se falsifique el metadata puede hacerse aparecer botones de más. La base
rechaza cada operación, así que el daño es visual y solo contra uno mismo. **No
urgente, pero conviene**: la UI debería pintarse con lo que devuelve
`ensure_user_by_code`, no con el token.

### 3. Cuentas huérfanas en `auth.users`

Detectadas al mapear identidades, sin tocar:

- **6 cuentas `@staff.local`** de pruebas de marzo/mayo 2026 (`emp001`, `emp002`,
  `710`, `celina`, `0lc2p1kj`, `ku59apf9`) que no resuelven a ningún empleado ni por
  correo ni por metadata. Hoy no tienen permisos; son ruido.
- **2 cuentas `@farmalasa.app`** sin empleado: `empleado.prueba` y `carlos.renderos`.

Ninguna es un riesgo activo — ninguna resuelve a un empleado, así que ninguna tiene
permisos. Pero una cuenta que puede autenticarse y no corresponde a nadie no debería
existir. Decidir si se borran.

### 4. De la misma familia, ya abiertos en otras notas

Conviene mirarlos en la misma pasada, porque son todos "la autorización no está
donde debería":

- `attendance` y `audit_logs` aceptan **cualquier fila de cualquier usuario
  autenticado** (`WITH CHECK (true)` en el INSERT): se puede fabricar una marcación
  y falsificar la bitácora. Ver `AUDITORIA-COMPLETA-2026-07-30.md`.
- `employees.is_admin`: la columna se eliminó y tres funciones de
  `src/data/requests.js` la siguen consultando — son los fallbacks del enrutador de
  aprobadores, así que una solicitud puede quedarse **sin aprobador**. Misma nota.
- `staff_salary`: la pantalla ofrece un control de "datos sensibles" que no existe en
  ninguna capa; el salario viaja al navegador de cualquiera que abra el expediente.
  Decisión del usuario del 2026-08-03: dejarlo por ahora. Lo marca
  `npm run gate:data` en cada commit.
- La cuenta QA de CI tiene permisos **de todos los módulos** desde el 2026-07-25
  (se ampliaron para una auditoría visual). El motivo original de que fuera mínima
  era el blast radius si se filtra el secret de CI. Está pendiente decidir si se
  revierte — no decidirlo sin preguntar.

---

## Herramientas de verificación (reutilizables)

Lo que sirvió acá y va a servir para el barrido pendiente.

### Simular el JWT de un usuario, sin escribir nada

```sql
begin;
  perform set_config('request.jwt.claims',
    json_build_object('sub', <uid>, 'role','authenticated', 'email', <correo>,
                      'user_metadata', <jsonb>)::text, true);
  -- ... llamar acá las funciones auth_* o los RPC a probar ...
rollback;
```

**Trampa que costó una medición entera:** hacerlo con `set_config` dentro de un
`SELECT`/`LATERAL` **no funciona** — el planner reordena y todas las filas terminan
evaluándose con el último claims aplicado. Las dos huellas no coincidían por eso, no
por el cambio. Va en un bloque `DO $$ ... $$` con un `for ... loop`, donde el orden
sí es determinista.

### Verificar contra la fuente de verdad, no contra el comportamiento anterior

Cuando lo viejo estaba mal, comparar antes/después solo dice "cambió". Lo que hay que
comparar es el resultado nuevo contra el cálculo directo sobre las tablas:

```
esperado = (employees.system_role = 'SUPERADMIN')
        OR exists(role_permissions del role_id ...)
        OR exists(role_permissions del secondary_role_id ...)
```

Eso es lo que dio 516/516 y es la prueba de que ningún empleado perdió ni ganó
permisos por accidente.

### Barrido de lecturas de metadata

```sql
-- funciones
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.prokind='f' and pg_get_functiondef(p.oid) ilike '%user_metadata%';

-- policies (acá dieron 0: lo heredaban por las funciones, no lo leían directo)
select polrelid::regclass::text, polname from pg_policy
where coalesce(pg_get_expr(polqual,polrelid),'')      ilike '%user_metadata%'
   or coalesce(pg_get_expr(polwithcheck,polrelid),'') ilike '%user_metadata%';
```

Los dos deben seguir dando **cero**. Si alguno vuelve a dar filas, se reintrodujo el
bug.
