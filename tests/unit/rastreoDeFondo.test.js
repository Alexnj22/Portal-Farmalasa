import { describe, it, expect } from 'vitest';
import { CADENCIAS, cadenciaDe, quienesEscriben, repartoSigueEnRuta, rutasVigentes, sinRutas, tocaEscribir, ultimaPosicion } from '@nucleo/utils/rastreoDeFondo';

describe('rastreo de fondo', () => {
    it('Torogoz de ayer no cuenta; el reparto no caduca por fecha', () => {
        const e = rutasVigentes({ reparto: { rutaId: 7 }, torogoz: { yo: 'u1', fecha: '2026-10-06' } }, '2026-10-07');
        expect(e).toEqual({ reparto: { rutaId: '7' } });
        expect(rutasVigentes({ torogoz: { yo: 'u1', fecha: '2026-10-07' } }, '2026-10-07')).toEqual({ torogoz: { yo: 'u1', fecha: '2026-10-07' } });
        expect(sinRutas(rutasVigentes(null, '2026-10-07'))).toBe(true);
    });

    it('la cadencia es la más frecuente de las vivas', () => {
        expect(cadenciaDe({})).toBeNull();
        expect(cadenciaDe({ torogoz: {} })).toEqual(CADENCIAS.torogoz);
        expect(cadenciaDe({ torogoz: {}, reparto: {} })).toEqual({ intervaloMs: 30_000, distanciaM: 50 });
    });

    it('la primera posición se escribe siempre y después cada intervalo, con holgura', () => {
        expect(tocaEscribir('reparto', undefined, 1000)).toBe(true);
        expect(tocaEscribir('reparto', 0, 20_000)).toBe(false);
        expect(tocaEscribir('reparto', 0, 27_000)).toBe(true);
        expect(tocaEscribir('torogoz', 0, 30_000)).toBe(false);
        expect(tocaEscribir('otra', undefined, 1)).toBe(false);
    });

    it('cada ruta lleva su propio reloj', () => {
        const estado = { reparto: { rutaId: '1' }, torogoz: { yo: 'u', fecha: 'h' } };
        const a = quienesEscriben(estado, {}, 0);
        expect(a.tipos.sort()).toEqual(['reparto', 'torogoz']);
        const b = quienesEscriben(estado, a.ultimas, 30_000);
        expect(b.tipos).toEqual(['reparto']);
        const c = quienesEscriben(estado, b.ultimas, 60_000);
        expect(c.tipos.sort()).toEqual(['reparto', 'torogoz']);
    });

    it('del lote toma la posición más reciente con coordenadas', () => {
        const p = ultimaPosicion([
            { timestamp: 1, coords: { latitude: 1, longitude: 1, accuracy: 5 } },
            { timestamp: 3, coords: { latitude: 3, longitude: 3 } },
            { timestamp: 9, coords: { latitude: null, longitude: 9 } },
        ]);
        expect(p).toEqual({ lat: 3, lng: 3, precision: null, at: 3 });
        expect(ultimaPosicion([])).toBeNull();
    });

    it('el reparto rastrea sólo en ruta', () => {
        expect(repartoSigueEnRuta('en_ruta')).toBe(true);
        expect(repartoSigueEnRuta('completada')).toBe(false);
        expect(repartoSigueEnRuta('pendiente')).toBe(false);
    });
});
