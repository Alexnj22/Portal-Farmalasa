import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";
import { login, leerFicha, escribirCampos, correoValido, repararCorreo } from "../_shared/erp-clientes.ts";

// La sala contesta el dato que el portal le pidió, y el portal cierra el asunto.
//
// El pedido nace en `sincronizar-fichas-clientes` cuando Hacienda rechaza el
// correo de un contribuyente y no es un error de tipeo que se arregle solo. La
// sala lo ve en Inicio, escribe el correo correcto y confirma. Acá pasa todo lo
// demás, en este orden y sin saltarse un paso:
//
//   1. Quién llama, del JWT — y que sea de ESA sala.
//   2. El correo tiene forma (después de limpiarle los espacios: el caso real
//      que originó todo esto era exactamente un espacio al final).
//   3. Se escribe en la ficha del SISTEMA DE ORIGEN, que es la que viaja a
//      Hacienda. Escribirlo en el portal sería cosmético — las dos copias
//      divergen y el documento seguiría saliendo con el correo viejo.
//   4. Se RELEE la ficha y se compara. El sistema de origen contesta 200 con un
//      cuerpo de error, así que «no falló» no significa «cambió».
//   5. Recién entonces se cierra el pedido.
//   6. Y se reintenta el documento, para que la sala vea el resultado ahora y
//      no mañana.
//
// ── Por qué la sala no edita la ficha en Clientes ─────────────────────────
// Porque no puede: `clientes.can_edit` no lo tiene ningún cargo de sala, y
// dárselo para esto abriría la edición de las 28,000 fichas para resolver un
// campo de una. Acá la sala no edita un cliente — contesta una pregunta sobre
// SU venta, y el permiso que se le pide es el de esa pregunta.
//
// ⚠️ La llama el navegador con la sesión de quien contesta: va con JWT, o sea
// SIN `--no-verify-jwt`. El flag depende de QUIÉN llama, no del circuito.
//
//     supabase functions deploy responder-dato-pedido \
//       --project-ref sacecdkdmsdvgqnrsett

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
    const { pedido_id, valor } = await req.json().catch(() => ({}));
    if (!pedido_id) return json({ ok: false, error: "Falta el pedido." }, 400);

    // ── 1 · Quién contesta. Del JWT, nunca del cuerpo. ──────────────────
    const emp = await requireActiveEmployeeUser(req, admin);
    if (!emp) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    const { data: pedido, error: pErr } = await admin
      .from("dte_datos_pedidos")
      .select("id, invoice_id, customer_id, branch_id, campo, estado, valor_actual, correlativo")
      .eq("id", pedido_id)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!pedido) return json({ ok: false, error: "Ese pedido ya no existe." }, 404);
    if (pedido.estado !== "PENDIENTE")
      return json({ ok: false, error: `Este pedido ya está ${pedido.estado.toLowerCase()}.` }, 409);

    // Es la sala del documento la que puede contestar — o quien lleva
    // Facturación, que es quien persigue el trámite. Un correo de un cliente de
    // otra sala es un dato que quien contesta no tuvo enfrente.
    // La sucursal se LEE: `requireActiveEmployeeUser` devuelve id, estado,
    // código y nombre — no la sala. Confiar en un `emp.branch_id` que no existe
    // daba `NaN === n` (siempre falso) y habría dejado a TODAS las salas fuera
    // de su propio pedido, con un 403 que parece un problema de permisos.
    const { data: quien, error: qErr } = await admin
      .from("employees").select("branch_id").eq("id", emp.id).maybeSingle();
    if (qErr) throw qErr;
    const esSuSala = quien?.branch_id != null
      && Number(quien.branch_id) === Number(pedido.branch_id);
    if (!esSuSala) {
      // Una consulta que falla NO es «no tenés permiso»: sin esa distinción, un
      // problema de red le dice a alguien que el pedido no es suyo.
      const permiso = await permisoDeModulo(admin, emp.id, "facturacion", "can_edit");
      if (permiso.roto) return json({ ok: false, error: permiso.roto }, 503);
      if (!permiso.puede)
        return json({ ok: false, error: "Este pedido es de otra sala." }, 403);
    }

    // ── 2 · El valor tiene forma ────────────────────────────────────────
    // Se le limpian los espacios antes de juzgarlo: el caso que originó todo
    // esto era un correo perfecto con un espacio al final, y rechazárselo a
    // quien lo tecleó bien sería repetir el mismo defecto del otro lado.
    const { valor: limpio } = repararCorreo(String(valor ?? ""));
    if (!limpio) return json({ ok: false, error: "Escribí el correo." }, 400);
    if (!correoValido(limpio))
      return json({ ok: false, error: `«${limpio}» no tiene forma de correo.` }, 400);

    const { data: cli, error: cErr } = await admin
      .from("customers").select("erp_id, name").eq("id", pedido.customer_id).maybeSingle();
    if (cErr) throw cErr;
    if (!cli?.erp_id)
      return json({ ok: false, error: "El cliente no tiene número interno: no se puede escribir su ficha." }, 422);

    // ── 3 · Escribir donde importa, y ── 4 · comprobar releyendo ────────
    const cookie = await login();
    const w = await escribirCampos(cookie, String(cli.erp_id), { correo: limpio });
    if (!w.ok)
      return json({ ok: false, error: `No se pudo guardar el correo: ${w.motivo ?? "sin motivo"}` }, 502);

    const despues = await leerFicha(cookie, String(cli.erp_id));
    if ((despues.campos.correo ?? "").trim() !== limpio)
      return json({
        ok: false,
        error: `Se pidió el cambio pero la ficha quedó en «${despues.campos.correo ?? ""}».`,
      }, 502);

    // El espejo del portal, para que Clientes muestre lo mismo sin esperar a la
    // próxima corrida.
    const { error: espErr } = await admin
      .from("customers").update({ email: limpio }).eq("id", pedido.customer_id);
    if (espErr) console.error("espejo del correo:", espErr.message);

    // ── 5 · Recién ahora el pedido está cerrado ─────────────────────────
    const { data: cerrado, error: cerrErr } = await admin.rpc("cerrar_dato_pedido", {
      p_id: pedido.id, p_valor: limpio, p_actor: emp.id,
      p_nota: `Contestado desde ${esSuSala ? "la sala" : "Facturación"}.`,
    });
    if (cerrErr) throw cerrErr;

    // ── 6 · Y se reintenta el documento ahora ───────────────────────────
    // Sin esto habría que esperar al barrido de las 22:30, y quien contestó no
    // sabría si sirvió. El resultado se informa tal cual: puede volver a
    // rechazarse por otra cosa, y decir «listo» sobre eso sería mentir.
    let documento: Record<string, unknown> | null = null;
    const secreto = Deno.env.get("ADMIN_INVOKE_SECRET");
    if (secreto) {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/regularizar-dte`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secreto}` },
        body: JSON.stringify({ alcance: "una", invoice_id: pedido.invoice_id }),
        signal: AbortSignal.timeout(120_000),
      }).then((x) => x.json()).catch(() => null);
      const fila = (r?.detalle as { sello?: string | null; error?: string }[] | undefined)?.[0];
      documento = {
        entro: typeof fila?.sello === "string" && fila.sello.length === 40,
        motivo: fila?.error ?? null,
      };
    }

    return json({ ok: true, correo: limpio, cerrado, documento });

  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
