import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * La composición de un traslado sobrevive a que se cierre la sesión.
 *
 * El store ya resolvía que agregar un producto cierre el formulario sin
 * llevarse la lista. Lo que faltaba es la otra mitad: **el portal cierra la
 * sesión sola cuando nadie usa la pantalla, y en los cargos de sala ese plazo
 * son 5 minutos**. Al volver, la aplicación se recarga y un `create()` en
 * memoria nace vacío — componer un pedido a tres salas, atender a un cliente y
 * volver, borraba todo sin decir nada.
 *
 * Esto no se puede comprobar mirando la pantalla: hay que esperar cinco minutos
 * sin tocar nada, y el defecto se ve como «se me borró» y no como un error. Por
 * eso vive acá, y por eso la prueba SIMULA la recarga —vuelve a importar el
 * módulo— en vez de dar por buena la escritura en `localStorage`.
 */

const alma = new Map();
const localStorageFalso = {
    getItem: (k) => (alma.has(k) ? alma.get(k) : null),
    setItem: (k, v) => alma.set(k, String(v)),
    removeItem: (k) => alma.delete(k),
};

beforeEach(() => {
    alma.clear();
    vi.stubGlobal('localStorage', localStorageFalso);
    vi.resetModules();
});

const renglon = (nombre, clave) => ({
    clave,
    item: { erp_product_id: 1, nombre, cantidad: 2, presentacion_tipo: 'CAJA', factor: 1 },
});

describe('la composición de un traslado', () => {
    it('vuelve entera después de recargar', async () => {
        const { useComposicionTraslado } = await import('../../src/store/composicionTraslado');
        useComposicionTraslado.getState().agregar(renglon('EUTIROX 100', 's1'));
        useComposicionTraslado.getState().agregar(renglon('EUTIROX 100', 's2'));
        useComposicionTraslado.getState().setCausa('faltante de sala');

        // La recarga: el módulo se evalúa de nuevo y el store nace otra vez.
        vi.resetModules();
        const recargado = await import('../../src/store/composicionTraslado');
        const s = recargado.useComposicionTraslado.getState();

        expect(s.renglones).toHaveLength(2);
        expect(s.renglones.map(r => r.clave)).toEqual(['s1', 's2']);
        expect(s.causa).toBe('faltante de sala');
    });

    it('al enviar se limpia, y la recarga NO la resucita', async () => {
        const { useComposicionTraslado } = await import('../../src/store/composicionTraslado');
        useComposicionTraslado.getState().agregar(renglon('EUTIROX 100', 's1'));
        // `limpiar` es lo que corre al mandar la solicitud: ahí deja de ser
        // borrador. Si el guardado sobreviviera a esto, la próxima vez que
        // alguien abriera el formulario se encontraría el pedido que YA mandó.
        useComposicionTraslado.getState().limpiar();

        vi.resetModules();
        const recargado = await import('../../src/store/composicionTraslado');
        expect(recargado.useComposicionTraslado.getState().renglones).toEqual([]);
        expect(recargado.useComposicionTraslado.getState().causa).toBe('');
    });

    it('quitar un renglón también se guarda', async () => {
        const { useComposicionTraslado } = await import('../../src/store/composicionTraslado');
        useComposicionTraslado.getState().agregar(renglon('A', 's1'));
        useComposicionTraslado.getState().agregar(renglon('B', 's2'));
        useComposicionTraslado.getState().quitar(0);

        vi.resetModules();
        const recargado = await import('../../src/store/composicionTraslado');
        const s = recargado.useComposicionTraslado.getState();
        expect(s.renglones).toHaveLength(1);
        expect(s.renglones[0].clave).toBe('s2');
    });

    it('sin `localStorage` no revienta: nace vacía y sigue funcionando', async () => {
        // Navegación privada, o la cuota llena. `draftUtils` ya lo traga, pero
        // el que importa es el store: si el arranque tirara, la vista no monta.
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('sin storage'); },
            setItem: () => { throw new Error('sin storage'); },
            removeItem: () => { throw new Error('sin storage'); },
        });
        const { useComposicionTraslado } = await import('../../src/store/composicionTraslado');
        expect(useComposicionTraslado.getState().renglones).toEqual([]);
        expect(() => useComposicionTraslado.getState().agregar(renglon('A', 's1'))).not.toThrow();
        expect(useComposicionTraslado.getState().renglones).toHaveLength(1);
    });
});
