// La constancia de una reserva hecha en la sucursal (2026-10-07).
//
// Se le entrega al cliente que deja un anticipo: dice qué apartó, cuánto dejó,
// cuánto le falta y hasta cuándo puede retirarlo (`venceAt`, el de la base). Lleva el código de
// la reserva en barras para que la caja la encuentre escaneándolo — sin el
// número escrito debajo, igual que el resto de papeles del portal.
import { imprimirDocumento, fechaHora } from './ticketPrint';
import { formatMoney } from './formatNumber';

// El plazo del saldo a favor es el de `public.saldo_favor_dias()` (60 desde el
// 2026-10-20). El papel decía 30: se le prometía al cliente la mitad del plazo.
// Desde el reglamento v2 (`reglas_v2_desde()`), un año: lo dice `reglas`
// (`reserva_reglas()`), que el que imprime pasa; sin reglas, el de v1.
export const DIAS_SALDO_A_FAVOR = 60;
const vigenciaEnPapel = (reglas) => (Number(reglas?.dias_saldo_favor ?? DIAS_SALDO_A_FAVOR) >= 365
    ? '12 meses' : `${Number(reglas?.dias_saldo_favor ?? DIAS_SALDO_A_FAVOR)} dias`);

const recortar = (t, n) => (String(t ?? '').length > n ? `${String(t).slice(0, n - 1)}.` : String(t ?? ''));

// Compacta (2026-10-20, «no dice en qué sucursal, hay mucho texto»): el código
// en el título, DÓNDE se retira y hasta cuándo arriba, el producto en una
// línea, los montos como totales y el pie en dos renglones. Sin tabla de
// productos —es uno solo— ni el código repetido en grande.
// `telefono` (2026-10-21): para avisarle cuando esté lista. `enCamino`: la sala
// de donde viene por traslado; ahí no hay plazo todavía —empieza al llegar—.
// `renglones` (2026-10-22): un pedido de varios productos con un solo cobro;
// sin él, el producto único de siempre.
// `porConfirmar` (2026-11-21): el anticipo de un ENCARGO que Bodega todavía no
// confirma. El total es el precio de hoy en el catálogo y el papel lo dice:
// puede cambiar, y si cambia, se paga la diferencia o se devuelve.
export function construirConstanciaDeReserva({ codigo, cliente, telefono, producto, cantidad, precio, renglones, anticipo, metodo, venceAt, enCamino, sala, atendio, ahora = new Date(), reglas = null, porConfirmar = false }) {
    const lista = renglones?.length ? renglones : [{ producto, cantidad, precio }];
    const total = Math.round(lista.reduce((t, r) => t + Number(r.precio) * Number(r.cantidad), 0) * 100) / 100;
    const saldo = Math.round((total - Number(anticipo)) * 100) / 100;
    return {
        titulo: '',
        encabezado: {
            titulo: `${porConfirmar ? 'ENCARGO' : renglones?.length ? 'PEDIDO' : 'RESERVA'} ${codigo}`,
            lineas: [sala ? `Retira en ${String(sala).toUpperCase()}` : null,
                venceAt ? `Hasta el ${fechaHora(new Date(venceAt))}` : (enCamino ? `Viene de ${String(enCamino).toUpperCase()}` : null)].filter(Boolean),
        },
        bloques: lista.map((r) => ({ texto: `${r.cantidad} x ${recortar(r.producto, 80)}` })),
        datos: [
            ...(cliente ? [['Cliente', cliente]] : []),
            ...(telefono ? [['Telefono', telefono]] : []),
            ['Impreso', fechaHora(ahora)],
            ...(atendio ? [['Atendio', atendio]] : []),
        ],
        // Sin destacado (2026-10-21, «hay textos muy grandes como falta
        // pagar»): en el rollo el destacado es doble alto y en negrita, y
        // «Falta pagar» salía más grande que el propio código de la reserva.
        totales: [
            [porConfirmar ? 'Total aprox.' : 'Total', formatMoney(total)],
            [`Anticipo (${metodo})`, formatMoney(Number(anticipo))],
            [porConfirmar ? 'Falta aprox.' : 'Falta pagar', formatMoney(Math.max(saldo, 0))],
        ],
        codigos: [{ valor: codigo, simbologia: 'CODE128' }],
        // «Si no la retiras: 60 dias a tu favor» no se entendía: lo que queda
        // a favor es el ANTICIPO, como saldo para otra compra.
        pie: porConfirmar ? [
            'PRECIO POR CONFIRMAR: puede cambiar.',
            'Te avisamos el precio y para cuando llega.',
            'Si sube, pagas la diferencia al retirar.',
            'Si baja, te devolvemos lo que dejaste de mas.',
            'Trae este papel para retirar.',
        ] : [
            ...(enCamino && !venceAt ? ['Te avisamos cuando llegue.'] : []),
            'Trae este papel para retirar.',
            // Partido a mano: el pie viaja tal cual y el rollo cortaría a
            // mitad de palabra en la columna 54.
            'Si no la retiras a tiempo, tu anticipo no se pierde:',
            `queda como saldo a favor por ${vigenciaEnPapel(reglas)}.`,
        ],
    };
}

