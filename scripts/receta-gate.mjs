#!/usr/bin/env node
/**
 * gate:receta — que el libro bajo receta vea todo lo que tiene que ver.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 * El contenido del libro lo decide UNA condición: de qué clase es el producto.
 * Y esa clase sale, en última instancia, de `products.es_antibiotico`, una
 * casilla que **mantiene el ERP a mano**. Hoy está bien —se midió el 3-sep— y
 * nada garantiza que siga estándolo: el día que entre una presentación nueva de
 * azitromicina sin marcar, se despacha en el mostrador y **no aparece en el
 * libro**. Sin error, sin fila de menos visible, sin nadie que pueda notarlo.
 *
 * Es el mismo modo de falla que este repo ya conoce con otro nombre: una lista
 * escrita a mano que se desincroniza del registro. Lo que faltaba no era la
 * lista —está bien— era algo que la mirara.
 *
 * ── La regla, y de dónde sale ───────────────────────────────────────────────
 * En El Salvador NO todo antibiótico exige receta. El **RTS 11.02.04:24 §6.4.3**
 * remite «al listado emitido oficialmente por SRS», y ese listado son dos
 * tandas de la DNM:
 *
 *   · **jul-2015** — todo antibiótico INYECTABLE, cualquiera sea la molécula.
 *   · **2018** — seis moléculas, cualquiera sea la vía: cefixima, azitromicina,
 *     claritromicina, levofloxacina, moxifloxacina y norfloxacina.
 *
 * Todo lo demás —amoxicilina, ampicilina, cefalexina, metronidazol, TMP-SMX,
 * ciprofloxacina oral— es **venta libre**, y auditar contra «todo antibiótico»
 * da un número grande y falso: pasó el 3-sep, midiendo contra ATC J01.
 *
 * ── Lo que este gate NO puede ver, dicho de frente ──────────────────────────
 * Detecta por NOMBRE, así que una marca comercial que no esté en la lista de
 * abajo y no nombre su principio activo se le escapa. La defensa de verdad es
 * `products.principio_activo`, y hoy sólo lo tienen 18 de los productos del
 * libro — por eso la sección D lo mide y lo reporta como deuda.
 */
import { readFileSync } from 'node:fs';
import { abrirCanal } from './lib/canal-supabase.mjs';

const BASELINE = JSON.parse(readFileSync(new URL('./receta-baseline.json', import.meta.url), 'utf8'));

/* ── Las seis moléculas ──────────────────────────────────────────────────────
 * Se buscan en el PRINCIPIO ACTIVO y en el nombre — nunca por marca comercial.
 *
 * La primera versión de este gate sí tenía un mapa de marcas, y se equivocó en
 * la primera corrida: acusó a `BACTIVANZ 300 X 10 CAPSULAS` de ser
 * claritromicina cuando su principio activo dice **CEFDINIR 300 mg**. La marca
 * no la puede adivinar un patrón, y un gate que acusa al que hizo bien el
 * trabajo es cómo un gate se termina desactivando.
 *
 * Así que el mapa se fue y quedó lo verificable. El costo es que una marca sin
 * principio activo cargado se le escapa — por eso la sección F mide esa deuda y
 * sólo la deja bajar: es la única forma de que este gate llegue a ver todo. */
const MOLECULAS = [
  { generico: 'cefixima',       patron: 'cefixim' },
  { generico: 'azitromicina',   patron: 'azitromic' },
  { generico: 'claritromicina', patron: 'claritromic' },
  { generico: 'levofloxacina',  patron: 'levoflox' },
  { generico: 'moxifloxacina',  patron: 'moxiflox' },
  { generico: 'norfloxacina',   patron: 'norflox' },
];

/* Moléculas antibióticas que, EN PRESENTACIÓN INYECTABLE, exigen receta por la
 * resolución de 2015. En oral son venta libre, así que el patrón de forma es
 * tan importante como el de molécula. */
const ABX_INYECTABLE = 'ceftriax|cefotax|ceftazidim|cefazol|gentamic|amikacin|clindamic|penicil|'
                     + 'oxacilin|ampicil|sultamicil|piperacil|vancomic|meropenem|imipenem|'
                     + 'estreptomic|tobramic|fosfomic';
const FORMA_INYECTABLE = 'ampoll|amp\\.|ampula|inyect|\\bi\\.?v\\b|\\bi\\.?m\\b|/2 ?ml|x 2 ml|'
                       + 'hospitalaria|tripack|1 ?gr?\\b|0\\.5 ?gr\\b|liofiliz';

const clasificado = `coalesce(dc.clase, CASE WHEN p.es_antibiotico THEN 'antibiotico' END) IS NOT NULL`;

