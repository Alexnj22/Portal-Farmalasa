// Cola local de marcajes de asistencia. Cuando el kiosco no tiene conexión, el
// marcaje se guarda acá en vez de perderse — se reintenta cuando la conexión
// vuelve. localStorage alcanza de sobra: el volumen real por kiosco es de
// decenas al día, no justifica IndexedDB.
//
// Dos correcciones de la auditoría 2026-08-16:
//
//   1. **Se guarda CUÁNDO ocurrió el marcaje, y esa hora es la que se manda.**
//      Antes el reintento llamaba a `registerAttendance`, que hace
//      `new Date().toISOString()` al insertar: un marcaje encolado a las 8 de
//      la mañana y recuperado a las 3 de la tarde entraba a planilla como si
//      la persona hubiera llegado a las 3.
//   2. **Un rechazo del servidor descarta el item; sólo un fallo de red lo
//      conserva.** Antes cualquier error cortaba el barrido y dejaba el item
//      al frente para siempre. Como la causa real del fallo era una policy que
//      rechazaba SIEMPRE, la cola quedaba trabada de por vida en el primer
//      marcaje, y la pantalla decía «se sincronizará solo».

const QUEUE_KEY = 'kiosk_attendance_queue';
// Más viejo que esto, el servidor lo rechaza (`KIOSK_MOMENTO_DEMASIADO_VIEJO`):
// un marcaje de hace más de un día lo corrige Talento Humano, no un reintento.
const MAX_EDAD_MS = 24 * 60 * 60 * 1000;

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

export function enqueueAttendancePunch({ employeeId, type, metadata, ocurridoEn = null }) {
    const queue = readQueue();
    queue.push({
        id: `${employeeId}-${type}-${Date.now()}`,
        employeeId,
        type,
        metadata: metadata || null,
        // `ocurridoEn` es la hora REAL del marcaje. `queuedAt` se conserva por
        // compatibilidad con lo que haya quedado en cola de una versión previa.
        ocurridoEn: ocurridoEn || new Date().toISOString(),
        queuedAt: new Date().toISOString(),
    });
    writeQueue(queue);
}

export function contarMarcajesEnCola() {
    return readQueue().length;
}

// Procesa la cola EN ORDEN: importa la secuencia cronológica de cada persona
// (la entrada antes que la salida). `enviar` recibe el item y devuelve
// `{ ok, networkError }` — se detiene en el primer fallo de RED y descarta los
// items que el servidor rechaza o que ya están vencidos.
export async function flushAttendanceQueue(enviar) {
    const queue = readQueue();
    if (queue.length === 0) return { synced: 0, descartados: 0, remaining: 0 };

    let synced = 0;
    let descartados = 0;
    const remaining = [...queue];

    while (remaining.length > 0) {
        const item = remaining[0];
        const ocurridoEn = item.ocurridoEn || item.queuedAt;
        const edad = Date.now() - Date.parse(ocurridoEn || '');

        if (!Number.isFinite(edad) || edad > MAX_EDAD_MS) {
            console.warn('kiosco: marcaje en cola vencido, se descarta —', item.id, ocurridoEn);
            remaining.shift();
            descartados++;
            continue;
        }

        let resultado;
        try {
            resultado = await enviar({ ...item, ocurridoEn });
        } catch {
            break; // fallo inesperado: se reintenta más tarde
        }

        if (resultado?.ok) {
            remaining.shift();
            synced++;
        } else if (resultado?.networkError) {
            break; // sigue sin conexión
        } else {
            // El servidor contestó que no (duplicado, empleado fuera de la
            // sucursal, tipo inválido…). Reintentarlo daría lo mismo siempre.
            console.warn('kiosco: el servidor rechazó un marcaje en cola, se descarta —', item.id, resultado?.motivo);
            remaining.shift();
            descartados++;
        }
    }

    writeQueue(remaining);
    return { synced, descartados, remaining: remaining.length };
}
