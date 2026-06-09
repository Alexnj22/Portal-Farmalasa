import { createClient } from "npm:@supabase/supabase-js@2"
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"
import { getCorsHeaders } from "../_shared/security.ts"
import { callGemini } from "../_shared/gemini.ts"

// SALY — Asistente de Operaciones
const SALY_PERSONA = `Eres Saly, asistente ejecutiva de operaciones de "Farmacia La Salud" y "La Popular". Tienes un perfil de consultora senior: analítica, precisa y orientada a decisiones. Tu comunicación es formal, moderna y sin adornos — vas directo al dato y a la acción.
Nunca uses metáforas médicas ni lenguaje poético. Hablas como una directora de operaciones profesional, no como un asistente genérico de IA.
Reglas Universales:
1. Límite legal 44h semanales. Turnos >7h que crucen de 11 am a 2 pm requieren almuerzo.
2. Basa tus respuestas ESTRICTAMENTE en los datos que se te proporcionan. NUNCA inventes información.
3. Respuestas directas y concisas. Cero texto de relleno, cero saludos, cero frases de cierre.
4. Formato de hora 12h (am/pm) siempre.`;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error("Acceso denegado: Falta el token de autorización (Bearer).")

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseAdminKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')?.trim()

    if (!geminiApiKey) throw new Error("API Key de Gemini no configurada en Supabase.")

    const authClient = createClient(supabaseUrl, supabaseAnonKey)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await authClient.auth.getUser(token)
    
    if (authError || !user) throw new Error("Sesión expirada o inválida. Por favor, inicia sesión nuevamente.")

    const payloadReq = await req.json();
    const { action, payload, userContext } = payloadReq;

    if (!action) throw new Error("No se especificó la 'action' en el body.")

    // Sanitize free-text user input to prevent prompt injection
    const MAX_QUESTION_LEN = 600;
    if (payload?.question && typeof payload.question === 'string') {
      payload.question = payload.question.slice(0, MAX_QUESTION_LEN).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    }

    const supabase = createClient(supabaseUrl, supabaseAdminKey)

    const isComplexTask = action === 'generate-schedule' || action === 'analyze-document';
    const temperature = action === 'generate-schedule' ? 0.1 : action === 'chat' ? 0.3 : 0.2; 
    const mimeType = isComplexTask ? "application/json" : "text/plain";

    let prompt = "";
    let inlineData: { mimeType: string; data: string }[] = [];
    let responseKey = "result";

    switch (action) {
      case 'analyze-branch': {
        prompt = `Tarea: Analiza los datos de la sucursal y redacta un reporte ejecutivo breve (máximo 3 párrafos cortos). Ve directo al grano, no saludes.\nDATOS: ${JSON.stringify(payload.branchData)}`;
        responseKey = "aiSummary";
        break;
      }
      case 'analyze-history': {
        prompt = `Tarea: Analiza el historial de la sucursal. Destaca alertas urgentes. Sé directo, no saludes.\nHISTORIAL: ${JSON.stringify(payload.historyData)}`;
        responseKey = "aiSummary";
        break;
      }
      case 'analyze-document': {
        const { data: fileData, error: downloadError } = await supabase.storage.from(payload.bucketName).download(payload.filePath)
        if (downloadError) throw downloadError
        inlineData = [{ mimeType: fileData.type || 'application/pdf', data: encode(await fileData.arrayBuffer()) }];
        prompt = `Analiza este documento. Devuelve ÚNICAMENTE un JSON exacto: { "aiSummary": "...", "issueDate": "...", "expDate": "..." }`;
        responseKey = "aiData";
        break;
      }
      case 'generate-schedule': {
        const { branchId, employees, shifts, weeklyHours, otherEmployees } = payload;
        const { data: salesData } = await supabase.from('branch_hourly_sales').select('sale_hour, transaction_count').eq('branch_id', branchId).order('sale_date', { ascending: false }).limit(3000);

        let trafficSummary = [];
        if (salesData && salesData.length > 0) {
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

        prompt = `Tarea: Arma el horario óptimo en JSON. 
        REGLAS: Cubrir apertura/cierre, solapar horas pico, almuerzos escalonados, lactancia, límite 44h. 
        DATOS: Horarios: ${JSON.stringify(weeklyHours || {})} | Tráfico: ${JSON.stringify(trafficSummary)} | Empleados: ${JSON.stringify(employees)} | Turnos: ${JSON.stringify(shifts)}`;
        responseKey = "aiSchedule";
        break;
      }

      case 'chat': {
        const todayStr = new Date().toISOString().split('T')[0];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

        const [ 
            { data: dbBranches }, 
            { data: dbEmployees }, 
            { data: dbShifts },
            { data: dbRoles },
            { data: dbAttendanceToday },
            { data: dbRecentEvents },
            { data: dbWfmSnapshots },
            { data: dbAnnouncements }
        ] = await Promise.all([
            supabase.from('branches').select('id, name, weekly_hours').limit(50), 
            supabase.from('employees').select('id, name, branch_id, shift_id, role_id, status, weekly_schedule').eq('status', 'ACTIVE').limit(200), 
            supabase.from('shifts').select('id, name, start_time, end_time, branch_id').limit(100),
            supabase.from('roles').select('id, name').limit(50),
            supabase.from('attendance').select('employee_id, type, timestamp').gte('timestamp', `${todayStr}T00:00:00Z`).limit(500),
            supabase.from('employee_events').select('employee_id, type, date, note').gte('date', thirtyDaysAgoStr).limit(100),
            supabase.from('wfm_snapshots').select('branch_id, recommended_staff, peak_day_name, peak_hour').gte('snapshot_date', thirtyDaysAgoStr).limit(10),
            supabase.from('announcements').select('title, message, priority, target_type').eq('is_archived', false).limit(10) // 🚨 FIX Aplicado aquí
        ]);

        const dbContext = {
            sucursales: dbBranches || [],
            empleados: dbEmployees?.map(e => ({ id: e.id, nombre: e.name, sucursal_id: e.branch_id, rol_id: e.role_id, estado: e.status, horario: e.weekly_schedule })) || [],
            turnos: dbShifts || [],
            roles: dbRoles || [],
            asistencias_hoy: dbAttendanceToday || [],
            eventos_recientes: dbRecentEvents || [],
            metricas_wfm: dbWfmSnapshots || [],
            anuncios: dbAnnouncements || []
        };

        prompt = `
        ============= BASE DE DATOS EN VIVO (SQL) =============
        Tienes acceso a la radiografía operativa en tiempo real:
        ${JSON.stringify(dbContext)}
        ========================================================
        
        PERFIL DEL USUARIO: ${userContext?.name || 'Usuario'} (${userContext?.role || 'Staff'})
        
        HISTORIAL DE LA CONVERSACIÓN:
        ${payload.history ? payload.history : '(Este es el primer mensaje)'}
        
        NUEVO MENSAJE DEL USUARIO:
        "${payload.question}"
        
        REGLAS DE RESPUESTA (ESTILO DIRECTIVO):
        1. CERO SALUDOS: Ve directamente al punto. No saludes de nuevo.
        2. ANÁLISIS CRUZADO: Eres brillante cruzando datos.
        3. PRECISIÓN: NUNCA inventes o asumas datos.
        4. ESTRUCTURA VISUAL: Usa OBLIGATORIAMENTE listas con viñetas (*) y negritas (**). SEPARA cada elemento con un salto de línea (\\n).
        5. FORMATO DE HORA AM/PM: Siempre convierte las horas al formato 12h con am/pm.
        6. CREACIÓN DE AVISOS (BORRADOR DE APROBACIÓN): Si el usuario te pide crear o enviar un aviso, NUNCA asumas que ya está publicado. Prepara un borrador de confirmación. 
        - 🚨 REGLA DE REDACCIÓN: Si el usuario SOLO te da el mensaje, INVENTA un título corto, profesional y directo (máximo 4 palabras) que resuma el tema. NO repitas el mensaje en el título.
        Para que la UI dibuje la tarjeta, DEBES agregar EXACTAMENTE esta etiqueta al final de tu respuesta (en formato JSON estricto):
        <<<DRAFT_ANNOUNCEMENT:{"title": "...", "message": "...", "target_type": "...", "target_value": "...", "priority": "..."}>>>
        
        REGLAS PARA MAPEAR EL JSON DE AVISOS:
        - target_type: Usa "GLOBAL" si dice "a todos". Usa "BRANCH" si menciona una sucursal específica. Usa "ROLE" si menciona un cargo o rol específico (ej. "a los jefes", "para los doctores").
        - target_value: 
            - Si target_type es "GLOBAL", el target_value debe ser "null" o "". 
            - Si es "BRANCH", pon el "id" de la sucursal (búscalo en dbContext.sucursales). 
            - Si es "ROLE", pon el nombre exacto del rol en MAYÚSCULAS (ej. "JEFE DE SALA", búscalo en dbContext.roles).
        - priority: Usa "URGENT" si el usuario explícitamente dice que es urgente, inmediato o prioridad. Si no lo especifica, usa siempre "NORMAL".
       7. LECTURA DE AVISOS: Cuando el usuario pregunte qué avisos hay, DEBES mostrar la información EXACTA de la base de datos sin parafrasear ni resumir tu propia versión. 
        Usa estrictamente este formato visual para listarlos:
        * **[URGENTE/NORMAL] Título exacto:** Mensaje exacto.
        Si el título y el mensaje son exactamente iguales en la base de datos, muestra solo el título para evitar repeticiones absurdas.`;
        
        responseKey = "result";
        break;
      }

      case 'analyze-survey-comments': {
        const { comments, segment } = payload;
        const textos = (comments || []).map((c: any) =>
            `[${c.isJefe ? 'Jefe/a' : 'Colaborador/a'} – ${c.sucursal}]: "${c.texto}"`
        ).join('\n');
        prompt = `Analiza los siguientes ${(comments || []).length} comentarios abiertos de una encuesta de clima organizacional. Segmento: ${segment}.

COMENTARIOS:
${textos}

Entrega un análisis ejecutivo en español con exactamente estas cuatro secciones. No agregues introducción ni cierre.

**Ideas recurrentes:** Las 2–3 ideas o percepciones que más se repiten. Describe la idea en concreto — no el tema genérico. Si varios comentarios de distintas sucursales apuntan a lo mismo, indícalo.

**Aspectos valorados:** Qué reconocen o agradecen los colaboradores. Solo si aparece en los comentarios.

**Fricciones identificadas:** Lista cada problema concreto en una línea separada. Para cada uno, indica:
- Qué problema es (específico, no genérico)
- En qué sucursal o perfil aparece (usa el nombre de sucursal del comentario)
- Si es aislado o repetido en varios comentarios
Ejemplo: "Falta de comunicación del jefe de sala → La Popular Centro (mencionado por 2 colaboradores)"

**Acción recomendada:** Una sola acción prioritaria, directa y ejecutable. Indica a qué sucursal o grupo aplica si el problema es localizado.

Reglas estrictas:
- Máximo 220 palabras en total.
- NUNCA uses números de comentario como referencia.
- Usa solo lo que está escrito. Sin inferencias ni suposiciones.
- Lenguaje formal, sin metáforas.`;
        responseKey = "aiSummary";
        break;
      }

      default:
        throw new Error(`Acción '${action}' no reconocida.`);
    }

    const finalSystemInstruction = `${SALY_PERSONA}\n\n${prompt}`;

    let finalData = await callGemini({
      prompt: finalSystemInstruction,
      model: "gemini-2.5-pro",
      temperature,
      jsonOutput: mimeType === "application/json",
      inlineData,
    });

    // 🤖 INTERCEPTOR DE BORRADORES (Agentic AI - HITL)
    if (action === 'chat') {
        const draftMatch = finalData.match(/<<<DRAFT_ANNOUNCEMENT:\s*(\{.*?\})\s*>>>/s);
        
        if (draftMatch) {
            try {
                // Verificamos que el JSON esté bien formado por Gemini
                const draftData = JSON.parse(draftMatch[1]);
                
                // Limpiamos el texto principal que verá el usuario
                finalData = finalData.replace(draftMatch[0], '').trim();
                
                // Agregamos la nueva etiqueta que leerá el FRONTEND
                finalData += `\n\n[[CARD_DRAFT_AVISO:${JSON.stringify(draftData)}]]`;
                
            } catch (err) {
                console.error("Error parseando borrador de Saly:", err);
                finalData = finalData.replace(draftMatch[0], '').trim();
            }
        }
    }

    if (isComplexTask) {
        finalData = JSON.parse(finalData.replace(/```json/g, '').replace(/```/g, '').trim());
    }

    return new Response(JSON.stringify({ success: true, [responseKey]: finalData }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('❌ Error Saly AI:', error.message)
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
})