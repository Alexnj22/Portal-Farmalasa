// La cola de impresión de cada sala.
//
// Existe porque el camino directo (`http://localhost`) sólo alcanza la
// computadora que tiene el navegador abierto, y **no puede alcanzar otra**:
// apuntar a la IP de la caja es contenido mixto y el navegador lo corta — la
// exención vale sólo para `localhost` y no se hereda a una IP.
//
// Tres reglas de este módulo se aprendieron con el papel en la mano, y las tres
// son invisibles desde el código:
//
//   · **el contenido viaja en base64**, porque un ticket es un flujo de bytes y
//     un NUL no cabe en una columna `text`. El 17-ago-2026 esta llamada
//     devolvía 400 en cada intento, el portal lo leía como «este camino no
//     está» y el papel salía en la computadora de quien apretaba el botón;
//   · **el error VIAJA, no se convierte en lista vacía.** Devolver `[]` hacía
//     que la pantalla dijera «Ninguna sala imprime todavía» —un estado
//     legítimo— con cinco cajas registradas y latiendo;
//   · **el token no se puede volver a leer.** Se ve una sola vez, al registrar.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const { encolarImpresion, fetchCajasDeImpresion, fetchSalasConCaja,
        crearCodigoDeVinculacion, eliminarCajaDeImpresion, fetchColaDeImpresion,
        fetchVersionPublicadaDelAgente } = await import('../../src/data/impresion');

// Dos pruebas de acá reemplazan `from`/`rpc` para simular un fallo: se guardan
// los originales y se restauran en cada prueba, porque si no el reemplazo se
// filtra a las siguientes y las hace fallar por el motivo equivocado.
const fromReal = espia.supabase.from;
const rpcReal  = espia.supabase.rpc;
beforeEach(() => {
    espia.limpiar();
    vi.unstubAllGlobals();
    espia.supabase.from = fromReal;
    espia.supabase.rpc  = rpcReal;
});

describe('dejar un documento esperando en la caja de una sala', () => {
    it('el contenido va en base64 y la sala es un argumento', () => {
        encolarImpresion({ branchId: 4, titulo: 'Corte Z', contenidoB64: 'G0EA' });
        expect(espia.rpc[0]).toEqual({ nombre: 'encolar_impresion',
            args: { p_branch_id: 4, p_titulo: 'Corte Z', p_contenido: 'G0EA' } });
    });

    it('encolar es una FUNCIÓN, no un insert en la tabla', () => {
        // La función es la que rechaza cuando esa sala no tiene caja — y ese
        // rechazo es deliberado: una cola que nadie lee es papel que nunca sale.
        encolarImpresion({ branchId: 4, titulo: 't', contenidoB64: 'x' });
        expect(espia.uso('insert')).toBe(false);
    });
});

describe('las cajas registradas', () => {
    it('el token NO está entre las columnas que se piden', async () => {
        // Un token que se puede volver a leer desde cualquier pantalla es un
        // token que viaja.
        await fetchCajasDeImpresion();
        expect(espia.primero('select')[0]).not.toMatch(/token/);
    });

    it('trae el latido y la versión del agente: sin eso no se sabe cuál contesta', async () => {
        await fetchCajasDeImpresion();
        const columnas = espia.primero('select')[0];
        for (const c of ['ultimo_latido', 'agente_version', 'agente_canal'])
            expect(columnas).toContain(c);
    });

    it('salen ordenadas por nombre', async () => {
        await fetchCajasDeImpresion();
        expect(espia.primero('order')).toEqual(['nombre']);
    });

    it('un fallo devuelve el error, no una lista vacía', async () => {
        // Un fallo disfrazado de dato manda a buscar el problema al lugar
        // equivocado: acá mandaba a reinstalar cinco agentes sanos.
        espia.supabase.from = () => ({
            select: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'permission denied' } }) }),
        });
        const r = await fetchCajasDeImpresion();
        expect(r.cajas).toEqual([]);
        expect(r.error).toMatchObject({ message: 'permission denied' });
    });
});

