import { createClient } from "npm:@supabase/supabase-js@2"
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts"
import { callGemini, parseGeminiJson } from "../_shared/gemini.ts"

// SALY — ayuda en pantalla (docs/PLAN-SALY-AYUDA-EN-PANTALLA-2026-11-04.md).
//
// La llama el NAVEGADOR con la sesión de quien pregunta → JWT (nunca
// `--no-verify-jwt`). Sólo entra acá una pregunta ESCRITA: los avisos y sus
// explicaciones los arma el portal sin IA.
//
// El costo es la restricción del usuario («que Saly no cueste mucho, lo mínimo
// posible»), y se cuida en cinco lugares:
//   · el modelo más barato (flash-lite) y SIN pensamiento;
//   · lo que se le manda es lo que la pantalla resume (≤3,500 caracteres), no
//     el DOM ni la tabla entera, y la guía es sólo la del módulo;
//   · contesta en PIEZAS (JSON corto), con tope de salida;
//   · 30 preguntas por persona y por día, contadas en la base;
//   · el navegador no repite la misma pregunta sobre la misma pantalla.
// Medido a precios de lista: ~1,800 tokens de entrada y ~250 de salida por
// pregunta ≈ $0.0003. Mil preguntas al mes, unos 30 centavos.

const MODELO = "gemini-2.5-flash-lite"
const TOPE_DIARIO = 30
const MAX_PANTALLA = 3500
const MAX_PREGUNTA = 300
const RETENCION_DIAS = 180

// La guía de cada pantalla: qué es, qué significa cada número, qué se hace y
// qué NO puede decidir Saly. Es lo que evita que invente.
const GUIAS: Record<string, string> = {
  cortes_caja: `PANTALLA: Cortes de caja (lista de cortes de todas las salas a las que la persona tiene acceso).
- Un CORTE es contar el efectivo del cajón en un momento del día. Tipo C = corte del turno; tipo Z = cierre del día (no se deshace).
- ESPERADO = lo que el sistema dice que debería haber en el cajón. CONTADO = lo que la persona contó. DIFERENCIA = contado − esperado: negativa es FALTANTE, positiva es SOBRANTE.
- Estados: PENDIENTE (nadie lo firmó), CONFIRMADO (alguien dio por bueno el conteo), DESCARTADO (el conteo se tiró, no cuenta).
- Un faltante suele ser un vale o un pago a proveedor que no se anotó, un cobro con tarjeta registrado como efectivo, o vuelto mal dado. Se revisa en Mi caja.
- Los cobros de créditos en efectivo hechos desde el portal YA se suman al esperado.
- Quien decide qué pasa con un faltante es quien supervisa la sala, no Saly.
- Filtros: sala, estado, diferencia (falta/sobra/ok), búsqueda y periodo.`,
  caja: `PANTALLA: Mi caja, pestaña Hoy (la caja de una sala, el día de hoy).
- Pasos del día: abrir caja → anotar ingresos y vales → hacer cortes (contar el cajón) y confirmarlos → cerrar el día (corte Z, no se deshace).
- Cerrar el día tiene CUATRO frenos: (1) un corte sin confirmar ni descartar; (2) ningún corte confirmado hoy; (3) entró efectivo después del último corte confirmado (hay que hacer otro corte y contarlo); (4) quedan preventas guardadas sin finalizar en la caja.
- "Falta por contar" = dinero que entró después del último conteo confirmado. No es un faltante: es dinero que nadie contó todavía.
- Si nadie cierra el día, el portal lo cierra solo una hora después de la hora de cierre, siempre que haya un corte reciente.
- Un vale es una salida de efectivo (pago a proveedor, compra menor). Hay que anotarlo con su boleta.
- Saly no puede abrir, cortar ni cerrar la caja: sólo explicar y llevar.`,
}

const PERSONA = `Eres Saly, la ayuda en pantalla del portal de "Farmacia La Salud" y "La Popular". No eres una persona ni tienes género: eres una presencia cálida que explica lo que hay en pantalla.
Hablas en español neutro, de "tú", sin voseo y sin emojis. Primera persona con verbos ("me preocupa", "te explico"), nunca adjetivos con género sobre ti.
Reglas:
1. Responde SOLO con lo que dice la GUÍA y los DATOS DE LA PANTALLA. Si no está ahí, dilo ("eso no lo veo en esta pantalla") y sugiere a quién preguntar (supervisión de la sala o quien administra el portal). Nunca inventes números ni nombres.
2. No guardas, apruebas ni envías nada. Puedes PONER FILTROS de la pantalla (sólo valores de las opciones que se te dan) y LLEVAR a otra pantalla.
3. Corto y por pasos. Nunca párrafos largos.
4. No regañes ni culpes a nadie.`

