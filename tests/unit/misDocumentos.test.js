import { describe, expect, it } from 'vitest';
import { documentosDelExpediente, filtrarDocumentos, pestanasDeDocumentos, solicitudesConDocumento } from '@nucleo/utils/misDocumentos';

describe('misDocumentos', () => {
    const exp = documentosDelExpediente({ hire_date: '2024-01-01', employee_documents: [
        { url: 'https://x/a.pdf', category: 'DUI_FRENTE', uploaded_at: '2026-01-02' }, { url: null },
    ] });
    const sols = solicitudesConDocumento([
        { id: 1, type: 'DISABILITY', status: 'APPROVED', created_at: '2026-09-01', metadata: '{"docUrl":"https://x/b.jpg"}' },
        { id: 2, type: 'PERMIT', status: 'PENDING', created_at: '2026-09-02', metadata: {} },
        { id: 3, type: 'CERTIFICATE', status: 'PENDING', created_at: '2026-09-03', metadata: { certificateType: 'LABORAL' } },
    ]);
    it('arma el expediente y las solicitudes con documento', () => {
        expect(exp.length).toBe(1);
        expect(exp[0]).toMatchObject({ type: 'EXPEDIENTE', status: 'EN_EXPEDIENTE' });
        expect(sols.map((s) => s.id)).toEqual([1, 3]);
    });
    it('pestañas con cuenta, sin las vacías', () => {
        expect(pestanasDeDocumentos([...exp, ...sols]).map((t) => [t.key, t.cuenta])).toEqual([['ALL', 3], ['EXPEDIENTE', 1], ['DISABILITY', 1], ['CERTIFICATE', 1]]);
    });
    it('filtra por pestaña, estado y búsqueda', () => {
        const todos = [...exp, ...sols];
        expect(filtrarDocumentos(todos, { pestana: 'DISABILITY' }).length).toBe(1);
        expect(filtrarDocumentos(todos, { estado: 'PENDING' })[0].id).toBe(3);
        expect(filtrarDocumentos(todos, { busqueda: 'laboral' })[0].id).toBe(3);
    });
});
