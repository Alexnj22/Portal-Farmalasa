import { createClient } from "npm:@supabase/supabase-js@2"
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"
import { getCorsHeaders, requireAuthUser } from "../_shared/security.ts"
import { callGemini, parseGeminiJson } from "../_shared/gemini.ts"

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const user = await requireAuthUser(req)
  if (!user) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { filePath, bucketName, buscarPersonas } = await req.json()

    // Auditoría 2026-07: whitelist de buckets. La descarga usa service_role
    // (bypasea RLS), así que sin esto cualquier usuario autenticado podía pedir
    // el análisis de un archivo de CUALQUIER bucket, incluido 'backups' (IDOR).
    const ALLOWED_DOC_BUCKETS = ['documents', 'empleados', 'payment-proofs']
    if (!ALLOWED_DOC_BUCKETS.includes(bucketName)) {
      return new Response(JSON.stringify({ error: "BUCKET_NOT_ALLOWED" }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: fileData, error: downloadError } = await supabase.storage
      .from(bucketName)
      .download(filePath)

    if (downloadError) throw downloadError

    const base64 = encode(await fileData.arrayBuffer())
    const mimeType = fileData.type || 'application/pdf'

    /* ── Los nombres, sólo cuando se piden ─────────────────────────────────
     *
     * El acuse del Ministerio de Trabajo por una recontratación nombra a VARIAS
     * personas: es un papel de la empresa, no de cada quien. Para poder
     * asignarlo a todos de una vez hay que saber a quiénes cubre.
     *
     * Va detrás de una bandera y no siempre: pedir nombres en CADA documento
     * agrega trabajo al modelo para una respuesta que en un carné o una licencia
     * no se usa, y un campo que nadie mira es un campo que se llena mal sin que
     * nadie lo note.
     *
     * La instrucción es deliberadamente estrecha — TRABAJADORES LISTADOS, no
     * «nombres» — porque en ese papel también aparecen el representante legal,
     * el nombre de la empresa y quien firma en el Ministerio. Meterlos en la
     * lista propondría asignarle a un funcionario público un documento del
     * expediente de otra persona. */
    const bloquePersonas = buscarPersonas
      ? `,
      "personas": ["Nombre completo de CADA TRABAJADOR listado en el documento, tal como está escrito. SOLO trabajadores: NO incluyas al representante legal, ni al patrono, ni a la empresa, ni a funcionarios o firmantes del Ministerio. Si el documento nombra a una sola persona, devuelve esa. Si no puedes distinguir con seguridad quiénes son los trabajadores, devuelve una lista vacía."]`
      : ''

    const prompt = `Eres un auditor legal experto. Analiza este documento.
    Extrae la siguiente información y devuelve ÚNICAMENTE un JSON válido (sin markdown, solo las llaves y valores):
    {
      "aiSummary": "Un resumen muy profesional y directo de máximo 2 líneas destacando lo más importante.",
      "issueDate": "Fecha de expedición en formato YYYY-MM-DD. Usa null si no existe.",
      "expDate": "Fecha de vencimiento en formato YYYY-MM-DD. Usa null si no existe.",
      "numeroDeRegistro": "El numero de inscripcion, registro o junta que identifica a la persona en el documento — por ejemplo el numero de la Junta de Vigilancia (JVPQF, JVPE, JVPM) o del Consejo de Vigilancia de la Profesion de Contaduria Publica. Devuelve SOLO el numero o codigo, sin la palabra que lo antecede. Usa null si el documento no lo trae o si no estas seguro de cual de los numeros del documento es."${bloquePersonas}
    }`

    const rawText = await callGemini({
      prompt,
      inlineData: [{ mimeType, data: base64 }],
      jsonOutput: true,
    })
    const parsedAI = parseGeminiJson(rawText)

    return new Response(JSON.stringify({ success: true, aiData: parsedAI }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('Error de IA:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
