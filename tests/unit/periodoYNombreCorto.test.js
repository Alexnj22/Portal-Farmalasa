// Dos cosas que se ven en casi toda pantalla del portal y que nadie miraba:
// el período que eligen las flechas, y cómo se escribe el nombre de alguien.
//
// Las dos comparten el mismo modo de falla: **no fallan, se equivocan**. Un
// paso de un mes sobre un rango de un día salta 30 días y la pantalla muestra
// otro período sin decir nada; un nombre partido por la mitad equivocada
// escribe a otra persona.

import { describe, it, expect } from 'vitest';
import { granularidadDePeriodo, correrPeriodo, periodoDeHoy, periodoAlcanzaHoy, svToday, pad }
    from '../../src/utils/periodo';
import { shortEmployeeName, employeeInitials } from '../../src/utils/nameUtils';
import { calcAge, MINOR_AGE } from '../../src/utils/ageUtils';

describe('qué ES un período, deducido del propio rango', () => {
    // Pedido del usuario (2026-08-14): «que ese elemento sea inteligente, y se
    // adapte según el contexto: si es por mes, pasa el mes; si el día, el día».
    // Un paso fijo se equivoca en los dos sentidos.
    it('un día es un día', () => {
        expect(granularidadDePeriodo('2026-08-14|2026-08-14'))
            .toEqual({ unidad: 'día', paso: 'dia', n: 1 });
    });

    it('del 1 al último es un mes — y el último día se PREGUNTA', () => {
        expect(granularidadDePeriodo('2026-08-01|2026-08-31').unidad).toBe('mes');
        expect(granularidadDePeriodo('2026-04-01|2026-04-30').unidad).toBe('mes');
        expect(granularidadDePeriodo('2026-02-01|2026-02-28').unidad).toBe('mes');
        expect(granularidadDePeriodo('2028-02-01|2028-02-29').unidad).toBe('mes');  // bisiesto
    });

    it('el año entero es un año, y NO doce meses', () => {
        expect(granularidadDePeriodo('2026-01-01|2026-12-31'))
            .toEqual({ unidad: 'año', paso: 'anio', n: 1 });
    });

    it('doce meses que no arrancan en enero NO son un año', () => {
        // Correrlo como año lo movería doce meses igual, pero la etiqueta
        // mentiría: «feb-2026 a ene-2027» no es «2026».
        const g = granularidadDePeriodo('2026-02-01|2027-01-31');
        expect(g.unidad).toBe('período');
        expect(g).toMatchObject({ paso: 'mes', n: 12 });
    });

    it('varios meses enteros se corren de a esa cantidad', () => {
        expect(granularidadDePeriodo('2026-06-01|2026-08-31'))
            .toEqual({ unidad: 'período', paso: 'mes', n: 3 });
    });

    it('un rango suelto se cuenta en días, con los dos extremos adentro', () => {
        expect(granularidadDePeriodo('2026-08-08|2026-08-14'))
            .toEqual({ unidad: 'período', paso: 'dia', n: 7 });
    });

    it('un valor roto no revienta: cae en un paso de un día', () => {
        for (const v of [null, undefined, '', 'cualquier cosa', '2026-08-01'])
            expect(granularidadDePeriodo(v)).toEqual({ unidad: 'período', paso: 'dia', n: 1 });
    });
});

describe('correr el período respeta su propia unidad', () => {
    it('un día se mueve un día', () => {
        expect(correrPeriodo('2026-08-14|2026-08-14', 1)).toBe('2026-08-15|2026-08-15');
        expect(correrPeriodo('2026-08-14|2026-08-14', -1)).toBe('2026-08-13|2026-08-13');
    });

    it('un mes entero da el mes entero siguiente, no «del 1 al 31 de febrero»', () => {
        // El fin se RECALCULA al último día del mes que toque.
        expect(correrPeriodo('2026-01-01|2026-01-31', 1)).toBe('2026-02-01|2026-02-28');
        expect(correrPeriodo('2026-03-01|2026-03-31', -1)).toBe('2026-02-01|2026-02-28');
        expect(correrPeriodo('2028-01-01|2028-01-31', 1)).toBe('2028-02-01|2028-02-29');
    });

    it('cruza el año en las dos direcciones', () => {
        expect(correrPeriodo('2026-12-01|2026-12-31', 1)).toBe('2027-01-01|2027-01-31');
        expect(correrPeriodo('2026-01-01|2026-01-31', -1)).toBe('2025-12-01|2025-12-31');
        expect(correrPeriodo('2026-01-01|2026-12-31', 1)).toBe('2027-01-01|2027-12-31');
    });

    it('ir y volver devuelve al mismo período', () => {
        for (const p of ['2026-08-14|2026-08-14', '2026-08-01|2026-08-31',
                         '2026-01-01|2026-12-31', '2026-08-08|2026-08-14',
                         '2026-06-01|2026-08-31'])
            expect(correrPeriodo(correrPeriodo(p, 1), -1)).toBe(p);
    });

    it('una semana se mueve una semana, no un día', () => {
        expect(correrPeriodo('2026-08-08|2026-08-14', 1)).toBe('2026-08-15|2026-08-21');
    });

    it('un valor roto se devuelve tal cual en vez de inventar uno', () => {
        expect(correrPeriodo('', 1)).toBe('');
        expect(correrPeriodo(null, 1)).toBeNull();
    });
});

