import { describe, it, expect } from 'vitest';
import { conTramo, diferenciaDelCorte, repartirEnPartes } from '../../src/utils/cortesDiagnostico';

// Los casos son cortes REALES capturados el 13 y 14 de agosto de 2026. No son
// inventados a propósito: la regla que prueban —que sólo un corte confirmado
// corre la base— salió de un faltante de $1.25 que el portal mostraba en Salud 5
// sobre un corte que cuadraba, y que el aviso que la sala lee hace años daba por
// exacto. Un número inventado no habría encontrado eso.

const corte = (o) => ({ tipo: 'C', estado: 'PENDIENTE', ...o });

// Salud 5, 14-ago. A las 12:36 sobraba $1.25 porque el cobro de crédito de $1.25
// no estaba registrado; lo registraron y rehicieron el corte a las 12:40 — mismo
// efectivo, misma venta, exacto.
const SALUD5 = [
    corte({ hora: '12:36:24', total_declarado: 230.07, diferencia_erp: 1.25, tk_total_caja: 228.82, tk_cobros_credito: null }),
    corte({ hora: '12:40:20', total_declarado: 230.07, diferencia_erp: -6.25, tk_total_caja: 230.07, tk_cobros_credito: 1.25 }),
];

describe('la diferencia propia de un corte', () => {
    it('usa la del comprobante y no la que guardó el sistema', () => {
        // 230.07 − 230.07 = 0, aunque el sistema guardó −6.25 (cuenta cinco veces
        // el cobro de crédito de 1.25).
        expect(diferenciaDelCorte(SALUD5[1]).valor).toBe(0);
        expect(diferenciaDelCorte(SALUD5[1]).fuente).toBe('ticket');
    });

    it('deja mandar a la guardada cuando el comprobante sumó un cobro que aún no entraba', () => {
        // Salud 3, 13-ago 12:39: brecha de exactamente +1× el cobro de crédito.
        const c = corte({
            hora: '12:39:10', total_declarado: 488.80, diferencia_erp: 0.75,
            tk_total_caja: 542.70, tk_cobros_credito: 54.65,
        });
        expect(diferenciaDelCorte(c).valor).toBe(0.75);
        expect(diferenciaDelCorte(c).fuente).toBe('guardada');
    });
});

describe('el tramo: sólo un corte CONFIRMADO corre la base', () => {
    it('no le cobra al corte bueno la diferencia del que vino a reemplazar', () => {
        const [a, b] = conTramo(SALUD5);
        expect(a.tramo).toBe(1.25);
        // Antes daba −1.25: restaba el +1.25 del corte de las 12:36, que nadie
        // había firmado. El corte de las 12:40 cuadra y tiene que decir eso.
        expect(b.tramo).toBe(0);
    });

    it('sí arrastra la diferencia cuando el corte anterior está confirmado', () => {
        const [, b] = conTramo([{ ...SALUD5[0], estado: 'CONFIRMADO' }, SALUD5[1]]);
        expect(b.tramo).toBe(-1.25);
    });

    it('un descartado no cuenta ni como base ni como tramo', () => {
        const [a, b] = conTramo([{ ...SALUD5[0], estado: 'DESCARTADO' }, SALUD5[1]]);
        expect(a.tramo).toBeNull();
        expect(b.tramo).toBe(0);
    });

    it('mide contra el último confirmado, no contra el corte de al lado', () => {
        // Salud 1, 13-ago: dos pendientes en el medio no mueven la referencia.
        const serie = conTramo([
            corte({ hora: '12:00:00', estado: 'CONFIRMADO', total_declarado: 100, diferencia_erp: 0.50, tk_total_caja: 99.50, tk_cobros_credito: null }),
            corte({ hora: '13:00:00', total_declarado: 200, diferencia_erp: 0.75, tk_total_caja: 199.25, tk_cobros_credito: null }),
            corte({ hora: '14:00:00', total_declarado: 300, diferencia_erp: 0.90, tk_total_caja: 299.10, tk_cobros_credito: null }),
        ]);
        expect(serie[1].tramo).toBe(0.25);   // 0.75 − 0.50
        expect(serie[2].tramo).toBe(0.40);   // 0.90 − 0.50, NO 0.90 − 0.75
    });

    it('el cierre del día no tiene tramo', () => {
        expect(conTramo([{ tipo: 'Z', estado: 'PENDIENTE' }])[0].tramo).toBeNull();
    });
});

describe('repartir una reposición entre quienes aportan', () => {
    it('no pierde ni inventa centavos al dividir', () => {
        // $1.25 entre dos: 0.63 + 0.62. Redondear cada parte daría 1.26 o 1.24, y
        // el servidor rechaza el reparto que no cierra exacto.
        expect(repartirEnPartes(-1.25, 2)).toEqual([0.63, 0.62]);
        expect(repartirEnPartes(1.25, 2).reduce((a, b) => a + b, 0)).toBeCloseTo(1.25, 2);
    });

    it('reparte lo que no divide exacto entre las primeras', () => {
        expect(repartirEnPartes(-10, 3)).toEqual([3.34, 3.33, 3.33]);
        expect(repartirEnPartes(-0.01, 3)).toEqual([0.01, 0, 0]);
    });

    it('siempre devuelve montos positivos, venga un faltante o un sobrante', () => {
        expect(repartirEnPartes(-5, 1)).toEqual([5]);
        expect(repartirEnPartes(5, 1)).toEqual([5]);
    });

    it('sin nadie que aporte no hay reparto', () => {
        expect(repartirEnPartes(-5, 0)).toEqual([]);
    });
});
