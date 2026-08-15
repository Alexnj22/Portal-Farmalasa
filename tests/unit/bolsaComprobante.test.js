import { describe, it, expect } from 'vitest';
import {
    construirEtiquetaDeBolsa, construirValeDeSalida, construirComprobanteDeEntrega,
} from '../../src/utils/bolsaComprobante';
import { seccionesParaElPrograma, COLUMNAS_TICKET } from '../../src/utils/ticketPrint';

// Los tres papeles de una bolsa de efectivo. Se prueban contra el camino SIN
// DIALOGO —el que arma el texto con posiciones contadas a mano— porque es el que
// sale de la ticketera en la sala y el único donde una columna de más se lleva
// un dígito sin avisar.
//
// El caso es una bolsa realista: Salud 3, corte de las 19:01 del 14-ago,
// $716.92 (el tramo más grande medido en los cortes capturados anda por ahí), y
// nombres con eñe y tilde, que fue el primer defecto del primer ticket impreso.

const bolsa = {
    folio: 'S3-260814-2', fecha: '2026-08-14', hora: '19:01:41',
    caja: 'MI CAJA LA SALUD 3', monto_inicial: 716.92,
    cerrada_at: '2026-08-15T01:12:00.000Z',
};

const salidas = [
    { fecha: '2026-08-14', hora: '20:15', motivo: 'Remesa entregada a un cliente', monto: -200 },
    { fecha: '2026-08-15', hora: '09:40', motivo: 'Pago a proveedor', monto: -150 },
];

const etiqueta = (extra = {}) => construirEtiquetaDeBolsa({
    bolsa, sala: 'Salud 3', cerradaPor: 'José Riváz Peña',
    version: 1, impresaAt: '2026-08-15T01:12:00.000Z', ...extra,
});

const vale = (extra = {}) => construirValeDeSalida({
    vale: { folio: 'V-S3-260815-1', monto: 200, saldo_despues: 516.92 },
    operacion: {
        folio: 'R-260815-3', motivo: 'Remesa entregada a un cliente',
        banco: 'Banco Agrícola', numero_boleta: '4477201', monto: 200,
    },
    bolsa, sala: 'Salud 3', registradoPor: 'Ana Peña Núñez',
    registradoAt: '2026-08-15T02:15:00.000Z', ...extra,
});

const entrega = (extra = {}) => construirComprobanteDeEntrega({
    entrega: { folio: 'E-S3-260816-1', entregado_at: '2026-08-16T14:20:00.000Z' },
    sala: 'Salud 3',
    bolsas: [
        { folio: 'S3-260814-2', fecha: '2026-08-14', hora: '19:01', efectivo: 366.92, vales: 350 },
        { folio: 'S3-260815-1', fecha: '2026-08-15', hora: '12:40', efectivo: 512.30, vales: 0 },
    ],
    entregadoPor: 'José Riváz Peña', recibidoPor: 'Carlos Menéndez', ...extra,
});

const cuerpo = (t) => seccionesParaElPrograma({ ancho: 80, ...t }).cuerpo;
const todoElTexto = (t) => JSON.stringify(seccionesParaElPrograma({ ancho: 80, ...t }));
// El pie es una SECCION aparte del cuerpo: buscar ahi una firma dentro de
// `cuerpo` no la encuentra nunca, y el test pasaria en verde al reves.
const pie = (t) => seccionesParaElPrograma({ ancho: 80, ...t }).pie;
// El `\x1b` es un caracter de control a propósito: son los códigos de la
// impresora, y quitarlos es justamente lo que hay que hacer para contar columnas.
// eslint-disable-next-line no-control-regex
const renglones = (t) => cuerpo(t).split('\n').map((l) => l.replace(/\x1b./g, ''));

describe.each([
    ['la etiqueta de la bolsa', etiqueta],
    ['la etiqueta con salidas', () => etiqueta({ salidas })],
    ['el vale de salida', vale],
    ['el comprobante de entrega', entrega],
])('reglas del rollo — %s', (_nombre, armar) => {
    it('no manda un solo caracter que el rollo no sepa imprimir', () => {
        // Fuera de 0x20–0x7E el papel imprime otra letra, y lo hace en silencio.
        const texto = todoElTexto(armar()).replace(/\\u001b./g, '');
        const raros = [...texto].filter((c) => c.charCodeAt(0) > 126 && c !== '\\');
        expect(raros).toEqual([]);
    });

    it('no pasa de 54 columnas en ningun renglon', () => {
        for (const linea of renglones(armar())) {
            expect(linea.length).toBeLessThanOrEqual(COLUMNAS_TICKET.chica);
        }
    });
});

