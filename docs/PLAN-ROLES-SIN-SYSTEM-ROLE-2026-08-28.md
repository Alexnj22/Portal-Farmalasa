# Plan — hacer fuertes los cargos y eliminar `system_role` (2026-08-28)

> **Decisión del usuario**, en sus palabras: *«la verdad system role no tiene
> sentido, para eso está el rol que es el cargo, al cual se le asignan permisos
> por vistas y cosas. mejor hagamos más fuertes los roles y eliminemos system
> role»*.

Estado: **auditado. Las dos decisiones están cerradas** (§5). Nada del plan
ejecutado todavía — lo único que ya pasó es el borrado de la cuenta técnica, que
lo pidió el usuario y cerró la decisión D2 por su cuenta.

---

## 1. Por qué se llegó acá

Un aviso nuevo tenía que llegarle a «Logística y Supervisión». Se resolvió
supervisión por `employees.system_role IN ('SUPERVISOR','ADMIN','SUPERADMIN')`
—que es lo que hace `auth_es_supervision()`— y el usuario lo cortó en el acto:
*«rutilio no es supervisor, celina no es supervisor»*.

Tenía razón, y la medición explica por qué:

| persona | cargo real | `system_role` |
|---|---|---|
| Rutilio Aleman | **Gerente General** | `SUPERVISOR` |
| Celina Escobar | **Jefe/a de Talento Humano** | `ADMIN` |
| EDWIN NUÑEZ | Supervisor/a de Ventas | `SUPERVISOR` |

`system_role` es un **rango**, no un puesto, y dice el rango **al revés del
organigrama**: marca `SUPERVISOR` a la cima de la empresa y `ADMIN` a un cargo
que cuelga de Administrador. Es la misma familia de
[[feedback_admin_es_un_area_no_un_rol]].

**El problema de fondo no es que esté mal cargado: es que dice dos veces algo
que ya está dicho una vez**, y por persona en vez de por cargo. Dos personas del
mismo cargo pueden tener rango distinto, y nada avisa cuál es el correcto.

---

## 2. La auditoría — dónde vive hoy

### 2.1 En la base

Barrido sobre **todos los esquemas** (funciones, policies, vistas, vistas
materializadas y triggers):

| clase | cuántos |
|---|---|
| funciones | **14** |
| vistas | **1** (`employees_safe`) |
| **policies** | **0** |
| triggers | **0** |
| vistas materializadas | **0** |
| claims del JWT (`custom_access_token_hook`) | **0** |

> ⚠️ **El barrido por nombre de columna NO alcanza, y por poco me lo pierdo.**
> Existe `auth_employee_system_role()`, un envoltorio que devuelve la columna, y
> varias migraciones de agosto lo usan **dentro de policies de
> `approval_requests`**. Buscar `system_role` en el texto de las policies no lo
> encuentra si la policy llama a la función. Se rebarrió por el nombre de la
> función: **hoy no la usa ninguna policy, ninguna vista y ninguna otra función
> — es huérfana.** Las policies que la usaban fueron reemplazadas por versiones
> posteriores. Se borra con el resto.

Las 14 funciones usan la columna para **cuatro preguntas, y sólo cuatro**:

| grupo | qué pregunta | funciones |
|---|---|---|
| **A · Llave maestra** | `= 'SUPERADMIN'` — se salta el permiso por módulo | `cancelar_envio`, `puede_confirmar_traslado`, `puede_enviar_producto`, `validar_envio_producto`, `recordar_linea_base_de_egreso`, `session_idle_limit_minutes` |
| **B · Supervisión** | `IN ('SUPERVISOR','ADMIN','SUPERADMIN')` — quien desempata | `auth_es_supervision`, `notificar_decision_diferencia`, `resolver_destinatarios_traslado` |
| **C · Jefatura de sala** | `IN ('JEFE','SUBJEFE')` — a quién se avisa de su sala | `notificar_resolucion_traslado`, `notificar_resolucion_envio`, `notificar_resolucion_movimiento_inventario` |
| **D · Aprobador de respaldo** | `IN ('ADMIN','SUPERADMIN')` | `asignar_aprobador_solicitud` |
| **E · Huérfanas** | lectura cruda | `auth_employee_system_role`, `employees_safe` |

