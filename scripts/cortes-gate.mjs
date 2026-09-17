#!/usr/bin/env node
/**
 * gate:cortes — el efectivo del cajón contra el esperado del corte.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 * El 2026-09-02 el portal anunció **+$78.40 de sobrante** en Salud 4 sobre un
 * corte que en realidad tenía un **faltante de $9.85**. La causa: cobrar un
 * crédito desde el portal mete efectivo en el cajón, pero el sistema de origen
 * lo registra sólo como movimiento del día — no lo suma a INGRESOS ni a la
 * línea COBROS CREDITO, o sea a ninguno de los dos términos de
 * `TOTAL CAJA = INGRESOS + VENTA − VALES + COBROS`. El esperado nacía corto y
 * el conteo de la sala aparecía como un sobrante que nadie hizo.
 *
 * Ninguna de las capas que ya existían podía verlo, y la ceguera es
 * estructural: los tests unitarios miden la aritmética con cortes inventados y
 * eso estaba bien; `gate:data` mira tipos de columna; `gate:perf` mira
 * velocidad. **Nadie comparaba el dinero que entró al cajón contra el dinero
 * que el esperado cuenta**, que es la única pregunta que delata este defecto.
 *
 * Y el modo de falla es el silencio: no hay error, no falta ninguna fila, la
 * cifra se ve razonable, y quien la lee no tiene cómo saber que el papel que
 * tiene en la mano no cuenta todo lo que hay en la caja.
 *
 * ── Lo que mide, y por qué esas tres cosas ──────────────────────────────────
 *
 *   A. El efectivo del cajón está contado. Por sala y por día, los movimientos
 *      «POR ABONO A CREDITO» VIVOS del origen contra lo que el mejor corte del
 *      día llega a contar. Es la pregunta general —vale para una fuente de
 *      efectivo que nadie previó, no sólo para los cobros del portal— y es la
 *      que habría cazado el 2-sep.
 *
 *   B. La suma del comprobante cierra. `subtotal − vales + cobros = total_caja`
 *      en todos los cortes. Sobre ese despeje se apoya la corrección: es de ahí
 *      que sale «cuánto contó el comprobante», y si alguna vez deja de cerrar,
 *      la corrección estaría restando un número que no significa lo que cree.
 *
 *   C. El sello está al día. `cobros_portal_efectivo` de cada corte contra lo
 *      que la base calcula hoy. Vigila el MECANISMO —los dos triggers— y no el
 *      resultado: un trigger que alguien borra no da ningún error, deja el
 *      número viejo, y el portal vuelve a mentir exactamente igual que antes.
 *
 *   E. Ningún movimiento está anotado dos veces. Dos detectores, porque el
 *      duplicado entra por dos puertas distintas: el mismo número de boleta
 *      repetido en la sala con el MISMO sentido, y la ráfaga —dos movimientos
 *      idénticos en 15 segundos— que es la única forma de ver el duplicado
 *      cuando el movimiento no lleva boleta. Existe porque los frenos que se
 *      pusieron el 17-sep son PREVENCIÓN, y prevención sin vigilancia es una
 *      creencia: si mañana entra un duplicado por un camino que nadie previó,
 *      esto lo dice.
 *
 * ── Dos decisiones de medición, las dos costaron ────────────────────────────
 *
 *   · Los movimientos con `desaparecido_at` NO cuentan. El origen no anula:
 *     borra. El 1-sep en Salud 1 un abono de $54.99 se borró a las 15:04 y el
 *     corte de esa hora cerró en 0.00 — correcto. Contándolo, este gate habría
 *     abierto un hallazgo contra un corte impecable. Acusar a quien hizo bien
 *     el trabajo es cómo un gate se termina desactivando.
 *
 *   · El corte de referencia es el que MÁS llega a contar en el día, no el
 *     último. Los cortes son acumulativos, pero hay cortes de apertura de turno
 *     que declaran 0.00 (Salud 4 tiene uno el mismo 2-sep, id 669): tomando «el
 *     último» la referencia sería ése.
 *
 * Verificado sobre las 493 filas capturadas: A falla en UN sala-día de toda la
 * historia —el del 2-sep— y en ninguno más; B cierra 493 de 493. O sea que el
 * cero no es un cero de instrumento apagado: es el número que hay.
 */
import { abrirCanal } from './lib/canal-supabase.mjs';

const CENTAVO = 0.005;
const money = (n) => `$${Number(n).toFixed(2)}`;

