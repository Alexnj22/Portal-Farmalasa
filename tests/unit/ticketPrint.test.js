import { describe, it, expect } from 'vitest';
import { seccionesParaElPrograma, COLUMNAS_TICKET, textoParaElRollo, ticketEnBase64 }
    from '../../src/utils/ticketPrint';

// El ancla de estos tests es un ticket REAL del sistema de facturación —factura
// 351275, capturada el 2026-08-13— del que se contaron las columnas:
//
//   '         DESCRIPCION           CANT.    P.U   SUBTOTAL'   (54)
//   'FLUCONAZOL 150MG X 2 CAPS. MK   2.00    8.05   16.10  '   (54)
//
// La cantidad cierra en la columna 36, el precio en 44 y el importe en 52. Eso es
// lo que tiene que reproducir el envío directo, porque el programa que imprime no
// acomoda nada: saca los caracteres tal cual. Si alguien cambia la geometría "para
// que se vea mejor", el ticket sale desalineado en la sala y nadie lo ve desde acá.
const REAL = 'FLUCONAZOL 150MG X 2 CAPS. MK   2.00    8.05   16.10  ';

const ticket = () => ({
    ancho: 80,
    encabezado: { titulo: 'FARMACIA LA SALUD 1', lineas: ['Barrio San Antonio', 'Tel. 2301-0013'] },
    titulo: 'Prueba',
    datos: [['Fecha', '13/08/2026 20:03']],
    items: {
        columnas: [
            { label: 'DESCRIPCION' }, { label: 'CANT.' }, { label: 'P.U' }, { label: 'SUBTOTAL' },
        ],
        filas: [
            ['FLUCONAZOL 150MG X 2 CAPS. MK CAJA', '2.00', '8.05', '16.10'],
            ['IBUPROFENO 400MG', '1.00', '1.25', '1.25'],
        ],
    },
    totales: [['TOTAL', '$ 16.10', true]],
    pie: ['GRACIAS POR SU COMPRA'],
});

const renglones = (t) => seccionesParaElPrograma(t).cuerpo.split('\n');
// Los códigos ocupan CERO columnas de papel: hay que sacarlos ENTEROS antes de
// contar. `ESC a n` mide tres bytes, y un `\x1b.` dejaba el tercero adentro —una
// columna que no existe—. Desde que cada código viaja pegado al renglón que
// manda (para no gastar un renglón en blanco por cada uno), ese byte de más era
// la diferencia entre 54 y «55, no cabe».
// eslint-disable-next-line no-control-regex
const sinCodigos = (s) => s.replace(/\x1b(?:[!aRt].|@)/g, '');

