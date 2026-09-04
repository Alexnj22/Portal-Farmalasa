/**
 * gate:nombre — el nombre de una persona se pinta con el canónico, no crudo.
 *
 * ── El reporte que lo trajo ─────────────────────────────────────────────────
 *
 * «¿por qué sale el nombre completo? hay reglas ya definidas que lo prohíben,
 * siempre nombre y apellido. ¿por qué falla la regla?» (2026-09-03), sobre la
 * tarjeta de un corte descartado de La Popular que decía
 * «EDWIN ALEXANDER NUNEZ JOYA» junto a un avatar que decía «EN».
 *
 * La regla existía y estaba escrita —`shortEmployeeName` en
 * `src/utils/nameUtils.js`, primer nombre + primer apellido en toda la
 * interfaz—. Lo que faltaba era algo que la obligara: un barrido de las 632
 * fuentes encontró OCHO sitios más con el mismo defecto y TRES copias de la
 * regla escritas a mano, dos de ellas mal.
 *
 * ── Por qué el modo de falla es invisible ──────────────────────────────────
 *
 * Siete de los ocho estaban junto a un `AvatarConEstado` que SÍ llama al
 * canónico —para las iniciales—, así que el avatar acortaba y el texto de al
 * lado no. Y los ocho tenían `truncate`: el nombre largo no desbordaba nada,
 * se cortaba a la mitad. No hay error, no hay layout roto, no hay nada que
 * reportar salvo «se ve raro». Por eso vivieron meses.
 *
 * La copia a mano peor es `.split(' ').slice(0, 2)`, que toma las dos PRIMERAS
 * palabras: sobre «EDWIN ALEXANDER NUNEZ JOYA» da «EDWIN ALEXANDER» —dos
 * nombres y ningún apellido—, que es exactamente lo que el canónico existe
 * para evitar. Se lee bien y nombra mal.
 *
 * ── Por qué es un gate aparte y no una categoría de `gate:design` ──────────
 *
 * `design-gate` es regex sobre el texto del archivo, y acá el regex no alcanza:
 * la primera versión de este detector, buscando `\.name` a mano, dio 147
 * hallazgos de los cuales 25 eran reales. Contaba `branch.name` (una sucursal),
 * bitácoras, `localeCompare`, textos de búsqueda y `key=`. Un gate que acusa a
 * cinco de cada seis se desactiva solo.
 *
 * Con el AST la pregunta se puede hacer bien: ¿esta expresión LLEGA al DOM?
 * Eso lo contesta el árbol —hijo de un JSXElement, o un atributo que el usuario
 * lee— y no el texto. Es la misma decisión que ya tomaron `gate:tdz` y
 * `gate:undefinidos`, que también viven fuera de `design-gate` por necesitar
 * ámbitos.
 *
 * ── Bloqueante en CERO, sin baseline ───────────────────────────────────────
 *
 * No hay deuda que absorber: los ocho se arreglaron el mismo día. Lo legítimo
 * está en EXCEPCIONES **con su motivo escrito**, que es la diferencia entre una
 * excepción y una deuda sin clasificar.
 *
 * Uso:
 *   node scripts/nombre-gate.mjs             todo `src/` desde el disco
 *   node scripts/nombre-gate.mjs --hook      sólo lo que el ÍNDICE conoce
 *   node scripts/nombre-gate.mjs --listar    imprime también lo exceptuado
 *
 * `--hook` mira el índice y no el disco por lo mismo que los demás gates: en
 * este árbol trabajan varias sesiones a la vez, y bloquear un commit por el
 * archivo a medio editar de otra persona culpa a quien no lo tocó.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { archivosIndexados, leerDelIndice } from './lib/git-index.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const soloIndexado = process.argv.includes('--hook');
const listarTodo   = process.argv.includes('--listar');

/* ── Las excepciones, cada una con su motivo Y SU CUENTA ────────────────────
 *
 * Son las DOS excepciones que `utils/nameUtils` ya declara —Personal, donde el
 * nombre completo ES el dato, y todo lo que SALE del portal— más los casos que
 * no son un empleado. Van por archivo: la granularidad del resto de los gates
 * del repo, y la única que no se rompe cuando alguien mueve una línea.
 *
 * ── Pero por archivo NO alcanza, y se comprobó ────────────────────────────
 *
 * Al probar el gate contra una regresión fabricada a propósito —reponer el
 * `.split(' ').slice(0, 2)` del widget de anulaciones, que da «EDWIN
 * ALEXANDER»— el gate NO la cazó: ese archivo tiene una excepción legítima por
 * sus dos chips de primer nombre, y la excepción se tragó el defecto nuevo.
 *
 * Por eso cada excepción declara CUÁNTOS sitios cubre. El archivo puede tener
 * sus dos; el tercero falla. Es el mismo trinquete que usan los baselines del
 * repo, aplicado adentro de la excepción en vez de al total — y la única forma
 * de que «este archivo es una excepción» no signifique «este archivo ya no se
 * mira». */
