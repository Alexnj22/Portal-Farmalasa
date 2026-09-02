import { describe, it, expect } from 'vitest';
import { conceptoDelPapel } from '../../src/utils/conceptoDelPapel';

// ═══════════════════════════════════════════════════════════════════════════
// Qué operación fue, dicho por el papel.
//
// Es la frase que llena sola el concepto en los DOS lados del POS Promerica —la
// entrada (`MiCajaView`) y la salida (`SalidaDeBolsa`)— desde el 2026-09-02.
// Lo que estas pruebas anclan es la trampa que costó una remesa trabada el
// 2026-08-21 y que acá vuelve por la puerta de atrás: la boleta de una remesa
// la imprime el POS y ARRIBA lleva el banco que procesa el cobro, no la red que
// entrega el dinero.
// ═══════════════════════════════════════════════════════════════════════════

describe('conceptoDelPapel', () => {
    it('la remesa se nombra con la RED, nunca con el banco de la cabecera', () => {
        expect(conceptoDelPapel({
            tipo_operacion: 'REMESA',
            entidad: 'BANCO PROMERICA',
            red_remesas: 'MONEY GRAM WS',
        })).toBe('Remesa MONEY GRAM WS');
    });

    it('sin red impresa dice «Remesa» a secas: no toma el banco del POS', () => {
        expect(conceptoDelPapel({
            tipo_operacion: 'REMESA', entidad: 'BANCO PROMERICA', red_remesas: null,
        })).toBe('Remesa');
    });

    /* ── Las dos boletas de referencia que dio el usuario (2026-09-02) ──────
     * Son del mismo POS, del mismo día, y muestran por qué el enum no alcanza:
     * las dos caen en un solo valor cada una y el papel distingue más. */

    // «RETIRO TOKEN / PAGO CTK / EN EFECTIVO» — boleta 001103, $125.00, Salud 3.
    // El usuario: «esa dice retiro Token, esa es su opción».
    it('el retiro se nombra COMO LO DICE EL PAPEL, no con un genérico', () => {
        expect(conceptoDelPapel({
            tipo_operacion: 'RETIRO',
            operacion_impresa: 'RETIRO TOKEN',
            entidad: 'Banco Promerica',
            nombres: ['Banco Promerica', 'AB FARMACIA LA SALUD 3'],
            red_remesas: null,
        })).toBe('Retiro Token');
    });

    // «REMESA / MONEY GRAM WS / EN EFECTIVO» — boleta 018504, $300.00, Salud 4.
    // La línea impresa dice «REMESA» a secas: lo que distingue es la red.
    it('la remesa gana con la red aunque el papel traiga su propia línea', () => {
        expect(conceptoDelPapel({
            tipo_operacion: 'REMESA',
            operacion_impresa: 'REMESA',
            red_remesas: 'MONEY GRAM WS',
            entidad: 'Banco Promerica',
        })).toBe('Remesa MONEY GRAM WS');
    });

    // Sin línea impresa —las boletas viejas, leídas antes de que el lector la
    // devolviera— el retiro sigue teniendo un nombre que se entiende.
    it('sin línea impresa el retiro cae a un nombre generico', () => {
        expect(conceptoDelPapel({
            tipo_operacion: 'RETIRO', entidad: 'AB FARMACIA LA SALUD 3',
        })).toBe('Retiro de efectivo');
    });

    // La capitalización NO rompe lo que ya venía escrito: el papel grita en
    // mayúsculas, pero «MoneyGram» trae su forma y volverlo «Moneygram» sería
    // romperlo para «arreglarlo». Y «WS» o «CTK» son siglas, no palabras.
    it('capitaliza la línea impresa y deja en paz a la entidad', () => {
        // La sigla sin vocales se queda: «Ws» y «Ctk» no son el nombre de nada.
        expect(conceptoDelPapel({ tipo_operacion: 'RETIRO', operacion_impresa: 'RETIRO TOKEN PAGO CTK' }))
            .toBe('Retiro Token Pago CTK');
        // Y la entidad NO se toca: capitalizarla rompe los nombres que son
        // siglas con vocales, que es como se llaman casi todos los servicios.
        expect(conceptoDelPapel({ tipo_operacion: 'PAGO_SERVICIO', servicio: 'CAESS' }))
            .toBe('Pago de CAESS');
        expect(conceptoDelPapel({ tipo_operacion: 'REMESA', red_remesas: 'MoneyGram' }))
            .toBe('Remesa MoneyGram');
    });

    /* ── El pago de un recibo: quién COBRA no es quién PROCESA ─────────────
     * Medido en producción el 2026-09-02: siete entradas del día decían «Pago
     * de Banco Promerica», «Depósito Banco Promerica» y «Compra en Banco
     * Promerica» sobre recibos de luz, agua y teléfono. El nombre estaba
     * impreso en el papel — sólo que era el del POS de la farmacia. */
    it('el pago de un servicio nombra a la empresa del recibo', () => {
        expect(conceptoDelPapel({
            tipo_operacion: 'PAGO_SERVICIO',
            servicio: 'CAESS',
            entidad: 'Banco Promerica',
            nombres: ['Banco Promerica', 'AB FARMACIA LA SALUD 3', 'CAESS'],
        })).toBe('Pago de CAESS');
    });

    it('sin la empresa del detalle NO cae a la cabecera: dice menos', () => {
        expect(conceptoDelPapel({
            tipo_operacion: 'PAGO_SERVICIO', servicio: null, entidad: 'Banco Promerica',
        })).toBe('Pago de servicio');
        expect(conceptoDelPapel({
            tipo_operacion: 'DEPOSITO', servicio: null, entidad: 'Banco Promerica',
        })).toBe('Depósito');
    });

    // La excepción: en el tiquete de una tienda la cabecera ES el comercio.
    it('la compra sí se nombra con la cabecera, que ahí es el comercio', () => {
        expect(conceptoDelPapel({
            tipo_operacion: 'COMPRA', entidad: 'FERRETERIA DON GENARO',
        })).toBe('Compra en FERRETERIA DON GENARO');
    });

    it('sin operación legible queda el nombre impreso, y sin nada, vacío', () => {
        expect(conceptoDelPapel({ entidad: 'FERRETERIA DON GENARO' }))
            .toBe('FERRETERIA DON GENARO');
        expect(conceptoDelPapel({ tipo_operacion: 'OTRO' })).toBe('');
        expect(conceptoDelPapel(null)).toBe('');
    });
});

