// Cinco capas de datos, y la MISMA pregunta en todas: ¿lo que se pide entero,
// llega entero? ¿y lo que decide, lo decide la base?
//
// Son de áreas distintas —Min·Máx, Cortes, Envíos, el interruptor del traslado
// y Metas— pero comparten los dos modos de falla de esta parte del portal, y
// los dos son mudos:
//
//   1. **El tope de 1000.** PostgREST corta ahí sin error. Una bandeja
//      incompleta se ve idéntica a una completa, y `.limit(1000)` es peor que
//      no poner nada porque es el cap EXACTO: el día que la tabla lo cruza,
//      trunca en silencio.
//   2. **Decidir desde el navegador.** Aprobar, cancelar o resolver van por RPC
//      justamente para que la regla viva en un lado solo. Un `update` directo
//      cuya policy no pasa afecta cero filas y devuelve `error: null`.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const { fetchAllMinMaxChangeRequests, decidirMinMax, insertMinMaxChangeRequest } =
    await import('../../src/data/minmaxRequests');
const { fetchCortes, resolverCorte, reabrirCorte } = await import('../../src/data/cortes');
const { cancelarEnvio, fetchEnviosVivos, fetchEnviosHistorial } = await import('../../src/data/envios');
const { fetchMetasDashboard, guardarMetaManual, confirmarMeta } = await import('../../src/data/metas');
const { fetchTrasladoSwitch, setTrasladoSwitch } = await import('../../src/data/trasladoSwitch');

beforeEach(() => espia.limpiar());

describe('lo que se pide entero, se pagina', () => {
    it('la bandeja de Min·Máx pagina en vez de poner un tope', async () => {
        // `.limit(1000)` está prohibido: es el cap exacto de PostgREST, así que
        // la bandeja mostraría 1000 de N sin decirlo.
        await fetchAllMinMaxChangeRequests();
        expect(espia.tabla()).toBe('minmax_change_requests');
        expect(espia.uso('range')).toBe(true);
        expect(espia.uso('limit')).toBe(false);
    });

    it('los cortes del período también', async () => {
        // Son ~30 por día: un rango de dos meses ya cruza el tope.
        await fetchCortes({ desde: '2026-06-01', hasta: '2026-08-24' });
        expect(espia.tabla()).toBe('cortes_caja');
        expect(espia.uso('range')).toBe(true);
    });

    it('el historial de envíos pide un tope EXPLÍCITO, y no es 1000', () => {
        // Acá el tope es deliberado —es un historial que se mira de a poco—, y
        // por eso el número tiene que estar lejos del cap: un tope que coincide
        // con el cap no se distingue de un truncamiento.
        fetchEnviosHistorial();
        expect(espia.rpc[0].nombre).toBe('get_envios_historial');
        expect(espia.rpc[0].args.p_limite).toBe(100);
        expect(espia.rpc[0].args.p_limite).toBeLessThan(1000);
    });
});

describe('quien decide es la base', () => {
    it('aprobar un Min·Máx llama a una función, no escribe la tabla', async () => {
        await decidirMinMax(42, true, 'va');
        expect(espia.rpc[0]).toEqual({ nombre: 'approve_minmax_request',
                                       args: { p_request_id: 42, p_note: 'va' } });
        expect(espia.uso('update')).toBe(false);
    });

    it('rechazar llama a OTRA función, no a la misma con una bandera', async () => {
        await decidirMinMax(42, false, 'no');
        expect(espia.rpc[0].nombre).toBe('reject_minmax_request');
    });

    it('una nota vacía viaja como null', async () => {
        await decidirMinMax(42, true);
        expect(espia.rpc[0].args.p_note).toBeNull();
    });

    it('aprobar devuelve lo que contestó la base', async () => {
        // Desde el 2026-08-14 la función trae el par ANTERIOR: el único momento
        // en que alguien lo tiene sin volver a consultar es justo antes de
        // pisarlo. Sin eso el historial pintaba «MIN — MAX —».
        const r = await decidirMinMax(42, true);
        expect(r.ok).toBe(true);
        expect(r.error).toBeNull();
        expect(r).toHaveProperty('data');   // el par anterior se pasa tal cual
    });

    it('resolver y reabrir un corte van por función', () => {
        resolverCorte(7, 'RESUELTO', { motivo: 'faltante repuesto' });
        expect(espia.rpc[0].nombre).toBe('resolver_corte_caja');
        espia.limpiar();
        reabrirCorte(7, 'llegó el comprobante');
        expect(espia.rpc[0]).toEqual({ nombre: 'reabrir_corte_caja',
                                       args: { p_id: 7, p_motivo: 'llegó el comprobante' } });
    });

    it('cancelar un envío también', async () => {
        await cancelarEnvio(9, 'se rompió la caja');
        expect(espia.rpc[0].nombre).toBe('cancelar_envio');
        expect(espia.uso('update')).toBe(false);
    });

    it('confirmar y guardar una meta no tocan la tabla directo', async () => {
        // El monto de la meta es lo que se le paga a la sala: la regla de quién
        // puede fijarlo tiene que vivir en un lado solo.
        await guardarMetaManual({ branchId: 4, yearMonth: '2026-08', monto: 50000, nota: 'x' });
        expect(espia.rpc[0].nombre).toBe('upsert_meta_manual');
        espia.limpiar();
        await confirmarMeta({ id: 3, monto: 51000, nota: '' });
        expect(espia.rpc[0].nombre).toBe('confirmar_meta_supervisor');
        expect(espia.uso('update')).toBe(false);
    });

    it('el tablero de metas se arma en la base, con el mes como argumento', async () => {
        await fetchMetasDashboard('2026-08');
        expect(espia.rpc[0].nombre).toBe('get_metas_dashboard');
        expect(Object.values(espia.rpc[0].args)).toContain('2026-08');
    });

    it('los envíos vivos salen de una función, no de armar la lista acá', async () => {
        await fetchEnviosVivos();
        expect(espia.rpc[0].nombre).toBe('get_envios_vivos');
    });
});

describe('el interruptor del traslado son DOS, no uno', () => {
    it('se leen los dos juntos y en orden', async () => {
        // Pausar el envío y la recepción a la vez deja varado lo que ya salió de
        // bodega y todavía no llegó: fuera de una sala y sin poder entrar en la
        // otra. Ante un problema se pausa el envío y la recepción queda abierta.
        await fetchTrasladoSwitch();
        expect(espia.tabla()).toBe('traslado_interruptor');
        expect(espia.primero('order')).toEqual(['accion']);
    });

    it('cambiarlo va por función, con la acción como argumento', () => {
        setTrasladoSwitch('envio', true, 'incidente de bodega');
        expect(espia.rpc[0]).toEqual({ nombre: 'set_traslado_interruptor',
            args: { p_accion: 'envio', p_pausado: true, p_motivo: 'incidente de bodega' } });
    });

    it('sin motivo manda null', () => {
        setTrasladoSwitch('recepcion', false, '');
        expect(espia.rpc[0].args.p_motivo).toBeNull();
    });
});

describe('lo que sí se escribe directo', () => {
    it('crear una solicitud de Min·Máx es un insert: la policy la valida', () => {
        insertMinMaxChangeRequest({ erp_product_id: 1, propuesta_min: 5 });
        expect(espia.tabla()).toBe('minmax_change_requests');
        expect(espia.uso('insert')).toBe(true);
        expect(espia.rpc).toHaveLength(0);
    });
});
