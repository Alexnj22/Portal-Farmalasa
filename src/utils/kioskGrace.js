// Ventana de gracia de autorización del kiosco.
//
// Reemplaza a `kiosk_supervisor_pins`, el caché de localStorage que guardaba
// los PIN de los supervisores EN CLARO en el disco de cada tablet para que la
// autorización siguiera funcionando sin conexión.
//
// Acá NO se guarda material de la credencial: solo el id del empleado y la
// fecha de su última autorización verificada CONTRA EL SERVIDOR. Con eso, una
// caída de internet no bloquea a quien ya se autorizó en ese kiosco hace poco,
// y el que nunca lo hizo cae al camino PENDIENTE en vez de ser aceptado a
// ciegas — que es la decisión que se tomó en la auditoría del 2026-07-29.
//
// Un atacante que lea este localStorage obtiene una lista de ids y fechas.
// Antes obtenía las credenciales.

const GRACE_KEY  = 'kiosk_auth_grace';
const GRACE_DAYS = 7;

function readGrace() {
    try {
        const raw = localStorage.getItem(GRACE_KEY);
        const obj = raw ? JSON.parse(raw) : {};
        return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch {
        return {};
    }
}

// Registra que este empleado se autorizó con éxito contra el servidor en este
// dispositivo. Se llama SOLO tras un ok real del RPC, nunca tras un camino
// offline — si no, la ventana se auto-renovaría sin verificación.
export function recordKioskVerification(employeeId) {
    if (!employeeId) return;
    const grace = readGrace();
    grace[employeeId] = new Date().toISOString();

    // Poda: no dejar crecer el objeto con gente que ya no trabaja acá.
    const cutoff = Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000;
    for (const [id, iso] of Object.entries(grace)) {
        const t = Date.parse(iso);
        if (!Number.isFinite(t) || t < cutoff) delete grace[id];
    }

    try { localStorage.setItem(GRACE_KEY, JSON.stringify(grace)); } catch { /* localStorage lleno */ }
}

// ¿Este empleado se autorizó en este kiosco dentro de la ventana? Solo se
// consulta cuando NO hay conexión.
export function hasRecentKioskVerification(employeeId, days = GRACE_DAYS) {
    if (!employeeId) return false;
    const iso = readGrace()[employeeId];
    if (!iso) return false;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return false;
    return t >= Date.now() - days * 24 * 60 * 60 * 1000;
}

// Se llama al desvincular el dispositivo: la ventana de gracia es propiedad
// del kiosco, no del navegador.
export function clearKioskGrace() {
    try { localStorage.removeItem(GRACE_KEY); } catch { /* no disponible */ }
}
