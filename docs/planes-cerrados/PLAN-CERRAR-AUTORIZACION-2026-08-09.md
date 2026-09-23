# Plan — cerrar la autorización de la base (2026-08-09)

> ## ✅ CERRADO el 2026-09-23
>
> Remedido contra producción ese día: el criterio de salida (§«Cómo se sabe que
> terminó») pasó de **83** a **26 policies en 22 tablas**, y las 26 están
> enumeradas y decididas —ya no hay ninguna «residual»—:
>
> | grupo | tablas | por qué queda sin `auth_` |
> |---|---|---|
> | catálogos que usa todo el portal | `branches`, `roles`, `role_permissions`, `presentaciones`, `laboratorios`, `holidays`, `shifts`, `erp_sucursal_map`, `module_locks`, `products`, `product_precios` | no son datos sensibles; el COSTO de `product_precios` se cerró por columna (regla 5) |
> | configuración de la pantalla | `banner_portal`, `dashboard_canon`, `security_config` | la lee cualquier sesión para pintarse |
> | protegidas por su tabla madre (`EXISTS`, hereda su RLS) | `bolsa_faltante`, `bolsas_eventos`, `bolsas_movimientos`, `envio_linea`, `cotizacion_items` (lectura), `employee_branches` | se ve lo que se puede ver de la madre |
> | propias de cada uno | `push_subscriptions` | por identidad (`auth.email()`), sólo `authenticated` |
> | cerrada del todo | `puntos_codigo_acceso` | `false`: nadie la lee |
>
> D1 (escritura de renglones de cotización) cerrado en `20260923224621`; D3 y
> D4 antes; D5 ya estaba (`auth_has_module_permission` reconoce `auth_is_su`);
> D6 en las tandas del 22 y 23-sep más las reglas 1–6 de la Fase 2 y el costo
> (producto, línea de venta y valorizado del conteo). Cada tanda se midió por
> cargo antes y después: nadie perdió una pantalla que usara.
>
> **Si una tabla nueva aparece en la consulta de abajo, no es «lo que quedó»:
> es una tabla que nació abierta.** Decidirla con el mismo método o sumarla a
> esta lista con su motivo.

Cinco defectos encontrados al medir el alcance del bloqueo de personas
(v2.535.0). No son casos delicados que haya que rodear: son cosas que están mal
y tienen una forma correcta. El usuario lo pidió así — *«no lo rodees para no
romperlo, dime: esto está mal, debería ser de esta forma»*.

> **Medido contra producción el 2026-08-24 — el plan avanzó, no cerró.** Su propio
> criterio de salida (§«Cómo se sabe que terminó») da hoy **70**, contra las 83 del
> arranque: 13 cerradas. De los defectos con nombre, **D3 y D4 están cerrados** —
> `audit_logs`, `attendance`, `employees`, `employee_events` y `timesheets` tienen
> hoy `auth_` en todas sus policies, incluidos los INSERT que aceptaban cualquier
> fila—. **D1 sigue abierto tal cual**: `cotizacion_items_write` es `FOR ALL` y no
> pregunta nada. D6 —el resto de las 83— es el grueso de las 70 que quedan.

