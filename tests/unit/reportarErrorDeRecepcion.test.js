import { describe, expect, it } from 'vitest';
import { puedeReportarError, PLAZO_PARA_REPORTAR_MS } from '@nucleo/utils/tableroDePedidos';
import { extrasDeRenglones } from '@nucleo/utils/extrasDeRecepcion';

// Pedido 07-201026-2-S1 (2026-10-21): la sala vio tarde que llegó Humectación
// Diaria donde el sistema decía Reparación Intensiva, y no había ninguna puerta.
describe('puedeReportarError — 2 días desde que se cerró la recepción', () => {
    const cerro = '2026-10-21T03:41:04Z';
    const t0 = new Date(cerro).getTime();

    it('dentro del plazo, sí', () => {
        expect(puedeReportarError({ recibidoAt: cerro, ahora: t0 + 60_000 })).toBe(true);
        expect(puedeReportarError({ recibidoAt: cerro, ahora: t0 + PLAZO_PARA_REPORTAR_MS - 1 })).toBe(true);
    });
    it('vencido, no — salvo supervisión', () => {
        const tarde = t0 + PLAZO_PARA_REPORTAR_MS + 1;
        expect(puedeReportarError({ recibidoAt: cerro, ahora: tarde })).toBe(false);
        expect(puedeReportarError({ recibidoAt: cerro, ahora: tarde, esSupervision: true })).toBe(true);
    });
    it('sin cerrar la recepción, o con algo por contar, no: ahí está la pantalla de siempre', () => {
        expect(puedeReportarError({ recibidoAt: null, ahora: t0 })).toBe(false);
        expect(puedeReportarError({ recibidoAt: cerro, pendientes: 3, ahora: t0 })).toBe(false);
    });
});

describe('extrasDeRenglones — un extra con propuesta sin contestar se puede quitar', () => {
    const base = { es_extra: true, status: 'con_diferencia', id: 1, erp_product_id: 1614 };
    it.each([
        [null, false, true],
        ['propuesta', true, true],
        ['contrapropuesta', true, false],
        ['acordada', true, false],
    ])('resolucion_status=%s → bloqueado %s, retirable %s', (estado, bloqueado, retirable) => {
        const [e] = extrasDeRenglones([{ ...base, resolucion_status: estado }]);
        expect(e.bloqueado).toBe(bloqueado);
        expect(e.retirable).toBe(retirable);
    });
});