### 2.2 En el código

**19 archivos**, mismos cuatro grupos:

| archivo | grupo |
|---|---|
| `src/data/requests.js` (×7) | D — `ADMIN_SYSTEM_ROLES`, y el enrutador por rango |
| `src/store/slices/requestsSlice.js` (×4) | B/C/D — la escalera de aprobación |
| `src/utils/decisionDiferencia.js` + `src/views/pedidos/TabPedidos.jsx` | B — `CARGOS_DE_SUPERVISION` |
| `src/views/dashboard/WidgetAnnulmentRequest.jsx`, `WidgetInventoryMovement.jsx` | D |
| `supabase/functions/_shared/security.ts`, `trasladar-pedido-erp`, `devolver-pedido-erp` | A |
| `supabase/functions/auto-copy-weekly-roster` | D (respaldo `ADMIN`/`SUPERVISOR`) |
| `supabase/functions/ensure_user_by_code` (×6) | copia el valor al metadata de la cuenta |
| `src/context/AuthContext.jsx`, `AppLayout.jsx`, `NoAccessView.jsx`, `AccessDeniedView.jsx` | sólo **rótulo en pantalla** |
| `supabase/functions/sync-products` | ya corregido hoy: lee el cargo |
| `check-sync-health-alerts`, `set-employee-password`, `tipoDeFicha.js` | falsos positivos (`systemRoleId` es otra cosa, o es un comentario) |

**El metadata de la cuenta es un cuarto sitio donde vive el valor**
(`ensure_user_by_code` lo copia a `user_metadata.systemRole`). No se usa para
autorizar —hay un comentario en `set-employee-password` que recuerda que una
sesión podía ponerse `systemRole: 'SUPERADMIN'` ahí— pero hay que limpiarlo o
queda un valor viejo que alguien va a creerse.

### 2.3 Los datos (49 fichas activas al momento de auditar; 48 después del borrado)

| valor | personas | cargos que lo llevan |
|---|---:|---|
| `EMPLEADO` | 35 | dependientes, bodega, servicios generales, regentes… |
| `JEFE` | 7 | Jefe/a de Sala (6) · Jefe/a de Compras y Logística (1) |
| `SUBJEFE` | 2 | **Regente de Enfermería** |
| `SUPERVISOR` | 2 | **Gerente General** · Supervisor/a de Ventas |
| `ADMIN` | 1 | **Jefe/a de Talento Humano** |
| `SUPERADMIN` | 1 | Superusuario del Sistema (cuenta técnica) — **borrada el 2026-08-28, ver §5.3** |
| *(sin valor)* | 1 | **Administrador** — Carlos Renderos |

---

## 3. Lo que ya existe en `roles` y alcanza

`roles` no es una lista de nombres: ya tiene organigrama y reglas.

```
Gerente General ─ Administrador ─┬─ Supervisor/a de Ventas ─ Jefe/a de Sala ─ Subjefe/a ─ Dependiente
                                 ├─ Jefe/a de Talento Humano
                                 ├─ Jefe/a de Compras y Logística ─ Asistente ─ Auxiliar de Bodega
                                 └─ Supervisor del Dpto. Médico ─ Regente de Enfermería
```

Columnas que ya decide el cargo: `parent_role_id`, `secondary_parent_role_id`,
`scope`, `max_limit`, `max_price_level`, `idle_limit_min`, `is_su`; más
`role_permissions` (módulo × ver/editar/aprobar × alcance).

### El hallazgo que vuelve barato todo el cambio

Los 7 Regentes de Enfermería están partidos —5 `EMPLEADO` y 2 `SUBJEFE`— y
parecía la peor decisión del plan: mismo cargo, dos rangos, y pasar a rango por
cargo obligaba a elegir uno y cambiarle el comportamiento a alguien.

