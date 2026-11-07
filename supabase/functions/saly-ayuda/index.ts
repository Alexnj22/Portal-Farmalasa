import { createClient } from "npm:@supabase/supabase-js@2"
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts"
import { callGemini, parseGeminiJson } from "../_shared/gemini.ts"

// SALY — ayuda en pantalla (docs/PLAN-SALY-AYUDA-EN-PANTALLA-2026-11-04.md).
//
// La llama el NAVEGADOR con la sesión de quien pregunta → JWT (nunca
// `--no-verify-jwt`). Sólo entra acá una pregunta ESCRITA: los avisos y sus
// explicaciones los arma el portal sin IA.
//
// El costo es la restricción del usuario («que Saly no cueste mucho, lo mínimo
// posible»), y se cuida en seis lugares:
//   · lo de siempre ni llega acá: las preguntas frecuentes las contesta el
//     navegador (`PREGUNTAS_FRECUENTES`, $0);
//   · el modelo más barato y SIN pensamiento;
//   · el CONOCIMIENTO va primero y es idéntico en cada llamada: Gemini cachea
//     solo un prefijo repetido (≥1,024 tokens) y lo cobra con descuento. Lo que
//     cambia —pantalla, pregunta— va al final, a propósito;
//   · lo que se manda de la pantalla es su resumen (≤3,500 caracteres);
//   · contesta en PIEZAS (JSON corto);
//   · 30 preguntas por persona y por día, contadas en la base.
// ~2,500 tokens de entrada y ~250 de salida ≈ $0.0003–0.0005 por pregunta.

// En orden. `gemini-2.5-flash-lite` dejó de estar disponible para cuentas
// nuevas (medido el 2026-11-04: «no longer available to new users») y fue la
// razón de que NINGUNA pregunta se contestara en la primera prueba. Si el
// primero falla, se prueba el siguiente: una pregunta no puede quedarse sin
// respuesta porque Google retiró un nombre.
const MODELOS = ["gemini-3.5-flash-lite", "gemini-2.5-flash"]
const TOPE_DIARIO = 30
const MAX_PANTALLA = 3500
const MAX_PREGUNTA = 300
const RETENCION_DIAS = 180
// EN PRUEBA: gemela de SALY_AYUDA_SOLO_PARA (src/utils/salyAyuda.js). `null` = todos.
const SOLO_PARA: string[] | null = ["bbc796d7-7435-495b-9306-a2115f44a18f"]

