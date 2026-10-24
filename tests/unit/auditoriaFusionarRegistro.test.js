// `puntuar.mjs --escribir` reescribía el registro entero y borraba las
// verificaciones, el sello y todo lo escrito a mano. Estas pruebas fijan que la
// fusión toca SÓLO lo que la regla deriva (ejes, pct, estado, hallazgos) y deja
// el resto idéntico.

import { describe, it, expect } from 'vitest';
import { EJES } from '../../auditoria/areas.mjs';
import { fusionarRegistro, pctDeArea } from '../../auditoria/fusionar-registro.mjs';

const ejesCon = (pct, extra = {}) => Object.fromEntries(EJES.map(e => [e.id, { pct, evidencia: `viejo ${pct}`, hallazgos: ['viejo'], ...extra }]));
const calculoCon = pct => Object.fromEntries(EJES.map(e => [e.id, { pct, evidencia: `nuevo ${pct}`, hallazgos: e.id === 'flujo' ? ['pendiente real'] : [] }]));

function registroDeEjemplo() {
    return {
        nota: 'nota del registro',
        iniciado: '2026-08-23',
        recalculado: '2026-08-23',
        campo_que_nadie_conoce: { x: 1 },
        areas: {
            pedidos: {
                ejes: ejesCon(80, { nota_a_mano: 'medido en sala el 2026-10-01' }),
                pct: 80, estado: 'en-curso',
                sello_sala: { fecha: '2026-10-02', evidencia: 'corrida real en Salud 4' },
                hallazgos: ['[flujo] viejo'],
                verificaciones: [
                    { fecha: '2026-08-23', evidencia: 'Auditoría completa' },
                    { fecha: '2026-10-22', evidencia: 'H10 → 28edadc84' },
                ],
                descongelada_el: '2026-10-20',
                nota_del_area: 'algo escrito a mano',
            },
        },
    };
}

describe('fusionarRegistro', () => {
    it('conserva verificaciones, sello, notas y campos desconocidos tal cual', () => {
        const viejo = registroDeEjemplo();
        const copia = structuredClone(viejo);
        const nuevo = fusionarRegistro(viejo, { pedidos: calculoCon(96) }, { hoy: '2026-10-24' });

        expect(viejo).toEqual(copia);   // no muta la entrada
        const a = nuevo.areas.pedidos, b = copia.areas.pedidos;
        expect(a.verificaciones).toEqual(b.verificaciones);
        expect(a.sello_sala).toEqual(b.sello_sala);
        expect(a.descongelada_el).toBe(b.descongelada_el);
        expect(a.nota_del_area).toBe(b.nota_del_area);
        expect(nuevo.nota).toBe(copia.nota);
        expect(nuevo.iniciado).toBe(copia.iniciado);
        expect(nuevo.campo_que_nadie_conoce).toEqual(copia.campo_que_nadie_conoce);
        expect(nuevo.recalculado).toBe('2026-10-24');
    });

    it('reemplaza pct/evidencia/hallazgos de cada eje y conserva lo escrito a mano dentro del eje', () => {
        const nuevo = fusionarRegistro(registroDeEjemplo(), { pedidos: calculoCon(96) });
        for (const e of EJES) {
            const v = nuevo.areas.pedidos.ejes[e.id];
            expect(v.pct).toBe(96);
            expect(v.evidencia).toBe('nuevo 96');
            expect(v.nota_a_mano).toBe('medido en sala el 2026-10-01');
        }
        expect(nuevo.areas.pedidos.ejes.flujo.hallazgos).toEqual(['pendiente real']);
        expect(nuevo.areas.pedidos.hallazgos).toEqual(['[flujo] pendiente real']);
    });

    it('deriva pct y estado con la regla del gate: sello + ejes ≥95 = 100 y congelado', () => {
        const nuevo = fusionarRegistro(registroDeEjemplo(), { pedidos: calculoCon(96) });
        expect(nuevo.areas.pedidos.pct).toBe(100);
        expect(nuevo.areas.pedidos.estado).toBe('congelado');
        expect(pctDeArea(nuevo.areas.pedidos)).toBe(nuevo.areas.pedidos.pct);
    });

    it('un desbloqueo abierto no vuelve solo a congelado', () => {
        const nuevo = fusionarRegistro(registroDeEjemplo(), { pedidos: calculoCon(96) }, { desbloqueadas: ['pedidos'] });
        expect(nuevo.areas.pedidos.estado).toBe('en-curso');
    });

    it('sin sello topa en 95 y si los ejes bajan, el pct baja', () => {
        const viejo = registroDeEjemplo();
        viejo.areas.pedidos.sello_sala = null;
        expect(fusionarRegistro(viejo, { pedidos: calculoCon(99) }).areas.pedidos).toMatchObject({ pct: 95, estado: 'completo' });
        expect(fusionarRegistro(viejo, { pedidos: calculoCon(70) }).areas.pedidos).toMatchObject({ pct: 70, estado: 'en-curso' });
    });

    it('conserva un eje que la regla no produce', () => {
        const viejo = registroDeEjemplo();
        viejo.areas.pedidos.ejes.eje_a_mano = { pct: 50, evidencia: 'a mano', hallazgos: ['h'] };
        const calc = calculoCon(96);
        const nuevo = fusionarRegistro(viejo, { pedidos: calc });
        expect(nuevo.areas.pedidos.ejes.eje_a_mano).toEqual(viejo.areas.pedidos.ejes.eje_a_mano);
    });

    it('un área nueva nace con sello vacío y una verificación inicial; un área que no se calculó queda intacta', () => {
        const viejo = registroDeEjemplo();
        viejo.areas.vieja = { pct: 12, otra: 'cosa' };
        const nuevo = fusionarRegistro(viejo, { pedidos: calculoCon(96), ventas: calculoCon(90) },
            { verificacionInicial: { fecha: '2026-10-24', evidencia: 'primera' } });
        expect(nuevo.areas.vieja).toEqual({ pct: 12, otra: 'cosa' });
        expect(nuevo.areas.ventas).toMatchObject({ pct: 90, estado: 'en-curso', sello_sala: null,
            verificaciones: [{ fecha: '2026-10-24', evidencia: 'primera' }] });
    });
});
