# Auditoría Módulo Min/Max — 2026-07-17

> Auditoría completa de código, base de datos y flujos del módulo Min/Max (v2.17.57).
> Incluye el plan de acción aprobado y las decisiones del usuario sobre cada mejora.
> Alcance verificado: frontend (`MinMaxView`, `TabMinMax` + `tabminmax/*`, `TabMinMaxNetwork`,
> `TabMinMaxRequests`, `WidgetMinMaxRequest`, capas de datos `stockParams.js`/`minmaxRequests.js`/`minmaxLabs.js`),
> edge functions (`auto-calculate-minmax`, `sync-erp-minmax`), y todas las migraciones SQL del módulo
> (calculate/publish/trigger bodega/get_stock_analysis/solicitudes/RPCs auxiliares).
> Pendiente al momento de escribir: verificación de estado VIVO en prod (requiere MCP Supabase autenticado).

---

## TL;DR

El módulo está **funcionalmente maduro**: cálculo ABC/XYZ con winsorización P95, flujo
borradores→publicación con auto-apply ±40%, Bodega auto-derivada por trigger en tiempo real,
solicitudes con aprobación y ruteo de notificaciones. No hay funcionalidades a medias.

Pero se encontró:
- **1 bug crítico de lógica**: tres semánticas contradictorias de `manual_min/manual_max`
  conviviendo entre MinMax, Pedidos y el flujo de Solicitudes.
- **1 hueco de seguridad real**: RPCs de escritura masiva (publicar, 0 en red, descartar)
  sin chequeo de permiso — cualquier cuenta autenticada puede invocarlos por API.
- **Código muerto**: carpeta `supabase/functions/sync-erp-minmax/` (escribe a tabla eliminada)
  y 2 RPCs huérfanos en BD.
- ~10 hallazgos medios/bajos (detalle abajo).

---

## 1. Cómo funciona el módulo (arquitectura verificada)

### Datos
- **`product_stock_params`** (PK: `erp_product_id`, `erp_sucursal_id`) — tabla central:
  - Publicado: `min_units` / `max_units` (+ `abc_class`, `daily_velocity`, `velocity_30d`, `cv`,
    `demand_variability`, `units_sold_6m`, `revenue_6m`, `calculated_at`, `published_at/by`).
  - Borrador: `draft_min/max/abc_class/velocity/cv/status/...` (`draft_status`: none | pending | sparse_data).
  - Manual: `manual_min` / `manual_max` — en el modelo vigente (migración 2026-06-19) es un
    **delta aditivo** pensado para Bodega (`effective = publicado + manual`).
  - `calc_min` / `calc_max` (referencia calculada para "Restaurar"), `is_hidden`, `lead_time_days`.
- **`product_stock_params_history`** — snapshot en cada publicación / auto-apply.
- **`stock_config`** (id=1) — cycle_days=45, reorder x/y/z (7/10/15d), buffers, umbrales ABC (70/90),
  umbrales XYZ por CV (150/400), analysis_days=180, approaching_pct, outlier_percentile (P95).
- **`minmax_change_requests`** — solicitudes de ajuste (widget dashboard → aprobación supervisor).
- **`minmax_ignored`** — productos descartados de sugerencias (TabSinVenta).
- **`minmax_sync_log`** — log de corridas del cron.

### Cálculo — `calculate_stock_params(p_erp_sucursal_id)` (versión 2026-07-17)
1. Valida permiso: `service_role` O `auth_can_edit_any(ARRAY['minmax'])`.
2. **Bodega (id=6) excluida**: devuelve `{skipped:true, reason:'bodega_not_calculated_here'}`
   (fix de hoy — antes generaba borradores que nunca podían publicarse: 3,050+ filas de ruido).
3. Salta la sucursal si tiene `draft_status='pending'` (protege trabajo de revisión en curso).
4. Pipeline: ventas diarias 180d de `sales_invoice_items` (excluye ANULADA, labs ocultos)
   → cap al percentil P95 por producto (winsorización de mayoristas)
   → velocidad/día, velocidad 30d, CV → XYZ (X≤150, Y≤400, Z resto)
   → ABC por revenue acumulado por sucursal (A<70%, B<90%)
   → `MIN = GREATEST(FLOOR(vel × (reorden_XYZ + buffer)), 1 si aplica)`; usa `lead_time_days` si existe
   → `MAX = GREATEST(CEIL(vel × cycle_days), MIN+1, 1)`.
