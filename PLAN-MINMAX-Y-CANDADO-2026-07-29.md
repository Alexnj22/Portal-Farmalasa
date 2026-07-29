# Plan — Candado de mantenimiento + cierre de la auditoría MIN·MAX

**Fecha:** 2026-07-29 · **Estado: APLICADO** (F0–F4) — v2.218.0, v2.221.0, v2.222.0, v2.223.0
**Origen:** auditoría del módulo MIN·MAX (2026-07-29), 20 hallazgos
**Entrega:** por fases, con validación y confirmación entre cada una

---

## Cierre — 2026-07-29

Todo aplicado y verificado contra prod. Lo que se movió:

| | antes | después |
|---|---|---|
| `get_stock_analysis` Salud 1 | 472 ms | 186 ms |
| `get_stock_analysis` Bodega | 932 ms | 287 ms |
| Polling de Bodega (cada 5 s) | 245 buffers + Sort | 10 buffers |
| Publicación sin cambios reales | ~3,385 filas escritas | 0 |
| Historial por recálculo | 2,913 filas, 509 pares duplicados | 1,056 filas, 0 duplicados |
| Residuo de borrador | 7,605 filas | 4,456 (el resto es portante) |
| Bodega desfasada de la Σ | 20 productos | 0 |
| Escritura de MIN/MAX por API fuera de tu sucursal | 27 empleados podían | 0 |

**Nueve cosas que el plan tenía mal o de menos** (detalle en `src/version.js`):

1. F1.2a — "hoy 0 filas violarían el CHECK": eran **4**.
2. F2.1 — quitar los `INSERT` de las RPCs **no alcanzó**: el doble UPDATE de
   `calculate_stock_params` seguía generando 509 pares. Hubo que acotar la
   condición del trigger al par MIN/MAX.
3. F2.3 — la premisa era falsa: hay **454 días** de ventas, así que subir
   `analysis_days` no se queda sin datos. Y el divisor por producto hay que
   tomarlo de la primera venta **histórica**: con la de dentro de la ventana
   inflaba 1,418 de 1,765 productos (+17.4%) en vez de 45 (+2.4%).
4. F2.4 — el backfill **no podía** anular las 9 columnas a ciegas:
   `get_stock_analysis` las usa como fallback de lectura, así que habría
   blanqueado 1,325 filas nunca publicadas.
5. F2.8 — **hallazgo nuevo:** 20 filas de Bodega desfasadas de la Σ, y la causa
   (el `pending_upsert` creaba la fila sin `min_units`).
6. F3.2 — `activo = true` en `pres_factors` **sería un bug**: es la tabla de
   conversión de unidades, no un catálogo de opciones.
7. F3.2 — excluir `is_catalog_only` rompe la búsqueda instantánea (el cliente sí
   usa esas filas al buscar y con el filtro "no_data").
8. F4.1 — no era 1 empleado, eran **27** (roles 19 y 30 entran por `pedidos`), y
   el scope obligaba a volver `SECURITY DEFINER` el trigger de Bodega.
9. F4.4 — el recálculo manual **no hace falta**: el cron del 1-ago lo hace solo,
   ya en horario tranquilo. Correrlo a mano dejaría ~7,200 borradores y volvería
   a bloquear el cron, que es exactamente cómo se llegó al atraso de 6 semanas.

**Desviación deliberada:** F2.6 se resolvió con `.select()` de vuelta en el upsert
de Bodega en vez de agregarle `manual_min`/`manual_max` al `RETURNS TABLE` de
`get_stock_analysis` (200 líneas, 4 ramas UNION, 1.5 s por llamada) — mismo efecto
en el log de auditoría, sin tocar el RPC.

### Pendientes chicos, anotados a propósito

- **Verificar la corrida del cron del 1-ago 2026 a las 09:00 UTC** (decisión de
  Alex): es lo que pone al día las 4 sucursales congeladas. El aviso a los
  Supervisores y `minmax_sync_log` registran el resultado.
