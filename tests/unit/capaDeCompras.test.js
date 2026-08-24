// La capa de datos de Compras y Cuentas por Pagar.
//
// Acá el error se paga con dinero, y el modo de falla es el mismo que en toda
// esta parte del portal: **no falla, cuadra mal**. Dos decisiones de fondo se
// anclan porque no se ven desde el código de la pantalla:
//
//   · `compra_pagos` y `compra_pago_aplicado` **no tienen policy de escritura a
//     propósito**. Un INSERT suelto podría aplicar a una factura más de lo que
//     se le debe, y ese error no se ve hasta que el saldo no cuadra contra el
//     banco. La validación vive en `registrar_pago_compra`, que es lo único que
//     puede mirar el saldo del documento ANTES de escribir;
//   · **el monto del pago es la SUMA de lo aplicado**, no un número aparte, así
//     no puede existir un pago de $500 repartido en $300.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const { fetchCuentasPorPagar, fetchDetalleProveedor, fetchPagos, registrarPago,
        aprobarPago, anularPago, guardarCondicionesProveedor } =
    await import('../../src/data/cuentasPorPagar');
const { fetchProveedoresMaestro, fetchProveedorCategorias, setProveedorCategoria,
        setProveedoresCategoriaBulk } = await import('../../src/data/proveedores');
const { fetchPurchaseReceiptItems, fetchPurchaseReceiptsPage, fetchSuppliersBasic } =
    await import('../../src/data/compras');

beforeEach(() => espia.limpiar());

describe('el dinero se mueve SÓLO por función', () => {
    it('registrar un pago no toca la tabla', async () => {
        await registrarPago({ emisorNit: '0614-1', fecha: '2026-08-24', forma: 'CHEQUE',
                              referencia: '  ', aplicaciones: [{ document_id: 1, monto: 300 }], nota: '' });
        expect(espia.rpc[0].nombre).toBe('registrar_pago_compra');
        expect(espia.uso('insert')).toBe(false);
        expect(espia.uso('update')).toBe(false);
    });

    it('el monto no viaja aparte: van las APLICACIONES', async () => {
        // Un total propio podría no coincidir con lo repartido, y ese descuadre
        // no aparece hasta conciliar contra el banco.
        await registrarPago({ emisorNit: '0614-1', fecha: '2026-08-24', forma: 'CHEQUE',
                              aplicaciones: [{ document_id: 1, monto: 300 }, { document_id: 2, monto: 200 }] });
        const args = espia.rpc[0].args;
        expect(args.p_aplicaciones).toHaveLength(2);
        expect(Object.keys(args)).not.toContain('p_monto');
    });

    it('una referencia o nota en blanco viajan como null', async () => {
        await registrarPago({ emisorNit: '0614-1', fecha: '2026-08-24', forma: 'EFECTIVO',
                              referencia: '', aplicaciones: [], nota: '' });
        expect(espia.rpc[0].args.p_referencia).toBeNull();
        expect(espia.rpc[0].args.p_nota).toBeNull();
    });

    it('aprobar y anular son funciones distintas, y anular exige motivo', async () => {
        // El pago queda PENDIENTE hasta que Gerencia lo apruebe: el cheque
        // todavía no salió, así que no baja el saldo — pero sí se ve como «en
        // trámite», que es lo que evita pagar dos veces la misma factura.
        await aprobarPago(9);
        expect(espia.rpc[0]).toEqual({ nombre: 'aprobar_pago_compra', args: { p_pago_id: 9 } });
        espia.limpiar();
        await anularPago(9, 'el cheque se anuló');
        expect(espia.rpc[0].nombre).toBe('anular_pago_compra');
        expect(Object.values(espia.rpc[0].args)).toContain('el cheque se anuló');
    });

    it('un fallo devuelve el mensaje, no lanza', async () => {
        // Quien llama es un formulario: un throw ahí deja el diálogo abierto sin
        // decir nada, y el usuario vuelve a apretar.
        const r = await registrarPago({ emisorNit: 'x', fecha: 'y', forma: 'z', aplicaciones: [] });
        expect(r).toHaveProperty('error');
        expect(r).toHaveProperty('pagoId');
    });
});

