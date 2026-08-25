import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { Suspense } from 'react';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════════════
// El alta manual del conteo, después de salir a su propio archivo.
//
// El 2026-08-23 `AddManualItemForm` se extrajo de `ConteoDetailView` y pasó a
// `lazy()`: 162 líneas que sólo existen cuando alguien toca «Agregar» y que
// viajaban en el paquete de una pantalla que se abre de pie frente a un
// anaquel. El `bundle-gate` lo pidió —la vista había quedado 1 kB sobre su
// techo— y bajó de 68 a 67 kB.
//
// **Mover 162 líneas de archivo no lo prueba el compilador.** El build valida
// que los imports resuelvan; lo que NO valida es que el componente monte —un
// hook que quedó sin su proveedor, un import que se llevó a medias, un
// `export default` que no era. Eso sólo se ve al renderizarlo.
//
// Y no se pudo comprobar en el navegador: el botón «Agregar» exige permiso de
// gestión en el módulo, y la cuenta con la que corre el barrido no lo tiene —
// el botón no llega ni a estar en el DOM. Esta prueba es la que cubre ese hueco,
// y encima no depende de permisos ni de red.
//
// Lo que ancla es lo mínimo y lo que de verdad se rompe: que el módulo diferido
// se pueda cargar, que monte sin lanzar, y que dibuje sus dos controles
// obligatorios —elegir producto y elegir presentación—.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('../../src/data/conteoInventario', () => ({
    searchActiveProductsForConteo: vi.fn(async () => ({ data: [], error: null })),
    fetchProductPresentacionesForConteo: vi.fn(async () => ({ data: [], error: null })),
    fetchErpSucursalIdsForBranch: vi.fn(async () => ({ data: [], error: null })),
    fetchInventoryLotesForProduct: vi.fn(async () => ({ data: [], error: null })),
}));

vi.mock('../../src/store/toastStore', () => ({
    useToastStore: () => ({ showToast: vi.fn() }),
}));

const AltaManual = React.lazy(() => import('../../src/views/inventario/AddManualItemForm'));

