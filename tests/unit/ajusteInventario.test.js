import { describe, it, expect } from 'vitest';
import { solicitudDeMinMax, mensajeDeMinMax } from '@nucleo/utils/minmaxSolicitud';
import { problemasDeLinea, llevaControlDeLote, causaObligatoria, solicitudDeAjuste, OPERACIONES_AJUSTE, unidadesEnSala, topeDeLinea } from '@nucleo/utils/ajusteInventario';

describe('ajusteInventario', () => {
    it('una carga sin saber si lleva lote EXIGE el lote (AVAMYS)', () => {
        expect(problemasDeLinea({ cantidad: 2, lote: '', vence: '' }, { llevaLote: null, esCarga: true })).toEqual(['lote', 'vence']);
        expect(problemasDeLinea({ cantidad: 2 }, { llevaLote: false, esCarga: true })).toEqual([]);
    });
    it('un descargo no puede pasar la existencia', () => {
        expect(problemasDeLinea({ cantidad: 5, existencia: 3 }, { llevaLote: false, esCarga: false })).toContain('sin existencia');
    });
    it('perecedero pide vencimiento aunque no lleve lote', () => {
        expect(problemasDeLinea({ cantidad: 1 }, { llevaLote: false, esCarga: true, esPerecedero: true })).toEqual(['vence']);
    });
    it('lleva lote: descargo = hay lotes; carga = regulado', () => {
        expect(llevaControlDeLote({}, { esCarga: false, lotes: [{}] })).toBe(true);
        expect(llevaControlDeLote({ regulado: false }, { esCarga: true })).toBe(false);
        expect(llevaControlDeLote({}, { esCarga: true })).toBe(null);
    });
    it('la causa es obligatoria siempre (la exige la base)', () => {
        expect(causaObligatoria('VENCIMIENTO', null)).toBe(true);
        expect(causaObligatoria('DESCARTE', 'CRUCE')).toBe(true);
    });
    it('arma la solicitud', () => {
        const op = OPERACIONES_AJUSTE.find(o => o.key === 'DESCARTE');
        const s = solicitudDeAjuste({ op, motivo: 'CRUCE', causa: ' x ', lineas: [{ erp_product_id: 1, descripcion: 'A', tipo: 'UNIDAD', factor: 1, cantidad: '2', lote: 'L1', vence: '', existencia: 5 }],
            usuarioId: 'u', aprobador: { id: 's', name: 'Sup' }, sala: { branchId: 2, nombre: 'LP', erpSucursalId: 5, erpUbicacionId: 7 } });
        expect(s.type).toBe('INVENTORY_DISCARD_REQUEST');
        expect(s.metadata).toMatchObject({ subtipo: 'DESCARTE', motivo_label: 'Cruce de producto', total_unidades: 2, erp_ubicacion_id: 7 });
        expect(s.metadata.items[0]).toMatchObject({ cantidad: 2, lote: 'L1', vence: null });
    });
});

describe('minmax — la solicitud y sus mensajes', () => {
    it('arma la fila con el retrato de hoy', () => {
        const s = solicitudDeMinMax({ producto: { id: 366, nombre: 'A' }, erpSucursalId: '5', actual: { min: 12, max: 30, sales6m: 706 },
            ventas: { unidadesMes: 3 }, min: 15, max: 40, motivo: '  ', usuario: { email: 'x@y', id: 'u', name: 'U' } });
        expect(s).toMatchObject({ erp_sucursal_id: 5, current_min: 12, requested_max: 40, reason: null, requested_by: 'x@y', current_sales_mes: 3 });
    });
    it('traduce los errores de la base', () => {
        expect(mensajeDeMinMax('MMCR_BODEGA')).toMatch(/Bodega/);
        expect(mensajeDeMinMax('x MMCR_SIN_CAMBIO', 'Salud 1')).toMatch(/Salud 1/);
    });
});

