#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Las funciones de la base, cada una con su área
// ─────────────────────────────────────────────────────────────────────────────
//
// Hasta el 2026-10-21 el mapa de auditoria/areas.mjs cubría archivos, tablas,
// edge functions y crons — pero no las ~1,200 funciones de `public`, que es
// donde vive buena parte de la lógica del portal. Ninguna entraba en ningún
// porcentaje: se podía auditar un área entera sin mirar el SQL que la hace
// funcionar.
//
// Escribirlas a mano en areas.mjs no escala ni se mantiene. Este script PROPONE
// el área de cada función a partir de quién la usa DE VERDAD, en este orden
// (la primera evidencia que contesta, gana):
//
//   1. trigger  — la tabla que la dispara
//   2. cron     — el cron que la llama
//   3. código   — las pantallas, datos y edge functions que la nombran
//   4. tablas   — las tablas que lee o escribe su cuerpo
//   5. llamada  — las funciones ya asignadas que la llaman
//
// Lo que no se puede resolver queda con área `null` y el gate lo marca: eso se
// asigna a mano, con `"manual": true` para que una corrida posterior no lo pise.
//
//   npm run auditoria:funciones            muestra qué cambiaría
//   npm run auditoria:funciones -- --escribir
//
// Sólo lee producción. Escribe únicamente auditoria/funciones.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREAS, areaDeArchivo } from '../auditoria/areas.mjs';
import { abrirCanal } from './lib/canal-supabase.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(RAIZ, 'auditoria', 'funciones.json');
const ESCRIBIR = process.argv.includes('--escribir');

const SQL = `
SELECT json_build_object(
  'funciones', (SELECT json_agg(json_build_object('n', p.proname, 'src', p.prosrc))
                  FROM (SELECT DISTINCT ON (p.proname) p.proname, p.prosrc FROM pg_proc p
                         WHERE p.pronamespace = 'public'::regnamespace
                           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
                         ORDER BY p.proname, length(p.prosrc) DESC) p),
  'triggers',  (SELECT coalesce(json_agg(json_build_object('f', p.proname, 't', c.relname)), '[]')
                  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_class c ON c.oid = t.tgrelid
                 WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace),
  'crons',     (SELECT coalesce(json_agg(json_build_object('j', jobname, 'cmd', command)), '[]') FROM cron.job),
  'policies',  (SELECT coalesce(json_agg(json_build_object('t', tablename, 'q', coalesce(qual, '') || ' ' || coalesce(with_check, ''))), '[]')
                  FROM pg_policies WHERE schemaname = 'public')
) AS r`;

// ── producción ──────────────────────────────────────────────────────────────
const canal = abrirCanal('auditoria-funciones');
let prod;
try { prod = canal.consultar(SQL)[0].r; } finally { canal.cerrar(); }
const nombres = new Set(prod.funciones.map(f => f.n));

// ── dueños conocidos ────────────────────────────────────────────────────────
const areaDeTabla = new Map(), areaDeCron = new Map(), areaDeEdge = new Map();
for (const a of AREAS) {
    a.tablas.forEach(t => areaDeTabla.set(t, a.id));
    a.crons.forEach(c => areaDeCron.set(c, a.id));
    a.edge.forEach(e => areaDeEdge.set(e, a.id));
}
const palabras = (txt) => new Set(String(txt).match(/[a-z_][a-z0-9_]*/gi)?.map(s => s.toLowerCase()) || []);
const votar = (areas) => {
    const cuenta = new Map();
    areas.filter(Boolean).forEach(a => cuenta.set(a, (cuenta.get(a) || 0) + 1));
    const orden = [...cuenta].sort((x, y) => y[1] - x[1]);
    return orden[0]?.[0] ?? null;
};

