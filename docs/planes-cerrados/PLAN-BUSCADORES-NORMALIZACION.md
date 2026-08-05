# Plan — Buscadores con normalización total ("superpoderes")

**Estado: FASE 1 + FASE 2 APLICADAS Y VERIFICADAS EN PROD** (v2.17.53) ·
Escrito: 2026-07-12 · Aplicado: 2026-07-17. Fase 3 (fuzzy server-side)
sigue sin implementar — ver nota al final de esta sección.
**Objetivo:** que TODOS los buscadores del portal encuentren lo que el usuario
busca aunque escriba sin tildes, sin puntuación, con las palabras en otro
orden, o con un typo.

## Resumen de lo aplicado (2026-07-17)

Primero probado end-to-end en staging (`ewcmerxqjvludtgskuin`) con datos
sintéticos, luego aplicado a prod (`sacecdkdmsdvgqnrsett`) con OK explícito,
verificado ahí contra datos reales. Migraciones en
`supabase/migrations/20260717*.sql` (10 archivos).

- **Fase 1**: el alcance real fueron 3 archivos, no 6 — verificación en vivo
  descartó `TabMinMax.jsx` (ya usaba `smartFilter`) y los "spots naive" de
  `TabStaff.jsx`/`FormLeadership.jsx` (son clasificación de rol, no cajas de
  búsqueda). Migrados: `ConteoInventarioView.jsx`, `SchedulesView.jsx`,
  `usePedidosData.js` (la lógica de `TabPedidos.jsx` vive ahí tras el
  Bloque 6.C).
- **Fase 2.1-2.3**: `norm_search()`/`f_unaccent()` + 9 RPCs con `p_search`
  reescritos con match por tokens (`LIKE ALL`) — la lista real fue
  `inventory_grouped`, `inventory_inversion`, `inventory_proximos_count`,
  `get_conteo_items_search`/`_count`, `get_conteo_products_page`/`_count`,
  `get_product_sales_agg`/`_jsonb` (9, no 8 — `_jsonb` se descubrió en el
  grep de `pg_proc` que el plan ya pedía hacer).
- **Fase 2.4-A**: columnas generadas `products.nombre_norm`/`pactivo_norm` +
  `likePattern()` en `searchUtils.js`. 6 call sites migrados (los mismos que
  Estrategia A abajo, con rutas actualizadas post-Bloque 6.A:
  `src/data/{conteoInventario,recepcion,promotions,cotizaciones,productos,
  dispatchRules}.js`).
- **Fase 2.4-B**: en vez de una sola RPC `search_ventas`, se crearon 2 —
  `search_ventas_ids` (sales_invoices) y `search_inventory_descripcion_ids`
  (inventory, la tabla más caliente del proyecto — tampoco recibe columna
  generada).
- **Fuera de alcance, documentado como decisión deliberada**: `customers`
  (ya tenía `search_name` generado con `translate()`, no era la fuente de
  los bugs reportados), `ComprasView`/`requestsSlice` (tablas chicas, se
  dejaron tal cual). **Fase 3 (fuzzy server-side) sigue sin implementar.**

## Casos canónicos que deben funcionar al terminar

| Usuario escribe | Debe encontrar | Por qué falla hoy (server-side) |
|---|---|---|
| `ssn` o `s.s.n` | `S.S.N TABLETAS` | Los puntos están en la BD; `ILIKE '%ssn%'` no matchea |
| `alcohol 90` | `ALCOHOL-90` | El guion está en la BD; el espacio del query rompe el substring |
| `acido` | `ÁCIDO FÓLICO` | La tilde está en la BD |
| `500 gravol` | `GRAVOL 500MG` | Orden de tokens; ILIKE es substring único |
| `graovl` (typo) | `GRAVOL` (como "resultados similares") | No hay fuzzy server-side |

---

## Diagnóstico (2026-07-12)

Hay **dos mundos** de búsqueda y solo uno tiene superpoderes:

1. **Client-side** — `src/utils/searchUtils.js` ya existe con `normSearch`
   (tildes+puntuación), `tokenMatch` (tokens en cualquier orden/campo),
   `fuzzyScore` (Levenshtein) y `smartFilter` (exact→fuzzy con banner).
   ~12 vistas ya lo usan. **6 archivos siguen con búsqueda naive**
   (`toLowerCase().includes`).

2. **Server-side** — TODOS los RPCs con `p_search` y todos los `.ilike()`
   directos comparan contra la **columna cruda**. Peor: varias vistas mandan
   `normSearch(q)` al servidor (TabInventario, VentasView, TabReglas), o sea
   **normalizan solo el lado del usuario** — eso hace que "s.s.n" escrito tal
   cual TAMPOCO encuentre "S.S.N" (el query llega como `ssn`, la BD tiene
   `S.S.N`). Bug de normalización unilateral.

