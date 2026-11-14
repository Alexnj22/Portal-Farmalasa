import { describe, it, expect } from 'vitest';
import {
    problemaDeBaja, avisosDeBaja, liquidacionEstimada, ausenciasConfiguranCausal, respaldoDeBajaObligatorio, pendientesDeBaja, diasDeAguinaldo, CAUSALES_ART_50,
} from '@nucleo/utils/bajaLegal';
import { validarNovedad } from '@nucleo/utils/novedadDePersonal';
import { htmlDeActaYCarta } from '@nucleo/utils/papelDeBaja';

const emp = { id: 1, status: 'ACTIVO', hire_date: '2020-03-01' };
const comun = { type: 'TERMINATION', date: '2026-11-30', ultimoDiaLaborado: '2026-11-30', note: 'x' };

describe('renuncia', () => {
    const ok = { ...comun, terminationReason: 'RENUNCIA', hojaRenunciaExpedida: '2026-11-10', renunciaPresentada: '2026-11-12' };
    it('completa pasa', () => expect(problemaDeBaja(ok, emp)).toBeNull());
    it('sin la hoja no pasa', () => expect(problemaDeBaja({ ...ok, hojaRenunciaExpedida: '' }, emp)).toMatch(/hoja oficial/));
    it('hoja presentada después de 10 días no vale (Art. 402)', () =>
        expect(problemaDeBaja({ ...ok, renunciaPresentada: '2026-11-25' }, emp)).toMatch(/10 días/));
    it('preaviso corto se avisa, no frena', () => {
        expect(avisosDeBaja({ ...ok, date: '2026-11-20' }, emp)[0]).toMatch(/Preaviso de 8 días/);
    });
});

describe('despidos', () => {
    const sin = { ...comun, terminationReason: 'DESPIDO_SIN_RESPONSABILIDAD', fueroDeclarado: 'NO', causalArt50: 16, fechaDeLosHechos: '2026-11-25', pruebas: 'Acta del 25/11 firmada por dos testigos' };
    it('completo pasa', () => expect(problemaDeBaja(sin, emp)).toBeNull());
    it('sin responder el fuero no pasa', () => expect(problemaDeBaja({ ...sin, fueroDeclarado: undefined }, emp)).toMatch(/embarazada/));
    it('con fuero se frena', () => expect(problemaDeBaja({ ...sin, fueroDeclarado: 'SI' }, emp)).toMatch(/Art\. 113/));
    it('sin causal no pasa', () => expect(problemaDeBaja({ ...sin, causalArt50: '' }, emp)).toMatch(/causal/));
    it('sin pruebas no pasa', () => expect(problemaDeBaja({ ...sin, pruebas: 'nada' }, emp)).toMatch(/pruebas/));
    it('la causal 1 caduca a los 30 días', () => expect(problemaDeBaja({ ...sin, causalArt50: 1 }, emp)).toMatch(/30 días/));
    it('la causal 12 exige las ausencias', () => {
        expect(problemaDeBaja({ ...sin, causalArt50: 12 }, emp)).toMatch(/ausencias/);
        expect(problemaDeBaja({ ...sin, causalArt50: 12, diasDeAusencia: ['2026-11-20', '2026-11-21'] }, emp)).toBeNull();
    });
    it('con responsabilidad sólo pide el fuero', () =>
        expect(problemaDeBaja({ ...comun, terminationReason: 'DESPIDO_CON_RESPONSABILIDAD', fueroDeclarado: 'NO' }, emp)).toBeNull());
    it('las 20 causales', () => expect(CAUSALES_ART_50.map((c) => c.n)).toEqual([...Array(20)].map((_, i) => i + 1)));
});

