import { describe, it, expect } from 'vitest';
import { convertir, armarPlan, piezasSrs, piezasPortal, volumenSrs } from '../../scripts/srs/cargaMercado.mjs';

// Casos que la primera versión leyó mal en el plan real de La Salud (2026-11-18).
describe('contar piezas, no medidas', () => {
    it.each([
        ['CAJA X 10 BLISTER X 10 CAPSULAS', 100],
        ['1 FRASCO X 200 DOSIS (PRESENTACIÓN COMERCIAL)', 1],
        ['CAJA X 1 VIAL X 2,400,000 U.I.', 1],
        ['TARRO X 120 G (PRESENTACIÓN COMERCIAL)', 1],
        ['CAJA X 100 VIALES DE 2 ML', 100],
        ['CAJA X 24 SOBRES X 2 CAPLETAS', 48],
        ['CAJA CONTENIENDO: AMPOLLA A', null],
    ])('SRS «%s» → %s', (t, n) => expect(piezasSrs(t)).toBe(n));

    it.each([
        ['CLAVULIN C/12 X 70 ML', null],
        ['IPRAMIST SPRAY 15 ML X 200 DOSIS', null],
        ['METIOM H. PYLORI TRATAMIENTO X 14 DIAS', null],
        ['UVAMIN RETARD BLISTER X 10 CAP | (R)', 10],
        ['LOSARTAN 50MG X 100 TAB. ECOMED', 100],
        ['PANADOL GRIPE NOCHE X 24 SOBRES', 24],
    ])('portal «%s» → %s', (t, n) => expect(piezasPortal(t)).toBe(n));

    it('el volumen es el del frasco, no la concentración', () => {
        expect(volumenSrs('CAJA X 1 FRASCO X 50 ML')).toEqual({ n: 50, u: 'ML' });
        expect(volumenSrs('FIXIM 100mg/5mL')).toBe(null);
    });

    it.each([['TRAVATAN X 2.5 ML', null], ['KOPTIN SUSPENSION X 22.5 ML', null]])('portal «%s» → %s', (t, n) => expect(piezasPortal(t)).toBe(n));

    it('el portal cuenta sobres: 24 sobres son UNA caja de 24 sobres x 2, al precio de la caja', () => {
        const r = convertir({
            producto: { nombre: 'PANADOL GRIPE NOCHE X 24 SOBRES' },
            pareja: { presentacion_srs: 'CAJA X 24 SOBRES X 2 CAPLETAS (PRESENTACIÓN COMERCIAL)' },
            precios: [{ descripcion: '1x1', factor: 1, vineta: 0.5, descuento_1: 0.45 }, { descripcion: '1X24', factor: 24, vineta: 10.78, descuento_1: 9.7 }],
            inventario: [{ detalle: '1x1', cantidad: 24 }],
        });
        expect(r).toMatchObject({ ok: true, existencia: 1, precio: 10.78, conDescuento: 9.7 });
        expect(r.avisos).not.toContain('precio_proporcional');
    });

    it('el portal cuenta sobres y la SRS sólo tabletas: no se adivina', () => {
        const r = convertir({
            producto: { nombre: 'SALVADOL MIGRAÑA X 25 SOBRES' },
            pareja: { presentacion_srs: 'CAJA X 50 TABLETAS (PRESENTACIÓN COMERCIAL)' },
            precios: [{ descripcion: '1x1', factor: 1, vineta: 0.5 }, { descripcion: '1x25', factor: 25, vineta: 12.64 }],
            inventario: [],
        });
        expect(r).toMatchObject({ ok: false, motivo: 'empaque_no_cuadra' });
    });

    it('un vial suelto no se declara como la caja de 100', () => {
        const r = convertir({
            producto: { nombre: 'GENTAMICINA 160MG X 2 ML VIJOSA' },
            pareja: { presentacion_srs: 'CAJA X 100 VIALES DE 2 ML' },
            precios: [{ descripcion: '1x1', factor: 1, vineta: 4.6, descuento_1: 4.15 }],
            inventario: [{ detalle: '1x1', cantidad: 3 }],
        });
        expect(r).toMatchObject({ ok: false, motivo: 'empaque_no_cuadra' });
    });
});

