import { getCorsHeaders } from "../_shared/security.ts"
import { callGemini } from "../_shared/gemini.ts"

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { branchName, historyData } = await req.json()

    const prompt = `Eres un Gerente de Operaciones analizando una sucursal.
    A continuación, te proporcionaré los últimos registros en el historial de la sucursal llamada "${branchName}".
    Los datos están en formato JSON y comprimidos (fecha, acción, detalle y usuario).

    Por favor, devuelve un resumen ejecutivo estructurado en 2 o 3 párrafos breves.
    Destaca lo más importante: permisos ingresados, problemas recurrentes, pagos, o actividades clave.
    No saludes, ve directo al análisis. Puedes usar negritas (**) para resaltar conceptos clave.

    HISTORIAL DE SUCURSAL:
    ${historyData}`

    const cleanResponse = (await callGemini({ prompt })).trim()

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
