import { describe, it, expect } from 'vitest';
import {
    esElTitular, elTitularEstaEnElPapel, esNuestraFarmacia, elPapelNosNombra,
} from '../../supabase/functions/_shared/titular.ts';

/* Esta prueba existe porque lo que decide este código es si un cliente puede
 * abonar su crédito con el papel que trajo, con el cliente enfrente. Un
 * rechazo de más lo manda a su casa; uno de menos acredita un pago que nunca
 * entró. Ninguno de los dos falla al correr — se descubren en el mostrador.
 *
 * El caso que la originó (2026-09-02): una NOTA DE CARGO de Bancoagrícola.
 * Sus dos únicos nombres son «Transfer365 JOSE RUTILIO ALEMA» —el destino, con
 * el apellido cortado por el banco— y «JOSE MANUEL ANTONIO MENJIVAR MENJIVAR»,
 * que es el titular de la cuenta DEBITADA, o sea quien paga. El portal lo
 * rechazó, y lo habría rechazado por dos motivos independientes: el nombre
 * bueno no sobrevivía a la comparación por estar cortado, y el rótulo «A
 * nombre de» se lee como el beneficiario cuando en una nota de cargo es el
 * ordenante. */
describe('esElTitular — el nombre que el banco imprimió', () => {
    it('acepta el nombre CORTADO, que es el caso que trajo la regla', () => {
        // «ALEMA» es ALEMÁN sin la N: el banco corta a un largo fijo.
        expect(esElTitular('Transfer365 JOSE RUTILIO ALEMA')).toBe(true);
        expect(esElTitular('JOSE RUTILIO ALEMA')).toBe(true);
        expect(esElTitular('JOSE R ALEMAN VASQUE')).toBe(true);
    });

    it('acepta las formas abreviadas e invertidas de siempre', () => {
        expect(esElTitular('JOSÉ RUTILIO ALEMÁN VÁSQUEZ')).toBe(true);
        expect(esElTitular('ALEMAN VASQUEZ JOSE R')).toBe(true);
        expect(esElTitular('J RUTILIO ALEMAN V')).toBe(true);
        expect(esElTitular('jose aleman')).toBe(true);
    });

    it('rechaza a otra persona, aunque comparta el nombre de pila', () => {
        expect(esElTitular('JOSE MANUEL ANTONIO MENJIVAR MENJIVAR')).toBe(false);
        expect(esElTitular('JOSE MARTINEZ')).toBe(false);
        expect(esElTitular('RUTILIO PEREZ')).toBe(false);   // sin apellido nuestro
        expect(esElTitular('')).toBe(false);
        expect(esElTitular(null)).toBe(false);
    });

    it('no confunde un nombre que EMPIEZA igual con uno cortado', () => {
        // El prefijo vale de un lado solo: lo que el banco corta es el nombre
        // impreso, no el nuestro. «JOSEFA» no es «JOSE».
        expect(esElTitular('JOSEFA ALEMANIA')).toBe(false);
    });
});

describe('elTitularEstaEnElPapel — cuando no se sabe en qué casilla está', () => {
    it('reconoce el nombre cortado del destino de la nota de cargo', () => {
        expect(elTitularEstaEnElPapel([
            'JOSE MANUEL ANTONIO MENJIVAR MENJIVAR',
            'Transfer365 JOSE RUTILIO ALEMA',
        ])).toBe(true);
    });

    it('pide TRES palabras, así que un cliente apellidado Vásquez no cuenta', () => {
        // Es la razón de que sea más estricto que la casilla del beneficiario:
        // acá no hay rótulo que respalde, y Vásquez es apellido corriente.
        expect(esElTitular('JOSE VASQUEZ')).toBe(true);              // con rótulo, pasa
        expect(elTitularEstaEnElPapel(['JOSE VASQUEZ'])).toBe(false); // suelto, no
    });

    it('un papel donde no estamos no nos nombra', () => {
        expect(elTitularEstaEnElPapel(['MARIA LOPEZ', 'BANCO AGRICOLA', null])).toBe(false);
        expect(elTitularEstaEnElPapel([])).toBe(false);
        expect(elTitularEstaEnElPapel(undefined)).toBe(false);
    });
});

/* El segundo caso, dos días después (2026-09-04): un PAGO QR. Su único nombre
 * es «FARMACIA LA SALUD QPL» —el COMERCIO con el que el QR está registrado— y
 * el titular de la cuenta no aparece por ningún lado, porque en un pago QR no
 * tiene por qué aparecer. El portal lo rechazó como «de otro beneficiario»
 * con el cliente ya habiendo pagado.
 *
 * O sea que el defecto no era el nombre: era que el portal sabía UNO. */
describe('esNuestraFarmacia — el nombre del COMERCIO, que no es el de la persona', () => {
    it('reconoce el nombre del pago QR que trajo la regla', () => {
        expect(esNuestraFarmacia('FARMACIA LA SALUD QPL')).toBe(true);
    });

    it('reconoce las dos marcas y sus formas de escribirse', () => {
        expect(esNuestraFarmacia('FARMACIA LA SALUD')).toBe(true);
        expect(esNuestraFarmacia('FARMACIA LA POPULAR')).toBe(true);
        expect(esNuestraFarmacia('Farmacias La Popular y La Salud')).toBe(true);
        expect(esNuestraFarmacia('FARM LA SALUD 3')).toBe(true);
    });

    it('acepta el nombre CORTADO, igual que con el de la persona', () => {
        // El banco corta a un largo fijo; ya pasó con «ALEMA».
        expect(esNuestraFarmacia('FARMACIA LA SALU')).toBe(true);
        expect(esNuestraFarmacia('FARMACIA LA POPULA')).toBe(true);
    });

    it('pide las DOS cosas: que diga farmacia y que diga nuestra marca', () => {
        expect(esNuestraFarmacia('FARMACIA SAN JOSE')).toBe(false);   // farmacia ajena
        expect(esNuestraFarmacia('LA POPULAR')).toBe(false);          // sin «farmacia»
        expect(esNuestraFarmacia('TIENDA LA SALUD')).toBe(false);     // no es farmacia
        expect(esNuestraFarmacia('BANCO AGRICOLA')).toBe(false);
        expect(esNuestraFarmacia('')).toBe(false);
        expect(esNuestraFarmacia(null)).toBe(false);
    });
});

describe('elPapelNosNombra — las tres formas de que el papel diga que es nuestro', () => {
    it('el pago QR: sólo el comercio, sin la persona por ningún lado', () => {
        expect(elPapelNosNombra(['FARMACIA LA SALUD QPL'])).toBe(true);
    });

    it('la nota de cargo: la persona, con el apellido cortado', () => {
        expect(elPapelNosNombra([
            'JOSE MANUEL ANTONIO MENJIVAR MENJIVAR', 'Transfer365 JOSE RUTILIO ALEMA',
        ])).toBe(true);
    });

    it('un papel donde no estamos sigue sin nombrarnos', () => {
        expect(elPapelNosNombra(['MARIA LOPEZ', 'FARMACIA SAN JOSE', null])).toBe(false);
        expect(elPapelNosNombra([])).toBe(false);
        expect(elPapelNosNombra(undefined)).toBe(false);
    });
});
