import { describe, expect, it } from 'vitest';
import { anticiposDeLaQuincena, bajasEnQuincena, contratoEnQuincena, descuentoDeSuspension, incapacidadesPorPersona, mensajeDePendientesDeTH, pendienteDeTH, suspensionesPorPersona, diaDeAprobacion, diasPagadosDeQuincena, esAusenciaDescontable, esQuincena, montoEnLetras, numeroEnLetras, ordenDeCargo, partidasDeBoleta, problemaDeQuincena, quincenaPorDefecto, rotuloDePeriodo, totalesDePlanilla } from '@nucleo/utils/planilla';
import { calcPayrollEntry } from '@nucleo/store/slices/payrollSlice';

describe('planilla', () => {
    it('el monto en letras de la boleta', () => {
        expect(montoEnLetras(362.71)).toBe('TRESCIENTOS SESENTA Y DOS CON 71/100');
        expect(montoEnLetras(1000)).toBe('MIL CON 00/100');
        expect(numeroEnLetras(0)).toBe('cero');
        expect(numeroEnLetras(100)).toBe('cien');
        expect(numeroEnLetras(121)).toBe('ciento veintiuno');
        expect(numeroEnLetras(21000)).toBe('veintiún mil');
        expect(numeroEnLetras(1250)).toBe('mil doscientos cincuenta');
        expect(numeroEnLetras(31)).toBe('treinta y uno');
    });
    it('la quincena se nombra por su primer día', () => {
        expect(rotuloDePeriodo('2026-09-16', '2026-09-30')).toMatch(/^Segunda Quincena de/);
        expect(rotuloDePeriodo('2026-09-01', '2026-09-15')).toMatch(/^Primera Quincena de/);
    });
    it('los cargos más altos primero; uno desconocido al final', () => {
        expect(ordenDeCargo({ role_id: 2 })).toBe(0);
        expect(ordenDeCargo({ roleId: 999 })).toBe(999);
    });
    it('totales', () => {
        expect(totalesDePlanilla([{ net_pay: 10, total_deductions: 2, ordinary_salary: 12 }, { net_pay: '5' }])).toEqual({ personas: 2, liquido: 15, descuentos: 2, ordinario: 12 });
    });
});

describe('partidasDeBoleta', () => {
    it('convierte las horas en dinero con el sueldo por hora del papel', () => {
        // $600/mes → diario 20.00 → por hora 2.50
        const p = partidasDeBoleta({ extra_hours_diurnal: 3, night_hours_ordinary: 4, subtotal_a: 300, subtotal_b: 20, ordinary_salary: 300, days_worked: 15 }, 600);
        expect(p.porHora).toBe(2.5);
        const extra = p.noSujetos.find((x) => x.rotulo.startsWith('Horas extra diurnas'));
        expect(extra.horas).toBe(3);
        expect(extra.monto).toBe(15);
        expect(p.noSujetos.find((x) => x.rotulo.startsWith('Horas nocturnas ordinarias')).monto).toBe(2.5);
        expect(p.subtotalA).toBe(300);
        expect(p.subtotalB).toBe(20);
    });
    it('omite las partidas en cero', () => {
        const p = partidasDeBoleta({ ordinary_salary: 100 }, 300);
        expect(p.noSujetos).toEqual([]);
        expect(p.otrosDescuentos).toEqual([]);
    });
});

