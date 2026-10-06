import { describe, expect, it } from 'vitest';
import { filtrarBitacora, ordenarBitacora, varianteDeSeveridad } from '@nucleo/utils/bitacora';

describe('bitacora', () => {
    it('el día es el de El Salvador, no el del UTC', () => {
        // 7 p. m. del 5-oct en El Salvador son la 1 a. m. del 6 en UTC.
        const logs = [{ action: 'X', created_at: '2026-10-06T01:00:00Z' }];
        expect(filtrarBitacora(logs, { desde: '2026-10-05', hasta: '2026-10-05' })).toHaveLength(1);
        expect(filtrarBitacora(logs, { desde: '2026-10-06' })).toHaveLength(0);
    });
    it('por acción', () => {
        const logs = [{ action: 'A' }, { action: 'B' }];
        expect(filtrarBitacora(logs, { accion: 'B' })).toEqual([{ action: 'B' }]);
        expect(filtrarBitacora(logs)).toHaveLength(2);
    });
    it('el orden: la fecha como instante, lo demás como texto', () => {
        const logs = [{ created_at: '2026-10-05T10:00:00Z', user_name: 'b' }, { created_at: '2026-10-05T12:00:00Z', user_name: 'A' }];
        expect(ordenarBitacora(logs)[0].user_name).toBe('A');
        expect(ordenarBitacora(logs, { key: 'user_name', direction: 'asc' })[0].user_name).toBe('A');
        expect(varianteDeSeveridad('CRITICAL')).toBe('danger');
        expect(varianteDeSeveridad(undefined)).toBe('info');
    });
});
