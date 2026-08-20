import { createClient } from "npm:@supabase/supabase-js@2"
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts"
import { callGemini, parseGeminiJson } from "../_shared/gemini.ts"
import { callClaude, parseClaudeJson } from "../_shared/claude.ts"

// ════════════════════════════════════════════════════════════════════════════
// Lee la foto del comprobante de una salida de dinero y la cuadra contra lo
// que la persona escribió.
//
// Pedido del usuario el 2026-08-20, mirando una salida real: «no puedes
// detectar que sea una boleta válida (que no tomen foto de otra cosa)». La
// única forma de saberlo sin adivinar es LEER la boleta y comparar contra los
// tres datos que el formulario ya pide: entidad, número de boleta y monto. Un
// heurístico de «esto parece un documento» caza la foto de una pared, no la
// foto de OTRA boleta ni la de la boleta de $50 para una salida de $200.
//
// ── La imagen viaja INLINE, no por el bucket ────────────────────────────────
// `analyze-document` recibe un `filePath` y se lo descarga a Storage. Acá no
// sirve: la verificación pasa ANTES de guardar, y subir para verificar dejaría
// en `payment-proofs` la basura de cada intento fallido —justo las fotos que se
// decidió no guardar—. Llega en base64 y no toca el bucket.
//
// ── Devuelve además el RECUADRO del papel ───────────────────────────────────
// «Que detectes y recortes el papel». Bajar un modelo de visión al teléfono se
// evaluó y se descartó (ver `EditorDeDocumento`): pesa megabytes y se equivoca
// con una foto movida sobre un mostrador. Pero si la imagen YA viaja acá para
// leerla, el recuadro sale de la misma llamada y no cuesta nada extra. Entra
// como SUGERENCIA: el editor abre con ese recorte puesto y la persona lo
// confirma o lo corrige. Un recorte automático que nadie mira es peor que uno
// manual — eso no cambió.
//
// ── Quién lee: una constante, no un `if` escondido ──────────────────────────
// El usuario preguntó el 2026-08-20 si convenía usar Claude en vez de Gemini
// («te tengo completo, así tú te encargas»). La respuesta corta es que su
// suscripción de Claude NO es una API key: la API se factura aparte, con una
// key de console.anthropic.com. Mientras esa key no exista en los secretos de
// Supabase, esto lee con Gemini, que ya está configurado y ya lo usan otras
// seis funciones del portal.
//
// El cambio es esta línea. Va como constante y no como «si hay key usá Claude,
// si no Gemini» a propósito: un camino que se elige solo hace que nadie sepa
// cuál corrió, y el día que la lectura falle no se puede saber quién falló.
const LECTOR: 'gemini' | 'claude' = 'gemini'

// ── El veredicto lo arma esta función, no el modelo ─────────────────────────
// El modelo sólo LEE. Comparar es aritmética y comparación de cadenas, y eso se
// hace acá: si la decisión de bloquear dependiera de que el modelo diga «no
// coincide», bastaría con que un día conteste distinto para que la regla cambie
// sola. El modelo aporta datos; la regla vive en código que se puede leer.
// ════════════════════════════════════════════════════════════════════════════

/** Deja sólo dígitos: los números de boleta se escriben `000292`, `292`, `# 292`. */
const soloDigitos = (v: unknown) => String(v ?? '').replace(/\D+/g, '')

/** `000292` y `292` son la MISMA boleta: se comparan sin los ceros de adelante. */
const mismaBoleta = (a: unknown, b: unknown) => {
  const x = soloDigitos(a).replace(/^0+/, '')
  const y = soloDigitos(b).replace(/^0+/, '')
  return !!x && x === y
}

/** Un centavo de tolerancia, que es ruido de coma flotante y no una diferencia. */
const mismoMonto = (a: unknown, b: unknown) => {
  const x = Number(a), y = Number(b)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  return Math.abs(x - y) < 0.01
}

/**
 * La entidad se compara con tolerancia: en la boleta puede salir
 * `TRANSNETWORK WS` y en el portal `TRANSNETWORK`. Basta con que una contenga
 * a la otra una vez normalizadas — es el mismo criterio de `buscarCargo`.
 */
const norm = (v: unknown) => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

