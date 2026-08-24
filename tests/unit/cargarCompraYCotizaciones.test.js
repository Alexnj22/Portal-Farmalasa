// Cargar una compra desde su documento, y las cotizaciones.
//
// La primera tiene una decisión que sólo se entiende con el número al lado:
// **la pregunta es `(proveedor, su código)`, no `renglón`.** Está medido que el
// **87% de los renglones usan un código de proveedor que se repite**, así que
// responder la primera de la lista resuelve más renglones que responder
// cualquier otra — y cada confirmación deja de preguntarse **para siempre**.
//
// Y su recorte por estado vive en la BASE por un motivo medido: son 3.016
// renglones distintos, la consulta trae 500, y ordenados con los pendientes
// adelante —que son 3.003— un apartado o un confirmado **no entraba nunca en
// esos 500**. El filtro «Todos» mostraba una sola cosa y no había forma de
// llegar a los otros dos estados desde la pantalla.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
const invoke = vi.fn(async () => ({ data: { documentos: [{ id: 1, renglones: [] }] }, error: null }));
espia.supabase.functions = { invoke: (...a) => invoke(...a) };
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const { fetchDocumentosSinCargar, fetchPropuesta, confirmarProducto, fetchProductosPorConfirmar } =
    await import('../../src/data/cargarCompra');
const { searchProductsActive, searchCustomersByName, fetchCotizacionesList,
        fetchAllProductPreciosForCotizaciones } = await import('../../src/data/cotizaciones');
const { createBranchSlice } = await import('../../src/store/slices/branchSlice');

beforeEach(() => { espia.limpiar(); vi.clearAllMocks(); });

describe('leer el documento', () => {
    it('lo lee una función con la SESIÓN de quien mira, no con el secreto de servicio', async () => {
        // Es la única que puede leer el JSON y el PDF del bucket privado, y
        // comprueba el permiso del módulo. El secreto de servicio es sólo para
        // los barridos desde Postgres.
        await fetchPropuesta(7);
        expect(invoke).toHaveBeenCalledWith('leer-dte-json', {
            body: { document_ids: [7], modo: 'propuesta', max_items: 30 },
        });
    });

    it('un error de la función se DEVUELVE, no se traga', async () => {
        invoke.mockResolvedValueOnce({ data: null, error: { message: 'sin permiso' } });
        expect(await fetchPropuesta(7)).toEqual({ propuesta: null, error: 'sin permiso' });
    });

    it('un documento que no devolvió nada NO es una propuesta vacía', async () => {
        // Pintar cero renglones diría que la factura no tiene productos.
        invoke.mockResolvedValueOnce({ data: { documentos: [] }, error: null });
        expect((await fetchPropuesta(7)).propuesta).toBeNull();
    });

    it('un error DENTRO del documento también sale a la pantalla', async () => {
        invoke.mockResolvedValueOnce({ data: { documentos: [{ error: 'el PDF no se pudo leer' }] }, error: null });
        expect(await fetchPropuesta(7)).toEqual({ propuesta: null, error: 'el PDF no se pudo leer' });
    });

    it('los documentos sin cargar se piden por ventana de días', async () => {
        await fetchDocumentosSinCargar(30);
        expect(espia.rpc[0]).toEqual({ nombre: 'get_documentos_sin_cargar', args: { p_dias: 30 } });
        espia.limpiar();
        await fetchDocumentosSinCargar();
        expect(espia.rpc[0].args.p_dias).toBe(60);
    });
});

describe('el diccionario que hace que el trabajo baje solo', () => {
    it('confirmar guarda que ese código de ESE proveedor es ese producto', async () => {
        // La clave son los dos juntos: el mismo código puede ser otro producto
        // en otro proveedor.
        await confirmarProducto('0614-1', 'AB-900', '77');
        expect(espia.rpc[0]).toEqual({ nombre: 'confirmar_alias_producto',
            args: { p_emisor_nit: '0614-1', p_codigo_prov: 'AB-900', p_product_id: 77 } });
    });

    it('el id del producto viaja como NÚMERO aunque llegue del formulario como texto', async () => {
        await confirmarProducto('0614-1', 'AB-900', '77');
        expect(typeof espia.rpc[0].args.p_product_id).toBe('number');
    });

    it('el estado lo recorta la BASE, no el navegador', async () => {
        // Con el recorte acá, un apartado o un confirmado no entraba nunca en
        // los 500 que trae la consulta.
        await fetchProductosPorConfirmar('apartados');
        expect(espia.rpc[0].args).toEqual({ p_estado: 'apartados', p_limite: 500 });
        expect(espia.uso('from')).toBe(false);
    });

    it('por defecto pregunta por los pendientes', async () => {
        await fetchProductosPorConfirmar();
        expect(espia.rpc[0].args.p_estado).toBe('pendientes');
    });

    it('sin datos devuelve filas vacías y el error aparte', async () => {
        const r = await fetchProductosPorConfirmar();
        expect(Array.isArray(r.filas)).toBe(true);
        expect(r).toHaveProperty('error');
    });
});

