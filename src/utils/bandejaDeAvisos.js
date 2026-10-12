// Cómo se ordena la bandeja de avisos (2026-10-12). Reporte del usuario: «me
// aparecen como 2 secciones por decidir y abajo avisos sin leer».
//
// La causa: «Por decidir» se arma con lo que la persona tiene que contestar
// (solicitudes, ajustes de Mín·Máx, traslados, envíos — `porDecidir`), y DEBAJO
// se listaban los avisos sin leer, que incluyen el aviso de cada una de esas
// mismas solicitudes con su propio Aprobar / Rechazar. Medido en producción:
// seis ajustes de Mín·Máx salían dos veces cada uno.
//
// La regla: lo que espera una decisión va UNA vez, arriba. Si ya está en «Por
// decidir», su aviso no se repite; si no está (otra fuente, otro alcance), el
// aviso mismo sube a esa sección. Lo demás son avisos: primero los sin leer,
// después los que ya se decidieron (quedan a la vista con su sello).
import { claveDeDecision } from './accionesDeAviso';

/**
 * @param {object[]} avisos       las notificaciones cargadas
 * @param {object[]} porDecidir   los elementos de «Por decidir» (con `clave`)
 * @param {(n) => boolean} esperaDecision  `avisoEsperaDecision` ya con permisos
 */
export function ordenarBandeja(avisos = [], porDecidir = [], esperaDecision = () => false) {
    const claves = new Set(porDecidir.map((i) => String(i.clave)));
    const pendientes = [];
    const sinLeer = [];
    const decididos = [];
    for (const n of avisos) {
        if (n.deleted_at) continue;
        if (esperaDecision(n)) {
            if (!claves.has(claveDeDecision(n))) pendientes.push(n);
            continue;
        }
        (n.read_at ? decididos : sinLeer).push(n);
    }
    return { pendientes, sinLeer, decididos, totalPorDecidir: porDecidir.length + pendientes.length };
}
