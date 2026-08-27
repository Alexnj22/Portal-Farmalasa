import { describe, it, expect } from 'vitest';
import {
    resolverTurnoDelDia, minutosNocturnosDe, tramosDeLaJornada,
    reparosDelDia, descansoInsuficiente, claveDeDia, aMinutos, aHora,
    HORAS_SEMANA_DIURNA, HORAS_JORNADA_DIURNA,
} from '../../src/utils/turnoDelDia';

// El catálogo de prueba. `start_time`/`end_time` es como vienen de la base;
// `start`/`end` es como quedan en memoria después del store. Las dos formas
// tienen que resolver igual, porque las dos existen a la vez en producción.
const TURNOS = [
    { id: 1,  name: 'Apertura', start_time: '07:00:00', end_time: '15:30:00', lunch_start: '12:00:00', lunch_minutes: 60 },
    { id: 2,  name: 'Cierre',   start: '10:30', end: '19:00', lunch_start: '13:00', lunch_minutes: 60 },
    { id: 3,  name: 'Nocturno', start_time: '13:30:00', end_time: '22:00:00' },
    { id: 99, name: 'Sin pausa', start_time: '08:00:00', end_time: '12:00:00' },
];

describe('resolverTurnoDelDia — las cuatro lecturas que divergían', () => {
    // Éste es EL caso: la pantalla lo pinta «Manual» y lo cuenta en las 44 h,
    // el kiosco lo daba por día libre (exigía `shiftId`) y pedía autorización
    // de supervisor para marcar.
    it('un día con SÓLO horas propias es un día trabajado', () => {
        const r = resolverTurnoDelDia({ customStart: '08:00', customEnd: '17:00' }, TURNOS);
        expect(r.trabaja).toBe(true);
        expect(r.inicio).toBe('08:00');
        expect(r.fin).toBe('17:00');
        expect(r.esManual).toBe(true);
        expect(r.nombre).toBe('Manual');
    });

    // El reverso: la función de SQL exigía `customStart`, así que un día
    // asignado sólo desde el catálogo no existía para los avisos de sala.
    it('un día con SÓLO turno del catálogo es un día trabajado', () => {
        const r = resolverTurnoDelDia({ shiftId: 1 }, TURNOS);
        expect(r.trabaja).toBe(true);
        expect(r.inicio).toBe('07:00');
        expect(r.fin).toBe('15:30');
        expect(r.esManual).toBe(false);
        expect(r.nombre).toBe('Apertura');
    });

    // La verdad de JavaScript: lo ausente es falso. En SQL estaba escrito
    // `coalesce((isOff)::boolean, true) = false`, o sea al revés.
    it('sin la clave `isOff`, la persona TRABAJA', () => {
        expect(resolverTurnoDelDia({ shiftId: 1 }, TURNOS).trabaja).toBe(true);
    });

    it.each([
        ['ausente',   {}],
        ['null',      { isOff: null }],
        ['false',     { isOff: false }],
        ['cero',      { isOff: 0 }],
        ['vacía',     { isOff: '' }],
    ])('`isOff` %s no deja a nadie libre', (_, extra) => {
        expect(resolverTurnoDelDia({ shiftId: 1, ...extra }, TURNOS).trabaja).toBe(true);
    });

    it('`isOff` verdadero sí deja libre, y no mira las horas', () => {
        const r = resolverTurnoDelDia({ isOff: true, shiftId: 1, customStart: '07:00', customEnd: '15:30' }, TURNOS);
        expect(r.trabaja).toBe(false);
        expect(r.minutosPagados).toBe(0);
    });

    it('las horas propias mandan sobre las del turno', () => {
        const r = resolverTurnoDelDia({ shiftId: 1, customStart: '09:00', customEnd: '18:00' }, TURNOS);
        expect(r.inicio).toBe('09:00');
        expect(r.fin).toBe('18:00');
        expect(r.nombre).toBe('Apertura');   // sigue siendo ese turno, con horas cambiadas
        expect(r.esManual).toBe(false);
    });

    it('`start`/`end` y `start_time`/`end_time` resuelven igual', () => {
        expect(resolverTurnoDelDia({ shiftId: 2 }, TURNOS).inicio).toBe('10:30');
        expect(resolverTurnoDelDia({ shiftId: 1 }, TURNOS).inicio).toBe('07:00');
    });

    // La QUINTA forma de decir «libre», y sólo `consolidate-timesheets` la
    // conocía: la escriben marcar incapacidad, marcar vacaciones y el regreso
    // anticipado de vacaciones.
    it.each([['LIBRE'], ['libre']])('`shiftId: %s` es día libre', (valor) => {
        const r = resolverTurnoDelDia({ shiftId: valor, note: 'Incapacidad', customStart: '07:00', customEnd: '15:30' }, TURNOS);
        expect(r.trabaja).toBe(false);
    });

    it('un turno que ya no existe en el catálogo no inventa horas', () => {
        expect(resolverTurnoDelDia({ shiftId: 4242 }, TURNOS).trabaja).toBe(false);
    });

    it('entrada igual a salida no es una jornada', () => {
        expect(resolverTurnoDelDia({ customStart: '08:00', customEnd: '08:00' }, TURNOS).trabaja).toBe(false);
    });

    it('acepta el día guardado como cadena JSON', () => {
        expect(resolverTurnoDelDia('{"shiftId":1}', TURNOS).trabaja).toBe(true);
        expect(resolverTurnoDelDia('esto no es json', TURNOS).trabaja).toBe(false);
    });

    it('null, undefined y un número no rompen', () => {
        for (const basura of [null, undefined, 7, [], '']) {
            expect(resolverTurnoDelDia(basura, TURNOS).trabaja).toBe(false);
        }
    });
});

