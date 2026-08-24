// Tres piezas del expediente de empleado y el cálculo del personal mínimo.
//
// Las tres primeras son catálogos y validaciones que viven fuera del formulario
// **a propósito**: la pantalla valida y el store normaliza antes de guardar, y
// si cada uno tuviera su copia de «esta edad es válida» las dos se separarían la
// primera vez que alguien tocara una.
//
// La cuarta decide **cuánta gente hace falta en una sala**, y de ahí salen las
// contrataciones. Un día con `isOpen` mal puesto no muestra un horario raro:
// cambia ese número.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MIN_DEPENDENT_AGE, MAX_DEPENDENT_AGE, isDependentAgeOnly, getDependentAge,
         isDependentAgeInvalid } from '../../src/utils/economicDependents';
import { GRADO_BASICA_OPTIONS, OTRA_ESPECIALIDAD, isCatalogOther, buildCatalogOptions }
    from '../../src/utils/educationCatalogs';
import { NATIONALITY_OPTIONS } from '../../src/data/nationalities';
import { calculateMinimumStaff } from '../../src/utils/staffHelpers';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));
const { fetchPracticantes, upsertInstitucionCatalogEntry, fetchInstitucionCatalogValues,
        deletePracticante } = await import('../../src/data/practicantes');

describe('los dependientes económicos: fecha exacta o edad a mano', () => {
    it('con fecha de nacimiento NO está en modo edad', () => {
        expect(isDependentAgeOnly({ birth_date: '2015-04-01' })).toBe(false);
    });

    it('con una edad y sin fecha, sí — aunque nadie haya tocado el interruptor', () => {
        // Es el caso de la familia que no sabe la fecha exacta.
        expect(isDependentAgeOnly({ age: 8 })).toBe(true);
        expect(getDependentAge({ age: 8 })).toBe(8);
    });

    it('el interruptor explícito GANA sobre lo que se deduzca del dato', () => {
        expect(isDependentAgeOnly({ age_only: false, age: 8 })).toBe(false);
        expect(isDependentAgeOnly({ age_only: true, birth_date: '2015-04-01' })).toBe(true);
    });

    it('el rango humano son 0 a 120', () => {
        expect(MIN_DEPENDENT_AGE).toBe(0);
        expect(MAX_DEPENDENT_AGE).toBe(120);
        expect(getDependentAge({ age: 0 })).toBe(0);
        expect(getDependentAge({ age: 120 })).toBe(120);
    });

    it('un recién nacido son 0 años, y 0 no es «vacío»', () => {
        // Es el caso que rompen los `if (!age)`.
        expect(isDependentAgeInvalid({ age_only: true, age: 0 })).toBe(false);
    });

    it('lo que bloquea Guardar: vacío, decimal, negativo o fuera de rango', () => {
        for (const age of ['', null, 8.5, -1, 121, 'ocho'])
            expect(isDependentAgeInvalid({ age_only: true, age }), String(age)).toBe(true);
    });

    it('quien NO está en modo edad nunca queda bloqueado por la edad', () => {
        expect(isDependentAgeInvalid({ birth_date: '2015-04-01', age: 'basura' })).toBe(false);
    });

    it('una edad inválida no devuelve un número: devuelve null', () => {
        // Un `NaN` acá se guardaría en la ficha.
        for (const age of ['', 8.5, -1, 121, 'ocho'])
            expect(getDependentAge({ age_only: true, age })).toBeNull();
    });
});

describe('los catálogos académicos', () => {
    it('la básica va de 1° a 9°', () => {
        expect(GRADO_BASICA_OPTIONS).toHaveLength(9);
        expect(GRADO_BASICA_OPTIONS[0].value).toBe('1');
        expect(GRADO_BASICA_OPTIONS.at(-1).label).toContain('noveno');
    });

    it('«Otra…» siempre va al final', () => {
        // Si quedara en el medio, el ojo la elegiría por accidente.
        const opts = buildCatalogOptions(['Enfermería', 'Farmacia'], 'Otra…');
        expect(opts).toHaveLength(3);
        expect(opts.at(-1).value).toBe(OTRA_ESPECIALIDAD);
        expect(opts.at(-1).label).toBe('Otra…');
    });

    it('«otro» se detecta por el DATO, no por un estado interno', () => {
        // Un valor tecleado que no está en el catálogo es «otro», y al recargar
        // la ficha tiene que seguir viéndose así — un estado interno se pierde.
        const opts = buildCatalogOptions(['Enfermería'], 'Otra…');
        expect(isCatalogOther('Enfermería', opts)).toBe(false);
        expect(isCatalogOther('Bioanálisis', opts)).toBe(true);
    });

    it('el propio centinela cuenta como «otro» mientras no se teclee nada', () => {
        const opts = buildCatalogOptions(['Enfermería'], 'Otra…');
        expect(isCatalogOther(OTRA_ESPECIALIDAD, opts)).toBe(true);
    });

    it('vacío no es «otro»: es sin elegir', () => {
        const opts = buildCatalogOptions(['Enfermería'], 'Otra…');
        expect(isCatalogOther('', opts)).toBe(false);
        expect(isCatalogOther(null, opts)).toBe(false);
        expect(isCatalogOther(undefined, opts)).toBe(false);
    });
});

