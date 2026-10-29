/**
 * Cómo se lee un registro del historial de una sucursal: su rótulo (la
 * dimensión o la acción), su título, qué había antes y qué quedó, quién lo hizo
 * y si trae un archivo. Vivía dentro de `views/branch-tabs/TabHistory.jsx`; se
 * mudó para que la ficha de la app lo cuente igual.
 */
import { formatMoney } from './formatNumber';

const detallesDe = (item) => {
    if (typeof item?.details !== 'string') return item?.details || {};
    try { return JSON.parse(item.details); } catch { return {}; }
};

export const DIMENSIONES_DEL_HISTORIAL = [
    { value: 'LEGAL', label: 'Legal' }, { value: 'FINANCE', label: 'Finanzas' },
    { value: 'OPERATIVE', label: 'Operativo' }, { value: 'HR', label: 'Personal' }, { value: 'OTHER', label: 'Otros' },
];

/**
 * El título de cada acción que llega al historial de una sala. Sin él, un
 * registro sin `timeline_title` se pintaba «Configuración Modificada» —el
 * mismo título para un pago, un kiosco y una persona asignada—, y la acción
 * cruda (`TRASLADO_SOLICITADO`) quedaba de rótulo en mayúsculas.
 */
const TITULO_DE_ACCION = {
    APERTURA_OFICIAL: 'Apertura de la sucursal',
    EDITAR_SUCURSAL: 'Datos de la sucursal actualizados',
    ELIMINAR_SUCURSAL: 'Sucursal eliminada',
    DOC_AGREGADO: 'Documento agregado',
    PAGO_REGISTRADO: 'Pago registrado',
    RECARGA_HISTORICO_VENTAS_INICIADA: 'Recarga de ventas iniciada',
    RECARGA_HISTORICO_VENTAS_TERMINADA: 'Recarga de ventas terminada',
    VINCULAR_KIOSCO: 'Kiosco vinculado',
    REVOCAR_KIOSCO: 'Kiosco revocado',
    EMPLEADO_ASIGNADO: 'Persona asignada',
    EMPLEADO_RELEVADO: 'Persona relevada',
    EMPLEADO_DESVINCULADO_SUCURSAL: 'Persona desvinculada',
    PROMOTION: 'Cambio de cargo',
    SINCRONIZAR_VENTAS_SUCURSAL: 'Ventas actualizadas',
};

const aFrase = (accion) => {
    const t = String(accion || '').replace(/_/g, ' ').toLowerCase().trim();
    return t ? t[0].toUpperCase() + t.slice(1) : 'Registro';
};

/** El título legible de una acción del historial. */
export const tituloDeAccion = (accion) => TITULO_DE_ACCION[accion] || aFrase(accion);

/** El rótulo del registro (lo que el portal pinta en la insignia): su dimensión, en palabras. */
export function rotuloDelRegistro(item) {
    if (item?.isSynthetic) return 'Hito';
    if (item?.isDoc) return 'Archivo histórico';
    return DIMENSIONES_DEL_HISTORIAL.find((x) => x.value === dimensionDelRegistro(item))?.label || 'Otros';
}

/** La dimensión, para filtrar: LEGAL · FINANCE · OPERATIVE · HR · OTHER (o la que traiga). */
export function dimensionDelRegistro(item) {
    const d = detallesDe(item);
    if (d.dimension) return d.dimension;
    if (item?.isDoc) return 'LEGAL';
    if (item?.action === 'PAGO_REGISTRADO') return 'FINANCE';
    if (item?.action === 'EDITAR_SUCURSAL' || item?.action === 'APERTURA_OFICIAL') return 'OPERATIVE';
    if (['PERSONAL_ASIGNADO', 'EDITAR_EMPLEADO', 'ELIMINAR_EMPLEADO', 'ACCION_RRHH',
         // Los trae el historial por `details` desde 2026-10-29 (jefatura, cascada del expediente).
         'EMPLEADO_ASIGNADO', 'EMPLEADO_RELEVADO', 'EMPLEADO_DESVINCULADO_SUCURSAL'].includes(item?.action)) return 'HR';
    return 'OTHER';
}


/** Título, antes/nuevo, quién y el archivo de un registro. */
export function lecturaDelRegistro(item) {
    const d = detallesDe(item);
    let titulo = item?.name || tituloDeAccion(item?.action);
    let antes = null;
    let nuevo = d.new_value ?? null;
    if (d.timeline_title) {
        titulo = d.timeline_title; antes = d.old_value ?? null; nuevo = d.new_value ?? null;
    } else if (item?.action === 'PAGO_REGISTRADO' && d.servicio) {
        titulo = `Pago de ${d.servicio}`;
        nuevo = `Monto: ${formatMoney(d.monto)}`;
    }
    const nombre = item?.user_name || item?.actor_name || 'SISTEMA';
    const sistema = item?.isSynthetic || ['SISTEMA', 'ADMIN', 'ADMINISTRADOR'].includes(String(nombre).toUpperCase());
    return {
        titulo, antes, nuevo,
        actor: sistema ? null : { id: item?.user_id ?? null, email: item?.user_email ?? null, name: nombre },
        archivo: (item?.isDoc && item?.file_url) || d.file_url || null,
        critico: item?.severity === 'CRITICAL',
    };
}

/** El historial con la apertura de la sucursal como primer hito, lo más nuevo arriba. */
export function historialConApertura(historial, fechaApertura) {
    const lista = Array.isArray(historial) ? [...historial] : [];
    if (fechaApertura && !lista.some((i) => i.action === 'APERTURA_OFICIAL' && i.isSynthetic)) {
        const f = String(fechaApertura).includes('T') ? fechaApertura : `${fechaApertura}T08:00:00`;
        lista.push({ id: 'synthetic-opening', isSynthetic: true, sortDate: new Date(f), action: 'APERTURA_OFICIAL', name: 'Inauguración de la sucursal', actor_name: 'SISTEMA' });
    }
    return lista.sort((a, b) => b.sortDate - a.sortDate);
}
