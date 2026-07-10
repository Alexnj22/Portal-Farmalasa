import { createClient } from "npm:@supabase/supabase-js@2"
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts"
import { callGemini } from "../_shared/gemini.ts"

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Auditoría 2026-07: gate obligatorio — antes cualquiera con la anon key
  // pública podía quemar cuota de Gemini sin ninguna sesión real.
  // Ver AUDITORIA-2026-07.md, sección Remediado.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const employee = await requireActiveEmployeeUser(req, admin)
  if (!employee) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 401,
    })
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
