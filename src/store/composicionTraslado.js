import { create } from 'zustand';
import { repartirPedido } from '../utils/unidadesInventario';

// La solicitud que se está armando, viva por fuera del modal que la arma.
//
// ── Por qué no vive en el formulario ──────────────────────────────────────
// Pedido del usuario, 2026-08-20: al agregar un producto, la pantalla tiene que
// volver a la **consulta de inventario** —la de verdad, con su lista de
// faltantes— para elegir el siguiente. Y la consulta es la que abre este
// formulario, así que volver a ella significa CERRAR el formulario.
//
// Con la lista adentro del formulario, cerrarlo la borraba. Acá sobrevive: se
// abre el formulario, se agrega, se cierra, se elige otro producto en la
// consulta, se vuelve a abrir — y lo que llevabas sigue ahí.
//
// ── Por qué un store y no el estado del widget ────────────────────────────
// La consulta se dibuja en DOS sitios —la baldosa del tablero y su pantalla
// grande— y el formulario se abre desde los dos. Con el estado en el widget,
// cada copia tendría su propia solicitud a medias y cuál se manda dependería de
// por cuál puerta se entró.
//
// ── Lo que este store NO hace ─────────────────────────────────────────────
// No habla con la base. Quién puede pedir, a qué sala sale cada renglón y qué
// se escribe se sigue decidiendo en el formulario y en el servidor: esto es
// dónde se guarda lo que se lleva armado, nada más.
//
// Y no sobrevive a recargar la página, a propósito: una solicitud a medias que
// reaparece dos días después es peor que una que se perdió — quien la ve no
// sabe si la armó él, ni si la existencia que vio sigue estando.

/**
 * Rehace la cuenta de un renglón cuando cambia su cantidad o su presentación.
 *
 * Las dos correcciones pasan por acá porque **el factor multiplica**: cambiar
 * UNIDAD por CAJA X 10 sin rehacer el reparto convierte 5 en cincuenta veces el
 * producto. Y el reparto por lote es lo que manda («los lotes MANDAN»,
 * 2026-08-07), así que un renglón con la cantidad nueva y el reparto viejo dice
 * una cosa y lleva otra.
 */
function recalcular(r, cambios) {
    const tipo   = cambios.presentacion_tipo ?? r.item.presentacion_tipo;
    const factor = Number(cambios.factor ?? r.item.factor) || 1;
    const cant   = cambios.cantidad !== undefined
        ? Math.max(0, Math.floor(Number(cambios.cantidad)) || 0)
        : Number(r.item.cantidad) || 0;

    const unid  = cant * factor;
    const lotes = r.lotesVivos ?? [];
    const { reparto, faltan } = repartirPedido(lotes, unid);

    return {
        ...r,
        unidades: unid,
        // Por qué NO se puede mandar, si es que no se puede. Se guarda en el
        // renglón y no se recalcula al pintar: lo que frena el envío y lo que se
        // lee en la tarjeta tienen que ser el mismo juicio.
        problema: cant <= 0 ? 'sin cantidad'
            : unid > Number(r.origen.unidades ?? 0) ? `${r.origen.sala} tiene ${r.origen.unidades}`
            : (lotes.length > 0 && faltan > 0) ? `faltan ${faltan} en los lotes`
            : null,
        item: {
            ...r.item,
            presentacion_tipo: tipo,
            factor,
            cantidad: cant,
            lotes: lotes.length > 0
                ? reparto.map(l => ({ lote: l.lote, vence: l.vence, unidades: l.toma }))
                : null,
        },
    };
}

export const useComposicionTraslado = create((set, get) => ({
    /** Los renglones agregados, en el orden en que entraron. */
    renglones: [],
    /** El «para qué», uno para toda la solicitud. */
    causa: '',

    agregar: (renglon) => set(s => ({ renglones: [...s.renglones, renglon] })),

    quitar: (i) => set(s => ({ renglones: s.renglones.filter((_, j) => j !== i) })),

    editar: (i, cambios) => set(s => ({
        renglones: s.renglones.map((r, j) => (j === i ? recalcular(r, cambios) : r)),
    })),

    setCausa: (causa) => set({ causa }),

    /** Al mandar, y al cancelar a propósito. Nunca al cerrar el formulario. */
    limpiar: () => set({ renglones: [], causa: '' }),

    /**
     * Si ese producto ya está pedido a ese mismo estante.
     *
     * El mismo producto a la misma sala dos veces no es un pedido más grande: es
     * una sola línea con la cantidad sumada. La base lo frena igual —y frenaría
     * la composición ENTERA, porque las solicitudes se insertan juntas—, así que
     * se pregunta antes, donde todavía se puede arreglar sin perder lo demás.
     */
    yaEsta: (clave, erpProductId) => get().renglones.some(
        r => r.clave === clave && r.item.erp_product_id === erpProductId,
    ),
}));
