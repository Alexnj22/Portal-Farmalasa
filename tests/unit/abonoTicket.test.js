import { describe, it, expect } from 'vitest';
import { construirComprobanteDeAbono, vencimientoDeReserva, CONDICIONES_DEL_PAPEL } from '../../src/utils/abonoTicket';
import { textoParaElRollo } from '../../src/utils/ticketPrint';

/**
 * La geometría del comprobante de abono, anclada contra el rollo de verdad.
 *
 * Existe por un defecto que el código no puede ver solo: **el rollo sólo sabe
 * maquetar tablas de CUATRO columnas**, y con cualquier otra cantidad
 * `filaDeItem` cae a «primera celda a la izquierda, última a la derecha» y las
 * del medio desaparecen **sin error y sin fila de menos**. La primera versión de
 * este papel usaba tres columnas y salió sin el nombre del producto — que es lo
 * único que el cliente lee para comprobar que le apartaron lo que pidió.
 *
 * Por eso el test mira el TEXTO del rollo y no el objeto: el objeto estaba bien
 * las dos veces.
 */

const ABONO = {
    folio: 'S31000',
    fecha: '2026-09-01',
    vence_el: '2026-09-16',
    cliente_nombre: 'Maria Elena Portillo',
    cliente_telefono: '7712-4408',
    total: 48.75,
    abonado: 15,
    renglones: [
        { nombre: 'Losartan 50 mg', presentacion: 'caja 30 tab', cantidad: 2, precio: 8.9 },
        { nombre: 'Faja lumbar talla M', cantidad: 1, precio: null },
    ],
};

const papel = (abono = ABONO) => textoParaElRollo(construirComprobanteDeAbono({
    abono, sala: 'Salud 3', hechoPor: 'Maribel Alberto', hechoAt: '2026-09-01T21:40:00Z',
}));

describe('comprobante de abono', () => {
    it('imprime el nombre del producto, no sólo cantidad y monto', () => {
        const t = papel();
        expect(t).toContain('Losartan 50 mg caja 30 tab');
        expect(t).toContain('Faja lumbar talla M');
    });

    it('el renglón sin precio no inventa un monto', () => {
        // Ni `$0.00` ni un tentativo: un cero es un precio, y el cliente vuelve
        // con el papel en la mano a exigir el número que dice.
        const soloSinPrecio = papel({ ...ABONO, total: null, renglones: [ABONO.renglones[1]] });
        expect(soloSinPrecio).not.toContain('$0.00');
        expect(soloSinPrecio).toContain('Por definir');
    });

    it('sin total no promete un saldo pendiente', () => {
        // Sin total no hay resta posible, y poner el abono como si fuera el
        // saldo diría lo contrario de la verdad.
        expect(papel({ ...ABONO, total: null })).not.toContain('Queda pendiente');
        expect(papel()).toContain('Queda pendiente');
    });

    it('lleva el folio, el vencimiento y quién atendió', () => {
        const t = papel();
        expect(t).toContain('S31000');
        expect(t).toContain('16/09/2026');
        expect(t).toContain('Maribel Alberto');
    });

    it('lleva las condiciones del mostrador', () => {
        const t = papel();
        for (const linea of CONDICIONES_DEL_PAPEL) expect(t).toContain(linea);
    });

    it('cabe en el rollo: ningún renglón de texto pasa de 54 columnas', () => {
        /* El ancho del papel en letra chica. Un renglón más largo NO da error:
         * la impresora lo parte donde le toque, y lo que se parte es una cifra.
         *
         * Se miden SÓLO los renglones sin códigos de impresora, y no es pereza:
         * una secuencia ESC/POS lleva bytes IMPRIMIBLES adentro —`\x1d!\x00`
         * tiene un `!`— así que descontar los de control deja el resto contando
         * como columnas y el test acusa al encabezado por un carácter que nunca
         * se imprime. Un instrumento que acusa al que hizo bien el trabajo se
         * termina desactivando. Los renglones que importan —los productos, las
         * cifras, las condiciones— no llevan ningún código. */
        // eslint-disable-next-line no-control-regex
        const sinCodigos = papel().split('\n').filter((l) => !/[\x00-\x1f]/.test(l));
        expect(sinCodigos.length).toBeGreaterThan(10);   // el instrumento midió algo
        for (const linea of sinCodigos) expect(linea.length).toBeLessThanOrEqual(54);
    });

    it('el vencimiento se calcula sin que el huso le reste un día', () => {
        // Una fecha leída como medianoche retrocede un día en cualquier huso al
        // oeste. Acá el día que vence es el que dice el papel.
        expect(vencimientoDeReserva('2026-09-01')).toBe('2026-09-16');
        expect(vencimientoDeReserva('2026-12-25')).toBe('2027-01-09');
    });
});
