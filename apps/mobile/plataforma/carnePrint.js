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
import * as Print from 'expo-print';
import { leerAjustesDeImpresion, limpiarValorDeBarras, textoParaElRollo, ticketEnBase64 } from '@nucleo/utils/ticketPrint';
import { svgDeCodigoDeBarras } from './impresion';
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

// ── La etiqueta del carné de PLÁSTICO ──────────────────────────────────────
// Gemelo de la web: la hoja de 85 × 30 mm con el nombre y las barras del PIN
// permanente, la que se lleva quien fabrica el carné. En la web sale por el
// diálogo del navegador; acá, por AirPrint (`expo-print`), que es su
// equivalente — NUNCA por la cola de la sala: un ticket con la credencial
// permanente quedaría sobre un mostrador, que es justo lo que el carné del día
// existe para evitar. El primer argumento (la ventana del navegador) no existe
// en el teléfono y se ignora.
export async function imprimirEtiquetaDeCarne(_win, { nombre, valor } = {}) {
  const limpio = limpiarValorDeBarras(valor);
  if (!limpio) return { ok: false, motivo: 'Esa persona no tiene código de carné.' };
  const svg = await svgDeCodigoDeBarras(limpio, 'CODE128').catch(() => '');
  if (!svg) return { ok: false, motivo: 'No se pudo dibujar el código de barras.' };
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = `<html><head><meta charset="utf-8"><style>
    @page { margin: 0; size: 85mm 30mm; }
    body { margin: 0; padding: 8mm 4mm; font-family: Arial, sans-serif; text-align: center;
           display: flex; flex-direction: column; align-items: center; justify-content: center; }
    h3 { margin: 0 0 3mm; font-size: 11pt; font-weight: bold; }
    svg { max-width: 75mm; height: 12mm; }
  </style></head><body><h3>${esc(nombre)}</h3>${svg}</body></html>`;
  try {
    // 85 × 30 mm en puntos de imprenta (72 por pulgada).
    await Print.printAsync({ html, width: 241, height: 85 });
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e?.message || 'No se pudo imprimir.' };
  }
}
