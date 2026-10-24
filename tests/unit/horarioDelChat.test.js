import { describe, expect, it } from 'vitest';
import {
    cuandoAbre, fechaLarga, horaDelHorario, horaLegible, horarioDeDomingo, nombreDelDia,
    proximosFeriados, rangoLegible, textoDelEstado, trozosDelMensaje,
} from '@nucleo/utils/horarioDelChat';
import { guardarBorrador, leerBorrador, tieneBorrador } from '@nucleo/utils/chatBorradores';
import { escribeAhora, VENTANA_ESCRIBIENDO_MS } from '@nucleo/hooks/escrituraDelChat';

// El chat con clientes: el horario que se le dice al cliente, lo escrito que
// sobrevive a cerrar el panel y el «está escribiendo…». Todo es lo que el
// cliente o el dependiente LEEN, así que se prueba la frase final.

const llano = (s) => String(s).replace(/ /g, ' ');
const HOY = '2026-10-21';   // miércoles

describe('el horario en palabras', () => {
    it('la hora de 24 pasa a 12 con a. m./p. m., y una hora ilegible queda vacía', () => {
        expect(llano(horaLegible('22:00'))).toBe('10:00 p. m.');
        expect(llano(horaLegible('07:00:00'))).toBe('7:00 a. m.');
        expect(horaLegible('mañana')).toBe('');
        expect(horaLegible(null)).toBe('');
    });

    it('el día visto desde hoy: hoy, mañana, el día de la semana o la fecha', () => {
        expect(nombreDelDia('2026-10-21', HOY)).toBe('hoy');
        expect(nombreDelDia('2026-10-22', HOY)).toBe('mañana');
        expect(nombreDelDia('2026-10-26', HOY)).toBe('el lunes');
        expect(nombreDelDia('2026-10-28', HOY)).toBe('el 28 de octubre');
        expect(nombreDelDia('2026-12-25', HOY)).toBe('el 25 de diciembre');
    });

    it('cuándo abre: con artículo para el mensaje, sin él para la píldora', () => {
        expect(llano(cuandoAbre('2026-10-22T07:00', { hoy: HOY }))).toBe('mañana a las 7:00 a. m.');
        expect(llano(cuandoAbre('2026-10-22T07:00', { hoy: HOY, conArticulo: false }))).toBe('mañana 7:00 a. m.');
        expect(cuandoAbre(null)).toBe('');
        expect(cuandoAbre('2026-10-22', { hoy: HOY })).toBe('');
    });

    it('el mensaje: reemplaza los marcadores y marca el que falta en vez de inventar una hora', () => {
        const abierta = trozosDelMensaje('Atendemos hasta las {cierra}. Abrimos {abre}.', { abierta: true, cierra: '22:00', abre: null }, { hoy: HOY });
        expect(abierta.map((t) => llano(t.texto)).join('')).toBe('Atendemos hasta las 10:00 p. m.. Abrimos {abre}.');
        expect(abierta.find((t) => t.texto === '{abre}')).toEqual({ texto: '{abre}', marcador: true, faltante: true });
        expect(abierta.find((t) => llano(t.texto) === '10:00 p. m.')).toEqual(expect.objectContaining({ marcador: true }));
        expect(trozosDelMensaje('', null)).toEqual([]);
    });

    it('la píldora: en línea hasta el cierre, o fuera de horario con la próxima apertura', () => {
        expect(llano(textoDelEstado({ abierta: true, cierra: '22:00' }, { hoy: HOY }).texto)).toBe('Farmacia en línea · hasta las 10:00 p. m.');
        const cerrada = textoDelEstado({ abierta: false, abre: '2026-10-22T07:00', feriado: 'Día de la Raza' }, { hoy: HOY });
        expect(llano(cerrada.texto)).toBe('Fuera de horario · abre mañana 7:00 a. m.');
        expect(cerrada).toMatchObject({ tono: 'neutral', feriado: 'Día de la Raza' });
        expect(textoDelEstado({ abierta: false }).texto).toBe('Fuera de horario');
        expect(textoDelEstado(null)).toBeNull();
    });
});