5. Upsert de borradores; `draft_status='pending'` solo si algo cambió vs publicado, si no 'none'.
   1-2 días de datos → `sparse_data` (revisión manual). Respeta `is_hidden`.
6. **Auto-apply**: si publicado>0 y draft dentro de ±40% del publicado → aplica directo + history,
   sin pasar por revisión. Devuelve `{rows, auto_applied, drafted}`.

### Publicación — `publish_stock_params(erp_id, product_ids[], published_by)` v7
1. Bloque 1: borradores 'pending' de sucursales (≠6) → live (`min_units=LEAST(draft_min, draft_max)`,
   `max_units=GREATEST(...)` — sanea inversiones), limpia drafts, snapshot a history.
2. Bloque 2: auto-confirma **Bodega** = Σ sucursales (pub_min/pub_max = Σ publicados;
   si Σ efectiva ≠ Σ publicada → deja draft pending en bodega con la Σ efectiva).
   Fix v7: incluye productos cuya Σ llegó a 0/0 para limpiar drafts stale de bodega.

### Bodega en tiempo real — trigger `trg_bodega_draft_sync`
- `AFTER INSERT OR UPDATE OF draft_min, draft_max, draft_status, min_units, max_units`
  FOR EACH ROW, `WHEN (NEW.erp_sucursal_id != 6)`.
- Recalcula Σ del "mejor valor disponible" de cada sucursal (draft si pending, publicado si no):
  - Todas publicadas → escribe bodega en vivo (`min_units/max_units`, status none).
  - Alguna pendiente → escribe borrador de bodega (status pending, badge "SUC. PEND.").
- ⚠️ Retorno temprano si Σ=0 (ver hallazgo M-2).

### Manual de Bodega (modelo aditivo, 2026-06-19)
- Usuario ingresa el **TOTAL** deseado en la celda de Bodega; la UI:
  1. Lee la Σ fresca de BD al abrir la celda (`openBodegaEdit` → floor actualizado).
  2. Valida `total ≥ Σ` (piso; segunda validación al guardar).
  3. Guarda `manual = total − Σ` (delta; NULL si no hay excedente).
- `effective = Σ + delta` → escala automáticamente cuando las sucursales cambian.
- "Restaurar" limpia el manual → vuelve a Σ automática.
- Auditoría completa: `MINMAX_BODEGA_MANUAL_OVERRIDE` con delta_min/max y pub_sum del momento.
- Tab Bodega hace **polling cada 5s** (`fetchStockParamsUpdates`, cursor por `updated_at`) —
  reemplazo deliberado del canal realtime que consumía ~25% del CPU de la DB (Bloque 4.3).

### UI
- `MinMaxView` → tabs por permiso: **Sucursal** (`TabMinMax` 1,666 líneas + hook `useMinMaxData`
  1,074 — la extracción del Bloque 6 dejó el archivo sano), **Red** (`TabMinMaxNetwork` sobre
  `get_network_summary` + oportunidades de traslado), **Solicitudes** (si can_approve).
- Carga de datos: Patrón C (`get_stock_analysis_jsonb`, 1 llamada json_agg — 0.4s vs 1.9s del
  patrón por chunks) + `get_inventory_cost_summary` + `get_draft_cost_estimate`.
- Edición inline MIN·MAX con navegación por teclado (Tab/flechas), validaciones cruzadas
  (MIN<MAX, reglas de 0), confirmación para poner 0 en clase A/B, warning a ±4× del calculado.
- Acciones por fila: Poner 0, Restaurar, Historial, Ocultar, Descartar, Publicar individual,
  0 en red (desde Bodega). Publicación con toast de 5s cancelable.
- Widget dashboard (`dash_minmax_req`): proponer ajuste → notifica a Supervisor de Ventas
  disponible (fallback: jefe inmediato vía parent_role_id) → bandeja Solicitudes → aprobar aplica.
- Cron: `auto-calculate-minmax-monthly` — día 1 de cada mes, 15:00 UTC (9am SV), recalcula las
  6 sucursales de venta en secuencia, loguea a `minmax_sync_log`, notifica push + announcement.

