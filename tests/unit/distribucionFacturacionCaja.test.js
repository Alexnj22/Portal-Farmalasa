import { describe, it, expect } from 'vitest';
import { formatMoney } from '@nucleo/utils/formatNumber';
import {
    accionesDelDocumento, avisoDelPlazo, correoValido, documentosDeLaCubeta, estadoDelCorreo, gruposDeFacturacion,
    nombreFormaPago, revisionDelComprobante, semaforoDeFacturacion,
} from '@nucleo/utils/distribucionFacturacion';
import {
    cierreDelDiaListo, cuentaDelCierre, cuentaDelDia, formasDeLaLiquidacion, movimientoListo, resumenDelCamion, rotuloDiferencia,
} from '@nucleo/utils/distribucionCaja';
import { cambioDelCobro, clientesDeLaCartera, problemaDelCobro, repartoDelCobro } from '@nucleo/utils/distribucionCartera';
import { leerMonto } from '@nucleo/utils/distribucionComun';

// Las reglas de Facturación, Cobros y Caja que comparten el portal y la app
// (se mudaron de las pantallas al núcleo el 2026-10-07). Lo que importa es que
// las dos pantallas digan lo mismo: si una ofrece «Deshacer» pasado el plazo y
// la otra no, el que se entera es Hacienda.

const SELLO = 'X'.repeat(40);
const doc = (o) => ({ id: 1, tipo: '01', estado: 'sellado', sello_recibido: SELLO, numero_control: 'DTE-01-00000000-000000000000001', codigo_generacion: '0F1E2D3C-4B5A-4978-8695-A4B3C2D1E0F9', pedido_id: 9, total_pagar: 10, json: { identificacion: {} }, ...o });

describe('Facturación', () => {
    const docs = [
        doc({ id: 1 }),
        doc({ id: 2, estado: 'firmado', sello_recibido: null }),
        doc({ id: 3, estado: 'rechazado', sello_recibido: null, pedido: { estado: 'confirmado', dte_id: null } }),
        doc({ id: 4, estado: 'contingencia', sello_recibido: null, contingencia_id: null }),
        doc({ id: 5, estado: 'sellado', correo: [{ estado: 'fallido', destinatario: 'a@b.com' }] }),
        doc({ id: 6, estado: 'sellado', correo: [{ estado: 'sin_correo' }] }),
    ];
    const g = gruposDeFacturacion(docs);

    it('agrupa lo que pide acción', () => {
        expect(g.porEnviar.map(d => d.id)).toEqual([2]);
        expect(g.rechazados.map(d => d.id)).toEqual([3]);
        expect(g.sinAvisoDeContingencia.map(d => d.id)).toEqual([4]);
        expect(g.sellados.length).toBe(3);
        expect(g.sinEntregar.map(d => d.id)).toEqual([5, 6]);
        expect(g.enviables.map(d => d.id)).toEqual([5]);
    });

    it('el semáforo es rojo con un rechazo', () => {
        expect(semaforoDeFacturacion(g).nivel).toBe('error');
        expect(semaforoDeFacturacion(gruposDeFacturacion([doc({})])).nivel).toBe('ok');
    });

    it('la cubeta y su sub-filtro', () => {
        expect(documentosDeLaCubeta(docs, g, { cubeta: 'accion', sub: 'rechazados' }).map(d => d.id)).toEqual([3]);
        expect(documentosDeLaCubeta(docs, g, { cubeta: 'todos', coincide: d => d.id > 4 }).map(d => d.id)).toEqual([5, 6]);
    });

    it('pasado el plazo no se corrige ni se deshace; la devolución sólo en Crédito Fiscal', () => {
        const vencido = { estado: 'vencido', limite: '2026-09-01' };
        expect(accionesDelDocumento(doc({}), { puedeVender: true, plazo: vencido })).toMatchObject({ puedeCorregir: false, puedeDeshacer: false, puedeDevolver: false });
        expect(accionesDelDocumento(doc({ tipo: '03' }), { puedeVender: true, plazo: vencido }).puedeDevolver).toBe(true);
        expect(accionesDelDocumento(doc({}), { puedeVender: true, plazo: { estado: 'vigente', dias: 10, limite: '2026-12-01' } })).toMatchObject({ puedeCorregir: true, puedeDeshacer: true });
        expect(accionesDelDocumento(doc({}), { puedeVender: false }).puedeDeshacer).toBe(false);
        expect(avisoDelPlazo(vencido, '03').tono).toBe('freno');
        expect(avisoDelPlazo({ estado: 'vigente', dias: 2, limite: '2026-10-09' }, '01').tono).toBe('cuidado');
    });

    it('el correo', () => {
        expect(correoValido(' a@b.co ')).toBe(true);
        expect(correoValido('a@b')).toBe(false);
        expect(estadoDelCorreo([{ estado: 'enviado', destinatario: 'x@y.com' }]).clave).toBe('enviado');
        expect(nombreFormaPago('13')).toBe('A crédito');
    });

    it('el comprobante: coincide, diferencia, «el resto» y sin lectura', () => {
        const leido = (monto) => ({ leido: { es_comprobante: true, monto } });
        expect(revisionDelComprobante(leido(10), { montoEsperado: 10 }).estado).toBe('coincide');
        expect(revisionDelComprobante(leido(9), { montoEsperado: 10 }).estado).toBe('diferencia');
        expect(revisionDelComprobante(leido(9), { montoEsperado: null }).estado).toBe('sin_comparar');
        const sin = revisionDelComprobante({ sinLector: true }, { montoEsperado: 10, montoPapel: 10 });
        expect(sin).toMatchObject({ estado: 'coincide', verificacion: 'sin_lectura', pideMontoAMano: true });
        expect(revisionDelComprobante({ leido: { es_comprobante: false } }, { montoEsperado: 10 }).estado).toBe('no_es');
    });
});

