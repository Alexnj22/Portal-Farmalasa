/**
 * El monto que se deja escribir, topeado a lo máximo que se permite.
 *
 * ── LA REGLA (usuario, 2026-09-29) ─────────────────────────────────────────
 * En todo campo de DINERO que tiene un máximo conocido —lo que se debe, lo que
 * queda por explicar, el saldo de alguien—, escribir de más NO bloquea: el
 * campo se lleva al máximo. «Que no permita ingresar un monto mayor al
 * permitido no tiene sentido. Si se escribe un valor mayor, que se ponga el
 * max permitido.»
 *
 * Nació en Cuentas por Cobrar el 3-sep («en el input de monto no permita
 * ingresar una cantidad mayor a la de la deuda pendiente») y se volvió la
 * regla de todo el portal el 29-sep, al repetirse en la causa de una
 * diferencia de caja.
 *
 * Se TOPEA y no se borra la tecla: quien escribe 100 sobre una deuda de 47.50
 * ve 47.50. Un campo que se queda mudo al teclear se lee como un teclado que
 * no anda, y uno que deja escribir de más y después traba el botón obliga a
 * adivinar el número exacto.
 *
 * Devuelve también si topeó, porque el aviso no se puede deducir del valor:
 * 47.50 escrito a mano y 47.50 recortado se ven idénticos.
 *
 * ── Dónde NO va ─────────────────────────────────────────────────────────────
 * · Un CONTEO a ciegas (bolsas, cortes): lo que se contó es el dato, y topearlo
 *   al esperado sería decir la cifra que el conteo tiene que ignorar.
 * · Una salida que «no alcanza» contra el efectivo de la sala: el tope sería
 *   el efectivo del cajón, que esa pantalla no puede revelar.
 * El servidor sigue rechazando de todos modos: esto es la cortesía del campo,
 * no el control.
 *
 * @param {string|number} valor lo que se escribió (ya pasado por la máscara DECIMAL)
 * @param {number} tope el máximo permitido, en dólares
 * @returns {{ valor: string, topeado: boolean }}
 */
export function hastaElTope(valor, tope) {
    const v = String(valor ?? '');
    const n = Number(v);
    // Sin tope conocido —el dato todavía no cargó— no se recorta nada: un tope
    // de cero dejaría el campo en cero y sin explicación.
    if (v.trim() === '' || !Number.isFinite(n) || !Number.isFinite(tope) || tope <= 0) return { valor: v, topeado: false };
    if (n <= tope + 0.004) return { valor: v, topeado: false };
    return { valor: (Math.round(tope * 100) / 100).toFixed(2), topeado: true };
}
