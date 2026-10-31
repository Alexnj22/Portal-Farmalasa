import { describe, expect, it } from 'vitest';
import {
    claveDePrincipio, escribirConcentracion, leerConcentracion,
    normalizarConcentracion, normalizarPrincipio, normalizarUnidad,
} from '@nucleo/utils/concentracion';

// Las formas reales medidas en product_active_principles el 2026-10-30.
describe('normalizarConcentracion', () => {
    it.each([
        ['500 mg.', '500 mg'], ['500mg', '500 mg'], ['1 g.', '1 g'], ['5 gr', '5 g'],
        ['250 mcg.', '250 mcg'], ['400 ui', '400 UI'], ['250 mg/5 ml', '250 mg/5 mL'],
        ['40 mg/2ml', '40 mg/2 mL'], ['1 %', '1 %'], ['0,5 mg', '0.5 mg'], ['10 ml.', '10 mL'],
        ['5 mg/ml', '5 mg/mL'], ['2 g/100g', '2 g/100 g'], ['500', '500'],
        ['1.00gr', '1 g'], ['0.50 mg.', '0.5 mg'], ['100 mg', '100 mg'], ['2.5 mg', '2.5 mg'],
    ])('%s → %s', (entrada, salida) => expect(normalizarConcentracion(entrada)).toBe(salida));

    it('lo que no entiende lo deja como vino', () => {
        expect(normalizarConcentracion('n/a')).toBe('n/a');
        expect(normalizarConcentracion('500 tabletas')).toBe('500 tabletas');
        expect(normalizarConcentracion('')).toBeNull();
    });
});

describe('leerConcentracion / escribirConcentracion', () => {
    it('separa cantidad y unidad', () => {
        expect(leerConcentracion('125 mg.')).toEqual({ cantidad: '125', unidad: 'mg', crudo: null });
        expect(leerConcentracion('n/a')).toEqual({ cantidad: '', unidad: '', crudo: 'n/a' });
    });
    it('sin cantidad no hay concentración', () => {
        expect(escribirConcentracion('', 'mg')).toBeNull();
        expect(escribirConcentracion('2,5', 'mg')).toBe('2.5 mg');
    });
    it('unidades desconocidas no se inventan', () => expect(normalizarUnidad('tabletas')).toBeNull());
});

describe('nombre del principio', () => {
    it('mayúsculas, tildes intactas, espacios limpios', () => {
        expect(normalizarPrincipio('  ácido   clavulánico ')).toBe('ÁCIDO CLAVULÁNICO');
    });
    it('la clave no distingue tildes', () => {
        expect(claveDePrincipio('Acetaminofén')).toBe(claveDePrincipio('ACETAMINOFEN'));
    });
});

describe('el nombre contra el registro sanitario', async () => {
    const { concentracionesDelNombre, corregirConElNombre } = await import('@nucleo/utils/concentracion');
    it('lee las concentraciones del nombre', () => {
        expect(concentracionesDelNombre('OMEPRAZOL 20 MG X 100 CAPS. SAIMED')).toEqual(['20 mg']);
        expect(concentracionesDelNombre('AMOXICILINA 500MG + CLAVULANICO 125MG')).toEqual(['500 mg', '125 mg']);
        expect(concentracionesDelNombre('ACETAMINOFEN CAJA X 100 TAB')).toEqual([]);
    });
    it('F064815112006: el registro dice 21 mg y el nombre 20 mg', () => {
        expect(corregirConElNombre('21 mg.', 'OMEPRAZOL 20 MG X 100 CAPS. SAIMED')).toBe('20 mg');
    });
    it('sin contradicción no corrige', () => {
        expect(corregirConElNombre('500 mg.', 'ACETAMINOFEN 500MG CAJA X 100')).toBeNull();
        expect(corregirConElNombre('500 mg', 'ACETAMINOFEN CAJA X 100')).toBeNull();
        expect(corregirConElNombre('20 mg', 'X 40 MG Y 80 MG')).toBeNull();
        expect(corregirConElNombre('5 mL', 'JARABE 120 MG')).toBeNull();
    });
    it('el tamaño del envase, el volumen de la dosis y el total del frasco no corrigen', () => {
        expect(corregirConElNombre('1 g', 'CANESTEN TRIPLE ACCION X 15 GR')).toBeNull();
        expect(corregirConElNombre('0.1 g', 'ADAFERIN GEL 0.1 % X 30 GR')).toBeNull();
        expect(corregirConElNombre('200 mg', 'ACIVIREX SUSPENSION 200/5MG X 100 ML')).toBeNull();
        expect(corregirConElNombre('209.603 mg', 'AZITROMICINA 600MG X15 ML MK')).toBeNull();
    });
    it('la sal contra la base sí corrige (575 mg de trihidrato = 500 mg)', () => {
        expect(corregirConElNombre('575 mg', 'AMOXICILINA 500MG X 100 CAPS. SAIMED')).toBe('500 mg');
        expect(corregirConElNombre('154.5 mg', 'AMOXICILINA 125 MG X 60 ML MK')).toBe('125 mg');
    });
    it('«2,500 UI» son dos mil quinientas', () => {
        expect(concentracionesDelNombre('BADYKET 2,500 UI X 2 JERINGAS')).toEqual(['2500 UI']);
        expect(normalizarConcentracion('5,000 UI')).toBe('5000 UI');
        expect(normalizarConcentracion('0,5 mg')).toBe('0.5 mg');
        expect(normalizarConcentracion('118.822 mg')).toBe('118.822 mg');
    });
});
