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
    // La fuente buena son las facturas: traen TODAS las formas de pago. El
    // tiquete Z sólo lista tarjeta y crédito, y ahí se escondió una
    // transferencia dentro del efectivo.
    const facturas = (o) => Object.entries(o).map(([tipo_pago, total]) => ({ tipo_pago, total }));

    it('saca el efectivo de las facturas, no restando del total', () => {
        // La Popular, 13-ago — el cierre que el usuario abrió en pantalla.
        const d = desgloseDelCierre(
            { total_declarado: 1678.83 },
            facturas({ efectivo: 1602.88, tarjeta: 57.55, credito: 18.40 }),
        );
        expect(d.total).toBe(1678.83);
        expect(d.efectivo).toBe(1602.88);
        expect(d.derivado).toBe(false);
    });

    it('NO se traga una transferencia dentro del efectivo', () => {
        // Salud 2, 13-ago. El desglose derivado del tiquete daba $1,411.25 de
        // efectivo —$2.20 de más— porque el tiquete no imprime transferencias.
        const conFacturas = desgloseDelCierre(
            { total_declarado: 1774.15, tk_tarjeta: 362.25, tk_credito: 0.65 },
            facturas({ efectivo: 1409.05, tarjeta: 362.25, credito: 0.65, transferencia: 2.20 }),
        );
        expect(conFacturas.efectivo).toBe(1409.05);
        expect(conFacturas.formas.map((f) => f.tipo)).toContain('transferencia');

        // Y el caso viejo, para que quede escrito por qué no alcanzaba.
        const soloTiquete = desgloseDelCierre({
            total_declarado: 1774.15, tk_tarjeta: 362.25, tk_credito: 0.65,
        });
        expect(soloTiquete.efectivo).toBe(1411.25);
        expect(soloTiquete.derivado).toBe(true);
    });

    it('coincide con la venta del último corte de caja del mismo día', () => {
        // Lo que hace confiable la cifra: el efectivo del cierre TIENE que ser
        // el `VENTA` que contó el último corte. Las 6 salas del 13-ago.
        const casos = [
            { pagos: { efectivo: 1602.88, tarjeta: 57.55,  credito: 18.40 },                       ultimoCorte: 1602.88 },
            { pagos: { efectivo: 1413.20, tarjeta: 202.55, credito: 13.00 },                       ultimoCorte: 1413.20 },
            { pagos: { efectivo: 1409.05, tarjeta: 362.25, credito: 0.65, transferencia: 2.20 },   ultimoCorte: 1409.05 },
            { pagos: { efectivo: 1146.40, tarjeta: 33.60,  credito: 4.65 },                        ultimoCorte: 1146.40 },
            { pagos: { efectivo: 1106.15, tarjeta: 135.45, credito: 64.56 },                       ultimoCorte: 1106.15 },
            { pagos: { efectivo: 312.40,  tarjeta: 35.15 },                                        ultimoCorte: 312.40 },
        ];
        for (const c of casos) {
            expect(desgloseDelCierre({}, facturas(c.pagos)).efectivo).toBeCloseTo(c.ultimoCorte, 2);
        }
    });

    it('lista una forma que nunca vio antes, en vez de esconderla', () => {
        // El día que el origen agregue una forma nueva tiene que aparecer sola.
        const d = desgloseDelCierre({}, facturas({ efectivo: 100, cheque: 25 }));
        expect(d.formas).toEqual([{ tipo: 'cheque', total: 25 }]);
        expect(d.efectivo).toBe(100);
    });

    it('sin facturas cae al tiquete y lo dice', () => {
        const d = desgloseDelCierre({ total_declarado: 500 });
        expect(d.efectivo).toBe(500);
        expect(d.formas).toEqual([]);
        expect(d.derivado).toBe(true);
    });
});