- **Limpiar las firmas** de `p_decided_by` (approve/reject) y `p_published_by`
  (publish, zero_out): hoy se reciben e ignoran. Se pueden borrar en cuanto el
  frontend de v2.223.0 esté desplegado en todos los clientes.
- **`calculate_stock_params` sin el guard de scope** de F4.1. Es inerte hoy (los 6
  roles con `can_edit` en minmax resuelven a ALL) y ya tiene lo que sí importaba,
  el candado de mantenimiento.
- **`presentations` no desempata** el `ORDER BY factor DESC`: con dos
  presentaciones del mismo factor el orden depende del orden de lectura (8
  productos de Bodega). Preexistente y cosmético.
- **El rol 12 tiene `pedidos = ALL`**, así que a nivel de base sigue pudiendo
  escribir todas las sucursales aunque su `minmax` sea BRANCH. Si el negocio lo
  quiere encerrado en Bodega, se cambia en `role_permissions`, no en el código.

---

## Decisiones tomadas

| Decisión | Elegido |
|---|---|
| Semántica del candado | **Solo lectura + banner.** Se puede entrar y consultar; guardar/publicar/calcular queda deshabilitado con el motivo visible |
| Enforcement | **Modificar `auth_can_edit_any()`.** Cubre 59 policies / 30 tablas + 23 RPCs de una sola vez, incluido PostgREST directo |
| Entrega | **Fases F0→F4**, cada una validada y confirmada antes de la siguiente |

---

## Lo que el candado NO hace (límite explícito)

`auth_can_edit_any` se evalúa dentro de RLS y de RPCs `SECURITY DEFINER` llamadas por
usuarios. **`service_role` salta RLS por completo**, así que el candado **no detiene a
los crons ni a las edge functions** que escriben directo a las tablas (sync de DTE, de
inventario, de productos). El candado detiene **personas**, no procesos automáticos.

Para una ventana de mantenimiento que necesite frenar también los crons, hay que
desactivar el job en `cron.job` aparte. Esto se documenta en el propio panel del candado
para que nadie lo asuma.

**Excepción que sí vamos a cubrir:** `calculate_stock_params` es la única de las 23 RPCs
que exime a `service_role` explícitamente (la llama `auto-calculate-minmax` el día 1 de
cada mes). Si MIN·MAX está bloqueado, ese recálculo **también** debe abortar — se le
agrega un chequeo de candado que aplica incluso a `service_role`.

---

## Por qué el riesgo de tocar `auth_can_edit_any` es menor de lo que parece

Verificado en prod: de las 23 funciones que la invocan, **22 no eximen a `service_role`**.
Como `auth_employee_role_id()` devuelve NULL para `service_role`, esas 22 **ya devuelven
`false` hoy** para ese rol. Conclusión: **agregar el chequeo de candado no cambia en
absoluto el comportamiento de `service_role`** — solo puede afectar a usuarios humanos
autenticados, que es exactamente el objetivo.

El riesgo real que queda es un error de sintaxis o de lógica booleana que rompa la
escritura de los 30 tablas. Se mitiga con: staging primero, `EXPLAIN` comparativo de
initplan antes/después, y una migración de rollback escrita **antes** de aplicar.

---

# F0 — Candado de mantenimiento por módulo

## F0.1 · Tabla `module_locks`

```sql
SET lock_timeout = '5s';

CREATE TABLE public.module_locks (
  id             bigserial PRIMARY KEY,
  module_key     text        NOT NULL UNIQUE,
  locked_by_id   uuid        NOT NULL REFERENCES public.employees(id),
  locked_by_name text        NOT NULL,   -- desnormalizado: el banner no hace join
  reason         text,
  locked_at      timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,   -- válvula: un candado olvidado se cura solo
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_module_locks_key_exp ON public.module_locks (module_key, expires_at DESC);

ALTER TABLE public.module_locks ENABLE ROW LEVEL SECURITY;

-- Todos deben poder LEER el candado: sin esto nadie ve el banner.
CREATE POLICY module_locks_select ON public.module_locks
  FOR SELECT TO authenticated USING (true);
-- Sin policies de INSERT/UPDATE/DELETE: se toca solo por las RPCs DEFINER de abajo.
```