/* A. Efectivo que entró al cajón y ningún corte del día llega a contar.
 *
 * `conto` suma las dos vías por las que un cobro puede estar contado: el
 * renglón del comprobante (despejado de su propia suma, que es la cifra que no
 * depende de haber podido leer la línea) y el sello del portal. */
const SQL_SIN_CONTAR = `
WITH mov AS (
  SELECT branch_id, fecha,
         coalesce(sum(monto) FILTER (
           WHERE tipo = 'ENTRADA'
             AND concepto ILIKE '%ABONO A CREDITO%'
             AND desaparecido_at IS NULL), 0) AS en_el_cajon
    FROM public.cortes_caja_movimientos
   GROUP BY 1, 2
), tope AS (
  SELECT branch_id, fecha,
         max(round(tk_total_caja - tk_subtotal + tk_vales, 2)
             + cobros_portal_efectivo) AS conto
    FROM public.cortes_caja
   WHERE tipo = 'C' AND estado <> 'DESCARTADO' AND tk_total_caja IS NOT NULL
   GROUP BY 1, 2
)
SELECT b.name AS sala, t.fecha::text AS fecha,
       m.en_el_cajon::text AS en_el_cajon, t.conto::text AS conto,
       round(m.en_el_cajon - t.conto, 2)::text AS sin_contar
  FROM mov m
  JOIN tope t ON t.branch_id = m.branch_id AND t.fecha = m.fecha
  JOIN public.branches b ON b.id = m.branch_id
 WHERE round(m.en_el_cajon - t.conto, 2) > 0.005
 ORDER BY t.fecha DESC, b.name`;

/* B. La suma del comprobante contra su propio total. */
const SQL_SUMA = `
SELECT b.name AS sala, c.fecha::text AS fecha, c.hora::text AS hora, c.id::text AS id,
       round(c.tk_subtotal - c.tk_vales + coalesce(c.tk_cobros_credito, 0) - c.tk_total_caja, 2)::text AS desvio
  FROM public.cortes_caja c
  JOIN public.branches b ON b.id = c.branch_id
 WHERE c.tipo = 'C' AND c.tk_total_caja IS NOT NULL
   AND c.tk_subtotal IS NOT NULL AND c.tk_vales IS NOT NULL
   AND abs(c.tk_subtotal - c.tk_vales + coalesce(c.tk_cobros_credito, 0) - c.tk_total_caja) >= 0.005
 ORDER BY c.fecha DESC, b.name`;

/* C. El sello contra lo que la base calcula hoy. */
const SQL_SELLO = `
SELECT b.name AS sala, c.fecha::text AS fecha, c.hora::text AS hora, c.id::text AS id,
       c.cobros_portal_efectivo::text AS sellado,
       public.cobros_portal_en_efectivo(c.branch_id, c.fecha, c.hora)::text AS de_verdad
  FROM public.cortes_caja c
  JOIN public.branches b ON b.id = c.branch_id
 WHERE c.cobros_portal_efectivo IS DISTINCT FROM
       public.cobros_portal_en_efectivo(c.branch_id, c.fecha, c.hora)
 ORDER BY c.fecha DESC, b.name`;

/* D. Días CERRADOS que se llevaron efectivo sin contar.
 *
 * Es la otra mitad de A y pregunta algo distinto: A mira si el esperado del
 * corte deja fuera dinero que entró; ésta mira si el día se CERRÓ con dinero
 * que ningún corte llegó a medir. Un día así ya no se puede arreglar —la caja
 * no vuelve a abrir y el cierre no se deshace—, así que el gate no lo previene:
 * lo NOMBRA, que es lo único que queda.
 *
 * Existe porque el freno vive en `hacer-corte-caja` y en la pantalla, y los dos
 * se pueden esquivar: un corte hecho desde el sistema de la caja no pasa por
 * ninguno. Si esto vuelve a dar un número, el freno no está alcanzando.
 *
 * Usa el MISMO juez que el freno (`caja_falta_por_contar`), no una copia: dos
 * respuestas distintas sobre la misma pregunta es exactamente lo que este
 * archivo existe para evitar.
 *
 * `>= 0.01` y no `> 0.005`: el freno del servidor usa ese corte, y el gate no
 * puede acusar a un cierre que el freno habría dejado pasar.
 *
 * Medido el 6-sep sobre los 143 cierres de 45 días: **dos**, los dos anteriores
 * al freno. Van en `YA_PASADOS` porque un hallazgo histórico que no se puede
 * reparar no puede dejar el gate en rojo para siempre — pero se declaran con su
 * monto y su motivo, no se borran: son la única prueba de que el detector ve
 * algo. Fabricarle la regresión salió gratis, y funcionó: el segundo lo encontró
 * él, no yo.
 *
 *   · Salud 2, 6-sep   $159.39  — 25 ventas, el pago de CAESS y una inyección,
 *     seis horas después de su único corte confirmado. Es el caso que originó
 *     el freno.
 *   · Salud 1, 17-ago  $11.55   — anotaron un ingreso de $11.55 después del
 *     corte confirmado de las 22:01, rehicieron el corte (que ya daba exacto) y
 *     **descartaron ése**, dejando confirmado el del sobrante. Cerraron a las
 *     22:03.
 *
 * Una entrada nueva acá NO se agrega para que el gate calle: sólo para un día
 * ya cerrado que no se puede reparar, y con el monto escrito. */
