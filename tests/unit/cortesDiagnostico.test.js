import { describe, it, expect } from 'vitest';
import {
    conTramo, desgloseDelCierre, diferenciaDelCorte, repartirEnPartes,
} from '../../src/utils/cortesDiagnostico';

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

// ── El cierre del día (Z) ──────────────────────────────────────────────────
// Su monto es VENTA, no efectivo, y el detalle lo mostraba con los rótulos del
// corte de caja: decía «se contó $1,678.83» cuando en la caja hubo $1,602.88.
// Los casos son los seis cierres reales del 13-ago.

describe('el desglose del cierre del día', () => {
    it('saca el efectivo restando lo que no pasa por la caja', () => {
        // La Popular, 13-ago — el que levantó el usuario en pantalla.
        const d = desgloseDelCierre({ total_declarado: 1678.83, tk_tarjeta: 57.55, tk_credito: 18.40 });
        expect(d.total).toBe(1678.83);
        expect(d.efectivo).toBe(1602.88);
    });

    it('coincide con la venta del último corte de caja del mismo día', () => {
        // La comprobación que hace confiable la derivación: el efectivo del
        // cierre TIENE que ser el `VENTA` que contó el último corte.
        const casos = [
            { total: 1678.83, tarjeta: 57.55,  credito: 18.40, ventaDelUltimoCorte: 1602.88 }, // La Popular
            { total: 1628.75, tarjeta: 202.55, credito: 13.00, ventaDelUltimoCorte: 1413.20 }, // Salud 1
            { total: 1184.65, tarjeta: 33.60,  credito: 4.65,  ventaDelUltimoCorte: 1146.40 }, // Salud 3
            { total: 1306.16, tarjeta: 135.45, credito: 64.56, ventaDelUltimoCorte: 1106.15 }, // Salud 4
            { total: 347.55,  tarjeta: 35.15,  credito: null,  ventaDelUltimoCorte: 312.40 },  // Salud 5
        ];
        for (const c of casos) {
            const d = desgloseDelCierre({
                total_declarado: c.total, tk_tarjeta: c.tarjeta, tk_credito: c.credito,
            });
            expect(d.efectivo).toBeCloseTo(c.ventaDelUltimoCorte, 2);
        }
    });

    it('aguanta un cierre sin tarjeta ni crédito', () => {
        const d = desgloseDelCierre({ total_declarado: 500 });
        expect(d.tarjeta).toBe(0);
        expect(d.credito).toBe(0);
        expect(d.efectivo).toBe(500);
    });

    it('no inventa formas de pago que el origen no manda', () => {
        // `otras` existe para que el día que aparezca una forma nueva —una
        // transferencia— el desglose deje de cerrar y se vea. Hoy es cero en los
        // 42 tiquetes capturados.
        expect(desgloseDelCierre({ total_declarado: 100, tk_tarjeta: 10 }).otras).toBe(0);
    });
});
