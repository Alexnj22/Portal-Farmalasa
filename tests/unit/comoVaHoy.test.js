import { describe, it, expect } from 'vitest';
import { armarDia, ritmoDelDia, relojDelDia } from '@nucleo/utils/comoVaHoy.js';

const tipica = [{ hora: 8, total: 100 }, { hora: 9, total: 100 }, { hora: 10, total: 200 }];

describe('armarDia', () => {
    it('lo esperado a media hora es la meta por la parte típica que ya pasó', () => {
        const d = armarDia({ hoy: [{ hora: 8, total: 50 }], tipica, metaDia: 800, reloj: { hora: 9, minuto: 30 } });
        // A las 9:30 normalmente va 100 + 50 de 400 = 37.5 % → 300 de 800.
        expect(d.esperadoAhora).toBe(300);
        expect(d.vendido).toBe(50);
        expect(d.serie.map((s) => s.real)).toEqual([50, 50, null]);
        expect(d.serie.at(-1).esperado).toBe(800);
    });
    it('sin meta compara contra el día típico', () => {
        const d = armarDia({ hoy: [], tipica, metaDia: null, reloj: { hora: 11, minuto: 0 } });
        expect(d.base).toBe(400);
        expect(d.esperadoAhora).toBe(400);
        expect(d.conMeta).toBe(false);
    });
    it('sin historia no hay con qué comparar', () => {
        expect(armarDia({ hoy: [{ hora: 8, total: 5 }], tipica: [], metaDia: 100, reloj: { hora: 9, minuto: 0 } })).toBeNull();
    });
    it('antes de abrir no se espera nada', () => {
        const d = armarDia({ hoy: [], tipica, metaDia: 800, reloj: { hora: 6, minuto: 0 } });
        expect(d.esperadoAhora).toBe(0);
        expect(ritmoDelDia(d)).toBeNull();
    });
});

describe('ritmoDelDia', () => {
    it('clasifica con un margen de 5 %', () => {
        expect(ritmoDelDia({ vendido: 106, esperadoAhora: 100 })).toBe('arriba');
        expect(ritmoDelDia({ vendido: 96, esperadoAhora: 100 })).toBe('ritmo');
        expect(ritmoDelDia({ vendido: 80, esperadoAhora: 100 })).toBe('bajo');
    });
});

describe('relojDelDia', () => {
    it('lee la hora de El Salvador (UTC-6)', () => {
        expect(relojDelDia(Date.UTC(2026, 10, 17, 20, 15))).toEqual({ hora: 14, minuto: 15 });
    });
});

import { datosDeApoyo } from '@nucleo/utils/comoVaHoy.js';

describe('datosDeApoyo', () => {
    const dia = {
        hoy: [{ hora: 8, parte: 0.1, ventas: 10 }, { hora: 9, parte: 0.05, ventas: 4 }],
        tipica: [{ hora: 8, parte: 0.1, ventas: 8 }, { hora: 9, parte: 0.1, ventas: 8 }, { hora: 10, parte: 0.3, ventas: 20 }, { hora: 11, parte: 0.2, ventas: 10 }],
        semana_pasada: [{ hora: 8, parte: 0.05 }, { hora: 9, parte: 0.1 }],
    };
    it('compara contra lo normal a esta hora y busca la hora fuerte', () => {
        const d = datosDeApoyo(dia, { hora: 9, minuto: 30 });
        expect(d.ventasHoy).toBe(14);
        expect(d.ventasVsNormal).toBe(17);   // 14 contra 12
        expect(d.horaFuerte).toBe(10);
        expect(d.vsSemanaPasada).toBe(50);   // 0.15 contra 0.1
    });
});
