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
        entidad: 'MONEYGRAM', entidadEtiqueta: 'Remesadora',
        numero_boleta: '4477201', monto: 200,
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
// impresora, y quitarlos es justamente lo que hay que hacer para contar
// columnas. Van ENTEROS: `ESC a n` mide tres bytes y sacarle dos deja el tercero
// contando como una columna que en el papel no existe.
// eslint-disable-next-line no-control-regex
const sinCodigos = (s) => s.replace(/\x1b(?:[!aRt].|@)/g, '');
const renglones = (t) => cuerpo(t).split('\n').map(sinCodigos);

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

    // ── El papel se paga por centimetro ─────────────────────────────────────
    // Las tres de abajo son lo que pidio el usuario el 2026-08-17 mirando un
    // ticket real: «quita el nit, quita los espacios en blanco, y haz dos
    // columnas donde quepan». Cada una vuelve sola si nadie la vigila: un
    // codigo de impresora en su propio renglon imprime un renglon vacio, y un
    // dato por renglon es lo que sale de escribir la lista sin pensar en el
    // ancho.

    it('no lleva el NIT: estos papeles no salen de la farmacia', () => {
        expect(todoElTexto(armar())).not.toContain('0401-210685-101-0');
        expect(todoElTexto(armar())).not.toContain('NIT');
    });

    it('no gasta un renglon en blanco, salvo el que separa el total del pie', () => {
        // El salto del final de cada seccion no es un renglon: cierra el
        // ultimo. Por eso se recorta antes de contar, en las dos. Y el pie
        // termina ademas con el margen de corte, que SI tiene que estar: es lo
        // que salva la ultima linea de la cuchilla.
        // Sin los codigos: un renglon que solo los lleva imprime UN BLANCO, asi
        // que para contar blancos hay que sacarlos antes.
        const sinCierre = (texto) => texto.replace(/\n+$/, '').split('\n').map(sinCodigos);

        expect(sinCierre(cuerpo(armar())).filter((l) => l.trim() === '')).toEqual([]);

        // El pie arranca con UNO, a proposito (pedido del usuario el
        // 2026-08-17): sin el, el numero de etiqueta salia pegado al total. Es
        // el primero y no hay otro.
        const lineasDelPie = sinCierre(pie(armar()));
        expect(lineasDelPie[0].trim()).toBe('');
        expect(lineasDelPie.slice(1).filter((l) => l.trim() === '')).toEqual([]);
    });

    it('pone dos datos por renglon donde entran', () => {
        // Un renglon con dos rotulos es la prueba de que se armaron las dos
        // columnas; y la segunda arranca siempre en la mitad del rollo, para
        // que se lean como tabla y no como texto corrido.
        const conDos = renglones(armar()).filter((l) => (l.match(/: /g) ?? []).length === 2);
        expect(conDos.length).toBeGreaterThan(0);
        for (const l of conDos) {
            expect(l.slice(0, 27)).toMatch(/ {2}$/);          // dos espacios libres
            expect(l[27]).not.toBe(' ');                      // y ahi arranca la segunda
        }
    });
});

