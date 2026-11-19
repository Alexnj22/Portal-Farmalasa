// El CSV del libro bajo receta (o de antibióticos), escrito UNA vez para el
// portal (`TabBajoReceta`) y la app (`libro-receta`).
//
// El orden del archivo es por FOLIO ascendente, siempre — aunque la pantalla
// esté ordenada por otra columna. Un libro foliado se lee en el orden de sus
// folios, y un archivo que sale en el orden en que alguien dejó la tabla no se
// puede cotejar contra el papel.
import { CLASE_ANTIBIOTICO, ESTADO_RENGLON } from '../data/bitacoras';
import { hora12 } from './hora';

export const CABECERA_LIBRO_BAJO_RECETA = ['FOLIO', 'FECHA', 'HORA', 'MEDICAMENTO', 'LABORATORIO', 'LOTE', 'VENCE',
    'CANTIDAD DISPENSADA', 'CANTIDAD PRESCRITA', 'PACIENTE', 'PRESCRIPTOR',
    'N JUNTA', 'RECETA', 'COPIA DE RECETA', 'DOCUMENTO', 'DESPACHO',
    'ESTADO', 'MOTIVO DE ANULACION'];

/**
 * El vencimiento del inventario es de MES: 6,735 de 6,760 lotes traen el día 1,
 * que es la forma de guardar el «11/2026» impreso en la caja. Un día 1 vale como
 * el último día de su mes; cualquier otro día, tal cual. Gemelo de
 * `public.vence_efectivo` — cambiar uno exige cambiar el otro.
 */
export function venceEfectivo(fecha) {
    if (!fecha || typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(fecha)) return fecha || null;
    const [y, m, d] = fecha.slice(0, 10).split('-').map(Number);
    if (d !== 1) return fecha.slice(0, 10);
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
}

/** ¿Se entregó vencido? Con la regla del mes. */
export const vencidoAlVender = (vence, fecha) => Boolean(vence && fecha && venceEfectivo(vence) < String(fecha).slice(0, 10));

/**
 * ¿El lote escrito son dos lotes en uno (o «GENERICO»)? Mismo juez que la base
 * (`libro_lote_motivo`): un lote por fila. Lo usan el portal y la app al
 * corregir el lote del libro (PENDIENTES 22).
 */
export const loteFundido = (lote) => {
    const l = String(lote ?? '');
    return /_/.test(l) || /\d{5,}\s*[-/, ]\s*\d{5,}/.test(l) || l.trim().toUpperCase() === 'GENERICO';
};

/**
 * Lo que falta para poder guardar la corrección del lote, en el orden de las
 * condiciones del botón y con el campo al que lleva, o null si está listo.
 * `partes`: [{ lote, vence, cantidad }] como se escriben en el formulario.
 */
export function queFaltaAlCorregirLote({ partes, cantidad, vendidoVencido, fechaVenta }) {
    const fmt = (v) => (v === null || v === undefined ? '—' : String(Number(v)));
    for (let k = 0; k < partes.length; k++) {
        const p = partes[k];
        const deCual = partes.length > 1 ? ` (lote ${k + 1})` : '';
        if (!String(p.lote ?? '').trim()) return { texto: `Escribe el lote${deCual}.`, campo: `lote-${k}` };
        if (loteFundido(p.lote)) return { texto: `Escribe un solo lote por fila${deCual}.`, campo: `lote-${k}` };
        if (!p.vence) return { texto: `Elige el vencimiento${deCual}.`, campo: `vence-${k}` };
        if (!(Number(p.cantidad) > 0)) return { texto: `Escribe la cantidad${deCual}.`, campo: `cantidad-${k}` };
    }
    const suma = partes.reduce((s, p) => s + (Number(p.cantidad) || 0), 0);
    if (Math.abs(suma - Number(cantidad)) >= 1e-9) {
        return { texto: `Las cantidades suman ${fmt(suma)} y se entregaron ${fmt(cantidad)}.`, campo: `cantidad-${partes.length - 1}` };
    }
    const algunaVencida = partes.some(p => vencidoAlVender(p.vence, fechaVenta));
    if (algunaVencida && !vendidoVencido) return { texto: 'Revisa el vencimiento o marca que se entregó vencido.', campo: 'vendidoVencido' };
    if (!algunaVencida && vendidoVencido) return { texto: 'Desmarca «Sí, se entregó vencido»: ningún vencimiento es anterior a la venta.', campo: 'vendidoVencido' };
    return null;
}

/**
 * El lote que el libro DICE de un renglón: el corregido por la sala si lo hay
 * (`lote_revision`, PENDIENTES 22), y si no el que trajo la venta. Una venta
 * que salió de dos lotes se escribe con la cantidad de cada uno al lado.
 * El original no se pierde: vive en `r.lote` y en la revisión.
 */
export function loteDelRenglon(r) {
    const rv = r?.lote_revision;
    const partes = Array.isArray(rv?.partes) ? rv.partes : [];
    if (rv && (rv.estado === 'corregida' || rv.estado === 'confirmada') && partes.length) {
        const varias = partes.length > 1;
        return {
            lote: partes.map(p => (varias ? `${p.lote} (${Number(p.cantidad)})` : p.lote)).join(' / '),
            vence: partes.map(p => p.vence).join(' / '),
            corregido: true,
            confirmado: rv.estado === 'confirmada',
            porRevisar: false,
        };
    }
    return { lote: r?.lote || '', vence: r?.vence || '', corregido: false, confirmado: false, porRevisar: Boolean(rv) };
}

export function csvDelLibroBajoReceta(renglones, { clase = null, sucursalNombre = '', periodo = '' } = {}) {
    const rows = [...(renglones || [])]
        .sort((a, b) => a.folio - b.folio)
        .map((r) => [r, loteDelRenglon(r)])
        .map(([r, l]) => [
            r.folio_txt, r.fecha, hora12(r.hora),
            r.producto_nombre, r.laboratorio || '', l.lote, l.vence,
            r.cantidad, r.prescrito ?? '', r.paciente || '', r.medico || '',
            r.numero_junta || '', r.receta_correlativo || '',
            r.tiene_foto ? 'SI' : 'NO', r.correlativo_doc || '',
            r.vendedor || '', ESTADO_RENGLON[r.estado]?.label || r.estado,
            r.motivo_anulacion || '',
        ]);
    const nombre = `libro-${clase === CLASE_ANTIBIOTICO ? 'antibioticos' : 'bajo-receta'}-${
        (sucursalNombre || 'sala').toLowerCase().replace(/\s+/g, '-')}-${periodo || 'periodo'}`;
    return { headers: CABECERA_LIBRO_BAJO_RECETA, rows, nombre };
}
