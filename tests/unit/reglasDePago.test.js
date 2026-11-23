import { describe, it, expect } from 'vitest';
import {
    pagoDelDia, pagoDeLosDias, semanasConDescansoEnDuda, factorDelDia, lunesDe, domingoDe,
    TOLERANCIA_SEMANAL_MIN,
} from '@nucleo/utils/reglasDePago';
import { consolidarDia, turnoEnInstantes } from '../../supabase/functions/_shared/tiempoTrabajado.ts';
import { pendienteDeTH, mensajeDePendientesDeTH } from '@nucleo/utils/planilla';

/* Las reglas de pago decididas por el usuario el 2026-11-23. Un caso por regla,
 * con el artículo en el nombre. Tarifa de prueba: $2.00 la hora básica. */
const H = 2;

describe('horas de más — CT Art. 169/170: Talento Humano decide pago o banco', () => {
    const dia = { regular_hours: 8, overtime_hours: 2, nocturnal_overtime_hours: 0 };
    it('sin decidir: ni se pagan ni se bancan', () => {
        const p = pagoDelDia(dia, H);
        expect(p.horasPorDecidir).toBe(2);
        expect(p.horasExtraPagoDiurnas).toBe(0);
        expect(p.bancoDiurnas).toBe(0);
    });
    it('a PAGO: van a la planilla (×2 lo hace calcPayrollEntry)', () => {
        const p = pagoDelDia({ ...dia, extra_decision: 'PAGO' }, H);
        expect(p.horasExtraPagoDiurnas).toBe(2);
        expect(p.horasPorDecidir).toBe(0);
    });
    it('al BANCO: van al banco de horas y no se pagan', () => {
        const p = pagoDelDia({ ...dia, extra_decision: 'BANCO' }, H);
        expect(p.bancoDiurnas).toBe(2);
        expect(p.horasExtraPagoDiurnas).toBe(0);
    });
    it('las de noche se separan de las de día', () => {
        const p = pagoDelDia({ ...dia, nocturnal_overtime_hours: 0.5, extra_decision: 'PAGO' }, H);
        expect(p.horasExtraPagoDiurnas).toBe(1.5);
        expect(p.horasExtraPagoNocturnas).toBe(0.5);
    });
});

describe('nocturno — CT Art. 168: 25 % desde las 19:00', () => {
    it('día normal: las horas nocturnas van a la planilla como horas (× 0,25 allá)', () => {
        expect(pagoDelDia({ regular_hours: 7, nocturnal_hours: 3 }, H).horasNocturnasOrdinarias).toBe(3);
    });
});

describe('día de descanso trabajado — CT Art. 175 / RIT Art. 30 y compensatorio Art. 176', () => {
    it('básico + 50 % por las horas, y un compensatorio', () => {
        const p = pagoDelDia({ is_rest_day_worked: true, regular_hours: 8 }, H);
        expect(p.montoDiaEspecial).toBe(8 * H * 1.5);       // $24
        expect(p.compensatorio).toBe(true);
        expect(factorDelDia('DESCANSO')).toBe(1.5);
    });
    it('extra en descanso: el 100 % sobre el salario extraordinario del día (Art. 175 inc. 2)', () => {
        const p = pagoDelDia({ is_rest_day_worked: true, regular_hours: 8, overtime_hours: 1, extra_decision: 'PAGO' }, H);
        expect(p.montoDiaEspecial).toBe(8 * H * 1.5 + 1 * H * 1.5 * 2);   // $30
    });
    it('nocturno en descanso: el 25 % sobre el salario del día', () => {
        const p = pagoDelDia({ is_rest_day_worked: true, regular_hours: 4, nocturnal_hours: 2 }, H);
        expect(p.montoDiaEspecial).toBe(4 * H * 1.5 + 2 * H * 1.5 * 0.25);   // $13.50
        expect(p.horasNocturnasOrdinarias).toBe(0);   // no se paga dos veces
    });
});

describe('asueto trabajado — CT Art. 192: salario ordinario + 100 %', () => {
    it('× 2 por las horas', () => {
        expect(pagoDelDia({ is_holiday_worked: true, regular_hours: 8 }, H).montoDiaEspecial).toBe(32);
    });
    it('extra en asueto: sobre el salario extraordinario (Art. 192 inc. 2)', () => {
        const p = pagoDelDia({ is_holiday_worked: true, regular_hours: 8, overtime_hours: 1, extra_decision: 'PAGO' }, H);
        expect(p.montoDiaEspecial).toBe(32 + 1 * H * 2 * 2);   // $40
    });
    it('si es asueto y descanso a la vez, manda el asueto', () => {
        expect(pagoDelDia({ is_holiday_worked: true, is_rest_day_worked: true, regular_hours: 1 }, H).montoDiaEspecial).toBe(4);
    });
});

