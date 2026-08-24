// La capa de datos fiscal: cierre de período, Corte Z, resumen y libro de
// compras completo.
//
// Acá el error no es un número feo: es un libro que se presenta a Hacienda con
// un documento de menos. Y las cuatro piezas comparten una decisión de fondo —
// **la regla vive en la base, no en el navegador** —, cada una por su motivo:
//
//   · el cierre resuelve sus cuatro frenos en `cerrar_periodo_fiscal`; escritos
//     dos veces, el día que uno cambie el otro seguiría opinando;
//   · el Corte Z devuelve el Z del origen JUNTO al número del portal con la
//     diferencia ya calculada, porque armar el cotejo en el frontend es donde se
//     cuela comparar contra la columna equivocada;
//   · el resumen fiscal cobra el permiso adentro: sin `resumen_fiscal.can_view`
//     devuelve `FORBIDDEN` en vez de datos, y el alcance por sucursal también lo
//     decide el servidor;
//   · el libro completo pagina porque junio-julio ya dieron 1.384 filas.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const { fetchPeriodosFiscales, cerrarPeriodoFiscal, reabrirPeriodoFiscal } =
    await import('../../src/data/cierrePeriodo');
const { fetchCortesZ, fetchCorteZDias } = await import('../../src/data/corteZ');
const { fetchResumenFiscal } = await import('../../src/data/resumenFiscal');
const { fetchLibroComprasCompleto, fetchLibroComprasDeclarable } =
    await import('../../src/data/libroComprasCompleto');

const rpcReal = espia.supabase.rpc;
beforeEach(() => { espia.limpiar(); espia.supabase.rpc = rpcReal; });

describe('el cierre de período (Art. 67 LIVA)', () => {
    it('la cadena entera llega en UNA llamada, con los frenos ya resueltos', async () => {
        // La vista no re-deduce las cuatro condiciones para cerrar: viven en la
        // función, junto con `puede_cerrarse` y su `motivo_no_puede`.
        await fetchPeriodosFiscales();
        expect(espia.rpc[0].nombre).toBe('get_periodos_fiscales');
        expect(espia.uso('from')).toBe(false);
    });

    it('«no se sabe» no es «coincide»: lo declarado nace en null', async () => {
        // `declarado_real` es lo que la contadora presentó de verdad. Un 0 por
        // defecto diría que se declaró cero.
        await cerrarPeriodoFiscal('2026-07', null, undefined);
        expect(espia.rpc[0].args).toEqual({ p_periodo: '2026-07', p_nota: null, p_declarado_real: null });
    });

    it('un cero declarado SÍ se manda: es un dato, no un vacío', async () => {
        await cerrarPeriodoFiscal('2026-07', 'sin movimiento', 0);
        expect(espia.rpc[0].args.p_declarado_real).toBe(0);
    });

    it('una nota vacía viaja como null', async () => {
        await cerrarPeriodoFiscal('2026-07', '', 100);
        expect(espia.rpc[0].args.p_nota).toBeNull();
    });

    it('reabrir exige motivo y va por función', async () => {
        // Sin esto, un período mal cerrado se corrige con un UPDATE a mano y la
        // cadena del remanente se rompe en silencio.
        await reabrirPeriodoFiscal('2026-07', 'la contadora corrigió el anexo');
        expect(espia.rpc[0]).toEqual({ nombre: 'reabrir_periodo_fiscal',
            args: { p_periodo: '2026-07', p_motivo: 'la contadora corrigió el anexo' } });
        expect(espia.uso('update')).toBe(false);
    });

    it('un error de la base SE LANZA: un cierre a medias no puede pasar por bueno', async () => {
        espia.supabase.rpc = () => Promise.resolve({ data: null, error: { message: 'PERIODO_YA_CERRADO' } });
        await expect(cerrarPeriodoFiscal('2026-07', null, null)).rejects.toMatchObject({ message: 'PERIODO_YA_CERRADO' });
        await expect(fetchPeriodosFiscales()).rejects.toBeTruthy();
    });
});

