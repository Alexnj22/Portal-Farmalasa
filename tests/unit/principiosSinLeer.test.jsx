import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, cleanup, screen } from '@testing-library/react';

vi.setConfig({ testTimeout: 20000 });

// ═══════════════════════════════════════════════════════════════════════════
// Catálogo → detalle del producto: los principios activos que no se pudieron
// leer no se pueden editar (2026-11-23). El error de la lectura se anotaba en
// la consola y el detalle guardaba `principles: []`; el editor abría vacío y
// su guardado automático (`guardarPrincipiosActivos`, que reemplaza la lista
// entera) borraba los principios reales al primer cambio.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@nucleo/data/productos', async (orig) => ({
    ...(await orig()),
    guardarPrincipiosActivos: vi.fn(),
}));

vi.mock('@nucleo/context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 1 }, hasPermission: () => true, getScope: () => 'ALL' }),
}));

const { ExpandedProductRow } = await import('../../src/views/productos/TabCatalogo');

const producto = { id: 7, nombre: 'Producto de prueba', principio_activo: 'Paracetamol' };
const base = { precios: [], changelog: [], prodLog: [], purchases: [], precioHistory: [] };

const montar = (data) => render(
    <table><tbody>
        <ExpandedProductRow product={producto} data={data} loadingRow={false}
            onPhotoUpdated={() => {}} onPrinciplesUpdated={() => {}} onReintentarPrincipios={() => {}}
            onCategoryUpdated={() => {}} onClose={() => {}} categories={[]} onCategoryCreated={() => {}} />
    </tbody></table>,
);

describe('principios activos que no cargaron', () => {
    beforeEach(() => cleanup());

    it('la lectura de principios falló → «Reintentar» y sin editor', () => {
        montar({ ...base, principles: [], principlesError: true });
        expect(screen.getByText('No se pudieron cargar los principios activos.')).toBeTruthy();
    });

    it('el detalle entero no cargó → tampoco hay editor', () => {
        montar(undefined);
        expect(screen.getByText('No se pudieron cargar los principios activos.')).toBeTruthy();
    });

    it('leídos → sin aviso de error', () => {
        montar({ ...base, principles: [{ id: 1, nombre: 'Paracetamol', concentracion: '500 mg', orden: 0 }], principlesError: false });
        expect(screen.queryByText('No se pudieron cargar los principios activos.')).toBeNull();
    });
});
