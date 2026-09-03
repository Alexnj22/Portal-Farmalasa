import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════════════
// «En ningún lado me sale quién recibe.»
//
// La entrega de la caja salió a producción el 3-sep (v2.964.0) y esa misma
// tarde Salud 2 la usó por primera vez: corte de las 12:05, lo confirmó
// Cristian Humberto y la caja la recibió Karen Figueroa. El dato se pidió con
// carné, se guardó en `cortes_caja.recibido_por`… y «Hoy» —la pantalla donde
// trabaja la sala— no lo mostraba en ninguna parte.
//
// El corte de acá es el REAL (id 698). Lo que se ancla:
//
//   · que el nombre de quien recibe SE PINTA, que es el reporte entero;
//   · que quien recibe y quien entrega NO se confunden — el servidor rechaza
//     que quien hizo el corte reciba su propia caja, así que son dos personas
//     a propósito y un rótulo cruzado nombraría al que no fue;
//   · que «nadie la recibió» se dibuja igual de visible, con su motivo. Es la
//     mitad «avisar» de la decisión del usuario («avisar primero, medir,
//     después bloquear»), y un aviso que se esconde cuando la respuesta es la
//     mala no es un aviso.
// ═══════════════════════════════════════════════════════════════════════════

// El padrón: quien recibe tiene su ficha con foto firmada. Sin el store, el
// avatar cae a la inicial — que es exactamente el silencio que la migración de
// `get_cortes_resolutores` vino a cerrar, no lo que esta prueba mide.
vi.mock('../../src/store/staffStore', () => ({
    useStaffStore: (selector) => selector({ employees: [], historialCompleto: true }),
}));

const EntregaDelTurno = (await import('../../src/components/cortes/EntregaDelTurno.jsx')).default;

const CRISTIAN = { id: 'c-1', name: 'Cristian Humberto' };
const KAREN = { id: 'k-1', name: 'Karen Figueroa' };

/* Corte 698 — Salud 2, 3-sep, 12:05. El primero que se entregó de verdad. */
const ENTREGADO = {
    id: 698, tipo: 'C', hora: '12:05:48', estado: 'CONFIRMADO',
    employee_id: CRISTIAN.id, hizo: { name: CRISTIAN.name },
    resuelto_por: CRISTIAN.id,
    recibido_por: KAREN.id, recibe: { name: KAREN.name },
    entrega: 'RECIBIDO', sin_entrega_motivo: null,
};

const PERSONAS = new Map([[CRISTIAN.id, CRISTIAN], [KAREN.id, KAREN]]);

describe('EntregaDelTurno', () => {
    it('dice quién recibió la caja, con su nombre', () => {
        render(<EntregaDelTurno corte={ENTREGADO} personas={PERSONAS} />);
        expect(screen.getByText('Recibió la caja')).toBeTruthy();
        expect(screen.getByText('Karen Figueroa')).toBeTruthy();
    });

    it('no confunde a quien entrega con quien recibe', () => {
        const { container } = render(<EntregaDelTurno corte={ENTREGADO} personas={PERSONAS} />);
        const texto = container.textContent;
        // El orden importa: primero entrega, después recibe. Cruzados, la
        // pantalla nombraría a Cristian como quien se hizo cargo del dinero.
        expect(texto.indexOf('Entregó')).toBeLessThan(texto.indexOf('Recibió la caja'));
        expect(texto.indexOf('Cristian Humberto')).toBeLessThan(texto.indexOf('Karen Figueroa'));
    });

    it('el corte hecho desde la caja no llama «entregó» a quien sólo firmó', () => {
        render(<EntregaDelTurno personas={PERSONAS}
            corte={{ ...ENTREGADO, employee_id: null, hizo: null }} />);
        expect(screen.getByText('Confirmó')).toBeTruthy();
        expect(screen.queryByText('Entregó')).toBeNull();
    });

    it('«nadie la recibió» se dibuja igual, con el motivo escrito', () => {
        render(<EntregaDelTurno personas={PERSONAS} corte={{
            ...ENTREGADO, recibido_por: null, recibe: null,
            entrega: 'SIN_ENTREGA', sin_entrega_motivo: 'quedó sola en la sala',
        }} />);
        expect(screen.getByText('Nadie la recibió')).toBeTruthy();
        expect(screen.getByText('quedó sola en la sala')).toBeTruthy();
    });

    it('sin corte no pinta nada — el cierre del día no tiene a quién entregar', () => {
        const { container } = render(<EntregaDelTurno corte={null} personas={PERSONAS} />);
        expect(container.textContent).toBe('');
    });
});
