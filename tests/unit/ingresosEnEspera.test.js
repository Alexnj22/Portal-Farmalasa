// La caja que no contesta no frena el ingreso (2026-11-03).
//
// `operar-caja` anota el ingreso sin número de la caja y contesta `en_espera`;
// este equipo lo recuerda y lo manda solo. Lo que estas pruebas cuidan:
//   · sólo se recuerda lo que el servidor dijo que está en espera;
//   · el reenvío espera a que venza el reclamo del envío original (90 s);
//   · lo que la caja aceptó, o lo que ya no se puede mandar, sale de la lista;
//   · «se está mandando» y la caja caída lo dejan para la próxima.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const ingresos = new Map();
vi.mock('@plataforma/archivosEnEspera', () => ({
    guardar: vi.fn(), listar: vi.fn(async () => []), quitar: vi.fn(),
    guardarIngreso: vi.fn(async (it) => { ingresos.set(it.id, it); }),
    listarIngresos: vi.fn(async () => [...ingresos.values()]),
    quitarIngreso: vi.fn(async (id) => { ingresos.delete(id); }),
}));

const invoke = vi.fn();
vi.mock('@nucleo/supabaseClient', () => ({
    supabase: { functions: { invoke: (...a) => invoke(...a) }, rpc: vi.fn() },
}));

const { anotarIngreso } = await import('@nucleo/data/bolsas');
const { reenviarIngresosEnEspera, ingresosEnEspera } = await import('@nucleo/data/ingresosEnEspera');

/** Un error de `functions.invoke` con su respuesta, como lo arma supabase-js. */
const fallo = (status, error) => ({
    data: null,
    error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
        context: { status, json: async () => ({ ok: false, error }) },
    }),
});
const viejo = (id, sala = 1) => ingresos.set(id, { id, sala, creado: Date.now() - 5 * 60_000 });

beforeEach(() => { ingresos.clear(); invoke.mockReset(); });

describe('anotarIngreso', () => {
    it('la caja no contestó: lo recuerda para mandarlo después', async () => {
        invoke.mockResolvedValueOnce({ data: { ok: true, en_espera: true, movimiento_del_portal: 77, aviso: 'La caja no respondió…' }, error: null });
        const r = await anotarIngreso({ sala: 4, monto: 5, concepto: 'POS' });
        expect(r.aviso).toMatch(/caja no respondió/);
        expect([...ingresos.values()]).toEqual([expect.objectContaining({ id: 77, sala: 4 })]);
    });

    it('la caja lo aceptó: no queda nada esperando', async () => {
        invoke.mockResolvedValueOnce({ data: { ok: true, movimiento_del_portal: 78, movimiento_en_caja: 9 }, error: null });
        await anotarIngreso({ sala: 4, monto: 5, concepto: 'POS' });
        expect(await ingresosEnEspera()).toBe(0);
    });
});

describe('reenviarIngresosEnEspera', () => {
    it('no toca uno recién anotado: el envío original todavía lo tiene reclamado', async () => {
        ingresos.set(1, { id: 1, sala: 1, creado: Date.now() });
        expect(await reenviarIngresosEnEspera()).toBe(1);
        expect(invoke).not.toHaveBeenCalled();
    });

    it('la caja lo recibió: sale de la lista', async () => {
        viejo(1, 3);
        invoke.mockResolvedValueOnce({ data: { ok: true, movimiento_en_caja: 55 }, error: null });
        expect(await reenviarIngresosEnEspera()).toBe(0);
        expect(invoke).toHaveBeenCalledWith('operar-caja', { body: { accion: 'reenviar_a_caja', sala: 3, movimiento: 1 } });
    });

    it('lo que ya no se puede mandar (anulado, día cerrado) sale de la lista', async () => {
        viejo(1);
        invoke.mockResolvedValueOnce(fallo(409, 'Ese movimiento está anulado.'));
        expect(await reenviarIngresosEnEspera()).toBe(0);
    });

    it('«se está mandando» lo deja para la próxima', async () => {
        viejo(1);
        invoke.mockResolvedValueOnce(fallo(409, 'Ese ingreso se está mandando a la caja en este momento. Espera un minuto.'));
        expect(await reenviarIngresosEnEspera()).toBe(1);
    });

    it('con la caja todavía caída no insiste con el resto', async () => {
        viejo(1); viejo(2);
        invoke.mockResolvedValueOnce(fallo(500, 'login sin cookie de sesión'));
        expect(await reenviarIngresosEnEspera()).toBe(2);
        expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('pasado un día lo suelta sin intentarlo', async () => {
        ingresos.set(1, { id: 1, sala: 1, creado: Date.now() - 25 * 3600_000 });
        expect(await reenviarIngresosEnEspera()).toBe(0);
        expect(invoke).not.toHaveBeenCalled();
    });
});
