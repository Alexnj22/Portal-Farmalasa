// Los bordes del período que se paga.
//
// De acá salen las fechas de la quincena y las horas que se leen en la auditoría
// de asistencia. Un borde mal puesto **mueve un día de trabajo de una quincena a
// la otra**, y eso llega a la planilla sin que nada falle.
//
// Vivían dentro de una vista de 1.497 líneas y por eso nunca se probaron — el
// propio archivo lo decía: sus tres hermanas ya se habían mudado a
// `data/attendanceAudit.js` «porque acá no se podían probar». Esto termina esa
// mudanza.
//
// Con reloj FIJO: una prueba de quincenas sin él pasa el día 3 y falla el 20.

import { describe, it, expect } from 'vitest';
import {
    getMondayOfCurrentWeek, fmtTimeCSTStr, formatTime12h,
    isEditedPunch, isAutoPunch, isPendingPunch,
    getCurrentQuincenaStart, getQuincenaEnd, prevQuincena, nextQuincena,
} from '../../src/views/asistencia/quincena';

const enSV = (iso) => new Date(iso).getTime();

describe('la quincena en curso', () => {
    it('del 1 al 15 arranca el 01; del 16 en adelante, el 16', () => {
        expect(getCurrentQuincenaStart(enSV('2026-08-01T18:00:00Z'))).toBe('2026-08-01');
        expect(getCurrentQuincenaStart(enSV('2026-08-15T18:00:00Z'))).toBe('2026-08-01');
        expect(getCurrentQuincenaStart(enSV('2026-08-16T18:00:00Z'))).toBe('2026-08-16');
        expect(getCurrentQuincenaStart(enSV('2026-08-31T18:00:00Z'))).toBe('2026-08-16');
    });

    it('el día 16 a la medianoche de El Salvador todavía es la primera quincena', () => {
        // 2026-08-16T02:00Z son las 20:00 del 15 en El Salvador. Leerlo en hora
        // local del servidor pondría ese turno en la segunda quincena y el día
        // se pagaría en el período equivocado.
        expect(getCurrentQuincenaStart(enSV('2026-08-16T02:00:00Z'))).toBe('2026-08-01');
        expect(getCurrentQuincenaStart(enSV('2026-08-16T06:00:00Z'))).toBe('2026-08-16');
    });
});

describe('dónde termina cada quincena', () => {
    it('la primera siempre el 15', () => {
        expect(getQuincenaEnd('2026-08-01')).toBe('2026-08-15');
        expect(getQuincenaEnd('2026-02-01')).toBe('2026-02-15');
    });

    it('la segunda termina el último día REAL del mes', () => {
        // 28, 29, 30 y 31 son todos posibles. Asumir 30 —o 31— corre el borde en
        // siete meses del año.
        expect(getQuincenaEnd('2026-08-16')).toBe('2026-08-31');
        expect(getQuincenaEnd('2026-04-16')).toBe('2026-04-30');
        expect(getQuincenaEnd('2026-02-16')).toBe('2026-02-28');
        expect(getQuincenaEnd('2028-02-16')).toBe('2028-02-29');   // bisiesto
    });
});

describe('moverse entre quincenas', () => {
    it('adelante y atrás dentro del mes', () => {
        expect(nextQuincena('2026-08-01')).toBe('2026-08-16');
        expect(prevQuincena('2026-08-16')).toBe('2026-08-01');
    });

    it('cruza el mes y el año', () => {
        expect(nextQuincena('2026-08-16')).toBe('2026-09-01');
        expect(prevQuincena('2026-09-01')).toBe('2026-08-16');
        expect(nextQuincena('2026-12-16')).toBe('2027-01-01');
        expect(prevQuincena('2027-01-01')).toBe('2026-12-16');
    });

    it('ir y volver devuelve al mismo lugar, mes por mes de un año entero', () => {
        // La prueba que revela un borde torcido: si `prevQuincena` y
        // `nextQuincena` discreparan en un solo mes, el recorrido no cerraría.
        let q = '2026-01-01';
        for (let i = 0; i < 24; i++) {
            const ida = nextQuincena(q);
            expect(prevQuincena(ida)).toBe(q);
            q = ida;
        }
        expect(q).toBe('2027-01-01');
    });

    it('febrero de un bisiesto no rompe el recorrido', () => {
        expect(nextQuincena('2028-02-16')).toBe('2028-03-01');
        expect(prevQuincena('2028-03-01')).toBe('2028-02-16');
    });
});