const SQL_MOLECULAS = MOLECULAS.map(m => `
  SELECT '${m.generico}' AS molecula, p.nombre, p.activo,
         (SELECT count(*) FROM public.sales_invoice_items i
            JOIN public.sales_invoices s ON s.id = i.invoice_id
           WHERE i.erp_product_id = p.id AND s.fecha >= current_date - 90)::text AS ventas
    FROM public.products p
    LEFT JOIN public.dispensacion_clases dc ON dc.erp_product_id = p.id
   WHERE (p.nombre ~* '${m.patron}' OR coalesce(p.principio_activo, '') ~* '${m.patron}')
     AND NOT (${clasificado})`).join('\n  UNION ALL\n')
  + '\n ORDER BY activo DESC, molecula, nombre';

const SQL_INYECTABLES = `
SELECT p.nombre, p.activo,
       (SELECT count(*) FROM public.sales_invoice_items i
          JOIN public.sales_invoices s ON s.id = i.invoice_id
         WHERE i.erp_product_id = p.id AND s.fecha >= current_date - 90)::text AS ventas
  FROM public.products p
  LEFT JOIN public.dispensacion_clases dc ON dc.erp_product_id = p.id
 WHERE (p.nombre ~* '${ABX_INYECTABLE}' OR coalesce(p.principio_activo, '') ~* '${ABX_INYECTABLE}')
   AND p.nombre ~* '${FORMA_INYECTABLE}'
   AND NOT (${clasificado})
 ORDER BY p.activo DESC, p.nombre`;

/* C. El libro contra las ventas, dentro de la ventana que cada sala tiene
 * abierta. Es la pregunta general —no depende de acertarle al nombre— y la que
 * caza cualquier renglón que el sync no alcanzó a cargar. */
const SQL_LIBRO_INCOMPLETO = `
SELECT b.name AS sala, s.fecha::text AS fecha, count(*)::text AS faltan
  FROM public.sales_invoice_items i
  JOIN public.sales_invoices s ON s.id = i.invoice_id
  JOIN public.branches b ON b.id = s.branch_id
  JOIN public.products p ON p.id = i.erp_product_id
  LEFT JOIN public.dispensacion_clases dc ON dc.erp_product_id = p.id
 WHERE ${clasificado}
   AND b.libro_receta_desde IS NOT NULL
   AND s.fecha >= b.libro_receta_desde
   AND s.fecha <= (now() AT TIME ZONE 'America/El_Salvador')::date - 1
   AND NOT EXISTS (SELECT 1 FROM public.bitacora_dispensaciones d
                    WHERE d.sales_invoice_item_id = i.id)
 GROUP BY 1, 2 ORDER BY 2 DESC, 1`;

/* D. Sin principio activo no hay forma de comprobar la regla por molécula: la
 * única defensa que queda es acertarle al nombre comercial. */
const SQL_SIN_PRINCIPIO = `
SELECT count(*) FILTER (WHERE coalesce(btrim(p.principio_activo), '') = '')::text AS sin_pa,
       count(*)::text AS total
  FROM public.products p
  LEFT JOIN public.dispensacion_clases dc ON dc.erp_product_id = p.id
 WHERE ${clasificado} AND p.activo`;

/* E. Ventas que no nombran ningún producto del catálogo. No pueden entrar al
 * libro por construcción —el sync cruza contra `products`—, así que un
 * antibiótico despachado así es invisible para siempre. */
const SQL_GENERICAS = `
SELECT count(*)::text AS renglones, count(DISTINCT s.branch_id)::text AS salas,
       min(s.fecha)::text AS desde, max(s.fecha)::text AS hasta
  FROM public.sales_invoice_items i
  JOIN public.sales_invoices s ON s.id = i.invoice_id
 WHERE s.fecha >= current_date - 90
   AND (i.erp_product_id IS NULL OR i.erp_product_id = 0
        OR NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = i.erp_product_id))`;

/* F. Toda corrección de clase lleva su motivo escrito: es la respuesta a «¿por
 * qué esta ranitidina no está en el libro de antibióticos?», y un motivo de
 * tres palabras no la contesta. */
const SQL_MOTIVOS = `
SELECT p.nombre, dc.clase, length(coalesce(dc.motivo, ''))::text AS largo
  FROM public.dispensacion_clases dc
  JOIN public.products p ON p.id = dc.erp_product_id
 WHERE length(coalesce(btrim(dc.motivo), '')) < 40
 ORDER BY p.nombre`;

