import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { loteCortoDeRenglon, detalleDeSolicitud } from '@nucleo/utils/tarjetaDeSolicitud';
import { datosDeRespuesta } from '@nucleo/utils/avisosDeOperacion';
import LotesConFuente from '../../src/components/common/LotesConFuente';

// FOLIMEN, Bodega → Salud 3 (2026-11-05): la captura que abrió esto.
const meta = {
    branch_name: 'Salud 3', origen_branch_name: 'Bodega',
    items: [{ erp_product_id: 2061, cantidad: 1, descripcion: 'FOLIMEN', presentacion_tipo: 'CAJA',
        lotes: [{ lote: 'GENERICO', vence: '2028-10-01', unidades: 4 }] }],
    lotes_asignados: { 0: { lote: '25009', vence: '2028-10-01', id_lote_erp: '32912' } },
    erp_traslado: { detalle: [{ erp_product_id: 2061, cantidad: 1, numero_lote: '25009', id_lote_erp: '32912' }] },
};

describe('el aviso del traslado lleva el lote', () => {
    it('push y app: el lote que salió, con su vencimiento', () => {
        expect(loteCortoDeRenglon(meta, 0)).toBe('Lote 25009 · 10/2028');
        const d = detalleDeSolicitud({ type: 'INVENTORY_TRANSFER_REQUEST', metadata: meta });
        expect(d.renglones[0][0]).toBe('FOLIMEN (Lote 25009 · 10/2028)');
    });

    it('push: un genérico no agrega nada', () => {
        expect(loteCortoDeRenglon({ items: meta.items }, 0)).toBe('');
    });

    it('campana: la respuesta trae los lotes y se dibujan', () => {
        const datos = datosDeRespuesta({ type: 'REQUEST_RESOLVED', metadata: { respuesta: {
            tipo: 'traslado', estado: 'ENVIA',
            productos: [{ nombre: 'FOLIMEN', pedida: 1, enviada: 1,
                lotes: [{ lote: '25009', vence: '2028-10-01', fuente: 'salio', unidades: 1 }] }],
        } } });
        expect(datos.productos[0].lotes[0]).toMatchObject({ lote: '25009', fuente: 'salio' });
        const { container } = render(<LotesConFuente lotes={datos.productos[0].lotes} />);
        expect(container.textContent).toContain('Salió lote');
        expect(container.textContent).toContain('10/2028');
    });

    it('campana: un aviso viejo sin lotes no dibuja nada', () => {
        const datos = datosDeRespuesta({ type: 'REQUEST_RESOLVED', metadata: { respuesta: {
            tipo: 'traslado', estado: 'ENVIA', productos: [{ nombre: 'X', pedida: 1, enviada: 1 }] } } });
        expect(datos.productos[0].lotes).toEqual([]);
    });
});
