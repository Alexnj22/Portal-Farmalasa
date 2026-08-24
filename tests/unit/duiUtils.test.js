// El DUI: 8 dígitos + un verificador de módulo 10 con pesos 9..2.
//
// Se prueba porque el algoritmo estaba escrito DOS veces antes de extraerse
// (`EmployeeFormModal`, y a punto de una tercera en Practicantes), y porque su
// contrato tiene una decisión que sorprende y se puede deshacer sin que nada
// falle: **lo incompleto pasa**.
//
// Los verificadores de acá no están inventados: salen de correr el algoritmo del
// documento sobre los ocho dígitos. Un caso de prueba con un verificador
// inventado prueba que la función coincide consigo misma, no que esté bien.

import { describe, it, expect } from 'vitest';
import { maskDui, isValidDUIAlgorithm } from '../../src/utils/duiUtils';

describe('el verificador', () => {
    it.each(['04413277-6', '00000000-0', '12345678-4', '99999999-4', '01234567-8'])(
        'acepta %s', (dui) => { expect(isValidDUIAlgorithm(dui)).toBe(true); });

    it('rechaza el mismo número con OTRO verificador', () => {
        // Es la única prueba que de verdad ejercita el cálculo: si la función
        // devolviera `true` siempre, todo lo de arriba pasaría igual.
        expect(isValidDUIAlgorithm('04413277-5')).toBe(false);
        expect(isValidDUIAlgorithm('12345678-0')).toBe(false);
        expect(isValidDUIAlgorithm('00000000-1')).toBe(false);
    });

    it('el `10` del cálculo se convierte en `0`, no queda en dos dígitos', () => {
        // `00000000` suma 0 → `10 - 0 = 10`, que no es un dígito. La rama que lo
        // baja a 0 es fácil de perder al reescribir y sólo la toca este caso.
        expect(isValidDUIAlgorithm('00000000-0')).toBe(true);
    });

    it('los guiones y espacios no cambian el resultado', () => {
        expect(isValidDUIAlgorithm('044132776')).toBe(true);
        expect(isValidDUIAlgorithm('0441 3277-6')).toBe(true);
    });
});

describe('lo incompleto PASA, y es una decisión', () => {
    // La función se llama mientras alguien escribe. Si un DUI a medias diera
    // «inválido», el campo se pintaría en rojo desde la primera tecla y el aviso
    // dejaría de significar algo. Quien exige que esté COMPLETO es el formulario,
    // no esta función.
    it.each([null, undefined, '', '0441', '04413277', '0441327761'])(
        'no rechaza «%s»', (v) => { expect(isValidDUIAlgorithm(v)).toBe(true); });

    it('sólo juzga cuando hay exactamente 9 dígitos', () => {
        expect(isValidDUIAlgorithm('04413277-5')).toBe(false);   // 9 → juzga
        expect(isValidDUIAlgorithm('04413277-55')).toBe(true);   // 10 → no juzga
    });
});

describe('la máscara', () => {
    it('pone el guión al llegar al noveno dígito', () => {
        expect(maskDui('0441327')).toBe('0441327');
        expect(maskDui('04413277')).toBe('04413277');
        expect(maskDui('044132776')).toBe('04413277-6');
    });

    it('descarta lo que no es dígito y no deja escribir de más', () => {
        expect(maskDui('04-41 32a77b6')).toBe('04413277-6');
        expect(maskDui('0441327765432')).toBe('04413277-6');
    });

    it('el vacío sale vacío, no «undefined»', () => {
        expect(maskDui('')).toBe('');
        expect(maskDui(null)).toBe('');
        expect(maskDui(undefined)).toBe('');
    });
});