describe('lo que le debemos a cada proveedor', () => {
    it('se cuenta desde la fecha del DTE, no desde la compra registrada', async () => {
        // Decisión del usuario (2026-08-16): es lo que el proveedor va a cobrar
        // exista o no la carga, y así aparecen las facturas que llegaron por
        // correo y nadie registró — que hoy no están en ningún otro control.
        await fetchCuentasPorPagar('2026-01-01');
        expect(espia.rpc[0]).toEqual({ nombre: 'get_cuentas_por_pagar', args: { p_desde: '2026-01-01' } });
    });

    it('sin fecha desde manda null, no la de hoy', async () => {
        await fetchCuentasPorPagar();
        expect(espia.rpc[0].args.p_desde).toBeNull();
    });

    it('el detalle y los pagos se piden por NIT del emisor', async () => {
        await fetchDetalleProveedor('0614-1');
        expect(Object.values(espia.rpc[0].args)).toContain('0614-1');
        espia.limpiar();
        await fetchPagos('0614-1');
        expect(espia.rpc[0].nombre).toBe('get_pagos_compra');
    });

    it('las condiciones de crédito se guardan por función', async () => {
        // El límite de crédito decide si se le puede seguir comprando: un UPDATE
        // suelto lo cambiaría sin que nadie lo revise.
        await guardarCondicionesProveedor(3, { diasCredito: 30, limiteCredito: 5000, formaPago: 'CHEQUE' });
        expect(espia.rpc[0].nombre).toBe('set_proveedor_condiciones_credito');
        expect(espia.uso('update')).toBe(false);
    });

    it('sin datos devuelve filas vacías y el error aparte', async () => {
        const r = await fetchCuentasPorPagar();
        expect(Array.isArray(r.filas)).toBe(true);
        expect(r).toHaveProperty('error');
    });
});

describe('el maestro de proveedores', () => {
    it('el maestro sale de una función, no de la tabla', async () => {
        await fetchProveedoresMaestro();
        expect(espia.rpc[0].nombre).toBe('get_proveedores_maestro');
        expect(espia.uso('from')).toBe(false);
    });

    it('las categorías salen ordenadas por clase y después por nombre', async () => {
        // Es una lista agrupada: ordenarla sólo por nombre mezcla las clases.
        fetchProveedorCategorias();
        expect(espia.todos('order')).toEqual([['clase'], ['nombre']]);
    });

    it('clasificar uno o varios son funciones distintas', async () => {
        // La de lote existe para no disparar N llamadas y para que la regla se
        // aplique en una sola transacción.
        await setProveedorCategoria(3, 7);
        expect(espia.rpc[0]).toEqual({ nombre: 'set_proveedor_categoria', args: { p_id: 3, p_categoria_id: 7 } });
        espia.limpiar();
        await setProveedoresCategoriaBulk([3, 4, 5], 7);
        expect(espia.rpc[0].nombre).toBe('set_proveedores_categoria_bulk');
    });
});

describe('las recepciones de bodega', () => {
    it('la lista pagina con un rango, y ordena TOTAL', async () => {
        // `range()` corta por posición: sin el desempate por `id`, dos compras
        // de la misma fecha pueden repartirse mal entre dos páginas.
        fetchPurchaseReceiptsPage({ from: 0, to: 49 });
        expect(espia.primero('range')).toEqual([0, 49]);
        expect(espia.todos('order')).toEqual([
            ['fecha', { ascending: false }], ['id', { ascending: false }],
        ]);
    });

    it('los renglones salen en el orden del documento', async () => {
        // Un renglón fuera de lugar no se nota, y el papel del proveedor tiene
        // otro orden: cotejar deja de ser mecánico.
        fetchPurchaseReceiptItems(9);
        expect(espia.primero('order')).toEqual(['linea_num']);
        expect(espia.primero('eq')).toEqual(['receipt_id', 9]);
    });

    it('el catálogo de proveedores del filtro sale por nombre', () => {
        fetchSuppliersBasic();
        expect(espia.primero('order')).toEqual(['nombre']);
    });
});
