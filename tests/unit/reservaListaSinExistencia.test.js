import { describe, it, expect } from 'vitest';
import {
    accionesDeReservaNucleo, detalleDelRenglonDeReserva, estadoDeReserva, faltanEnSala, textoDeFaltante,
} from '@nucleo/utils/reservasDeSala';

// (2026-11-03) R-000151 de Salud 2: 3 cajas apartadas, la caja vendió 2 en
// mostrador y la tarjeta siguió diciendo «Lista para retirar». La base manda
// `faltan_en_sala`/`hay_en_sala` en cada renglón listo; esto fija qué dice.
const lista = (extra = {}) => ({ id: 151, estado: 'lista', origen: 'sucursal', cantidad: 3, tiene_app: false, ...extra });

describe('reserva lista sin existencia en la sala', () => {
    it('completa: sigue «Lista para retirar» y ofrece avisar', () => {
        const r = lista({ faltan_en_sala: 0, hay_en_sala: 3 });
        expect(faltanEnSala(r)).toBe(0);
        expect(estadoDeReserva(r).label).toBe('Lista para retirar');
        expect(textoDeFaltante(r)).toBe('');
        expect(accionesDeReservaNucleo(r).map((a) => a.k)).toContain('whatsapp');
    });

    it('le faltan 2: lo dice el estado, el renglón y el texto', () => {
        const r = lista({ faltan_en_sala: 2, hay_en_sala: 1 });
        expect(estadoDeReserva(r)).toEqual({ label: 'Faltan 2 en la sala', variant: 'danger', tono: 'danger' });
        expect(detalleDelRenglonDeReserva(r)).toBe('En la sala hay 1 de 3');
        expect(textoDeFaltante(r)).toMatch(/tiene 1 de 3/);
    });

    it('una sola: en singular', () => {
        expect(estadoDeReserva(lista({ faltan_en_sala: 1, hay_en_sala: 2 })).label).toBe('Falta 1 en la sala');
    });

    it('no le avisa al cliente que está lista; Retirar queda con la advertencia', () => {
        const a = accionesDeReservaNucleo(lista({ faltan_en_sala: 2, hay_en_sala: 1 }));
        expect(a.map((x) => x.k)).not.toContain('whatsapp');
        expect(a.find((x) => x.k === 'retirar').title).toMatch(/estante/);
    });

    it('un pedido con dos productos cortos: rótulo general', () => {
        const r = { id: 1, pedido: 'P-1', estado: 'lista', renglones: [
            lista({ id: 1, faltan_en_sala: 1 }), lista({ id: 2, faltan_en_sala: 2 }),
        ] };
        expect(estadoDeReserva(r).label).toBe('Falta producto en la sala');
    });

    it('un renglón pendiente nunca cuenta como faltante (todavía no se apartó)', () => {
        expect(faltanEnSala({ estado: 'pendiente', faltan_en_sala: 3 })).toBe(0);
    });

    it('sin el dato (base vieja): no inventa un faltante', () => {
        expect(estadoDeReserva(lista()).label).toBe('Lista para retirar');
    });
});
