import { describe, it, expect } from 'vitest';
import {
    estadoLicencia, filtrarClientes, resumenDeClientes, erroresDeCliente, clienteParaGuardar, CLIENTE_VACIO, clienteAFormulario,
    leerFormularioDePrecio, leerFormularioDeProveedor, mensajeDeProveedor, compraVacia, payloadDeCompra, compraConMontosCalculados,
    compraDesdeDetalle, resumenDeCompras, erroresDeEmisor, emisorParaGuardar, EMISOR_VACIO, nuevoUuid, filtrarCatalogo,
} from '@nucleo/utils/distribucionComercial';

// Las reglas comerciales de Torogoz que comparten el portal y la app nativa.
const HOY = '2026-10-07';

describe('clientes', () => {
    it('la licencia: sin, vencida, por vencer (30 días) o vigente', () => {
        expect(estadoLicencia({}, HOY).label).toBe('Sin licencia');
        expect(estadoLicencia({ licencia_srs: 'X', licencia_srs_vence: '2026-10-06' }, HOY).label).toBe('Vencida');
        expect(estadoLicencia({ licencia_srs: 'X', licencia_srs_vence: '2026-11-06' }, HOY).label).toBe('Vence pronto');
        expect(estadoLicencia({ licencia_srs: 'X', licencia_srs_vence: '2026-11-07' }, HOY).label).toBe('Vigente');
        expect(estadoLicencia({ licencia_srs: 'X' }, HOY).label).toBe('Vigente');
    });

    it('busca un NIT por sus dígitos, escrito con o sin guiones', () => {
        const cs = [{ id: 1, nombre: 'Tienda A', num_documento: '04071503901234', tipo: 'tienda', activo: true },
            { id: 2, nombre: 'Farmacia B', num_documento: '99', tipo: 'farmacia', activo: true }];
        expect(filtrarClientes(cs, { buscar: '0407-150390', hoy: HOY }).map(c => c.id)).toEqual([1]);
        expect(filtrarClientes(cs, { tipo: 'farmacia', hoy: HOY }).map(c => c.id)).toEqual([2]);
        expect(filtrarClientes(cs, { soloSinLicencia: true, hoy: HOY })).toHaveLength(2);
        expect(resumenDeClientes(cs, HOY)).toEqual({ activos: 2, contribuyentes: 0, sinLicencia: 2, credito: 0 });
    });

    it('un contribuyente exige NIT, actividad y dirección completa', () => {
        const e = erroresDeCliente({ ...CLIENTE_VACIO, nombre: 'X', nrc: '1234' });
        expect(Object.keys(e).sort()).toEqual(['cod_actividad', 'direccion', 'num_documento']);
        expect(erroresDeCliente({ ...CLIENTE_VACIO, nombre: 'X' })).toEqual({});
        expect(erroresDeCliente({ ...CLIENTE_VACIO, nombre: 'X', plazo_dias: '121' }).plazo_dias).toBeTruthy();
        expect(erroresDeCliente({ ...CLIENTE_VACIO, nombre: 'X', telefono: '2222' }).telefono).toBeTruthy();
    });

    it('lo que se guarda: NIT sin guiones, gran contribuyente sólo con NRC, la ruta por id', () => {
        const f = { ...CLIENTE_VACIO, nombre: ' Tienda ', tipo_documento: '36', num_documento: '0407-150390-123-4', gran_contribuyente: true, ruta_id: '3' };
        const g = clienteParaGuardar(f, { id: 7, emisorId: 1 });
        expect(g).toMatchObject({ id: 7, emisor_id: 1, nombre: 'Tienda', num_documento: '04071503901234', gran_contribuyente: false, ruta_id: 3, ruta: null, limite_credito: 0, plazo_dias: 0 });
        expect(clienteAFormulario({ nombre: 'A', nrc: null, limite_credito: 10 }).nrc).toBe('');
    });
});

describe('catálogo', () => {
    it('el precio en centavos exactos, el % entre 0 y 100 y el aviso bajo costo', () => {
        expect(leerFormularioDePrecio({ precio: '1.955', descPct: '' }).precioNum).toBeNull();
        const l = leerFormularioDePrecio({ precio: '1,13', descPct: '50', tope: '', costo: 0.6 });
        expect(l.precioNum).toBe(1.13);
        expect(l.bajoCosto).toBe(true);
        expect(l.descuento).toEqual({ descuento_pct: 50, descuento_desde: null, descuento_hasta: null, descuento_max_pct: null });
        expect(leerFormularioDePrecio({ precio: '1', descPct: '101' }).valido).toBe(false);
        expect(leerFormularioDePrecio({ precio: '1', descPct: '5', descDesde: '2026-10-09', descHasta: '2026-10-08' }).fechasMal).toBe(true);
    });

    it('los filtros: venta libre nunca incluye lo controlado', () => {
        const items = [{ nombre: 'A', venta_libre: true, controlado: true, activo: true }, { nombre: 'B', venta_libre: true, controlado: false, activo: false }];
        expect(filtrarCatalogo(items, { canal: 'libre', hoy: HOY }).map(p => p.nombre)).toEqual(['B']);
        expect(filtrarCatalogo(items, { canal: 'inactivo', hoy: HOY }).map(p => p.nombre)).toEqual(['B']);
    });
});