---

## 2. Hallazgos

### 🔴 CRÍTICO

**C-1 · Tres semánticas contradictorias de `manual_min/manual_max`**

La migración `20260619_bodega_manual_additive_model.sql` cambió manual de **reemplazo**
(`effective = COALESCE(manual, publicado)`) a **delta aditivo** (`effective = publicado + manual`),
asumiendo "Sucursales: manual siempre NULL". Solo se migró `get_stock_analysis`. Hoy conviven:

| Consumidor | Semántica | Referencia |
|---|---|---|
| `get_stock_analysis` (módulo MinMax) | **aditiva**: `min_units + manual_min` | migración 20260716154457, línea 149 |
| `get_pedido_preview` (¡genera pedidos!) | **reemplazo**: `COALESCE(manual_min, min_units)` | 20260618_..._regla_respetada.sql:79 |
| `ItemSections.jsx` (revisión en Pedidos) | **reemplazo**: `manual ?? min_units` | ItemSections.jsx:345 |
| `approve_minmax_request` | escribe el solicitado **absoluto** en manual | 20260610_minmax_change_requests.sql:76 |
| Widget "En uso ahora" | **reemplazo**: `manual ?? min_units` | WidgetMinMaxRequest.jsx:64 |

Consecuencias:
- Aprobar una solicitud **infla el efectivo en MinMax**: MIN publicado 10 + solicitud "nuevo MIN 15"
  aprobada → MinMax muestra 25 (10+15), Pedidos usa 15. Nadie ve lo mismo.
- Un delta de Bodega leído por Pedidos como total: Σ=500 + excedente 50 → Pedidos cree MIN Bodega = 50.
- Las ediciones en vivo (`saveDraftCell`/`saveDraftPair`) y `publish_stock_params` **no limpian
  `manual_*`** en sucursales → un manual heredado de una solicitud vieja suma para siempre.

**Fix acordado**: manual queda **EXCLUSIVO de Bodega** (delta aditivo). `approve_minmax_request`
pasa a escribir `min_units/max_units` directo (+ limpia manual + snapshot a history) — coincide
con el texto de la UI "se aplicarán en vivo". `get_pedido_preview` e `ItemSections` migran a
`min_units + COALESCE(manual,0)`. Widget corrige "En uso ahora". Migración de datos: detectar
sucursales con `manual_* IS NOT NULL` y resolverlas caso a caso (staging primero).

### 🟠 ALTO

**A-1 · RPCs de escritura sin chequeo de permiso**

`publish_stock_params`, `zero_out_product_all_branches` y `discard_stock_drafts` son
SECURITY DEFINER con GRANT a `authenticated` y **cero validación interna** (a diferencia de
`calculate_stock_params`, que valida `auth_can_edit_any(['minmax'])`). Cualquier empleado
autenticado — cuenta QA, login por carné — puede vía API directa publicar borradores, poner 0/0
en toda la red o descartar todo, saltándose el RLS granular de la tabla (los DEFINER lo bypassean).
La UI gatea por `can_edit`; la API no.

**Fix**: mismo patrón de `calculate_stock_params` — `publish_stock_params` exige `can_approve`
(o can_edit, a definir), `zero_out_product_all_branches` y `discard_stock_drafts` exigen `can_edit`.

### 🟡 MEDIOS

- **M-1 · `MinMaxView.jsx:40` — tab inicial sin fallback de permiso.** `activeTab` arranca en
  `'sucursal'` fijo; un usuario sin `minmax_tab_sucursal` (solo Red) igual ve TabMinMax renderizado,
  porque el render chequea `activeTab === 'sucursal'`, no la pertenencia a `TABS`.
  Fix: inicializar con `TABS[0]?.key`.
- **M-2 · Trigger de Bodega — retorno temprano en Σ=0** (`20260619_fix_bodega_draft_sync_live_propagation.sql:39`).
  Si la última sucursal con valores queda en 0 por **edición en vivo**, el trigger no toca Bodega
  y esta conserva MIN/MAX viejos. Parchado solo para la ruta de publicación (v7) y el RPC "0 en red".
  Fix: eliminar el early-return y escribir 0/0 en vivo.
