import { createClient } from "npm:@supabase/supabase-js@2"
import { getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts"
import { callGemini, parseGeminiJson } from "../_shared/gemini.ts"
// El base64 se hace por trozos y NO con `encode()` de std.
//
// Medido el 2026-08-26 con un PDF real de un DUy: la función murió con
// «Memory limit exceeded» (HTTP 546). Convertir el archivo entero de una sola
// vez arma un string binario completo MÁS su base64 —dos copias enteras en
// memoria además del buffer— y un PDF de pocos megas ya no entra.
//
// Por trozos alineados a 3 bytes el pico es de kilobytes. La alineación importa:
// el base64 de trozos concatenados sólo es igual al base64 del todo si cada
// trozo es múltiplo de 3; con cualquier otro tamaño saldría un archivo corrupto
// que el modelo no puede leer y que NO da error — devolvería «no lo pude leer»
// y nadie sabría por qué.
const TROZO = 3 * 4096

function aBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const partes: string[] = []
  for (let i = 0; i < bytes.length; i += TROZO) {
    const trozo = bytes.subarray(i, Math.min(i + TROZO, bytes.length))
    let binario = ''
    for (let j = 0; j < trozo.length; j++) binario += String.fromCharCode(trozo[j])
    partes.push(btoa(binario))
  }
  return partes.join('')
}

// Tope por archivo. Un DUI escaneado pesa menos de esto con holgura; más que
// esto suele ser un PDF con las páginas en altísima resolución, y conviene
// decirlo en vez de morir sin explicación.
const TOPE_BYTES = 12 * 1024 * 1024

// ════════════════════════════════════════════════════════════════════════════
// Lee el DUI de una persona y devuelve lo que el documento dice.
//
// Pedido de Talento Humano el 2026-08-26: subir el DUI de los dos lados y que
// el portal detecte los datos en vez de teclearlos.
//
// ── Por qué esto vale más que ahorrar tecleo ────────────────────────────────
//
// Medido el mismo día: **48 de las 49 fichas no se podían guardar** porque
// faltaba DUI, género o estado civil. Los tres están EN EL DUI — el anverso
// lleva el número, los nombres, el sexo y las fechas; el reverso lleva el
// domicilio, la profesión u oficio, el estado familiar y el tipo de sangre.
// O sea que el escaneo no acelera la carga: la desbloquea.
//
// ── Los dos lados en UNA llamada, no dos ────────────────────────────────────
//
// El número está en el anverso y el estado familiar en el reverso, pero el
// modelo lee mejor si ve las dos caras juntas: puede cruzar que sean del mismo
// documento y de la misma persona. Dos llamadas sueltas devolverían dos objetos
// que hay que conciliar acá, y conciliar es adivinar.
//
// ── Llega por RUTA de Storage, no en base64 ─────────────────────────────────
//
// Al revés que `leer-boleta`, que verifica ANTES de guardar y por eso no puede
// tocar el bucket. Acá las dos imágenes SON documentos del expediente: se
// suben igual, se lean o no. Mandarlas otra vez en base64 sería subir dos
// megabytes dos veces.
//
// ── Lo que NO hace ──────────────────────────────────────────────────────────
//
// No escribe nada. Devuelve lo leído y quien llama decide: la pantalla ofrece
// cada campo y la persona confirma. Un formulario que se llena solo y se guarda
// solo convierte un error de lectura en un dato del expediente, y después nadie
// sabe si el DUI dice eso o si lo dijo el modelo.

// El dígito verificador del DUI: los 8 primeros por 9,8,7…2, la suma módulo 10,
// y 10 menos eso (con 10 → 0). Se comprueba ACÁ y no sólo en el navegador
// porque es la única forma de saber si el número que leyó el modelo es un DUI o
// una lectura mal hecha de uno.
function duiValido(dui: string): boolean {
  const limpio = String(dui || '').replace(/\D/g, '')
  if (limpio.length !== 9) return false
  const d = limpio.split('').map(Number)
  const verificador = d.pop()!
  const suma = d.reduce((acc, n, i) => acc + n * (9 - i), 0)
  let calc = 10 - (suma % 10)
  if (calc === 10) calc = 0
  return calc === verificador
}

const formatearDui = (dui: string) => {
  const l = String(dui || '').replace(/\D/g, '')
  return l.length === 9 ? `${l.slice(0, 8)}-${l.slice(8)}` : ''
}

// Una fecha que el modelo devolvió tiene que ser una fecha, y tiene que caer en
// un rango que un DUI puede tener. Un `null` es «no lo pude leer» y se muestra
// vacío; una fecha inventada se guardaría como dato.
function fechaValida(v: unknown, desde = 1900, hasta = 2100): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const [y, m, d] = v.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  if (y < desde || y > hasta) return null
  return v
}

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null)

