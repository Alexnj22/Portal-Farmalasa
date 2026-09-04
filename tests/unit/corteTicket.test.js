import { describe, expect, it } from 'vitest';
import { construirComprobanteDeCorte } from '../../src/utils/corteTicket';
import { resultadoDeLaFila } from '../../src/utils/cortesDiagnostico';
import { textoParaElRollo } from '../../src/utils/ticketPrint';

/*
 * El comprobante del corte, anclado contra un corte REAL: el 14323 de Salud 3
 * del 2026-08-31, que es el primero que salió bien tipado desde el portal.
 *
 * Se ancla el TEXTO DEL ROLLO y no el objeto, por lo mismo que `ticketPrint`:
 * lo que importa es el papel. Y dos cosas que este archivo existe para vigilar:
 *
 *   · **que siga siendo corto.** El del origen mide 38 renglones con texto;
 *     éste nació en 21, sacando lo que no dice nada (correlativos en cero,
 *     tarjeta y crédito listados uno por uno, las líneas sin monto). Un tope
 *     holgado lo deja crecer de vuelta sin que nadie lo note.
 *   · **que la diferencia sea la del TIQUETE.** El origen imprime la que se le
 *     manda sin recalcularla, y la que el portal calculaba estaba mal por
 *     $401.80 en este mismo corte. Ver la nota de `corteTicket.js`.
 */

// Ya pasado por `diferenciaDelCorte`, que es lo que recibe el constructor: el
// esperado y la diferencia son los del TIQUETE (520.41 / -29.56), no los que
// calculó el formulario del origen (922.21 / -431.36).
const CORTE_14323 = {
    ok: true, id_corte: 14323, fuente: 'ticket',
    esperado: 520.41, contado: 490.85, diferencia: -29.56,
    // Ese día no hubo cobros de crédito desde el portal — el módulo todavía no
    // existía. Va como CERO y no ausente: `null` significa «no se pudo leer», y
    // el papel lo declara. Ver el bloque de aviso en `construirComprobanteDeCorte`.
    cobros_portal_efectivo: 0,
    segun_el_sistema: { esperado: 922.21, diferencia: -431.36 },
    nota: {
        titulo: 'Los cobros de crédito se contaron de más',
        detalle: 'La otra cifra dice -$431.36 porque suma $100.45 4 veces de más.',
    },
    tiquete: {
        empleado: 'RODRIGO EDUARDO MARQUEZ', caja: '4', turno: '1',
        total_caja: 520.41, cobros_credito: 100.45, contado: 490.85,
        // Las piezas con las que se DERIVA el cobro de la propia suma:
        // 581.61 - 161.65 + 100.45 = 520.41, y 581.61 = 11.31 + 570.30.
        subtotal: 581.61, vales: 161.65,
        // Como vinieron del tiquete: el rótulo es del origen, no una lista de acá.
        formas: [
            { rotulo: 'Pagos con tarjeta', monto: 59.20 },
            { rotulo: 'Ventas al credito', monto: 112.10 },
        ],
        lineas: [
            { rotulo: '(+) Ingresos', monto: 11.31 },
            { rotulo: '(+) Venta', monto: 570.30 },
            { rotulo: '(-) Vales', monto: 161.65 },
            { rotulo: '(+) Cobros credito', monto: 100.45 },
        ],
    },
};

const armar = (resultado) => construirComprobanteDeCorte({
    resultado, sala: 'Salud 3', hechoPor: 'EDWIN NUNEZ',
    hechoAt: '2026-08-31T19:08:24Z',
});

// El ancho real del rollo en letra chica. Ver COLUMNAS en `ticketCampos`.
const enRollo = (t) => textoParaElRollo({ ancho: 58, ...t });

