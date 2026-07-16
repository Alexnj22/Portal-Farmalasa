// Cola local de marcajes de asistencia (bloque 7B.8, Fase B). Cuando el
// kiosco no tiene conexión (o el insert falla por cualquier razón de red),
// el marcaje se guarda acá en vez de perderse — se reintenta cuando vuelve
// la conexión, llamando de nuevo a registerAttendance (mismo camino que un
// marcaje normal, con toda su lógica de auditoría/estado local intacta).
// localStorage alcanza de sobra: el volumen real de marcajes por kiosco es
// bajo (decenas al día), no justifica IndexedDB/workbox.

const QUEUE_KEY = 'kiosk_attendance_queue';

function readQueue() {
    try {
        const raw = localStorage.getItem(QUEUE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function writeQueue(queue) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* localStorage lleno o no disponible */ }
}

export function enqueueAttendancePunch({ employeeId, type, metadata }) {
    const queue = readQueue();
    queue.push({
        id: `${employeeId}-${type}-${Date.now()}`,
        employeeId,
        type,
        metadata: metadata || null,
        queuedAt: new Date().toISOString(),
    });
    writeQueue(queue);
}

export function getAttendanceQueueSize() {
    return readQueue().length;
}

// Procesa la cola EN ORDEN (importa la secuencia cronológica de un empleado:
// IN antes que OUT, etc.) — se detiene en el primer fallo y deja el resto
// en cola para el próximo intento, en vez de reordenar o saltarse items.
export async function flushAttendanceQueue(registerAttendanceFn) {
    const queue = readQueue();
    if (queue.length === 0) return { synced: 0, remaining: 0 };

    let synced = 0;
    const remaining = [...queue];
    while (remaining.length > 0) {
        const item = remaining[0];
        try {
            await registerAttendanceFn(item.employeeId, item.type, item.metadata);
            remaining.shift();
            synced++;
        } catch {
            break; // sigue sin conexión (u otro error) — reintentar más tarde
        }
    }
    writeQueue(remaining);
    return { synced, remaining: remaining.length };
}
