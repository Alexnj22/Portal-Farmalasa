import { createClient } from "npm:@supabase/supabase-js@2"
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts"
import { callGemini, parseGeminiJson } from "../_shared/gemini.ts"

// ════════════════════════════════════════════════════════════════════════════
// Lee la orden de descuento de un préstamo (2026-10-14).
//
// Pedido del usuario: «se subirá una/unas fotos del documento, y ahí que tome
// los datos como confirmar empleado, fecha de inicio, fin, tasa, cuota, monto…
// (pero que sean editables) buscando siempre usar la menor cantidad de tokens
// posibles, e identifica el banco».
//
// ── Por qué es tan corto ────────────────────────────────────────────────────
// Lo que se cobra es la SALIDA, y en 2.5-flash el pensamiento cuenta como
// salida (ver `_shared/gemini.ts`: 8× el precio de la entrada). Por eso:
//   · prompt de pocas líneas y claves cortas — la respuesta es ~150 tokens;
//   · sin resumen ni texto libre: sólo los campos que la pantalla usa;
//   · `thinkingBudget: 128`, el techo medido en las boletas (igual precisión
//     que el dinámico con 94% menos pensamiento; 0 derrumba el caso difícil);
//   · las fotos llegan ya reducidas a 1400 px desde el navegador
//     (`aBase64Reducido`) e INLINE: no se suben para leerlas.
// El banco se devuelve como texto y el navegador lo cruza con su catálogo
// (`constants/bancos.js`): pedirle al modelo que elija de una lista larga
// cuesta tokens de entrada en cada llamada.
//
// Nada se guarda acá: devuelve lo leído y la persona confirma.
// ════════════════════════════════════════════════════════════════════════════

const PROMPT = `Orden de descuento de préstamo (El Salvador). Devuelve SOLO JSON:
{"nombre":"deudor/empleado","banco":"institución que presta","ref":"n° de préstamo","monto":0,"tasa":0,"cuota":0,"plazo":0,"periodicidad":"MENSUAL|QUINCENAL","inicio":"YYYY-MM-DD","fin":"YYYY-MM-DD"}
monto=monto del préstamo; tasa=% anual; cuota=a descontar por periodo; plazo=n° de cuotas. Usa null si no aparece. No inventes.`

const MAX_IMAGENES = 4

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const employee = await requireActiveEmployeeUser(req, admin)
  if (!employee) return json({ error: 'UNAUTHORIZED' }, 401)

  // Sólo quien puede escribir en un expediente: es el mismo permiso que
  // guardar la orden, y sin él cualquiera con sesión quemaría la cuota.
  const comoQuienLlama = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  )
  const { data: puede, error: errPermiso } = await comoQuienLlama.rpc('auth_can_edit_any', {
    p_modules: ['staff_detail', 'staff_list'],
  })
  if (errPermiso) return json({ error: errPermiso.message }, 500)
  if (!puede) return json({ error: 'FORBIDDEN' }, 403)

  try {
    const { imagenes } = await req.json().catch(() => ({}))
    const lista = Array.isArray(imagenes) ? imagenes.filter((i) => i?.data).slice(0, MAX_IMAGENES) : []
    if (!lista.length) return json({ error: 'SIN_IMAGEN' }, 400)

    const leido = parseGeminiJson<Record<string, unknown>>(await callGemini({
      prompt: PROMPT,
      inlineData: lista.map((i) => ({ mimeType: i.mimeType || 'image/jpeg', data: i.data })),
      jsonOutput: true,
      temperature: 0,
      thinkingBudget: 128,
      timeoutMs: 45_000,
    }))
    return json({ ok: true, leido })
  } catch (error) {
    console.error('leer-orden-de-descuento:', (error as Error).message)
    return json({ error: (error as Error).message }, 400)
  }
})
