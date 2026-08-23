#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// EL BARRIDO — mide por área los ejes que ningún gate existente mira
// ─────────────────────────────────────────────────────────────────────────────
//
// Los once gates del portal cubren mucho, pero cada uno nació de un incidente y
// mira exactamente eso: design mira el tema, movil mira el canon del teléfono,
// data mira el techo de las 1000 filas y los tipos, permisos cruza las llaves.
// Ninguno mira RESILIENCIA («¿qué pasa cuando falla?»), OBSERVABILIDAD («¿se
// puede reconstruir lo que pasó?») ni una parte de DATOS que vive en el
// navegador y no en la consulta.
//
// Este archivo no es un gate: no bloquea nada y no tiene baseline. Es el
// instrumento de la auditoría — corre una vez por pasada, reparte lo que
// encuentra entre las 25 áreas y deja el número que después alguien tiene que ir
// a verificar a mano.
//
// ── La advertencia que va primero ───────────────────────────────────────────
// Un detector estático sobre 174,084 líneas produce falsos positivos, y la
// lección más cara de agosto fue exactamente ésa: el detector de acuse acusaba a
// 36 tarjetas que hacían lo correcto y tapaba al único botón mudo. Por eso cada
// categoría de acá abajo lleva escrito QUÉ mira y qué NO puede ver, y el informe
// imprime ejemplos con archivo y línea — para poder abrir tres a mano antes de
// creerle un número. Un número sin tres casos abiertos no entra al registro.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { AREAS, areaDeArchivo } from '../auditoria/areas.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');

