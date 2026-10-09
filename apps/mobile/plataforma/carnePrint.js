// El carné de papel — la versión del TELÉFONO. Gemelo de
// `src/plataforma/carnePrint.js`.
//
// El teléfono no tiene impresora enchufada ni diálogo de impresión: el papel
// sale por la COLA de una sala (`encolarImpresion`), que lee el agente de su
// caja. Por eso aquí la sala es obligatoria — sin ella se dice, no se finge que
// salió. El documento es el MISMO del portal (`construirCarneDePapel`) y los
// bytes también (`textoParaElRollo` + `ticketEnBase64`): las barras las dibuja
// la impresora con el valor, no hace falta el SVG del navegador.
import { construirCarneDePapel } from '@nucleo/utils/carneDePapel';
import { leerAjustesDeImpresion, textoParaElRollo, ticketEnBase64 } from '@nucleo/utils/ticketPrint';
import { encolarImpresion } from '@nucleo/data/impresion';

export { SIMBOLOGIA_DEL_CARNE, construirCarneDePapel } from '@nucleo/utils/carneDePapel';

export async function imprimirCarneDePapel(datos, { sala = null } = {}) {
  if (sala == null) {
    return { via: 'cola', ok: false, detalle: 'Desde el teléfono el carné sale por la caja de una sala: elige cuál.' };
  }
  try {
    const { ancho } = leerAjustesDeImpresion();
    const { error } = await encolarImpresion({
      branchId: Number(sala),
      titulo: 'Carné del día',
      contenidoB64: ticketEnBase64(textoParaElRollo({ ancho, ...construirCarneDePapel(datos) })),
    });
    if (error) return { via: 'cola', ok: false, detalle: 'Esa sala no tiene una caja que reciba el documento. Elige otra.' };
    return { via: 'cola', ok: true, detalle: 'Se mandó a la caja de la sala. Sale en unos segundos.' };
  } catch (e) {
    return { via: 'cola', ok: false, detalle: e?.message || 'No se pudo mandar a imprimir.' };
  }
}

// La etiqueta del carné de plástico es una hoja de 85 × 30 mm para una
// impresora de etiquetas enchufada a una computadora: en el teléfono no existe.
export async function imprimirEtiquetaDeCarne() {
  return { ok: false, motivo: 'La etiqueta del carné se imprime desde una computadora con la impresora de etiquetas.' };
}
