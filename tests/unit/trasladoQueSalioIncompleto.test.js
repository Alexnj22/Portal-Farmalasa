import { describe, it, expect } from 'vitest';
import { metaDelEnvio, loQueNoSalio, piezasDe, renglonesDe, lotesPedidos } from '@nucleo/utils/trasladoTexto';
import { cuantoTardo, rechazadasDe, ajustadasDe, esParcial } from '@nucleo/utils/movimientoTexto';

// La solicitud real del 28-oct-2026 (Salud 2 → Salud 1): se pidieron 5
// productos y 24 unidades, salieron 2 y 4. La bolsa por recibir decía «5
// PRODUCTOS · 24 unidades» con los lotes de los cinco.
const REAL = {
    items: [
        { lotes: [{ lote: 'CB30VVU', vence: '2028-03-01', unidades: 2 }, { lote: 'LXB30VVU', vence: '2028-03-01', unidades: 3 }],
          factor: 1, cantidad: 5, descripcion: 'MESIGYNA AMPOLLA', erp_product_id: 344, presentacion_tipo: 'CAJA' },
        { lotes: [{ lote: 'GENERICO', vence: null, unidades: 2 }],
          factor: 1, cantidad: 2, descripcion: 'FORMULA MENOPAUSIA X 90 CAPS VIJOSA', erp_product_id: 3710, presentacion_tipo: 'CAJA' },
        { lotes: [{ lote: '75397', vence: '2027-06-01', unidades: 1 }],
          factor: 1, cantidad: 1, descripcion: 'COLMIBE 10/10MG X 30 COMP.', erp_product_id: 223, presentacion_tipo: 'CAJA' },
        { lotes: [{ lote: '0047092', vence: '2029-04-01', unidades: 8 }, { lote: '0047154', vence: '2029-04-01', unidades: 5 }, { lote: '0046807', vence: '2029-07-01', unidades: 1 }],
          factor: 1, cantidad: 14, descripcion: 'SUDAGRIP BALSAMICO AMPOLLA', erp_product_id: 2548, presentacion_tipo: 'CAJA' },
        { lotes: [{ lote: 'GENERICO', vence: null, unidades: 2 }],
          factor: 1, cantidad: 2, descripcion: 'MENOPACE X 30 CAPSULAS', erp_product_id: 3740, presentacion_tipo: 'CAJA' },
    ],
    total_unidades: 24,
    erp_traslado: {
        id_traslado: '57661',
        unidades: 4,
        detalle: [
            { cantidad: 2, descripcion: 'FORMULA MENOPAUSIA X 90 CAPS VIJOSA', numero_lote: null, erp_product_id: 3710 },
            { cantidad: 2, descripcion: 'MENOPACE X 30 CAPSULAS', numero_lote: null, erp_product_id: 3740 },
        ],
        parcial: { motivo: 'Pidieron que solo se les enviaran esos productos' },
    },
};

