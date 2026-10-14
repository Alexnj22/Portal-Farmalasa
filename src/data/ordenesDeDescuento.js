/**
 * Órdenes de descuento de un empleado (préstamos que la empresa descuenta de
 * planilla y paga al banco). Ver `ordenes_descuento` y la función
 * `leer-orden-de-descuento`.
 */
import { supabase } from '../supabaseClient';
import { subirArchivo } from '../utils/storageFiles';
import { aBase64Reducido } from '@plataforma/fotoParaLeer';

const COLUMNAS = ['banco', 'referencia', 'monto_prestamo', 'tasa_interes', 'cuota', 'periodicidad',
    'plazo_cuotas', 'fecha_inicio', 'fecha_fin', 'estado', 'archivos', 'nombre_en_documento', 'notas'];

/** @param {string} employeeId */
export async function fetchOrdenes(employeeId) {
    const { data, error } = await supabase.from('ordenes_descuento')
        .select('*').eq('employee_id', employeeId)
        .order('fecha_inicio', { ascending: false, nullsFirst: false });
    if (error) throw error;
    return data || [];
}

/**
 * Lee las fotos del documento. Viajan reducidas e INLINE: no hace falta
 * subirlas para leerlas, y así un intento descartado no deja basura.
 * @param {File[]} archivos
 */
export async function leerOrden(archivos) {
    const imagenes = [];
    for (const a of (archivos || []).slice(0, 4)) {
        imagenes.push({ data: await aBase64Reducido(a), mimeType: a.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg' });
    }
    const { data, error } = await supabase.functions.invoke('leer-orden-de-descuento', { body: { imagenes } });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'No se pudo leer el documento.');
    return data.leido;
}

/** Sube una foto a la carpeta del empleado; devuelve `{ url, file_name }`. */
export async function subirFotoDeOrden(employeeId, archivo) {
    const limpio = String(archivo?.name || 'orden').replace(/[^\w.-]+/g, '_');
    const url = await subirArchivo('documents', `employees/${employeeId}/ordenes-descuento/${Date.now()}_${limpio}`, archivo);
    return { url, file_name: archivo.name };
}

const limpiar = (orden) => {
    const fila = {};
    for (const k of COLUMNAS) {
        if (!(k in orden)) continue;
        const v = orden[k];
        fila[k] = v === '' ? null : v;
    }
    return fila;
};

/** `creado_por` lo pone la base (`auth_employee_id()`): el navegador conoce la
 *  CUENTA, no la ficha, y para la mayoría no son el mismo id. */
export async function guardarOrden(employeeId, orden) {
    const fila = { ...limpiar(orden), updated_at: new Date().toISOString() };
    const q = orden.id
        ? supabase.from('ordenes_descuento').update(fila).eq('id', orden.id).select().maybeSingle()
        : supabase.from('ordenes_descuento').insert({ ...fila, employee_id: employeeId }).select().maybeSingle();
    const { data, error } = await q;
    if (error) throw error;
    // Sin policy que lo deje, la escritura devuelve cero filas sin error.
    if (!data) throw new Error('No se guardó: hace falta permiso de edición en Personal.');
    return data;
}

export async function borrarOrden(id) {
    const { error, count } = await supabase.from('ordenes_descuento').delete({ count: 'exact' }).eq('id', id);
    if (error) throw error;
    if (!count) throw new Error('No se borró: hace falta permiso de edición en Personal.');
}
