import { describe, it, expect } from 'vitest';
import { consolidarDia, turnoEnInstantes } from '../../supabase/functions/_shared/tiempoTrabajado.ts';
import {
    resolverTurnoDelDia, esJornadaPartida, finDeLaPausa, regresoEsperadoDeLaPausa,
} from '@nucleo/utils/turnoDelDia';
import { evaluarCoberturaDelDia } from '@nucleo/utils/coberturaDelDia';
import { buildTimeClockConfig, buildFinalPunchPresentation } from '@nucleo/utils/timeClock.rules';

/* La pausa del día, de cualquier duración (2026-11-23). Los cinco casos que se
 * pidieron: día normal, pausa de 4 h, lactancia 30 + 30, entrada olvidada y
 * nocturno. `sv()` escribe la hora como la vive la sala (UTC−6).
 *
 * `turno_del_dia` es la respuesta de la función de SQL para el mismo día —
 * medida en el branch de pruebas el 2026-11-23 con estos mismos días—, y el
 * gemelo de JS tiene que decir lo mismo (`gemelos`). */
const FECHA = '2026-11-24';
const sv = (h, fecha = FECHA) => `${fecha}T${h}:00-06:00`;
const m = (type, h, fecha, details) => ({ type, timestamp: sv(h, fecha), ...(details ? { details } : {}) });
const VENTANA = { inicioDelDia: new Date(sv('00:00')), finDelDia: new Date(sv('23:59')) };

const DIAS = {
    normal:    { customStart: '07:00', customEnd: '16:00', hasLunch: true, lunchStart: '12:00' },
    partida:   { customStart: '07:00', customEnd: '19:00', hasLunch: true, lunchStart: '12:00', lunchMinutes: 240 },
    lactancia: { customStart: '07:00', customEnd: '16:00', hasLunch: true, lunchStart: '12:00',
                 hasLactation: true, lactationStart: '09:00', lactationMinutes: 30, lactation2Start: '14:00', lactation2Minutes: 30 },
    nocturno:  { customStart: '22:00', customEnd: '06:00', hasLunch: true, lunchStart: '23:30', lunchMinutes: 60 },
};
// Lo que devolvió `public.turno_del_dia` en el branch de pruebas.
const SQL = {
    normal:    { trabaja: true, inicio: '07:00', fin: '16:00', cruza: false, pausa_inicio: '12:00', pausa_minutos: 60,  minutos_brutos: 540, minutos_pagados: 480 },
    partida:   { trabaja: true, inicio: '07:00', fin: '19:00', cruza: false, pausa_inicio: '12:00', pausa_minutos: 240, minutos_brutos: 720, minutos_pagados: 480 },
    lactancia: { trabaja: true, inicio: '07:00', fin: '16:00', cruza: false, pausa_inicio: '12:00', pausa_minutos: 60,  minutos_brutos: 540, minutos_pagados: 480 },
    nocturno:  { trabaja: true, inicio: '22:00', fin: '06:00', cruza: true,  pausa_inicio: '23:30', pausa_minutos: 60,  minutos_brutos: 480, minutos_pagados: 420 },
};
const turno = (k) => turnoEnInstantes(FECHA, SQL[k], DIAS[k]);
const horas = (d) => ({ reg: d.minutosRegulares / 60, extra: d.minutosExtra / 60 });

describe('gemelos: resolverTurnoDelDia (JS) = turno_del_dia (SQL)', () => {
    it.each(Object.keys(DIAS))('%s', (k) => {
        const r = resolverTurnoDelDia(DIAS[k], []);
        expect(r.minutosBrutos).toBe(SQL[k].minutos_brutos);
        expect(r.minutosPagados).toBe(SQL[k].minutos_pagados);
        expect(r.pausa?.inicio ?? null).toBe(SQL[k].pausa_inicio);
        expect(r.pausa?.minutos ?? null).toBe(SQL[k].pausa_minutos);
        expect(r.cruzaMedianoche).toBe(SQL[k].cruza);
    });

    it('la jornada partida se reconoce por la pausa de más de una hora', () => {
        expect(esJornadaPartida(resolverTurnoDelDia(DIAS.partida, []))).toBe(true);
        expect(esJornadaPartida(resolverTurnoDelDia(DIAS.normal, []))).toBe(false);
        expect(finDeLaPausa(resolverTurnoDelDia(DIAS.partida, []))).toBe(16 * 60);
    });

    it('la pausa de la noche no cuenta como hora nocturna', () => {
        const r = resolverTurnoDelDia({ customStart: '10:00', customEnd: '22:00', hasLunch: true, lunchStart: '19:00', lunchMinutes: 120 }, []);
        expect(r.minutosNocturnos).toBe(60);   // 21–22; la pausa 19–21 no
    });
});

