import { describe, it, expect } from 'vitest';
import {
    construirEtiquetaDeBolsa, construirValeDeSalida,
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

// Una linea del vale: de que bolsa salio cuanto, y con cuanto quedo.
const linea = (extra = {}) => ({
    movimiento_id: 1, vale_folio: 'V-S3-260815-1',
    bolsa_folio: bolsa.folio, bolsa_fecha: bolsa.fecha, bolsa_hora: bolsa.hora,
    monto: -200, saldo_despues: 516.92, ...extra,
});

const vale = (extra = {}) => construirValeDeSalida({
    operacion: {
        folio: 'REM-1003', motivo: 'Remesa entregada a un cliente',
        entidad: 'MONEYGRAM', entidadEtiqueta: 'Remesadora',
        numero_boleta: '4477201', monto: 200,
    },
    lineas: [linea()],
    sala: 'Salud 3', registradoPor: 'Ana Peña Núñez',
    registradoAt: '2026-08-15T02:15:00.000Z', ...extra,
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

// El vale de una salida que tomo cuatro bolsas. Va a las reglas del rollo
// porque es el que mas apura la geometria: cuatro renglones de tabla con folio,
// fecha, hora y dos importes en 54 columnas.
const valeDeCuatro = () => vale({
    operacion: {
        folio: 'CMB-1032', motivo: 'Cambio por monedas', monto: 2000,
        leyenda: 'El dinero queda en sala de ventas.', nota: 'REMESA DE SILVIA',
    },
    lineas: [
        linea({ movimiento_id: 33, bolsa_folio: 'LP-1144', bolsa_fecha: '2026-08-26', bolsa_hora: '13:06', monto: -370, saldo_despues: 3.85 }),
        linea({ movimiento_id: 34, bolsa_folio: 'LP-1147', bolsa_fecha: '2026-08-26', bolsa_hora: '16:01', monto: -560, saldo_despues: 3.07 }),
        linea({ movimiento_id: 35, bolsa_folio: 'LP-1149', bolsa_fecha: '2026-08-26', bolsa_hora: '19:01', monto: -210, saldo_despues: 1.91 }),
        linea({ movimiento_id: 36, bolsa_folio: 'LP-1159', bolsa_fecha: '2026-08-27', bolsa_hora: '14:22', monto: -860, saldo_despues: 81.40 }),
    ],
    recibidoPor: { nombre: 'Andy Mancia', metodo: 'CARNE' },
});

// El unico cheque del mes, tal como esta en produccion: Salud 1, 27-ago,
// $352.50 de una iglesia con nombre de cuarenta y ocho caracteres. Es el caso
// que apura la geometria del bloque — el nombre mas largo que se ha cobrado.
const cheques = [{
    hora: '15:09:29', total: 352.50,
    cliente: 'IGLESIA TABERNACULO BIBLICO BAUTISTA CHALATENANGO',
    documento: '0000083532_COF',
}];

describe.each([
    ['la etiqueta de la bolsa', etiqueta],
    ['la etiqueta con salidas', () => etiqueta({ salidas })],
    ['la etiqueta con un cheque', () => etiqueta({ cheques })],
    ['la etiqueta con salidas y cheque', () => etiqueta({ salidas, cheques })],
    ['el vale de salida', vale],
    ['el vale de cuatro bolsas', valeDeCuatro],
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
            ['EFECTIVO INICIAL', '$716.92'],
            ['VALES (2)', '-$350.00'],
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
            ['EFECTIVO INICIAL', '$716.92'],
            ['VALES (1)', '-$716.92'],
            ['EFECTIVO', '$0.00', true],
        ]);
    });

    // ── El cheque, que no es un billete ─────────────────────────────────────
    // Reportado por el usuario el 2026-08-29: «no avisa cuando hay 1 cheque».
    // El papel decia «EFECTIVO $565.21» sobre una bolsa que ademas llevaba uno
    // de $352.50, y quien la cuenta cuenta billetes.

    it('sin cheques no gasta un renglon en el aviso', () => {
        const t = etiqueta();
        expect(t.bloques).toBeUndefined();
        expect(cuerpo(t)).not.toContain('CHEQUE');
    });

    it('nombra el cheque que va adentro, con su hora, su cliente y su monto', () => {
        const t = etiqueta({ cheques });
        const texto = cuerpo(t);
        expect(texto).toContain('Cheques:');
        expect(texto).toContain('15:09');
        expect(texto).toContain('IGLESIA TABERNACULO');
        expect(texto).toContain('$352.50');
    });

    it('NO lo suma al efectivo: el numero que se cuenta sigue siendo el de los billetes', () => {
        // La trampa entera esta aca. Si el cheque entrara en la resta, la
        // etiqueta pediria contar $1,069.42 en una bolsa que tiene $716.92 en
        // billetes y un papel — o sea, un faltante inventado de $352.50.
        const t = etiqueta({ cheques });
        expect(t.totales).toEqual([['EFECTIVO', '$716.92', true]]);
    });

    it('el aviso va ARRIBA del efectivo, no despues', () => {
        // Se lee de arriba abajo y el ultimo numero es el que se compara: un
        // aviso posterior llega cuando ya se conto.
        const texto = cuerpo(etiqueta({ cheques }));
        expect(texto.indexOf('CHEQUE')).toBeLessThan(texto.indexOf('EFECTIVO'));
    });

    it('es un rotulo y no un aviso: ni advierte ni explica en prosa', () => {
        // Salió como «OJO: TAMBIEN VA UN CHEQUE» más un renglón que explicaba
        // que no entraba en el efectivo, y el usuario sacó las dos cosas: la
        // etiqueta es una lista de lo que hay adentro. En un rollo de veinte
        // renglones, la prosa que repite lo que la maqueta ya dice son dos
        // gastados en nada.
        const texto = cuerpo(etiqueta({ cheques }));
        expect(texto).not.toContain('OJO');
        expect(texto).not.toContain('No entra');
    });

    it('el mismo rotulo sirve para uno y para dos: no hay plural que conjugar', () => {
        const dos = [...cheques, { hora: '18:40:00', cliente: 'ALCALDIA', total: 40 }];
        const texto = cuerpo(etiqueta({ cheques: dos }));
        expect(texto).toContain('Cheques:');
        expect(texto).toContain('18:40 ALCALDIA');
        expect(texto).toContain('$40.00');
    });

    it('avisa que anula a la anterior solo cuando no es la primera', () => {
        // El numero de etiqueta y la hora en que se imprimio van en el MISMO
        // renglon: son un solo dato —cual de las dos manda— y en dos gastaban
        // papel.
        expect(pie(etiqueta({ version: 1 }))).toContain('ETIQUETA #1 - 14/08/26 07:12 pm');
        expect(pie(etiqueta({ version: 3 })))
            .toContain('ETIQUETA #3 - ANULA LA ANTERIOR - 14/08/26 07:12 pm');
    });

    it('el monto de partida sale en la resta, no entre los datos de arriba', () => {
        // Vivia arriba como `Guardado al cerrar`, en letra chica entre las
        // fichas: al reimprimir una etiqueta despues de agregar un vale, el
        // papel decia lo que se resto y lo que queda, pero de cuanto se partio
        // no se leia (pedido del usuario, 2026-08-18).
        const conVales = cuerpo(etiqueta({ salidas }));
        expect(conVales).not.toContain('Guardado al cerrar');
        expect(conVales).toContain('EFECTIVO INICIAL');
        // Sin salidas no hay resta que mostrar: un solo total, sin repetirlo.
        expect(cuerpo(etiqueta())).not.toContain('EFECTIVO INICIAL');
        expect(cuerpo(etiqueta())).not.toContain('Guardado al cerrar');
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

describe('el vale de una salida', () => {
    it('dice cuanto sale y cuanto queda — el papel a mano solo decia lo primero', () => {
        expect(vale().totales).toEqual([['SALE DE LA BOLSA', '$200.00', true]]);
        // Lo que queda ya no es un total: es la ultima columna de la tabla, que
        // es el unico lugar donde entra bolsa por bolsa.
        expect(vale().items.filas).toEqual([['S3-260814-2 14/08', '19:01', '200.00', '516.92']]);
    });

    it('nombra sus bolsas con el corte: el folio solo no las distingue sobre la mesa', () => {
        expect(cuerpo(vale())).toContain('S3-260814-2 14/08');
        expect(cuerpo(vale())).toContain('19:01');
    });

    it('no dice donde se guarda ni pide firma', () => {
        // Hasta el 2026-08-28 el pie decia «Este vale queda dentro de la bolsa
        // X» y llevaba una raya para firmar. Las dos se fueron: el vale se
        // archiva —no hace falta que el papel lo repita— y quien retira ya esta
        // nombrado por el servidor, que es mas fuerte que una firma a mano.
        const t = vale({ recibidoPor: { nombre: 'Andy Mancia', metodo: 'CARNE' } });
        expect(pie(t)).not.toContain('dentro de la bolsa');
        expect(pie(t)).not.toContain('Firma');
        expect(pie(t)).toContain('Recibe: Andy Mancia (carne escaneado)');
    });

    it('en una remesa no se nombra a nadie: la recibe el cliente', () => {
        const t = vale();
        expect(pie(t)).not.toContain('Recibe:');
        expect(cuerpo(t)).toContain('No. de boleta: 4477201');
    });

    it('en otra causa nombra a quien retira, y dice como se comprobo que era el', () => {
        const t = vale({ recibidoPor: { nombre: 'MARÍA JOSÉ PEÑA', metodo: 'CLAVE' } });
        expect(pie(t)).toContain('Recibe: MARIA JOSE PENA');
        expect(pie(t)).toContain('(usuario y contrasena)');
    });

    it('una salida de cuatro bolsas es UN papel con cuatro renglones', () => {
        // El caso real que lo motivo: CMB-1032, $2,000 de La Popular. Antes
        // salian cuatro vales casi iguales y parecian cuatro salidas.
        const t = vale({
            operacion: {
                folio: 'CMB-1032', motivo: 'Cambio por monedas', monto: 2000,
                leyenda: 'El dinero queda en sala de ventas.',
            },
            lineas: [
                linea({ movimiento_id: 33, bolsa_folio: 'LP-1144', bolsa_fecha: '2026-08-26', bolsa_hora: '13:06', monto: -370, saldo_despues: 3.85 }),
                linea({ movimiento_id: 34, bolsa_folio: 'LP-1147', bolsa_fecha: '2026-08-26', bolsa_hora: '16:01', monto: -560, saldo_despues: 3.07 }),
                linea({ movimiento_id: 35, bolsa_folio: 'LP-1149', bolsa_fecha: '2026-08-26', bolsa_hora: '19:01', monto: -210, saldo_despues: 1.91 }),
                linea({ movimiento_id: 36, bolsa_folio: 'LP-1159', bolsa_fecha: '2026-08-27', bolsa_hora: '14:22', monto: -860, saldo_despues: 81.40 }),
            ],
        });
        expect(t.items.filas).toHaveLength(4);
        expect(t.items.filas.map((f) => [f[0], f[2], f[3]])).toEqual([
            ['LP-1144 26/08', '370.00', '3.85'],
            ['LP-1147 26/08', '560.00', '3.07'],
            ['LP-1149 26/08', '210.00', '1.91'],
            ['LP-1159 27/08', '860.00', '81.40'],
        ]);
        // El destacado es el total de la operacion, y dice de cuantas bolsas
        // salio: un solo numero sin eso se lee como el saldo de una bolsa.
        expect(t.totales).toEqual([['SALE DE 4 BOLSAS', '$2,000.00', true]]);
        // Y sigue siendo UN papel: un solo folio arriba, el de la operacion.
        expect(cuerpo(t)).toContain('Vale: CMB-1032');
    });

    it('una linea anulada no entra ni al detalle ni a la cuenta de bolsas', () => {
        const t = vale({
            operacion: { folio: 'PAG-1004', motivo: 'Pago a proveedor', monto: 200 },
            lineas: [
                linea(),
                linea({ movimiento_id: 2, bolsa_folio: 'S3-1099', monto: -300, anulado_at: '2026-08-16T10:00:00Z' }),
            ],
        });
        expect(t.items.filas).toHaveLength(1);
        expect(cuerpo(t)).not.toContain('S3-1099');
        expect(t.totales[0][0]).toBe('SALE DE LA BOLSA');
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

    it('la leyenda del motivo se imprime: sin ella el papel dice otra cosa', () => {
        // Un vale de $2,000 por cambio de monedas se lee, sobre la mesa de
        // administracion, como dinero que salio de la empresa. La leyenda es lo
        // unico que dice que no. Sale del catalogo, igual que el rotulo de
        // arriba: un motivo nuevo la declara ahi y este archivo no se toca.
        const cambio = vale({
            operacion: {
                folio: 'CMB-260828-1', motivo: 'Cambio por monedas', monto: 2000,
                leyenda: 'El dinero queda en sala de ventas.',
            },
        });
        expect(cuerpo(cambio)).toContain('El dinero queda en sala de ventas.');
        // Y sin leyenda no aparece el rotulo vacio, como con la entidad.
        expect(cuerpo(vale())).not.toContain('NOTA');
    });

    it('la leyenda va ANTES del detalle escrito a mano', () => {
        // Una dice QUE ES esta salida y la otra cuenta el caso. Al reves, el
        // detalle de quien registro tapa la unica linea que explica el papel.
        const texto = cuerpo(vale({
            operacion: {
                folio: 'CMB-260828-2', motivo: 'Cambio por monedas', monto: 500,
                leyenda: 'El dinero queda en sala de ventas.',
                nota: 'Para las cajas del fin de semana',
            },
        }));
        expect(texto.indexOf('El dinero queda en sala de ventas.'))
            .toBeLessThan(texto.indexOf('Para las cajas del fin de semana'));
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