describe('comprobante del corte', () => {
    it('imprime la cuenta completa de la caja', () => {
        const papel = enRollo(armar(CORTE_14323));
        for (const linea of ['(+) Ingresos', '(+) Venta', '(-) Vales', '(+) Cobros credito']) {
            expect(papel).toContain(linea);
        }
        // Los montos, para que la suma se pueda rehacer sobre el papel.
        for (const monto of ['11.31', '570.30', '161.65', '100.45']) {
            expect(papel).toContain(monto);
        }
    });

    it('dice la diferencia del tiquete, no la del formulario', () => {
        const papel = enRollo(armar(CORTE_14323));
        expect(papel).toContain('$490.85');   // lo contado
        expect(papel).toContain('Diferencia');
        expect(papel).toContain('-$29.56');
        // El número que el origen imprime en su propio papel para este corte no
        // aparece en NINGUNA parte: el papel lleva sólo los valores corregidos.
        expect(papel).not.toContain('431.36');
    });

    it('la direccion la dice el signo, no un rotulo que cambia', () => {
        // Decisión del usuario (31-ago): el rótulo es fijo y el signo manda, así
        // la misma posición del papel siempre significa lo mismo.
        const sobra = { ...CORTE_14323, contado: 560.00, diferencia: 39.59 };
        const papelSobra = enRollo(armar(sobra));
        expect(papelSobra).toContain('+$39.59');
        expect(papelSobra).not.toContain('SOBRA');

        const cuadra = { ...CORTE_14323, contado: 520.41, diferencia: 0 };
        const papelCuadra = enRollo(armar(cuadra));
        // El cero SIN signo: «+$0.00» dice que sobró nada.
        expect(papelCuadra).toContain('$0.00');
        expect(papelCuadra).not.toContain('+$0.00');
        expect(papelCuadra).not.toContain('CUADRA');
        expect(papelCuadra).not.toContain('FALTA');
    });

    it('no repite «debia haber» junto a la diferencia', () => {
        // Decisión del usuario (31-ago): en los totales van sólo el contado y la
        // diferencia. Lo que debía haber es la suma del bloque de arriba, y un
        // tercer número grande le compite al único que hay que mirar.
        const papel = enRollo(armar(CORTE_14323));
        expect(papel.toLowerCase()).not.toContain('debia haber');
    });

    it('separa lo que no pasa por la caja', () => {
        const papel = enRollo(armar(CORTE_14323));
        expect(papel).toContain('No pasa por la caja');
        expect(papel).toContain('59.20');
        expect(papel).toContain('112.10');
    });

    it('pinta las formas COMO VENGAN, no dos escritas a mano', () => {
        // La regresión que este caso caza: una forma que el origen empiece a
        // imprimir mañana —cheque, transferencia— tiene que salir sola. Con
        // «tarjeta» y «credito» fijas no sale como cero: DESAPARECE, y el papel
        // sigue cuadrando diciendo de menos. Ya costó los $2.20 de Salud 2 del
        // 13-ago en el desglose del cierre.
        const conCheque = {
            ...CORTE_14323,
            tiquete: {
                ...CORTE_14323.tiquete,
                formas: [
                    ...CORTE_14323.tiquete.formas,
                    { rotulo: 'Pagos con cheque', monto: 2.20 },
                ],
            },
        };
        const papel = enRollo(armar(conCheque));
        expect(papel).toContain('Pagos con cheque');
        expect(papel).toContain('2.20');
    });

    it('no imprime el bloque cuando no hubo ninguna otra forma', () => {
        const sinOtros = { ...CORTE_14323, tiquete: { ...CORTE_14323.tiquete, formas: [] } };
        expect(enRollo(armar(sinOtros))).not.toContain('No pasa por la caja');
    });

    it('avisa en el papel cuando NO se pudo leer el tiquete', () => {
        const sinTiquete = {
            ...CORTE_14323, nota: null,
            tiquete: { ...CORTE_14323.tiquete, total_caja: null },
        };
        expect(enRollo(armar(sinTiquete)).toUpperCase()).toContain('ATENCION');
        // Y cuando sí se leyó, no hay ningún aviso que distraiga.
        expect(enRollo(armar(CORTE_14323)).toUpperCase()).not.toContain('ATENCION');
    });

    it('avisa cuando no se pudo leer el efectivo de los cobros del portal', () => {
        /* Ese efectivo está en el cajón y el comprobante del sistema no lo suma
         * a su esperado. Sin el dato la diferencia impresa está de más justo por
         * ese monto, y un cero silencioso ahí ya costó anunciar +$78.40 de
         * sobrante sobre un faltante de $9.85 (Salud 4, 2026-09-02). */
        const sinDato = { ...CORTE_14323, cobros_portal_efectivo: null };
        expect(enRollo(armar(sinDato)).toUpperCase()).toContain('ATENCION');
        // Y cero NO es lo mismo que ausente: un día sin cobros no lleva aviso.
        expect(enRollo(armar(CORTE_14323)).toUpperCase()).not.toContain('ATENCION');
    });

    it('se mantiene corto', () => {
        const papel = enRollo(armar(CORTE_14323));
        // Sin los renglones vacíos del avance de papel del final. 20 es lo
        // MEDIDO el 2026-08-31, no un número redondo: el tope existe para que
        // el papel no vuelva a crecer, así que un margen holgado no vigila nada.
        const utiles = papel.split('\n').filter((l) => l.trim()).length;
        expect(utiles).toBeLessThanOrEqual(20);
    });

    it('es solo ASCII: el rollo no lee UTF-8', () => {
        const papel = enRollo(armar(CORTE_14323));
        // Los códigos de impresora sí son bytes de control; lo que se vigila son
        // las tildes y eñes, que salen como basura en el papel («NUÑEZ» →
        // `NUÆEZ`, medido la primera vez que se imprimió de verdad).
        expect(papel).not.toMatch(/[áéíóúÁÉÍÓÚñÑ¿¡]/);
    });
});


