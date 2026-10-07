import { describe, expect, it } from 'vitest';
import { diaCorto, horasDelDia, maximoDe, repartoDeFormas, semanaCompleta, serieDiaria, variacionPct } from '@nucleo/utils/distribucionTablero';
import {
    alternarDia, avanceDeRuta, cargaSinNota, comoLlegar, cuentaDeDescarga, diasDeRuta, moverEnLista, resumenDeCamiones, validarUnidadesDeCarga,
} from '@nucleo/utils/distribucionRutas';
import { accionesDePedido, controlCorto, estadoDePedido, pedidosDeLaVista, resumenDePedidos } from '@nucleo/utils/distribucionPedidos';

describe('tablero', () => {
    it('variación: null sin período anterior, y el porcentaje con signo', () => {
        expect(variacionPct(100, 0)).toBeNull();
        expect(variacionPct(150, 100)).toBe(50);
        expect(variacionPct(50, 100)).toBe(-50);
    });
    it('el día corto no retrocede por UTC', () => {
        expect(diaCorto('2026-09-01')).toBe('1 sep');
        expect(serieDiaria([{ fecha: '2026-10-07', ventas: '12.5', anterior: null, documentos: '3' }])[0])
            .toMatchObject({ etiqueta: '7 oct', ventas: 12.5, anterior: 0, documentos: 3 });
    });
    it('la semana completa de lunes a domingo, con el mejor día marcado', () => {
        const s = semanaCompleta([{ dia: 3, ventas: 40, documentos: 2 }, { dia: 5, ventas: 90, documentos: 4 }]);
        expect(s).toHaveLength(7);
        expect(s.map(f => f.etiqueta)).toEqual(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']);
        expect(s.filter(f => f.mejor).map(f => f.dia)).toEqual([5]);
        expect(semanaCompleta([]).some(f => f.mejor)).toBe(false);
    });
    it('las horas de 6a a 8p', () => {
        const h = horasDelDia([{ hora: 13, documentos: 5, ventas: 20 }]);
        expect(h).toHaveLength(15);
        expect(h[0].etiqueta).toBe('6a');
        expect(h.find(f => f.hora === 12).etiqueta).toBe('12p');
        expect(h.find(f => f.hora === 13)).toMatchObject({ etiqueta: '1p', documentos: 5 });
    });
    it('el reparto de formas de pago suma 100 y nombra el crédito', () => {
        const r = repartoDeFormas([{ forma: '01', monto: 75 }, { forma: '13', monto: 25 }]);
        expect(r.map(f => f.pct)).toEqual([75, 25]);
        expect(r[0].rotulo).toBe('Efectivo');
        expect(r[1].rotulo).toBe('A crédito');
        expect(maximoDe([])).toBe(1);
    });
});

describe('rutas y camiones', () => {
    it('el avance de la ruta', () => {
        const a = avanceDeRuta([{ estado: 'venta' }, { estado: 'visitado' }, { estado: 'pendiente' }, { estado: 'pendiente' }]);
        expect(a).toMatchObject({ total: 4, venta: 1, visitados: 2, porVisitar: 2, pctVenta: 50 });
        expect(avanceDeRuta([]).pctVenta).toBeNull();
    });
    it('los días y el orden', () => {
        expect(diasDeRuta([5, 1])).toBe('L V');
        expect(diasDeRuta([])).toBe('sin días');
        expect(alternarDia([5], 1)).toEqual([1, 5]);
        expect(alternarDia([1, 5], 5)).toEqual([1]);
        expect(moverEnLista(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
        const l = ['a'];
        expect(moverEnLista(l, 0, -1)).toBe(l);
    });
    it('cómo llegar usa las coordenadas si las hay', () => {
        expect(comoLlegar({ lat: 14, lng: -89, nombre: 'X' })).toContain('destination=14,-89');
        expect(comoLlegar({ nombre: 'Tienda Ana', direccion: 'Centro' })).toContain(encodeURIComponent('Tienda Ana Centro'));
    });
    it('una carga sin Nota de Remisión válida', () => {
        expect(cargaSinNota(null)).toBe(false);
        expect(cargaSinNota({ dte: null })).toBe(true);
        expect(cargaSinNota({ dte: { estado: 'rechazado' } })).toBe(true);
        expect(cargaSinNota({ dte: { estado: 'sellado' } })).toBe(false);
        expect(resumenDeCamiones([{ carga: { dte: null }, lotes: [{ queda: 3 }, { queda: '2' }] }, { carga: null, lotes: [] }]))
            .toEqual({ camiones: 1, unidades: 5, sinNota: 1 });
    });
    it('no se carga más de lo libre en bodega', () => {
        const lote = { id: 7, existencia: 10 };
        expect(validarUnidadesDeCarga(lote, [{ lote_id: 7, unidades: 6 }], '4')).toMatchObject({ libre: 4, malo: false });
        expect(validarUnidadesDeCarga(lote, [{ lote_id: 7, unidades: 6 }], '5').malo).toBe(true);
        expect(validarUnidadesDeCarga(lote, [], '0').malo).toBe(true);
        expect(validarUnidadesDeCarga(lote, [], '').malo).toBe(false);
    });
    it('la descarga con faltante exige nota', () => {
        const lotes = [{ lote_id: 1, queda: 5 }, { lote_id: 2, queda: 0 }];
        expect(cuentaDeDescarga(lotes, { 1: '5' }, '')).toMatchObject({ faltan: 0, listo: true });
        expect(cuentaDeDescarga(lotes, { 1: '3' }, '')).toMatchObject({ faltan: 2, listo: false });
        expect(cuentaDeDescarga(lotes, { 1: '3' }, 'se dañaron').listo).toBe(true);
        expect(cuentaDeDescarga(lotes, { 1: '6' }, 'x').malos).toHaveLength(1);
    });
});

describe('pedidos', () => {
    const P = [
        { id: 1, estado: 'confirmado', created_at: '2026-10-07T10:00:00', dist_clientes: { nombre: 'Tienda Ana' } },
        { id: 2, estado: 'facturado', created_at: '2026-10-07T11:00:00', dist_clientes: { nombre: 'Súper Beto' }, dist_dte: { estado: 'firmado', numero_control: 'DTE-01-000000000000123' } },
        { id: 3, estado: 'anulado', created_at: '2026-10-06T11:00:00', dist_clientes: { nombre: 'Farmacia' }, dist_dte: { estado: 'rechazado' } },
    ];
    it('cada pestaña con su búsqueda', () => {
        expect(pedidosDeLaVista(P, 'pendientes').map(p => p.id)).toEqual([1]);
        expect(pedidosDeLaVista(P, 'finalizados', 'beto').map(p => p.id)).toEqual([2]);
        expect(pedidosDeLaVista(P, 'finalizados', 'ana')).toEqual([]);
        expect(pedidosDeLaVista(P, 'otra').map(p => p.id)).toEqual([1]);
    });
    it('los números de arriba', () => {
        expect(resumenDePedidos(P, '2026-10-07')).toEqual({ porFacturar: 1, facturadosHoy: 1, sinSello: 1, rechazados: 1 });
    });
    it('una preventa con descuento pedido no está por facturar', () => {
        expect(estadoDePedido({ estado: 'confirmado', descuento_solicitud_id: 9 }).label).toBe('Descuento por aprobar');
        expect(estadoDePedido({ estado: 'confirmado' }).label).toBe('Preventa');
        expect(controlCorto('DTE-01-000000000000123')).toBe('#123');
    });
    it('qué se puede hacer', () => {
        expect(accionesDePedido(P[0], true)).toMatchObject({ facturar: true, anular: true, corregir: true, volverAVender: false });
        expect(accionesDePedido(P[0], false).facturar).toBe(false);
        expect(accionesDePedido({ ...P[1], dte_id: 5 }, true)).toMatchObject({ facturar: false, reintentar: true, volverAVender: true, verDocumento: true });
    });
});