const YA_PASADOS = new Set(['Salud 2/2026-09-06', 'Salud 1/2026-08-17']);

const SQL_CERRO_SIN_CONTAR = `
SELECT b.name AS sala, z.fecha::text AS fecha, z.hora::text AS hora,
       (public.caja_falta_por_contar(z.branch_id::int, z.fecha)->>'falta')::text AS falta,
       coalesce(public.caja_falta_por_contar(z.branch_id::int, z.fecha)->>'desde', '—') AS desde
  FROM public.cortes_caja z
  JOIN public.branches b ON b.id = z.branch_id
 WHERE z.tipo = 'Z'
   AND coalesce((public.caja_falta_por_contar(z.branch_id::int, z.fecha)->>'falta')::numeric, 0) >= 0.01
 ORDER BY z.fecha DESC, b.name`;

/* E. Movimientos de caja anotados dos veces.
 *
 * ── Los dos detectores, y por qué hacen falta los dos ───────────────────────
 *
 *   · **Boleta repetida.** El número de una boleta de POS es el ID de la
 *     transacción: el aparato no lo repite nunca. Así que el mismo número, en
 *     la misma sala y con el MISMO sentido, es la misma operación anotada dos
 *     veces. El sentido CONTRARIO no cuenta: ésa es la corrección de un
 *     movimiento anotado al revés —una remesa entra al cajón cuando en realidad
 *     sale— y es legítima; las tres reales lo dicen en el concepto.
 *
 *   · **Ráfaga.** Dos movimientos idénticos separados por 15 segundos o menos.
 *     Es la única manera de ver el duplicado cuando NO hay boleta, y es la
 *     firma exacta del defecto del 17-sep: los pares reales estaban a 34-73 ms
 *     y uno tenía tres filas en un segundo.
 *
 * ── Por qué 15 segundos y no «el mismo día» ─────────────────────────────────
 *
 * Porque hay movimientos que se repiten DE VERDAD: la aplicación de una
 * inyección y la prueba de glucosa son $1, y una sala hace varias por día —
 * ocho en Salud 4 el 14-sep—. Medido: con el corte en 15 s, esos 55 grupos no
 * disparan ni una vez, y los 10 duplicados verdaderos caen todos adentro. Una
 * regla de «mismo monto y concepto el mismo día» los acusaría a todos, y un
 * gate que acusa a quien hizo bien el trabajo se termina desactivando.
 *
 * Sólo mira los VIGENTES: un duplicado que ya se anuló está resuelto, y volver
 * a nombrarlo sería pedir que se arregle dos veces.
 */
const SQL_DUPLICADOS = `
WITH vivos AS (
  SELECT m.id, m.branch_id, m.fecha, m.tipo, m.tipo_codigo, m.monto, m.concepto,
         m.registrado_at,
         ltrim(regexp_replace(coalesce(m.numero_boleta, ''), '\\D', '', 'g'), '0') AS num
    FROM public.caja_movimientos_portal m
   WHERE m.anulado_at IS NULL
),
por_boleta AS (
  SELECT branch_id, min(fecha) AS fecha, 'boleta repetida'::text AS regla,
         ('boleta ' || num || ' anotada ' || count(*) || ' veces como ' || lower(tipo))::text AS detalle,
         array_agg(id ORDER BY id) AS ids
    FROM vivos WHERE num <> ''
   GROUP BY branch_id, num, tipo
  HAVING count(*) > 1
),
por_rafaga AS (
  SELECT branch_id, fecha, 'ráfaga'::text AS regla,
         (count(*) || ' movimientos iguales en '
           || round(extract(epoch FROM (max(registrado_at) - min(registrado_at)))::numeric, 1)
           || ' s: ' || left(concepto, 40) || ' por $' || to_char(monto, 'FM999990.00'))::text AS detalle,
         array_agg(id ORDER BY registrado_at) AS ids
    FROM vivos
   GROUP BY branch_id, fecha, tipo_codigo, monto, concepto
  HAVING count(*) > 1
     AND extract(epoch FROM (max(registrado_at) - min(registrado_at))) <= 15
)
SELECT b.name AS sala, d.fecha::text AS fecha, d.regla, d.detalle,
       array_to_string(d.ids, ', ') AS ids
  FROM (SELECT * FROM por_boleta UNION ALL SELECT * FROM por_rafaga) d
  JOIN public.branches b ON b.id = d.branch_id
 ORDER BY d.fecha DESC, b.name`;

