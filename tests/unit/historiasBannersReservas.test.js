import { describe, it, expect } from 'vitest';
import {
    DESTINOS_DE_LA_APP, bannerValido, filaDeBanner, filaDeHistoria, historiaValida,
} from '@nucleo/utils/ofertasClientes';
import { pilaDelCliente, reservasPendientes, reservasPorCodigo, resumenDelPedido } from '@nucleo/utils/reservasDeSala';

describe('historias de la app de clientes', () => {
    it('pide título de 3 letras e imagen', () => {
        expect(historiaValida({ titulo: 'Bebé' }, 'ruta.jpg')).toBe(true);
        expect(historiaValida({ titulo: 'Be' }, 'ruta.jpg')).toBe(false);
        expect(historiaValida({ titulo: 'Bebé' }, null)).toBe(false);
    });
    it('el botón sale de la lista cerrada; uno desconocido queda sin botón', () => {
        const f = { titulo: ' Semana ', rotulo: '', texto: '', enlace: '/ofertas', publicada: true, oferta_id: '' };
        expect(filaDeHistoria(f, 'x.jpg', '2026-10-09', '2026-10-10')).toMatchObject({
            titulo: 'Semana', rotulo: null, enlace: '/ofertas', boton: 'Ver ofertas', inicio: '2026-10-09', fin: '2026-10-10', oferta_id: null,
        });
        expect(filaDeHistoria({ ...f, enlace: '/inventado' }, 'x.jpg', 'a', 'b')).toMatchObject({ enlace: null, boton: null });
        expect(DESTINOS_DE_LA_APP[0]).toMatchObject({ valor: '', boton: null });
    });
});

describe('banners de la app de clientes', () => {
    it('pide fechas en orden', () => {
        expect(bannerValido({ titulo: 'Bebé', inicio: '2026-10-01', fin: '2026-10-05' }, 'x')).toBe(true);
        expect(bannerValido({ titulo: 'Bebé', inicio: '2026-10-05', fin: '2026-10-01' }, 'x')).toBe(false);
    });
    it('con oferta no lleva pantalla', () => {
        expect(filaDeBanner({ titulo: 'B', oferta_id: 7, enlace: '/puntos', inicio: 'a', fin: 'b' }, 'x')).toMatchObject({ oferta_id: 7, enlace: null });
        expect(filaDeBanner({ titulo: 'B', oferta_id: '', enlace: '/puntos', inicio: 'a', fin: 'b' }, 'x')).toMatchObject({ oferta_id: null, enlace: '/puntos' });
    });
});

describe('reservas de la sala', () => {
    const filas = [
        { id: 12, estado: 'pendiente', pedido: 'P-ABC123', precio: 2, cantidad: 3, cliente: 'ANA LOPEZ', pago_estado: 'pagado' },
        { id: 13, estado: 'lista', pedido: 'P-ABC123', precio: '1.5', cantidad: 1, cliente: 'ANA LOPEZ', pago_estado: 'pagado' },
        { id: 14, estado: 'pendiente', pedido: null, precio: 5, cantidad: 1, cliente: 'LUIS' },
    ];
    it('cuenta las que esperan', () => { expect(reservasPendientes(filas)).toBe(2); });
    it('busca por código de reserva o de pedido', () => {
        expect(reservasPorCodigo(filas, 'r-000014').map((r) => r.id)).toEqual([14]);
        expect(reservasPorCodigo(filas, 'p-abc').map((r) => r.id)).toEqual([12, 13]);
        expect(reservasPorCodigo(filas, '', 1)).toHaveLength(1);
        expect(reservasPorCodigo(filas, '')).toHaveLength(3);
    });
    it('suma el pedido y dice si se pagó en línea', () => {
        const r = resumenDelPedido(filas, 'P-ABC123');
        expect(r.renglones).toHaveLength(2);
        expect(r.total).toBe(7.5);
        expect(r.pagado).toBe(true);
        expect(resumenDelPedido(filas, 'R-000012').renglones).toHaveLength(0);
        expect(pilaDelCliente(filas[0])).toBe('ANA');
    });
});
