// Cómo se lee un traslado: la fecha y el resumen de lo que se pide.
//
// Aparte de `FilasTraslado.jsx` porque son funciones puras y ese archivo
// exporta componentes: mezclarlos rompe el fast refresh de Vite (lo dice
// `react-refresh/only-export-components`, y con razón — un archivo que exporta
// las dos cosas se recarga entero en cada tecla).

import { hora12 } from './hora';
import { fechaTexto } from './fecha';

export const fmtCuando = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const hoy = new Date();
    const mismoDia = d.toDateString() === hoy.toDateString();
    return mismoDia
        ? hora12(d)
        : d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
};

// Sus tres usos son vencimientos de lote, que vienen como fecha sin hora
// ('2027-11-01'). Leída como UTC y pintada en hora local retrocedía un día —y
// con el día 01, que es el caso de casi todas, retrocedía un MES: «31 oct 27»
// por un lote que vence el 1 de noviembre. Se le pasa el DÍA como texto a
// `fechaTexto`, que no lo convierte de huso — igual que `fmtVence` en
// `pedidoPdfDoc.js`. Armarlo en hora local del aparato fallaba en cualquiera
// que no estuviera en hora de El Salvador.
export const fmtFechaLarga = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return '';
    const dos = (n) => String(n).padStart(2, '0');
    return fechaTexto(`${y}-${dos(m)}-${dos(d)}`, { day: '2-digit', month: 'short', year: '2-digit' });
};

/** Lo que se pide, en una línea legible. */
export function resumenItems(meta) {
    const items = Array.isArray(meta?.items) ? meta.items : [];
    if (items.length === 0) return 'Sin detalle';
    if (items.length === 1) {
        const i = items[0];
        return `${i.cantidad} ${i.presentacion_tipo} · ${i.descripcion ?? i.erp_product_id}`;
    }
    return `${items.length} productos · ${meta?.total_unidades ?? 0} unidades`;
}

/**
 * Lo mismo que `resumenItems`, pero PARTIDO en sus dos mitades.
 *
 * `resumenItems` devuelve una sola línea —«6 UNIDAD · CREMA COMBINADA X 20 GR»—
 * y sirve donde hay un renglón y nada más: una celda de tabla, un aviso. En una
 * tarjeta esa línea es el problema: el nombre del producto es lo que distingue
 * una de la de al lado, y va detrás de una cuenta que se repite en todas.
 *
 * Se arma desde `meta.items`, la MISMA fuente, y no cortando el texto que
 * devuelve la otra: partir por el « · » se rompería el día que una descripción
 * traiga uno.
 *
 * Devuelve `null` cuando no hay detalle, para que quien la use caiga a
 * `resumenItems` en vez de pintar un hueco.
 */
export function piezasDe(meta) {
    const items = Array.isArray(meta?.items) ? meta.items : [];
    if (items.length === 0) return null;
    if (items.length === 1) {
        const i = items[0];
        return {
            cuenta: `${i.cantidad} ${i.presentacion_tipo ?? ''}`.trim(),
            // La cuenta partida en dos: el NÚMERO es el ancla de la tarjeta y la
            // unidad su pie de foto. Juntos en una cadena obligaban a la tarjeta
            // a pintarlos con el mismo peso, que es lo que hacía que «10 CAJA»
            // pesara igual que todo lo demás y nada anclara la mirada.
            numero: String(i.cantidad ?? ''),
            unidad: String(i.presentacion_tipo ?? '').trim() || 'unidad',
            nombre: i.descripcion ?? String(i.erp_product_id ?? 'Sin nombre'),
        };
    }
    // Con varios no hay UN nombre que mostrar, así que el ancla pasa a ser
    // cuántos productos son, y la cuenta, las unidades que suman.
    const unidades = meta?.total_unidades ?? 0;
    return {
        cuenta: `${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`,
        numero: String(items.length),
        unidad: items.length === 1 ? 'producto' : 'productos',
        nombre: `${items.length} productos`,
        varios: true,
        unidades,
    };
}