const EXCEPCIONES = {
  // ── Personal: el nombre completo ES el dato ──────────────────────────────
  'src/views/EmployeeDetailView.jsx':
    { n: 2, motivo: 'la ficha del empleado — el encabezado y la entrega de contraseña nombran a la persona, no la mencionan' },
  'src/views/employee/EmployeeProfileView.jsx':
    { n: 1, motivo: '«Mi perfil» es la ficha propia' },
  'src/views/branch-tabs/TabStaff.jsx':
    { n: 1, motivo: 'el listado de personal de una sucursal' },
  'src/components/forms/AsignarDocumentoAVarios.jsx':
    { n: 1, motivo: '«Tiene ficha: …» coteja a qué ficha corresponde el documento; recortarlo quita justo lo que se está cotejando' },

  // ── Documentos y datos fiscales ──────────────────────────────────────────
  'src/components/personal/SancionModal.jsx':
    { n: 1, motivo: 'una sanción del RIT Art. 83 es un documento legal y nombra a la persona entera' },
  'src/components/forms/FormSalesDteViewer.jsx':
    { n: 2, motivo: '`receptor.nombre` es el CLIENTE de una factura, no personal: es un dato fiscal y no se recorta' },
  'src/components/forms/FormPurchaseDteViewer.jsx':
    { n: 1, motivo: 'ídem — el receptor del DTE de una compra' },

  // ── Otra regla, deliberada: sólo el primer nombre ─────────────────────────
  'src/components/forms/BranchTabLegal.jsx':
    { n: 1, motivo: 'botón angosto de selección: `split(\' \')[0]` es sólo el primer nombre, a propósito' },
  'src/views/dashboard/WidgetAnnulmentRequest.jsx':
    { n: 2, motivo: 'dos chips `text-micro` muestran sólo el primer nombre a propósito; el que pretendía ser nombre+apellido ya usa el canónico' },

  // ── Sucursal, no persona ─────────────────────────────────────────────────
  'src/components/forms/FormLeadership.jsx':
    { n: 1, motivo: '`empBranch?.name` es una SUCURSAL — la variable empieza con «emp» y por eso la caza el detector' },
};

/* ── La regla ───────────────────────────────────────────────────────────────
 *
 * Tres preguntas, y las tres tienen que dar que sí:
 *   1. ¿el objeto es una PERSONA del portal? (no una sucursal, un rol, un
 *      producto — todos tienen `.name` y ninguno es alguien)
 *   2. ¿se PINTA como texto? (hijo de un JSXElement, no una prop)
 *   3. ¿nadie la acortó ya?
 *
 * La tercera mira el contenedor JSX ENTERO y no la llamada más cercana: el
 * patrón normal es `{x?.name ? shortEmployeeName(x) : 'nadie'}`, donde el
 * `.name` que queda es la CONDICIÓN y no lo que se pinta. Sin eso el detector
 * acusaba a los nueve sitios recién corregidos — y acusar a quien hizo bien el
 * trabajo es cómo un gate se termina desactivando.
 *
 * ── Los atributos quedan FUERA, y es una decisión medida ──────────────────
 *
 * La primera versión contaba `title`, `alt` y `aria-label`: dio 24 hallazgos
 * de los cuales cinco eran texto. Pero un `title={emp.name}` sobre una celda
 * que ya muestra el nombre corto no contradice la regla — la COMPLETA: el
 * tooltip es exactamente donde el nombre entero cabe sin desbordar nada, y el
 * `alt` de una foto es lo que lee un lector de pantalla. Contarlos convertía
 * el gate en diecinueve acusaciones a quien hizo lo correcto.
 *
 * Las props de componente (`nombre=`, `label=`) tampoco: ahí el nombre viaja a
 * otro componente que puede resolverlo —`AutorLinea` llama al canónico
 * adentro— y desde acá no se puede saber. Eso lo cubre el componente, donde sí
 * se sabe. */
const RAIZ_PERSONA = /^(emp|empleado|employee|persona|quien|firmante|resolutor|aprobador|approver|solicitante|requester|vendor|vendedor|usuario|user|autor|creador|receptor|remitente|contador|anotaron|hizo|recibe|abrio|supervisor|jefe|responsable|asignado|destinatario|miembro|companero|compañero|contado|recibida|entregada|cerrada|abierta|marcado|target|actor|dueno)/i;
// Tienen `.name` y no son alguien.
const NO_ES_PERSONA = /\b(branch|sucursal|sala|role|rol|cargo|producto|product|lab|laboratorio|presentacion|proveedor|banco|archivo|file|tipo|modulo|module|categoria|estado|turno|shift)\b/i;
const CAMPOS = new Set(['name', 'nombre', 'full_name', 'nombre_completo']);
const YA_ACORTADO = /shortEmployeeName|employeeInitials/;

