import { supabase } from '../supabaseClient';
import { insertApprovalRequestSilent } from './requests';
import { filtroProductoOCodigo } from '../utils/searchUtils';

// Datos del widget de cargas y descartes de inventario.
//
// La idea del widget es dar vuelta el trabajo: en vez de que alguien busque
// producto por producto, el portal PROPONE la lista y la persona tilda. Eso se
// puede porque `inventory` ya guarda lote, fecha de vencimiento, cantidad y
// presentación por sucursal — el sync lo trae cada minuto.
//
// ── La presentación NO es su id ────────────────────────────────────────────
// El portal y el sistema de origen numeran las presentaciones distinto (para el
// producto 2: 1/102/230 acá, 8421/7213/3 allá), así que acá se arma el
// SIGNIFICADO —tipo + factor— y del otro lado se resuelve por etiqueta. Nunca
// mandar `product_precios.id_presentacion` como si fuera el del movimiento.

// Tope deliberado, por debajo del corte de 1000 filas de PostgREST: si una
// sucursal tuviera más vencidos que esto, el widget lo DICE en vez de mostrar
// una lista recortada que se lee como completa.
export const TOPE_LISTA = 400;

/**
 * Lo que está vencido o por vencer en una sucursal, lote por lote.
 *
 * `dias = 0` es "ya vencido"; 30/60/90 agregan lo que vence dentro de ese
 * plazo. Devuelve `{ filas, hayMas }`.
 */
export async function fetchLotesPorVencer({ erpSucursalId, dias = 0 }) {
    const corte = new Date(Date.now() - 6 * 60 * 60 * 1000);   // fecha de El Salvador
    corte.setDate(corte.getDate() + Number(dias || 0));
    const hasta = corte.toISOString().slice(0, 10);

    const { data, error } = await supabase
        .from('inventory')
        .select('erp_product_id, descripcion, presentacion, detalle, lote, fecha_vencimiento, cantidad')
        .eq('erp_sucursal_id', Number(erpSucursalId))
        .eq('is_vencidos', false)          // la bodega de vencidos ya es el destino, no el origen
        .gt('cantidad', 0)
        .not('fecha_vencimiento', 'is', null)
        .lte('fecha_vencimiento', hasta)
        .order('fecha_vencimiento', { ascending: true })
        .range(0, TOPE_LISTA);             // uno de más: así se sabe si hay cola

    if (error) return { filas: [], hayMas: false, error };
    const filas = (data ?? []).slice(0, TOPE_LISTA);
    return { filas, hayMas: (data ?? []).length > TOPE_LISTA, error: null };
}

/**
 * Busca en el catálogo activo, para CARGAR.
 *
 * Lo que se carga es justamente lo que la sala no tiene registrado, así que
 * buscar sobre su inventario deja afuera el caso normal: reportado el
 * 2026-08-12 con AVAMYS, que no aparecía porque Salud 4 lo tenía en cero.
 * Descargar sigue buscando sobre la existencia —no se puede sacar lo que no
 * está— y por eso son dos funciones y no una con bandera.
 *
 * Trae `regulado` porque de eso depende que la pantalla exija el número de
 * lote, y `perecedero` porque de eso depende que exija la fecha. Los dos viajan
 * en la misma consulta: pedirlos después es otro viaje por producto.
 *
 * La existencia se busca aparte y es SOLO informativa —«había 5»—: en una carga
 * no topa nada. Un producto que la sala no tiene sale igual, con existencia 0.
 */
export async function buscarEnCatalogo({ erpSucursalId, texto }) {
    const q = String(texto ?? '').trim();
    if (q.length < 2) return { filas: [], error: null };

    const { data, error } = await supabase
        .from('products')
        .select('id, nombre, regulado, perecedero')
        .eq('activo', true)
        .or(filtroProductoOCodigo(q))
        .order('nombre')
        .range(0, 60);

    if (error) return { filas: [], error };
    const productos = data ?? [];
    if (!productos.length) return { filas: [], error: null };

    // La existencia de esos productos en la sala. Va sobre los ids que ya se
    // encontraron —nunca sobre todo el inventario— y son 61 como mucho, así que
    // entra de sobra bajo el corte de 1000 filas.
    //
    // Si esta consulta falla NO se cae la búsqueda: la existencia es un dato al
    // margen —en una carga no topa nada— y perderla no puede costar el listado
    // entero. Pero se mira el error igual, porque descartarlo sin leerlo deja
    // todas las existencias en cero y eso se ve idéntico a que no haya nada.
    const { data: exis, error: exisErr } = await supabase
        .from('inventory')
        .select('erp_product_id, cantidad')
        .eq('erp_sucursal_id', Number(erpSucursalId))
        .eq('is_vencidos', false)
        .gt('cantidad', 0)
        .in('erp_product_id', productos.map(p => p.id))
        .range(0, 999);

    const porProducto = new Map();
    for (const r of exisErr ? [] : (exis ?? [])) {
        porProducto.set(r.erp_product_id, (porProducto.get(r.erp_product_id) ?? 0) + Number(r.cantidad || 0));
    }

    return {
        filas: productos.map(p => ({
            erp_product_id: p.id,
            descripcion: p.nombre,
            // `null` cuando la existencia no se pudo leer: distinto de 0, que
            // afirma que la sala no tiene ninguna.
            cantidad: exisErr ? null : (porProducto.get(p.id) ?? 0),
            regulado: p.regulado,
            perecedero: p.perecedero,
        })),
        error: null,
    };
}

