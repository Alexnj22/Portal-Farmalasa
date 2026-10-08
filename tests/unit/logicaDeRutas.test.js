import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    MIN_POR_PARADA, duracionConParadas, llegadasEstimadas, claveDePuntos, crearCache,
    distanciaAPolilineaM, debeRecalcular, esperaDeSondeo, SONDEO_TOPE_MS, resumenPorSala,
} from '../../src/views/pedidos/logicaDeRutas';
import { marcarRastreoDeFondo, hayRastreoDeFondo, _reiniciarRastreoDeFondo } from '../../src/plataforma/rastreoRuta';

const espia = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@nucleo/supabaseClient', () => ({ supabase: { rpc: espia.rpc } }));
vi.mock('@nucleo/data/audit', () => ({ conBitacora: (p) => p, anotar: () => {} }));
const { esFuncionInexistente, cerrarRutaConMotivo, marcarParadaNoEntregada, MSG_FUNCION_DE_RUTA_FALTA } = await import('@nucleo/data/rutas');

describe('tiempo de parada', () => {
    it('suma MIN_POR_PARADA por parada a la conducción', () => {
        // El caso medido: 15 min de conducción con 3 salas no son 15 min.
        expect(duracionConParadas(15, 3)).toBe(15 + 3 * MIN_POR_PARADA);
        expect(duracionConParadas(0, 0)).toBe(0);
        expect(duracionConParadas(NaN, 2)).toBe(2 * MIN_POR_PARADA);
    });
    it('la llegada a cada parada incluye las descargas anteriores, no la propia', () => {
        expect(llegadasEstimadas([{ dur_min: 5 }, { dur_min: 7 }, { dur_min: null }]))
            .toEqual([5, 5 + MIN_POR_PARADA + 7, 5 + 7 + 2 * MIN_POR_PARADA]);
    });
});

describe('clave de puntos y caché', () => {
    it('depende del orden y redondea a ~1 m', () => {
        const a = { lat: 14.0411771, lng: -88.9631119 }, b = { lat: 14.1, lng: -89 };
        expect(claveDePuntos([a, b])).toBe(claveDePuntos([{ lat: 14.041177, lng: -88.963112 }, b]));
        expect(claveDePuntos([a, b])).not.toBe(claveDePuntos([b, a]));
        expect(claveDePuntos([a, null])).toBe('');
    });
    it('el caché descarta el más viejo al pasar el tope', () => {
        const c = crearCache(2);
        c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3);
        expect(c.has('a')).toBe(true);
        expect(c.has('b')).toBe(false);
        expect(c.size).toBe(2);
    });
});

describe('desvío del trazado', () => {
    const linea = [{ lat: 14, lng: -89 }, { lat: 14, lng: -88.99 }];   // ~1.08 km al este
    it('un punto sobre la línea está a ~0 m; uno 0.005° al norte, a ~550 m', () => {
        expect(distanciaAPolilineaM({ lat: 14, lng: -88.995 }, linea)).toBeLessThan(1);
        const d = distanciaAPolilineaM({ lat: 14.005, lng: -88.995 }, linea);
        expect(d).toBeGreaterThan(540); expect(d).toBeLessThan(570);
        expect(distanciaAPolilineaM({ lat: 14, lng: -89 }, [])).toBe(Infinity);
    });
    it('recalcula al desviarse o al cambiar lo pendiente, no por estar en camino', () => {
        const base = { polilinea: linea, clavePendientes: 'x', claveAnterior: 'x' };
        expect(debeRecalcular({ ...base, pos: { lat: 14.0001, lng: -88.995 } })).toBe(false);
        expect(debeRecalcular({ ...base, pos: { lat: 14.005, lng: -88.995 } })).toBe(true);
        expect(debeRecalcular({ ...base, claveAnterior: 'y', pos: { lat: 14, lng: -88.995 } })).toBe(true);
        expect(debeRecalcular({ ...base, clavePendientes: '', pos: { lat: 14.5, lng: -88 } })).toBe(false);
        expect(debeRecalcular({ ...base, pos: null })).toBe(false);
    });
});