describe('las nacionalidades (Art. 23.1 del Código de Trabajo)', () => {
    it('El Salvador y Centroamérica van primero', () => {
        // El resto sigue orden alfabético; el orden sólo importa para lo más
        // frecuente, porque el desplegable ya es buscable.
        expect(NATIONALITY_OPTIONS[0].value).toBe('Salvadoreña');
        expect(NATIONALITY_OPTIONS.slice(0, 7).map(o => o.value))
            .toContain('Guatemalteca');
    });

    it('ninguna se repite', () => {
        const vs = NATIONALITY_OPTIONS.map(o => o.value);
        expect(new Set(vs).size).toBe(vs.length);
    });

    it('cada opción tiene valor y rótulo', () => {
        for (const o of NATIONALITY_OPTIONS) {
            expect(o.value).toBeTruthy();
            expect(o.label).toBeTruthy();
        }
    });
});

describe('cuánta gente hace falta en una sala', () => {
    const horario = (dias) => Object.fromEntries(
        dias.map((d, i) => [i, d ? { isOpen: true, start: '08:00', end: '18:00' } : { isOpen: false }]),
    );
    const seisDias = horario([false, true, true, true, true, true, true]);   // 60 h de apertura

    it('sin historial usa el cálculo tradicional, no devuelve cero', () => {
        // Devolver 0 diría que la sala no necesita a nadie.
        const r = calculateMinimumStaff(seisDias, [], 2);
        expect(r.wfmApplied).toBe(false);
        expect(r.minStaff).toBeGreaterThan(0);
        expect(r.totalOpenHours).toBe(60);
    });

    it('el piso es «tantas personas a la vez, toda la apertura»', () => {
        // 60 h × 2 personas = 120 h de trabajo antes del margen de ausentismo.
        expect(calculateMinimumStaff(seisDias, [], 2).baseStaffHours).toBe(120);
        expect(calculateMinimumStaff(seisDias, [], 3).baseStaffHours).toBe(180);
    });

    it('el margen de ausentismo SUMA horas, no las resta', () => {
        // Es cobertura que hay que reponer, no un descuento.
        const conMargen = calculateMinimumStaff(seisDias, [], 2, 80, 0.15);
        const sinMargen = calculateMinimumStaff(seisDias, [], 2, 80, 0);
        expect(conMargen.totalLaborHoursNeeded).toBeGreaterThan(sinMargen.totalLaborHoursNeeded);
        expect(conMargen.shrinkageHours).toBe(18);      // 120 × 0.15
    });

    it('un día cerrado no cuenta horas', () => {
        expect(calculateMinimumStaff(horario([false, true, false, false, false, false, false]), []).totalOpenHours)
            .toBe(10);
    });

    it('un cierre que cruza la medianoche no resta horas', () => {
        // Sin el `+24`, un turno de 22:00 a 06:00 daría −16 h de apertura.
        const cruza = { 1: { isOpen: true, start: '22:00', end: '06:00' } };
        expect(calculateMinimumStaff(cruza, []).totalOpenHours).toBe(8);
    });

    it('el horario también se acepta como TEXTO, que es como viene de la base', () => {
        expect(calculateMinimumStaff(JSON.stringify(seisDias), []).totalOpenHours).toBe(60);
    });

    it('una sucursal de menos de tres meses NO se mide con la misma vara', () => {
        const reciente = new Date();
        reciente.setMonth(reciente.getMonth() - 1);
        const ventas = [{ sale_date: '2026-08-03', sale_hour: 10, total_sales: 5000 }];
        const r = calculateMinimumStaff(seisDias, ventas, 2, 80, 0.15, reciente.toISOString());
        expect(r.isNewBranch).toBe(true);
        expect(r.wfmApplied).toBe(false);
    });

    it('con historial y sala madura, la hora pico se identifica', () => {
        const ventas = [
            { sale_date: '2026-08-03', sale_hour: 10, total_sales: 100 },   // lunes
            { sale_date: '2026-08-03', sale_hour: 17, total_sales: 900 },
        ];
        const r = calculateMinimumStaff(seisDias, ventas, 2, 80, 0.15, '2020-01-01');
        expect(r.wfmApplied).toBe(true);
        expect(r.peakHour).toMatchObject({ dayName: 'Lunes', hour: 17 });
    });

    it('una hora de mucho volumen suma HORAS por encima del piso', () => {
        // 900 / 80 ≈ 12 personas para esa hora, contra un piso de 2: son 10
        // horas-persona extra en la semana.
        const ventas = [{ sale_date: '2026-08-03', sale_hour: 17, total_sales: 900 }];
        const r = calculateMinimumStaff(seisDias, ventas, 2, 80, 0.15, '2020-01-01');
        const base = calculateMinimumStaff(seisDias, [], 2, 80, 0.15);
        expect(r.extraVolumeHours).toBe(10);
        expect(r.totalLaborHoursNeeded).toBeGreaterThan(base.totalLaborHoursNeeded);
    });

    it('pero la PLANTILLA sólo se mueve al cruzar las 44 horas de una persona', () => {
        // Es un techo: 138 h y 149 h dan las mismas 4 personas. Esperar que cada
        // hora extra sume alguien haría creer que el motor no está corriendo.
        const unPico = calculateMinimumStaff(seisDias,
            [{ sale_date: '2026-08-03', sale_hour: 17, total_sales: 900 }], 2, 80, 0.15, '2020-01-01');
        expect(unPico.minStaff).toBe(calculateMinimumStaff(seisDias, [], 2, 80, 0.15).minStaff);

        // Con volumen en varias horas de varios días, sí cruza.
        const muchos = [];
        for (const d of ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'])
            for (const h of [9, 10, 11, 16, 17, 18])
                muchos.push({ sale_date: d, sale_hour: h, total_sales: 900 });
        const r = calculateMinimumStaff(seisDias, muchos, 2, 80, 0.15, '2020-01-01');
        expect(r.minStaff).toBeGreaterThan(unPico.minStaff);
    });

    it('sin horario cargado no revienta', () => {
        expect(calculateMinimumStaff(null, []).totalOpenHours).toBe(0);
        expect(calculateMinimumStaff('', []).totalOpenHours).toBe(0);
    });
});

describe('los practicantes', () => {
    beforeEach(() => espia.limpiar());

    it('la lista trae la sala y el supervisor RESUELTOS, no sus ids', () => {
        // Un id de supervisor no le dice nada a quien mira la lista, y
        // resolverlo con una segunda consulta por fila es lo que convierte una
        // pantalla en lenta.
        fetchPracticantes();
        const columnas = espia.primero('select')[0];
        expect(columnas).toContain('branches(name)');
        expect(columnas).toContain('supervisor:supervisor_employee_id');
    });

    it('salen del más nuevo al más viejo', () => {
        fetchPracticantes();
        expect(espia.primero('order')).toEqual(['created_at', { ascending: false }]);
    });

    it('una institución tecleada se agrega al catálogo sin duplicarla', () => {
        // Así queda disponible como opción real para el siguiente registro, que
        // es lo que evita que cada quien la escriba a su manera.
        upsertInstitucionCatalogEntry('Universidad de El Salvador');
        const [filas, opciones] = espia.primero('upsert');
        expect(filas[0]).toEqual({ category: 'INSTITUCION_EDUCATIVA', value: 'Universidad de El Salvador' });
        expect(opciones).toEqual({ onConflict: 'category,value', ignoreDuplicates: true });
    });

    it('el catálogo se pide por su categoría, no entero', () => {
        // `education_catalog_entries` guarda también especialidades y
        // profesiones: sin el filtro, el desplegable de instituciones ofrecería
        // carreras.
        fetchInstitucionCatalogValues();
        expect(espia.primero('eq')).toEqual(['category', 'INSTITUCION_EDUCATIVA']);
        expect(espia.primero('order')).toEqual(['value']);
    });

    it('borrar toca una fila identificada', () => {
        deletePracticante(4);
        expect(espia.uso('delete')).toBe(true);
        expect(espia.primero('eq')).toEqual(['id', 4]);
    });
});
