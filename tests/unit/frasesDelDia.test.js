import { describe, expect, it } from 'vitest';
import { diaDeFrase, estadosDeFrases, faltaEnFrase, filaDeFrase, fraseDeUnDia, fraseValida } from '@nucleo/utils/ofertasClientes';

const HOY = '2026-11-03';

describe('frases del día', () => {
    it('el día cambia a las 8:00 de El Salvador', () => {
        expect(diaDeFrase(Date.UTC(2026, 10, 3, 13, 59))).toBe('2026-11-02'); // 07:59 SV
        expect(diaDeFrase(Date.UTC(2026, 10, 3, 14, 0))).toBe('2026-11-03'); // 08:00 SV
        expect(diaDeFrase(Date.UTC(2026, 10, 4, 5, 0))).toBe('2026-11-03'); // 23:00 SV
    });

    it('valida largo, categoría y fecha si se programa', () => {
        expect(fraseValida({ texto: 'Hola', categoria: 'animo' })).toBe(false);
        expect(fraseValida({ texto: 'Hoy es un buen día.', categoria: 'animo' })).toBe(true);
        expect(faltaEnFrase({ texto: 'Hola', categoria: 'animo' })?.campo).toBe('texto');
        expect(faltaEnFrase({ texto: 'Hoy es un buen día.', categoria: 'x' })?.campo).toBe('categoria');
        expect(faltaEnFrase({ texto: 'Hoy es un buen día.', categoria: 'animo', programada: true, fecha: '' })?.campo).toBe('fecha');
        expect(fraseValida({ texto: 'Hoy es un buen día.', categoria: 'otra' })).toBe(false);
        expect(fraseValida({ texto: 'Hoy es un buen día.', categoria: 'salud', programada: true, fecha: '' })).toBe(false);
        expect(filaDeFrase({ texto: '  Hola mundo ', categoria: 'calma', programada: false, fecha: '2026-11-05' }))
            .toEqual({ texto: 'Hola mundo', categoria: 'calma', fecha: null, activa: true });
    });

    const frases = [
        { id: 1, activa: true, fecha: null, mostrada_el: '2026-11-01' },
        { id: 2, activa: true, fecha: null, mostrada_el: null },
        { id: 3, activa: true, fecha: null, mostrada_el: null },
        { id: 4, activa: true, fecha: '2026-11-05', mostrada_el: null },
        { id: 5, activa: false, fecha: null, mostrada_el: null },
        { id: 6, activa: true, fecha: HOY, mostrada_el: null },
    ];

    it('estados y lugar en la cola', () => {
        const e = estadosDeFrases(frases, HOY);
        expect(e.get(1).key).toBe('salio');
        expect(e.get(2)).toMatchObject({ key: 'cola', lugar: 1 });
        expect(e.get(3)).toMatchObject({ key: 'cola', lugar: 2 });
        expect(e.get(4).key).toBe('programada');
        expect(e.get(5).key).toBe('pausada');
        expect(e.get(6).key).toBe('hoy');
    });

    it('qué sale cada día: lo programado no gasta cola', () => {
        expect(fraseDeUnDia(frases, HOY, HOY).id).toBe(6);
        expect(fraseDeUnDia(frases, '2026-11-04', HOY).id).toBe(2);
        expect(fraseDeUnDia(frases, '2026-11-05', HOY).id).toBe(4);
        expect(fraseDeUnDia(frases, '2026-11-06', HOY).id).toBe(3);
        expect(fraseDeUnDia(frases, '2026-11-07', HOY)).toBeNull();
    });

    it('si hoy todavía no salió ninguna, hoy gasta la primera de la cola', () => {
        const sinHoy = frases.filter((f) => f.id !== 6);
        expect(fraseDeUnDia(sinHoy, HOY, HOY).id).toBe(2);
        expect(fraseDeUnDia(sinHoy, '2026-11-04', HOY).id).toBe(3);
    });
});