describe('sondeo con espera creciente', () => {
    it('crece 3, 6, 12, 24 y se queda en 24', () => {
        expect([0, 1, 2, 3, 4].map(i => esperaDeSondeo(i))).toEqual([3000, 6000, 12000, 24000, 24000]);
    });
    it('respeta el mismo tope total de 2 minutos y lee ~8 veces en vez de 40', () => {
        let total = 0, n = 0;
        for (let i = 0; ; i++) {
            const e = esperaDeSondeo(i);
            if (e == null) break;
            total += e; n++;
        }
        expect(total).toBe(SONDEO_TOPE_MS);
        expect(n).toBeLessThanOrEqual(10);
    });
});

describe('resumen por sala', () => {
    it('cuenta renglones, unidades, revisión y sin stock por sala', () => {
        const r = resumenPorSala([
            { erp_sucursal_id: 1, cantidad_asignada: 4 },
            { erp_sucursal_id: 1, cantidad_asignada: 2, revision_minmax: true },
            { erp_sucursal_id: 1, cantidad_asignada: 0, sin_stock: true },
            { erp_sucursal_id: 2, cantidad_asignada: 3, agotamiento: true },
        ]);
        expect(r).toEqual([
            { erp_sucursal_id: 1, renglones: 2, unidades: 6, revision: 1, sinStock: 1, agotamiento: 0 },
            { erp_sucursal_id: 2, renglones: 1, unidades: 3, revision: 0, sinStock: 0, agotamiento: 1 },
        ]);
    });
});

describe('rastreo de fondo', () => {
    beforeEach(() => _reiniciarRastreoDeFondo());
    it('sin marcar no hay; marcado por ruta responde por esa ruta', () => {
        expect(hayRastreoDeFondo('r1')).toBe(false);
        marcarRastreoDeFondo(true, 'r1');
        expect(hayRastreoDeFondo('r1')).toBe(true);
        expect(hayRastreoDeFondo('r2')).toBe(false);
        expect(hayRastreoDeFondo()).toBe(true);
        marcarRastreoDeFondo(false, 'r1');
        expect(hayRastreoDeFondo('r1')).toBe(false);
    });
    it('cuenta los montajes dobles: hace falta apagar las dos veces', () => {
        marcarRastreoDeFondo(true, 'r1'); marcarRastreoDeFondo(true, 'r1');
        marcarRastreoDeFondo(false, 'r1');
        expect(hayRastreoDeFondo('r1')).toBe(true);
        marcarRastreoDeFondo(false, 'r1');
        expect(hayRastreoDeFondo('r1')).toBe(false);
    });
    it('marcado sin ruta vale para todas', () => {
        marcarRastreoDeFondo(true);
        expect(hayRastreoDeFondo('cualquiera')).toBe(true);
    });
});

describe('RPC de rutas', () => {
    it('reconoce la función inexistente por código o por mensaje', () => {
        expect(esFuncionInexistente({ code: 'PGRST202' })).toBe(true);
        expect(esFuncionInexistente({ code: '42883' })).toBe(true);
        expect(esFuncionInexistente({ message: 'Could not find the function public.cerrar_ruta(p_motivo, p_ruta_id) in the schema cache' })).toBe(true);
        expect(esFuncionInexistente({ code: '42501', message: 'permission denied' })).toBe(false);
        expect(esFuncionInexistente(null)).toBe(false);
    });
    it('manda los parámetros con los nombres que espera la base', async () => {
        espia.rpc.mockResolvedValueOnce({ data: null, error: null });
        await marcarParadaNoEntregada({ rutaId: 'R', pedidoId: 'P', sucursalId: 3, motivo: 'cerrada' });
        expect(espia.rpc).toHaveBeenLastCalledWith('ruta_parada_no_entregada',
            { p_ruta_id: 'R', p_pedido_id: 'P', p_sucursal_id: 3, p_motivo: 'cerrada' });
        espia.rpc.mockResolvedValueOnce({ data: null, error: null });
        await cerrarRutaConMotivo({ rutaId: 'R', motivo: 'avería' });
        expect(espia.rpc).toHaveBeenLastCalledWith('cerrar_ruta', { p_ruta_id: 'R', p_motivo: 'avería' });
    });
    it('si la función no existe devuelve un error claro', async () => {
        espia.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
        const { error } = await cerrarRutaConMotivo({ rutaId: 'R', motivo: 'x' });
        expect(error.message).toBe(MSG_FUNCION_DE_RUTA_FALTA);
        expect(error.falta).toBe(true);
    });
});
