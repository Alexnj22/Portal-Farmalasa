#!/usr/bin/env node
/**
 * gate:eficiencia — cuánto le pide el portal al sistema de origen, y que eso
 * no crezca sin que nadie lo haya decidido.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────────
 *
 * El 2026-08-20 el usuario preguntó si un barrido nuevo no estaría saturando el
 * sistema. Medido, el barrido era **1 disparo en 24 h**. El que pedía de verdad
 * era otro: la vigilancia de los cortes de caja, con **2.863 disparos** y 13
 * peticiones cada uno — unas 25.000 al día. Llevaba semanas corriendo así y
 * nadie lo había mirado con esa pregunta en la mano, porque **no había forma de
 * verlo**: la cadencia de un cron vive en producción, el costo por corrida vive
 * en el código, y nada los juntaba.
 *
 * Este gate los junta. No mide velocidad —eso es `gate:perf`—: mide **volumen y
 * silencio**. Cuántas veces por día el portal toca el sistema de origen, y si
 * algo de eso está fallando sin que nadie se entere.
 *
 * ── Cuatro cosas que este gate SÍ puede afirmar ───────────────────────────────
 *
 * 1. Que ningún cron nuevo apareció sin que su costo quedara declarado.
 * 2. Que ninguna cadencia se apretó en silencio.
 * 3. Que lo declarado sigue vivo en producción — un cron que dejó de existir es
 *    una protección que se apagó sola. `backup-critical-tables` estuvo **17
 *    días sin correr** y lo delató una alerta, no un gate.
 * 4. Que las llamadas salientes están saliendo bien. Un redeploy sin
 *    `--no-verify-jwt` deja al cron contestando 401 **antes de ejecutar una
 *    línea**, y ya pasó tres veces.
 *
 * ── Una cosa que NO puede afirmar, y hay que decirla ──────────────────────────
 *
 * Cuántas peticiones hace cada corrida. Eso sale del código y de cuántas vueltas
 * dé su bucle: no se lee de afuera. Así que se DECLARA, con su motivo escrito, y
 * lo que el gate vigila es que la suma no crezca. Los que todavía no se midieron
 * están anotados como tales y se cuentan aparte: un número que no se midió no se
 * puede sumar a un presupuesto sin mentir. Esa deuda **sólo baja**.
 *
 * Uso:
 *   npm run gate:eficiencia                    todo (necesita red)
 *   npm run gate:eficiencia -- --hook          sólo lo local (para el pre-commit)
 *   npm run gate:eficiencia -- --update-baseline  baja los números a lo medido
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { abrirCanal } from './lib/canal-supabase.mjs';
import { clasificarSalientes, cuentaComoCronRoto } from './lib/salientes.mjs';


const BASELINE_FILE = 'scripts/eficiencia-gate-baseline.json';
/* La lectura anterior NO va en el baseline, aunque ahí nació.
 *
 * El baseline es un acuerdo del repo —lo que no puede subir— y se commitea; la
 * lectura anterior es de ESTE clon y cambia en cada corrida. Mezclarlos hacía
 * que correr el gate dejara el archivo sucio, y en un árbol con varias sesiones
 * eso es ruido permanente en `git status` y un conflicto esperando. Va afuera y
 * sin versionar: un clon nuevo simplemente no tiene lectura anterior, que es un
 * caso que el gate ya sabe contestar. */
const ESTADO_FILE = 'scripts/.eficiencia-gate-estado.json';
const SOLO_LOCAL = process.argv.includes('--hook');
const REGENERAR = process.argv.includes('--update-baseline');

/* ── El manifiesto ────────────────────────────────────────────────────────────
 *
 * Un cron por fila, con lo que cuesta CADA corrida en peticiones al sistema de
 * origen. `sistema: 0` no es «no hace nada»: es «no toca el sistema», y para
 * varios eso es cierto sólo mientras no haya trabajo — está dicho en el motivo.
 *
 * `sistema: null` significa SIN MEDIR. No se inventa un número: se cuenta como
 * deuda en su propia línea del baseline y se baja midiendo, no estimando.
 *
 * La cadencia se compara contra producción tal cual: si alguien la aprieta, el
 * gate lo dice con el número viejo y el nuevo a la vista. */
