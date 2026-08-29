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
