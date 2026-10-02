/**
 * Lo que decide el formulario de un movimiento de caja: qué se saca de la foto
 * de la boleta y qué se le dice a quien registra, y si el número de boleta
 * choca con otro de la sala. Vivía dentro de `DialogoMovimiento`
 * (`views/MiCajaView.jsx`); se mudó el 2026-10-02 para que la app del teléfono
 * llene, avise y frene con las MISMAS palabras que el portal.
 */
import { formatMoney } from './formatNumber';
import { conceptoDelPapel, sentidoDelPapel } from './conceptoDelPapel';
import { choqueDeBoleta } from './boletaRepetida';

/** Un ejemplo de qué escribir en el detalle de cada motivo: sin la pista, «Aplicación
 *  de inyección» se llena con «aplicación» en vez de con QUÉ se aplicó. */
export const PISTA_DE_DETALLE = {
    APLICACION:     'Neurobion 25000',
    GLUCOSA:        'en ayunas',
    ABONO_CREDITO:  'de qué compra',
    POS_PROMERICA:  'CAESS, ANDA, telefono',
    COMPRA:         'agua fria, saldo telefonico',
    PAGO_PROVEEDOR: 'que factura se paga',
    ANTICIPO:       'quincena que descuenta',
    BONIFICACION:   'de que linea',
    DEVOLUCION:     'por que se devuelve',
};

/**
 * Qué se llena con lo que leyó la foto (`leerBoleta`), y el aviso.
 *
 * El monto se LLENA siempre y se CIERRA sólo si el papel lo confirma (regla del
 * usuario, 2026-09-05: «si no está seguro el resultado, debe decirlo y permitir
 * poner el monto manualmente»). «Seguro» es concreto: la boleta imprime el
 * total MÁS DE UNA VEZ y las lecturas coinciden (`CONFIRMADO`). `CONTRADICHO`
 * es un dígito mal leído; `UNICO` es que no hay con qué comprobarlo.
 *
 * El aviso DICE el monto y DICE si está comprobado: estas impresoras escriben
 * el cero con barra y a la resolución de la foto se confunde con un 8, así que
 * cotejar contra el papel es la última defensa.
 *
 *   → { error } si la lectura falló, o
 *     { monto, boleta, concepto, puesto: {monto,boleta,concepto}, aviso, aMano, lectura }
 *     `puesto.monto` = el monto quedó confirmado (se puede cerrar el campo).
 */
export function lecturaDeBoleta(r, { pideBoleta = false } = {}) {
    if (!r || r.error) return { error: true, aviso: 'No se pudo leer la foto. Escribe los datos a mano.', aMano: true };
    const leido = r.leido || {};
    const confianza = r.montoConfianza;
    const seguro = confianza === 'CONFIRMADO';
    const puesto = {};
    const montoLeido = Number(leido.monto);
    const hayMonto = Number.isFinite(montoLeido) && montoLeido > 0;
    const salida = { monto: null, boleta: null, concepto: null, lectura: r };
    if (hayMonto) { salida.monto = String(leido.monto); puesto.monto = seguro; }
    if (leido.numero_boleta) { salida.boleta = String(leido.numero_boleta); puesto.boleta = true; }
    const texto = conceptoDelPapel(leido);
    if (texto) { salida.concepto = texto.slice(0, 50); puesto.concepto = true; }

    const nombres = { boleta: 'el número', concepto: 'el detalle' };
    const faltan = ['boleta', 'concepto']
        .filter((k) => !puesto[k] && (k !== 'boleta' || pideBoleta))
        .map((k) => nombres[k]);
    const cola = faltan.length ? ` Falta ${faltan.join(' y ')}.` : '';
    const nada = !hayMonto && !puesto.boleta && !puesto.concepto;
    const aviso = nada
        ? 'La foto no se dejó leer. Escribe los datos a mano.'
        : !hayMonto
            ? `La foto no leyó el monto: escríbelo.${cola}`
            : confianza === 'CONTRADICHO'
                ? `La boleta trae el monto dos veces y no dicen lo mismo: leí ${formatMoney(montoLeido)}. Escribe el que dice el papel.`
                : !seguro
                    ? `Leí ${formatMoney(montoLeido)}, pero la boleta sólo lo dice una vez: compáralo con el papel y corrígelo si no es.${cola}`
                    : `La foto leyó ${formatMoney(montoLeido)}${leido.numero_boleta ? `, boleta ${leido.numero_boleta}` : ''}, y la boleta lo confirma.${cola}`;
    return { ...salida, puesto, aviso, aMano: nada };
}

/**
 * ¿El papel va para el otro lado? Una remesa SALE y el pago de un recibo ENTRA,
 * con un papel que se ve igual: confundirlos costó tres correcciones a mano.
 * Avisa y no frena; se calla cuando el papel no lo dice claro.
 */
export function choqueDeSentido(r, entra) {
    const leido = r?.leido || {};
    const lado = sentidoDelPapel(leido);
    const seAnota = entra ? 'ENTRADA' : 'SALIDA';
    if (!lado || lado === seAnota) return null;
    return `Revisa el motivo: el papel dice ${conceptoDelPapel(leido) || 'otra operación'}, `
        + `y eso normalmente ${lado === 'ENTRADA' ? 'ENTRA a la caja' : 'SALE de la caja'}. `
        + `Estás anotando ${entra ? 'un ingreso' : 'una salida'}.`;
}

/**
 * El problema del número de boleta, ya redactado. La MISMA boleta en la sala
 * frena (`bloquea`); el mismo número en el otro sentido sólo avisa, porque es
 * como se ve una corrección (`choqueDeBoleta`).
 *   → null | { tono: 'danger'|'warning', bloquea, texto }
 */
export function problemaDeBoleta(repetidas, entra, boleta = '') {
    const r = choqueDeBoleta(repetidas, entra);
    if (!r) return null;
    const m = r.movimiento || {};
    const cuando = String(m.fecha || '').slice(0, 10);
    const cuanto = formatMoney(Number(m.monto) || 0);
    if (r.bloquea) {
        return {
            tono: 'danger', bloquea: true,
            texto: `La boleta ${m.numero_boleta || String(boleta).trim()} ya se anotó en esta sala`
                + `${cuando ? ` el ${cuando}` : ''} por ${cuanto}`
                + `${m.concepto ? ` (${m.concepto})` : ''}.`,
        };
    }
    return {
        tono: 'warning', bloquea: false,
        texto: `Ese número ya está anotado como ${m.tipo === 'ENTRADA' ? 'ingreso' : 'salida'}`
            + `${cuando ? ` del ${cuando}` : ''} por ${cuanto}. `
            + 'Si estás corrigiendo el sentido, puedes seguir.',
    };
}