**Regla de oro de todo el plan: normalizar SIEMPRE ambos lados** (query y
columna) con la MISMA función.

### ⚠️ El caso `alcohol 90` exige match por tokens en el servidor

`norm_search('ALCOHOL-90')` = `alcohol90` (sin espacio).
`norm_search('alcohol 90')` = `alcohol 90` (con espacio).
`'alcohol90' LIKE '%alcohol 90%'` = **false**. Un ILIKE normalizado simple NO
basta: el servidor debe partir el query en tokens y exigir que cada token
aparezca (igual que `tokenMatch`). Ver patrón en Fase 2.3.

---

## Fase 1 — Cliente (riesgo cero, sin tocar BD) ✅ APLICADO

Migrar a `smartFilter`/`tokenMatch` los archivos con búsqueda naive:

| Archivo | Nota |
|---|---|
| `src/views/ConteoInventarioView.jsx` | |
| `src/views/SchedulesView.jsx` | |
| `src/views/pedidos/TabPedidos.jsx` | |
| `src/views/productos/TabMinMax.jsx` | |
| `src/views/branch-tabs/TabStaff.jsx` | |
| `src/components/forms/FormLeadership.jsx` | Ya importa `tokenMatch`; queda un spot naive residual |

Patrón (de `design-search-standard`): `smartFilter(query, data, getFields)` →
`{ results, isFuzzy }`; si `isFuzzy`, mostrar banner ámbar
"Resultados similares para X".

Al filtrar productos incluir siempre `principio_activo` en los campos.

---

## Fase 2 — Servidor (la clave; requiere OK humano por cada write a prod) ✅ APLICADO

### 2.1 Migración: extensión `unaccent` + `norm_search()`

`unaccent` está disponible en Supabase. Se instala en el schema `extensions`.
**Nota 0B.5:** el hallazgo de la auditoría (anon/authenticated/authenticator
NO tienen `extensions` en su `search_path`) aquí NO afecta, porque
`norm_search` vive en `public` y referencia `unaccent` **schema-calificado**.
No repetir el error de pg_trgm de 2026-05-17.

```sql
SET lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- unaccent(text) no es IMMUTABLE (depende del search_path para el diccionario).
-- Wrapper con diccionario explícito → indexable.
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path = ''
AS $$ SELECT extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

-- Espejo EXACTO de normSearch() en src/utils/searchUtils.js.
-- Si se cambia el char class aquí, cambiarlo también en JS (y viceversa).
CREATE OR REPLACE FUNCTION public.norm_search(text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT trim(lower(regexp_replace(
    public.f_unaccent(coalesce($1, '')),
    '[.\-/,;:()''"’]', '', 'g'
  )))
$$;

REVOKE EXECUTE ON FUNCTION public.f_unaccent(text), public.norm_search(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.f_unaccent(text), public.norm_search(text) TO authenticated, service_role;
```

Verificación inmediata:
```sql
SELECT public.norm_search('S.S.N')       = 'ssn',        -- true
       public.norm_search('ALCOHOL-90')  = 'alcohol90',  -- true
       public.norm_search('Ácido Fólico')= 'acido folico'; -- true
```

### 2.2 Índices GIN trigram sobre la expresión normalizada

`CREATE INDEX CONCURRENTLY` **no puede ir dentro de una transacción** →
NO usar `apply_migration` (envuelve en transacción); ejecutar cada statement
por separado vía `execute_sql`. CONCURRENTLY no bloquea escrituras: seguro
sobre tablas calientes, pero igual preferir ventana 06:00–11:59 UTC.
Dependen de `pg_trgm` en `public` — otra razón por la que 0B.5 quedó como
riesgo aceptado (no mover la extensión).

```sql
-- products (~24K filas, caliente: sync inventario cada minuto)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_nombre_norm_trgm
  ON public.products USING gin (public.norm_search(nombre) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_pactivo_norm_trgm
  ON public.products USING gin (public.norm_search(principio_activo) gin_trgm_ops);

-- sales_invoices (~548K filas, MUY caliente) — solo si se decide RPC de ventas (2.4)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_invoices_cliente_norm_trgm
  ON public.sales_invoices USING gin (public.norm_search(cliente) gin_trgm_ops);

-- sales_invoice_items.descripcion (get_product_sales_agg filtra aquí) — millones
-- de filas: crear SOLO si el EXPLAIN del RPC lo pide; el filtro suele correr
-- sobre el agregado, no sobre la tabla base. Verificar en staging primero.

-- inventory_grouped_mv (MV; los índices sobreviven al REFRESH)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inv_grouped_mv_desc_norm_trgm
  ON public.inventory_grouped_mv USING gin (public.norm_search(descripcion) gin_trgm_ops);
```