> **Remedido y re-decidido el 2026-09-22.** Regla del usuario, que manda sobre
> todo lo de abajo: *«cada uno debe tener acceso solo a lo suyo, sin nada más»* —
> y la condición: *«confirma que no quite información o acceso»*.
>
> 555 policies en `public`; **73** no preguntan nada, pero no son 73 problemas:
>
> | grupo | cuántas | qué se hace |
> |---|---:|---|
> | catálogos que toda pantalla necesita (sucursales, cargos, permisos, feriados, productos, presentaciones, laboratorios, faltas, encuestas…) | ~30 | **nada** — se declaran intencionales |
> | protegidas por su tabla madre vía `EXISTS` (bolsas, solicitudes, cotizaciones) | ~6 | nada; D1 se revisa aparte |
> | **datos que no son de todos** | ~35 | se cierran, en dos fases |
>
> **Fase 1** — tablas chicas y frías, con pocos lectores: historiales de cambios
> (precios, productos, facturas, MIN·MAX), resoluciones de facturación,
> `espejo_conflictos` (datos de clientes), ventas perdidas, estadísticas
> mensuales, reglas de reclamo, WFM, `inventory_sync_log`, metas.
>
> **Fase 2** — las grandes y calientes: `sales_invoice_items` (594k),
> `inventory`, `product_precios` (costos), `product_stock_params`,
> `sales_daily_stats`, `product_sales_*`. Las leen hasta 22 funciones INVOKER:
> el acceso tiene que ser la unión de todos esos módulos. Staging primero y
> ventana 06:00–11:59 UTC (tablas calientes).
>
> **El método, por tabla, para no quitarle a nadie lo que usa:**
> 1. todos los lectores: `.from()` directo, embebidos en otro `select`,
>    funciones INVOKER y vistas `security_invoker`;
> 2. la policy nueva = `can_view` en la unión de los módulos que abren esas
>    pantallas, con el alcance de sala si la pantalla lo recorta;
> 3. medir filas visibles por cargo antes y después en una transacción con
>    rollback: **igual** para todo cargo con alguno de esos módulos, **0** para
>    los demás. Si un cargo que usa la pantalla pierde una fila, no se aplica.