function main() {
  console.log('\n  gate:receta — el libro bajo receta contra el catálogo y las ventas\n');
  const canal = abrirCanal('receta-gate');
  const fallas = [];
  const avisos = [];

  try {
    const sueltas = canal.consultar(SQL_MOLECULAS);
    for (const r of sueltas) {
      fallas.push({
        clave: `molecula-sin-clasificar:${r.nombre}`,
        detalle: `${r.nombre} — ${r.molecula}${r.activo === 'true' || r.activo === true ? '' : ' (inactivo)'}`
               + `, ${r.ventas} venta(s) en 90 días`,
        porque: 'Es una de las seis moléculas que exigen receta cualquiera sea la vía (DNM, 2018). '
              + 'Sin clasificar se despacha en el mostrador y no aparece en el libro. Se arregla con '
              + 'una fila en `dispensacion_clases`, o marcándolo en el ERP.',
      });
    }
    console.log(`  moléculas:   ${sueltas.length === 0 ? 'las seis, todas clasificadas' : `${sueltas.length} producto(s) sin clasificar`}`);

    const iny = canal.consultar(SQL_INYECTABLES);
    for (const r of iny) {
      fallas.push({
        clave: `inyectable-sin-clasificar:${r.nombre}`,
        detalle: `${r.nombre}${r.activo === 'true' || r.activo === true ? '' : ' (inactivo)'}, ${r.ventas} venta(s) en 90 días`,
        porque: 'Todo antibiótico INYECTABLE exige receta desde la resolución de la DNM de jul-2015, '
              + 'sin importar la molécula.',
      });
    }
    console.log(`  inyectables: ${iny.length === 0 ? 'todos clasificados' : `${iny.length} producto(s) sin clasificar`}`);

    const huecos = canal.consultar(SQL_LIBRO_INCOMPLETO);
    for (const r of huecos) {
      fallas.push({
        clave: `renglon-que-falta:${r.sala}:${r.fecha}`,
        detalle: `${r.sala} ${r.fecha}: ${r.faltan} venta(s) bajo receta sin renglón en el libro`,
        porque: 'El libro tiene que poder contestar «¿nos falta alguna?». Un renglón que el sync no '
              + 'alcanzó a cargar no da error y no deja hueco visible.',
      });
    }
    console.log(`  el libro:    ${huecos.length === 0 ? 'sin renglones faltantes' : `${huecos.length} sala-día(s) con renglones que faltan`}`);

    const motivos = canal.consultar(SQL_MOTIVOS);
    for (const r of motivos) {
      fallas.push({
        clave: `motivo-flaco:${r.nombre}`,
        detalle: `${r.nombre} (${r.clase}): el motivo tiene ${r.largo} caracteres`,
        porque: 'El motivo es lo que se le contesta a un inspector que pregunta por qué ese producto '
              + 'está en un libro y no en el otro. Tiene que decir la razón, no repetir la clase.',
      });
    }
    console.log(`  motivos:     ${motivos.length === 0 ? 'todos escritos' : `${motivos.length} sin explicar`}`);

    /* F. La deuda que hace posible todo lo demás, con trinquete: sólo baja.
     *
     * No falla el gate por existir —es deuda vieja y un gate en rojo desde el
     * día uno se aprende a ignorar— pero sí falla si CRECE, porque cada
     * producto sin principio activo es un producto que las secciones A y B no
     * pueden ver. */
    const [pa] = canal.consultar(SQL_SIN_PRINCIPIO);
    const sinPa = pa ? Number(pa.sin_pa) : 0;
    const tope = Number(BASELINE.sin_principio_activo ?? 0);
    if (sinPa > tope) {
      fallas.push({
        clave: 'sin-principio-activo-subio',
        detalle: `${sinPa} productos del libro sin principio activo, y el tope era ${tope}`,
        porque: 'Cada uno es un producto que las secciones A y B no pueden mirar: sin el principio '
              + 'activo, la única defensa es acertarle al nombre comercial. El baseline SÓLO baja — '
              + 'se baja cargando el dato, no subiendo el número.',
      });
    }
    if (sinPa > 0 && sinPa <= tope) {
      avisos.push(`${sinPa} de ${pa.total} productos del libro no tienen principio activo cargado `
                + `(tope ${tope}) — sin él la regla sólo se puede comprobar acertándole al nombre comercial.`);
    }
    console.log(`  genérico:    ${pa ? `${Number(pa.total) - sinPa} de ${pa.total} con principio activo (deuda ${sinPa}/${tope})` : '—'}`);

    const [gen] = canal.consultar(SQL_GENERICAS);
    if (gen && Number(gen.renglones) > 0) {
      avisos.push(`${gen.renglones} renglón(es) de venta en ${gen.salas} sala(s) (${gen.desde} → ${gen.hasta}) `
                + 'no nombran ningún producto del catálogo: se digitaron como genérico. El libro cruza '
                + 'contra `products`, así que un antibiótico despachado así NO entra y no hay forma de notarlo.');
    }
    console.log(`  sin catálogo:${gen ? ` ${gen.renglones} renglón(es) de venta en 90 días` : ' —'}`);
  } finally {
    canal.cerrar();
  }

  if (avisos.length) {
    console.log('\n  ⚠ Para mirar');
    for (const a of avisos) console.log(`      · ${a}`);
  }

  if (fallas.length === 0) {
    console.log('\n✓ El libro ve todo lo que la norma manda que vea.\n');
    return;
  }

  console.log(`\n✗ ${fallas.length} hallazgo(s):\n`);
  for (const f of fallas) {
    console.log(`  • ${f.clave} — ${f.detalle}`);
    console.log(`      ${f.porque}`);
  }
  console.log('\n  Esto decide qué queda registrado de una dispensación bajo receta. No se');
  console.log('  silencia con una excepción: o el producto está clasificado, o hay que decir');
  console.log('  por escrito por qué no le toca.\n');
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