const CRONS = [
  {
    job: 'refresh-product-last-sale-daily', slug: null, cadencia: '45 6 * * *',
    corridasDia: 1, sistema: 0,
    motivo: 'Recalcula `product_last_sale` —la fecha de la última venta de cada producto en cada '
          + 'sala— desde las ventas reales. Existe porque el disparador que la llena escribe al '
          + 'INSERTAR el renglón y sólo sabe SUBIR la fecha, y la anulación de la factura llega '
          + 'después: sin este barrido, cada factura anulada deja su fecha adentro para siempre. '
          + 'Medido el 2026-09-01 al estrenarlo: 34 fechas equivocadas (hasta 195 días más nuevas '
          + 'de lo real) y 11 productos que NUNCA se vendieron pero figuraban vendidos, con nueve '
          + 'de esas 45 cruzando el corte de 90 días con el que Mín·Máx decide si congela una '
          + 'baja de máximo. Se anulan ~65 facturas por mes de forma sostenida, así que la '
          + 'suciedad se re-acumula sola: por eso es un cron y no un arreglo de una vez. '
          + '`sistema: 0` porque es SQL puro contra la propia base — no habla con el ERP ni con '
          + 'Hacienda. Una vez al día y a las 06:45 UTC: cuesta ~1.07 s entrando por índice, va '
          + 'después del rollup de las 06:30 para no pelearle el `work_mem`, y cae en la ventana '
          + 'en que los crons de sync están quietos (corren 12-23,0-5).',
  },
  {
    job: 'soltar-capturas-abandonadas', slug: 'soltar-captura', cadencia: '7 * * * *',
    corridasDia: 24, sistema: 0,
    motivo: 'Vacía el buzón `capturas/` — la copia temporal que el teléfono deja para que la '
          + 'computadora la baje. El caso normal NO llega acá: quien la baja llama a '
          + '`soltar-captura` en el acto. Esto recoge lo abandonado (el diálogo que se cerró, la '
          + 'señal que se fue), que sin barrido se acumula sin techo: medido antes de la primera '
          + 'corrida, 31 archivos y 12.4 MB en tres días, y son DUIs y contratos de personas. '
          + '`sistema: 0` porque no habla con el ERP ni con Hacienda: sólo lista y borra en el '
          + 'Storage del propio proyecto. Cada hora y no cada día porque la variable que este '
          + 'cron controla es cuánto tiempo pasa un papel ajeno en un buzón que ya nadie mira.',
  },
  // ── Los que hablan con el sistema en cada corrida ──────────────────────────
  {
    job: 'creditos-cada-10min', slug: 'sync-creditos', cadencia: '*/10 13-23,0-4 * * *',
    corridasDia: 102, sistema: 6,
    motivo: 'Trae al portal las cuentas por cobrar de las seis salas. Son 6 listados, uno por '
          + 'sala y EN SERIE: la sucursal vive en la sesión del origen, así que dos a la vez se '
          + 'pisan la sala y devuelven la cartera equivocada sin dar error. Mira SÓLO EL DÍA DE '
          + 'HOY, y eso es lo que la hace barata — medido el 2-sep: la ventana de un día son '
          + '1.8 s y 2 kB contra 17.3 s y 1.4 MB del histórico entero, o sea diez veces menos '
          + 'tiempo del origen y setecientas veces menos datos. Lo viejo ya está guardado y su '
          + 'fecha no cambia. La VENTANA horaria (7am-10:59pm SV, corregida por el usuario: «a las '
          + '10 sigue abierto») saca las corridas nocturnas, que no '
          + 'cambian un dato. Escribe sólo lo que cambió (`IS DISTINCT FROM`): medido, una '
          + 'corrida sobre las 2,387 filas escribió 0.',
  },
  {
    job: 'creditos-barrido-completo', slug: 'sync-creditos', cadencia: '0 8 * * *',
    corridasDia: 1, sistema: 6,
    motivo: 'El histórico entero, una vez al día a las 2am SV con el origen quieto. NO es '
          + 'redundante con la pasada de los diez minutos y omitirlo deja un defecto silencioso: '
          + 'un abono hecho EN EL ORIGEN sobre un crédito de hace ocho meses no aparece en la '
          + 'ventana de hoy —lo que cambió es su saldo, no su fecha—, así que el espejo mostraría '
          + 'una deuda ya pagada para siempre y el aviso del plazo cobraría lo que nadie debe. '
          + 'Cuesta 17.3 s y 1.4 MB, una vez.',
  },
  {
    job: 'creditos-vencidos-0800-sv', slug: 'avisar-creditos-vencidos', cadencia: '0 14 * * *',
    corridasDia: 1, sistema: 0,
    motivo: 'Avisa a quien vendió y a la jefatura de sala cuando un crédito se pasó del mes. '
          + '`sistema: 0` porque lee el espejo del portal, no el origen. Un aviso por SALA y no '
          + 'uno por crédito —34 avisos serían ruido que se aprende a ignorar en una semana—, y '
          + 'la clave antiduplicado lleva el día adentro, así que suena una vez por día mientras '
          + 'haya algo vencido. A las 8 SV y DESPUÉS de la corrida de las 13:00 UTC: al revés '
          + 'avisaría sobre créditos que alguien ya pagó ayer.',
  },
  {
    job: 'cortes-caja-30s', slug: 'sync-cortes-caja', cadencia: '30 seconds',
    corridasDia: 1920, sistema: 6,
    motivo: 'Cada 30 s de 7 a 23 SV porque quien corta la caja revisa la diferencia EN EL MOMENTO '
          + 'y rehace el corte; la cadencia es requisito del usuario y no se espacia. '
          + 'Son 6 listados, uno por sala: desde v2.671.1 la sesión de cada sala sobrevive a la '
          + 'corrida, antes eran 13 (un ingreso + un cambio de sala por cada listado). '
          + 'La VENTANA la aplica la función y no el cron: `pg_cron` con un intervalo '
          + '(`30 seconds`) no admite un rango de horas, así que hasta el 2026-08-25 disparaba '
          + '2.880 veces mientras acá decía 1.920 — eran ~5.760 peticiones diarias de más, entre '
          + 'las 23:00 y las 07:00 con las salas cerradas. Hoy `HORA_DESDE`/`HORA_HASTA` de '
          + '`sync-cortes-caja` contestan sin gastar nada fuera de ese rango. El tope son las 23 y '
          + 'no las 22 porque los cortes reales llegan hasta las 22:xx (24 en esa hora, medidos '
          + 'sobre 60 días) y cortar a las 22 en punto dejaría sin sincronizar justo los de cierre. '
          + 'Desde el 2026-09-02 `hacer-corte-caja` además dispara un barrido de UNA sala apenas '
          + 'hace el corte (~35 peticiones al día, una por corte): el papel sale al CONFIRMAR y la '
          + 'fila hace falta para poder firmar, y la mediana de aparición era de 38 s. Eso NO '
          + 'reemplaza a esta ronda y por eso la cadencia no bajó: el portal sólo puede avisar de '
          + 'los cortes que hace ÉL, y la sala todavía puede cortar en la pantalla de la caja — ese '
          + 'corte no avisa a nadie y sin la ronda sería invisible. Decisión del usuario '
          + '(2026-09-02) de dejarla en 30 s.',
  },
  {
    job: 'puntos-vencer-mensual', slug: 'puntos-vencer', cadencia: '0 9 1 * *',
    corridasDia: 1 / 30, sistema: 0,
    motivo: 'El vencimiento de los puntos. `sistema: 0` como su hermana: no toca el sistema de '
          + 'origen, lee y escribe en la base de puntos por MySQL. '
          + 'UNA VEZ AL MES y no más, porque un punto vence un día concreto y adelantarse no '
          + 'cambia nada: correrlo a diario sería recalcular la misma respuesta treinta veces. '
          + 'El día 1 a las 09:00 UTC cae en la ventana en que los syncs no corren (12-23,0-5), '
          + 'así que no compite por conexiones. '
          + 'Medido en la primera corrida: 1,070 ms para reconstruir los grupos de las 14,632 '
          + 'cuentas — una sola consulta con suma corrida, no una por cliente. '
          + 'Hoy corre en modo MIRAR (`{"aplicar": false}` escrito en el cron, no sólo en el '
          + 'default de la función): el primer punto que puede vencer es del 1-oct-2027, así que '
          + 'hasta entonces lo único que hace es dejar su medición en `puntos_vencimiento_log`.',
  },
  {
    job: 'sync-puntos-1min', slug: 'sync-puntos', cadencia: '* * * * *',
    corridasDia: 1440, sistema: 0,
    motivo: 'Las ventas que ganan puntos, al sistema de puntos. `sistema: 0` porque NO le pega al '
          + 'sistema de origen: lee del portal y escribe por MySQL en la base de puntos, así que '
          + 'no gasta ninguna petición de las que este gate cuida. '
          + 'CADA MINUTO, decisión del usuario, y la cadencia importa por una razón del mostrador: '
          + 'el cliente puede presentar el ticket poco después de comprar, y si la venta todavía no '
          + 'llegó, no se le pueden dar sus puntos. Cada cinco minutos deja una ventana de hasta '
          + 'cinco en la que un ticket recién emitido «no existe». '
          + 'Se puede porque se MIDIÓ: en régimen `ventas_para_puntos` sobre la ventana de siete '
          + 'días tarda 34 ms —la bitácora `puntos_enviados` descarta lo ya enviado, así que la '
          + 'ventana ancha no cuesta lo que parece—, o sea 49 segundos de base por día. Si ese '
          + 'número crece, ACÁ hay que mirar antes de dejar la cadencia: una lectura lenta cada '
          + 'minuto llena el pool de PostgREST y tira el portal entero.',
  },
  {
    job: 'aperturas-caja-30min', slug: 'sync-aperturas-caja', cadencia: '*/30 12-23,0-4 * * *',
    corridasDia: 34, sistema: 19,
    motivo: 'Quién tiene la caja abierta en cada sala, a qué hora la abrió y cuánto espera el '
          + 'sistema. Existe porque ese dato hoy no está en ningún lado: tres de las seis salas '
          + 'cortan bajo una cuenta compartida («MI CAJA LA POPULAR») —185 de 452 cortes desde el '
          + '14-ago— y en los 452 `cortes_caja.employee_id` está en NULL. '
          + 'Son 19 peticiones: un ingreso + tres por sala (cambiar de sala, la pantalla con las '
          + 'cajas, y el panel de cada caja). No se cachea la caja de cada sala a propósito: una '
          + 'caja nueva tiene que aparecer sola. '
          + 'CADA 30 MINUTOS y no más seguido porque la hora de apertura que se guarda es EXACTA '
          + '—la da el panel, no el reloj de la corrida—, así que mirar más veces no la mejora; lo '
          + 'único que gana precisión es el cierre, y el turno se cierra una vez al día. La '
          + 'ventana va en el cron Y en la función: acá acota el disparo, allá porque `forzar` la '
          + 'saltea para un repaso a mano.',
  },
  {
    job: 'avisar-dui-por-vencer-diario', slug: null, cadencia: '0 13 * * *',
    corridasDia: 1, sistema: 0,
    motivo: 'CERO peticiones al sistema de origen: es SQL puro contra la propia base. Sin `slug` '
          + 'porque no llama a ninguna edge function — `pg_cron` ejecuta la función directamente. '
          + 'Diario y no semanal a propósito: la ventana es de 30 días y el freno vive en el '
          + '`metadata` del aviso (fuente + persona + etapa), así que correr todos los días no '
          + 'produce un aviso de más; lo que evita es que alguien espere una semana para '
          + 'enterarse de que su documento ya venció. A la persona se le avisa una vez por etapa '
          + 'y a Talento Humano se le manda UN resumen diario con la lista, no un aviso por '
          + 'cabeza: cuarenta y nueve avisos iguales el mismo día se archivan de una pasada.',
  },
  {
    job: 'avisar-bultos-viejos-daily', slug: 'avisar-bultos-viejos', cadencia: '0 15 * * *',
    corridasDia: 1, sistema: 0,
    motivo: 'CERO peticiones al sistema de origen: sólo lee la base y escribe avisos. Una vez al '
          + 'día porque lo que vigila —una bolsa que lleva días encima de alguien— se mueve en '
          + 'días, no en minutos. Su antiduplicado lleva los días adentro del check_key, así que '
          + 'el aviso vuelve una vez por día que pasa en vez de sonar una sola vez y callarse.',
  },
  {
    job: 'barrer-traslados-recibidos', slug: 'barrer-traslados-recibidos', cadencia: '0 12-23,0-3 * * *',
    corridasDia: 16, sistema: 13,
    motivo: 'Un ingreso + un cambio de sala y una lectura de cola por cada sala con tarjetas '
          + 'abiertas (6 hoy). Cada hora y no más seguido: lo único que cubre —que alguien reciba '
          + 'un traslado a mano en el sistema— deja el producto YA en la sala, no hay nada trabado.',
  },
  {
    job: 'continuar-traslados-pedido', slug: 'trasladar-pedido-erp', cadencia: '* * * * *',
    corridasDia: 1440, sistema: 0,
    motivo: 'Cada minuto, pero sin corrida en curso contesta NADA_QUE_CONTINUAR mirando SOLO la '
          + 'base: cero peticiones al sistema. Cuando hay un despacho a medias, esa corrida sí '
          + 'trabaja —y es exactamente cuando tiene que hacerlo—.',
  },
  {
    job: 'reintentar-ingreso-pedido', slug: 'trasladar-pedido-erp', cadencia: '*/10 * * * *',
    corridasDia: 144, sistema: 0,
    motivo: 'Igual: `recepciones_por_reintentar` es una consulta a la base y devuelve vacío casi '
          + 'siempre. Sólo toca el sistema cuando hay una recepción que se cortó.',
  },
  {
    job: 'continuar-envios', slug: 'enviar-producto-erp', cadencia: '*/10 * * * *',
    corridasDia: 144, sistema: 0,
    motivo: 'Retoma un envío cuyo despacho se cortó por tiempo. NO toca el sistema de origen en '
          + 'la corrida normal: `envios_por_continuar` es una consulta a la base y devuelve vacío '
          + 'casi siempre, porque un envío entero entra en una sola corrida. Cuando hay algo a '
          + 'medias sí trabaja, y es exactamente cuando tiene que hacerlo. '
          + '⚠️ El detector NO lo ve solo: su `net.http_post` vive dentro de '
          + '`continuar_envios_pendientes()` y el comando del cron sólo la llama, así que no '
          + 'aparece en el barrido de `functions/v1/` que arma la lista de crons sin declarar. '
          + 'Está acá a mano, y por eso mismo: un cron que dispara peticiones y que el gate no '
          + 'puede descubrir es el que más falta hace declarar.',
  },
  {
    job: 'avisar-bitacora-por-vencer-30min', slug: 'avisar-bitacora-por-vencer', cadencia: '*/30 13-23,0-1 * * *',
    corridasDia: 26, sistema: 0,
    motivo: 'CERO peticiones al sistema de origen: una consulta a la base y, cuando hay algo por '
          + 'vencerse, un aviso. Cada media hora de 07:00 a 19:30 SV —la ventana en que hay '
          + 'franjas abiertas— porque lo que vigila dura dos horas: espaciarlo a una hora dejaría '
          + 'franjas sin aviso. Su antiduplicado NO lleva los minutos adentro, así que suena una '
          + 'vez por ventana y por día en vez de dos: sobre trece registros diarios, repetir el '
          + 'mismo aviso es la forma más rápida de enseñar a ignorar la campana.',
  },
  {
    job: 'avisar-envios-sin-decidir', slug: null, cadencia: '0 15 * * *',
    corridasDia: 1, sistema: 0,
    motivo: 'No llama a ninguna función: es una consulta y un aviso. Le recuerda a la sala de '
          + 'destino el envío que lleva dos días sin contestar — producto que no está en ninguna '
          + 'de las dos salas y que nadie puede vender mientras tanto.',
  },
  {
    job: 'promociones-ciclo-diario', slug: null, cadencia: '30 13 * * *',
    corridasDia: 1, sistema: 0,
    motivo: 'SQL puro: no llama a ninguna función ni toca el sistema de origen. Cierra los '
          + 'renglones de promoción que terminaron —por lote agotado o por vencimiento— y avisa '
          + 'al 80% y al 100% del lote de CADA SALA. Se declara acá aunque no cueste peticiones '
          + 'porque un cron de SQL puro sin declarar es invisible al gate por construcción: la '
          + 'consulta de la sección B sólo trae de producción los que llaman a functions/v1/ o '
          + 'los ya declarados. Una vez al día a las 7:30 SV, antes de que abran las salas, para '
          + 'que el aviso llegue con margen para pedir un traslado y no cuando ya no hay nada '
          + 'que hacer.',
  },
  {
    job: 'avisar-diferencias-vencidas', slug: null, cadencia: '0 15 * * *',
    corridasDia: 1, sistema: 0,
    motivo: 'No llama a ninguna función: es una consulta y un aviso. Cuando una sala y bodega '
          + 'acuerdan resolver una diferencia EN FÍSICO —bodega manda el producto, o la sala lo '
          + 'devuelve— no queda ningún movimiento en el sistema: lo único que cierra el renglón '
          + 'es que alguien apriete «llegó». El plazo de tres días ya se escribía y NADIE lo '
          + 'leía: la pantalla se lo muestra a quien abre el pedido, que es justo la persona que '
          + 'ya sabe. Avisa al lado que DEBE el movimiento —no a los dos, el que espera ya está '
          + 'esperando— y a supervisión, que es quien puede destrabarlo. Una vez al día a las '
          + '09:00 SV: el plazo es de días, revisarlo cada hora serían 24 lecturas para la misma '
          + 'respuesta, y un aviso a las 17:00 llega cuando ya no hay nada que mover. No repite '
          + 'el mismo renglón dentro de 20 horas.',
  },
  {
    job: 'drain-cliente-erp-queue', slug: 'push-cliente-erp', cadencia: '3,13,23,33,43,53 * * * *',
    corridasDia: 144, sistema: null,
    motivo: 'SIN MEDIR. Vacía la cola de fichas de cliente; con la cola vacía no debería tocar el '
          + 'sistema, pero no está comprobado.',
  },
  {
    job: 'sync-dte-inv-all-1min', slug: 'sync-dte-sales', cadencia: '* 12-23,0-5 * * *',
    corridasDia: 1080, sistema: null,
    motivo: 'SIN MEDIR, y es el segundo candidato después de los cortes: cada minuto, 18 h al día, '
          + 'recorriendo sucursales para ventas e inventario.',
  },
  {
    job: 'refresh-inv-mv-2min', slug: 'sync-dte-sales', cadencia: '*/2 12-23,0-5 * * *',
    corridasDia: 540, sistema: null, motivo: 'SIN MEDIR.',
  },
  {
    job: 'dte-resync-mes-hora', slug: 'sync-dte-sales', cadencia: '0 12-23,0-5 * * *',
    corridasDia: 18, sistema: null, motivo: 'SIN MEDIR.',
  },
  {
    job: 'sync-products-10min', slug: 'sync-products', cadencia: '*/10 * * * *',
    corridasDia: 144, sistema: null, motivo: 'SIN MEDIR.',
  },
  {
    job: 'sync-purchases-10min', slug: 'sync-erp-purchases', cadencia: '*/10 * * * *',
    corridasDia: 144, sistema: null, motivo: 'SIN MEDIR.',
  },
  {
    job: 'check-sales-alerts-5min', slug: 'check-sales-alerts', cadencia: '*/5 12-23,0-5 * * *',
    corridasDia: 216, sistema: 0, motivo: 'Mira la base, no el sistema.',
  },
  {
    job: 'check-sync-health-alerts-20min', slug: 'check-sync-health-alerts', cadencia: '*/20 12-23,0-5 * * *',
    corridasDia: 54, sistema: 0, motivo: 'Mira la base, no el sistema.',
  },
  // ── Los diarios, semanales y mensuales ─────────────────────────────────────
  // Su volumen es irrelevante para el presupuesto (una corrida por día o menos),
  // pero están declarados igual: lo que el gate cuida en ellos es que SIGAN
  // EXISTIENDO y que no fallen en silencio.
  // SQL puro (`slug: null`): no llama a ninguna función ni sale a ningún lado.
  // Está declarado igual para que el cruce contra producción avise si alguien lo
  // apaga — y apagarlo sería justamente perder el recordatorio.
  { job: 'avisar-cambios-que-no-se-quedaron',    slug: null,                          cadencia: '20 12-23,0-5 * * *', corridasDia: 18, sistema: 0, motivo: 'Compara el portal contra lo aprobado y avisa. No toca el sistema de origen.' },
  { job: 'recordar-linea-base-egreso-mensual',  slug: null,                          cadencia: '0 15 1 * *', corridasDia: 0.033, sistema: 0, motivo: 'Mira export_log y avisa. No toca el sistema de origen.' },
  { job: 'sincronizar-fichas-clientes-2130-sv', slug: 'sincronizar-fichas-clientes', cadencia: '30 3 * * *', corridasDia: 1, sistema: null, motivo: 'Corrida nocturna de fichas.' },
  { job: 'regularizar-dte-2230-sv',             slug: 'regularizar-dte',             cadencia: '30 4 * * *', corridasDia: 1, sistema: null, motivo: 'Envío nocturno a Hacienda.' },
  { job: 'cortes-caja-repaso-diario',           slug: 'sync-cortes-caja',            cadencia: '40 5 * * *', corridasDia: 1, sistema: null, motivo: 'Repaso del día, con movimientos forzados.' },
  { job: 'sync-numero-control-daily',           slug: 'sync-numero-control',         cadencia: '0 7 * * *',  corridasDia: 1, sistema: null, motivo: 'Repaso diario.' },
  { job: 'check-purchases-reconciliation-daily', slug: 'check-purchases-reconciliation', cadencia: '20 7 * * *', corridasDia: 1, sistema: null, motivo: 'Cuadre diario de compras.' },
  { job: 'check-sales-reconciliation-daily',    slug: 'check-sales-reconciliation',  cadencia: '30 7 * * *', corridasDia: 1, sistema: null, motivo: 'Cuadre diario de ventas.' },
  { job: 'consolidate-timesheets-daily',        slug: 'consolidate-timesheets',      cadencia: '0 8 * * *',  corridasDia: 1, sistema: 0, motivo: 'Sólo base.' },
  { job: 'sync-purchase-emails-daily',          slug: 'sync-purchase-emails',        cadencia: '0 9 * * *',  corridasDia: 1, sistema: 0, motivo: 'Lee correo, no el sistema.' },
  { job: 'apply-scheduled-employee-events-daily', slug: 'apply-scheduled-employee-events', cadencia: '0 11 * * *', corridasDia: 1, sistema: 0, motivo: 'Sólo base.' },
  { job: 'check-doc-expiry-daily',              slug: 'check-doc-expiry',            cadencia: '0 13 * * *', corridasDia: 1, sistema: 0, motivo: 'Sólo base.' },
  { job: 'check-employee-doc-expiry-daily',     slug: 'check-employee-doc-expiry',   cadencia: '30 13 * * *', corridasDia: 1, sistema: 0, motivo: 'Sólo base.' },
  { job: 'notify-new-products-daily',           slug: 'notify-new-products-daily',   cadencia: '0 14 * * 1-6', corridasDia: 1, sistema: 0, motivo: 'Sólo base.' },
  { job: 'ccf-repaso-22h-sv',                   slug: 'check-sales-alerts',          cadencia: '0 4 * * *',  corridasDia: 1, sistema: 0, motivo: 'Sólo base.' },
  { job: 'heal-dte-sync',                       slug: 'heal-dte-sync',               cadencia: '0 */2 * * *', corridasDia: 12, sistema: null, motivo: 'SIN MEDIR. Repara huecos del sync.' },
  { job: 'backup-critical-tables-weekly',       slug: 'backup-critical-tables',      cadencia: '0 8 * * 0',  corridasDia: 0, sistema: 0, motivo: 'Semanal. Ya estuvo 17 días muerto sin que nadie lo viera.' },
  // Eran DOS sobre la misma función. El de las 06:00 UTC (sábado a medianoche
  // en El Salvador) copiaba, y éste de las 16:00 encontraba todo hecho y salía
  // sin tocar nada: ninguna corrección hecha el sábado se propagaba. Y como
  // `notify_missing_roster` corre a las 15:00 UTC y pregunta si faltan
  // horarios, con la copia de medianoche ya hecha esa alarma no podía sonar
  // NUNCA. El de las 06:00 se apagó el 2026-08-27; queda éste, después de la
  // alarma, que es el orden que el diseño quería.
  { job: 'auto-copy-weekly-roster',             slug: 'auto-copy-weekly-roster',     cadencia: '0 16 * * 6', corridasDia: 0, sistema: 0, motivo: 'Semanal.' },
  { job: 'purchases-fastbackfill-semanal',      slug: 'sync-erp-purchases',          cadencia: '0 9 * * 0',  corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Semanal.' },
  { job: 'auto-calculate-minmax-monthly',       slug: 'auto-calculate-minmax',       cadencia: '0 9 1 * *',  corridasDia: 0, sistema: 0, motivo: 'Mensual, sólo base.' },
  { job: 'corte-z-mensual',                     slug: 'sync-corte-z',                cadencia: '0 9 1 * *',  corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual.' },
  { job: 'dte-resync-month-popular', slug: 'backfill-dte-sales', cadencia: '0 5 1 * *', corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual, una sala.' },
  { job: 'dte-resync-month-salud1',  slug: 'backfill-dte-sales', cadencia: '0 5 1 * *', corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual, una sala.' },
  { job: 'dte-resync-month-salud2',  slug: 'backfill-dte-sales', cadencia: '0 5 1 * *', corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual, una sala.' },
  { job: 'dte-resync-month-salud3',  slug: 'backfill-dte-sales', cadencia: '0 5 1 * *', corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual, una sala.' },
  { job: 'dte-resync-month-salud4',  slug: 'backfill-dte-sales', cadencia: '0 5 1 * *', corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual, una sala.' },
  { job: 'dte-resync-month-salud5',  slug: 'backfill-dte-sales', cadencia: '0 5 1 * *', corridasDia: 0, sistema: null, motivo: 'SIN MEDIR. Mensual, una sala.' },
];

/* Los crons que NO invocan una edge function quedan fuera a propósito: no le
 * piden nada al sistema de origen, y vigilarlos es trabajo de otro gate. */

// ── Utilidades ───────────────────────────────────────────────────────────────
const rojo  = (s) => `\x1b[31m${s}\x1b[0m`;
const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const gris  = (s) => `\x1b[90m${s}\x1b[0m`;

function archivosTs(dir) {
  const out = [];
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js|jsx)$/.test(p)) out.push(p);
    }
  })(dir);
  return out;
}

/* `fetch(` sin plazo.
 *
 * Una edge function vive 150 s (400 en el plan actual). Un `fetch` sin
 * `AbortSignal.timeout` que quede colgado se lleva TODO ese presupuesto y la
 * corrida muere sin hacer su trabajo — y como el cron no espera la respuesta,
 * muere en silencio. Se cuenta por llamada, con el paréntesis balanceado para
 * no confundir el `signal` de la llamada de al lado. */
function fetchsSinPlazo() {
  const hallazgos = [];
  for (const f of archivosTs('supabase/functions').filter(f => f.endsWith('.ts'))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\bfetch\s*\(/g)) {
      let i = m.index + m[0].length, prof = 1;
      while (i < s.length && prof > 0) {
        const c = s[i];
        if (c === '(') prof++; else if (c === ')') prof--;
        i++;
      }
      const llamada = s.slice(m.index, i);
      if (!/AbortSignal\s*\.\s*timeout/.test(llamada))
        hallazgos.push(`${f}:${s.slice(0, m.index).split('\n').length}`);
    }
  }
  return hallazgos;
}

/* Sondeos desde el navegador.
 *
 * El otro lado de la carga: no lo que el portal le pide al sistema de origen,
 * sino lo que le pide a su propia base **una vez por cada pantalla abierta**.
 * Un `setInterval` de 10 s en una vista que alguien deja abierta toda la mañana
 * son ~3.600 consultas por pestaña, y no aparecen en ningún cron.
 *
 * Se cuentan sólo los que tocan la red: un intervalo que hace avanzar un reloj
 * en pantalla no le cuesta nada a nadie. El período se imprime para poder
 * juzgarlos, pero lo que el gate vigila es que no aparezcan más. */
function sondeosDelNavegador() {
  const hallazgos = [];
  for (const f of archivosTs('src')) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/setInterval\s*\(/g)) {
      let i = m.index + m[0].length, prof = 1;
      while (i < s.length && prof > 0) {
        const c = s[i];
        if (c === '(') prof++; else if (c === ')') prof--;
        i++;
      }
      const llamada = s.slice(m.index, i);
      if (!/supabase|fetch\(|fetch[A-Z]|refetch|recargar|cargar[A-Z]|load[A-Z]|invoke\(/.test(llamada)) continue;
      const ms = llamada.match(/,\s*([0-9_*\s]+)\)\s*$/);
      hallazgos.push({
        sitio: `${f}:${s.slice(0, m.index).split('\n').length}`,
        cada: ms ? ms[1].trim() : 'no literal',
      });
    }
  }
  return hallazgos;
}

