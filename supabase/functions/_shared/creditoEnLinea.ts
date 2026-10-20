// ─── Abonar en la caja un crédito que el cliente pagó con Wompi ────────────
//
// 2026-10-20. Lo llaman `wompi-pagos` (apenas Wompi aprueba el cobro, después
// de contestar) y `sync-creditos` (cada 10 minutos, los que quedaron sin
// abonar). Escrito una vez: dos copias de un abono son dos maneras de abonar
// dos veces.
//
// Decisiones del dueño: el pago es por el saldo TOTAL; queda en el sistema de
// la caja como «Transferencia» en la sala del crédito; si al llegar el dinero
// el crédito ya no debía (lo pagaron en caja mientras tanto), se le devuelve
// en caja — Wompi no anula cobros de enlace de pago.
//
// ── Por qué no se abona dos veces ──────────────────────────────────────────
// 1. `credito_pago_tomar` reclama el pago de forma atómica: dos procesos a la
//    vez no lo toman los dos.
// 2. El documento del abono es `WOMPI-<transacción>`. Antes de abonar se leen
//    los abonos del crédito EN LA CAJA y, si ya está, no se abona: cubre el
//    caso de un proceso que abonó y se cayó antes de anotarlo.
// 3. `creditos_abonos_portal.app_pago_id` es único: un pago, una anotación.
import { getErpBranchMap } from "./security.ts";
import { abonarEnOrigen, abonosDelCredito, creditosDeLaSala, getCortesCreds, getSessionCookie } from "./creditos.ts";

const FORMA = "Transferencia";
const MAX_INTENTOS = 8;
export const documentoWompi = (idTransaccion: string) => `WOMPI-${idTransaccion}`;

// deno-lint-ignore no-explicit-any
type Admin = any;

