import { describe, expect, it } from 'vitest';
import { masSolicitados, reporteDeVentaPerdida } from '@nucleo/utils/ventasPerdidas';

describe('ventasPerdidas', () => {
    it('los más pedidos se ordenan por unidades y cuentan las veces', () => {
        const filas = [
            { descripcion: 'A', cantidad: 2 }, { producto_buscado: 'B', cantidad: 5 }, { descripcion: 'A', producto_buscado: 'a', cantidad: 4 },
        ];
        expect(masSolicitados(filas)).toEqual([{ nombre: 'A', veces: 2, total: 6 }, { nombre: 'B', veces: 1, total: 5 }]);
        expect(masSolicitados(filas, 1)).toHaveLength(1);
    });
    it('un reporte necesita qué se pidió y al menos una unidad', () => {
        expect(reporteDeVentaPerdida({ buscado: '  ', cantidad: 1 })).toBeNull();
        expect(reporteDeVentaPerdida({ buscado: 'X', cantidad: '0' })).toBeNull();
        expect(reporteDeVentaPerdida({ buscado: ' LORATADINA ', cantidad: '3', salaId: 2, empleadoId: 'e' })).toEqual({
            producto_buscado: 'LORATADINA', descripcion: null, principio_activo: null, laboratorio: null,
            cantidad: 3, branch_id: 2, reportado_por: 'e', status: 'pendiente',
        });
    });
});
