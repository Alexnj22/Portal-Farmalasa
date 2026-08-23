// Metas — los meses de El Salvador y el histórico que alimenta el gráfico.
//
// El área no tenía ni una prueba. Lo que se prueba acá es la aritmética que
// decide QUÉ MES está mirando el portal, y el resumen mensual que se dibuja.
//
// El riesgo del mes es el mismo de siempre y es silencioso: contado en UTC,
// desde las 18:00 de El Salvador el portal ya está en «mañana» — y el último
// día del mes eso significa que la meta de agosto se mira contra el mes de
// septiembre. Nadie ve un error: ve un cumplimiento raro.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    ymHoySV, diaHoySV, ymSumar, ymLabel, ymLabelCorto,
    agruparHistoricoPorMes, tramoLabel, SALAS_VENTA, YM_INICIO_HISTORIA,
} from '../../src/views/metas/metasUtils';

afterEach(() => vi.useRealTimers());
const enUTC = (iso) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)); };

describe('el mes en curso es el de El Salvador', () => {
    it('el último día del mes a las 19:00 SV sigue siendo ese mes', () => {
        // 2026-08-31 19:00 SV = 2026-09-01 01:00 UTC. Con la fecha UTC el portal
        // ya diría septiembre y la meta de agosto se miraría contra el mes que
        // viene, a un día de cerrarla.
        enUTC('2026-09-01T01:00:00Z');
        expect(ymHoySV()).toBe('2026-08');
        expect(diaHoySV()).toBe(31);
    });

    it('pasada la medianoche salvadoreña cambia el mes', () => {
        enUTC('2026-09-01T06:00:00Z');   // 00:00 SV del 1 de septiembre
        expect(ymHoySV()).toBe('2026-09');
        expect(diaHoySV()).toBe(1);
    });
});

describe('correr meses', () => {
    it('suma y resta dentro del año', () => {
        expect(ymSumar('2026-08', 1)).toBe('2026-09');
        expect(ymSumar('2026-08', -1)).toBe('2026-07');
        expect(ymSumar('2026-08', 0)).toBe('2026-08');
    });

    it('cruza el fin de año en las dos direcciones', () => {
        // Diciembre + 1 y enero − 1 son donde se rompe una resta de meses hecha
        // a mano, y los dos son bordes que el portal pisa cada año.
        expect(ymSumar('2026-12', 1)).toBe('2027-01');
        expect(ymSumar('2026-01', -1)).toBe('2025-12');
        expect(ymSumar('2026-01', -13)).toBe('2024-12');
        expect(ymSumar('2025-05', 12)).toBe('2026-05');
    });

    it('el mes siempre lleva dos cifras', () => {
        // Sin el relleno, '2026-9' ordena DESPUÉS de '2026-10' en cualquier
        // comparación de texto — y el histórico se ordena por texto.
        expect(ymSumar('2026-08', 1)).toBe('2026-09');
        expect(ymSumar('2026-12', -3)).toBe('2026-09');
        expect(ymSumar('2026-01', 0)).toBe('2026-01');
    });

    it('los meses ordenan bien como texto, que es como se ordenan', () => {
        const meses = ['2026-10', '2026-09', '2026-01', '2025-12'];
        expect([...meses].sort((a, b) => a.localeCompare(b)))
            .toEqual(['2025-12', '2026-01', '2026-09', '2026-10']);
    });

    it('los rótulos nombran el mes en español', () => {
        expect(ymLabel('2026-08')).toBe('Agosto 2026');
        expect(ymLabel('2026-01')).toBe('Enero 2026');
        expect(ymLabel('2026-12')).toBe('Diciembre 2026');
        expect(ymLabelCorto('2026-08')).toBe('Ago 2026');
    });
});

