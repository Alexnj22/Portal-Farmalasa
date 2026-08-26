// Cuándo una llamada saliente fuera de 2xx es un problema, y cuándo no.
//
// Vive en su propio módulo —y no dentro de `eficiencia-gate.mjs`— porque el gate
// es un SCRIPT: importarlo para probar esta regla ejecutaba el gate entero
// contra producción. Medido: 13,84 s de «import» en una prueba unitaria, que
// además necesitaba red. Una prueba que sale a producción para comprobar una
// cuenta de tres líneas es una prueba que alguien va a terminar salteando.

export const TASA_NO_OK_MAX = 0.01;

/* ── Qué corridas fallidas cuentan como evidencia (2026-08-26) ──────────────
 *
 * `clasificarSalientes` sube a ROJO en cuanto hay una corrida fallida en la
 * misma ventana. La pregunta es cuáles cuentan, y acá contaban TODAS.
 *
 * El 2026-08-26 el gate se puso rojo por dos 503
 * `SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED` y cuatro tiempos de espera de DNS,
 * escalados por 17 `job startup timeout` repartidos entre seis crons — todos
 * entre 0,19% y 0,94%, o sea que el propio gate los estaba imprimiendo como
 * AVISO en la sección de arriba: «por debajo del 5% que pone esto en rojo».
 *
 * Los mismos tropiezos eran ruido tolerable en una sección y prueba de un cron
 * roto en la otra. Y el mensaje que salía mandaba a revisar `verify_jwt` sobre
 * funciones que estaban bien — **exactamente la receta equivocada que este
 * módulo se creó para corregir**, un piso más arriba.
 *
 * Hay además un motivo de fondo, y es el que manda: un `job startup timeout` es
 * el planificador que **no logró arrancar el trabajo**. Nunca hizo una llamada
 * saliente, así que no puede ser evidencia sobre llamadas salientes. Es el
 * mismo razonamiento que ya está escrito para las colgadas —«un fallo de DNS no
 * llega a la función»— aplicado un nivel más arriba.
 *
 * Entonces cuenta lo SOSTENIDO, con el mismo 5% que usa la sección de crons:
 * una función que quedó con el JWT puesto falla el 100% de las veces, no el
 * 0,2%. */
export const TASA_CRON_ROJA = 0.05;

export function cuentaComoCronRoto({ fallidas = 0, corridas = 0 } = {}) {
  if (!fallidas) return 0;
  const tasa = corridas ? fallidas / corridas : 1;   // sin corridas, un fallo es todo
  return tasa > TASA_CRON_ROJA ? fallidas : 0;
}

/* ── Un 401 no prueba que un cron esté roto (2026-08-24) ────────────────────
 *
 * Acá había tolerancia cero y el mensaje afirmaba que «el cron está fallando
 * ANTES de ejecutar una línea». Ese día el gate se puso rojo por DOS llamadas
 * de 4.106 —un 401 `UNAUTHORIZED_INVALID_JWT_FORMAT` y un 400
 * `{"ok":false,"error":"Falta el envío."}`— y **las 33 corridas de cron de esas
 * dos ventanas terminaron `succeeded`; en 24 h no falló ninguna**. O sea que el
 * mensaje mandaba a redesplegar funciones que estaban bien: es la misma receta
 * equivocada que ya se corrigió en el cuadre de ventas, donde el aviso decía
 * «resincronizar» sobre un caso en el que resincronizar no servía de nada.
 *
 * `net._http_response` guarda TODA salida de `pg_net`, no sólo la de los crons:
 * una prueba desde el navegador, un barrido a mano o una función que validó su
 * entrada y contestó 400 caen ahí igual. Y el 400 de ese día era literalmente
 * eso — una función rechazando una entrada incompleta, que es lo que tiene que
 * hacer.
 *
 * Entonces se cruza con lo único que responde la pregunta de verdad: **¿le
 * falló una corrida a algún cron?** Si sí, sigue siendo rojo y el mensaje vale.
 * Si no, es un aviso con el desglose a la vista — acotar el fallo no es dejar
 * de mirar. Y queda el techo por TASA para que una inundación vuelva a ser roja
 * aunque los crons la sobrevivan: 1%, el mismo que las colgadas.
 *
 * Vive afuera y exportada para poder probarla: la regresión que tiene que cazar
 * —un cron con el JWT puesto— no se puede fabricar contra producción.
 */
export function clasificarSalientes({ noOk = 0, total = 0, corridasFallidas = 0, desglose = '' } = {}) {
  if (noOk <= 0) return { nivel: 'nada', mensaje: null };
  const tasa = total ? noOk / total : 0;

  if (corridasFallidas > 0)
    return { nivel: 'rojo',
      mensaje: `hay ${noOk} llamada(s) saliente(s) fuera de 2xx (${desglose}) y ${corridasFallidas} `
             + 'corrida(s) de cron fallida(s) en la misma ventana. Un 401 acá significa que una '
             + 'función volvió a quedar con verify_jwt y el cron está fallando ANTES de ejecutar '
             + 'una línea — ya pasó tres veces. Un 5xx suelto puede ser el reinicio de Postgres: '
             + 'cruzar contra pg_postmaster_start_time().' };

  if (tasa > TASA_NO_OK_MAX)
    return { nivel: 'rojo',
      mensaje: `hay ${noOk} llamada(s) saliente(s) fuera de 2xx (${desglose}): `
             + `${(tasa * 100).toFixed(2)}% de ${total.toLocaleString('es')}, por encima del `
             + `${TASA_NO_OK_MAX * 100}%. Ningún cron falló, así que no es el JWT — pero a este `
             + 'volumen hay algo que llama y rebota.' };

  return { nivel: 'aviso',
    mensaje: `${noOk} llamada(s) saliente(s) fuera de 2xx (${desglose}) y NINGUNA corrida de cron `
           + 'fallida en 24 h. No es el JWT: `net._http_response` guarda toda salida de `pg_net`, '
           + 'así que una prueba desde el navegador o una función que rechazó una entrada '
           + 'incompleta cae ahí igual. Mirar el desglose antes de tocar nada.' };
}