describe('Cobros', () => {
    const cuentas = [{ id: 1, estado: 'abierta', vence: '2026-10-01', saldo: 5 }, { id: 2, estado: 'abierta', vence: '2026-09-01', saldo: 3 }];
    it('reparte primero lo que vence antes, o a mano', () => {
        expect(repartoDelCobro(cuentas, { aMano: false, monto: 4 }).map(r => [r.cxc_id, r.monto])).toEqual([[2, 3], [1, 1]]);
        expect(repartoDelCobro(cuentas, { aMano: true, manual: { 1: '2' }, leer: leerMonto }).map(r => [r.cxc_id, r.monto])).toEqual([[1, 2]]);
    });
    it('dice qué impide cobrar', () => {
        const base = { puedeCobrar: true, montoFinal: 5, saldo: 8, aMano: false, reparto: [], forma: '01', referencia: '', cambio: null };
        expect(problemaDelCobro(base)).toBeNull();
        expect(problemaDelCobro({ ...base, montoFinal: 9 })).toBe(`El cliente debe ${formatMoney(8)}: no se puede cobrar más.`);
        expect(problemaDelCobro({ ...base, forma: '05' })).toMatch(/llevan su número/);
        expect(problemaDelCobro({ ...base, cambio: cambioDelCobro('01', 4, 5) })).toBe('Lo entregado no alcanza.');
    });
    it('filtra la cartera', () => {
        const cl = [{ id: 1, vencido: 0, saldo: 5, limite_credito: 10, dias_atraso: 0 }, { id: 2, vencido: 3, saldo: 20, limite_credito: 10, dias_atraso: 45 }];
        expect(clientesDeLaCartera(cl, { vista: 'vencidos' }).map(c => c.id)).toEqual([2]);
        expect(clientesDeLaCartera(cl, { vista: 'limite' }).map(c => c.id)).toEqual([2]);
        expect(clientesDeLaCartera(cl, { tramo: '31_60' }).map(c => c.id)).toEqual([2]);
    });
});

describe('Caja', () => {
    it('la cuenta del cierre: cuadra o pide motivo', () => {
        expect(cuentaDelCierre(10.1, '10.10', '')).toMatchObject({ diferencia: 0, listo: true });
        expect(cuentaDelCierre(10, '9,50', '')).toMatchObject({ diferencia: -0.5, listo: false });
        expect(cuentaDelCierre(10, '9.50', 'devolví al cliente').listo).toBe(true);
        expect(rotuloDiferencia(-0.5, formatMoney)).toBe(`Faltante ${formatMoney(0.5)}`);
    });
    it('suma por forma y el camión', () => {
        expect(formasDeLaLiquidacion({ por_forma: [{ forma: '01', origen: 'ventas', monto: 3 }, { forma: '01', origen: 'cobros', monto: 2 }] }))
            .toEqual([{ forma: '01', ventas: 3, cobros: 2 }]);
        const cam = resumenDelCamion([{ cargado: 10, vendido: 6, devuelto: 3, queda: 1, faltante: 1, faltante_costo: 2.5, estado: 'abierta', nota_remision: 'DTE-04-123456' }]);
        expect(cam).toMatchObject({ faltante: 1, costo: 2.5, abierta: true, notas: 'NR 123456' });
        expect(cam.filas.length).toBe(4);
    });
    it('un movimiento y el cierre del día', () => {
        expect(movimientoListo({ tipo: 'entrega', monto: '5', concepto: 'corte', contado: '' }).listo).toBe(false);
        expect(movimientoListo({ tipo: 'gasto', monto: '5', concepto: 'combustible' }).listo).toBe(true);
        const d = { efectivo_recibido: 100, depositado: 80, pendientes: 0 };
        expect(cuentaDelDia(d).queda).toBe(20);
        expect(cierreDelDiaListo(d, 20, '').listo).toBe(false);
        expect(cierreDelDiaListo(d, 20, 'caja fuerte').listo).toBe(true);
        expect(cierreDelDiaListo({ ...d, pendientes: 2 }, 0, '').motivo).toMatch(/Faltan 2/);
    });
});
