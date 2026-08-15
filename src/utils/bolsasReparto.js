// De qué bolsa sale el dinero.
//
// Regla del usuario (2026-08-15): **la más vieja que alcance sola**. No se parte
// una remesa en dos bolsas para vaciar la más antigua — se busca desde la más
// vieja hacia adelante la primera que cubra el monto entero. Así cada salida
// deja un solo vale y una sola bolsa tocada, que es lo que se puede controlar
// con papeles adentro de una bolsa.
//
// El caso que igual hay que resolver es cuando NINGUNA alcanza sola. Ahí sí se
// combinan, desde la más vieja, y la operación queda con dos vales — que es
// exactamente el caso «se tomaron 2 bolsas» que preguntó el usuario. La
// pantalla lo dice antes de registrar: dos papeles adentro de dos bolsas no es
// lo mismo que uno.
//
// Vive fuera del componente porque decide de dónde sale dinero y eso tiene que
// poder probarse. El servidor no confía en esta cuenta: revalida que la suma
// cierre y que cada bolsa tenga saldo.

const centavos = (n) => Math.round(Number(n || 0) * 100);

/**
 * Las que están en la sala y tienen algo, de la más vieja a la más nueva.
 *
 * El orden de preferencia del saldo importa: el mapa recién traído, después el
 * que la fila ya trae pegado, y sólo al final `monto_inicial`. Sin el del medio,
 * un llamador que ya resolvió los saldos —y no manda el mapa— caería en lo
 * guardado y ofrecería sacar plata que ya salió.
 */
export function disponibles(bolsas, saldos) {
    return (bolsas || [])
        .filter((b) => b.estado === 'ABIERTA')
        .map((b) => ({ ...b, saldo: Number(saldos?.get(b.id)?.saldo ?? b.saldo ?? b.monto_inicial ?? 0) }))
        .filter((b) => centavos(b.saldo) > 0)
        .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))
            || String(a.hora).localeCompare(String(b.hora)));
}

/**
 * Elige de qué bolsas sale `monto`.
 *
 * @returns {{ repartos: Array<{bolsa_id, folio, monto}>, alcanza: boolean, combinada: boolean, falta: number }}
 *   `alcanza` false = entre todas no hay tanto. `combinada` true = hizo falta
 *   más de una bolsa, o sea que van a ser varios vales.
 */
export function elegirBolsas(lista, monto) {
    const objetivo = centavos(monto);
    const vacio = { repartos: [], alcanza: false, combinada: false, falta: 0 };
    if (objetivo <= 0 || !lista?.length) return vacio;

    // 1. La más vieja que alcance SOLA.
    const sola = lista.find((b) => centavos(b.saldo) >= objetivo);
    if (sola) {
        return {
            repartos: [{ bolsa_id: sola.id, folio: sola.folio, monto: objetivo / 100 }],
            alcanza: true, combinada: false, falta: 0,
        };
    }

    // 2. Ninguna alcanza: se combinan desde la más vieja.
    const repartos = [];
    let resta = objetivo;
    for (const b of lista) {
        if (resta <= 0) break;
        const toma = Math.min(centavos(b.saldo), resta);
        if (toma <= 0) continue;
        repartos.push({ bolsa_id: b.id, folio: b.folio, monto: toma / 100 });
        resta -= toma;
    }

    return {
        repartos: resta > 0 ? [] : repartos,
        alcanza: resta <= 0,
        combinada: resta <= 0 && repartos.length > 1,
        falta: resta > 0 ? resta / 100 : 0,
    };
}

/** Lo que hay en total en la sala, para decir cuánto falta cuando no alcanza. */
export const totalDisponible = (lista) =>
    (lista || []).reduce((a, b) => a + centavos(b.saldo), 0) / 100;
