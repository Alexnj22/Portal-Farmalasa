// Clientes Mayoristas — las reglas de la pantalla, escritas UNA vez para el
// portal (`views/mayoristas/MayoristasView.jsx`) y la app
// (`apps/mobile/app/mayoristas.js`): qué entra en cada pestaña, cómo se ordena,
// cómo se lee una línea del historial y qué puede hacer cada quien con un
// cliente. Vivían dentro de la vista del portal (2026-10-12).
import { tokenMatch } from './searchUtils';

/** Los nombres de precio (`PRECIOS` de `data/mayoristas`), repetidos acá para no importar datos desde utils. */
const PRECIO = { mayoreo: 'Mayoreo', mayoreo_plus: 'Mayoreo Plus' };

/** Una línea del historial en palabras. */
export const textoDeAccion = (h) => ({
    solicitado: 'Lo pidió desde la app',
    propuesto: `Propuesto${h.precio ? ` con ${PRECIO[h.precio]}` : ''}`,
    aprobado: `Aprobado${h.precio ? ` con ${PRECIO[h.precio]}` : ''}`,
    rechazado: 'Rechazado',
    precio_cambiado: `Precio cambiado a ${PRECIO[h.precio] ?? '—'}`,
    retiro_avisado: 'Retiro avisado',
}[h.accion] ?? h.accion);

export const ORDENES_MAYORISTAS = [
    { value: 'mayoreo', label: 'Más compra a mayoreo' },
    { value: 'promedio', label: 'Mayor promedio mensual' },
    { value: 'reciente', label: 'Compra más reciente' },
];

/** Las solicitudes por resolver (el número de la pestaña). */
export const solicitudesPendientes = (filas) => (filas ?? []).filter((f) => f.estado === 'solicitado');

/**
 * Lo que muestra una pestaña: «solicitudes», «mayoristas» o «candidatos» (los
 * que no son ni lo pidieron; con `soloCumplen`, sólo los que cumplen la
 * cláusula 2.3), con búsqueda por nombre o documento y el orden elegido.
 */
export function filasDeMayoristas(filas, { tab, busqueda = '', soloCumplen = true, orden = 'mayoreo' } = {}) {
    return (filas ?? [])
        .filter((f) => (tab === 'solicitudes' ? f.estado === 'solicitado'
            : tab === 'mayoristas' ? f.estado === 'aprobado'
                : f.estado !== 'aprobado' && f.estado !== 'solicitado' && (!soloCumplen || f.cumple)))
        .filter((f) => !busqueda || tokenMatch(`${f.nombre ?? ''} ${f.documento ?? ''}`, busqueda))
        .sort((a, b) => (orden === 'promedio' ? b.prom_3m - a.prom_3m
            : orden === 'reciente' ? String(b.ultima_compra ?? '').localeCompare(String(a.ultima_compra ?? ''))
                : b.a_mayoreo - a.a_mayoreo));
}

/**
 * Qué se puede hacer con un cliente: proponerlo (si no es ni lo pidió, o lo
 * rechazaron o se retiró), resolver su solicitud (quien la hizo no puede: lo
 * frena también la base) o gestionarlo (cambiar precio o retirar) si ya es
 * mayorista y no tiene un retiro avisado.
 */
export function accionesDeMayorista(cliente, { puedeProponer, puedeAprobar, userId }) {
    const est = cliente?.estado;
    const esSolicitante = !!(cliente?.solicitado_por_id && userId && cliente.solicitado_por_id === userId);
    return {
        esSolicitante,
        proponer: !!puedeProponer && (!est || est === 'rechazado' || est === 'retirado'),
        resolver: !!puedeAprobar && est === 'solicitado' && !esSolicitante,
        gestionar: !!puedeAprobar && est === 'aprobado' && !cliente?.retiro_programado,
    };
}