> **Tanda 1 aplicada el 2026-09-22** (`20260922231032`, v2.1034.0): 24 tablas.
> Cinco sin ningún lector desde el navegador quedan cerradas
> (`espejo_conflictos`, `purchase_claim_lines`, `purchase_claim_rules`,
> `wfm_snapshots`, `sales_alert_log`); las otras 19 pasan a `can_view` del
> módulo de las pantallas que las leen. Medido por cargo antes, simulado y
> después: 288 combinaciones tabla·cargo, **0 diferencias** entre lo simulado y lo
> real, **ningún cargo perdió filas a medias**, y los 89 casos que pasaron a 0
> son cargos sin permiso para esa pantalla (cruzado contra `role_permissions`).
>
> **Tanda 2 aplicada el 2026-09-23** (`20260923143952`, v2.1034.1). Recorte por
> SALA en `sales_invoice_changelog` y `ventas_monthly_stats`: `ventas` es el único
> módulo de la tanda 1 con cargos de alcance de sala; minmax, metas, inventario y
> sync_health sólo los tienen cargos ALL, así que ahí no había nada que recortar.
> Jefe/a de Sala pasa de 14,154 a 972 filas de cambios de factura (su sala), que
> es lo que su pantalla ya pedía. `inventory_sync_log` pasa a Inventario o
> Actualización de datos, y el recuadro «Datos» del menú sólo se dibuja con uno
> de esos permisos (decisión del usuario); la campana de al lado sigue para todos.
>
> **Fase 1 terminada.**
>
> **Fase 2 — reglas aprobadas por el usuario el 2026-09-23** (mapa de lectores
> completo en la conversación de ese día; el resumen, acá):
>
> | # | datos | regla |
> |---|---|---|
> | 1 | `sales_invoice_items` | cada sala sólo la suya: heredar la visibilidad de `sales_invoices` (`EXISTS` sobre la factura, con atajo para alcance ALL) |
> | 2 | `sales_daily_stats`, `product_sales_*`, `product_last_sale`, `inventory_daily` | por sala / por módulo, igual que las facturas |
> | 3 | `inventory` | por la UNIÓN de módulos, **sin** recorte por sala: la consulta de inventario, pedir/enviar traslado y faltantes con stock en otra sala miran las otras salas por diseño |
> | 4 | `product_stock_params` | igual que el inventario (los traslados miran el MIN de la otra sala) |
> | 5 | `product_precios.costo` | sólo con «ver costos»: quitar el SELECT de la columna y pasar a DEFINER con su chequeo las 6 funciones que la leen; `TabCatalogo` deja de pedirla sin el permiso |
> | 6 | catálogos de un módulo | a su módulo |
>
> **Tanda 3 aplicada el 2026-09-23** (`20260923165044`): regla 6 — encuestas,
> principios activos, ubicaciones de producto y de laboratorio, categorías,
> opciones de diferencia, faltas disciplinarias y clases de dispensación, a su
> módulo (lectura = lectura ∪ escritura del módulo, para no romper un DELETE); y
> `mv_refresh_state`, `inventory_sync_huella` y `puntos_config` cerradas. Quedan
> `education_catalog_entries` y `suppliers`/`proveedores` (otras policies los leen).
>
> **Reglas 1–4 aplicadas el 2026-09-23, de día y sin caída** (decisión del
> usuario: «si se puede hacer ahora mejor, sólo que no se caiga el sistema»):
> `20260923165357` detalle de ventas, `…165548` estadísticas, `…165800`
> inventario, `…165839` MIN·MAX. Método: una tabla por vez, `lock_timeout` de
> 2 s, sin consultas largas antes, y después 5xx por minuto (0 en todos) y
> medición como usuario. Jefe/a de Sala: 0 líneas de venta de otra sala (antes
> todas), ranking de productos igual (10 filas, 83 ms); inventario visible para
> todos los cargos con alguna pantalla que lo usa (el único 0 de dependiente era
> una persona bloqueada); `gate:perf` en verde.
>
> ✅ **Regla 5 (costos) aplicada el 2026-09-23** en tres pasos: `…211841`
> (`get_precios_con_costo` + Ventas→Productos, resumen de costo de MIN·MAX y Sin
> venta envueltas en DEFINER con alcance y costo en NULL sin permiso), v2.1035.6
> (el Catálogo deja de leer la columna), `…212306` (SELECT por columna, sin
> `costo`, en `product_precios` y `product_precios_history`). Medido antes/después
> como usuario: QA y Compras idénticos al centavo; una sala ve lo mismo sin la
> columna de costo. 0 errores de permiso en el log después del cierre.
>
> ✅ **Cerrado el resto el mismo 2026-09-23:**
> - `…213806`: `education_catalog_entries` (Personal/Expediente),
>   `proveedores` (Laboratorios, MIN·MAX) y `suppliers` (Laboratorios, Compras,
>   Proveedores, Facturas de compra, Promociones). Medido por cargo: sólo quedan
>   en 0 los que no tienen ninguna de esas pantallas.
> - `…214234`: `sales_invoice_items.costo_unitario/costo_origen/costo_ambiguo`
>   por columna. Nada del navegador lo leía.
> - `…214627` + v2.1036.2 + `…215032`: el valorizado del conteo con su propio
>   permiso, «Ver el valorizado» (`conteo_inventario_ver_montos`), también en la
>   base. El costo por renglón vive además en `conteo_inventario_costos` (RLS =
>   el permiso, lo mantiene un disparador) y el faltante/sobrante sale por
>   `get_conteos_valor`. QA idéntico y en el mismo tiempo; una sala, sin montos.
> - `promocion_cierre_sala.costo` NO es un costo de producto: es lo que cuesta
>   el bono (monto × personas), y ya sólo lo lee Promociones. Nada que cerrar.
>
> **(Nota previa) Reglas 1–5 van sobre tablas calientes**: probar en el entorno de pruebas
> (necesita ventas sembradas: el branch nuevo no trae facturas), medir el costo
> de la policy de `sales_invoice_items` como usuario, y aplicar en la ventana
> 06:00–11:59 UTC.
>
> ⚠️ **Lección de medición:** medir con el DDL aplicado DENTRO de una
> transacción mantiene tomadas las tablas con ACCESS EXCLUSIVE mientras dura; una
> corrida tardó >5 min (sin 5xx, pero es exactamente el patrón del outage del
> 8-jul). Cuando la policy nueva no depende de la fila —todo o nada según el
> permiso—, el «después» se calcula evaluando el permiso por cargo, sin DDL.

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

## ~~D2 · Se puede falsificar la bitácora~~ — RETIRADO: no existe

**Esto lo reporté mal.** `audit_logs` **sí** tiene la restricción:
`WITH CHECK (user_id = (SELECT auth.uid()))`, puesta el 2026-08-06. La bitácora
no se puede falsificar. El propio `auditSlice.js` lo dice en un comentario que
no leí: *«la policy de INSERT (20260806000957) sólo acepta el auth.uid() de la
sesión»*.