/** Busca por nombre dentro de lo que esa sucursal tiene con existencia. */
export async function buscarConExistencia({ erpSucursalId, texto }) {
    const q = String(texto ?? '').trim();
    if (q.length < 2) return { filas: [], error: null };

    const { data, error } = await supabase
        .from('inventory')
        .select('erp_product_id, descripcion, presentacion, detalle, lote, fecha_vencimiento, cantidad')
        .eq('erp_sucursal_id', Number(erpSucursalId))
        .eq('is_vencidos', false)
        .gt('cantidad', 0)
        .ilike('descripcion', `%${q}%`)
        .order('descripcion')
        .range(0, 60);

    return { filas: data ?? [], error };
}

/**
 * Las presentaciones de cada producto, con su factor.
 *
 * Es lo que después identifica la presentación del otro lado, así que se pide
 * el tipo y el factor y NO el id. Chunkeado de a 1000 porque el `in()` viaja
 * como filtro y la respuesta se corta en 1000 filas sin avisar.
 */
export async function fetchPresentaciones(productIds) {
    const ids = [...new Set((productIds ?? []).map(Number).filter(Boolean))];
    if (!ids.length) return { porProducto: new Map(), error: null };

    const tandas = [];
    for (let i = 0; i < ids.length; i += 1000) tandas.push(ids.slice(i, i + 1000));

    const respuestas = await Promise.all(tandas.map(t => supabase
        .from('product_precios')
        .select('product_id, factor, activo, presentaciones(tipo)')
        .in('product_id', t)
        .eq('activo', true)));

    const fallo = respuestas.find(r => r.error);
    if (fallo) return { porProducto: new Map(), error: fallo.error };

    const porProducto = new Map();
    for (const r of respuestas) {
        for (const fila of r.data ?? []) {
            const tipo = fila.presentaciones?.tipo;
            const factor = Number(fila.factor);
            if (!tipo || !factor) continue;
            const lista = porProducto.get(fila.product_id) ?? [];
            // Misma etiqueta = misma presentación: el otro lado también las
            // tiene repetidas y son intercambiables.
            if (!lista.some(p => p.tipo === tipo && p.factor === factor)) {
                lista.push({ tipo, factor });
            }
            porProducto.set(fila.product_id, lista);
        }
    }
    // La unidad primero: es la que se usa en un descarte casi siempre.
    for (const lista of porProducto.values()) lista.sort((a, b) => a.factor - b.factor);
    return { porProducto, error: null };
}

/**
 * Los lotes de un producto en una sucursal, con su fecha y su existencia.
 *
 * Verificado el 2026-08-06 contra el sistema de origen en tres productos
 * regulados: los pares (lote, vencimiento) son IDÉNTICOS. La única diferencia
 * es la forma — acá van separados por presentación y allá sumados en unidades
 * base; PREDIN son 1 UNIDAD + 1 CAJA + 1 BLISTER acá y 111 allá. Por eso el
 * buscador puede ofrecer los lotes al instante sin salir a preguntar.
 *
 * La identidad de un lote es **número + fecha**, no el número: GLIMEPIRIDA
 * tiene dos «L31800» con vencimientos distintos y son existencias separadas.
 */
export async function fetchLotesDeProducto({ erpProductId, erpSucursalId }) {
    const { data, error } = await supabase
        .from('inventory')
        .select('lote, fecha_vencimiento, presentacion, cantidad')
        .eq('erp_product_id', Number(erpProductId))
        .eq('erp_sucursal_id', Number(erpSucursalId))
        .eq('is_vencidos', false)
        .gt('cantidad', 0)
        .order('fecha_vencimiento', { ascending: true })
        .range(0, 200);

    if (error) return { lotes: [], error };

    // Un producto sin control de lote guarda todo bajo 'GENERICO'. Eso no es un
    // lote: es la ausencia de uno, y ofrecerlo para elegir sería mentir.
    const reales = (data ?? []).filter(r => r.lote && r.lote !== 'GENERICO');
    const porClave = new Map();
    for (const r of reales) {
        const clave = `${r.lote}|${r.fecha_vencimiento ?? ''}`;
        const previo = porClave.get(clave);
        if (previo) previo.presentaciones.push({ presentacion: r.presentacion, cantidad: r.cantidad });
        else porClave.set(clave, {
            lote: r.lote,
            vence: r.fecha_vencimiento,
            presentaciones: [{ presentacion: r.presentacion, cantidad: r.cantidad }],
        });
    }
    return { lotes: [...porClave.values()], error: null };
}

