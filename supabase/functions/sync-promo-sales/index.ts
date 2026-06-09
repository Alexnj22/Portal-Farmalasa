import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";
import { selectAllPaged } from "../_shared/db.ts";

// Syncs daily sales from sales_invoice_items into promotion_sales_cache
// for all active promotions. Run daily via pg_cron.
//
// Flow:
//   1. Find active promotions with their products and branch scope.
//   2. For each promotion_product, aggregate units sold per date/branch
//      from sales_invoice_items joined to sales_invoices.
//   3. Upsert into promotion_sales_cache.
//   4. Auto-close promos whose stock condition is exhausted.

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const errors: string[] = [];
  let totalUpserted = 0;
  let autoClosed = 0;

  try {
    // 1. Load active promos with products and branch scope
    const { data: promos, error: promosErr } = await supabase
      .from("promotions")
      .select(`
        id, nombre, fecha_inicio, fecha_fin, end_condition,
        promotion_branches(branch_id),
        promotion_products(
          id, product_id, stock_inicial, factor_denominador
        )
      `)
      .in("estado", ["active", "paused"]);

    if (promosErr) throw new Error(`Load promos: ${promosErr.message}`);
    if (!promos || promos.length === 0) {
      return new Response(JSON.stringify({ ok: true, synced: 0, auto_closed: 0, errors: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (const promo of promos) {
      const branchIds: number[] = (promo.promotion_branches || []).map((pb: any) => pb.branch_id);
      if (branchIds.length === 0) continue;

      const fromDate = promo.fecha_inicio ?? "2020-01-01";
      const toDate   = promo.fecha_fin ?? new Date().toISOString().split("T")[0];

      for (const pp of (promo.promotion_products || [])) {
        try {
          // Aggregate daily units sold per branch for this product during the promo period.
          // Paginado con .range() para superar el cap de 1000 filas de PostgREST
          // (promos largas con muchas ventas se truncaban silenciosamente).
          const sales = await selectAllPaged<any>((from, to) =>
            supabase
              .from("sales_invoice_items")
              .select(`
                cantidad, presentacion,
                sales_invoices!inner(fecha, branch_id, estado)
              `)
              .eq("erp_product_id", pp.product_id)
              .in("sales_invoices.branch_id", branchIds)
              .gte("sales_invoices.fecha", fromDate)
              .lte("sales_invoices.fecha", toDate)
              .neq("sales_invoices.estado", "ANULADA")
              .gt("cantidad", 0)
              .range(from, to)
          );

          // Aggregate by (fecha, branch_id)
          const agg: Record<string, number> = {};
          for (const row of (sales || [])) {
            const inv = row.sales_invoices as any;
            if (!inv) continue;
            const factor = (() => {
              const m = (row.presentacion || "").match(/[0-9]+[xX]([0-9]+)/);
              return m ? parseInt(m[1]) : 1;
            })();
            const key = `${inv.fecha}__${inv.branch_id}`;
            agg[key] = (agg[key] || 0) + (row.cantidad * factor);
          }

          const rows = Object.entries(agg).map(([key, units]) => {
            const [fecha, branch_id] = key.split("__");
            return {
              promotion_product_id: pp.id,
              fecha,
              branch_id: parseInt(branch_id),
              units_sold: Math.round(units),
            };
          });

          if (rows.length > 0) {
            const { error: upsertErr } = await supabase
              .from("promotion_sales_cache")
              .upsert(rows, { onConflict: "promotion_product_id,fecha,branch_id" });
            if (upsertErr) errors.push(`upsert pp=${pp.id}: ${upsertErr.message}`);
            else totalUpserted += rows.length;
          }
        } catch (e: any) {
          errors.push(`pp=${pp.id}: ${e.message}`);
        }
      }

      // Auto-close if end_condition is stock or both and stock exhausted
      if (promo.end_condition === "stock" || promo.end_condition === "both") {
        const totalStock = (promo.promotion_products || []).reduce(
          (s: number, pp: any) => s + (pp.stock_inicial || 0), 0
        );
        if (totalStock > 0) {
          // Sumar SOLO las ventas dentro del período de la promo — sin filtrar por
          // fecha, el cache histórico (o reuso del producto en otra promo) cerraba
          // promociones antes de tiempo.
          const { data: cacheRows } = await supabase
            .from("promotion_sales_cache")
            .select("units_sold")
            .in("promotion_product_id", (promo.promotion_products || []).map((pp: any) => pp.id))
            .gte("fecha", fromDate)
            .lte("fecha", toDate);

          const totalSold = (cacheRows || []).reduce((s, r) => s + (r.units_sold || 0), 0);
          if (totalSold >= totalStock) {
            await supabase
              .from("promotions")
              .update({ estado: "closed" })
              .eq("id", promo.id);
            autoClosed++;
          }
        }
      }

      // Auto-close if fecha_fin passed (for date/both)
      if ((promo.end_condition === "date" || promo.end_condition === "both") && promo.fecha_fin) {
        const today = new Date().toISOString().split("T")[0];
        if (promo.fecha_fin < today) {
          await supabase.from("promotions").update({ estado: "closed" }).eq("id", promo.id);
          autoClosed++;
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: errors.length === 0, synced: totalUpserted, auto_closed: autoClosed, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