describe('tardanza — RIT Arts. 23, 25, 26 / CT Art. 171', () => {
    const ts = (fecha, extra) => ({ employee_id: 'a', work_date: fecha, late_minutes: 0, ...extra });
    const quincena = { desde: '2026-11-16', hasta: '2026-11-30' };
    it(`${TOLERANCIA_SEMANAL_MIN} minutos en la semana: tolerancia, nada que decidir`, () => {
        const s = semanasConDescansoEnDuda([ts('2026-11-16', { late_minutes: 6 }), ts('2026-11-18', { late_minutes: 4 })], [], quincena);
        expect(s).toEqual([]);
    });
    it('11 minutos sumando la semana: se propone perder el descanso', () => {
        const s = semanasConDescansoEnDuda([ts('2026-11-16', { late_minutes: 6 }), ts('2026-11-18', { late_minutes: 5 })], [], quincena);
        expect(s).toHaveLength(1);
        expect(s[0]).toMatchObject({ semana: '2026-11-16', minutosTarde: 11, motivo: 'TARDANZA', decision: null });
    });
    it('una ausencia sin justificar: semana incompleta (RIT Art. 25)', () => {
        const s = semanasConDescansoEnDuda([ts('2026-11-17', { is_absent: true, absence_type: null })], [], quincena);
        expect(s[0].motivo).toBe('SEMANA_INCOMPLETA');
    });
    it('una ausencia justificada (vacación) no cuenta', () => {
        expect(semanasConDescansoEnDuda([ts('2026-11-17', { is_absent: true, absence_type: 'VACATION' })], [], quincena)).toEqual([]);
    });
    it('la decisión de Talento Humano se lee', () => {
        const s = semanasConDescansoEnDuda([ts('2026-11-16', { late_minutes: 30 })],
            [{ employee_id: 'a', semana: '2026-11-16', decision: 'JUSTIFICADO' }], quincena);
        expect(s[0].decision).toBe('JUSTIFICADO');
    });
    it('la semana se cuenta en la quincena de su domingo', () => {
        // Lunes 9 al domingo 15: es de la primera quincena, no de ésta.
        expect(semanasConDescansoEnDuda([ts('2026-11-14', { late_minutes: 30 })], [], quincena)).toEqual([]);
        expect(lunesDe('2026-11-22')).toBe('2026-11-16');
        expect(domingoDe('2026-11-16')).toBe('2026-11-22');
    });
});

describe('planilla: lo pendiente traba la aprobación', () => {
    it('horas por decidir y descanso en duda salen en el renglón', () => {
        expect(pendienteDeTH({ extras_por_decidir_horas: 2, descanso_por_decidir_semanas: 1 })).toMatch(/2 h de más.*1 semana/);
    });
    it('el aviso cabe en un toast (≤ 240) aun con los cuatro pendientes', () => {
        const msg = mensajeDePendientesDeTH([{ incapacidad_pendiente_dias: 1, suspension_pendiente_dias: 1, extras_por_decidir_horas: 1, descanso_por_decidir_semanas: 1 }]);
        expect(msg.length).toBeLessThanOrEqual(240);
    });
    it('pagoDeLosDias suma y cuenta compensatorios', () => {
        const t = pagoDeLosDias([
            { regular_hours: 8, overtime_hours: 1 },
            { is_rest_day_worked: true, regular_hours: 4 },
        ], H);
        expect(t.horasPorDecidir).toBe(1);
        expect(t.montoDiasEspeciales).toBe(12);
        expect(t.compensatorios).toBe(1);
    });
});

describe('consolidación: sin horario el tope es la jornada legal (RIT Art. 16)', () => {
    const sv = (h) => `2026-11-22T${h}:00-06:00`;
    const V = { inicioDelDia: new Date(sv('00:00')), finDelDia: new Date(sv('23:59')) };
    it('descanso trabajado 7–18 sin horario: 8 regulares (con la pausa marcada) y 2 de más por decidir', () => {
        const d = consolidarDia([
            { type: 'IN_EXTRA', timestamp: sv('07:00') }, { type: 'OUT_LUNCH', timestamp: sv('12:00') },
            { type: 'IN_LUNCH', timestamp: sv('13:00') }, { type: 'OUT_EXTRA', timestamp: sv('18:00') },
        ], { ...V, turno: turnoEnInstantes('2026-11-22', null, null) });
        expect(d.minutosRegulares).toBe(480);
        expect(d.minutosExtra).toBe(120);
    });
});
