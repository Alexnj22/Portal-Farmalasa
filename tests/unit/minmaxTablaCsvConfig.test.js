// Mín·Máx: la lógica de la tabla (presentaciones, riesgo de la regla de
// despacho, matriz ABC×XYZ), el CSV que baja la sala y la validación de la
// configuración global. Las tres viven en el núcleo para que el portal y el
// teléfono digan el MISMO número; estas pruebas fijan ese número.
import { describe, expect, it } from 'vitest';
import {
    normXyz, hasDispatchRisk, sortedPres, smallestPres, formatUnits, formatDominant,
    sugerenciaParaLaRegla, matrizAbcXyz,
} from '@nucleo/utils/minmaxTabla';
import { csvDeMinMax } from '@nucleo/utils/csvMinMax';
import {
    SECCIONES_CONFIG_MINMAX, validarConfigMinMax, payloadDeConfigMinMax, cambiaElCatalogo,
} from '@nucleo/utils/configMinMax';

const CAJA = [
    { tipo: 'Caja ', factor: 30 },
    { tipo: 'Blister', factor: 10 },
    { tipo: 'Unidad', factor: 1 },
];

describe('minmaxTabla — clases y presentaciones', () => {
    it('normXyz traduce los valores viejos y deja X por defecto', () => {
        expect(normXyz('stable')).toBe('X');
        expect(normXyz('moderate')).toBe('Y');
        expect(normXyz('erratic')).toBe('Z');
        expect(normXyz('Z')).toBe('Z');
        expect(normXyz(null)).toBe('X');
        expect(normXyz(undefined)).toBe('X');
    });

    it('sortedPres quita la unidad, deduplica por factor y ordena de mayor a menor', () => {
        const r = sortedPres([...CAJA, { tipo: 'Otra caja', factor: 30 }]);
        expect(r.map(p => p.factor)).toEqual([30, 10]);
        expect(sortedPres(null)).toEqual([]);
    });

    it('smallestPres prefiere la de factor 1 y si no hay, la más chica', () => {
        expect(smallestPres(CAJA).factor).toBe(1);
        expect(smallestPres([{ tipo: 'Caja', factor: 12 }, { tipo: 'Sobre', factor: 3 }]).factor).toBe(3);
        expect(smallestPres([])).toBeNull();
        expect(smallestPres(undefined)).toBeNull();
    });

    it('formatUnits descompone en la presentación mayor primero y deja el resto en unidades', () => {
        expect(formatUnits(0, CAJA)).toBe('0');
        expect(formatUnits(75, CAJA)).toBe('2 Caja + 1 Blister + 5 und');
        expect(formatUnits(30, CAJA)).toBe('1 Caja');
        expect(formatUnits(7, CAJA)).toBe('7 und');
        // Sin presentaciones mayores, en unidades a secas.
        expect(formatUnits(1500, [{ tipo: 'Unidad', factor: 1 }])).toBe(`${(1500).toLocaleString()} und`);
    });

    it('formatDominant redondea HACIA ARRIBA: la caja no se parte', () => {
        expect(formatDominant(31, CAJA)).toBe('≥2 Caja');
        expect(formatDominant(30, CAJA)).toBe('≥1 Caja');
        expect(formatDominant(0, CAJA)).toBe('0');
        expect(formatDominant(null, CAJA)).toBe('0');
        expect(formatDominant(4, [])).toBe('4 und');
    });
});

describe('minmaxTabla — riesgo de la regla de despacho', () => {
    it('sin regla de despacho o sin MÁX no hay riesgo', () => {
        expect(hasDispatchRisk(10, null, 1)).toBe(false);
        expect(hasDispatchRisk(0, 12, 1)).toBe(false);
        expect(hasDispatchRisk(-3, 12, 1)).toBe(false);
    });

    it('el umbral es el 40% del paquete (factor × múltiplo), igual que get_pedido_preview', () => {
        // paquete de 12: 4 < 4.8 → redondea a 0 cajas → riesgo
        expect(hasDispatchRisk(4, 12, 1)).toBe(true);
        // 5 ≥ 4.8 → una caja → sin riesgo
        expect(hasDispatchRisk(5, 12, 1)).toBe(false);
        // el múltiplo agranda el paquete: 12 × 2 = 24, umbral 9.6
        expect(hasDispatchRisk(9, 12, 2)).toBe(true);
        expect(hasDispatchRisk(10, 12, 2)).toBe(false);
        // múltiplo ausente cuenta como 1
        expect(hasDispatchRisk(4, 12, null)).toBe(true);
    });

    it('sugerenciaParaLaRegla sube el MÁX justo al umbral y conserva la proporción del MÍN', () => {
        // paquete 12 → MÁX 5 (ceil 4.8). Proporción 3/6 = 0.5 → MÍN round(2.5) = 3
        expect(sugerenciaParaLaRegla(3, 6, 12, 1)).toEqual({ paquete: 12, minNuevo: 3, maxNuevo: 5 });
        // la sugerencia deja de tener riesgo, que es para lo que existe
        const s = sugerenciaParaLaRegla(1, 2, 24, 3);
        expect(hasDispatchRisk(s.maxNuevo, 24, 3)).toBe(false);
        expect(hasDispatchRisk(s.maxNuevo - 1, 24, 3)).toBe(true);
    });

    it('el MÍN sugerido nunca alcanza al MÁX (chk_min_lt_max)', () => {
        // proporción 1 (MÍN = MÁX) → se acota a MÁX − 1
        const s = sugerenciaParaLaRegla(6, 6, 12, 1);
        expect(s.minNuevo).toBeLessThan(s.maxNuevo);
        expect(s.minNuevo).toBe(4);
        // paquete chiquito: MÁX 1 → MÍN 0
        expect(sugerenciaParaLaRegla(5, 5, 2, 1)).toEqual({ paquete: 2, minNuevo: 0, maxNuevo: 1 });
    });

    it('sin MÁX actual la proporción por defecto es la mitad; sin paquete, null', () => {
        expect(sugerenciaParaLaRegla(0, 0, 10, 1)).toEqual({ paquete: 10, minNuevo: 2, maxNuevo: 4 });
        expect(sugerenciaParaLaRegla(1, 2, null, 1)).toBeNull();
        expect(sugerenciaParaLaRegla(1, 2, 0, 3)).toBeNull();
    });
});

