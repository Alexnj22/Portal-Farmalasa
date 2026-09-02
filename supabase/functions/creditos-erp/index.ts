import {
  getCorsHeaders, getErpBranchMap, permisoDeModulo, requireActiveEmployeeUser,
} from "../_shared/security.ts";
import {
  creditosDeLaSala, FORMAS_DE_PAGO as FORMAS, getCortesCreds, getSessionCookie, ABONO_URL,
} from "../_shared/creditos.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════════════════
// LOS CRÉDITOS DE LOS CLIENTES — verlos y abonarles desde el portal.
//
// ── Por qué pasa por acá y no por el navegador ────────────────────────────
// El sistema de la caja no habla con el navegador de nadie: hay que entrar con
// las credenciales del portal y fijar la sucursal en la sesión. Y el abono
// MUEVE DINERO —entra al cajón como efectivo— así que el permiso y el alcance
// se cobran del lado del servidor, igual que en `operar-caja`.
//
// ── Lo que se midió antes de escribir esto (1-sep) ────────────────────────
// 126 créditos con saldo entre las seis salas, $4,646.21, 43 clientes. De esos,
// **35 pasados del mes de plazo** ($443.70) y el más viejo con **462 días**.
// Nadie los está mirando: no existe ninguna pantalla que los liste.
//
// ── La trampa del nombre, que rompe en silencio ───────────────────────────
// El formulario del origen manda el parámetro `id_factura`, y **lo que lleva
// adentro es el ID DEL CRÉDITO**. Medido: el crédito 102 se pide con
// `?id_credito=102`, su campo oculto `id_factura` vale `102`, y la factura de
// ese mismo crédito es la **19228**. Mandar el número de la factura abonaría al
// crédito de otra persona —o a ninguno— sin dar error. Por eso acá el parámetro
// se llama `credito` y la traducción al nombre ajeno se hace en un solo sitio.
// ═══════════════════════════════════════════════════════════════════════════


