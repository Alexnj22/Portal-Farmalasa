import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";
import { corregirLote, fechaQueChocaAlCorregir } from "../_shared/erp-corregir-lote.ts";
import { validarLoteEscrito } from "../_shared/erp-asignar-lote.ts";
import { esLoteGenerico, nombreCorto, sesionEn } from "../_shared/erp-traslado.ts";
import { corregirVenceSinLote, validarVenceEscrito } from "../_shared/erp-corregir-vence.ts";
import { login } from "../_shared/erp-dte.ts";

// La sala corrige el lote o el vencimiento de su existencia, directo y sin
// aprobación (2026-11-16, decisión del usuario). La lógica contra el sistema
// de la caja vive en `_shared/erp-corregir-lote.ts`; acá sólo va quién puede y
// sobre qué sala.
//
// Lo llama el NAVEGADOR (Ajuste de inventario → «Corregir lote o
// vencimiento»), así que se despliega CON verificación de JWT.
//
// ── Quién puede ───────────────────────────────────────────────────────────
// La misma llave que abre el Ajuste de inventario (`dash_inv_movement`), y
// sobre la misma sala que dejaría pedir un movimiento ahí: la propia, la que
// cubre ahora, o cualquiera con alcance de todas. Es la regla de
// `validar_solicitud_movimiento_inventario`, repetida porque esta función usa
// la llave de servicio y el RLS no la frena.

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const { erp_sucursal_id, erp_product_id, lote, vence, unidades, lote_nuevo, vence_nuevo, motivo } =
      await req.json().catch(() => ({}));

    const quien = await requireActiveEmployeeUser(req, admin);
    if (!quien) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    const erpSucursal = Number(erp_sucursal_id);
    const pid = Number(erp_product_id);
    const n = Number(unidades);
    const causa = String(motivo ?? "").trim();
    if (!erpSucursal || !pid) return json({ ok: false, error: "Falta la sucursal o el producto." }, 400);
    if (!String(lote ?? "").trim()) return json({ ok: false, error: "Falta el lote que se corrige." }, 400);
    if (!Number.isInteger(n) || n <= 0) return json({ ok: false, error: "Indica cuántas unidades se corrigen." }, 400);
    if (causa.length < 4) return json({ ok: false, error: "Escribe por qué se corrige." }, 400);
    // Sin lote de origen y sin lote nuevo: un perecedero sin control de lote,
    // que sólo corrige el vencimiento (2026-11-27, `_shared/erp-corregir-vence.ts`).
    const soloVence = esLoteGenerico(lote) && !String(lote_nuevo ?? "").trim();
    const v = soloVence ? null : validarLoteEscrito(lote_nuevo, vence_nuevo);
    if (v && !v.ok) return json({ ok: false, codigo: "LOTE_NUEVO_INVALIDO", error: v.error }, 422);
    const vv = soloVence ? validarVenceEscrito(vence_nuevo) : null;
    if (vv && !vv.ok) return json({ ok: false, codigo: "VENCE_INVALIDO", error: vv.error }, 422);

    // ── La sala ─────────────────────────────────────────────────────────
    const { data: mapa, error: mapaErr } = await admin.from("erp_sucursal_map")
      .select("branch_id, nombre, inv_ubicaciones").eq("erp_sucursal_id", erpSucursal).maybeSingle();
    if (mapaErr) throw mapaErr;
    const ubicacion = Number((mapa?.inv_ubicaciones ?? [])
      .find((u: { id: number; isVencidos: boolean }) => !u.isVencidos)?.id);
    if (!mapa || !ubicacion) return json({ ok: false, error: "Esa sucursal no existe." }, 404);
    const branch = Number(mapa.branch_id);

    // ── Quién puede, y sobre qué sala ───────────────────────────────────
    const permiso = await permisoDeModulo(admin, quien.id, "dash_inv_movement", "can_view");
    if (permiso.roto) return json({ ok: false, error: permiso.roto }, 503);
    if (!permiso.puede) return json({ ok: false, error: "No tienes permiso para ajustar inventario." }, 403);
    const emp = permiso.emp as { branch_id?: number } | null;
    let enSuSala = permiso.alcanceTodo || emp?.branch_id === branch;
    if (!enSuSala && emp?.branch_id != null) {
      const { data: cubiertas, error } = await admin.rpc("salas_que_cubre_ahora", { p_branch_id: emp.branch_id });
      if (error) throw error;
      enSuSala = Array.isArray(cubiertas) && cubiertas.includes(branch);
    }
    if (!enSuSala) return json({ ok: false, error: "Sólo puedes corregir el inventario de tu sucursal." }, 403);

    // Mientras se cuenta, el número no se mueve (igual que el ajuste): la
    // sala entera si el conteo todavía no tiene productos (`en_conteo`), o
    // sólo los productos que ese conteo lleva (`productos`).
    const { data: conteo, error: conteoErr } = await admin.rpc("sucursal_en_conteo", { p_branch_id: branch });
    if (conteoErr) throw conteoErr;
    if (conteo?.en_conteo)
      return json({ ok: false, codigo: "EN_CONTEO", error: `Hay un conteo abierto en ${mapa.nombre}: ciérralo antes.` }, 409);
    if (Array.isArray(conteo?.productos) && conteo.productos.map(Number).includes(pid))
      return json({ ok: false, codigo: "EN_CONTEO", error: "Ese producto se está contando: corrígelo cuando se cierre el conteo." }, 409);

    const { data: prod, error: prodErr } = await admin.from("products")
      .select("id, nombre, perecedero").eq("id", pid).maybeSingle();
    if (prodErr) throw prodErr;
    if (!prod) return json({ ok: false, error: "Ese producto no existe." }, 404);
    const referencia = `${causa} - Hecho por: ${nombreCorto({ ...(permiso.emp ?? {}), name: quien.name })}`;

    if (soloVence) {
      if (prod.perecedero !== true)
        return json({ ok: false, codigo: "NO_PERECEDERO", error: `${prod.nombre} no lleva lote ni vencimiento.` }, 422);
      const r = await corregirVenceSinLote({
        cookie: await sesionEn(erpSucursal, login),
        erpSucursal, erpUbicacion: ubicacion, erpProductId: pid,
        descripcion: String(prod.nombre ?? ""),
        venceViejo: vence ? String(vence).slice(0, 10) : null,
        unidades: n, venceNuevo: (vv as { vence: string }).vence, referencia,
      });
      if (!r.ok) {
        if (r.descuadre) console.error(`[corregir-lote-inventario] DESCUADRE ${pid}@${erpSucursal}: ${r.descuadre}`);
        return json({ ok: false, codigo: r.codigo, error: r.descuadre ? `${r.error} ${r.descuadre}` : r.error }, 409);
      }
      return json({ ...r, sala: mapa.nombre, producto: prod.nombre });
    }
    const lv = v as { lote: string; vence: string };

    // El número nuevo con otra fecha en alguna sala: con OTRO número es un
    // lote distinto (un tecleo que choca) y se frena; con el MISMO número la
    // persona afirma la fecha de ese lote, y las otras salas que lo tengan
    // con otra fecha van como aviso (ver la cabecera de erp-corregir-lote).
    const mismoNumero = !esLoteGenerico(lote) && String(lote).trim().toUpperCase() === lv.lote;
    // Para el aviso cuenta también la fecha que se corrige: otra sala que la
    // arrastre tiene el mismo error.
    const choca = await fechaQueChocaAlCorregir(admin, pid, lv.lote, lv.vence, null,
      mismoNumero ? erpSucursal : null);
    if (choca && !mismoNumero)
      return json({
        ok: false, codigo: "LOTE_OTRA_FECHA",
        error: `El lote ${lv.lote} ya está registrado con vencimiento ${choca}. Revisa la caja.`,
      }, 422);

    const r = await corregirLote({
      erpSucursal, erpUbicacion: ubicacion, erpProductId: pid,
      descripcion: String(prod.nombre ?? ""),
      loteViejo: String(lote).trim(), venceViejo: vence ? String(vence).slice(0, 10) : null,
      unidades: n, loteNuevo: lv.lote, venceNuevo: lv.vence, referencia,
    });
    if (!r.ok) {
      if (r.descuadre) console.error(`[corregir-lote-inventario] DESCUADRE ${pid}@${erpSucursal}: ${r.descuadre}`);
      return json({ ok: false, codigo: r.codigo, error: r.descuadre ? `${r.error} ${r.descuadre}` : r.error }, 409);
    }
    const avisos = [...r.avisos];
    if (choca) avisos.push(`En otra sucursal el lote ${lv.lote} figura con vencimiento ${choca}: corrígelo ahí si es el mismo.`);
    return json({ ...r, avisos, sala: mapa.nombre, producto: prod.nombre });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
