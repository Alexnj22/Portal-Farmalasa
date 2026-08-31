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

const CORTE_14323 = {
    ok: true, id_corte: 14323, del_tiquete: true,
    esperado: 520.41, contado: 490.85, diferencia: -29.56,
    tiquete: {
        empleado: 'RODRIGO EDUARDO MARQUEZ', caja: '4', turno: '1',
        tarjeta: 59.20, credito: 112.10,
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
        expect(papel).toContain('$520.41');   // lo que debía haber
        expect(papel).toContain('$490.85');   // lo contado
        expect(papel).toContain('FALTA');
        expect(papel).toContain('$29.56');
        // El número que el origen imprime en su propio papel para este corte.
        // Si aparece acá, alguien volvió a sacar la cuenta del formulario.
        expect(papel).not.toContain('431.36');
    });

    it('separa lo que no pasa por la caja', () => {
        const papel = enRollo(armar(CORTE_14323));
        expect(papel).toContain('No pasa por la caja');
        expect(papel).toContain('59.20');
        expect(papel).toContain('112.10');
    });

    it('no imprime el bloque cuando no hubo tarjeta ni credito', () => {
        const sinOtros = {
            ...CORTE_14323,
            tiquete: { ...CORTE_14323.tiquete, tarjeta: null, credito: null },
        };
        expect(enRollo(armar(sinOtros))).not.toContain('No pasa por la caja');
    });

    it('avisa en el papel cuando la cuenta NO salio del tiquete', () => {
        const calculado = { ...CORTE_14323, del_tiquete: false };
        expect(enRollo(armar(calculado)).toUpperCase()).toContain('ATENCION');
        // Y cuando sí salió del tiquete, no hay ningún aviso que distraiga.
        expect(enRollo(armar(CORTE_14323)).toUpperCase()).not.toContain('ATENCION');
    });

    it('se mantiene corto', () => {
        const papel = enRollo(armar(CORTE_14323));
        // Sin los renglones vacíos del avance de papel del final. 21 es lo
        // MEDIDO el 2026-08-31, no un número redondo: el tope existe para que
        // el papel no vuelva a crecer, así que un margen holgado no vigila nada.
        const utiles = papel.split('\n').filter((l) => l.trim()).length;
        expect(utiles).toBeLessThanOrEqual(21);
    });

    it('es solo ASCII: el rollo no lee UTF-8', () => {
        const papel = enRollo(armar(CORTE_14323));
        // Los códigos de impresora sí son bytes de control; lo que se vigila son
        // las tildes y eñes, que salen como basura en el papel («NUÑEZ» →
        // `NUÆEZ`, medido la primera vez que se imprimió de verdad).
        expect(papel).not.toMatch(/[áéíóúÁÉÍÓÚñÑ¿¡]/);
    });
});