/* Qué funciones hablan con el sistema de origen. Sale del código —su host o los
 * módulos compartidos que lo envuelven—, no de una lista a mano: una lista a
 * mano se desincroniza el día que alguien escribe una función nueva. */
function funcionesQueTocanElSistema() {
  const out = new Set();
  for (const f of archivosTs('supabase/functions')) {
    const slug = f.split('/')[2];
    const s = readFileSync(f, 'utf8');
    if (/clientesdte3\.oss\.com\.sv|_shared\/erp-/.test(s)) out.add(slug);
  }
  return out;
}

/* Una clave que falta vale INFINITO, no `undefined`.
 *
 * Se llenó sola en la primera corrida con un chequeo nuevo: `Math.min(8,
 * undefined)` es NaN, el baseline quedó con `null` y a la corrida siguiente
 * TODO era mayor que `null`, o sea rojo permanente por un chequeo que estaba
 * bien. Un tope que no existe todavía tiene que dejar pasar y anotarse, no
 * bloquear. */
const TOPES = ['peticionesDia', 'fetchSinPlazo', 'cronsSinMedir', 'sondeosNavegador', 'escriturasInutilesHora'];
const guardado = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : {};
const baseline = Object.fromEntries(TOPES.map(k =>
  [k, Number.isFinite(guardado[k]) ? guardado[k] : Infinity]));

