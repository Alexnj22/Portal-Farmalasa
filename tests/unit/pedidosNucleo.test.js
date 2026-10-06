import { describe, expect, it } from 'vitest';
import {
    cifrasDelRenglon, estadoDeDiferencia, filtrarPedidos, indicadoresDePedidos, minutosLegibles,
    pasosDelPedido, rangoDeMes, resumenDeRecepcion, seccionesDeRenglones, tieneObservacion,
} from '@nucleo/utils/tableroDePedidos';

describe('pedidos — núcleo compartido con la app', () => {
    it('rangoDeMes da el primer y el último día', () => {
        expect(rangoDeMes(0, new Date(2026, 1, 10))).toBe('2026-02-01|2026-02-28');
        expect(rangoDeMes(-1, new Date(2026, 0, 5))).toBe('2025-12-01|2025-12-31');
    });

    it('un completado con observación no se esconde del filtro por defecto', () => {
        const rows = [
            { pedido_id: 1, pedido_status: 'completado', recibido_erp_at: 'x', created_at: '2026-10-02' },
            { pedido_id: 2, pedido_status: 'completado', recibido_erp_at: 'x', llegada_tipo: 'falta_caja', created_at: '2026-10-02' },
            { pedido_id: 3, pedido_status: 'confirmado', created_at: '2026-09-02' },
        ];
        expect(filtrarPedidos(rows).map(r => r.pedido_id)).toEqual([2, 3]);
        expect(filtrarPedidos(rows, { estado: 'completado' }).map(r => r.pedido_id)).toEqual([1, 2]);
        expect(filtrarPedidos(rows, { rango: '2026-10-01|2026-10-31' }).map(r => r.pedido_id)).toEqual([2]);
    });

    it('lo que no entró al inventario es observación', () => {
        expect(tieneObservacion({}, 0)).toBe(false);
        expect(tieneObservacion({}, 2)).toBe(true);
        expect(tieneObservacion({ cajas_especiales_llegadas: { a: 'faltante' } })).toBe(true);
    });

    it('los pasos traen quién y suman los extras', () => {
        const gente = { a: { id: 'a', name: 'Ana' }, b: { id: 'b', name: 'Beto' } };
        const pasos = pasosDelPedido(
            { created_at: 't0', created_by: 'a', enviado_at: 't3', enviado_por: 'b', falta_caja_at: 't5', llegada_tipo: 'mixto', diferencias_reportadas_at: 't6' },
            { quien: id => gente[id] ?? null, conductor: gente.b, entrega: { entregado_at: 't4' } },
        );
        expect(pasos.slice(0, 7).map(p => p.key)).toEqual(['confirmado', 'iniciado', 'preparado', 'enviado', 'ruta_entregado', 'llegada', 'erp']);
        expect(pasos[0].emp.name).toBe('Ana');
        expect(pasos[4].emp.name).toBe('Beto');                // sin entregado_por: el conductor
        expect(pasos.find(p => p.key === 'falta_caja').label).toBe('Dañada + Falta');
        expect(pasos.filter(p => p.extra).map(p => p.key)).toEqual(['falta_caja', 'diferencias', 'corregido']);
    });

    it('secciones, recepción y cifras', () => {
        const s = seccionesDeRenglones([{ cantidad_asignada: 2 }, { cantidad_asignada: 0, sin_stock: true }]);
        expect([s.enviados.length, s.sinStock.length, s.total]).toEqual([1, 1, 2]);
        const r = resumenDeRecepcion({ llegada_tipo: 'caja_danada', reenvios_historial: [{}] }, [{ resolucion_status: 'confirmada' }, {}]);
        expect(r).toMatchObject({ llegada: 'Caja dañada', reenvios: 1, difResueltas: 1, difPendientes: 1 });
        expect(cifrasDelRenglon({ cantidad_asignada: 5, cantidad_recibida: 3 }).delta).toBe(-2);
        expect(estadoDeDiferencia({ resolucion_status: 'escalada' })).toBe('Lo ve supervisión');
    });

    it('indicadores promedian sin los negativos y agrupan por sucursal', () => {
        const ind = indicadoresDePedidos([
            { pedido_id: 1, erp_sucursal_id: 2, tiempo_prep_neto_min: 30, num_pausas: 1 },
            { pedido_id: 1, erp_sucursal_id: 3, tiempo_prep_neto_min: 50, num_pausas: 0 },
            { pedido_id: 2, erp_sucursal_id: 2, tiempo_prep_neto_min: -1 },
        ], id => `S${id}`);
        expect(ind.pedidos).toBe(2);
        expect(ind.prep).toBe(40);
        expect(ind.porSucursal[0]).toMatchObject({ id: 2, nombre: 'S2', pedidos: 2, prep: 30, pausas: 1 });
        expect(minutosLegibles(125)).toBe('2h 5m');
        expect(minutosLegibles(null)).toBe('—');
    });
});

describe('pedidos — cuentas y rótulos', () => {
    it('pedidosPorSala cuenta dentro del rango', async () => {
        const { pedidosPorSala } = await import('@nucleo/utils/tableroDePedidos');
        const c = pedidosPorSala([{ erp_sucursal_id: 2, created_at: '2026-10-02' }, { erp_sucursal_id: 2, created_at: '2026-09-02' }], '2026-10-01|2026-10-31');
        expect(c.get(2)).toBe(1);
    });
    it('rotuloDePresentacion', async () => {
        const { rotuloDePresentacion } = await import('@nucleo/utils/tableroDePedidos');
        expect(rotuloDePresentacion({ dispatch_tipo: 'caja', dispatch_factor: 12 })).toBe('Caja ×12');
        expect(rotuloDePresentacion({ factor: 1 })).toBe('Unidad');
        expect(rotuloDePresentacion({ dispatch_tipo: 'multiplo', dispatch_factor: 3 })).toBe('Unid ×3');
    });
});
