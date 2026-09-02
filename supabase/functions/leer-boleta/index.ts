import { createClient } from "npm:@supabase/supabase-js@2"
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts"
import { callGemini, parseGeminiJson } from "../_shared/gemini.ts"
import { callClaude, parseClaudeJson } from "../_shared/claude.ts"

// ════════════════════════════════════════════════════════════════════════════
// Lee la foto del comprobante de una salida de dinero y la cuadra contra lo
// que la persona escribió.
//
// Pedido del usuario el 2026-08-20, mirando una salida real: «no puedes
// detectar que sea una boleta válida (que no tomen foto de otra cosa)». La
// única forma de saberlo sin adivinar es LEER la boleta y comparar contra los
// tres datos que el formulario ya pide: entidad, número de boleta y monto. Un
// heurístico de «esto parece un documento» caza la foto de una pared, no la
// foto de OTRA boleta ni la de la boleta de $50 para una salida de $200.
//
// ── Pero sólo DOS de esos tres frenan (2026-08-21) ──────────────────────────
// El monto y el número de boleta identifican la operación: son datos del
// papel, y si no cuadran, la foto es de otra cosa. La entidad resultó no ser
// un dato del papel sino del PROCESADOR — arriba de la boleta de una remesa va
// el banco del POS, no la remesadora—, así que quedó como aviso. El detalle,
// en `mismaEntidad`.
//
// ── La imagen viaja INLINE, no por el bucket ────────────────────────────────
// `analyze-document` recibe un `filePath` y se lo descarga a Storage. Acá no
// sirve: la verificación pasa ANTES de guardar, y subir para verificar dejaría
// en `payment-proofs` la basura de cada intento fallido —justo las fotos que se
// decidió no guardar—. Llega en base64 y no toca el bucket.
//
// ── Devuelve además el RECUADRO del papel ───────────────────────────────────
// «Que detectes y recortes el papel». Bajar un modelo de visión al teléfono se
// evaluó y se descartó (ver `EditorDeDocumento`): pesa megabytes y se equivoca
// con una foto movida sobre un mostrador. Pero si la imagen YA viaja acá para
// leerla, el recuadro sale de la misma llamada y no cuesta nada extra. Entra
// como SUGERENCIA: el editor abre con ese recorte puesto y la persona lo
// confirma o lo corrige. Un recorte automático que nadie mira es peor que uno
// manual — eso no cambió.
//
// ── Quién lee: una constante, no un `if` escondido ──────────────────────────
// El usuario preguntó el 2026-08-20 si convenía usar Claude en vez de Gemini
// («te tengo completo, así tú te encargas»). La respuesta corta es que su
// suscripción de Claude NO es una API key: la API se factura aparte, con una
// key de console.anthropic.com. Mientras esa key no exista en los secretos de
// Supabase, esto lee con Gemini, que ya está configurado y ya lo usan otras
// seis funciones del portal.
//
// El cambio es esta línea. Va como constante y no como «si hay key usá Claude,
// si no Gemini» a propósito: un camino que se elige solo hace que nadie sepa
// cuál corrió, y el día que la lectura falle no se puede saber quién falló.
const LECTOR: 'gemini' | 'claude' = 'gemini'

// ── El veredicto lo arma esta función, no el modelo ─────────────────────────
// El modelo sólo LEE. Comparar es aritmética y comparación de cadenas, y eso se
// hace acá: si la decisión de bloquear dependiera de que el modelo diga «no
// coincide», bastaría con que un día conteste distinto para que la regla cambie
// sola. El modelo aporta datos; la regla vive en código que se puede leer.
// ════════════════════════════════════════════════════════════════════════════

/** Deja sólo dígitos: los números de boleta se escriben `000292`, `292`, `# 292`. */
const soloDigitos = (v: unknown) => String(v ?? '').replace(/\D+/g, '')