/*
 * ── EL MISMO PAPEL, ARMADO DESDE LA FILA ───────────────────────────────────
 *
 * Un corte se confirma desde cuatro pantallas y sólo una tenía en memoria la
 * respuesta de `hacer-corte-caja`: las otras tres confirmaban sin papel. Desde
 * el 4-sep el comprobante lo arma `resultadoDeLaFila` con la fila de
 * `cortes_caja`, así que hay DOS caminos al mismo documento.
 *
 * Estos casos los enfrentan sobre el MISMO corte real —el 14323, tal como está
 * guardado en producción— y exigen que el rollo salga idéntico. Si divergen, el
 * papel del corte recién hecho y el del mismo corte confirmado desde el módulo
 * dejarían de ser el mismo documento, y nadie podría notarlo: los dos salen
 * bien impresos.
 */
const FILA_14323 = {
    id: 597, branch_id: 27, erp_corte_id: 14323, tipo: 'C',
    fecha: '2026-08-31', hora: '13:08:24', turno: 1, caja_erp: 4,
    empleado_texto: 'RODRIGO EDUARDO MARQUEZ',
    // Como los devuelve PostgREST: `numeric` viaja como cadena.
    total_declarado: '490.85', diferencia_erp: '-431.36', esperado: '922.21',
    tk_saldo_inicial: '0.00', tk_saldo_caja_chica: '0.00',
    tk_ingresos: '11.31', tk_venta: '570.30', tk_subtotal: '581.61',
    tk_vales: '161.65', tk_cobros_credito: '100.45', tk_total_caja: '520.41',
    tk_retencion: '0.00', tk_devoluciones: '0.00',
    cobros_portal_efectivo: '0.00',
    ticket: ' FARMACIA LA SALUD 3\n \n CORTE TIPO: CORTE DE CAJA\n'
        + ' CORTE DE CAJA  : 14323\n_________________________________\n'
        + ' FECHA: 31-08-2026  HORA:1:08 PM\n EMPLEADO: RODRIGO EDUARDO MARQUEZ\n'
        + ' CAJA : 4  TURNO: 1\n_________________________________\n'
        + ' TIQUETES:     0000000   0000000\n FACTURAS:           0         0\n'
        + ' FISCALES:           0         0\n\n SALDO INICIAL $:           0.00\n'
        + ' SALDO CAJA CHICA $:        0.00\n (+)INGRESOS $:            11.31\n'
        + ' (+) VENTA $:             570.30\n_________________________________\n'
        + ' SUBTOTAL $:              581.61\n (-)VALES $:             161.65\n'
        + '_________________________________\n'
        + ' (+) COBROS CREDITO $:            100.45\n'
        + '_________________________________\n TOTAL CAJA $:            520.41\n\n'
        + ' (-) RETENCION $:           0.00\n (-)DEVOLUCIONES$:          0.00\n'
        + '_________________________________\n EFECTIVO $:              490.85\n'
        + ' DIFERENCIA $:           -431.36\n\nPAGOS CON TARJETA\n'
        + 'COF                               8.70\nCOF                              30.25\n'
        + 'COF                               7.65\nCOF                              12.60\n'
        + 'TOTAL                            59.20\nVENTAS AL CREDITO\n'
        + 'COF                              16.30\nCOF                               0.75\n'
        + 'COF                              95.05\nTOTAL                           112.10\n\n',
};

