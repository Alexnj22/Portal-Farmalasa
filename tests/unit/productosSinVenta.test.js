import { describe, it, expect } from 'vitest';
import { datosDeProductosSinVenta } from '../../src/utils/avisosDeOperacion';
import { porQueDesde } from '../../src/utils/productosParados';

// El aviso semanal de productos sin venta (`avisar_productos_sin_venta`) y el
// porqué de la fecha, que comparten la tarjeta y la pestaña «Stock retenido».

const aviso = (parados) => ({ type: 'PRODUCTOS_SIN_VENTA', metadata: { parados } });

describe('datosDeProductosSinVenta', () => {
    it('lee los destinos y los ejemplos tal como los arma la base', () => {
        const d = datosDeProductosSinVenta(aviso({
            sala: 'La Popular', erp: 5, productos: 21, costo: 359.79, en_la_lista: 21, muestra: true,
            destinos: [{ erp: 3, sala: 'Salud 3', productos: 5, costo: 120.5 }, { erp: 6, sala: 'Bodega', productos: 9, costo: 90 }],
            ejemplos: [{ producto: 'SIMILAC 2', existencia: 2, costo: 59.35, destino: 'Salud 3',
                         desde: '2026-03-01', dias: 207, ultima_venta: '2026-03-01' }],
        }));
        expect(d.productos).toBe(21);
        expect(d.destinos.map(x => x.sala)).toEqual(['Salud 3', 'Bodega']);
        expect(d.ejemplos[0].producto).toBe('SIMILAC 2');
        expect(d.muestra).toBe(true);
    });

    it('otro tipo, o un aviso sin destinos, no dibuja tarjeta', () => {
        expect(datosDeProductosSinVenta({ type: 'SYSTEM', metadata: {} })).toBeNull();
        expect(datosDeProductosSinVenta(aviso({ sala: 'Salud 1' }))).toBeNull();
    });
});

describe('porQueDesde', () => {
    it('nombra la fecha que manda', () => {
        expect(porQueDesde({ desde: '2026-03-10', ultima_venta: '2026-03-10' })).toBe('última venta');
        expect(porQueDesde({ desde: '2026-04-02', ultima_venta: '2026-01-01', ultima_entrada: '2026-04-02', entrada_via: 'traslado' }))
            .toBe('llegó por traslado');
        expect(porQueDesde({ desde: '2026-02-01', ultima_venta: '2025-11-01', reingreso: '2026-02-01' }))
            .toBe('reingreso a la empresa');
        expect(porQueDesde({ desde: null })).toBe('sin venta ni entrada registrada');
    });
});