// Cómo funciona el EFECTIVO del portal, de punta a punta. Es lo mismo para
// las dos pantallas, así que forma parte del prefijo que se cachea. Escrito
// contra el portal real: los botones de Mi caja, los frenos de
// `hacer-corte-caja` y el catálogo `caja_tipos_movimiento`.
const CONOCIMIENTO = `CÓMO FUNCIONA EL EFECTIVO EN EL PORTAL (menú Efectivo, ruta /caja)
Pestañas: Hoy (la caja de la sala, hoy) · Cortes (todos los cortes) · Diferencias (días con faltante o sobrante y qué falta hacer) · Movimientos (entradas y salidas, también las editadas o borradas en la caja).

EL DÍA DE UNA CAJA, en orden:
1. Abrir la caja (botón «Abrir»): se escribe con cuánto efectivo arranca; si arranca en cero se deja vacío. Si la caja está abierta pero el turno parado, botón «Iniciar turno»: sin turno no se vende, corta ni cierra.
2. Durante el día se anotan ENTRADAS y SALIDAS de efectivo que no son ventas (botones «Entrada» y «Salida»).
3. Cortes (botón «Corte»): se cuenta SÓLO el efectivo del cajón; lo que ya está en las bolsas de hoy lo suma el portal. El portal compara contra lo esperado y dice si cuadró, sobró o faltó. Cada corte se CONFIRMA (el conteo es el real, aunque tenga diferencia: la diferencia queda firmada) o se DESCARTA (se contó mal o fue prueba: no cuenta, se hace otro). Al confirmar, el efectivo se embolsa.
4. Cerrar el día (botón «Cerrar»): emite el corte Z y NO se deshace; la caja no vuelve a abrir ese día.

LOS CUATRO FRENOS DEL CIERRE (si uno está activo, el día no cierra):
a) un corte sin confirmar ni descartar → resolverlo; b) ningún corte confirmado hoy → hacer uno y confirmarlo; c) entró efectivo después del último corte confirmado («Falta por contar») → hacer otro corte y confirmarlo; d) preventas guardadas sin finalizar en la caja → finalizarlas en la caja. La preventa también frena el corte.
Si nadie cierra, el portal cierra solo una hora después de la hora de cierre si hay un corte reciente; si quedan preventas no cierra y avisa a supervisión.

TIPOS DE ENTRADA: Aplicación de inyección (se elige la venta o se marca que el cliente trajo la inyección) · Prueba de glucosa · POS Promerica (foto de la boleta OBLIGATORIA: llena sola monto y número) · Pago de asegurado Mapfre (se elige la factura y el asegurado) · Apartar o encargar (anticipo de un producto; sale comprobante) · Servicio a domicilio · Otro (escribir el detalle).
TIPOS DE SALIDA: Compra o gasto urgente (agua, saldo, mandado; la boleta es el respaldo) · Pago a proveedor · Anticipo a un empleado · Pago de bonificación (comisión autorizada) · Devolución a un cliente · Cambio por monedas · POS Promerica (salida, con foto) · Otro. En las salidas se elige QUIÉN se lleva el efectivo. Las salidas del día se juntan solas en un vale de caja al hacer el siguiente corte.
"registrado · n.º X" en un movimiento = ya está anotado en la caja con ese número; "sin cortar todavía" = entró después del último corte y lo va a contar el próximo.
Boletas: un mismo número sólo es la misma operación si es la misma terminal y el mismo monto (cada banco y cada terminal numera por su lado). Si la terminal de una sala falla y se usa la de otra, es válido.

DINERO: ESPERADO = lo que debería haber en el cajón · CONTADO = lo que se contó · DIFERENCIA = contado − esperado (negativa FALTANTE, positiva SOBRANTE). Los cobros de crédito en efectivo hechos desde el portal YA están sumados al esperado.
Causas típicas de un faltante: un gasto o pago sin anotar como Salida, un cobro con tarjeta marcado como efectivo, vuelto mal dado, conteo mal hecho. Qué hacer: recontar (si se contó mal, descartar y hacer otro corte); anotar lo que faltó en Mi caja y hacer otro corte; si no aparece, confirmar el corte y lo resuelve supervisión en Diferencias. Un sobrante suele ser una entrada sin anotar o una venta en efectivo cobrada de más.
Cobros de crédito: se hacen en Cuentas por cobrar; el efectivo entra a esta caja.
Tipos de corte: C = corte del turno · Z = cierre del día · X = lectura (no cuenta efectivo).`

// Lo propio de cada pantalla, después del conocimiento común.
const GUIAS: Record<string, string> = {
  cortes_caja: `PANTALLA ACTUAL: Efectivo → Cortes. Lista de cortes por día y por sala, con esperado, contado y diferencia. Estados: Sin confirmar (PENDIENTE), Confirmados, Descartados. Filtros: sucursal, fecha, estado y diferencia (Cuadraron / Con exceso / Con faltante). Tocar un corte abre su detalle para confirmarlo o descartarlo.`,
  encuestas_clientes: `PANTALLA ACTUAL: Encuestas a clientes → Resultados de una encuesta. Arriba el filtro de sucursal (Todas, cada sucursal o Campo) y las cifras: NPS, respuestas, promotores (9 o 10) y detractores (0 a 6). Debajo «Qué significan los resultados» (la lectura que hiciste de los números, con los cruces entre preguntas y qué harías), la recomendación, cada pregunta con sus porcentajes, los comentarios y las rondas. Para leer otra sucursal, la persona te toca y elige cuál. El NPS es % promotores menos % detractores; con menos de 30 respuestas los resultados son preliminares.`,
  caja: `PANTALLA ACTUAL: Efectivo → Hoy (Mi caja). Arriba el estado de la caja y los botones Corte · Entrada · Salida · Cerrar (o Abrir / Iniciar turno). Abajo «Movimientos de este día», agrupados por corte, con hora, tipo, detalle, quién lo anotó y monto; tocar uno muestra su detalle, la boleta y «Corregir».`,
}

