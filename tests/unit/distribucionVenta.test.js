import { describe, it, expect, vi, beforeEach } from 'vitest';
import { indexarPrecios } from '@nucleo/utils/distribucionPrecios';
import {
    armarVenta, contextoLotes, lotesDeLaVenta, renglonNuevo, renglonesParaGuardar, pagosParaGuardar, cabeceraDePago,
    soloNumero, porLoteDe, mesVence,
} from '@nucleo/utils/distribucionVenta';
import { filaNueva } from '@nucleo/utils/distribucionPagos';

// La venta sin pantalla: la misma cuenta que usaba la vista del portal, que
// ahora comparten el portal y la app nativa.
const listas = [{ id: 1, nombre: 'Mayoreo', orden: 1 }];
const precios = [
    { product_id: 6, presentacion: 'UNIDAD', unidades: 1, lista_id: 1, precio_con_iva: '2.26' },
    { product_id: 6, presentacion: 'CAJA', unidades: 10, lista_id: 1, precio_con_iva: '20.00' },
];
const idx = indexarPrecios(precios, listas);
const producto = { product_id: 6, nombre: 'ACETAMINOFEN', activo: true, venta_libre: true, precio_con_iva: 2.26 };
const porId = new Map([['6', producto]]);
const cliente = { id: 9, nombre: 'Farmacia La Paz', tipo: 'farmacia', licencia_srs: 'X', plazo_dias: 30, limite_credito: 100 };
const emisor = { id: 1, descuento_max_pct: 5 };

function armar({ carrito, lotes = [{ id: 11, product_id: 6, lote: 'A', vence: '2027-01-01', existencia: 50 }], pagos = [filaNueva()], extra = {} } = {}) {
    const { lotesIdx, existencias } = lotesDeLaVenta({ lotesCrudos: lotes, desdeCamion: false, yo: 'u1', reservas: [], sesion: 's' });
    return armarVenta({
        carrito, idx, porId, listaEfectiva: 1, tipoDoc: '01', cliente, emisor, lotesIdx, existencias,
        ctxLotes: contextoLotes(idx, lotesIdx), permitido: (p) => p.activo, puedeVender: true,
        puedeConfigurar: false, puedeDescontar: false, pagos, plazo: '', credito: null, hoy: '2026-10-07', ...extra,
    });
}

describe('armarVenta', () => {
    it('suma con el motor del documento y deja facturar', () => {
        const v = armar({ carrito: [renglonNuevo(6, 'UNIDAD', { cantidad: '3', lote_id: 11 })] });
        expect(v.venta.total).toBeCloseTo(6.78, 2);
        expect(v.bloqueo).toBeNull();
    });

    it('un descuento que quien vende no puede dar queda POR APROBAR y no entra al total', () => {
        const v = armar({ carrito: [renglonNuevo(6, 'UNIDAD', { cantidad: '10', lote_id: 11, descValor: '20' })] });
        expect(v.porAprobar).toHaveLength(1);
        expect(v.venta.total).toBeCloseTo(22.6, 2);
        expect(v.bloqueoGuardar).toBeNull();
        expect(v.bloqueo).toMatch(/por aprobar/);
    });

    it('sin existencia suficiente en el lote, no factura', () => {
        const v = armar({ carrito: [renglonNuevo(6, 'CAJA', { cantidad: '6', lote_id: 11 })] });
        expect(v.lineas[0].faltaExistencia).toBe(true);
        expect(v.bloqueo).toMatch(/No hay existencia/);
    });

    it('lo reservado por otra venta se descuenta y se dice quién', () => {
        const { lotesIdx, existencias } = lotesDeLaVenta({
            lotesCrudos: [{ id: 11, product_id: 6, lote: 'A', existencia: 5 }], desdeCamion: false, yo: 'u1',
            reservas: [{ sesion: 'otra', lote_id: 11, unidades: 5, nombre: 'ANA MARIA LOPEZ PEREZ' }], sesion: 's',
        });
        expect(existencias.get('6')).toBe(0);
        expect(lotesIdx.get('6')[0].reservadoPor).toEqual(['ANA LOPEZ']);
    });

    it('a crédito por encima de lo disponible no factura', () => {
        const pagos = [filaNueva('13')];
        const v = armar({
            carrito: [renglonNuevo(6, 'CAJA', { cantidad: '2', lote_id: 11 })], pagos,
            extra: { plazo: '30', credito: { disponible: 10, saldo: 90 } },
        });
        expect(v.excedeCredito).toBe(true);
        expect(v.bloqueo).toMatch(/ya debe/);
    });
});

