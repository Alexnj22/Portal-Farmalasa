// La ficha del cliente: 24.502 fichas que terminan en documentos fiscales.
//
// Dos decisiones de fondo, y las dos existen porque el modo de falla es callado:
//
//   · **nada se filtra en el navegador.** PostgREST corta en 1000 sin avisar,
//     así que un `select()` acá traería el 4% del catálogo y la vista mostraría
//     números falsos con toda naturalidad. Filtrar, ordenar y paginar viven en
//     `get_customers_page`;
//   · **`customers` no tiene policy de UPDATE.** `update_customer_fiscal` es el
//     único camino de escritura, ni desde acá ni desde ningún otro lado.
//
// Y una tercera que se ve al comparar con el sistema de origen: **sólo viajan
// los campos que se mandan, y el resto se conserva**. Es lo contrario de lo que
// hace el ERP, cuyo POST parcial BORRA lo que no recibe.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
const invoke = vi.fn(async () => ({ data: { empujado: true }, error: null }));
espia.supabase.functions = { invoke: (...a) => invoke(...a) };
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const { fetchCustomersPage, fetchCustomerDetail, updateCustomerFiscal, pushClienteAlErp,
        fetchClientesPorRevisar, descartarClientePorRevisar, codigoDeError, mensajeDeError } =
    await import('../../src/data/customers');

const rpcReal = espia.supabase.rpc;
beforeEach(() => { espia.limpiar(); vi.clearAllMocks(); espia.supabase.rpc = rpcReal; });

describe('nada se filtra en el navegador', () => {
    it('la página de clientes se arma en la base', async () => {
        await fetchCustomersPage({ page: 2, pageSize: 50 });
        expect(espia.rpc[0].nombre).toBe('get_customers_page');
        expect(espia.uso('from')).toBe(false);
        expect(espia.uso('range')).toBe(false);
    });

    it('el detalle también, y por id', async () => {
        await fetchCustomerDetail(900);
        expect(espia.rpc[0]).toEqual({ nombre: 'get_customer_detail', args: { p_id: 900 } });
    });

    it('un `error` DENTRO de la respuesta también lanza', async () => {
        // El RPC contesta 200 con `{error: 'FORBIDDEN'}`: si sólo se mirara el
        // error de transporte, la pantalla pintaría una ficha vacía como si el
        // cliente no tuviera datos.
        espia.supabase.rpc = () => Promise.resolve({ data: { error: 'FORBIDDEN' }, error: null });
        await expect(fetchCustomerDetail(1)).rejects.toThrow('FORBIDDEN');
    });
});

describe('guardar la ficha', () => {
    it('va por el único camino de escritura', async () => {
        await updateCustomerFiscal(900, { nombre: 'ANA' });
        expect(espia.rpc[0].nombre).toBe('update_customer_fiscal');
        expect(espia.uso('update')).toBe(false);
    });

    it('sólo viajan los campos que se mandan', async () => {
        // El RPC conserva lo que no recibe. Mandar la ficha entera haría que un
        // formulario con un campo sin cargar borrara el dato que había.
        await updateCustomerFiscal(900, { telefono: '23010013' });
        expect(espia.rpc[0].args.p_campos).toEqual({ telefono: '23010013' });
    });

    it('la confirmación fiscal es explícita y arranca apagada', async () => {
        // Son datos que se declaran a Hacienda: el cambio se confirma, no se
        // desliza.
        await updateCustomerFiscal(900, { nit: '0614' });
        expect(espia.rpc[0].args.p_confirmar_fiscal).toBe(false);
        espia.limpiar();
        await updateCustomerFiscal(900, { nit: '0614' }, { confirmarFiscal: true });
        expect(espia.rpc[0].args.p_confirmar_fiscal).toBe(true);
    });
});

describe('los errores llegan como CÓDIGO, y el texto se escribe una vez', () => {
    const err = (c) => new Error(`error de postgres: ${c}`);

    it('el código crudo queda disponible para que la vista reaccione', () => {
        // `REQUIERE_CONFIRMACION_FISCAL` abre el diálogo, no muestra un error.
        expect(codigoDeError(err('REQUIERE_CONFIRMACION_FISCAL'))).toBe('REQUIERE_CONFIRMACION_FISCAL');
        expect(codigoDeError(err('DUI_INVALIDO'))).toBe('DUI_INVALIDO');
    });

    it('cada código tiene su frase, y dice qué hacer', () => {
        expect(mensajeDeError(err('NOMBRE_DUPLICADO'))).toContain('Búscala y edita esa');
        expect(mensajeDeError(err('TELEFONO_INVALIDO'))).toContain('8 dígitos');
        expect(mensajeDeError(err('GEO_INCOHERENTE'))).toContain('no se corresponden');
    });

    it('un error desconocido NO se traga: sale su mensaje', () => {
        expect(codigoDeError(err('ALGO_NUEVO'))).toBeNull();
        expect(mensajeDeError(new Error('se cayó la red'))).toBe('se cayó la red');
    });

    it('sin mensaje hay una frase de última instancia', () => {
        expect(mensajeDeError(null)).toBe('No se pudo guardar. Intenta de nuevo.');
        expect(mensajeDeError({})).toBe('No se pudo guardar. Intenta de nuevo.');
    });
});

describe('el envío al sistema de origen NUNCA lanza', () => {
    it('el resultado es informativo, no una condición del guardado', async () => {
        // El guardado en el portal ya terminó. El origen es un servidor de
        // terceros que puede tardar —medido: una lectura suya tardó más de 300 s—
        // y hacer esperar a la persona por eso sería castigarla por la lentitud
        // de otro.
        invoke.mockResolvedValueOnce({ data: null, error: { message: '504' } });
        expect(await pushClienteAlErp(900)).toEqual({ empujado: false, error: '504' });
    });

    it('ni siquiera cuando la llamada revienta', async () => {
        // Si falla, no se pierde nada: la entrada del changelog queda con
        // `erp_synced_at IS NULL`, o sea en la cola.
        invoke.mockRejectedValueOnce(new Error('sin red'));
        expect(await pushClienteAlErp(900)).toEqual({ empujado: false, error: 'sin red' });
    });

    it('manda el id de la ficha, no la ficha entera', async () => {
        await pushClienteAlErp(900);
        expect(invoke).toHaveBeenCalledWith('push-cliente-erp', { body: { customer_id: 900 } });
    });
});

describe('las fichas por revisar', () => {
    it('la paginación viaja como argumento', async () => {
        await fetchClientesPorRevisar({ familia: 'repetido', page: 3, pageSize: 50 });
        expect(espia.rpc[0].args).toEqual({ p_familia: 'repetido', p_limit: 50, p_offset: 100 });
    });

    it('sin familia pedida manda null, que significa «todas»', async () => {
        await fetchClientesPorRevisar();
        expect(espia.rpc[0].args.p_familia).toBeNull();
        expect(espia.rpc[0].args.p_offset).toBe(0);
    });

    it('sin datos devuelve ceros y una lista, no undefined', async () => {
        const r = await fetchClientesPorRevisar();
        expect(r).toEqual({ total: 0, congelado: 0, repetido: 0, rows: [] });
    });

    it('descartar se ANOTA, y se puede deshacer', async () => {
        // Una decisión que no se anota se vuelve a tomar.
        await descartarClientePorRevisar(5);
        expect(espia.rpc[0]).toEqual({ nombre: 'descartar_cliente_por_revisar',
                                       args: { p_id: 5, p_deshacer: false } });
        espia.limpiar();
        await descartarClientePorRevisar(5, true);
        expect(espia.rpc[0].args.p_deshacer).toBe(true);
    });
});
