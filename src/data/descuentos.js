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
    /* Los que no se pudieron leer o escribir no se callan: antes la respuesta
       decía «listo» aunque uno no se hubiera tocado. */
    const fallidos = Array.isArray(data.fallidos) ? data.fallidos : [];
    if (fallidos.length) {
        const cuales = fallidos.map((f) => `«${f.descripcion}»: ${f.error}`).join(' ');
        const hechos = (data.cambiados ?? []).length;
        throw new Error(`${hechos ? `Se actualizaron ${hechos}, pero no` : 'No'} se pudo actualizar ${fallidos.length === 1 ? 'un descuento' : `${fallidos.length} descuentos`}. ${cuales}`);
    }
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

/**
 * Lo que la oferta de la app toma de un descuento: fechas, salas, tipo, monto
 * y los productos con precio antes y después, sin los de receta. Después la
 * mantiene al día `descuentos-erp` (`_shared/ofertaDeDescuento.ts`).
 */
export async function fotoParaApp(id) {
    const data = await llamar({ accion: 'foto_para_app', id: Number(id) });
    if (data.ok !== true) throw new Error(data.error || 'No se pudo leer el descuento.');
    return data.foto;
}

/**
 * Los descuentos de una promoción (para reactivarla y mover también su
 * descuento). La web y la app reactivan con lo mismo.
 *
 * Salen de la COPIA de la caja (`promocion_descuentos`), en una sola llamada:
 * antes se pedía cada uno a la caja, con su login, sólo para mostrarlo. La
 * escritura (`moverDescuentosA`) igual relee la caja antes de tocar nada, así
 * que lo que se muestra no decide lo que se escribe. Uno ligado que la copia
 * todavía no tiene se pide a la caja como antes; uno que la copia sabe borrado
 * no se ofrece.
 *
 * Trae los LIGADOS y, además, los que todavía no lo están pero son de ella
 * (2026-11-10, Rinokem). Quién es de quién lo dice la base, con el mismo juez
 * que el cron que liga solo. Cada uno vuelve con:
 *   · `ligado` — ya era de la promoción;
 *   · `candidatas` — en cuántas promociones encaja uno sin ligar. Con más de
 *     una, la pantalla no lo marca sola: que decida quien mira.
 */
export async function fetchDescuentosDePromocion(promocionId) {
    const { data, error } = await supabase.rpc('promocion_descuentos', { p_id: Number(promocionId) });
    if (error) throw error;
    const filas = /** @type {any[]} */ (data) ?? [];
    return Promise.all(filas
        .filter((d) => !d.borrado)
        .map((d) => {
            const extra = { ligado: d.ligado === true, candidatas: Number(d.candidatas) || 1 };
            if (!d.en_copia) return fetchDescuento(d.id).then((x) => ({ ...x, ...extra }));
            return {
                id: Number(d.id), descripcion: d.descripcion, tipo: d.tipo, monto: Number(d.monto),
                inicio: d.inicio, fin: d.fin, todas_las_salas: d.todas_las_salas === true,
                branch_id: d.branch_id ?? null, productos: d.productos ?? [], ...extra,
            };
        }));
}

/**
 * Liga un descuento a su promoción. La base sólo acepta lo que su juez propone
 * (`NO_CORRESPONDE` si no): no es una puerta para ligar cualquier cosa.
 */
async function ligarDescuentoAPromocion(promocionId, descuentoId) {
    const { data, error } = await supabase.rpc('ligar_descuento_a_promocion', {
        p_promocion: Number(promocionId), p_descuento: Number(descuentoId),
    });
    if (error) throw error;
    return data;
}

/**
 * Mueve el fin de varios descuentos y devuelve los que NO entraron, con su
 * motivo (`avisos` del origen o `error`). Uno que falla no frena a los demás:
 * cada uno es una escritura aparte. Sólo se fuerza lo que ya mostró avisos y
 * quien aprieta leyó; un reintento por error de red vuelve a pasar por los
 * avisos. `mensaje(e)` traduce el error para la pantalla.
 *
 * Con `promocionId`, el que todavía no estaba ligado (`ligado: false`) se liga
 * DESPUÉS de moverlo —también si ya llegaba a esa fecha y no hubo que
 * moverlo—, para que la próxima vez la promoción lo conozca sola. Un vínculo
 * que falla no deshace el movimiento ni se presenta como falla del precio: lo
 * recupera el cron que liga solo.
 */
export async function moverDescuentosA(lista, fin, mensaje = (e) => e?.message || 'No se pudo mover el descuento.', { promocionId = null } = {}) {
    const pedidos = (lista || []).filter((d) => d?.id);
    if (!pedidos.length) return [];
    let resultados;
    try {
        /* UNA llamada para todos (`mover_fin`): el servidor lee la lista una
           vez, relee cada descuento justo antes de escribirlo y confirma al
           final. Antes eran dos llamadas por descuento, cada una con su login. */
        const data = await llamar({
            accion: 'mover_fin',
            fin,
            promocion_id: promocionId ? Number(promocionId) : null,
            items: pedidos.map((d) => ({ id: Number(d.id), forzar: !!d.avisos })),
        });
        if (data.ok !== true) throw new Error(data.error || 'No se pudo mover el descuento.');
        resultados = new Map((data.resultados ?? []).map((r) => [Number(r.id), r]));
    } catch (e) {
        // Si la llamada entera falló, faltan todos, con el mismo motivo.
        const texto = mensaje(e);
        return pedidos.map((d) => ({ ...d, avisos: undefined, error: texto }));
    }

    const quedan = [];
    for (const d of pedidos) {
        const r = resultados.get(Number(d.id));
        if (!r) { quedan.push({ ...d, avisos: undefined, error: mensaje(new Error('La caja no contestó por este descuento.')) }); continue; }
        if (Array.isArray(r.avisos) && r.avisos.length) {
            quedan.push({ ...d, avisos: r.avisos.map((a) => a.texto), error: undefined });
            continue;
        }
        if (r.error) { quedan.push({ ...d, avisos: undefined, error: mensaje(new Error(r.error)) }); continue; }
        if (promocionId && d.ligado === false) {
            await ligarDescuentoAPromocion(promocionId, d.id).catch((e) => {
                console.error('[descuentos] ligar a la promoción:', e?.message ?? e);
            });
        }
    }
    return quedan;
}

/**
 * Las rebajas de las ventas de un período, separadas en «de campaña» y «a
 * mano» (PENDIENTES 30). La factura no trae el descuento del renglón: la base
 * lo cruza con la copia de las campañas (`descuentos_espejo`). Hasta 92 días
 * por llamada; `branchId` null = las salas que el permiso deja ver.
 */
export async function fetchRebajasEnVentas({ desde, hasta, branchId = null }) {
    const { data, error } = await supabase.rpc('rebajas_en_ventas', {
        p_desde: desde, p_hasta: hasta, p_branch_id: branchId ? Number(branchId) : null,
    });
    if (error) throw error;
    const d = /** @type {any} */ (data);
    return {
        resumen: d?.resumen ?? { campana: { renglones: 0, monto: 0 }, a_mano: { renglones: 0, monto: 0 } },
        porCampana: d?.por_campana ?? [],
        aMano: d?.a_mano ?? [],
    };
}
