/**
 * Mantenimiento — los frenos del movimiento de mercadería y lo que le queda a
 * un candado de módulo. Vivía en `MaintenanceView`; se mudó el 2026-10-05 para
 * que la app diga lo mismo.
 */

// Los cuatro interruptores de movimiento de mercadería, con su nombre en
// palabras del negocio. Es un mapa y no un ternario porque ya son cuatro: el
// ternario que había pintaba «Recibir en la sala» sobre cualquier acción que no
// fuera `enviar`, así que los dos de devolución habrían salido con el rótulo del
// otro proceso — y quien lea la pantalla no tiene cómo saber que está mintiendo.
export const INTERRUPTOR = {
    enviar: {
        titulo:  'Sacar mercadería de bodega',
        detalle: 'Al finalizar un pedido, la mercadería sale sola.',
        pausa:   'No va a salir mercadería hasta que lo reanudes.',
        reanuda: 'La mercadería vuelve a salir al finalizar un pedido.',
    },
    recibir: {
        titulo:  'Recibir en la sala',
        detalle: 'Al confirmar una caja, la mercadería entra sola.',
        pausa:   'No se va a poder recibir hasta que lo reanudes.',
        reanuda: 'Las salas ya pueden recibir.',
    },
    devolver_enviar: {
        titulo:  'Sacar una devolución de la sala',
        detalle: 'Cuando bodega acepta una devolución, el producto sale de la sala.',
        pausa:   'Las devoluciones aceptadas no van a salir de la sala.',
        reanuda: 'Las devoluciones aceptadas vuelven a salir.',
    },
    devolver_recibir: {
        titulo:  'Recibir una devolución en bodega',
        detalle: 'Bodega confirma la entrada de lo que la sala devolvió.',
        pausa:   'Lo devuelto no va a poder entrar a bodega: queda en el camino.',
        reanuda: 'Bodega ya puede confirmar lo devuelto.',
    },
    // El sobrante: la sala recibió de más y se acordó que bodega le mande esa
    // unidad. Nacieron en pausa el 2026-08-18 con el motivo «Sin estrenar»
    // porque ese brazo todavía no está construido, y hasta hoy salían a
    // pantalla con su llave de base de datos —`sobrante_enviar`— por no estar
    // en este mapa.
    sobrante_enviar: {
        titulo:  'Mandar el sobrante a la sala',
        detalle: 'Cuando se acuerda un sobrante, bodega manda la unidad.',
        pausa:   'Los sobrantes acordados no van a salir de bodega.',
        reanuda: 'Bodega vuelve a mandar los sobrantes acordados.',
    },
    sobrante_recibir: {
        titulo:  'Recibir el sobrante en la sala',
        detalle: 'La sala confirma la entrada de la unidad que le mandaron.',
        pausa:   'El sobrante no va a poder entrar a la sala: queda en el camino.',
        reanuda: 'Las salas ya pueden recibir el sobrante.',
    },
    // «No reenviar» de Pedidos (2026-09-17): anula el traslado de una caja
    // especial que no llegó y el producto regresa a Bodega. Nació en el CHECK
    // de `traslado_interruptor` sin entrar a este mapa, y por eso salía como
    // «Movimiento sin nombre» hasta el 2026-10-05.
    anular: {
        titulo:  'Anular una caja que no llegó',
        detalle: 'Cuando bodega decide no reenviar una caja especial, su traslado se anula y el producto vuelve a bodega.',
        pausa:   'No se van a poder anular cajas que no llegaron: quedan pendientes.',
        reanuda: 'Bodega ya puede anular las cajas que no va a reenviar.',
    },
};

// Un interruptor que no está en el mapa es un olvido de quien lo agregó, no un
// caso a soportar: el CHECK de `traslado_interruptor` enumera las acciones, así
// que sumar una y no nombrarla acá deja su LLAVE en pantalla. Pasó con los dos
// del sobrante, que estuvieron tres días diciendo `sobrante_enviar` a quien
// abriera Mantenimiento. La red es un rótulo neutro —nunca la llave cruda, que
// no le dice nada a quien lee— y un aviso que igual se entiende.
export const SIN_NOMBRE = {
    titulo:  'Movimiento sin nombre',
    detalle: 'Este freno todavía no tiene nombre en esta pantalla.',
    pausa:   'Quedó en pausa.',
    reanuda: 'Volvió a andar.',
};

export const rotuloDeInterruptor = (accion) => INTERRUPTOR[accion] ?? SIN_NOMBRE;


/** Lo que le falta a un candado: «faltan 28 min», «faltan 3 h 5 min» o «vencido». */
export function tiempoRestante(expiresAt, ahora = Date.now()) {
    const ms = new Date(expiresAt) - ahora;
    if (ms <= 0) return 'vencido';
    const min = Math.floor(ms / 60000);
    if (min < 60) return `faltan ${min} min`;
    return `faltan ${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Cuántas horas dura un candado (redondeado, al menos 1), como texto para el selector. */
export const horasDelCandado = (lock) =>
    String(Math.max(1, Math.round((new Date(lock.expires_at) - new Date(lock.locked_at)) / 3600_000)));

/** Cuánto puede durar un candado: las mismas opciones en el portal y en la app. */
export const HORAS_DE_CANDADO = [1, 2, 4, 8, 12, 24].map((h) => ({ value: String(h), label: h === 1 ? '1 hora' : `${h} horas` }));