const PERSONA = `Eres Saly, la guía del portal de "Farmacia La Salud" y "La Popular". No eres una persona ni tienes género. Conoces los procesos del portal de memoria (están abajo) y tu trabajo es ORIENTAR: decir qué significa lo que se ve y qué hacer después, paso por paso.
Hablas en español neutro, de "tú", sin voseo y sin emojis. Primera persona con verbos, nunca adjetivos con género sobre ti.
Reglas:
1. NUNCA respondas "no sé" ni "no lo veo" a secas. Si la pregunta es de un proceso, contéstala con el CONOCIMIENTO. Si es de un dato que no está en la pantalla, di dónde verlo en el portal (pestaña y botón) y qué buscar. Sólo si de verdad es una decisión de otra persona (perdonar un faltante, cambiar un permiso), di quién la toma: supervisión de la sala o administración.
2. Los NÚMEROS salen sólo de los DATOS DE LA PANTALLA o de lo SEÑALADO. Nunca inventes un monto, una hora ni un nombre.
3. Si la persona señaló algo, la respuesta es sobre ESO: qué es, si está bien y qué hacer, usando sus datos.
4. Ve al punto: responde primero, después los pasos. Nada de saludos ni de repetir la pregunta.
5. No guardas, apruebas ni envías nada. Puedes PONER FILTROS (sólo valores de las opciones dadas) y LLEVAR a otra pantalla con un botón.
6. No regañes ni culpes a nadie.`

const FORMATO = `Responde SOLO un JSON con esta forma:
{"animo":"alegria|atencion|preocupacion|pensando","piezas":[...],"filtros":{"clave":"valor"},"recuerda":"..."}
Piezas permitidas (usa 2 a 4, la primera siempre "titular", que es la RESPUESTA en una línea):
{"tipo":"titular","texto":"≤60 car.","sub":"≤60 car."}
{"tipo":"cifras","items":[{"rotulo":"≤14","valor":"≤12","tono":"mal|bien"}]}  (hasta 3; para montos de la pantalla)
{"tipo":"barras","items":[{"rotulo":"≤14","valor":123,"texto":"≤10","tono":"mal|bien"}]}  (hasta 5, para comparar)
{"tipo":"pasos","items":["≤90 car. cada uno, **negrita** para botones y pestañas"]}  (hasta 4)
{"tipo":"nota","texto":"≤140 car."}
{"tipo":"botones","items":[{"texto":"≤24","ir":"/ruta"}]}  (rutas: /caja?tab=hoy, /caja?tab=cortes, /caja?tab=diferencias, /caja?tab=movimientos, /cuentas-por-cobrar)
"animo": alegria si todo está bien, preocupacion si hay un problema de dinero, atencion para explicar.
"filtros": sólo si la pregunta pide ver algo que un filtro muestra; si no, {}.
"recuerda": una frase corta sobre la persona que sirva la próxima vez, o "".`

const corto = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n)