describe('abandono', () => {
    const ab = { ...comun, terminationReason: 'ABANDONO', fueroDeclarado: 'NO', diasDeAusencia: ['2026-11-03', '2026-11-10', '2026-11-17'], intentoDeContacto: 'Llamadas el 18 y 19, mensaje por WhatsApp' };
    it('completo pasa', () => expect(problemaDeBaja(ab, emp)).toBeNull());
    it('sin intento de contacto no pasa', () => expect(problemaDeBaja({ ...ab, intentoDeContacto: '' }, emp)).toMatch(/contactar/));
    it('2 sueltas no alcanzan', () => expect(ausenciasConfiguranCausal(['2026-11-03', '2026-11-10'])).toBe(false));
    it('sábado y lunes con el domingo de descanso son consecutivos', () => {
        expect(ausenciasConfiguranCausal(['2026-10-31', '2026-11-02'])).toBe(false);
        expect(ausenciasConfiguranCausal(['2026-10-31', '2026-11-02'], 0)).toBe(true);
        expect(ausenciasConfiguranCausal(['2026-10-31', '2026-11-02'], 3)).toBe(false);
    });
    it('el abandono no exige el respaldo para registrar (quien no vuelve no firma)', () => {
        expect(respaldoDeBajaObligatorio('ABANDONO')).toBe(false);
        expect(respaldoDeBajaObligatorio('RENUNCIA')).toBe(true);
        expect(pendientesDeBaja('ABANDONO').some((p) => p.clave === 'cartaEntregada')).toBe(true);
        expect(pendientesDeBaja('RENUNCIA').some((p) => p.clave === 'cartaEntregada')).toBe(false);
    });
    it('acta y carta: las ausencias, la causal 12 y el patrono', () => {
        const html = htmlDeActaYCarta({ empleado: { name: 'ANA PÉREZ' }, sucursal: 'Salud 5', formData: { terminationReason: 'ABANDONO', date: '2026-11-13', diasDeAusencia: ['2026-10-27', '2026-10-28'], ultimoDiaLaborado: '2026-10-25' } });
        expect(html).toMatch(/Acta de inasistencias/);
        expect(html).toMatch(/causal 12/);
        expect(html).toMatch(/27 de octubre de 2026/);
        expect(html).toMatch(/ALEMÁN/);
    });
    it('2 seguidas o 3 en el mes sí', () => {
        expect(ausenciasConfiguranCausal(['2026-11-03', '2026-11-04'])).toBe(true);
        expect(ausenciasConfiguranCausal(['2026-11-01', '2026-11-15', '2026-11-28'])).toBe(true);
    });
});

describe('validarNovedad usa las reglas de la baja', () => {
    it('dice qué falta', () => {
        const r = validarNovedad({ formData: { ...comun, terminationReason: 'RENUNCIA' }, empleado: emp });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/hoja oficial/);
    });
    it('falta el último día trabajado', () =>
        expect(problemaDeBaja({ ...comun, ultimoDiaLaborado: '', terminationReason: 'RENUNCIA' }, emp)).toMatch(/último día/));
});

