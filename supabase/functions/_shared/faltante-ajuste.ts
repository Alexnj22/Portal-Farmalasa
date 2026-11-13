// Cerrar un faltante de traslado como «no apareció» (2026-11-12).
//
// Decisión del usuario tras la auditoría de traslados: lo que no apareció lo
// cierra SUPERVISIÓN, que dice a cargo de quién queda (la sala que envió, la
// que recibió o una persona), y el sistema lo DESCUENTA de la sala que recibió.
//
// Por qué de la que recibió, decida quien decida: la recepción entra COMPLETA
// (un faltante es una declaración, no una recepción parcial), así que el
// producto que no venía en la caja quedó en el inventario de esa sala —
// existencia que nadie tiene. A cargo de quién queda es a quién se le atribuye
// la pérdida; dónde se corrige el inventario lo dice dónde está el fantasma.
// En un envío «no llegó» el movimiento sigue en tránsito: primero se recibe
// (para que no quede colgado en la caja) y después se descuenta — eso lo hace
// `enviar-producto-erp`, que es quien sabe recibir un envío.
//
// Lo usan las dos funciones que mueven traslados, con la acción `no_aparecio`:
// `aplicar-traslado-inventario` (solicitudes) y `enviar-producto-erp` (envíos).
//
// ── Quién puede lo decide la BASE, no esta función ───────────────────────
// `tomar_ajuste_faltante` se llama con la SESIÓN de quien apretó (no con la
// llave de servicio): pregunta si es supervisión, valida responsable y nota, y
// aparta el faltante con un candado de 3 minutos. Si dice que no, no se toca la
// caja.
//
// ── Un descarte no se repite ─────────────────────────────────────────────
// Si la caja contesta algo ilegible, el descarte PUDO haber entrado: se anota
// `ajuste.incierto` y la base se niega a reintentar hasta que una persona mire
// el kardex. Reintentar a ciegas descontaría dos veces.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { conceptoDe, descartarUnaLinea } from "./erp-descarte.ts";

export interface FaltanteTomado {
  id: string;
  request_id: string;
  familia: "solicitud" | "envio";
  posicion: number;
  erp_product_id: number | null;
  descripcion: string | null;
  presentacion_tipo: string | null;
  cantidad: number;
  origen_branch_id: number | null;
  destino_branch_id: number | null;
  responsable: "origen" | "destino" | "persona";
  responsable_employee_id: string | null;
  resolucion: string | null;
  ajuste: Record<string, unknown> | null;
}

export interface PedidoNoAparecido {
  faltante_id?: string;
  responsable?: string;
  responsable_employee_id?: string | null;
  nota?: string;
}

type Tomado =
  | { ok: true; actor: string; faltante: FaltanteTomado }
  | { ok: false; status: number; codigo: string; error: string };

/** Aparta el faltante con la sesión de quien llama. Nunca lanza. */
export async function tomarAjusteFaltante(req: Request, p: PedidoNoAparecido): Promise<Tomado> {
  if (!p.faltante_id) return { ok: false, status: 400, codigo: "SIN_FALTANTE", error: "Falta el faltante." };
  const comoPersona = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data, error } = await comoPersona.rpc("tomar_ajuste_faltante", {
    p_id: p.faltante_id,
    p_responsable: p.responsable ?? null,
    p_responsable_emp: p.responsable_employee_id ?? null,
    p_nota: p.nota ?? null,
  });
  if (error) return { ok: false, status: 503, codigo: "BASE", error: `No se pudo apartar el faltante: ${error.message}` };
  const r = data as { ok?: boolean; codigo?: string; error?: string; actor?: string; faltante?: FaltanteTomado } | null;
  if (!r?.ok || !r.faltante || !r.actor) {
    const codigo = r?.codigo ?? "DESCONOCIDO";
    const status = codigo === "FORBIDDEN" ? 403 : codigo === "YA_EN_CURSO" || codigo === "YA_CERRADO" || codigo === "INCIERTO" ? 409 : 422;
    return { ok: false, status, codigo, error: r?.error ?? "No se pudo apartar el faltante." };
  }
  return { ok: true, actor: r.actor, faltante: { ...r.faltante, cantidad: Number(r.faltante.cantidad) } };
}

/** Anota en el faltante (sin soltarlo): lo que ya pasó en la caja, para un reintento. */
export async function anotarAjuste(admin: SupabaseClient, f: FaltanteTomado, extra: Record<string, unknown>) {
  f.ajuste = { ...(f.ajuste ?? {}), ...extra };
  const { error } = await admin.from("bolsa_faltante").update({ ajuste: f.ajuste }).eq("id", f.id).eq("estado", "abierto");
  if (error) console.error(`[faltante-ajuste] ${f.id}: no se pudo anotar el avance: ${error.message}`);
}

/** Suelta el candado sin cerrar. El motivo queda en `ajuste` para quien lo vuelva a intentar. */
export async function soltarAjuste(
  admin: SupabaseClient, f: FaltanteTomado, actor: string, extra: Record<string, unknown> = {},
) {
  const { error } = await admin.from("bolsa_faltante").update({
    ajuste: { ...(f.ajuste ?? {}), ...extra },
    ajuste_en_curso_at: null,
    ajuste_en_curso_por: null,
    responsable: null,
    responsable_employee_id: null,
  }).eq("id", f.id).eq("estado", "abierto").eq("ajuste_en_curso_por", actor);
  if (error) console.error(`[faltante-ajuste] ${f.id}: no se pudo soltar: ${error.message}`);
}

