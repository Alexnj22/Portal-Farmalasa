import { describe, expect, it } from 'vitest';
import {
    armarVenta, clienteDeLaVenta, codigoDeVendedor, notaDeLaVenta, puedeEnviarPreventa, textoDePreventa,
} from '@nucleo/utils/preventa';

const base = {
    codigo: 'R-000013', documento: 'consumidor_final', pagado: 0, falta_pagar: 31.8,
    cliente: { erp_id: '6317', name: 'JUAN PEREZ' }, vendedor: { code: '303', role_id: 30 },
    renglones: [{ reserva_id: 13, producto_id: 5021, nombre: 'UROLITINA', cantidad: 1, factor: 1, precio_unitario: 31.8, precio_normal: 31.8 }],
};

describe('preventa — el vendedor', () => {
    it('firma con su código', () => expect(codigoDeVendedor({ code: '303', role_id: 30 })).toBe('303'));
    it('los cuatro cargos de administración firman con 1000', () => {
        for (const role_id of [2, 3, 11, 13]) expect(codigoDeVendedor({ code: '71020', role_id })).toBe('1000');
    });
    it('sin código numérico no hay vendedor', () => expect(codigoDeVendedor({ code: '', role_id: 30 })).toBeNull());
});

describe('preventa — el cliente', () => {
    it('va el real con nombre ASCII', () => expect(clienteDeLaVenta({ erp_id: '6317', name: 'JUAN PEREZ' })).toEqual({ id: '6317', generico: false, motivo: null }));
    it('una Ñ o una tilde lo manda como cliente frecuente', () => {
        expect(clienteDeLaVenta({ erp_id: '6317', name: 'EDWIN NUÑEZ' })).toMatchObject({ id: '-2', generico: true, motivo: 'nombre_con_tilde' });
        expect(clienteDeLaVenta({ erp_id: '6317', name: 'JOSÉ PÉREZ' }).generico).toBe(true);
    });
    it('sin ficha en la caja, cliente frecuente', () => expect(clienteDeLaVenta({ erp_id: null, name: 'ANA' }).motivo).toBe('sin_ficha_en_caja'));
});

describe('preventa — la venta', () => {
    it('arma renglones, total y nota', () => {
        const v = armarVenta(base);
        expect(v.vendedor).toBe('303');
        expect(v.total).toBe(31.8);
        expect(v.renglones[0]).toMatchObject({ producto_id: 5021, cantidad: 1, precio: 31.8, subtotal: 31.8 });
        expect(v.nota).toBe('RESERVA R-000013');
    });
    it('con cliente genérico, la nota lleva el nombre en ASCII', () => {
        const v = armarVenta({ ...base, cliente: { erp_id: '6317', name: 'EDWIN ALEXANDER NUÑEZ JOYA' } });
        expect(v.nota).toBe('RESERVA R-000013 - EDWIN NUNEZ');
        expect(/^[\x20-\x7e]*$/.test(v.nota)).toBe(true);
    });
    it('lo pagado viaja en la nota para no cobrarlo dos veces', () => {
        expect(notaDeLaVenta({ codigo: 'R-1', cliente: { generico: false }, pagado: 15.9, faltaPagar: 15.9 }))
            .toBe('RESERVA R-1 - PAGADO $15.90 FALTA $15.90');
    });
    it('rechaza un renglón sin producto o sin precio', () => {
        expect(() => armarVenta({ ...base, renglones: [{ ...base.renglones[0], producto_id: -1 }] })).toThrow();
        expect(() => armarVenta({ ...base, renglones: [{ ...base.renglones[0], precio_unitario: 0 }] })).toThrow();
    });
});

describe('preventa — la pantalla', () => {
    it('se envía desde pendiente o lista, una sola vez', () => {
        expect(puedeEnviarPreventa({ estado: 'lista' })).toBe(true);
        expect(puedeEnviarPreventa({ estado: 'lista', preventa_estado: 'viva' })).toBe(false);
        expect(puedeEnviarPreventa({ estado: 'lista', preventa_estado: 'fallida' })).toBe(true);
        expect(puedeEnviarPreventa({ estado: 'en_revision' })).toBe(false);
        expect(puedeEnviarPreventa({ estado: 'pendiente', origen: 'app', bajo_receta: true, receta_estado: 'pendiente' })).toBe(false);
    });
    it('dice en qué quedó', () => {
        expect(textoDePreventa({ preventa_estado: 'viva', preventa_ref: '32' })).toBe('Preventa #32 en caja');
        expect(textoDePreventa({ preventa_estado: 'fallida' })).toBe('');
    });
});