**No hay nada que elegir.** Los dos marcados `SUBJEFE` —Alexander Melgar
(Salud 1) e Idalia Serrano (Salud 4)— **ya tienen `secondary_role_id =
Subjefe/a de Sala`**. O sea que el cargo ya dice exactamente lo que
`system_role` estaba repitiendo, y el mecanismo para expresarlo por cargo existe
y ya está bien cargado. `permisoDeModulo` ya lee los dos cargos.

Y `session_idle_limit_minutes` es el mismo caso: su rama `SUPERADMIN → 720 min`
es redundante porque el cargo *Superusuario del Sistema* ya tiene
`idle_limit_min = 720`. Se borra sin cambiar un minuto para nadie.

---

## 4. Lo que hay que agregar — una sola columna, y no es `is_su`

```sql
ALTER TABLE public.roles
  ADD COLUMN rango smallint NOT NULL DEFAULT 0;
```

> **Una sola columna, no dos.** El borrador de este plan agregaba también
> `llave_maestra` para reemplazar a `SUPERADMIN`. Al borrarse la cuenta técnica
> (§5.3) ese valor se quedó **sin un solo portador**, así que la columna nacería
> en `false` para los 24 cargos y no la leería nadie — que es exactamente el
> defecto que este proyecto ya se anotó una vez: *una decisión cerrada no es una
> decisión cableada*. Las seis funciones del grupo A pierden su rama
> `SUPERADMIN` como **código muerto**, sin sustituto. El día que haga falta una
> puerta de emergencia se agrega `roles.llave_maestra` con quien la vaya a tener,
> y se sabrá para qué.

**`rango`** es una escala **ordenada**, para que «de este nivel para arriba» se
escriba `>=` y no una lista de literales que hay que ir actualizando:

| rango | qué es |
|---:|---|
| 0 | colaborador |
| 1 | subjefatura de sala |
| 2 | jefatura (de sala o de área) |
| 3 | supervisión |
| 4 | dirección |

> **Y no se reusa `is_su` para nada de esto.** Hoy `is_su` es `true` en **dos**
> cargos —*Superusuario del Sistema* y *Supervisor/a de Ventas*— y significa otra
> cosa (a qué fichas se les esconde la cara en los listados). Reusarla habría
> sido un cambio de seguridad disfrazado de refactorización.

Y helpers, `STABLE` y pensados para envolverse en `(SELECT …)` como manda
CLAUDE.md:

```sql
public.auth_rango()            -- el mayor entre el cargo y el cargo secundario
public.rango_de_empleado(uuid)
```

---

## 5. La tabla de mapeo

| cargo | personas | `system_role` hoy | `rango` |
|---|---:|---|---:|
| Gerente General | 1 | `SUPERVISOR` | **4** |
| Administrador | 1 | *(sin valor)* | **4** |
| Jefe/a de Talento Humano | 1 | `ADMIN` | **4** |
| Supervisor/a de Ventas | 1 | `SUPERVISOR` | **3** |
| Supervisor del Dpto. Médico y Enfermería | 0 | — | **3** |
| Jefe/a de Compras y Logística | 1 | `JEFE` | **2** |
| Jefe/a de Sala | 6 | `JEFE` | **2** |
| Subjefe/a de Sala | 0 | — | **1** |
| Superusuario del Sistema | **0** | — | **0** |
| todos los demás (15 cargos) | 35 | `EMPLEADO` / — | **0** |

### Qué reproduce igual y qué cambia

| grupo | hoy | con el mapeo | ¿idéntico? |
|---|---|---|---|
| **A · llave maestra** | la cuenta técnica | **nadie** (la ficha se borró) | ✅ igual en la práctica: esa cuenta nunca inició sesión |
| **C · jefatura de sala** | 9 personas (7 `JEFE` + 2 `SUBJEFE`) | 9 personas (6 Jefe/a de Sala + 1 Compras y Logística + los 2 con cargo secundario Subjefe/a) | ✅ **igual** |
| **B · supervisión** | Rutilio · Edwin · Celina | rango ≥ 3 → Rutilio · Edwin · Celina · **Carlos** | ⚠️ entra Carlos |
| **D · aprobador de respaldo** | Celina | rango ≥ 4 → **Rutilio** · **Carlos** · Celina | ⚠️ entran dos |

### ✅ Las dos decisiones, cerradas