describe('el Corte Z', () => {
    it('los dos lados vienen en la misma fila', async () => {
        // El cotejo ES lo que se quiere mirar: pedirlos en dos consultas y
        // enfrentarlos acá es donde se cuela comparar contra la columna
        // equivocada.
        await fetchCortesZ('2026-07-01', '2026-07-31', 4);
        expect(espia.rpc[0]).toEqual({ nombre: 'get_cortes_z',
            args: { p_desde: '2026-07-01', p_hasta: '2026-07-31', p_branch_id: 4 } });
    });

    it('sin sucursal pedida manda null, que significa «todas»', async () => {
        await fetchCortesZ('2026-07-01', '2026-07-31', null);
        expect(espia.rpc[0].args.p_branch_id).toBeNull();
        espia.limpiar();
        await fetchCortesZ('2026-07-01', '2026-07-31');
        expect(espia.rpc[0].args.p_branch_id).toBeNull();
    });

    it('la sucursal viaja como número aunque llegue como texto del formulario', async () => {
        await fetchCortesZ('2026-07-01', '2026-07-31', '4');
        expect(espia.rpc[0].args.p_branch_id).toBe(4);
    });

    it('el día por día se pide aparte, y ahí la sucursal es obligatoria', async () => {
        // Son ~31 filas por tarjeta y sólo hacen falta cuando alguien va a
        // investigar una diferencia.
        await fetchCorteZDias('4', '2026-07');
        expect(espia.rpc[0]).toEqual({ nombre: 'get_corte_z_dias',
            args: { p_branch_id: 4, p_periodo: '2026-07' } });
    });

    it('sin datos devuelve un arreglo, no null', async () => {
        espia.supabase.rpc = () => Promise.resolve({ data: null, error: null });
        expect(await fetchCortesZ('2026-07-01', '2026-07-31')).toEqual([]);
        expect(await fetchCorteZDias(4, '2026-07')).toEqual([]);
    });
});

describe('el resumen fiscal', () => {
    it('es un objeto JSON: no pasa por el tope de las 1000 filas', async () => {
        await fetchResumenFiscal('2026-07-01', '2026-07-31', null);
        expect(espia.rpc[0].nombre).toBe('get_resumen_fiscal');
        expect(espia.uso('range')).toBe(false);
    });

    it('el permiso NO se pregunta acá: lo cobra la función', async () => {
        // Sin `resumen_fiscal.can_view` devuelve `FORBIDDEN` en vez de datos, y
        // un usuario limitado a su sucursal no puede pedir otra aunque mande el
        // parámetro.
        await fetchResumenFiscal('2026-07-01', '2026-07-31', 4);
        expect(espia.uso('from')).toBe(false);
        expect(espia.rpc).toHaveLength(1);
    });
});

describe('el libro de compras completo', () => {
    it('PAGINA: junio-julio ya dieron 1.384 filas', async () => {
        // PostgREST cortaría en 1000 sin avisar, y a un libro fiscal le
        // faltarían documentos sin que nada falle.
        await fetchLibroComprasCompleto('2026-06-01', '2026-07-31', null);
        expect(espia.uso('range')).toBe(true);
        expect(espia.rpc[0].nombre).toBe('get_libro_compras_completo');
    });

    it('el DECLARABLE no recibe sucursal, y eso no es un olvido', async () => {
        // El libro se presenta por NRC —la empresa— y los documentos que sólo
        // llegaron por correo no tienen sucursal guardada. Aceptar el parámetro
        // haría que pedir una sala omitiera cientos de CCF sin avisar.
        await fetchLibroComprasDeclarable('2026-06-01', '2026-07-31');
        expect(Object.keys(espia.rpc[0].args)).toEqual(['p_desde', 'p_hasta']);
        expect(fetchLibroComprasDeclarable).toHaveLength(2);
    });

    it('el declarable también pagina', async () => {
        await fetchLibroComprasDeclarable('2026-06-01', '2026-07-31');
        expect(espia.uso('range')).toBe(true);
    });
});
