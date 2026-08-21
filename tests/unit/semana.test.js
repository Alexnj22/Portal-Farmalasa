import { describe, it, expect } from 'vitest';
import { getLocalMonday, formatWeekRange, shiftWeek, enLaSemanaDe, rangoDeSemana } from '../../src/utils/semana';

/**
 * La semana del portal.
 *
 * Se ancla porque tres pantallas cortan por ella —Solicitudes, Traslados y
 * Horarios— y porque el error clásico no falla: devuelve un día de menos y
 * nadie lo nota hasta que alguien pregunta por qué su solicitud del lunes
 * aparece en la semana anterior.
 */
describe('la semana empieza el lunes', () => {
    it('un lunes es su propio lunes', () => {
        expect(getLocalMonday('2026-08-17')).toBe('2026-08-17');
    });

    it('el domingo pertenece a la semana que ARRANCÓ, no a la que empieza', () => {
        // 2026-08-23 es domingo: su lunes es el 17, no el 24. Es el caso que
        // `getDay() === 0` resuelve con el `-6`.
        expect(getLocalMonday('2026-08-23')).toBe('2026-08-17');
    });

    it('el lunes siguiente ya es otra semana', () => {
        expect(getLocalMonday('2026-08-24')).toBe('2026-08-24');
    });
});

describe('correr la semana', () => {
    it('cruza el mes hacia atrás', () => {
        expect(shiftWeek('2026-09-07', -1)).toBe('2026-08-31');
    });

    it('cruza el año hacia adelante', () => {
        expect(shiftWeek('2026-12-28', +1)).toBe('2027-01-04');
    });

    it('ida y vuelta devuelve el mismo lunes', () => {
        expect(shiftWeek(shiftWeek('2026-08-17', -5), +5)).toBe('2026-08-17');
    });
});

describe('el rótulo dice sólo lo que hace falta', () => {
    it('mismo mes: el mes se nombra una vez', () => {
        expect(formatWeekRange('2026-08-17')).toBe("17 - 23 Ago '26");
    });

    it('cruza el mes: se nombran los dos', () => {
        expect(formatWeekRange('2026-08-31')).toBe("31 Ago - 06 Sep '26");
    });

    it('cruza el año: se nombran los dos años', () => {
        expect(formatWeekRange('2026-12-28')).toBe("28 Dic '26 - 03 Ene '27");
    });
});

describe('qué cae dentro de la semana', () => {
    const lunes = '2026-08-17';

    it('el propio lunes a primera hora entra', () => {
        expect(enLaSemanaDe(lunes, new Date(2026, 7, 17, 0, 1).toISOString())).toBe(true);
    });

    it('el domingo a última hora todavía entra', () => {
        expect(enLaSemanaDe(lunes, new Date(2026, 7, 23, 23, 59).toISOString())).toBe(true);
    });

    it('el lunes siguiente ya no', () => {
        expect(enLaSemanaDe(lunes, new Date(2026, 7, 24, 0, 1).toISOString())).toBe(false);
    });

    it('sin fecha, no entra — y no revienta', () => {
        expect(enLaSemanaDe(lunes, null)).toBe(false);
        expect(enLaSemanaDe(lunes, 'no es una fecha')).toBe(false);
    });
});

describe('el rango que viaja a la base', () => {
    /* La trampa de siempre: `new Date('2026-08-17')` se lee como UTC, y en El
     * Salvador (UTC−6) eso es el domingo 16 a las 18:00. Un rango armado así
     * empujaría media semana al casillero equivocado. Se comprueba que el
     * extremo coincida con la medianoche LOCAL, sea cual sea la zona donde
     * corran las pruebas. */
    it('empieza a la medianoche local del lunes', () => {
        const { desde } = rangoDeSemana('2026-08-17');
        expect(desde).toBe(new Date(2026, 7, 17, 0, 0, 0, 0).toISOString());
    });

    it('termina en la medianoche local del lunes siguiente, sin incluirla', () => {
        const { hasta } = rangoDeSemana('2026-08-17');
        expect(hasta).toBe(new Date(2026, 7, 24, 0, 0, 0, 0).toISOString());
    });

    it('los dos extremos abarcan exactamente siete días', () => {
        const { desde, hasta } = rangoDeSemana('2026-08-17');
        expect(new Date(hasta) - new Date(desde)).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('el rango y `enLaSemanaDe` cortan por el MISMO borde', () => {
        // Si se separaran, la lista paginada y la filtrada en el navegador
        // dirían cosas distintas sobre la misma solicitud.
        const lunes = '2026-08-17';
        const { desde, hasta } = rangoDeSemana(lunes);
        for (const iso of [desde, new Date(new Date(hasta) - 1).toISOString()]) {
            expect(enLaSemanaDe(lunes, iso)).toBe(true);
        }
        expect(enLaSemanaDe(lunes, hasta)).toBe(false);
        expect(enLaSemanaDe(lunes, new Date(new Date(desde) - 1).toISOString())).toBe(false);
    });
});