// Datos reales del portal (2026-11-18).
const UVAMIN = {
    producto: { nombre: 'UVAMIN RETARD BLISTER X 10 CAP | (R)' },
    pareja: { crp: '7178-4', nombre_srs: 'UVAMIN RETARD 100mg CAPSULAS', presentacion_srs: 'CAJA X 10 BLISTER X 10 CAPSULAS (PRESENTACIÓN COMERCIAL)', laboratorio_srs: 'ACINO PHARMA AG' },
    precios: [
        { descripcion: '1x1', factor: 1, vineta: 0.882, descuento_1: 0.8 },
        { descripcion: '1x10', factor: 10, vineta: 8.82, descuento_1: 7.6 },
    ],
};
const UROGESIC = {
    producto: { nombre: 'UROGESIC X 100 TABLETAS' },
    pareja: { crp: '1-1', nombre_srs: 'UROGESIC TABLETAS', presentacion_srs: 'CAJA X 10 BLISTER X 10 TABLETAS (PRESENTACIÓN COMERCIAL)', laboratorio_srs: 'X' },
    precios: [
        { descripcion: '1x1', factor: 1, vineta: 0.28, descuento_1: 0.25 },
        { descripcion: '1x10', factor: 10, vineta: 2.78, descuento_1: 2.45 },
        { descripcion: '1x100', factor: 100, vineta: 27.79, descuento_1: 24.5 },
    ],
};
const LOSARTAN = {
    producto: { nombre: 'LOSARTAN 50MG X 100 TAB. ECOMED' },
    pareja: { crp: '2-1', nombre_srs: 'LOSARTAN POTASICO 50 mg TABLETAS ECOMED', presentacion_srs: 'CAJA X 10 BLISTER X 10 TABLETAS', laboratorio_srs: 'ECOMED' },
    precios: [
        { descripcion: '1x1', factor: 1, vineta: 3, descuento_1: 2.5 },     // un blíster de 10
        { descripcion: '1x10', factor: 10, vineta: 30, descuento_1: 22.5 }, // la caja
    ],
};

