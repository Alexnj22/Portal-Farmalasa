import { describe, it, expect } from 'vitest';
import {
    construirComprobante, construirComprobanteDeAsiento, soloAscii,
} from '../../src/utils/corteComprobante';
import { seccionesParaElPrograma, COLUMNAS_TICKET } from '../../src/utils/ticketPrint';

// El comprobante de una diferencia de caja es el PRIMER documento del portal que
// va al rollo, así que las reglas del papel se estrenan acá. Las dos que se
// rompen solas —y que no se ven desde una pantalla— son el ASCII y las 54
// columnas: las dos fallan en la sala, en térmico, y nadie las nota desde acá.
//
// El caso es el real de Salud 5 del 14-ago: faltante de $1.25 repuesto entre dos
// personas, una de ellas con eñe en el apellido (que fue justo el defecto del
// primer ticket impreso: «NUÑEZ» salió `NUÆEZ`).

const corte = {
    fecha: '2026-08-14',
    hora: '12:40:20',
    empleado_texto: 'MI CAJA LA SALUD 5',
};

const diferencia = {
    monto: -1.25,
    via: 'REPONE',
    causa: 'Cobro de credito no registrado al momento del corte',
    registrado_at: '2026-08-14T21:15:00.000Z',
};

const personas = [
    { nombre: 'EDWIN NUÑEZ', monto: 0.75 },
    { nombre: 'María José Peña', monto: 0.50 },
];

const armar = (extra = {}) => construirComprobante({
    corte, sala: 'Salud 5', diferencia, personas, registradoPor: 'Wendy Martínez', ...extra,
});

const cuerpo = (t) => seccionesParaElPrograma({ ancho: 80, ...t }).cuerpo;
const todoElTexto = (t) => JSON.stringify(seccionesParaElPrograma({ ancho: 80, ...t }));
// Los códigos de la impresora ocupan CERO columnas de papel, así que hay que
// sacarlos enteros antes de contar. `ESC a n` mide tres bytes: un `\x1b.` deja
// el tercero adentro y suma una columna que no existe — y desde que los códigos
// viajan pegados al renglón que mandan (para no gastar uno en blanco cada vez),
// ese byte de más era la diferencia entre 54 y «55, no cabe».
// eslint-disable-next-line no-control-regex
const sinCodigos = (s) => s.replace(/\x1b(?:[!aRt].|@)/g, '');

describe('el comprobante de una diferencia de caja', () => {
    it('no manda un solo caracter que el rollo no sepa imprimir', () => {
        // El rollo es ASCII: cualquier cosa fuera de 0x20–0x7E sale como basura.
        // Se prueba sobre TODO el documento —no sólo el cuerpo— porque los
        // nombres viajan en varias secciones.
        const texto = todoElTexto(armar()).replace(/\\u001b./g, '');
        const raros = [...texto].filter((c) => c.charCodeAt(0) > 126 && c !== '\\');
        expect(raros).toEqual([]);
    });

    it('convierte la eñe y las tildes en vez de perderlas', () => {
        expect(soloAscii('EDWIN NUÑEZ')).toBe('EDWIN NUNEZ');
        expect(soloAscii('María José Peña')).toBe('Maria Jose Pena');
        expect(cuerpo(armar())).toContain('EDWIN NUNEZ');
    });

    it('no pasa de 54 columnas en ningun renglon', () => {
        for (const linea of cuerpo(armar()).split('\n')) {
            expect(sinCodigos(linea).length).toBeLessThanOrEqual(COLUMNAS_TICKET.chica);
        }
    });

    it('lleva la fecha del CORTE y la de la firma, que no son la misma', () => {
        expect(cuerpo(armar())).toContain('14/08/2026');   // el corte
        expect(cuerpo(armar())).toContain('12:40');        // su hora
        // Quién y cuándo firmó van en el PIE, que es otra sección del documento
        // —por eso se busca en todo el ticket y no sólo en el cuerpo—.
        expect(todoElTexto(armar())).toContain('Wendy Martinez');
    });

    it('deja las dos lineas de firma que se llenan a mano al entregar', () => {
        const t = armar();
        expect(t.pie.some((l) => l.startsWith('Entrega'))).toBe(true);
        expect(t.pie.some((l) => l.startsWith('Recibe'))).toBe(true);
    });

    it('dice la direccion del dinero, no el signo', () => {
        // «-1.25» en un recibo se lee mal; «ENTRA A CAJA» no.
        expect(cuerpo(armar())).toContain('ENTRA A CAJA');
        expect(cuerpo(armar({ diferencia: { ...diferencia, monto: 1.25, via: 'RETIRA' }, personas: [] })))
            .toContain('SALE DE CAJA');
    });

    it('muestra el monto en positivo aunque el faltante sea negativo', () => {
        const texto = cuerpo(armar());
        expect(texto).toContain('1.25');
        expect(texto).not.toContain('-1.25');
    });

    it('reparte entre quienes aportan y sus partes suman el total', () => {
        const t = armar();
        expect(t.items.filas).toHaveLength(2);
        const suma = t.items.filas.reduce((a, [, monto]) => a + Number(monto.replace(/[^0-9.]/g, '')), 0);
        expect(suma).toBeCloseTo(1.25, 2);
    });

    it('no lleva lista de personas cuando nadie repone de su bolsillo', () => {
        const t = armar({ diferencia: { ...diferencia, via: 'JUSTIFICA' }, personas: [] });
        expect(t.items).toBeUndefined();
        expect(t.titulo).toBe('DIFERENCIA JUSTIFICADA');
    });

    it('recorta un nombre largo acá y no en la impresora', () => {
        const t = armar({ personas: [{ nombre: 'X'.repeat(80), monto: 1.25 }] });
        expect(t.items.filas[0][0].length).toBeLessThanOrEqual(COLUMNAS_TICKET.chica - 14);
    });
});

