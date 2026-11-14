import { describe, it, expect } from 'vitest';
import { frenoPorReglasPendientes } from '@nucleo/utils/reglasDeDespacho';
import { esTextoTecnico } from '@nucleo/utils/errorMessages';

const rows = [
    { erp_product_id: 3952, product_name: 'GUANTE TALLA S NIPRO/SENSI CJA X 50 PARES', erp_sucursal_id: 4 },
    { erp_product_id: 3952, product_name: 'GUANTE TALLA S NIPRO/SENSI CJA X 50 PARES', erp_sucursal_id: 2 },
    { erp_product_id: 10, product_name: 'OTRO' },
];

describe('frenoPorReglasPendientes', () => {
    it('sin pendientes no frena', () => {
        expect(frenoPorReglasPendientes(rows, [])).toBeNull();
    });
    it('una pendiente de un producto que no está en el pedido no frena', () => {
        expect(frenoPorReglasPendientes(rows, [{ erp_product_id: 99 }])).toBeNull();
    });
    it('frena, nombra el producto una vez y se puede mostrar tal cual', () => {
        const e = frenoPorReglasPendientes(rows, [{ erp_product_id: 3952 }]);
        expect(e.userFacing).toBe(true);
        expect(e.reglasPendientes).toEqual([3952]);
        expect(e.message).toMatch(/un producto tiene la regla de despacho pendiente \(GUANTE TALLA S/);
        expect(e.message.match(/GUANTE/g)).toHaveLength(1);
        expect(esTextoTecnico(e.message)).toBe(false);
    });
    it('con muchos, muestra dos y cuenta el resto sin pasar el largo presentable', () => {
        const muchos = Array.from({ length: 6 }, (_, i) => ({ erp_product_id: i + 1, product_name: `PRODUCTO DE NOMBRE MUY LARGO NUMERO ${i + 1} X 100 TABLETAS` }));
        const e = frenoPorReglasPendientes(muchos, muchos.map(r => ({ erp_product_id: r.erp_product_id })));
        expect(e.message).toMatch(/6 productos tienen/);
        expect(e.message).toMatch(/y 4 más/);
        expect(esTextoTecnico(e.message)).toBe(false);
    });
});
