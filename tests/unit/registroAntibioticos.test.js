import { describe, expect, it } from 'vitest';
import {
    contarPorEstado, csvDelRegistro, enCajas, estadoDeFila, explicarDiferencia, filasDelRegistro, saldoCorrido,
} from '@nucleo/utils/registroAntibioticos';

// Forma real de `get_registro_antibioticos_lote` (Salud 2, octubre 2026,
// AMOXICILINA 500 MG X 30 CAP MK), recortada.
const REGISTRO = {
    periodo: '2026-10', desde: '2026-10-01', hasta: '2026-10-28',
    productos: [{
        product_id: 2224, producto: 'AMOXICILINA 500 MG X 30 CAP MK', en_el_libro: false, factor_caja: 30,
        traslados_fuera_del_portal: 0,
        cuadre: { inicial: 875, neto: -309, existencia: 566, diferencia: 0 },
        lotes: [
            {
                lote: 'L6A5013', vence: '2027-12-01', generico: false, fundido: false, sin_lote: false,
                inicial: 0, inicial_origen: 'historial', entradas: '300', salidas: '10',
                final_calculado: 290, existencia: 290, en_vencidos: 0, diferencia: 0,
                movimientos: [
                    { fecha: '2026-10-20', tipo: 'recibido', documento: 'Traslado 54842', detalle: 'De Bodega', unidades: 120, responsable: 'Ana López' },
                    { fecha: '2026-10-22', tipo: 'recibido', documento: 'Traslado 55730', detalle: 'De Bodega', unidades: 90 },
                    { fecha: '2026-10-24', tipo: 'recibido', documento: 'Traslado 56470', detalle: 'De Bodega', unidades: 90 },
                    { fecha: '2026-10-28', tipo: 'venta', documento: 'FCF 1', unidades: '-10.000' },
                ],
            },
            {
                lote: 'LSVF10697', vence: '2027-11-01', inicial: null, inicial_origen: 'sin_base',
                entradas: 0, salidas: 40, final_calculado: null, existencia: 2, diferencia: null,
                movimientos: [{ fecha: '2026-10-16', tipo: 'venta', unidades: -40 }],
            },
        ],
    }, {
        product_id: 3101, producto: 'AMOXICILINA 500MG X 100 CAPS. SAIMED', factor_caja: 100,
        traslados_fuera_del_portal: 2,
        cuadre: { inicial: 533, neto: 35, existencia: 268, diferencia: -300 },
        lotes: [
            { lote: 'SIN LOTE', sin_lote: true, inicial: 0, entradas: 50, salidas: 0, diferencia: null, movimientos: [] },
            { lote: '707250906707250906', inicial: 100, inicial_origen: 'historial', entradas: 300, salidas: 32,
              existencia: 68, diferencia: -300, movimientos: [] },
        ],
    }],
};

describe('filasDelRegistro', () => {
    it('aplana producto → lote y convierte los números que vienen como texto', () => {
        const filas = filasDelRegistro(REGISTRO);
        expect(filas).toHaveLength(4);
        expect(filas[0]).toMatchObject({ producto: 'AMOXICILINA 500 MG X 30 CAP MK', lote: 'L6A5013', entradas: 300, factor_caja: 30, cuadra_producto: true });
        expect(filas[3]).toMatchObject({ product_id: 3101, cuadra_producto: false, traslados_fuera: 2 });
    });

    it('sin registro, ninguna fila', () => {
        expect(filasDelRegistro(null)).toEqual([]);
    });
});

describe('estadoDeFila y contarPorEstado', () => {
    it('separa cuadra / sin base / sin lote / diferencia', () => {
        const filas = filasDelRegistro(REGISTRO);
        expect(filas.map(estadoDeFila)).toEqual(['cuadra', 'sin_base', 'sin_lote', 'diferencia']);
        expect(contarPorEstado(filas)).toEqual({ todos: 4, cuadra: 1, sin_base: 1, sin_lote: 1, diferencia: 1 });
    });
});

describe('saldoCorrido', () => {
    it('acumula desde el saldo inicial y termina en el calculado', () => {
        const [lote] = filasDelRegistro(REGISTRO);
        const s = saldoCorrido(lote);
        expect(s.map(m => m.saldo)).toEqual([120, 210, 300, 290]);
        expect(s.at(-1).saldo).toBe(lote.final_calculado);
    });

    it('sin saldo inicial no inventa uno: el saldo queda en null', () => {
        const sinBase = filasDelRegistro(REGISTRO)[1];
        expect(saldoCorrido(sinBase).map(m => m.saldo)).toEqual([null]);
    });
});

describe('enCajas', () => {
    it('dice cajas y sueltas', () => {
        expect(enCajas(290, 30)).toBe('9 cj + 20');
        expect(enCajas(300, 100)).toBe('3 cj');
        expect(enCajas(-60, 30)).toBe('−2 cj');
    });
    it('calla cuando no aporta', () => {
        expect(enCajas(20, 30)).toBe('');
        expect(enCajas(5, 1)).toBe('');
        expect(enCajas(5, null)).toBe('');
    });
});

describe('explicarDiferencia', () => {
    it('una diferencia con el producto descuadrado es un movimiento sin registrar', () => {
        const f = filasDelRegistro(REGISTRO)[3];
        expect(explicarDiferencia(f)).toMatch(/sin registrar/);
    });
    it('si el producto cuadra y hubo traslados fuera del portal, la culpa es del lote del traslado', () => {
        const f = { ...filasDelRegistro(REGISTRO)[3], cuadra_producto: true };
        expect(explicarDiferencia(f)).toMatch(/fuera del portal/);
    });
    it('el lote fundido y el genérico se nombran antes que lo demás', () => {
        const f = filasDelRegistro(REGISTRO)[3];
        expect(explicarDiferencia({ ...f, fundido: true })).toMatch(/dos números/);
        expect(explicarDiferencia({ ...f, generico: true })).toMatch(/GENERICO/);
    });
    it('lo que cuadra no lleva explicación', () => {
        expect(explicarDiferencia(filasDelRegistro(REGISTRO)[0])).toBeNull();
    });
});

describe('csvDelRegistro', () => {
    it('una fila de saldo inicial, una por movimiento y una de existencia por lote', () => {
        const { headers, rows } = csvDelRegistro(REGISTRO, 'Salud 2');
        // 4 lotes × (inicial + existencia) + 5 movimientos
        expect(rows).toHaveLength(4 * 2 + 5);
        for (const r of rows) expect(r).toHaveLength(headers.length);
        const lote = rows.filter(r => r[3] === 'L6A5013');
        expect(lote[0][6]).toBe('Saldo inicial');
        expect(lote.at(-2)[10]).toBe(290); // saldo después de la última venta
        expect(lote.at(-1)).toEqual(expect.arrayContaining(['Existencia', 290]));
    });
});
