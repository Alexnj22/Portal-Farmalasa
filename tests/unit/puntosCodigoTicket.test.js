import { describe, it, expect } from 'vitest';
import {
    urlConCodigo, codigoLegible, construirTicketDeCodigo, URL_MIS_PUNTOS,
} from '../../src/utils/puntosCodigoTicket';
import { textoParaElRollo } from '../../src/utils/ticketPrint';

/**
 * El papel del código de acceso, anclado contra el defecto que lo destapó.
 *
 * El 2026-09-03 se entregó el primer código en sala, se escaneó su QR y la
 * pantalla contestó «no encontramos una ficha con ese documento y ese
 * teléfono». El QR estaba bien: mandaba el código y nada más, que es lo que el
 * papel promete. La que no cumplía era `puntos_cliente_por_documento`, que
 * aceptaba el código solo si la ficha era extranjera.
 *
 * **La regla es: si es por código, el código alcanza.** Se corrigió en la base
 * (`20260903164641_puntos_el_codigo_entra_solo`) y estas pruebas fijan el otro
 * extremo del contrato — que el QR siga llevando el código y NADA más, y que el
 * papel no le pida al cliente un segundo dato que ya no hace falta.
 */

const CODIGO = 'TCVMCR4';

describe('el QR del papel', () => {
    it('lleva el codigo adentro y es lo unico que hace falta', () => {
        const url = urlConCodigo(CODIGO);
        expect(url).toBe(`${URL_MIS_PUNTOS}?codigo=${CODIGO}`);
    });

    it('limpia guiones y espacios antes de armar la direccion', () => {
        expect(urlConCodigo('tcv-mcr 4')).toContain(`?codigo=${CODIGO}`);
    });

    it('sin codigo no inventa un parametro vacio', () => {
        expect(urlConCodigo('')).toBe(URL_MIS_PUNTOS);
    });
});

describe('el papel', () => {
    const doc = construirTicketDeCodigo({
        nombre: 'CELINA BEATRIZ ESCOBAR ESCOBAR', codigo: CODIGO,
        emitidoPor: 'Maribel Alberto', ahora: new Date('2026-09-03T16:30:00Z'),
    });
    const papel = textoParaElRollo(doc);

    it('imprime el codigo partido, que es como se dicta', () => {
        expect(codigoLegible(CODIGO)).toBe('TCV - MCR4');
        expect(papel).toContain('TCV - MCR4');
    });

    it('no le pide al cliente un segundo dato: el codigo entra solo', () => {
        expect(papel).not.toMatch(/telefono/i);
        expect(papel).not.toMatch(/\bdui\b/i);
    });

    it('el QR y las letras salen del mismo dato: no pueden divergir', () => {
        expect(doc.qr).toBe(urlConCodigo(CODIGO));
        expect(doc.qr).toContain(CODIGO);
    });
});
