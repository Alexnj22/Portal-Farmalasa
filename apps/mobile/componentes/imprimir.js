// Imprimir desde el teléfono: el documento va a la caja de la SALA por la
// cola (`encolarImpresion`), que es el mismo primer camino de
// `imprimirDocumento` en el portal. El teléfono no tiene otro: si la sala no
// tiene una caja registrada, se dice y no se finge que salió.
//
// Los bytes son los MISMOS del portal (`textoParaElRollo` + `ticketEnBase64`
// del núcleo): un comprobante impreso desde la app y otro desde el portal son
// el mismo papel. `ok: true` significa *recibido por la cola*, nunca *salió
// papel* (CLAUDE.md, «Impresión en ticketera»).
import { leerAjustesDeImpresion, textoParaElRollo, ticketEnBase64 } from '@nucleo/utils/ticketPrint';
import { encolarImpresion } from '@nucleo/data/impresion';

export async function imprimirEnLaSala(ticket, sala, titulo = null) {
  if (sala == null) return { ok: false, detalle: 'No se sabe en qué sala imprimirlo.' };
  try {
    const { ancho } = leerAjustesDeImpresion();
    const { error } = await encolarImpresion({
      branchId: Number(sala),
      titulo: titulo || ticket?.titulo || 'Documento',
      contenidoB64: ticketEnBase64(textoParaElRollo({ ancho, ...ticket })),
    });
    if (error) return { ok: false, detalle: 'La sala no tiene una caja que reciba el documento, o tiene demasiados esperando.' };
    return { ok: true, detalle: 'Se mandó a la caja de la sala. Sale en unos segundos.' };
  } catch (e) {
    return { ok: false, detalle: e?.message ?? 'No se pudo mandar a imprimir.' };
  }
}