Cumple las reglas de CLAUDE.md: PK, `created_at`, RLS con policy explícita, índice que
cubre la FK, snake_case, `lock_timeout`.

`expires_at` es obligatorio y lo pone la RPC (default 4 h, máximo 24 h). Sin él, un
candado olvidado un viernes deja el módulo en solo-lectura todo el fin de semana.

## F0.2 · Helper `auth_module_locked`

```sql
CREATE OR REPLACE FUNCTION public.auth_module_locked(p_modules text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.module_locks ml
    WHERE ml.module_key = ANY(p_modules)
      AND ml.expires_at > now()
      AND ml.locked_by_id IS DISTINCT FROM public.auth_employee_id()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.auth_module_locked(text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auth_module_locked(text[]) TO authenticated, service_role;
```

**Semántica deliberada: si CUALQUIERA de los módulos del array está bloqueado, bloquea.**
Es decir, `auth_can_edit_any(ARRAY['minmax','pedidos'])` con `minmax` bloqueado deja de
permitir escribir `product_stock_params` aunque el usuario entre por `pedidos`. Es lo
correcto para una ventana de mantenimiento: si estoy tocando MIN·MAX, nada escribe
`product_stock_params`, venga por donde venga. Queda anotado porque es sobre-bloqueo
intencional, no un descuido.

**El titular del candado nunca se bloquea a sí mismo** (`locked_by_id IS DISTINCT FROM
auth_employee_id()`).

## F0.3 · El cambio de una línea en `auth_can_edit_any`

```sql
CREATE OR REPLACE FUNCTION public.auth_can_edit_any(p_modules text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT
    COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'systemRole', '') = 'SUPERADMIN'
    OR (
      NOT public.auth_module_locked(p_modules)          -- ← único cambio
      AND (
        EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.role_id = public.auth_employee_role_id()
            AND rp.module_key = ANY(p_modules) AND rp.can_edit
        )
        OR EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.role_id = public.auth_employee_secondary_role_id()
            AND rp.module_key = ANY(p_modules) AND rp.can_edit
        )
      )
    );
$$;
```

SUPERADMIN salta el candado a propósito (escotilla de emergencia). Hoy **nadie** tiene
`systemRole = 'SUPERADMIN'` en `auth.users`, así que la escotilla real es F0.4.

## F0.4 · RPCs para tomar y soltar el candado

```sql
lock_module(p_module_key text, p_reason text, p_hours int DEFAULT 4)   -- DEFINER
unlock_module(p_module_key text)                                       -- DEFINER
```

Guardas obligatorias:

- `lock_module` exige `auth_employee_id() IS NOT NULL` → **si no resuelve al empleado,
  RECHAZA**. Sin esto alguien podría crear un candado que no puede abrir.
- `lock_module` exige `auth_has_module_permission(p_module_key, 'can_edit')` — solo
  quien puede editar el módulo puede ponerlo en mantenimiento.
- `lock_module` valida que `p_module_key` exista en `role_permissions.module_key`
  (93 módulos hoy) → nada de candados fantasma por un typo.
- `p_hours` acotado a `[1, 24]`.
- `unlock_module` la puede llamar **el titular O quien tenga `permissions.can_edit`** →
  un segundo admin siempre puede liberar un candado atascado.
- Ambas escriben a `audit_logs` (`MODULE_LOCK_ON` / `MODULE_LOCK_OFF`).

## F0.5 · Cliente

| Archivo | Cambio |
|---|---|
| `AuthContext.jsx` | Cargar `module_locks` en el boot; exponer `moduleLocks`, `isModuleLocked(key)`, `moduleLock(key)`. Suscripción realtime a `module_locks` — tabla diminuta y casi sin escrituras, no repite el problema de `product_stock_params` |
| `AuthContext.jsx:607` | `hasPermission(key, action)`: si `action !== 'can_view'` y el módulo está bloqueado y no soy el titular → `false`. **`can_view` nunca se bloquea** (decisión: solo lectura) |
| `ModuleLockBanner.jsx` (nuevo) | Banner con ícono, nombre del titular, motivo y hora de inicio. Componentes canónicos del sistema de diseño, cero elementos nativos |
| `MinMaxView.jsx` | Montar el banner (primer módulo que lo usa) |
| `PermissionsView.jsx` | Panel de administración: lista de candados activos, tomar/soltar, con `ConfirmModal`. Aviso explícito de que los crons NO se detienen |

