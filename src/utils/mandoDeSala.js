// ── Quién manda en una sala, y quién responde a quién ───────────────────────
//
// Sale del árbol `roles.parent_role_id` y NUNCA de leer el texto del cargo. El
// listado de personal lo hace al revés (`r.includes('JEFE')`, `r.includes(
// 'REGENTE')`, un peso escrito a mano), y ese es el defecto que ya costó los
// `role_id: null` del 2026-08-12: «un rótulo no es una clave» (CLAUDE.md).
//
// ── Las tres reglas, y de dónde salen ──────────────────────────────────────
//
// Las corrigió el usuario el 2026-08-26 mirando el primer boceto, que
// destacaba a TODO el que responde fuera de la sala. Salud 4 salía con tres
// jefes —la Jefa de Sala, la Regente de Enfermería y la Técnica de
// Mantenimiento— y la técnica aparecía PRIMERA, porque su cargo cuelga del
// Administrador (nivel 2) y el de la jefa del Supervisor de Ventas (nivel 3).
// O sea: el árbol formal, leído crudo, coronaba a quien la sala no reconoce
// como jefe. La sala tiene UNA jefatura.
//
//   1. El jefe de la sala es quien más gente de ESA sala tiene colgando de su
//      cargo. No el de nivel más alto: Mantenimiento está más arriba en el
//      organigrama y no manda a nadie ahí.
//
//   2. Un cargo cuyo superior está VACANTE en toda la empresa responde a la
//      jefatura de la sala. Palabras del usuario: «mientras no haya un
//      supervisor del departamento médico, [la regente de enfermería] queda
//      bajo el jefe de sala». Vale igual para el Auxiliar de Bodega, que
//      cuelga de un Asistente de Logística que hoy no existe. Es una regla
//      sobre el DATO —el puesto está vacío— y no sobre esos dos cargos.
//
//   3. El resto —superior real, pero fuera de la sala— está adscrito: trabaja
//      ahí y responde a otro. Es el caso de Mantenimiento, y el que hace
//      falta para no mentir sobre quién lo dirige.
//
// El segundo puesto se busca entre los HIJOS DIRECTOS del cargo del jefe, y
// cuando en la sala no lo ocupa nadie, el hueco SE MUESTRA. Pedido del
// usuario, dos veces: primero «si no hay subjefe, que aparezca el espacio
// pendiente», y después —al ver que Bodega no lo mostraba— «asistente de
// logística es como subjefe, dejalo como pendiente».
//
// La primera versión pedía además que ese cargo estuviera ocupado en OTRA
// parte de la empresa, con el argumento de que un puesto que nadie ocupa en
// ningún lado no es una vacante sino un puesto en desuso. El usuario lo
// corrigió: en Bodega el Asistente de Logística **sí** es el segundo, y que
// esté vacío en las ocho salas no lo vuelve menos pendiente — lo vuelve MÁS
// pendiente. Un filtro que esconde el hueco justo cuando es total es un filtro
// que apaga la alarma más fuerte.
//
// ── Y por eso la ocupación se pregunta sobre la PLANTILLA, no sobre lo que se
// dibuja ────────────────────────────────────────────────────────────────────
// Las fichas que no son personal —el Contador Externo, las cuentas del
// sistema— no salen en los equipos, y si la ocupación se midiera sobre lo
// dibujado, Administración anunciaría «Contador Externo: puesto sin cubrir»
// sobre un puesto que está cubierto y sólo no se muestra. La lista completa
// contesta «¿alguien lo ocupa?» y la visible contesta «¿a quién dibujo?». Son
// dos preguntas distintas y confundirlas inventa una vacante.

import { cadenaDeSuperiores, nivelDeCargo } from './roles';

/** Los cargos de una persona: el principal y el secundario, como números. */
export function cargosDe(emp) {
    return [emp?.role_id, emp?.secondary_role_id]
        .filter(v => v != null)
        .map(Number)
        .filter(n => !Number.isNaN(n));
}

/**
 * El rango con el que se ORDENA, que sale del cargo principal.
 *
 * A propósito no es el mínimo de los dos: el cargo secundario también sirve
 * para permisos —«Sistema — Alertas Técnicas» es una raíz del árbol— y tomarlo
 * en cuenta subiría al tope de su sala a quien sólo recibe unos avisos.
 */
export function rangoDe(roles, emp) {
    const principal = nivelDeCargo(roles, emp?.role_id);
    if (principal != null) return principal;
    const secundario = nivelDeCargo(roles, emp?.secondary_role_id);
    // Un cargo que no está en la tabla va al final: no es la raíz de la
    // empresa, y darle 0 lo coronaría por accidente.
    return secundario == null ? 99 : secundario;
}

const porNombre = (a, b) => String(a?.name || '').localeCompare(String(b?.name || ''));

