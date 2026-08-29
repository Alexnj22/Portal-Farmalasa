import { supabase } from '../supabaseClient';

// Lo que no llegó en la bolsa.
//
// ── Qué es un faltante acá ─────────────────────────────────────────────────
// Una DECLARACIÓN, no una corrección. Cuando alguien abre una bolsa y encuentra
// de menos, el movimiento ya pasó: en una solicitud el sistema le puso el
// producto a la sala, y en un envío el renglón salió del estante de la otra.
// Esto no mueve existencias — sólo deja constancia de que faltó, con nombre,
// cantidad, quién lo vio y cuándo, y le avisa el mismo día a la sala que lo
// despachó y a supervisión.
//
// Antes no había dónde decirlo, y las dos salidas que existían mentían: aceptar
// mete al inventario algo que no está en el estante, y devolver crea el
// movimiento de vuelta de algo que nunca llegó.
//
// ── Por qué no se escribe desde acá ────────────────────────────────────────
// Un faltante se declara al RECIBIR —dentro de la función que recibe, que es la
// que sabe si quien lo dice es la sala que tiene la caja— y no con un insert
// del navegador. Este archivo sólo lee la lista y cierra lo que ya se resolvió.

/**
 * Los faltantes que hay que mirar: todo lo abierto, más lo cerrado del último
 * mes para poder mirar atrás sin ir al historial.
 *
 * La función es INVOKER, así que el RLS decide qué salas ve cada quien — el
 * mismo que decide qué traslados se ven.
 */
export async function fetchFaltantes() {
    const { data, error } = await supabase.rpc('get_faltantes_de_bolsa');
    return { faltantes: data ?? [], error };
}

/**
 * Declararlo DESPUÉS de haber recibido la bolsa, dentro del plazo.
 *
 * El camino normal es al recibir: ahí se cuenta la caja. Pero el caso real es
 * el otro —se aprieta «ya llegó» y se cuenta diez minutos después— y sin esta
 * puerta el hueco volvía a ser invisible, que es justo lo que el circuito vino
 * a cerrar.
 *
 * **Con plazo (48 h), y lo decide la base.** Un faltante se declara para que
 * alguien vaya a BUSCAR la caja: la sala de origen mira su mostrador, quien
 * hizo el recorrido revisa lo que lleva. Pasados unos días eso ya no se puede
 * hacer y lo que queda es un reclamo sin caja. La pantalla no repite el número:
 * si se pasó, el servidor contesta `FUERA_DE_PLAZO` con cuánto hace.
 *
 * Quién firma sale de `auth_employee_id()` adentro de la función, nunca de un
 * parámetro — igual que el resto de las escrituras del portal.
 */
export async function declararFaltanteTardio(requestId, faltantes) {
    const { data, error } = await supabase.rpc('declarar_faltante_tardio', {
        p_request_id: requestId,
        p_faltantes: faltantes,
    });
    if (error) return { ok: false, error: error.message };
    if (data?.ok === false) return { ok: false, error: data.error, codigo: data.codigo };
    return { ok: true, declarados: data?.declarados ?? 0 };
}

/** Cuántas horas hay para declararlo después. Espejo de `declarar_faltante_tardio`. */
export const HORAS_PARA_DECLARAR_TARDE = 48;

/**
 * Los dos finales de un faltante, y no hay un tercero.
 *
 * `aparecio` es la bolsa que estaba en el mostrador de al lado. `no_aparecio`
 * es el que hay que resolver de otra forma —reponerlo, ajustarlo, reclamarlo—,
 * y por eso **exige que se escriba qué se hizo**: es el renglón que alguien va
 * a tener que leer dentro de un mes.
 */
export const CIERRES_DE_FALTANTE = [
    { valor: 'aparecio',    rotulo: 'Apareció' },
    { valor: 'no_aparecio', rotulo: 'No apareció' },
];

/**
 * Cierra un faltante. Nunca lanza: devuelve `{ ok, error }`.
 *
 * Quién firma lo resuelve la base con `auth_employee_id()`, igual que las
 * policies: un parámetro no puede decidir con el nombre de quién se cierra.
 */
export async function cerrarFaltante(id, estado, nota = '') {
    const { data, error } = await supabase.rpc('cerrar_faltante', {
        p_id: id,
        p_estado: estado,
        p_nota: nota?.trim() || null,
    });
    if (error) return { ok: false, error: error.message };
    // `YA_CERRADO` no es un fallo del portal: alguien más lo cerró entre que se
    // pintó la lista y se apretó el botón. Se dice como lo que es.
    if (data?.codigo === 'YA_CERRADO') {
        return { ok: false, error: 'Alguien ya lo había cerrado.', codigo: 'YA_CERRADO' };
    }
    return { ok: data?.ok === true, error: data?.ok ? null : 'No se pudo cerrar.' };
}