describe('el período de hoy conserva la FORMA del que se le pasa', () => {
    it('de un mes devuelve el mes en curso completo', () => {
        const hoy = periodoDeHoy('2020-05-01|2020-05-31');
        expect(hoy).toMatch(/^\d{4}-\d{2}-01\|\d{4}-\d{2}-\d{2}$/);
        expect(granularidadDePeriodo(hoy).unidad).toBe('mes');
    });

    it('de un año devuelve el año en curso completo', () => {
        expect(periodoDeHoy('2020-01-01|2020-12-31')).toMatch(/^\d{4}-01-01\|\d{4}-12-31$/);
    });

    it('de un día devuelve hoy — en hora de El Salvador', () => {
        // Y no la del equipo: la fecha de un corte, de una venta o de un turno
        // es la de la sala.
        expect(periodoDeHoy('2020-05-04|2020-05-04')).toBe(`${svToday()}|${svToday()}`);
    });
});

describe('saber si ya no hay «siguiente» que mirar', () => {
    it('un período que termina hoy o después, alcanza', () => {
        expect(periodoAlcanzaHoy(`2020-01-01|${svToday()}`)).toBe(true);
        expect(periodoAlcanzaHoy('2020-01-01|2999-12-31')).toBe(true);
    });

    it('uno viejo no', () => {
        expect(periodoAlcanzaHoy('2020-01-01|2020-01-31')).toBe(false);
    });

    it('uno roto tampoco — y devuelve false, no undefined', () => {
        expect(periodoAlcanzaHoy('')).toBe(false);
        expect(periodoAlcanzaHoy(null)).toBe(false);
    });

    it('`pad` deja los dos dígitos que exige el formato', () => {
        expect(pad(1)).toBe('01');
        expect(pad(12)).toBe('12');
    });
});

describe('el nombre corto del portal', () => {
    it('es primer nombre + primer apellido, tenga los que tenga', () => {
        expect(shortEmployeeName({ first_names: 'ANA MARIA', last_names: 'PEREZ LOPEZ DE SOL' }))
            .toBe('ANA PEREZ');
    });

    it('sale de las columnas SEPARADAS cuando existen', () => {
        // `employees.name` es una columna GENERADA: partir ese texto es adivinar
        // dónde estaba la frontera.
        expect(shortEmployeeName({ first_names: 'JOSE', last_names: 'MARTINEZ', name: 'OTRA COSA' }))
            .toBe('JOSE MARTINEZ');
    });

    it('con sólo el nombre concatenado usa el heurístico, que es el ÚLTIMO recurso', () => {
        // Con 3 palabras es ambiguo —«ANA PEREZ LOPEZ» puede ser 1 nombre + 2
        // apellidos o 2 nombres + 1 apellido— y en producción hay de las dos
        // formas. Si a la fila le faltan las columnas, se agregan al `select`.
        expect(shortEmployeeName({ name: 'ANA PEREZ LOPEZ' })).toBe('ANA LOPEZ');
        expect(shortEmployeeName('ANA PEREZ')).toBe('ANA PEREZ');
        expect(shortEmployeeName({ name: 'ANA' })).toBe('ANA');
    });

    it('sin dato dice «Personal», no una cadena vacía ni «undefined»', () => {
        expect(shortEmployeeName(null)).toBe('Personal');
        expect(shortEmployeeName({})).toBe('Personal');
        expect(shortEmployeeName({ name: '   ' })).toBe('Personal');
    });

    it('con un solo lado no deja espacios sueltos', () => {
        expect(shortEmployeeName({ first_names: 'ANA', last_names: '' })).toBe('ANA');
        expect(shortEmployeeName({ first_names: '', last_names: 'PEREZ' })).toBe('PEREZ');
    });

    it('las iniciales siguen el mismo criterio', () => {
        expect(employeeInitials({ first_names: 'ana maria', last_names: 'perez lopez' })).toBe('AP');
        expect(employeeInitials({ first_names: 'ANA', last_names: '' })).toBe('A');
        expect(employeeInitials(null)).toBe('?');
    });
});

describe('la edad decide qué documento se pide', () => {
    // Menor de edad: documento alterno en vez de DUI (Art. 23.2 CT).
    const haceAnios = (n, offsetDias = 0) => {
        const d = new Date();
        d.setFullYear(d.getFullYear() - n);
        d.setDate(d.getDate() + offsetDias);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    it('el mayor de edad son 18', () => {
        expect(MINOR_AGE).toBe(18);
    });

    it('el día del cumpleaños ya cuenta', () => {
        expect(calcAge(haceAnios(18))).toBe(18);
    });

    it('un día antes del cumpleaños todavía no', () => {
        // Es el borde exacto que decide qué documento se le pide a alguien.
        expect(calcAge(haceAnios(18, 1))).toBe(17);
    });

    it('sin fecha, o con una rota, devuelve null y no un cero', () => {
        // Un 0 se leería como «recién nacido» y pediría documento alterno.
        expect(calcAge(null)).toBeNull();
        expect(calcAge('')).toBeNull();
        expect(calcAge('no es fecha')).toBeNull();
    });
});