// Gemela de `validarPiezas` de src/utils/salyAyuda.js: si cambia una regla,
// cambian las dos. El navegador vuelve a validar al pintar.
function validarPiezas(lista: unknown): unknown[] {
  if (!Array.isArray(lista)) return []
  const tono = (t: unknown) => (t === "mal" || t === "bien" ? t : undefined)
  const out: unknown[] = []
  for (const p of lista.slice(0, 6) as any[]) {
    if (!p || typeof p !== "object") continue
    const items = Array.isArray(p.items) ? p.items : []
    switch (p.tipo) {
      case "titular":
        if (corto(p.texto, 90)) out.push({ tipo: "titular", texto: corto(p.texto, 90), sub: corto(p.sub, 90) || undefined })
        break
      case "cifras": {
        const it = items.slice(0, 3).map((i: any) => ({ rotulo: corto(i?.rotulo, 18), valor: corto(i?.valor, 14), tono: tono(i?.tono) }))
          .filter((i: any) => i.rotulo && i.valor)
        if (it.length) out.push({ tipo: "cifras", items: it })
        break
      }
      case "barras": {
        const it = items.slice(0, 5).map((i: any) => ({ rotulo: corto(i?.rotulo, 16), valor: Math.abs(Number(i?.valor)) || 0, texto: corto(i?.texto, 12), tono: tono(i?.tono) }))
          .filter((i: any) => i.rotulo)
        if (it.length) out.push({ tipo: "barras", items: it })
        break
      }
      case "pasos": {
        const it = items.slice(0, 4).map((t: unknown) => corto(t, 110)).filter(Boolean)
        if (it.length) out.push({ tipo: "pasos", items: it })
        break
      }
      case "nota":
        if (corto(p.texto, 160)) out.push({ tipo: "nota", texto: corto(p.texto, 160) })
        break
      case "botones": {
        const it = items.slice(0, 2).map((b: any) => ({ texto: corto(b?.texto, 28), ir: /^\/[a-z0-9\-/?=&_]*$/i.test(b?.ir || "") ? b.ir : undefined }))
          .filter((b: any) => b.texto && b.ir)
        if (it.length) out.push({ tipo: "botones", items: it })
        break
      }
    }
  }
  return out
}

