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
    const { branchName, branchData } = await req.json()

    const prompt = `Eres un asistente de Inteligencia Artificial de nivel directivo.
    Se te entregará el estado actual en tiempo real de la sucursal "${branchName}".

    Por favor, redacta un reporte ejecutivo muy breve (2 o 3 párrafos cortos) con el siguiente formato mental:
    1. Si está operando en este momento y cuántos empleados y kioscos tiene activos.
    2. Si tiene alertas críticas urgentes que deban atenderse inmediatamente.
    3. Si su nivel de documentación o perfil está completo o si hay áreas de oportunidad.

    Sé conciso, directo y profesional. No saludes. Usa negritas (**) para resaltar estados o métricas clave.

    DATOS EN TIEMPO REAL:
    ${branchData}`

    const cleanResponse = (await callGemini({ prompt })).trim()

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