describe('el comprobante armado desde la fila', () => {
    it('sale igual que el del corte recien hecho', () => {
        // Los dos caminos, el mismo corte, el mismo papel. Es la comparación que
        // importa: cualquier diferencia acá es un papel que dice otra cosa según
        // desde dónde se confirme.
        expect(enRollo(armar(resultadoDeLaFila(FILA_14323))))
            .toBe(enRollo(armar(CORTE_14323)));
    });

    it('la diferencia sale del tiquete, tambien por este camino', () => {
        const r = resultadoDeLaFila(FILA_14323);
        // -29.56 es la del tiquete; -431.36 la que guardó el formulario del
        // origen, que cuenta los cobros de crédito 4 veces de más.
        expect(r.diferencia).toBeCloseTo(-29.56, 2);
        expect(r.esperado).toBeCloseTo(520.41, 2);
        expect(r.fuente).toBe('ticket');
    });

    it('no inventa lineas que el tiquete no trae', () => {
        /* La columna en cero NO es una línea del papel: el tiquete no la
         * imprime y un cero inventado se lee como un dato medido. Verificado
         * sobre los 557 cortes tipo C con tiquete guardado: la columna está en
         * `null` exactamente cuando falta la línea, 0 discrepancias. */
        const { lineas } = resultadoDeLaFila(FILA_14323).tiquete;
        expect(lineas.map((l) => l.rotulo)).toEqual([
            '(+) Ingresos', '(+) Venta', '(-) Vales', '(+) Cobros credito',
        ]);
    });

    it('la venta en CERO si sale: es la caja que no vendio', () => {
        const sinVender = { ...FILA_14323, tk_venta: '0.00' };
        const rotulos = resultadoDeLaFila(sinVender).tiquete.lineas.map((l) => l.rotulo);
        expect(rotulos).toContain('(+) Venta');
    });

    it('lee las formas del tiquete COMO VENGAN, no de dos columnas fijas', () => {
        /* La fila tiene `tk_tarjeta` y `tk_credito`, y armar el papel con ellas
         * sería volver a escribir a mano la lista de formas: una que el origen
         * empiece a imprimir mañana no saldría como cero, DESAPARECERÍA. Por eso
         * se leen del texto. */
        const conCheque = {
            ...FILA_14323,
            ticket: FILA_14323.ticket
                + 'PAGOS CON CHEQUE\nCOF                               2.20\n'
                + 'TOTAL                             2.20\n\n',
        };
        const papel = enRollo(armar(resultadoDeLaFila(conCheque)));
        expect(papel).toContain('Pagos con cheque');
        expect(papel).toContain('2.20');
    });

    it('encuentra las formas tambien cuando el corte cuadro', () => {
        /* Un corte exacto NO imprime la línea DIFERENCIA: el papel dice «EXACTO
         * FELICIDADES». Sin esa segunda ancla las formas se perderían enteras y
         * el papel parecería haber perdido plata. Medido: de los 557 cortes tipo
         * C guardados, 179 traen sólo esta. */
        const exacto = {
            ...FILA_14323,
            ticket: FILA_14323.ticket.replace(
                ' DIFERENCIA $:           -431.36', ' EXACTO FELICIDADES   $:     0.00',
            ),
        };
        const { formas } = resultadoDeLaFila(exacto).tiquete;
        expect(formas.map((f) => f.rotulo)).toEqual(['Pagos con tarjeta', 'Ventas al credito']);
    });

    it('sin tiquete guardado no inventa formas ni revienta', () => {
        const r = resultadoDeLaFila({ ...FILA_14323, ticket: null });
        expect(r.tiquete.formas).toEqual([]);
        expect(enRollo(armar(r))).not.toContain('No pasa por la caja');
    });
});
