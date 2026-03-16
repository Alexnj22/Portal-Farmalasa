import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { branchName, historyData } = await req.json()

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')?.trim()
    if (!geminiApiKey) throw new Error("API Key no encontrada en Supabase.")

    // 1. OBTENER MODELOS AUTORIZADOS
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`
    const listResponse = await fetch(listUrl)
    const listData = await listResponse.json()

    if (!listData.models) throw new Error("No se pudo obtener la lista de modelos de Google.")

    const validModels = listData.models.filter((m: any) => 
      m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')
    )
    if (validModels.length === 0) throw new Error("API Key sin modelos válidos.")

    let targetModel = validModels.find((m: any) => m.name.includes('flash')) 
                      || validModels.find((m: any) => m.name.includes('pro')) 
                      || validModels[0];

    // 2. CREAR EL PROMPT CON EL HISTORIAL
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${targetModel.name}:generateContent?key=${geminiApiKey}`

    const prompt = `Eres un Gerente de Operaciones analizando una sucursal. 
    A continuación, te proporcionaré los últimos registros en el historial de la sucursal llamada "${branchName}". 
    Los datos están en formato JSON y comprimidos (fecha, acción, detalle y usuario).
    
    Por favor, devuelve un resumen ejecutivo estructurado en 2 o 3 párrafos breves. 
    Destaca lo más importante: permisos ingresados, problemas recurrentes, pagos, o actividades clave. 
    No saludes, ve directo al análisis. Puedes usar negritas (**) para resaltar conceptos clave.
    
    HISTORIAL DE SUCURSAL:
    ${historyData}`

    // 3. ENVIAR A GOOGLE
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    })

    const geminiData = await response.json()
    
    if (!response.ok) throw new Error(JSON.stringify(geminiData))
    if (!geminiData.candidates || geminiData.candidates.length === 0) throw new Error("Gemini no devolvió texto.")

    const cleanResponse = geminiData.candidates[0].content.parts[0].text.trim()

    return new Response(JSON.stringify({ success: true, aiSummary: cleanResponse }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('Error de IA Historial:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})