describe('lo que viaja a la base', () => {
    it('renglones, pagos y cabecera', () => {
        const v = armar({ carrito: [renglonNuevo(6, 'UNIDAD', { cantidad: '2', lote_id: 11, descValor: '5' })] });
        expect(renglonesParaGuardar(v.lineas, 1)).toEqual([{
            product_id: 6, cantidad: 2, presentacion: 'UNIDAD', lote_id: 11, lista_id: 1, descuentoTipo: 'pct', descuentoValor: 5,
        }]);
        const pagos = [{ ...filaNueva('04'), monto: '1' }, filaNueva('01')];
        expect(pagosParaGuardar(pagos).map(p => p.resto)).toEqual([false, true]);
        expect(cabeceraDePago([filaNueva('13')])).toEqual({ condicion: 2, formaPago: '01' });
    });

    it('utilidades', () => {
        expect(soloNumero('1,5x')).toBe('1.5');
        expect(mesVence('2026-11-01')).toBe('11/2026');
        expect(porLoteDe([renglonNuevo(6, 'CAJA', { cantidad: '2', lote_id: 11 })], () => 10)).toEqual([{ lote_id: 11, unidades: 20 }]);
    });
});

// ── La cola de ventas sin señal ──
const espias = vi.hoisted(() => ({
    crearPedido: vi.fn(), guardarPagos: vi.fn(), facturarPedido: vi.fn(), enviarContingencia: vi.fn(), fetchPedidoPorUuid: vi.fn(),
}));
vi.mock('@nucleo/data/distribucion', () => ({ ...espias, mensajeDeDistribucion: (e) => e?.message ?? 'error' }));
const cola = await import('@nucleo/data/distribucionSinSenal');

describe('ventas sin señal (núcleo)', () => {
    beforeEach(() => { localStorage.clear(); Object.values(espias).forEach(f => f.mockReset()); });

    it('el código de generación es un UUID v4 en mayúsculas', () => {
        const e = cola.guardarVentaSinSenal({ clientUuid: 'a', renglones: [], pagos: [] });
        expect(e.codigo_generacion).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
        expect(cola.ventasSinSenal()).toHaveLength(1);
    });

    it('al volver la señal crea, factura en contingencia y vacía la cola', async () => {
        const e = cola.guardarVentaSinSenal({ clientUuid: 'a', emisorId: 1, clienteId: 9, renglones: [], pagos: [] });
        espias.fetchPedidoPorUuid.mockResolvedValue(null);
        espias.crearPedido.mockResolvedValue(77);
        const r = await cola.enviarVentasSinSenal();
        expect(r.facturadas).toBe(1);
        expect(espias.facturarPedido).toHaveBeenCalledWith(77, { contingencia: { tipo: 3, emitido_at: e.emitido_at, codigo_generacion: e.codigo_generacion } });
        expect(espias.enviarContingencia).toHaveBeenCalled();
        expect(cola.ventasSinSenal()).toHaveLength(0);
    });

    it('si sigue sin señal, la venta se queda en la cola sin error', async () => {
        cola.guardarVentaSinSenal({ clientUuid: 'a', renglones: [], pagos: [] });
        espias.fetchPedidoPorUuid.mockRejectedValue(new TypeError('Network request failed'));
        const r = await cola.enviarVentasSinSenal();
        expect(r).toEqual({ facturadas: 0, errores: 0, aviso: null });
        expect(cola.ventasSinSenal()[0].error).toBeNull();
    });

    it('uuidV4 sin crypto.randomUUID sigue dando la forma de un v4', () => {
        const original = globalThis.crypto;
        Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
        try {
            expect(cola.uuidV4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        } finally {
            Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
        }
    });
});