/**
 * Los lotes que el pedido pide, si los trae.
 *
 * Desde el 2026-08-07 quien pide puede elegir de qué lote quiere que salga —y
 * descartar el que vence demasiado pronto— y esa elección MANDA (decisión del
 * usuario). Que quien despacha los vea es la mitad que la hace mandar: un lote
 * elegido que no llega a la pantalla de enfrente es un lote que no se respeta.
 *
 * Los pedidos anteriores no traen `lotes` y devuelven una lista vacía: se ven
 * como siempre, sin un hueco ni un «—» que sugiera que falta algo.
 */
export function lotesPedidos(meta) {
    return (Array.isArray(meta?.items) ? meta.items : [])
        .flatMap(i => (Array.isArray(i.lotes) ? i.lotes : []))
        .filter(l => l && (l.lote || l.vence));
}

/** El texto sobre el que busca la vista: producto, salas, quién y por qué. */
export function textoBuscable(fila, nombrePor) {
    const m = fila?.metadata ?? {};
    const items = Array.isArray(m.items) ? m.items : [];
    return [
        ...items.map(i => i.descripcion ?? ''),
        m.origen_branch_name ?? '',
        m.branch_name ?? '',
        m.rejection_reason ?? '',
        fila?.note ?? '',
        nombrePor?.(fila?.employee_id) ?? '',
    ].join(' ');
}

/**
 * Lo que trae la caja, PRODUCTO por producto y con sus lotes adentro.
 *
 * `lotesPedidos` aplana: saca los lotes de todos los renglones y los junta en
 * una sola lista. Con UN producto eso alcanza —el nombre está en el título—,
 * pero con varios la lista queda sin dueño: cinco lotes seguidos no dicen cuál
 * es de cuál. En el traslado que lo destapó (5 productos, Bodega → Salud 5, el
 * 20-ago) dos de los cinco eran «BRONCODINE FLUX», uno jarabe y otro gotas —o
 * sea que el lote suelto no sólo no ayudaba: se podía cotejar contra el
 * producto equivocado y darlo por bueno.
 *
 * Quien recibe tiene la caja en la mano y es el único que puede comprobar que
 * llegó lo que se pidió. Esta es la lista contra la que lo hace.
 */
export function renglonesDe(meta) {
    return (Array.isArray(meta?.items) ? meta.items : []).map((i, idx) => ({
        idx,
        nombre: i.descripcion ?? `#${i.erp_product_id ?? '?'}`,
        cantidad: Number(i.cantidad) || 0,
        presentacion: i.presentacion_tipo ?? '',
        lotes: (Array.isArray(i.lotes) ? i.lotes : []).filter(l => l && (l.lote || l.vence)),
    }));
}

/* Las líneas del despacho que son de ESTE renglón, o `null` si no se puede
 * saber: el detalle guarda el producto y no la posición, así que con el mismo
 * producto en dos renglones (dos presentaciones) no hay cómo repartirlo. Es la
 * misma regla que `loQueLlego` y que la función que recibe. */
function lineasDelRenglon(items, idx, detalle) {
    const id = Number(items[idx]?.erp_product_id);
    const repetido = items.filter(i => Number(i?.erp_product_id) === id).length > 1;
    if (repetido) return null;
    return detalle.filter(d => Number(d?.erp_product_id) === id);
}

