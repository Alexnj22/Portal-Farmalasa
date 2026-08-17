import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mensajeAmigable, MENSAJE_GENERICO } from '../../src/utils/errorMessages.js';

// `mensajeAmigable` compara contra una tira que junta message + details + hint +
// code, porque varias reglas matchean por CÓDIGO (`23505`, `22P02`). Lo que se
// MUESTRA, en cambio, tiene que ser sólo el mensaje: un `RAISE EXCEPTION` de
// plpgsql viene siempre con `code: 'P0001'`, y hasta el 2026-08-17 toda frase
// escrita para una persona salía a pantalla con « · P0001» pegado atrás.
describe('mensajeAmigable · qué se compara y qué se muestra', () => {
    beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('una frase del portal no arrastra el P0001 de Postgres', () => {
        const err = { message: 'Demasiados carnes sin reconocer seguidos. Espera unos minutos.', code: 'P0001', details: null, hint: null };
        expect(mensajeAmigable(err)).toBe('Demasiados carnes sin reconocer seguidos. Espera unos minutos.');
    });

    it('las reglas que matchean por código siguen funcionando', () => {
        // Acá el texto útil está en el código, no en el mensaje: si la
        // comparación mirara sólo `message`, este caso se perdería.
        const err = { message: 'duplicate key value violates unique constraint', code: '23505' };
        expect(mensajeAmigable(err)).toBe('Ya existe un registro con esos datos.');
    });

    it('un volcado técnico se sigue cambiando por el genérico', () => {
        const err = { message: 'sync_inventory_batch: <!DOCTYPE html><html>', code: 'PGRST202' };
        expect(mensajeAmigable(err)).not.toContain('DOCTYPE');
    });

    it('sin error, el respaldo', () => {
        expect(mensajeAmigable(null)).toBe(MENSAJE_GENERICO);
        expect(mensajeAmigable(null, 'No se pudo confirmar el carné.')).toBe('No se pudo confirmar el carné.');
    });
});