/* Lo que ya estaba cuando se escribió el detector (2026-09-17).
 *
 * Se declara por los ids de las filas y no por sala-día: identifica EL caso, y
 * así un duplicado nuevo en la misma sala el mismo día igual aparece.
 *
 *   · `214, 215` — Salud 2, 5-sep. Un pago de CAESS de $12.30 (boleta 000467)
 *     anotado dos veces con 634 ms de diferencia: el envío doble que se corrigió
 *     el 17-sep.
 *
 *     ⚠️ **NO se anula ninguna de las dos.** La sala lo vio el mismo día y lo
 *     resolvió con un contra-movimiento —una salida de $12.30 que dice «por
 *     error se ingresó 2 veces»—, así que el dinero YA está cuadrado y el corte
 *     de ese día cerró exacto. Anular una de las dos entradas ahora
 *     descuadraría la caja en $12.30. Queda acá como lo que es: la prueba de
 *     que el detector ve algo.
 *
 * Una entrada nueva acá NO se agrega para que el gate calle: sólo para un caso
 * ya resuelto por otra vía, y con su explicación escrita. */
const DUPLICADOS_YA_PASADOS = new Set(['214, 215']);

/* Que los dos triggers sigan puestos. Un hallazgo de C dice que el número está
 * viejo; éste dice POR QUÉ, y aparece aunque todavía no haya un número mal. */
const SQL_TRIGGERS = `
SELECT t.tgname AS nombre
  FROM pg_trigger t
 WHERE NOT t.tgisinternal
   AND t.tgname IN ('cortes_caja_cobros_portal', 'abonos_portal_resella_cortes')`;

