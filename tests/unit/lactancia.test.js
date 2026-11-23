import { describe, it, expect } from 'vitest';
import {
    CASOS_DE_LACTANCIA, periodoDeLactancia, lactanciaVigente, avisoDelParto, masMeses,
} from '@nucleo/utils/lactancia';
import { resolverTurnoDelDia, reparosDelDia, tramosDeLaJornada } from '@nucleo/utils/turnoDelDia';
import { datosDelDiaParaGuardar } from '@nucleo/utils/edicionDeHorario';

// Los casos viven en `lactancia.js` (`CASOS_DE_LACTANCIA`) para que el MISMO
// listado se enfrente contra `public.lactancia_periodo` en la base. Enfrentados
// el 2026-11-23 en el entorno de pruebas: 14 de 14 iguales. Cambiar un gemelo
// exige volver a correrlos contra el otro.
describe('periodoDeLactancia — gemelo de public.lactancia_periodo', () => {
    for (const c of CASOS_DE_LACTANCIA) {
        it(c.nombre, () => {
            expect(periodoDeLactancia(c.inicio, c.meta)).toEqual(c.esperado);
        });
    }
});

describe('masMeses — como Postgres', () => {
    it('el día que no existe cae al último del mes', () => {
        expect(masMeses('2026-08-31', 6)).toBe('2027-02-28');
        expect(masMeses('2027-08-31', 6)).toBe('2028-02-29');
        expect(masMeses('2026-01-31', 1)).toBe('2026-02-28');
        expect(masMeses('2026-10-15', 3)).toBe('2027-01-15');
    });
});

describe('lactanciaVigente — gemelo de public.lactancia_hasta', () => {
    const mat = (id, extra = {}) => ({
        id, type: 'DISABILITY', date: '2026-05-01',
        metadata: { disabilityType: 'MATERNIDAD', endDate: '2026-08-20', fechaPartoProbable: '2026-05-31', ...extra },
    });
    it('dentro del período', () => {
        expect(lactanciaVigente([mat('a')], '2026-09-01')).toEqual({ desde: '2026-08-21', hasta: '2026-11-29', eventoId: 'a' });
    });
    it('el primer y el último día cuentan', () => {
        expect(lactanciaVigente([mat('a')], '2026-08-21')).not.toBeNull();
        expect(lactanciaVigente([mat('a')], '2026-11-29')).not.toBeNull();
    });
    it('durante la maternidad y después de los 6 meses, no', () => {
        expect(lactanciaVigente([mat('a')], '2026-08-20')).toBeNull();
        expect(lactanciaVigente([mat('a')], '2026-11-30')).toBeNull();
    });
    it('la novedad corregida o anulada no cuenta', () => {
        expect(lactanciaVigente([mat('a', { status: 'SUPERSEDED' })], '2026-09-01')).toBeNull();
        expect(lactanciaVigente([mat('a', { status: 'CANCELLED' })], '2026-09-01')).toBeNull();
        expect(lactanciaVigente([mat('a', { status: 'ANULADA' })], '2026-09-01')).toBeNull();
    });
    it('metadata como texto (así viene a veces de la base)', () => {
        const ev = mat('a'); ev.metadata = JSON.stringify(ev.metadata);
        expect(lactanciaVigente([ev], '2026-09-01')?.hasta).toBe('2026-11-29');
    });
    it('terminada antes por Talento Humano', () => {
        expect(lactanciaVigente([mat('a', { lactanciaTerminadaEl: '2026-09-10' })], '2026-09-11')).toBeNull();
        expect(lactanciaVigente([mat('a', { lactanciaTerminadaEl: '2026-09-10' })], '2026-09-10')?.hasta).toBe('2026-09-10');
    });
    it('otro tipo de evento, no', () => {
        expect(lactanciaVigente([{ ...mat('a'), type: 'VACATION' }], '2026-09-01')).toBeNull();
    });
});

describe('avisoDelParto — Art. 59, 10 semanas después del parto', () => {
    it('parto real tardío con el fin sin mover', () => {
        expect(avisoDelParto({ fechaPartoReal: '2026-06-20', endDate: '2026-08-20' })).toEqual({ finMinimo: '2026-08-29' });
    });
    it('el fin ya cubre las 10 semanas', () => {
        expect(avisoDelParto({ fechaPartoReal: '2026-06-01', endDate: '2026-08-20' })).toBeNull();
    });
    it('sin parto real, nada', () => {
        expect(avisoDelParto({ fechaPartoProbable: '2026-06-20', endDate: '2026-08-20' })).toBeNull();
    });
});

describe('el día con lactancia (Art. 61) — turnoDelDia', () => {
    const dia = (extra) => resolverTurnoDelDia({ customStart: '07:00', customEnd: '16:00', hasLunch: true, lunchStart: '12:00', hasLactation: true, ...extra }, []);

    it('pegada antes o después del almuerzo SÍ se permite', () => {
        expect(reparosDelDia(dia({ lactationStart: '11:00' }))).toEqual([]);
        expect(reparosDelDia(dia({ lactationStart: '13:00' }))).toEqual([]);
    });
    it('cruzada con el almuerzo, no', () => {
        expect(reparosDelDia(dia({ lactationStart: '12:30' }))).toContain('La lactancia cae dentro de la pausa alimenticia, y el reglamento no lo permite.');
    });
    it('partida en dos: 30 y 30, y cuenta como trabajada', () => {
        const d = datosDelDiaParaGuardar({ inicio: '07:00', fin: '16:00', conPausa: true, pausa: '12:00', conLactancia: true, lactancia: '09:00', lactancia2: '15:00' });
        expect(d).toMatchObject({ lactationStart: '09:00', lactationMinutes: 30, lactation2Start: '15:00', lactation2Minutes: 30 });
        const r = resolverTurnoDelDia(d, []);
        expect(r.lactancia).toEqual({ inicio: '09:00', minutos: 30 });
        expect(r.lactancia2).toEqual({ inicio: '15:00', minutos: 30 });
        expect(r.minutosPagados).toBe(8 * 60);   // 9 h menos el almuerzo: la lactancia NO se descuenta
        expect(tramosDeLaJornada(r).filter(t => t.tipo === 'lactancia')).toHaveLength(2);
        expect(reparosDelDia(r)).toEqual([]);
    });
    it('la segunda mitad sobre el almuerzo, no', () => {
        expect(reparosDelDia(dia({ lactationStart: '09:00', lactationMinutes: 30, lactation2Start: '12:15', lactation2Minutes: 30 })))
            .toContain('La lactancia cae dentro de la pausa alimenticia, y el reglamento no lo permite.');
    });
    it('una sola pausa conserva la forma de antes', () => {
        const d = datosDelDiaParaGuardar({ inicio: '07:00', fin: '16:00', conPausa: true, pausa: '12:00', conLactancia: true, lactancia: '15:00' });
        expect(d).not.toHaveProperty('lactation2Start');
        expect(d).not.toHaveProperty('lactationMinutes');
    });
});