**D1 — Carlos Renderos entra.** Palabras del usuario: *«carlos renderos es
administrador y debe tener los permisos según administrador»*. Con el rango por
cargo eso pasa solo. Efecto lateral bueno: hoy el aprobador de respaldo es **una
sola persona** (Celina), y pasa a ser tres.

> Aparte, y anotado para que no se mezcle: el cargo *Administrador* hoy tiene
> **157 módulos, o sea todo** —*«por ahora tiene todos»*—. Si alguna vez hay que
> recortarlo, se hace en Permisos y no tiene nada que ver con este plan.

**D2 — resuelta borrando la cuenta, no eligiendo.** Ver §5.3.

### 5.3 La cuenta técnica se borró (2026-08-28)

Al explicarle qué era, el usuario respondió *«lo puedes eliminar, no tiene
uso»*. Se comprobó antes de tocarla, y estaba completamente aislada:

| comprobación | resultado |
|---|---|
| inició sesión alguna vez | **nunca** (cuenta creada el 11-jul) |
| solicitudes asignadas / firmadas | 0 / 0 |
| dispositivos donde recibir un aviso | 0 |
| filas que la referencian en toda la base | **1** — su propia fila de acceso |
| menciones en cualquier campo `json`/`jsonb` del esquema | **0** |

Se borraron **dos filas**: la ficha (`employees`, código 71015, usuario
`sufarmasalud`) y su credencial (`auth.users`, `71015@staff.local`). La fila de
`employee_auth_accounts` se fue en cascada. Verificado después: 0 accesos
huérfanos, 0 fichas con `SUPERADMIN`, 48 fichas activas.

**El cargo «Superusuario del Sistema» NO se borró.** Lo siembran dos migraciones
y se recrea solo al rehacer el entorno de pruebas; borrarlo rompería ese
sembrado. Queda sin nadie, que en efecto es lo mismo.

⚠️ **La credencial no se iba sola.** La ficha y su fila de acceso caen juntas por
la cascada, pero el usuario de autenticación vive en otro esquema y hay que
borrarlo explícitamente. Sin ese segundo borrado quedaba una credencial viva sin
ficha detrás — una cuenta que puede entrar y a la que el portal ya no le conoce
la cara.

---

## 6. La red de seguridad: la tabla de equivalencia

**Antes de tocar nada** se congela, en el scratchpad, el veredicto **actual** de
las cuatro preguntas para las 46 fichas activas y las 8 salas:

```sql
-- por persona: llave maestra, supervisión, jefatura, respaldo
-- por sala:    a quién avisa cada una de las 4 funciones de notificación
```

Después de cada migración se vuelve a correr y **se enfrenta contra la foto**.
Toda diferencia tiene que estar en la tabla de §5 — si aparece una que no está,
el paso se revierte. Es el mismo método con el que se validaron
`_shared/distrito.ts` (25,946 casos, 0 distintas) y `turno_del_dia` (los 16 que
importan, 0 distintas): **no alcanza con que el código nuevo se lea bien; tiene
que decidir lo mismo.**

---

## 7. El orden de los pasos

> ⚠️ **Acá NO vale «la base primero».** La regla de siempre —migrar la base antes
> de pushear el frontend— se escribió para columnas que se AGREGAN. Para una que
> se BORRA el orden es al revés: si la columna desaparece antes de que el código
> deje de pedirla, todo `select` que la nombre falla. `employees_safe` y
> `COLUMNAS_PERSONA` de `requestsSlice.js` la piden por nombre.

