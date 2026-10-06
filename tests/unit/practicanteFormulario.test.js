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