describe('el ticket que se manda al programa de impresión', () => {
    it('pone cantidad, precio e importe en las columnas del ticket real', () => {
        const linea = renglones(ticket()).find(l => l.includes('FLUCONAZOL'));
        expect(linea.indexOf('2.00') + '2.00'.length).toBe(36);
        expect(linea.indexOf('8.05') + '8.05'.length).toBe(44);
        expect(linea.indexOf('16.10') + '16.10'.length).toBe(52);
        // La misma línea del origen, columna por columna.
        expect(linea.slice(29, 52)).toBe(REAL.slice(29, 52));
    });

    it('parte el nombre largo en el renglón siguiente en vez de recortarlo', () => {
        const ls = renglones(ticket());
        const i = ls.findIndex(l => l.includes('FLUCONAZOL'));
        // 'CAJA' no entra en 31 caracteres junto al resto del nombre: baja.
        expect(ls[i]).toContain('FLUCONAZOL 150MG X 2 CAPS. MK');
        expect(ls[i]).not.toContain('CAJA');
        expect(ls[i + 1]).toBe('CAJA');
    });

    it('no pasa de 54 columnas en ninguna línea de datos', () => {
        for (const l of renglones(ticket())) {
            expect(sinCodigos(l).length).toBeLessThanOrEqual(COLUMNAS_TICKET.chica);
        }
    });

    it('manda exactamente las claves que espera el programa', () => {
        expect(Object.keys(seccionesParaElPrograma(ticket())).sort()).toEqual([
            'cuerpo', 'encabezado', 'img', 'pie', 'qr', 'qr_farmalasa', 'total_letras', 'totales',
        ]);
    });

    it('centra y agranda el nombre de la farmacia, y deja el pie con margen de corte', () => {
        const s = seccionesParaElPrograma(ticket());
        expect(s.encabezado.startsWith('\x1bR\f\x1ba\x01\x1b!\x10')).toBe(true);
        expect(s.encabezado).toContain('FARMACIA LA SALUD 1');
        // Los saltos del final son lo que salva la última línea de la cuchilla,
        // que queda CENTÍMETROS arriba del punto donde deja de salir papel. Se
        // cuentan, no se buscan con `endsWith`: con cinco —lo que había hasta el
        // 2026-08-17— el corte se llevaba el final del ticket en la sala, y un
        // `endsWith('\n\n\n\n\n')` da verde igual con cinco que con seis.
        // Son SEIS y no doce desde el 2026-08-18: con el corte viajando en el
        // ticket, el margen dejó de ser colchón y es el blanco que se ve abajo
        // — el usuario lo midió con el rollo en la mano y sobraba la mitad.
        // El pie NO lleva orden de cortar, y es a propósito: **estas secciones
        // son las del camino directo**, y ahí el programa de la caja ya manda
        // `GS V '1'` por su cuenta despues del pie (leído en
        // `printik_pista.php`). Los bytes del portal se SUMAN a los suyos, así
        // que un corte acá corta dos veces — y el intento de v2.661.5 ademas
        // colgaba la impresora. El corte del camino de la cola se afirma abajo,
        // sobre `textoParaElRollo`: son dos caminos distintos y por eso son dos
        // pruebas distintas.
        expect(s.pie).not.toContain('\x1d\x56');
        expect(s.pie.match(/\n+$/)[0].length).toBe(6);
    });

    it('el total destacado sale en negrita y doble alto, y vuelve a letra normal', () => {
        // El HTML lo pinta desde el primer dia (clase `grande`) y el rollo lo
        // ignoraba: los totales salian los tres iguales, asi que la cifra que
        // alguien cuenta con las manos no se distinguia de las que la explican
        // (reporte del usuario, 2026-08-18, con el papel en la mano).
        const t = ticket();
        t.totales = [['VALES (2)', '-$350.50'], ['EFECTIVO', '$1,328.85', true]];
        const s = seccionesParaElPrograma(t);

        // `ESC ! 0x18` = negrita (0x08) + doble alto (0x10) en UN codigo, el
        // mismo comando con el que este ticket ya cambia de letra. Doble ANCHO
        // no: partiria el renglon, que se rellena contando 40 columnas.
        expect(s.cuerpo).toContain('\x1b!\x18EFECTIVO');
        expect(s.cuerpo).not.toContain('\x1b!\x18VALES');
        expect(s.cuerpo).not.toContain('\x1b!\x20');

        // Y se apaga en el MISMO renglon: un codigo suelto se lleva un renglon
        // entero de rollo, y lo que sigue no tiene por que salir agrandado.
        const linea = s.cuerpo.split('\n').find((l) => l.includes('EFECTIVO'));
        expect(linea.endsWith('\x1b!\x00')).toBe(true);
        // El renglon destacado sigue midiendo 40 columnas: el doble alto no
        // cambia el ancho, y por eso el relleno de `dosColumnas` sigue valiendo.
        // eslint-disable-next-line no-control-regex
        expect(linea.replace(/\x1b(?:[!aRt].|@)/g, '')).toHaveLength(40);
    });

    // Los dos que siguen salieron del PRIMER ticket impreso desde el portal
    // (Salud 3, 2026-08-14). Los dos defectos son invisibles en pantalla: la
    // vista previa en HTML acentúa bien y parte por palabras, y el que no hace
    // ninguna de las dos cosas es el rollo.
    it('transcribe a ASCII: el rollo imprimió NUÑEZ como NU?EZ', () => {
        const t = ticket();
        t.encabezado.titulo = 'FARMACIAS LA POPULAR Y LA SALUD';
        t.datos = [['Hecha por', 'Edwin Núñez'], ['NIT', '0401-210685-101-0  ·  NRC 213237-5']];
        t.pie = ['Impresión de prueba · no es un comprobante'];
        const s = seccionesParaElPrograma(t);
        const todo = s.encabezado + s.cuerpo + s.pie;

        expect(todo).toContain('Edwin Nunez');
        expect(todo).toContain('Impresion de prueba - no es un comprobante');
        // Ni un byte fuera de ASCII: es lo único que el aparato garantiza leer.
        expect(/[^\x00-\x7E]/.test(todo)).toBe(false);
    });

    it('parte la prosa en palabras: el rollo cortó «DE EST / A IMPRESORA»', () => {
        const t = ticket();
        t.bloques = [{
            texto: 'El renglón más largo que NO se parta en dos es el ancho de esta impresora.',
        }];
        const ls = renglones(t).map(sinCodigos);

        for (const l of ls) expect(l.length).toBeLessThanOrEqual(COLUMNAS_TICKET.chica);
        // La palabra sobrevive entera en algún renglón; no queda «EST» + «A».
        expect(ls.some(l => l.includes('impresora.'))).toBe(true);
    });

    it('no se rompe con una tabla que no tiene las cuatro columnas del ticket', () => {
        const t = ticket();
        t.items = { columnas: [{ label: 'Concepto' }, { label: 'Monto' }], filas: [['Efectivo', '$ 20.00']] };
        const linea = renglones(t).find(l => l.includes('Efectivo'));
        expect(sinCodigos(linea).length).toBe(COLUMNAS_TICKET.chica);
        expect(linea.endsWith('$ 20.00')).toBe(true);
    });
    // ── La cola de la sala lleva BYTES ──────────────────────────────────────
    //
    // Estas dos pruebas existen por un bug que no se veía en pantalla ni en el
    // papel: la cola guardaba el ticket como `text`, y como TODO ticket lleva
    // un NUL (`ESC ! \x00` es la letra normal), Postgres rechazaba cada
    // documento con 400. El portal caía al diálogo del navegador, así que el
    // papel salía en la computadora de quien apretaba el botón en vez de en la
    // caja de la sala. La primera prueba fija el hecho que lo causa; la
    // segunda, que el viaje no lo pierda.

    it('el ticket de la cola cierra con el corte, y despues del margen', () => {
        // Por acá NADIE mas manda el corte: el agente entrega los bytes con
        // `lp -o raw`, sin driver que agregue nada, y su `CORTAR` viene
        // apagado. Sin esto el papel sale entero y hay que arrancarlo a mano —
        // que es lo que el usuario reportó el 2026-08-18 imprimiendo desde otra
        // computadora.
        const bytes = textoParaElRollo(ticket());

        expect(bytes.endsWith('\n'.repeat(6) + '\x1dV1')).toBe(true);
        // Tres bytes y ninguno en cero. `GS V 66 n` colgó la ticketera de una
        // sala (v2.661.5) y en el papel se veria igual de bien, asi que no
        // alcanza con comprobar que haya *alguna* orden de cortar.
        expect(bytes).not.toContain('\x1dV\x42');
        expect(bytes).not.toContain('\x1dV\x00');
    });

    it('todo ticket lleva un NUL adentro: por eso no puede viajar como texto', () => {
        expect(textoParaElRollo(ticket())).toContain('\x00');
    });

    it('el base64 devuelve los MISMOS bytes, NUL incluido', () => {
        const texto = textoParaElRollo(ticket());
        const vuelta = atob(ticketEnBase64(texto));

        expect(vuelta.length).toBe(texto.length);
        expect(vuelta).toBe(texto);
        // Y ni un byte por encima de 255: el rollo lee uno por carácter, así
        // que un UTF-8 de dos bytes volvería a imprimir letras ajenas.
        expect([...vuelta].every(c => c.charCodeAt(0) <= 0xFF)).toBe(true);
    });
});

