// Catálogos de nivel académico para El Salvador.
//
// Grado Básica es fijo (1°-9°, no cambia). Especialidades de Bachillerato
// Técnico/Técnico Superior y Profesiones universitarias viven en la tabla
// `education_catalog_entries` (no hardcodeadas aquí) — se sembró con una
// lista base investigada (MINEDUCYT "Mi Nueva Escuela" 2026 + carreras más
// demandadas de UES/institutos técnicos), y cada vez que alguien teclea
// "Otra..." en el modal de Empleado, ese valor se agrega a la tabla y queda
// disponible como opción real para el siguiente registro — sin importar si
// es especialidad técnica o profesión universitaria/maestría.

export const GRADO_BASICA_OPTIONS = [
    { value: '1', label: '1° Grado' },
    { value: '2', label: '2° Grado' },
    { value: '3', label: '3° Grado' },
    { value: '4', label: '4° Grado' },
    { value: '5', label: '5° Grado' },
    { value: '6', label: '6° Grado' },
    { value: '7', label: '7° Grado' },
    { value: '8', label: '8° Grado' },
    { value: '9', label: '9° Grado (Noveno)' },
];

export const OTRA_ESPECIALIDAD = '__OTRA__';

// "Otra..." se detecta por dato, no por estado interno: si el valor guardado
// no está en el catálogo (incluido el propio sentinel mientras no se ha
// tecleado nada), se considera "otro".
export const isCatalogOther = (value, options) => value != null && value !== '' && !options.some(o => o.value === value && o.value !== OTRA_ESPECIALIDAD);

// Arma las options de un catálogo a partir de los valores traídos de la BD
// (tabla education_catalog_entries), con "Otra..." siempre al final.
export const buildCatalogOptions = (values, otherLabel) => [
    ...values.map(v => ({ value: v, label: v })),
    { value: OTRA_ESPECIALIDAD, label: otherLabel },
];