/** Abona un pago ya aprobado. Nunca lanza: deja el estado escrito en la fila. */
export async function aplicarPagoDeCredito(admin: Admin, pagoId: number): Promise<{ estado: string; error?: string }> {
  const { data: tomados, error: eT } = await admin.rpc("credito_pago_tomar", { p_pago_id: pagoId });
  if (eT) { console.error("[credito-en-linea] tomar:", eT.message); return { estado: "error", error: eT.message }; }
  const p = (tomados ?? [])[0];
  if (!p) return { estado: "ocupado" };   // otro lo está abonando, o ya se abonó

  const fin = async (cambios: Record<string, unknown>) => {
    const { error } = await admin.from("app_reservas_pagos").update(cambios).eq("id", p.id);
    if (error) console.error(`[credito-en-linea] pago ${p.id}: no se guardó el estado:`, error.message);
  };
  const avisar = async (tipo: string, texto: string) => {
    const { error } = await admin.rpc("credito_pago_avisar", { p_pago_id: p.id, p_tipo: tipo, p_texto: texto });
    if (error) console.error(`[credito-en-linea] pago ${p.id}: no se avisó:`, error.message);
  };

  try {
    const entrada = getErpBranchMap().find((e) => e.branchId === Number(p.credito_branch_id));
    if (!entrada) throw new Error(`la sala ${p.credito_branch_id} no está configurada`);
    const credito = String(p.credito_erp);
    const doc = documentoWompi(String(p.id_transaccion));
    const monto = Number(p.monto);

    const { data: espejo, error: eE } = await admin.from("creditos_de_clientes")
      .select("fecha, cliente, factura_erp").eq("branch_id", p.credito_branch_id).eq("credito_erp", credito).maybeSingle();
    if (eE) throw eE;
    if (!espejo?.fecha) throw new Error("el crédito no está en el espejo");

    const { username, password } = getCortesCreds();
    const cookie = await getSessionCookie(username, password);

    // ¿Ya está en la caja? (un intento anterior abonó y no llegó a anotarlo)
    const previos = await abonosDelCredito(cookie, entrada.erpId, credito);
    const yaEsta = previos.find((a) => String(a.documento ?? "").replace(/\s+/g, "").toUpperCase() === doc.toUpperCase());

    const antes = await creditosDeLaSala(cookie, entrada.erpId, String(espejo.fecha), String(espejo.fecha));
    const vivo = antes.find((c) => c.credito === credito);
    if (!vivo) throw new Error("el crédito no aparece en la caja");

    let abonado = yaEsta ? Number(yaEsta.monto) : 0;
    let erpAbonoId: string | null = yaEsta?.erp_id ?? null;
    let saldoAntes = yaEsta ? Number((vivo.saldo + abonado).toFixed(2)) : vivo.saldo;

    if (!yaEsta) {
      // Lo que se abona es lo que el crédito debe HOY, nunca más: lo que sobre
      // del cobro se devuelve en caja.
      abonado = Number(Math.min(monto, Math.max(0, vivo.saldo)).toFixed(2));
      saldoAntes = vivo.saldo;
      if (abonado > 0.004) {
        // `abrirSala` ya la abrió `creditosDeLaSala`, en esta misma sesión.
        const r = await abonarEnOrigen(cookie, credito, abonado, FORMA, doc);
        if (!r.ok) throw new Error(`la caja no aceptó el abono: ${r.crudo.slice(0, 200)}`);
        erpAbonoId = r.datos.id_abono_credito ? String(r.datos.id_abono_credito) : null;
      }
    }

    // Releer el día: el saldo que se guarda es el que la caja dice tener.
    let saldoDespues = Number((saldoAntes - abonado).toFixed(2));
    try {
      const delDia = await creditosDeLaSala(cookie, entrada.erpId, String(espejo.fecha), String(espejo.fecha));
      const post = delDia.find((c) => c.credito === credito);
      if (post) saldoDespues = post.saldo;
      if (delDia.length) {
        const { error } = await admin.rpc("sync_creditos_batch", { p_filas: delDia.map((c) => ({ ...c, branch_id: p.credito_branch_id })) });
        if (error) console.error("[credito-en-linea] espejo:", error.message);
      }
    } catch (e) {
      console.error(`[credito-en-linea] releer: ${(e as Error).message}`);
    }

    let abonoId: number | null = null;
    if (abonado > 0.004) {
      const { data: ya } = await admin.from("creditos_abonos_portal").select("id").eq("app_pago_id", p.id).maybeSingle();
      abonoId = ya?.id ?? null;
      if (!abonoId) {
        const { data: fila, error: eL } = await admin.from("creditos_abonos_portal").insert({
          branch_id: p.credito_branch_id, credito_erp: credito, factura_erp: vivo.factura_erp ?? espejo.factura_erp,
          cliente: vivo.cliente || espejo.cliente, monto: abonado, forma: FORMA, documento: doc,
          saldo_antes: saldoAntes, saldo_despues: saldoDespues, abonado_por: null,
          erp_abono_id: erpAbonoId, origen: "app", app_pago_id: p.id,
          fecha_documento: String(p.pagado_at ?? new Date().toISOString()).slice(0, 10),
        }).select("id").single();
        // El dinero ya entró a la caja: un fallo acá no lo deshace, se anota.
        if (eL) console.error(`[credito-en-linea] pago ${p.id}: no se anotó el abono:`, eL.message);
        abonoId = fila?.id ?? null;
      }
    }

    const devolver = Number((monto - abonado).toFixed(2));
    if (devolver > 0.004) {
      await fin({ abono_estado: "por_devolver", devolver_monto: devolver, abono_at: new Date().toISOString(), abono_error: null });
      await avisar("CREDITO_PAGO_POR_DEVOLVER",
        `${vivo.cliente || espejo.cliente} pagó $${monto.toFixed(2)} en la app por el crédito ${credito}, que ya `
        + (abonado > 0.004 ? `sólo debía $${abonado.toFixed(2)}` : "estaba pagado")
        + `. Hay que devolverle $${devolver.toFixed(2)} en caja (transacción Wompi ${p.id_transaccion}).`);
      return { estado: "por_devolver" };
    }
    await fin({ abono_estado: "aplicado", devolver_monto: null, abono_at: new Date().toISOString(), abono_error: null });
    return { estado: "aplicado" };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error(`[credito-en-linea] pago ${p.id}:`, msg);
    await fin({ abono_estado: "fallo", abono_error: msg.slice(0, 500) });
    // Se avisa una vez, al tercer intento: uno o dos fallos son la caja lenta.
    if (Number(p.abono_intentos) === 3 || Number(p.abono_intentos) === MAX_INTENTOS) {
      await avisar("CREDITO_PAGO_SIN_ABONAR",
        `Un pago en la app de $${Number(p.monto).toFixed(2)} por el crédito ${p.credito_erp} no se pudo abonar en la caja `
        + `(${p.abono_intentos} intentos): ${msg.slice(0, 160)}. Se sigue intentando cada 10 minutos.`);
    }
    return { estado: "fallo", error: msg };
  }
}

/** Los pagos cobrados que todavía no se abonaron. De a uno: la caja se usa en serie. */
export async function aplicarPendientes(admin: Admin): Promise<number> {
  const { data, error } = await admin.from("app_reservas_pagos").select("id, abono_estado, abono_tomado_at, abono_intentos")
    .in("abono_estado", ["pendiente", "fallo", "aplicando"]).lt("abono_intentos", 50).order("id").limit(20);
  if (error) { console.error("[credito-en-linea] pendientes:", error.message); return 0; }
  let n = 0;
  for (const p of data ?? []) {
    if (p.abono_estado === "aplicando" && Date.now() - Date.parse(p.abono_tomado_at) < 10 * 60_000) continue;
    await aplicarPagoDeCredito(admin, p.id);
    n++;
  }
  return n;
}
