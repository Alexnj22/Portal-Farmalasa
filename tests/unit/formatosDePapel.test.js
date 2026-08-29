// ─────────────────────────────────────────────────────────────────────────────
// Los tres papeles que de verdad se escanean
// ─────────────────────────────────────────────────────────────────────────────
//
// Dicho por el usuario (2026-08-29): «normalmente se escanea: tamaño carta, y
// tamaño de cédula (carné) —estos pueden ser vertical u horizontal—, tamaño
// oficio. Es raro escanear algo de otro tamaño».
//
// Eso deja de ser una nota y pasa a ser una CORRECCIÓN: marcar cuatro esquinas
// —a mano o con un modelo— siempre queda con un par de milímetros de error, así
// que la proporción medida sale «casi carta». Sabiendo que casi todo lo que
// entra es uno de estos tres, la que está a un 3 % de carta ES carta.
//
// Lo que se ancla acá es sobre todo lo que NO se hace: nombrar cuando hay duda.

import { describe, it, expect } from 'vitest';
import { FORMATOS, medidaAjustada, reconocerFormato } from '../../src/utils/formatosDePapel';

describe('reconocer el papel', () => {
    it('reconoce los seis: los tres tamaños, de pie y acostados', () => {
        const vistos = new Set();
        for (const f of FORMATOS) {
            for (const [a, b] of [[f.ancho, f.alto], [f.alto, f.ancho]]) {
                const r = reconocerFormato(a * 10, b * 10);
                expect(r, `${f.id} ${a}×${b}`).toBeTruthy();
                expect(r.id).toBe(f.id);
                vistos.add(`${r.id}-${r.orientacion}`);
            }
        }
        expect(vistos.size).toBe(6);
    });

    it('corrige un papel medido con error hasta la forma real', () => {
        // Una carta de pie marcada con un 3.5 % de error en el ancho.
        const r = medidaAjustada(820, 1090);
        expect(r.formato?.id).toBe('carta');
        // El lado LARGO se conserva —es donde vive la resolución de la letra— y
        // el corto se recalcula.
        expect(r.alto).toBe(1090);
        expect(r.ancho).toBe(Math.round(1090 * 215.9 / 279.4));
    });

    it('no toca lo que no se parece a ningún papel conocido', () => {
        // Un cuadrado y una tira larga: existen —media hoja, un recibo— y
        // forzarlos a carta sería deformarlos.
        for (const [a, b] of [[1000, 1000], [400, 1600]]) {
            const r = medidaAjustada(a, b);
            expect(r.formato).toBeNull();
            expect([r.ancho, r.alto]).toEqual([a, b]);
        }
    });
});

/* ── La parte que importa: cuándo se puede NOMBRAR ───────────────────────────
 *
 * Un oficio de pie (0.654) y una cédula parada (0.630) se llevan un 3.6 %. Con
 * una foto no hay forma de saber el tamaño físico, así que distinguirlos es
 * adivinar — y «Cédula» escrito sobre un oficio se lee como que el portal
 * entendió el documento, que es cuando la gente deja de revisar.
 *
 * Ajustar la proporción igual sirve (el error es de milímetros); lo que no se
 * puede es ponerle nombre.
 */
describe('nombrar sólo cuando no hay duda', () => {
    it('una carta se puede nombrar: no se parece a ninguna otra', () => {
        expect(reconocerFormato(2159, 2794).seguro).toBe(true);
        expect(reconocerFormato(2794, 2159).seguro).toBe(true);
    });

    it('un oficio y una cédula NO: se llevan menos de un 5 %', () => {
        expect(reconocerFormato(2159, 3302).seguro).toBe(false);   // oficio de pie
        expect(reconocerFormato(856, 540).seguro).toBe(false);     // cédula acostada
    });

    /* La prueba que hace falta para creerle a la de arriba: con la regla vieja
     * —el segundo tiene que estar 1.6× más lejos que el primero— un papel que
     * cae EXACTO sobre el oficio daba «seguro» automáticamente, porque
     * cualquier cosa es infinitamente más que cero. O sea que la regla se
     * portaba peor justo en el caso ambiguo. */
    it('y eso vale también cuando el papel cae exacto sobre la medida', () => {
        const exacto = reconocerFormato(215.9 * 10, 330.2 * 10);
        expect(exacto.distancia).toBeCloseTo(0, 6);
        expect(exacto.seguro).toBe(false);
    });
});
