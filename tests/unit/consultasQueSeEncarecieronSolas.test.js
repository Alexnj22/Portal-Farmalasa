// Cuatro capas más, y una lección que ninguna otra prueba del repo tiene
// escrita: **una consulta se puede encarecer sola.**
//
// El selector de sucursal de Inventario pedía las últimas 30 filas de
// `inventory_sync_log` sin filtrar, y para un `ORDER BY synced_at` a secas no
// hay índice que sirva: el plan real era un **Parallel Seq Scan de 775.868 filas
// para devolver 30**. Medido en producción el 2026-08-18: media 2.099 ms, pico
// 7.818 ms, cada vez que alguien abría Inventario — y se llevaba los DOS workers
// paralelos de la instancia, así que mientras corría el resto de la base iba en
// un solo hilo.
//
// **Nadie lo rompió.** La tabla crece 10.080 filas por día (7 salas × cada
// minuto) y ese día tocó su techo de retención de 90 días: se encareció ~1% por
// día durante tres meses hasta cruzar la línea. El arreglo fue filtrar
// `is_vencidos`, que además es más correcto —el único consumidor ya descartaba
// los vencidos en JS, tirando la mitad de las 30 filas—. Medido después: 0,147 ms.
//
// Por eso el filtro está anclado acá: quitarlo no rompe nada hoy y vuelve a
// costar siete segundos dentro de tres meses.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const { fetchInventorySyncLog, fetchAllVencidosInventory, fetchExpiredInventoryCount,
        fetchInventoryDetail } = await import('../../src/data/inventarioTab');
const { fetchLaboratoriosBasic, fetchProveedores, deleteProveedor, fetchProductCountByLabDevolutivo } =
    await import('../../src/data/laboratorios');
const { fetchBannerPortal, setBannerPortal } = await import('../../src/data/bannerPortal');
const { esAvisoDeMinMax } = await import('../../src/data/solicitudDeAviso');

beforeEach(() => espia.limpiar());

describe('el selector de sucursal de Inventario', () => {
    it('filtra `is_vencidos` — sin eso no hay índice que sirva', () => {
        // Es el filtro que convirtió un Parallel Seq Scan de 775.868 filas en
        // una lectura de 0,147 ms. Quitarlo no rompe nada hoy.
        fetchInventorySyncLog();
        expect(espia.tabla()).toBe('inventory_sync_log');
        expect(espia.primero('eq')).toEqual(['is_vencidos', false]);
    });

    it('pide las 30 últimas, no todas', () => {
        fetchInventorySyncLog();
        expect(espia.primero('order')).toEqual(['synced_at', { ascending: false }]);
        expect(espia.primero('limit')).toEqual([30]);
    });
});

describe('el inventario vencido', () => {
    it('se pagina: por sala puede pasar de 1000 filas', async () => {
        await fetchAllVencidosInventory(5);
        expect(espia.uso('range')).toBe(true);
        expect(espia.todos('eq')).toContainEqual(['is_vencidos', true]);
        expect(espia.todos('eq')).toContainEqual(['erp_sucursal_id', 5]);
    });

    it('sin sala pedida NO agrega el filtro de sala', async () => {
        // Un `eq('erp_sucursal_id', null)` no devolvería «todas»: devolvería
        // cero filas, y la pantalla lo mostraría como «no hay vencidos».
        await fetchAllVencidosInventory(null);
        expect(espia.todos('eq').map(a => a[0])).not.toContain('erp_sucursal_id');
    });

    it('lo POR VENCER se cuenta entre lo que NO está en el área de vencidos', () => {
        // Es la distinción del módulo: `is_vencidos` es *dónde está apartado*,
        // `fecha_vencimiento` es *cuándo caduca*. Contar entre los ya apartados
        // daría siempre el número que ya se resolvió.
        fetchExpiredInventoryCount(5, '2026-08-24');
        expect(espia.todos('eq')).toContainEqual(['is_vencidos', false]);
        expect(espia.primero('lt')).toEqual(['fecha_vencimiento', '2026-08-24']);
        expect(espia.primero('select')[1]).toEqual({ count: 'exact', head: true });
    });

    it('el detalle sólo trae lotes con existencia', () => {
        // Un lote en cero no es una opción para pedir ni para trasladar: sale
        // ocupando renglón y no se puede elegir.
        fetchInventoryDetail(5, 900, false);
        expect(espia.primero('gt')).toEqual(['cantidad', 0]);
    });

    it('el detalle sale ordenado por presentación y lote, no como venga', () => {
        fetchInventoryDetail(5, 900, false);
        expect(espia.todos('order')).toEqual([['presentacion'], ['lote']]);
    });
});

