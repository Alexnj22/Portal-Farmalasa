import useMediaQuery from '../../hooks/useMediaQuery';

// El corte y la resolución de la fila abierta viven fuera del componente porque
// la regla de fast-refresh pide que un archivo de componente exporte sólo
// componentes — el mismo motivo por el que `estadoDialogo` y `arrastreHoja` ya
// son módulos aparte. Ver `ExpedienteMovil.jsx` para qué resuelven y por qué.

// El MISMO corte que `DataTable` usa para decidir ficha o tabla. Está acá y no
// como número suelto en cada vista justamente para que no puedan divergir.
export const CORTE_TELEFONO = '(max-width: 1023.98px)';

/**
 * Resuelve si estamos en el teléfono y cuál es la fila abierta.
 *
 * `filas` es la lista ya cargada y `abiertoId` el estado que la vista ya tiene
 * para expandir: no hace falta estado nuevo ni una consulta aparte, porque el
 * expediente muestra la misma fila que la expansión de escritorio.
 */
export function useExpedienteMovil(filas, abiertoId, campoId = 'id') {
    const enTelefono = useMediaQuery(CORTE_TELEFONO);
    const abierto = enTelefono && abiertoId != null
        ? (filas || []).find(f => f?.[campoId] === abiertoId) || null
        : null;
    return { enTelefono, abierto };
}
