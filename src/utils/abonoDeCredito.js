/**
 * La regla de cobrar un crédito: con qué se puede pagar, cuándo un comprobante
 * frena, cómo se reparte un pago entre los créditos del mismo cliente y cuándo
 * el cobro está listo. Vivía dentro de `DialogoAbono`
 * (`views/CuentasPorCobrarView.jsx`); se mudó el 2026-10-02 para que la app del
 * teléfono cobre con la MISMA regla — un abono escribe en el sistema de la caja
 * y no tiene vuelta atrás, así que dos reglas distintas no son una opción.
 */

/** Pedir aprobación no es una forma de pago: el cobro se guarda y no se aplica hasta que alguien firme. */
export const APROBACION = 'APROBACION';

/* Las formas que el portal ACEPTA (decisión del usuario, 2-sep): «voucher y
 * recibo quítalo, otro y bitcoin también». Esta lista y la del servidor
 * (`creditos-erp`) son la MISMA lista dicha dos veces y se mueven juntas. */
export const FORMAS_DE_COBRO = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cheque', APROBACION];
export const ROTULO_DE_FORMA = { [APROBACION]: 'Solicitar aprobación' };

/** Con qué se pagó de verdad un cobro que va a aprobación. «Otro» sólo acá. */
export const FORMAS_REALES = ['Transferencia', 'Tarjeta', 'Cheque', 'Otro'];

/** Por qué el lector no dio por bueno un comprobante (`leer-pago-de-credito`). */
export const MOTIVO_DEL_FRENO = {
    NO_ES_COMPROBANTE: 'La foto no muestra un comprobante de pago.',
    ILEGIBLE: 'El comprobante no se lee: la foto está borrosa o cortada.',
    NO_APROBADO: 'Ese voucher salió declinado, así que no acredita ningún pago.',
    OPERACION_NO_APLICADA: 'El comprobante dice que la operación no se aplicó.',
    SIN_MONTO: 'No se pudo leer el monto del comprobante.',
    MONTO_MAYOR_AL_SALDO: 'El comprobante es por más de lo que este cliente debe.',
};

/** Lo que debe el cliente en la sala: la suma de sus créditos (o el saldo de éste, si no se leyeron). */
export function sumaDeSaldos(hermanos, credito) {
    const lista = hermanos?.length ? hermanos : [credito];
    return lista.reduce((t, h) => t + (Number(h.saldo) || 0), 0);
}

/**
 * Reparte un total del crédito abierto hacia los demás, cada uno hasta su
 * saldo, en el orden que vienen (el más viejo primero). Lo que no cabe se queda
 * sin repartir: un pago por más de la deuda no se registra.
 *   → { [id]: '12.50', … }
 */
export function repartoDelMasViejo(total, creditos) {
    let queda = Number(total) || 0;
    const reparto = {};
    for (const h of creditos) {
        if (queda <= 0.004) break;
        const toma = Math.min(queda, Number(h.saldo) || 0);
        if (toma > 0.004) { reparto[h.id] = toma.toFixed(2); queda = Number((queda - toma).toFixed(2)); }
    }
    return reparto;
}

/**
 * El reparto que sale de un comprobante leído: todo al crédito abierto hasta su
 * saldo; si sobra y hay otros créditos, el resto a ellos y se abre el reparto.
 * Si sobra y no hay otros, el abierto queda en su saldo y lo que sobra queda
 * sin aplicar: el cuadre (`estadoDelCobro`) lo dice y no deja cobrar.
 *   → { reparto, repartir }
 */
export function repartoDesdeElComprobante(monto, credito, otros = []) {
    const m = Number(monto);
    const suyo = Math.min(m, Number(credito.saldo) || 0);
    const resto = Number((m - suyo).toFixed(2));
    const reparto = { [credito.id]: (resto > 0.004 ? suyo : m).toFixed(2) };
    if (!(resto > 0.004) || !otros.length) return { reparto, repartir: false };
    return { reparto: { ...reparto, ...repartoDelMasViejo(resto, otros) }, repartir: true };
}

/**
 * Todo lo que el formulario necesita saber para habilitar el botón, en un solo
 * sitio. La suma repartida tiene que dar EXACTO el comprobante: aceptar menos
 * deja una diferencia sin dueño (el banco movió $50 y el portal explicaría $45).
 * Un comprobante a nombre de otro, o sin beneficiario, va a aprobación solo.
 */
export function estadoDelCobro({ forma, montoDoc, reparto = {}, creditos = [], lectura = null, hayArchivo = false, motivo = '' }) {
    const pideAprobacion = forma === APROBACION;
    const conPapel = forma !== 'Efectivo' && !pideAprobacion;
    const sumaRepartida = Object.values(reparto).reduce((t, v) => t + (Number(v) || 0), 0);
    const totalPago = conPapel ? Number(montoDoc) : sumaRepartida;
    const bloqueado = !!lectura && lectura.veredicto !== 'OK';
    const iraAprobacion = pideAprobacion || !!lectura?.nombreSinReconocer;
    const cuadra = Number.isFinite(totalPago) && totalPago > 0 && Math.abs(sumaRepartida - totalPago) < 0.005;
    const seExcedeAlguno = creditos.some((h) => (Number(reparto[h.id]) || 0) > (Number(h.saldo) || 0) + 0.004);
    const listo = !bloqueado && cuadra && !seExcedeAlguno
        && (!conPapel || (hayArchivo && !!lectura))
        && (!pideAprobacion || String(motivo).trim().length >= 5);
    const descuadre = conPapel && totalPago > 0 && !cuadra
        ? (sumaRepartida < totalPago
            ? { faltan: totalPago - sumaRepartida }
            : { sobran: sumaRepartida - totalPago })
        : null;
    return { pideAprobacion, conPapel, sumaRepartida, totalPago, bloqueado, iraAprobacion, cuadra, seExcedeAlguno, listo, descuadre };
}

/** Lo que se le manda a la caja: crédito por crédito, sólo los que llevan algo. */
export function aplicacionesDelPago(creditos, reparto) {
    return creditos
        .filter((h) => Number(reparto[h.id]) > 0.004)
        .map((h) => ({ credito: h.credito, monto: Number(reparto[h.id]) }));
}