const regla = {
  create(context) {
    const sc = context.sourceCode ?? context.getSourceCode();

    const esPersona = (node) => {
      if (!CAMPOS.has(node.property?.name)) return null;
      const txt = sc.getText(node);
      if (NO_ES_PERSONA.test(txt)) return null;
      // La cadena completa: `req.employee?.name` → ['req','employee']
      const cadena = [];
      let o = node.object;
      while (o && (o.type === 'MemberExpression' || o.type === 'OptionalMemberExpression')) {
        if (o.property?.name) cadena.unshift(o.property.name);
        o = o.object;
      }
      if (o?.type === 'Identifier') cadena.unshift(o.name);
      else if (o?.type === 'CallExpression' && o.callee?.property?.name) cadena.unshift(o.callee.property.name);
      return cadena.some((c) => RAIZ_PERSONA.test(c)) ? txt : null;
    };

    const revisar = (node) => {
      const txt = esPersona(node);
      if (!txt) return;

      // ¿Se pinta como texto? Se sube hasta el contenedor JSX más cercano.
      let contenedor = null;
      for (let p = node.parent, i = 0; p && i < 16; p = p.parent, i++) {
        if (p.type === 'JSXExpressionContainer') { contenedor = p; break; }
        // Dentro de una prop: se pinta en otro lado. No se sigue.
        if (p.type === 'JSXAttribute') return;
      }
      if (!contenedor) return;

      const padre = contenedor.parent;
      if (padre?.type !== 'JSXElement' && padre?.type !== 'JSXFragment') return;

      // Alguien ya lo resolvió en esta misma expresión.
      if (YA_ACORTADO.test(sc.getText(contenedor))) return;

      /* Y una CONDICIÓN no se pinta. `{x.name && <Algo/>}` pregunta si hay
       * alguien; `{x.name ? shortEmployeeName(x) : '—'}` pregunta lo mismo.
       * Lo que se lee es la otra mitad, y acusarlas es acusar al patrón normal
       * de todo el repo — los dos únicos hallazgos que quedaban al escribir
       * este gate eran exactamente eso.
       *
       * `&&` SÍ y `||`/`??` NO, que es la distinción que la primera versión de
       * este bloque se comió: en `{x.name && <Algo/>}` la izquierda es un test
       * y no se muestra, pero en `{x.name || '—'}` la izquierda ES el valor y
       * se pinta. Dando por condición a las dos, el gate se puso en verde
       * tapando tres sitios que sí pintan el nombre — y lo delató quejándose
       * de que sus propias excepciones ya no cubrían nada. */
      for (let p = node, q = node.parent, i = 0; q && q !== contenedor && i < 16; p = q, q = q.parent, i++) {
        if (q.type === 'LogicalExpression' && q.operator === '&&' && q.left === p) return;
        if (q.type === 'ConditionalExpression' && q.test === p) return;
        if (q.type === 'UnaryExpression' && q.operator === '!') return;
      }

      context.report({ node, messageId: 'crudo', data: { txt } });
    };

    return {
      MemberExpression: revisar,
      OptionalMemberExpression: revisar,
    };
  },
  meta: {
    messages: {
      crudo: '`{{txt}}` se pinta entero — el portal muestra primer nombre + primer apellido: `shortEmployeeName()` (utils/nameUtils)',
    },
  },
};

