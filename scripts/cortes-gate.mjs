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
