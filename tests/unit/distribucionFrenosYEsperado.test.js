import { describe, it, expect } from 'vitest';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { accionesDelDocumento, avisoDeFreno } from '@nucleo/utils/distribucionFacturacion';
import { cuentaDelCierre, efectivoDelCierre, textoDeLaDiferencia } from '@nucleo/utils/distribucionCaja';
import { ticketDeLiquidacion } from '@nucleo/utils/distribucionDocumento.js';

// Dos cosas halladas en la prueba en vivo de Distribución (2026-10-22): el
// documento seguía ofreciendo «Corregir» y «Deshacer» con una solicitud ya
// esperando o con una nota de crédito encima (el freno llegaba recién del
// servidor), y un día con sólo devoluciones sugería contar «−$12.00».

const doc = (o) => ({ id: 1, tipo: '03', estado: 'sellado', pedido_id: 9, json: { identificacion: {} }, ...o });
const vigente = { estado: 'vigente', limite: '2027-01-21', dias: 90 };

describe('lo que frena pedir la invalidación', () => {
    it('sin frenos se ofrecen las tres', () => {
        expect(accionesDelDocumento(doc(), { puedeVender: true, plazo: vigente, frenos: { solicitud: null, nota: null } }))
            .toMatchObject({ puedeCorregir: true, puedeDeshacer: true, puedeDevolver: true, pedida: null, conNota: null });
    });
    it('con una solicitud esperando no se pide otra, ni se devuelve mientras se decide', () => {
        const solicitud = { id: 'x', accion: 'anular', created_at: '2026-10-22T20:00:00Z', solicitante: 'Usuario Pruebas' };
        const a = accionesDelDocumento(doc(), { puedeVender: true, plazo: vigente, frenos: { solicitud, nota: null } });
        expect(a).toMatchObject({ puedeCorregir: false, puedeDeshacer: false, puedeDevolver: false });
        const av = avisoDeFreno(a);
        expect(av.titulo).toBe('Solicitud pendiente: deshacer la venta');
        expect(av.texto).toContain('Usuario Pruebas la pidió el 22/10/2026');
    });
    it('con nota de crédito: ni corregir ni deshacer, y se dice que primero va la nota', () => {
        const a = accionesDelDocumento(doc(), { puedeVender: true, plazo: vigente, frenos: { solicitud: null, nota: { id: 5, numero_control: 'DTE-05-X' } } });
        expect(a).toMatchObject({ puedeCorregir: false, puedeDeshacer: false, puedeDevolver: true });
        const av = avisoDeFreno(a);
        expect(av.tono).toBe('cuidado');
        expect(av.texto).toBe('Este documento tiene la nota de crédito DTE-05-X. Para corregirlo o deshacer la venta, primero hay que invalidar la nota.');
    });
    it('los frenos sólo cuentan para un sellado', () => {
        const a = accionesDelDocumento(doc({ estado: 'rechazado' }), { puedeVender: true, frenos: { solicitud: { id: 'x' }, nota: null } });
        expect(a.pedida).toBeNull();
        expect(a.puedeCorregir).toBe(true);
        expect(avisoDeFreno(a)).toBeNull();
    });
});

describe('el esperado negativo de la liquidación', () => {
    it('no sugiere contar un monto negativo: dice cuánto hay que devolver', () => {
        const e = efectivoDelCierre(-12, formatMoney);
        expect(e).toMatchObject({ negativo: true, rotulo: 'Hay que devolver', monto: 12, sugerido: '0.00' });
        expect(e.aviso).toContain('Hay que devolverle $12.00 al vendedor');
    });
    it('con esperado positivo, igual que siempre', () => {
        expect(efectivoDelCierre(349.65, formatMoney)).toMatchObject({ negativo: false, rotulo: 'Efectivo a entregar', monto: 349.65, sugerido: '349.65', aviso: null });
    });
    it('contar $0.00 sobre −$12 se lee como lo que hay que devolver, no como sobrante', () => {
        const k = cuentaDelCierre(-12, '0', '');
        expect(textoDeLaDiferencia(-12, k.contado, k.diferencia, formatMoney)).toBe('Contado $0.00 · hay que devolverle $12.00');
        const k2 = cuentaDelCierre(100, '95', '');
        expect(textoDeLaDiferencia(100, k2.contado, k2.diferencia, formatMoney)).toBe('Faltan $5.00');
    });
    it('el papel dice «HAY QUE DEVOLVER» y no un efectivo negativo', () => {
        const liq = { fecha: '2026-10-22', vendedor: { name: 'Carlos Mejía' }, ventas: { total: 0, documentos: 0, lista: [] }, por_forma: [],
            cobros: { total: 0, lista: [] }, devoluciones: { total: 12, a_favor: 0, lista: [] }, cheques: [], efectivo: { ventas: 0, cobros: 0, esperado: -12 }, credito: 0, cierre: null };
        const t = ticketDeLiquidacion(liq, null, {});
        expect(t.totales.find(x => x[0] === 'HAY QUE DEVOLVER')[1]).toBe('$12.00');
        expect(t.totales.find(x => x[0] === 'EFECTIVO A ENTREGAR')).toBeUndefined();
    });
});
