// Un archivo que reemplaza a otro no hereda su vencimiento, y las caras del DUI
// vencen cuando vence el DUI (2026-10-22). Lo usan la app y el portal.
import { describe, it, expect } from 'vitest';
import { parcheDeArchivoNuevo, carasConElVencimientoDelDui } from '@nucleo/utils/documentosDelExpediente';

describe('parcheDeArchivoNuevo', () => {
    const subida = { url: 'https://x/nuevo.jpg', file_name: 'nuevo.jpg' };

    it('al reemplazar, vacía el vencimiento del archivo anterior', () => {
        const p = parcheDeArchivoNuevo({ url: 'https://x/viejo.jpg', expiry_date: '2026-03-12' }, subida, 'T');
        expect(p).toEqual({ ...subida, uploaded_at: 'T', expiry_date: '' });
    });

    it('el primer archivo respeta la fecha escrita antes', () => {
        const p = parcheDeArchivoNuevo({ url: null, expiry_date: '2030-01-01' }, subida, 'T');
        expect(p).toEqual({ ...subida, uploaded_at: 'T' });
        expect(parcheDeArchivoNuevo(undefined, subida, 'T')).toEqual({ ...subida, uploaded_at: 'T' });
    });
});

describe('carasConElVencimientoDelDui', () => {
    const lista = [
        { category: 'DUI_FRENTE', url: 'a', expiry_date: '2026-03-12' },
        { category: 'DUI_REVERSO', url: null, expiry_date: '' },
        { category: 'NIT', url: 'b', expiry_date: '2026-03-12' },
    ];

    it('pone la fecha sólo en las caras cargadas', () => {
        const r = carasConElVencimientoDelDui(lista, '2034-03-08');
        expect(r.map((d) => d.expiry_date)).toEqual(['2034-03-08', '', '2026-03-12']);
    });

    it('sin fecha o sin cambio devuelve la misma lista', () => {
        expect(carasConElVencimientoDelDui(lista, null)).toBe(lista);
        expect(carasConElVencimientoDelDui(lista, '2026-03-12')).toBe(lista);
    });
});
