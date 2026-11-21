import { describe, expect, it } from 'vitest';
import { opcionesCerrarConVenta } from '@nucleo/utils/reservasDeSala';

describe('opcionesCerrarConVenta', () => {
    it('anticipo que cubría todo el precio (R-000164): no dice «lo que faltaba»', () => {
        const o = opcionesCerrarConVenta({ anticipo: 6.6, precio: 6.6, cantidad: 1, vendida_aparte: { total: 6.6 } });
        expect(o.cubria).toBe(true);
        expect(o.pregunta).toContain('ya había pagado todo el precio');
        expect(o.opciones.map((x) => x.k)).toEqual([true, false]);
        expect(o.opciones.map((x) => x.texto).join(' ')).not.toContain('faltaba');
        expect(o.opciones[1].texto).toContain('pagó otra vez $6.60');
    });
    it('anticipo parcial: dice cuánto faltaba', () => {
        const o = opcionesCerrarConVenta({ anticipo: 2, precio: 3.3, cantidad: 2, vendida_aparte: { total: 6.6 } });
        expect(o.cubria).toBe(false);
        expect(o.opciones[0].texto).toContain('$4.60 que faltaban');
        expect(o.opciones[1].texto).toContain('$2.00 quedan a su favor');
    });
});
