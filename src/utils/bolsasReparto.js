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
// ── Las monedas se quedan adentro: EL PASO SALE DEL MONTO (2026-09-01) ─────
//
// Nació el 28-ago mirando un retiro de $2,000 para cambiar monedas —«no se debe
// tomar en cuenta los impares de 10, porque no se entregan monedas»— y vivía
// como un campo por motivo: sólo «Cambio por monedas» lo tenía, y una remesa
// salía al centavo. Se vio en `REM-1058`: $500 repartidos en $55.82 + $324.80 +
// $119.38, tres bolsas con monedas contadas a mano para completar un total
// redondo.
//
// Regla del usuario (1-sep), y ahora vale para **todos los vales**:
//
//   el monto es múltiplo de 10   →  cada bolsa aporta múltiplos de **10**
//   el monto es múltiplo de 5    →  cada bolsa aporta múltiplos de **5**
//   el monto trae centavos       →  sale **exacto**, como siempre
//
// «Así en un corte nunca salen monedas o billetes de 5.» El paso lo dispara el
// MONTO PEDIDO y no el motivo: $500 sale en billetes de $10, $55 en billetes de
// $5, y $125.75 sale exacto — que es lo que el mismo usuario pidió expresamente
// que se permitiera el 28-ago.
//
// Por eso el paso se DERIVA y ya no se declara por tipo: un campo por motivo
// obligaba a acertarle a cada uno, y el que se olvidara volvía a partir monedas
// sin que nada lo dijera. Derivado, la regla no se puede olvidar.
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
 * El paso que le corresponde a un monto, en centavos. 0 = sale exacto.
 *
 * Se prueba de mayor a menor: el de $10 primero, porque es el que deja menos
 * papeles sueltos. Un monto que no es múltiplo de 5 —$7, o cualquiera con
 * centavos— no tiene paso: forzarlo dejaría la salida sin poder cuadrar.
 */
export function pasoDeMonto(montoEnCentavos) {
    if (montoEnCentavos <= 0) return 0;
    if (montoEnCentavos % 1000 === 0) return 1000;
    if (montoEnCentavos % 500 === 0) return 500;
    return 0;
}

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
 * El paso ya NO se pasa: se deriva del monto (ver `pasoDeMonto`). El parámetro
 * viejo se quitó a propósito y no se dejó ignorado — un argumento que no hace
 * nada se sigue pasando durante años y hace creer que decide algo.
 * @returns {{ repartos: Array<{bolsa_id, folio, monto}>, alcanza: boolean,
 *            combinada: boolean, falta: number, redondo: boolean, disponible: number }}
 *   `alcanza` false = entre todas no hay tanto. `combinada` true = hizo falta
 *   más de una bolsa, o sea que van a ser varios vales. `redondo` true = la
 *   regla del paso está actuando y las monedas se quedan en las bolsas.
 *   `disponible` es el techo bajo la regla vigente.
 */
export function elegirBolsas(lista, monto) {
    const objetivo = centavos(monto);
    const paso = pasoDeMonto(objetivo);
    // `redondo` es cierto por construcción cuando hay paso: `pasoDeMonto` sólo
    // devuelve uno que divide al monto. Se conserva la bandera porque la
    // pantalla la usa para explicar por qué el techo bajó.
    const redondo = paso > 0;
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