describe('quincenas 1–15 y 16–fin de mes (decisión del dueño, 2026-10-22)', () => {
    it('propone la quincena que contiene el día', () => {
        expect(quincenaPorDefecto('2026-10-07')).toEqual({ start_date: '2026-10-01', end_date: '2026-10-15' });
        expect(quincenaPorDefecto('2026-10-15')).toEqual({ start_date: '2026-10-01', end_date: '2026-10-15' });
        expect(quincenaPorDefecto('2026-10-16')).toEqual({ start_date: '2026-10-16', end_date: '2026-10-31' });
        expect(quincenaPorDefecto('2027-02-20')).toEqual({ start_date: '2027-02-16', end_date: '2027-02-28' });
        expect(quincenaPorDefecto('2028-02-29')).toEqual({ start_date: '2028-02-16', end_date: '2028-02-29' });
        expect(quincenaPorDefecto('2026-12-31')).toEqual({ start_date: '2026-12-16', end_date: '2026-12-31' });
    });
    it('valida los bordes', () => {
        expect(esQuincena('2026-10-01', '2026-10-15')).toBe(true);
        expect(esQuincena('2026-10-16', '2026-10-31')).toBe(true);
        expect(esQuincena('2026-11-16', '2026-11-30')).toBe(true);
        expect(esQuincena('2027-02-16', '2027-02-28')).toBe(true);
        expect(esQuincena('2026-10-16', '2026-10-30')).toBe(false);
        expect(esQuincena('2026-10-01', '2026-10-16')).toBe(false);
        expect(esQuincena('2026-10-05', '2026-10-19')).toBe(false);
        expect(esQuincena('2026-10-16', '2026-11-15')).toBe(false);
        expect(problemaDeQuincena('2026-10-01', '2026-10-15')).toBeNull();
        expect(problemaDeQuincena('2026-10-02', '2026-10-15')).toMatch(/del 1 al 15/);
        expect(problemaDeQuincena('', '')).toMatch(/Elige/);
    });
    it('paga 15 días aunque la quincena tenga 13 o 16, sin importar las marcaciones', () => {
        expect(diasPagadosDeQuincena([])).toEqual({ dias: 15, descontados: 0, pendientes: 0, suspensionPendiente: 0 });
        expect(diasPagadosDeQuincena(undefined)).toEqual({ dias: 15, descontados: 0, pendientes: 0, suspensionPendiente: 0 });
        // 13 días trabajados y 2 descansos sin fila: se pagan los 15.
        const trabajados = Array.from({ length: 13 }, (_, i) => ({ work_date: `2026-10-${String(i + 1).padStart(2, '0')}`, is_absent: false }));
        expect(diasPagadosDeQuincena(trabajados).dias).toBe(15);
    });
    it('descuenta sólo la ausencia injustificada (la suspensión la decide TH en el evento)', () => {
        const ts = [
            { work_date: '2026-10-02', is_absent: true, absence_type: null },
            { work_date: '2026-10-03', is_absent: true, absence_type: 'VACATION' },
            { work_date: '2026-10-04', is_absent: true, absence_type: 'DISABILITY' },
            { work_date: '2026-10-05', is_absent: true, absence_type: 'PERMIT' },
            { work_date: '2026-10-06', is_absent: false, absence_type: 'SUSPENSION' },
            { work_date: '2026-10-02', is_absent: true, absence_type: null }, // el mismo día repetido
        ];
        expect(esAusenciaDescontable(ts[0])).toBe(true);
        expect(esAusenciaDescontable(ts[1])).toBe(false);
        expect(esAusenciaDescontable(ts[4])).toBe(false);
        expect(diasPagadosDeQuincena(ts)).toMatchObject({ dias: 14, descontados: 1 });
    });
    it('nunca paga días negativos', () => {
        const ts = Array.from({ length: 16 }, (_, i) => ({ work_date: `2026-10-${16 + i}`, is_absent: true }));
        expect(diasPagadosDeQuincena(ts).dias).toBe(0);
    });
    it('15 días de sueldo diario son la mitad del mensual', () => {
        expect(calcPayrollEntry({ base_salary: 600 }, 15).ordinary_salary).toBe(300);
        expect(calcPayrollEntry({ base_salary: 1000 }, 15).ordinary_salary).toBe(500);
        // una ausencia: 300 − 20
        expect(calcPayrollEntry({ base_salary: 600 }, 14).ordinary_salary).toBe(280);
    });
});

