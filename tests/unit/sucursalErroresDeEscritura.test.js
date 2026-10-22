// Auditoría 2026-10 (grupo 3, H3): tres llamadas de `branchSlice` ignoraban
// su `error`. Estas pruebas fabrican el fallo de la base y miran qué hace el
// store — que es justo lo que no se veía, porque un error ignorado no falla.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
    insertBranch: vi.fn(),
    updateBranch: vi.fn(),
    updateBranchReturning: vi.fn(),
    insertBranchDocument: vi.fn(),
    fetchBranchDocuments: vi.fn(),
    fetchAuditLogsForBranch: vi.fn(),
}));

vi.mock('@nucleo/supabaseClient', () => ({
    supabase: {
        storage: {
            from: () => ({
                upload: vi.fn(async () => ({ error: null })),
                getPublicUrl: (ruta) => ({ data: { publicUrl: `https://x/public/documents/${ruta}` } }),
            }),
        },
    },
}));
vi.mock('@nucleo/data/branches', () => db);

const { createBranchSlice } = await import('@nucleo/store/slices/branchSlice');
const { useToastStore } = await import('@nucleo/store/toastStore');

const archivo = { name: 'nuevo.pdf', body: new ArrayBuffer(4), contentType: 'application/pdf' };

function armar(branches = []) {
    let estado = { branches, branchHistory: {} };
    const appendAuditLog = vi.fn(async () => {});
    const set = (u) => { estado = { ...estado, ...(typeof u === 'function' ? u(estado) : u) }; };
    const get = () => ({ ...slice, ...estado, appendAuditLog });
    const slice = createBranchSlice(set, get);
    return { slice, leer: () => estado, appendAuditLog };
}

beforeEach(() => {
    Object.values(db).forEach(f => f.mockReset());
    vi.restoreAllMocks();
});

describe('crear sucursal: el enlace del contrato', () => {
    it('si no se guarda, la sala igual queda registrada y se AVISA (no se crea dos veces)', async () => {
        db.insertBranch.mockResolvedValue({ data: { id: 9, name: 'Salud 9', settings: {}, weekly_hours: {} }, error: null });
        db.updateBranch.mockResolvedValue({ error: { message: 'permission denied' } });
        const toast = vi.spyOn(useToastStore.getState(), 'showToast').mockImplementation(() => {});
        toast.mockClear();
        const { slice, leer } = armar();

        const id = await slice.addBranch({ name: 'Salud 9', settings: { rent: { contract: { documentFile: archivo } } } });

        expect(id).toBe(9);
        const sala = leer().branches.find(b => b.id === 9);
        expect(sala).toBeTruthy();
        // No dice tener un contrato que no quedó guardado.
        expect(sala.settings.rent.contract.documentUrl).toBeUndefined();
        expect(toast).toHaveBeenCalledWith('Falta el contrato', expect.stringMatching(/contrato/), 'error');
    });

    it('si se guarda, no avisa nada', async () => {
        db.insertBranch.mockResolvedValue({ data: { id: 9, name: 'Salud 9', settings: {}, weekly_hours: {} }, error: null });
        db.updateBranch.mockResolvedValue({ error: null });
        const toast = vi.spyOn(useToastStore.getState(), 'showToast').mockImplementation(() => {});
        toast.mockClear();
        const { slice, leer } = armar();
        await slice.addBranch({ name: 'Salud 9', settings: { rent: { contract: { documentFile: archivo } } } });
        expect(leer().branches[0].settings.rent.contract.documentUrl).toMatch(/contrato_alquiler/);
        expect(toast).not.toHaveBeenCalled();
    });
});

describe('editar sucursal: la fila «Histórico» del documento reemplazado', () => {
    const sala = { id: 3, name: 'Salud 3', settings: { legal: { municipalUrl: 'https://x/viejo.pdf', wasteUrl: 'https://x/desechos.pdf' } } };
    const cambios = { name: 'Salud 3', settings: { legal: { municipalFile: archivo, wasteFile: archivo } } };

    it('si el historial no entra, NO se toca la ficha y se lanza con un mensaje', async () => {
        db.insertBranchDocument.mockResolvedValue({ error: { message: 'boom' } });
        const { slice, leer } = armar([sala]);

        await expect(slice.updateBranch(3, cambios)).rejects.toThrow(/historial/);
        expect(db.updateBranchReturning).not.toHaveBeenCalled();
        expect(leer().branches[0]).toBe(sala);
    });

    it('los dos históricos van en UN solo INSERT, antes de escribir la ficha', async () => {
        const orden = [];
        db.insertBranchDocument.mockImplementation(async () => { orden.push('historial'); return { error: null }; });
        db.updateBranchReturning.mockImplementation(async (id, p) => { orden.push('ficha'); return { data: { id, ...p }, error: null }; });
        const { slice } = armar([sala]);

        await slice.updateBranch(3, cambios);

        expect(db.insertBranchDocument).toHaveBeenCalledTimes(1);
        const filas = db.insertBranchDocument.mock.calls[0][0];
        expect(filas.map(f => f.file_url).sort()).toEqual(['https://x/desechos.pdf', 'https://x/viejo.pdf']);
        expect(filas.every(f => f.status === 'HISTÓRICO' && f.branch_id === 3)).toBe(true);
        expect(orden).toEqual(['historial', 'ficha']);
    });

    it('sin documentos reemplazados no escribe historial', async () => {
        db.updateBranchReturning.mockImplementation(async (id, p) => ({ data: { id, ...p }, error: null }));
        const { slice } = armar([sala]);
        await slice.updateBranch(3, { name: 'Salud 3', settings: {} });
        expect(db.insertBranchDocument).not.toHaveBeenCalled();
    });
});

describe('historial de la sucursal: error no es vacío', () => {
    it('vacío de verdad devuelve []', async () => {
        db.fetchBranchDocuments.mockResolvedValue({ data: [], error: null });
        db.fetchAuditLogsForBranch.mockResolvedValue({ data: [], error: null });
        const { slice } = armar();
        await expect(slice.getBranchHistory(3)).resolves.toEqual([]);
    });

    it('si falla la lectura de documentos, lanza (no devuelve «sin historial»)', async () => {
        db.fetchBranchDocuments.mockResolvedValue({ data: null, error: { message: 'timeout' } });
        db.fetchAuditLogsForBranch.mockResolvedValue({ data: [], error: null });
        const { slice, leer } = armar();
        await expect(slice.getBranchHistory(3)).rejects.toThrow(/No se pudo cargar el historial/);
        expect(leer().branchHistory[3]).toBeUndefined();
    });

    it('si falla la bitácora, también lanza', async () => {
        db.fetchBranchDocuments.mockResolvedValue({ data: [{ id: 1, created_at: '2026-10-01' }], error: null });
        db.fetchAuditLogsForBranch.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
        const { slice } = armar();
        await expect(slice.getBranchHistory(3)).rejects.toThrow();
    });

    it('con datos, mezcla y ordena del más nuevo al más viejo', async () => {
        db.fetchBranchDocuments.mockResolvedValue({ data: [{ id: 'd', created_at: '2026-10-01' }], error: null });
        db.fetchAuditLogsForBranch.mockResolvedValue({ data: [{ id: 'l', created_at: '2026-10-05' }], error: null });
        const { slice } = armar();
        const r = await slice.getBranchHistory(3);
        expect(r.map(x => x.id)).toEqual(['l', 'd']);
    });
});