describe('feriados y horario de domingo', () => {
    const feriados = [
        { holiday_date: '2020-12-25', name: 'Navidad', is_recurring: true, municipality: null },
        { holiday_date: '2020-01-01', name: 'Año nuevo', is_recurring: true, municipality: null },
        { holiday_date: '2026-11-15', name: 'Fiestas patronales', is_recurring: false, municipality: 'Chalatenango' },
        { holiday_date: '2026-11-02', name: 'Difuntos', is_recurring: false, municipality: null },
        { holiday_date: '2026-11-02', name: 'Difuntos (repetido)', is_recurring: false, municipality: null },
    ];

    it('sólo nacionales, los recurrentes llevados al año que toca (y al siguiente), ordenados y sin repetir', () => {
        const r = proximosFeriados(feriados, { desde: '2026-10-21', dias: 90 });
        expect(r).toEqual([
            { fecha: '2026-11-02', nombre: 'Difuntos' },
            { fecha: '2026-12-25', nombre: 'Navidad' },
            { fecha: '2027-01-01', nombre: 'Año nuevo' },
        ]);
    });

    it('fuera de la ventana no aparecen', () => {
        expect(proximosFeriados(feriados, { desde: '2026-10-21', dias: 5 })).toEqual([]);
        expect(proximosFeriados(null)).toEqual([]);
    });

    it('las horas escritas a mano se leen igual', () => {
        expect(horaDelHorario('7:00 AM')).toBe('07:00');
        expect(horaDelHorario('18:30 PM')).toBe('18:30');
        expect(horaDelHorario('cerrado')).toBe('');
    });

    it('el horario de domingo: sólo si abre y tiene las dos horas; acepta el JSON como texto', () => {
        expect(horarioDeDomingo({ 0: { isOpen: true, start: '8:00', end: '17:00' } })).toEqual({ abre: '08:00', cierra: '17:00' });
        expect(horarioDeDomingo('{"0":{"isOpen":true,"start":"08:00","end":"12:00"}}')).toEqual({ abre: '08:00', cierra: '12:00' });
        expect(horarioDeDomingo({ 0: { isOpen: false, start: '8:00', end: '17:00' } })).toBeNull();
        expect(horarioDeDomingo({ 0: { isOpen: true, start: '8:00' } })).toBeNull();
        expect(horarioDeDomingo('no es json')).toBeNull();
    });

    it('el rango y la fecha larga', () => {
        expect(llano(rangoLegible('7:00', '16:00'))).toBe('7:00 a. m. – 4:00 p. m.');
        expect(fechaLarga('2026-11-02')).toBe('lunes 2 de noviembre');
        expect(fechaLarga('nada')).toBe('nada');
    });
});

describe('lo escrito sobrevive a cerrar el panel', () => {
    it('un borrador con algo se guarda; uno vacío o de puros espacios se borra', () => {
        guardarBorrador(1, { texto: 'hola' });
        expect(leerBorrador(1)).toEqual({ texto: 'hola' });
        guardarBorrador(1, { texto: '   ', archivo: null });
        expect(tieneBorrador(1)).toBe(false);
        expect(leerBorrador(1)).toBeNull();
    });

    it('una foto sola (sin texto) también cuenta como algo escrito', () => {
        guardarBorrador(2, { texto: '', foto: 'file:///foto.jpg' });
        expect(tieneBorrador(2)).toBe(true);
        guardarBorrador(2, null);
        expect(tieneBorrador(2)).toBe(false);
    });

    it('cada conversación tiene el suyo', () => {
        guardarBorrador(3, { texto: 'a' });
        guardarBorrador(4, { texto: 'b' });
        expect(leerBorrador(3).texto).toBe('a');
        expect(leerBorrador(4).texto).toBe('b');
    });
});

describe('«está escribiendo…»', () => {
    const t = Date.parse('2026-10-21T15:00:00Z');
    it('vale mientras la última tecla tiene menos de 6 s', () => {
        expect(VENTANA_ESCRIBIENDO_MS).toBe(6000);
        expect(escribeAhora('2026-10-21T15:00:00Z', t + 5_999)).toBe(true);
        expect(escribeAhora('2026-10-21T15:00:00Z', t + 6_000)).toBe(false);
    });
    it('tolera un reloj un poco adelantado, no uno muy corrido', () => {
        expect(escribeAhora('2026-10-21T15:00:03Z', t)).toBe(true);
        expect(escribeAhora('2026-10-21T15:00:10Z', t)).toBe(false);
    });
    it('sin marca o con una marca ilegible, no escribe nadie', () => {
        expect(escribeAhora(null, t)).toBe(false);
        expect(escribeAhora('ayer', t)).toBe(false);
    });
});