// ── Qué se mira ────────────────────────────────────────────────────────────
let archivos;
let leer;
if (soloIndexado) {
  archivos = [...archivosIndexados(RAIZ, ['src'])].filter((f) => /\.jsx$/.test(f));
  const contenido = leerDelIndice(RAIZ, archivos);
  leer = (f) => contenido.get(f) ?? '';
} else {
  archivos = execSync("find src -type f -name '*.jsx'",
    { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .trim().split('\n').filter(Boolean);
  leer = (f) => readFileSync(join(RAIZ, f), 'utf8');
}

console.log('');
if (!archivos.length) {
  console.log('  ✓ gate:nombre — el commit no toca pantallas, nada que mirar.\n');
  process.exit(0);
}

const linter = new Linter();
const config = [{
  files: ['**/*.jsx'],
  languageOptions: {
    ecmaVersion: 'latest', sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  plugins: { nombre: { rules: { 'con-el-canonico': regla } } },
  rules: { 'nombre/con-el-canonico': 'error' },
}];

const hallazgos  = [];
const exceptuados = [];
const ilegibles  = [];

for (const archivo of archivos) {
  const texto = leer(archivo);
  if (!texto) continue;
  let mensajes;
  try {
    mensajes = linter.verify(texto, config, archivo);
  } catch {
    // Un archivo que no se pudo parsear NO se da por bueno: un gate que se
    // calla ante lo que no pudo medir no puede dar verde.
    ilegibles.push(archivo);
    continue;
  }
  for (const m of mensajes) {
    if (m.fatal) { ilegibles.push(`${archivo}:${m.line}`); continue; }
    if (m.ruleId !== 'nombre/con-el-canonico') continue;
    const h = { archivo, linea: m.line, mensaje: m.message };
    (EXCEPCIONES[archivo] ? exceptuados : hallazgos).push(h);
  }
}

// ── Una excepción que ya no cubre nada es una excepción que miente ─────────
const cuenta = (f) => exceptuados.filter((e) => e.archivo === f).length;
const sinUso    = Object.keys(EXCEPCIONES).filter((f) => cuenta(f) === 0);
// Y una que cubre MÁS de lo declarado se comió un defecto nuevo.
const crecieron = Object.entries(EXCEPCIONES)
  .map(([f, x]) => [f, cuenta(f), x.n])
  .filter(([, hay, declarados]) => hay > declarados);

// ── Veredicto ──────────────────────────────────────────────────────────────
if (listarTodo && exceptuados.length) {
  console.log(`  · ${exceptuados.length} sitio(s) exceptuados con motivo escrito:\n`);
  const porArchivo = new Map();
  for (const e of exceptuados) porArchivo.set(e.archivo, (porArchivo.get(e.archivo) || 0) + 1);
  for (const [f, n] of porArchivo) console.log(`      ${f} (${n} de ${EXCEPCIONES[f].n})\n        ${EXCEPCIONES[f].motivo}`);
  console.log('');
}

if (!hallazgos.length && !ilegibles.length && !sinUso.length && !crecieron.length) {
  console.log(`  ✓ gate:nombre — ${archivos.length} pantalla(s), ningún nombre completo en la interfaz.`);
  console.log(`    ${exceptuados.length} sitio(s) exceptuados con su motivo (\`--listar\` para verlos).\n`);
  process.exit(0);
}

if (ilegibles.length) {
  console.log(`  ✗ gate:nombre — ${ilegibles.length} archivo(s) que no se pudieron leer\n`);
  for (const f of ilegibles) console.log(`      ${f}`);
  console.log('');
}

if (hallazgos.length) {
  console.log(`  ✗ gate:nombre — ${hallazgos.length} nombre(s) de persona pintados enteros\n`);
  for (const h of hallazgos) console.log(`      ${h.archivo}:${h.linea}  ${h.mensaje}`);
  console.log('');
  console.log('    El portal muestra SIEMPRE primer nombre + primer apellido:');
  console.log('    `shortEmployeeName(persona)` de `src/utils/nameUtils.js`.');
  console.log('');
  console.log('    No falla nada ni desborda nada —con `truncate` el nombre largo');
  console.log('    se corta a la mitad—, así que esto no se reporta como bug: se');
  console.log('    reporta como «se ve raro», meses después.');
  console.log('');
  console.log('    Si el nombre completo ES el dato (Personal, un documento legal,');
  console.log('    algo que SALE del portal, o no es un empleado), va a EXCEPCIONES');
  console.log('    de este archivo CON SU MOTIVO escrito.');
  console.log('');
}

if (crecieron.length) {
  console.log(`  ✗ gate:nombre — ${crecieron.length} archivo(s) exceptuado(s) con MÁS sitios de los declarados\n`);
  for (const [f, hay, declarados] of crecieron) {
    console.log(`      ${f}: ${hay} donde la excepción declara ${declarados}`);
    console.log(`        ${EXCEPCIONES[f].motivo}`);
  }
  console.log('');
  console.log('    La excepción cubre lo que se revisó, no el archivo entero. Si el');
  console.log('    sitio nuevo también es legítimo, subí el `n` y explicá por qué en');
  console.log('    el motivo; si no, usá `shortEmployeeName()`.');
  console.log('');
}

if (sinUso.length) {
  console.log(`  ✗ gate:nombre — ${sinUso.length} excepción(es) que ya no cubren nada\n`);
  for (const f of sinUso) console.log(`      ${f}\n        ${EXCEPCIONES[f].motivo}`);
  console.log('');
  console.log('    El archivo se arregló, se movió o se borró. Una excepción que');
  console.log('    sobrevive a su motivo tapa el hallazgo que venga después.');
  console.log('');
}

process.exit(1);
