import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// El único módulo que sale a la red. Se reemplaza para que la prueba mida la
// PANTALLA y no la base — y para poder afirmar que sin permiso la consulta ni
// siquiera se hace, que es la mitad del hallazgo: hasta el 2026-08-17 el
// MIN·MAX viajaba al navegador aunque el campo estuviera deshabilitado.
const fetchStockParamsForRevision = vi.fn(async () => ({
    data: [{
        erp_product_id: 428, erp_sucursal_id: 4, units_sold_6m: 6,
        min_units: 1, max_units: 2, manual_min: null, manual_max: null,
    }],
    error: null,
}));
vi.mock('../../src/data/stockParams', () => ({
    fetchStockParamsForRevision: (...a) => fetchStockParamsForRevision(...a),
    updateStockParams: vi.fn(async () => ({ error: null })),
    effectiveMinMaxPair: (psp) => ({
        min: psp?.manual_min ?? psp?.min_units ?? null,
        max: psp?.manual_max ?? psp?.max_units ?? null,
    }),
}));

const ItemSections = (await import('../../src/views/pedidos/tabpedidos/ItemSections')).default;

// Un renglón que no se despachó por la regla: es el único que dibuja la fila de
// MIN·MAX. Los valores salen del pedido `d75d4083` del entorno de pruebas.
const ITEM_REGLA = {
    id: 2,
    pedido_id: 'd75d4083-882d-4a40-b3e0-f31588394291',
    erp_product_id: 428,
    erp_sucursal_id: 4,
    product_name: 'ACETAMINOFEN 500MG',
    products: { nombre: 'ACETAMINOFEN 500MG', laboratorios: { nombre: 'LAB PRUEBA' } },
    cantidad_asignada: 0,
    revision_minmax: true,
    sin_stock: false,
    agotamiento: false,
    min_qty_snapshot: 1,
    max_qty_snapshot: 2,
    stock_packs_snapshot: 0,
    factor: 1,
    dispatch_tipo: 'caja',
    dispatch_factor: 12,
    dispatch_pres_factor: 12,
    dispatch_multiplo: 1,
    presentations: [],
};

function abrirSeccion() {
    fireEvent.click(screen.getByText('Revisar regla de despacho'));
}

describe('Pedidos · la fila de MIN·MAX de «Revisar regla de despacho»', () => {
    // Reportado dos veces. La primera (2026-08-15) se cerró dejando los campos
    // visibles y deshabilitados con un cartel de «solo lectura»; lo pedido era
    // que MIN y MAX no estuvieran ahí. Un dependiente no tiene por qué ver el
    // mínimo, el máximo ni las ventas de 6 meses de su sala para entender por
    // qué un producto no le llegó — eso lo dice la columna «Motivo».
    it('sin permiso de MIN·MAX no se dibuja, y tampoco se pide el dato', () => {
        fetchStockParamsForRevision.mockClear();
        render(<ItemSections allItems={[ITEM_REGLA]} loading={false} canEditMinMax={false} />);
        abrirSeccion();

        expect(screen.queryByLabelText('Mínimo')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Máximo')).not.toBeInTheDocument();
        expect(screen.queryByText('Ventas 6M')).not.toBeInTheDocument();
        // Ni el cartel del arreglo viejo: no se dice «no podés», se quita.
        expect(screen.queryByText(/Solo lectura/i)).not.toBeInTheDocument();
        expect(fetchStockParamsForRevision).not.toHaveBeenCalled();

        // El porqué SÍ se queda — es lo que la sección viene a contestar.
        expect(screen.getByText('Necesidad baja')).toBeInTheDocument();
        // Pero no la orden de tocar un campo que esta pantalla ya no tiene.
        expect(screen.queryByText(/Ajustar MAX/i)).not.toBeInTheDocument();
    });

    it('con permiso de MIN·MAX sigue estando completa', async () => {
        fetchStockParamsForRevision.mockClear();
        render(<ItemSections allItems={[ITEM_REGLA]} loading={false} canEditMinMax />);
        abrirSeccion();

        expect(await screen.findByLabelText('Mínimo')).toHaveValue(1);
        expect(await screen.findByLabelText('Máximo')).toHaveValue(2);
        expect(screen.getByText('Ventas 6M')).toBeInTheDocument();
        expect(screen.getByText('Restaurar')).toBeInTheDocument();
        expect(screen.getByText('0 / 0')).toBeInTheDocument();
        expect(screen.getByText(/Ajustar MAX/i)).toBeInTheDocument();
        expect(fetchStockParamsForRevision).toHaveBeenCalledTimes(1);
    });

    // El valor por defecto es el que gobierna a cualquier llamador que se olvide
    // de pasar la propiedad: tiene que ser el cerrado, no el abierto.
    it('sin la propiedad, se comporta como sin permiso', () => {
        fetchStockParamsForRevision.mockClear();
        render(<ItemSections allItems={[ITEM_REGLA]} loading={false} />);
        abrirSeccion();

        expect(screen.queryByLabelText('Mínimo')).not.toBeInTheDocument();
        expect(fetchStockParamsForRevision).not.toHaveBeenCalled();
    });
});
