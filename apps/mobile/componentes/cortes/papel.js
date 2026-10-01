// El papel que sale al CONFIRMAR un corte, como en el portal
// (`useResolverCorte.jsx`): el comprobante del corte y la etiqueta de su
// bolsa — que nace sola al confirmar (trigger de `cortes_caja`). Los dos van a
// la caja de la sala por la cola; desde el teléfono no hay otro camino.
//
// Cada uno devuelve `{ ok, detalle }` y NUNCA lanza: que no salga el papel no
// deshace la firma, sólo hay que decirlo para que lo impriman desde la caja.
import { fetchCorteParaElPapel } from '@nucleo/data/cortes';
import { fetchBolsaDeCorte, fetchChequesDeBolsa, fetchSalidasDeBolsa, marcarEtiquetaImpresa } from '@nucleo/data/bolsas';
import { construirComprobanteDeCorte } from '@nucleo/utils/corteTicket';
import { construirEtiquetaDeBolsa, salidasParaEtiqueta } from '@nucleo/utils/bolsaComprobante';
import { resultadoDeLaFila } from '@nucleo/utils/cortesDiagnostico';
import { imprimirEnLaSala } from '../imprimir';

export async function comprobanteDelCorte(corte, sala, hechoPor) {
  try {
    const { corte: fila } = await fetchCorteParaElPapel(corte.id);
    if (!fila) return { ok: false, detalle: 'No se pudo leer el corte para armar el papel.' };
    return await imprimirEnLaSala(construirComprobanteDeCorte({
      resultado: resultadoDeLaFila(fila), sala, hechoPor, hechoAt: new Date().toISOString(),
    }), corte.branch_id);
  } catch (e) {
    return { ok: false, detalle: e?.message ?? 'No se pudo preparar el papel.' };
  }
}

// La etiqueta se marca impresa sólo si la cola la recibió, y con la versión
// siguiente: así una reimpresión se distingue de la primera.
export async function etiquetaDeLaBolsa(corteId, branchId, sala, cerradaPor) {
  try {
    const { bolsa, error } = await fetchBolsaDeCorte(corteId);
    if (error) return { ok: false, detalle: 'No se pudo leer la bolsa de este corte.' };
    if (!bolsa) return { ok: true, sinBolsa: true };
    const r = await imprimirEnLaSala(construirEtiquetaDeBolsa({
      bolsa, sala, salidas: [], cheques: await fetchChequesDeBolsa(bolsa.id), cerradaPor,
      version: (bolsa.etiqueta_version || 0) + 1, impresaAt: new Date().toISOString(),
    }), branchId);
    if (r.ok) await marcarEtiquetaImpresa(bolsa.id);
    return { ...r, folio: bolsa.folio };
  } catch (e) {
    return { ok: false, detalle: e?.message ?? 'No se pudo preparar el papel.' };
  }
}

// Reimprimir la etiqueta de una bolsa, como `useCerrarBolsa().imprimir` del
// portal: con sus SALIDAS (si no, la etiqueta diría lo guardado sobre una bolsa
// que ya no lo tiene) y sus cheques; la versión la da `marcarEtiquetaImpresa`,
// así la reimpresión se distingue de la primera.
export async function reimprimirEtiqueta(bolsa, sala, cerradaPor) {
  try {
    const salidas = Number(bolsa.salidas) === 0 && bolsa.salidas != null ? [] : salidasParaEtiqueta(await fetchSalidasDeBolsa(bolsa.id));
    const cheques = await fetchChequesDeBolsa(bolsa.id);
    const { data: version, error } = await marcarEtiquetaImpresa(bolsa.id);
    if (error) return { ok: false, detalle: error.message };
    return await imprimirEnLaSala(construirEtiquetaDeBolsa({
      bolsa, sala, salidas, cheques, cerradaPor,
      version: version ?? (bolsa.etiqueta_version || 0) + 1, impresaAt: new Date().toISOString(),
    }), bolsa.branch_id);
  } catch (e) {
    return { ok: false, detalle: e?.message ?? 'No se pudo preparar el papel.' };
  }
}