// Se vuelve a tapar acá: el navegador ya lo hizo, pero la función no confía en él.
function tapar(t: string): string {
  return t
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[correo oculto]")
    .replace(/\b\d{4}-?\d{6}-?\d{3}-?\d\b/g, "[NIT oculto]")
    .replace(/\b\d{8}-\d\b/g, "[DUI oculto]")
    .replace(/(?:\+?503[\s-]?)?\b[267]\d{3}[\s-]?\d{4}\b/g, "[teléfono oculto]")
    .replace(/((?:salario|sueldo|salary)[^\d$]{0,20})\$?\s?[\d,]+(?:\.\d+)?/gi, "$1[monto oculto]")
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  const responder = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } })
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
  const emp = await requireActiveEmployeeUser(req, admin)
  if (!emp) return responder({ ok: false, motivo: "SESION" }, 401)
  if (SOLO_PARA && !SOLO_PARA.includes(emp.id)) return responder({ ok: false, motivo: "EN_PRUEBA" }, 403)

  try {
    const body = await req.json().catch(() => ({}))
    const modulo = String(body?.modulo || "")
    const guia = GUIAS[modulo]
    const pregunta = corto(body?.pregunta, MAX_PREGUNTA)
    if (!guia || !pregunta) return responder({ ok: false, motivo: "PEDIDO" }, 400)
    const pantalla = tapar(String(body?.pantalla || "")).slice(0, MAX_PANTALLA)
    const preguntaLimpia = tapar(pregunta)
    // Lo que la persona señaló en pantalla (arrastrando a Saly o con
    // «Señalar»): el texto visible de ese bloque, ya tapado en el navegador.
    const senalado = tapar(corto(body?.senalado, 600))

    // Filtros que la pantalla ofrece: la IA sólo puede elegir entre éstos.
    const filtrosIn = (body?.filtros && typeof body.filtros === "object") ? body.filtros as Record<string, any> : {}
    const filtros: Record<string, { rotulo: string; opciones: string[] }> = {}
    for (const [k, f] of Object.entries(filtrosIn).slice(0, 6)) {
      const ops = (Array.isArray(f?.opciones) ? f.opciones : []).slice(0, 30)
        .map((o: any) => `${corto(o?.value, 40)}=${corto(o?.label, 40)}`)
      if (ops.length) filtros[corto(k, 30)] = { rotulo: corto(f?.rotulo, 30), opciones: ops }
    }

    // Tope diario, contado en la base.
    const desde = new Date(Date.now() - 24 * 3600_000).toISOString()
    const { count, error: eCount } = await admin.from("saly_ayuda_registro")
      .select("id", { count: "exact", head: true }).eq("employee_id", emp.id).gte("created_at", desde)
    if (eCount) throw eCount
    if ((count ?? 0) >= TOPE_DIARIO) return responder({ ok: false, motivo: "TOPE", quedan: 0 })

    const { data: mem, error: eMem } = await admin.from("saly_ayuda_memoria")
      .select("resumen").eq("employee_id", emp.id).maybeSingle()
    if (eMem) throw eMem

    // Lo fijo PRIMERO (se cachea solo), lo que cambia AL FINAL.
    const prompt = `${PERSONA}

${FORMATO}

${CONOCIMIENTO}

${guia}

LO QUE SÉ DE ESTA PERSONA: ${mem?.resumen || "(nada todavía)"}

FILTROS DISPONIBLES (clave: valor=rótulo):
${Object.entries(filtros).map(([k, f]) => `${k} (${f.rotulo}): ${f.opciones.join(" | ")}`).join("\n") || "(ninguno)"}

DATOS DE LA PANTALLA:
${pantalla || "{}"}
${senalado ? `\nLO QUE LA PERSONA SEÑALÓ (la pregunta es sobre ESTO; es el texto tal como se ve en pantalla):\n${senalado}\n` : ""}
PREGUNTA: ${preguntaLimpia}`

    let tokens = 0
    let crudo = ""
    let ultimoError: unknown = null
    for (const model of MODELOS) {
      try {
        crudo = await callGemini({
          prompt, model, temperature: 0.2, jsonOutput: true, thinkingBudget: 0, timeoutMs: 20_000,
          uso: (u) => { tokens = (u.promptTokenCount || 0) + (u.candidatesTokenCount || 0) },
        })
        break
      } catch (e) {
        ultimoError = e
        console.error(`[saly-ayuda] ${model} falló, pruebo el siguiente:`, e instanceof Error ? e.message : e)
      }
    }
    if (!crudo) throw ultimoError ?? new Error("Ningún modelo respondió")
    const r = parseGeminiJson<any>(crudo)
    const animo = ["alegria", "atencion", "preocupacion", "pensando"].includes(r?.animo) ? r.animo : "atencion"
    const piezas = validarPiezas(r?.piezas)
    if (!piezas.length) piezas.push({ tipo: "titular", texto: "No supe cómo responder eso", sub: "Pregúntale a quien supervisa la sala" })

    // Sólo valores que existen en las opciones.
    const filtrosOut: Record<string, string> = {}
    for (const [k, v] of Object.entries(r?.filtros && typeof r.filtros === "object" ? r.filtros : {})) {
      if (filtros[k]?.opciones.some((o) => o.split("=")[0] === String(v))) filtrosOut[k] = String(v)
    }

    const { data: fila, error: eIns } = await admin.from("saly_ayuda_registro").insert({
      employee_id: emp.id, modulo, pregunta: senalado ? `${preguntaLimpia} ⟨señaló: ${senalado.slice(0, 200)}⟩` : preguntaLimpia,
      respuesta: { animo, piezas, filtros: filtrosOut }, tokens,
    }).select("id").single()
    if (eIns) throw eIns

    const recuerda = corto(r?.recuerda, 200)
    if (recuerda) {
      const nuevo = [mem?.resumen, recuerda].filter(Boolean).join(" · ").slice(-600)
      const { error: eUp } = await admin.from("saly_ayuda_memoria")
        .upsert({ employee_id: emp.id, resumen: nuevo, updated_at: new Date().toISOString() })
      if (eUp) console.error("[saly-ayuda] memoria", eUp.message)
    }

    // Retención: lo viejo se borra al anotar, sin cron (pocas filas al día).
    const { error: eDel } = await admin.from("saly_ayuda_registro").delete()
      .lt("created_at", new Date(Date.now() - RETENCION_DIAS * 86400_000).toISOString())
    if (eDel) console.error("[saly-ayuda] retención", eDel.message)

    return responder({ ok: true, id: fila.id, animo, piezas, filtros: filtrosOut, quedan: TOPE_DIARIO - (count ?? 0) - 1 })
  } catch (err) {
    console.error("[saly-ayuda]", err instanceof Error ? err.message : err)
    return responder({ ok: false, motivo: "FALLA" }, 500)
  }
})