export function imprimirConstanciaDeReserva(datos, { sala = null } = {}) {
    return imprimirDocumento(construirConstanciaDeReserva(datos), { sala, tituloDeCola: `Reserva ${datos.codigo}` });
}

// La constancia de un ENCARGO (2026-10-21): no se cobró nada, así que no lleva
// montos; dice qué se pidió, para quién y que se le avisa con precio y fecha.
// `renglones` (2026-11-24): varios productos en un solo papel, cada uno con su
// código y sus barras —se retira cada uno por su código—; `[{ codigo, producto,
// cantidad, nuevo }]`. Sin él, el producto único de siempre.
export function construirConstanciaDeEncargo({ codigo, cliente, telefono, producto, cantidad, nuevo, renglones, sala, atendio, ahora = new Date() }) {
    const varios = renglones?.length > 1;
    const lista = renglones?.length ? renglones : [{ codigo, producto, cantidad, nuevo }];
    const nuevos = lista.filter((r) => r.nuevo).length;
    return {
        titulo: '',
        encabezado: {
            titulo: varios ? `ENCARGO · ${lista.length} PRODUCTOS` : `ENCARGO ${lista[0].codigo}`,
            lineas: [sala ? `Retira en ${String(sala).toUpperCase()}` : null].filter(Boolean),
        },
        bloques: lista.map((r) => ({ texto: `${varios ? `${r.codigo}  ` : ''}${r.cantidad} x ${recortar(r.producto, 80)}` })),
        datos: [
            ...(cliente ? [['Cliente', cliente]] : []),
            ...(telefono ? [['Telefono', telefono]] : []),
            ['Impreso', fechaHora(ahora)],
            ...(atendio ? [['Atendio', atendio]] : []),
        ],
        // Con varios, la leyenda dice de qué producto es cada barra.
        codigos: lista.map((r) => ({ valor: r.codigo, simbologia: 'CODE128', ...(varios ? { leyenda: recortar(r.producto, 40) } : {}) })),
        pie: nuevos === lista.length ? [
            'Lo consultamos y te avisamos si se puede conseguir,',
            'el precio y para cuando llega. No has pagado nada.',
        ] : nuevos > 0 ? [
            'Te avisamos el precio y para cuando llega cada uno,',
            'y si se pueden conseguir. No has pagado nada.',
        ] : [
            'Te avisamos el precio y para cuando llega,',
            'y ahi se paga completo. No has pagado nada.',
        ],
    };
}

export function imprimirConstanciaDeEncargo(datos, { sala = null } = {}) {
    return imprimirDocumento(construirConstanciaDeEncargo(datos), { sala, tituloDeCola: `Encargo ${datos.codigo ?? datos.renglones?.[0]?.codigo ?? ''}` });
}