const FORMATO = `Responde SOLO un JSON con esta forma:
{"animo":"alegria|atencion|preocupacion|pensando","piezas":[...],"filtros":{"clave":"valor"},"recuerda":"..."}
Piezas permitidas (usa 2 a 4, la primera siempre "titular"):
{"tipo":"titular","texto":"≤60 car.","sub":"≤60 car."}
{"tipo":"cifras","items":[{"rotulo":"≤14","valor":"≤12","tono":"mal|bien"}]}  (hasta 3)
{"tipo":"barras","items":[{"rotulo":"≤14","valor":123,"texto":"≤10","tono":"mal|bien"}]}  (hasta 5, para comparar)
{"tipo":"pasos","items":["≤90 car. cada uno, **negrita** permitida"]}  (hasta 4)
{"tipo":"nota","texto":"≤140 car."}
{"tipo":"botones","items":[{"texto":"≤24","ir":"/ruta"}]}  (sólo rutas de la GUÍA o /caja?tab=hoy, /caja?tab=cortes)
"filtros": sólo si la pregunta pide ver algo que un filtro muestra; si no, {}.
"recuerda": una frase corta sobre la persona que sirva la próxima vez (qué suele preguntar), o "" si nada.`

const corto = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n)

// Gemela de `validarPiezas` de src/utils/salyAyuda.js: si cambia una regla,
// cambian las dos. El navegador vuelve a validar al pintar.
function validarPiezas(lista: unknown): unknown[] {
  if (!Array.isArray(lista)) return []
  const tono = (t: unknown) => (t === "mal" || t === "bien" ? t : undefined)
  const out: unknown[] = []
  for (const p of lista.slice(0, 6) as any[]) {
    if (!p || typeof p !== "object") continue
    const items = Array.isArray(p.items) ? p.items : []
    switch (p.tipo) {
      case "titular":
        if (corto(p.texto, 90)) out.push({ tipo: "titular", texto: corto(p.texto, 90), sub: corto(p.sub, 90) || undefined })
        break
      case "cifras": {
        const it = items.slice(0, 3).map((i: any) => ({ rotulo: corto(i?.rotulo, 18), valor: corto(i?.valor, 14), tono: tono(i?.tono) }))
          .filter((i: any) => i.rotulo && i.valor)
        if (it.length) out.push({ tipo: "cifras", items: it })
        break
      }
      case "barras": {
        const it = items.slice(0, 5).map((i: any) => ({ rotulo: corto(i?.rotulo, 16), valor: Math.abs(Number(i?.valor)) || 0, texto: corto(i?.texto, 12), tono: tono(i?.tono) }))
          .filter((i: any) => i.rotulo)
        if (it.length) out.push({ tipo: "barras", items: it })
        break
      }
      case "pasos": {
        const it = items.slice(0, 4).map((t: unknown) => corto(t, 110)).filter(Boolean)
        if (it.length) out.push({ tipo: "pasos", items: it })
        break
      }
      case "nota":
        if (corto(p.texto, 160)) out.push({ tipo: "nota", texto: corto(p.texto, 160) })
        break
      case "botones": {
        const it = items.slice(0, 2).map((b: any) => ({ texto: corto(b?.texto, 28), ir: /^\/[a-z0-9\-/?=&_]*$/i.test(b?.ir || "") ? b.ir : undefined }))
          .filter((b: any) => b.texto && b.ir)
        if (it.length) out.push({ tipo: "botones", items: it })
        break
      }
    }
  }
  return out
}

