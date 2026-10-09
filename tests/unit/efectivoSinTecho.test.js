import { describe, expect, it, vi, beforeEach } from 'vitest';

// Las consultas de efectivo que devuelven FILAS se parten para no caer bajo el
// techo de 1000 de PostgREST: por tramos de fechas (cortes) o por tandas de ids
// (saldos de bolsas). Se comprueba que cada llamada pida un pedazo acotado y que
// el resultado junte TODOS los pedazos.
const llamadas = [];
vi.mock('@nucleo/supabaseClient', () => ({
    supabase: {
        rpc: vi.fn(async (fn, args) => {
            llamadas.push([fn, args]);
            if (fn === 'get_bolsas_saldos') return { data: args.p_ids.map((id) => ({ bolsa_id: id, saldo: 1 })), error: null };
            return { data: [{ fecha: args.p_desde }], error: null };
        }),
    },
}));

import { fetchPiezasDelCajon, fetchVentasPorPago } from '@nucleo/data/cortes';
import { fetchSaldos } from '@nucleo/data/bolsas';
import { totalesDeDepositos } from '@nucleo/utils/depositoDeEfectivo';

beforeEach(() => { llamadas.length = 0; });

describe('efectivo sin techo de 1000 filas', () => {
    it('un día es una sola llamada', async () => {
        await fetchVentasPorPago({ desde: '2026-10-09', hasta: '2026-10-09' });
        expect(llamadas).toEqual([['get_ventas_por_forma_de_pago', { p_desde: '2026-10-09', p_hasta: '2026-10-09' }]]);
    });

    it('un período largo va en tramos de 14 días que cubren todo el rango sin huecos', async () => {
        const filas = await fetchVentasPorPago({ desde: '2026-08-01', hasta: '2026-09-30' });
        const tramos = llamadas.map(([, a]) => [a.p_desde, a.p_hasta]);
        expect(tramos[0]).toEqual(['2026-08-01', '2026-08-14']);
        expect(tramos.at(-1)[1]).toBe('2026-09-30');
        for (let i = 1; i < tramos.length; i++) expect(tramos[i][0] > tramos[i - 1][1]).toBe(true);
        expect(filas).toHaveLength(tramos.length);
    });

    it('las piezas del cajón llevan la sala en cada tramo', async () => {
        await fetchPiezasDelCajon({ desde: '2026-09-01', hasta: '2026-09-30', branchId: '3' });
        expect(llamadas.every(([, a]) => a.p_branch === 3)).toBe(true);
        expect(llamadas.length).toBe(3);
    });

    it('los saldos de bolsas se piden de a 500 ids y se juntan', async () => {
        const ids = Array.from({ length: 1201 }, (_, i) => i + 1);
        const saldos = await fetchSaldos(ids);
        expect(llamadas.map(([, a]) => a.p_ids.length)).toEqual([500, 500, 201]);
        expect(saldos.size).toBe(1201);
    });

    it('los totales de depósitos no cuentan corregidos ni ANTERIOR, y señalan los sin boleta', () => {
        const t = totalesDeDepositos([
            { monto_deposito: 100, monto_efectivo: 20, comprobante_url: 'x' },
            { monto_deposito: 50, monto_efectivo: 0 },
            { monto_deposito: 999, anulado_at: '2026-10-01' },
            { monto_deposito: 777, destino: 'ANTERIOR' },
        ]);
        expect(t).toEqual({ banco: 150, efectivo: 20, sinBoleta: 1, sinBoletaMonto: 50 });
    });
});

describe('totales de conteos', () => {
    it('cuenta lo contado y sólo las descuadradas sin resolver', async () => {
        const { totalesDeConteos } = await import('@nucleo/utils/depositoDeEfectivo');
        expect(totalesDeConteos([
            { total_contado: 100, descuadradas: 3, resueltas: 1, justificado: 5 },
            { total_contado: 50, descuadradas: 1, resueltas: 2 },
        ])).toEqual({ contado: 150, abiertas: 2, justificado: 5 });
    });
});
