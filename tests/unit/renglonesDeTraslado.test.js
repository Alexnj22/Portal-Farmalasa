import { describe, it, expect } from 'vitest';
import { renglonesDeTraslado } from '../../supabase/functions/_shared/erp-traslado.ts';
import real from './fixtures/ver-traslado-2026-08-20.json';

// La lectura de `ver_traslado.php` con la que `leer-traslados-erp` sabe cuándo
// entró cada producto a cada sala. Corre sobre las páginas REALES capturadas el
// 2026-08-20 (ver `trasladoLlevaProducto.test.js` para qué es cada una).

describe('renglonesDeTraslado', () => {
    it('lee descripción, presentación, unidad y cantidad', () => {
        const { renglones } = renglonesDeTraslado(real.paginas['29444']);
        expect(renglones).toEqual([
            { descripcion: 'VASOTRATE 75 MG X 20 TABLETAS', presentacion: 'CAJA', unidad: '1', cantidad: '2' },
        ]);
    });

    it('conserva dos renglones idénticos: son dos renglones', () => {
        const { renglones } = renglonesDeTraslado(real.paginas['29932']);
        expect(renglones).toHaveLength(2);
        expect(renglones[0].descripcion).toBe('DOLO APRANAX X 100 TAB');
        expect(renglones[0].presentacion).toBe('BLISTER X 10');
        expect(renglones[0].unidad).toBe('10');
    });

    it('trae el destino normalizado, que es lo que distingue la sala', () => {
        expect(renglonesDeTraslado(real.paginas['29444']).destino)
            .toBe('SUCURSAL 1 CALLE MORAZÁN NO. 39 BARRIO EL CALVARIO, CHALATENANGO, CHALATENANGO.');
        expect(renglonesDeTraslado(real.paginas['29445']).destino)
            .toMatch(/^SUCURSAL 1 FARMACIA LA POPULAR/);
    });

    it('un número que no existe no tiene renglones ni destino', () => {
        // Así contesta el sistema a un id inexistente: la misma página, la tabla vacía.
        const vacia = '<table id="tableview"><thead><tr><th>Descripción</th></tr></thead><tbody></tbody></table>';
        expect(renglonesDeTraslado(vacia)).toEqual({ renglones: [], destino: null });
        expect(renglonesDeTraslado('')).toEqual({ renglones: [], destino: null });
    });
});