/* ── QUÉ servicio y DE QUIÉN ────────────────────────────────────────────────
 *
 * Pedido del usuario (2026-09-02) sobre la boleta de Claro de Salud 4: «por qué
 * no se agrega el concepto, pago de telefonía, compañía Claro, tipo línea móvil,
 * teléfono el que sale ahí, así cualquier cosa podemos buscar».
 *
 * La última palabra es la razón: «Pago de CLARO» es lo mismo veinte veces al
 * mes, y el teléfono es lo único que distingue ESE pago. El nombre del cliente
 * no sirve —el papel lo imprime cortado, «YANIRA NOEMI AGUILAR QU»— y el monto
 * se repite todos los meses. */
describe('lo que hace buscable un pago de servicio', () => {
    const CLARO = {
        tipo_operacion: 'PAGO_SERVICIO',
        operacion_impresa: 'PAGO DE TELEFONIA',
        servicio: 'CLARO',
        detalle_servicio: 'LINEA MOVIL',
        referencia_servicio: '77463090',
    };

    it('la boleta real de Salud 4: empresa, servicio y teléfono', () => {
        expect(conceptoDelPapel(CLARO)).toBe('Pago de CLARO · LINEA MOVIL · 77463090');
    });

    it('cabe en el campo del sistema de la caja', () => {
        // 50 caracteres, medidos sobre 2,418 movimientos del origen. Si el
        // concepto no cupiera, el recorte se comería justo el número.
        expect(conceptoDelPapel(CLARO).length).toBeLessThanOrEqual(50);
    });

    it('cada pieza sólo si el papel la trajo', () => {
        expect(conceptoDelPapel({ ...CLARO, detalle_servicio: null }))
            .toBe('Pago de CLARO · 77463090');
        expect(conceptoDelPapel({ ...CLARO, referencia_servicio: null }))
            .toBe('Pago de CLARO · LINEA MOVIL');
        expect(conceptoDelPapel({ ...CLARO, detalle_servicio: null, referencia_servicio: null }))
            .toBe('Pago de CLARO');
    });

    it('un depósito también dice de quién', () => {
        expect(conceptoDelPapel({
            tipo_operacion: 'DEPOSITO', servicio: 'ANDA',
            detalle_servicio: null, referencia_servicio: '4410225',
        })).toBe('Depósito ANDA · 4410225');
    });

    it('una remesa NO los lleva: su referencia es la boleta, no una cuenta', () => {
        expect(conceptoDelPapel({
            tipo_operacion: 'REMESA', red_remesas: 'MONEY GRAM WS',
            detalle_servicio: 'X', referencia_servicio: '99999999',
        })).toBe('Remesa MONEY GRAM WS');
    });
});