describe('la etiqueta de una bolsa', () => {
    it('sin salidas dice el efectivo y no imprime tabla ni vales', () => {
        const t = etiqueta();
        expect(t.items).toBeUndefined();
        expect(t.totales).toEqual([['EFECTIVO ADENTRO', '$716.92', true]]);
        expect(cuerpo(t)).not.toContain('VALES ADENTRO');
    });

    it('descuenta las salidas y dice cuanto efectivo debe quedar', () => {
        // 716.92 − 200 − 150. Es la cifra que administracion cuenta con las
        // manos, y por eso es la destacada.
        expect(etiqueta({ salidas }).totales).toEqual([
            ['EFECTIVO QUE DEBE HABER', '$366.92', true],
            ['VALES ADENTRO (2)', '$350.00'],
        ]);
    });

    it('una bolsa sin un billete adentro cuadra: 0 en efectivo y todo en vales', () => {
        // El caso que preguntó el usuario. La bolsa viaja igual — lo que queda
        // adentro son boletas del banco, que valen lo mismo que los billetes.
        const vacia = etiqueta({
            salidas: [{ fecha: '2026-08-15', hora: '11:02', motivo: 'Remesa', monto: -716.92 }],
        });
        expect(vacia.totales).toEqual([
            ['EFECTIVO QUE DEBE HABER', '$0.00', true],
            ['VALES ADENTRO (1)', '$716.92'],
        ]);
    });

    it('avisa que anula a la anterior solo cuando no es la primera', () => {
        expect(etiqueta({ version: 1 }).pie).toContain('ETIQUETA #1');
        expect(etiqueta({ version: 3 }).pie).toContain('ETIQUETA #3 - ANULA LA ANTERIOR');
    });

    it('no pierde un digito de un monto de cuatro cifras', () => {
        // El relleno del rollo recorta por la IZQUIERDA lo que no entra en las 8
        // columnas del importe. Con `$1,234.56` (9) se perdía el primer
        // caracter, y con un signo delante el que se perdía era el signo: un
        // faltante impreso como sobrante. Ver `importeDeColumna`.
        const grande = etiqueta({
            salidas: [{ fecha: '2026-08-15', hora: '09:40', motivo: 'Pago a proveedor', monto: -1234.56 }],
        });
        const fila = renglones(grande).find((l) => l.includes('Pago a proveedor'));
        expect(fila).toContain('1,234.56');
        expect(fila.length).toBeLessThanOrEqual(COLUMNAS_TICKET.chica);
    });

    it('cinco cifras entran soltando el separador de miles, no cortando', () => {
        const enorme = etiqueta({
            salidas: [{ fecha: '2026-08-15', hora: '09:40', motivo: 'Envio a otra sala', monto: -12345.67 }],
        });
        expect(renglones(enorme).find((l) => l.includes('Envio a otra sala'))).toContain('12345.67');
    });
});

describe('el vale que queda dentro de la bolsa', () => {
    it('dice cuanto sale y cuanto queda — el papel a mano solo decia lo primero', () => {
        expect(vale().totales).toEqual([
            ['SALE DE LA BOLSA', '$200.00', true],
            ['QUEDA EN LA BOLSA', '$516.92'],
        ]);
    });

    it('nombra su bolsa: un vale que cambia de bolsa descuadra dos', () => {
        expect(pie(vale())).toContain('Este vale queda dentro de la bolsa S3-260814-2.');
    });

    it('en una remesa no hay quien firme: la recibe el cliente', () => {
        const t = vale();
        expect(pie(t)).not.toContain('Recibe:');
        expect(pie(t)).not.toContain('Firma');
        expect(cuerpo(t)).toContain('No. de boleta: 4477201');
    });

    it('en otra causa firma quien retira, y dice como se comprobo que era el', () => {
        const t = vale({ recibidoPor: { nombre: 'MARÍA JOSÉ PEÑA', metodo: 'CLAVE' } });
        expect(pie(t)).toContain('Recibe: MARIA JOSE PENA');
        expect(pie(t)).toContain('(usuario y contrasena)');
        expect(pie(t)).toContain('Firma ______________________');
    });

    it('cuando la operacion salio de dos bolsas, ningun vale parece ser toda la operacion', () => {
        const t = vale({
            vale: { folio: 'V-S3-260815-4', monto: 300, saldo_despues: 216.92 },
            operacion: { folio: 'P-260815-7', motivo: 'Pago a proveedor', monto: 500 },
        });
        expect(pie(t)).toContain('Parte de P-260815-7 por $500.00.');
    });

    it('cuando la operacion cabe en una sola bolsa no dice nada de partes', () => {
        expect(pie(vale())).not.toContain('Parte de');
    });
});

describe('el comprobante de entrega', () => {
    it('cierra con efectivo, vales y el total que amparan los cortes', () => {
        expect(entrega().totales).toEqual([
            ['BOLSAS', '2'],
            ['EFECTIVO', '$879.22', true],
            ['VALES (en 1 bolsa)', '$350.00'],
            ['TOTAL SEGUN LOS CORTES', '$1,229.22'],
        ]);
    });

    it('sin vales no imprime el renglon de vales', () => {
        const limpio = entrega({
            bolsas: [{ folio: 'S3-260815-1', fecha: '2026-08-15', hora: '12:40', efectivo: 512.30, vales: 0 }],
        });
        expect(limpio.totales.map(([r]) => r)).not.toContain('VALES');
        expect(cuerpo(limpio)).not.toContain('VALES');
    });

    it('el encabezado de la tabla no se pega a la columna de al lado', () => {
        // 'EFECTIVO' mide 8 y su campo mide 8: salia `HORAEFECTIVO`, ilegible.
        const cabecera = renglones(entrega()).find((l) => l.includes('BOLSA') && l.includes('HORA'));
        expect(cabecera).not.toMatch(/HORA\S/);
    });

    it('lleva las dos firmas: no es una entrega si la firma uno solo', () => {
        const texto = pie(entrega());
        expect(texto).toContain('Entrega: Jose Rivaz Pena');
        expect(texto).toContain('Recibe: Carlos Menendez');
    });
});