describe('la política de vencimiento de proveedores', () => {
    it('los catálogos salen ordenados por nombre', () => {
        // Son listas que alguien recorre con el ojo: el orden de inserción hace
        // que buscar sea leerlas enteras.
        fetchLaboratoriosBasic();
        expect(espia.primero('order')).toEqual(['nombre']);
        espia.limpiar();
        fetchProveedores();
        expect(espia.primero('order')).toEqual(['nombre']);
    });

    it('borrar un proveedor toca una fila identificada', () => {
        deleteProveedor(12);
        expect(espia.uso('delete')).toBe(true);
        expect(espia.primero('eq')).toEqual(['id', 12]);
    });

    it('contar productos de un laboratorio pide el NÚMERO, no las filas', () => {
        // `products` tiene 5.212 filas: bajarlas para contarlas las traería con
        // el tope de 1000 encima y el número saldría corto.
        fetchProductCountByLabDevolutivo(3);
        expect(espia.primero('select')[1]).toEqual({ count: 'exact', head: true });
    });
});

describe('la franja de aviso del portal', () => {
    it('es UNA sola fila, no una lista', () => {
        // No es Anuncios: aquello son mensajes con audiencia y caducidad. Esto
        // es LA franja, una sola, para todo el mundo a la vez.
        fetchBannerPortal();
        expect(espia.tabla()).toBe('banner_portal');
        expect(espia.primero('eq')).toEqual(['id', 1]);
    });

    it('apagarla NO borra el texto que tenía', () => {
        // `null` significa «no lo toques»: así el texto queda listo para la
        // próxima vez en vez de tener que reescribirlo.
        setBannerPortal({ activo: false });
        expect(espia.rpc[0]).toEqual({ nombre: 'set_banner_portal', args: {
            p_activo: false, p_texto: null, p_texto_corto: null, p_variante: null } });
    });

    it('encenderla con texto lo manda entero', () => {
        setBannerPortal({ activo: true, texto: 'Obra en Salud 2', textoCorto: 'Obra', variante: 'obra' });
        expect(espia.rpc[0].args).toEqual({ p_activo: true, p_texto: 'Obra en Salud 2',
                                            p_texto_corto: 'Obra', p_variante: 'obra' });
    });
});

describe('de qué tabla sale la solicitud de un aviso', () => {
    it('lo dice el aviso, no el id', () => {
        // Un Min·Máx vive en `minmax_change_requests`, con otras columnas y otro
        // ciclo. El id no lo distingue.
        expect(esAvisoDeMinMax({ metadata: { request_type: 'MINMAX' } })).toBe(true);
        expect(esAvisoDeMinMax({ metadata: { request_type: 'ANNULMENT_REQUEST' } })).toBe(false);
    });

    it('un aviso sin ese dato NO se toma por Min·Máx', () => {
        // Buscarlo en la tabla equivocada devolvería «no está» sobre una
        // solicitud que sí existe.
        expect(esAvisoDeMinMax({ metadata: {} })).toBe(false);
        expect(esAvisoDeMinMax({})).toBe(false);
        expect(esAvisoDeMinMax(null)).toBe(false);
    });
});