Al deshabilitarse `can_edit` vía `hasPermission`, **todos los botones de MIN·MAX que ya
consultan `canManage`/`canApprove` se apagan solos** — no hay que tocarlos uno por uno.

## F0.6 · Validación de F0

1. **Staging (`ewcmerxqjvludtgskuin`) primero**, que ya tiene el helper y 63 policies:
   sembrar un empleado + permisos, aplicar F0.1–F0.4, y verificar con `BEGIN…ROLLBACK`:
   - sin candado → el `UPDATE` pasa;
   - con candado de otro → el `UPDATE` es rechazado por RLS;
   - con candado propio → el `UPDATE` pasa;
   - candado vencido (`expires_at` en el pasado) → el `UPDATE` pasa.
2. **Initplan.** `EXPLAIN` de un `count()` sobre una tabla grande con policy que usa
   `auth_can_edit_any`, antes y después. Si el tiempo se dispara, es que se perdió el
   `(SELECT ...)` y hay que revertir — es literalmente el incidente del 2026-07-08.
3. **Migración de rollback escrita y probada antes de tocar prod** (restaura el cuerpo
   original de `auth_can_edit_any`).
4. Prod: aplicar entre **06:00–11:59 UTC**, y usar el propio candado sobre `minmax`
   como primer uso real antes de arrancar F1.
5. `npm run build`, `npm run lint`, `npm run gate:design` en verde.

---

# F1 — Los dos bugs de escritura confirmados

> Confirmados con escritura real contra prod dentro de `BEGIN…ROLLBACK`
> (0 filas residuales verificadas después).
> ```
> CASO1[MIN=5,MAX=NULL] → RECHAZADO al guardar por psp_draft_max_gte_min (trigger bodega)
> CASO2[MIN=12,MAX=12]  → guarda OK … y el publish ABORTA EL LOTE por chk_min_lt_max
> ```

## F1.1 · La validación que falta (causa raíz)

`src/views/productos/TabMinMax.jsx:1150` — ArrowLeft desde MAX es el **único** de los 5
caminos de guardado que no llama a `validateEditForRow`. Y como hay `e.preventDefault()`,
ArrowLeft nunca mueve el cursor dentro del número: siempre salta de celda y guarda.

```jsx
// antes
else { if (inlineDraftEdit.value !== '') saveDraftCell(inlineDraftEdit); setInlineDraftEdit({...}); }

// después — idéntico a sus hermanos (blur:1141, Enter:1156, ArrowUp:1166)
else {
    if (inlineDraftEdit.value !== '') {
        const err = validateEditForRow(inlineDraftEdit, row);
        if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; }
        saveDraftCell(inlineDraftEdit);
    }
    setInlineDraftEdit({...});
}
```

## F1.2 · Defensa en profundidad en la BD

El fix del cliente cierra *el* camino conocido. Estos tres cierran *la clase entera*:

**a) CHECK sobre las columnas de borrador**, alineado con `chk_min_lt_max`:

```sql
ALTER TABLE product_stock_params DROP CONSTRAINT psp_draft_max_gte_min;
ALTER TABLE product_stock_params ADD CONSTRAINT psp_draft_pair_valid CHECK (
  (draft_min IS NULL AND draft_max IS NULL)
  OR (draft_min IS NULL AND draft_max IS NOT NULL)
  OR (draft_min = 0  AND COALESCE(draft_max,0) <= 1)
  OR (draft_min >= 1 AND draft_max > draft_min)
) NOT VALID;
ALTER TABLE product_stock_params VALIDATE CONSTRAINT psp_draft_pair_valid;
```

Hoy **0 filas lo violarían** (verificado), pero se aplica `NOT VALID` + `VALIDATE` para
que si aparece una entre la verificación y la migración, falle el `VALIDATE` y no el
`ALTER` con lock tomado.