describe('consolidación por tramos', () => {
    it('día normal: almuerzo marcado, 8 h regulares', () => {
        const d = consolidarDia([m('IN', '07:00'), m('OUT_LUNCH', '12:00'), m('IN_LUNCH', '13:00'), m('OUT', '16:00')], { ...VENTANA, turno: turno('normal') });
        expect(horas(d)).toEqual({ reg: 8, extra: 0 });
        expect(d.incompleta).toBe(false);
    });

    it('día normal: se queda una hora más → 1 h extra (antes el tope era 9 h)', () => {
        const d = consolidarDia([m('IN', '07:00'), m('OUT_LUNCH', '12:00'), m('IN_LUNCH', '13:00'), m('OUT', '17:00')], { ...VENTANA, turno: turno('normal') });
        expect(horas(d)).toEqual({ reg: 8, extra: 1 });
    });

    it('día normal: no marcó el almuerzo → se descuenta el del horario', () => {
        const d = consolidarDia([m('IN', '07:00'), m('OUT', '16:00')], { ...VENTANA, turno: turno('normal') });
        expect(horas(d)).toEqual({ reg: 8, extra: 0 });
        expect(d.pausaSinMarcar).toBe(true);
    });

    it('«Omisión de almuerzo»: no se descuenta la pausa', () => {
        const d = consolidarDia([m('IN', '07:00'), m('OUT', '15:00', FECHA, { skippedLunch: true })], { ...VENTANA, turno: turno('normal') });
        expect(horas(d)).toEqual({ reg: 8, extra: 0 });
        expect(d.pausaSinMarcar).toBe(false);
    });

    it('pausa de 4 h marcada como SALIDA y ENTRADA: 8 h, no 12', () => {
        const d = consolidarDia([m('IN', '07:00'), m('OUT', '12:00'), m('IN_EXTRA', '16:00'), m('OUT_EXTRA', '19:00')], { ...VENTANA, turno: turno('partida') });
        expect(horas(d)).toEqual({ reg: 8, extra: 0 });
    });

    it('pausa de 4 h marcada como pausa, y vuelve a las 3: 9 h → 1 extra', () => {
        const d = consolidarDia([m('IN', '07:00'), m('OUT_LUNCH', '12:00'), m('IN_LUNCH', '15:00'), m('OUT', '19:00')], { ...VENTANA, turno: turno('partida') });
        expect(horas(d)).toEqual({ reg: 8, extra: 1 });
    });

    it('pausa de 4 h sin marcar: se descuentan las 4 h del horario', () => {
        const d = consolidarDia([m('IN', '07:00'), m('OUT', '19:00')], { ...VENTANA, turno: turno('partida') });
        expect(horas(d)).toEqual({ reg: 8, extra: 0 });
    });

    it('lactancia 30 + 30 marcada: cuenta como trabajada', () => {
        const d = consolidarDia([
            m('IN', '07:00'), m('OUT_LACTATION', '09:00'), m('IN_LACTATION', '09:30'),
            m('OUT_LUNCH', '12:00'), m('IN_LUNCH', '13:00'),
            m('OUT_LACTATION', '14:00'), m('IN_LACTATION', '14:30'), m('OUT', '16:00'),
        ], { ...VENTANA, turno: turno('lactancia') });
        expect(horas(d)).toEqual({ reg: 8, extra: 0 });
    });

    it('lactancia pegada al almuerzo (sale 12, vuelve 2): sólo se descuenta el almuerzo', () => {
        const dia = { ...DIAS.normal, hasLactation: true, lactationStart: '13:00', lactationMinutes: 60 };
        const t = turnoEnInstantes(FECHA, SQL.normal, dia);
        const d = consolidarDia([m('IN', '07:00'), m('OUT_LUNCH', '12:00'), m('IN_LUNCH', '14:00'), m('OUT', '16:00')], { ...VENTANA, turno: t });
        expect(horas(d)).toEqual({ reg: 8, extra: 0 });
    });

    it('lactancia pegada a la entrada: entra una hora después y no es tardanza', () => {
        const dia = { ...DIAS.normal, hasLactation: true, lactationStart: '07:00', lactationMinutes: 60 };
        const t = turnoEnInstantes(FECHA, SQL.normal, dia);
        const d = consolidarDia([m('IN', '08:00'), m('OUT_LUNCH', '12:00'), m('IN_LUNCH', '13:00'), m('OUT', '16:00')], { ...VENTANA, turno: t });
        expect(horas(d)).toEqual({ reg: 8, extra: 0 });
        expect(d.minutosTardanza).toBe(0);
    });

    it('entrada olvidada con otras marcas: NO ausente, marcación incompleta', () => {
        const d = consolidarDia([m('OUT_LUNCH', '12:00'), m('IN_LUNCH', '13:00'), m('OUT', '16:00')], { ...VENTANA, turno: turno('normal') });
        expect(d.sinMarcas).toBe(false);
        expect(d.incompleta).toBe(true);
        expect(horas(d)).toEqual({ reg: 3, extra: 0 });
    });

    it('sin ninguna marca: ausente', () => {
        const d = consolidarDia([], { ...VENTANA, turno: turno('normal') });
        expect(d.sinMarcas).toBe(true);
    });

    it('salió a la pausa y no volvió: incompleta', () => {
        const d = consolidarDia([m('IN', '07:00'), m('OUT_LUNCH', '12:00')], { ...VENTANA, turno: turno('partida') });
        expect(d.incompleta).toBe(true);
        expect(d.abierta).toBe(false);
    });

    it('nocturno 22–06 con pausa: 7 h es el tope (RIT Art. 16)', () => {
        const d = consolidarDia([
            m('IN', '22:00'), m('OUT_LUNCH', '23:30'), m('IN_LUNCH', '00:30', '2026-11-25'), m('OUT', '06:00', '2026-11-25'),
        ], { ...VENTANA, turno: turno('nocturno') });
        expect(horas(d)).toEqual({ reg: 7, extra: 0 });
        expect(d.minutosNocturnos).toBe(420);
    });

    it('la salida del nocturno de ayer no hace incompleto el día de hoy', () => {
        const d = consolidarDia([m('OUT', '06:00'), m('IN', '07:00'), m('OUT_LUNCH', '12:00'), m('IN_LUNCH', '13:00'), m('OUT', '16:00')], { ...VENTANA, turno: turno('normal') });
        expect(d.incompleta).toBe(false);
        expect(horas(d)).toEqual({ reg: 8, extra: 0 });
    });

    it('un domingo de 10 h pagadas: el tope es 8 y lo demás es extra', () => {
        const t = turnoEnInstantes(FECHA, { trabaja: true, inicio: '07:00', fin: '18:00', pausa_inicio: '12:00', pausa_minutos: 60, minutos_pagados: 600 }, {});
        const d = consolidarDia([m('IN', '07:00'), m('OUT_LUNCH', '12:00'), m('IN_LUNCH', '13:00'), m('OUT', '18:00')], { ...VENTANA, turno: t });
        expect(horas(d)).toEqual({ reg: 8, extra: 2 });
    });

    it('salida generada al fin del horario cuando quedó dentro de un tramo', () => {
        const d = consolidarDia([m('IN', '07:00'), m('OUT_LUNCH', '12:00'), m('IN_LUNCH', '16:00')],
            { ...VENTANA, turno: turno('partida'), salidaAutomatica: new Date(sv('19:00')) });
        expect(horas(d)).toEqual({ reg: 8, extra: 0 });
        expect(d.abierta).toBe(false);
    });
});

