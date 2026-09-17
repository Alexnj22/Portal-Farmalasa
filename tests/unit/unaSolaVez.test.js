import { describe, it, expect, vi } from 'vitest';
import { unaSolaVez } from '../../src/utils/unaSolaVez';

// ═══════════════════════════════════════════════════════════════════════════
// El doble toque que costó $377.61.
//
// Entre el 4 y el 16 de septiembre de 2026 se registraron 13 movimientos de
// caja de más, en 10 grupos, con los pares separados por 34 a 73 ms — y uno con
// TRES registros en un solo segundo. No era la sala escribiendo dos veces: el
// botón seguía activo mientras la foto del comprobante subía, porque lo que lo
// apagaba (`ocupado`) recién se encendía DESPUÉS de esa subida.
//
// Lo que estas pruebas anclan es el cerrojo: dos toques mientras la primera
// llamada está en vuelo tienen que ejecutar el trabajo UNA vez.
// ═══════════════════════════════════════════════════════════════════════════

/** Una promesa que se resuelve cuando la prueba quiera. */
function promesaControlada() {
    let resolver, rechazar;
    const promesa = new Promise((res, rej) => { resolver = res; rechazar = rej; });
    return { promesa, resolver, rechazar };
}

describe('unaSolaVez', () => {
    it('dos toques mientras la primera llamada está en vuelo ejecutan UNA vez', async () => {
        const { promesa, resolver } = promesaControlada();
        const trabajo = vi.fn(() => promesa);
        const guardar = unaSolaVez(trabajo);

        // Los dos toques, sin esperar en el medio: es exactamente lo que hace
        // un doble clic, y lo que un `useState` no alcanza a frenar porque su
        // valor nuevo no se ve hasta el próximo render.
        const a = guardar();
        const b = guardar();

        expect(trabajo).toHaveBeenCalledTimes(1);

        resolver('listo');
        await expect(a).resolves.toBe('listo');
        // El segundo toque recibe el resultado del primero, no `undefined`: así
        // quien llamó puede esperarlo y enterarse de cómo terminó.
        await expect(b).resolves.toBe('listo');
        expect(trabajo).toHaveBeenCalledTimes(1);
    });

    it('TRES toques seguidos también ejecutan una sola vez', async () => {
        // El caso real: CAESS $9.26 en Salud 5, tres filas a las 20:54:28.858,
        // .872 y 20:54:29.069 — 211 ms de punta a punta.
        const { promesa, resolver } = promesaControlada();
        const trabajo = vi.fn(() => promesa);
        const guardar = unaSolaVez(trabajo);

        guardar(); guardar(); guardar();
        expect(trabajo).toHaveBeenCalledTimes(1);

        resolver(null);
        await promesa;
    });

    it('cuando la primera terminó, el botón vuelve a servir', async () => {
        // Si el cerrojo no se soltara, la sala no podría anotar el SIGUIENTE
        // movimiento sin recargar: el arreglo sería peor que el defecto.
        const trabajo = vi.fn(async () => 'ok');
        const guardar = unaSolaVez(trabajo);

        await guardar();
        await guardar();

        expect(trabajo).toHaveBeenCalledTimes(2);
    });

    it('un fallo suelta el cerrojo: se puede reintentar', async () => {
        // Un corte de red no puede dejar el botón muerto para siempre.
        const trabajo = vi.fn()
            .mockRejectedValueOnce(new Error('sin red'))
            .mockResolvedValueOnce('a la segunda');
        const guardar = unaSolaVez(trabajo);

        await expect(guardar()).rejects.toThrow('sin red');
        await expect(guardar()).resolves.toBe('a la segunda');
        expect(trabajo).toHaveBeenCalledTimes(2);
    });

    it('los argumentos son los del PRIMER toque, no los del segundo', async () => {
        // El segundo toque no reabre la decisión: si llegara con otros datos,
        // aplicarlos escribiría algo que nadie confirmó.
        const { promesa, resolver } = promesaControlada();
        const trabajo = vi.fn(() => promesa);
        const guardar = unaSolaVez(trabajo);

        guardar({ monto: 115.16 });
        guardar({ monto: 999 });

        expect(trabajo).toHaveBeenCalledTimes(1);
        expect(trabajo).toHaveBeenCalledWith({ monto: 115.16 });

        resolver(null);
        await promesa;
    });

    it('una función que lanza en seco (sin promesa) también suelta el cerrojo', async () => {
        // `unaSolaVez` envuelve la llamada en un `async`, así que un `throw`
        // sincrónico llega como rechazo y no rompe el cerrojo.
        const trabajo = vi.fn(() => { throw new Error('rompió'); });
        const guardar = unaSolaVez(trabajo);

        await expect(guardar()).rejects.toThrow('rompió');
        await expect(guardar()).rejects.toThrow('rompió');
        expect(trabajo).toHaveBeenCalledTimes(2);
    });
});
