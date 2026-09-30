import { describe, it, expect } from 'vitest';
import { solicitudDeMinMax, mensajeDeMinMax } from '@nucleo/utils/minmaxSolicitud';
import { problemasDeLinea, llevaControlDeLote, causaObligatoria, solicitudDeAjuste, OPERACIONES_AJUSTE } from '@nucleo/utils/ajusteInventario';

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