// ── Categorías ──────────────────────────────────────────────────────────────
// `eje` es a cuál de los doce ejes del registro descuenta.
// `ve` / `noVe` son obligatorios: un detector sin sus límites escritos es un
// número que nadie puede interpretar seis meses después.
const CATEGORIAS = [
    {
        id: 'error-tragado',
        eje: 'resiliencia',
        titulo: 'Escritura a la base cuyo error se descarta',
        ve: 'Un `await supabase…insert/update/delete/upsert/rpc` destructurado como `{ data }` '
          + 'sin `error` — la escritura puede fallar y la pantalla sigue como si nada.',
        noVe: 'El que guarda la respuesta entera en una variable y la chequea después. '
            + 'Ésos salen como falso negativo, no como falso positivo.',
        archivos: /^src\/.*\.(js|jsx)$/,
        buscar: (linea) =>
            /await\s+supabase[\s\S]{0,80}?\.(insert|update|delete|upsert|rpc)\(/.test(linea)
            && /const\s*\{\s*data\b/.test(linea) && !/\berror\b/.test(linea),
    },
    {
        id: 'catch-mudo',
        eje: 'resiliencia',
        titulo: 'Falla atrapada y callada sin decir por qué',
        ve: 'Un `catch` cuyo cuerpo no tiene código NI una explicación de por qué se calla — '
          + 'sólo una palabra como «silencioso» o «ignorar». El usuario ve la pantalla igual '
          + 'que si hubiera funcionado y no queda rastro en ningún lado.',
        noVe: 'El `catch` que explica la decisión por escrito («timeout o red inestable → se '
            + 'confía en el caché local»): callarse a propósito y dejarlo dicho es una decisión, '
            + 'no un olvido. Tampoco ve el que atrapa y muestra un toast, que es lo correcto.',
        archivos: /^src\/.*\.(js|jsx)$/,
        multilinea: true,
        // La primera versión cortaba el cuerpo a las 8 líneas, y por eso acusó a
        // dos `catch` que SÍ manejan el error: su comentario ocupaba justo esas
        // ocho y el `setClasifError(...)` real caía fuera de la ventana. Un
        // detector con la ventana corta no encuentra menos: encuentra MAL, y
        // acusa con más fuerza justamente al código que más se molestó en
        // explicarse.
        buscar: (_l, texto, i, lineas) => {
            if (!/catch\s*(\([^)]*\))?\s*\{\s*$/.test(lineas[i])) return false;
            const crudas = texto.split('\n');
            let prof = 1, j = i + 1, cuerpo = [], cuerpoCrudo = [];
            while (j < lineas.length && j < i + 80) {
                prof += (lineas[j].match(/\{/g) || []).length - (lineas[j].match(/\}/g) || []).length;
                if (prof <= 0) break;
                cuerpo.push(lineas[j]); cuerpoCrudo.push(crudas[j]); j++;
            }
            if (prof > 0) return false;                       // no se pudo cerrar: no se acusa
            const codigo = cuerpo.map(l => l.trim()).filter(Boolean);
            if (codigo.length) return false;                  // hay código: maneja el error
            // Sólo comentario. Se acusa nada más si NO explica: una explicación
            // de verdad ocupa más que una palabra.
            const explicacion = cuerpoCrudo.join(' ').replace(/[/*]/g, ' ').replace(/\s+/g, ' ').trim();
            return explicacion.length < 30;
        },
    },
    {
        id: 'dinero-en-number',
        eje: 'datos',
        titulo: 'Monto capturado en un campo numérico del navegador',
        ve: 'Un `type="number"` en la misma línea o cerca de una etiqueta que habla de dinero. '
          + 'El campo numérico nativo no tiene separador decimal en teclado latino y descarta '
          + 'lo que el usuario escribió sin avisar.',
        noVe: 'El campo de cantidad, que sí puede ser numérico. Se filtra por el nombre, así que '
            + 'un campo de monto llamado de otra forma se escapa.',
        archivos: /^src\/.*\.jsx$/,
        buscar: (linea) => /type=["']number["']/.test(linea)
            && /(monto|precio|costo|total|salario|efectivo|importe|pago|saldo|valor)/i.test(linea),
    },
    {
        id: 'escritura-sin-bitacora',
        eje: 'observabilidad',
        titulo: 'Archivo que escribe en la base y no registra nada en la bitácora',
        ve: 'Un archivo de `src/data/` con al menos una escritura (insert/update/delete/upsert) '
          + 'y ni una referencia a `appendAuditLog`. La regla del proyecto es que toda acción '
          + 'de usuario va a `audit_logs`.',
        noVe: 'El que registra desde un trigger de Postgres o desde el llamador. Este detector '
            + 'mira UN archivo por vez: no puede seguir la cadena, así que sobre-acusa.',
        archivos: /^src\/data\/.*\.js$/,
        porArchivo: (texto) =>
            /\.(insert|update|delete|upsert)\(/.test(texto) && !/appendAuditLog|audit_logs|registrarAuditoria/.test(texto),
    },
    {
        id: 'submit-sin-freno',
        eje: 'resiliencia',
        titulo: 'Botón que envía y no se apaga mientras trabaja',
        ve: 'Un `<Button` con `onClick` que llama a algo `async` y sin `disabled` ni `loading` '
          + 'en el mismo elemento. Dos toques seguidos mandan la operación dos veces.',
        noVe: 'El que se protege con una bandera dentro del handler. Sobre-acusa a propósito: '
            + 'es más barato revisar un botón de más que despachar un pedido dos veces.',
        archivos: /^src\/(views|components)\/.*\.jsx$/,
        multilinea: true,
        // Sólo cuenta el `onClick={async …}` que además tiene un `await` adentro.
        // La primera versión aceptaba cualquier verbo del nombre y acusó a
        // «Confirmar» de un modal que sólo hacía `setModo('confirmar')` —cambiar
        // una variable local no se puede mandar dos veces—. Y el corte del
        // elemento tomaba doce líneas de corrido, así que el botón «Cancelar» de
        // arriba heredaba el `onClick` del botón de abajo. Nueve de trece eran
        // falsos: un detector así hace que se desactive la categoría entera.
        buscar: (_l, _t, i, lineas) => {
            if (!/<Button\b/.test(lineas[i])) return false;
            let el = '', prof = 0, j = i;
            while (j < lineas.length && j < i + 25) {
                el += lineas[j] + '\n';
                prof += (lineas[j].match(/[{(]/g) || []).length - (lineas[j].match(/[})]/g) || []).length;
                if (prof <= 0 && /\/>|>\s*$|>[^<]*<\/Button>/.test(lineas[j])) break;
                j++;
            }
            return /onClick=\{\s*async\b/.test(el) && /\bawait\b/.test(el)
                && !/\b(disabled|loading|cargando|guardando|enviando|ocupado|procesando)\b/.test(el);
        },
    },
    {
        id: 'fecha-sin-hora',
        eje: 'datos',
        titulo: 'Fecha sin hora leída como si fuera UTC',
        ve: '`new Date(` sobre algo con forma `YYYY-MM-DD` sin hora. El navegador lo interpreta '
          + 'como medianoche UTC y en El Salvador (UTC-6) el día retrocede uno.',
        noVe: 'La cadena que llega con hora, que es correcta. Y la que se parte a mano, que '
            + 'también lo es.',
        archivos: /^src\/.*\.(js|jsx)$/,
        buscar: (linea) => /new Date\((?!\s*\))/.test(linea)
            && /\d{4}-\d{2}-\d{2}(?!T)/.test(linea)
            && !/T\d{2}:/.test(linea),
    },
    {
        id: 'texto-del-sistema-de-origen',
        eje: 'ux',
        titulo: 'La pantalla nombra el sistema de origen o la jerga de la tubería',
        ve: 'Un literal de texto que ve el usuario y dice ERP, «sincronizar», «sync» o «resync». '
          + 'La regla del usuario, corregida dos veces: que todo parezca que sale del portal.',
        noVe: 'El identificador que SÍ se queda (`erp_id`, `ERP_ORDER`, `matchErpFilter`) — se '
            + 'filtran. Pero tampoco ve el texto que se arma por variable, ni el que vive en la '
            + 'base. Grepear no alcanza: la verificación real es abrir la vista.',
        archivos: /^src\/(views|components)\/.*\.jsx$/,
        buscar: (linea) => {
            // Una cadena que es el ARGUMENTO de una llamada técnica no la ve
            // nadie: `.channel('sidebar-sync-status')` era el primer hallazgo de
            // esta categoría y es el nombre de un canal de Realtime.
            // Se BORRA el contenido de className y de los argumentos técnicos, no se
            // descarta la línea entera. Descartarla se comió un hallazgo real: el
            // rótulo «Sync» del menú lateral vive en un <span> que además lleva
            // className, y con el filtro ancho el único texto visible de esa línea
            // desaparecía junto con las clases de Tailwind. Un filtro que apaga el
            // hallazgo junto con el ruido es peor que no filtrar: deja el número
            // más chico y más falso.
            const limpia = linea
                .replace(/className=\{[^}]*\}/g, 'className={}')
                .replace(/className="[^"]*"/g, 'className=""')
                .replace(/\.(channel|from|rpc|getItem|setItem|removeItem|querySelector|getAttribute|setAttribute|addEventListener|includes|startsWith|endsWith|split|join|replace|match|test)\s*\([^)]*\)/g, '');
            const textos = [...limpia.matchAll(/(?:>|["'`])\s*([^"'`<>{}]{4,90}?)\s*(?:<|["'`])/g)].map(m => m[1]);
            return textos.some(t =>
                /\bERP\b/.test(t) || /\bsincroniz|\bresync\b/i.test(t) || /\bsync\b/i.test(t)
            ) && !/erp_[a-z]|_erp\b|ERP_[A-Z]|erpId|matchErp|syncKey|sync_|data-/.test(limpia);
        },
    },
];

// ── Quitar los comentarios antes de mirar ───────────────────────────────────
// Los tres primeros hallazgos de `fecha-sin-hora` eran el comentario de
// `src/utils/semana.js` que EXPLICA por qué `new Date('2026-08-18')` retrocede
// un día. O sea: el detector estaba acusando a la documentación de la regla que
// venía a hacer cumplir. Es la misma familia del detector de acuse que señalaba
// a 36 tarjetas correctas — un instrumento que no distingue código de prosa
// produce un número grande y sin sentido, y un número así termina desactivando
// el detector entero.
function sinComentarios(lineas) {
    let enBloque = false;
    return lineas.map(l => {
        let out = l;
        if (enBloque) { const fin = out.indexOf('*/'); if (fin === -1) return ''; out = out.slice(fin + 2); enBloque = false; }
        out = out.replace(/\/\*[\s\S]*?\*\//g, '');
        const ini = out.indexOf('/*');
        if (ini !== -1) { enBloque = true; out = out.slice(0, ini); }
        return out.replace(/(^|[^:])\/\/.*$/, '$1');
    });
}

// ── Barrido ─────────────────────────────────────────────────────────────────
const archivos = execSync("git ls-files 'src/**'", { cwd: RAIZ })
    .toString().trim().split('\n').filter(f => /\.(js|jsx)$/.test(f));

const hallazgos = [];
for (const f of archivos) {
    const texto = fs.readFileSync(path.join(RAIZ, f), 'utf8');
    const lineas = sinComentarios(texto.split('\n'));
    const area = areaDeArchivo(f);
    for (const cat of CATEGORIAS) {
        if (!cat.archivos.test(f)) continue;
        if (cat.porArchivo) {
            if (cat.porArchivo(texto)) hallazgos.push({ cat: cat.id, eje: cat.eje, area, archivo: f, linea: 1, texto: '' });
            continue;
        }
        for (let i = 0; i < lineas.length; i++) {
            if (cat.buscar(lineas[i], texto, i, lineas))
                hallazgos.push({ cat: cat.id, eje: cat.eje, area, archivo: f, linea: i + 1, texto: lineas[i].trim().slice(0, 100) });
        }
    }
}

if (JSON_OUT) { console.log(JSON.stringify({ categorias: CATEGORIAS.map(({ id, eje, titulo, ve, noVe }) => ({ id, eje, titulo, ve, noVe })), hallazgos }, null, 2)); process.exit(0); }

// ── Informe ─────────────────────────────────────────────────────────────────
const g = s => `\x1b[90m${s}\x1b[0m`, n = s => `\x1b[1m${s}\x1b[0m`;
console.log(n('\n  BARRIDO DE AUDITORÍA — lo que los once gates no miran\n'));

for (const cat of CATEGORIAS) {
    const hs = hallazgos.filter(h => h.cat === cat.id);
    console.log(`  ${n(cat.titulo)}  ${hs.length ? `\x1b[33m${hs.length}\x1b[0m` : '\x1b[32m0\x1b[0m'}   ${g('→ eje ' + cat.eje)}`);
    console.log(g(`     ve:    ${cat.ve}`));
    console.log(g(`     no ve: ${cat.noVe}`));
    if (hs.length) {
        const porArea = {};
        hs.forEach(h => (porArea[h.area] = (porArea[h.area] || 0) + 1));
        console.log('     por área: ' + Object.entries(porArea).sort((a, b) => b[1] - a[1])
            .map(([a, c]) => `${a} ${c}`).join(' · '));
        console.log(g('     ejemplos para abrir a mano:'));
        hs.slice(0, 3).forEach(h => console.log(g(`       ${h.archivo}:${h.linea}  ${h.texto}`)));
    }
    console.log('');
}

console.log(n('  Por área\n'));
for (const a of AREAS) {
    const hs = hallazgos.filter(h => h.area === a.id);
    if (!hs.length) { console.log(`  \x1b[32m✓\x1b[0m ${a.id}`); continue; }
    const porCat = {};
    hs.forEach(h => (porCat[h.cat] = (porCat[h.cat] || 0) + 1));
    console.log(`  \x1b[33m·\x1b[0m ${a.id.padEnd(18)} ${String(hs.length).padStart(3)}   `
              + g(Object.entries(porCat).sort((x, y) => y[1] - x[1]).map(([c, k]) => `${c}:${k}`).join(' ')));
}
console.log(n(`\n  Total: ${hallazgos.length} hallazgo(s) en ${new Set(hallazgos.map(h => h.archivo)).size} archivo(s).`));
console.log(g('  Ninguno entra al registro sin abrir tres a mano primero.\n'));