const fallos = [];
const avisos = [];
const medido = {};
let estadoNuevo = null;

// ══ SECCIÓN A · Local, sin red ═══════════════════════════════════════════════
console.log('\n  \x1b[1mA · Lo que se puede ver sin salir a la red\x1b[0m\n');

// A1 · El presupuesto declarado
const conNumero = CRONS.filter(c => c.sistema !== null);
const sinMedir  = CRONS.filter(c => c.sistema === null);
const peticionesDia = conNumero.reduce((n, c) => n + c.corridasDia * c.sistema, 0);
medido.peticionesDia = peticionesDia;
medido.cronsSinMedir = sinMedir.length;

const topeP = baseline.peticionesDia;
console.log(`  peticiones al sistema por día (declaradas): ${peticionesDia.toLocaleString('es')} (tope ${Number(topeP).toLocaleString('es')})`);
for (const c of [...conNumero].filter(c => c.sistema > 0).sort((a, b) => b.corridasDia * b.sistema - a.corridasDia * a.sistema))
  console.log(gris(`      ${String(c.corridasDia * c.sistema).padStart(6)}  ${c.job} — ${c.corridasDia} corridas × ${c.sistema}`));
if (peticionesDia > topeP)
  fallos.push(`el presupuesto de peticiones subió: ${peticionesDia} contra ${topeP}. `
            + 'Si es una cadencia nueva o un costo nuevo, hay que decidirlo, no absorberlo.');

