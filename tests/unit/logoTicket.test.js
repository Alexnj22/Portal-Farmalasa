import { describe, it, expect } from 'vitest';
import { logoParaElRollo } from '@nucleo/utils/logoTicket';
import { textoParaElRollo, seccionesParaElPrograma, construirTicketHtml } from '@nucleo/utils/ticketPrint';

const cabecera = (s) => [...s.slice(0, 8)].map((c) => c.charCodeAt(0));

describe('logo del ticket', () => {
    it('es GS v 0 del ancho entero del rollo, 128 filas', () => {
        for (const [mm, bytes] of [[80, 72], [58, 48]]) {
            const s = logoParaElRollo(mm);
            expect(cabecera(s)).toEqual([0x1d, 0x76, 0x30, 0, bytes, 0, 128, 0]);
            expect(s.length).toBe(8 + bytes * 128 + 1);
        }
    });

    it('va centrado con relleno: los costados en blanco', () => {
        const s = logoParaElRollo(80);
        for (let y = 0; y < 128; y++) {
            const fila = s.slice(8 + y * 72, 8 + (y + 1) * 72);
            expect(fila.slice(0, 28)).toBe('\x00'.repeat(28));
            expect(fila.slice(44)).toBe('\x00'.repeat(28));
        }
    });

    it('sale sólo si el ticket lleva la marca arriba', () => {
        const conMarca = { ancho: 80, encabezado: { titulo: 'FARMACIA LA SALUD' }, titulo: 'X' };
        const sinMarca = { ancho: 80, titulo: 'X' };
        expect(textoParaElRollo(conMarca)).toContain(logoParaElRollo(80));
        expect(textoParaElRollo(sinMarca)).not.toContain('\x1dv0');
        expect(seccionesParaElPrograma(conMarca).img).toMatch(/logo-ticket\.png$/);
        expect(seccionesParaElPrograma(sinMarca).img).toBe('');
        expect(construirTicketHtml(conMarca)).toContain('class="logo"');
        expect(construirTicketHtml(sinMarca)).not.toContain('class="logo"');
    });
});
