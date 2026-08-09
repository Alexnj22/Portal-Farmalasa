# Plan — cerrar la autorización de la base (2026-08-09)

Cinco defectos encontrados al medir el alcance del bloqueo de personas
(v2.535.0). No son casos delicados que haya que rodear: son cosas que están mal
y tienen una forma correcta. El usuario lo pidió así — *«no lo rodees para no
romperlo, dime: esto está mal, debería ser de esta forma»*.

## De dónde salen

De las **252 policies** de `public`, **83 no preguntaban nada** — ni permiso ni
identidad. La [primera tanda](#ya-hecho) cerró 11 tablas inequívocas. Lo que
queda son los cinco defectos de abajo, más el resto de las 83.

## Ya hecho

| | |
|---|---|
| Bloqueo de personas + freno `RESTRICTIVE` en las 135 tablas | v2.535.0 |
| Tanda 1: 11 tablas sensibles cerradas por módulo | `20260809170811` |

---

## D1 · `cotizacion_items` acepta escrituras de cualquiera

**Está mal.** La policy es `FOR ALL` con `USING (auth.role() = 'authenticated')`.
No es sólo lectura: **cualquier persona con cuenta puede insertar, modificar o
borrar líneas de cualquier cotización**, sin permiso de Cotizaciones y sin que
quede rastro de por qué cambió el monto.

**Debería ser** dos policies separadas, como el resto del portal:

```sql
DROP POLICY cotizacion_items_authenticated ON public.cotizacion_items;

CREATE POLICY cotizacion_items_select ON public.cotizacion_items
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('cotizaciones','can_view')));

CREATE POLICY cotizacion_items_write ON public.cotizacion_items
  FOR ALL TO authenticated
  USING      ((SELECT public.auth_has_module_permission('cotizaciones','can_edit')))
  WITH CHECK ((SELECT public.auth_has_module_permission('cotizaciones','can_edit')));
```

**Antes de aplicar:** confirmar que `cotizaciones` es la ruta que escribe
(`App.jsx` la guarda con ese módulo) y revisar `cotizaciones` en `src/data/` por
si alguna escritura ocurre desde otra vista.

**Verificación:** con un cargo sin `cotizaciones`, un `INSERT` sobre
`cotizacion_items` tiene que fallar; con `can_edit`, pasar. En
`BEGIN…ROLLBACK`, con `SET LOCAL role authenticated`.

---

## D2 · Se puede falsificar la bitácora

**Está mal.** `audit_logs` tiene el INSERT **sin `WITH CHECK`**: cualquiera
inserta una entrada a nombre de otra persona. Ya estaba levantado en la
auditoría del 2026-07-30 y sigue abierto.

La tabla tiene `user_id` y `user_name`, y el cliente los manda en el payload
(`src/data/audit.js` → `.insert([logData])`). O sea que **la autoría la elige
quien escribe** — exactamente lo que la regla del repo prohíbe.

**Debería ser** que la autoría salga del JWT y no del payload:

```sql
DROP POLICY audit_logs_insert ON public.audit_logs;

CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT public.auth_employee_id()));
```

**Ojo — hay un camino que se rompe:** el kiosco y los procesos de servicio
escriben con `service_role`, que salta RLS y no se ve afectado. Pero **hay que
verificar** si alguna escritura desde el navegador manda un `user_id` distinto
del propio (por ejemplo, registrar una acción «en nombre de»). Si existe, ese
caso concreto va por un RPC `SECURITY DEFINER` que valide el permiso, no
relajando la policy.

**Verificación:** con la sesión de A, insertar un log con `user_id` de B tiene
que fallar; con el propio, pasar.

---

## D3 · La bitácora entera es legible, y el arreglo no es la policy

**Está mal.** `audit_logs` con `USING (true)`: cualquiera lee **quién hizo qué en
todo el portal** — quién aprobó, quién borró, quién cambió un precio.

**Lo que está mal de fondo NO es la policy**, y por eso esta corrección tiene un
paso previo. Dos vistas leen la tabla entera desde el navegador y filtran en el
cliente:

- `src/data/branches.js` → `fetchAuditLogsForBranch(branchId)` — `.eq('target_id', branchId)`
- `src/data/stockParams.js` → `fetchAuditLogsForProduct(...)` — `.in('action', …).eq('target_id', …)`

Cerrar la policy con `auditview` rompe el historial de sucursal y el de producto.
Pero **el defecto es que esas vistas consulten la bitácora global**: el filtro
por objeto tiene que estar del lado del servidor.

**Debería ser**, en este orden:

1. Un RPC `SECURITY DEFINER` por caso —`audit_log_de_objeto(p_target_id text,
   p_actions text[] DEFAULT NULL)`— que valide **el permiso de la vista que lo
   llama** (`branches` o `minmax`) y devuelva sólo el historial de ese objeto.
2. Cambiar las dos funciones de `src/data/` para usarlo.
3. Recién entonces:

```sql
DROP POLICY admin_read ON public.audit_logs;

CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('auditview','can_view')));
```

**Verificación:** el historial de una sucursal y el de un producto siguen
mostrándose para quien tiene esos módulos; un cargo sin `auditview` no puede
leer `audit_logs` directo.

---

## D4 · Los expedientes del personal están abiertos

**Está mal.** `employee_documents` y `employee_events` con `USING (true)`:
cualquier persona con cuenta lee los documentos y el historial de **cualquier**
empleado — incapacidades, amonestaciones, contratos.

**El matiz es real y no es excusa:** el autoservicio los lee también
(`src/data/employeeSelfService.js`, «Mis Documentos»). Así que la policy no es
«sólo el módulo», es **las propias O el módulo**. Las dos tablas tienen
`employee_id`, así que sale en una línea:

```sql
DROP POLICY employee_documents_select ON public.employee_documents;
CREATE POLICY employee_documents_select ON public.employee_documents
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT public.auth_employee_id())
      OR (SELECT public.auth_has_module_permission('staff_detail','can_view'))
      OR (SELECT public.auth_has_module_permission('emp_documents','can_view')));
```

…y lo mismo para `employee_events`, que además lo lee el enrutador de
aprobadores (`src/data/requests.js`) — **hay que verificar con qué identidad
corre** antes de cerrar; si es del navegador, entra en el `OR`.

**Verificación:** un empleado ve **sus** documentos y **cero** de otro; alguien
con `staff_detail` los ve todos.

---

## D5 · Hay dos definiciones de superusuario y no coinciden

**Está mal, y es la raíz de los otros.** El frontend corta con
`if (isSU) return true`, y ese `isSU` sale de **`roles.is_su`**. El servidor
—`auth_has_module_permission`— reconoce superusuario por
**`employees.system_role = 'SUPERADMIN'`**. Son columnas distintas y pueden
contradecirse: la cuenta del usuario es `is_su = true` con
`system_role = 'SUPERVISOR'`.

Ya costó una vista vacía (Conexiones, 2026-08-09) y se esquivó **dos veces** ese
mismo día otorgando permisos explícitos en vez de arreglarlo. Mientras sean dos
definiciones, **cada módulo nuevo vuelve a caer en la misma trampa**.

**Debería ser una sola.** La del servidor tiene que reconocer las dos formas:

```sql
CREATE OR REPLACE FUNCTION public.auth_has_module_permission(p_module_key text, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT
    COALESCE((SELECT public.auth_employee_system_role()), '') = 'SUPERADMIN'
    OR (SELECT public.auth_is_su())          -- ← lo que faltaba
    OR EXISTS ( … lo de hoy, sin cambios … );
$$;
```

**Por qué así y no al revés** (quitarle el atajo al frontend): el atajo del
frontend es el comportamiento que la gente ya conoce y el que la pantalla de
Permisos refleja. Cambiar el servidor para que coincida **amplía** —nadie pierde
acceso— mientras que cambiar el frontend se lo quitaría a quien hoy lo tiene.

**Esto toca un ayudante que usan 94 policies**, así que:

- Ensayo obligatorio en staging con la batería de casos: SU por `is_su`, SU por
  `system_role`, con módulo, sin módulo, y por rol secundario.
- `EXPLAIN` sobre una consulta con policy para confirmar que sigue dando
  `InitPlan` y no una evaluación por fila (regla del outage del 2026-07-08).
- Y **al cerrar, revisar si los permisos explícitos otorgados como rodeo
  sobran**: `sesiones` y `bloqueos` en el cargo 13. Si el arreglo es correcto, ya
  no hacen falta — y dejarlos puestos escondería que funcionó.

---

## D6 · Lo que queda de las 83

Después de la tanda 1 y de D1–D4, quedan abiertas por grupo. No son «catálogo»:
hay que decidir una por una y con el mismo método —quién la lee, con qué guarda
está la ruta—.

| Grupo | Tablas | Puerta probable |
|---|---|---|
| Precios y costos | `product_precios`, `_history`, `_changelog` | Lo lee media aplicación (Pedidos, Cotizaciones, Productos). Necesita mirar vista por vista; `productos_ver_costos` no alcanza |
| Ventas | `sales_invoice_items`, `_changelog`, `sales_*_resolutions`, `sales_payment_confirmations`, `sales_daily_stats`, `sales_alert_log` | `ventas` / `facturacion` |
| Compras | `purchase_claim_lines`, `_rules`, `proveedores`, `suppliers` | `compras` / `proveedores` |
| Metas | `metas_config`, `metas_sucursal` | `metas` |
| Inventario | `inventory`, `inventory_sync_log`, `product_stock_params`, `_history`, `minmax_ignored`, `espejo_conflictos` | `inventario` / `minmax` — **tablas calientes**, migración aparte |
| Personal | `employee_branches`, `schedule_coverage`, `wfm_snapshots` | `staff_list` / `schedules` |
| Otros | `ventas_perdidas`, `products_changelog`, `product_sales_*`, `product_last_sale`, `dashboard_canon` (+ su DELETE abierto) | por decidir |
| Catálogos — **se quedan abiertos** | `branches`, `roles`, `presentaciones`, `laboratorios`, `product_categories`, `product_active_principles`, `lab_locations`, `holidays`, `shifts`, `education_catalog_entries`, `erp_sucursal_map`, `module_locks`, `mv_refresh_state`, `stock_config`, `dispatch_rules`, `products` | Los necesita todo el portal y no son datos sensibles. **Es una decisión, no un olvido** |

Aparte, tres INSERT sin `WITH CHECK` que permiten escribir a nombre de otro:
`push_subscriptions`, `user_dashboard_prefs` y `pedidos_snapshots`. Los tres
tienen el SELECT/UPDATE/DELETE bien acotados al dueño — **el INSERT es el que
falta**, el mismo patrón que D2. Y `push_subscriptions` los tiene otorgados al
rol `public` en vez de `authenticated`.

---

## Orden, y por qué ése

1. **D5 primero.** Es la raíz: mientras haya dos definiciones de superusuario,
   cualquier cierre que haga puede dejar fuera a quien no debería, y lo vamos a
   descubrir en producción como ya pasó.
2. **D1 y D2** — directos, sin dependencias, y son agujeros de **escritura**,
   que pesan más que los de lectura.
3. **D4** — una línea por tabla, con el `OR` del autoservicio.
4. **D3** — pide el RPC de historial primero; es el único con refactor previo.
5. **D6** por grupos, empezando por Ventas y Compras y dejando Inventario para
   el final por ser tablas calientes.

## Reglas que este plan hereda y no negocia

- `SET lock_timeout = '5s'` en toda migración; tablas calientes en su propia
  migración y con reintentos.
- Toda llamada a `auth_*` dentro de una policy **envuelta en `(SELECT …)`** —
  regla del outage del 2026-07-08, verificada con `EXPLAIN`.
- Ensayo en staging (`ewcmerxqjvludtgskuin`) dentro de `BEGIN…ROLLBACK`, con
  `SET LOCAL role authenticated` y el JWT simulado por
  `set_config('request.jwt.claims', …)` — sin cambiar de rol, RLS ni siquiera se
  evalúa y la prueba no prueba nada.
- La puerta de cada tabla se elige **midiendo** quién la lee y con qué
  `PermissionGuard`, nunca por intuición.
- Cada tanda con su archivo de migración nombrado con la versión que devolvió el
  servidor, y `npm run gate:migrations -- --remote` al cerrar.

## Cómo se sabe que terminó

```sql
select count(*) from pg_policies
where schemaname='public' and policyname <> 'bloqueo_global'
  and coalesce(qual,'')||' '||coalesce(with_check,'') !~ 'auth_'
  and roles::text not like '%service_role%';
```

Ese número era **83**. Baja con cada tanda, y lo que quede al final tiene que
ser exactamente la lista de catálogos de D6 — enumerada, no residual.
