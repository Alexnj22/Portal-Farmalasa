import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@nucleo/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

const { rpcConRespaldo, codigoDeNegocio, esFuncionInexistente, olvidarFuncionesInexistentes } =
    await import('@nucleo/data/rpcConRespaldo');
const { mensajeAmigable } = await import('@nucleo/utils/errorMessages');

describe('rpcConRespaldo — una función que puede no existir todavía', () => {
    beforeEach(() => { rpc.mockReset(); olvidarFuncionesInexistentes(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });

    it('si la función existe, usa su respuesta y no toca el respaldo', async () => {
        rpc.mockResolvedValue({ data: { ciclo: 2 }, error: null });
        const respaldo = vi.fn();
        const r = await rpcConRespaldo('pedir_reenvio_sala', { p: 1 }, respaldo);
        expect(r).toEqual({ data: { ciclo: 2 }, error: null, camino: 'rpc' });
        expect(rpc).toHaveBeenCalledWith('pedir_reenvio_sala', { p: 1 });
        expect(respaldo).not.toHaveBeenCalled();
    });

    it('si no existe (PGRST202 o 42883), corre el respaldo y recuerda no volver a preguntar', async () => {
        rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
        const respaldo = vi.fn().mockResolvedValue({ data: 'viejo', error: null });
        const r1 = await rpcConRespaldo('finalizar_sala_con_cajas', {}, respaldo);
        const r2 = await rpcConRespaldo('finalizar_sala_con_cajas', {}, respaldo);
        expect(r1).toEqual({ data: 'viejo', error: null, camino: 'respaldo' });
        expect(r2.camino).toBe('respaldo');
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(respaldo).toHaveBeenCalledTimes(2);

        rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } });
        const r3 = await rpcConRespaldo('programar_entrega_sala', {}, respaldo);
        expect(r3.camino).toBe('respaldo');
    });

    it('la memoria es por función: otra función se sigue preguntando', async () => {
        rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });
        await rpcConRespaldo('a', {}, async () => ({ data: null, error: null }));
        rpc.mockResolvedValueOnce({ data: 1, error: null });
        const r = await rpcConRespaldo('b', {}, vi.fn());
        expect(r.camino).toBe('rpc');
    });

    it('un error de negocio NO cae al respaldo: se devuelve tal cual', async () => {
        const error = { code: 'P0001', message: 'YA_FINALIZADO: esa sala ya estaba finalizada' };
        rpc.mockResolvedValue({ data: null, error });
        const respaldo = vi.fn();
        const r = await rpcConRespaldo('finalizar_sala_con_cajas', {}, respaldo);
        expect(r.error).toBe(error);
        expect(r.camino).toBe('rpc');
        expect(respaldo).not.toHaveBeenCalled();
        expect(codigoDeNegocio(r.error)).toBe('YA_FINALIZADO');
        // Y se sigue preguntando la próxima vez.
        await rpcConRespaldo('finalizar_sala_con_cajas', {}, respaldo);
        expect(rpc).toHaveBeenCalledTimes(2);
    });

    it('un respaldo que lanza vuelve como error, no revienta', async () => {
        rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
        const boom = new Error('red');
        const r = await rpcConRespaldo('x', {}, async () => { throw boom; });
        expect(r).toEqual({ data: null, error: boom, camino: 'respaldo' });
    });

    it('códigos y textos', () => {
        expect(esFuncionInexistente({ code: 'PGRST202' })).toBe(true);
        expect(esFuncionInexistente({ code: 'P0001' })).toBe(false);
        expect(esFuncionInexistente(null)).toBe(false);
        expect(codigoDeNegocio({ message: 'PAGINA_ITEMS_REQUERIDO: el pedido…' })).toBe('PAGINA_ITEMS_REQUERIDO');
        expect(codigoDeNegocio({ message: 'No se puede finalizar: la sala está en pausa.' })).toBe(null);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(mensajeAmigable({ code: 'P0001', message: 'NO_INICIADO: esa sala no empezó a prepararse' }))
            .toBe('Esa sala todavía no empezó a prepararse: no se puede finalizar.');
        expect(mensajeAmigable({ code: 'P0001', message: 'YA_CONFIRMADO: la llegada del reenvío 2 ya se confirmó' }))
            .toMatch(/reenvío ya se había confirmado/);
    });
});