const PROMPT = `Eres un lector de documentos de identidad de El Salvador. Te doy el Documento Único de Identidad (DUI) de una persona.

Puede llegarte de dos formas y las dos son válidas: como DOS imágenes (anverso y reverso), o como UN SOLO archivo —normalmente un PDF— que contiene las dos caras. Si es un solo archivo, busca las dos caras dentro de él antes de responder: el número y el sexo están en el anverso, y el domicilio, la profesión, el estado familiar y el tipo de sangre en el reverso.

Devuelve ÚNICAMENTE un JSON válido, sin markdown, con esta forma exacta:
{
  "numero": "el número de DUI con guion, formato 00000000-0. null si no se lee.",
  "nombres": "los nombres de pila, tal como aparecen. null si no se leen.",
  "apellidos": "los apellidos, tal como aparecen. null si no se leen.",
  "sexo": "M o F. null si no se lee.",
  "fecha_nacimiento": "YYYY-MM-DD. null si no se lee.",
  "lugar_nacimiento": "el lugar de nacimiento tal como aparece. null si no está.",
  "lugar_expedicion": "el lugar de expedición del documento. null si no está.",
  "fecha_expedicion": "YYYY-MM-DD. null si no se lee.",
  "fecha_vencimiento": "YYYY-MM-DD. null si no se lee.",
  "estado_familiar": "SOLTERO, CASADO, DIVORCIADO, VIUDO, ACOMPANADO o null.",
  "profesion": "la profesión u oficio que dice el documento. null si no está.",
  "domicilio": "la dirección de residencia del reverso. null si no está.",
  "departamento": "el departamento del domicilio. null si no está.",
  "municipio": "el municipio del domicilio. null si no está.",
  "distrito": "el distrito del domicilio, si aparece. null si no está.",
  "tipo_sangre": "el tipo de sangre (por ejemplo O+, A-). null si no aparece.",
  "es_dui": true si las imágenes son realmente un DUI de El Salvador, false si son otra cosa,
  "caras": ["ANVERSO" | "REVERSO" | "AMBAS" | "OTRO", ...] una entrada POR CADA archivo que te di, EN EL MISMO ORDEN. Di ANVERSO si esa imagen es la cara con la foto y el número; REVERSO si es la cara con el domicilio y la firma; AMBAS si ese único archivo trae las dos caras; OTRO si esa imagen no es una cara de un DUI salvadoreño.
}

REGLAS QUE NO PUEDES ROMPER:
- Si un dato no se lee con seguridad, devuelve null. NUNCA lo inventes ni lo deduzcas.
- El tipo de sangre es OPCIONAL en el DUI: sólo aparece si la persona presentó constancia de laboratorio. Que no esté es normal, devuelve null.
- No completes el departamento ni el municipio a partir del distrito ni al revés. Devuelve sólo lo que está escrito.
- Las fechas van en formato YYYY-MM-DD y sólo si las lees completas.
- "caras" tiene EXACTAMENTE tantas entradas como archivos recibiste, en orden. No la omitas ni la acortes: sirve para avisarle a quien carga que subió dos veces la misma cara o un documento que no es.`

