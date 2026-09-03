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
const { cadenaDeEntregas } = await import('../../src/utils/cortesDiagnostico.js');

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

const JONATHAN = { id: 'j-1', name: 'Jonathan Melgar' };
const GLENDA = { id: 'g-1', name: 'Glenda Anaya' };

/* Un corte con su entrega. Los turnos de sala encadenan: quien recibió a las
 * 12 es quien corta a las 4. */
const corte = (id, hora, dio, rec, extra = {}) => ({
    id, tipo: 'C', hora, estado: 'CONFIRMADO',
    employee_id: dio.id, hizo: { name: dio.name },
    resuelto_por: dio.id,
    recibido_por: rec?.id || null, recibe: rec ? { name: rec.name } : null,
    entrega: rec ? 'RECIBIDO' : 'SIN_ENTREGA', sin_entrega_motivo: null,
    ...extra,
});

describe('EntregaDelTurno', () => {
    it('dice de quién a quién, y en ese orden', () => {
        const { container } = render(<EntregaDelTurno entregas={[ENTREGADO]} personas={PERSONAS} />);
        const texto = container.textContent;
        expect(texto).toContain('Cristian Humberto le entregó la caja a');
        expect(texto).toContain('Karen Figueroa');
        // Cruzados, la pantalla nombraría a Cristian como quien se hizo cargo
        // del dinero — y el servidor rechaza justamente eso.
        expect(texto.indexOf('Cristian Humberto')).toBeLessThan(texto.indexOf('Karen Figueroa'));
        expect(texto).toContain('corte de las 12:05');
    });

    it('con tres cortes dibuja la cadena y nombra a quien la tiene AHORA', () => {
        const { container } = render(<EntregaDelTurno personas={PERSONAS} entregas={[
            corte(1, '12:05:48', CRISTIAN, KAREN),
            corte(2, '16:30:00', KAREN, JONATHAN),
            corte(3, '21:00:12', JONATHAN, GLENDA),
        ]} />);
        const texto = container.textContent;
        expect(texto).toContain('La caja pasó por 3 manos hoy');
        expect(texto).toContain('Glenda Anaya');
        expect(texto).toContain('última entrega de las 21:00');
    });

    it('la cadena mete a cada persona UNA vez, no dos', () => {
        // Karen aparece como quien recibe a las 12 y como quien entrega a las
        // 16: son el mismo eslabón. Duplicarla dibujaría `Karen → Karen`.
        const nodos = cadenaDeEntregas([
            corte(1, '12:05:48', CRISTIAN, KAREN),
            corte(2, '16:30:00', KAREN, JONATHAN),
            corte(3, '21:00:12', JONATHAN, GLENDA),
        ]);
        expect(nodos.map((n) => n.id)).toEqual([CRISTIAN.id, KAREN.id, JONATHAN.id, GLENDA.id]);
        expect(nodos.some((n) => n.salto)).toBe(false);
    });

    it('no inventa un traspaso cuando el que corta no es el que recibió antes', () => {
        // Karen recibió a las 12; el corte de las 16 lo hace Jonathan, que nunca
        // la recibió. `Karen → Jonathan` sería un traspaso que nadie hizo.
        const { container } = render(<EntregaDelTurno personas={PERSONAS} entregas={[
            corte(1, '12:05:48', CRISTIAN, KAREN),
            corte(2, '16:30:00', JONATHAN, GLENDA),
        ]} />);
        expect(container.textContent).toContain('·');
    });

    it('«sin entregar» se dice, y nombra a quien confirmó', () => {
        const { container } = render(<EntregaDelTurno personas={PERSONAS} entregas={[
            corte(1, '12:05:48', CRISTIAN, null, { sin_entrega_motivo: 'quedó sola en la sala' }),
        ]} />);
        expect(container.textContent).toContain('confirmó');
        expect(container.textContent).toContain('sin entregar la caja');
        expect(container.textContent).toContain('Cristian Humberto');
    });

    it('sin entregas no pinta nada — el cierre del día no tiene a quién entregar', () => {
        const { container } = render(<EntregaDelTurno entregas={[]} personas={PERSONAS} />);
        expect(container.textContent).toBe('');
    });
});