const mismaEntidad = (a: unknown, b: unknown) => {
  const x = norm(a), y = norm(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

const PROMPT = `Estás mirando la foto de un comprobante de pago impreso (una "boleta" o
"voucher" de un punto de venta, casi siempre papel térmico angosto), tomada con un
teléfono sobre un mostrador.

Devuelve ÚNICAMENTE un JSON válido con esta forma exacta:
{
  "es_boleta": true | false,
  "entidad": "el nombre del comercio, banco o red de remesas impreso arriba, o null",
  "numero_boleta": "el número rotulado BOLETA / VOUCHER / RECIBO / No., sólo dígitos, o null",
  "monto": 0.00,
  "moneda": "USD" | null,
  "fecha": "YYYY-MM-DD o null",
  "recuadro": { "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 },
  "legible": true | false,
  "motivo": "si es_boleta es false, en una frase corta y en español, qué se ve en la foto"
}

Reglas:
- "es_boleta" es false si la foto no muestra un comprobante impreso (una pared, un
  producto, una pantalla, una persona, una hoja en blanco, un documento de otro tipo).
- "monto" es el TOTAL cobrado o entregado, como número, sin símbolo de moneda ni
  separadores de miles. Si hay varios importes, el que está rotulado MONTO o TOTAL.
- "numero_boleta" es el correlativo del comprobante. NO uses la referencia, la
  autorización, el terminal ni el DUI.
- "recuadro" es la caja que encierra SÓLO el papel dentro de la foto, en fracciones
  de 0 a 1 sobre el ancho y el alto de la imagen (x,y = esquina superior izquierda).
  Si el papel ocupa toda la foto, devuelve {"x":0,"y":0,"w":1,"h":1}.
- "legible" es false si la impresión está tan borrosa, quemada o cortada que no se
  pueden leer los importes.
- Si un dato no está en la foto, null. No lo inventes ni lo deduzcas.`

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  // Mismo gate que las demás funciones con Gemini: sin sesión de empleado
  // activo, cualquiera con la anon key pública quemaría la cuota.
  const employee = await requireActiveEmployeeUser(req, admin)
  if (!employee) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { imagenBase64, mimeType, esperado } = await req.json()
    if (!imagenBase64) {
      return new Response(JSON.stringify({ error: 'SIN_IMAGEN' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // El formulario está abierto con alguien esperando: si tarda más que esto,
    // conviene decirlo y ofrecer reintentar antes que dejar la pantalla colgada.
    const TIMEOUT_MS = 45_000
    const leido = LECTOR === 'claude'
      ? parseClaudeJson<Record<string, unknown>>(await callClaude({
          prompt: PROMPT,
          imagenes: [{ mimeType: mimeType || 'image/jpeg', data: imagenBase64 }],
          effort: 'low',
          timeoutMs: TIMEOUT_MS,
        }))
      : parseGeminiJson<Record<string, unknown>>(await callGemini({
          prompt: PROMPT,
          inlineData: [{ mimeType: mimeType || 'image/jpeg', data: imagenBase64 }],
          jsonOutput: true,
          temperature: 0,
          timeoutMs: TIMEOUT_MS,
        }))

    // ── La regla, en código ────────────────────────────────────────────────
    const esperaBoleta = !!(esperado?.numeroBoleta)
    const coincide = {
      entidad: esperado?.entidad ? mismaEntidad(leido.entidad, esperado.entidad) : null,
      numeroBoleta: esperaBoleta ? mismaBoleta(leido.numero_boleta, esperado.numeroBoleta) : null,
      monto: esperado?.monto != null ? mismoMonto(leido.monto, esperado.monto) : null,
    }

    let veredicto = 'OK'
    if (!leido.es_boleta) veredicto = 'NO_ES_BOLETA'
    else if (leido.legible === false) veredicto = 'ILEGIBLE'
    else if (coincide.monto === false) veredicto = 'MONTO_NO_COINCIDE'
    else if (coincide.numeroBoleta === false) veredicto = 'BOLETA_NO_COINCIDE'
    else if (coincide.entidad === false) veredicto = 'ENTIDAD_NO_COINCIDE'

    return new Response(JSON.stringify({ leido, coincide, veredicto }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    // Sin veredicto: no es «la boleta está mal», es «no se pudo preguntar». La
    // pantalla tiene que decir esas dos cosas distinto — una se arregla sacando
    // otra foto y la otra reintentando.
    return new Response(JSON.stringify({ error: 'NO_SE_PUDO_LEER', detalle: String((err as Error)?.message || err) }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
