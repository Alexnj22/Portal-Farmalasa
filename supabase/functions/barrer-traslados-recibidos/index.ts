import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";
import { login } from "../_shared/erp-dte.ts";
import {
  contenidoDeTraslado,
  lectorDeRecepcion,
  sesionEn as abrirSesionEn,
  trasladoLlevaProducto,
} from "../_shared/erp-traslado.ts";

// Apaga las tarjetas «Ya llegó, recibir» cuyo traslado el sistema YA tenía
// recibido.
//
// ── Por qué existe ─────────────────────────────────────────────────────────
// La tarjeta se apaga cuando el portal anota `erp_recibido`. Pero el traslado
// puede entrar a la sala POR FUERA del portal, y entonces nadie escribe esa
// marca:
//
//   1. Alguien lo recibe a mano en el sistema —es lo normal cuando el producto
//      se necesita ya y la tarjeta todavía no se miró—.
//   2. El portal lo recibe, el sistema lo carga, y contesta algo que no se pudo
//      leer como éxito. El producto entró y la solicitud quedó «en camino» para
//      siempre. Es el caso que documenta `aplicar-traslado-inventario` sobre el
//      29444 y el 29446, reportado así: «al confirmar uno como llegado se carga,
//      pero no se quita».
//
// Medido el 2026-08-20 sobre las 18 tarjetas abiertas de todas las salas: 17
// correctas y 1 fantasma (el VASOTRATE del 17-ago, traslado 29444, FINALIZADO
// en el sistema desde ese día). O sea que no es epidemia — pero la única salida
// que había era que alguien apretara el botón, y quien mira la tarjeta no tiene
// forma de saber si es real o vieja.
//
// ── Lo que este barrido NO hace ────────────────────────────────────────────
// No escribe una sola línea en el sistema. Lee dos listas por sala y, cuando el
// sistema dice que ese traslado ya entró, escribe en el PORTAL. Un barrido que
// pudiera cargar inventario sería otra cosa y tendría que justificarse aparte.
//
// Tampoco cierra un traslado ANULADO: ahí el producto no entró y darlo por
// recibido sería mentir. Se cuenta y se reporta; cerrarlo es una decisión de
// una persona (y hoy el botón contesta 409 con el motivo).
//
// ── La guarda que hace que esto sea seguro ─────────────────────────────────
// «Ya no está en la cola de pendientes» NO alcanza para cerrar: si el número
// que el portal guardó fuera el de OTRO traslado —el defecto que se cerró en
// v2.666.1 y que vivió en nueve renglones de pedido— cerraríamos una tarjeta
// cuyo producto nunca llegó. Así que antes de cerrar se abre el traslado y se
// comprueba que adentro está el producto de la tarjeta. Si no se puede leer, o
// no coincide, no se cierra: se reporta.
const PRESUPUESTO_MS = 100_000;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  // Nadie de afuera. No hay camino de navegador para esto: lo llama el cron.
  if (!requireInvokeSecret(req)) return json({ ok: false, error: "No autorizado." }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const arranque = Date.now();

  try {
    const cuerpo = await req.json().catch(() => ({}));
    // El simulacro es el valor por omisión, igual que en el despacho: esto
    // cierra solicitudes de otras salas y hacerlo tiene que ser explícito.
    const simulacro = cuerpo.simulacro !== false;
    const minutos = Number.isFinite(Number(cuerpo.minutos)) ? Number(cuerpo.minutos) : 15;

    const { data: filas, error: filasErr } = await admin
      .rpc("traslados_por_barrer", { p_minutos: minutos });
    if (filasErr) throw filasErr;
    const abiertas = (Array.isArray(filas) ? filas : []) as {
      request_id: string;
      erp_sucursal_id: number;
      id_traslado: string;
      producto: string | null;
      enviado_at: string | null;
    }[];
    if (abiertas.length === 0)
      return json({ ok: true, simulacro, revisadas: 0, cerradas: [], codigo: "NADA_QUE_BARRER" });

    // Una sesión por sala: la sucursal es estado GLOBAL de la sesión del
    // sistema, así que las colas de recepción son las de la sala abierta.
    const porSala = new Map<number, typeof abiertas>();
    for (const f of abiertas) {
      const suc = Number(f.erp_sucursal_id);
      if (!porSala.has(suc)) porSala.set(suc, []);
      porSala.get(suc)!.push(f);
    }

    const cerradas: unknown[] = [];
    const anulados: unknown[] = [];
    const noCoincide: unknown[] = [];
    const salasSinLeer: number[] = [];
    let pendientes = 0, desconocidos = 0, revisadas = 0, corte = false;

    for (const [suc, cartas] of [...porSala.entries()].sort((a, b) => a[0] - b[0])) {
      if (Date.now() - arranque > PRESUPUESTO_MS) { corte = true; break; }

      let cookie: string;
      try {
        cookie = await abrirSesionEn(suc, login);
      } catch (e) {
        // No se pudo abrir la sala: sus tarjetas quedan como estaban. Un
        // barrido que no pudo mirar no concluye nada.
        console.error(`barrido: sala ${suc} no se pudo abrir: ${(e as Error).message}`);
        salasSinLeer.push(suc);
        continue;
      }

      // La cola se lee UNA vez por sala y se reusa; el caso que decide —«no
      // está en la cola»— se vuelve a preguntar fresco. Es el mismo lector que
      // usa la recepción de pedidos.
      const estadoDe = lectorDeRecepcion(cookie);

      for (const carta of cartas) {
        if (Date.now() - arranque > PRESUPUESTO_MS) { corte = true; break; }
        revisadas++;
        const id = String(carta.id_traslado);
        const estado = await estadoDe(id);

        if (estado === "pendiente") { pendientes++; continue; }
        if (estado === "desconocido") { desconocidos++; continue; }
        if (estado === "anulado") {
          anulados.push({ request_id: carta.request_id, id_traslado: id, producto: carta.producto });
          console.log(`barrido: ${id} (${carta.producto}) está ANULADO — no se cierra.`);
          continue;
        }

        // estado === "recibido". Antes de cerrar, que el traslado lleve DE
        // VERDAD el producto de esta tarjeta.
        const contenido = await contenidoDeTraslado(cookie, id);
        if (!trasladoLlevaProducto(contenido, carta.producto)) {
          noCoincide.push({
            request_id: carta.request_id, id_traslado: id, producto: carta.producto,
            motivo: contenido ? "el traslado no lleva ese producto" : "no se pudo leer el traslado",
          });
          console.log(`barrido: ${id} no se cierra — ${contenido ? "no lleva" : "no se pudo leer"} ${carta.producto}`);
          continue;
        }

        if (simulacro) {
          cerradas.push({ request_id: carta.request_id, id_traslado: id, producto: carta.producto, simulacro: true });
          continue;
        }

        const { data: cerro, error: cerrarErr } = await admin.rpc("cerrar_traslado_ya_recibido", {
          p_request_id: carta.request_id,
          p_id_traslado: id,
          p_msg: "El sistema ya lo tenia recibido cuando el portal barrio las solicitudes en camino; "
               + "no se volvio a cargar. La fecha de arriba es la del barrido, no la de la entrada.",
        });
        if (cerrarErr) throw cerrarErr;
        if (cerro) {
          cerradas.push({ request_id: carta.request_id, id_traslado: id, producto: carta.producto });
          console.log(`barrido: cerrada la solicitud del traslado ${id} (${carta.producto}), sala ${suc}.`);
        } else {
          // Alguien la cerró en el medio, o el número cambió. Las dos cosas
          // significan lo mismo acá: no era nuestra para cerrar.
          desconocidos++;
        }
      }
    }

    return json({
      ok: true,
      simulacro,
      revisadas,
      cerradas,
      pendientes,
      anulados,
      no_coincide: noCoincide,
      desconocidos,
      salas_sin_leer: salasSinLeer,
      corte,
      ms: Date.now() - arranque,
    });
  } catch (e) {
    console.error("barrer-traslados-recibidos:", (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
