// Anular sólo la parte de UNA sala de un pedido (2026-11-06). El juez es
// `anular_pedido_sucursal` en la base; esto fija cuándo se OFRECE el botón.
import { describe, it, expect } from 'vitest';
import { etapasPorPedido, puedeAnularLaSala } from '@nucleo/utils/tableroDePedidos';

const P = 'ped-243';
const s1 = { pedido_id: P, erp_sucursal_id: 1, pedido_status: 'confirmado', iniciado_at: '2026-11-06T19:44:57Z', finalizado_at: '2026-11-06T21:19:08Z' };
const s2 = { pedido_id: P, erp_sucursal_id: 2, pedido_status: 'confirmado' };

describe('puedeAnularLaSala', () => {
    it('cuenta las salas del pedido', () => {
        expect(etapasPorPedido([s1, s2]).get(P).salas).toBe(2);
    });

    it('la sala sin iniciar se puede anular aunque otra ya esté finalizada (pedido 243)', () => {
        const et = etapasPorPedido([s1, s2]);
        expect(puedeAnularLaSala(s2, et)).toBe(true);
    });

    it('la sala que Bodega ya empezó no', () => {
        const et = etapasPorPedido([s1, s2]);
        expect(puedeAnularLaSala(s1, et)).toBe(false);
        const enCurso = { ...s2, iniciado_at: '2026-11-06T20:00:00Z' };
        expect(puedeAnularLaSala(enCurso, etapasPorPedido([s1, enCurso]))).toBe(false);
    });

    it('con una sola sala no: eso es anular el pedido', () => {
        expect(puedeAnularLaSala(s2, etapasPorPedido([s2]))).toBe(false);
    });

    it('un pedido anulado o completado no', () => {
        for (const st of ['anulado', 'completado']) {
            const r = { ...s2, pedido_status: st };
            expect(puedeAnularLaSala(r, etapasPorPedido([s1, r]))).toBe(false);
        }
    });

    it('vale también si otra sala ya salió (pedido «enviado»)', () => {
        const r = { ...s2, pedido_status: 'enviado' };
        expect(puedeAnularLaSala(r, etapasPorPedido([s1, r]))).toBe(true);
    });
});