describe('la bolsa en camino cuenta lo que SALIÓ', () => {
    it('el despacho incompleto real: 2 productos y 4 unidades, no 5 y 24', () => {
        const envio = metaDelEnvio(REAL);
        expect(piezasDe(envio)).toMatchObject({ numero: '2', unidades: 4, nombre: '2 productos' });
        expect(renglonesDe(envio).map(r => [r.nombre, r.cantidad])).toEqual([
            ['FORMULA MENOPAUSIA X 90 CAPS VIJOSA', 2],
            ['MENOPACE X 30 CAPSULAS', 2],
        ]);
        // El genérico viaja sin número: conserva el nombre del pedido.
        expect(lotesPedidos(envio).map(l => [l.lote, l.unidades])).toEqual([['GENERICO', 2], ['GENERICO', 2]]);
    });

    it('lo que no salió se nombra aparte, con cuánto se pidió', () => {
        expect(loQueNoSalio(REAL)).toEqual([
            { idx: 0, nombre: 'MESIGYNA AMPOLLA', presentacion: 'CAJA', pedida: 5, salio: 0 },
            { idx: 2, nombre: 'COLMIBE 10/10MG X 30 COMP.', presentacion: 'CAJA', pedida: 1, salio: 0 },
            { idx: 3, nombre: 'SUDAGRIP BALSAMICO AMPOLLA', presentacion: 'CAJA', pedida: 14, salio: 0 },
        ]);
    });

    it('un recorte de cantidad lleva los lotes que salieron, con su vencimiento', () => {
        const meta = {
            items: [REAL.items[3]],
            erp_traslado: { detalle: [{ cantidad: 3, numero_lote: '0047092', erp_product_id: 2548 }] },
        };
        const [r] = renglonesDe(metaDelEnvio(meta));
        expect(r.cantidad).toBe(3);
        expect(r.lotes).toEqual([{ lote: '0047092', vence: '2029-04-01', unidades: 3 }]);
        expect(loQueNoSalio(meta)).toEqual([
            { idx: 0, nombre: 'SUDAGRIP BALSAMICO AMPOLLA', presentacion: 'CAJA', pedida: 14, salio: 3 },
        ]);
    });

    it('sin despacho todavía, es lo pedido y no falta nada', () => {
        const pedido = { items: REAL.items, total_unidades: 24 };
        expect(metaDelEnvio(pedido)).toBe(pedido);
        expect(loQueNoSalio(pedido)).toEqual([]);
    });

    it('el mismo producto en dos renglones no se reparte: se queda como se pidió', () => {
        const meta = {
            items: [
                { cantidad: 2, descripcion: 'X JARABE', erp_product_id: 9, presentacion_tipo: 'FRASCO' },
                { cantidad: 1, descripcion: 'X CAJA', erp_product_id: 9, presentacion_tipo: 'CAJA' },
            ],
            erp_traslado: { detalle: [{ cantidad: 1, erp_product_id: 9 }] },
        };
        expect(renglonesDe(metaDelEnvio(meta)).map(r => r.cantidad)).toEqual([2, 1]);
        expect(loQueNoSalio(meta)).toEqual([]);
    });
});

describe('cuantoTardo no se lee como una hora futura', () => {
    it('dice «tardó», no «en»', () => {
        expect(cuantoTardo('2026-10-28T21:55:43Z', '2026-10-29T15:15:43Z')).toBe('tardó 17 h');
        expect(cuantoTardo('2026-10-28T21:55:00Z', '2026-10-28T22:05:00Z')).toBe('tardó 10 min');
        expect(cuantoTardo('2026-10-28T21:55:00Z', '2026-10-28T21:55:20Z')).toBe('al momento');
    });
});

describe('la solicitud marca qué renglones no salieron', () => {
    it('los que no salieron llevan el motivo; la solicitud queda parcial', () => {
        expect([...rechazadasDe(REAL)]).toEqual([
            [0, 'Pidieron que solo se les enviaran esos productos'],
            [2, 'Pidieron que solo se les enviaran esos productos'],
            [3, 'Pidieron que solo se les enviaran esos productos'],
        ]);
        expect(ajustadasDe(REAL).size).toBe(0);
        expect(esParcial({ status: 'APPROVED', metadata: REAL })).toBe(true);
    });

    it('un recorte de cantidad es un ajuste, no un rechazo', () => {
        const meta = {
            items: [REAL.items[3]],
            erp_traslado: { detalle: [{ cantidad: 3, numero_lote: '0047092', erp_product_id: 2548 }] },
        };
        expect(rechazadasDe(meta).size).toBe(0);
        expect([...ajustadasDe(meta)]).toEqual([[0, 3]]);
    });

    it('lo que escribió quien decidió una carga manda sobre el despacho', () => {
        const meta = { ...REAL, lineas_rechazadas: [{ i: 1, motivo: 'vencido' }] };
        expect([...rechazadasDe(meta)]).toEqual([[1, 'vencido']]);
    });
});