describe('elegir dónde imprimir NO es lo mismo que administrar cajas', () => {
    it('va por su propia función, no por la tabla', async () => {
        // La tabla exige el permiso `impresion`, donde se ve el equipo, la cola
        // de CUPS y el canal — información de instalación. Esto contesta lo
        // único que hace falta para ELEGIR, y lo puede preguntar cualquiera con
        // sesión.
        await fetchSalasConCaja();
        expect(espia.rpc[0].nombre).toBe('salas_con_caja_de_impresion');
        expect(espia.uso('from')).toBe(false);
    });

    it('también acá el error viaja', async () => {
        espia.supabase.rpc = () => Promise.resolve({ data: null, error: { message: 'x' } });
        const r = await fetchSalasConCaja();
        expect(r.salas).toEqual([]);
        expect(r.error).toBeTruthy();
    });
});

describe('registrar y sacar una caja', () => {
    it('vincular devuelve un código, no dos identificadores para transcribir', () => {
        // Antes había que copiar dos UUID a mano a un archivo de texto en la
        // computadora de la caja: se copia mal, y un carácter cambiado da un
        // error que no dice cuál de los dos está mal.
        crearCodigoDeVinculacion({ branchId: 4, nombre: 'Caja Salud 4' });
        expect(espia.rpc[0]).toEqual({ nombre: 'crear_codigo_de_vinculacion',
            args: { p_branch_id: 4, p_nombre: 'Caja Salud 4' } });
    });

    it('sacar una caja BORRA la fila: no la desactiva', () => {
        // `activo = false` la dejaría en la lista diciendo lo mismo. Salud 3
        // llegó a tener tres cajas —dos muertas y la buena— y una lista así hace
        // dudar de la única que sirve.
        eliminarCajaDeImpresion(9);
        expect(espia.rpc[0]).toEqual({ nombre: 'eliminar_caja_de_impresion', args: { p_id: 9 } });
        expect(espia.uso('update')).toBe(false);
        expect(espia.uso('delete')).toBe(false);
    });
});

describe('la versión publicada del agente', () => {
    it('sale del archivo que se bajan las cajas, no de una constante del portal', async () => {
        // Si se comparara contra un número escrito acá, el día que alguien no lo
        // actualiza la pantalla diría que están todas al día.
        const sha = 'a'.repeat(64);
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            expect(url).toBe('/agente-impresion/agente.sha256');
            return { ok: true, text: async () => `${sha}\n` };
        }));
        expect(await fetchVersionPublicadaDelAgente()).toBe(sha.slice(0, 12));
    });

    it('si no se puede leer, la pantalla NO opina', async () => {
        // Decir «atrasada» porque no se pudo leer el archivo sería mandar a
        // alguien a actualizar una caja que estaba bien.
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
        expect(await fetchVersionPublicadaDelAgente()).toBeNull();

        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin red'); }));
        expect(await fetchVersionPublicadaDelAgente()).toBeNull();
    });

    it('un contenido que no es un hash tampoco cuenta', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '<!doctype html>' })));
        expect(await fetchVersionPublicadaDelAgente()).toBeNull();
    });
});

describe('lo último que pasó por la cola', () => {
    it('trae el estado y el error: `ok` no significa que salió papel', async () => {
        // Por el camino directo, `ok` significa «el programa recibió el pedido».
        // Acá el agente contesta si el comando funcionó.
        await fetchColaDeImpresion();
        const columnas = espia.primero('select')[0];
        for (const c of ['estado', 'intentos', 'error', 'impreso_at']) expect(columnas).toContain(c);
    });

    it('lo más reciente primero, y con un tope lejos del cap', async () => {
        await fetchColaDeImpresion();
        expect(espia.primero('order')).toEqual(['id', { ascending: false }]);
        expect(espia.primero('limit')).toEqual([25]);
    });

    it('sin sala pedida no agrega el filtro', async () => {
        await fetchColaDeImpresion();
        expect(espia.uso('eq')).toBe(false);
        espia.limpiar();
        await fetchColaDeImpresion({ branchId: 4 });
        expect(espia.primero('eq')).toEqual(['branch_id', 4]);
    });
});
