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
// ── Y las monedas se quedan adentro cuando no hacen falta (2026-08-28) ──────
//
// Segunda regla del usuario, dictada mirando un retiro de $2,000 para cambiar
// monedas: «no se debe tomar en cuenta los impares de 10, porque no se entregan
// monedas». De una bolsa con $373.85 salen $370 y los $3.85 se quedan: lo que
// se entrega son billetes, y romper la bolsa para completar un centavo obliga a
// contar monedas que nadie pidió.
//
// Y la otra mitad, que es la que evita que la regla estorbe: «sólo si la salida
// de dinero es 125.75, ahí sí debe permitirlo y decir de qué bolsa sacarlo».
// O sea que **la regla la dispara el MONTO PEDIDO, no el motivo**: si el monto
// es múltiplo del paso, cada bolsa aporta múltiplos y su impar se queda; si el
// monto trae impar, sale exacto como siempre. Un motivo sin `multiplo` en el
// catálogo (hoy todos menos «Cambio por monedas») no cambia en nada.
//
// La consecuencia que hay que decir en pantalla: con la regla activa el TECHO
// BAJA. Cinco bolsas con $2,466.25 sólo pueden entregar $2,450 en billetes de
// $10, y los $16.25 de monedas no se pueden pedir. Por eso `elegirBolsas`
// devuelve `disponible` — el techo bajo la regla vigente — y no se deja que la
// pantalla lo deduzca de `totalDisponible`, que cuenta las monedas.
//
// Vive fuera del componente porque decide de dónde sale dinero y eso tiene que
// poder probarse. El servidor no confía en esta cuenta: revalida que la suma
// cierre, que cada bolsa tenga saldo y que cada aporte respete el paso.

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
 * @param lista     las de la sala, ya ordenadas por `disponibles`
 * @param monto     lo que se quiere sacar
 * @param multiplo  el paso del motivo (`bolsas_tipos_salida.multiplo`), o null.
 *                  Sólo actúa cuando `monto` es múltiplo de él.
 * @returns {{ repartos: Array<{bolsa_id, folio, monto}>, alcanza: boolean,
 *            combinada: boolean, falta: number, redondo: boolean, disponible: number }}
 *   `alcanza` false = entre todas no hay tanto. `combinada` true = hizo falta
 *   más de una bolsa, o sea que van a ser varios vales. `redondo` true = la
 *   regla del paso está actuando y las monedas se quedan en las bolsas.
 *   `disponible` es el techo bajo la regla vigente.
 */
export function elegirBolsas(lista, monto, multiplo = null) {
    const objetivo = centavos(monto);
    const paso = centavos(multiplo);
    // La regla la dispara el monto pedido: $2,000 sale en billetes, $125.75 sale
    // exacto. Sin esto, «Cambio por monedas» rechazaría el impar que el usuario
    // pidió expresamente que se permitiera.
    const redondo = paso > 0 && objetivo > 0 && objetivo % paso === 0;
    const puede = (b) => {
        const s = centavos(b.saldo);
        return redondo ? Math.floor(s / paso) * paso : s;
    };
    const disponible = (lista || []).reduce((a, b) => a + puede(b), 0) / 100;

    const vacio = { repartos: [], alcanza: false, combinada: false, falta: 0, redondo, disponible };
    if (objetivo <= 0 || !lista?.length) return vacio;

    // 1. La más vieja que alcance SOLA.
    const sola = lista.find((b) => puede(b) >= objetivo);
    if (sola) {
        return {
            repartos: [{ bolsa_id: sola.id, folio: sola.folio, monto: objetivo / 100 }],
            alcanza: true, combinada: false, falta: 0, redondo, disponible,
        };
    }

    // 2. Ninguna alcanza: se combinan desde la más vieja.
    const repartos = [];
    let resta = objetivo;
    for (const b of lista) {
        if (resta <= 0) break;
        const toma = Math.min(puede(b), resta);
        if (toma <= 0) continue;
        repartos.push({ bolsa_id: b.id, folio: b.folio, monto: toma / 100 });
        resta -= toma;
    }

    return {
        repartos: resta > 0 ? [] : repartos,
        alcanza: resta <= 0,
        combinada: resta <= 0 && repartos.length > 1,
        falta: resta > 0 ? resta / 100 : 0,
        redondo,
        disponible,
    };
}

/** Lo que hay en total en la sala, para decir cuánto falta cuando no alcanza. */
export const totalDisponible = (lista) =>
    (lista || []).reduce((a, b) => a + centavos(b.saldo), 0) / 100;
