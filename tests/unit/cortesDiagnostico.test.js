import { describe, it, expect } from 'vitest';
import {
    cobrosDeCredito, conLaCuentaBuena, conTramo, desgloseDelCierre, diferenciaDelCorte,
    formasFueraDelComprobante, noContoEfectivo, notaDeCifra, repartirEnPartes,
    seConfirmaDeUnClic, sugerenciasDeCorte, resumenDeCortes,
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

    it('el tiquete gana aunque la brecha sea +1x los cobros de crédito', () => {
        /* Salud 3, 1-sep 21:03 (corte 14378). El tiquete suma
         * 1334.54 − 254.18 + 66.10 = 1146.61 y se contaron 1146.37: **−$0.09**.
         * El formulario decía +$66.01 —un sobrante inexistente— porque omitió
         * los cobros de crédito, que son efectivo que entró al cajón.
         *
         * Hubo una excepción que le daba la razón al formulario con esta firma.
         * Se quitó con datos: sobre 485 cortes la suma del tiquete cierra en
         * 485; el formulario se aparta en 112. Y su premisa era falsa —si el
         * tiquete imprimiera el total del día, `tk_cobros_credito` sería igual
         * en todos los cortes de la jornada, y crece 40 veces sobre 371 pares. */
        const c = corte({
            hora: '21:03:45', total_declarado: 1146.37, diferencia_erp: 66.01,
            tk_total_caja: 1146.46, tk_cobros_credito: 66.10,
        });
        expect(diferenciaDelCorte(c).valor).toBe(-0.09);
        expect(diferenciaDelCorte(c).fuente).toBe('ticket');
        expect(diferenciaDelCorte(c).esperado).toBe(1146.46);
    });

    it('y también en un corte de media mañana: la hora no cambia la cuenta', () => {
        /* La pregunta del usuario: «¿qué pasa si hay 3 cortes en el día?». Un
         * intento anterior desempataba mirando si era el ÚLTIMO — con eso, un
         * corte del mediodía con la misma firma habría vuelto a inventar el
         * sobrante. Sin excepción no hay nada que desempatar. */
        const c = corte({
            hora: '12:39:10', total_declarado: 488.80, diferencia_erp: 55.40,
            tk_total_caja: 488.80, tk_cobros_credito: 54.65,
        });
        expect(diferenciaDelCorte(c).valor).toBe(0);
        expect(diferenciaDelCorte(c).fuente).toBe('ticket');
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

// ── Las formas de pago que el comprobante no nombra ────────────────────────
// El tiquete imprime dos secciones y sólo dos: tarjeta y crédito. Verificado en
// los 42 capturados. Una transferencia (469 documentos y $19,685 en 15 meses),
// un cheque o un bitcoin cobran, entran al total del cierre y no salen en
// ningún renglón del papel.

describe('las formas que el comprobante no nombra', () => {
    const facturas = (o) => Object.entries(o).map(([tipo_pago, total]) => ({ tipo_pago, total }));

    it('deja fuera lo que el papel SÍ imprime', () => {
        const f = formasFueraDelComprobante(
            facturas({ efectivo: 1409.05, tarjeta: 362.25, credito: 0.65, transferencia: 2.20 }),
        );
        expect(f).toEqual([{ tipo: 'transferencia', total: 2.20 }]);
    });

    it('las ordena de mayor a menor y descarta los centavos sueltos', () => {
        const f = formasFueraDelComprobante(
            facturas({ efectivo: 100, transferencia: 206.41, cheque: 80, bitcoin: 0 }),
        );
        expect(f.map((x) => x.tipo)).toEqual(['transferencia', 'cheque']);
    });

    it('sin facturas no inventa nada', () => {
        expect(formasFueraDelComprobante(null)).toEqual([]);
        expect(formasFueraDelComprobante(facturas({ efectivo: 500 }))).toEqual([]);
    });
});

describe('la pista de una forma que no pasa por la caja', () => {
    const conTramoDe = (n) => ({ tipo: 'C', estado: 'PENDIENTE', tramo: n });

    it('avisa cuando el sobrante es igual a una transferencia del día', () => {
        const s = sugerenciasDeCorte(conTramoDe(2.20), [], [{ tipo: 'transferencia', total: 2.20 }]);
        expect(s[0].titulo).toContain('transferencia');
        expect(s[0].titulo).toContain('2.20');
    });

    it('NO la ofrece ante un faltante', () => {
        // Estas formas no entran a la caja: confundirlas con efectivo hace que
        // SOBRE lo declarado, nunca que falte. Mandaría a buscar donde no es.
        const s = sugerenciasDeCorte(conTramoDe(-2.20), [], [{ tipo: 'transferencia', total: 2.20 }]);
        expect(s.some((x) => x.titulo.includes('transferencia'))).toBe(false);
    });

    it('no dice nada cuando el monto no coincide', () => {
        const s = sugerenciasDeCorte(conTramoDe(5.00), [], [{ tipo: 'cheque', total: 80 }]);
        expect(s.some((x) => x.titulo.includes('cheque'))).toBe(false);
    });

    it('va PRIMERA: es la única pista que no se puede ver en el papel', () => {
        const movimientos = [{ tipo: 'ENTRADA', concepto: 'algo', monto: 2.20 }];
        const s = sugerenciasDeCorte(conTramoDe(2.20), movimientos, [{ tipo: 'cheque', total: 2.20 }]);
        expect(s[0].titulo).toContain('cheque');
    });
});

// ── A qué corte pertenece cada cobro de crédito ─────────────────────────────
// El caso base son los tres cobros que Salud 4 hizo desde el portal el 2-sep
// entre las 10:01 y las 10:04 —dos por transferencia y uno en efectivo—, que es
// justo la mezcla que el comprobante no distingue.
const ABONOS_S4 = [
    { id: 1, hora: '10:01:01', monto: 11.30, forma: 'Transferencia', cliente: 'AUDELIA CALLEJAS' },
    { id: 2, hora: '10:03:15', monto: 8.55, forma: 'Efectivo', cliente: 'GLENDA ANAYA' },
    { id: 3, hora: '10:04:18', monto: 10.00, forma: 'Transferencia', cliente: 'AUDELIA CALLEJAS' },
];

describe('los cobros de crédito de un corte', () => {
    it('parte el día por la hora del corte, no por el día entero', () => {
        const c = cobrosDeCredito({ hora: '10:03:30', tk_cobros_credito: 8.55 }, ABONOS_S4);
        expect(c.antes.map((a) => a.id)).toEqual([1, 2]);
        expect(c.despues.map((a) => a.id)).toEqual([3]);
        expect(c.hasta).toBe(19.85);
        // Cuadra contra lo que ENTRÓ AL CAJÓN, no contra todo lo cobrado: la
        // transferencia de las 10:01 no llega al comprobante.
        expect(c.enCaja).toBe(8.55);
        expect(c.cuadra).toBe(true);
    });

    it('se compara contra lo que entró al cajón, no contra todo lo cobrado', () => {
        // Un cobro por transferencia no entra al cajón, así que compararlo
        // contra el total ($29.85) denunciaría una brecha falsa en cada corte
        // donde alguien pagó por transferencia. Ojo: que el comprobante traiga
        // $8.55 acá es el dato del caso, no una regla — el comprobante tampoco
        // cuenta el efectivo del portal; eso lo corrige `contraste`.
        const c = cobrosDeCredito({ hora: '13:00:00', tk_cobros_credito: 8.55 }, ABONOS_S4);
        expect(c.hasta).toBe(29.85);
        expect(c.enCaja).toBe(8.55);
        expect(c.noEfectivo).toBe(21.30);
        expect(c.cuadra).toBe(true);
    });

    it('un abono anulado no cuenta ni antes ni después', () => {
        const c = cobrosDeCredito({ hora: '13:00:00', tk_cobros_credito: 8.55 },
            [...ABONOS_S4, { id: 9, hora: '11:00:00', monto: 50, forma: 'Efectivo', anulado: true }]);
        expect(c.hasta).toBe(29.85);
        expect(c.enCaja).toBe(8.55);
        expect(c.antes.some((a) => a.id === 9)).toBe(false);
    });

    it('registrar menos que el comprobante NO es un hallazgo', () => {
        // Los $66.10 de Salud 3 del 1-sep fueron nueve cobros cargados en la
        // pantalla de la caja: ninguno pasó por el portal. La brecha negativa es
        // eso, no un descuadre.
        const c = cobrosDeCredito({ hora: '21:03:45', tk_cobros_credito: 66.10 }, []);
        expect(c.hasta).toBe(0);
        expect(c.brecha).toBe(-66.10);
        expect(c.cuadra).toBe(false);
    });

    it('NO culpa al cobro que no fue efectivo por un faltante', () => {
        // Fue una hipótesis del 2-sep y la medición del mismo día la desmintió:
        // el comprobante no cuenta esos cobros, así que no pueden explicar un
        // faltante. Ofrecerla mandaba a buscar una causa que no existe.
        const cobros = cobrosDeCredito({ hora: '13:00:00', tk_cobros_credito: 8.55 }, ABONOS_S4);
        const s = sugerenciasDeCorte({ ...corte({ hora: '13:00:00' }), tramo: -21.30 }, [], [], cobros);
        expect(s.some((x) => x.titulo.includes('no entraron en efectivo'))).toBe(false);
    });

    it('se calla sobre los cobros cuando el detalle ya los explica', () => {
        const cobros = cobrosDeCredito({ hora: '10:30:00', tk_cobros_credito: 8.55 },
            [ABONOS_S4[1]]);
        const s = sugerenciasDeCorte(
            { ...corte({ hora: '10:30:00' }), tramo: -3.00, tk_cobros_credito: 8.55 }, [], [], cobros,
        );
        expect(s.some((x) => x.titulo.includes('cobros de crédito'))).toBe(false);
    });

    it('y se calla también con una transferencia en el medio', () => {
        // El cobro que no es efectivo ya no impide dar por explicada la línea:
        // el comprobante tampoco lo cuenta.
        const cobros = cobrosDeCredito({ hora: '10:30:00', tk_cobros_credito: 8.55 },
            [ABONOS_S4[0], ABONOS_S4[1]]);
        const s = sugerenciasDeCorte(
            { ...corte({ hora: '10:30:00' }), tramo: -3.00, tk_cobros_credito: 8.55 }, [], [], cobros,
        );
        expect(s.some((x) => x.titulo.includes('cobros de crédito'))).toBe(false);
    });
});

/* ── El efectivo del portal que el comprobante no cuenta ─────────────────────
 *
 * Salud 4, 2-sep, corte de las 13:00 (id 666). Es el caso REAL que destapó el
 * defecto, con las cifras del papel y de la base:
 *
 *     INGRESOS  6.00 + VENTA 274.85 − VALES 50.00 = TOTAL CAJA 230.85
 *     sin línea COBROS CREDITO
 *     dos cobros del portal EN EFECTIVO antes de contar: 8.55 + 79.70 = 88.25
 *     se contaron 309.25
 *
 * El portal anunciaba +$78.40 de sobrante. Lo que había era un faltante de
 * $9.85 — y ese número decide si a alguien se le señala un faltante, así que
 * está anclado acá y no sólo en la base. */
describe('el efectivo del portal que el comprobante deja fuera', () => {
    const S4 = corte({
        hora: '13:00:49', total_declarado: 309.25, diferencia_erp: 78.40,
        tk_ingresos: 6.00, tk_venta: 274.85, tk_subtotal: 280.85, tk_vales: 50.00,
        tk_cobros_credito: null, tk_total_caja: 230.85, cobros_portal_efectivo: 88.25,
    });

    it('lo suma al esperado y convierte el sobrante fantasma en el faltante real', () => {
        const d = diferenciaDelCorte(S4);
        expect(d.esperado).toBe(319.10);
        expect(d.valor).toBe(-9.85);
        expect(d.fuente).toBe('ticket');
    });

    it('no lo cuenta dos veces cuando el comprobante YA lo trae', () => {
        // Mismo día, misma plata, pero con la línea impresa: el esperado del
        // comprobante ya la incluye y sumarla otra vez inventaría un faltante
        // de $88.25.
        const conLinea = corte({
            ...S4, tk_cobros_credito: 88.25, tk_total_caja: 319.10,
        });
        expect(diferenciaDelCorte(conLinea).esperado).toBe(319.10);
        expect(diferenciaDelCorte(conLinea).valor).toBe(-9.85);
    });

    it('deriva lo que contó el comprobante de su propia suma, no del renglón', () => {
        // El renglón se lee del papel con una expresión regular. Si el origen le
        // cambia el nombre, `tk_cobros_credito` queda en null — y creerle a ese
        // null inventaría un faltante del tamaño de los cobros del día.
        const sinRenglon = corte({
            ...S4, tk_cobros_credito: null, tk_total_caja: 319.10, tk_subtotal: 280.85, tk_vales: 50.00,
        });
        expect(diferenciaDelCorte(sinRenglon).esperado).toBe(319.10);
    });

    it('el comprobante contando MÁS que el portal no es un hallazgo', () => {
        // Cobros hechos en la pantalla de la caja: el portal no los ve. El piso
        // en cero evita que esa diferencia se reste del esperado.
        const enLaCaja = corte({
            ...S4, tk_cobros_credito: 150.00, tk_total_caja: 380.85, cobros_portal_efectivo: 88.25,
        });
        expect(diferenciaDelCorte(enLaCaja).esperado).toBe(380.85);
    });

    it('lo explica en pantalla en vez de marcarlo como plata sin explicar', () => {
        const n = notaDeCifra(S4);
        expect(n.alerta).toBe(false);
        expect(n.titulo).toBe('El comprobante no contó los cobros de crédito');
        expect(n.detalle).toContain('$88.25');
        expect(n.detalle).toContain('$319.10');
    });

    it('el tramo del día sale del esperado corregido', () => {
        // Un corte anterior confirmado corre la base; el de las 13:00 tiene que
        // medirse contra el esperado bueno, no contra el del comprobante.
        const [manana, tarde] = conTramo([
            corte({ hora: '10:00:00', estado: 'CONFIRMADO', total_declarado: 100, diferencia_erp: 0,
                tk_subtotal: 100, tk_vales: 0, tk_total_caja: 100, cobros_portal_efectivo: 0 }),
            S4,
        ]);
        expect(manana.tramo).toBe(0);
        expect(tarde.tramo).toBe(-9.85);
        expect(tarde.esperadoUsado).toBe(319.10);
    });

    it('sin cobros del portal nada cambia', () => {
        const limpio = corte({
            hora: '21:03:45', total_declarado: 1146.37, diferencia_erp: 66.01,
            tk_subtotal: 1334.54, tk_vales: 254.18, tk_cobros_credito: 66.10,
            tk_total_caja: 1146.46, cobros_portal_efectivo: 0,
        });
        expect(diferenciaDelCorte(limpio).valor).toBe(-0.09);
        // La nota que sale es la de siempre —el formulario contó los cobros de
        // más—, no la nueva: no hay nada que el comprobante haya dejado fuera.
        expect(notaDeCifra(limpio).titulo).toBe('Los cobros de crédito se contaron de más');
    });
});

/* ── El corte que no contó el efectivo ───────────────────────────────────────
 *
 * Salud 4, 2-sep 13:09 (corte 14393), nueve minutos después del de las 13:00 y
 * con las mismas cifras del día. Su tiquete termina:
 *
 *     TOTAL CAJA $:  230.85 · EFECTIVO $: 0.00 · EXACTO FELICIDADES $: 0.00
 *
 * El portal restaba 0 − 319.10 y anunciaba un faltante de $319.10 con un botón
 * al lado para cobrárselo a alguien. */
describe('un corte que no contó el efectivo', () => {
    const SIN_CONTEO = corte({
        hora: '13:09:48', total_declarado: 0, diferencia_erp: 0,
        tk_ingresos: 6.00, tk_venta: 274.85, tk_subtotal: 280.85, tk_vales: 50.00,
        tk_cobros_credito: null, tk_total_caja: 230.85, cobros_portal_efectivo: 88.25,
    });

    it('se reconoce por las tres cosas juntas', () => {
        expect(noContoEfectivo(SIN_CONTEO)).toBe(true);
    });

    it('no tiene diferencia: `null`, que no es cero', () => {
        const d = diferenciaDelCorte(SIN_CONTEO);
        expect(d.valor).toBe(null);
        expect(d.fuente).toBe('sin-conteo');
    });

    it('no se puede confirmar de un clic', () => {
        // Con `valor: 0` habría quedado listo para firmar sin abrirlo, que es
        // peor que el faltante inventado: no lo mira nadie.
        const [c] = conTramo([SIN_CONTEO]);
        expect(c.tramo).toBe(null);
        expect(seConfirmaDeUnClic(c)).toBe(false);
    });

    it('no corre la base del día ni se cuenta como cuadrado', () => {
        const lista = conTramo([
            corte({ hora: '13:00:49', estado: 'CONFIRMADO', total_declarado: 309.25, diferencia_erp: 78.40,
                tk_subtotal: 280.85, tk_vales: 50.00, tk_total_caja: 230.85, cobros_portal_efectivo: 88.25 }),
            { ...SIN_CONTEO, estado: 'CONFIRMADO' },
            corte({ hora: '18:00:00', total_declarado: 400.00, diferencia_erp: 0,
                tk_subtotal: 280.85, tk_vales: 50.00, tk_total_caja: 400.00, cobros_portal_efectivo: 88.25 }),
        ]);
        expect(lista[0].tramo).toBe(-9.85);
        expect(lista[1].tramo).toBe(null);
        // El de las 18:00 se mide contra el de las 13:00, no contra el vacío.
        expect(lista[2].tramo).toBe(9.85);

        const r = resumenDeCortes(lista);
        expect(r.sinConteo).toBe(1);
        expect(r.vivos).toBe(2);
    });

    it('una caja realmente vacía SÍ sigue siendo un faltante', () => {
        // La diferencia está en que ahí el origen marca el faltante. Silenciarlo
        // taparía una alarma buena, así que las tres condiciones van juntas.
        const vacia = corte({
            hora: '20:00:00', total_declarado: 0, diferencia_erp: -230.85,
            tk_subtotal: 280.85, tk_vales: 50.00, tk_total_caja: 230.85, cobros_portal_efectivo: 0,
        });
        expect(noContoEfectivo(vacia)).toBe(false);
        expect(diferenciaDelCorte(vacia).valor).toBe(-230.85);
    });
});

describe('la pista del múltiplo mide en dólares, no en la razón', () => {
    it('no ofrece un múltiplo que no suma', () => {
        /* El caso real: diferencia $319.10 y un movimiento de $79.70. La
         * pantalla decía «la diferencia es 4 × $79.70», pero 4 × 79.70 = 318.80.
         * Con la tolerancia sobre la razón, medio centésimo son 40 centavos a
         * esta altura de cifra. */
        const s = sugerenciasDeCorte(
            { ...corte({ hora: '13:09:48' }), tramo: -319.10 },
            [{ tipo: 'ENTRADA', monto: 79.70, concepto: 'POR ABONO A CREDITO' }],
        );
        expect(s.some((x) => x.titulo.includes('79.70'))).toBe(false);
    });

    it('y sigue ofreciendo el que sí suma', () => {
        const s = sugerenciasDeCorte(
            { ...corte({ hora: '13:09:48' }), tramo: -318.80 },
            [{ tipo: 'ENTRADA', monto: 79.70, concepto: 'POR ABONO A CREDITO' }],
        );
        expect(s.some((x) => x.titulo.includes('79.70'))).toBe(true);
    });
});

/* ── El corte RECIÉN HECHO se cuenta igual que el mismo corte en la tabla ────
 *
 * Corte 14399 de Salud 4, 2026-09-02 14:11. El papel que imprimió el portal
 * decía **+$88.40** y la tarjeta —ya con la fila sellada por el trigger— decía
 * **+$0.15**: dos números para el mismo corte, y el equivocado es el que queda
 * en papel.
 *
 * La causa no fue el juez sino las PIEZAS. La traducción de la respuesta de
 * `hacer-corte-caja` a una fila de `cortes_caja` vivía en la vista y se había
 * quedado con cinco de las ocho columnas que `contraste` lee: sin
 * `cobros_portal_efectivo` da por cero el efectivo de cobros de crédito que el
 * comprobante no cuenta, y la corrección no se aplica. No hay error, no falta
 * ninguna línea, y en la tabla se ve bien — por eso se imprimió. */
describe('la cuenta del corte recién hecho', () => {
    const RESPUESTA_14399 = {
        ok: true, contado: 339.25, esperado: 250.85, diferencia: 88.40,
        cobros_portal_efectivo: 88.25,
        tiquete: {
            total_caja: 250.85, subtotal: 300.85, vales: 50.00, cobros_credito: 0,
        },
    };

    it('le suma el efectivo de los cobros del portal, como la tabla', () => {
        const r = conLaCuentaBuena(RESPUESTA_14399);
        expect(r.esperado).toBe(339.10);
        expect(r.diferencia).toBe(0.15);
        expect(r.fuente).toBe('ticket');
        // Y la explicación acompaña al número: sin ella la pantalla diría «hay
        // plata sin explicar» sobre la plata que acaba de explicar.
        expect(r.nota.titulo).toContain('cobros de crédito');
        // La del origen se conserva, no se pisa: es lo que quedó en su registro.
        expect(r.segun_el_sistema).toEqual({ esperado: 250.85, diferencia: 88.40 });
    });

    it('da lo mismo que leer la fila ya sellada — es el mismo corte', () => {
        const enLaTabla = corte({
            hora: '14:11:50', total_declarado: 339.25, diferencia_erp: 88.40,
            tk_subtotal: 300.85, tk_vales: 50.00, tk_cobros_credito: null,
            tk_total_caja: 250.85, cobros_portal_efectivo: 88.25,
        });
        const d = diferenciaDelCorte(enLaTabla);
        const r = conLaCuentaBuena(RESPUESTA_14399);
        expect([r.esperado, r.diferencia]).toEqual([d.esperado, d.valor]);
    });

    it('sin tiquete devuelve la respuesta tal cual: no hay qué comparar', () => {
        const sinTiquete = { ...RESPUESTA_14399, tiquete: { total_caja: null } };
        expect(conLaCuentaBuena(sinTiquete)).toBe(sinTiquete);
    });
});
