import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════════════
// El formulario de «Sacar dinero de una bolsa» sale del CATÁLOGO.
//
// Lo que estas pruebas anclan es que **el catálogo mande de verdad**: qué
// campos aparecen, cuáles frenan y cuáles no. Escrito con `if`s en el `.jsx`
// —que es como estaba antes— un motivo nuevo aparecía en la base y no en la
// pantalla, y nada lo delataba.
//
// El disparador fue el repaso del usuario del 2026-08-19, motivo por motivo:
// «pago a proveedor: no lleva número de boleta, porque no es por POS. foto del
// comprobante tampoco porque a veces no deja el DTE, que sea opcional la foto.
// quien se lleva el efectivo no debe salir, porque no es de la empresa».
//
// Los tres casos que se prueban son los tres que se pueden romper por separado:
// la foto OBLIGATORIA que frena, la OPCIONAL que no frena, y el receptor que
// manda a un segundo paso en vez de registrar.
// ═══════════════════════════════════════════════════════════════════════════

const registrarSalida = vi.fn(async () => ({ data: { folio: 'PAG-1' }, error: null }));

// El catálogo, calcado de las filas reales de `bolsas_tipos_salida`.
const TIPOS = [
    { codigo: 'REMESA', etiqueta: 'Remesa entregada a un cliente', prefijo: 'REM', signo: -1,
      etiqueta_entidad: 'Remesadora', pide_boleta: true, foto: 'OBLIGATORIA', pide_receptor: false },
    { codigo: 'PAGO_PROVEEDOR', etiqueta: 'Pago a proveedor', prefijo: 'PAG', signo: -1,
      etiqueta_entidad: 'Proveedor', pide_boleta: false, foto: 'OPCIONAL', pide_receptor: false },
    { codigo: 'GASTO', etiqueta: 'Gasto o compra urgente', prefijo: 'GAS', signo: -1,
      etiqueta_entidad: null, pide_boleta: false, foto: 'OPCIONAL', pide_receptor: true },
];

vi.mock('../../src/data/bolsas', () => ({
    fetchTiposDeSalida: vi.fn(async () => TIPOS),
    fetchEntidadesDeSalida: vi.fn(async () => [{ tipo: 'REMESA', nombre: 'RIA' }]),
    registrarSalida: (...a) => registrarSalida(...a),
    subirComprobante: vi.fn(async () => 'https://x/f.jpg'),
    identificarPorCarne: vi.fn(),
    identificarPorUsuario: vi.fn(),
}));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../src/store/toastStore', () => ({ useToastStore: () => vi.fn() }));

const SalidaDeBolsa = (await import('../../src/components/bolsas/SalidaDeBolsa')).default;

const BOLSAS = [{ id: 1, folio: 'BOL-1', branch_id: 3, estado: 'ABIERTA',
    fecha: '2026-08-18', hora: '18:00:00', monto_inicial: 500 }];
const SALDOS = new Map([[1, { bolsa_id: 1, saldo: 500 }]]);

const abrir = async () => {
    const r = render(
        <SalidaDeBolsa abierto bolsas={BOLSAS} saldos={SALDOS} onClose={() => {}} onHecho={() => {}} />,
    );
    // Los dos `fetch` del catálogo resuelven en microtareas.
    await act(async () => {});
    return r;
};

/** Elegir un motivo en el `LiquidSelect`, que es un botón + lista. */
const elegirMotivo = async (etiqueta) => {
    fireEvent.click(screen.getByLabelText('Motivo de la salida'));
    await act(async () => {});
    fireEvent.click(screen.getByText(etiqueta));
    await act(async () => {});
};

const escribirMonto = async (v) => {
    fireEvent.change(screen.getByLabelText(/Cuánto/i), { target: { value: v } });
    await act(async () => {});
};

beforeEach(() => { registrarSalida.mockClear(); });

describe('SalidaDeBolsa — el catálogo decide qué se pide', () => {
    it('sin motivo elegido no dibuja ningún campo del motivo', async () => {
        await abrir();
        expect(screen.queryByText(/Número de boleta/i)).toBeNull();
        expect(screen.queryByText(/Foto del comprobante/i)).toBeNull();
        expect(screen.queryByText(/Remesadora/i)).toBeNull();
    });

    // Lo que el usuario pidió quitar: el pago a proveedor no pasa por el POS.
    it('«Pago a proveedor» no pide boleta y su foto dice que es opcional', async () => {
        await abrir();
        await elegirMotivo('Pago a proveedor');
        expect(screen.queryByText('Número de boleta')).toBeNull();
        expect(screen.getByText(/Foto del comprobante \(opcional\)/i)).toBeTruthy();
    });

    // Y sin foto se puede registrar — que es todo el punto de 'OPCIONAL'.
    it('«Pago a proveedor» se registra SIN foto y sin identificar a nadie', async () => {
        await abrir();
        await elegirMotivo('Pago a proveedor');
        fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'Droguería X' } });
        await escribirMonto('120.50');

        fireEvent.click(screen.getByRole('button', { name: /Registrar e imprimir/i }));
        await act(async () => {});

        expect(registrarSalida).toHaveBeenCalledTimes(1);
        const arg = registrarSalida.mock.calls[0][0];
        expect(arg.tipo).toBe('PAGO_PROVEEDOR');
        expect(arg.monto).toBe(120.5);
        expect(arg.fotoUrl).toBeNull();
        // El cobrador del proveedor no es de la empresa: no hay a quién pedirle
        // carné, y por eso el motivo no lo pide.
        expect(arg.recibidoPor).toBeNull();
        expect(arg.vale).toBeNull();
    });

    // La remesa NO se relajó: es la única que pasa por el POS.
    it('la remesa sigue exigiendo boleta y foto', async () => {
        await abrir();
        await elegirMotivo('Remesa entregada a un cliente');
        expect(screen.getByText('Número de boleta')).toBeTruthy();
        expect(screen.getByText('Foto del comprobante')).toBeTruthy();
        expect(screen.queryByText(/Foto del comprobante \(opcional\)/i)).toBeNull();
    });

    // Un motivo con receptor no se registra desde el formulario: primero hay
    // que identificar a quien se lo lleva, y eso es un paso propio (el lector
    // es un `keydown` global y no puede convivir con campos de texto).
    it('«Gasto» manda a identificar antes de registrar', async () => {
        await abrir();
        await elegirMotivo('Gasto o compra urgente');
        await escribirMonto('40');

        expect(screen.queryByRole('button', { name: /Registrar e imprimir/i })).toBeNull();
        const seguir = screen.getByRole('button', { name: /Continuar/i });
        expect(seguir.disabled).toBe(false);

        fireEvent.click(seguir);
        await act(async () => {});

        // Segundo paso: el formulario ya no está y el botón no puede escribir
        // hasta que haya alguien reconocido.
        expect(screen.queryByLabelText(/Cuánto/i)).toBeNull();
        expect(screen.getByText(/Falta identificar a quien se lo lleva/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: /Registrar e imprimir/i }).disabled).toBe(true);
        expect(registrarSalida).not.toHaveBeenCalled();
    });

    // La coma del teclado en español no puede perderse: es dinero.
    it('el monto acepta coma y la guarda con punto', async () => {
        await abrir();
        await elegirMotivo('Pago a proveedor');
        fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'Droguería X' } });
        await escribirMonto('120,50');

        expect(screen.getByLabelText(/Cuánto/i).value).toBe('120.50');

        fireEvent.click(screen.getByRole('button', { name: /Registrar e imprimir/i }));
        await act(async () => {});
        expect(registrarSalida.mock.calls[0][0].monto).toBe(120.5);
    });
});