- **M-3 · `LabsPanel` — cap de 1000 filas.** `fetchActiveProductLabIds()` (`minmaxLabs.js:11`) trae
  `products` sin paginar → con >1000 productos activos los conteos por laboratorio son incorrectos;
  `fetchProductIdsByLaboratorio`/`unhideStockParamsForProducts` pueden des-ocultar solo parcialmente
  un laboratorio grande. Fix: Patrón B (count + chunks).
- **M-4 · `ConfigPanel.jsx:50` — `Field` definido dentro del componente.** El tipo se recrea en cada
  render → React desmonta/remonta el input → **pierde el foco tras cada tecla**. Fix: extraerlo a
  nivel de módulo.
- **M-5 · Historial incompleto.** `fetchAuditLogsForProduct` no incluye `MINMAX_REQUEST_APPROVED`,
  y ese log usa el id de la *solicitud* como `target_id` — los overrides que entran por solicitud
  aprobada son invisibles en el modal de historial del producto. Fix: loggear también con
  target = producto (o incluir la acción + normalizar target).

### 🟢 BAJOS

- **B-1 · Polling de Bodega** (`stockParams.js:37`): sin `.limit()` y cursor con `gt(updated_at)` —
  una publicación masiva escribe miles de filas con el MISMO timestamp; el poll trae 1000 y el `gt`
  se salta el resto hasta el próximo cambio. Fix: `.limit()` explícito + cursor `gte` con dedupe
  (o keyset compuesto updated_at+erp_product_id).
- **B-2 · Conversión de unidades duplicada.** `calculate_stock_params` usa
  `regexp_match(ii.presentacion, '[0-9]+[xX]([0-9]+)')` mientras `get_stock_analysis` ya usa
  `ii.factor_unidades` (pre-calculado por trigger). Viola la regla del proyecto "factor SIEMPRE de
  product_precios / nunca regex". Fix: migrar calculate a `factor_unidades` (además es más rápido).
- **B-3 · `get_stock_analysis` re-otorga EXECUTE a `anon`** (migración 20260716154457:285).
  Es INVOKER así que RLS protege, pero rompe el estándar "anon no ve nada". Fix: revocar anon.
- **B-4 · `get_minmax_approver_ids` rutea por `ILIKE 'supervisor%ventas%'`** — viola la regla
  "SIEMPRE por role_id directo"; un rename del rol rompe el ruteo en silencio (solicitudes sin
  notificar a nadie). Fix: role_id fijo de la tabla `roles`.
- **B-5 · `TabMinMaxNetwork.jsx:277` — `border-l-4 border-l-red-400/orange-400`** — indicadores de
  borde izquierdo coloreado, prohibidos explícitamente en el proyecto. Fix: tint de fondo (patrón ALERT.row).
- **B-6 · `approveAll` usa `window.confirm`** (`TabMinMaxRequests.jsx:242`) en vez del `ConfirmModal`
  estándar, y aprueba en serie (N llamadas + N notificaciones; si falla a mitad queda parcial).
  Fix: cubierto por mejora M7 (RPC bulk atómico + ConfirmModal).
- **B-7 · Botones Config/Labs no gateados por permiso** (`TabMinMax.jsx:441-456`): un usuario
  solo-lectura los ve y el guardado le falla con error RLS crudo. Fix: gatear por `can_edit`.
- **B-8 · Constantes ERP duplicadas en 4 archivos**: `TabMinMaxRequests`, `WidgetMinMaxRequest` y
  `TabMinMaxNetwork` redefinen `ERP_NAMES/ERP_ORDER` en vez de importar `tabminmax/constants.js`.
- **B-9 · Widget: race de catálogo** — si el catálogo termina de cargar después de que el usuario
  tipeó, los resultados no se recomputan hasta la próxima tecla (efecto solo depende de `search`).

### 🪦 Código muerto / huérfano

- **`supabase/functions/sync-erp-minmax/`** — escribe a `erp_minmax`, tabla **eliminada en v2.2.209**.
  Ya documentada como huérfana en el registro del Bloque 7B.7, pero la carpeta sigue en el repo
  (riesgo real: ya se editó por error una vez creyéndola viva). **Borrar la carpeta.**
