import { describe, it, expect } from 'vitest';
import { problemaDeContrasenaNueva } from '@nucleo/utils/contrasena';

describe('problemaDeContrasenaNueva', () => {
    it('pide el largo primero', () => {
        expect(problemaDeContrasenaNueva('Ab1', 'Ab1')).toBe('Mínimo 8 caracteres.');
        expect(problemaDeContrasenaNueva(undefined, '')).toBe('Mínimo 8 caracteres.');
    });
    it('pide una mayúscula y un número', () => {
        expect(problemaDeContrasenaNueva('abcdefg1', 'abcdefg1')).toBe('Debe incluir al menos una mayúscula.');
        expect(problemaDeContrasenaNueva('Abcdefgh', 'Abcdefgh')).toBe('Debe incluir al menos un número.');
    });
    it('compara con la confirmación sólo si viene', () => {
        expect(problemaDeContrasenaNueva('Abcdefg1', 'Abcdefg2')).toBe('Las contraseñas no coinciden.');
        expect(problemaDeContrasenaNueva('Abcdefg1')).toBeNull();
        expect(problemaDeContrasenaNueva('Abcdefg1', 'Abcdefg1')).toBeNull();
    });
});
