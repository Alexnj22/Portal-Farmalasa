---
name: DTE Sync — Architecture & Known Fixes
description: Edge function sync-dte-sales critical fixes, FK constraint removal, puntos detection, and final DB state after 2026-05 resync
type: project
---

## sync-dte-sales (v15) — Deployed & Working

**Critical fix: `p.id ?? null` not `p.id || null`**
`p.id || null` converted erp_product_id=0 (puntos discount) to null. Always use `??`.

**has_puntos detection:** Items with `erp_product_id=0` mark the parent invoice `has_puntos=true`.

**FK constraint dropped:** `sales_invoice_items_erp_product_id_fkey` was removed because `erp_product_id=0` is not in `products` table. Items inserts would silently fail. Do NOT re-add this FK.

**Why:** Full re-sync in 2026-05 required three passes before this was discovered: first pass (v14) had `||` bug, second pass (v15) had FK blocking 0-id items, third pass (FK dropped) succeeded.

**How to apply:** If items counts look wrong after a forceItems sync, check if a FK on erp_product_id was re-added.

## get_puntos_canjeados RPC

Uses `SUM(ii.total_linea) WHERE ii.erp_product_id = 0` — direct sum, not arithmetic.

## DB State after 2026-05 resync

- 272,820 invoices (2025-05-01 → 2026-05-02)
- 465,340 items
- 652 invoices with has_puntos=true
- $3,642.70 total puntos discount
- FK on erp_product_id removed from sales_invoice_items

## Client / Product auto-creation on sync

- **Clients**: `upsert_customers` RPC called on every sync — new names auto-added
- **Products (sync-dte-sales)**: upsert with `ignoreDuplicates:true` — adds new products but does NOT update names
- **Products (sync-products)**: full upsert — updates names, laboratorios, presentaciones, product_precios daily