// ── El otro papel: el del movimiento acumulado ──────────────────────────────
// En el sistema queda UN ingreso por el total y nada dice de qué está hecho.
// Este comprobante lo desarma. Usa las cuatro columnas del ticket, cuya
// geometría está medida contra un ticket real — si alguien la cambia, la fecha
// y la hora se corren y el papel deja de identificar el corte.

const asiento = (extra = {}) => construirComprobanteDeAsiento({
    sala: 'Salud 5',
    entra: true,
    referencia: 'ING-4471',
    filas: [
        { fecha: '2026-08-14', hora: '12:40:20', monto: -1.25, causa: 'Cobro de credito sin registrar' },
        { fecha: '2026-08-14', hora: '19:02:11', monto: -0.75, causa: 'Vale sin su papel' },
    ],
    registradoPor: 'Wendy Martínez',
    cuando: '2026-08-14T22:05:00.000Z',
    ...extra,
});

describe('el comprobante del ingreso o vale acumulado', () => {
    it('no manda un solo caracter que el rollo no sepa imprimir', () => {
        const texto = todoElTexto(asiento()).replace(/\\u001b./g, '');
        expect([...texto].filter((c) => c.charCodeAt(0) > 126 && c !== '\\')).toEqual([]);
    });

    it('no pasa de 54 columnas en ningun renglon', () => {
        for (const linea of cuerpo(asiento()).split('\n')) {
            expect(sinCodigos(linea).length).toBeLessThanOrEqual(COLUMNAS_TICKET.chica);
        }
    });

    it('suma exactamente lo que suman sus lineas', () => {
        // El total del papel TIENE que ser el del documento del sistema: si no,
        // el que cuadre la caja va a buscar una diferencia que no existe. Se
        // compara contra la suma de las filas, no contra un texto suelto: un
        // `toContain('2.00')` pasaría igual si el 2.00 saliera de otro renglón.
        const t = asiento();
        const numero = (s) => Number(String(s).replace(/[^0-9.]/g, ''));
        const suma = t.items.filas.reduce((a, f) => a + numero(f[3]), 0);
        expect(numero(t.totales[0][1])).toBeCloseTo(suma, 2);
        expect(suma).toBeCloseTo(2.00, 2);
    });

    it('dice de que corte sale cada linea, con fecha y hora', () => {
        // Una sala corta tres veces el mismo día: sin la hora, la línea no
        // identifica cuál de los tres.
        const texto = cuerpo(asiento());
        expect(texto).toContain('12:40');
        expect(texto).toContain('19:02');
        expect(texto).toContain('14/08');
    });

    it('lleva el numero con que quedo el documento en el sistema', () => {
        expect(cuerpo(asiento())).toContain('ING-4471');
    });

    it('cambia de documento y de direccion segun el signo', () => {
        expect(asiento().titulo).toBe('INGRESO POR FALTANTES DE CAJA');
        expect(cuerpo(asiento())).toContain('TOTAL QUE ENTRA');

        const vale = asiento({ entra: false, referencia: 'VAL-88', filas: [
            { fecha: '2026-08-14', hora: '12:40:20', monto: 1.25, causa: 'Venta no registrada' },
        ] });
        expect(vale.titulo).toBe('VALE POR SOBRANTES DE CAJA');
        expect(cuerpo(vale)).toContain('TOTAL QUE SALE');
    });

    it('respeta la geometria de cuatro columnas del ticket real', () => {
        // Las mismas posiciones que ancla `ticketPrint.test.js`: 36, 44 y 52.
        const linea = cuerpo(asiento()).split('\n').find((l) => l.includes('Cobro de credito'));
        expect(linea.indexOf('14/08') + '14/08'.length).toBe(36);
        expect(linea.indexOf('12:40') + '12:40'.length).toBe(44);
        expect(linea.indexOf('$1.25') + '$1.25'.length).toBe(52);
    });

    it('recorta un motivo largo aca y no en la impresora', () => {
        const t = asiento({ filas: [{ fecha: '2026-08-14', hora: '12:40:20', monto: -1, causa: 'x'.repeat(90) }] });
        expect(t.items.filas[0][0].length).toBeLessThanOrEqual(28);
    });
});