/**
 * El lote de cada renglón de un traslado, para la trazabilidad: idx → lista de
 * `{ lote, vence, unidades, fuente }`.
 *
 * Reportado con captura (2026-11-05): el detalle de la solicitud mostraba
 * producto y cantidad pero NO el lote, aunque estaba guardado. Vive en tres
 * sitios de la `metadata`, y se toma el más fuerte que haya:
 *
 *   1. `salio`    — `erp_traslado.detalle[].numero_lote`: lo que el sistema
 *                   movió de verdad. Es la respuesta a «¿qué lote viajó?».
 *   2. `apartado` — `lotes_asignados[idx]`: el que quien despacha apartó
 *                   (o el de la caja, cuando salió sin lote).
 *   3. `pedido`   — `items[idx].lotes`: el que eligió quien pidió.
 *
 * El detalle no guarda el vencimiento: se cruza con el apartado por
 * `id_lote_erp` o por número, y si no coincide se deja en `null` — un
 * vencimiento de OTRO lote al lado de éste sería un dato falso de trazabilidad.
 * Una línea que salió sin número dice `lote: null` («sin lote»), no hereda el
 * del pedido: el pedido pudo ser un genérico con otro vencimiento.
 */
export function lotesPorRenglon(meta) {
    const items = Array.isArray(meta?.items) ? meta.items : [];
    const detalle = Array.isArray(meta?.erp_traslado?.detalle) ? meta.erp_traslado.detalle : [];
    const asignados = (meta?.lotes_asignados && typeof meta.lotes_asignados === 'object')
        ? meta.lotes_asignados : {};
    const out = new Map();

    items.forEach((item, idx) => {
        const asignado = asignados[idx] ?? asignados[String(idx)] ?? null;
        const pedidos = (Array.isArray(item?.lotes) ? item.lotes : []).filter(l => l && (l.lote || l.vence));

        const suyas = detalle.length > 0 ? lineasDelRenglon(items, idx, detalle) : null;
        if (suyas && suyas.length > 0) {
            out.set(idx, suyas.map(d => {
                const lote = d?.numero_lote ? String(d.numero_lote) : null;
                const coincide = asignado && (
                    (d?.id_lote_erp && String(asignado.id_lote_erp ?? '') === String(d.id_lote_erp))
                    || (lote && String(asignado.lote ?? '') === lote));
                const pedido = lote ? pedidos.find(l => String(l.lote ?? '') === lote) : null;
                return {
                    lote,
                    vence: (coincide ? asignado.vence : null) ?? pedido?.vence ?? null,
                    unidades: Number(d?.cantidad) || 0,
                    fuente: 'salio',
                };
            }));
            return;
        }
        if (asignado && (asignado.lote || asignado.vence)) {
            out.set(idx, [{
                lote: asignado.lote ? String(asignado.lote) : null,
                vence: asignado.vence ?? null,
                unidades: Number(asignado.paquetes) || null,
                fuente: 'apartado',
            }]);
            return;
        }
        if (pedidos.length > 0) {
            out.set(idx, pedidos.map(l => ({
                lote: l.lote ? String(l.lote) : null,
                vence: l.vence ?? null,
                unidades: Number(l.unidades) || null,
                fuente: 'pedido',
            })));
        }
    });
    return out;
}

/**
 * La `metadata` vista desde lo que SALIÓ y no desde lo que se pidió.
 *
 * `metadata.items` es el pedido, y un despacho puede salir incompleto —«enviar
 * lo que hay», o quien pidió avisa que ya no hace falta todo—. Pintar `items`
 * en la bolsa en camino es ponerle a quien recibe una lista contra la que va a
 * cotejar lo que nunca salió. Pasó el 29-oct-2026: Salud 2 → Salud 1 se pidieron
 * 5 productos y 24 unidades, salieron 2 y 4, y la bolsa por recibir decía «5
 * PRODUCTOS · 24 unidades» con los lotes de los cinco.
 *
 * Devuelve la misma forma que `metadata` —con `items` y `total_unidades`
 * reescritos— para que `piezasDe`, `renglonesDe` y `lotesPedidos` sirvan tal
 * cual. Sin `erp_traslado.detalle` (todavía no salió, o una fila vieja)
 * devuelve la `metadata` sin tocar. Un renglón que no se puede repartir se
 * queda como se pidió: preferible un techo flojo a esconder lo que sí viajó.
 */
