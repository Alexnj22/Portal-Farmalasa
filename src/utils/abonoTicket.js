// El comprobante que se lleva el cliente cuando deja un abono para apartar un
// producto.
//
// ── Este papel es el CONTRATO, no un recibo ────────────────────────────────
//
// Es la única prueba que el cliente tiene de que dejó dinero y de qué le
// prometieron a cambio, y con él vuelve a retirar. Eso decide todo lo demás:
//
//  · **Lleva las condiciones impresas.** Un plazo o una devolución que sólo se
//    dijeron de palabra no se pueden sostener ante nadie — ni a favor de la
//    farmacia ni a favor del cliente.
//  · **Lleva quién lo hizo.** No para acusar: para que quien vuelva con una
//    duda encuentre a la persona con la que habló.
//  · **Lleva el código de barras del folio**, para que al retirar la sala
//    escanee el papel en vez de teclear el número. El lector físico ya está en
//    uso en el login y en el conteo.
//
// ── El renglon SIN precio se imprime sin monto, a proposito ────────────────
//
// Un encargo que todavía no se cotiza no tiene precio pactado, y escribir un
// número tentativo lo convierte en uno: el cliente vuelve con el papel en la
// mano y ese número es lo que va a exigir. Se imprime la cantidad y el nombre,
// la columna del monto queda vacía, y el total dice «por definir». La cláusula
// 7 dice qué pasa entonces.
//
// ── Lo que se rompe solo (§5 de docs/IMPRESION-EN-TICKETERA-2026-08-13.md) ──
// Sólo ASCII —por eso los rótulos van SIN TILDE a propósito, no es un
// descuido—, 54 columnas en letra chica, y el papel no tiene tema: ni colores,
// ni fondos, ni bordes. El ancho NO se pasa: es un ajuste de la computadora que
// tiene la ticketera enchufada.

import { EMPRESA } from '../constants/empresa';
import { formatMoney } from './formatNumber';
import { fechaCorta, juntarSiEntra, recortar, selloCorto, soloAscii } from './ticketCampos';

/**
 * Las condiciones de la reserva, tal como se imprimen.
 *
 * Viven acá y no en la base **porque el papel es el contrato**: lo que se
 * imprimió el día del abono es lo que rige para ese abono, y una tabla editable
 * cambiaría de retroactivo las condiciones de los comprobantes ya entregados.
 * El día que haya que cambiarlas, se cambian acá y los papeles nuevos salen con
 * las nuevas — los viejos siguen diciendo lo que decían.
 *
 * Redactadas en segunda persona y sin tildes (el rollo no lee UTF-8).
 */
export const POLITICA_DE_RESERVA = [
    'El producto queda apartado 15 dias desde la fecha del comprobante. Vencido el plazo sin retirarlo, la farmacia puede volver a venderlo.',
    'El abono no se devuelve en efectivo. Si el cliente desiste, queda como saldo a favor por 30 dias, aplicable a cualquier compra.',
    'El retiro se hace presentando el comprobante. Sin el, se entrega solo al titular con documento de identidad.',
    'El precio queda fijo al del comprobante durante el plazo de reserva.',
    'Si el producto no llega por causa del proveedor, se devuelve el abono completo o se aplica a otro producto, a eleccion del cliente.',
    'Un producto "por definir" no tiene precio pactado: se acuerda al confirmarlo, y el cliente puede desistir con devolucion completa del abono.',
    'Los medicamentos que requieren receta se entregan solo contra receta vigente.',
];

/**
 * Lo que sí va impreso, y por qué son CUATRO y no las siete.
 *
 * El rollo cobra papel por renglón: la política entera son ~20 renglones en 54
 * columnas, una quinta parte de un comprobante que en total mide treinta. Y un
 * muro de texto en papel térmico no se lee — se salta, que es lo contrario de
 * lo que una cláusula existe para lograr.
 *
 * Van las cuatro que se aplican EN EL MOSTRADOR, o sea las que alguien va a
 * discutir con el papel en la mano: cuánto dura, que el dinero no vuelve en
 * efectivo, que hay que traer el papel, y que el precio no se mueve. Las otras
 * tres son casos que resuelve quien atiende con la política a la vista, y la
 * política completa vive en `POLITICA_DE_RESERVA`.
 *
 * Cortas a propósito: el pie del rollo va CENTRADO, y una línea de 50
 * caracteres centrada se lee torcida.
 */
export const CONDICIONES_DEL_PAPEL = [
    'Apartado 15 dias desde esta fecha.',
    'El abono no se devuelve en efectivo.',
    'Trae este comprobante para retirar.',
    'El precio no cambia dentro del plazo.',
];

/** Cuántos días vale la reserva. Sale de la cláusula 1 y se usa para `vence_el`. */
export const DIAS_DE_RESERVA = 15;

/**
 * `2026-09-01` + 15 → `2026-09-16`, en fecha pura y sin husos.
 *
 * Se arma a mediodía UTC a propósito: una fecha leída como medianoche retrocede
 * un día en cualquier huso al oeste, y acá el día que vence es el que dice el
 * papel. Es la misma trampa que ya costó una corrección en el portal.
 */
export function vencimientoDeReserva(fecha, dias = DIAS_DE_RESERVA) {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}

