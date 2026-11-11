import { describe, it, expect } from 'vitest';
import {
    problemaDeBaja, avisosDeBaja, liquidacionEstimada, ausenciasConfiguranCausal, diasDeAguinaldo, CAUSALES_ART_50,
} from '@nucleo/utils/bajaLegal';
import { validarNovedad } from '@nucleo/utils/novedadDePersonal';

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
        expect(l.rubros.every((r) => r.aplica === true)).toBe(true);
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
    it('despido justificado: proporcionales a revisar, fuera del total', () => {
        const l = liquidacionEstimada({ ...base, motivo: 'DESPIDO_SIN_RESPONSABILIDAD' });
        expect(l.rubros.every((r) => r.aplica === 'revisar')).toBe(true);
        expect(l.total).toBe(0);
    });
    it('sin salario no calcula', () => expect(liquidacionEstimada({ ...base, salarioMensual: null, motivo: 'RENUNCIA' })).toBeNull());
    it('días de aguinaldo por antigüedad', () => {
        expect([diasDeAguinaldo(1), diasDeAguinaldo(3), diasDeAguinaldo(10)]).toEqual([15, 19, 21]);
    });
});
