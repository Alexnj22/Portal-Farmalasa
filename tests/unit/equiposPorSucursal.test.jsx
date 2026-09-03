import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ═══════════════════════════════════════════════════════════════════════════
// «Equipos por sucursal» — el boceto que agrupa el personal por sala.
//
// Lo que ancla NO es cómo se ve, sino la única decisión que la vista toma sola:
// **quién es referente de una sala y quién es equipo**. Esa respuesta sale del
// árbol de `roles.parent_role_id` y no de leer el texto del cargo, que es la
// diferencia entre un dato y una coincidencia de palabras — el mismo defecto
// que costó los `role_id: null` de 2026-08-12 («un rótulo no es una clave»).
//
// El caso que se reproduce es **Salud 4**, y es el que corrigió el usuario el
// 2026-08-26 mirando el primer boceto. Ahí conviven una Jefa de Sala, una
// Regente de Enfermería que además es Subjefa, tres Dependientes y una Técnica
// de Mantenimiento. El boceto destacaba a los tres que responden fuera de la
// sala y ponía a la técnica PRIMERA, porque su cargo cuelga del Administrador
// (nivel 2) y el de la jefa del Supervisor de Ventas (nivel 3): el árbol formal
// leído crudo coronaba a quien la sala no reconoce como jefe.
//
// Las tres reglas que lo arreglan —jefe por cuánta gente le cuelga, superior
// vacante que devuelve a la persona a la jefatura de sala, y adscrito para el
// que responde a alguien que sí existe pero está afuera— viven en
// `src/utils/mandoDeSala.js` con su porqué.
// ═══════════════════════════════════════════════════════════════════════════

// Las 6 filas de `roles` que participan, con los ids y padres REALES de
// producción (consultados el 2026-08-26). Copiarlos importa: si el árbol de la
// base cambia, esta prueba deja de describir la empresa y hay que volver a
// mirarla, que es justo lo que se quiere que pase.
const ROLES = [
    { id: 2,  name: 'Gerente General',                              parent_role_id: null },
    { id: 3,  name: 'Administrador',                                parent_role_id: 2 },
    { id: 35, name: 'Contador Externo',                             parent_role_id: 2 },
    { id: 12, name: 'Jefe/a de Compras y Logistica',                parent_role_id: 3 },
    { id: 14, name: 'Asistente de Logistica',                       parent_role_id: 12 },
    { id: 15, name: 'Auxiliar de Bodega',                           parent_role_id: 14 },
    { id: 13, name: 'Supervisor/a de Ventas',                       parent_role_id: 3 },
    { id: 22, name: 'Supervisor del Departamento Medico y Enfermería', parent_role_id: 3 },
    { id: 27, name: 'Tecnico de Mantenimiento y Servicios Generales', parent_role_id: 3 },
    { id: 19, name: 'Jefe/a de Sala',                               parent_role_id: 13 },
    { id: 23, name: 'Regente de Enfermeria',                        parent_role_id: 22 },
    { id: 20, name: 'Subjefe/a de Sala',                            parent_role_id: 19 },
    { id: 30, name: 'Dependiente de Farmacia',                      parent_role_id: 20 },
];

const persona = (id, name, role_id, role, branch_id, secondary_role_id = null, secondary_role = null) => ({
    id, name, role_id, role, branch_id, branchId: branch_id, secondary_role_id, secondary_role,
    status: 'ACTIVO', history: [], documents: [], employee_documents: [],
    // Con estos tres puestos, `alertasDe` no encuentra nada que decir: la
    // prueba habla del reparto, no de las insignias.
    dui: '00000000-0', birth_date: '1990-03-04', isss_number: '123456',
});