export function metaDelEnvio(meta) {
    const detalle = Array.isArray(meta?.erp_traslado?.detalle) ? meta.erp_traslado.detalle : null;
    const items = Array.isArray(meta?.items) ? meta.items : [];
    if (!detalle || detalle.length === 0 || items.length === 0) return meta;

    const salieron = items.flatMap((item, idx) => {
        const suyas = lineasDelRenglon(items, idx, detalle);
        if (suyas == null) return [item];
        const cantidad = suyas.reduce((s, d) => s + (Number(d?.cantidad) || 0), 0);
        if (cantidad <= 0) return [];
        const pedidos = Array.isArray(item.lotes) ? item.lotes : [];
        const lotes = suyas.map(d => {
            // El genérico viaja sin número de lote; el pedido lo nombraba.
            const lote = d?.numero_lote ?? (pedidos.length === 1 ? pedidos[0]?.lote : null);
            const pedido = pedidos.find(l => l?.lote && l.lote === lote);
            return { lote, vence: pedido?.vence ?? null, unidades: Number(d?.cantidad) || 0 };
        });
        return [{ ...item, cantidad, lotes }];
    });

    return {
        ...meta,
        items: salieron,
        total_unidades: salieron.reduce((s, i) => s + (Number(i.cantidad) || 0), 0),
    };
}

/**
 * Lo que se pidió y NO salió, o salió de menos: la otra mitad de
 * `metaDelEnvio`. Quien recibe tiene que saber que no viene, y por qué, para no
 * declararlo faltante ni salir a buscarlo. Vacío si salió todo o si todavía no
 * salió nada.
 */
export function loQueNoSalio(meta) {
    const detalle = Array.isArray(meta?.erp_traslado?.detalle) ? meta.erp_traslado.detalle : null;
    const items = Array.isArray(meta?.items) ? meta.items : [];
    if (!detalle || detalle.length === 0) return [];
    return items.flatMap((item, idx) => {
        const suyas = lineasDelRenglon(items, idx, detalle);
        if (suyas == null) return [];
        const pedida = Number(item.cantidad) || 0;
        const salio = suyas.reduce((s, d) => s + (Number(d?.cantidad) || 0), 0);
        if (salio >= pedida) return [];
        return [{
            idx,
            nombre: item.descripcion ?? `#${item.erp_product_id ?? '?'}`,
            presentacion: item.presentacion_tipo ?? '',
            pedida,
            salio,
        }];
    });
}

/**
 * Lo que de verdad VIAJÓ en la bolsa, renglón por renglón.
 *
 * `renglonesDe` lista lo que se PIDIÓ, que es lo correcto para «¿esto es lo que
 * mandé a pedir?». Para declarar un faltante no sirve: un despacho puede salir
 * recortado —«enviar lo que hay»— y ofrecer decir que faltaron 5 de un renglón
 * del que salieron 2 es ofrecer declarar un hueco que no existe.
 *
 * `metadata.erp_traslado.detalle` es lo que salió; guarda `erp_product_id` pero
 * **no la posición**, así que se cruza por producto. Cuando el mismo producto
 * aparece en dos renglones —dos presentaciones distintas— el detalle no
 * distingue cuál es cuál y el techo vuelve a ser lo pedido: preferible un techo
 * flojo a rechazar un faltante verdadero. Es la misma regla, escrita igual, que
 * usa la función que recibe.
 *
 * `posicion` es el índice dentro de `metadata.items`, que es el nombre del
 * renglón para todo el circuito.
 */
export function loQueLlego(meta) {
    const detalle = Array.isArray(meta?.erp_traslado?.detalle) ? meta.erp_traslado.detalle : [];
    return renglonesDe(meta).map((r, idx) => {
        const item = (Array.isArray(meta?.items) ? meta.items : [])[idx] ?? {};
        const suyas = detalle.filter(d => Number(d?.erp_product_id) === Number(item.erp_product_id));
        return {
            posicion: r.idx,
            descripcion: r.nombre,
            cantidad: suyas.length === 1 ? Number(suyas[0]?.cantidad ?? 0) : r.cantidad,
        };
    });
}
