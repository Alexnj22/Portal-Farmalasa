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
    const { filePath, bucketName } = await req.json()

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

    const prompt = `Eres un auditor legal experto. Analiza este documento.
    Extrae la siguiente información y devuelve ÚNICAMENTE un JSON válido (sin markdown, solo las llaves y valores):
    {
      "aiSummary": "Un resumen muy profesional y directo de máximo 2 líneas destacando lo más importante.",
      "issueDate": "Fecha de expedición en formato YYYY-MM-DD. Usa null si no existe.",
      "expDate": "Fecha de vencimiento en formato YYYY-MM-DD. Usa null si no existe."
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
