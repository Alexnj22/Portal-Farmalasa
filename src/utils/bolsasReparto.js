// De dónde sale el dinero: primero el CAJÓN, después las bolsas.
//
// ── La prioridad se invirtió el 2026-09-02 ─────────────────────────────────
//
// Hasta ese día una salida de efectivo salía SIEMPRE de una bolsa: el botón de
// Mi caja ni ofrecía el cajón mientras la sala tuviera una bolsa abierta. La
// regla del 30-ago era «prefiere las bolsas de cortes anteriores», porque ese
// dinero ya lo descontó su propio cierre.
//
// Regla nueva del usuario: **la prioridad es la caja.** Si el cajón tiene el
// efectivo, de ahí sale; si no lo tiene, sale de las bolsas con todo lo que
// sigue escrito abajo, que no cambió.
//
// Lo trajo OTR-1060 de Salud 3: **$3.37** de un pago sacados de la bolsa
// S3-1216, del día anterior, con el cajón lleno de las ventas de la mañana.
// Abrir una bolsa sellada de ayer para pagar $3.37 rompe justo el control que
// la bolsa existe para dar.
//
// El cajón entra al reparto como un origen más y con la MISMA regla del paso:
// si el monto es múltiplo de $10, del cajón salen billetes de $10. Y entra
// entero o no entra —no se parte una salida entre el cajón y una bolsa—: sería
// un vale de caja más un vale de bolsa por una sola entrega, y son dos papeles
// distintos en dos archivos distintos.
//
// ── Lo de abajo es la regla de las bolsas, que no cambió ───────────────────
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
 * Cuánto hay en la bolsa AHORA. Cero cuando no se sabe.
 *
 * `monto_inicial` es lo que se guardó; el saldo es lo que queda después de los
 * vales. Hasta el 2026-09-03 esta pregunta estaba respondida a mano en SEIS
 * sitios —acá, el Circuito, Mi caja, el widget del Inicio y las dos sumas de la
 * entrega— y las seis terminaban en `?? b.monto_inicial`: cuando el saldo no
 * llegaba mostraban lo guardado. Un número creíble, más alto que el real y en
 * la dirección peligrosa — la pantalla del conteo pide contar contra él y el
 * diálogo de salida ofrece sacar plata que ya salió.
 *
 * **Medido ese día: en operación normal el saldo SIEMPRE llega.** Un
 * dependiente ve 40 bolsas por RLS y `get_bolsas_saldos` le devuelve 40 filas,
 * así que el fallback no se estrena nunca salvo que esa consulta falle sola
 * —son dos llamadas distintas y la segunda puede caer con la primera bien—.
 * Había 4 bolsas abiertas con vales por $1,753.01: ése era el tamaño exacto del
 * faltante que la sala habría visto sin que nada fallara a la vista.
 *
 * Por eso lo desconocido vale CERO y no lo guardado. Cero es evidente —nadie
 * confunde $0.00 con un saldo—, deja la bolsa fuera del reparto (`disponibles`
 * filtra las que no tienen nada, o sea que no se le puede sacar dinero) y hace
 * que el servidor rechace el conteo en vez de aceptarlo contra una cifra
 * inventada. El error pasa de creíble y a favor a visible y en contra.
 */
export function saldoDeBolsa(b) {
    const s = Number(b?.saldo);
    return Number.isFinite(s) ? s : 0;
}

/**
 * Las que están en la sala y tienen algo, de la más vieja a la más nueva.
 *
 * El orden de preferencia del saldo importa: el mapa recién traído y después el
 * que la fila ya trae pegado. Sin el segundo, un llamador que ya resolvió los
 * saldos —y no manda el mapa— se quedaría sin ninguno.
 */
