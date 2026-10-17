// Cómo se pagó un ingreso de caja (2026-10-17).
//
// ── Por qué importa más que un rótulo ──────────────────────────────────────
// La caja trata todo ingreso como EFECTIVO: lo suma al esperado del corte. Una
// inyección cobrada con tarjeta y anotada igual nacía como un faltante que no
// existe. Así que la forma de pago decide ADÓNDE va el ingreso: el efectivo a
// la caja, lo demás se queda en el portal (`operar-caja`).
//
// ── El comprobante es la prueba ────────────────────────────────────────────
// Tarjeta y transferencia piden SIEMPRE la foto del voucher o del comprobante,
// y los datos salen de la lectura. Sin foto el ingreso igual se anota, pero
// queda pendiente de autorización —y para pedirla hay que decir por qué no hay
// foto—: es dinero que no está en ningún cajón que alguien pueda contar.
//
// ── Un voucher puede cubrir más que este ingreso ───────────────────────────
// Un voucher de $16 = $15 de una venta con tarjeta + $1 de una inyección
// (ejemplo del usuario). El ingreso anota su parte y el total del voucher; el
// resto lo cuadra `caja_vouchers_del_dia` contra las ventas con tarjeta.
//
// Vive en el núcleo y no en la pantalla porque son tres los diálogos que cobran
// (el ingreso, la aplicación de inyección y el abono): escrita tres veces, uno
// terminaría dejando pasar lo que los otros frenan.

export const FORMAS_DE_PAGO = [
    { value: 'EFECTIVO', label: 'Efectivo' },
    { value: 'TARJETA', label: 'Tarjeta' },
    { value: 'TRANSFERENCIA', label: 'Transferencia' },
];

/** El estado vacío: efectivo, que es lo que era todo ingreso hasta hoy. */
export const FORMA_DE_PAGO_INICIAL = Object.freeze({
    forma: 'EFECTIVO', foto: null, lectura: null, comprobanteTotal: '', numero: '',
    sinComprobante: false, motivo: '',
});

/** El papel que hace de prueba, nombrado como lo dice la sala. */
export const nombreDelComprobante = (forma) => (forma === 'TRANSFERENCIA'
    ? 'comprobante de la transferencia' : 'voucher');

const aNumero = (v) => {
    const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/**
 * Qué falta y qué se va a hacer con este pago.
 *
 * `monto` es lo que se cobra en ESTE ingreso. Devuelve:
 *   valido          se puede anotar
 *   noEfectivo      no va a la caja
 *   pideAutorizacion  sin comprobante: queda esperando autorización
 *   resto           lo que el voucher cubre además de este ingreso (> 0 = una venta con tarjeta)
 *   falta           qué impide anotarlo, en palabras de la sala (o null)
 */
export function estadoDeFormaDePago(v, monto) {
    const p = v ?? FORMA_DE_PAGO_INICIAL;
    const noEfectivo = p.forma !== 'EFECTIVO';
    const cobro = aNumero(monto);
    if (!noEfectivo) return { valido: true, noEfectivo: false, pideAutorizacion: false, resto: 0, falta: null };

    const papel = nombreDelComprobante(p.forma);
    const conFoto = !!p.foto;
    const pideAutorizacion = !conFoto && !!p.sinComprobante;
    const total = aNumero(p.comprobanteTotal);
    const resto = total != null && cobro != null ? Math.round((total - cobro) * 100) / 100 : 0;

    let falta = null;
    if (!conFoto && !p.sinComprobante) falta = `Sube la foto del ${papel}.`;
    else if (pideAutorizacion && String(p.motivo ?? '').trim().length < 5) falta = `Explica por qué no hay ${papel}.`;
    else if (total != null && cobro != null && resto < -0.004) falta = `El cobro no puede pasar del total del ${papel} (${total.toFixed(2)}).`;

    return { valido: !falta, noEfectivo, pideAutorizacion, resto: resto > 0.004 ? resto : 0, falta };
}

/** Los campos que viajan a `anotarIngreso`, con la URL de la foto ya subida. */
export function datosDeFormaDePago(v, fotoUrl = null) {
    const p = v ?? FORMA_DE_PAGO_INICIAL;
    if (p.forma === 'EFECTIVO') return { formaPago: 'EFECTIVO' };
    return {
        formaPago: p.forma,
        comprobanteTotal: aNumero(p.comprobanteTotal),
        // El número del voucher viaja como `boleta`: es lo que agrupa las
        // partes de un mismo voucher y lo que el servidor suma contra su total.
        boleta: String(p.numero ?? '').trim() || null,
        lectura: fotoUrl ? (p.lectura ?? null) : null,
        motivoSinComprobante: fotoUrl ? '' : String(p.motivo ?? '').trim(),
    };
}