// ── El código de barras del carné de papel ──────────────────────────────────
//
// Lo que estos tests pueden anclar es el CONTRATO de bytes: qué comando se
// manda y con qué parámetros. Lo que NO pueden es que la impresora lo entienda
// — eso sólo lo contesta el papel, y ya costó una sala: el test de `GS V 66 0`
// estaba en verde mientras colgaba la ticketera de Salud 4 (v2.661.5).
describe('ticketPrint · código de barras', () => {
    const conCodigo = (simbologia) => ({
        ...ticket(),
        codigos: [{ valor: 'ARY3AM5GFP', simbologia }],
    });

    it('CODE128 va con su byte de largo, contando el prefijo {B', () => {
        const bytes = textoParaElRollo(conCodigo('CODE128'));
        // GS k I <n> {B <datos> — n = 10 datos + 2 del prefijo = 12
        expect(bytes).toContain(`\x1dk\x49${String.fromCharCode(12)}{BARY3AM5GFP`);
    });

    it('CODE39 va sin largo y termina en NUL, que es un byte de EN MEDIO', () => {
        const bytes = textoParaElRollo(conCodigo('CODE39'));
        expect(bytes).toContain('\x1dk\x04ARY3AM5GFP\x00');
        // Y ese NUL no queda al final del ticket: el del final es el que se
        // pierde por el camino de HTTP + PHP (ver la constante CORTAR_PAPEL).
        expect(bytes.endsWith('\x00')).toBe(false);
    });

    it('el valor se limpia a mayúsculas y dígitos antes de entrar a las barras', () => {
        const bytes = textoParaElRollo({
            ...ticket(),
            codigos: [{ valor: ' ary3-am5 gfp ', simbologia: 'CODE39' }],
        });
        expect(bytes).toContain('\x1dk\x04ARY3AM5GFP\x00');
    });

    it('APAGA el valor legible: la credencial no se escribe nunca', () => {
        // Instrucción del usuario el 2026-08-20: «JAMÁS lo debes mostrar». Lo
        // que va adentro de esas barras abre el portal, y en claro basta una
        // foto. Se apaga con el comando explícito y no confiando en el valor por
        // defecto de la impresora: una que lo traiga encendido lo imprimiría sin
        // que nadie se entere hasta ver el papel.
        const bytes = textoParaElRollo(conCodigo('CODE128'));
        expect(bytes).toContain('\x1dH\x00');
        expect(bytes).not.toContain('\x1dH\x02');
    });

    it('el valor aparece UNA sola vez: dentro de las barras y en ningún otro lado', () => {
        // El ticket lo arma un objeto con datos, bloques y pie. Si alguna vez
        // alguien mete el código en un rótulo «para que se pueda teclear», este
        // test lo ve — y es exactamente lo que no debe pasar.
        const bytes = textoParaElRollo(conCodigo('CODE39'));
        expect(bytes.split('ARY3AM5GFP').length - 1).toBe(1);
    });

    it('un ticket sin códigos no manda ni un byte de barras', () => {
        expect(textoParaElRollo(ticket())).not.toContain('\x1dk');
    });
});
