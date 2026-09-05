import { supabase } from '../supabaseClient';

/**
 * Descuentos por producto — lo que la venta le rebaja al renglón.
 *
 * Todo pasa por la edge function `descuentos-erp`: el sistema de la caja no
 * habla con el navegador de nadie y el permiso se cobra del lado del servidor.
 *
 * ── Las dos formas, y por qué la segunda se dice con todas las letras ─────
 * · **Porcentaje** — descuenta ese % del renglón.
 * · **Monto** — descuenta ese monto **por CADA UNIDAD**, no por venta. Medido
 *   en el sistema de la caja: `subtotal -= monto × cantidad`. Es la trampa del
 *   módulo: «$10.04» sobre dos unidades son $20.08, y el rótulo «Monto» a
 *   secas se lee como «$10.04 y ya».
 */

/**
 * El motivo que escribió la función, no el que inventa supabase-js.
 *
 * Ante cualquier código que no sea 2xx, `functions.invoke` devuelve siempre la
 * misma frase y deja el cuerpo sin abrir en `.context`. Acá los frenos
 * contestan con código —403 el permiso, 404 el que ya no existe, 502 el origen
 * que no aceptó— así que el mensaje bueno viaja por el camino que hay que leer.
 */
async function motivoDelServidor(error) {
    try {
        const cuerpo = await error?.context?.json?.();
        if (cuerpo?.error) return new Error(cuerpo.error);
    } catch { /* la respuesta no era JSON: queda el error tal cual */ }
    return error;
}

async function llamar(body) {
    const { data, error } = await supabase.functions.invoke('descuentos-erp', { body });
    if (error) throw await motivoDelServidor(error);
    return data ?? {};
}

/** Los descuentos que esta persona puede ver, con sus productos ya nombrados. */
export async function fetchDescuentos() {
    const data = await llamar({ accion: 'listar' });
    if (data.ok !== true) throw new Error(data.error || 'No se pudieron cargar los descuentos.');
    return { descuentos: data.descuentos ?? [], alcanceTodo: data.alcance_todo === true };
}

/** Uno solo, leído del formulario del origen: los valores tal cual los guarda. */
export async function fetchDescuento(id) {
    const data = await llamar({ accion: 'detalle', id: Number(id) });
    if (data.ok !== true) throw new Error(data.error || 'No se pudo cargar el descuento.');
    return data.descuento;
}

/**
 * Crea o corrige.
 *
 * Devuelve `{ ok: true }` cuando se guardó, o `{ avisos: [...] }` cuando el
 * servidor encontró algo que hay que mirar antes —un precio que quedaría bajo
 * el costo, u otro descuento que ya toma esos productos en esas fechas—. Los
 * avisos NO son un error: la pantalla los muestra y quien decide reenvía con
 * `forzar: true`. Lo que confirmó queda escrito en la bitácora.
 */
export async function guardarDescuento(payload) {
    const data = await llamar({ accion: 'guardar', ...payload });
    if (data.ok === true) return { ok: true };
    if (Array.isArray(data.avisos) && data.avisos.length) return { avisos: data.avisos };
    throw new Error(data.error || 'No se pudo guardar el descuento.');
}

/** Borra. El origen no tiene «apagar»: o se mueve la fecha de fin, o se borra. */
export async function borrarDescuento(id) {
    const data = await llamar({ accion: 'borrar', id: Number(id) });
    if (data.ok !== true) throw new Error(data.error || 'No se pudo borrar el descuento.');
    return true;
}

/**
 * Agrega o quita productos de los descuentos de una promoción.
 *
 * Se manda la DELTA —qué cambió—, no la lista final: la buena la arma el
 * servidor releyendo el descuento en el momento de escribirlo. Entre que la
 * pantalla se cargó y alguien apretó, otra persona pudo agregarle un producto
 * desde el sistema de ventas, y mandar la lista entera se lo llevaría por
 * delante sin dar error.
 *
 * Devuelve `{ cambiados, sin_cambio, sin_productos }`. `sin_productos` son los
 * descuentos que quedarían vacíos: NO se borran solos —borrar es irreversible y
 * sería un efecto secundario de haber quitado un producto—, se nombran para que
 * quien decide vaya a quitarlos.
 */
export async function sincronizarProductosDelDescuento(promocionId, { agregar = [], quitar = [] }) {
    const data = await llamar({
        accion: 'sincronizar_productos',
        promocion_id: Number(promocionId),
        agregar: agregar.map(Number),
        quitar: quitar.map(Number),
    });
    if (data.ok !== true) throw new Error(data.error || 'No se pudo actualizar el descuento.');
    return data;
}

/**
 * Precio y costo de unos productos, para mostrar en qué queda el precio MIENTRAS
 * se arma el descuento.
 *
 * El servidor vuelve a comprobarlo al guardar —esto es para ver, no para
 * decidir—, pero verlo antes es lo que evita el error: un 60 % se escribe igual
 * de rápido que un 25 %, y sólo el precio resultante dice cuál de los dos vende
 * a pérdida.
 *
 * Devuelve `{ id, nombre, precio, costo_con_iva }`. El costo llega YA con IVA:
 * `vineta` es el precio al público y la columna `costo` es el precio neto de la
 * factura de compra, así que crudos no se pueden comparar.
 */
export async function fetchPreciosDeProductos(ids) {
    const lista = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!lista.length) return [];
    const { data, error } = await supabase.rpc('get_precios_para_descuento', { p_ids: lista });
    if (error) throw error;
    return data ?? [];
}