**b) `sync_bodega_draft_from_branch_stmt`** — que Σmax nunca pueda quedar bajo Σmin:

```sql
clamped AS (
  SELECT erp_product_id,
    GREATEST(bodega_min, CASE WHEN bodega_max > 1 THEN 1 ELSE 0 END) AS bodega_min,
    GREATEST(bodega_max, bodega_min)                                  AS bodega_max,  -- ← nuevo
    all_published
  FROM sums
)
```

**c) `publish_stock_params`** — normalizar el par antes de escribirlo, en vez de derivar
MIN y MAX por separado. Un solo CTE que garantice el invariante
`(m=0 ∧ M≤1) ∨ (m≥1 ∧ M>m)` cualquiera sea la combinación de NULLs.

## F1.3 · Solicitudes: constraint desalineada

- `mmcr_max_gt_min_chk` (`max > min`) se reemplaza por el mismo predicado de
  `chk_min_lt_max`. Verificar antes que las 2 filas históricas lo cumplan.
- `approve_minmax_requests_bulk`: dejar de meter las violaciones de CHECK en
  `skipped_not_found`. Agregar un bucket `skipped_invalid` con el `SQLERRM` real.

## F1.4 · Validación de F1

- Reproducir CASO1 y CASO2 en `BEGIN…ROLLBACK` y comprobar que **ahora fallan al
  guardar con un mensaje entendible**, no en el publish.
- Publicar un lote de prueba sintético (producto negativo, sucursal 99) y verificar
  que ya no aborta.
- `translateDbError` aplicado a los toasts de guardado de `useMinMaxData` — hoy muestran
  el texto crudo de Postgres.
- Prueba manual en la UI: la secuencia exacta ArrowLeft desde MAX.

---

# F2 — Integridad de datos

| # | Arreglo | Validación |
|---|---|---|
| 2.1 | **Historial doble.** `fn_psp_capture_history` (valores viejos) + los `INSERT` explícitos de `publish_stock_params`/`calculate_stock_params` (valores nuevos). Elegir **una** fuente: quitar los `INSERT` de las RPCs y dejar solo el trigger, que es el que captura todo cambio venga de donde venga | Contar filas nuevas por publish antes/después. Backfill: marcar las 13,198 duplicadas o dejarlas y documentar el corte |
| 2.2 | **Orden del historial.** `fetchStockParamsHistory` ordena solo por `captured_at`; agregar `id DESC` de desempate para que el `ExpandedPanel` no pinte el "antes" como estado posterior | Comparar los 5 registros de un producto con pares en el mismo segundo |
| 2.3 | **`data_days`/`draft_data_days` muertas.** 0 filas con valor en 18,364. O se implementan (denominador real de velocidad) o se borran las columnas y la línea `data_days = draft_data_days` de `publish_stock_params`. **Recomiendo implementarlas**: son el guardarraíl que falta si suben `analysis_days` | Decisión tuya antes de tocar |
| 2.4 | **Residuo de borrador.** 7,605 filas con `draft_abc_class`/`draft_velocity` y `draft_status <> 'pending'`. `discard_stock_drafts` debe limpiar las 9 columnas `draft_*`, no 3. Backfill de las existentes | Verificar que el badge y el filtro ABC dejan de mostrar la clase descartada |
| 2.5 | **424 `sparse_data` zombis** de mediados de junio. `calculate_stock_params` debe resetear a `'none'` los `sparse_data` de la sucursal que ya no aparecen en `stats` | Correr el recálculo de Salud 4 en `BEGIN…ROLLBACK` y contar |
| 2.6 | **`manual_min`/`manual_max` no salen de `get_stock_analysis`** → el log de auditoría de bodega registra `null` en el delta no editado (`useMinMaxData.js:457`). Agregarlas al `RETURNS TABLE` | Guardar un override de bodega y leer el `details` del `audit_log` |
| 2.7 | **Pedidos escribe sin `updated_at` ni tocar `draft_status`** (`ItemSections.jsx:394`) → el polling de bodega se pierde el cambio y un borrador viejo lo pisaría al publicar | Editar desde Pedidos con la pestaña de Bodega abierta y ver si refresca |
| 2.8 | **Paridad de ocultos.** El trigger excluye `is_hidden`; el bloque bodega de `publish_stock_params` no. Hoy no diverge, pero es la misma suma calculada de dos formas | Igualar y comparar Σ por producto antes/después |

