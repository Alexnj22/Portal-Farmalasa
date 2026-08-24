// Las fechas y el conteo de pendientes del libro regulado (SRS).
//
// Se prueban porque el número que sale de acá es el que **firma el regente al
// cerrar el mes**, y porque las fechas de este archivo están escritas con dos
// defensas distintas que se ven como adorno y no lo son:
//
//   · `hoySV` resta seis horas a la hora del sistema en vez de leer la fecha
//     local. En un servidor en UTC —donde corren los crons— la fecha local a
//     las 02:00 SV ya es el día siguiente, y un renglón caería en el día
//     equivocado del libro;
//   · `correrDia` construye la fecha a **mediodía UTC** para que sumar un día
//     no la mueva de fecha por un huso o un cambio de hora.
//
// Y el conteo tiene una regla que decide cuánto trabajo se le exige a la sala:
// un área que hoy no aplica NO suma huecos. Contarla inventaría trabajo que
// nadie tenía que hacer.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hoySV, periodoDe, correrDia, correrPeriodo, pendientesDelDia, rotularRango, soloLimpieza, TIPO_AREA }
    from '../../src/data/bitacoras';

describe('hoy en El Salvador', () => {
    afterEach(() => vi.useRealTimers());

    it('a media tarde da el mismo día', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-24T20:00:00Z')); // 14:00 SV
        expect(hoySV()).toBe('2026-08-24');
    });

    it('en la madrugada SV todavía es el día anterior, aunque en UTC ya cambió', () => {
        // 2026-08-25T02:00Z son las 20:00 del 24 en El Salvador. Leer la fecha
        // en UTC daría el 25 y el renglón caería en el día equivocado del libro.
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-25T02:00:00Z'));
        expect(hoySV()).toBe('2026-08-24');
    });

    it('el corte del día es a las 06:00 UTC', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-25T05:59:59Z'));
        expect(hoySV()).toBe('2026-08-24');
        vi.setSystemTime(new Date('2026-08-25T06:00:00Z'));
        expect(hoySV()).toBe('2026-08-25');
    });
});

describe('el período', () => {
    it('es el YYYY-MM de la fecha', () => {
        expect(periodoDe('2026-08-24')).toBe('2026-08');
        expect(periodoDe('2026-01-01')).toBe('2026-01');
    });

    it('sin fecha cae a hoy', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-24T20:00:00Z'));
        expect(periodoDe(null)).toBe('2026-08');
        expect(periodoDe('')).toBe('2026-08');
        vi.useRealTimers();
    });
});