**Por qué me equivoqué, escrito para que no se repita:** la consulta con la que
audité mostraba la columna `qual` para todas las policies. **En una policy de
INSERT `qual` es siempre NULL** — la restricción vive en `with_check`. Así que
*toda* policy de INSERT me apareció como «sin restricción», y reporté cinco
agujeros de los cuales **ninguno era real**:

| Reportado | Verificado |
|---|---|
| `audit_logs` INSERT abierto | `WITH CHECK (user_id = auth.uid())` |
| `push_subscriptions` INSERT abierto | `WITH CHECK (employee_id = …)` |
| `user_dashboard_prefs` INSERT abierto | `WITH CHECK (user_id = auth.uid())` |
| `pedidos_snapshots` INSERT abierto | `WITH CHECK (created_by = auth.uid())` |
| `dashboard_canon` DELETE abierto | `USING (auth_is_su())` |

Lo que sí era cierto —D1, D3, D4— salió de la columna `qual` de policies de
**SELECT**, donde `qual` es la correcta.

**La regla que queda:** al auditar policies, mirar la columna que corresponde al
comando. `qual` gobierna SELECT/UPDATE/DELETE; `with_check` gobierna INSERT y la
mitad de escritura de UPDATE. Mirar sólo una de las dos fabrica hallazgos falsos
en un sentido o agujeros invisibles en el otro.

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
| Otros | `ventas_perdidas`, `products_changelog`, `product_sales_*`, `product_last_sale` | por decidir |
| Catálogos — **se quedan abiertos** | `branches`, `roles`, `presentaciones`, `laboratorios`, `product_categories`, `product_active_principles`, `lab_locations`, `holidays`, `shifts`, `education_catalog_entries`, `erp_sucursal_map`, `module_locks`, `mv_refresh_state`, `stock_config`, `dispatch_rules`, `products` | Los necesita todo el portal y no son datos sensibles. **Es una decisión, no un olvido** |

Lo único que queda de la lista de escrituras: **`push_subscriptions` tiene sus
policies otorgadas al rol `public` en vez de `authenticated`**. No es explotable
—`anon` no tiene `auth.email()`, así que la subconsulta no empareja con nada—
pero es un descuido que conviene corregir cuando se toque esa tabla.

(Los «tres INSERT sin `WITH CHECK`» que este documento reportaba acá **no
existían**: ver la nota de D2.)

---

## Orden, y por qué ése

1. **D5 primero.** Es la raíz: mientras haya dos definiciones de superusuario,
   cualquier cierre que haga puede dejar fuera a quien no debería, y lo vamos a
   descubrir en producción como ya pasó.
2. **D1 y D4a** — directos, sin dependencias. D1 es el único agujero de
   **escritura** que resultó real, y pesa más que los de lectura.
3. **Los dos RPC** — `empleado_no_disponible` y `audit_log_de_objeto`, más el
   cambio de sus llamadores. D3 y D4b comparten defecto: **la vista pide los
   datos en vez de hacer la pregunta**, y por eso la tabla tiene que estar
   abierta.
4. **D3 y D4b** — las policies, recién cuando sus llamadores ya no lean la tabla.
5. **D6** por grupos, empezando por Ventas y Compras y dejando Inventario para
   el final por ser tablas calientes.

## Reglas que este plan hereda y no negocia

- `SET lock_timeout = '5s'` en toda migración; tablas calientes en su propia
  migración y con reintentos.
- Toda llamada a `auth_*` dentro de una policy **envuelta en `(SELECT …)`** —
  regla del outage del 2026-07-08, verificada con `EXPLAIN`.
- Ensayo en staging dentro de `BEGIN…ROLLBACK`, con
  `SET LOCAL role authenticated` y el JWT simulado por
  `set_config('request.jwt.claims', …)` — sin cambiar de rol, RLS ni siquiera se
  evalúa y la prueba no prueba nada. El ref del branch sale de
  `supabase branches list`, no de este documento: el que figuraba acá
  (`ewcmerxqjvludtgskuin`) se borró el 2026-08-12 — ver §«Entorno de pruebas»
  de CLAUDE.md.
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
