import { describe, it, expect } from 'vitest';
import {
    claveDeSalto, correlativo7, filaDeSaltoSolventado, nulosPendientes, saltosPendientes, saltosSolventados,
} from '@nucleo/utils/colasDeFacturacion';
import {
    alternarResumen, csvMatrizDeLaboratorio, csvVendedoresDePromocion, cuentaDelProducto, descuentosPorEstado,
    formaDeDescuento, ofertaDesdeDescuento, payloadDeDescuento, problemasAlCorregirDescuento, resumenElegido,
} from '@nucleo/utils/promocionesUtils';
import { cambioDeMeta, cambiosPorMeta, csvDelSemestre } from '@nucleo/utils/metasUtils';
import {
    archivoDeEncuesta, canalesCon, conMetaDeSucursal, enlaceDeEncuesta, encuestaBorrable, estadoDelResumen, loteParaResumir,
    numeroDeMetaEscrito, sucursalesCon,
} from '@nucleo/utils/encuestasClientes';

describe('saltos de correlativo', () => {
    const g = { branch_id: 2, tipo_documento: 'CCF', gap_from: 10, gap_to: 12 };
    it('separa pendientes de solventados y filtra por mes', () => {
        const res = [{ ...g, resolved_at: '2026-10-02T10:00:00Z' }];
        expect(saltosPendientes([g, { ...g, gap_from: 20, gap_to: 21 }], res)).toHaveLength(1);
        expect(saltosSolventados([g], res, '2026-10')[0].gap).toEqual(g);
        expect(saltosSolventados([g], res, '2026-09')).toHaveLength(0);
        expect(claveDeSalto(g)).toBe('2__CCF__10__12');
    });
    it('los nulos de Hacienda no cuentan acá', () => {
        const n = [{ id: 1, campos_nulos: ['recibido_mh'] }, { id: 2, campos_nulos: ['cliente'] }, { id: 3, campos_nulos: ['cliente'] }];
        expect(nulosPendientes(n, new Set([3])).map((x) => x.id)).toEqual([2]);
    });
    it('la fila solventada lleva comentario o null', () => {
        expect(filaDeSaltoSolventado(g, '  ', 'Ana')).toMatchObject({ comment: null, resolved_by: 'Ana', gap_from: 10 });
        expect(correlativo7(45)).toBe('0000045');
    });
});

describe('corregir un descuento', () => {
    it('valida lo que impide guardar', () => {
        const f = formaDeDescuento(null, '2026-10-09');
        expect(problemasAlCorregirDescuento(f, true)[0]).toMatch(/nombre/);
        const ok = { ...f, descripcion: 'X', monto: '10', fin: '2026-10-20', productos: [{ id: 1 }] };
        expect(problemasAlCorregirDescuento(ok, false)).toEqual([]);
        expect(problemasAlCorregirDescuento({ ...ok, tipo: '%', monto: '120' }, false)).toContain('Un porcentaje no puede pasar de 100.');
        expect(payloadDeDescuento(ok, { id: '7', salaPorDefecto: 2 })).toMatchObject({ id: 7, monto: 10, branch_id: 2, productos: [1], forzar: false });
    });
    it('cuenta lo que se pierde bajo el costo', () => {
        expect(cuentaDelProducto({ precio: 10, costo_con_iva: 9 }, '%', 20)).toMatchObject({ queda: 8, bajoCosto: true, pierde: 1 });
    });
    it('ordena por sección y arma la oferta desde el descuento', () => {
        const g = descuentosPorEstado([{ inicio: '2026-10-01', fin: '2026-10-30' }, { inicio: '2026-11-01', fin: '2026-11-05' }], '2026-10-09');
        expect(g.activos).toHaveLength(1);
        expect(g.programados).toHaveLength(1);
        expect(ofertaDesdeDescuento({ descripcion: 'D' }, { a: 1 }, null)).toMatchObject({ titulo: 'D', a: 1, promocion_id: null });
    });
    it('el resumen diario: «sin avisar» apaga los dos', () => {
        expect(alternarResumen({ supervision: true, salas: true }, 'no')).toEqual({ supervision: false, salas: false });
        expect(resumenElegido({ supervision: false, salas: false }, 'no')).toBe(true);
    });
    it('los CSV de promociones', () => {
        expect(csvVendedoresDePromocion([{ nombre: 'A', unidades: 2 }], 'Promo X').nombre).toBe('promocion_Promo_X');
        expect(csvMatrizDeLaboratorio({ salas: [{ sala: 'S1', nivel: null, siguiente_nivel: null }] }, 3).rows[0][2]).toBe('');
    });
});

describe('metas', () => {
    it('lee un cambio y agrupa por meta', () => {
        expect(cambioDeMeta({ evento: 'confirmada', monto_antes: 100, monto_despues: 110 })).toMatchObject({ texto: 'la confirmó en', despues: 110, mov: 10 });
        expect(cambioDeMeta({ evento: 'devuelta', monto_antes: 100, monto_despues: 110 }).despues).toBeNull();
        expect(cambiosPorMeta([{ meta_id: 1 }, { meta_id: 1 }, { meta_id: 2 }])[1]).toHaveLength(2);
    });
    it('el CSV del semestre', () => {
        const c = csvDelSemestre({ meses: [{ ym: '2026-07' }], personas: [{ nombre: 'A', por_mes: { '2026-07': 5 }, total: 5, pagar: true }] }, '2026-S2');
        expect(c.rows[0]).toEqual(['A', '', '', 5, 5, 'SI']);
        expect(c.nombre).toBe('bono_semestral_2026-S2');
    });
});

describe('encuestas a clientes', () => {
    it('ajustes', () => {
        expect(numeroDeMetaEscrito('')).toBeNull();
        expect(numeroDeMetaEscrito('12a')).toBe(12);
        expect(canalesCon(['qr'], 'qr', true)).toEqual(['qr']);
        expect(sucursalesCon([], 2, true)).toEqual([{ branch_id: 2, meta: null }]);
        expect(conMetaDeSucursal([{ branch_id: 2, meta: null }], 2, '30')[0].meta).toBe(30);
    });
    it('resumen con IA: sin repetidos y cuándo se rehace', () => {
        expect(loteParaResumir([{ texto: 'Hola' }, { texto: ' hola ' }, { texto: '' }])).toHaveLength(1);
        expect(estadoDelResumen(null)).toMatchObject({ puede: true, boton: 'Resumir con IA' });
        expect(estadoDelResumen({ texto: 'x', nuevos: 2, minimo_nuevos: 5 })).toMatchObject({ puede: false });
    });
    it('enlace, archivo y borrar', () => {
        expect(enlaceDeEncuesta('abc', true)).toBe('https://portal.farmasalud.lat/e/abc?modo=tablet');
        expect(archivoDeEncuesta('Satisfacción Sala')).toBe('encuesta-satisfaccion-sala');
        expect(encuestaBorrable({ estado: 'borrador' }, true)).toBe(true);
        expect(encuestaBorrable({ estado: 'publicada' }, true)).toBe(false);
    });
});
