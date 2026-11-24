// La planilla del portal contra la boleta de pago de la empresa (2026-11-23).
//
// Se recorrió la boleta renglón por renglón. Las tasas son las de la boleta:
// diario = mensual / 30, hora = diario / 8 (cuatro decimales), nocturnas
// ordinarias sólo el recargo (× 0,25), la hora extra nocturna en DOS
// renglones (noct. extraordinarias × 0,5 y extra nocturnas × 2, o sea × 2,5),
// extra diurna × 2, retenciones sólo sobre el salario ordinario (ISSS 3 %, AFP
// 7,25 %, renta quincenal sobre lo que queda) y líquido = (A − C) + B.
//
// Los datos son FICTICIOS: la boleta real tiene datos de una persona y no se
// copian acá. Las cuentas se hicieron a mano con las reglas de la boleta.
import { describe, it, expect } from 'vitest';
import { calcPayrollEntry } from '@nucleo/store/slices/payrollSlice';
import { partidasDeBoleta } from '@nucleo/utils/planilla';
import { pagoDelDia } from '@nucleo/utils/reglasDePago';
import { buildBoletaHTML } from '@nucleo/utils/boletaDePapel';

describe('la boleta de la empresa', () => {
    // $720 al mes → $24.00 diario → $3.0000 la hora.
    const emp = { base_salary: 720 };
    const fila = calcPayrollEntry(emp, 15, {
        night_hours_ordinary: 3,       // 3 × 0.75  = 2.25
        night_hours_extra: 2,          // 2 × 1.50  = 3.00
        extra_hours_nocturnal: 2,      // 2 × 6.00  = 12.00
        extra_hours_diurnal: 1,        // 1 × 6.00  = 6.00
        bonifications: 50,             // bono por venta
        bonificaciones_detalle: 'Bono por venta',
        viaticos: 10, viaticos_detail: 'Por 1 visita de supervisión',
    });

    it('A: salario ordinario = días × diario', () => {
        expect(fila.ordinary_salary).toBe(360);
        expect(fila.subtotal_a).toBe(360);
    });

    it('B: los no sujetos, cada uno en su renglón', () => {
        expect(fila.subtotal_b).toBe(2.25 + 3 + 12 + 6 + 50 + 10);   // 83.25
    });

    it('C: retenciones sólo sobre el salario ordinario', () => {
        expect(fila.isss_deduction).toBe(10.8);
        expect(fila.afp_deduction).toBe(26.1);
        // (360 − 10.80 − 26.10) = 323.10 → tramo II: 8.83 + 10 % × 48.10
        expect(fila.renta_deduction).toBe(13.64);
        expect(fila.total_deductions).toBe(50.54);
    });

    it('líquido = (A − C) + B, al centavo', () => {
        expect(fila.net_pay).toBe(392.71);
    });

    it('la hora extra nocturna cuesta × 2,5 (2 + 0,5), no × 2,25', () => {
        const p = partidasDeBoleta(fila, emp.base_salary);
        const noctExtra = p.noSujetos.find(x => x.rotulo.startsWith('Horas nocturnas extra'));
        const extraNoct = p.noSujetos.find(x => x.rotulo.startsWith('Horas extra nocturnas'));
        expect(noctExtra.monto + extraNoct.monto).toBe(15);           // 2 h × 3.00 × 2.5
        expect(noctExtra.tarifa).toBe(1.5);
        expect(extraNoct.tarifa).toBe(6);
    });

    it('el renglón de bonificaciones lleva su concepto, y el de asuetos queda en 0', () => {
        const p = partidasDeBoleta(fila, emp.base_salary);
        expect(p.noSujetos.find(x => x.rotulo.startsWith('Bonificaciones')).rotulo).toBe('Bonificaciones · Bono por venta');
        expect(p.noSujetos.some(x => x.rotulo === 'Recargo de asuetos')).toBe(false);
        const html = buildBoletaHTML({ ...fila, employee: { base_salary: 720 } }, { start_date: '2026-11-16', end_date: '2026-11-30' }, []);
        expect(html).toContain('BONIFICACIÓN: Bono por venta');
        expect(html).toContain('VIÁTICO: Por 1 visita de supervisión');
        expect(html).toContain('2.00 X $6.0000 =');
    });

    it('el sueldo por hora va con cuatro decimales, como en la boleta', () => {
        // $675 / 30 / 8 = 2.8125; con dos decimales salía 2.81 y los montos no daban.
        expect(partidasDeBoleta({}, 675).porHora).toBe(2.8125);
        expect(partidasDeBoleta({}, 675).diario).toBe(22.5);
    });

    it('medio día trabajado (14.5) y bono por venta en Bonificaciones', () => {
        const f = calcPayrollEntry({ base_salary: 600 }, 14.5, { bonifications: 40, viaticos: 5 });
        // 14.5 × 20.00 = 290.00; ISSS 8.70; AFP 21.03 (21.025); renta sobre
        // 260.27 = 0 (exento hasta 275). B = 45. Líquido = 290 − 29.73 + 45.
        expect(f.ordinary_salary).toBe(290);
        expect(f.renta_deduction).toBe(0);
        expect(f.net_pay).toBe(305.27);
        expect(f.holiday_surcharge).toBe(0);
    });
});

describe('el día de descanso o asueto con extra nocturna', () => {
    it('la extra nocturna se paga sobre el salario extraordinario del día: f × 2 × 1,25', () => {
        const d = pagoDelDia({ is_rest_day_worked: true, regular_hours: 0, overtime_hours: 1, nocturnal_overtime_hours: 1, extra_decision: 'PAGO' }, 4);
        expect(d.montoDiaEspecial).toBe(15);   // 1 h × 4 × 1.5 × 2.5
    });
    it('en un día normal la hora extra nocturna va a los dos renglones de la boleta', () => {
        const d = pagoDelDia({ regular_hours: 8, overtime_hours: 2, nocturnal_overtime_hours: 2, extra_decision: 'PAGO' }, 3);
        expect(d.horasExtraPagoNocturnas).toBe(2);
    });
});
