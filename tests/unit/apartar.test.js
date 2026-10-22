import { describe, expect, it } from 'vitest';
import { planDeApartar, telefonoDeFicha, tomaDeCadaTraslado, trasladosQueCubren } from '@nucleo/utils/apartar';
import { agruparPorPedido, conteoDeReservas, porCobrarDeSala, seccionesDeReservas } from '@nucleo/utils/reservasDeSala';

const cliente = { id: 1, name: 'ANA PEREZ', phone: '7777-7777' };
const producto = { id: 10, nombre: 'IBUPROFENO' };
const caja = { tipo: 'Caja', factor: 10, precio: 5 };
const base = { cliente, telOk: true, producto, elegida: caja, cantidad: '2' };

describe('planDeApartar — la regla de Apartar del portal y de la app', () => {
    it('hay en la sala: se aparta y se cobra el 50 % por defecto', () => {
        const p = planDeApartar({ ...base, opciones: { modo: 'reserva', disponibles: 5 } });
        expect(p.modo).toBe('reserva');
        expect(p.totalCobro).toBe(10);
        expect(p.montoAnticipo).toBe(5);
        expect(p.conAnticipo).toBe(true);
        expect(p.falta).toBeNull();
    });

    it('el teléfono se confirma antes de seguir', () => {
        const p = planDeApartar({ ...base, telOk: false, opciones: { modo: 'reserva' } });
        expect(p.falta).toBe('Confirma el teléfono del cliente.');
    });

    it('lo que ya viene en camino: toma sólo los traslados que hacen falta y encarga el resto', () => {
        const opciones = { modo: 'encargo', disponibles: 0, en_camino: [{ id: 'a', unidades: 10, origen: 'Salud 1' }, { id: 'b', unidades: 30, origen: 'Salud 2' }] };
        const p = planDeApartar({ ...base, cantidad: '1', opciones });
        expect(p.modo).toBe('viene');
        expect(p.elegidosIds).toEqual(['a']);
        expect(p.restoABodega).toBe(0);
        const q = planDeApartar({ ...base, cantidad: '5', opciones, vienenElegidos: ['a'] });
        expect(q.restoABodega).toBe(4);
        expect(q.enCamino).toEqual({ traslados_en_camino: ['a'], encargar_resto: true });
    });

    it('descartar lo que viene deja el encargo (o el pedido a otra sala)', () => {
        const opciones = { modo: 'encargo', en_camino: [{ id: 'a', unidades: 10, origen: 'Salud 1' }] };
        expect(planDeApartar({ ...base, opciones, vienenElegidos: [] }).modo).toBe('encargo');
        const t = planDeApartar({ ...base, opciones, vienenElegidos: [], traslado: { branch_id: 7, sala: 'Salud 3', lista: true } });
        expect(t.modo).toBe('traslado');
        expect(t.enCamino).toEqual({ traslado_desde: 7 });
    });

    it('un pedido cobra todo junto y no admite un producto que se encarga', () => {
        const apartados = [{ productoId: 99, productoNombre: 'X', factor: 1, cantidad: 1, precio: 4, enCamino: null, origen: null }];
        const p = planDeApartar({ ...base, apartados, opciones: { modo: 'reserva' }, cuanto: 'todo' });
        expect(p.totalCobro).toBe(14);
        expect(p.renglonesDelPedido).toHaveLength(2);
        const q = planDeApartar({ ...base, apartados, opciones: { modo: 'encargo' } });
        expect(q.falta).toMatch(/quítalo del pedido/);
    });

    it('un encargo va de 1 a 20 unidades', () => {
        const p = planDeApartar({ ...base, cantidad: '21', opciones: { modo: 'encargo' } });
        expect(p.falta).toBe('Un encargo va de 1 a 20 unidades.');
    });
});

describe('piezas de Apartar', () => {
    it('reparte lo que se toma de cada traslado', () => {
        const vienen = [{ id: 'a', unidades: 10 }, { id: 'b', unidades: 30 }];
        expect(trasladosQueCubren(vienen, 25)).toEqual(['a', 'b']);
        expect([...tomaDeCadaTraslado(vienen, ['a', 'b'], 10, 3)]).toEqual([['a', 1], ['b', 2]]);
    });
    it('el teléfono con guion, o nada', () => {
        expect(telefonoDeFicha('79416817')).toBe('7941-6817');
        expect(telefonoDeFicha('7941')).toBeNull();
    });
});

describe('la lista de la sala', () => {
    const filas = [
        { id: 1, estado: 'lista', pedido: 'P-ABC123', precio: 2, cantidad: 1 },
        { id: 2, estado: 'pendiente', pedido: 'P-ABC123', precio: 3, cantidad: 1 },
        { id: 3, estado: 'lista', precio: 1, cantidad: 1 },
        { id: 4, estado: 'vencida', saldo_favor: 5 },
    ];
    it('un pedido es una sola tarjeta, y va a «Por preparar» si una parte espera', () => {
        const g = agruparPorPedido(filas.slice(0, 3));
        expect(g).toHaveLength(2);
        const s = seccionesDeReservas(g);
        expect(s.map((x) => [x.clave, x.lista.length])).toEqual([['preparar', 1], ['listas', 1]]);
    });
    it('cuenta lo que hay que preparar, lo listo y los saldos', () => {
        // Cuenta TARJETAS: el pedido P- con una parte pendiente es una sola, por preparar.
        expect(conteoDeReservas(filas)).toEqual({ preparar: 1, listas: 1, saldos: 1 });
    });
    it('«Por cobrar»: encargos confirmados sin pagar y reservas de sala con saldo', () => {
        const r = porCobrarDeSala(
            [{ id: 5, estado: 'confirmado', pago_estado: 'pendiente', precio_unitario: 3, anticipo: 9, cantidad: 3 }],
            [{ id: 6, origen: 'sucursal', estado: 'lista', precio: 4, cantidad: 2, anticipo: 3 }],
        );
        expect(r.map((x) => [x.codigo, x.saldo])).toEqual([['E-000005', 9], ['R-000006', 5]]);
    });
});
