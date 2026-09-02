SET lock_timeout = '5s';

/* ── De cada hora a cada 10 minutos, y sólo con las salas abiertas ─────────
 *
 * El usuario: «cada hora es mucho, ¿cada 5 minutos? o qué opinás». Medido el
 * 2-sep antes de decidir: una corrida completa cuesta **17.3 s y 1.4 MB** —
 * login 0.5 s más seis listados, y Salud 3 sola son 6.2 s—. Y el origen NO
 * deja pedir sólo los que deben: su pantalla ofrece rango de fechas y nada
 * más, así que es la tanda entera o nada.
 *
 *   cada hora   0.5% del tiempo    144 peticiones/día    34 MB
 *   cada 15'    1.9%               576                  134 MB
 *   cada 10'    2.9%               864                  202 MB
 *   cada 5'     5.8%             1.728                  403 MB
 *
 * Se elige **cada 10 minutos dentro del horario de sala** (13-23,0-3 UTC =
 * 7am-9pm SV): 90 corridas, 540 peticiones, 126 MB.
 *
 * Por qué 10 y no 5: **la frescura de esta lista no protege dinero.** El abono
 * relee el saldo del origen antes de escribir y rechaza el exceso, así que una
 * lista atrasada muestra una deuda ya pagada durante unos minutos — molesto,
 * no peligroso. Los 5 minutos costarían el doble para ganar cinco minutos
 * sobre algo que no puede hacer daño, y ocuparían el 5.8% del tiempo de un ERP
 * que es el mismo con el que las salas facturan.
 *
 * Por qué la ventana: entre las 9 de la noche y las 7 de la mañana no hay
 * quien cobre ni quien mire. Doce corridas nocturnas por día son 72 peticiones
 * que no cambian un dato — y la corrida de las 7am deja la lista al día antes
 * de que abra la primera sala.
 */
SELECT cron.alter_job(jobid, schedule := '*/10 13-23,0-3 * * *')
FROM cron.job WHERE jobname = 'creditos-cada-hora';
