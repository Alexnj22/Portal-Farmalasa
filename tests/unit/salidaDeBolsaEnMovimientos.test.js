// Cuánto de una salida de bolsa lo contó ya un VALE de la caja, y cuánto no.
//
// Se prueba porque las dos mitades van a dos lugares distintos de la pantalla
// —la que el vale contó se dibuja DENTRO de su renglón, la otra como fila
// propia— y equivocarse cuenta el mismo dinero dos veces o lo esconde entero.
//
// Los datos son los reales: los tres vales que existen (Salud 3 y Salud 4,
// 1 y 2 de septiembre de 2026) y la remesa REM-1058 repartida en tres bolsas.

import { describe, it, expect } from 'vitest';
import { repartoDeUnaSalida } from '../../src/utils/cortesDiagnostico';

/** Una parte pagada desde una bolsa. `vale` es el `erp_movimiento_id` del
 *  renglón que la caja anotó, o `null` si esa bolsa ya estaba cerrada. */
const parte = (monto, vale = null, anulado = null) => ({
    monto: String(monto),
    anulado_at: anulado,
    caja_vale_id: vale ? `v-${vale}` : null,
    caja_vales_portal: vale ? { erp_movimiento_id: vale } : null,
});

const salida = (monto, partes) => ({ monto: String(monto), bolsas_movimientos: partes });

describe('repartoDeUnaSalida', () => {
    /* Salud 3, 1-sep: la remesa REM-1058 de $500 salió de tres bolsas —$119.38
     * de la del día abierto y $380.62 de dos del 31-ago—, y el vale real fue de
     * $119.38. Es el caso que enseñó que el monto de la operación NO es lo que
     * la caja descuenta. */
    it('parte la remesa REM-1058 en lo que el vale contó y lo que no', () => {
        const r = repartoDeUnaSalida(salida(500, [
            parte(119.38, 43814),
            parte(200.00),
            parte(180.62),
        ]));
        expect(r.porVale.get(43814)).toBeCloseTo(119.38, 2);
        expect(r.cubiertoPorVales).toBeCloseTo(119.38, 2);
        expect(r.montoSinVale).toBeCloseTo(380.62, 2);
    });

    /* Salud 4, 2-sep: el vale 7 son $300 de una sola salida. Cubierta entera →
     * no le corresponde fila propia, sólo salir en el desglose del vale. */
    it('una salida cubierta entera no deja nada afuera', () => {
        const r = repartoDeUnaSalida(salida(300, [parte(300, 43911)]));
        expect(r.montoSinVale).toBe(0);
        expect(r.porVale.get(43911)).toBeCloseTo(300, 2);
    });

    /* De una bolsa ya cerrada: la caja no anota nada, porque ese dinero salió
     * de la caja en el corte que la embolsó. Es el caso de las 65 salidas y los
     * $15,072.74 que no se veían en ninguna pantalla de Efectivo. */
    it('sin ningún vale, todo queda afuera', () => {
        const r = repartoDeUnaSalida(salida(120, [parte(120)]));
        expect(r.cubiertoPorVales).toBe(0);
        expect(r.montoSinVale).toBeCloseTo(120, 2);
        expect(r.porVale.size).toBe(0);
    });

    /* Salud 3, 2-sep: el vale 8 son $180 de TRES salidas. Cada una aporta lo
     * suyo al mismo `erp_movimiento_id`, y el desglose las suma por vale. */
    it('suma varias partes que caen en el mismo vale', () => {
        const r = repartoDeUnaSalida(salida(180, [
            parte(60, 43912), parte(60, 43912), parte(60, 43912),
        ]));
        expect(r.porVale.size).toBe(1);
        expect(r.porVale.get(43912)).toBeCloseTo(180, 2);
        expect(r.montoSinVale).toBe(0);
    });

    /* Una parte anulada no movió dinero: contarla como cubierta diría que el
     * vale descontó algo que no descontó, y escondería el resto de la fila. */
    it('una parte anulada no cuenta como cubierta', () => {
        const r = repartoDeUnaSalida(salida(100, [parte(40, 43912, '2026-09-02T20:00:00Z'), parte(60)]));
        expect(r.cubiertoPorVales).toBe(0);
        expect(r.montoSinVale).toBeCloseTo(100, 2);
    });

    /* Nunca negativo. Un `montoSinVale` negativo se restaría del neto e
     * inventaría dinero; cero dice «no queda nada afuera», que es lo seguro. */
    it('si las partes suman más que la operación, no queda nada afuera', () => {
        const r = repartoDeUnaSalida(salida(100, [parte(150, 43912)]));
        expect(r.montoSinVale).toBe(0);
    });

    it('una operación sin partes queda entera afuera', () => {
        expect(repartoDeUnaSalida(salida(75, [])).montoSinVale).toBeCloseTo(75, 2);
        expect(repartoDeUnaSalida({}).montoSinVale).toBe(0);
    });
});