- **`get_minmax_comparison`** (RPC en BD) — referencia a `erp_minmax` eliminada → rompería al
  invocarse. Sin consumidor en `src/`. **DROP.**
- **`get_stock_analysis_count`** (RPC en BD) — sin consumidor desde el cambio a Patrón C
  (el frontend usa `get_stock_analysis_jsonb`). **DROP.**
- Fuera de eso, **no hay funcionalidades a medias**: todos los botones/flujos de TabMinMax, Red,
  Solicitudes y el widget están conectados de punta a punta.

---

## 3. Estado manual de Bodega — evaluación y alternativa

**Cómo funciona hoy**: delta aditivo (detalle en §1). El modelo es la elección correcta —
escala solo cuando las sucursales cambian y nunca queda por debajo de la Σ (el modelo absoluto
anterior quedaba stale). Los problemas no son del modelo sino de:
1. Su **adopción parcial** (bug C-1 — Pedidos y Solicitudes siguen en semántica de reemplazo).
2. El retorno temprano del trigger en Σ=0 (M-2).
3. Un delta fijo en unidades **se diluye en silencio** si la Σ crece:

| Escenario | Σ sucursales | MIN Bodega (delta fijo 50) | Colchón real |
|---|---|---|---|
| Al configurarlo | 100 | 150 | 50% |
| Demanda crece | 400 | 450 | 12% ← se diluyó |
| Demanda baja | 40 | 90 | 125% ← ahora sobra |

**Mejor integración (mejora M6, decidida "Después")**: ofrecer el excedente **como porcentaje**
("Σ + 20%") con el delta fijo como alternativa — el colchón escala con la demanda en ambas
direcciones sin retoques manuales.

---

## 4. PLAN DE ACCIÓN COMPLETO

> Estado del usuario: **Fase 1 aprobada para arrancar** (2026-07-17). Reglas: staging
> (`ewcmerxqjvludtgskuin`) primero para DDL sobre tablas calientes; todo `apply_migration` con su
> archivo local del MISMO nombre en el mismo commit; `SET lock_timeout='5s'` en toda migración;
> writes a prod con OK explícito uno a uno; bump `APP_VERSION` + changelog en cada commit.

### Fase 1 — Crítico + Seguridad (aprobada, en curso)

**1.1 Unificar semántica de `manual_*`** (fix de C-1):
   a. Diagnóstico vivo (requiere MCP Supabase): contar filas con `manual_* IS NOT NULL` por
      sucursal — separar Bodega (legítimas, delta) de sucursales (contaminadas por solicitudes).
   b. Migración de datos para sucursales contaminadas: convertir el manual absoluto en valor
      publicado (`min_units = manual_min`, `manual_min = NULL`) — revisar caso a caso si hay pocas.
   c. `approve_minmax_request` v2: escribe `min_units/max_units` directo + `manual_* = NULL` +
      snapshot a `product_stock_params_history` + validar `erp_sucursal_id != 6` (o manejar Bodega
      como delta). Mantener SECURITY INVOKER (la RLS de UPDATE ya exige can_approve).
   d. `get_pedido_preview` + `get_pedido_sin_bodega` (si aplica): `COALESCE(manual,min_units)` →
      `min_units + COALESCE(manual,0)`.
   e. `ItemSections.jsx:345` y `WidgetMinMaxRequest.jsx:64`: misma fórmula aditiva.
   f. QA: staging → verificar preview de pedidos antes/después con un producto con manual.

**1.2 Permisos en RPCs DEFINER** (fix de A-1):
   - `publish_stock_params` → exigir `auth_can_edit_any(ARRAY['minmax'])` + (decidir) can_approve.
   - `zero_out_product_all_branches`, `discard_stock_drafts` → `auth_can_edit_any(ARRAY['minmax'])`.
   - Patrón: `IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' AND NOT ... THEN RAISE`.
   - `get_stock_analysis`: REVOKE anon (fix B-3, mismo commit).

### Fase 2 — Medios

- **2.1** Fallback de tab por permiso en `MinMaxView` (M-1) + gatear Config/Labs por can_edit (B-7).
- **2.2** Trigger de Bodega: eliminar early-return en Σ=0 → escribir 0/0 en vivo (M-2).
  *Se fusiona con la mejora M1 (trigger statement-level) para tocar el trigger una sola vez.*
