import { describe, it, expect } from 'vitest';
import { seccionesParaElPrograma, COLUMNAS_TICKET } from '../../src/utils/ticketPrint';

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
const sinCodigos = (s) => s.replace(/\x1b./g, '').replace(/\x1b!./g, '');

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
        // Los saltos del final son lo que salva la última línea de la cuchilla.
        expect(s.pie.endsWith('\n\n\n\n\n')).toBe(true);
    });

    it('no se rompe con una tabla que no tiene las cuatro columnas del ticket', () => {
        const t = ticket();
        t.items = { columnas: [{ label: 'Concepto' }, { label: 'Monto' }], filas: [['Efectivo', '$ 20.00']] };
        const linea = renglones(t).find(l => l.includes('Efectivo'));
        expect(sinCodigos(linea).length).toBe(COLUMNAS_TICKET.chica);
        expect(linea.endsWith('$ 20.00')).toBe(true);
    });
});
