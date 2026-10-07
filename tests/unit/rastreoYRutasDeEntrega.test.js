import { describe, it, expect, vi } from 'vitest';

vi.mock('@plataforma/ubicacion', () => ({ seguirPosicion: vi.fn(async () => async () => {}) }));
vi.mock('@nucleo/data/distribucion', () => ({ registrarPosicion: vi.fn(async () => null) }));

const { crearAnotador, enRutaHoy, claveEnRuta, INTERVALO_RASTREO_MS } = await import('@nucleo/data/distribucionRastreo');
const { encuadre, puntosValidos, tieneCoordenadas } = await import('@nucleo/utils/encuadreDelMapa');
const R = await import('@nucleo/utils/rutasDeEntrega');

describe('rastreo de la ruta', () => {
    it('anota la primera posición enseguida y después sólo en cada vuelta del reloj', () => {
        const anotadas = [];
        const a = crearAnotador((p) => anotadas.push(p));
        a.tick();                       // sin posición todavía: nada
        a.recibir({ lat: 1, lng: 1 });  // la primera: se anota
        a.recibir({ lat: 2, lng: 2 });  // las siguientes esperan al reloj
        a.recibir({ lat: 3, lng: 3 });
        expect(anotadas).toEqual([{ lat: 1, lng: 1 }]);
        a.tick();
        expect(anotadas).toEqual([{ lat: 1, lng: 1 }, { lat: 3, lng: 3 }]);
    });
    it('«en ruta» vale sólo el día en que se marcó', () => {
        expect(enRutaHoy('2026-10-07', '2026-10-07')).toBe(true);
        expect(enRutaHoy('2026-10-06', '2026-10-07')).toBe(false);
        expect(enRutaHoy(null, '2026-10-07')).toBe(false);
        expect(claveEnRuta('abc')).toBe('torogoz-en-ruta:abc');
        expect(INTERVALO_RASTREO_MS).toBe(60_000);
    });
});

describe('encuadre del mapa', () => {
    it('descarta lo que no es una coordenada (incluido 0,0)', () => {
        expect(tieneCoordenadas({ lat: 0, lng: 0 })).toBe(false);
        expect(tieneCoordenadas({ lat: '14.03', lng: '-88.93' })).toBe(true);
        expect(puntosValidos([[14, -89], { lat: null, lng: 1 }, { lat: 14.1, lng: -88.9 }])).toHaveLength(2);
    });
    it('abarca todos los puntos con margen, y sin puntos no inventa centro', () => {
        expect(encuadre([])).toBeNull();
        const r = encuadre([{ lat: 14, lng: -89 }, { lat: 14.2, lng: -88.8 }]);
        expect(r.latitude).toBeCloseTo(14.1);
        expect(r.longitude).toBeCloseTo(-88.9);
        expect(r.latitudeDelta).toBeCloseTo(0.28);
        expect(encuadre([{ lat: 14, lng: -89 }]).latitudeDelta).toBe(0.01);
    });
});

describe('rutas de reparto', () => {
    const ruta = { id: 1, numero: 7, conductor_nombre: 'Ana Pérez', status: 'en_ruta', ruta_pedidos: [
        { id: 'b', orden_entrega: 2, erp_sucursal_id: 3, pedido_id: 'p2', entregado_at: null },
        { id: 'a', orden_entrega: 1, erp_sucursal_id: 2, pedido_id: 'p1', entregado_at: '2026-10-07T15:00:00Z' },
    ] };
    it('ordena las paradas y cuenta el avance', () => {
        const p = R.ordenarParadas(ruta);
        expect(p.map(x => x.id)).toEqual(['a', 'b']);
        expect(R.avanceDeEntrega(p)).toEqual({ entregadas: 1, total: 2, completa: false });
        expect(R.avanceDeEntrega([])).toEqual({ entregadas: 0, total: 0, completa: false });
    });
    it('rotula las paradas con la sala y el pedido, y sin nombre no las pierde', () => {
        const [r] = R.enriquecerRutas([ruta], [{ erp_sucursal_id: 2, branch: { name: 'Salud 2' } }], [{ id: 'p1', numero: 75 }]);
        const a = r.ruta_pedidos.find(x => x.id === 'a');
        const b = r.ruta_pedidos.find(x => x.id === 'b');
        expect(a).toMatchObject({ suc_name: 'Salud 2', numeros: [75] });
        expect(b).toMatchObject({ suc_name: 'Suc. 3', numeros: [] });
        expect(R.idsDeParadas([ruta])).toEqual({ sucursales: [3, 2], pedidos: ['p2', 'p1'] });
    });
    it('estado, distancia, búsqueda y separación', () => {
        expect(R.estadoDeRuta('rara').label).toBe('Pendiente');
        expect(R.distanciaTexto(850)).toBe('850 m');
        expect(R.distanciaTexto(1234)).toBe('1.2 km');
        expect(R.distanciaTexto(0)).toBeNull();
        const otra = { ...ruta, id: 2, numero: 12, conductor_nombre: 'Luis', status: 'completada' };
        expect(R.filtrarRutas([ruta, otra], 'ana').map(r => r.id)).toEqual([1]);
        expect(R.filtrarRutas([ruta, otra], '12').map(r => r.id)).toEqual([2]);
        const s = R.separarRutas([ruta, otra]);
        expect(s.activas.map(r => r.id)).toEqual([1]);
        expect(s.completadas.map(r => r.id)).toEqual([2]);
    });
    it('ubica las salas, arma el trazo de ida y vuelta y lee si el conductor está en vivo', () => {
        const { porSucursal, bodega } = R.coordenadasDeSucursales([
            { erp_sucursal_id: 1, es_bodega: true, branch: { settings: { location: { lat: '14', lng: '-89' } } } },
            { erp_sucursal_id: 2, branch: { settings: { location: { lat: 14.1, lng: -88.9 } } } },
            { erp_sucursal_id: 3, branch: { settings: {} } },
        ]);
        expect(bodega).toEqual({ lat: 14, lng: -89 });
        expect(Object.keys(porSucursal)).toEqual(['1', '2']);
        expect(R.trazoDeReparto(bodega, R.ordenarParadas(ruta), porSucursal)).toEqual([bodega, { lat: 14.1, lng: -88.9 }, bodega]);
        const ahora = Date.parse('2026-10-07T15:05:00Z');
        expect(R.conductorEnVivo('2026-10-07T15:03:00Z', ahora)).toBe(true);
        expect(R.conductorEnVivo('2026-10-07T15:01:00Z', ahora)).toBe(false);
        expect(R.conductorEnVivo(null, ahora)).toBe(false);
    });
});