/**
 * ¿El número que escribió la persona está EN EL PAPEL, en cualquier renglón?
 *
 * Existe por una remesa trabada de verdad (Salud 4, 29-ago-2026). La boleta de
 * Promerica trae dos números —`REFERENCIA : 082915195407` y `BOLETA : 018433`—
 * en dos columnas desalineadas, y el lector emparejó mal: dijo que la boleta era
 * la referencia y frenó a quien había escrito el número correcto.
 *
 * El freno existe para atajar la foto de OTRA operación, y para eso alcanza con
 * que el número esté impreso: una boleta ajena no lo tendría en ningún renglón.
 * Exigir además que el rótulo se haya leído bien es pedirle al lector una
 * precisión que el papel no siempre permite, y el costo de equivocarse lo paga
 * la sala con el cliente enfrente.
 */
const estaEnElPapel = (numeros: unknown, esperado: unknown) => {
  const y = soloDigitos(esperado).replace(/^0+/, '')
  if (!y) return false
  return (Array.isArray(numeros) ? numeros : [])
    .some((n) => soloDigitos(n).replace(/^0+/, '') === y)
}

/** `000292` y `292` son la MISMA boleta: se comparan sin los ceros de adelante. */
const mismaBoleta = (a: unknown, b: unknown) => {
  const x = soloDigitos(a).replace(/^0+/, '')
  const y = soloDigitos(b).replace(/^0+/, '')
  return !!x && x === y
}

/** Un centavo de tolerancia, que es ruido de coma flotante y no una diferencia. */
const mismoMonto = (a: unknown, b: unknown) => {
  const x = Number(a), y = Number(b)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  return Math.abs(x - y) < 0.01
}

/**
 * La entidad se compara con tolerancia: en la boleta puede salir
 * `TRANSNETWORK WS` y en el portal `TRANSNETWORK`. Basta con que una contenga
 * a la otra una vez normalizadas — es el mismo criterio de `buscarCargo`.
 */
const norm = (v: unknown) => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