describe('proveedores y compras', () => {
    it('NIT de 9 a 14 dígitos, plazo hasta 180', () => {
        expect(leerFormularioDeProveedor({ nombre: 'P', nit: '0614-1234', plazo_dias: '30' }).errNit).toBe(true);
        expect(leerFormularioDeProveedor({ nombre: 'P', nit: '061412345', plazo_dias: '181' }).errPlazo).toBe(true);
        expect(leerFormularioDeProveedor({ nombre: 'P', nit: '', plazo_dias: '0' }).listo).toBe(true);
        expect(mensajeDeProveedor({ message: 'dup key dist_proveedores_nit' }, () => 'x')).toBe('Ya hay un proveedor con ese NIT.');
    });

    it('el payload de la compra: sólo renglones con producto, lote en mayúsculas, vence sólo al crédito', () => {
        const c = { ...compraVacia(HOY), proveedor_id: '4', numero: ' dte ', vence: '2026-11-01', gravada: '10', iva: '1.3', total: '11.3',
            items: [{ product_id: 9, cantidad: '2', costo_unitario: '5', lote: ' ab1 ', vence: '2027-01-01' }, { product_id: null }] };
        const p = payloadDeCompra(c);
        expect(p).toMatchObject({ proveedor_id: 4, numero: 'dte', condicion: 1, vence: null, total: 11.3 });
        expect(p.items).toEqual([{ product_id: 9, codigo_proveedor: null, descripcion_proveedor: null, unidades_por: 1, cantidad: 2, costo_unitario: 5, lote: 'AB1', vence: '2027-01-01' }]);
        expect(compraConMontosCalculados(c)).toMatchObject({ gravada: '10', iva: '1.3', total: '11.3', exenta: '0' });
    });

    it('el detalle ordena los renglones por id y pasa los montos a texto', () => {
        const c = compraDesdeDetalle({ id: 1, proveedor_id: 2, gravada: 0, exenta: null, dist_compra_items: [{ id: 5, cantidad: 1, costo_unitario: '2.5' }, { id: 3, cantidad: 2, costo_unitario: 1 }] });
        expect(c.items.map(i => i.key)).toEqual(['3', '5']);
        expect(c.gravada).toBe('0');
        expect(c.exenta).toBe('');
    });

    it('el resumen del mes cuenta sólo lo recibido y el IVA de los CCF', () => {
        const r = resumenDeCompras([{ estado: 'recibida', fecha: '2026-10-01', total: 10, iva: 1, tipo_doc: '03' },
            { estado: 'recibida', fecha: '2026-10-02', total: 5, iva: 0, tipo_doc: '01' },
            { estado: 'borrador', fecha: '2026-10-02', total: 99, iva: 9, tipo_doc: '03' },
            { estado: 'recibida', fecha: '2026-09-30', total: 7, iva: 1, tipo_doc: '03' }], '2026-10');
        expect(r).toEqual({ comprado: 15, credito: 1, documentos: 2, borradores: 1 });
    });

    it('nuevoUuid tiene forma v4 y no se repite', () => {
        const a = nuevoUuid();
        expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        expect(nuevoUuid()).not.toBe(a);
    });
});

describe('la empresa que factura', () => {
    it('exige NIT, NRC, actividad, dirección, teléfono, correo y los códigos de emisión', () => {
        const e = erroresDeEmisor(EMISOR_VACIO);
        expect(Object.keys(e).sort()).toEqual(['cod_actividad', 'correo', 'direccion', 'nit', 'nombre', 'nrc', 'telefono']);
        expect(erroresDeEmisor({ ...EMISOR_VACIO, establecimiento: 'X001' }).establecimiento).toBeTruthy();
        expect(emisorParaGuardar({ ...EMISOR_VACIO, nit: '0614-150390-101-2', cod_estable_mh: '' })).toMatchObject({ nit: '06141503901012', cod_estable_mh: null });
    });
});
