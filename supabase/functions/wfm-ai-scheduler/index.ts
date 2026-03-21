import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 🚨 1. Atrapamos toda la data enriquecida del payload
    const payload = await req.json();
    const { branchId, employees, shifts, weekStartDate, weeklyHours, otherEmployees } = payload;

    if (!branchId || !employees || !shifts) {
      throw new Error("Faltan datos requeridos (branchId, employees, shifts).");
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 2. Extraer el patrón de tráfico de los últimos 30 días
    const { data: salesData, error: salesError } = await supabaseClient
      .from('branch_hourly_sales')
      .select('sale_hour, transaction_count')
      .eq('branch_id', branchId)
      .order('sale_date', { ascending: false })
      .limit(3000);

    let trafficSummary: Array<{hora: string, promedio_clientes: number}> = [];
    
    if (!salesError && salesData && salesData.length > 0) {
        const hourlyTraffic: Record<string, {total: number, count: number}> = {};
        salesData.forEach(row => {
          if (!hourlyTraffic[row.sale_hour]) hourlyTraffic[row.sale_hour] = { total: 0, count: 0 };
          hourlyTraffic[row.sale_hour].total += row.transaction_count;
          hourlyTraffic[row.sale_hour].count += 1;
        });

        trafficSummary = Object.keys(hourlyTraffic).map(hour => ({
          hora: `${hour}:00`,
          promedio_clientes: Math.round(hourlyTraffic[hour].total / hourlyTraffic[hour].count)
        })).sort((a, b) => parseInt(a.hora) - parseInt(b.hora));
    }

    // 3. Preparar el SÚPER PROMPT para Gemini (Versión Ultra Pro)
    const systemInstruction = `
    Eres un experto matemático y estratega en Workforce Management (WFM) para una cadena de farmacias.
    Tu objetivo es armar el horario semanal óptimo en formato JSON estricto, maximizando la cobertura y respetando las leyes laborales.
    
    REGLAS ESTRICTAS DE NEGOCIO:
    1. COBERTURA TOTAL: El horario DEBE cubrir completamente los horarios de apertura y cierre indicados en 'Horarios de Sucursal'. Si un día abren de 07:00 a 22:00, DEBE haber personal durante todo ese bloque utilizando los turnos del Catálogo.
    2. HORAS PICO: Garantiza solapamiento de turnos (doble o triple cobertura) en las horas con mayor "promedio_clientes" según el Tráfico Promedio.
    3. ALMUERZOS ESCALONADOS: Si un turno dura 8 horas o más Y cruza el bloque de 11:00 AM a 14:00 PM, OBLIGATORIAMENTE asigna a "lunchTime" la hora exacta de salida en formato de texto (ej. "12:00" o "13:00"). REGLA DE ORO: Si hay múltiples empleados, ESCALONA los almuerzos para jamás dejar vacía la sucursal. Si no aplica, pon false.
    4. LACTANCIA: Revisa el historial ('history') de cada empleado. Si tiene un permiso de 'LACTATION' o 'PERMISSION' relevante, asígnale a "lactationTime" la hora exacta de salida anticipada (ej. "15:00" o "16:00"). Si no aplica, pon false.
    5. LÍMITES LEGALES: Ningún empleado puede exceder las 44 horas semanales de trabajo efectivo. Todos deben tener al menos 1 día libre (no asignar shiftId ese día).
    6. DÉFICIT Y PRÉSTAMOS: Si es matemáticamente imposible cubrir la operación completa con los empleados locales sin violar las 44 horas:
       - Escribe una alerta detallada en el arreglo "warnings" indicando los huecos de cobertura (ej. "No hay cobertura de cierre el Sábado de 18:00 a 22:00").
       - Analiza 'Empleados de Otras Sucursales' y sugiere refuerzos lógicos en "suggestions" (ej. "Sugerimos solicitar apoyo a Carlos Ruiz (Dependiente, Sucursal Centro) para el turno de cierre del Sábado").

    FORMATO JSON EXACTO REQUERIDO:
    (NO devuelvas texto markdown \`\`\`json, SOLO la estructura JSON pura)
    {
      "ai_reasoning": "Resumen técnico de 2 líneas justificando la distribución, picos y almuerzos.",
      "warnings": ["Advertencia detallada si falta personal..."], 
      "suggestions": ["Sugerencia de préstamo de otra sucursal..."],
      "schedule": {
        "ID_DEL_EMPLEADO_1": {
          "1": { "shiftId": "ID_TURNO_A", "lunchTime": "12:00", "lactationTime": false },
          "2": { "shiftId": "ID_TURNO_B", "lunchTime": false, "lactationTime": "16:00" },
          "3": { "shiftId": "ID_TURNO_A", "lunchTime": "13:00", "lactationTime": false }
          // 1=Lunes ... 0=Domingo. Omitir el día (no enviar la llave) si le toca libre.
        }
      }
    }
    
    DATOS DE CONTEXTO:
    - Horarios de Sucursal (Apertura/Cierre): ${JSON.stringify(weeklyHours || {})}
    - Tráfico Promedio: ${JSON.stringify(trafficSummary)}
    - Empleados (De esta sucursal): ${JSON.stringify(employees)}
    - Empleados de Otras Sucursales (Para posibles préstamos): ${JSON.stringify(otherEmployees || [])}
    - Catálogo de Turnos (Solo usa IDs válidos de esta lista): ${JSON.stringify(shifts)}
    `;

    // 4. Llamar a Google Gemini con Temperature súper baja para respuestas analíticas
    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${Deno.env.get('GEMINI_API_KEY')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemInstruction }] }],
        generationConfig: { 
            temperature: 0.1, // 🚨 CRÍTICO: Mantiene a la IA determinista y matemática
            response_mime_type: "application/json" 
        }
      })
    });

    const geminiData = await geminiRes.json();
    
    // Validar errores directos de Google API
    if (geminiData.error) {
        throw new Error(`Google API Error: ${geminiData.error.message}`);
    }

    if (!geminiData.candidates || !geminiData.candidates[0].content.parts[0].text) {
        throw new Error("Gemini no devolvió un horario válido.");
    }

    // Parsear el string JSON de Gemini
    const aiScheduleJSON = JSON.parse(geminiData.candidates[0].content.parts[0].text);

    return new Response(JSON.stringify({ success: true, aiSchedule: aiScheduleJSON }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("🔥 ERROR WFM AI:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400, // Bad Request para que el frontend lo cachee
    });
  }
});