describe('anticipos: la quincena del día de aprobación, una sola vez', () => {
    const periodo = { periodId: 'p2', start: '2026-10-16', end: '2026-10-31' };
    const anticipo = (id, emp, monto, aprobado, extra = {}) => ({
        id, employee_id: emp, status: 'APPROVED', metadata: { amount: monto },
        approvals: aprobado ? [{ level: 1, approvedAt: aprobado }] : [], updated_at: '2026-11-03T15:00:00Z', ...extra,
    });
    it('pedido el 14 y aprobado el 17 se descuenta en la segunda', () => {
        const m = anticiposDeLaQuincena([anticipo('a', 'e1', 50, '2026-10-17T16:00:00Z', { created_at: '2026-10-14T15:00:00Z' })], periodo);
        expect(m.get('e1')).toEqual({ monto: 50, solicitudes: [{ id: 'a', monto: 50, rezagado: false }] });
        expect(anticiposDeLaQuincena([anticipo('a', 'e1', 50, '2026-10-17T16:00:00Z')], { periodId: 'p1', start: '2026-10-01', end: '2026-10-15' }).size).toBe(0);
    });
    it('el día es el de El Salvador, no el de UTC', () => {
        // 15-oct 19:00 en la sala = 16-oct 01:00 UTC → primera quincena.
        const a = anticipo('a', 'e1', 40, '2026-10-16T01:00:00Z');
        expect(anticiposDeLaQuincena([a], periodo).size).toBe(0);
        expect(anticiposDeLaQuincena([a], { periodId: 'p1', start: '2026-10-01', end: '2026-10-15' }).get('e1').monto).toBe(40);
    });
    it('no se descuenta dos veces: si ya entró en otro período se salta; en este mismo, vuelve', () => {
        const a = anticipo('a', 'e1', 50, '2026-10-17T16:00:00Z');
        expect(anticiposDeLaQuincena([a], periodo, new Map([['a', 'p9']])).size).toBe(0);
        expect(anticiposDeLaQuincena([a], periodo, new Map([['a', 'p2']])).get('e1').monto).toBe(50);
    });
    it('suma varios de la misma persona y usa el respaldo cuando no hay approvals', () => {
        const m = anticiposDeLaQuincena([
            anticipo('a', 'e1', 50, '2026-10-17T16:00:00Z'),
            anticipo('b', 'e1', 25.5, null, { updated_at: '2026-10-20T16:00:00Z' }),
            anticipo('c', 'e2', 0, '2026-10-17T16:00:00Z'),
        ], periodo);
        expect(m.get('e1').monto).toBe(75.5);
        expect(m.get('e1').solicitudes.map(s => s.id)).toEqual(['a', 'b']);
        expect(m.has('e2')).toBe(false);
        expect(diaDeAprobacion({ approvals: [], metadata: { decidido_at: '2026-10-20T03:00:00Z' } })).toBe('2026-10-19');
    });
});


