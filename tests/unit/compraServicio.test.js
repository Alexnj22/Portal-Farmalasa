// El flete dentro de una compra de mercadería (2026-11-05): entra como
// SERVICIO en la misma compra, sin producto ni inventario.
import { describe, it, expect } from 'vitest';
import { lineaDelSobre, esFleteOServicio } from '../../supabase/functions/_shared/compraSobre.ts';

describe('flete / servicio', () => {
    it('reconoce los fletes de la cola', () => {
        for (const d of ['FLETE', 'Flete', 'PAGO DE 50% DE FLETE AEROFLASH', 'NA|SERVICIO DE TRANSPORTE', 'FLETE L-S/L V. 01-12-2033 1'])
            expect(esFleteOServicio(d)).toBe(true);
        for (const d of ['GINKGO BILOBA', 'TRANSPORE GEL', 'CAJA MELOFLEX RELAX 15 MG X 10 COMP'])
            expect(esFleteOServicio(d)).toBe(false);
    });
    it('INCOFA: el flete de $0.88 va como SERVICIO, sin lote ni vencimiento', () => {
        const { linea, problemas } = lineaDelSobre(3, { descripcion: 'FLETE', cantidad: 1, precio: 0.884956, descuento: 0, exento: false, subtotal: 0.88 }, { tipo: 'servicio' });
        expect(problemas).toEqual([]);
        expect(linea).toMatchObject({ id_producto: 'SERV', bandera: 'SERVICIO', cant: '1', unidad: '1', id_presentacion: '1', vence: 'NULL', numero_lote: '', compra: '0.8800', descripcion_ser: 'FLETE' });
    });
});
