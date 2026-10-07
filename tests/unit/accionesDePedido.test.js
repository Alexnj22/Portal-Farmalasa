import { describe, expect, it, vi } from 'vitest';

vi.mock('@nucleo/supabaseClient', () => ({ supabase: {} }));

import { cicloDeReenvioPendiente, razonesDePausaDisponibles, renglonesPorSala, renglonParaConfirmar, textoDePausa } from '@nucleo/data/accionesDePedido';
import { buildPedidoCodigo, fefoProject } from '@nucleo/utils/codigoDePedido';

describe('accionesDePedido', () => {
    it('el texto de una pausa, con y sin comentario', () => {
        expect(textoDePausa('almuerzo')).toBe('Almuerzo');
        expect(textoDePausa('otro', '  llegó el camión ')).toBe('Otro… — llegó el camión');
    });

    it('el almuerzo se usa una vez por pedido', () => {
        expect(razonesDePausaDisponibles([]).some((r) => r.key === 'almuerzo')).toBe(true);
        expect(razonesDePausaDisponibles([{ razon: 'Almuerzo' }]).some((r) => r.key === 'almuerzo')).toBe(false);
    });

    it('el ciclo de reenvío pendiente es el primero sin llegada', () => {
        const h = [{ ciclo: 1, cajas: [2], arrived_at: 'x' }, { ciclo: 2, cajas: [4, 5], electrolits: 1 }];
        expect(cicloDeReenvioPendiente(h)).toMatchObject({ ciclo: 2, cajas: [4, 5], electrolits: 1, especiales: [] });
        expect(cicloDeReenvioPendiente([], [7])).toMatchObject({ ciclo: 1, cajas: [7] });
        expect(cicloDeReenvioPendiente([], [])).toBeNull();
    });

    it('reparte los renglones por sala y sección', () => {
        const m = renglonesPorSala([
            { erp_sucursal_id: 1 }, { erp_sucursal_id: 1, sin_stock: true }, { erp_sucursal_id: 2, revision_minmax: true }, { erp_sucursal_id: 2, agotamiento: true },
        ]);
        expect(m[1].normal).toHaveLength(1);
        expect(m[1].sinStock).toHaveLength(1);
        expect(m[2].revision).toHaveLength(1);
        expect(m[2].agotamiento).toHaveLength(1);
    });

    it('un renglón para confirmar toma los lotes por FEFO y el múltiplo por defecto', () => {
        const r = renglonParaConfirmar({ erp_sucursal_id: 1, cantidad_asignada: 3, stock_packs: '9', lotes_bodega: [{ packs: 2 }, { packs: 5 }] });
        expect(r.lotes_asignados).toEqual([{ packs: 2, take: 2 }, { packs: 5, take: 1 }]);
        expect(r.dispatch_multiplo).toBe(1);
        expect(r.stock_packs_snapshot).toBe(9);
    });

    it('fefo y el código de cada sala', () => {
        expect(fefoProject([], 3)).toEqual([]);
        const codigo = buildPedidoCodigo({ 5: 3 }, new Date(2026, 9, 7), 1);
        expect(codigo(5)).toMatch(/^03-071026-1-/);
    });
});
