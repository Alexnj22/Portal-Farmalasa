import { describe, it, expect } from 'vitest';
import { datosDeResumenDeLaManana } from '@nucleo/utils/resumenDeLaManana';

describe('datosDeResumenDeLaManana', () => {
    it('sólo reconoce el aviso RESUMEN_MANANA', () => {
        expect(datosDeResumenDeLaManana({ type: 'SYSTEM', metadata: { renglones: [{ titulo: 'x' }] } })).toBeNull();
        expect(datosDeResumenDeLaManana(null)).toBeNull();
    });

    it('sin renglones legibles devuelve null y la tarjeta queda como siempre', () => {
        expect(datosDeResumenDeLaManana({ type: 'RESUMEN_MANANA', metadata: {} })).toBeNull();
        expect(datosDeResumenDeLaManana({ type: 'RESUMEN_MANANA', metadata: { renglones: [{ titulo: '  ' }, null] } })).toBeNull();
    });

    it('conserva el orden, el enlace de cada tema y descarta lo vacío', () => {
        const d = datosDeResumenDeLaManana({
            type: 'RESUMEN_MANANA',
            metadata: {
                renglones: [
                    { tema: 'hacienda', titulo: 'Una factura no entró a Hacienda anoche', cuerpo: 'x', link: '/facturacion' },
                    { tema: 'creditos', titulo: '23 créditos vencidos · $546.74', cuerpo: '', link: '' },
                    { tema: 'roto' },
                ],
            },
        });
        expect(d.renglones).toEqual([
            { clave: 'hacienda', titulo: 'Una factura no entró a Hacienda anoche', cuerpo: 'x', link: '/facturacion' },
            { clave: 'creditos', titulo: '23 créditos vencidos · $546.74', cuerpo: null, link: null },
        ]);
    });
});
