// El papel que sale al CONFIRMAR un corte, como en el portal
// (`useResolverCorte.jsx`): el comprobante del corte y la etiqueta de su
// bolsa — que nace sola al confirmar (trigger de `cortes_caja`). Los dos van a
// la caja de la sala por la cola; desde el teléfono no hay otro camino.
//
// Cada uno devuelve `{ ok, detalle }` y NUNCA lanza: que no salga el papel no
// deshace la firma, sólo hay que decirlo para que lo impriman desde la caja.
import { fetchCorteParaElPapel } from '@nucleo/data/cortes';
import { fetchBolsaDeCorte, fetchChequesDeBolsa, fetchOperacionDeBolsa, fetchSalidasDeBolsa, marcarEtiquetaImpresa, marcarValeImpreso } from '@nucleo/data/bolsas';
import { construirComprobanteDeCorte } from '@nucleo/utils/corteTicket';
import { construirEtiquetaDeBolsa, construirValeDeSalida, salidasParaEtiqueta } from '@nucleo/utils/bolsaComprobante';
import { construirComprobanteDeMovimiento } from '@nucleo/utils/movimientoTicket';
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

// El vale de una salida de BOLSA (`imprimirValeDeOperacion` del portal): se
// marca impreso cada renglón sólo si la cola lo recibió.
export async function valeDeLaSalida(operacionId, salaId) {
  try {
    const oper = await fetchOperacionDeBolsa(operacionId);
    if (!oper) return { ok: false, detalle: 'No se pudo traer esa salida.' };
    const vivas = (oper.lineas || []).filter((l) => !l.anulado_at);
    const r = await imprimirEnLaSala(construirValeDeSalida({
      operacion: {
        folio: oper.folio, motivo: oper.etiqueta, entidad: oper.entidad, entidadEtiqueta: oper.etiqueta_entidad,
        numero_boleta: oper.numero_boleta, monto: oper.monto, nota: oper.nota, leyenda: oper.leyenda,
      },
      lineas: vivas, sala: oper.sala || '', registradoPor: oper.registrado_nombre,
      recibidoPor: oper.recibido_nombre ? { nombre: oper.recibido_nombre, metodo: oper.recibido_metodo } : null,
      registradoAt: oper.registrado_at,
    }), salaId);
    if (r.ok) await Promise.all(vivas.map((l) => marcarValeImpreso(l.movimiento_id)));
    return { ...r, folio: oper.folio };
  } catch (e) {
    return { ok: false, detalle: e?.message ?? 'No se pudo preparar el vale.' };
  }
}

// El comprobante de una salida del CAJÓN (`imprimirMovimiento` de Mi caja).
export async function comprobanteDelMovimiento(movimiento, { etiqueta, detalle, persona, comoSeComprobo }, sala, salaNombre, hechoPor) {
  try {
    return await imprimirEnLaSala(construirComprobanteDeMovimiento({
      movimiento, etiqueta: etiqueta || '', detalle: detalle || '', persona: persona || '', comoSeComprobo: comoSeComprobo || null,
      sala: salaNombre, hechoPor, hechoAt: new Date().toISOString(),
    }), sala);
  } catch (e) {
    return { ok: false, detalle: e?.message ?? 'No se pudo preparar el comprobante.' };
  }
}
