// En qué punto está una conversación, DERIVADO de lo que la bandeja ya trae
// (no hay columna de estado en la base más allá de abierta/resuelta). Módulo
// sin componentes, por el fast refresh.
//
// El orden de las preguntas es la regla:
//   1. resuelta                      → «Resuelta»
//   2. lo último lo escribió el equipo → «Esperando al cliente» (la pelota
//      está del otro lado, aunque quien contestó la siga teniendo tomada)
//   3. alguien la tiene tomada         → «En atención · <nombre>»
//   4. lo demás —el cliente escribió y nadie la tiene— → «Nuevo»
//
// «Nuevo» incluye la que alguien abrió y soltó SIN contestar: el contador de
// sin leer quedó en cero, pero el cliente sigue esperando una respuesta.

export const ESTADOS = {
    nuevo:     { label: 'Nuevo',                variant: 'info' },
    atencion:  { label: 'En atención',          variant: 'chart-6' },
    esperando: { label: 'Esperando al cliente', variant: 'neutral' },
    resuelta:  { label: 'Resuelta',             variant: 'success' },
};

export function estadoDeConversacion(c) {
    if (c?.estado === 'resuelta') return 'resuelta';
    if (c?.ultimo_de === 'equipo') return 'esperando';
    if (c?.tomada_vigente) return 'atencion';
    return 'nuevo';
}

// Los umbrales de la espera: ámbar a los 15 minutos, rojo a la hora.
const AMBAR_MIN = 15;
const ROJO_MIN = 60;

/**
 * Cuánto lleva esperando un «Nuevo», desde su último mensaje. `null` para los
 * otros estados. `tono`: 'neutral' | 'warning' | 'danger' (variantes de Badge).
 */
export function esperaDe(c, ahora) {
    if (estadoDeConversacion(c) !== 'nuevo') return null;
    const desde = Date.parse(c?.ultimo_mensaje_at);
    if (Number.isNaN(desde)) return null;
    const min = Math.max(0, Math.floor((ahora - desde) / 60_000));
    const label = min < 1 ? 'ahora'
        : min < 60 ? `${min} min`
        : min < 24 * 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`
        : `${Math.floor(min / (24 * 60))} d`;
    return { min, label, tono: min > ROJO_MIN ? 'danger' : min > AMBAR_MIN ? 'warning' : 'neutral' };
}

/** Las pestañas de la vista (y los chips del panel): `filtro` → qué estados entran. */
export const FILTROS = {
    abierta:   { label: 'Todas abiertas',       estados: ['nuevo', 'atencion', 'esperando'] },
    nuevo:     { label: 'Nuevas',               estados: ['nuevo'] },
    atencion:  { label: 'En atención',          estados: ['atencion'] },
    esperando: { label: 'Esperando al cliente', estados: ['esperando'] },
    resuelta:  { label: 'Resueltas',            estados: ['resuelta'] },
};

/** El estado que se le pide a la base para ese filtro. */
export const estadoServidor = (filtro) => (filtro === 'resuelta' ? 'resuelta' : 'abierta');