---

# F3 — Rendimiento

## F3.1 · Sacar `live_sales` de `get_stock_analysis` — el 90% del costo

```
get_stock_analysis_jsonb: 199 llamadas · media 1,550 ms · máx 7,452 ms · 308 s acumulados
   de los cuales el CTE live_sales = 983 ms de 1,085 ms (medido en Bodega)
   escanea 574,848 líneas de sales_invoice_items + 133,260 facturas, EN CADA CARGA
```

Y solo sirve para pisar `units_sold_6m` y `velocity_30d`.

**DECISIÓN (2026-07-29): el dato se mantiene EN VIVO.** No se degrada al snapshot del
último recálculo — se necesita dato real para decidir. Se implementa vía **tabla de
rollup incremental**, el mismo patrón que ya usa esta misma función en su CTE
`last_sale`:

> `product_last_sale` — 16,670 filas, `max(last_sale_date) = 2026-07-29` (hoy),
> mantenida por `fn_update_product_last_sale`. Es dato vivo, no snapshot.

Diseño: `product_sales_rollup (erp_product_id, erp_sucursal_id, units_180d,
units_30d, updated_at)`, mantenida por el mismo disparador que alimenta
`product_last_sale`. `get_stock_analysis` reemplaza el `live_sales` (574,848 líneas
escaneadas por carga) por un `LEFT JOIN` indexado sobre ~16 K filas.

Frescura resultante: **igual de viva que hoy** (se actualiza con cada factura que entra),
a costo de índice en vez de 983 ms de escaneo. La ventana de 180 días exige un recorte
periódico del acumulado — se resuelve con un job diario que recalcula solo los productos
con venta en las últimas 24 h, no con un `TRUNCATE`+`INSERT` completo.

**Validación específica:** comparar fila por fila el `units_sold_6m` del rollup contra el
`live_sales` actual, para las 4,233 filas de una sucursal. Cero diferencias antes de
cambiar la RPC.

## F3.2 · Resto

| Arreglo | Ganancia medida |
|---|---|
| No devolver las filas `is_catalog_only` salvo que se pidan | 1,703 de 4,233 filas (40% de 3.7 MB) que la UI descarta al llegar |
| Índice `(erp_sucursal_id, updated_at, erp_product_id)` para el polling de bodega | Hoy lee las 3,990 filas cada 5 s y las descarta (`Rows Removed by Filter: 3990`). El comentario en `stockParams.js:47` ya afirma que este índice existe |
| `publish_stock_params`: `ON CONFLICT DO UPDATE … WHERE (cols) IS DISTINCT FROM (EXCLUDED.cols)` en el bloque de bodega | Hoy reescribe ~3,385 filas por publicación cambien o no — prohibido por CLAUDE.md |
| Debounce de `get_inventory_cost_summary` + `get_draft_cost_estimate` | Se disparan las dos en cada celda guardada: ~200 ms de BD por edición |
| `pres_factors` sin `activo = true` (a diferencia de `catalog_pres`, que sí lo tiene) | Mismo patrón del bug del CSV de presentaciones inactivas |
| `inventory` escaneado dos veces por llamada (`inv_base` + `inv_all_pres`) | Unificar |

---

# F4 — Seguridad y lógica de negocio

## F4.1 · El candado por sucursal es solo del cliente

`minmax_change_requests` **sí** está scopeada por sucursal. `product_stock_params` y
`stock_config` **no**:

```sql
psp_update USING (SELECT auth_can_edit_any(ARRAY['minmax','pedidos']))  -- sin erp_sucursal_id
```

El rol 12 (*Jefe/a de Compras y Logística*, `scope = BRANCH`, 1 empleado) está encerrado
en su sucursal solo por `lockedErpId` en el frontend. Vía PostgREST directo puede escribir
cualquier sucursal, cambiar la config global, o llamar `discard_stock_drafts(cualquiera)`.