function main() {
  const canal = abrirCanal('cortes-gate');
  const fallas = [];
  try {
    const triggers = canal.consultar(SQL_TRIGGERS).map(r => r.nombre);
    for (const t of ['cortes_caja_cobros_portal', 'abonos_portal_resella_cortes']) {
      if (!triggers.includes(t)) {
        fallas.push({
          clave: `trigger-ausente:${t}`,
          detalle: 'no está en producción',
          porque: 'Sin él, el efectivo que el portal cobra deja de sumarse al esperado y vuelve '
                + 'el sobrante fantasma. No da ningún error: sigue mostrando el número viejo.',
        });
      }
    }
    console.log(`  triggers:    ${triggers.length}/2 puestos`);

    const sinContar = canal.consultar(SQL_SIN_CONTAR);
    for (const r of sinContar) {
      fallas.push({
        clave: `efectivo-sin-contar:${r.sala}/${r.fecha}`,
        detalle: `${money(r.sin_contar)} en el cajón que ningún corte del día cuenta `
               + `(entraron ${money(r.en_el_cajon)}, se cuentan ${money(r.conto)})`,
        porque: 'Efectivo que está en la caja y no está en el esperado se ve como un sobrante '
              + 'que nadie hizo — y tapa el faltante real que puede haber debajo.',
      });
    }
    console.log(`  cajón:       ${sinContar.length === 0 ? 'todo el efectivo contado' : `${sinContar.length} sala-día(s) con efectivo sin contar`}`);

    const suma = canal.consultar(SQL_SUMA);
    for (const r of suma) {
      fallas.push({
        clave: `suma-del-comprobante:${r.id}`,
        detalle: `${r.sala} ${r.fecha} ${r.hora}: se desvía ${money(r.desvio)}`,
        porque: '`subtotal − vales + cobros = total_caja` es el despeje del que sale «cuánto contó '
              + 'el comprobante». Si deja de cerrar, la corrección resta un número que ya no '
              + 'significa eso. Ver `contraste` en src/utils/cortesDiagnostico.js.',
      });
    }
    console.log(`  comprobante: ${suma.length === 0 ? 'la suma cierra en todos' : `${suma.length} corte(s) donde no cierra`}`);

    const sello = canal.consultar(SQL_SELLO);
    for (const r of sello) {
      fallas.push({
        clave: `sello-viejo:${r.id}`,
        detalle: `${r.sala} ${r.fecha} ${r.hora}: dice ${money(r.sellado)} y hoy son ${money(r.de_verdad)}`,
        porque: 'El sello lo mantienen dos triggers. Uno viejo significa que un abono entró por un '
              + 'camino que no los dispara.',
      });
    }
    console.log(`  sello:       ${sello.length === 0 ? 'al día en todos los cortes' : `${sello.length} corte(s) con el número viejo`}`);

    const cerroSinContar = canal.consultar(SQL_CERRO_SIN_CONTAR);
    const nuevos = cerroSinContar.filter(r => !YA_PASADOS.has(`${r.sala}/${r.fecha}`));
    for (const r of nuevos) {
      fallas.push({
        clave: `cerro-sin-contar:${r.sala}/${r.fecha}`,
        detalle: `cerró el día a las ${String(r.hora).slice(0, 5)} con ${money(r.falta)} sin contar `
               + `(último conteo firmado: ${r.desde})`,
        porque: 'Ese dinero ya no lo puede contar nadie: la caja de ese día no vuelve a abrir y el '
              + 'cierre no se deshace. Si aparece acá, el freno de `hacer-corte-caja` no alcanzó — '
              + 'lo más probable es un corte hecho desde el sistema de la caja, que no pasa por él.',
      });
    }
    console.log(`  cierres:     ${nuevos.length === 0
      ? `ninguno se llevó efectivo sin contar${cerroSinContar.length ? ` (${cerroSinContar.length} histórico(s) declarado(s))` : ''}`
      : `${nuevos.length} día(s) cerrados con efectivo sin contar`}`);

    /* Un mismo caso puede caer en los DOS detectores —el par de Salud 1 lo
     * hace—, y nombrarlo dos veces haría creer que son dos problemas. Se
     * agrupa por los ids, que es lo que identifica el caso. */
    const duplicados = canal.consultar(SQL_DUPLICADOS);
    const porCaso = new Map();
    for (const r of duplicados) {
      if (!porCaso.has(r.ids)) porCaso.set(r.ids, { ...r, reglas: [] });
      porCaso.get(r.ids).reglas.push(r.regla);
    }
    const dupNuevos = [...porCaso.values()].filter(r => !DUPLICADOS_YA_PASADOS.has(r.ids));
    for (const r of dupNuevos) {
      fallas.push({
        clave: `movimiento-duplicado:${r.sala}/${r.fecha}`,
        detalle: `${r.detalle} — filas ${r.ids} (${r.reglas.join(' + ')})`,
        porque: 'El mismo dinero contado dos veces en la caja. Los frenos del 17-sep lo cortan '
              + 'antes de escribirlo, así que si aparece acá entró por un camino que no pasa por '
              + 'ellos. Revisar de dónde vino ANTES de anular: si la sala ya lo corrigió con un '
              + 'contra-movimiento, anular descuadraría la caja.',
      });
    }
    console.log(`  duplicados:  ${dupNuevos.length === 0
      ? `ninguno vigente${porCaso.size ? ` (${porCaso.size} histórico(s) declarado(s))` : ''}`
      : `${dupNuevos.length} movimiento(s) anotados dos veces`}`);
  } finally {
    canal.cerrar();
  }

  if (fallas.length === 0) {
    console.log('\n✓ El efectivo del cajón y el esperado de los cortes dicen lo mismo.\n');
    return;
  }

  console.log(`\n✗ ${fallas.length} hallazgo(s):\n`);
  for (const f of fallas) {
    console.log(`  • ${f.clave} — ${f.detalle}`);
    console.log(`      ${f.porque}`);
  }
  console.log('\n  Esto decide si a alguien se le señala un faltante. No se silencia con una');
  console.log('  excepción: o el dinero está contado, o hay que averiguar por dónde entró.\n');
  process.exitCode = 1;
}

try { main(); } catch (e) {
  // Un gate que no pudo medir no puede dar verde — mismo criterio que gate:perf.
  console.log(`\n✗ No pude medir contra producción: ${String(e.message).split('\n')[0]}`);
  if (e.detalleCli) {
    console.log('\n  Lo que contestó:');
    for (const l of e.detalleCli.split('\n').slice(-8)) console.log(`    ${l}`);
  }
  console.log('\n  Si no dijo nada más, suele ser el CLI sin login o el proyecto sin linkear:');
  console.log('    supabase login && supabase link --project-ref sacecdkdmsdvgqnrsett\n');
  process.exitCode = 1;
}
