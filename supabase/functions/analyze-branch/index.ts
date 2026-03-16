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
    const { branchName, branchData } = await req.json()

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')?.trim()
    if (!geminiApiKey) throw new Error("API Key no encontrada en Supabase.")

    // 1. Obtener la lista de modelos válidos (A prueba de fallos)
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

    // 2. Construir el prompt estructurado
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${targetModel.name}:generateContent?key=${geminiApiKey}`

    const prompt = `Eres un asistente de Inteligencia Artificial de nivel directivo.
    Se te entregará el estado actual en tiempo real de la sucursal "${branchName}".
    
    Por favor, redacta un reporte ejecutivo muy breve (2 o 3 párrafos cortos) con el siguiente formato mental:
    1. Si está operando en este momento y cuántos empleados y kioscos tiene activos.
    2. Si tiene alertas críticas urgentes que deban atenderse inmediatamente.
    3. Si su nivel de documentación o perfil está completo o si hay áreas de oportunidad.
    
    Sé conciso, directo y profesional. No saludes. Usa negritas (**) para resaltar estados o métricas clave.

    DATOS EN TIEMPO REAL:
    ${branchData}`

    // 3. Ejecutar la llamada a Google
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
    console.error('Error de IA Sucursal:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})