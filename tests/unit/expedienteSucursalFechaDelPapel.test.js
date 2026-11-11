import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    documentosDeSucursal, esFechaDelPapel, fechaLeidaQueSeAplica, problemaDelDocumentoPropio,
    FECHA_DEL_ARCHIVO_LEGAL,
} from '@nucleo/utils/expedienteDeSucursal';

describe('cada documento abre el formulario que tiene su archivo', () => {
    // Solvencia, desechos y fumigación viven en «Gestión del inmueble»
    // (BranchTabInmueble); abrían «Configuración legal», que no los tiene.
    const b = { type: 'FARMACIA', propertyType: 'RENTED', settings: { legal: { injections: true, controlledBooks: true } } };
    const todos = (() => { const d = documentosDeSucursal(b); return [...d.permisos, ...d.personal, ...d.infra]; })();
    const modal = (id) => todos.find((d) => d.id === id)?.modal;
    it.each(['alcaldia', 'desechos', 'fumigacion', 'arrendamiento'])('%s → editBranchInmueble', (id) => {
        expect(modal(id)).toBe('editBranchInmueble');
    });
    it('libros sigue en Configuración legal', () => expect(modal('libros')).toBe('editBranchLegal'));
});

describe('esFechaDelPapel', () => {
    it.each([['2027-03-31', true], ['2027-02-30', false], ['31/03/2027', false], [null, false], ['1999-01-01', false], ['', false]])(
        '%s → %s', (v, ok) => expect(esFechaDelPapel(v)).toBe(ok));
});

describe('fechaLeidaQueSeAplica', () => {
    it('vacía y sin tocar → la del papel', () => {
        expect(fechaLeidaQueSeAplica({ leida: '2027-05-01', puesta: '', anterior: null })).toBe('2027-05-01');
    });
    it('renovación: la fecha vieja sin tocar se reemplaza', () => {
        expect(fechaLeidaQueSeAplica({ leida: '2027-05-01', puesta: '2026-05-01', anterior: '2026-05-01' })).toBe('2027-05-01');
    });
    it('si quien guarda la cambió, manda lo que escribió', () => {
        expect(fechaLeidaQueSeAplica({ leida: '2027-05-01', puesta: '2027-06-01', anterior: '2026-05-01' })).toBeNull();
    });
    it('una lectura inválida no toca nada', () => {
        expect(fechaLeidaQueSeAplica({ leida: 'null', puesta: '', anterior: '' })).toBeNull();
        expect(fechaLeidaQueSeAplica({ leida: undefined, puesta: '', anterior: '' })).toBeNull();
    });
    it('igual a la que ya está → nada que avisar', () => {
        expect(fechaLeidaQueSeAplica({ leida: '2027-05-01', puesta: '2027-05-01', anterior: '2027-05-01' })).toBeNull();
    });
});

describe('documento propio: la fecha puede esperar al papel', () => {
    const datos = { title: 'Rótulo', hasExpiration: true, expDate: '' };
    it('sin archivo, falta la fecha', () => expect(problemaDelDocumentoPropio(datos)).toMatch(/vencimiento/));
    it('con archivo por leer, se deja pasar', () => expect(problemaDelDocumentoPropio(datos, { seLeeDelArchivo: true })).toBeNull());
});

// ── updateBranch: sube, lee y guarda la fecha en el MISMO parche ──
const analizar = vi.fn();
const editar = vi.fn();
const toast = vi.fn();
vi.mock('@nucleo/data/ia', () => ({ analizarDocumento: (...a) => analizar(...a) }));
vi.mock('@nucleo/store/toastStore', () => ({ useToastStore: { getState: () => ({ showToast: toast }) } }));
vi.mock('@nucleo/supabaseClient', () => ({
    supabase: { storage: { from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: (p) => ({ data: { publicUrl: `https://x/${p}` } }),
    }) } },
}));
const FILA = JSON.stringify({ id: 2, name: 'Sala', settings: { legal: { municipalExpiration: '2026-01-31', srsExpiration: '2026-09-01' } } });
const fila = () => JSON.parse(FILA);
vi.mock('@nucleo/data/branches', () => ({
    fetchBranchRow: async () => ({ data: fila(), error: null }),
    editarSucursal: (...a) => editar(...a),
    insertBranchDocument: async () => ({ error: null }),
    insertBranch: vi.fn(), updateBranch: vi.fn(), deleteBranch: vi.fn(), fetchBranchDocuments: vi.fn(),
    fetchAuditLogsForBranch: vi.fn(), fetchActiveKioskDeviceCount: vi.fn(), insertKioskDevice: vi.fn(),
    updateKioskDevice: vi.fn(), fetchBranchKiosks: vi.fn(), fetchBranchExpenseRecord: vi.fn(),
    updateBranchExpense: vi.fn(), insertBranchExpense: vi.fn(),
}));