describe('liquidación estimada', () => {
    const base = { salarioMensual: 600, ingreso: '2020-03-01', baja: '2026-11-30', salarioMinimoMensual: 408.8 };
    it('despido con responsabilidad: indemnización con tope de 4 mínimos y proporcionales', () => {
        const l = liquidacionEstimada({ ...base, motivo: 'DESPIDO_CON_RESPONSABILIDAD' });
        const ind = l.rubros.find((r) => r.clave === 'indemnizacion');
        // 600/30 = 20 diarios < 4 × 13.63 → sin tope; 30 × 20 × años
        expect(ind.monto).toBeCloseTo(30 * 20 * l.aniosDeServicio, -1);
        expect(l.rubros.filter((r) => r.clave !== 'quincena25').every((r) => r.aplica === true)).toBe(true);
        expect(l.total).toBeGreaterThan(ind.monto);
    });
    it('renuncia: prestación desde 2 años, salario topado en 2 mínimos', () => {
        const l = liquidacionEstimada({ ...base, salarioMensual: 1500, motivo: 'RENUNCIA' });
        const p = l.rubros.find((r) => r.clave === 'prestacionRenuncia');
        expect(p.monto).toBeCloseTo(15 * (2 * 408.8 / 30) * 6, 1);
    });
    it('renuncia con menos de 2 años: sin prestación', () => {
        const l = liquidacionEstimada({ ...base, ingreso: '2025-06-01', motivo: 'RENUNCIA' });
        expect(l.rubros.find((r) => r.clave === 'prestacionRenuncia')).toMatchObject({ monto: 0, aplica: false });
    });
    it('despido justificado: sin proporcionales (Arts. 187 y 202 CT)', () => {
        const l = liquidacionEstimada({ ...base, motivo: 'DESPIDO_SIN_RESPONSABILIDAD' });
        expect(l.rubros.find((r) => r.clave === 'vacaciones')).toMatchObject({ aplica: false, monto: 0 });
        expect(l.rubros.find((r) => r.clave === 'aguinaldo')).toMatchObject({ aplica: false, monto: 0 });
        expect(l.total).toBe(0);
    });
    it('renuncia con menos de 2 años: vacaciones y aguinaldo proporcionales sí (Art. 9 LRPERV)', () => {
        const l = liquidacionEstimada({ ...base, ingreso: '2025-06-01', motivo: 'RENUNCIA' });
        expect(l.rubros.find((r) => r.clave === 'vacaciones').aplica).toBe(true);
        expect(l.total).toBeGreaterThan(0);
    });
    it('renuncia sin preaviso: la prestación queda a revisar (Art. 2 LRPERV)', () => {
        const l = liquidacionEstimada({ ...base, motivo: 'RENUNCIA', preavisoDias: 3 });
        expect(l.rubros.find((r) => r.clave === 'prestacionRenuncia').aplica).toBe('revisar');
    });
    it('despido en los primeros 30 días: indemnización a revisar (Art. 28 CT)', () => {
        const l = liquidacionEstimada({ ...base, ingreso: '2026-11-10', motivo: 'DESPIDO_CON_RESPONSABILIDAD' });
        expect(l.rubros.find((r) => r.clave === 'indemnizacion').aplica).toBe('revisar');
    });
    it('quincena 25: 50% proporcional desde el 15 de enero, fuera del total', () => {
        const l = liquidacionEstimada({ ...base, motivo: 'RENUNCIA' });
        const q = l.rubros.find((r) => r.clave === 'quincena25');
        expect(q.aplica).toBe('revisar');
        expect(q.monto).toBeCloseTo(300 * (320 / 365), 1);
        expect(liquidacionEstimada({ ...base, salarioMensual: 2000, motivo: 'RENUNCIA' }).rubros.some((r) => r.clave === 'quincena25')).toBe(false);
    });
    it('sin salario no calcula', () => expect(liquidacionEstimada({ ...base, salarioMensual: null, motivo: 'RENUNCIA' })).toBeNull());
    it('días de aguinaldo por antigüedad', () => {
        expect([diasDeAguinaldo(1), diasDeAguinaldo(3), diasDeAguinaldo(10)]).toEqual([15, 19, 21]);
    });
});

describe('ultimaBajaPorPersona', () => {
    it('toma la más reciente vigente y descarta las canceladas', async () => {
        const { ultimaBajaPorPersona } = await import('@nucleo/utils/bajaLegal');
        const m = ultimaBajaPorPersona([
            { id: 1, employee_id: 7, date: '2025-01-10', motivo: 'RENUNCIA', sucursal: '3', cargo: '5' },
            { id: 2, employee_id: 7, date: '2026-11-30', motivo: 'ABANDONO', estado: 'CANCELLED', sucursal: '4' },
            { id: 3, employee_id: 7, date: '2026-10-01', motivo: 'DESPIDO_SIN_RESPONSABILIDAD', sucursal: '2', cargo: null },
        ]);
        expect(m.get('7')).toEqual({ id: 3, motivo: 'DESPIDO_SIN_RESPONSABILIDAD', fecha: '2026-10-01', sucursalId: 2, cargoId: null });
    });
});
