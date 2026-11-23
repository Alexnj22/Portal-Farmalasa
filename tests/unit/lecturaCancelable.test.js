import { describe, it, expect, vi } from 'vitest';
import { lecturaCancelable } from '@nucleo/utils/lecturaCancelable';

const esperar = () => new Promise((r) => setTimeout(r, 0));
const diferida = () => { let resolver, rechazar; const p = new Promise((a, b) => { resolver = a; rechazar = b; }); return { p, resolver, rechazar }; };

describe('lecturaCancelable — «Cuándo se vende más» del Inicio', () => {
    it('una lectura que falla apaga la carga y avisa el error (antes: esqueleto para siempre)', async () => {
        const alLlegar = vi.fn(), alFallar = vi.fn(), alTerminar = vi.fn();
        lecturaCancelable(() => Promise.reject(new Error('red caída')), { alLlegar, alFallar, alTerminar });
        await esperar();
        expect(alLlegar).not.toHaveBeenCalled();
        expect(alFallar).toHaveBeenCalledTimes(1);
        expect(alTerminar).toHaveBeenCalledTimes(1);
    });

    it('si el armado de los datos lanza, también es error y la carga se apaga', async () => {
        const alFallar = vi.fn(), alTerminar = vi.fn();
        lecturaCancelable(() => Promise.resolve({ data: [] }), { alLlegar: () => { throw new Error('sala sin horario'); }, alFallar, alTerminar });
        await esperar();
        expect(alFallar).toHaveBeenCalledTimes(1);
        expect(alTerminar).toHaveBeenCalledTimes(1);
    });

    it('la respuesta de la sucursal anterior no pisa a la nueva aunque llegue después', async () => {
        const vieja = diferida(), nueva = diferida();
        const pintado = [];
        const abandonar = lecturaCancelable(() => vieja.p, { alLlegar: (r) => pintado.push(r) });
        abandonar(); // cambió la sucursal: el efecto se limpia
        lecturaCancelable(() => nueva.p, { alLlegar: (r) => pintado.push(r) });
        nueva.resolver('Salud 1');
        await esperar();
        vieja.resolver('La Popular');
        await esperar();
        expect(pintado).toEqual(['Salud 1']);
    });

    it('abandonada, no apaga la carga de la que la reemplazó ni avisa un error', async () => {
        const alFallar = vi.fn(), alTerminar = vi.fn();
        const abandonar = lecturaCancelable(() => Promise.reject(new Error('x')), { alFallar, alTerminar });
        abandonar();
        await esperar();
        expect(alFallar).not.toHaveBeenCalled();
        expect(alTerminar).not.toHaveBeenCalled();
    });
});