describe('updateBranch lee la fecha de los papeles nuevos', () => {
    beforeEach(() => { analizar.mockReset(); editar.mockReset(); toast.mockReset(); });

    const correr = async (legalDelFormulario) => {
        const { createBranchSlice } = await import('@nucleo/store/slices/branchSlice');
        const f = fila();
        let estado = { branches: [fila()], employees: [], appendAuditLog: async () => {} };
        const set = (f) => { estado = { ...estado, ...(typeof f === 'function' ? f(estado) : f) }; };
        const slice = createBranchSlice(set, () => ({ ...slice, ...estado }));
        editar.mockImplementation(async (id, columnas, parches) => ({
            data: { antes: fila(), despues: { ...f, settings: { legal: { ...f.settings.legal, ...legalDelFormulario } } } }, error: null,
            parches,
        }));
        await slice.updateBranch(2, { ...f, settings: { legal: { ...f.settings.legal, ...legalDelFormulario } } });
        return editar.mock.calls[0][2];
    };
    const archivo = () => new File(['x'], 'solvencia.pdf', { type: 'application/pdf' });

    it('solvencia renovada: el vencimiento viejo se cambia por el del papel', async () => {
        analizar.mockResolvedValue({ data: { success: true, aiData: { expDate: '2027-01-31' } }, error: null });
        const parches = await correr({ municipalFile: archivo() });
        expect(analizar).toHaveBeenCalledWith(expect.objectContaining({ bucketName: 'documents', sinResumen: true }));
        expect(JSON.stringify(parches)).toContain('2027-01-31');
        expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Fecha tomada/), expect.stringMatching(/Solvencia Municipal/), 'success');
    });

    it('si la persona escribió otra fecha, se respeta', async () => {
        analizar.mockResolvedValue({ data: { success: true, aiData: { expDate: '2027-01-31' } }, error: null });
        const parches = await correr({ municipalFile: archivo(), municipalExpiration: '2027-02-28' });
        expect(JSON.stringify(parches)).toContain('2027-02-28');
        expect(JSON.stringify(parches)).not.toContain('2027-01-31');
    });

    it('si la lectura falla, se guarda igual con lo que había', async () => {
        analizar.mockResolvedValue({ data: null, error: new Error('modelo caído') });
        const parches = await correr({ municipalFile: archivo() });
        expect(JSON.stringify(parches)).toContain('municipalUrl');
        expect(JSON.stringify(parches)).not.toContain('municipalExpiration');
        expect(toast).not.toHaveBeenCalled();
    });

    it('sin archivo nuevo no se llama al modelo', async () => {
        await correr({ srsExpiration: '2027-09-01' });
        expect(analizar).not.toHaveBeenCalled();
    });

    it('todos los archivos legales con fecha están mapeados a un campo', () => {
        expect(Object.keys(FECHA_DEL_ARCHIVO_LEGAL).sort()).toEqual([
            'controlledBooksFile', 'farmacovigilanciaAuthFile', 'fumigationFile', 'municipalFile',
            'nursingServicePermitFile', 'regentCredentialFile', 'srsPermitFile', 'wasteFile',
        ]);
    });
});

describe('limpiarAjustes no destruye el archivo adjunto', () => {
    it('un File sigue siendo File después de otro cambio del formulario', async () => {
        const { limpiarAjustes } = await import('@nucleo/utils/edicionDeSucursal');
        const f = new File(['x'], 'solvencia.pdf', { type: 'application/pdf' });
        const app = { name: 'a.pdf', body: new ArrayBuffer(4), contentType: 'application/pdf' };
        const s = limpiarAjustes({ legal: { municipalFile: f, municipalExpiration: '' }, rent: { contract: { documentFile: app } } });
        expect(s.legal.municipalFile).toBe(f);
        expect(s.rent.contract.documentFile.body).toBe(app.body);
        // Sigue siendo una copia: cambiarla no toca el original.
        const original = { legal: { a: 1 } };
        limpiarAjustes(original).legal.a = 2;
        expect(original.legal.a).toBe(1);
        expect(limpiarAjustes('{"legal":{"x":1}}')).toEqual({ legal: { x: 1 } });
    });
});
