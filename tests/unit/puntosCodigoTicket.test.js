import { describe, it, expect } from 'vitest';
import {
    urlConCodigo, codigoLegible, construirTicketDeCodigo,
} from '../../src/utils/puntosCodigoTicket';
import { textoParaElRollo } from '../../src/utils/ticketPrint';

/**
 * El papel del código de acceso, anclado contra el defecto que lo destapó.
 *
 * El 2026-09-03 se generó un código para una clienta con ficha `Consumidor`, se
 * escaneó el QR y la pantalla contestó «no encontramos una ficha con ese
 * documento y ese teléfono». No era un error del portal: `puntos_cliente_por_
 * documento` acepta el código SOLO cuando la ficha es extranjera —en las demás
 * exige además el teléfono— y el QR mandaba únicamente el código. O sea que
 * para casi todos los clientes el papel prometía algo que no podía cumplir.
 *
 * Estas pruebas fijan las dos mitades de la corrección: el QR DICE que hace
 * falta el teléfono, y el papel también lo dice en letras — porque el QR lo lee
 * la pantalla y las letras las lee la persona.
 */

const CODIGO = 'TCVMCR4';

describe('el QR del papel', () => {
    it('lleva el codigo adentro', () => {
        expect(urlConCodigo(CODIGO)).toContain(`?codigo=${CODIGO}`);
    });

    it('avisa que hace falta el telefono cuando la ficha no es extranjera', () => {
        expect(urlConCodigo(CODIGO, { pideTelefono: true })).toContain('&tel=1');
    });

    it('no lo avisa en una ficha extranjera, que entra con el codigo solo', () => {
        expect(urlConCodigo(CODIGO, { pideTelefono: false })).not.toContain('tel=1');
    });

    it('limpia guiones y espacios antes de armar la direccion', () => {
        expect(urlConCodigo('tcv-mcr 4')).toContain(`?codigo=${CODIGO}`);
    });

    it('sin codigo no inventa un parametro vacio', () => {
        expect(urlConCodigo('')).not.toContain('?');
    });
});

describe('el papel', () => {
    const papel = (opts) => textoParaElRollo(construirTicketDeCodigo({
        nombre: 'CELINA BEATRIZ ESCOBAR ESCOBAR', codigo: CODIGO,
        emitidoPor: 'Maribel Alberto', ahora: new Date('2026-09-03T16:30:00Z'),
        ...opts,
    }));

    it('imprime el codigo partido, que es como se dicta', () => {
        expect(codigoLegible(CODIGO)).toBe('TCV - MCR4');
        expect(papel()).toContain('TCV - MCR4');
    });

    it('dice que va con el telefono cuando la ficha lo necesita', () => {
        expect(papel({ pideTelefono: true })).toMatch(/telefono/i);
    });

    it('no lo dice cuando el codigo entra solo', () => {
        expect(papel({ pideTelefono: false })).not.toMatch(/telefono/i);
    });

    it('el QR y las letras salen del mismo dato: no pueden divergir', () => {
        const doc = construirTicketDeCodigo({ nombre: 'X', codigo: CODIGO, pideTelefono: true });
        expect(doc.qr).toBe(urlConCodigo(CODIGO, { pideTelefono: true }));
    });
});
