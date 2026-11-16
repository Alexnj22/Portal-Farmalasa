// Qué entra y cuánto al aprobar una solicitud — la regla de la aprobación
// PARCIAL, para el modal del portal (`ModalSolicitud`) y la pantalla de la app.
//
// Vivía dentro del modal del portal. La app necesita exactamente la misma
// cuenta —qué renglones quedan afuera, a cuáles se les bajó la cantidad, si eso
// ya es un parcial que exige motivo, y qué índices viajan al servidor—, y una
// copia de esa cuenta es la clase de cosa que se separa en silencio: si una
// manda los índices con cantidad y la otra pelados, el servidor aplica otra
// cosa que lo que la pantalla prometió.
//
// Son DOS ajustes distintos y hacen falta los dos: quitar renglones enteros y
// bajarle la cantidad a uno que sí entra. Un abono por confirmar sólo tiene el
// primero: su monto lo fijó el comprobante, así que lleva casillas y no `+/−`,
// y sus renglones viven en `metadata.creditos` y no en `items`.
import { esMovimiento, lineasDe } from './movimientoTexto';

export const esAbonoPorConfirmar = (req) => req?.type === 'ABONO_APROBACION';

const metaDe = (req) => ((typeof req?.metadata === 'object' && req.metadata) ? req.metadata : {});

/** Los renglones que se pueden marcar: los créditos de un abono, o los productos. */
export function lineasDeDecision(req) {
    const meta = metaDe(req);
    if (esAbonoPorConfirmar(req)) return Array.isArray(meta.creditos) ? meta.creditos : [];
    return lineasDe(meta);
}

/**
 * Qué se puede ajustar antes de aprobar.
 *  · `editable`    — hay algo que ajustar (se decide, es un movimiento o un abono, y no se está rechazando).
 *  · `conCantidad` — además de marcar, se puede bajar la cantidad (no en un abono).
 *  · `porLinea`    — hay casillas: con UNA sola línea, desmarcarla sería rechazar, y para eso está su botón.
 *
 * @param {any} req
 * @param {{ decidible?: boolean, rechazando?: boolean }} [opciones]
 */
export function ajustesPosibles(req, { decidible, rechazando = false } = {}) {
    const abono = esAbonoPorConfirmar(req);
    const editable = !!decidible && (esMovimiento(req?.type) || abono) && !rechazando;
    return {
        editable,
        conCantidad: editable && !abono,
        porLinea: editable && lineasDeDecision(req).length > 1,
    };
}

export const seleccionInicial = (lineas) => new Set((lineas ?? []).map((_, i) => i));
export const cantidadesIniciales = (lineas) => new Map((lineas ?? []).map((l, i) => [i, Number(l?.cantidad) || 0]));

/** Nunca 0 ni más de lo pedido. */
export const acotarCantidad = (linea, n) => Math.max(1, Math.min(Number(linea?.cantidad) || 0, Number(n) || 0));

/**
 * La cuenta de la decisión con lo que hay marcado.
 *
 * `aceptadas` es lo que viaja al servidor —sólo cuando de verdad se cambió
 * algo—: los ÍNDICES con su cantidad, nunca las líneas, porque el servidor las
 * resuelve contra lo que se guardó al crear la solicitud. El abono manda los
 * índices PELADOS: su renglón no tiene cantidad, y un `{i, cantidad: 0}` diría
 * que entra por cero, que no es lo mismo que «se devuelve».
 */
export function resumenDeDecision({ req, lineas, seleccion, cantidades, editable, conCantidad, porLinea }) {
    const abono = esAbonoPorConfirmar(req);
    const fuera = lineas.length - seleccion.size;
    const recortes = conCantidad
        ? [...seleccion].filter((i) => (cantidades.get(i) ?? 0) < (Number(lineas[i]?.cantidad) || 0)).length
        : 0;
    // «Parcial» es cualquier cosa que no sea exactamente lo que pidieron.
    const parcial = !!editable && seleccion.size > 0 && (fuera > 0 || recortes > 0);
    // Aprobar sin nada marcado no es aprobar: es rechazar con otro nombre.
    const nadaSeleccionado = !!porLinea && seleccion.size === 0;

    const aceptadas = parcial
        ? [...seleccion].sort((a, b) => a - b)
            .map((i) => (abono ? i : { i, cantidad: cantidades.get(i) ?? (Number(lineas[i]?.cantidad) || 0) }))
        : null;

    // El aviso habla de PRODUCTOS porque nació con los movimientos; sobre un
    // abono lo que queda afuera es dinero que se le DEVUELVE al cliente.
    // Cuando entra todo tal cual se pidió no hay nada que decir: el aviso
    // «Entra todo lo que se pidió, completo» se quitó el 2026-11-16 a pedido
    // del usuario («no son formas que yo hablo»), y además seguía en pantalla
    // cuando a la carga le faltaban datos, contradiciendo al aviso de arriba.
    // Tuteo y frases cortas, como habla el usuario.
    let aviso = null;
    if (editable && (nadaSeleccionado || parcial)) {
        const tono = nadaSeleccionado ? 'danger' : 'warning';
        const texto = abono
            ? (nadaSeleccionado
                ? 'No marcaste ningún crédito. Si no se confirma ninguno, rechaza la solicitud y se le devuelve todo.'
                : (fuera === 1
                    ? '1 crédito queda sin confirmar: ese abono se anula y el saldo vuelve a subir. Escribe abajo el motivo.'
                    : `${fuera} créditos quedan sin confirmar: esos abonos se anulan y los saldos vuelven a subir. Escribe abajo el motivo.`))
            : nadaSeleccionado
                ? 'No marcaste ningún producto. Si no va a entrar nada, rechaza la solicitud.'
                : [
                    fuera > 0 && (fuera === 1 ? 'Dejaste 1 producto fuera' : `Dejaste ${fuera} productos fuera`),
                    recortes > 0 && (fuera > 0
                        ? (recortes === 1 ? 'a 1 le bajaste la cantidad' : `a ${recortes} les bajaste la cantidad`)
                        : (recortes === 1 ? 'A 1 producto le bajaste la cantidad' : `A ${recortes} productos les bajaste la cantidad`)),
                ].filter(Boolean).join(' y ') + '. Escribe abajo el motivo.';
        aviso = { tono, texto };
    }
    return { fuera, recortes, parcial, nadaSeleccionado, aceptadas, aviso };
}

/** El motivo es obligatorio al rechazar y en un parcial — en los dos no se explica sola. */
export const faltaMotivo = ({ rechazando, parcial, nota }) =>
    (rechazando || parcial) && !String(nota ?? '').trim();

/** Los rótulos de los botones: un abono no se «aprueba», se confirma; y «rechazar» lo devuelve. */
export function rotulosDeDecision(req, parcial) {
    const abono = esAbonoPorConfirmar(req);
    return {
        aprobar: abono ? (parcial ? 'Confirmar lo marcado' : 'Confirmar') : (parcial ? 'Aplicar lo marcado' : 'Aprobar'),
        rechazar: abono ? 'Devolver todo' : 'Rechazar',
        confirmarRechazo: abono ? 'Confirmar la devolución' : 'Confirmar rechazo',
    };
}
