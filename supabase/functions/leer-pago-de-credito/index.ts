import { createClient } from "npm:@supabase/supabase-js@2"
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts"
import { callGemini, parseGeminiJson } from "../_shared/gemini.ts"
import { TITULAR, esElTitular, esNuestraFarmacia, elPapelNosNombra, norm } from "../_shared/titular.ts"

// ════════════════════════════════════════════════════════════════════════════
// Lee el comprobante con el que un cliente abona un crédito, y LLENA el
// formulario con lo que dice el papel.
//
// Pedido del usuario (2-sep): «si es transferencia / cheque / tarjeta, que se
// anexe el comprobante primero antes de digitar montos etc., y que de ahí mismo
// lo tome».
//
// ── El orden es al revés que en `leer-boleta`, y no es un detalle ──────────
// Allá la persona escribe el monto y la foto CONFIRMA; acá la foto va primero y
// LLENA. La diferencia es de quién es el dato: en una salida de dinero el monto
// lo decide quien saca la plata, y en un abono lo decide el papel que el cliente
// trajo. Pedir que se escriba primero es invitar a escribir lo que se esperaba
// —el saldo redondo— y no lo que el documento dice.
//
// Por eso esta función NO recibe un `esperado` con el monto. Recibe el SALDO,
// que es lo único contra lo que tiene sentido comparar: un papel por más de lo
// que se debe es un papel de otra cosa.
//
// ── Tres documentos, tres cosas que probar ────────────────────────────────
//
//   transferencia  el dinero tiene que haber llegado a NUESTRA cuenta. Se mira
//                  el BENEFICIARIO — pero desde el 2026-09-04 un nombre que no
//                  se reconoce AVISA y no frena: ver «Por qué el nombre ajeno
//                  ya no frena», más abajo. Vale también para el pago QR, donde
//                  el que recibe es el comercio y no la persona.
//   cheque         igual, y además que sea un cheque y no otra hoja.
//   tarjeta        el voucher tiene que ser de uno de NUESTROS POS. Un voucher
//                  de otro comercio no acredita nada.
//
// El monto y la fecha se leen en los tres y se ofrecen para llenar.
//
// ── El veredicto lo arma el código, no el modelo ──────────────────────────
// El modelo sólo LEE. Si la decisión de frenar dependiera de que conteste «no
// coincide», bastaría con que un día conteste distinto para que la regla cambie
// sola. El modelo aporta datos; la regla se puede leer acá.
// ════════════════════════════════════════════════════════════════════════════

/** Dos montos son el mismo si difieren menos de un centavo. */
const mismoMonto = (a: unknown, b: unknown) => {
  const x = Number(a), y = Number(b)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return Math.abs(x - y) < 0.005
}

