// `endDate` es el ÚLTIMO día de la ausencia — la vuelta es el siguiente.
//
// Las dos fechas se parecen tanto que la diferencia sólo se ve el día que
// alguien la vive: la vacación de la primera persona que la tuvo en el portal
// terminaba el 21 y el aro anunciaba «vuelve el 21 de septiembre» sobre alguien
// que se reincorporaba el 22. No hay error, no hay fila de menos y la fecha
// sale bien formada — sólo que corrida un día.
//
// Se ancla acá porque el `+1` de `fechaDeVuelta` es exactamente la clase de
// línea que una simplificación borra: leída sola parece un ajuste sin motivo.
// El motivo es que las otras tres piezas que tocan `endDate` ya lo tratan como
// último día —`FormNovedad` escribe `date + 14` para los 15 días continuos y
// `date + días − 1` para una incapacidad, y el filtro de `estadoDePersona`
// cuenta a la persona ausente TODAVÍA ese día— así que quitarlo no arregla una
// inconsistencia: la crea.

import { describe, it, expect } from 'vitest';
import { fechaDeVuelta, estadoDesdeClave, estadoDePersona, estaAusenteHoy } from '../../src/utils/estadoDePersona';

const hoyISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('fechaDeVuelta — el día siguiente al último de la ausencia', () => {
    it('una vacación que termina el 21 vuelve el 22', () => {
        expect(fechaDeVuelta('2026-09-21')).toBe('22 de septiembre');
    });

    it('cruza el fin de mes sin quedarse en el 32', () => {
        expect(fechaDeVuelta('2026-09-30')).toBe('1 de octubre');
    });

    it('cruza el fin de año', () => {
        expect(fechaDeVuelta('2026-12-31')).toBe('1 de enero');
    });

    it('acepta un timestamp completo y se queda con la fecha', () => {
        expect(fechaDeVuelta('2026-09-21T08:00:00+00:00')).toBe('22 de septiembre');
    });

    it('sin fecha de fin no inventa una vuelta', () => {
        // Un permiso abierto. `null` es lo que hace que la píldora no diga
        // «vuelve el …» sobre algo que nadie decidió todavía.
        expect(fechaDeVuelta(null)).toBeNull();
        expect(fechaDeVuelta('')).toBeNull();
        expect(fechaDeVuelta('no es una fecha')).toBeNull();
    });
});

describe('los dos caminos —la ficha y la base— dicen la misma fecha', () => {
    it('el que viene de la base (clave + hasta) ya trae la vuelta formateada', () => {
        expect(estadoDesdeClave('VACATION', '2026-09-21').hasta).toBe('22 de septiembre');
    });

    it('el que se deriva del historial local dice lo mismo', () => {
        const emp = { id: 1, history: [{ type: 'VACATION', date: '2020-01-01', metadata: { endDate: '2099-09-21' } }] };
        expect(estadoDePersona(emp).hasta).toBe('22 de septiembre');
    });
});

describe('el último día de vacación la persona TODAVÍA no está', () => {
    it('con el endDate en hoy sigue contando como ausente', () => {
        // La otra mitad de la misma decisión: si `endDate` fuera el día de
        // regreso, hoy tendría que estar presente. Es ausente, y por eso la
        // vuelta es mañana.
        const emp = { id: 1, history: [{ type: 'VACATION', date: '2020-01-01', metadata: { endDate: hoyISO() } }] };
        expect(estaAusenteHoy(emp)).toBe(true);
        expect(estadoDePersona(emp).texto).toBe('En vacaciones');
    });
});
