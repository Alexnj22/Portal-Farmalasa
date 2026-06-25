---
name: feedback-supabase-row-limit
description: PostgREST silently caps at 1000 rows — NEVER omit .range() on any query that could return many rows
type: feedback
---
NEVER query PostgREST without an explicit `.range()` on any table or RPC that could return more than a handful of rows. PostgREST silently truncates results to 1000 rows with no error — the query "succeeds" but data is missing.
**Why:** We burned this multiple times: erp_minmax, inventory, products, pedido_items all hit the cap silently. The user explicitly asked to never let this happen again.
**How to apply:**
- Large tables (products, inventory, erp_minmax, pedido_items, etc.): always `.range(0, 9999)` or paginate with server-side offset.
- Paginated UI: use `.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)` with `{ count: 'exact' }`.
- RPCs: always chain `.range(0, 9999)` even if the RPC has LIMIT inside — PostgREST applies its own cap on top.
- No exceptions: even "small" tables can grow. Default to always including range.