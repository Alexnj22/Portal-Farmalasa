# Portal Farmalasa — Claude Code Guidelines

## REGLA CRÍTICA: Límite 1000 filas PostgREST

**PostgREST (Supabase) silenciosamente trunca cualquier respuesta a 1000 filas.** Este proyecto tiene `max-rows=1000` configurado. No hay advertencia ni error — simplemente devuelve 1000 filas y para.

**Lo que NO funciona:**
- `.range(0, 9999)` — sigue devolviendo exactamente 1000 filas
- `.range(0, 4999)` — igual, sigue en 1000
- Cualquier `.select()` / `.rpc()` sin paginación explícita en tablas grandes

**Patrón A — RPC que recibe array de IDs como parámetro:**
Chunkear el *input*, no el output. Si cada chunk tiene ≤1000 IDs, la respuesta también será ≤1000 filas:
```js
const CHUNK = 1000;
const chunks = [];
for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
const results = await Promise.all(
    chunks.map(c => supabase.rpc('mi_funcion', { p_ids: c }))
);
const rows = results.flatMap(r => r.data || []);
```

**Patrón B — RPC/select que pagina el output (ej. `get_stock_analysis`):**
```js
const CHUNK = 1000;
// Primero el count, luego todos los chunks en paralelo
const { data: count } = await supabase.rpc('get_X_count', params);
const numChunks = Math.max(1, Math.ceil(count / CHUNK));
const results = await Promise.all(
    Array.from({ length: numChunks }, (_, i) =>
        supabase.rpc('get_X', params).range(i * CHUNK, (i + 1) * CHUNK - 1)
    )
);
const rows = results.flatMap(r => r.data || []);
```

**Patrón C — RPC que devuelve JSONB (no SETOF):**
El límite no aplica cuando el RPC devuelve un único objeto JSON/JSONB. Opción válida para funciones que agregan todo server-side.

**Tablas seguras para bulk load sin paginar** (siempre <1000 filas): `branches`, `roles`, `presentaciones`, `laboratorios`.

**Tablas que REQUIEREN paginación**: `products`, `inventory`, `dte_sales`, `product_stock_params`, `get_stock_analysis` (RPC).

---

## Supabase Project
- Project ID: `sacecdkdmsdvgqnrsett`
- Aplicar migraciones vía MCP tool `apply_migration` (no `supabase db push`)

## Estándares del proyecto
- Ver `DESIGN.md` para patrones de UI (glassmorphism, filter pills, tabs, search)
- Siempre usar `LiquidSelect` en lugar de `<select>` nativo
- Badges `es_antibiotico=true` → "Bajo Receta" (NUNCA "Abx")
- Toda acción de usuario → `appendAuditLog` (staffStore → `audit_logs`)
- Bumpar `APP_VERSION` en `src/version.js` en cada commit