/** A cargo de quién, en palabras — para el concepto de la caja y la respuesta. */
export async function nombreDelResponsable(admin: SupabaseClient, f: FaltanteTomado): Promise<string> {
  if (f.responsable === "persona" && f.responsable_employee_id) {
    const { data } = await admin.from("employees").select("name").eq("id", f.responsable_employee_id).maybeSingle();
    return String(data?.name ?? "una persona");
  }
  const branch = f.responsable === "origen" ? f.origen_branch_id : f.destino_branch_id;
  const { data } = await admin.from("branches").select("name").eq("id", branch).maybeSingle();
  return String(data?.name ?? (f.responsable === "origen" ? "la sala que envió" : "la sala que recibió"));
}

/**
 * Descuenta el faltante de la sala que recibió y lo cierra «no apareció».
 * Devuelve la respuesta para el navegador. El candado se suelta en todos los
 * caminos que no cierran.
 */
export async function descontarYCerrar(opc: {
  admin: SupabaseClient;
  f: FaltanteTomado;
  actor: string;
  actorNombre: string;
  erpSucursal: number;
  erpUbicacion: number;
  factor: number;
  presentacion: string;
  referencia: string;      // el vale o el código de la bolsa
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { admin, f, actor } = opc;
  const nombre = f.descripcion ?? `el producto ${f.erp_product_id}`;
  if (!f.erp_product_id || !opc.factor || !opc.presentacion) {
    await soltarAjuste(admin, f, actor, { ultimo_error: "Al renglón le falta el producto o su presentación." });
    return { status: 422, body: { ok: false, error: `${nombre}: al renglón le falta el producto o su presentación; no se puede descontar.` } };
  }
  const aCargo = await nombreDelResponsable(admin, f);
  const concepto = conceptoDe([
    "FALTANTE NO APARECIO", opc.referencia, `A CARGO DE ${aCargo}`, `AUT ${opc.actorNombre}`,
  ]);

  const r = await descartarUnaLinea({
    erpSucursal: opc.erpSucursal,
    erpUbicacion: opc.erpUbicacion,
    linea: {
      erp_product_id: f.erp_product_id,
      presentacion_tipo: opc.presentacion,
      factor: opc.factor,
      cantidad: f.cantidad,
      descripcion: nombre,
    },
    concepto,
  }).catch((e) => ({ ok: false as const, codigo: "INCIERTO", error: `Se cortó la comunicación con la caja: ${(e as Error).message}` }));

  if (!r.ok) {
    const at = new Date().toISOString();
    // Ilegible o cortado: pudo haber entrado. Se marca y no se reintenta solo.
    const extra = r.codigo === "INCIERTO"
      ? { incierto: { at, por: actor, error: r.error, concepto } }
      : { ultimo_error: r.error, ultimo_error_at: at };
    await soltarAjuste(admin, f, actor, extra);
    return {
      status: r.codigo === "INCIERTO" ? 502 : 409,
      body: {
        ok: false, codigo: r.codigo,
        error: r.codigo === "INCIERTO"
          ? `${r.error} Antes de volver a intentarlo hay que revisar el kardex de la sala.`
          : r.error,
      },
    };
  }

  // Desde acá el producto YA salió del inventario: un fallo al anotar se dice
  // como lo que es, nunca como si no se hubiera descontado.
  const ajuste = { ...(f.ajuste ?? {}), descarte: { at: new Date().toISOString(), concepto, ...r.aplicado } };
  delete (ajuste as Record<string, unknown>).ultimo_error;
  delete (ajuste as Record<string, unknown>).ultimo_error_at;
  const { data: cerrado, error: errCerrar } = await admin.from("bolsa_faltante").update({
    estado: "no_aparecio",
    ajuste,
    resuelto_por: actor,
    resuelto_at: new Date().toISOString(),
    ajuste_en_curso_at: null,
    ajuste_en_curso_por: null,
  }).eq("id", f.id).eq("estado", "abierto").select("id").maybeSingle();
  if (errCerrar || !cerrado) {
    console.error(`[faltante-ajuste] ${f.id}: DESCONTADO y sin cerrar: ${errCerrar?.message ?? "0 filas"}`);
    // Que nadie lo reintente: el descarte ya entró.
    await anotarAjuste(admin, f, { incierto: { at: new Date().toISOString(), por: actor, error: "Se descontó y no se pudo cerrar el faltante.", concepto } });
    return {
      status: 500,
      body: { ok: false, codigo: "DESCONTADO_SIN_CERRAR",
              error: `${nombre} se descontó de la sala, pero no se pudo cerrar el faltante. No lo vuelvas a intentar: avisa a sistemas.` },
    };
  }

  const { error: errAviso } = await admin.rpc("avisar_faltante_resuelto", { p_id: f.id, p_actor: actor });
  if (errAviso) console.error(`[faltante-ajuste] ${f.id}: aviso: ${errAviso.message}`);

  return { status: 200, body: { ok: true, producto: nombre, a_cargo_de: aCargo, cantidad: f.cantidad } };
}
