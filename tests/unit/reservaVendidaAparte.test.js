import { describe, it, expect } from 'vitest';
import {
    detalleDelRenglonDeReserva, estadoDeReserva, textoDeFaltante, textoDeVentaAparte, vendidaAparte,
} from '@nucleo/utils/reservasDeSala';

// (2026-11-20) R-000164 de Salud 1: lista el 13 nov y vendida en caja media
// hora después como venta suelta. La base manda `vendida_aparte`; esto fija
// qué dice la tarjeta.
const venta = { invoice_id: 6735171, factura: '0000094201_COF', at: '2026-11-13T21:04:32+00:00', total: 6.6 };
const lista = (extra = {}) => ({ id: 164, estado: 'lista', origen: 'sucursal', cantidad: 1, ...extra });

describe('reserva vendida en caja por fuera', () => {
    it('gana al faltante en el estado, el renglón y el texto', () => {
        const r = lista({ vendida_aparte: venta, faltan_en_sala: 1, hay_en_sala: 0 });
        expect(estadoDeReserva(r)).toEqual({ label: 'Ya se vendió en caja', variant: 'danger', tono: 'danger' });
        expect(detalleDelRenglonDeReserva(r)).toMatch(/^Se vendió en caja el 13 nov/);
        expect(textoDeVentaAparte(r)).toMatch(/\$6\.60/);
        expect(textoDeFaltante(r)).toBe('');
    });

    it('sin venta, nada cambia', () => {
        const r = lista({ vendida_aparte: null, faltan_en_sala: 1, hay_en_sala: 0 });
        expect(vendidaAparte(r)).toBeNull();
        expect(estadoDeReserva(r).label).toBe('Falta 1 en la sucursal');
        expect(textoDeVentaAparte(r)).toBe('');
    });

    it('cerrada: no avisa', () => {
        expect(vendidaAparte(lista({ estado: 'retirada', vendida_aparte: venta }))).toBeNull();
    });
});
