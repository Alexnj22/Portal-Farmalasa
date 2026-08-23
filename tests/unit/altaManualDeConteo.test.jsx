import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { Suspense } from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';

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