const parecido = (a: unknown, b: unknown) => {
  const x = norm(a), y = norm(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

/**
 * Si la remesadora aparece en el papel, EN CUALQUIER PARTE.
 *
 * Antes se comparaba sólo contra el nombre de la cabecera, y eso resultó no ser
 * la remesadora: la boleta de una remesa la imprime el POS, y arriba va el
 * **banco que procesa el cobro** — «BANCO PROMERICA», que es el banco del POS
 * de la farmacia—. Reportado el 2026-08-21: no dejaba registrar una remesa
 * porque «dice banco promerica, y banco promerica es el banco del POS».
 *
 * Y no fallaba siempre, que es lo que lo hacía difícil de ver: la boleta de
 * REM-1010 sí decía `TRANSNETWORK WS` arriba y pasó sin ruido. O sea que ese
 * campo dice la remesadora en unas boletas y el banco del POS en otras — un
 * dato que cambia de significado según el papel no puede ser la prueba.
 *
 * Por eso se pregunta por TODOS los nombres impresos y alcanza con que uno
 * coincida. Y por eso, además, no coincidir ya no frena: ver el veredicto.
 */
const mismaEntidad = (leido: Record<string, unknown>, esperado: unknown) => {
  const nombres = [
    leido.entidad,
    ...(Array.isArray(leido.nombres) ? leido.nombres : []),
  ]
  return nombres.some((n) => parecido(n, esperado))
}

const PROMPT = `Estás mirando la foto de un comprobante de pago impreso (una "boleta" o
"voucher" de un punto de venta, casi siempre papel térmico angosto), tomada con un
teléfono sobre un mostrador.

Devuelve ÚNICAMENTE un JSON válido con esta forma exacta:
{
  "es_boleta": true | false,
  "entidad": "el nombre del comercio, banco o red de remesas impreso arriba, o null",
  "nombres": ["TODOS los nombres de empresa, banco, marca o red impresos en el papel"],
  "numero_boleta": "el número rotulado BOLETA / VOUCHER / RECIBO / No., sólo dígitos, o null",
  "numeros_del_papel": ["TODOS los números de 4 dígitos o más impresos en el papel"],
  "tipo_operacion": "REMESA | PAGO_SERVICIO | RETIRO | DEPOSITO | COMPRA | OTRO — lo que DICE el papel",
  "operacion_impresa": "la línea que NOMBRA la operación, tal como está impresa, o null",
  "red_remesas": "la red de remesas del detalle (MoneyGram, Ria, Western Union...), o null",
  "servicio": "la empresa a la que se le PAGA (CAESS, ANDA, CLARO...), del detalle, o null",
  "detalle_servicio": "qué servicio de esa empresa (LINEA MOVIL, RESIDENCIAL, PREPAGO...), o null",
  "referencia_servicio": "el número que identifica a quién se le pagó (teléfono, NIC, cuenta), o null",
  "monto": 0.00,
  "moneda": "USD" | null,
  "fecha": "YYYY-MM-DD o null",
  "recuadro": { "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 },
  "legible": true | false,
  "motivo": "si es_boleta es false, en una frase corta y en español, qué se ve en la foto"
}

Reglas:
- "es_boleta" es false si la foto no muestra un comprobante impreso (una pared, un
  producto, una pantalla, una persona, una hoja en blanco, un documento de otro tipo).
- "monto" es el TOTAL cobrado o entregado, como número, sin símbolo de moneda ni
  separadores de miles. Si hay varios importes, el que está rotulado MONTO o TOTAL.
  Una misma boleta puede traer DOS renglones "MONTO": uno arriba, entre los datos
  del cliente y sin símbolo ("MONTO: 125"), y el total abajo, con moneda
  ("MONTO: US$125.00"). Vale el de abajo, el que lleva la moneda.
- "nombres" lista TODO nombre propio de empresa, banco, marca o red de remesas que
  aparezca en el papel, esté donde esté: la cabecera, el cuerpo, el pie, el logo.
  Una boleta de remesa suele llevar DOS —el banco que procesa el cobro arriba y la
  red de remesas en el detalle— y hacen falta los dos. No inventes ni completes: si
  sólo hay uno, la lista tiene uno. Sin ninguno, [].
- "numero_boleta" es el correlativo del comprobante. NO uses la referencia, la
  autorización, el terminal ni el DUI.
- OJO con las boletas a DOS COLUMNAS: los rótulos van a la izquierda y los
  valores alineados a la derecha, y no siempre en el mismo renglón. Una boleta
  real de Banco Promerica (29-ago-2026) tiene «REFERENCIA :» con 082915195407
  al lado y «BOLETA :» con 018433 en la línea de abajo — leerlo por renglón da
  la referencia donde va la boleta. Emparejá cada rótulo con SU valor, no con
  el número que le quede más cerca.
- "numeros_del_papel" lista todos los números largos que aparezcan, sin
  interpretarlos: referencia, autorización, terminal, boleta, clave. Sirve para
  comprobar que un número escrito a mano está en el papel aunque el rótulo se
  haya leído mal.
- "tipo_operacion" sale de lo que el papel DICE, no de lo que parezca: "REMESA"
  si aparece esa palabra o el nombre de una red de remesas; "PAGO_SERVICIO" si
  nombra una empresa de servicio o el pago de un recibo —CAESS, DELSUR, EEO,
  DEUSEM, ANDA, CLARO, TIGO, MOVISTAR, DIGICEL, JAPAN, cable, internet, agua,
  luz, telefono— o si dice COLECTURIA o PAGO DE SERVICIOS; "RETIRO" si el POS
  ENTREGA efectivo contra una tarjeta, un token o una cuenta —"RETIRO",
  "RETIRO SIN TARJETA", "ADELANTO" o "AVANCE DE EFECTIVO"—; "DEPOSITO" si dice
  depósito o abono a cuenta; "COMPRA" si es la compra de un producto. Si no se
  puede afirmar, "OTRO".
- "red_remesas" es la red que ENTREGA el dinero —MoneyGram, Ria, Western Union,
  Transnetwork—, que NO es el banco de la cabecera. En una boleta de Promerica
  que dice "REMESA / MONEY GRAM WS", la red es MoneyGram y Promerica es sólo
  quien procesa el cobro. Si el papel no nombra ninguna red, null.
- "operacion_impresa" es la línea CENTRAL que nombra la operación, copiada tal
  cual. Vive entre los datos del cajero y la firma del cliente, y suele venir en
  dos o tres renglones: la operación, la marca o red, y la forma de pago.
  Devolvé SÓLO el renglón de la operación, con las palabras que la califican en
  ESE renglón. NO incluyas "EN EFECTIVO", ni el renglón de la marca o la red
  —ése va en "red_remesas"—, ni nombres de personas, ni importes.

  Existe porque el enum de "tipo_operacion" agrupa y el papel distingue: dos
  boletas reales de Banco Promerica del 2-sep-2026, y lo que hay que devolver en
  cada una:

    · "RETIRO TOKEN / PAGO CTK / EN EFECTIVO"
        tipo_operacion    = "RETIRO"
        operacion_impresa = "RETIRO TOKEN"
        red_remesas       = null

    · "REMESA / MONEY GRAM WS / EN EFECTIVO"
        tipo_operacion    = "REMESA"
        operacion_impresa = "REMESA"
        red_remesas       = "MONEY GRAM WS"

  Si el papel no tiene una línea así, null. No la deduzcas del resto.
- "servicio" es la empresa A LA QUE SE LE PAGA, y vive en el MISMO renglón
  donde una remesa lleva su red: debajo de la línea de la operación.

  NO es el nombre de la cabecera. En una boleta de POS arriba va el banco que
  procesa el cobro —«BANCO PROMERICA»—, que es el banco del aparato de la
  farmacia y no la empresa del recibo. Escribirlo ahí da «Pago de Banco
  Promerica» sobre el recibo de la luz, que es exactamente lo que pasaba antes
  de pedir este campo. Es la misma trampa que "red_remesas" resuelve del lado de
  las remesas.

  La excepción es un recibo propio de la empresa de servicio —no una boleta de
  POS—: ahí el nombre de arriba SÍ es a quién se le paga. Decidilo mirando el
  papel, no por una regla fija.

  Si el papel no nombra ninguna empresa de servicio, null.
- "detalle_servicio" es lo que CALIFICA al servicio en su propio renglón, y suele
  ir pegado a la empresa con un guión. En "PAGO DE TELEFONIA / CLARO - LINEA
  MOVIL" el servicio es "CLARO" y el detalle_servicio es "LINEA MOVIL". Copialo
  tal cual, sin la empresa adelante. Si no lo dice, null.
- "referencia_servicio" es el número que dice A QUIÉN se le pagó: el teléfono en
  un pago de telefonía, el NIC en uno de luz, el número de cuenta o de contrato
  en los demás. Va rotulado —TELEFONO:, NIC:, CUENTA:, CONTRATO:, SUMINISTRO:—
  y NO es la boleta, ni la referencia del POS, ni la autorización, ni el
  terminal, ni el monto. Sólo los dígitos.

  Existe porque es el ÚNICO dato con el que alguien vuelve a encontrar ese pago
  después: el nombre del cliente puede estar cortado y el monto se repite todos
  los meses. En la boleta de Claro del 2-sep-2026 es "77463090", rotulado
  TELEFONO. Si el papel no trae ninguno así, null.
- "recuadro" es la caja que encierra SÓLO el papel dentro de la foto, en fracciones
  de 0 a 1 sobre el ancho y el alto de la imagen (x,y = esquina superior izquierda).
  Si el papel ocupa toda la foto, devuelve {"x":0,"y":0,"w":1,"h":1}.
- "legible" es false si la impresión está tan borrosa, quemada o cortada que no se
  pueden leer los importes.
- Si un dato no está en la foto, null. No lo inventes ni lo deduzcas.`

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  // Mismo gate que las demás funciones con Gemini: sin sesión de empleado
  // activo, cualquiera con la anon key pública quemaría la cuota.
  const employee = await requireActiveEmployeeUser(req, admin)
  if (!employee) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { imagenBase64, mimeType, esperado } = await req.json()
    if (!imagenBase64) {
      return new Response(JSON.stringify({ error: 'SIN_IMAGEN' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // El formulario está abierto con alguien esperando: si tarda más que esto,
    // conviene decirlo y ofrecer reintentar antes que dejar la pantalla colgada.
    const TIMEOUT_MS = 45_000
    const leido = LECTOR === 'claude'
      ? parseClaudeJson<Record<string, unknown>>(await callClaude({
          prompt: PROMPT,
          imagenes: [{ mimeType: mimeType || 'image/jpeg', data: imagenBase64 }],
          effort: 'low',
          timeoutMs: TIMEOUT_MS,
        }))
      : parseGeminiJson<Record<string, unknown>>(await callGemini({
          prompt: PROMPT,
          inlineData: [{ mimeType: mimeType || 'image/jpeg', data: imagenBase64 }],
          jsonOutput: true,
          temperature: 0,
          timeoutMs: TIMEOUT_MS,
        }))

    // ── La regla, en código ────────────────────────────────────────────────
    const esperaBoleta = !!(esperado?.numeroBoleta)
    const coincide = {
      entidad: esperado?.entidad ? mismaEntidad(leido, esperado.entidad) : null,
      numeroBoleta: esperaBoleta
        ? (mismaBoleta(leido.numero_boleta, esperado.numeroBoleta)
           || estaEnElPapel(leido.numeros_del_papel, esperado.numeroBoleta))
        : null,
      monto: esperado?.monto != null ? mismoMonto(leido.monto, esperado.monto) : null,
      // El TIPO no se autollena —la foto sólo se pide DESPUÉS de elegir el
      // motivo, así que llegaría tarde— pero sí confirma: si el papel dice
      // «REMESA» y el motivo elegido es otro, alguien se equivocó de casilla.
      // Es aviso y no freno, como la entidad: el papel no siempre lo dice con
      // esa palabra y frenar por eso trabaría una operación buena.
      tipo: esperado?.tipo && leido.tipo_operacion && leido.tipo_operacion !== 'OTRO'
        ? String(leido.tipo_operacion).toUpperCase() === String(esperado.tipo).toUpperCase()
        : null,
    }

    // El VEREDICTO es lo que frena. Son los cuatro que prueban que esta foto es
    // de ESTA operación y no de otra: que sea una boleta, que se lea, y que el
    // monto y el número sean los que se escribieron.
    let veredicto = 'OK'
    if (!leido.es_boleta) veredicto = 'NO_ES_BOLETA'
    else if (leido.legible === false) veredicto = 'ILEGIBLE'
    else if (coincide.monto === false) veredicto = 'MONTO_NO_COINCIDE'
    else if (coincide.numeroBoleta === false) veredicto = 'BOLETA_NO_COINCIDE'

    // Los AVISOS se dicen y no frenan. Hoy hay uno solo, y la entidad está acá
    // por una razón que costó una remesa trabada (2026-08-21): el nombre que la
    // boleta trae impreso es el del banco del POS —«BANCO PROMERICA»— y no
    // siempre nombra a la remesadora. Un dato que la boleta a veces no trae no
    // puede ser la condición para registrar una salida de dinero que YA ocurrió.
    //
    // Que no frene no significa que se pierda: viaja en la respuesta, la
    // pantalla lo muestra en amarillo y queda guardado en `foto_lectura` junto a
    // la operación. Decisión del usuario, 2026-08-21: «avisar, pero dejar
    // guardar».
    const avisos = coincide.entidad === false
      ? [{
        campo: 'entidad',
        leido: leido.entidad ?? null,
        nombres: Array.isArray(leido.nombres) ? leido.nombres : [],
        esperado: esperado.entidad,
      }]
      : []

    return new Response(JSON.stringify({ leido, coincide, veredicto, avisos }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    // Sin veredicto: no es «la boleta está mal», es «no se pudo preguntar». La
    // pantalla tiene que decir esas dos cosas distinto — una se arregla sacando
    // otra foto y la otra reintentando.
    return new Response(JSON.stringify({ error: 'NO_SE_PUDO_LEER', detalle: String((err as Error)?.message || err) }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