// Se vuelve a tapar acá: el navegador ya lo hizo, pero la función no confía en él.
function tapar(t: string): string {
  return t
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[correo oculto]")
    .replace(/\b\d{4}-?\d{6}-?\d{3}-?\d\b/g, "[NIT oculto]")
    .replace(/\b\d{8}-\d\b/g, "[DUI oculto]")
    .replace(/(?:\+?503[\s-]?)?\b[267]\d{3}[\s-]?\d{4}\b/g, "[teléfono oculto]")
    .replace(/((?:salario|sueldo|salary)[^\d$]{0,20})\$?\s?[\d,]+(?:\.\d+)?/gi, "$1[monto oculto]")
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  const responder = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } })
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
  const emp = await requireActiveEmployeeUser(req, admin)
  if (!emp) return responder({ ok: false, motivo: "SESION" }, 401)

  try {
    const body = await req.json().catch(() => ({}))
    const modulo = String(body?.modulo || "")
    const guia = GUIAS[modulo]
    const pregunta = corto(body?.pregunta, MAX_PREGUNTA)
    if (!guia || !pregunta) return responder({ ok: false, motivo: "PEDIDO" }, 400)
    const pantalla = tapar(String(body?.pantalla || "")).slice(0, MAX_PANTALLA)
    const preguntaLimpia = tapar(pregunta)
    // Lo que la persona señaló en pantalla (arrastrando a Saly o con
    // «Señalar»): el texto visible de ese bloque, ya tapado en el navegador.
    const senalado = tapar(corto(body?.senalado, 600))

    // Filtros que la pantalla ofrece: la IA sólo puede elegir entre éstos.
    const filtrosIn = (body?.filtros && typeof body.filtros === "object") ? body.filtros as Record<string, any> : {}
    const filtros: Record<string, { rotulo: string; opciones: string[] }> = {}
    for (const [k, f] of Object.entries(filtrosIn).slice(0, 6)) {
      const ops = (Array.isArray(f?.opciones) ? f.opciones : []).slice(0, 30)
        .map((o: any) => `${corto(o?.value, 40)}=${corto(o?.label, 40)}`)
      if (ops.length) filtros[corto(k, 30)] = { rotulo: corto(f?.rotulo, 30), opciones: ops }
    }

    // Tope diario, contado en la base.
    const desde = new Date(Date.now() - 24 * 3600_000).toISOString()
    const { count, error: eCount } = await admin.from("saly_ayuda_registro")
      .select("id", { count: "exact", head: true }).eq("employee_id", emp.id).gte("created_at", desde)
    if (eCount) throw eCount
    if ((count ?? 0) >= TOPE_DIARIO) return responder({ ok: false, motivo: "TOPE", quedan: 0 })

    const { data: mem, error: eMem } = await admin.from("saly_ayuda_memoria")
      .select("resumen").eq("employee_id", emp.id).maybeSingle()
    if (eMem) throw eMem

    const prompt = `${PERSONA}

GUÍA:
${guia}

LO QUE SÉ DE ESTA PERSONA: ${mem?.resumen || "(nada todavía)"}

FILTROS DISPONIBLES (clave: valor=rótulo):
${Object.entries(filtros).map(([k, f]) => `${k} (${f.rotulo}): ${f.opciones.join(" | ")}`).join("\n") || "(ninguno)"}

DATOS DE LA PANTALLA:
${pantalla || "{}"}
${senalado ? `\nLO QUE LA PERSONA SEÑALÓ (la pregunta es sobre ESTO; es el texto tal como se ve en pantalla):\n${senalado}\n` : ""}
PREGUNTA: ${preguntaLimpia}

${FORMATO}`

    let tokens = 0
    const crudo = await callGemini({
      prompt, model: MODELO, temperature: 0.2, jsonOutput: true, thinkingBudget: 0, timeoutMs: 20_000,
      uso: (u) => { tokens = (u.promptTokenCount || 0) + (u.candidatesTokenCount || 0) },
    })
    const r = parseGeminiJson<any>(crudo)
    const animo = ["alegria", "atencion", "preocupacion", "pensando"].includes(r?.animo) ? r.animo : "atencion"
    const piezas = validarPiezas(r?.piezas)
    if (!piezas.length) piezas.push({ tipo: "titular", texto: "No supe cómo responder eso", sub: "Pregúntale a quien supervisa la sala" })

    // Sólo valores que existen en las opciones.
    const filtrosOut: Record<string, string> = {}
    for (const [k, v] of Object.entries(r?.filtros && typeof r.filtros === "object" ? r.filtros : {})) {
      if (filtros[k]?.opciones.some((o) => o.split("=")[0] === String(v))) filtrosOut[k] = String(v)
    }

    const { data: fila, error: eIns } = await admin.from("saly_ayuda_registro").insert({
      employee_id: emp.id, modulo, pregunta: senalado ? `${preguntaLimpia} ⟨señaló: ${senalado.slice(0, 200)}⟩` : preguntaLimpia,
      respuesta: { animo, piezas, filtros: filtrosOut }, tokens,
    }).select("id").single()
    if (eIns) throw eIns

    const recuerda = corto(r?.recuerda, 200)
    if (recuerda) {
      const nuevo = [mem?.resumen, recuerda].filter(Boolean).join(" · ").slice(-600)
      const { error: eUp } = await admin.from("saly_ayuda_memoria")
        .upsert({ employee_id: emp.id, resumen: nuevo, updated_at: new Date().toISOString() })
      if (eUp) console.error("[saly-ayuda] memoria", eUp.message)
    }

    // Retención: lo viejo se borra al anotar, sin cron (pocas filas al día).
    const { error: eDel } = await admin.from("saly_ayuda_registro").delete()
      .lt("created_at", new Date(Date.now() - RETENCION_DIAS * 86400_000).toISOString())
    if (eDel) console.error("[saly-ayuda] retención", eDel.message)

    return responder({ ok: true, id: fila.id, animo, piezas, filtros: filtrosOut, quedan: TOPE_DIARIO - (count ?? 0) - 1 })
  } catch (err) {
    console.error("[saly-ayuda]", err instanceof Error ? err.message : err)
    return responder({ ok: false, motivo: "FALLA" }, 500)
  }
})
