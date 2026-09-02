import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    mesesRecientes, mesAnterior, rotuloMes, fmtVigencia, diasRestantes,
    estadoVisible, esLaboratorio,
} from '../../src/views/promociones/promocionesUtils';

/**
 * Los meses de Promociones, anclados contra un reloj congelado.
 *
 * Existe por un defecto que ningún gate podía ver: `mesesRecientes` recorría el
 * calendario hacia ADELANTE. Devolvía trece meses válidos —cadenas AAAA-MM
 * perfectas, con su rótulo en español— sólo que doce de ellos todavía no
 * existían. No falló nada: el único síntoma fue que la liquidación se armó de
 * septiembre en vez de agosto, y eso se descubrió mirando la fila escrita en la
 * base, no la pantalla.
 *
 * Por eso el test fija el ORDEN y los EXTREMOS de la lista, que es lo que el
 * defecto cambiaba, y no sólo su tamaño ni el formato de sus valores.
 */

// 2 de septiembre de 2026, 21:00 en El Salvador — la hora está puesta a
// propósito después de las 18:00 UTC-6: con `new Date(cadena)` el portal ya se
// creyó un día en el futuro más de una vez.
const CONGELADO = new Date('2026-09-03T03:00:00Z');

const congelarReloj = () => {
    vi.useFakeTimers();
    vi.setSystemTime(CONGELADO);
};

afterEach(() => { vi.useRealTimers(); });

describe('mesesRecientes', () => {
    it('arranca en el mes SIGUIENTE y sigue hacia atrás', () => {
        congelarReloj();
        const v = mesesRecientes().map((x) => x.value);
        expect(v[0]).toBe('2026-10');   // el siguiente: se negocia antes de empezar
        expect(v[1]).toBe('2026-09');   // el actual
        expect(v[2]).toBe('2026-08');   // el anterior
    });

    it('no ofrece ningún mes más allá del siguiente', () => {
        congelarReloj();
        const v = mesesRecientes().map((x) => x.value);
        // El defecto original: doce meses del futuro, todos con forma válida.
        expect(v.filter((m) => m > '2026-10')).toEqual([]);
    });

    it('devuelve la cantidad pedida, sin repetidos y en orden descendente', () => {
        congelarReloj();
        const v = mesesRecientes().map((x) => x.value);
        expect(v).toHaveLength(13);
        expect(new Set(v).size).toBe(13);
        expect([...v].sort().reverse()).toEqual(v);
    });

    it('cruza el año hacia atrás', () => {
        congelarReloj();
        const v = mesesRecientes().map((x) => x.value);
        expect(v).toContain('2025-12');
        expect(v.at(-1)).toBe('2025-10');
    });
});

describe('mesAnterior', () => {
    it('es el mes anterior al de hoy', () => {
        congelarReloj();
        expect(mesAnterior()).toBe('2026-08');
    });

    it('coincide con el tercer elemento de la lista, que es de donde salía antes', () => {
        congelarReloj();
        expect(mesAnterior()).toBe(mesesRecientes()[2].value);
    });

    it('cruza el año: en enero, el anterior es diciembre del año pasado', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2027-01-15T18:00:00Z'));
        expect(mesAnterior()).toBe('2026-12');
    });
});

describe('rotuloMes', () => {
    it('nombra el mes sin retroceder uno', () => {
        // `new Date('2026-08')` se lee como UTC y en El Salvador cae en julio.
        expect(rotuloMes('2026-08')).toMatch(/agosto/i);
        expect(rotuloMes('2026-01')).toMatch(/enero/i);
        expect(rotuloMes('2026-12')).toMatch(/diciembre/i);
    });

    it('un mes mal escrito devuelve un guion, no una fecha inventada', () => {
        expect(rotuloMes('2026-13')).toBe('—');
        expect(rotuloMes('agosto')).toBe('—');
        expect(rotuloMes(null)).toBe('—');
        expect(rotuloMes('')).toBe('—');
    });
});

describe('fmtVigencia', () => {
    it('no retrocede un día: una fecha sin hora no se lee como UTC', () => {
        expect(fmtVigencia('2026-08-01', '2026-08-31')).toBe('1 ago – 31 ago 2026');
        // El año sólo aparece dos veces cuando el rango lo cruza.
        expect(fmtVigencia('2026-12-20', '2027-01-05')).toBe('20 dic 2026 – 5 ene 2027');
    });

    it('sin las dos fechas devuelve un guion', () => {
        expect(fmtVigencia(null, '2026-08-31')).toBe('—');
        expect(fmtVigencia('2026-08-01', null)).toBe('—');
    });
});

describe('diasRestantes', () => {
    it('cuenta desde HOY en El Salvador', () => {
        congelarReloj();
        expect(diasRestantes('2026-09-02')).toBe(0);
        expect(diasRestantes('2026-09-09')).toBe(7);
        expect(diasRestantes('2026-08-31')).toBe(-2);
    });
});

describe('estadoVisible', () => {
    it('el borrador y la terminada mandan sobre la fecha', () => {
        congelarReloj();
        expect(estadoVisible({ estado: 'borrador', fin: '2020-01-01' }).clave).toBe('borrador');
        expect(estadoVisible({ estado: 'finalizada', fin: '2030-01-01' }).clave).toBe('finalizada');
    });

    it('«por vencer» y «vencida» se LEEN de la fecha, no se guardan', () => {
        congelarReloj();
        expect(estadoVisible({ estado: 'activa', fin: '2026-08-31' }).clave).toBe('vencida');
        expect(estadoVisible({ estado: 'activa', fin: '2026-09-05' }).clave).toBe('por_vencer');
        expect(estadoVisible({ estado: 'activa', fin: '2026-12-31' }).clave).toBe('activa');
    });
});

describe('esLaboratorio', () => {
    it('distingue los dos tipos y no se cae con nada', () => {
        expect(esLaboratorio({ tipo: 'laboratorio' })).toBe(true);
        expect(esLaboratorio({ tipo: 'producto' })).toBe(false);
        // Las promociones creadas antes de que existiera el tipo no lo traen.
        expect(esLaboratorio({})).toBe(false);
        expect(esLaboratorio(null)).toBe(false);
        expect(esLaboratorio(undefined)).toBe(false);
    });
});
