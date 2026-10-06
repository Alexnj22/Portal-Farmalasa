import { describe, expect, it } from 'vitest';
import { horasDelCandado, INTERRUPTOR, rotuloDeInterruptor, SIN_NOMBRE, tiempoRestante } from '@nucleo/utils/mantenimiento';

describe('mantenimiento', () => {
    it('todo freno del CHECK de traslado_interruptor tiene nombre', () => {
        // La lista del CHECK (20260918022307). Una acción nueva ahí sin nombre acá
        // sale como «Movimiento sin nombre»: pasó con `anular`.
        for (const a of ['enviar', 'recibir', 'devolver_enviar', 'devolver_recibir', 'sobrante_enviar', 'sobrante_recibir', 'anular']) {
            expect(INTERRUPTOR[a], a).toBeTruthy();
        }
        expect(rotuloDeInterruptor('otra')).toBe(SIN_NOMBRE);
    });
    it('lo que le falta a un candado', () => {
        const ahora = Date.parse('2026-10-05T12:00:00Z');
        expect(tiempoRestante('2026-10-05T12:28:30Z', ahora)).toBe('faltan 28 min');
        expect(tiempoRestante('2026-10-05T15:05:00Z', ahora)).toBe('faltan 3 h 5 min');
        expect(tiempoRestante('2026-10-05T11:00:00Z', ahora)).toBe('vencido');
    });
    it('las horas de un candado', () => {
        expect(horasDelCandado({ locked_at: '2026-10-05T12:00:00Z', expires_at: '2026-10-05T16:10:00Z' })).toBe('4');
        expect(horasDelCandado({ locked_at: '2026-10-05T12:00:00Z', expires_at: '2026-10-05T12:10:00Z' })).toBe('1');
    });
});