describe('la etiqueta de una bolsa', () => {
    it('sin salidas dice el efectivo y no imprime tabla ni vales', () => {
        const t = etiqueta();
        expect(t.items).toBeUndefined();
        expect(t.totales).toEqual([['EFECTIVO', '$716.92', true]]);
        expect(cuerpo(t)).not.toContain('VALES');
    });

    it('descuenta las salidas y cierra con el efectivo, DEBAJO de los vales', () => {
        // 716.92 − 200 − 150. Es la cifra que administracion cuenta con las
        // manos, y por eso es la destacada y la ultima: la etiqueta se lee como
        // una resta, y el numero que cierra la cuenta es el que se busca
        // (pedido del usuario, 2026-08-17).
        expect(etiqueta({ salidas }).totales).toEqual([
            ['VALES (2)', '$350.00'],
            ['EFECTIVO', '$366.92', true],
        ]);
    });

    it('una bolsa sin un billete adentro cuadra: 0 en efectivo y todo en vales', () => {
        // El caso que preguntó el usuario. La bolsa viaja igual — lo que queda
        // adentro son boletas del banco, que valen lo mismo que los billetes.
        const vacia = etiqueta({
            salidas: [{ fecha: '2026-08-15', hora: '11:02', motivo: 'Remesa', monto: -716.92 }],
        });
        expect(vacia.totales).toEqual([
            ['VALES (1)', '$716.92'],
            ['EFECTIVO', '$0.00', true],
        ]);
    });

    it('avisa que anula a la anterior solo cuando no es la primera', () => {
        // El numero de etiqueta y la hora en que se imprimio van en el MISMO
        // renglon: son un solo dato —cual de las dos manda— y en dos gastaban
        // papel.
        expect(pie(etiqueta({ version: 1 }))).toContain('ETIQUETA #1 - 14/08/26 07:12 pm');
        expect(pie(etiqueta({ version: 3 })))
            .toContain('ETIQUETA #3 - ANULA LA ANTERIOR - 14/08/26 07:12 pm');
    });

    it('sin salidas no repite el monto: el total de abajo dice lo mismo', () => {
        // `Guardado al cerrar` y `EFECTIVO` son el mismo numero cuando no salio
        // nada de la bolsa.
        expect(cuerpo(etiqueta())).not.toContain('Guardado al cerrar');
        expect(cuerpo(etiqueta({ salidas }))).toContain('Guardado al cerrar: $716.92');
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

    it('el rotulo de a quien se le entrego lo dice el TIPO, no este archivo', () => {
        // El papel decia «Banco» sobre una remesadora. El rotulo viaja desde
        // `bolsas_tipos_salida` —el mismo que rotula el campo del formulario—,
        // asi que los dos cambian juntos y no se puede desincronizar uno.
        expect(cuerpo(vale())).toContain('Remesadora: MONEYGRAM');
        expect(cuerpo(vale({
            operacion: {
                folio: 'P-260815-7', motivo: 'Pago a proveedor', monto: 200,
                entidad: 'DROGUERIA SANTA MARIA', entidadEtiqueta: 'Proveedor',
            },
        }))).toContain('Proveedor: DROGUERIA SANTA MARIA');
        // Y sin entidad no gasta un renglon en un rotulo vacio.
        expect(cuerpo(vale({
            operacion: { folio: 'A-1', motivo: 'Anticipo a un empleado', monto: 200 },
        }))).not.toContain('Entidad');
    });
});

describe('la hora que va en la etiqueta', () => {
    it('es la de la sala, no la del sello UTC', async () => {
        // El defecto real: cortando el ISO a mano (`slice(11,16)`) el vale decía
        // «04:23 p. m.» y la etiqueta de la MISMA bolsa listaba esa salida a las
        // «22:23». Dos papeles de la misma operación con seis horas de
        // diferencia, y el que miente es el que va pegado afuera.
        const { enHoraDeLaSala } = await import('../../src/utils/bolsaComprobante');
        expect(enHoraDeLaSala('2026-08-15T22:23:00.000Z'))
            .toEqual({ fecha: '2026-08-15', hora: '16:23' });
        // Y cruza el día correctamente: 03:00 UTC es todavía el día anterior en
        // El Salvador.
        expect(enHoraDeLaSala('2026-08-16T03:00:00.000Z'))
            .toEqual({ fecha: '2026-08-15', hora: '21:00' });
    });

    it('deja fuera los vales anulados: ya no están adentro', async () => {
        const { salidasParaEtiqueta } = await import('../../src/utils/bolsaComprobante');
        const filas = [
            { registrado_at: '2026-08-15T22:23:00.000Z', monto: -500, etiqueta: 'Remesa' },
            { registrado_at: '2026-08-15T23:00:00.000Z', monto: -100, etiqueta: 'Gasto', anulado_at: '2026-08-16T00:00:00.000Z' },
            { registrado_at: '2026-08-15T23:30:00.000Z', monto: 100, etiqueta: 'Reintegro' },
        ];
        const out = salidasParaEtiqueta(filas);
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({ fecha: '2026-08-15', hora: '16:23', motivo: 'Remesa', monto: -500 });
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