console.log(`\n  crons sin medir su costo: ${sinMedir.length} (tope ${baseline.cronsSinMedir})`);
for (const c of sinMedir) console.log(gris(`      ${c.job} → ${c.slug}`));
if (sinMedir.length > baseline.cronsSinMedir)
  fallos.push(`hay ${sinMedir.length} crons sin medir y el tope es ${baseline.cronsSinMedir}. `
            + 'Un cron nuevo se mide antes de entrar, no después.');

// A2 · `fetch` sin plazo
const sinPlazo = fetchsSinPlazo();
medido.fetchSinPlazo = sinPlazo.length;
console.log(`\n  fetch sin AbortSignal.timeout: ${sinPlazo.length} (tope ${baseline.fetchSinPlazo})`);
for (const h of sinPlazo.slice(0, 8)) console.log(gris(`      ${h}`));
if (sinPlazo.length > 8) console.log(gris(`      … y ${sinPlazo.length - 8} más`));
if (sinPlazo.length > baseline.fetchSinPlazo)
  fallos.push(`hay ${sinPlazo.length} fetch sin plazo y el tope es ${baseline.fetchSinPlazo}. `
            + 'Uno colgado se lleva la corrida entera, y en un cron eso muere en silencio.');

// A4 · Sondeos desde el navegador
const sondeos = sondeosDelNavegador();
medido.sondeosNavegador = sondeos.length;
console.log(`\n  sondeos con red desde el navegador: ${sondeos.length} (tope ${baseline.sondeosNavegador})`);
for (const h of [...sondeos].sort((a, b) => String(a.cada).length - String(b.cada).length))
  console.log(gris(`      cada ${String(h.cada).padStart(9)}  ${h.sitio}`));
if (sondeos.length > baseline.sondeosNavegador)
  fallos.push(`hay ${sondeos.length} sondeos con red en el navegador y el tope es ${baseline.sondeosNavegador}. `
            + 'Cada uno corre una vez por pestaña abierta: no aparece en ningún cron y se multiplica por gente.');

