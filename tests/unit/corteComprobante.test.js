import { describe, it, expect } from 'vitest';
import { construirComprobante, soloAscii } from '../../src/utils/corteComprobante';
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
            expect(linea.replace(/\x1b./g, '').length).toBeLessThanOrEqual(COLUMNAS_TICKET.chica);
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