// ── el código: qué archivo nombra a qué función ────────────────────────────
// Se buscan los nombres ENTRE COMILLAS (`.rpc('x')`, `"x"`), no cualquier
// palabra: una función que se llama como una variable no la "usa" ese archivo.
const usosEnCodigo = new Map();    // función -> [área, …]
function recorrer(dir, alArchivo) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) recorrer(p, alArchivo);
        else if (/\.(m?js|jsx|ts|tsx)$/.test(e.name)) alArchivo(p);
    }
}
const anotar = (archivo, area) => {
    const txt = fs.readFileSync(archivo, 'utf8');
    for (const m of txt.matchAll(/['"`]([a-z_][a-z0-9_]*)['"`]/g))
        if (nombres.has(m[1])) (usosEnCodigo.get(m[1]) || usosEnCodigo.set(m[1], []).get(m[1])).push(area);
};
recorrer(path.join(RAIZ, 'src'), (p) => {
    const rel = path.relative(RAIZ, p);
    if (rel === 'src/types/database.ts') return;   // nombra TODAS: no es un uso
    const area = areaDeArchivo(rel);
    if (area) anotar(p, area);
});
const dirEdge = path.join(RAIZ, 'supabase', 'functions');
for (const d of fs.existsSync(dirEdge) ? fs.readdirSync(dirEdge) : []) {
    const area = areaDeEdge.get(d);
    if (area) recorrer(path.join(dirEdge, d), (p) => anotar(p, area));
}

// ── la propuesta ────────────────────────────────────────────────────────────
const previo = fs.existsSync(DESTINO) ? JSON.parse(fs.readFileSync(DESTINO, 'utf8')) : { funciones: {} };
const propuesta = {};
const srcDe = new Map(prod.funciones.map(f => [f.n, f.src || '']));

for (const n of [...nombres].sort()) {
    const viejo = previo.funciones?.[n];
    if (viejo?.manual) { propuesta[n] = viejo; continue; }

    let area = null, por = null;
    // Los helpers de permisos los usan las policies de TODAS las áreas: su
    // dueño es el área de permisos, no la que más los nombra.
    if (/^(auth_|sec_)/.test(n)) { propuesta[n] = { area: 'permisos', por: 'nombre' }; continue; }
    const tr = prod.triggers.filter(t => t.f === n).map(t => areaDeTabla.get(t.t));
    if ((area = votar(tr))) por = 'trigger';
    if (!area) {
        const cr = prod.crons.filter(c => palabras(c.cmd).has(n)).map(c => areaDeCron.get(c.j));
        if ((area = votar(cr))) por = 'cron';
    }
    if (!area) {
        // Una utilidad que nombran cuatro áreas o más sin que ninguna tenga la
        // mitad de los usos es del chasis, no de la que más la nombra.
        const usos = usosEnCodigo.get(n) || [];
        const distintas = new Set(usos);
        const top = votar(usos);
        if (distintas.size >= 4 && usos.filter(x => x === top).length * 2 < usos.length) { area = 'plataforma'; por = 'transversal'; }
        else if ((area = top)) por = 'código';
    }
    if (!area) {
        const tok = palabras(srcDe.get(n));
        const tb = [...tok].filter(t => areaDeTabla.has(t)).map(t => areaDeTabla.get(t));
        if ((area = votar(tb))) por = 'tablas';
    }
    if (!area) {
        // Una función que usan las policies es un permiso de la base.
        if (prod.policies.some(p => palabras(p.q).has(n))) { area = 'permisos'; por = 'policy'; }
    }
    propuesta[n] = { area, por };
}
// 5. Las que quedaron: el área de quien las llama, ya resuelto. Dos pasadas
//    alcanzan para las cadenas cortas; lo demás queda para mano.
for (let vuelta = 0; vuelta < 3; vuelta++) {
    for (const n of Object.keys(propuesta)) {
        if (propuesta[n].area) continue;
        const llamadoPor = [...nombres].filter(m => m !== n && propuesta[m]?.area && palabras(srcDe.get(m)).has(n));
        const area = votar(llamadoPor.map(m => propuesta[m].area));
        if (area) propuesta[n] = { area, por: 'llamada' };
    }
}

// ── informe ─────────────────────────────────────────────────────────────────
const cambios = Object.keys(propuesta).filter(n => previo.funciones?.[n]?.area !== propuesta[n].area);
const quitadas = Object.keys(previo.funciones || {}).filter(n => !nombres.has(n));
const sinArea = Object.keys(propuesta).filter(n => !propuesta[n].area);
const porMetodo = {};
Object.values(propuesta).forEach(v => { porMetodo[v.por ?? 'sin área'] = (porMetodo[v.por ?? 'sin área'] || 0) + 1; });

console.log(`\n  ${nombres.size} funciones en producción · ${cambios.length} con área nueva o distinta · ${quitadas.length} ya no existen`);
console.log('  por evidencia: ' + Object.entries(porMetodo).map(([k, v]) => `${k} ${v}`).join(' · '));
if (sinArea.length) console.log(`  sin área (asignar a mano, con "manual": true): ${sinArea.join(', ')}`);

if (ESCRIBIR) {
    fs.writeFileSync(DESTINO, JSON.stringify({
        nota: 'Área de cada función de `public`. La propone `npm run auditoria:funciones` según quién la usa '
            + '(trigger > cron > código > tablas > policy > quien la llama). Lo marcado "manual": true lo decidió '
            + 'una persona y el script no lo pisa. gate:auditoria falla si una función de producción no está acá.',
        generado: new Date().toISOString(),
        funciones: propuesta,
    }, null, 1) + '\n');
    console.log(`  ✓ escrito ${path.relative(RAIZ, DESTINO)}\n`);
} else console.log('  (vista previa — `-- --escribir` para guardarlo)\n');