describe('las cotizaciones', () => {
    it('el buscador de productos sólo ofrece los ACTIVOS', async () => {
        // Cotizar uno dado de baja produce un precio que no se puede facturar.
        searchProductsActive('amox');
        expect(espia.todos('eq')).toContainEqual(['activo', true]);
        expect(espia.primero('limit')).toEqual([20]);
    });

    it('el de clientes tiene su propio tope, y ordena por nombre', () => {
        searchCustomersByName('perez');
        expect(espia.primero('limit')).toEqual([60]);
        expect(espia.primero('order')).toEqual(['name']);
    });

    it('la lista se acota al alcance de la sala cuando lo hay', async () => {
        fetchCotizacionesList(4);
        expect(espia.primero('eq')).toEqual(['branch_id', 4]);
        espia.limpiar();
        fetchCotizacionesList(null);
        expect(espia.uso('eq')).toBe(false);
    });

    it('el tope de la lista es deliberado y NO es el cap de PostgREST', () => {
        // 1000 trunca en silencio; 300 es un freno que se ve.
        fetchCotizacionesList();
        expect(espia.primero('limit')).toEqual([300]);
        expect(espia.primero('order')).toEqual(['created_at', { ascending: false }]);
    });

    it('los precios del catálogo se traen PAGINADOS', async () => {
        // Son miles de filas: sin paginar, cotizar con el catálogo cortado
        // pondría precios de los primeros 1000 productos y ninguno del resto.
        await fetchAllProductPreciosForCotizaciones();
        expect(espia.uso('range')).toBe(true);
    });
});

describe('validar el kiosco: «no autorizado» NO es «no pude preguntar»', () => {
    // Antes hacía un SELECT directo sobre `kiosk_devices`, que exigía una policy
    // `anon SELECT true`: **cualquiera sin sesión leía la tabla entera**. Hoy lo
    // valida una función SECURITY DEFINER.
    //
    // Y la distinción de los dos noes no es cosmética: `useKioskDevice` depende
    // de ella para **no desvincular un kiosco sólo porque se quedó sin internet
    // un momento**.
    const slice = () => createBranchSlice(() => {}, () => ({}));
    const rpcReal = espia.supabase.rpc;

    beforeEach(() => { espia.supabase.rpc = rpcReal; });

    it('una fila devuelta es un sí', async () => {
        espia.supabase.rpc = () => Promise.resolve({ data: [{ id: 'd1' }], error: null });
        expect(await slice().validateKioskToken('d1', 'tok'))
            .toEqual({ authorized: true, networkError: false });
    });

    it('CERO filas es un no REAL: dispositivo revocado o token inválido', async () => {
        espia.supabase.rpc = () => Promise.resolve({ data: [], error: null });
        expect(await slice().validateKioskToken('d1', 'malo'))
            .toEqual({ authorized: false, networkError: false });
    });

    it('un error es «no pude preguntar», y el kiosco NO se desvincula', async () => {
        espia.supabase.rpc = () => Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
        const r = await slice().validateKioskToken('d1', 'tok');
        expect(r).toMatchObject({ authorized: false, networkError: true });
        expect(r.message).toBe('Failed to fetch');
    });

    it('una respuesta que no es una lista NO se toma por autorizada', async () => {
        // Ante la duda, el kiosco pide credenciales; no da por buena una forma
        // que no reconoce.
        espia.supabase.rpc = () => Promise.resolve({ data: { ok: true }, error: null });
        expect((await slice().validateKioskToken('d1', 'tok')).authorized).toBe(false);
    });

    it('el token viaja al servidor, no se compara acá', async () => {
        espia.supabase.rpc = rpcReal;
        espia.limpiar();
        await slice().validateKioskToken('d1', 'tok');
        expect(espia.rpc[0]).toEqual({ nombre: 'verify_kiosk_device',
                                       args: { p_device_id: 'd1', p_device_token: 'tok' } });
    });
});