/**
 * Un renglón para la tabla del papel.
 *
 * **Cuatro celdas y en este orden — nombre, cantidad, unitario, total — porque
 * el rollo sólo sabe maquetar tablas de cuatro.** Con cualquier otra cantidad
 * `filaDeItem` cae a «primera celda a la izquierda, última a la derecha» y las
 * del medio **desaparecen sin avisar**: con tres columnas el papel salía con la
 * cantidad y el monto, y sin el nombre del producto. Es la geometría medida
 * contra un ticket real del sistema de la caja, y el nombre que no entra
 * continúa en el renglón de abajo en vez de recortarse.
 *
 * `presentacion` va pegada al nombre y no en columna propia por lo mismo: no
 * hay una quinta.
 */
function filaDeRenglon(r) {
    const cantidad = Number(r?.cantidad) || 0;
    const nombre = soloAscii(
        [r?.nombre, r?.presentacion].filter(Boolean).join(' ').trim(),
    ) || 'Sin nombre';
    const precio = r?.precio == null || r.precio === '' ? null : Number(r.precio);
    const hayPrecio = precio != null && Number.isFinite(precio);
    // Vacío y no `$0.00`: un cero es un precio, y «no lo sabemos todavia» no es
    // cero. Ver el encabezado del archivo.
    return [
        nombre,
        String(cantidad),
        hayPrecio ? formatMoney(precio) : '',
        hayPrecio ? formatMoney(precio * cantidad) : '',
    ];
}

/**
 * El comprobante del abono.
 *
 * @param {object}  abono              la fila de `abonos_de_cliente` (o lo que se va a escribir)
 * @param {string}  sala               nombre de la sucursal
 * @param {string}  hechoPor           quién lo recibió
 * @param {string}  hechoAt            ISO del momento
 */
export function construirComprobanteDeAbono({ abono, sala, hechoPor, hechoAt }) {
    const renglones = Array.isArray(abono?.renglones) ? abono.renglones : [];
    const total = abono?.total == null ? null : Number(abono.total);
    const abonado = Number(abono?.abonado) || 0;
    // El saldo sólo se puede decir si hay total. Con «por definir» no hay resta
    // posible, y poner el abono como si fuera el saldo sería mentir al reves.
    const saldo = total == null ? null : Math.max(0, total - abonado);

    /* El cliente va acá arriba y no en un bloque propio: el rollo pinta los
     * bloques ANTES de la tabla de productos, así que un bloque «Cliente»
     * empujaría los productos abajo de lo que el cliente lee primero — y lo
     * primero que mira es qué le apartaron. Como par de datos entra en el
     * encabezado sin costar un renglón de más.
     *
     * El teléfono va impreso porque es con lo que la sala avisa cuando el
     * encargo llega, y es el dato que más se equivoca al dictarlo: en el papel,
     * el cliente lo corrige ahí mismo. */
    const datos = [
        ['Folio', soloAscii(abono?.folio || '-')],
        ['Fecha', fechaCorta(abono?.fecha)],
        ['Sucursal', recortar(soloAscii(sala || '-'), 20)],
        ['Vence', fechaCorta(abono?.vence_el)],
        ['Cliente', recortar(soloAscii(abono?.cliente_nombre || 'sin nombre'), 30)],
        ['Telefono', soloAscii(abono?.cliente_telefono || 'sin telefono')],
    ];

    const totales = [
        ['Total del producto', total == null ? 'Por definir' : formatMoney(total)],
        ['Abono recibido', formatMoney(abonado), true],
    ];
    if (saldo != null) totales.push(['Queda pendiente', formatMoney(saldo)]);

    return {
        titulo: 'COMPROBANTE DE ABONO',
        encabezado: { titulo: soloAscii(EMPRESA.razonSocial) },
        datos,
        items: {
            columnas: [
                { label: 'PRODUCTO' },
                { label: 'CANT', alinear: 'der' },
                { label: 'P.UNIT', alinear: 'der' },
                { label: 'TOTAL', alinear: 'der' },
            ],
            filas: renglones.map(filaDeRenglon),
        },
        totales,
        /* El folio en barras, para que al retirar se escanee el papel. Va DESPUES
         * de las condiciones —al final del rollo— porque es lo que la sala busca
         * con el lector, y el final es el pedazo que queda hacia afuera al
         * sostener el papel. */
        codigos: [{ valor: abono?.folio || '', simbologia: 'CODE128', texto: abono?.folio || '' }],
        /* Quién lo recibió. Sin raya para firmar, por lo mismo que el vale de
         * bolsa: no lo escribió nadie a mano, lo puso el portal después de
         * comprobar su sesión, y una raya al lado pide a mano una prueba que el
         * registro ya tiene mejor. */
        /* Las condiciones van en el PIE y no en un bloque: el rollo pinta los
         * bloques antes de la tabla, y unas cláusulas metidas entre el nombre
         * del cliente y lo que le apartaron empujan lo que se mira fuera de la
         * primera mirada. Abajo es donde van las condiciones de cualquier
         * comprobante, y es donde nadie las busca hasta que las necesita. */
        pie: [
            ...CONDICIONES_DEL_PAPEL,
            juntarSiEntra(`Te atendio: ${recortar(soloAscii(hechoPor || 'sin identificar'), 28)}`,
                          selloCorto(hechoAt)),
        ],
    };
}
