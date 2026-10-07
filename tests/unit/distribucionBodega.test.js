import { describe, it, expect } from 'vitest';
import {
    estadoDeVencimiento, leerEntero, enteroOpcional, lotesConDias, filtrarLotes, resumenDeLotes, costosDelCatalogo,
    resumenDeConteo, renglonesDeConteo, productoPorCodigo, filasDeReposicion, resumenDeReposicion, pedidoSugeridoCsv,
    existenciasPorProducto, medicamentoDeSrs,
} from '@nucleo/utils/distribucionBodega';
import { listadosDeRetenciones, archivoDeRetencion, filasRelacionadas, serieDeUtilidad } from '@nucleo/utils/distribucionReportes';

const HOY = '2026-10-07';

describe('bodega de la distribuidora', () => {
    it('vencimiento: vencido, por vencer, lejos y sin fecha', () => {
        expect(estadoDeVencimiento('2026-10-01', HOY)).toEqual({ variant: 'danger', texto: 'Vencido hace 6 d' });
        expect(estadoDeVencimiento(HOY, HOY).texto).toBe('Vence hoy');
        expect(estadoDeVencimiento('2026-12-01', HOY).variant).toBe('warning');
        expect(estadoDeVencimiento('2027-12-01', HOY).variant).toBe('success');
        expect(estadoDeVencimiento(null, HOY).texto).toBe('Sin fecha');
    });
    it('enteros: 0 vale; vacío del mín/máx es automático y basura es NaN', () => {
        expect(leerEntero('0')).toBe(0);
        expect(leerEntero('2.5')).toBeNull();
        expect(enteroOpcional('')).toBeNull();
        expect(enteroOpcional('x')).toBeNaN();
    });
    it('lotes: costo por emisor y producto, filtros y resumen', () => {
        const costos = costosDelCatalogo([{ emisor_id: 1, product_id: 10, costo_promedio: '2' }, { emisor_id: 1, product_id: 11, costo_promedio: null }]);
        const lotes = lotesConDias([
            { id: 1, emisor_id: 1, product_id: 10, nombre: 'A', lote: 'L1', vence: '2026-10-01', existencia: 5 },
            { id: 2, emisor_id: 1, product_id: 11, nombre: 'B', lote: 'L2', vence: '2026-11-01', existencia: 3 },
            { id: 3, emisor_id: 1, product_id: 11, nombre: 'B', lote: 'L3', vence: null, existencia: 0 },
        ], costos, HOY);
        expect(lotes[0].valor).toBe(10);
        expect(lotes[1].costo).toBeNull();
        expect(filtrarLotes(lotes).map(l => l.id)).toEqual([1, 2]);
        expect(filtrarLotes(lotes, { filtro: 'agotados' }).map(l => l.id)).toEqual([3]);
        expect(filtrarLotes(lotes, { filtro: 'vencidos' }).map(l => l.id)).toEqual([1]);
        expect(filtrarLotes(lotes, { filtro: 'porVencer' }).map(l => l.id)).toEqual([2]);
        expect(resumenDeLotes(lotes)).toEqual({ productos: 2, unidades: 8, porVencer: 1, vencidos: 1, valor: 10, sinCosto: 1 });
    });
    it('conteo: contados, diferencias al costo, filtro por producto escaneado', () => {
        const conteo = { items: [
            { id: 1, product_id: 10, nombre: 'A', lote: 'L1', sistema: 5, contado: 3, costo: 2 },
            { id: 2, product_id: 11, nombre: 'B', lote: 'L2', sistema: 1, contado: 2, costo: 4 },
            { id: 3, product_id: 11, nombre: 'B', lote: 'L3', sistema: 1, contado: null, costo: 4 },
        ] };
        expect(resumenDeConteo(conteo)).toEqual({ faltante: 4, sobrante: 4, conDif: 2, contados: 2, total: 3 });
        expect(renglonesDeConteo(conteo, { soloSinContar: true }).map(i => i.id)).toEqual([3]);
        expect(renglonesDeConteo(conteo, { producto: 11 }).map(i => i.id)).toEqual([2, 3]);
        expect(productoPorCodigo([{ product_id: 10, codigo_barras: '7401 ' }], '7401').product_id).toBe(10);
        expect(productoPorCodigo([], '')).toBeNull();
    });
    it('reposición: bajo el mínimo, compra sugerida y CSV por proveedor', () => {
        const datos = { productos: [
            { product_id: 1, nombre: 'Zeta', proveedor: 'B', sugerido: 2, costo: '1.5', disponible: 0, minimo: 1, maximo: 2, vencido: 0 },
            { product_id: 2, nombre: 'Alfa', proveedor: 'A', sugerido: 1, costo: null, disponible: 0, minimo: 1, maximo: 1, vencido: 3 },
            { product_id: 3, nombre: 'Beta', proveedor: 'A', sugerido: 0, costo: '9', disponible: 5, minimo: 1, maximo: 2, vencido: 0 },
        ] };
        expect(filasDeReposicion(datos).length).toBe(2);
        expect(filasDeReposicion(datos, { soloBajo: false }).length).toBe(3);
        expect(resumenDeReposicion(datos)).toEqual({ todos: 3, bajo: 2, costoSugerido: 3, vencidos: 1 });
        const csv = pedidoSugeridoCsv(datos);
        expect(csv.rows.map(r => r[1])).toEqual(['Alfa', 'Zeta']);
        expect(csv.rows[1].slice(6)).toEqual(['1.5000', '3.00']);
    });
    it('existencias por sala: suma lotes y presentaciones, sin vencidos', () => {
        const r = existenciasPorProducto([
            { erp_product_id: 9, descripcion: 'X', erp_sucursal_id: 1, cantidad: 2, factor: 10 },
            { erp_product_id: 9, descripcion: 'X', erp_sucursal_id: 1, cantidad: 3, factor: 1 },
            { erp_product_id: 9, descripcion: 'X', erp_sucursal_id: 2, cantidad: 5, factor: 1, is_vencidos: true },
        ]);
        expect(r[0].salas.get(1)).toBe(23);
        expect(r[0].salas.has(2)).toBe(false);
    });
    it('SRS: limpia la basura invisible y arma el principio con su concentración', () => {
        const m = medicamentoDeSrs({ nombre_comercial: 'AMOXIL ', formula: 'Amoxicilina', concentracion: '500 mg', estatus: 'A', noregistro: 'F1' });
        expect(m).toMatchObject({ nombre: 'AMOXIL', principio: 'Amoxicilina 500 mg', activo: true, registro: 'F1' });
    });
});

describe('reportes de la distribuidora: lo que antes armaba la pantalla', () => {
    it('retenciones: cuatro listados con su total y su archivo', () => {
        const ventas = { contribuyente: [{ tipo_dte: '03', cliente: 'C', numero_control: 'N1', ventas_gravadas: 100, debito_fiscal: 13, retenido: 1, percibido: 0 }] };
        const l = listadosDeRetenciones(ventas, []);
        expect(l.map(x => x.clave)).toEqual(['ret', 'perc', 'percProv', 'retProv']);
        expect(l[0].total).toBe(1);
        const a = archivoDeRetencion(l[0], '2026-10');
        expect(a.nombre).toBe('iva-retenido-sobre-ventas-torogoz-2026-10.csv');
        expect(a.rows.length).toBeGreaterThan(0);
    });
    it('relacionadas y serie diaria', () => {
        const f = filasRelacionadas({ productos: [{ product_id: 1, nombre: 'P', pagado_u: 1 }], referencias: { 1: { costo_farmalasa: 2 } } });
        expect(f[0].avisos[0].clave).toBe('bajo_costo');
        expect(serieDeUtilidad([{ fecha: '2026-10-01', venta: '10', costo: '7.5' }])[0].utilidad).toBe(2.5);
    });
});
