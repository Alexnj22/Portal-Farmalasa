// Catálogos de nivel académico para El Salvador.
//
// Fuentes: MINEDUCYT — reforma "Mi Nueva Escuela" (15 especialidades de
// Bachillerato Técnico Productivo, sectores industrial/comercial/servicios/
// agrícola, vigente desde 2026) + nomenclatura tradicional de Bachillerato
// Técnico Vocacional (Contaduría, Salud, etc. — títulos que la mayoría de
// empleados actuales todavía porta, ya que la reforma es reciente).
//
// No existe un catálogo cerrado y oficial de carreras de Técnico Superior
// (más de 600 programas distintos entre institutos públicos y privados,
// según el clasificador de títulos del BCR) ni de licenciaturas/maestrías —
// por eso esos niveles usan una lista de las carreras más comunes en el
// sector salud/retail + una opción "Otra" con texto libre, en vez de un
// catálogo cerrado inventado.

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

export const BACHILLERATO_TECNICO_ESPECIALIDADES = [
    // Tradicional (Bachillerato Técnico Vocacional)
    { value: 'Contaduría / Asistente Administrativo Contable', label: 'Contaduría / Asistente Administrativo Contable' },
    { value: 'Salud (Atención Primaria en Salud)', label: 'Salud (Atención Primaria en Salud)' },
    { value: 'Informática', label: 'Informática' },
    { value: 'Mecánica Automotriz', label: 'Mecánica Automotriz' },
    { value: 'Turismo', label: 'Turismo' },
    // Sector Industrial (reforma 2026)
    { value: 'Electromecánica', label: 'Electromecánica' },
    { value: 'Electrónica', label: 'Electrónica' },
    { value: 'Electricidad', label: 'Electricidad' },
    { value: 'Motores de Combustión y Eléctricos', label: 'Motores de Combustión y Eléctricos' },
    { value: 'Software y Redes', label: 'Software y Redes' },
    { value: 'Construcción', label: 'Construcción' },
    { value: 'Aeronáutica', label: 'Aeronáutica' },
    // Sector Comercial
    { value: 'Gestión Administrativa', label: 'Gestión Administrativa' },
    { value: 'Logística Comercial y Transporte', label: 'Logística Comercial y Transporte' },
    // Sector Servicios
    { value: 'Salud y Bienestar Social', label: 'Salud y Bienestar Social' },
    { value: 'Servicios Turísticos', label: 'Servicios Turísticos' },
    { value: 'Expresiones Artísticas', label: 'Expresiones Artísticas' },
    { value: 'Diseño Digital', label: 'Diseño Digital' },
    // Sector Agrícola
    { value: 'Agropecuario', label: 'Agropecuario' },
    { value: 'Agroindustrial', label: 'Agroindustrial' },
    { value: OTRA_ESPECIALIDAD, label: 'Otra especialidad...' },
];

// Carreras de Técnico Superior más comunes en farmacia/retail — no es un
// catálogo oficial cerrado (no existe uno práctico, ver nota arriba).
export const TECNICO_SUPERIOR_ESPECIALIDADES = [
    { value: 'Técnico en Farmacia', label: 'Técnico en Farmacia' },
    { value: 'Técnico en Administración de Empresas', label: 'Técnico en Administración de Empresas' },
    { value: 'Técnico en Contaduría Pública', label: 'Técnico en Contaduría Pública' },
    { value: 'Técnico en Mercadeo', label: 'Técnico en Mercadeo' },
    { value: 'Técnico en Recursos Humanos', label: 'Técnico en Recursos Humanos' },
    { value: 'Técnico en Logística', label: 'Técnico en Logística' },
    { value: 'Técnico en Enfermería', label: 'Técnico en Enfermería' },
    { value: 'Técnico en Informática / Desarrollo de Software', label: 'Técnico en Informática / Desarrollo de Software' },
    { value: 'Técnico en Ingeniería de Redes', label: 'Técnico en Ingeniería de Redes' },
    { value: 'Técnico en Análisis de Sistemas', label: 'Técnico en Análisis de Sistemas' },
    { value: OTRA_ESPECIALIDAD, label: 'Otra especialidad...' },
];
