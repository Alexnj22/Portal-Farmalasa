/**
 * Lo que se hace con un documento del expediente recién subido: dónde va, si
 * se manda a leer y qué se toma de la lectura.
 *
 * Vivía dentro de `EmployeeFormModal` (la subida de un documento). Sale al
 * núcleo para que la app del personal haga exactamente lo mismo al subir un
 * papel desde el teléfono, sin una segunda copia de las reglas:
 *
 *  · el vencimiento leído del papel (sólo si no hay uno escrito antes),
 *  · la anualidad JVPQF/JVPE al 31 de marzo (fecha fija del CSSP),
 *  · el certificado médico por AÑO CALENDARIO (`POR_ANIO_CALENDARIO`),
 *  · el número de registro de la acreditación (sólo en su casilla, y vacía),
 *  · los nombres de un papel colectivo (`COMPARTIBLES`, el acuse del MTPS).
 *
 * La usan la subida de `EmployeeFormModal` y la app del personal.
 */
import { COMPARTIBLES, SIN_VENCIMIENTO, POR_ANIO_CALENDARIO, vencimientoDelAnio, anioDelVencimiento } from './documentosDelExpediente';
import { ACREDITACIONES } from './acreditaciones';
import { getNextAnnualidadCsspDueDate } from './documentExpiry';

const ANUALIDADES_CSSP = new Set(['ANUALIDAD_JVPQF', 'ANUALIDAD_JVPE']);

/** La acreditación cuyo documento (o certificado) es esta categoría, o null. */
export const acreditacionDelDocumento = (category) =>
    ACREDITACIONES.find(a => a.doc === category || a.certificado === category) || null;

/**
 * La carpeta del bucket `documents`. Un papel colectivo va a `compartidos/`
 * (cada ficha que lo nombra apunta ahí); el resto, a la carpeta de la ficha, o
 * a `employee-documents/unassigned` en un alta (todavía no hay id).
 */
export const carpetaDelDocumento = (category, empleadoId) => (COMPARTIBLES.has(category) ? 'compartidos'
    : empleadoId ? `employees/${empleadoId}/documents` : 'employee-documents/unassigned');

/** ¿Tiene algo que leerse? (vencimiento, número de junta o nombres). */
export const hayQueLeerDocumento = (category) => !SIN_VENCIMIENTO.has(category)
    || COMPARTIBLES.has(category)
    || !!acreditacionDelDocumento(category);

/** El cuerpo para `analizarDocumento` (`@nucleo/data/ia`). `stored` = `{ path, bucket }`. */
export const pedidoDeLectura = (category, stored) => ({
    filePath: stored.path, bucketName: stored.bucket,
    // El resumen de dos líneas sólo lo muestra el expediente de SUCURSAL; en
    // la ficha nadie lo ve y era la mitad de la salida.
    sinResumen: true,
    // Los nombres SÓLO en los papeles colectivos: pedirlos en cada documento
    // agrega trabajo al modelo para una respuesta que en un carné no se usa, y
    // un campo que nadie mira es un campo que se llena mal sin que nadie lo note.
    ...(COMPARTIBLES.has(category) ? { buscarPersonas: true } : {}),
});

/**
 * El vencimiento con el que nace el archivo ANTES de leerlo: uno que reemplaza
 * a otro no hereda su fecha; la escrita antes del primer archivo, sí.
 */
export const vencimientoDeArranque = (anterior) => (anterior?.url ? null : (anterior?.expiry_date || null));

/**
 * Qué se toma de la lectura.
 *
 * @param {object} p
 * @param {string} p.category
 * @param {object} [p.anterior]  la entrada que había en `employee_documents`
 * @param {object} [p.lectura]   `{ data, error }` de `analizarDocumento` (o null si no se leyó)
 * @param {object} [p.ficha]     la ficha (o el formulario), para no pisar un número ya escrito
 * @returns {{ expiryDate: string|null, numero: { campo: string, valor: string }|null, personas: string[] }}
 */
export function resultadoDeLectura({ category, anterior, lectura, ficha }) {
    const data = lectura?.data || null;
    const error = lectura?.error || null;
    let expiryDate = vencimientoDeArranque(anterior);
    if (!error && data?.success && data.aiData?.expDate && !expiryDate && !POR_ANIO_CALENDARIO.has(category)) {
        expiryDate = data.aiData.expDate;
    }
    // El número de la acreditación también sale del papel (pedido de Talento
    // Humano: del comprobante salen «número y vencimiento»). Sólo llena lo que
    // está VACÍO, y sólo en el documento de ESA junta: el DUI sí sustituye
    // («lo legal es el documento»), esto no — y el número de una junta puesto
    // en la casilla de otra manda a verificarlo al organismo equivocado.
    let numero = null;
    const numeroLeido = data?.aiData?.numeroDeRegistro;
    if (!error && numeroLeido) {
        const acred = acreditacionDelDocumento(category);
        if (acred && !ficha?.[acred.campo]) numero = { campo: acred.campo, valor: String(numeroLeido).trim() };
    }
    // Anualidad JVPQF/JVPE: fecha límite fija del CSSP (31 de marzo, igual para
    // todos los profesionales de salud inscritos), sólo si no hay fecha escrita
    // a mano ni leída del recibo.
    if (!expiryDate && ANUALIDADES_CSSP.has(category)) expiryDate = getNextAnnualidadCsspDueDate();
    // El certificado médico vale por AÑO CALENDARIO desde el 2026-10-13
    // (decisión del usuario: «sólo tome el año, es válido para todo ese año»):
    // del papel se toma sólo el año en que se expidió. Sin fecha legible queda
    // vacío para que alguien elija el año — poner «hoy + un año» sobre un
    // certificado viejo lo daría por vigente cuando no lo está.
    if (!expiryDate && POR_ANIO_CALENDARIO.has(category)) {
        expiryDate = vencimientoDelAnio(anioDelVencimiento(data?.aiData?.issueDate)) || null;
    }
    const personas = COMPARTIBLES.has(category) && Array.isArray(data?.aiData?.personas)
        ? data.aiData.personas.filter(n => String(n || '').trim())
        : [];
    return { expiryDate, numero, personas };
}

/** El texto del aviso al terminar de repartir un documento a varios. */
export function resumenDelReparto({ asignados, pendientes, omitidos }) {
    const partes = [];
    if (asignados) partes.push(`${asignados} asignado${asignados === 1 ? '' : 's'}`);
    if (pendientes) partes.push(`${pendientes} en espera de que los registren`);
    // Lo omitido se DICE: quien ya tenía uno no recibió éste.
    const yaTenian = (omitidos || []).filter(o => o.motivo === 'ya tiene uno');
    return [partes.join(' · ') || 'Sin cambios',
        yaTenian.length ? `${yaTenian.length} ya tenía uno cargado y no se reemplazó.` : '']
        .filter(Boolean).join(' ');
}
