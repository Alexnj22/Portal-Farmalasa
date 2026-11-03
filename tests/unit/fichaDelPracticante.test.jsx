// La pestaña Personal del practicante sólo pide lo que le aplica (2026-11-03,
// «¿por qué aparece ISSS, AFP?… verifica el Código de Trabajo»). Se dibuja la
// misma ficha dos veces —empleado y practicante— y se compara lo que se ve.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@nucleo/data/supabaseClient', () => {
    const q = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }),
        then: (r) => r({ data: [], error: null }) };
    return { supabase: { from: () => q, rpc: async () => ({ data: [], error: null }),
        storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
        auth: { getSession: async () => ({ data: { session: null } }) } } };
});

vi.mock('@nucleo/context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'x', role: 'Gerente General' } }),
    AuthProvider: ({ children }) => children,
}));

const { default: EmployeeFormModal } = await import('../../src/components/forms/EmployeeFormModal.jsx');

const dibujar = (tipo_ficha) => render(
    <MemoryRouter>
        <EmployeeFormModal formData={{ tipo_ficha, documents: [], chronic_conditions: [], dependents: [] }}
            setFormData={() => {}} branches={[]} roles={[]} activeTab="personal" setActiveTab={() => {}} />
    </MemoryRouter>);

const TEXTOS = [/ISSS y AFP/i, /Dependen Económicamente/i, /Tipo de Sangre/i, /Estado Civil/i,
    /Nivel Académico/i, /Vehículos/i, /ya trabajaba aquí/i];

describe('pestaña Personal', () => {
    it('el empleado ve todo', () => {
        dibujar('empleado');
        for (const t of TEXTOS) expect(screen.queryAllByText(t).length, String(t)).toBeGreaterThan(0);
    });
    it('el practicante no ve lo que el Código no le pide, y sí a quién avisar', () => {
        dibujar('practicante');
        for (const t of TEXTOS) expect(screen.queryAllByText(t).length, String(t)).toBe(0);
        expect(screen.getAllByText(/A quién avisar/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Dónde vive/i).length).toBeGreaterThan(0);
    });
});

describe('lo que falta del expediente', () => {
    it('al practicante no le pide lo que la pantalla le escondió', async () => {
        const { faltantesDelExpediente } = await import('@nucleo/utils/expediente');
        const campos = faltantesDelExpediente({ tipo_ficha: 'practicante', documents: [] }).map(f => f.campo);
        for (const c of ['gender', 'marital_status', 'nationality', 'profession', 'isss_estado', 'afp_estado',
            'base_salary', 'contract_type', 'dui_lugar_expedicion', 'dui_fecha_expedicion']) {
            expect(campos, c).not.toContain(c);
        }
        expect(campos).toContain('first_names');
    });
});