describe('la existencia de un descargo se cuenta en unidades', () => {
    // Una fila del inventario es un lote EN UNA PRESENTACIÓN: 2 cajas ×30.
    const filas = [
        { erp_product_id: 7, cantidad: 2, detalle: 'CAJA 1x30' },
        { erp_product_id: 7, cantidad: 5, detalle: 'UNIDAD' },
        { erp_product_id: 8, cantidad: 9, detalle: 'UNIDAD' },
    ];
    it('suma todas las filas del producto en unidades', () => {
        expect(unidadesEnSala(filas, 7)).toBe(65);
        expect(unidadesEnSala([{ erp_product_id: 7, cantidad: null }], 7)).toBeNull();
    });
    it('3 unidades de 2 cajas ×30 sí alcanzan', () => {
        const l = { cantidad: 3, factor: 1, unidadesEnSala: 60 };
        expect(problemasDeLinea(l, { llevaLote: false, esCarga: false })).toEqual([]);
    });
    it('en cajas el tope es la división entera', () => {
        const l = { cantidad: 3, factor: 30, unidadesEnSala: 65, tipo: 'CAJA' };
        expect(problemasDeLinea(l, { llevaLote: false, esCarga: false })).toContain('sin existencia');
        expect(topeDeLinea(l)).toBe(2);
    });
    it('la solicitud anota las unidades', () => {
        const op = OPERACIONES_AJUSTE.find(o => o.movimiento !== 'CARGA');
        const s = solicitudDeAjuste({ op, motivo: Object.keys({})[0], causa: 'x', lineas: [{ erp_product_id: 7, tipo: 'UNIDAD', factor: 1, cantidad: '3', unidadesEnSala: 60 }], usuarioId: 'u', sala: { branchId: 1, nombre: 'S', erpSucursalId: 1 } });
        expect(JSON.stringify(s)).toContain('"existencia":60');
    });
});

describe('descargar lo que no trae lote o fecha (2026-11-13)', async () => {
    const { cajaQuePide, lotesParaDescargar, problemasDeLinea, llevaControlDeLote } = await import('@nucleo/utils/ajusteInventario');
    const base = { cantidad: 2, factor: 1, unidadesEnSala: 10 };

    it('un regulado que sale de lo sin lote asignado pide lote y vencimiento de la caja', () => {
        const l = { ...base, lote: 'GENERICO', exige: { regulado: true, perecedero: false } };
        expect(cajaQuePide(l, { esCarga: false })).toBe('lote');
        expect(problemasDeLinea(l, { llevaLote: true, esCarga: false })).toContain('lote de la caja');
        const conCaja = { ...l, caja: { envio: { lote: 'AB1', vence: '2028-03-01' } } };
        expect(problemasDeLinea(conCaja, { llevaLote: true, esCarga: false })).toEqual([]);
    });

    it('un regulado con su lote real no pide nada', () => {
        expect(cajaQuePide({ ...base, lote: 'AB1', exige: { regulado: true } }, { esCarga: false })).toBeNull();
    });

    it('un perecedero sin control de lote y sin fecha pide sólo el vencimiento', () => {
        const l = { ...base, lote: '', exige: { regulado: false, perecedero: true }, conVence: false };
        expect(cajaQuePide(l, { esCarga: false })).toBe('vence');
        expect(cajaQuePide({ ...l, conVence: true }, { esCarga: false })).toBeNull();
    });

    it('al cargar no se pide nada de la caja', () => {
        expect(cajaQuePide({ ...base, lote: 'GENERICO', exige: { regulado: true } }, { esCarga: true })).toBeNull();
    });

    it('ofrece «sin lote asignado» sólo a un regulado con esa existencia', () => {
        const lotes = [{ lote: 'AB1', vence: '2028-03-01' }];
        expect(lotesParaDescargar(lotes, { regulado: true, sinLote: 4 })).toHaveLength(2);
        expect(lotesParaDescargar(lotes, { regulado: true, sinLote: 0 })).toHaveLength(1);
        expect(lotesParaDescargar(lotes, { regulado: false, sinLote: 4 })).toHaveLength(1);
    });

    it('un regulado lleva lote aunque la sala no tenga ninguno real', () => {
        expect(llevaControlDeLote({ exige: { regulado: true } }, { esCarga: false, lotes: [] })).toBe(true);
        expect(llevaControlDeLote({ exige: { regulado: false } }, { esCarga: false, lotes: [] })).toBe(false);
    });

    it('el vencimiento de una carga es un mes completo', () => {
        const l = { cantidad: 1, lote: 'X1', vence: '2028-0' };
        expect(problemasDeLinea(l, { llevaLote: true, esCarga: true })).toContain('vence');
        expect(problemasDeLinea({ ...l, vence: '2028-03-01' }, { llevaLote: true, esCarga: true })).toEqual([]);
    });
});
