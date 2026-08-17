import { describe, expect, it } from 'vitest';
import { applyInputMask } from '../../src/utils/inputStyles';

// ═══════════════════════════════════════════════════════════════════════════
// La máscara DECIMAL.
//
// Existe por un defecto medido el 2026-08-17 en el campo de temperatura de las
// bitácoras: con `type="number"`, teclear «24,9» dejaba **249** en el campo —el
// navegador tira la coma sin avisar— y 249 °C entraba como lectura válida. En
// un teclado en español la coma es el separador decimal normal, así que la
// trampa estaba en el camino de todos los días.
//
// Lo que estas pruebas anclan no es el formateo: es que **ningún separador se
// pierda en silencio** y que un tipeo raro no se convierta en otro número.
// ═══════════════════════════════════════════════════════════════════════════

const dec = (v) => applyInputMask(v, 'DECIMAL');

describe('máscara DECIMAL', () => {
    it('acepta el punto', () => {
        expect(dec('24.9')).toBe('24.9');
    });

    // El defecto original, al derecho.
    it('acepta la coma y la traduce a punto', () => {
        expect(dec('24,9')).toBe('24.9');
        expect(dec('24,95')).toBe('24.95');
    });

    it('nunca convierte «24,9» en 249', () => {
        expect(Number(dec('24,9'))).toBe(24.9);
        expect(Number(dec('24,9'))).not.toBe(249);
    });

    // Con `type="number"` el punto no se veía hasta escribir el dígito que
    // sigue, y la pantalla parecía estar ignorando la tecla.
    it('deja ver el separador mientras se está tecleando', () => {
        expect(dec('24.')).toBe('24.');
        expect(dec('24,')).toBe('24.');
    });

    it('corta en dos decimales, que es lo que guarda la columna', () => {
        expect(dec('24.987')).toBe('24.98');
    });

    // Pegar los grupos daría 24.95, que es otro número. Se queda el primero.
    it('con dos separadores se queda con el primer grupo', () => {
        expect(dec('24.9.5')).toBe('24.9');
        expect(dec('24,9,5')).toBe('24.9');
    });

    it('descarta letras y símbolos', () => {
        expect(dec('24°C')).toBe('24');
        expect(dec('abc')).toBe('');
        expect(dec('2a4.9x')).toBe('24.9');
    });

    it('conserva el signo negativo, para un congelador', () => {
        expect(dec('-18.5')).toBe('-18.5');
        expect(dec('-')).toBe('-');
    });

    it('el vacío sigue siendo vacío', () => {
        expect(dec('')).toBe('');
        expect(dec(null)).toBe('');
        expect(dec(undefined)).toBe('');
    });

    // Las otras máscaras comparten la función; que DECIMAL no las toque.
    it('no cambia las máscaras que ya existían', () => {
        expect(applyInputMask('12345678', 'PHONE')).toBe('1234-5678');
        expect(applyInputMask('1234567890', 'ISSS')).toBe('123456789');
        expect(applyInputMask('1234', 'PERCENT')).toBe('123');
    });
});
