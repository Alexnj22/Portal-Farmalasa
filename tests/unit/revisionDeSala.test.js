import { describe, expect, it } from 'vitest';
import { cuentaADescartar, estadoAjuste, filaPasaFiltros, mensajeDePublicacion, motivoDeSaltoDelCalculo } from '@nucleo/utils/revisionDeSala';

const fila = (x) => ({ erp_product_id: 1, draft_status: 'none', effective_min: 2, effective_max: 4, alert_status: 'ok', abc_class: 'A', demand_variability: 'stable', ...x });

describe('revisionDeSala', () => {
    it('filtra borradores, cambios, ABC, XYZ y alerta', () => {
        expect(filaPasaFiltros(fila({ draft_status: 'pending' }), { soloBorradores: true })).toBe(true);
        expect(filaPasaFiltros(fila(), { soloBorradores: true })).toBe(false);
        expect(filaPasaFiltros(fila({ draft_status: 'pending', draft_min: 2, draft_max: 4 }), { soloCambios: true })).toBe(false);
        expect(filaPasaFiltros(fila({ draft_status: 'pending', draft_min: 3, draft_max: 4 }), { soloCambios: true })).toBe(true);
        expect(filaPasaFiltros(fila(), { abc: 'B' })).toBe(false);
        expect(filaPasaFiltros(fila({ draft_abc_class: 'B' }), { abc: 'B' })).toBe(true);
        expect(filaPasaFiltros(fila(), { xyz: 'X' })).toBe(true);
        expect(filaPasaFiltros(fila(), { alerta: 'below_min' })).toBe(false);
    });

    it('los ocultos sólo se ven en su vista, y el catálogo sin venta sólo con «sin datos» o búsqueda', () => {
        const ocultos = new Set([1]);
        expect(filaPasaFiltros(fila(), { ocultos })).toBe(false);
        expect(filaPasaFiltros(fila(), { ocultos, soloOcultos: true })).toBe(true);
        expect(filaPasaFiltros(fila({ is_catalog_only: true }), {})).toBe(false);
        expect(filaPasaFiltros(fila({ is_catalog_only: true }), { hayBusqueda: true })).toBe(true);
    });

    it('cuenta lo que se lleva descartar, borradores y datos escasos', () => {
        const rows = [fila({ _erp_sucursal_id: 1, draft_status: 'pending' }), fila({ _erp_sucursal_id: 1, draft_status: 'sparse_data' }), fila({ _erp_sucursal_id: 2, draft_status: 'pending' })];
        expect(cuentaADescartar(rows, 1)).toEqual({ borradores: 1, sinDatos: 1, total: 2 });
    });

    it('el motivo de un cálculo negado y el texto de publicar', () => {
        expect(motivoDeSaltoDelCalculo({ rows: 3 })).toBeNull();
        expect(motivoDeSaltoDelCalculo({ skipped: true, reason: 'module_locked', locked_by: 'Ana' })).toMatch(/mantenimiento por Ana/);
        expect(mensajeDePublicacion({ published: 1 }).texto).toBe('Se publicaron 1 borrador');
        expect(mensajeDePublicacion({ published: 5, omitidas_por_ajuste_manual: 2 })).toMatchObject({ aviso: true });
    });

    it('un ajuste a mano sin motivo es «a mano»; con motivo y borrador distinto, en conflicto', () => {
        expect(estadoAjuste(fila())).toBeNull();
        expect(estadoAjuste(fila({ _manual_at: '2026-10-01' }))).toBe('a_mano');
        expect(estadoAjuste(fila({ _manual_at: '2026-10-01', _manual_motivo: 'x', draft_status: 'pending', draft_min: 9, draft_max: 9 }))).toBe('en_conflicto');
    });
});