Agregar el scope a `psp_insert`/`psp_update` y a las 3 RPCs (`calculate_stock_params`,
`publish_stock_params`, `discard_stock_drafts`), con el mismo patrón que ya usa
`mmcr_update`. **Todas las llamadas a `auth_*` envueltas en `(SELECT ...)`.**

## F4.2 · Autoría desde el cliente

`decided_by` en `approve_minmax_request`/`reject_minmax_request` viene del cliente,
mientras `published_by` sí usa `auth.email()`. Pasar a server-side. Y limpiar los
parámetros muertos `p_published_by` de `publish_stock_params` y
`zero_out_product_all_branches` (se reciben y se ignoran).
`zero_out_product_all_branches` además hardcodea `VALUES (1)…(7)` en vez de leer
`erp_sucursal_map`.

## F4.3 · ABC/XYZ son solo clasificación — RESUELTO, era intencional

`reorder_x = reorder_y = reorder_z = 25`, `buffer_x/y/z = 0`, y `lead_time_days` NULL en
las 18,364 filas. Entonces `MIN = floor(velocidad × 25)` y `MAX = ceil(velocidad × 35)`
para todo producto, sin que ABC ni XYZ intervengan.

**DECISIÓN (2026-07-29): es intencional.** Por ahora ABC/XYZ sirven **solo como
clasificación** — para filtrar, para el badge y para la matriz. No deben mover ningún
número. **No se toca la fórmula ni la config.**

Lo único que queda de F4.3, y es cosmético:

- Documentar la decisión en `DESIGN.md`/`CLAUDE.md` para que la próxima auditoría no la
  vuelva a levantar como bug.
- `xyz_x_cv_max` / `xyz_y_cv_max` (150/400) sí son restos muertos de la era
  pre-percentiles — hoy manda `xyz_x_percentile`/`xyz_y_percentile`. Retirarlas del
  `ConfigPanel` para que nadie edite un número que no hace nada.

⚠️ **Consecuencia a tener presente:** como el `reorder` es plano, cualquier cambio futuro
en `cycle_days`/`reorder_*_days` reescribe el MIN/MAX de **todo el catálogo a la vez**.
Es un motivo más para que el candado de F0 exista.

Detalles menores del mismo cálculo: `velocity` usa unidades winsorizadas pero
`velocity_30d` usa las crudas; y el denominador es `analysis_days` fijo (hoy coincide con
la data disponible — desde el 2026-01-30 — pero se rompe silenciosamente si lo suben).

## F4.4 · El recálculo mensual lleva 6 semanas sin correr en 4 de 6 sucursales

`calculated_at`: Salud 1 = 13-jun · Salud 4 y La Popular = 14-jun · Salud 5 = 17-jun.
Solo Salud 2 y 3 tienen 17-jul. El cron (`0 15 1 * *`) además dispara a las 15:00 UTC,
con los syncs por minuto activos.

La causa (sucursales saltadas por borradores pendientes) ya está arreglada y hoy hay
**1 solo borrador pendiente** en todo el sistema. Falta: correr un recálculo manual
controlado y mover el cron a la ventana 06:00–11:59 UTC.

---

## Orden de ejecución

```
F0  candado           → staging → initplan → rollback escrito → prod → primer uso real
F1  bugs de escritura → BEGIN…ROLLBACK + prueba manual de la UI
F2  integridad        → 8 arreglos, backfills medidos
F3  rendimiento       → decisión (a)/(b)/(c) sobre live_sales primero
F4  seguridad         → RLS scoping + decisión sobre ABC/XYZ
```

Reglas para todas las fases: `SET lock_timeout = '5s'` en toda migración · archivo local
en `supabase/migrations/` con el **mismo nombre** que se le pasa a `apply_migration`, en
la misma sesión · `APP_VERSION` bumpeada · `npm run build && lint && gate:design` en verde
· escrituras a tablas calientes preferentemente entre 06:00–11:59 UTC.