describe('la pausa alimenticia', () => {
    it('la hora sale del turno cuando el día no la trae', () => {
        const r = resolverTurnoDelDia({ shiftId: 1, hasLunch: true }, TURNOS);
        expect(r.pausa).toEqual({ inicio: '12:00', minutos: 60 });
        // 7:00–15:30 son 8,5 h brutas; menos la pausa quedan 7,5 — que es
        // exactamente el turno 1 del reglamento: 7:00 a 12:00 y 13:00 a 15:30.
        expect(r.minutosPagados).toBe(450);
    });

    it('la del día pisa la del turno', () => {
        const r = resolverTurnoDelDia({ shiftId: 1, hasLunch: true, lunchStart: '13:30' }, TURNOS);
        expect(r.pausa.inicio).toBe('13:30');
    });

    it('sin `hasLunch` no se descuenta nada, aunque el turno tenga pausa', () => {
        const r = resolverTurnoDelDia({ shiftId: 1 }, TURNOS);
        expect(r.pausa).toBeNull();
        expect(r.minutosPagados).toBe(r.minutosBrutos);
    });

    it('un turno sin pausa y un día que la pide no inventa una hora', () => {
        expect(resolverTurnoDelDia({ shiftId: 99, hasLunch: true }, TURNOS).pausa).toBeNull();
    });

    // RIT: «serán contadas como hora efectiva de trabajo y remunerada como tal».
    it('la lactancia NO descuenta horas pagadas', () => {
        const r = resolverTurnoDelDia({ shiftId: 1, hasLactation: true, lactationStart: '15:00' }, TURNOS);
        expect(r.lactancia).toEqual({ inicio: '15:00', minutos: 60 });
        expect(r.minutosPagados).toBe(r.minutosBrutos);
    });
});

describe('la medianoche', () => {
    it('un turno que cruza cuenta las horas del otro lado', () => {
        const r = resolverTurnoDelDia({ customStart: '22:00', customEnd: '06:00' }, TURNOS);
        expect(r.cruzaMedianoche).toBe(true);
        expect(r.minutosBrutos).toBe(8 * 60);
    });
});