export function disponibles(bolsas, saldos) {
    return (bolsas || [])
        .filter((b) => b.estado === 'ABIERTA')
        .map((b) => ({ ...b, saldo: saldoDeBolsa({ saldo: saldos?.get(b.id)?.saldo ?? b.saldo }) }))
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
 *            combinada: boolean, falta: number, redondo: boolean,
 *            disponible: number, paso: number }}
 *   `alcanza` false = entre todas no hay tanto. `combinada` true = hizo falta
 *   más de una bolsa, o sea que van a ser varios vales. `redondo` true = la
 *   regla del paso está actuando y las monedas se quedan en las bolsas.
 *   `disponible` es el techo bajo la regla vigente. `paso` es en cuánto se
 *   reparte, en DÓLARES y no en centavos: la pantalla tiene que poder decir
 *   «salen billetes de $10» sin volver a derivarlo — cuando lo derivaba ella
 *   leía `bolsas_tipos_salida.multiplo`, que sólo tiene «Cambio por monedas»,
 *   así que una remesa de $500 anunciaba «billetes de $0.00».
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

    const vacio = { repartos: [], alcanza: false, combinada: false, falta: 0, redondo, disponible, paso: paso / 100 };
    if (objetivo <= 0 || !lista?.length) return vacio;

    // 1. La más vieja que alcance SOLA.
    const sola = lista.find((b) => puede(b) >= objetivo);
    if (sola) {
        return {
            repartos: [{ bolsa_id: sola.id, folio: sola.folio, monto: objetivo / 100 }],
            alcanza: true, combinada: false, falta: 0, redondo, disponible, paso: paso / 100,
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
        paso: paso / 100,
    };
}

/** Lo que hay en total en la sala, para decir cuánto falta cuando no alcanza. */
export const totalDisponible = (lista) =>
    (lista || []).reduce((a, b) => a + centavos(b.saldo), 0) / 100;

/**
 * **De dónde sale una salida de efectivo: el cajón primero, las bolsas después.**
 *
 * @param efectivoEnCaja  lo que hay en BILLETES en el cajón, o `null` si no se
 *                        pudo medir. `null` NO es cero: es «no sé», y manda a
 *                        las bolsas, que es lo que se hacía siempre. La falla
 *                        segura es no mandar a nadie a buscar billetes que
 *                        capaz no están.
 * @param puedeElCajon    si ese motivo puede pagarse del cajón —o sea si
 *                        `bolsas_tipos_salida.caja_tipo` no es `NULL`—. Un
 *                        motivo sin mapear va a las bolsas.
 * @param lista           las bolsas de la sala, ya ordenadas por `disponibles`
 * @param monto           lo que se quiere sacar
 *
 * @returns el mismo objeto de `elegirBolsas` más `origen`: `'CAJA'` o
 *   `'BOLSAS'`. Con `'CAJA'` los `repartos` van VACÍOS a propósito — no hay
 *   ninguna bolsa que tocar, y devolver uno falso haría que la pantalla
 *   anunciara una etiqueta nueva sobre una bolsa que nadie abrió.
 *
 * El cajón entra ENTERO o no entra: partir una salida entre el cajón y una
 * bolsa dejaría un vale de caja y un vale de bolsa por una sola entrega, que
 * son dos papeles en dos archivos distintos por un solo acto.
 *
 * Y respeta el paso igual que una bolsa: si el monto es múltiplo de $10, del
 * cajón salen billetes de $10. Con el monto redondo eso sólo puede recortar el
 * techo hacia abajo, nunca hacia arriba.
 */
export function elegirOrigen({ efectivoEnCaja, puedeElCajon, lista, monto }) {
    const enBolsas = elegirBolsas(lista, monto);
    const objetivo = centavos(monto);
    if (objetivo <= 0 || !puedeElCajon || efectivoEnCaja == null) {
        return { ...enBolsas, origen: 'BOLSAS' };
    }
    const paso = pasoDeMonto(objetivo);
    const enCaja = centavos(efectivoEnCaja);
    const puede = paso > 0 ? Math.floor(enCaja / paso) * paso : enCaja;
    if (puede < objetivo) return { ...enBolsas, origen: 'BOLSAS' };
    return {
        ...enBolsas,
        origen: 'CAJA',
        repartos: [],
        alcanza: true,
        combinada: false,
        falta: 0,
    };
}
