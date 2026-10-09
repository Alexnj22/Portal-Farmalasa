import { describe, expect, it, vi } from 'vitest';

vi.mock('@nucleo/supabaseClient', () => ({ supabase: {} }));

import { cicloDeReenvioPendiente, razonesDePausaDisponibles, reenvioTodaviaEnBodega, renglonesPorSala, renglonParaConfirmar, textoDePausa } from '@nucleo/data/accionesDePedido';
import { buildPedidoCodigo, fefoProject } from '@nucleo/utils/codigoDePedido';
import { nivelDeUrgenciaDeSala, urgenciaDeSala } from '@nucleo/utils/tableroDePedidos';

describe('accionesDePedido', () => {
    it('el texto de una pausa, con y sin comentario', () => {
        expect(textoDePausa('almuerzo')).toBe('Almuerzo');
        expect(textoDePausa('otro', '  llegó el camión ')).toBe('Otro… — llegó el camión');
    });

    it('el almuerzo se usa una vez por pedido', () => {
        expect(razonesDePausaDisponibles([]).some((r) => r.key === 'almuerzo')).toBe(true);
        expect(razonesDePausaDisponibles([{ razon: 'Almuerzo' }]).some((r) => r.key === 'almuerzo')).toBe(false);
    });

    it('el ciclo de reenvío pendiente es el primero que SALIÓ y no llegó', () => {
        const h = [{ ciclo: 1, cajas: [2], sent_at: 'a', arrived_at: 'x' }, { ciclo: 2, cajas: [4, 5], electrolits: 1, sent_at: 'b' }];
        expect(cicloDeReenvioPendiente(h)).toMatchObject({ ciclo: 2, cajas: [4, 5], electrolits: 1, especiales: [] });
        expect(cicloDeReenvioPendiente([], [7])).toMatchObject({ ciclo: 1, cajas: [7] });
        expect(cicloDeReenvioPendiente([], [])).toBeNull();
    });

    it('un reenvío que todavía no sale de Bodega no se puede confirmar', () => {
        const h = [{ ciclo: 1, cajas: [2], sent_at: 'a', arrived_at: 'x' }, { ciclo: 2, cajas: [4], sent_at: null }];
        expect(reenvioTodaviaEnBodega(h)).toBe(true);
        expect(cicloDeReenvioPendiente(h, [9])).toBeNull();
        // Todo llegado: ya no se devuelve el último ciclo como si faltara.
        expect(cicloDeReenvioPendiente([{ ciclo: 1, cajas: [2], sent_at: 'a', arrived_at: 'x' }])).toBeNull();
        expect(reenvioTodaviaEnBodega([{ ciclo: 1, sent_at: 'a', arrived_at: 'x' }])).toBe(false);
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

    it('la urgencia de Generar se mide en productos bajo mínimo (y cae al % viejo sin los campos)', () => {
        expect(urgenciaDeSala({ bajo_min_productos: 50 })).toBe(100);
        expect(urgenciaDeSala({ bajo_min_productos: 5, en_cero_productos: 25 })).toBe(100);
        expect(urgenciaDeSala({ bajo_min_productos: 25 })).toBe(50);
        expect(nivelDeUrgenciaDeSala({ bajo_min_productos: 50 })).toBe('high');
        expect(nivelDeUrgenciaDeSala({ bajo_min_productos: 25 })).toBe('mid');
        expect(nivelDeUrgenciaDeSala({ bajo_min_productos: 10, avg_urgencia_pct: 90 })).toBe('low');
        expect(urgenciaDeSala({ avg_urgencia_pct: 70 })).toBe(70);
        expect(nivelDeUrgenciaDeSala({ avg_urgencia_pct: 70 })).toBe('high');
        expect(nivelDeUrgenciaDeSala(undefined)).toBe('none');
    });
});