Los 6 índices trigram existentes sobre columnas crudas (`products.nombre`,
`products.principio_activo`, `sales_invoices.cliente/correlativo/erp_invoice_id`,
`inventory_grouped_mv.descripcion`) **se mantienen** durante la transición;
dropear en una migración de limpieza solo cuando TODOS los callers usen la
versión norm (y ninguna otra query dependa de ellos — verificar con
`pg_stat_user_indexes.idx_scan`).

### 2.3 Patrón de match por tokens en RPCs

Reemplazar en cada RPC el patrón actual
`(p_search IS NULL OR col ILIKE '%' || p_search || '%')` por:

```sql
-- En el cuerpo de la función (plpgsql o CTE en sql):
-- tokens del query normalizado, como patrones LIKE
v_pats := (
  SELECT array_agg('%' || tok || '%')
  FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
  WHERE tok <> ''
);

-- y en el WHERE:
AND (p_search IS NULL OR public.norm_search(col) LIKE ALL (v_pats))
```

- `LIKE` (no ILIKE): ambos lados ya están en minúsculas.
- `LIKE ALL(array)` = cada token debe aparecer → `alcohol 90` matchea
  `alcohol90`, `500 gravol` matchea `gravol 500mg`. Paridad con `tokenMatch`.
- **Verificar con EXPLAIN en staging** que el índice GIN se usa. Si el planner
  no aprovecha el índice con `LIKE ALL`, usar el refinamiento: primer token
  como condición directa (`norm_search(col) LIKE v_pats[1]`, dispara el
  índice) + `LIKE ALL(v_pats)` como filtro residual.
- **Cuidado plan genérico** (memoria `feedback_sql_function_generic_plans`):
  el patrón `(p_search IS NULL OR ...)` ya provocó planes genéricos lentos
  antes (`get_puntos_canjeados` 923ms→12ms). Si el RPC se degrada, fence con
  CTE MATERIALIZED.
- El RPC normaliza internamente → el frontend puede mandar el texto crudo.
  Los `normSearch(q)` que ya se mandan hoy son idempotentes (inofensivos).

**RPCs a actualizar** (regenerar cada uno desde su definición actual en prod
con `pg_get_functiondef`, no desde archivos viejos de migración):

| RPC | Columnas filtradas | Caller |
|---|---|---|
| `get_product_sales_agg` + `_jsonb` | `sii.descripcion`, `pr.nombre`, agg `descripcion` | VentasView TabProductos |
| `inventory_grouped` | `descripcion` (MV) | TabInventario |
| `inventory_inversion` | `descripcion` | TabInventario |
| `inventory_proximos_count` | `descripcion` | TabInventario |
| `get_conteo_items_search` / `_count` | producto | conteoInventarioSlice |
| `get_conteo_products_page` / `_count` | producto | conteoInventarioSlice |

(Confirmar la lista final con
`SELECT proname FROM pg_proc WHERE pg_get_function_arguments(oid) ILIKE '%p_search%'`
— puede haber RPCs con p_search que el frontend aún no usa.)

### 2.4 Los `.ilike()` directos del frontend

PostgREST no filtra por expresiones → dos estrategias:

**A) Columnas generadas en `products`** (la mayoría de los casos son búsqueda
de producto). ⚠️ `ALTER TABLE ... ADD COLUMN GENERATED STORED` = **rewrite +
ACCESS EXCLUSIVE** sobre tabla caliente → obligatorio `lock_timeout='5s'`,
ventana 06:00–11:59 UTC, reintentar si cancela (regla del incidente
2026-07-08). Con 24K filas el rewrite es subsegundo una vez obtiene el lock.

```sql
SET lock_timeout = '5s';
ALTER TABLE public.products
  ADD COLUMN nombre_norm  text GENERATED ALWAYS AS (public.norm_search(nombre)) STORED,
  ADD COLUMN pactivo_norm text GENERATED ALWAYS AS (public.norm_search(principio_activo)) STORED;
-- Índices para estas columnas: versión sobre columna (reemplaza a los de expresión
-- de 2.2 para products — elegir UNA de las dos formas, no ambas):
--   CREATE INDEX CONCURRENTLY ... ON products USING gin (nombre_norm gin_trgm_ops);
```

En el frontend, agregar helper a `searchUtils.js` y usarlo en cada `.ilike()`:

```js
// Patrón LIKE tokenizado: "alcohol 90" → "%alcohol%90%" (matchea "alcohol90")
export function likePattern(q = '') {
  const toks = normSearch(q).split(/\s+/).filter(Boolean);
  return toks.length ? `%${toks.join('%')}%` : '%';
}
// Uso: .ilike('nombre_norm', likePattern(term))
```

(`likePattern` es orden-dependiente, a diferencia de `LIKE ALL` — aceptable
para typeahead de producto.)

