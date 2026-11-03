import { describe, expect, it } from 'vitest';
import { filaDePracticante, formularioDePracticante, validarPracticante } from '@nucleo/utils/practicanteFormulario';

const base = {
    ...formularioDePracticante(null),
    first_names: 'Ana', last_names: 'Pérez', branch_id: '3', institucion_educativa: 'UES',
    tutor_nombre: 'Lic. Ruiz', fecha_inicio: '2026-10-01', fecha_fin: '2026-12-01',
};

describe('practicanteFormulario', () => {
    it('sin convenio no se registra', () => {
        expect(validarPracticante(base, { tieneConvenio: false }).valido).toBe(false);
        expect(validarPracticante(base, { tieneConvenio: true }).valido).toBe(true);
    });
    it('un menor necesita documento alterno', () => {
        const menor = { ...base, birth_date: '2012-01-01' };
        expect(validarPracticante(menor, { tieneConvenio: true }).faltaDocumentoAlterno).toBe(true);
        expect(validarPracticante({ ...menor, alt_identity_document: 'Partida 123' }, { tieneConvenio: true }).valido).toBe(true);
    });
    it('el fin tiene que ser después del inicio', () => {
        expect(validarPracticante({ ...base, fecha_fin: '2026-09-01' }, { tieneConvenio: true }).fechasInvalidas).toBe(true);
    });
    it('la fila convierte tipos y limpia vacíos', () => {
        const f = filaDePracticante({ ...base, horas_requeridas: '200', phone: '  ' }, 'url');
        expect(f.branch_id).toBe(3);
        expect(f.horas_requeridas).toBe(200);
        expect(f.phone).toBeNull();
        expect(f.convenio_url).toBe('url');
    });
});

// ── La pasantía dentro de la ficha (2026-11-03) ─────────────────────────────
import {
    motivoPasantiaIncompleta, filaDePracticanteDesdeFicha, fichaConPasantia, pasantiaDe, PASANTIA_VACIA,
} from '@nucleo/utils/practicanteFormulario';
import { faltantesDelExpediente } from '@nucleo/utils/expediente';

describe('pasantía de una ficha de practicante', () => {
    const persona = { first_names: 'ANA', last_names: 'PEREZ', birth_date: '2000-01-01', dui: '', branch_id: 27 };
    const pasantia = { ...PASANTIA_VACIA, institucion_educativa: 'ITCHA', tutor_nombre: 'TUTOR',
        fecha_inicio: '2026-11-03', fecha_fin: '2026-11-30', horas_requeridas: '160' };

    it('completa y con convenio, se puede guardar', () => {
        expect(motivoPasantiaIncompleta(persona, pasantia, { tieneConvenio: true })).toBeNull();
    });
    it('dice qué falta: sala, institución, convenio, fechas al revés', () => {
        expect(motivoPasantiaIncompleta({ ...persona, branch_id: '' }, pasantia, { tieneConvenio: true })).toMatch(/sucursal/);
        expect(motivoPasantiaIncompleta(persona, { ...pasantia, institucion_educativa: '' }, { tieneConvenio: true })).toMatch(/institución/);
        expect(motivoPasantiaIncompleta(persona, pasantia, { tieneConvenio: false })).toMatch(/convenio/);
        expect(motivoPasantiaIncompleta(persona, { ...pasantia, fecha_fin: '2026-11-01' }, { tieneConvenio: true })).toMatch(/posterior/);
    });
    it('la fila copia la identidad de la ficha y lleva el employee_id', () => {
        const f = filaDePracticanteDesdeFicha(persona, pasantia, 'url', 'emp-1');
        expect(f).toMatchObject({ first_names: 'ANA', branch_id: 27, institucion_educativa: 'ITCHA',
            horas_requeridas: 160, convenio_url: 'url', employee_id: 'emp-1' });
    });
    it('fichaConPasantia trae la fila que nombra a la ficha, y no toca a un empleado', () => {
        const fila = { id: 'p1', employee_id: 'emp-1', convenio_url: 'u', ...pasantia };
        const r = fichaConPasantia({ id: 'emp-1', tipo_ficha: 'practicante' }, [fila]);
        expect(r.pasantia_id).toBe('p1');
        expect(r.pasantia_convenio_url).toBe('u');
        expect(r.pasantia).toEqual(pasantiaDe(fila));
        const emp = { id: 'x', tipo_ficha: 'empleado' };
        expect(fichaConPasantia(emp, [fila])).toBe(emp);
    });
    it('al practicante no se le piden contrato, sueldo ni ISSS/AFP', () => {
        const campos = faltantesDelExpediente({ tipo_ficha: 'practicante' }).map(f => f.campo);
        for (const c of ['contract_type', 'base_salary', 'periodo_pago', 'isss_estado', 'afp_estado', 'contrato_fecha_celebracion']) {
            expect(campos).not.toContain(c);
        }
        expect(campos).toContain('address');
        expect(faltantesDelExpediente({}).map(f => f.campo)).toContain('base_salary');
    });
});