const json = (b: unknown, s = 200, h: HeadersInit = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...h } });

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const responder = (b: unknown, s = 200) => json(b, s, cors);

  try {
    const body = await req.json().catch(() => ({}));
    const accion = String(body.accion ?? "listar");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const quien = await requireActiveEmployeeUser(req, supabase);
    if (!quien) return responder({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    /* Módulo propio —`cuentas_por_cobrar`, la vista «Cuentas por cobrar»— y no
     * `caja_vales`: son dos preguntas distintas y las mira otra gente. Mirar la
     * cartera es `can_view`; abonar es MOVER el cajón, así que es `can_edit`. */
    const [modulo, capacidad] = accion === "abonar"
      ? ["cuentas_por_cobrar", "can_edit"]
      : ["cuentas_por_cobrar", "can_view"];
    const permiso = await permisoDeModulo(supabase, quien.id, modulo, capacidad as "can_view" | "can_edit");
    if (permiso.roto) return responder({ ok: false, error: permiso.roto }, 503);
    if (!permiso.puede) {
      return responder({ ok: false, error: "No tienes permiso para ver las cuentas por cobrar." }, 403);
    }

    const mapa = getErpBranchMap().filter((e) => e.erpId !== 6);   // Bodega no vende al crédito
    const { username, password } = getCortesCreds();
    const cookie = await getSessionCookie(username, password);

    // ── LISTAR ───────────────────────────────────────────────────────────
    if (accion === "listar") {
      const desde = String(body.desde ?? "2025-01-01");
      const hasta = String(body.hasta ?? new Date().toISOString().slice(0, 10));
      /* Con alcance de una sala se lee SÓLO la suya. El navegador manda `sala`,
       * pero quien decide es el permiso: sin esto, cambiar un número en la
       * petición mostraría la cartera de otra sucursal. */
      const salas = permiso.alcanceTodo
        ? (body.sala ? mapa.filter((e) => e.branchId === Number(body.sala)) : mapa)
        : mapa.filter((e) => e.branchId === Number(permiso.emp?.branch_id));
      if (!salas.length) return responder({ ok: true, creditos: [] });

      const creditos: unknown[] = [];
      for (const { branchId, erpId } of salas) {
        // En serie y no en paralelo: la sucursal vive en la SESIÓN del origen,
        // así que dos lecturas a la vez se pisarían la sala y devolverían la
        // cartera equivocada sin dar ningún error.
        const filas = await creditosDeLaSala(cookie, erpId, desde, hasta);
        for (const c of filas) creditos.push({ ...c, branch_id: branchId });
      }
      return responder({ ok: true, creditos });
    }

    // ── ABONAR ───────────────────────────────────────────────────────────
    if (accion === "abonar") {
      const sala = Number(body.sala);
      const credito = String(body.credito ?? "").trim();
      const monto = Number(body.monto);
      const forma = String(body.forma ?? "Efectivo");
      const documento = String(body.documento ?? "").trim();

      const entrada = mapa.find((e) => e.branchId === sala);
      if (!entrada) return responder({ ok: false, error: "Esa sala no está configurada." }, 400);
      if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== sala) {
        return responder({ ok: false, error: "Solo puedes abonar en tu propia sala." }, 403);
      }
      if (!credito) return responder({ ok: false, error: "Falta a qué crédito se abona." }, 400);
      if (!(Number.isFinite(monto) && monto > 0)) {
        return responder({ ok: false, error: "Falta el monto." }, 400);
      }
      if (!FORMAS.includes(forma)) {
        return responder({ ok: false, error: "Esa forma de pago no existe." }, 400);
      }

      /* El saldo se relee del ORIGEN, no se cree el que mandó el navegador.
       * Entre que la pantalla cargó y alguien aprieta pueden haber abonado en
       * la caja: sin esto, un abono de más deja el crédito en saldo negativo y
       * el cliente pagó dos veces.
       *
       * Pero se relee SÓLO EL DÍA de ese crédito, y no el histórico entero:
       * la FECHA de un crédito no cambia nunca, así que sale del espejo del
       * portal y no hace falta ir a buscarla. Medido el 2-sep: la ventana de
       * un día son ~250 ms contra los 17.3 s de la tanda completa, y eso era
       * lo que alguien esperaba parado frente al cliente antes de cada abono.
       *
       * Si el espejo todavía no conoce el crédito —recién vendido, y la pasada
       * de los diez minutos aún no pasó— se cae al histórico. Es lento, pero es
       * el único caso donde no hay fecha de dónde partir. */
      const { data: enEspejo, error: errEspejoLee } = await supabase
        .from("creditos_de_clientes").select("fecha")
        .eq("branch_id", sala).eq("credito_erp", credito).maybeSingle();
      /* Nunca descartar el error de un query: si esta lectura falla en silencio
       * el abono sigue funcionando —cae al histórico entero— pero vuelve a
       * costar 17 s con el cliente enfrente, y nadie sabría por qué. */
      if (errEspejoLee) console.error(`[creditos-erp] espejo lee: ${errEspejoLee.message}`);
      const ventana = enEspejo?.fecha
        ? { desde: String(enEspejo.fecha), hasta: String(enEspejo.fecha) }
        : { desde: "2020-01-01", hasta: new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10) };

      const filas = await creditosDeLaSala(cookie, entrada.erpId, ventana.desde, ventana.hasta);
      const vivo = filas.find((c) => c.credito === credito);
      if (!vivo) return responder({ ok: false, error: "Ese crédito no existe en esta sala." }, 404);
      if (monto > vivo.saldo + 0.004) {
        return responder({
          ok: false,
          error: `Ese crédito debe ${vivo.saldo.toFixed(2)}. No se puede abonar más que eso.`,
          saldo: vivo.saldo,
        }, 409);
      }

      /* ⚠️ `id_factura` lleva el ID DEL CRÉDITO. No es un descuido de acá: es
       * el nombre que usa el formulario del origen, y su propio campo oculto
       * viaja con el número del crédito. Mandar el de la factura abonaría al
       * crédito de otra persona sin dar error. La traducción vive en esta
       * línea y en ninguna otra. */
      const resp = await (await fetch(ABONO_URL, {
        method: "POST",
        headers: {
          Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: new URLSearchParams({
          process: "abonar",
          id_factura: credito,
          monto: monto.toFixed(2),
          tipo_doc: forma,
          num_doc: documento,
        }).toString(),
        signal: AbortSignal.timeout(45_000),
      })).text();

      let datos: Record<string, unknown> = {};
      try { datos = JSON.parse(resp); } catch { /* se trata como fallo abajo */ }
      if (String(datos.typeinfo ?? "").toLowerCase() !== "success") {
        console.error(`[creditos-erp] abonar credito=${credito} sala=${sala}: ${resp.slice(0, 1000)}`);
        return responder({
          ok: false,
          error: "La caja no aceptó el abono. Vuelve a intentarlo; si sigue igual, avisa a Sistemas.",
        }, 502);
      }

      /* ── CONFIRMAR que entró, releyendo esa sala en esa fecha ───────────
       *
       * Idea del usuario (2-sep): «luego de un abono verificar esa fecha y
       * sucursal … para confirmar que sí se hizo». Vale la pena y es barata:
       * una petición sobre el DÍA del crédito trae un puñado de filas, no las
       * 2,387 del histórico.
       *
       * Y no es ceremonia. Hasta acá lo único que decía que el abono entró era
       * el `typeinfo: success` del origen; el saldo que se devolvía era una
       * RESTA hecha en el portal. Si allá el abono se aplicara distinto —o a
       * otro crédito, que es exactamente lo que pasa si se manda el número
       * equivocado y **no da error**—, el portal informaría el saldo bonito y
       * nadie lo sabría. Acá el número que se guarda y se muestra es el que el
       * origen dice tener.
       *
       * Un fallo de la relectura NO invalida el abono: el dinero ya entró. Se
       * cae a la resta y se avisa. */
      let saldoConfirmado: number | null = null;
      let confirmado = false;
      let delDia: Awaited<ReturnType<typeof creditosDeLaSala>> = [];
      try {
        delDia = await creditosDeLaSala(cookie, entrada.erpId, vivo.fecha, vivo.fecha);
        const post = delDia.find((c) => c.credito === credito);
        if (post) { saldoConfirmado = post.saldo; confirmado = true; }
      } catch (e) {
        console.error(`[creditos-erp] releer sala=${sala} fecha=${vivo.fecha}: ${(e as Error).message}`);
      }

      const esperado = Number((vivo.saldo - monto).toFixed(2));
      const saldoFinal = saldoConfirmado ?? esperado;
      // Una diferencia acá no es un redondeo: es que el origen aplicó otra cosa.
      const descuadre = confirmado && Math.abs(saldoFinal - esperado) > 0.004;
      if (descuadre) {
        console.error(`[creditos-erp] descuadre credito=${credito}: esperado ${esperado}, `
                    + `el origen dice ${saldoFinal}`);
      }

      /* El espejo se actualiza YA con lo releído, no dentro de diez minutos.
       * Quien acaba de cobrar mira la pantalla en ese momento, y verla con la
       * deuda vieja se lee como que el abono no entró — y el segundo intento
       * es cobrarle dos veces al cliente. */
      if (delDia.length) {
        const { error: errEspejo } = await supabase.rpc("sync_creditos_batch", {
          p_filas: delDia.map((c) => ({ ...c, branch_id: sala })),
        });
        if (errEspejo) console.error(`[creditos-erp] espejo: ${errEspejo.message}`);
      }

      /* Quién cobró y a qué hora — que es lo que el origen NO guarda: allá el
       * abono queda a nombre del usuario de la caja, que es el mismo para toda
       * la sala. Sin esta fila, «¿quién recibió ese dinero?» no tiene respuesta.
       *
       * Va DESPUÉS del abono y su fallo no lo deshace: el dinero ya entró. Se
       * anota el error y se contesta ok con aviso, que es lo honesto. */
      const { error: errLog } = await supabase.from("creditos_abonos_portal").insert({
        branch_id: sala, credito_erp: credito, factura_erp: vivo.factura_erp,
        cliente: vivo.cliente, monto: Number(monto.toFixed(2)),
        forma, documento: documento || null,
        // El saldo de DESPUÉS es el que el origen confirmó, no la resta: es lo
        // que hace que la bitácora sirva para auditar y no sólo para narrar.
        saldo_antes: vivo.saldo, saldo_despues: saldoFinal,
        abonado_por: quien.id,
        erp_abono_id: datos.id_abono_credito ? String(datos.id_abono_credito) : null,
      });

      const avisos = [
        descuadre
          ? `El abono entró, pero el crédito quedó en ${saldoFinal.toFixed(2)} y se esperaba `
            + `${esperado.toFixed(2)}. Revísalo antes de cobrar otra vez.`
          : null,
        !confirmado ? "El abono se mandó, pero no se pudo confirmar el saldo nuevo." : null,
        errLog ? "El abono se hizo, pero no se pudo anotar quién lo recibió. Avísale a Sistemas." : null,
      ].filter(Boolean);

      return responder({
        ok: true,
        abono: datos,
        saldo_despues: saldoFinal,
        confirmado,
        aviso: avisos.length ? avisos.join(" ") : undefined,
      });
    }

    return responder({ ok: false, error: "Acción desconocida." }, 400);
  } catch (e) {
    console.error("creditos-erp:", e);
    return responder({ ok: false, error: (e as Error).message ?? "Error" }, 500);
  }
});
