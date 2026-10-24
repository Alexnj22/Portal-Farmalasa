import { describe, it, expect } from 'vitest';
import { acumuladoAntesDe, cifraDeLaFranja, diferenciaDelCorte } from '@nucleo/utils/cortesDiagnostico';

/* Dos cortes reales de Salud 3 (filas de producción, 2026-10-24). Entre el
 * 14-ago y el 2-sep el origen le sumaba al esperado múltiplos de los cobros de
 * crédito, así que `diferencia_erp` NO es el faltante. */
const CORTE_161 = {
    id: 161, tipo: 'C', estado: 'CONFIRMADO', fecha: '2026-08-17', hora: '21:00:26',
    total_declarado: '2176.93', diferencia_erp: '-970.39', esperado: '3147.32',
    tk_subtotal: '2391.02', tk_vales: '456.70', tk_total_caja: '2176.92',
    tk_cobros_credito: '242.60', cobros_portal_efectivo: '0.00',
};
const CORTE_270 = {
    id: 270, tipo: 'C', estado: 'CONFIRMADO', fecha: '2026-08-20', hora: '21:18:03',
    total_declarado: '1866.08', diferencia_erp: '-499.50', esperado: '2365.58',
    tk_subtotal: '3323.11', tk_vales: '1583.53', tk_total_caja: '1864.78',
    tk_cobros_credito: '125.20', cobros_portal_efectivo: '0.00',
};

describe('la franja del corte usa el juez canónico, no la cifra del origen', () => {
    it('corte 161: el origen dice −$970.39, el corte cuadró (+$0.01)', () => {
        expect(diferenciaDelCorte(CORTE_161).valor).toBe(0.01);
        expect(cifraDeLaFranja(CORTE_161)).toEqual({ valor: 0.01, estado: 'sobra' });
    });

    it('corte 270: el origen dice −$499.50, sobraron $1.30', () => {
        expect(cifraDeLaFranja(CORTE_270)).toEqual({ valor: 1.3, estado: 'sobra' });
    });

    it('un corte exacto se rotula «cuadra» y uno con faltante «falta»', () => {
        const exacto = { ...CORTE_161, total_declarado: '2176.92' };
        expect(cifraDeLaFranja(exacto)).toEqual({ valor: 0, estado: 'cuadra' });
        const corto = { ...CORTE_161, total_declarado: '2170.00' };
        expect(cifraDeLaFranja(corto)).toEqual({ valor: -6.92, estado: 'falta' });
    });

    it('un corte que no contó el efectivo no «cuadró»: queda sin conteo', () => {
        const sinConteo = { ...CORTE_161, total_declarado: 0, diferencia_erp: 0 };
        expect(cifraDeLaFranja(sinConteo)).toEqual({ valor: null, estado: 'sin-conteo' });
    });
});

describe('la base del tramo con la lista de `caja_estado`', () => {
    it('con las piezas del tiquete, el acumulado previo es el del juez', () => {
        expect(acumuladoAntesDe([CORTE_161])).toEqual({ valor: 0.01, hora: '21:00:26' });
    });

    it('sin las piezas (la lista vieja) el juez sólo tiene la cifra del origen — por eso viajan', () => {
        const recortado = {
            id: 161, tipo: 'C', estado: 'CONFIRMADO', hora: '21:00:26',
            total_declarado: '2176.93', esperado: '3147.32', diferencia_erp: '-970.39',
        };
        expect(acumuladoAntesDe([recortado]).valor).toBe(-970.39);
    });
});