describe('franja nocturna — RIT Art. 16 (19:00 a 06:00)', () => {
    it.each([
        ['07:00 a 15:30 no tiene nada de nocturno', '07:00', '15:30', 0],
        ['13:30 a 22:00 tiene tres horas',          '13:30', '22:00', 180],
        ['18:00 a 20:00 tiene una',                 '18:00', '20:00', 60],
        ['22:00 a 06:00 es nocturno entero',        '22:00', '06:00', 480],
    ])('%s', (_, inicio, fin, esperados) => {
        const r = resolverTurnoDelDia({ customStart: inicio, customEnd: fin }, TURNOS);
        expect(r.minutosNocturnos).toBe(esperados);
    });

    it('más de cuatro horas nocturnas vuelven nocturna a toda la jornada', () => {
        expect(resolverTurnoDelDia({ customStart: '13:30', customEnd: '22:00' }, TURNOS).esJornadaNocturna).toBe(false);
        expect(resolverTurnoDelDia({ customStart: '20:00', customEnd: '04:00' }, TURNOS).esJornadaNocturna).toBe(true);
    });

    it('el cruce de intervalos da lo mismo que contar minuto a minuto', () => {
        const aMano = (i, f) => {
            let n = 0;
            for (let m = i; m < f; m++) { const h = ((m % 1440) + 1440) % 1440; if (h >= 1140 || h < 360) n++; }
            return n;
        };
        for (const [i, f] of [[420, 930], [810, 1320], [1320, 1800], [0, 1440], [1080, 1200]]) {
            expect(minutosNocturnosDe(i, f)).toBe(aMano(i, f));
        }
    });
});

describe('los tramos que se pintan', () => {
    it('parte la jornada en trabajo · pausa · trabajo', () => {
        const r = resolverTurnoDelDia({ shiftId: 1, hasLunch: true }, TURNOS);
        expect(tramosDeLaJornada(r).map(t => t.tipo)).toEqual(['trabajo', 'pausa', 'trabajo']);
    });

    it('con pausa y lactancia salen los dos cortes, en orden', () => {
        const r = resolverTurnoDelDia(
            { shiftId: 1, hasLunch: true, hasLactation: true, lactationStart: '14:00' }, TURNOS);
        expect(tramosDeLaJornada(r).map(t => t.tipo)).toEqual(['trabajo', 'pausa', 'trabajo', 'lactancia', 'trabajo']);
    });

    it('un día libre no tiene tramos', () => {
        expect(tramosDeLaJornada(resolverTurnoDelDia({ isOff: true }, TURNOS))).toEqual([]);
    });
});

describe('reparos del reglamento', () => {
    it('una jornada de más de ocho horas se reporta', () => {
        const r = resolverTurnoDelDia({ customStart: '07:00', customEnd: '17:00' }, TURNOS);
        expect(reparosDelDia(r).join(' ')).toMatch(/limita a 8/);
    });

    it('con la pausa descontada, 7:00 a 16:00 cabe en las ocho', () => {
        const r = resolverTurnoDelDia({ customStart: '07:00', customEnd: '16:00', hasLunch: true, lunchStart: '12:00' }, TURNOS);
        expect(reparosDelDia(r)).toEqual([]);
    });

    it('la jornada nocturna se limita a siete', () => {
        const r = resolverTurnoDelDia({ customStart: '20:00', customEnd: '04:00' }, TURNOS);
        expect(reparosDelDia(r).join(' ')).toMatch(/nocturna/);
    });

    // La ventana fija de 11:00 a 14:30 que había en el editor rechazaba estas
    // dos, que son pausas del REGLAMENTO (Barrio San Antonio T2, El Paraíso T2).
    it.each([
        ['18:00', '13:30', '22:00'],
        ['19:00', '14:00', '22:00'],
    ])('acepta la pausa de las %s, que es la del reglamento', (pausa, inicio, fin) => {
        const r = resolverTurnoDelDia({ customStart: inicio, customEnd: fin, hasLunch: true, lunchStart: pausa }, TURNOS);
        expect(reparosDelDia(r)).toEqual([]);
    });

    it('una pausa fuera de la jornada sí se reporta', () => {
        const r = resolverTurnoDelDia({ customStart: '07:00', customEnd: '15:00', hasLunch: true, lunchStart: '18:00' }, TURNOS);
        expect(reparosDelDia(r).join(' ')).toMatch(/fuera de la jornada/);
    });

    // RIT: «Las interrupciones no podrán ser utilizadas en la hora de almuerzo».
    // El editor sólo comparaba igualdad, así que 12:00 contra 12:30 pasaba.
    it('la lactancia que SOLAPA la pausa se reporta, no sólo la que coincide', () => {
        const r = resolverTurnoDelDia({
            customStart: '07:00', customEnd: '16:00',
            hasLunch: true, lunchStart: '12:00',
            hasLactation: true, lactationStart: '12:30',
        }, TURNOS);
        expect(reparosDelDia(r).join(' ')).toMatch(/lactancia cae dentro/);
    });

    it('la lactancia pegada al final de la pausa no solapa', () => {
        const r = resolverTurnoDelDia({
            customStart: '07:00', customEnd: '17:00',
            hasLunch: true, lunchStart: '12:00',
            hasLactation: true, lactationStart: '13:00',
        }, TURNOS);
        expect(reparosDelDia(r).join(' ')).not.toMatch(/lactancia cae dentro/);
    });

    it('un turno fuera del horario de la sala se reporta', () => {
        const r = resolverTurnoDelDia({ customStart: '06:00', customEnd: '14:00' }, TURNOS);
        expect(reparosDelDia(r, { horaDeApertura: 7 * 60, horaDeCierre: 19 * 60 }).join(' '))
            .toMatch(/horario de atención/);
    });
});

