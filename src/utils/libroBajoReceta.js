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

export function csvDelLibroBajoReceta(renglones, { clase = null, sucursalNombre = '', periodo = '' } = {}) {
    const rows = [...(renglones || [])]
        .sort((a, b) => a.folio - b.folio)
        .map((r) => [
            r.folio_txt, r.fecha, hora12(r.hora),
            r.producto_nombre, r.laboratorio || '', r.lote || '', r.vence || '',
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