// Salud 4 tal como está en producción, más el Administrador de casa matriz —
// que NO es decorado: es lo que hace que la técnica quede adscrita en vez de
// devuelta a la jefatura de sala. Su superior existe, sólo que está en otra
// sucursal. Sin esa fila, la regla del superior vacante se dispararía y la
// prueba pasaría por el motivo equivocado.
const EMPLEADOS = [
    persona(1, 'Jefa de Salud 4',       19, 'Jefe/a de Sala',                                 44),
    persona(2, 'Regente de Salud 4',    23, 'Regente de Enfermeria',                          44, 20, 'Subjefe/a de Sala'),
    persona(3, 'Tecnica de Servicios',  27, 'Tecnico de Mantenimiento y Servicios Generales', 44),
    persona(4, 'Dependiente Uno',       30, 'Dependiente de Farmacia',                        44),
    persona(5, 'Dependiente Dos',       30, 'Dependiente de Farmacia',                        44),
    persona(6, 'Regente de Salud 3',    23, 'Regente de Enfermeria',                          43),
    persona(7, 'Jefe de Salud 3',       19, 'Jefe/a de Sala',                                 43),
    persona(8, 'Dependiente Tres',      30, 'Dependiente de Farmacia',                        43),
    persona(9,  'El Administrador',      3, 'Administrador',                                  99),
    // Mantenimiento: sede en casa matriz y cobertura declarada sobre las
    // cuatro áreas. Su superior existe y está en Administración, así que en
    // Salud 4 quedaría adscrito — pero acá su sede ES Administración.
    { ...persona(13, 'El de Mantenimiento', 27, 'Tecnico de Mantenimiento y Servicios Generales', 99),
      assigned_branch_ids: [99, 50, 44, 43] },
    // Bodega: su segundo puesto —Asistente de Logística— no lo ocupa NADIE en
    // toda la empresa. El hueco tiene que verse igual; corrección del usuario.
    persona(10, 'Jefa de Bodega',       12, 'Jefe/a de Compras y Logistica',                  50),
    persona(11, 'Auxiliar Uno',         15, 'Auxiliar de Bodega',                             50),
    persona(12, 'Auxiliar Dos',         15, 'Auxiliar de Bodega',                             50),
];

// El Contador Externo NO se dibuja —no es personal— pero SÍ ocupa un cargo que
// cuelga del Gerente General. Vive aparte para que la prueba distinga las dos
// listas: si la ocupación se midiera sobre lo dibujado, Administración
// inventaría «Contador Externo: puesto sin cubrir» sobre un puesto ocupado.
const NO_PERSONAL = [
    { ...persona(90, 'Contador Externo', 35, 'Contador Externo', 99), tipo_ficha: 'servicio_externo' },
];

const BRANCHES = [{ id: 44, name: 'Salud 4' }, { id: 43, name: 'Salud 3' },
                  { id: 99, name: 'Administracion' }, { id: 50, name: 'Bodega' }];

const estado = {
    employees: [...EMPLEADOS, ...NO_PERSONAL],
    branches: BRANCHES,
    roles: ROLES,
    employeesStatus: 'ready',
    // La vista pide practicantes al montar. No son el tema de esta prueba, pero
    // sin el par lista/función el efecto de montaje lanza y las 14 se caen con
    // un error que apunta al store en vez de a la vista.
    practicantes: [],
    practicantesLoading: false,
    fetchPracticantes: () => {},
    deletePracticante: () => {},
};

vi.mock('../../src/store/staffStore', () => ({
    useStaffStore: (selector) => selector(estado),
}));

vi.mock('../../src/context/AuthContext', () => ({
    useAuth: () => ({ user: { branchId: 44 }, getScope: () => 'ALL', hasPermission: () => true }),
}));

// El alta de practicante y el diálogo de borrado no participan del reparto, y
// el primero trae su propio formulario con red y estado.
vi.mock('../../src/components/practicantes/PracticanteModal', () => ({ default: () => null }));

// El layout trae `framer-motion`, observadores de tamaño y el canal de vista:
// nada de eso participa del reparto, y montarlo convertiría un fallo de
// agrupación en un fallo de entorno. Se reemplaza por su hueco.
vi.mock('../../src/components/GlassViewLayout', () => ({
    default: ({ children }) => <div>{children}</div>,
}));
vi.mock('../../src/components/common/ViewTabBar', () => ({
    default: () => null,
}));

import EquiposView from '../../src/views/personal/EquiposView';

const montar = () => render(
    <MemoryRouter>
        <EquiposView searchTerm="" setSearchTerm={() => {}} />
    </MemoryRouter>,
);

// Sondas por el CONTENIDO del DOM, no por clases de CSS: un retoque visual no
// tiene que romper una prueba que habla de jerarquía.
const tarjetas = (container) => [...container.querySelectorAll('[data-surface="card"]')];

const textoDe = (t) => t.querySelector('p')?.textContent?.trim();

