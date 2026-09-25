// La ruta se vuelve a MEDIR cuando se reordena, no sólo a numerar.
//
// Hasta el 2026-09-25 `CrearRutaModal` subía, bajaba y quitaba paradas
// renumerándolas y nada más: cada una conservaba la distancia desde la parada
// que tenía ANTES del cambio, así que los totales de kilómetros y minutos
// —que se guardan con la ruta— quedaban mal. `armarRuta` es ahora el único
// camino para poner paradas en un orden, y mide cada tramo desde la anterior.
import { describe, it, expect } from 'vitest';
import { armarRuta, tramoEnLineaRecta, medidorDeMatriz, totalRoute } from '../../src/utils/routeOptimizer';

const bodega = { lat: 14.0412, lng: -88.9631 };
const A = { erp_sucursal_id: 1, suc_name: 'A', lat: 14.10, lng: -88.90, _uid: 'a' };
const B = { erp_sucursal_id: 2, suc_name: 'B', lat: 14.30, lng: -89.10, _uid: 'b' };
const C = { erp_sucursal_id: 3, suc_name: 'C', lat: 13.90, lng: -88.80, _uid: 'c' };

describe('armarRuta', () => {
    it('mide cada parada desde la anterior, la primera desde la bodega', () => {
        const r = armarRuta([A, B, C], bodega);
        expect(r.map(p => p.orden)).toEqual([1, 2, 3]);
        expect(r[0].dist_m).toBe(tramoEnLineaRecta(bodega, A).dist_m);
        expect(r[1].dist_m).toBe(tramoEnLineaRecta(A, B).dist_m);
        expect(r[2].dist_m).toBe(tramoEnLineaRecta(B, C).dist_m);
    });

    it('reordenar cambia los tramos (el defecto era que no)', () => {
        const antes = armarRuta([A, B, C], bodega);
        const despues = armarRuta([C, A, B], bodega);
        expect(despues[0]._uid).toBe('c');
        expect(despues[0].dist_m).toBe(tramoEnLineaRecta(bodega, C).dist_m);
        expect(despues[1].dist_m).toBe(tramoEnLineaRecta(C, A).dist_m);
        // Los totales siguen al orden nuevo, no se quedan con los del viejo.
        expect(totalRoute(despues).dist_m).not.toBe(totalRoute(antes).dist_m);
        const esperado = [tramoEnLineaRecta(bodega, C), tramoEnLineaRecta(C, A), tramoEnLineaRecta(A, B)]
            .reduce((s, t) => s + t.dist_m, 0);
        expect(totalRoute(despues).dist_m).toBe(esperado);
    });

    it('quitar una parada mide a la siguiente desde la que quedó antes', () => {
        const r = armarRuta([A, C], bodega);   // se quitó B
        expect(r[1].dist_m).toBe(tramoEnLineaRecta(A, C).dist_m);
    });

    it('una parada sin coordenadas queda sin medir y la siguiente se mide desde el último punto conocido', () => {
        const sinCoords = { erp_sucursal_id: 9, suc_name: 'X', _uid: 'x' };
        const r = armarRuta([A, sinCoords, B], bodega);
        expect(r[1].dist_m).toBeNull();
        expect(r[1].dur_min).toBeNull();
        expect(r[2].dist_m).toBe(tramoEnLineaRecta(A, B).dist_m);
    });

    it('conserva el resto de la parada (su identidad, sus productos)', () => {
        const r = armarRuta([{ ...A, items: [1, 2], isEncargo: true }], bodega);
        expect(r[0]).toMatchObject({ _uid: 'a', items: [1, 2], isEncargo: true });
    });
});

describe('medidorDeMatriz', () => {
    const puntos = [bodega, A, B];
    const matriz = {
        dist: [[0, 5000, null], [5000, 0, 9000], [null, 9000, 0]],
        dur:  [[0, 600, null],  [600, 0, 1200],  [null, 1200, 0]],
    };
    const medir = medidorDeMatriz(puntos, matriz);

    it('usa la carretera cuando la tabla tiene el par', () => {
        expect(medir(A, B)).toEqual({ dist_m: 9000, dur_min: 20 });
    });

    it('cae a la línea recta si Google no resolvió el par', () => {
        expect(medir(bodega, B)).toEqual(tramoEnLineaRecta(bodega, B));
    });

    it('cae a la línea recta para una parada que no estaba en la tabla (agregada a mano)', () => {
        expect(medir(A, C)).toEqual(tramoEnLineaRecta(A, C));
    });

    it('reordenar a mano sigue usando la carretera para los pares conocidos', () => {
        const r = armarRuta([A, B], bodega, medir);
        expect(r[0].dist_m).toBe(5000);
        expect(r[1].dist_m).toBe(9000);
    });
});