describe('el lunes de la semana', () => {
    it('el domingo pertenece a la semana que YA pasó', () => {
        // `(getUTCDay() + 6) % 7` convierte domingo=0 en 6. Con `getUTCDay()` a
        // secas el domingo saltaría a la semana siguiente y ese turno quedaría
        // en el período equivocado.
        expect(getMondayOfCurrentWeek(enSV('2026-08-23T18:00:00Z'))).toBe('2026-08-17'); // domingo
        expect(getMondayOfCurrentWeek(enSV('2026-08-24T18:00:00Z'))).toBe('2026-08-24'); // lunes
        expect(getMondayOfCurrentWeek(enSV('2026-08-22T18:00:00Z'))).toBe('2026-08-17'); // sábado
    });
});

describe('las horas', () => {
    it('una hora ISO se lee en El Salvador y en 12 horas', () => {
        expect(fmtTimeCSTStr('2026-08-24T14:05:00Z')).toBe('08:05 AM');
        expect(fmtTimeCSTStr('2026-08-24T18:30:00Z')).toBe('12:30 PM');
        expect(fmtTimeCSTStr('2026-08-25T02:00:00Z')).toBe('08:00 PM');
    });

    it('las doce se escriben 12, nunca 00', () => {
        // `h % 12` da 0 al mediodía y a medianoche; el `|| 12` es lo que lo
        // arregla, y es una sola barra de distancia entre «12:30 PM» y «00:30».
        expect(fmtTimeCSTStr('2026-08-24T18:00:00Z')).toBe('12:00 PM');
        expect(fmtTimeCSTStr('2026-08-24T06:00:00Z')).toBe('12:00 AM');
        expect(formatTime12h('12:00')).toBe('12:00 PM');
        expect(formatTime12h('00:30')).toBe('12:30 AM');
    });

    it('un horario `HH:MM` NO lleva huso: ya es hora de pared', () => {
        // Restarle seis horas al horario del turno lo correría: «08:00» es las
        // ocho de la mañana en la sala, no un instante UTC.
        expect(formatTime12h('08:00')).toBe('08:00 AM');
        expect(formatTime12h('17:45')).toBe('05:45 PM');
    });

    it('lo vacío y lo roto sale como «–», no como «NaN»', () => {
        for (const v of [null, undefined, '']) {
            expect(fmtTimeCSTStr(v)).toBe('–');
            expect(formatTime12h(v)).toBe('–');
        }
        expect(fmtTimeCSTStr('no es fecha')).toBe('–');
        expect(formatTime12h('abc')).toBe('–');
    });
});

describe('de dónde vino una marcación', () => {
    it('editada a mano: cualquiera de las tres marcas alcanza', () => {
        for (const d of [{ manualAudit: true }, { editedBy: 'x' }, { auditedByName: 'Ana' }])
            expect(isEditedPunch({ details: d })).toBe(true);
        expect(isEditedPunch({ details: {} })).toBe(false);
        expect(isEditedPunch({})).toBe(false);
        expect(isEditedPunch(null)).toBe(false);
    });

    it('una insertada por el sistema NO espera a RRHH', () => {
        // Ya tiene su propio distintivo. Contarla como pendiente inventaría
        // trabajo de revisión que nadie tiene que hacer.
        expect(isPendingPunch({ details: { pendingHRReview: true, autoInserted: true } })).toBe(false);
        expect(isPendingPunch({ details: { pendingHRReview: true } })).toBe(true);
        expect(isAutoPunch({ details: { autoInserted: true } })).toBe(true);
    });

    it('una automática Y editada es las DOS cosas en el dato', () => {
        // Son excluyentes en la pantalla pero no en el registro: el orden en que
        // la vista las pregunta es lo que decide qué distintivo gana.
        const p = { details: { autoInserted: true, manualAudit: true } };
        expect(isAutoPunch(p)).toBe(true);
        expect(isEditedPunch(p)).toBe(true);
    });
});
