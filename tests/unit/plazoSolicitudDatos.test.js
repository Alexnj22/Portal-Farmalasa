import { describe, it, expect } from 'vitest';
import { sumarDiasHabiles, diasHabilesEntre, plazoDe } from '../../src/data/solicitudesDatos';

// El plazo de una solicitud de datos personales (Art. 20 de la Ley de
// Protección de Datos): 20 días HÁBILES desde el acuse, 40 si se prorrogó.
//
// Se prueba la matemática y no la pantalla porque el error que importa no se
// ve: contar un día de más devuelve una fecha de vencimiento posterior a la
// real, y eso NO falla — muestra «te quedan 3 días» el día que el plazo ya se
// venció. Un plazo legal mal contado es una multa, no un defecto de layout.
//
// Las fechas están fijas a propósito: 2026-09-04 es viernes, el 05 sábado, el
// 06 domingo y el 07 lunes.

describe('sumarDiasHabiles', () => {
    it('salta el fin de semana: viernes + 1 hábil es lunes', () => {
        const viernes = new Date('2026-09-04T12:00:00');
        expect(sumarDiasHabiles(viernes, 1).getDay()).toBe(1);
    });

    it('veinte hábiles desde un viernes caen cuatro semanas después, en viernes', () => {
        const viernes = new Date('2026-09-04T12:00:00');
        const vence = sumarDiasHabiles(viernes, 20);
        expect(vence.getDay()).toBe(5);
        expect(vence.toISOString().slice(0, 10)).toBe('2026-10-02');
    });

    it('no mueve la fecha si no hay días que sumar', () => {
        const d = new Date('2026-09-04T12:00:00');
        expect(sumarDiasHabiles(d, 0).getTime()).toBe(d.getTime());
    });
});

describe('diasHabilesEntre', () => {
    it('un fin de semana entero no gasta plazo: de viernes a domingo, cero', () => {
        expect(diasHabilesEntre(new Date('2026-09-04T12:00:00'),
                                new Date('2026-09-06T12:00:00'))).toBe(0);
    });

    // Y el lunes SÍ cuenta apenas se llega a él: de sábado a lunes es UNO, no
    // cero. La primera versión de esta prueba lo dio por cero y la que estaba
    // mal era la prueba — el plazo se gasta el día hábil al que se llega, no el
    // día del que se sale.
    it('el lunes cuenta aunque se venga del sábado', () => {
        expect(diasHabilesEntre(new Date('2026-09-05T12:00:00'),
                                new Date('2026-09-07T12:00:00'))).toBe(1);
    });

    it('de viernes a lunes gasta UN día hábil', () => {
        expect(diasHabilesEntre(new Date('2026-09-04T12:00:00'),
                                new Date('2026-09-07T12:00:00'))).toBe(1);
    });

    it('una fecha anterior no devuelve días negativos', () => {
        expect(diasHabilesEntre(new Date('2026-09-10T12:00:00'),
                                new Date('2026-09-01T12:00:00'))).toBe(0);
    });
});

describe('plazoDe', () => {
    const recibida = '2026-09-04T12:00:00';

    it('sin acuse no hay plazo: la hoja impresa que nunca volvió no vence', () => {
        expect(plazoDe({ estado: 'IMPRESA', recibida_at: null })).toBeNull();
    });

    it('una resuelta o una anulada dejan de contar', () => {
        expect(plazoDe({ estado: 'RESUELTA', recibida_at: recibida })).toBeNull();
        expect(plazoDe({ estado: 'ANULADA',  recibida_at: recibida })).toBeNull();
    });

    it('cuenta 20 hábiles, y a los 17 ya apremia', () => {
        const p = plazoDe({ estado: 'RECIBIDA', recibida_at: recibida },
                          new Date('2026-09-29T12:00:00'));
        expect(p.total).toBe(20);
        expect(p.usados).toBe(17);
        expect(p.restan).toBe(3);
        expect(p.apremia).toBe(true);
        expect(p.vencida).toBe(false);
    });

    it('cuatro días antes todavía NO apremia: el aviso llega para poder actuar', () => {
        const p = plazoDe({ estado: 'RECIBIDA', recibida_at: recibida },
                          new Date('2026-09-28T12:00:00'));
        expect(p.restan).toBe(4);
        expect(p.apremia).toBe(false);
    });

    it('pasado el plazo queda vencida, y ya no apremia: apremiar es ANTES', () => {
        const p = plazoDe({ estado: 'RECIBIDA', recibida_at: recibida },
                          new Date('2026-10-06T12:00:00'));
        expect(p.restan).toBeLessThan(0);
        expect(p.vencida).toBe(true);
        expect(p.apremia).toBe(false);
    });

    it('la prórroga duplica el plazo y deja de ser prorrogable', () => {
        const p = plazoDe({ estado: 'RECIBIDA', recibida_at: recibida,
                            prorrogada_at: '2026-09-25T12:00:00' },
                          new Date('2026-09-29T12:00:00'));
        expect(p.total).toBe(40);
        expect(p.restan).toBe(23);
        expect(p.prorrogable).toBe(false);
    });

    it('el vencimiento es una fecha hábil, nunca un sábado ni un domingo', () => {
        const p = plazoDe({ estado: 'RECIBIDA', recibida_at: recibida },
                          new Date('2026-09-10T12:00:00'));
        expect([1, 2, 3, 4, 5]).toContain(p.vence.getDay());
    });
});