/**
 * Si cada producto es perecedero — o sea, si una carga suya necesita fecha.
 *
 * No todos lo son: 4,230 de 5,205. Para el resto el sistema de origen ni
 * dibuja el campo, así que pedir la fecha sería inventar un requisito.
 */
export async function fetchPerecederos(productIds) {
    const ids = [...new Set((productIds ?? []).map(Number).filter(Boolean))];
    if (!ids.length) return { perecederos: new Set(), error: null };

    const tandas = [];
    for (let i = 0; i < ids.length; i += 1000) tandas.push(ids.slice(i, i + 1000));
    const res = await Promise.all(tandas.map(t =>
        supabase.from('products').select('id, perecedero').in('id', t)));

    const fallo = res.find(r => r.error);
    if (fallo) return { perecederos: new Set(), error: fallo.error };
    return {
        perecederos: new Set(res.flatMap(r => r.data ?? []).filter(p => p.perecedero).map(p => p.id)),
        error: null,
    };
}

/**
 * Cuántas líneas vencidas hay en una sala. Es lo que la baldosa del tablero
 * muestra para dar un motivo de abrirla: sin ese número, la puerta no dice
 * nada de lo que hay del otro lado.
 *
 * `head: true` — se pide el CONTEO, no las filas: la baldosa no las dibuja.
 */
export async function contarPorVencer({ erpSucursalId }) {
    if (!erpSucursalId) return { vencidas: 0, en7: 0, en30: 0, error: null };

    // El día se corre a UTC-6 antes de recortarlo, como ya hacía el conteo de
    // vencidas: sin eso, entre las 18:00 y la medianoche local la fecha de
    // corte es la de mañana y los lotes que vencen hoy se cuentan como vencidos.
    const dia = (offset = 0) =>
        new Date(Date.now() - 6 * 60 * 60 * 1000 + offset * 86400000)
            .toISOString().slice(0, 10);
    const hoy = dia(0), en7 = dia(7), en30 = dia(30);

    // La fila de `inventory` es un LOTE, no un producto: el mismo producto
    // aparece tantas veces como fechas de vencimiento distintas tenga. Por eso
    // la baldosa dice «líneas» y no «productos» — cambiarlo por un conteo de
    // productos distintos daría un número más chico y menos accionable, porque
    // lo que se descarga es el lote.
    // ── Un recorrido, no tres (2026-08-20) ──────────────────────────────────
    // Esto eran tres `HEAD` a `inventory` con `count: exact`. Salían en
    // paralelo —así que costaban un round-trip de reloj, y el comentario que
    // lo decía era cierto—, pero eran tres conexiones y tres recorridos del
    // índice sobre la tabla más caliente de la base. Medidos en producción
    // dentro de la carga del Inicio: 188, 198 y 206 ms, y ahí no compiten con
    // nadie más que con las otras 48 llamadas de la misma avalancha.
    //
    // `contar_inventario_por_vencer` hace los tres tramos con `count(*)
    // FILTER` en una pasada. Verificado contra los tres HEAD en las SIETE
    // salas: los 21 números, iguales.
    //
    // Las fechas siguen calculándose ACÁ y viajan como parámetro: el corte a
    // UTC-6 de arriba es el que decide si un lote que vence hoy cuenta como
    // vencido, y moverlo al servidor cambiaría los números.
    const { data, error } = await supabase.rpc('contar_inventario_por_vencer', {
        p_erp_sucursal_id: Number(erpSucursalId),
        p_hoy: hoy,
        p_en7: en7,
        p_en30: en30,
    });

    return {
        vencidas: data?.vencidas ?? 0,
        en7:      data?.en7      ?? 0,
        en30:     data?.en30     ?? 0,
        error: error ?? null,
    };
}

/** Crea la solicitud. El aviso al aprobador lo dispara el trigger, no esto. */
export function insertMovimientoInventario(payload) {
    return insertApprovalRequestSilent(payload);
}

/**
 * ¿La sala está contando?
 *
 * La regla la aplica el trigger `frenar_ajuste_si_hay_conteo_abierto` sobre
 * `approval_requests` — el alta es un INSERT directo del navegador, así que un
 * `if` acá sería una sugerencia. Esto existe para lo OTRO: avisar antes de que
 * alguien arme una solicitud entera que va a rebotar al enviarla.
 *
 * Nunca lanza. Si no se puede preguntar, el formulario se abre igual y el
 * trigger sigue frenando lo que tenga que frenar: la falla segura de una
 * ADVERTENCIA es no darla, no cerrar la puerta.
 */
export async function fetchSucursalEnConteo(branchId) {
    if (branchId == null) return { en_conteo: false };
    const { data, error } = await supabase.rpc('sucursal_en_conteo', { p_branch_id: Number(branchId) });
    if (error) {
        console.error('[ajuste] no se pudo preguntar si la sala está contando:', error);
        return { en_conteo: false };
    }
    return data ?? { en_conteo: false };
}
