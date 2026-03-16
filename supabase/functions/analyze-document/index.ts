import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { filePath, bucketName } = await req.json()

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: fileData, error: downloadError } = await supabase.storage
      .from(bucketName)
      .download(filePath)
      
    if (downloadError) throw downloadError

    const arrayBuffer = await fileData.arrayBuffer()
    const base64 = encode(arrayBuffer)
    const mimeType = fileData.type || 'application/pdf'

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')?.trim()
    if (!geminiApiKey) throw new Error("API Key no encontrada en Supabase.")

    // 1. PREGUNTAR A GOOGLE QUÉ MODELOS EXISTEN PARA ESTA LLAVE
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`
    const listResponse = await fetch(listUrl)
    const listData = await listResponse.json()

    if (!listData.models) {
      throw new Error("No se pudo obtener la lista de modelos de Google. Revisa tu API Key.")
    }

    // 2. BUSCAR UN MODELO AUTORIZADO
    const validModels = listData.models.filter((m: any) => 
      m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')
    )

    if (validModels.length === 0) {
      throw new Error("Tu API Key está bloqueada y no tiene modelos de generación de contenido habilitados.")
    }

    // Priorizar uno que diga "flash" o "pro", si no, tomar el primero de la lista
    let targetModel = validModels.find((m: any) => m.name.includes('flash')) 
                      || validModels.find((m: any) => m.name.includes('pro')) 
                      || validModels[0];

    console.log("Modelo asignado por Google:", targetModel.name);

    // 3. EJECUTAR EL ANÁLISIS CON LA URL PERFECTA
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${targetModel.name}:generateContent?key=${geminiApiKey}`

    const prompt = `Eres un auditor legal experto. Analiza este documento.
    Extrae la siguiente información y devuelve ÚNICAMENTE un JSON válido (sin markdown, solo las llaves y valores):
    {
      "aiSummary": "Un resumen muy profesional y directo de máximo 2 líneas destacando lo más importante.",
      "issueDate": "Fecha de expedición en formato YYYY-MM-DD. Usa null si no existe.",
      "expDate": "Fecha de vencimiento en formato YYYY-MM-DD. Usa null si no existe."
    }`

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }]
      })
    })

    const geminiData = await response.json()
    
    if (!response.ok) {
      throw new Error(JSON.stringify(geminiData))
    }

    if (!geminiData.candidates || geminiData.candidates.length === 0) {
      throw new Error("Gemini no devolvió candidatos válidos.")
    }

    const rawText = geminiData.candidates[0].content.parts[0].text
    const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim()
    const parsedAI = JSON.parse(cleanJson)

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