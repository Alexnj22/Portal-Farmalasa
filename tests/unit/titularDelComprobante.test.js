import { describe, it, expect } from 'vitest';
import { esElTitular, elTitularEstaEnElPapel } from '../../supabase/functions/_shared/titular.ts';

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