Deno.serve(async (req: Request) => {
  const corsHeaders = { ...getCorsHeaders(req), "Access-Control-Allow-Methods": "POST, OPTIONS" }
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" })

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "MISSING_ENV" })
    const admin = createClient(supabaseUrl, serviceKey)

    // Quién llama y si puede, los DOS desde la base. El JWT sirve para lo único
    // que no se puede falsificar —quién sos, que lo firma Supabase—; el permiso
    // lo resuelve la base. Ver `set-employee-password` y la Fase 0 del plan de
    // blindaje.
    const caller = await requireActiveEmployeeUser(req, admin)
    if (!caller) return json({ ok: false, error: "INVALID_TOKEN" })

    const permiso = await permisoDeModulo(admin, caller.id, "staff_list", "can_edit")
    // `roto` es «no se pudo averiguar» y NO es «no podés»: decirle «no tenés
    // permiso» a quien sí lo tiene lo manda por el camino equivocado y el
    // problema real no se reporta nunca.
    if (permiso.roto) return json({ ok: false, error: "PERMISSION_CHECK_FAILED", details: permiso.roto })
    if (!permiso.puede) return json({ ok: false, error: "INSUFFICIENT_PERMISSIONS" })

    const body = await req.json().catch(() => ({}))
    const caras = [body?.frente, body?.reverso].filter(
      (c: unknown): c is { bucket: string; path: string } =>
        !!c && typeof (c as any).bucket === 'string' && typeof (c as any).path === 'string')

    // Acepta 1 o 2 archivos: dos caras sueltas, o un solo PDF que las trae
    // adentro. Talento Humano recibe las dos formas, y obligar a partir un PDF
    // en dos imágenes es trabajo manual para que el portal pueda leerlo — al
    // revés de para lo que existe.
    if (!caras.length) return json({ ok: false, error: "MISSING_FIELDS", details: "Se esperaba al menos un archivo del documento." })

    const inlineData = []
    for (const cara of caras) {
      const { data, error } = await admin.storage.from(cara.bucket).download(cara.path)
      if (error) return json({ ok: false, error: "DOWNLOAD_FAILED", details: error.message })
      const buf = await data.arrayBuffer()
      if (buf.byteLength > TOPE_BYTES) {
        return json({
          ok: false, error: "ARCHIVO_MUY_GRANDE",
          details: `El archivo pesa ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB y el tope es ${TOPE_BYTES / 1024 / 1024} MB. Vuelve a escanearlo con menos resolución.`,
        })
      }
      inlineData.push({ mimeType: data.type || 'image/jpeg', data: aBase64(buf) })
    }

    const crudo = await callGemini({ prompt: PROMPT, inlineData, jsonOutput: true })
    const leido = parseGeminiJson<Record<string, unknown>>(crudo)

    if (leido?.es_dui === false) {
      return json({ ok: false, error: "NO_ES_DUI", details: "Las imágenes no parecen un DUI de El Salvador." })
    }

    // El número sólo sale si además CUADRA. Un DUI mal leído se parece a un DUI
    // bien leído, y el dígito verificador es lo único que los distingue sin
    // preguntarle a nadie.
    const numeroCrudo = typeof leido?.numero === 'string' ? leido.numero : ''
    const numeroOk = duiValido(numeroCrudo)

    const anio = new Date().getFullYear()
    const datos = {
      numero: numeroOk ? formatearDui(numeroCrudo) : null,
      nombres: texto(leido?.nombres),
      apellidos: texto(leido?.apellidos),
      sexo: leido?.sexo === 'M' || leido?.sexo === 'F' ? leido.sexo : null,
      // Nadie con DUI nació después de hoy ni hace más de 120 años.
      fecha_nacimiento: fechaValida(leido?.fecha_nacimiento, anio - 120, anio),
      lugar_nacimiento: texto(leido?.lugar_nacimiento),
      lugar_expedicion: texto(leido?.lugar_expedicion),
      // El DUI se expide desde 2001 y vence a los pocos años de emitido.
      fecha_expedicion: fechaValida(leido?.fecha_expedicion, 2001, anio),
      fecha_vencimiento: fechaValida(leido?.fecha_vencimiento, 2001, anio + 20),
      estado_familiar: texto(leido?.estado_familiar),
      profesion: texto(leido?.profesion),
      domicilio: texto(leido?.domicilio),
      departamento: texto(leido?.departamento),
      municipio: texto(leido?.municipio),
      distrito: texto(leido?.distrito),
      tipo_sangre: texto(leido?.tipo_sangre),
    }

    return json({
      ok: true,
      datos,
      // Se dice aparte y no se calla: si el número no cuadra, la persona tiene
      // que saber que hay que teclearlo, no descubrir el campo vacío.
      numeroIlegible: !numeroOk && !!numeroCrudo,
      // La nacionalidad no se lee del documento: se DEDUCE. El DUI sólo se
      // emite a salvadoreños, así que si esto es un DUI, la persona lo es.
      nacionalidad: 'Salvadoreña',
      carasLeidas: caras.length,
      // ── Qué era cada archivo ────────────────────────────────────────────
      //
      // «No es un DUI» ya se resolvía arriba, cortando con `NO_ES_DUI`. Lo que
      // faltaba era el error más común y el más caro: **subir dos veces la
      // misma cara**. Eso pasa la comprobación de `es_dui` —las dos imágenes
      // SON un DUI— y se manifiesta como «faltó la mitad de los datos», que
      // nadie relaciona con el archivo: el número está en el anverso y el
      // domicilio en el reverso, así que con dos anversos falta la dirección
      // entera y parece que el lector falló.
      //
      // `caras` dice qué es cada archivo EN ORDEN, para poder decirlo.
      //
      // `esDui` viaja igual aunque acá siempre sea `true`: la respuesta dice lo
      // que el lector concluyó, y quien la consume no tiene por qué saber que
      // el corte pasó 40 renglones más arriba.
      esDui: leido?.es_dui !== false,
      caras: Array.isArray(leido?.caras)
        ? leido.caras.map((c: unknown) =>
            ['ANVERSO', 'REVERSO', 'AMBAS', 'OTRO'].includes(String(c)) ? String(c) : 'OTRO')
        : [],
    })
  } catch (e) {
    console.error('leer-dui:', e)
    return json({ ok: false, error: "READ_FAILED", details: String((e as Error)?.message || e) })
  }
})
