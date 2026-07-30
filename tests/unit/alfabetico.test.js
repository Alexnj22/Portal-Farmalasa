import { describe, it, expect } from 'vitest';
import { claveAlfabetica, letraDe, agruparPorLetra } from '../../src/utils/alfabetico';

describe('letraDe — el cajón del índice A–Z', () => {
    it('usa la primera letra cuando el nombre empieza con letra', () => {
        expect(letraDe('BAYER')).toBe('B');
        expect(letraDe('abbott')).toBe('A');
    });

    // El caso que motivó todo: 71 de 356 laboratorios traen prefijo del ERP.
    it('salta el prefijo numérico del ERP', () => {
        expect(letraDe('1-ABBOTT NUTRICIONAL')).toBe('A');
        expect(letraDe('1.1-INSUMOS')).toBe('I');
        expect(letraDe('2 -BAYER')).toBe('B');
        expect(letraDe('1.-HERSHEY\'S')).toBe('H');
    });

    // Del catálogo real: el prefijo trae un asterisco pegado.
    it('salta cualquier carácter inicial que no sea letra, no solo dígitos', () => {
        expect(letraDe('3-*BONIN SOLUCIONES')).toBe('B');
        expect(letraDe('  ((ZAMBON))')).toBe('Z');
    });

    it('ignora las tildes en vez de abrirles cajón propio', () => {
        expect(letraDe('ÁLAMO')).toBe('A');
        expect(letraDe('Ñandú')).toBe('N');
    });

    it('manda a # lo que no tiene ninguna letra', () => {
        expect(letraDe('123')).toBe('#');
        expect(letraDe('---')).toBe('#');
        expect(letraDe('')).toBe('#');
    });
});

describe('claveAlfabetica — la clave de orden es la MISMA que la de grupo', () => {
    it('ordena el prefijado junto a su letra real, no bajo el dígito', () => {
        const nombres = ['BAYER', '1-ABBOTT NUTRICIONAL', 'ACROMAX'];
        const ordenados = [...nombres].sort((a, b) => claveAlfabetica(a).localeCompare(claveAlfabetica(b), 'es'));
        expect(ordenados).toEqual(['1-ABBOTT NUTRICIONAL', 'ACROMAX', 'BAYER']);
    });
});

describe('agruparPorLetra', () => {
    const op = (label) => ({ value: label, label });

    it('deja los grupos contiguos y en orden', () => {
        const g = agruparPorLetra(['BAYER', '1-ABBOTT', 'ACROMAX', 'CALOX', 'BIOGALENIC'].map(op));
        expect(g.map((x) => x.letra)).toEqual(['A', 'B', 'C']);
        expect(g[0].items.map((i) => i.label)).toEqual(['1-ABBOTT', 'ACROMAX']);
        expect(g[1].items.map((i) => i.label)).toEqual(['BAYER', 'BIOGALENIC']);
    });

    it('pone # primero: al final de la Z sería inalcanzable', () => {
        const g = agruparPorLetra(['ZENECA', '999', 'ABBOTT'].map(op));
        expect(g.map((x) => x.letra)).toEqual(['#', 'A', 'Z']);
    });

    it('no repite una letra en dos grupos', () => {
        const g = agruparPorLetra(['ABBOTT', 'BAYER', 'ACROMAX', 'BIOGALENIC', 'ALFA'].map(op));
        const letras = g.map((x) => x.letra);
        expect(new Set(letras).size).toBe(letras.length);
    });

    it('no pierde ni duplica opciones', () => {
        const entrada = ['BAYER', '1-ABBOTT', 'ACROMAX', '999', 'CALOX'].map(op);
        const salida = agruparPorLetra(entrada).flatMap((g) => g.items);
        expect(salida).toHaveLength(entrada.length);
        expect(new Set(salida.map((o) => o.value)).size).toBe(entrada.length);
    });
});
