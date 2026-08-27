import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import ConteosDeBolsas from '../../src/components/bolsas/ConteosDeBolsas';

// ═══════════════════════════════════════════════════════════════════════════
// La tabla de tandas dice lo JUSTIFICADO, su COBERTURA y lo que no tiene
// respaldo.
//
// Ancla los tres hallazgos de la auditoría del 2026-08-26, que existían en los
// datos y no en la pantalla. Los tres se rompen en silencio —la fila sigue
// pintándose, sólo que sin decir la mitad— así que ningún gate los caza y una
// prueba es la única red.
//
//   1. «Sin resolver: $0.00» sobre −$4,592.24 que salieron de las bolsas. Las
//      16 diferencias del circuito se saldaron con «Justificar», así que la
//      única columna de diferencias mostraba cero en las cuatro tandas.
//
//   2. La tanda del 21-ago cubrió CINCO salas de seis. Salud 4 quedó afuera y
//      se contó nueve días después. La celda decía «14 → 20 ago» —el rango de
//      lo que SÍ entró—, que es cierto y no delata a la que falta.
//
//   3. (Retirado el mismo día.) La primera versión marcaba las justificaciones
//      sin foto de respaldo. «no hace falta foto de respaldo» (usuario): la foto
//      es opcional por decisión, así que señalar su ausencia es acusar a quien
//      hizo lo permitido, y una alarma que nadie va a apagar enseña a ignorar
//      las de al lado. El dato sigue viniendo del servidor, sin tratarse como
//      hallazgo.
//
// Los datos son los reales de producción de esa fecha, recortados.
// ═══════════════════════════════════════════════════════════════════════════

/** La tanda del 26: cubre las seis salas, con $4,592.24 explicados y una sin foto. */
const COMPLETA = {
    id: 2, folio: 'CNT-260826-1', fecha: '2026-08-26', cuantas: 43,
    total_esperado: 23967.10, total_contado: 19374.86, diferencia: -4592.24,
    descuadradas: 11, resueltas: 11, pendiente: 0,
    justificado: -4592.24, sin_respaldo: 1, sin_respaldo_monto: -450,
    salas: 6, salas_fuera: [],
    dia_desde: '2026-08-17', dia_hasta: '2026-08-23',
    cerrado_at: '2026-08-26T17:14:29Z', cerrado_por: 'EDWIN NUÑEZ',
    contaron: [{ name: 'AUDELIA CALLEJAS', photo_url: null }], por_sala: [],
};

/** La del 21: cuadró al centavo y le faltó una sala. Las dos cosas a la vez. */
const INCOMPLETA = {
    id: 1, folio: 'CNT-260821-1', fecha: '2026-08-21', cuantas: 54,
    total_esperado: 32006.16, total_contado: 32006.16, diferencia: 0,
    descuadradas: 0, resueltas: 0, pendiente: 0,
    justificado: 0, sin_respaldo: 0, sin_respaldo_monto: 0,
    salas: 5, salas_fuera: ['Salud 4'],
    dia_desde: '2026-08-14', dia_hasta: '2026-08-20',
    cerrado_at: '2026-08-21T20:51:29Z', cerrado_por: 'EDWIN NUÑEZ',
    contaron: [], por_sala: [],
};

const pintar = (lista, extra = {}) => render(
    <ConteosDeBolsas lista={lista} plegada={false} onPlegar={() => {}} {...extra} />,
);

describe('Conteos · lo justificado', () => {
    it('dice el monto explicado, que la columna «Sin resolver» no puede decir', () => {
        pintar([COMPLETA]);
        // El cero es cierto: no queda nada por explicar.
        expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
        // Y esto es lo que faltaba: ese dinero salió igual. Sale DOS veces —en
        // el aviso de arriba y en la columna— y así tiene que ser: el aviso se
        // lee con la sección plegada, la columna dice de qué tanda es.
        expect(screen.getAllByText('−$4,592.24').length).toBe(2);
    });

    it('NO señala la falta de foto: es opcional por decisión', () => {
        // Ver el punto 3 del encabezado. `sin_respaldo` llega igual y no se pinta.
        pintar([COMPLETA]);
        expect(screen.queryByText(/sin respaldo/i)).toBeNull();
    });

    it('no inventa una cifra cuando la tanda cuadró de verdad', () => {
        pintar([INCOMPLETA]);
        expect(screen.queryByText(/^[−+]\$/)).toBeNull();
    });
});

describe('Conteos · cobertura', () => {
    it('dice cuántas salas entraron, no sólo el rango de días', () => {
        pintar([INCOMPLETA]);
        expect(screen.getByText(/5 salas/)).toBeTruthy();
    });

    it('nombra a la sala que se quedó esperando', () => {
        pintar([INCOMPLETA]);
        // Nombrarla, no «falta 1 sala»: si no, hay que abrir el detalle y
        // comparar seis nombres contra los que hay.
        expect(screen.getByText('Faltó Salud 4')).toBeTruthy();
    });

    it('no señala a la tanda que sí cubrió todo', () => {
        pintar([COMPLETA]);
        expect(screen.getByText(/6 salas/)).toBeTruthy();
        expect(screen.queryByText(/Faltó/)).toBeNull();
    });
});

describe('Conteos · el aviso de arriba', () => {
    it('sale aunque la sección esté PLEGADA, que es como arranca', () => {
        // El motivo de la prueba: el aviso nació dentro del bloque plegable y
        // por lo tanto invisible por defecto, que es exactamente el defecto que
        // venía a corregir.
        render(<ConteosDeBolsas lista={[COMPLETA, INCOMPLETA]} plegada onPlegar={() => {}} />);
        expect(screen.getByText('Para mirar en estas fechas')).toBeTruthy();
        // Plegada, la columna no se pinta: queda sólo la del aviso.
        expect(screen.getAllByText('−$4,592.24').length).toBe(1);
    });

    it('se calla cuando no hay nada que mirar', () => {
        const limpia = { ...INCOMPLETA, salas: 6, salas_fuera: [] };
        render(<ConteosDeBolsas lista={[limpia]} plegada onPlegar={() => {}} />);
        expect(screen.queryByText('Para mirar en estas fechas')).toBeNull();
    });
});