- **2.3** Paginar `fetchActiveProductLabIds` / `fetchProductIdsByLaboratorio` (Patrón B) (M-3).
- **2.4** Extraer `Field` de `ConfigPanel` a nivel módulo (M-4).
- **2.5** Historial: incluir solicitudes aprobadas con target = producto (M-5).

### Fase 3 — Bajos + limpieza

- **3.1** Borrar carpeta `supabase/functions/sync-erp-minmax/`.
- **3.2** DROP `get_minmax_comparison` y `get_stock_analysis_count` (vía registro de huérfanos 7B.7).
- **3.3** `calculate_stock_params` → `factor_unidades` en vez de regex (B-2).
- **3.4** `get_minmax_approver_ids` por role_id (B-4).
- **3.5** Quitar `border-l` en TabMinMaxNetwork → tint de fondo (B-5).
- **3.6** Polling: `.limit()` + cursor keyset (B-1).
- **3.7** Consolidar `ERP_NAMES/ERP_ORDER` en `tabminmax/constants.js` (B-8) + fix race del widget (B-9).

### Fase 4 — Mejoras APROBADAS por el usuario

- **M1 · Trigger Bodega a nivel de statement** ✅
  `trg_bodega_draft_sync` pasa de FOR EACH ROW a `AFTER ... FOR EACH STATEMENT` con
  `REFERENCING NEW TABLE` — un 'Publicar todo' de ~4,000 productos pasa de ~4,000 ejecuciones
  (cada una con SUM + upsert) a 1 sola que agrega los productos afectados de una vez.
  Estimado: ~95% menos ejecuciones, publicaciones/cálculos 3-5× más rápidos.
  Incluye el fix M-2 (Σ=0). Probar en staging (tabla caliente: aplicar 06:00-11:59 UTC).
- **M2 · Vista Red con Patrón C** ✅
  `get_network_summary_json` con `json_agg(to_json(t))` + 1 llamada desde TabMinMaxNetwork
  (hoy: ~5 re-ejecuciones completas del RPC por los chunks de `.range()`).
  Estimado: ~80% menos tiempo de carga del tab Red.
- **M7 · Aprobación masiva atómica** ✅
  RPC `approve_minmax_requests_bulk(ids[])` en UNA transacción + `ConfirmModal` estándar
  (reemplaza `window.confirm`) + notificaciones agrupadas por empleado.
  Estimado: ~90% menos llamadas de red, cero estados parciales.

### Diferidas ("Después" — NO descartadas)

- **M3 · Forecast v2**: velocidad reciente ponderada + safety stock estadístico
  `z × σ × √(lead time)` por nivel de servicio por clase (A=98%, B=95%, C=90%).
  Estimado: 15-30% menos quiebres en clase A, 10-20% menos sobre-stock en C.
- **M4 · Lead time auto-aprendido**: job que derive `lead_time_days` real por producto desde el
  historial de compras. Estimado: MIN 10-20% más preciso en proveedores lentos.
- **M6 · Excedente de Bodega como %**: `manual_pct` ("Σ + X%") con delta fijo como alternativa.
  Elimina el mantenimiento periódico de excedentes y el colchón queda proporcional siempre.

### Rechazada

- **M5 · Recálculo semanal** ❌ — se mantiene el cron mensual (día 1, 15:00 UTC).

---

## 5. Checklist de ejecución

- [ ] OAuth MCP Supabase (bloqueante de Fase 1) — flujo lanzado, pendiente de autorización
- [ ] Diagnóstico vivo: manual_* contaminado por sucursal, drafts pendientes, cron activo, advisor
- [ ] Fase 1.1 — semántica manual unificada (staging → prod con OK)
- [ ] Fase 1.2 — permisos en RPCs + revoke anon
- [ ] Fase 2 (2.1–2.5)
- [ ] Fase 3 (3.1–3.7)
- [ ] Fase 4 — M1, M2, M7
- [ ] `/code-review` del diff acumulado al cierre de cada fase
- [ ] Bump APP_VERSION + changelog por commit; push (Vercel auto-deploya; DB antes que frontend)

---
*Generado por auditoría del 2026-07-17. Memoria persistente: `project_minmax_audit_2026_07_17.md`.*
