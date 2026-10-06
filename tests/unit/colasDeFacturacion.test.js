import { describe, expect, it } from 'vitest';
import { conteoDeObservaciones, esSolventable, metaObs, observacionesPendientes, sinResolver } from '@nucleo/utils/colasDeFacturacion';

describe('colasDeFacturacion', () => {
    it('un rechazo de Hacienda no se tapa con una resolución vieja', () => {
        const rows = [
            { id: 1, observaciones: ['SUMA_NO_CUADRA'] },
            { id: 2, observaciones: ['RECHAZADA_POR_HACIENDA'] },
            { id: 3, observaciones: ['SIN_CORRELATIVO', 'SUMA_NO_CUADRA'] },
        ];
        const res = [{ invoice_id: 1 }, { invoice_id: 2 }];
        expect(observacionesPendientes(rows, res).map((r) => r.id)).toEqual([2, 3]);
        expect(esSolventable(rows[1])).toBe(false);
        expect(conteoDeObservaciones(observacionesPendientes(rows, res))[0][0]).toBe('RECHAZADA_POR_HACIENDA');
    });
    it('un código desconocido se muestra crudo', () => {
        expect(metaObs('NUEVO')).toEqual({ label: 'NUEVO', variant: 'warning' });
        expect(metaObs('SELLO_INVALIDO').label).toBe('Sello inválido');
    });
    it('sin resolver', () => {
        expect(sinResolver([{ id: 1 }, { id: 2 }], [{ invoice_id: 2 }]).map((r) => r.id)).toEqual([1]);
        expect(sinResolver(null, null)).toEqual([]);
    });
});

describe('lo que dice Facturación tras enviar a Hacienda', () => {
    it('cuenta lo que pasó y avisa la cola', async () => {
        const { resumenDeRegularizacion } = await import('@nucleo/utils/colasDeFacturacion');
        const r = resumenDeRegularizacion({ resueltas: 3, revisadas: 8, fallidas: 5, restantes: 2, fichas_corregidas: 1 });
        expect(r.titulo).toBe('Tanda enviada a Hacienda');
        expect(r.texto).toContain('3 de 8');
        expect(r.texto).toContain('1 ficha de cliente corregida');
        expect(r.texto).toContain('quedan 2');
        expect(r.tono).toBe('warning');
        expect(resumenDeRegularizacion({ resueltas: 0, revisadas: 0 }).titulo).toBe('No había nada pendiente');
    });
    it('una sola: el motivo de Hacienda si no entró', async () => {
        const { resumenDeRegularizarUna } = await import('@nucleo/utils/colasDeFacturacion');
        expect(resumenDeRegularizarUna({ resueltas: 0, detalle: [{ ok: false, error: 'NRC inválido' }] }, 'CCF 9').texto).toBe('NRC inválido');
        expect(resumenDeRegularizarUna({ resueltas: 1 }, 'CCF 9').titulo).toBe('Enviado a Hacienda');
    });
    it('días que quedan del mes', async () => {
        const { diasQuedanDelMes, tonoDeDiasQuedan } = await import('@nucleo/utils/colasDeFacturacion');
        expect(diasQuedanDelMes(new Date(2026, 9, 31))).toBe(0);
        expect(diasQuedanDelMes(new Date(2026, 9, 26))).toBe(5);
        expect(tonoDeDiasQuedan(2)).toBe('danger');
        expect(tonoDeDiasQuedan(5)).toBe('warning');
    });
});
