import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════════════
// El aro cuando el navegador NO puede saberlo solo.
//
// Resolver el estado contra la lista de empleados del store parecía suficiente
// y no lo era: esa lista está ACOTADA. Quien no tiene `staff_list.can_view`
// recibe sólo los de su sucursal, y `employee_events` exige además
// `staff_detail` o `schedules` para leer los eventos de otro — así que para el
// resto **el historial llega vacío**, y un historial vacío es indistinguible de
// «esta persona no tiene ausencias».
//
// Ahí el aro mentía en silencio: decía «está» sobre alguien de quien no sabía
// nada. No fallaba nada, no faltaba ninguna fila, y sólo se notaba buscando a
// quien no estaba — que es el mismo silencio que el aro vino a cerrar, una capa
// más abajo.
//
// Lo que se ancla acá son las tres decisiones que lo cierran:
//   1. con el historial completo NO sale ni una petición;
//   2. sin él se pregunta a la base, y una pantalla con muchas caras pregunta
//      UNA vez, no una por cara;
//   3. quien está presente también se cachea, o el batcher no ahorraría nada.
// ═══════════════════════════════════════════════════════════════════════════

const rpc = vi.fn();
vi.mock('../../src/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

let estadoStore = {};
vi.mock('../../src/store/staffStore', () => ({
    useStaffStore: (selector) => selector(estadoStore),
}));

import AvatarConEstado from '../../src/components/common/AvatarConEstado';
import { _limpiarCache } from '../../src/data/estadosDePersonas';

const AUSENTE_HOY = { id: 'e-1', name: 'Quien Despachó' };

const montar = (emps) => render(
    <>{emps.map(e => <AvatarConEstado key={e.id} emp={e} px={48} />)}</>
).container;

const conAro = (c) => [...c.querySelectorAll('[data-estado]')].map(n => n.dataset.estado);

describe('El aro cuando el historial local está incompleto', () => {
    beforeEach(() => {
        cleanup(); _limpiarCache(); rpc.mockReset();
        estadoStore = { employees: [], historialCompleto: false };
    });
    afterEach(() => cleanup());

    it('con el historial COMPLETO no sale ni una petición', async () => {
        // Es el caso de quien tiene permiso: ya recibió todo en el arranque.
        // Preguntar de nuevo sería gastar una ranura del pool para un dato que
        // ya está en memoria.
        estadoStore = {
            historialCompleto: true,
            employees: [{ id: 'e-1', name: 'Quien Despachó', history: [] }],
        };
        montar([AUSENTE_HOY]);
        await new Promise(r => setTimeout(r, 0));
        expect(rpc).not.toHaveBeenCalled();
    });

    it('sin historial completo pregunta a la base y pinta el aro', async () => {
        rpc.mockResolvedValue({ data: [{ id: 'e-1', clave: 'VACATION', hasta: '2026-09-02' }], error: null });
        const c = montar([AUSENTE_HOY]);
        await waitFor(() => expect(conAro(c)).toEqual(['VACATION']));
        expect(rpc).toHaveBeenCalledWith('get_estados_de_personas', { p_ids: ['e-1'] });
    });

    it('veinte caras son UNA consulta, no veinte', async () => {
        // Es la razón de ser del batcher. Una pantalla de pedidos pinta decenas
        // de caras, y cada petición ocupa una ranura del pool de PostgREST — el
        // mismo que una lectura lenta llena hasta tirar el portal.
        rpc.mockResolvedValue({ data: [], error: null });
        const gente = Array.from({ length: 20 }, (_, i) => ({ id: `e-${i}`, name: `Persona ${i}` }));
        montar(gente);
        await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
        expect(rpc.mock.calls[0][1].p_ids).toHaveLength(20);
    });

    it('quien está presente también se cachea — si no, el batcher no ahorra nada', async () => {
        // La función descarta a los presentes antes de devolver, así que un id
        // que NO vuelve significa «está». Sin cachear esa ausencia de respuesta,
        // cada render volvería a preguntar por la mayoría de la gente.
        rpc.mockResolvedValue({ data: [], error: null });
        montar([AUSENTE_HOY]);
        await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));

        cleanup();
        montar([AUSENTE_HOY]);
        await new Promise(r => setTimeout(r, 0));
        expect(rpc).toHaveBeenCalledTimes(1);
    });

    it('sin permiso para ver el motivo, el aro dice «no está» y no por qué', async () => {
        // Lo decide la base: quien no puede leer `employee_events` recibe
        // `AUSENTE` a secas. Que el aro nunca calle no puede costar que toda la
        // empresa se entere de que alguien está de incapacidad.
        rpc.mockResolvedValue({ data: [{ id: 'e-1', clave: 'AUSENTE', hasta: null }], error: null });
        const c = montar([AUSENTE_HOY]);
        await waitFor(() => expect(conAro(c)).toEqual(['AUSENTE']));
        expect(c.textContent).not.toContain('vacaciones');
        expect(c.querySelector('[data-estado]').getAttribute('title')).toBe('No está hoy');
    });

    it('si la consulta falla NO se inventa un «está»', async () => {
        // Un error tragado dejaría el mapa vacío y el aro desaparecería de todas
        // las fotos sin que nada lo delatara — que es peor que no tenerlo.
        const avisos = vi.spyOn(console, 'error').mockImplementation(() => {});
        rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
        montar([AUSENTE_HOY]);
        await waitFor(() => expect(avisos).toHaveBeenCalled());

        // Y el siguiente render reintenta en vez de quedarse con el hueco.
        rpc.mockResolvedValue({ data: [{ id: 'e-1', clave: 'VACATION', hasta: null }], error: null });
        cleanup();
        const c = montar([AUSENTE_HOY]);
        await waitFor(() => expect(conAro(c)).toEqual(['VACATION']));
        avisos.mockRestore();
    });
});