const PROMPTS: Record<string, string> = {
  transferencia: `Estás mirando el comprobante de un pago que un cliente le hizo a una
farmacia: una TRANSFERENCIA BANCARIA, un DEPÓSITO o un PAGO CON CÓDIGO QR. Puede ser la
captura de pantalla de una app de banco, un correo de confirmación o un papel impreso.

Devuelve ÚNICAMENTE un JSON válido con esta forma exacta:
{
  "es_comprobante": true | false,
  "tipo_documento": "TRANSFERENCIA | DEPOSITO | PAGO_QR | OTRO",
  "beneficiario": "el nombre de quien RECIBE el dinero, tal cual está impreso, o null",
  "ordenante": "el nombre de quien ENVÍA el dinero, o null",
  "nombres_del_papel": ["TODOS los nombres de persona o empresa impresos, estén donde estén"],
  "banco": "el banco que emite el comprobante, o null",
  "monto": 0.00,
  "moneda": "USD" | null,
  "fecha": "YYYY-MM-DD o null",
  "referencia": "el número de referencia, confirmación, operación o transacción, o null",
  "estado": "el estado que el papel declare, copiado tal cual, o null",
  "numeros_del_papel": ["TODOS los números de 4 dígitos o más que aparezcan"],
  "legible": true | false,
  "motivo": "si es_comprobante es false, en una frase corta y en español, qué se ve"
}

Reglas:
- "es_comprobante" es false si no se ve un comprobante de pago (una foto de otra cosa,
  una pantalla en blanco, un producto, una persona).
- ⚠️ UN PAGO QR ES UN COMPROBANTE. La pantalla que dice "Pagos QR", "Pago con QR",
  "Transfer365" u "Operación ejecutada con éxito" y trae un monto y a quién se le pagó
  vale exactamente igual que una transferencia: "es_comprobante" true y tipo_documento
  "PAGO_QR". No la descartes por no tener forma de transferencia.
- En un PAGO QR el que recibe es un COMERCIO y no una persona, y su nombre va después de
  "Pagar a", "Comercio", "Negocio" o "Beneficiario" —por ejemplo "FARMACIA LA SALUD QPL"—.
  Ese nombre va en "beneficiario", y también en "nombres_del_papel".
- OJO con BENEFICIARIO vs ORDENANTE. Son dos nombres distintos y confundirlos
  invierte el sentido de la operación. El beneficiario es a quien SE LE ABONA:
  suele ir rotulado "Beneficiario", "Destino", "Para", "Acreditar a", "Cuenta
  destino". El ordenante es quien paga: "De", "Origen", "Cuenta debitada".
  Si sólo hay un nombre y no se puede saber cuál es, ponelo en "beneficiario" y
  dejá "ordenante" en null.
- ⚠️ DESDE QUÉ LADO ESTÁ EMITIDO EL PAPEL. Una NOTA DE CARGO —también
  "comprobante de débito", "cargo a cuenta"— la emite el banco de quien PAGA: la
  cuenta que encabeza el papel es la que se debitó, así que su titular (el que
  aparece bajo "A nombre de", "Titular", "Cliente") es el ORDENANTE y NO el
  beneficiario. En esos papeles el que RECIBE es el nombre que acompaña al tipo
  de transacción o al concepto: "Transfer365 JUAN PEREZ" significa que JUAN
  PEREZ recibe. Una NOTA DE ABONO o un comprobante de depósito es al revés: la
  cuenta del encabezado es la que recibe.
- "nombres_del_papel" lista TODO nombre propio impreso —encabezado, cuerpo, pie,
  concepto—, tal cual, aunque venga cortado a la mitad. No lo completes ni lo
  corrijas: si dice "JOSE RUTILIO ALEMA", escribí "JOSE RUTILIO ALEMA".
- "monto" es el importe transferido, como número, sin símbolo ni separadores de
  miles. Si hay comisión aparte, el monto es el que RECIBE el beneficiario.
- "fecha" es la de la operación, no la de impresión ni la de hoy. Si el papel trae dos
  ("fecha de ordenanza" y "fecha aplicada"), usá la de la operación.
- "estado" se copia TAL CUAL del papel, sin interpretarlo: FINALIZADO, APLICADA, EXITOSA,
  PENDIENTE, RECHAZADA, ANULADA… Si el papel no declara ningún estado, null.
- Si un dato no está, null. No lo inventes ni lo deduzcas.`,

  cheque: `Estás mirando la foto de un CHEQUE.

Devuelve ÚNICAMENTE un JSON válido con esta forma exacta:
{
  "es_comprobante": true | false,
  "tipo_documento": "CHEQUE | OTRO",
  "beneficiario": "el nombre escrito en la línea PÁGUESE A LA ORDEN DE, o null",
  "ordenante": "el titular de la cuenta, impreso abajo o al pie, o null",
  "nombres_del_papel": ["TODOS los nombres de persona o empresa impresos, estén donde estén"],
  "banco": "el banco impreso en el cheque, o null",
  "monto": 0.00,
  "moneda": "USD" | null,
  "fecha": "YYYY-MM-DD o null",
  "referencia": "el número del cheque, o null",
  "numeros_del_papel": ["TODOS los números de 4 dígitos o más que aparezcan"],
  "legible": true | false,
  "motivo": "si es_comprobante es false, en una frase corta y en español, qué se ve"
}

Reglas:
- "beneficiario" es lo escrito después de "PÁGUESE A LA ORDEN DE" — puede estar a
  mano. "ordenante" es el titular impreso de la cuenta, que es otra cosa.
- "monto" es la cifra en números. Si la cifra en números y la escrita en letras no
  coinciden, usá la escrita en LETRAS y dejá "legible" en true igual.
- "fecha" es la del cheque. Un cheque con fecha futura es válido de leer: se
  devuelve la fecha tal cual, sin corregirla.
- "referencia" es el número de cheque, normalmente arriba a la derecha. NO uses el
  número de cuenta ni el de ruta impreso abajo en tinta magnética.
- "nombres_del_papel" lista TODO nombre propio impreso, tal cual, aunque venga
  cortado. No lo completes ni lo corrijas.
- Si un dato no está, null. No lo inventes.`,

  tarjeta: `Estás mirando el VOUCHER de un pago con tarjeta en un punto de venta (POS),
casi siempre papel térmico angosto.

Devuelve ÚNICAMENTE un JSON válido con esta forma exacta:
{
  "es_comprobante": true | false,
  "tipo_documento": "VOUCHER | OTRO",
  "procesador": "el nombre del banco o procesador impreso ARRIBA del voucher, o null",
  "nombres": ["TODOS los nombres de banco, marca o comercio impresos en el papel"],
  "comercio": "el nombre del comercio, si aparece, o null",
  "monto": 0.00,
  "moneda": "USD" | null,
  "fecha": "YYYY-MM-DD o null",
  "referencia": "el número de AUTORIZACIÓN o APROBACIÓN, o null",
  "numeros_del_papel": ["TODOS los números de 4 dígitos o más que aparezcan"],
  "aprobado": true | false,
  "legible": true | false,
  "motivo": "si es_comprobante es false, en una frase corta y en español, qué se ve"
}

Reglas:
- "procesador" es el nombre de arriba, que es del BANCO que procesa el cobro y no
  de la tarjeta ni del comercio. Copialo tal cual.
- "nombres" lista todo nombre propio impreso, esté donde esté: cabecera, cuerpo,
  pie, logo. Hace falta porque el procesador no siempre está arriba.
- "aprobado" es false si el voucher dice DECLINADA, RECHAZADA, ANULADA o
  similar. Un voucher declinado no acredita ningún pago.
- "referencia" es la AUTORIZACIÓN. NO uses el número de terminal, el lote, ni los
  últimos dígitos de la tarjeta.
- NUNCA devuelvas el número completo de la tarjeta, ni siquiera si se ve.
- Si un dato no está, null. No lo inventes.`,
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )
    const quien = await requireActiveEmployeeUser(req, supabase)
    if (!quien) return json({ error: "SESION_INVALIDA" }, 401)

    const { imagenBase64, mimeType, forma, saldo } = await req.json()
    if (!imagenBase64) return json({ error: "SIN_IMAGEN" }, 400)

    /* El comprobante del banco llega en PDF tan seguido como en foto —es lo
     * que la app descarga—, y hasta el 2026-09-03 el portal lo rechazaba antes
     * de mandarlo: el reductor de imágenes lo cargaba en un `<img>`, que un PDF
     * no puede llenar, y el aviso decía «No se pudo leer la foto». El lector
     * abre las dos cosas; lo que había era una tubería hecha sólo para fotos. */
    const tipo = String(mimeType || "image/jpeg").toLowerCase()
    if (!tipo.startsWith("image/") && tipo !== "application/pdf") {
      return json({ error: "FORMATO_NO_SOPORTADO" }, 400)
    }

    const clave = String(forma || "").toLowerCase()
    const prompt = PROMPTS[clave]
    if (!prompt) return json({ error: "FORMA_SIN_LECTOR" }, 400)

    // El formulario está abierto con el cliente esperando: si tarda más que
    // esto, conviene decirlo y ofrecer reintentar antes que colgar la pantalla.
    const leido = parseGeminiJson<Record<string, unknown>>(await callGemini({
      prompt,
      inlineData: [{ mimeType: tipo, data: imagenBase64 }],
      jsonOutput: true,
      temperature: 0,
      timeoutMs: 45_000,
    }))

    // ── La regla, en código ────────────────────────────────────────────────
    const monto = Number(leido.monto)
    const tieneMonto = Number.isFinite(monto) && monto > 0
    const tope = Number(saldo)

    /* Los POS salen de la tabla y no de una lista escrita acá: son tres y hoy
     * el portal conoce uno con nombre. Con la tabla, sumar los otros dos es una
     * fila; escritos a mano, un despliegue — y mientras tanto el voucher de un
     * POS bueno se rechazaría con el cliente enfrente. */
    let pos: { codigo: string; nombre: string } | null = null
    let posSinReconocer = false
    if (clave === "tarjeta") {
      const { data: proveedores, error: ePos } = await supabase
        .from("pos_proveedores").select("codigo, nombre, nombres_en_el_papel").eq("activo", true)
      // Nunca descartar el error de un query: sin esto, un fallo de lectura
      // dejaría la lista vacía y TODO voucher saldría como «POS desconocido».
      if (ePos) console.error("[leer-pago] pos_proveedores:", ePos.message)
      const enElPapel = [leido.procesador, ...(Array.isArray(leido.nombres) ? leido.nombres : [])]
        .map(norm).filter(Boolean)
      for (const p of proveedores ?? []) {
        const alias = (p.nombres_en_el_papel ?? []).map(norm)
        if (alias.some((a: string) => enElPapel.some((n) => n.includes(a)))) {
          pos = { codigo: p.codigo, nombre: p.nombre }
          break
        }
      }
      posSinReconocer = !pos
    }

    /* El titular se busca DOS veces, y la segunda es la que evita el freno de
     * más. Primero en la casilla del que recibe, que es la respuesta correcta
     * cuando el papel la trae rotulada. Y después en TODO el papel, porque el
     * rótulo del que recibe no es uno solo: en una nota de cargo el que recibe
     * va pegado al tipo de transacción y «A nombre de» es quien paga. Ahí, leer
     * la casilla equivocada invierte la operación y rechaza un pago que entró.
     * Costó el abono del 2026-09-02 con el cliente en el mostrador. */
    const nombresDelPapel = clave === "tarjeta" ? [] : [
      leido.beneficiario, leido.ordenante,
      ...(Array.isArray(leido.nombres_del_papel) ? leido.nombres_del_papel : []),
    ]
    const nombradoEnElPapel = clave === "tarjeta" ? null : elPapelNosNombra(nombresDelPapel)

    /* La casilla del que recibe puede traer al titular O una farmacia nuestra.
     * Lo segundo es lo normal en un pago QR: el QR está registrado a nombre del
     * comercio, así que el papel nunca va a decir el nombre de la persona. */
    const coincide = {
      titular: clave === "tarjeta" ? null
        : (esElTitular(leido.beneficiario) || esNuestraFarmacia(leido.beneficiario)),
      nombradoEnElPapel,
      cabeEnElSaldo: tieneMonto && Number.isFinite(tope) ? monto <= tope + 0.004 : null,
      pos: clave === "tarjeta" ? !posSinReconocer : null,
    }

    /* El VEREDICTO es lo que frena, y son pocas cosas a propósito: que sea el
     * documento que dice ser, que se lea, que el propio papel no diga que la
     * operación no se aplicó, que tenga monto, y que no diga más de lo que el
     * cliente debe. Todo lo demás es aviso — un freno de más se paga con el
     * cliente esperando en el mostrador.
     *
     * Un papel que se declara RECHAZADO o PENDIENTE no acredita ningún pago, lo
     * mismo que un voucher declinado. Es lo único que se sumó como freno, y
     * sale SÓLO con una palabra explícita del papel: la ausencia del dato no
     * frena a nadie. */
    const NO_SE_APLICO = /RECHAZ|ANULAD|REVERS|DENEGAD|FALLID|PENDIENTE|EN PROCESO|NO APLICAD/

    let veredicto = "OK"
    if (!leido.es_comprobante) veredicto = "NO_ES_COMPROBANTE"
    else if (leido.legible === false) veredicto = "ILEGIBLE"
    else if (clave === "tarjeta" && leido.aprobado === false) veredicto = "NO_APROBADO"
    else if (clave !== "tarjeta" && NO_SE_APLICO.test(norm(leido.estado))) {
      veredicto = "OPERACION_NO_APLICADA"
    }
    else if (!tieneMonto) veredicto = "SIN_MONTO"
    else if (coincide.cabeEnElSaldo === false) veredicto = "MONTO_MAYOR_AL_SALDO"

    /* ── Por qué el nombre ajeno ya NO frena (2026-09-04) ──────────────────
     *
     * Hasta hoy, «nuestro nombre no está en el papel» apagaba el botón. Y el
     * papel que lo destapó era nuestro: un pago QR a «FARMACIA LA SALUD QPL»,
     * o sea el COMERCIO, que es un nombre que el portal no tenía por qué
     * conocer. El cliente ya había pagado y el cobro no se podía registrar.
     *
     * El problema de fondo no era ese nombre sino la forma del freno: **cada
     * manera nueva en que un banco nos nombra costaba un despliegue**, y entre
     * el papel nuevo y el despliegue no había ninguna salida en el mostrador.
     * Un freno sin salida no se cumple: se esquiva escribiendo el cobro como
     * otra cosa, y ahí se pierde hasta el rastro.
     *
     * Decisión del usuario, 2026-09-04: **pasa, con aviso y marca.** El aviso
     * habla en pantalla —«comprueba que el pago haya entrado»— y la marca queda
     * dentro de `lectura`, que se guarda en `creditos_abonos_portal.lectura`,
     * así que los comprobantes con nombre sin reconocer se pueden listar
     * después sin que nadie tenga que acordarse de anotarlos.
     *
     * Lo que SÍ sigue frenando no depende de ningún nombre: que no sea un
     * comprobante, que no se lea, que el propio papel diga que la operación no
     * se aplicó, que no tenga monto, o que diga más de lo que el cliente debe. */
    const nombreSinReconocer = clave !== "tarjeta" && nombradoEnElPapel === false

    /* El aviso del nombre NO va acá y es a propósito: `nombreSinReconocer` viaja
     * como bandera y la frase la escribe la pantalla, que es la que sabe con
     * cuánto peso decirla. Puesta también en `avisos` saldría dos veces. */
    const avisos: string[] = []
    if (!nombreSinReconocer && coincide.titular === false) {
      avisos.push(
        "El comprobante nombra a la empresa, pero no en la casilla de quien recibe el dinero. "
        + "Comprueba que el pago haya entrado antes de aceptarlo.",
      )
    }
    if (posSinReconocer) {
      avisos.push("No se reconoció el POS del voucher. Compruébalo antes de aceptar el pago.")
    }
    if (!leido.fecha) avisos.push("El comprobante no dice la fecha; escríbela a mano.")
    if (!leido.referencia) avisos.push("No se leyó el número del comprobante; escríbelo a mano.")

    /* Un cobro rechazado en el mostrador sale con 200 igual que uno aceptado, así
     * que sin esta línea la única forma de saber qué pasó es pedirle el teléfono
     * al cliente. Costó el pago QR del 2026-09-04: dos intentos en el registro,
     * los dos 200, y ninguno decía cuál de los cinco frenos había sido. */
    console.log("[leer-pago]", JSON.stringify({
      forma: clave, veredicto, nombreSinReconocer,
      tipo: leido.tipo_documento ?? null, estado: leido.estado ?? null,
      beneficiario: leido.beneficiario ?? null, monto: tieneMonto ? monto : null,
    }))

    return json({
      leido,
      coincide,
      veredicto,
      // La MARCA. Viaja adentro de `lectura` hasta
      // `creditos_abonos_portal.lectura`, que es donde se puede listar después.
      nombreSinReconocer,
      avisos,
      // Lo que la pantalla va a poner en el formulario. Se devuelve aparte de
      // `leido` para que se vea qué se autollenó y qué se dejó a mano.
      sugerido: {
        monto: tieneMonto ? Number(monto.toFixed(2)) : null,
        fecha: leido.fecha ?? null,
        documento: leido.referencia ?? null,
        pos: pos?.codigo ?? null,
        posNombre: pos?.nombre ?? null,
      },
      titularEsperado: TITULAR,
    })
  } catch (e) {
    // Sin veredicto: no es «el comprobante está mal», es «no se pudo
    // preguntar». La pantalla tiene que decirlo distinto y ofrecer reintentar.
    console.error("leer-pago-de-credito:", e)
    return json({ error: (e as Error).message ?? "NO_SE_PUDO_LEER" }, 500)
  }
})