describe('correr un día sin que el huso lo mueva', () => {
    it('suma y resta', () => {
        expect(correrDia('2026-08-24', 1)).toBe('2026-08-25');
        expect(correrDia('2026-08-24', -1)).toBe('2026-08-23');
        expect(correrDia('2026-08-24', 0)).toBe('2026-08-24');
    });

    it('cruza fin de mes y fin de año', () => {
        expect(correrDia('2026-08-31', 1)).toBe('2026-09-01');
        expect(correrDia('2026-12-31', 1)).toBe('2027-01-01');
        expect(correrDia('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('el 29 de febrero de un año bisiesto', () => {
        expect(correrDia('2028-02-28', 1)).toBe('2028-02-29');
        expect(correrDia('2028-03-01', -1)).toBe('2028-02-29');
    });

    it('correr treinta días seguidos de a uno da lo mismo que correr treinta', () => {
        // Si la fecha se construyera a medianoche en vez de mediodía, un cambio
        // de hora la correría y las dos cuentas se separarían.
        let uno = '2026-01-15';
        for (let i = 0; i < 30; i++) uno = correrDia(uno, 1);
        expect(uno).toBe(correrDia('2026-01-15', 30));
    });
});

describe('correr un período', () => {
    it('suma y resta meses', () => {
        expect(correrPeriodo('2026-08', 1)).toBe('2026-09');
        expect(correrPeriodo('2026-08', -1)).toBe('2026-07');
    });

    it('cruza el año en las dos direcciones', () => {
        expect(correrPeriodo('2026-12', 1)).toBe('2027-01');
        expect(correrPeriodo('2026-01', -1)).toBe('2025-12');
        expect(correrPeriodo('2026-06', -12)).toBe('2025-06');
    });
});

describe('los pendientes del día — el número que firma el regente', () => {
    const franja = (estado, fuera) => ({ estado, lectura: fuera ? { fuera_de_rango: true } : null });

    it('cuenta franjas y limpiezas juntas', () => {
        const dia = { areas: [{ franjas: [franja('hecha'), franja('abierta')], limpiezas: [franja('vencida')] }] };
        expect(pendientesDelDia(dia)).toEqual({ hechas: 1, abiertas: 1, vencidas: 1, total: 3, desvios: 0 });
    });

    it('un área que HOY NO APLICA no suma huecos', () => {
        // Es la regla que decide cuánto trabajo se le exige a la sala. Contarla
        // inventaría trabajo que nadie tenía que hacer, y ese número es el que
        // después se firma.
        const dia = { areas: [
            { aplica_hoy: false, franjas: [franja('vencida'), franja('vencida')] },
            { franjas: [franja('hecha')] },
        ] };
        expect(pendientesDelDia(dia)).toEqual({ hechas: 1, abiertas: 0, vencidas: 0, total: 1, desvios: 0 });
    });

    it('`aplica_hoy` ausente SÍ cuenta — sólo el false explícito exime', () => {
        // Un `undefined` que eximiera dejaría fuera del conteo a toda área que
        // no traiga la bandera, y el libro saldría completo sin estarlo.
        const dia = { areas: [{ franjas: [franja('vencida')] }] };
        expect(pendientesDelDia(dia).vencidas).toBe(1);
    });

    it('los desvíos se cuentan aparte, no en lugar del estado', () => {
        const dia = { areas: [{ franjas: [franja('hecha', true)] }] };
        const r = pendientesDelDia(dia);
        expect(r.hechas).toBe(1);
        expect(r.desvios).toBe(1);
    });

    it('un día sin áreas devuelve ceros, no null', () => {
        for (const v of [null, undefined, {}, { areas: [] }])
            expect(pendientesDelDia(v)).toEqual({ abiertas: 0, vencidas: 0, hechas: 0, total: 0, desvios: 0 });
    });

    it('un estado desconocido cuenta en el total pero en ninguna categoría', () => {
        // El total tiene que seguir cuadrando: si un estado nuevo desapareciera
        // del total, el porcentaje de cumplimiento saldría inflado.
        const dia = { areas: [{ franjas: [franja('en_curso')] }] };
        const r = pendientesDelDia(dia);
        expect(r.total).toBe(1);
        expect(r.hechas + r.abiertas + r.vencidas).toBe(0);
    });
});

describe('el rango del área, en texto', () => {
    it.each([
        [{ temp_min: 2, temp_max: 8 }, '2 a 8 °C'],
        [{ temp_max: 30 },             'hasta 30 °C'],
        [{ temp_min: 15 },             'desde 15 °C'],
        [{},                           'sin rango definido'],
        [null,                         'sin rango definido'],
    ])('%o → %s', (area, esperado) => { expect(rotularRango(area)).toBe(esperado); });

    it('el CERO es un límite válido, no un vacío', () => {
        // `temp_min: 0` es falsy. Un `if (min)` lo tomaría por ausente y un
        // refrigerador de 0 a 8 °C saldría como «hasta 8 °C».
        expect(rotularRango({ temp_min: 0, temp_max: 8 })).toBe('0 a 8 °C');
        expect(rotularRango({ temp_max: 0 })).toBe('hasta 0 °C');
    });
});

describe('un área que sólo se limpia', () => {
    it('se decide por las FRANJAS, no por el tipo', () => {
        // El día que se agregue otra área de sólo limpieza, una lista de tipos
        // habría que acordarse de tocarla; esto no.
        expect(soloLimpieza({ tipo: 'vitrinas', franjas: [] })).toBe(true);
        expect(soloLimpieza({ tipo: 'inventada_manana' })).toBe(true);
        expect(soloLimpieza({ tipo: 'refrigerador', franjas: [{ estado: 'abierta' }] })).toBe(false);
    });

    it('los cinco tipos de área tienen rótulo', () => {
        expect(Object.keys(TIPO_AREA).sort())
            .toEqual(['bodega', 'refrigerador', 'sala_ventas', 'servicio_sanitario', 'vitrinas']);
    });
});