describe('el histórico agrupado por mes', () => {
    const filas = [
        { year_month: '2026-07', monto_meta: 1000, venta_total: 900 },
        { year_month: '2026-07', monto_meta: 1000, venta_total: 1100 },   // otra sala
        { year_month: '2026-08', monto_meta: 2000, venta_total: 2000 },
    ];

    it('suma las salas de un mismo mes en un solo punto', () => {
        const r = agruparHistoricoPorMes(filas);
        expect(r).toHaveLength(2);
        expect(r[0]).toMatchObject({ ym: '2026-07', meta: 2000, venta: 2000, pct: 100 });
        expect(r[1]).toMatchObject({ ym: '2026-08', meta: 2000, venta: 2000, pct: 100 });
    });

    it('devuelve los meses en orden cronológico', () => {
        const desordenadas = [...filas].reverse();
        expect(agruparHistoricoPorMes(desordenadas).map(x => x.ym)).toEqual(['2026-07', '2026-08']);
    });

    it('un mes SIN meta no cuenta — sin meta no hay cumplimiento', () => {
        const conNula = [...filas, { year_month: '2026-09', monto_meta: null, venta_total: 5000 }];
        expect(agruparHistoricoPorMes(conNula).map(x => x.ym)).toEqual(['2026-07', '2026-08']);
    });

    it('el porcentaje lleva un decimal y no se inventa con meta en cero', () => {
        const r = agruparHistoricoPorMes([{ year_month: '2026-08', monto_meta: 3000, venta_total: 1000 }]);
        expect(r[0].pct).toBe(33.3);
        // Meta en cero: `pct` es null y NO cero. Cero se lee como «no vendió
        // nada»; null se lee como «no hay contra qué medir», que es lo cierto.
        const cero = agruparHistoricoPorMes([{ year_month: '2026-08', monto_meta: 0, venta_total: 1000 }]);
        expect(cero[0].pct).toBeNull();
    });

    it('se queda con los últimos N meses, no con los primeros', () => {
        const doce = Array.from({ length: 14 }, (_, i) => ({
            year_month: ymSumar('2025-05', i), monto_meta: 100, venta_total: 100,
        }));
        const r = agruparHistoricoPorMes(doce, 3);
        expect(r.map(x => x.ym)).toEqual(['2026-04', '2026-05', '2026-06']);
    });

    it('sin filas no rompe', () => {
        expect(agruparHistoricoPorMes([])).toEqual([]);
        expect(agruparHistoricoPorMes(null)).toEqual([]);
    });
});

describe('el nombre del tramo depende de si el bono está activo', () => {
    it('con bono habla de bono, sin bono habla de la meta', () => {
        // Regla del usuario: con las bonificaciones apagadas la pantalla no puede
        // nombrar un bono que nadie va a cobrar.
        expect(tramoLabel('completo', true)).toBe('Bono completo');
        expect(tramoLabel('completo', false)).toBe('Meta completa');
        expect(tramoLabel('medio', true)).toBe('Medio bono');
        expect(tramoLabel('medio', false)).toBe('Casi la meta');
        expect(tramoLabel('nada', true)).toBe('Sin bono');
        expect(tramoLabel('nada', false)).toBe('Sin meta');
    });

    it('un tramo vacío o desconocido no rotula nada', () => {
        expect(tramoLabel(null, true)).toBeNull();
        expect(tramoLabel('', true)).toBeNull();
        expect(tramoLabel('inventado', true)).toBeNull();
    });
});

describe('las constantes del módulo', () => {
    it('Bodega no está entre las salas que venden', () => {
        // Bodega (erp 6) no vende, así que no tiene meta. Si entrara acá, el
        // tablero mostraría una sala con meta cero y cumplimiento nulo.
        expect(SALAS_VENTA).not.toContain(6);
        expect(SALAS_VENTA).toHaveLength(6);
    });

    it('el histórico arranca donde arrancan las ventas sincronizadas', () => {
        expect(YM_INICIO_HISTORIA).toMatch(/^\d{4}-\d{2}$/);
    });
});