describe('ingreso o salida a mitad de quincena: según días contratados', () => {
    const q2 = { start: '2026-10-16', end: '2026-10-31' };
    const q1 = { start: '2026-10-01', end: '2026-10-15' };
    it('quien cubre la quincena entera cobra 15 aunque tenga 16 días', () => {
        expect(contratoEnQuincena(q2, '2020-01-01', null).dias).toBe(15);
        expect(contratoEnQuincena(q2, '2026-10-16', null).dias).toBe(15);
    });
    it('ingreso a mitad: desde su fecha de ingreso', () => {
        expect(contratoEnQuincena(q1, '2026-10-10', null)).toEqual({ dias: 6, desde: '2026-10-10', hasta: '2026-10-15' });
        expect(contratoEnQuincena(q1, '2026-10-16', null).dias).toBe(0);
    });
    it('baja a mitad: el día en que se firma la baja todavía se paga', () => {
        expect(contratoEnQuincena(q1, '2020-01-01', '2026-10-08')).toEqual({ dias: 8, desde: '2026-10-01', hasta: '2026-10-08' });
        expect(contratoEnQuincena(q1, '2020-01-01', '2026-10-01').dias).toBe(1);
        expect(contratoEnQuincena(q1, '2020-01-01', '2026-10-15').dias).toBe(15);
        // una baja anterior al reingreso es de otro contrato
        expect(contratoEnQuincena(q1, '2026-10-05', '2026-03-01').dias).toBe(11);
    });
    it('las ausencias se descuentan sólo dentro del contrato', () => {
        const ts = [{ work_date: '2026-10-03', is_absent: true }, { work_date: '2026-10-12', is_absent: true }];
        expect(diasPagadosDeQuincena(ts, { contratados: 6, desde: '2026-10-10', hasta: '2026-10-15' }).dias).toBe(5);
    });
    it('la baja sale del evento TERMINATION no anulado dentro de la quincena', () => {
        const b = bajasEnQuincena([
            { employee_id: 'e1', type: 'TERMINATION', date: '2026-10-08', metadata: {} },
            { employee_id: 'e2', type: 'TERMINATION', date: '2026-10-09', metadata: { status: 'CANCELLED' } },
            { employee_id: 'e3', type: 'TERMINATION', date: '2026-10-01', metadata: {} },
        ], q1);
        expect(b.get('e1')).toBe('2026-10-08');
        expect(b.has('e2')).toBe(false);
        // la firma el día 1 deja ese día por pagar
        expect(b.get('e3')).toBe('2026-10-01');
    });
});

describe('incapacidad: Talento Humano tiene la última palabra', () => {
    const eventos = [{ employee_id: 'e1', type: 'DISABILITY', date: '2026-10-02', metadata: { endDate: '2026-10-04' } }];
    const solicitudes = [
        { employee_id: 'e2', type: 'DISABILITY', status: 'PENDING', metadata: { startDate: '2026-10-05', endDate: '2026-10-06' } },
        { employee_id: 'e3', type: 'DISABILITY', status: 'APPROVED', metadata: { startDate: '2026-10-05', endDate: '2026-10-05' } },
    ];
    const inc = incapacidadesPorPersona(eventos, solicitudes);
    const ausente = (d) => ({ work_date: d, is_absent: true, absence_type: null });
    it('validada (novedad o solicitud aprobada): se paga', () => {
        expect(diasPagadosDeQuincena([ausente('2026-10-03')], { incapacidadesValidadas: inc.get('e1').validadas }).dias).toBe(15);
        expect(diasPagadosDeQuincena([ausente('2026-10-05')], { incapacidadesValidadas: inc.get('e3').validadas }).dias).toBe(15);
    });
    it('sin decisión: no se descuenta, pero queda pendiente', () => {
        const r = diasPagadosDeQuincena([ausente('2026-10-05'), ausente('2026-10-06')], { incapacidadesPendientes: inc.get('e2').pendientes });
        expect(r).toMatchObject({ dias: 15, descontados: 0, pendientes: 2 });
    });
    it('rechazada o inexistente: se descuenta', () => {
        expect(inc.has('e4')).toBe(false);
        expect(diasPagadosDeQuincena([ausente('2026-10-05')]).dias).toBe(14);
    });
});

