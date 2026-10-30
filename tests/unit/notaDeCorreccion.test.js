// La nota con que se aplica una corrección de factor le llega a la sala en el
// aviso de «Carga aplicada». Si la sala contó algo que la corrección no cubre,
// la nota lo dice y le pide la solicitud que corresponde (2026-10-30).
import { describe, it, expect } from 'vitest';
import { restoDelConteo, restoEnPresentaciones, notaDeCorreccion } from '@nucleo/data/revisionFactor';

// X-Ray Dol en Salud 2: CAJA 1 → 4 con un BLISTER de 1; el sistema tenía 1.
const xray = { sentido: 'crece', cargar: 3, carga_tipo: 'BLISTER', carga_factor: 1, a: 4, tipo_cambio: 'CAJA', presentacion: 'BLISTER' };

describe('nota de la corrección de factor', () => {
    it('Salud 2 contó 8: la corrección pone 3 y quedan 4 (1 caja) sin ajustar', () => {
        const conteo = { estado: 'DESCUADRE', diferencia: 7 };
        expect(restoDelConteo(xray, conteo)).toBe(4);
        expect(restoEnPresentaciones(xray, 4)).toBe('1 caja');
        expect(notaDeCorreccion(xray, conteo)).toMatch(/No se ajustó 1 caja que contaron de más: si lo tienen, pidan la carga/);
    });
    it('el conteo confirma la corrección: la nota no agrega nada', () => {
        expect(notaDeCorreccion(xray, { estado: 'DESCUADRE', diferencia: 3 })).toBe('Corrección por cambio de presentación.');
    });
    it('sin conteo, o con uno pendiente, tampoco', () => {
        expect(notaDeCorreccion(xray, null)).toBe('Corrección por cambio de presentación.');
        expect(restoDelConteo(xray, { estado: 'PENDIENTE', diferencia: null })).toBe(0);
    });
    it('contó de menos: pide el descarte', () => {
        expect(notaDeCorreccion(xray, { estado: 'DESCUADRE', diferencia: 1 })).toMatch(/No se descontó 2 blister que faltó en el conteo: si no está, pidan el descarte/);
    });
    it('cajas y sueltas', () => {
        expect(restoEnPresentaciones(xray, 6)).toBe('1 caja y 2 blister');
    });
});
