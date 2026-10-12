import { describe, it, expect, vi, beforeEach } from 'vitest';

// Un foco con más ids que MAX_IDS_EN_URL no viaja entero en la URL: se pide en
// tandas y la página se arma localmente con el mismo orden que la base.
const llamadas = [];
vi.mock('@nucleo/supabaseClient', () => {
    const builder = (estado) => ({
        select: () => builder(estado),
        in: (_c, ids) => { estado.ids = ids; return builder(estado); },
        eq: () => builder(estado), gte: () => builder(estado),
        then: (res) => { llamadas.push(estado.ids.length); return Promise.resolve({ data: estado.ids.map((id) => ({ id, nombre: `P${String(id).padStart(4, '0')}`, activo: true })), error: null }).then(res); },
    });
    return { supabase: { from: () => builder({}) } };
});

const { fetchProductsList, MAX_IDS_EN_URL, compararCatalogo } = await import('@nucleo/data/productos');

describe('focos del catálogo con muchos ids', () => {
    beforeEach(() => { llamadas.length = 0; });

    it('parte los ids en tandas que caben en la URL y pagina localmente', async () => {
        const ids = Array.from({ length: 1268 }, (_, i) => 1268 - i);
        const r = await fetchProductsList({ page: 2, pageSize: 30, filterActivo: 'todos', effectiveBids: ids, sortField: 'nombre', sortDir: 'asc' });
        expect(Math.max(...llamadas)).toBeLessThanOrEqual(MAX_IDS_EN_URL);
        expect(llamadas.reduce((a, b) => a + b, 0)).toBe(1268);
        expect(r.count).toBe(1268);
        expect(r.data).toHaveLength(30);
        expect(r.data[0].nombre).toBe('P0031');
    });

    it('ordena igual que la base: categoría con vacíos al final y después nombre', () => {
        const filas = [{ nombre: 'b', tipo_medicamento: null }, { nombre: 'a', tipo_medicamento: 'X' }, { nombre: 'c', tipo_medicamento: 'A' }];
        expect(filas.sort(compararCatalogo('categoria', 'asc')).map((f) => f.nombre)).toEqual(['c', 'a', 'b']);
    });
});
