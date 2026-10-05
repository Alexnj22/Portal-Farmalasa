/**
 * La bitácora del sistema (`audit_logs`) — qué registros se ven con los
 * filtros y cómo se ordenan. Vivía en `AuditView`; se mudó el 2026-10-05 para
 * que la app filtre igual.
 *
 * El día de un registro es el de El Salvador (`diaSV`), NO el del UTC: con
 * `toISOString()`, lo que pasó después de las 6 p. m. caía en el día
 * siguiente y desaparecía del filtro «hoy». Así estuvo hasta el 2026-10-05.
 */
import { diaSV } from './fecha';

export const ACCIONES_DE_BITACORA = [
    { value: 'ALL', label: 'Todas' },
    { value: 'REGISTRO_ASISTENCIA', label: 'Asistencias' },
    { value: 'CREAR_EMPLEADO', label: 'Creaciones' },
    { value: 'EDITAR_EMPLEADO', label: 'Ediciones' },
    { value: 'ELIMINAR_EMPLEADO', label: 'Eliminaciones' },
];

export function filtrarBitacora(logs, { accion = 'ALL', desde = '', hasta = '' } = {}) {
    return (logs || []).filter((log) => {
        if (accion !== 'ALL' && log.action !== accion) return false;
        if (desde || hasta) {
            const dia = diaSV(log.created_at);
            if (desde && dia < desde) return false;
            if (hasta && dia > hasta) return false;
        }
        return true;
    });
}

/** Ordena por una columna; la fecha como instante y lo demás como texto sin mayúsculas. */
export function ordenarBitacora(logs, { key = 'created_at', direction = 'desc' } = {}) {
    const valor = (l) => (key === 'created_at' ? new Date(l.created_at || 0).getTime() : String(l[key] || '').toLowerCase());
    return [...(logs || [])].sort((a, b) => {
        const x = valor(a), y = valor(b);
        if (x < y) return direction === 'asc' ? -1 : 1;
        if (x > y) return direction === 'asc' ? 1 : -1;
        return 0;
    });
}

/** La severidad de un registro, como variante de `Badge`. */
export const varianteDeSeveridad = (s) => (s === 'CRITICAL' ? 'danger' : s === 'WARNING' ? 'warning' : 'info');

/** De dónde vino el registro, en palabras. */
export const ROTULO_DE_ORIGEN = { KIOSK: 'Kiosco', SYSTEM: 'Sistema', ADMIN_PANEL: 'Portal' };