describe('minmaxTabla — matriz ABC × XYZ', () => {
    it('cuenta los nueve cruces, prefiere el borrador y descarta muertos, sin datos y clase D', () => {
        const m = matrizAbcXyz([
            { abc_class: 'A', demand_variability: 'X' },
            { abc_class: 'A', demand_variability: 'stable' },           // valor viejo → X
            { abc_class: 'C', draft_abc_class: 'B', demand_variability: 'Z', draft_demand_variability: 'Y' },
            { abc_class: 'A', demand_variability: 'X', is_dead_stock: true },
            { abc_class: 'A', demand_variability: 'X', alert_status: 'no_data' },
            { abc_class: 'D', demand_variability: 'X' },                 // fuera de la matriz
            { demand_variability: 'X' },                                  // sin clase → D
        ]);
        expect(Object.keys(m)).toHaveLength(9);
        expect(m.AX).toBe(2);
        expect(m.BY).toBe(1);
        expect(m.CZ).toBe(0);
        expect(Object.values(m).reduce((a, b) => a + b, 0)).toBe(3);
    });

    it('sin filas, todos los cruces en cero', () => {
        expect(Object.values(matrizAbcXyz()).every(v => v === 0)).toBe(true);
    });
});

describe('csvDeMinMax', () => {
    const fila = (extra = {}) => ({
        erp_product_id: 'P1', product_name: 'Ibuprofeno', laboratorio_nombre: 'Lab B',
        abc_class: 'A', demand_variability: 'X', effective_min: 10, effective_max: 30,
        units_sold_6m: 120, current_stock: 45, daily_velocity: 1, presentations: CAJA, ...extra,
    });

    it('sala: MIN·MAX en unidades, en el orden recibido, y vacío cuando no hay par', () => {
        const { headers, filas } = csvDeMinMax([
            fila(),
            fila({ product_name: 'Sin par', effective_min: 0, effective_max: 0, units_sold_6m: null }),
        ], 'Salud 1');
        expect(headers).toEqual(['Sucursal', 'Laboratorio', 'Producto', 'Clase', 'MIN (und)', 'MAX (und)', 'Ventas 6 meses']);
        expect(filas[0]).toEqual(['Salud 1', 'Lab B', 'Ibuprofeno', 'AX', 10, 30, 120]);
        expect(filas[1]).toEqual(['Salud 1', 'Lab B', 'Sin par', 'AX', '', '', 0]);
    });

    it('la clase sale del borrador cuando lo hay', () => {
        const { filas } = csvDeMinMax([fila({ draft_abc_class: 'C', draft_demand_variability: 'erratic' })], 'S');
        expect(filas[0][3]).toBe('CZ');
    });

    it('bodega: ordena por laboratorio y producto, y lleva todo a la presentación mayor', () => {
        const { headers, filas } = csvDeMinMax([
            fila({ laboratorio_nombre: 'lab b', product_name: 'Zeta' }),
            fila({ laboratorio_nombre: 'Lab A', product_name: 'Beta' }),
            fila({ laboratorio_nombre: 'Lab B', product_name: 'Alfa' }),
        ], 'Bodega', true, { P1: 0 }, { P1: 'Droguería X' });
        expect(headers).toHaveLength(11);
        expect(filas.map(f => f[2])).toEqual(['Beta', 'Alfa', 'Zeta']);
        // MIN 10 und / caja 30 → 0.33 < 0.4 → 0 cajas; MAX 30 → 1; inventario 45 → 1.5 → 2
        // MIN 0 y MAX 1 no chocan; a pedir = max(0, 1 − 2) = 0
        expect(filas[0].slice(4, 10)).toEqual([0, 1, 'Caja', 2, 0, 'Droguería X']);
    });

    it('bodega: si MIN y MAX redondean igual, el MIN baja uno', () => {
        const { filas } = csvDeMinMax([fila({ effective_min: 25, effective_max: 30 })], 'Bodega', true);
        // 25/30 = 0.83 → 1 caja; 30/30 → 1 caja → MIN pasa a 0
        expect(filas[0][4]).toBe(0);
        expect(filas[0][5]).toBe(1);
        expect(filas[0][9]).toBe('Sin registro');
    });

    it('bodega: la alerta mira la cobertura de la RED, no sólo la de bodega', () => {
        const alerta = (extra, red = {}) => csvDeMinMax([fila(extra)], 'Bodega', true, red).filas[0][10];
        expect(alerta({ current_stock: 0 })).toBe('SIN STOCK');
        expect(alerta({ effective_min: 0, effective_max: 0 })).toBe('SIN MIN/MAX');
        // bajo el MIN de bodega: crítico con los días de la red
        expect(alerta({ current_stock: 5 }, { P1: 15 })).toBe('CRÍTICO (20d red)');
        expect(alerta({ current_stock: 5, daily_velocity: 0 })).toBe('CRÍTICO');
        // sobre el MIN: según cobertura
        expect(alerta({ current_stock: 12 })).toBe('CRÍTICO (12d)');
        expect(alerta({ current_stock: 12 }, { P1: 8 })).toBe('ATENCIÓN (20d)');
        expect(alerta({ current_stock: 12 }, { P1: 30 })).toBe('');
        expect(alerta({ current_stock: 12, daily_velocity: 0 })).toBe('');
    });
});

