/* El prompt con que se lee el documento de un PAGO A PROVEEDOR.
 *
 * Nació el 2026-10-22: Salud 28 pagó $6.00 a Agua Fría con una «orden de
 * despacho» llenada a mano, fotografiada de costado, y el lector no la
 * reconoció. No era la foto: `PROMPT_BOLETA` describe un voucher térmico de
 * POS y dice explícitamente que «un documento de otro tipo» NO es boleta. La
 * salida terminó anotándose sin comprobante y pidiendo autorización, con el
 * papel en la mano.
 *
 * Lo que le paga la sala a un proveedor llega de tres formas, y las tres
 * valen (usuario, 2026-10-22: «puede ser de un térmico, un pdf, o una factura
 * así»): el tiquete térmico, el PDF de una factura electrónica y el talonario
 * llenado a mano. Por eso este prompt no supone el medio, sólo el CONTENIDO:
 * quién cobra, qué documento es, qué número lleva y cuánto suma.
 *
 * Devuelve las MISMAS claves que `PROMPT_BOLETA` donde el dato es el mismo
 * (`es_boleta`, `monto`, `numero_boleta`, `importes_del_papel`…): la pantalla,
 * el veredicto y `monto_origen` en la base las leen sin saber qué prompt
 * corrió. Lo propio de un proveedor va en claves aparte.
 */
export const PROMPT_DOCUMENTO_PROVEEDOR = `Estás mirando un documento con el que una farmacia le PAGA a un proveedor:
una factura, un crédito fiscal, una nota de remisión, una orden de despacho, un
recibo o un tiquete. Puede ser una foto de un papel —impreso, de impresora
térmica, o un formulario de talonario llenado A MANO— tomada con un teléfono y
posiblemente girada, o un PDF.

Devuelve ÚNICAMENTE un JSON válido con esta forma exacta:
{
  "es_boleta": true | false,
  "proveedor": "el nombre de la empresa que EMITE el documento y cobra, o null",
  "nombres": ["TODOS los nombres de empresa o marca impresos en el documento"],
  "tipo_documento": "FACTURA | CREDITO_FISCAL | NOTA_DE_REMISION | ORDEN_DE_DESPACHO | RECIBO | TIQUETE | OTRO",
  "documento_impreso": "el título del documento tal como está impreso (\\"ORDEN DE DESPACHO\\", \\"FACTURA\\"...), o null",
  "numero_documento": "el correlativo del documento, sólo dígitos, o null",
  "numeros_del_papel": ["TODOS los números de 4 dígitos o más del documento, impresos o escritos"],
  "monto": 0.00,
  "importes_del_papel": [{ "rotulo": "el rótulo tal como está, o null", "valor": 0.00 }],
  "renglones": [{ "cantidad": 0, "descripcion": "texto", "precio_unitario": 0.00, "total": 0.00 }],
  "escrito_a_mano": true | false,
  "moneda": "USD" | null,
  "fecha": "YYYY-MM-DD o null",
  "recuadro": { "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 },
  "legible": true | false,
  "motivo": "SÓLO si es_boleta es false: en una frase corta y en español, qué se ve; si no, null"
}

Reglas:
- "es_boleta" es true si es un documento de compra o de cobro de un proveedor,
  sea impreso, térmico, PDF o llenado a mano. Es false si la foto no muestra un
  documento así (una pared, un producto, una pantalla, una persona, una hoja en
  blanco).
- La foto puede venir GIRADA 90° o de cabeza. Leé el documento en su sentido
  correcto antes de extraer nada.
- "proveedor" es quien EMITE el documento: el nombre del membrete, arriba, con
  su dirección y teléfono. NO es el cliente («NOMBRE DEL CLIENTE», «SEÑOR(ES)»),
  que es la farmacia o una persona, ni el vendedor.
- "numero_documento" es el correlativo del documento: «No.», «Nº», «N°»,
  «FACTURA No.», casi siempre impreso en rojo en un talonario. NO es el NIT, el
  NRC, el teléfono, el DUI ni el número de autorización. En un DTE electrónico
  es el «Número de control» si no hay otro correlativo; devolvelo completo.
- "monto" es el TOTAL a pagar, como número, sin símbolo ni separadores de
  miles. El rotulado TOTAL, «T=», «VENTA TOTAL», «TOTAL A PAGAR». Si está
  escrito a mano, leelo a mano; ante la duda entre dos cifras, elegí la que
  cuadra con los renglones.
- "importes_del_papel" lista TODOS los importes del documento con el rótulo que
  llevan al lado («SUMAS», «IVA», «SUBTOTAL», «TOTAL», «T=», null si no tiene),
  incluidos los totales de cada renglón. Sin interpretar ni descartar repetidos:
  si el mismo número sale dos veces, va dos veces.
- "renglones" son las líneas de producto CON cantidad o importe: cantidad,
  descripción, precio unitario y total del renglón. En un formulario impreso la
  lista de productos puede venir preimpresa y sólo UNO llevar cantidad escrita:
  devolvé sólo los que tienen cantidad o importe. Si un dato del renglón no
  está, null.
- "escrito_a_mano" es true si el monto o el número del documento están
  escritos a mano.
- "fecha" es la fecha del documento (de compra o emisión, no la de entrega si
  son distintas). Los talonarios la escriben DÍA/MES/AÑO, y el año a mano
  suele venir abreviado («26», «026», «2026»): es un año reciente, 2025 o
  2026 — la orden de Agua Fría dice «22/10/026» y es el 22 de octubre de 2026.
- "recuadro" es la caja que encierra SÓLO el documento dentro de la foto, en
  fracciones de 0 a 1 sobre el ancho y el alto de la imagen tal como llegó
  (x,y = esquina superior izquierda). Si ocupa todo o es un PDF,
  {"x":0,"y":0,"w":1,"h":1}.
- "legible" es false si no se puede leer el total.
- Si un dato no está, null. No lo inventes ni lo deduzcas.`