describe('suspensión: con o sin descuento según Talento Humano', () => {
    const ev = (desc, extra = {}) => ({ id: 's', employee_id: 'e1', type: 'SUSPENSION', date: '2026-10-05',
        metadata: { endDate: '2026-10-06', ...(desc === undefined ? {} : { descuento_de_sueldo: desc }), ...extra } });
    it('lee la decisión del evento', () => {
        expect(descuentoDeSuspension(ev(true))).toBe(true);
        expect(descuentoDeSuspension(ev(false))).toBe(false);
        expect(descuentoDeSuspension(ev(undefined))).toBeNull();
    });
    it('con descuento: los días se descuentan aunque no haya fila de asistencia', () => {
        const s = suspensionesPorPersona([ev(true)]).get('e1');
        expect(diasPagadosDeQuincena([], { suspensiones: s })).toMatchObject({ dias: 13, descontados: 2, suspensionPendiente: 0 });
    });
    it('sin descuento: se pagan, aunque la asistencia diga ausente', () => {
        const s = suspensionesPorPersona([ev(false)]).get('e1');
        const ts = [{ work_date: '2026-10-05', is_absent: true, absence_type: 'SUSPENSION' }];
        expect(diasPagadosDeQuincena(ts, { suspensiones: s }).dias).toBe(15);
    });
    it('sin decidir: ni se paga ni se descuenta en silencio — queda pendiente', () => {
        const s = suspensionesPorPersona([ev(undefined)]).get('e1');
        expect(diasPagadosDeQuincena([], { suspensiones: s })).toMatchObject({ dias: 15, suspensionPendiente: 2 });
    });
    it('revocada por reclamo, o fuera del contrato: no cuenta', () => {
        expect(suspensionesPorPersona([ev(true, { reclamo: { estado: 'REVOCADA' } })]).has('e1')).toBe(false);
        const s = suspensionesPorPersona([ev(true)]).get('e1');
        expect(diasPagadosDeQuincena([], { suspensiones: s, contratados: 9, desde: '2026-10-06', hasta: '2026-10-15' }).dias).toBe(8);
    });
    it('el renglón y el freno de aprobación lo dicen en palabras', () => {
        expect(pendienteDeTH({ incapacidad_pendiente_dias: 2, suspension_pendiente_dias: 1 }))
            .toBe('2 días de incapacidad sin validar · 1 día de suspensión sin decidir el descuento');
        expect(pendienteDeTH({ incapacidad_pendiente_dias: 0 })).toBeNull();
        expect(mensajeDePendientesDeTH([])).toBeNull();
        expect(mensajeDePendientesDeTH([{ suspension_pendiente_dias: 1 }])).toMatch(/1 persona.*suspensión/);
    });
});

describe('anticipo aprobado en una quincena ya cerrada: pasa a la siguiente abierta', () => {
    const anticipo = (id, aprobado) => ({ id, employee_id: 'e1', status: 'APPROVED', metadata: { amount: 30 },
        approvals: [{ approvedAt: aprobado }], updated_at: aprobado });
    const periodos = [
        { id: 'p1', start_date: '2026-10-01', status: 'APPROVED' },
        { id: 'p2', start_date: '2026-10-16', status: 'DRAFT' },
        { id: 'p3', start_date: '2026-11-01', status: 'DRAFT' },
    ];
    const a = anticipo('a', '2026-10-10T16:00:00Z');   // en p1, que ya está aprobada
    it('entra en la primera quincena abierta posterior, marcado como rezagado', () => {
        const m = anticiposDeLaQuincena([a], { periodId: 'p2', start: '2026-10-16', end: '2026-10-31' }, new Map(), periodos);
        expect(m.get('e1').solicitudes).toEqual([{ id: 'a', monto: 30, rezagado: true }]);
    });
    it('no salta a una posterior si hay otra abierta antes', () => {
        const m = anticiposDeLaQuincena([a], { periodId: 'p3', start: '2026-11-01', end: '2026-11-15' }, new Map(), periodos);
        expect(m.size).toBe(0);
    });
    it('una sola vez: si ya entró en otra, no vuelve', () => {
        const m = anticiposDeLaQuincena([a], { periodId: 'p2', start: '2026-10-16', end: '2026-10-31' }, new Map([['a', 'p9']]), periodos);
        expect(m.size).toBe(0);
    });
    it('si su quincena sigue en borrador, o nunca se abrió, no se arrastra', () => {
        const abierta = periodos.map(p => (p.id === 'p1' ? { ...p, status: 'DRAFT' } : p));
        expect(anticiposDeLaQuincena([a], { periodId: 'p2', start: '2026-10-16', end: '2026-10-31' }, new Map(), abierta).size).toBe(0);
        expect(anticiposDeLaQuincena([a], { periodId: 'p2', start: '2026-10-16', end: '2026-10-31' }, new Map(), []).size).toBe(0);
    });
});
