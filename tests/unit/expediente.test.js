// ─────────────────────────────────────────────────────────────────────────────
// Qué le falta a un expediente — y qué NO le falta
// ─────────────────────────────────────────────────────────────────────────────
//
// Esta lista es ahora la ÚNICA señal de que una ficha está a medias: desde el
// 2026-08-26 el formulario deja guardar con sólo el nombre, así que si acá se
// escapa un campo, nadie más lo va a decir.
//
// Las pruebas que importan no son las de «falta X» sino las tres del final: un
// «NO_TIENE» declarado NO es un faltante, un menor NO debe DUI, y un mayor NO
// debe examen médico. Un detector que pide lo que no corresponde es el que
// termina desactivado.

import { describe, it, expect } from 'vitest';
import { faltantesDelExpediente, expedienteIncompleto, edadDe } from '../../src/utils/expediente';

const campos = (datos) => faltantesDelExpediente(datos).map(f => f.campo);

// Nace hace `n` años, con margen para que el mes no lo vuelva ambiguo.
const naceHace = (n) => {
    const h = new Date();
    return `${h.getFullYear() - n}-01-15`;
};

const COMPLETO = {
    first_names: 'MARIA', last_names: 'RIVAS', gender: 'F', marital_status: 'SOLTERO',
    birth_date: naceHace(30), nationality: 'Salvadoreña', address: 'COL. ESCALON',
    department: 'San Salvador', municipality: 'San Salvador Centro', distrito: 'San Salvador',
    profession: 'Dependiente', dui: '01234567-8',
    dui_lugar_expedicion: 'CHALATENANGO', dui_fecha_expedicion: '2020-05-04',
    role_id: 5, contract_type: 'INDEFINIDO', hire_date: '2026-09-01', branch_id: 2,
    base_salary: 400, periodo_pago: 'QUINCENAL',
    contrato_lugar_celebracion: 'CHALATENANGO', contrato_fecha_celebracion: '2026-08-31',
    code: '210', isss_estado: 'TIENE', afp_estado: 'TIENE',
    employee_documents: [
        { category: 'DUI_FRENTE', url: 'x' },
        { category: 'DUI_REVERSO', url: 'y' },
    ],
};

describe('faltantesDelExpediente', () => {
    it('un expediente completo no tiene faltantes', () => {
        expect(faltantesDelExpediente(COMPLETO)).toEqual([]);
        expect(expedienteIncompleto(COMPLETO)).toBe(false);
    });

    it('una ficha con sólo el nombre falta casi todo, y eso se puede guardar', () => {
        const faltan = campos({ first_names: 'MARIA', last_names: 'RIVAS' });
        expect(faltan).toContain('dui');
        expect(faltan).toContain('gender');
        expect(faltan).toContain('branch_id');
        expect(faltan).toContain('isss_estado');
        expect(faltan).not.toContain('first_names');
        expect(faltan.length).toBeGreaterThan(15);
    });

    it('cada faltante dice su artículo cuando lo tiene', () => {
        const dui = faltantesDelExpediente({ first_names: 'A', last_names: 'B' })
            .find(f => f.campo === 'dui');
        expect(dui.art).toBe('23 nº2');
    });

    it('un contrato a plazo sin fecha de fin falta — el Art. 25 lo presume indefinido', () => {
        expect(campos({ ...COMPLETO, contract_type: 'TEMPORAL', contract_end_date: null }))
            .toContain('contract_end_date');
        expect(campos({ ...COMPLETO, contract_type: 'TEMPORAL', contract_end_date: '2027-01-31' }))
            .not.toContain('contract_end_date');
    });

    // ── Lo que NO debe pedir ─────────────────────────────────────────────────

    it('un «NO_TIENE» declarado NO es un faltante', () => {
        // Es una respuesta, no un hueco. Lo que sigue después es el trámite.
        const faltan = campos({ ...COMPLETO, isss_estado: 'NO_TIENE', afp_estado: 'EN_TRAMITE' });
        expect(faltan).not.toContain('isss_estado');
        expect(faltan).not.toContain('afp_estado');
    });

    it('a un menor NO se le pide DUI: en El Salvador no se tramita hasta los 18', () => {
        const menor = {
            ...COMPLETO, birth_date: naceHace(17), dui: null,
            alt_identity_document: 'PN-123',
            employee_documents: [
                { category: 'DOCUMENTO_IDENTIDAD', url: 'x' },
                { category: 'EXAMEN_MEDICO', url: 'y' },
            ],
        };
        const faltan = campos(menor);
        expect(faltan).not.toContain('dui');
        expect(faltan).not.toContain('doc_dui');
        expect(faltan).toEqual([]);
    });

    it('a un menor SÍ se le pide el examen médico del Art. 117', () => {
        const menor = {
            ...COMPLETO, birth_date: naceHace(17), dui: null,
            alt_identity_document: 'PN-123',
            employee_documents: [{ category: 'DOCUMENTO_IDENTIDAD', url: 'x' }],
        };
        const examen = faltantesDelExpediente(menor).find(f => f.campo === 'examen_medico');
        expect(examen).toBeTruthy();
        expect(examen.art).toBe('117');
    });

    it('a un mayor NO se le pide examen médico', () => {
        expect(campos(COMPLETO)).not.toContain('examen_medico');
    });

    it('la imagen del DUI cuenta los DOS lados', () => {
        const soloFrente = { ...COMPLETO, employee_documents: [{ category: 'DUI_FRENTE', url: 'x' }] };
        expect(campos(soloFrente)).toContain('doc_dui');
    });
});

describe('edadDe', () => {
    it('no retrocede un día por leer la fecha como UTC', () => {
        // `new Date('2000-01-15')` se lee como UTC y en El Salvador (UTC−6)
        // cae el 14 por la tarde. Con el constructor por partes, no.
        expect(edadDe(naceHace(25))).toBe(25);
    });

    it('sin fecha devuelve null, no cero', () => {
        // Cero sería «recién nacido» y dispararía la rama de menor de edad.
        expect(edadDe(null)).toBe(null);
        expect(edadDe('')).toBe(null);
    });
});