// A3 · Todo cron declarado apunta a una función que existe, y el manifiesto
// sabe cuáles hablan con el sistema.
const enDisco = new Set(readdirSync('supabase/functions', { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_')).map(d => d.name));
const tocan = funcionesQueTocanElSistema();
for (const c of CRONS) {
  // `slug: null` es «no llama a ninguna función»: un cron de SQL puro. Se
  // declara igual —para que el cruce contra producción avise si se apaga— y no
  // se le exige un archivo en disco que por definición no tiene.
  if (c.slug && !enDisco.has(c.slug))
    fallos.push(`el cron ${c.job} apunta a «${c.slug}», que no existe en supabase/functions/. `
              + 'Un slug mal escrito no da error: el cron dispara al vacío para siempre.');
  // `sistema: 0` sobre una función que SÍ sabe hablar con el sistema es casi
  // siempre cierto —lo toca sólo cuando hay trabajo— pero es justo el número
  // que uno pondría por descuido. Se exige que el motivo se haga cargo.
  if (c.sistema === 0 && tocan.has(c.slug) && !/sistema/i.test(c.motivo))
    avisos.push(`${c.job} declara que no toca el sistema, pero ${c.slug} sí lo hace en el código, `
              + 'y el motivo no lo explica.');
}

// ══ SECCIÓN B · Contra producción ════════════════════════════════════════════
if (!SOLO_LOCAL) {
  console.log('\n  \x1b[1mB · Lo que sólo sabe producción\x1b[0m\n');
  let canal;
  try {
    canal = abrirCanal('eficiencia-gate');
    /* Los nombres salen del manifiesto de este archivo, no de afuera: se
     * interpolan porque `consultar` no toma parámetros. El `'x'` de relleno
     * evita un `IN ()` vacío, que no es SQL válido. */
    const sinFuncion = [...CRONS.filter(c => !c.slug).map(c => c.job), 'x']
      .map(j => `'${String(j).replace(/'/g, "''")}'`).join(', ');
    const crons = canal.consultar(`
      SELECT j.jobname, j.schedule, j.active,
             substring(j.command from 'functions/v1/([a-z0-9-]+)') AS slug,
             (SELECT count(*) FROM cron.job_run_details d
               WHERE d.jobid = j.jobid AND d.start_time > now() - interval '24 hours') AS corridas,
             (SELECT count(*) FROM cron.job_run_details d
               WHERE d.jobid = j.jobid AND d.start_time > now() - interval '24 hours'
                 AND d.status <> 'succeeded') AS fallidas,
             (SELECT left(d.return_message, 90) FROM cron.job_run_details d
               WHERE d.jobid = j.jobid AND d.start_time > now() - interval '24 hours'
                 AND d.status <> 'succeeded'
               ORDER BY d.start_time DESC LIMIT 1) AS ultimo_fallo
        FROM cron.job j
       -- Los que llaman a una edge function, MÁS los declarados que no llaman a
       -- ninguna. Sin la segunda mitad, un cron de SQL puro —un aviso, una
       -- purga— se podía declarar en el manifiesto y el cruce contra producción
       -- lo daba por apagado siempre, porque ni siquiera lo traía.
       WHERE j.command ILIKE '%functions/v1/%'
          OR j.jobname IN (${sinFuncion})`);

    /* «Contestó bien» es 2xx, NO exactamente 200.
     *
     * Con `IS DISTINCT FROM 200` este chequeo se ponía rojo cuando el sistema
     * funcionaba: `trasladar-pedido-erp` responde **202** con
     * `{"ok":true,"aceptado":true,"background":true}` — es el modo de fondo que
     * se diseñó a propósito para que un traslado grande no muera contra el
     * plazo de 150s de una edge function. O sea que despachar un pedido grande
     * bastaba para reprobar el gate. Y un gate que se pone rojo cuando todo
     * anda es un gate que se termina ignorando, que es justo lo que el
     * CLAUDE.md advierte de la sección de tiempos.
     *
     * Se sigue trayendo el desglose por código para que un 202 que aparezca
     * donde nadie lo espera se pueda ver igual: acotar el fallo no es lo mismo
     * que dejar de mirar. */
    const salientes = canal.consultar(`
      -- no_ok cuenta sólo lo que RECIBIÓ una respuesta con código malo. El
      -- "status_code IS NULL" estaba adentro y hacía que una llamada colgada
      -- disparara DOS chequeos por el mismo evento: el suyo y éste. Peor, el
      -- mensaje de éste dice "un 401 acá significa que una función volvió a
      -- quedar con verify_jwt" — o sea que un tropiezo de DNS se leía como un
      -- fallo de autenticación que nunca existió, y mandaba a revisar el lugar
      -- equivocado. Las que no respondieron ya las cuenta "colgadas".
      -- (Sin backticks a propósito: esto vive dentro de un template literal de
      -- JavaScript y un backtick lo cierra en silencio.)
      SELECT count(*) FILTER (WHERE status_code IS NOT NULL
                                AND status_code NOT BETWEEN 200 AND 299) AS no_ok,
             count(*) FILTER (WHERE status_code BETWEEN 201 AND 299) AS otros_2xx,
             count(*) FILTER (WHERE timed_out) AS colgadas,
             count(*) AS total,
             min(created)::text AS desde,
             (SELECT string_agg(x.linea, ' · ' ORDER BY x.n DESC) FROM (
                SELECT coalesce(status_code::text, 'sin respuesta') || '×' || count(*) AS linea,
                       count(*) AS n
                  FROM net._http_response
                 WHERE created > now() - interval '24 hours'
                   AND (status_code NOT BETWEEN 200 AND 299 OR status_code IS NULL)
                 GROUP BY status_code) x)                            AS desglose_malos
        FROM net._http_response WHERE created > now() - interval '24 hours'`);

    const porNombre = new Map(crons.map(c => [c.jobname, c]));
    const declarados = new Set(CRONS.map(c => c.job));
    // Cuántas corridas de cron fallaron en la ventana. Lo usa B3 para no acusar
    // a los crons de algo que no hicieron — ver el comentario de allá.
    let corridasFallidas = 0;

    // B1 · Un cron que nadie declaró
    for (const c of crons) {
      if (!c.active) continue;
      if (!declarados.has(c.jobname))
        fallos.push(`el cron ${c.jobname} (${c.schedule} → ${c.slug}) está activo y NO está en el manifiesto. `
                  + 'Su costo no lo está mirando nadie.');
    }

    // B2 · Cadencia y existencia de lo declarado
    for (const d of CRONS) {
      const p = porNombre.get(d.job);
      if (!p || !p.active) {
        fallos.push(`el cron ${d.job} está declarado y NO está activo en producción. `
                  + 'Una protección que se apagó sola no avisa: hay que decidir si vuelve o se borra del manifiesto.');
        continue;
      }
      if (p.schedule !== d.cadencia)
        fallos.push(`el cron ${d.job} cambió de cadencia: declarada «${d.cadencia}», en producción «${p.schedule}». `
                  + 'Si el cambio es a propósito, el manifiesto y su motivo se actualizan en el mismo commit.');
      /* ── Fallar por una tasa, no por un tropiezo ────────────────────────
       *
       * La primera corrida de este gate se puso roja por 4 corridas fallidas, y
       * las 4 eran `job startup timeout` en dos minutos de la tarde anterior,
       * repartidas entre crons distintos: el planificador no pudo arrancar el
       * trabajo, nada que ver con el trabajo en sí. Sobre 2.863 corridas eso es
       * 0,07%.
       *
       * Un gate que se pone rojo por eso es un gate que alguien va a empezar a
       * saltear —y entonces deja de proteger justo cuando importe—. Lo que sí
       * tiene que ser rojo es lo SOSTENIDO: una función que quedó con el JWT
       * puesto falla el 100% de las veces, no el 0,07%. */
      const tasa = Number(p.corridas) ? Number(p.fallidas) / Number(p.corridas) : 0;
      // Sólo suma lo SOSTENIDO. Un `job startup timeout` suelto no llegó a hacer
      // ninguna llamada saliente, así que no puede ser evidencia sobre ellas —
      // ver `cuentaComoCronRoto`. Antes contaba crudo y ponía en rojo a B3 por
      // los mismos tropiezos que esta sección imprime como aviso.
      corridasFallidas += cuentaComoCronRoto({ fallidas: p.fallidas, corridas: p.corridas });
      if (Number(p.fallidas) > 0 && tasa > 0.05)
        fallos.push(`el cron ${d.job} falló en ${p.fallidas} de ${p.corridas} corridas `
                  + `(${(tasa * 100).toFixed(1)}%): ${p.ultimo_fallo ?? 'sin mensaje'}`);
      else if (Number(p.fallidas) > 0)
        avisos.push(`${d.job}: ${p.fallidas} de ${p.corridas} corridas fallidas `
                  + `(${(tasa * 100).toFixed(2)}%, por debajo del 5% que pone esto en rojo) — ${p.ultimo_fallo ?? 'sin mensaje'}`);
      // Un cron que debería haber corrido y no corrió ni una vez.
      if (d.corridasDia >= 24 && Number(p.corridas) === 0)
        fallos.push(`el cron ${d.job} no corrió NI UNA VEZ en 24 h y debería correr ~${d.corridasDia}. `
                  + 'El silencio no es éxito.');
    }

    /* ── B0 · Amplificación de escritura ────────────────────────────────
     *
     * La sección que no necesita manifiesto: la base misma dice cuántas veces
     * se reescribió cada fila. `n_tup_upd` contra `n_tup_ins` y el porcentaje
     * HOT son suficientes para ver una tabla que se está reescribiendo sola.
     *
     * Se escribió el 2026-08-20 y encontró tres cosas en su primera corrida:
     * `impresion_dispositivos` con **101.984 escrituras sobre 6 filas** (el
     * latido de las cajas, ~1,1 por segundo), `purchase_receipt_items` con
     * 4.911 para 121 inserciones y **0% HOT**, y `purchase_receipts` con 1.384
     * para 10. Las tres llevaban meses así y ninguna dio nunca un error.
     *
     * El 0% HOT es la parte que más duele y la que menos se ve: una escritura
     * no-HOT rehace también las entradas de índice, así que cuesta varias veces
     * lo que parece.
     *
     * El tope es el total de escrituras inútiles —las que no vinieron con una
     * inserción— y sólo baja. Las tablas de sesión y de latido quedan fuera de
     * la lista negra pero DENTRO del total: son legítimas escribiendo seguido,
     * pero no por eso pueden crecer sin que nadie mire. */
    /* Se mide una TASA, no un total.
     *
     * `n_tup_upd` es acumulativo desde que arrancó el servidor, así que un tope
     * absoluto fallaría en la corrida siguiente por el solo paso del tiempo —el
     * error clásico de vigilar un contador—. La ventana sale de la base:
     * `pg_postmaster_start_time()`. Comprobado el 2026-08-20: 102.766
     * escrituras sobre 21,8 h dan 1,31 por segundo, y la medición directa
     * contra el reloj había dado ~1,1. Sirve.
     *
     * Efecto secundario que conviene saber: como el contador arrastra lo de
     * antes, después de un arreglo la tasa BAJA de a poco en vez de saltar. Lo
     * que se ve enseguida es la medición directa (dos lecturas separadas por un
     * minuto); esto es la vista larga. */
    const churn = canal.consultar(`
      SELECT relname AS tabla, n_tup_ins AS ins, n_tup_upd AS upd,
             coalesce(round(100.0 * n_tup_hot_upd / nullif(n_tup_upd,0)), 100) AS pct_hot,
             n_live_tup AS filas,
             round(extract(epoch FROM (now() - pg_postmaster_start_time()))/3600) AS horas
        FROM pg_stat_user_tables
       WHERE n_tup_upd > 500 AND n_tup_upd > n_tup_ins * 3
       ORDER BY n_tup_upd DESC LIMIT 20`);
    /* La tasa se mide entre DOS LECTURAS de este gate, no dividiendo el
     * acumulado por el tiempo encendido.
     *
     * La primera versión hacía eso último y quedó roja el mismo día que se
     * arreglaron tres tablas: el contador arrastra todo lo anterior al arreglo,
     * así que la tasa baja de a poco y mientras tanto cualquier actividad normal
     * la empuja arriba del tope. O sea que el instrumento acusaba una regresión
     * que no existía — y un gate que se pone rojo por su propia aritmética es
     * peor que no tenerlo.
     *
     * Entre dos lecturas, en cambio, se ve exactamente lo que pasó en el medio.
     * `_estado` no es un tope: es la lectura anterior, y se refresca en cada
     * corrida. Si el contador bajó, el servidor reinició y no hay nada que
     * comparar: se vuelve a anotar y se dice. */
    const VENTANA_MINIMA_H = 6;
    const crudo = churn.reduce((n, t) => n + Math.max(0, Number(t.upd) - Number(t.ins)), 0);
    const prev = existsSync(ESTADO_FILE)
      ? JSON.parse(readFileSync(ESTADO_FILE, 'utf8'))
      : null;
    const horasDesde = prev?.medidoEn
      ? (Date.now() - Date.parse(prev.medidoEn)) / 3_600_000
      : 0;
    let inutilesHora = null;
    if (!prev || crudo < Number(prev.crudo ?? 0)) {
      console.log(`\n  escrituras sin inserción: ${gris('primera lectura (o el servidor reinició) — se anota y se compara en la próxima')}`);
    } else if (horasDesde < VENTANA_MINIMA_H) {
      /* SEIS HORAS, y el número no es una corazonada — es el tamaño que hace
       * falta para que un golpe diario no mande.
       *
       * La ventana empezó en 2 minutos, pasó a 6 y después a 15, cada vez
       * porque la tasa saltaba: la misma base dio 619/h sobre seis minutos y
       * 1.330/h sobre dos. Quince tampoco alcanzaba, y el 2026-09-02 se midió
       * POR QUÉ en vez de volver a estimarlo.
       *
       * `refresh-product-sales-rollup-daily` corre a las 06:30 UTC, dura 3.2
       * segundos y reescribe `product_sales_rollup` entera: 2.550 de las 9.972
       * escrituras sin inserción de un día completo — el 26% — en TRES
       * SEGUNDOS. Una ventana de 15 minutos que lo contenga lee 10.200/h de esa
       * sola tabla; cualquier otra lee 0. El tope es 1.240. O sea que el
       * veredicto no lo decidía la base: lo decidía si la corrida anterior del
       * gate cayó antes o después de las 06:30.
       *
       * Ya había dejado dos rojos falsos anotados (2.752/h y 2.262/h, los dos
       * verdes al remedir), que es exactamente cómo un gate se termina
       * salteando con `--no-verify`.
       *
       * Con seis horas ese mismo golpe aporta 425/h como mucho. No lo alisa del
       * todo —para eso harían falta 24— pero lo deja por debajo del ruido, y a
       * cambio el gate sigue pudiendo juzgar dentro de un día de trabajo.
       *
       * Que difiera el veredicto NO es que dé verde sin medir: la lectura
       * anterior no se pisa (ver abajo), así que la ventana CRECE hasta que
       * alcanza. Lo que sigue pendiente, y es la corrección de fondo: declarar
       * el churn INTENCIONAL con su motivo —el rollup diario y el latido de las
       * 6 cajas de `impresion_dispositivos`, que juntos son el 68% del total y
       * ninguno de los dos es «una tabla que se reescribe sola»— y bajar el
       * tope a lo que quede. Eso exige medir el resto sobre una ventana larga,
       * y un número así no se inventa en una sesión. */
      console.log(`\n  escrituras sin inserción: ${gris(`pasaron ${Math.round(horasDesde * 60)} min desde la lectura anterior — hacen falta ${VENTANA_MINIMA_H * 60} para que la tasa signifique algo`)}`);
    } else {
      inutilesHora = Math.round((crudo - Number(prev.crudo)) / horasDesde);
      medido.escriturasInutilesHora = inutilesHora;
      console.log(`\n  escrituras sin inserción por hora: ${inutilesHora.toLocaleString('es')} `
                + `(tope ${Number(baseline.escriturasInutilesHora).toLocaleString('es')}) `
                + gris(`· medido contra la lectura de hace ${horasDesde.toFixed(1)} h`));
    }
    /* La lectura anterior se pisa SÓLO si esta corrida logró juzgar.
     *
     * Refrescarla siempre tenía una consecuencia que no se ve leyendo el código:
     * como el pre-commit corre este gate en todo commit que toca una migración,
     * dos commits seguidos dejan una ventana de un par de minutos — o sea por
     * debajo del cuarto de hora que la tasa necesita— y el gate pasa de largo
     * la sección de escrituras. **Da verde por no haber podido medir**, que es
     * justamente lo que este repo tiene escrito que un gate no puede hacer.
     *
     * Conservándola, la ventana CRECE hasta que alcanza para juzgar y recién
     * ahí se reinicia. El gate converge en vez de volver a empezar. */
    if (inutilesHora !== null || !prev || crudo < Number(prev.crudo ?? 0))
      estadoNuevo = { crudo, medidoEn: new Date().toISOString() };
    else
      console.log(gris('      (no se pisa la lectura anterior: la ventana sigue creciendo '
                     + 'hasta que alcance para juzgar)'));
    const horas = Math.max(Number(churn[0]?.horas ?? 1), 1);
    // El desglose por tabla va con la vista LARGA —el acumulado desde que
    // arrancó el servidor— porque sirve para reconocer al culpable, no para
    // juzgar. Quien juzga es la tasa entre lecturas de arriba.
    console.log(gris('      (desglose desde que arrancó el servidor, para ubicar de dónde sale)'));
    for (const t of churn.slice(0, 6))
      console.log(gris(`      ${String(Math.round(t.upd / horas)).padStart(6)}/h sobre ${String(t.filas).padStart(6)} filas `
                + `· ${String(t.ins).padStart(5)} inserciones · ${String(t.pct_hot).padStart(3)}% HOT  ${t.tabla}`));
    if (inutilesHora !== null && inutilesHora > baseline.escriturasInutilesHora)
      fallos.push(`las escrituras sin inserción subieron a ${inutilesHora}/h contra ${baseline.escriturasInutilesHora}/h. `
                + 'Una tabla que se reescribe sola no da error nunca: gasta WAL, ensucia los índices y '
                + 'hace trabajar al autovacuum por nada. Y el 0% HOT es la parte cara: esa escritura '
                + 'rehace también las entradas de índice.');

    // B3 · Las llamadas salientes
    const s = salientes[0] ?? {};
    console.log(`  llamadas salientes en la ventana que guarda la base: ${Number(s.total ?? 0).toLocaleString('es')} `
              + gris(`(desde ${s.desde ?? '?'})`));
    console.log(`      fuera de 2xx: ${s.no_ok ?? '?'}`
              + (Number(s.otros_2xx ?? 0) > 0 ? gris(`  ·  2xx que no son 200: ${s.otros_2xx} (aceptado: el modo de fondo responde 202)`) : '')
              + `  ·  colgadas por plazo: ${s.colgadas ?? '?'}`);
    if (s.desglose_malos) console.log(gris(`      ${s.desglose_malos}`));
    const veredicto = clasificarSalientes({
      noOk: Number(s.no_ok ?? 0), total: Number(s.total ?? 0),
      corridasFallidas, desglose: s.desglose_malos,
    });
    if (veredicto.nivel === 'rojo')  fallos.push(veredicto.mensaje);
    if (veredicto.nivel === 'aviso') avisos.push(veredicto.mensaje);
    // ── Colgadas: por TASA, no por tropiezo ─────────────────────────────────
    // Acá había tolerancia cero, y el 2026-08-24 puso el gate en rojo por UNA
    // llamada de 1.931 (0,052%). Mirada de cerca era un fallo de DNS —55.001 ms
    // enteros resolviendo el nombre, 0 en handshake y 0 en la petición—, o sea
    // que la llamada nunca llegó a ninguna función. No es un defecto del portal:
    // es la red.
    //
    // Y el propio gate ya tiene escrito el criterio correcto para los crons: «se
    // mide por TASA, no por tropiezo — un `job startup timeout` suelto es un
    // aviso, el 5% es rojo». Esto es lo mismo un piso más abajo, y quedaba
    // inconsistente.
    //
    // ⚠️ El umbral NO se sube para que calle. Está en 1% —veinte veces el
    // tropiezo medido y cinco veces más estricto que la regla de los crons— y el
    // conteo se imprime SIEMPRE, así que una sola colgada se sigue viendo aunque
    // no bloquee. Si sube de ahí, es que algo se rompió de verdad.
    //
    // Lo que NO se relaja es el «fuera de 2xx»: un 401 significa que una función
    // volvió a quedar con `verify_jwt` y el cron falla ANTES de ejecutar una
    // línea. Eso es sistemático desde el primer caso, nunca ruido.
    const TASA_COLGADAS_MAX = 1;
    const pctColgadas = Number(s.total ?? 0) > 0
      ? (100 * Number(s.colgadas ?? 0)) / Number(s.total) : 0;
    if (Number(s.colgadas ?? 0) > 0)
      console.log(gris(`      colgadas: ${pctColgadas.toFixed(3)}% de ${s.total} `
                     + `(tope ${TASA_COLGADAS_MAX}%) — un fallo de DNS no llega a la función`));
    if (pctColgadas > TASA_COLGADAS_MAX)
      fallos.push(`${s.colgadas} de ${s.total} llamadas salientes se colgaron hasta el plazo `
                + `(${pctColgadas.toFixed(2)}%, tope ${TASA_COLGADAS_MAX}%). `
                + 'A esta tasa ya no es la red: mirar si una función quedó sin responder.');

    // Cuánto se disparó de verdad, contra lo declarado.
    /* Los disparos REALES incluyen los que la condición horaria del propio cron
     * descarta sin llamar a nadie —`cortes-caja-30s` dispara 2.864 veces y sólo
     * ~1.920 caen dentro de su ventana de 7 a 22—, así que los dos números no
     * tienen por qué coincidir. Se imprimen juntos igual: la diferencia entre
     * ellos ES la ventana, y verla de vez en cuando evita creer que un cron
     * corre menos de lo que corre. */
    console.log('\n  disparos reales en 24 h contra las corridas declaradas (útiles):');
    for (const d of [...CRONS].sort((a, b) => b.corridasDia - a.corridasDia).slice(0, 6)) {
      const p = porNombre.get(d.job);
      if (p) console.log(gris(`      ${String(p.corridas).padStart(5)} reales · ${String(d.corridasDia).padStart(5)} declaradas  ${d.job}`));
    }
  } catch (e) {
    fallos.push(`no se pudo consultar producción: ${e.message}${e.detalleCli ? `\n${e.detalleCli}` : ''}`);
  } finally {
    canal?.cerrar();
  }
}

// ══ Cierre ═══════════════════════════════════════════════════════════════════
/* El estado se guarda SIEMPRE, aunque no se regenere el baseline: sin la
 * lectura anterior no hay tasa que medir la próxima vez. Los topes, en cambio,
 * sólo se tocan con `--update-baseline`. */
if (estadoNuevo && !SOLO_LOCAL)
  writeFileSync(ESTADO_FILE, JSON.stringify(estadoNuevo, null, 2) + '\n');

if (REGENERAR) {
  const nuevo = {
    // Una clave que esta corrida no midió (p. ej. `--hook`, que no sale a la
    // red) conserva su tope: regenerar no puede ser una forma de borrarlo.
    ...Object.fromEntries(TOPES.map(k => [k,
      Number.isFinite(medido[k])
        // La tasa de escrituras se mide en una ventana corta y es ruidosa: una
        // ráfaga normal la sube. Su tope se pone al DOBLE de lo medido, con el
        // mismo criterio que los tiempos de `gate:perf` — vigila que algo no
        // vuelva a costar miles, no que baje de 619 a 600. Los demás son
        // conteos exactos y van tal cual.
        ? Math.min(k === 'escriturasInutilesHora' ? medido[k] * 2 : medido[k], baseline[k])
        : baseline[k]])),
    nota: 'Sólo BAJA. Un número que sube es una decisión, y una decisión se escribe en el manifiesto '
        + 'con su motivo — no se absorbe regenerando este archivo.',
    actualizado: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(BASELINE_FILE, JSON.stringify(nuevo, null, 2) + '\n');
  console.log(`\n  baseline actualizado: ${JSON.stringify({ ...nuevo, nota: undefined })}`);
}

if (avisos.length) {
  console.log('\n  \x1b[33m⚠ Para mirar\x1b[0m');
  for (const a of avisos) console.log(`      · ${a}`);
}

if (fallos.length) {
  console.log(`\n${rojo('  ✗ gate:eficiencia en rojo')}\n`);
  for (const f of fallos) console.log(`      · ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`\n${verde('  ✓ gate:eficiencia en verde')}\n`);