describe('kiosco: el regreso de la pausa es el del horario', () => {
    const ahora = new Date(sv('16:05'));
    const config = {
        shift: { start: '07:00', end: '19:00', name: 'Manual' },
        lunchTime: '12:00', lunchMinutes: 240, esJornadaPartida: true,
    };
    it('volver a las 4:05 de una pausa de 12 a 4 NO es tardanza', () => {
        const cfg = buildTimeClockConfig({}, config, ahora);
        expect(cfg.lunchEndD.getHours()).toBe(16);
        const r = regresoEsperadoDeLaPausa({ lunchEndD: cfg.lunchEndD, salida: { timestamp: sv('12:00') }, minutosFuera: 240 });
        expect(r.getTime()).toBe(new Date(sv('16:00')).getTime());
    });
    it('salió tarde a la pausa: tiene la pausa completa desde que salió', () => {
        const r = regresoEsperadoDeLaPausa({ lunchEndD: new Date(sv('13:00')), salida: { timestamp: sv('12:30') }, minutosFuera: 60 });
        expect(r.getTime()).toBe(new Date(sv('13:30')).getTime());
    });
    it('el mensaje dice «pausa», no «buen provecho»', () => {
        const cfg = buildTimeClockConfig({}, config, new Date(sv('12:00')));
        const p = buildFinalPunchPresentation({ employee: { attendance: [] }, type: 'OUT_LUNCH', rawType: 'OUT_LUNCH', customConfig: cfg, now: new Date(sv('12:00')) });
        expect(p.message).toBe('Pausa registrada');
    });
});

describe('cobertura: la pausa partida no se propone escalonar', () => {
    it('sin «Conviene escalonarlo» para una pausa de 4 h', () => {
        const horarios = [
            { 1: DIAS.partida, name: 'Ana' },
            { 1: { customStart: '07:00', customEnd: '19:00' }, name: 'Luis' },
        ];
        const { avisos } = evaluarCoberturaDelDia(1, horarios, [], []);
        expect(avisos.some(a => /escalon/i.test(a.texto))).toBe(false);
    });
    it('el almuerzo de una hora sí se sigue avisando', () => {
        const horarios = [
            { 1: DIAS.normal, name: 'Ana' },
            { 1: { customStart: '07:00', customEnd: '19:00' }, name: 'Luis' },
        ];
        const { avisos } = evaluarCoberturaDelDia(1, horarios, [], []);
        expect(avisos.some(a => /escalon/i.test(a.texto))).toBe(true);
    });
});
