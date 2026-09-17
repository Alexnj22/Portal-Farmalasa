/* El prompt con que se lee una boleta de POS.
 *
 * Vive aparte de `leer-boleta` desde el 2026-09-17 para que se pueda MEDIR
 * sin copiarlo. Un prompt copiado a mano en una sonda mide el prompt de la
 * sonda: el dia que uno de los dos cambie, la medicion deja de hablar de lo que
 * corre en produccion y nadie se entera, porque los dos siguen funcionando.
 *
 * Cada regla de aca abajo costo una lectura equivocada. No se recorta para
 * ahorrar tokens de ENTRADA: medido el 2026-09-17, la entrada de texto fue
 * $0.79 de una factura de $9.54 y la salida $8.66. Lo caro es lo que el modelo
 * escribe, no lo que se le da para leer.
 */
export const PROMPT_BOLETA = `Estás mirando la foto de un comprobante de pago impreso (una "boleta" o
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
  "importes_del_papel": [{ "rotulo": "el rótulo tal como está impreso, o null", "valor": 0.00 }],
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
- ⚠️ ESTAS IMPRESORAS ESCRIBEN EL CERO CON UNA BARRA DIAGONAL ADENTRO: Ø. A la
  resolución de una foto de mostrador esa barra cierra el hueco y el cero se
  vuelve casi idéntico a un OCHO. Ante la duda entre 0 y 8 en un importe, mirá
  la forma: el 8 son dos círculos COMPLETOS uno sobre otro, con la cintura
  cerrada a los lados; el cero barrado es UN óvalo con una raya que lo cruza en
  diagonal y no toca los bordes. Costó una corrección real: la boleta 018540 del
  5-sep-2026 decía US$240.50 y se leyó 248.50.
- "importes_del_papel" lista TODOS los importes impresos, cada uno con el rótulo
  que lleva al lado tal como está escrito ("MONTO", "TOTAL", "MONTO:", null si no
  tiene). Sin interpretarlos y sin descartar los repetidos: si el mismo número
  sale dos veces, va dos veces. Sirve para comprobar el total contra un segundo
  renglón del propio papel — una boleta de remesa lo imprime arriba sin moneda y
  abajo con ella, y leer distinto en cada uno es la señal de que un dígito se
  leyó mal.
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