| # | paso | se puede revertir |
|---|---|---|
| **1** | Agregar `rango` y `llave_maestra` + poblarlas con la tabla de §5. **Nadie las lee todavía.** | sí, sin efecto |
| **2** | Crear los tres helpers (`auth_rango`, `auth_es_llave_maestra`, `rango_de_empleado`). | sí |
| **3** | Congelar la tabla de equivalencia (§6). | — |
| **4** | Borrar la rama `SUPERADMIN` de las 6 funciones del **grupo A**: hoy es código muerto, no tiene portador. Enfrentar. | sí |
| **5** | Reescribir las 3 del **grupo C** (jefatura). Enfrentar. | sí |
| **6** | Reescribir las 3 del **grupo B** (supervisión) y la del **D**. Enfrentar. **Acá aparecen las diferencias de §5, y tienen que ser exactamente ésas.** | sí |
| **7** | Código: los 19 archivos. `CARGOS_DE_SUPERVISION` y `ADMIN_SYSTEM_ROLES` pasan a preguntar por rango. Los cuatro de pantalla muestran el **cargo**, que es lo que la gente reconoce. | sí |
| **8** | `ensure_user_by_code` deja de copiar el valor al metadata. | sí |
| **9** | Sacar `system_role` de `employees_safe`. | sí |
| **10** | `DROP FUNCTION auth_employee_system_role()` — huérfana. | sí |
| **11** | `ALTER TABLE employees DROP COLUMN system_role` | **NO** |
| **12** | Categoría nueva en `gate:data`: `system_role` no vuelve. | — |

Los pasos 1–10 son reversibles y se pueden entregar de a uno. **El 11 se hace
solo, en un commit propio, y sólo después de que el 12 esté en verde y de que
pase una semana sin reclamos.** No hay apuro: una columna que nadie lee no
molesta.

### Cómo se prueban

Cada migración va primero al branch de pruebas **con `execute_sql`, nunca con
`apply_migration`** (ver CLAUDE.md: una fila huérfana en su `schema_migrations`
mata el `rebase_branch` para siempre). Y como el branch está **130 migraciones
atrasado**, hay que rehacerlo antes de creerle a una medición.

`employees` y `roles` **no** están en la lista de tablas calientes
(`sales_invoices`, `sales_invoice_items`, `inventory`, `products`), así que el
DDL no compite con los crons de cada minuto. Igual va con `SET lock_timeout =
'5s'`, como toda migración del proyecto.

---

## 8. Las trampas conocidas

1. **Un envoltorio esconde la columna.** `auth_employee_system_role()` hizo que
   el barrido por nombre de columna diera 0 policies cuando había policies
   escritas con la función. Hoy resultó huérfana, pero el método correcto es
   barrer **la columna y todos sus envoltorios**.
2. **El rango del cargo secundario cuenta.** `auth_rango()` tiene que tomar el
   **mayor** entre `role_id` y `secondary_role_id`, o Alexander e Idalia pierden
   su subjefatura en silencio. Es exactamente el caso que hoy funciona.
3. **`ADMIN` no es «administración».** Es un valor de rango, no un área. Al
   reescribir los avisos, el destinatario se nombra por cargo.
4. **Los cuatro archivos de pantalla no son autorización**, sólo rótulo. Se
   migran igual, pero no arriesgan permisos: `AppLayout` traduce `ADMIN →
   "Administrador"`, y con el cargo eso sale mejor y sin diccionario.
5. **`ensure_user_by_code` corre en el login por código.** Tocarlo mal deja a la
   sala sin poder entrar. Va en un paso propio y se prueba con una cuenta real
   antes de cerrarlo.

---

## 9. Lo que este plan NO toca

- **`is_su`** — está sobrecargada («tiene poderes» mezclado con «no es una
  persona») y ya se le sacó una parte con `tipo_ficha`. Es otro trabajo.
- **`role_permissions`** — el sistema de permisos por módulo no cambia. Es el
  que ya funciona bien y el que el usuario quiere reforzar.
- **La escalera de aprobación en sí** — se cambia de qué columna sale, no cómo
  escala. Cambiar los niveles es otra decisión.
- **La lista cerrada de `system_role`** — se hablaba de ponerle un CHECK.
  Ya no: la columna se va.

---

## 10. Costo

| paso | tamaño |
|---|---|
| 1–3 (columna, helpers, foto) | 1 migración + 1 script de medición |
| 4–6 (13 funciones, 3 tandas) | 3 migraciones, cada una con su enfrentamiento |
| 7 (19 archivos) | el más largo, pero mecánico |
| 8–12 | 1 migración + 1 categoría de gate |

**5 migraciones y 19 archivos**, entregables de a uno, con marcha atrás en todos
menos el último.
