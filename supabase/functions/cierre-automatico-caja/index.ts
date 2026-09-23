import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";

// ═══════════════════════════════════════════════════════════════════════════
// El día que nadie cerró se cierra solo — una hora después del cierre.
//
// Regla del usuario (23-sep): «que pase 1 hora después de la hora de cierre,
// si aún sigue abierta la sucursal y hay un corte de caja cerca de la hora de
// cierre» → se emite el corte Z. A la mañana siguiente `avisar_dias_sin_cierre`
// le cuenta a la sala que no lo hizo.
//
// El sistema de la caja no lo hace: revisado el 23-sep, no tiene ninguna
// opción de cierre automático. Lo único que hace solo es un corte C a las
// 21:00, y un C no es el cierre del día (Salud 5, 13 y 15-sep: C a las 21:00 y
// ningún Z).
//
// ── Quién decide y quién emite ────────────────────────────────────────────
// Decide `caja_cierre_automatico_decidir`, en la base, sin tocar el sistema de
// la caja: el cron corre 42 veces por noche y casi siempre la respuesta es
// «ya cerró» o «todavía no». Sólo para una sala que cumple la regla se llama a
// `hacer-corte-caja`, que emite el Z por el mismo camino que el botón de la
// sala — con su freno de «un solo Z por día» leído del propio sistema de la
// caja — y que le vuelve a preguntar al MISMO juez justo antes de emitir.
//
// ── Por qué no emite el Z acá ─────────────────────────────────────────────
// Porque ya existe quien lo hace bien. `hacer-corte-caja` sabe leer el
// formulario del Z, comprobar que lo que salió fue un Z y avisar a la captura.
// Escribirlo dos veces es el día en que una copia se queda vieja.
//
// `hacer-corte-caja` exige un JWT en la puerta (la llama el navegador), así que
// se entra con la llave de servicio, y lo que la AUTORIZA es el secreto de
// invocación en `x-cierre-automatico`.
//
// `simular: true` recorre todo y pide a `hacer-corte-caja` una simulación:
// nada se emite ni se anota.
// ═══════════════════════════════════════════════════════════════════════════

type Decision = {
  branch_id: number;
  fecha: string;
  cierre: string | null;
  procede: boolean;
  motivo: string | null;
  corte_hora?: string | null;
  falta?: number | null;
};

// Motivos que no piden anotar nada: la sala todavía está en horario, ya cerró
// bien, o no hay caja que cerrar. Anotarlos llenaría la tabla de días normales.
const SIN_NOVEDAD = new Set(["todavia_no", "ya_tiene_z", "sin_caja_abierta", "sin_horario"]);

const horaSV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(11, 16);

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  if (!requireInvokeSecret(req)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const simular = body.simular === true;
    const soloSala = body.sala != null ? Number(body.sala) : null;

    const url = Deno.env.get("SUPABASE_URL")!;
    const servicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secreto = Deno.env.get("ADMIN_INVOKE_SECRET")!;
    const supabase = createClient(url, servicio);

    const { data: decisiones, error } = await supabase.rpc("caja_cierre_automatico_salas");
    // Sin la lista no se sabe qué cerrar: se falla en voz alta, no se da por
    // «nada que hacer».
    if (error) throw new Error(`consultando las salas: ${error.message}`);

    const anotar = async (d: Decision, resultado: "cerrado" | "no_cerrado", extra: {
      motivo?: string | null; erp_corte_id?: number | null; detalle?: Record<string, unknown>;
    }) => {
      if (simular) return;
      const { error: errAnotar } = await supabase.rpc("caja_cierre_automatico_anotar", {
        p_branch_id: d.branch_id, p_fecha: d.fecha, p_resultado: resultado,
        p_motivo: extra.motivo ?? null, p_erp_corte_id: extra.erp_corte_id ?? null,
        p_corte_hora: d.corte_hora ?? null, p_falta: d.falta ?? null,
        p_detalle: { cierre: d.cierre, ...(extra.detalle ?? {}) },
      });
      // No se lanza: si el Z ya salió, lo que se pierde es el rastro, no el
      // cierre. Queda en el log, que es lo que mira quien investigue.
      if (errAnotar) console.error(`[cierre-automatico-caja] sala=${d.branch_id} no se pudo anotar: ${errAnotar.message}`);
    };

    const resultados: unknown[] = [];

    // En serie: el sistema de la caja no aguanta dos sesiones a la vez sobre
    // sus pantallas de ruta fija, y en una noche normal no hay ninguna.
    for (const d of (decisiones ?? []) as Decision[]) {
      if (soloSala != null && d.branch_id !== soloSala) continue;

      // La SONDA: `simular` con una sala llama a `hacer-corte-caja` aunque el
      // juez diga que no, para probar la puerta entre las dos a cualquier hora.
      // No emite nada: allá también va `simular`, y el juez la rechaza igual.
      const sonda = simular && soloSala != null;

      if (!sonda && SIN_NOVEDAD.has(String(d.motivo))) {
        resultados.push({ sala: d.branch_id, motivo: d.motivo });
        continue;
      }

      if (!sonda && !d.procede) {
        await anotar(d, "no_cerrado", { motivo: d.motivo });
        resultados.push({ sala: d.branch_id, cerrado: false, motivo: d.motivo });
        continue;
      }

      const r = await fetch(`${url}/functions/v1/hacer-corte-caja`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${servicio}`,
          "x-cierre-automatico": secreto,
        },
        body: JSON.stringify({ sala: d.branch_id, tipo: "Z", efectivo: 0, automatico: true, simular }),
        signal: AbortSignal.timeout(140_000),
      });
      const z = await r.json().catch(() => null) as Record<string, unknown> | null;

      if (simular) {
        resultados.push({ sala: d.branch_id, simulado: true, status: r.status, respuesta: z });
        continue;
      }

      if (z?.ok === true && z?.id_corte) {
        await anotar(d, "cerrado", {
          erp_corte_id: Number(z.id_corte),
          detalle: { z_hora: horaSV(), aviso: z.aviso ?? null },
        });
        console.log(`[cierre-automatico-caja] sala=${d.branch_id} Z ${z.id_corte} emitido`);
        resultados.push({ sala: d.branch_id, cerrado: true, z: z.id_corte, aviso: z.aviso ?? null });
        continue;
      }

      // El día ya tenía su Z en el sistema de la caja y el portal todavía no
      // lo había visto: no hay nada que anotar, ya cerró alguien.
      // Lo mismo si el juez, preguntado otra vez, ya ve el Z o una caja cerrada.
      if (z?.ya_estaba === true || (z?.no_procede === true && SIN_NOVEDAD.has(String(z.motivo)))) {
        resultados.push({ sala: d.branch_id, motivo: "ya_tiene_z" });
        continue;
      }

      const motivo = z?.turno_parado === true ? "turno_parado"
        : z?.no_procede === true ? String(z.motivo ?? "no_procede")
        : "fallo_al_emitir";
      await anotar(d, "no_cerrado", {
        motivo, detalle: { status: r.status, error: z?.error ?? null },
      });
      console.error(`[cierre-automatico-caja] sala=${d.branch_id} no se cerró (${motivo}): ${z?.error ?? r.status}`);
      resultados.push({ sala: d.branch_id, cerrado: false, motivo, error: z?.error ?? null });
    }

    return json({ ok: true, simulado: simular, resultados });
  } catch (e) {
    console.error("[cierre-automatico-caja]", e);
    return json({ ok: false, error: (e as Error)?.message ?? String(e) }, 500);
  }
});
