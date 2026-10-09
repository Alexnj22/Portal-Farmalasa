import { describe, it, expect } from 'vitest';
import {
    DESDE_EL_PORTAL, filasCsvPorCobrar, filtrarVentasDeInyeccion, ordenarParaVincular, porVendedorDeInyecciones,
    rangoPorDefecto, resumenPorCobrar,
} from '@nucleo/utils/inyeccionesPorCobrar';
import {
    comoSeVende, leerMililitros, partirCatalogoDeDosis, preciosCambiados, valorAlQuitar,
} from '@nucleo/utils/inyeccionesAjustes';

const ventas = [
    { id: 1, cod_vendedor: '7', vendedor_nombre: 'ANA PEREZ', cliente: 'JUAN', correlativo: '00012', productos: [{ descripcion: 'TRAMAL' }], cobro: { monto: 1, hora: '10:00' } },
    { id: 2, cod_vendedor: '7', vendedor_nombre: 'ANA PEREZ', cliente: 'LUIS', correlativo: '00013', productos: [{ descripcion: 'RUBRAVIDA' }], cobro: null },
    { id: 3, cod_vendedor: '9', vendedor_nombre: 'EVA SOL', cliente: 'MARTA', correlativo: '00014', productos: [{ descripcion: 'TRAMAL' }], cobro: null },
];

describe('Por cobrar de inyecciones', () => {
    it('el período arranca el día del registro mientras quede dentro de 90 días', () => {
        expect(rangoPorDefecto('2026-10-09')).toBe(`${DESDE_EL_PORTAL}|2026-10-09`);
        expect(rangoPorDefecto('2027-03-15')).toBe('2027-03-01|2027-03-15');
    });
    it('resume ventas, cobros y sueltos', () => {
        const r = resumenPorCobrar({ ventas, cobros_sin_venta: [{ monto: '2.5' }, { monto: 1 }] });
        expect(r).toMatchObject({ ventas: 3, con: 1, sin: 2, sueltos: 2, montoSueltos: 3.5 });
        expect(r.pct).toBeCloseTo(33.33, 1);
        expect(resumenPorCobrar(null)).toMatchObject({ ventas: 0, pct: 0 });
    });
    it('agrupa por vendedor, el que más vende primero', () => {
        const v = porVendedorDeInyecciones(ventas);
        expect(v[0]).toMatchObject({ cod: '7', ventas: 2, con: 1 });
        expect(v[1]).toMatchObject({ cod: '9', ventas: 1, con: 0 });
    });
    it('filtra por cobro y busca por inyección', () => {
        expect(filtrarVentasDeInyeccion(ventas, 'con', '').map((v) => v.id)).toEqual([1]);
        expect(filtrarVentasDeInyeccion(ventas, 'sin', '').map((v) => v.id)).toEqual([2, 3]);
        expect(filtrarVentasDeInyeccion(ventas, 'todas', 'rubravida').map((v) => v.id)).toEqual([2]);
    });
    it('el CSV marca SI/NO', () => {
        const filas = filasCsvPorCobrar(ventas, () => 'Salud 1');
        expect(filas[0][9]).toBe('SI');
        expect(filas[1][9]).toBe('NO');
        expect(filas[0][2]).toBe('Salud 1');
    });
    it('para asignar, las del día del cobro van primero', () => {
        const r = ordenarParaVincular([{ id: 1, fecha: '2026-10-01' }, { id: 2, fecha: '2026-10-02' }], '2026-10-02');
        expect(r.map((v) => v.id)).toEqual([2, 1]);
    });
});

describe('Ajustes de inyecciones', () => {
    it('dice cómo se vende', () => {
        expect(comoSeVende([1])).toBe('Se vende sólo entero');
        expect(comoSeVende([1, 5])).toBe('Se vende suelta y en caja de 5');
    });
    it('parte el catálogo y cuenta lo sin decidir (por ml también decide)', () => {
        const r = partirCatalogoDeDosis([
            { clasificacion: 'auto', confirmadas: null, contenido_ml: null },
            { clasificacion: 'auto', confirmadas: 2, contenido_ml: null },
            { clasificacion: 'incluido', confirmadas: null, contenido_ml: 10 },
            { clasificacion: 'quitado' },
        ]);
        expect(r.activas).toHaveLength(3);
        expect(r.quitados).toHaveLength(1);
        expect(r.sinConfirmar).toBe(1);
    });
    it('quitar uno agregado a mano lo devuelve a lo automático', () => {
        expect(valorAlQuitar({ clasificacion: 'incluido' })).toBeNull();
        expect(valorAlQuitar({ clasificacion: 'auto' })).toBe(false);
    });
    it('lee los mililitros con coma o punto y frena una dosis mayor al vial', () => {
        expect(leerMililitros('10', ['2', '2,5', '', ''])).toMatchObject({ c: 10, lista: [2, 2.5], valido: true });
        expect(leerMililitros('2', ['3', '', '', ''])).toMatchObject({ pasadas: true, valido: false });
        expect(leerMililitros('', ['2'])).toMatchObject({ valido: false });
    });
    it('sólo cuenta como cambio el precio distinto', () => {
        expect(preciosCambiados({ COMPRADA: 1, TRAIDA: 2 }, { COMPRADA: '1', TRAIDA: '2.5' })).toEqual(['TRAIDA']);
        expect(preciosCambiados(null, {})).toEqual([]);
    });
});
