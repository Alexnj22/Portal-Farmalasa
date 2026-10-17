import { describe, it, expect } from 'vitest';
import { primaPorPersona, periodoVigente, rotuloDelPeriodo, estadoEnElSeguro } from '@nucleo/utils/seguroDeVida';
import { loQueFalta, finDesdePlazo, camposDesdeLectura, cuotaDeLaQuincena, descuentosPorOrdenes } from '@nucleo/utils/ordenDeDescuento';
import { bancoDelTexto } from '@nucleo/constants/bancos';
import { revisarNup } from '@nucleo/utils/nupAfp';

describe('seguro de vida colectivo', () => {
    it('la prima sale de suma × tasa por millar, salvo que esté escrita', () => {
        expect(primaPorPersona({ suma_asegurada: 5000, tasa_por_millar: 6.5 })).toBe(32.5);
        expect(primaPorPersona({ suma_asegurada: 5000, tasa_por_millar: 6.5, prima_por_persona: 35 })).toBe(35);
    });
    it('el periodo cambia en noviembre, no en enero', () => {
        expect(periodoVigente(new Date(2026, 9, 31))).toBe(2025);
        expect(periodoVigente(new Date(2026, 10, 1))).toBe(2026);
        expect(periodoVigente(new Date(2027, 2, 15))).toBe(2026);
        expect(rotuloDelPeriodo(2026)).toBe('nov 2026 – oct 2027');
    });
    it('solvente = está en el listado del pago vigente', () => {
        const pago = { anio: 2026, cubiertos: [{ employee_id: 'a' }] };
        expect(estadoEnElSeguro('a', pago).clave).toBe('solvente');
        expect(estadoEnElSeguro('b', pago).clave).toBe('no_cubierto');
        expect(estadoEnElSeguro('a', null).clave).toBe('sin_pago');
    });
});

describe('orden de descuento', () => {
    const hoy = new Date(2026, 9, 14);
    it('cuenta las cuotas que faltan, incluida la de este mes', () => {
        const f = loQueFalta({ fecha_inicio: '2026-01-15', fecha_fin: '2026-12-15', cuota: 50, plazo_cuotas: 12 }, hoy);
        expect(f.cuotasRestantes).toBe(3);
        expect(f.saldo).toBe(150);
        expect(f.avance).toBeCloseTo(0.75);
    });
    it('quincenal = dos por mes; terminada = 0', () => {
        expect(loQueFalta({ fecha_fin: '2026-11-30', cuota: 20, periodicidad: 'QUINCENAL' }, hoy).cuotasRestantes).toBe(4);
        expect(loQueFalta({ fecha_fin: '2026-01-30', cuota: 20 }, hoy).terminada).toBe(true);
        expect(loQueFalta({ fecha_fin: '2027-01-30', estado: 'FINALIZADA' }, hoy).cuotasRestantes).toBe(0);
    });
    it('sin fecha de fin no inventa', () => {
        expect(loQueFalta({ cuota: 20 }, hoy).cuotasRestantes).toBeNull();
    });
    it('la fecha de fin se puede derivar del plazo', () => {
        expect(finDesdePlazo('2026-01-15', 12)).toBe('2026-12-15');
        expect(finDesdePlazo('2026-01-15', 24, 'QUINCENAL')).toBe('2026-12-15');
    });
    it('la lectura llena sólo lo que trae y reconoce el banco', () => {
        const c = camposDesdeLectura({ banco: 'BANCO DAVIVIENDA SALVADOREÑO, S.A.', cuota: '$125.50', plazo: 36, inicio: '2026-02-01', fin: null, tasa: null });
        expect(c.banco).toBe('Banco Davivienda');
        expect(c.cuota).toBe(125.5);
        expect(c.tasa_interes).toBe('');
        expect(c.fecha_fin).toBe('2029-01-01');
    });
});

describe('bancos', () => {
    it('reconoce sin inventar', () => {
        expect(bancoDelTexto('Banco Agricola S.A.')).toBe('Banco Agrícola');
        expect(bancoDelTexto('PRIMER BANCO DE LOS TRABAJADORES')).toBe('Primer Banco de los Trabajadores');
        expect(bancoDelTexto('Cooperativa La Inventada')).toBeNull();
        expect(bancoDelTexto('')).toBeNull();
    });
});

describe('NUP', () => {
    it('el DUI de la ficha vale como NUP', () => {
        expect(revisarNup('01234567-8', '01234567-8').ok).toBe(true);
        expect(revisarNup('012345678', '01234567-8').esElDui).toBe(true);
    });
});

// ── La planilla toma la cuota de las órdenes vigentes (2026-10-17) ───────────

describe('cuotaDeLaQuincena', () => {
    const base = { estado: 'VIGENTE', cuota: 100.01, periodicidad: 'MENSUAL', fecha_inicio: '2026-10-05', fecha_fin: '2027-03-05' };
    it('mensual: se parte en dos y las dos mitades suman la cuota al centavo', () => {
        const a = cuotaDeLaQuincena(base, '2026-10-01');
        const b = cuotaDeLaQuincena(base, '2026-10-16');
        expect(a).toBe(50);
        expect(b).toBe(50.01);
        expect(Math.round((a + b) * 100) / 100).toBe(100.01);
    });
    it('quincenal: la cuota entera cada quincena', () => {
        expect(cuotaDeLaQuincena({ ...base, periodicidad: 'QUINCENAL' }, '2026-11-16')).toBe(100.01);
    });
    it('por mes: incluye el mes de inicio y el de fin, nada fuera', () => {
        expect(cuotaDeLaQuincena(base, '2026-09-16')).toBe(0);
        expect(cuotaDeLaQuincena(base, '2027-03-16')).toBe(50.01);
        expect(cuotaDeLaQuincena(base, '2027-04-01')).toBe(0);
    });
    it('sólo vigente y con cuota', () => {
        expect(cuotaDeLaQuincena({ ...base, estado: 'FINALIZADA' }, '2026-10-01')).toBe(0);
        expect(cuotaDeLaQuincena({ ...base, cuota: '' }, '2026-10-01')).toBe(0);
    });
    it('suma por persona', () => {
        const m = descuentosPorOrdenes([
            { ...base, employee_id: 'a' },
            { ...base, employee_id: 'a', cuota: 20, periodicidad: 'QUINCENAL' },
            { ...base, employee_id: 'b', estado: 'CANCELADA' },
        ], '2026-10-01');
        expect(m.get('a')).toBe(70);
        expect(m.has('b')).toBe(false);
    });
});