**B) Mini-RPC** para tablas donde una columna generada es cara o el filtro es
multi-columna (ej. `sales_invoices`: 548K filas y 3 columnas → RPC
`search_ventas(p_search, ...)` con el patrón 2.3 en vez de rewrite).

**Call sites a migrar** (grep 2026-07-12):

| Archivo:línea | Tabla.columna | Estrategia |
|---|---|---|
| `NuevoConteoModal.jsx:68` | products.nombre | A |
| `ConteoDetailView.jsx:706` | products.nombre | A |
| `RecepcionModal.jsx:252` | products.nombre | A |
| `PromoModal.jsx:200` | products.nombre | A |
| `CotizacionesView.jsx:416` | products.nombre | A |
| `CotizacionesView.jsx:430` | `.ilike('name')` — verificar tabla | A o B |
| `TabCatalogo.jsx:2604` | products nombre+principio_activo (`or()`) | A (or() sobre `*_norm`) |
| `TabReglas.jsx:485` | products.nombre (hoy manda normSearch → bug unilateral) | A |
| `VentasView.jsx:444,521` | sales_invoices erp_invoice_id/correlativo/cliente | B (`search_ventas`) |
| `WidgetInventorySearch.jsx:412-464` | products.principio_activo + inventory | A + revisar flujo |
| `WidgetAnnulmentRequest.jsx:679` | search_name/nit/dui/phone/erp_id — verificar tabla | B probable |
| `ComprasView.jsx:161` | compras.proveedor | A (pocas filas) o dejar |
| `requestsSlice.js:195` | roles.name | Dejar (tabla mínima, interno) |

---

## Fase 3 — Fuzzy server-side (opcional, después) ⬜ PENDIENTE

Para el typo `graovl`→`GRAVOL` en búsquedas server-side (client-side ya lo
cubre `smartFilter`): si el match por tokens da 0 filas, fallback con
`pg_trgm`: `WHERE public.norm_search(nombre) % public.norm_search(p_search)
ORDER BY similarity(...) DESC LIMIT 20` (usa los mismos índices GIN).
Devolver flag `is_fuzzy` para el banner. No implementar hasta que Fase 2
esté estable.

---

## Orden de aplicación y reglas

1. **Staging primero** (branch `ewcmerxqjvludtgskuin`): 2.1 → 2.2 → un RPC
   piloto (`inventory_grouped`) → EXPLAIN + casos canónicos → resto.
2. Prod: cada paso con **OK humano explícito en el momento** (regla del
   proyecto). 2.1 y 2.3 son `apply_migration` normales (con `SET
   lock_timeout='5s'`); 2.2 vía `execute_sql` statement por statement
   (CONCURRENTLY); 2.4-A en ventana 06:00–11:59 UTC.
3. Frontend (Fase 1 + helpers 2.4) puede ir en paralelo; los cambios de
   frontend que dependen de columnas `*_norm` van DESPUÉS de su migración.
4. Limpieza final: dropear índices crudos sin uso; quitar `normSearch()`
   redundantes en llamadas a RPCs que ya normalizan.
5. Bumpar `APP_VERSION` + probar los 5 casos canónicos en la UI (catálogo,
   inventario, ventas, conteo) antes de cerrar.

## Verificación (checklist al aplicar)

- [x] `norm_search('S.S.N')='ssn'`, `('ALCOHOL-90')='alcohol90'`, `('Ácido')='acido'`
      — verificado en staging Y en prod con datos reales.
- [x] Catálogo (`inventory_grouped` + `.ilike('nombre_norm', ...)`): `ssn`,
      `alcohol 90`, `acido`, `500 gravol` (orden invertido) devuelven los
      productos correctos — verificado con datos sintéticos en staging
      (insertados y luego borrados) y contra datos reales en prod.
- [x] EXPLAIN confirma índice GIN en `products.nombre_norm` (Bitmap Index
      Scan). En `inventory_grouped_mv` con solo 5 filas sintéticas el
      planner prefiere Seq Scan — comportamiento correcto a esa cardinalidad,
      no un defecto del índice (que existe y es válido: `idx_igmv_desc_norm_trgm`).
- [ ] Latencia de RPCs sin regresión bajo carga real — no medido aún con
      tráfico de producción, solo con queries puntuales.
- [x] Syncs de cron no tocan `*_norm` (son `GENERATED`, Postgres lo impide
      a nivel de esquema).
- [x] Los 3 archivos reales de Fase 1 (no 6, ver "Resumen de lo aplicado")
      filtran con tildes/puntuación/typos vía `smartFilter`/`normSearch`/`tokenMatch`.
- [ ] `graovl`→`GRAVOL` (fuzzy) — cubierto solo client-side (`smartFilter`);
      Fase 3 server-side no implementada.