/**
 * Reparte a la gente de UNA sala en jefatura, segundos, equipo y adscritos.
 *
 * `personas` son las que se van a DIBUJAR. `todos` es la plantilla completa
 * —incluidas las fichas que no son personal— y sólo se usa para contestar
 * quién ocupa qué cargo: en la sala y en la empresa. Ver la nota de arriba
 * sobre por qué esas dos preguntas no se pueden mezclar.
 */
export function repartirSala({ personas, todos, roles, sucursalId }) {
    const mismaSala = (p) => sucursalId == null ||
        String(p?.branchId ?? p?.branch_id ?? '') === String(sucursalId);
    const enLaSala = (todos || []).filter(mismaSala);

    const cargosEnLaSala = new Set(
        (enLaSala.length ? enLaSala : personas).flatMap(cargosDe).map(String));
    const cargosEnLaEmpresa = new Set((todos || []).flatMap(cargosDe).map(String));

    // Cuánta gente de la sala cuelga de este cargo. El `!== cargo` evita que
    // un ciclo del árbol —nada en la base lo impide— haga que un cargo se
    // cuente como subordinado de sí mismo.
    const cuantosCuelgan = (cargo) => personas.filter(p =>
        cargosDe(p).some(c => c !== cargo && cadenaDeSuperiores(roles, c).includes(cargo))
    ).length;

    let jefe = null;
    let cargoDelJefe = null;
    let mayor = 0;
    personas.forEach(p => {
        cargosDe(p).forEach(c => {
            const cuantos = cuantosCuelgan(c);
            if (cuantos <= 0 || cuantos < mayor) return;
            // Empate: gana el de rango más alto, y si también empatan, el orden
            // alfabético — para que la pantalla no cambie de jefe entre dos
            // recargas por el orden en que vino la lista.
            if (cuantos === mayor) {
                const rangoActual = rangoDe(roles, jefe);
                const rangoNuevo = rangoDe(roles, p);
                if (rangoNuevo > rangoActual) return;
                if (rangoNuevo === rangoActual && porNombre(p, jefe) >= 0) return;
            }
            mayor = cuantos;
            jefe = p;
            cargoDelJefe = c;
        });
    });

    const hijosDirectos = cargoDelJefe == null ? [] : (roles || [])
        .filter(r => Number(r?.parent_role_id) === Number(cargoDelJefe))
        .map(r => Number(r.id));

    const resto = personas.filter(p => p !== jefe);
    const segundos = resto.filter(p => cargosDe(p).some(c => hijosDirectos.includes(c)));

    // El hueco del segundo puesto: el hijo directo que en ESTA sala no ocupa
    // nadie. Que tampoco lo ocupe nadie en el resto de la empresa no lo
    // descarta — al revés.
    const vacantesDeSegundo = hijosDirectos
        .filter(c => !cargosEnLaSala.has(String(c)))
        .map(c => (roles || []).find(r => Number(r.id) === c))
        .filter(Boolean);

    const equipo = [];
    const adscritos = [];
    resto.filter(p => !segundos.includes(p)).forEach(p => {
        const cuelgaDeLaSala = cargosDe(p).some(c =>
            cadenaDeSuperiores(roles, c).some(sup => cargosEnLaSala.has(String(sup))));
        // Regla 2: el superior INMEDIATO no lo ocupa nadie en toda la empresa.
        const superiorVacante = cargosDe(p).some(c => {
            const [padre] = cadenaDeSuperiores(roles, c);
            return padre != null && !cargosEnLaEmpresa.has(String(padre));
        });
        (cuelgaDeLaSala || superiorVacante ? equipo : adscritos).push(p);
    });

    const porRango = (a, b) => {
        const ra = rangoDe(roles, a);
        const rb = rangoDe(roles, b);
        return ra !== rb ? ra - rb : porNombre(a, b);
    };

    return {
        jefe,
        cargoDelJefe,
        segundos: segundos.sort(porRango),
        vacantesDeSegundo,
        equipo: equipo.sort(porRango),
        adscritos: adscritos.sort(porRango),
    };
}

/**
 * Los puestos intermedios que no ocupa nadie y por eso dejan gente colgando de
 * la jefatura de sala. Es la regla 2 dicha una vez y para toda la empresa, en
 * vez de repetir la explicación en cada tarjeta.
 */
export function puestosVacantesConGente({ todos, roles }) {
    const ocupados = new Set((todos || []).flatMap(cargosDe).map(String));
    const cuenta = new Map();

    (todos || []).forEach(p => {
        cargosDe(p).forEach(c => {
            const [padre] = cadenaDeSuperiores(roles, c);
            if (padre == null || ocupados.has(String(padre))) return;
            cuenta.set(padre, (cuenta.get(padre) || 0) + 1);
        });
    });

    return [...cuenta.entries()]
        .map(([id, personas]) => ({
            id,
            nombre: (roles || []).find(r => Number(r.id) === Number(id))?.name || null,
            personas,
        }))
        .filter(v => v.nombre)
        .sort((a, b) => b.personas - a.personas);
}