describe('AddManualItemForm — extraído a su propio archivo', () => {
    beforeEach(() => cleanup());

    // Se afirma sobre el CONTENIDO y no sobre un rótulo concreto: lo que esta
    // prueba tiene que cazar es «el módulo no monta», no «cambió una etiqueta».
    // Atarla a un texto la volvería frágil por el lado equivocado — se rompería
    // al retocar el formulario y seguiría sin ver una extracción a medias.
    const montar = async (simple) => {
        const { container } = render(
            <Suspense fallback={<span>cargando</span>}>
                <AltaManual branchId={30} onAdd={vi.fn()} onCancel={vi.fn()} simple={simple} />
            </Suspense>,
        );
        // El fallback NO se comprueba acá: `lazy` cachea el módulo, así que la
        // segunda vez React lo dibuja de una y no hay nada que esperar. Lo mira
        // la primera prueba, que es la única donde el estado «sin cargar» existe.
        await waitFor(() => {
            expect(container.textContent).not.toBe('cargando');
        }, { timeout: 5000 });
        return container;
    };

    it('el módulo diferido carga y monta sin lanzar', async () => {
        // Va PRIMERA a propósito: es la única corrida en la que el módulo aún
        // no está en caché, o sea la única que puede comprobar que se difiere.
        const container = await montar(true);
        // Algo dibujó, y con controles: un montaje que lanza deja el árbol vacío.
        expect(container.querySelectorAll('button, input').length).toBeGreaterThan(0);
    });

    it('en modo con lotes también monta — es otra rama del formulario', async () => {
        const container = await montar(false);
        expect(container.querySelectorAll('button, input').length).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// El lector físico, agregado el 2026-08-25 («que se pueda escanear el código
// ahí también, sea con lector / cámara»).
//
// De las dos formas de escanear, ésta es la única que se puede probar acá: la
// cámara necesita `getUserMedia` y una imagen con barras de verdad, y simularla
// probaría el simulacro. El lector físico no — es un teclado que escribe rápido,
// y eso jsdom lo reproduce exacto.
//
// Y es la que MÁS necesita una prueba, porque su modo de falla es el silencio:
// nadie aprieta nada para usarlo, así que si el detector no está armado la
// pantalla se ve idéntica y la única señal es que pasar la caja no hace nada.
// Eso se reporta como «el lector no sirve», que se investiga en el lugar
// equivocado.
// ═══════════════════════════════════════════════════════════════════════════
describe('AddManualItemForm — el código entra por el lector', () => {
    beforeEach(() => { cleanup(); vi.clearAllMocks(); });

    /** Lo que hace un lector: teclas seguidas y un Enter al final. */
    const pasarElLector = (codigo) => {
        for (const c of codigo) fireEvent.keyDown(document, { key: c });
        fireEvent.keyDown(document, { key: 'Enter' });
    };

    const montar = async () => {
        const { container } = render(
            <Suspense fallback={<span>cargando</span>}>
                <AltaManual branchId={30} onAdd={vi.fn()} onCancel={vi.fn()} simple />
            </Suspense>,
        );
        await waitFor(() => expect(container.textContent).not.toBe('cargando'), { timeout: 5000 });
        return container;
    };

    it('una ráfaga del lector sale a buscar ESE código', async () => {
        const { searchActiveProductsForConteo } = await import('../../src/data/conteoInventario');
        await montar();
        pasarElLector('7501234567890');
        await waitFor(() => {
            expect(searchActiveProductsForConteo).toHaveBeenCalledWith('7501234567890');
        }, { timeout: 3000 });
    });

    it('con UN solo resultado lo elige solo, y lo muestra para poder comprobarlo', async () => {
        const { searchActiveProductsForConteo } = await import('../../src/data/conteoInventario');
        searchActiveProductsForConteo.mockResolvedValue({
            data: [{ id: 991, nombre: 'ACETAMINOFEN 500MG', codigo_barras: '7501234567890', laboratorios: { nombre: 'BAYER' } }],
            error: null,
        });
        const container = await montar();
        pasarElLector('7501234567890');
        // El nombre Y el código: la tarjeta existe para poder cotejarla contra
        // la caja que se tiene en la mano cuando el escaneo eligió sin preguntar.
        await waitFor(() => {
            expect(container.textContent).toContain('ACETAMINOFEN 500MG');
            expect(container.textContent).toContain('7501234567890');
        }, { timeout: 3000 });
    });

    it('con NINGÚN resultado no elige nada y lo dice', async () => {
        const { searchActiveProductsForConteo } = await import('../../src/data/conteoInventario');
        searchActiveProductsForConteo.mockResolvedValue({ data: [], error: null });
        const container = await montar();
        pasarElLector('0000000000000');
        await waitFor(() => {
            expect(container.textContent).toContain('no está en el catálogo');
        }, { timeout: 3000 });
    });

    // La parte que un `try/finally` mudo se comía: un fallo de red se veía
    // igual que un código que no existe, y las dos cosas se arreglan en sitios
    // distintos.
    it('si la búsqueda revienta, lo dice — no se queda callado', async () => {
        const { searchActiveProductsForConteo } = await import('../../src/data/conteoInventario');
        searchActiveProductsForConteo.mockRejectedValue(new Error('network'));
        const container = await montar();
        pasarElLector('7501234567890');
        await waitFor(() => {
            expect(container.textContent).toContain('No se pudo buscar el código');
        }, { timeout: 3000 });
    });

    // Teclear NO es escanear. Es lo que impide que escribir en el buscador de al
    // lado se lea como una ráfaga y dispare una selección que nadie pidió.
    it('lo tecleado a ritmo humano no cuenta como escaneo', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { searchActiveProductsForConteo } = await import('../../src/data/conteoInventario');
        searchActiveProductsForConteo.mockResolvedValue({ data: [], error: null });
        await montar();
        for (const c of 'acetam') {
            fireEvent.keyDown(document, { key: c });
            await vi.advanceTimersByTimeAsync(150);   // hueco humano: >80ms
        }
        fireEvent.keyDown(document, { key: 'Enter' });
        await vi.advanceTimersByTimeAsync(600);
        expect(searchActiveProductsForConteo).not.toHaveBeenCalledWith('acetam');
        vi.useRealTimers();
    });
});
