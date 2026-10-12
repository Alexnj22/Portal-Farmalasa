import { supabase } from '../supabaseClient';
import { anotar } from './audit';

/**
 * Horario real de las salas y los mensajes automáticos del chat (2026-10-12).
 *
 * El horario de una sala en una fecha lo decide la base (`horario_de_sala`):
 * un horario ESPECIAL cargado para ese día > si es feriado, el horario de
 * DOMINGO de la sala > el día de la semana de `weekly_hours`. El chat de la
 * app pregunta `farmacia_estado()` y con eso elige cuál de los dos mensajes de
 * `app_chat_ajustes` manda.
 *
 * Ninguna lectura se acerca a 1000 filas: los ajustes son una sola fila, los
 * horarios especiales de una sala se piden desde hoy con tope de 200, y los
 * feriados nacionales son ~30 (tope 500).
 */

const sinError = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// ── Estado de la farmacia ───────────────────────────────────────────────────

/** `{ abierta, cierra 'HH:MI'|null, abre 'YYYY-MM-DDTHH:MI'|null, feriado|null }` */
export async function fetchFarmaciaEstado() {
    return sinError(await supabase.rpc('farmacia_estado'));
}

// ── Mensajes automáticos del chat ───────────────────────────────────────────

export async function fetchAjustesDelChat() {
    return sinError(await supabase.from('app_chat_ajustes')
        .select('mensaje_abierto, mensaje_cerrado, updated_by, updated_at')
        .eq('id', true)
        .maybeSingle());
}

/**
 * Guarda los dos mensajes. `employeeId` es la FICHA de quien edita: la policy
 * exige `updated_by = auth_employee_id()`. Sin permiso la policy no lanza —
 * devuelve cero filas—, así que eso se convierte en un error explícito.
 */
export async function guardarAjustesDelChat({ mensajeAbierto, mensajeCerrado, employeeId }) {
    const abierto = String(mensajeAbierto || '').trim();
    const cerrado = String(mensajeCerrado || '').trim();
    const filas = sinError(await supabase.from('app_chat_ajustes')
        .update({ mensaje_abierto: abierto, mensaje_cerrado: cerrado, updated_by: employeeId, updated_at: new Date().toISOString() })
        .eq('id', true)
        .select('mensaje_abierto, mensaje_cerrado, updated_by, updated_at'));
    if (!filas?.length) throw new Error('No se guardó: no tienes permiso para editar los mensajes del chat.');
    anotar('CHAT_AJUSTES_MENSAJES', 'app_chat_ajustes', { largo_abierto: abierto.length, largo_cerrado: cerrado.length });
    return filas[0];
}

// ── Horarios especiales por sala ────────────────────────────────────────────

/** Los horarios especiales de una sala desde `desde` (YYYY-MM-DD), el más próximo primero. */
export async function fetchHorariosEspeciales(branchId, desde) {
    return sinError(await supabase.from('sucursal_horario_especial')
        .select('id, branch_id, fecha, cerrada, abre, cierra, motivo, creado_por, created_at')
        .eq('branch_id', Number(branchId))
        .gte('fecha', desde)
        .order('fecha', { ascending: true })
        .limit(200)) ?? [];
}

const COLUMNAS_ESPECIAL = 'id, branch_id, fecha, cerrada, abre, cierra, motivo, creado_por, created_at';

/**
 * Carga (o reemplaza) el horario de UN día de una sala. Es único por
 * (sala, fecha): si ya había uno se ACTUALIZA esa fila —nunca borrar y volver a
 * insertar: si el insert fallara, el día se quedaría sin el horario que tenía—.
 * Al insertar, la policy exige que `creado_por` sea quien lo carga.
 */
export async function guardarHorarioEspecial({ branchId, fecha, cerrada, abre, cierra, motivo, employeeId }) {
    const fila = {
        branch_id: Number(branchId),
        fecha,
        cerrada: !!cerrada,
        abre: cerrada ? null : abre,
        cierra: cerrada ? null : cierra,
        motivo: String(motivo || '').trim().slice(0, 120) || null,
    };
    const previa = sinError(await supabase.from('sucursal_horario_especial')
        .select('id').eq('branch_id', fila.branch_id).eq('fecha', fecha).maybeSingle());
    const creada = previa
        ? sinError(await supabase.from('sucursal_horario_especial')
            .update(fila).eq('id', previa.id).select(COLUMNAS_ESPECIAL).maybeSingle())
        : sinError(await supabase.from('sucursal_horario_especial')
            .insert({ ...fila, creado_por: employeeId }).select(COLUMNAS_ESPECIAL).single());
    if (!creada) throw new Error('No se guardó: no tienes permiso para editar horarios de sucursales.');
    anotar('SUCURSAL_HORARIO_ESPECIAL_GUARDAR', String(fila.branch_id),
        { fecha, cerrada: fila.cerrada, abre: fila.abre, cierra: fila.cierra, motivo: fila.motivo });
    return creada;
}

export async function borrarHorarioEspecial({ id, branchId, fecha }) {
    const filas = sinError(await supabase.from('sucursal_horario_especial')
        .delete().eq('id', Number(id)).select('id'));
    if (!filas?.length) throw new Error('No se borró: no tienes permiso para editar horarios de sucursales.');
    anotar('SUCURSAL_HORARIO_ESPECIAL_BORRAR', String(branchId), { fecha });
}

// ── Feriados ────────────────────────────────────────────────────────────────

/** Los feriados nacionales (sin municipio). Son ~30 filas; los recurrentes se ubican en `proximosFeriados`. */
export async function fetchFeriadosNacionales() {
    return sinError(await supabase.from('holidays')
        .select('holiday_date, name, is_recurring, municipality')
        .is('municipality', null)
        .order('holiday_date', { ascending: true })
        .limit(500)) ?? [];
}
