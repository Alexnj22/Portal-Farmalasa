import { createClient } from "npm:@supabase/supabase-js@2"
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts"
import { callGemini, parseGeminiJson } from "../_shared/gemini.ts"
import { callClaude, parseClaudeJson } from "../_shared/claude.ts"
import { PROMPT_BOLETA as PROMPT } from "../_shared/boletaPrompt.ts"

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
 * ¿El total leído lo dice el papel MÁS DE UNA VEZ?
 *
 * Nació de una corrección real (boleta 018540, Salud 4, 5-sep-2026): el papel
 * dice **US$240.50** y el lector puso **248.50**. La causa está en la tipografía
 * del POS, que escribe el cero con una barra diagonal —`Ø`—: a la resolución en
 * que la foto viaja, esa barra cierra el hueco y el cero queda casi idéntico a
 * un 8. No es un defecto que se arregle pidiendo «leé con cuidado».
 *
 * Lo que sí lo ataja es que el papel **repite el total**: una boleta de remesa
 * lo imprime arriba sin moneda (`MONTO: $240.5`) y abajo con ella
 * (`MONTO: US$240.50`). Dos renglones distintos, la misma cifra. Si los dos se
 * leen igual, la lectura está confirmada por el propio papel; si difieren, un
 * dígito se leyó mal y no se sabe cuál — y ahí lo honesto es no cerrarle el
 * campo a nadie.
 *
 * Devuelve:
 *   'CONFIRMADO'  el total aparece dos o más veces con el mismo valor
 *   'CONTRADICHO' hay otro importe rotulado MONTO/TOTAL con un valor distinto
 *   'UNICO'       el papel sólo lo dice una vez: no se puede cotejar
 *
 * `CONTRADICHO` y `UNICO` NO son lo mismo y por eso son tres valores y no un
 * booleano: uno dice «el papel se desmiente», el otro «el papel no tiene con qué
 * confirmarlo». La primera versión de esto los juntaba en `false`, y así una
 * boleta de un solo importe —la mayoría de los pagos de servicio— habría
 * quedado marcada como sospechosa para siempre.
 */
const ES_TOTAL = /\b(MONTO|TOTAL|IMPORTE|VALOR)\b/
const confianzaDelMonto = (leido: Record<string, unknown>): 'CONFIRMADO' | 'CONTRADICHO' | 'UNICO' => {
  const total = Number(leido.monto)
  if (!Number.isFinite(total)) return 'UNICO'
  const lista = Array.isArray(leido.importes_del_papel) ? leido.importes_del_papel : []
  const importes = lista
    .map((i) => {
      const fila = (i ?? {}) as Record<string, unknown>
      return { rotulo: norm(fila.rotulo), valor: Number(fila.valor) }
    })
    .filter((i) => Number.isFinite(i.valor))

  const iguales = importes.filter((i) => mismoMonto(i.valor, total)).length
  if (iguales >= 2) return 'CONFIRMADO'
  // Un rótulo de total con OTRO número: el papel se está desmintiendo.
  if (importes.some((i) => ES_TOTAL.test(i.rotulo) && !mismoMonto(i.valor, total))) return 'CONTRADICHO'
  return 'UNICO'
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

    /* ── Cuánto se le puede creer al monto ──────────────────────────────────
     *
     * Va aparte del veredicto a propósito. El veredicto contesta «¿esta foto es
     * de esta operación?»; esto contesta «¿el número que leí es el que está
     * impreso?», que es otra pregunta y tiene otra consecuencia: no frena nada,
     * decide si el campo del monto se le puede CERRAR a quien anota.
     *
     * El usuario pidió el 2026-08-29 que la boleta y el monto no se pudieran
     * modificar cuando la foto los detecta, y esa regla sigue en pie — lo que
     * cambia es qué cuenta como «detectado». Un número que el papel no confirma
     * por segunda vez no está detectado: está leído. */
    const montoConfianza = confianzaDelMonto(leido)

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

    return new Response(JSON.stringify({ leido, coincide, veredicto, avisos, montoConfianza }), {
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