describe('convertir: existencia y precio en la presentación de la SRS', () => {
    it('blíster de 10 contra caja de 100: 4 cápsulas son 0.04 cajas y el precio es 10 blísteres', () => {
        const r = convertir({ ...UVAMIN, inventario: [{ detalle: '1x1', cantidad: 4 }, { detalle: '1x10', cantidad: 0 }] });
        expect(r.ok).toBe(true);
        expect(r.existencia).toBe(0.04);
        expect(r.precio).toBe(88.2);
        expect(r.conDescuento).toBe(76);
        expect(r.avisos).toContain('precio_proporcional');
    });

    it('dispensador: 4 sueltas + 3 blísteres = 0.34 y el precio de la caja de 100', () => {
        const r = convertir({ ...UROGESIC, inventario: [{ detalle: '1x1', cantidad: 4 }, { detalle: '1x10', cantidad: 3 }, { detalle: '1x100', cantidad: 0 }] });
        expect(r.existencia).toBe(0.34);
        expect(r.precio).toBe(27.79);
        expect(r.conDescuento).toBe(24.5);
        expect(r.avisos).not.toContain('precio_proporcional');
    });

    it('el «1x1» que es un blíster de 10 (LOSARTAN ECOMED)', () => {
        const r = convertir({ ...LOSARTAN, inventario: [{ detalle: '1x1', cantidad: 5 }] });
        expect(r.existencia).toBe(0.5);
        expect(r.precio).toBe(30);
    });

    it('el nombre y las presentaciones no cuadran: no se carga', () => {
        const r = convertir({ ...UROGESIC, producto: { nombre: 'UROGESIC X 30 TABLETAS' }, inventario: [] });
        expect(r.ok).toBe(false);
        expect(r.motivo).toBe('empaque_no_cuadra');
    });

    it('frasco: se cuenta entero si el volumen coincide, y no si es otro', () => {
        const base = {
            producto: { nombre: 'CLAVULIN SUSPENSION 70 ML' },
            precios: [{ descripcion: '1x1', factor: 1, vineta: 17.92, descuento_1: 17.75 }],
            inventario: [{ detalle: '1x1', cantidad: 2 }],
        };
        const igual = convertir({ ...base, pareja: { nombre_srs: 'CLAVULIN SUSPENSION', presentacion_srs: 'FRASCO X 70 ML' } });
        expect(igual).toMatchObject({ ok: true, existencia: 2, precio: 17.92 });
        const otro = convertir({ ...base, pareja: { nombre_srs: 'CLAVULIN SUSPENSION', presentacion_srs: 'FRASCO X 100 ML' } });
        expect(otro).toMatchObject({ ok: false, motivo: 'volumen_distinto' });
    });

    it('descuento mayor que el precio: se iguala y avisa', () => {
        const r = convertir({ ...UROGESIC, precios: UROGESIC.precios.map(p => ({ ...p, descuento_1: p.vineta * 2 })), inventario: [] });
        expect(r.conDescuento).toBe(r.precio);
        expect(r.avisos).toContain('descuento_mayor');
    });
});

describe('armarPlan', () => {
    const precios = new Map([[1, UROGESIC.precios], [2, LOSARTAN.precios], [3, UROGESIC.precios]]);
    const par = (product_id, crp, base) => ({ ...base.pareja, product_id, crp, producto: base.producto });

    it('guarda lo precargado nuestro, agrega lo nuestro con existencia, borra lo ajeno', () => {
        const plan = armarPlan({
            pares: [par(1, 'A', UROGESIC), par(2, 'B', LOSARTAN), par(3, 'C', UROGESIC)],
            precios,
            inventario: new Map([[2, [{ detalle: '1x1', cantidad: 1 }]]]),
            precargados: [{ crp: 'A', nombre: 'UROGESIC' }, { crp: 'Z', nombre: 'AJENO' }],
        });
        expect(plan.guardar.map(f => f.crp)).toEqual(['A']);      // sin existencia, pero precargado
        expect(plan.guardar[0].existencia).toBe(0);
        expect(plan.agregar.map(f => f.crp)).toEqual(['B']);      // C: sin existencia, no se agrega
        expect(plan.eliminar.map(f => f.crp)).toEqual(['Z']);
    });

    it('dos productos con la misma pareja suman existencias', () => {
        const plan = armarPlan({
            pares: [par(1, 'A', UROGESIC), par(3, 'A', UROGESIC)],
            precios,
            inventario: new Map([[1, [{ detalle: '1x10', cantidad: 2 }]], [3, [{ detalle: '1x100', cantidad: 1 }]]]),
            precargados: [],
        });
        expect(plan.agregar[0].existencia).toBe(1.2);
        expect(plan.agregar[0].avisos).toContain('varios_productos');
    });

    it('lo nuestro que no se puede convertir no se borra ni se manda', () => {
        const plan = armarPlan({
            pares: [{ ...par(1, 'A', UROGESIC), producto: { nombre: 'UROGESIC X 30 TABLETAS' } }],
            precios,
            inventario: new Map([[1, [{ detalle: '1x1', cantidad: 3 }]]]),
            precargados: [{ crp: 'A', nombre: 'UROGESIC' }],
        });
        expect(plan.revisar.map(f => f.crp)).toEqual(['A']);
        expect(plan.eliminar).toEqual([]);
        expect(plan.guardar).toEqual([]);
    });
});
