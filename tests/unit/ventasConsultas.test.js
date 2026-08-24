// La capa de datos de Ventas — lo que se le pide a la base y con qué argumentos.
//
// Se prueba porque acá vivió el mismo bug DOS veces, y las dos veces fue
// invisible: PostgREST corta en 1000 filas **sin avisar**.
//
//   · «Receta Médica» pedía los `invoice_id` con un `.in()` sin paginar y los
//     reinyectaba. Contra 4.013 renglones reales el navegador veía **901
//     facturas de 3.655**, y agosto/2026 mostraba **8 ventas de 93**;
//   · el camino normal llamaba `search_ventas_ids` —que devuelve SETOF— sin
//     paginar: buscar «maria» en «Este año» son 9.777 filas y llegaban 1.000.
//     Peor, los TOTALES del encabezado se sumaban sobre el conjunto recortado,
//     así que el monto en pantalla no era el del período.
//
// La salida fue mover el filtro a la base. Estas pruebas fijan lo que hace que
// eso siga siendo cierto: que la paginación viaje como ARGUMENTO del RPC —no
// como un `.range()` sobre el resultado— y que la lista y los totales pidan
// exactamente el mismo recorte.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const rpc  = vi.fn(() => ({ data: null, error: null }));
const from = vi.fn(() => ({ select: () => ({ eq: () => ({ data: [], error: null }) }) }));
vi.mock('../../src/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }));

const { fetchVentasConReceta, fetchVentasRecetaStats, fetchVentasSinProducto, fetchAntibioticProductIds } =
    await import('../../src/data/ventas');

beforeEach(() => vi.clearAllMocks());

const base = { fini: '2026-08-01', ffin: '2026-08-31', branchFilter: '4',
               anuladas: 'excluir', searchTerm: 'maria', sortCol: 'fecha', sortDir: 'desc' };

describe('el filtro vive en la BASE, no en el navegador', () => {
    it('la paginación viaja como argumento del RPC', () => {
        // Si volviera a resolverse con `.range()` sobre el resultado, el tope de
        // 1000 volvería a cortar antes de que la página se calcule.
        fetchVentasConReceta({ ...base, page: 3, pageSize: 200 });
        const [nombre, args] = rpc.mock.calls[0];
        expect(nombre).toBe('get_ventas_con_receta');
        expect(args.p_limit).toBe(200);
        expect(args.p_offset).toBe(400);        // (3 - 1) × 200
    });

    it('la primera página arranca en cero', () => {
        fetchVentasConReceta({ ...base, page: 1, pageSize: 50 });
        expect(rpc.mock.calls[0][1].p_offset).toBe(0);
    });

    it('el término de búsqueda va a la base, no se filtra acá', () => {
        fetchVentasConReceta({ ...base, page: 1, pageSize: 50 });
        expect(rpc.mock.calls[0][1].p_search).toBe('maria');
    });
});

describe('la lista y los totales piden el MISMO recorte', () => {
    it('los seis filtros coinciden entre las dos llamadas', () => {
        // Si dejan de coincidir, el encabezado habla de una lista que no está en
        // pantalla — que es exactamente lo que pasaba cuando los totales se
        // sumaban sobre el conjunto recortado.
        fetchVentasConReceta({ ...base, page: 1, pageSize: 50, soloReceta: true });
        fetchVentasRecetaStats({ ...base, soloReceta: true });
        const [, lista]   = rpc.mock.calls[0];
        const [, totales] = rpc.mock.calls[1];
        for (const k of ['p_fini', 'p_ffin', 'p_branch_id', 'p_anuladas', 'p_search', 'p_solo_receta'])
            expect([k, totales[k]]).toEqual([k, lista[k]]);
    });

    it('`soloReceta` viaja en las dos y por defecto es true', () => {
        fetchVentasConReceta({ ...base, page: 1, pageSize: 50 });
        fetchVentasRecetaStats({ ...base });
        expect(rpc.mock.calls[0][1].p_solo_receta).toBe(true);
        expect(rpc.mock.calls[1][1].p_solo_receta).toBe(true);
    });

    it('los totales NO llevan paginación: son del período entero', () => {
        fetchVentasRecetaStats({ ...base });
        const [, args] = rpc.mock.calls[0];
        expect(args.p_limit).toBeUndefined();
        expect(args.p_offset).toBeUndefined();
    });
});

describe('la sala y la búsqueda vacías se mandan como NULL', () => {
    it('sin sala, null — no 0 ni cadena vacía', () => {
        // Un 0 sería la sala número cero, que no existe, y devolvería nada.
        fetchVentasConReceta({ ...base, branchFilter: '', page: 1, pageSize: 50 });
        expect(rpc.mock.calls[0][1].p_branch_id).toBe(null);
    });

    it('la sala se manda como NÚMERO, no como el texto del desplegable', () => {
        fetchVentasConReceta({ ...base, branchFilter: '25', page: 1, pageSize: 50 });
        expect(rpc.mock.calls[0][1].p_branch_id).toBe(25);
    });

    it('una búsqueda de puros espacios es una búsqueda vacía', () => {
        fetchVentasConReceta({ ...base, searchTerm: '   ', page: 1, pageSize: 50 });
        expect(rpc.mock.calls[0][1].p_search).toBe(null);
    });
});

describe('lo que no es venta de productos', () => {
    it('pide el período y la sala, y devuelve lo que da el servidor', async () => {
        rpc.mockReturnValueOnce({ data: { total: 428.5, facturas: 2 }, error: null });
        const r = await fetchVentasSinProducto({ fini: '2026-08-01', ffin: '2026-08-31', branchId: 4 });
        expect(rpc.mock.calls[0][0]).toBe('get_ventas_sin_producto');
        expect(rpc.mock.calls[0][1].p_branch_id).toBe(4);
        expect(r.total).toBe(428.5);
    });

    it('sin permiso el servidor manda null y acá se devuelve null', () => {
        // El permiso lo decide el servidor, no esta función: un monto que llega
        // al navegador ya salió, lo pinte la pantalla o no.
        rpc.mockReturnValueOnce({ data: null, error: null });
        return expect(fetchVentasSinProducto({ fini: 'a', ffin: 'b' })).resolves.toBe(null);
    });

    it('un error del servidor SE LANZA, no se convierte en cero', () => {
        // Devolver 0 diría «no hubo cobros administrativos» sobre un período que
        // no se pudo leer, y la meta contaría de más sin que nada avise.
        rpc.mockReturnValueOnce({ data: null, error: new Error('RLS') });
        return expect(fetchVentasSinProducto({ fini: 'a', ffin: 'b' })).rejects.toThrow('RLS');
    });

    it('sin sala manda null explícito', async () => {
        rpc.mockReturnValueOnce({ data: null, error: null });
        await fetchVentasSinProducto({ fini: 'a', ffin: 'b' });
        expect(rpc.mock.calls[0][1].p_branch_id).toBe(null);
    });
});

describe('los productos bajo receta', () => {
    it('se piden por la marca, no por una lista escrita a mano', () => {
        fetchAntibioticProductIds();
        expect(from).toHaveBeenCalledWith('products');
    });
});
