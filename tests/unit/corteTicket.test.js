import { describe, expect, it } from 'vitest';
import { construirComprobanteDeCorte } from '../../src/utils/corteTicket';
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
    segun_el_sistema: { esperado: 922.21, diferencia: -431.36 },
    nota: {
        titulo: 'Los cobros de crédito se contaron de más',
        detalle: 'La otra cifra dice -$431.36 porque suma $100.45 4 veces de más.',
    },
    tiquete: {
        empleado: 'RODRIGO EDUARDO MARQUEZ', caja: '4', turno: '1',
        total_caja: 520.41, cobros_credito: 100.45, contado: 490.85,
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