// `data-lugar` lo estampa la vista, que en tiempo de render sí sabe si una
// tarjeta es la jefatura, el equipo o un adscrito. Preguntarlo por el aspecto
// —tamaño de la tarjeta, o la línea «Responde a…»— falla: lo primero es CSS y
// lo segundo lo llevan la jefatura Y los adscritos, que fue exactamente lo que
// hizo pasar por buena una sonda equivocada al escribir esta prueba.
const enLugar = (container, lugar) =>
    tarjetas(container).filter(c => c.dataset.lugar === lugar).map(textoDe);

const conJefatura = (container) => [...enLugar(container, 'jefatura'), ...enLugar(container, 'segundo')];

describe('Equipos por sucursal — quién manda y quién responde a quién', () => {
    beforeEach(() => cleanup());

    it('la jefa de sala manda, aunque su cargo esté MÁS ABAJO en el árbol', () => {
        // Técnico de Mantenimiento cuelga del Administrador (nivel 2) y Jefe/a
        // de Sala del Supervisor de Ventas (nivel 3). Por nivel ganaría la
        // técnica; por gente a cargo dentro de la sala, gana la jefa — que es
        // lo que la sala entiende.
        const { container } = montar();
        const nombres = conJefatura(container);
        expect(nombres).toContain('Jefa de Salud 4');
        expect(nombres).not.toContain('Tecnica de Servicios');
    });

    it('la regente que además es subjefa ocupa el segundo puesto', () => {
        const { container } = montar();
        expect(conJefatura(container)).toContain('Regente de Salud 4');
    });

    const vacantes = (container) => tarjetas(container)
        .filter(c => c.textContent.includes('Puesto sin cubrir'))
        .map(c => c.querySelector('span')?.textContent?.trim());

    it('la sala sin subjefe muestra el puesto sin cubrir, con su nombre', () => {
        const { container } = montar();
        // Salud 3 no tiene subjefe y Salud 4 sí: el hueco sale una sola vez.
        expect(vacantes(container)).toContain('Subjefe/a de Sala');
        expect(vacantes(container).filter(v => v === 'Subjefe/a de Sala')).toHaveLength(1);
    });

    it('el segundo puesto que NADIE ocupa en la empresa también se muestra', () => {
        // Corrección del usuario: «asistente de logística es como subjefe,
        // dejalo como pendiente». La versión anterior lo escondía justo porque
        // estaba vacío en todos lados — o sea, apagaba la alarma más fuerte.
        const { container } = montar();
        expect(vacantes(container)).toContain('Asistente de Logistica');
    });

    it('quien cubre varias áreas lo DICE, con cuántas y cuáles', () => {
        const { container } = montar();
        const suya = tarjetas(container).find(c => textoDe(c) === 'El de Mantenimiento');
        expect(suya.textContent).toContain('Cubre 4 áreas');
        // El detalle va en el `title`, para no gastar cuatro renglones de
        // tarjeta en algo que casi nadie necesita leer entero.
        expect(suya.querySelector('[title*="Salud 4"]')).toBeTruthy();
    });

    it('un puesto ocupado por una ficha que no se dibuja NO cuenta como vacante', () => {
        // El Contador Externo cuelga del Gerente General y no aparece en los
        // equipos —no es personal—. Medir la ocupación sobre lo dibujado
        // inventaría una vacante sobre un puesto que está cubierto.
        const { container } = montar();
        expect(vacantes(container)).not.toContain('Contador Externo');
    });

    it('la regente de Salud 3 NO es jefatura: su superior está vacante y responde a la sala', () => {
        const { container } = montar();
        const nombres = conJefatura(container);
        expect(nombres).toContain('Jefe de Salud 3');
        expect(nombres).not.toContain('Regente de Salud 3');
        // Y no queda suelta: cae en el equipo de su sala, que es la otra mitad
        // de la regla. Antes esto además se explicaba con un aviso arriba de la
        // vista; lo sacó el usuario el 2026-08-26 —«¿por qué dice eso? no es
        // necesario»— porque describía el mecanismo del reparto y no un hecho
        // del negocio. La regla sigue viva; lo que se fue es el cartel.
        expect(enLugar(container, 'equipo')).toContain('Regente de Salud 3');
    });

    it('la técnica queda adscrita: su superior existe, pero está en otra sucursal', () => {
        const { container } = montar();
        expect(container.textContent).toContain('También en esta sala');
        expect(enLugar(container, 'adscrito')).toEqual(['Tecnica de Servicios']);
        const adscrita = tarjetas(container).find(c => textoDe(c) === 'Tecnica de Servicios');
        expect(adscrita.textContent).toContain('Responde a Administrador');
    });

    it('dentro del equipo, la regente va ANTES que los dependientes', () => {
        // Pedido del usuario: «regente de enfermería sale después [del jefe]».
        // Después de la jefatura, sí — pero antes que el mostrador. El orden
        // sale del nivel del cargo en el árbol: Regente 3, Dependiente 5.
        const { container } = montar();
        const equipo = enLugar(container, 'equipo');
        expect(equipo.indexOf('Regente de Salud 3')).toBeLessThan(equipo.indexOf('Dependiente Tres'));
    });

    it('los dependientes siguen estando, en el equipo', () => {
        const { container } = montar();
        expect(enLugar(container, 'equipo')).toContain('Dependiente Uno');
        expect(conJefatura(container)).not.toContain('Dependiente Uno');
        expect(container.textContent).toContain('Dependiente Uno');
        expect(container.textContent).toContain('Dependiente Dos');
    });

    it('el encabezado de la sala cuenta a su gente', () => {
        const { container } = montar();
        expect(container.textContent).toContain('Salud 4');
        expect(container.textContent).toContain('5 personas');
    });

    // Con `employee_events` vacía —4 filas en toda la tabla el 2026-08-26,
    // ninguna de ausencia— la franja de estado no debe pintar nada. Una píldora
    // «Activo» repetida en cada tarjeta enseña a no mirarla, y el día que
    // aparezca la primera vacación va a pasar desapercibida entre las otras.
    it('sin eventos de ausencia no pinta ninguna franja de estado', () => {
        const { container } = montar();
        expect(container.textContent).not.toContain('En vacaciones');
        expect(container.textContent).not.toContain('Con permiso');
        expect(container.textContent).not.toContain('Activo');
    });

    it('la tarjeta de quien no está SE DISTINGUE de las demás', () => {
        // El primer intento ponía el estado como una píldora más, debajo de los
        // cargos. El usuario lo miró y dijo «no distingo que está de vacación»:
        // quedaba cuarta en una pila de píldoras, y la de arriba —«Faltan 2
        // datos»— es del mismo ámbar y del mismo tamaño. Lo que se ancla acá es
        // que la tarjeta cambie de ESTADO, no que exista el texto.
        const previo = estado.employees;
        estado.employees = [...EMPLEADOS.map(e => e.id !== 4 ? e : {
            ...e,
            history: [{ type: 'VACATION', date: '2020-01-01', metadata: { endDate: '2099-09-02' } }],
        }), ...NO_PERSONAL];
        try {
            const { container } = montar();
            const suya = tarjetas(container).find(c => textoDe(c) === 'Dependiente Uno');
            expect(suya.dataset.ausente).toBe('');
            // Sólo la suya: si todas quedaran marcadas, la marca no marcaría nada.
            expect(tarjetas(container).filter(c => c.dataset.ausente === '')).toHaveLength(1);

            // El chip del estado va ARRIBA de los cargos —«¿está?» se pregunta
            // antes que «¿qué hace?»— y es el ÚNICO relleno de la tarjeta.
            const chips = [...suya.querySelectorAll('span')].map(n => n.textContent.trim());
            const iEstado = chips.findIndex(t => t.startsWith('En vacaciones'));
            const iCargo = chips.findIndex(t => t === 'Dependiente de Farmacia');
            expect(iEstado).toBeGreaterThanOrEqual(0);
            expect(iEstado).toBeLessThan(iCargo);

            // Y la foto lleva su aro, con el estado como nombre accesible.
            expect(suya.querySelector('[data-estado="VACATION"]')).toBeTruthy();
        } finally {
            estado.employees = previo;
        }
    });

    it('una ausencia vigente se anuncia con la fecha de vuelta', () => {
        const previo = estado.employees;
        estado.employees = [...EMPLEADOS.map(e => e.id !== 4 ? e : {
            ...e,
            history: [{ type: 'VACATION', date: '2020-01-01', metadata: { endDate: '2099-09-02' } }],
        }), ...NO_PERSONAL];
        try {
            const { container } = montar();
            expect(container.textContent).toContain('En vacaciones');
            expect(container.textContent).toContain('vuelve el');
        } finally {
            estado.employees = previo;
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// La píldora de pendientes — y por qué «no lo veo» no es «no lo tiene»
//
// El DUI, el ISSS y la AFP salieron de `employees_safe` el 2026-08-24: hoy
// llegan por `get_employee_identidad`, que devuelve la fila PROPIA a quien no
// tiene `staff_detail`. Leídos crudos de la fila daban `undefined`, y la
// tarjeta lo empujaba a la lista de faltantes — o sea que el cargo que tiene el
// listado y no el expediente veía «Faltan 2 datos» sobre las 48 fichas de la
// empresa, todas con su DUI cargado.
//
// El mismo instante lo vive TODO EL MUNDO en cada recarga: `persistEmployees`
// borra esos campos del caché del disco, así que la primera pintura sale sin
// ellos y con la marca ausente.
//
// La marca `identidad_conocida` la pone el store desde la RESPUESTA —no desde
// el permiso— porque una fila que volvió con todo en `null` sí es un dato que
// falta, y ésa es exactamente la diferencia que había que poder decir.
// ═══════════════════════════════════════════════════════════════════════════
describe('Equipos por sucursal — sólo se acusa de faltar lo que se pudo mirar', () => {
    beforeEach(() => cleanup());

    // Todos los papeles del expediente cargados, para que el único pendiente
    // posible sea el que cada caso está midiendo.
    const CON_PAPELES = [
        { category: 'DUI_FRENTE',  url: 'x' },
        { category: 'DUI_REVERSO', url: 'x' },
    ];

    const conFicha = (parches) => {
        const previo = estado.employees;
        estado.employees = [
            { ...persona(1, 'Jefa de Salud 4', 19, 'Jefe/a de Sala', 44),
              employee_documents: CON_PAPELES, ...parches },
        ];
        return { previo, restaurar: () => { estado.employees = previo; } };
    };

    const pendientesDe = (container) =>
        container.querySelector('[title^="Información pendiente"]')?.getAttribute('title') ?? null;

    it('sin la marca del servidor NO acusa de que falten DUI, ISSS ni AFP', () => {
        // La fila del caché: los campos con llave se borran al persistir, así
        // que llegan vacíos y sin marca. Antes esto pintaba «Faltan 2 datos».
        const { restaurar } = conFicha({ dui: undefined, isss_number: undefined, afp_number: undefined });
        try {
            expect(pendientesDe(montar().container)).toBeNull();
        } finally { restaurar(); }
    });

    it('CON la marca del servidor, un DUI que de verdad falta sí se acusa', () => {
        // La otra mitad, y es la que hace útil a la prueba anterior: si el
        // arreglo hubiera sido «no mirar nunca el DUI», este caso pasaría a
        // callar un pendiente real y nadie lo notaría.
        const { restaurar } = conFicha({ identidad_conocida: true, dui: null, isss_number: '123456' });
        try {
            expect(pendientesDe(montar().container)).toContain('DUI');
        } finally { restaurar(); }
    });

    it('sin ISSS ni AFP, con la marca puesta, también', () => {
        const { restaurar } = conFicha({ identidad_conocida: true, dui: '00000000-0', isss_number: null, afp_number: null });
        try {
            expect(pendientesDe(montar().container)).toContain('ISSS / AFP');
        } finally { restaurar(); }
    });

    it('a un menor de edad NO se le pide DUI: se le pide su documento alterno', () => {
        // En El Salvador el DUI no se tramita hasta los 18, y el Art. 23 nº2 le
        // acepta un documento alterno. Pedírselo igual era una alerta que no se
        // podía apagar cargando el dato — el mismo defecto por otra causa.
        const hoy = new Date();
        const nacio = `${hoy.getFullYear() - 16}-01-15`;
        const { restaurar } = conFicha({
            identidad_conocida: true, birth_date: nacio, dui: null,
            alt_identity_document: 'CARNE-MINORIDAD-1', isss_number: '123456',
            employee_documents: [{ category: 'DOCUMENTO_IDENTIDAD', url: 'x' }],
        });
        try {
            expect(pendientesDe(montar().container)).toBeNull();
        } finally { restaurar(); }
    });
});
