import { describe, it, expect } from 'vitest';
import { lotesPorRenglon } from '@nucleo/utils/trasladoTexto';

// El caso de la captura (2026-11-05): FOLIMEN, Bodega → Salud 3. Se pidió con
// dos genéricos, se apartó el 25009 y salió el 25009.
const folimen = {
    items: [{
        erp_product_id: 2061, cantidad: 1, descripcion: 'FOLIMEN 5 MG X 100 COMPRIMIDOS',
        lotes: [
            { lote: 'GENERICO', vence: '2028-10-01', unidades: 2 },
            { lote: 'GENERICO', vence: '2028-12-01', unidades: 2 },
        ],
    }],
    lotes_asignados: { 0: { lote: '25009', vence: '2028-10-01', paquetes: 1, id_lote_erp: '32912' } },
    erp_traslado: { detalle: [{ erp_product_id: 2061, cantidad: 1, numero_lote: '25009', id_lote_erp: '32912' }] },
};

describe('lotesPorRenglon', () => {
    it('despachado: el lote que salió, con el vencimiento del apartado', () => {
        expect(lotesPorRenglon(folimen).get(0)).toEqual([
            { lote: '25009', vence: '2028-10-01', unidades: 1, fuente: 'salio' },
        ]);
    });

    it('sin despacho: el lote apartado', () => {
        const { erp_traslado: _e, ...meta } = folimen;
        expect(lotesPorRenglon(meta).get(0)).toEqual([
            { lote: '25009', vence: '2028-10-01', unidades: 1, fuente: 'apartado' },
        ]);
    });

    it('sin despacho ni apartado: lo que se pidió', () => {
        const meta = { items: folimen.items };
        expect(lotesPorRenglon(meta).get(0).map(l => l.fuente)).toEqual(['pedido', 'pedido']);
    });

    it('salió sin número: no hereda el lote ni el vencimiento de otro', () => {
        const meta = { items: folimen.items, erp_traslado: { detalle: [{ erp_product_id: 2061, cantidad: 1 }] } };
        expect(lotesPorRenglon(meta).get(0)).toEqual([{ lote: null, vence: null, unidades: 1, fuente: 'salio' }]);
    });

    it('vencimiento de un apartado que NO coincide no se pega', () => {
        const meta = { ...folimen, erp_traslado: { detalle: [{ erp_product_id: 2061, cantidad: 1, numero_lote: '99', id_lote_erp: '1' }] } };
        expect(lotesPorRenglon(meta).get(0)[0]).toMatchObject({ lote: '99', vence: null });
    });

    it('sin datos de lote: el renglón no aparece', () => {
        expect(lotesPorRenglon({ items: [{ erp_product_id: 1, cantidad: 2 }] }).has(0)).toBe(false);
    });
});