describe('descanso entre jornadas — RIT Art. 21 (ocho horas)', () => {
    const dia = (fecha, inicio, fin) => ({ fecha, resuelto: resolverTurnoDelDia({ customStart: inicio, customEnd: fin }, TURNOS) });

    it('cerrar a las 22:00 y abrir a las 7:00 deja nueve: pasa', () => {
        expect(descansoInsuficiente([dia('2026-08-31', '13:30', '22:00'), dia('2026-09-01', '07:00', '15:30')])).toEqual([]);
    });

    it('cerrar a las 22:00 y entrar a las 5:00 deja siete: se reporta', () => {
        const faltas = descansoInsuficiente([dia('2026-08-31', '13:30', '22:00'), dia('2026-09-01', '05:00', '13:00')]);
        expect(faltas).toHaveLength(1);
        expect(faltas[0].horas).toBe(7);
    });

    it('un día libre en medio corta la comparación', () => {
        const libre = { fecha: '2026-09-01', resuelto: resolverTurnoDelDia({ isOff: true }, TURNOS) };
        expect(descansoInsuficiente([dia('2026-08-31', '13:30', '22:00'), libre, dia('2026-09-02', '05:00', '13:00')])).toEqual([]);
    });
});

describe('las constantes salen del reglamento', () => {
    it('44 horas la semana diurna y 8 la jornada — RIT Art. 16', () => {
        expect(HORAS_SEMANA_DIURNA).toBe(44);
        expect(HORAS_JORNADA_DIURNA).toBe(8);
    });

    // Los cuatro turnos del reglamento suman 44 h exactas. Si alguna constante
    // se mueve, esta cuenta deja de dar y hay que volver a leer el Art. 18.
    it('el turno 1 del reglamento suma las 44 de la semana', () => {
        const laSemana = [
            ...Array(5).fill({ customStart: '07:00', customEnd: '15:30', hasLunch: true, lunchStart: '12:00' }),
            { customStart: '07:00', customEnd: '14:30', hasLunch: true, lunchStart: '12:00' },
            { isOff: true },
        ];
        const minutos = laSemana.reduce((t, d) => t + resolverTurnoDelDia(d, TURNOS).minutosPagados, 0);
        expect(minutos / 60).toBe(HORAS_SEMANA_DIURNA);
    });
});

describe('claveDeDia — domingo es 0', () => {
    it.each([
        ['2026-08-30', '0'], ['2026-08-31', '1'], ['2026-09-01', '2'],
        ['2026-09-02', '3'], ['2026-09-03', '4'], ['2026-09-04', '5'], ['2026-09-05', '6'],
    ])('%s → %s', (fecha, clave) => {
        expect(claveDeDia(new Date(fecha + 'T12:00:00'))).toBe(clave);
    });
});

describe('conversión de horas', () => {
    it('ida y vuelta', () => {
        for (const h of ['00:00', '07:00', '12:30', '19:45', '23:59']) expect(aHora(aMinutos(h))).toBe(h);
    });
    it('lo que no es una hora vale cero', () => {
        for (const basura of [null, undefined, '', 'siete']) expect(aMinutos(basura)).toBe(0);
    });
});