describe('configMinMax', () => {
    const buena = {
        cycle_days: 30, analysis_days: 180, reorder_x_days: 25, reorder_y_days: 25, reorder_z_days: 25,
        xyz_x_percentile: 50, xyz_y_percentile: 80, abc_a_pct: 80, abc_b_pct: 95, approaching_pct: 25,
        buffer_x_days: 0, buffer_y_days: 0, buffer_z_days: 0, outlier_percentile: 95,
    };

    it('una configuración sana valida', () => {
        expect(validarConfigMinMax(buena)).toBeNull();
    });

    it('rechaza cada combinación inválida con su motivo', () => {
        expect(validarConfigMinMax({ ...buena, cycle_days: 0 })).toMatch(/ciclo/);
        expect(validarConfigMinMax({ ...buena, abc_a_pct: 95 })).toMatch(/umbral A/);
        expect(validarConfigMinMax({ ...buena, xyz_x_percentile: 80 })).toMatch(/percentil de X/);
        expect(validarConfigMinMax({ ...buena, xyz_y_percentile: 101 })).toMatch(/no puede superar 100/);
        expect(validarConfigMinMax({ ...buena, approaching_pct: 0 })).toMatch(/entre 1 y 100/);
        expect(validarConfigMinMax({ ...buena, approaching_pct: 101 })).toMatch(/entre 1 y 100/);
    });

    it('compara como números aunque el formulario mande texto', () => {
        // '9' < '10' como texto sería falso; como número es verdadero
        expect(validarConfigMinMax({ ...buena, abc_a_pct: '9', abc_b_pct: '10' })).toBeNull();
    });

    it('el payload convierte a número, firma y pone 95 si falta el percentil de atípicos', () => {
        const { outlier_percentile, ...sinAtipicos } = buena;
        void outlier_percentile;
        const p = payloadDeConfigMinMax({ ...sinAtipicos, cycle_days: '45' }, 'quien@x.com');
        expect(p.cycle_days).toBe(45);
        expect(p.outlier_percentile).toBe(95);
        expect(p.updated_by).toBe('quien@x.com');
        expect(Number.isNaN(Date.parse(p.updated_at))).toBe(false);
        expect(payloadDeConfigMinMax(buena).updated_by).toBeNull();
    });

    it('cada campo de las secciones se escribe en el payload', () => {
        const p = payloadDeConfigMinMax(buena);
        for (const s of SECCIONES_CONFIG_MINMAX) for (const c of s.campos) expect(p).toHaveProperty(c.k);
    });

    it('cambiaElCatalogo: sí el ciclo, el reorden, el buffer o la ventana; no los umbrales de clase', () => {
        expect(cambiaElCatalogo(buena, { ...buena })).toBe(false);
        expect(cambiaElCatalogo(buena, { ...buena, cycle_days: '30' })).toBe(false); // mismo número
        expect(cambiaElCatalogo(buena, { ...buena, cycle_days: 31 })).toBe(true);
        expect(cambiaElCatalogo(buena, { ...buena, reorder_y_days: 20 })).toBe(true);
        expect(cambiaElCatalogo(buena, { ...buena, buffer_z_days: 2 })).toBe(true);
        expect(cambiaElCatalogo(buena, { ...buena, outlier_percentile: 90 })).toBe(true);
        expect(cambiaElCatalogo(buena, { ...buena, abc_a_pct: 70, approaching_pct: 30 })).toBe(false);
    });
});
