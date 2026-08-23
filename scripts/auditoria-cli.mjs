#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Las cuatro operaciones del registro de auditoría
// ─────────────────────────────────────────────────────────────────────────────
//
//   desbloquear <area> "motivo"      abrir un área congelada, con motivo escrito
//   sellar <area> "evidencia"        volver a cerrarla después de verificar
//   recalcular                       derivar `pct` y `estado` de los ejes
//   sincronizar <archivo.json>       refrescar el snapshot de producción
//
// Están en un archivo aparte del gate a propósito: el gate sólo LEE, y corre en
// el hook de pre-commit. Un script que escribe no tiene nada que hacer ahí — el
// día que un bug le haga tocar el registro durante un commit, el commit se
// llevaría un puntaje que nadie decidió.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { AREAS, EJES, TOPE_SIN_SELLO } from '../auditoria/areas.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRO = path.join(RAIZ, 'auditoria', 'registro.json');
const DESBLOQUEOS = path.join(RAIZ, 'auditoria', 'desbloqueos.json');
const SNAPSHOT = path.join(RAIZ, 'auditoria', 'snapshot-produccion.json');

const PESO_TOTAL = EJES.reduce((s, e) => s + e.peso, 0);
const hoy = () => new Date().toISOString().slice(0, 10);

const leer = (p, def) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } };
const escribir = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const morir = m => { console.error(`\n  ✗ ${m}\n`); process.exit(1); };

function pctDe(e) {
    if (!e?.ejes) return 0;
    const suma = EJES.reduce((s, eje) => s + ((e.ejes[eje.id]?.pct ?? 0) * eje.peso), 0);
    const bruto = Math.round(suma / PESO_TOTAL);
    return e.sello_sala ? bruto : Math.min(bruto, TOPE_SIN_SELLO);
}

// El estado se DERIVA, nunca se escribe a mano. Escribirlo a mano es cómo un
// área termina «congelada» sin haber llegado a 100 — y el candado protegiendo
// algo que nadie verificó es peor que no tener candado, porque da confianza.
function estadoDe(e) {
    const p = pctDe(e);
    if (!e?.ejes || !Object.keys(e.ejes).length) return 'sin-auditar';
    if (p >= 100 && e.sello_sala) return 'congelado';
    if (p >= TOPE_SIN_SELLO) return 'completo';
    return 'en-curso';
}

const [cmd, ...resto] = process.argv.slice(2);

switch (cmd) {

// ── desbloquear ─────────────────────────────────────────────────────────────
case 'desbloquear': {
    const [areaId, ...motivoPartes] = resto;
    const motivo = motivoPartes.join(' ').trim();
    if (!areaId || !motivo) morir('Uso: npm run auditoria:desbloquear -- <area> "motivo por el que se toca"');
    if (!AREAS.some(a => a.id === areaId)) morir(`No existe el área «${areaId}». Son: ${AREAS.map(a => a.id).join(', ')}`);

    const registro = leer(REGISTRO, { areas: {} });
    const entrada = registro.areas[areaId];
    if (entrada?.estado !== 'congelado') {
        console.log(`\n  · «${areaId}» no está congelada (estado: ${entrada?.estado || 'sin-auditar'}). No hace falta desbloquear.\n`);
        break;
    }

    const d = leer(DESBLOQUEOS, { abiertos: [] });
    if (d.abiertos.some(x => x.area === areaId)) morir(`«${areaId}» ya está descongelada. Sellala antes de volver a abrirla.`);

    let sha = '(sin repo)';
    try { sha = execSync('git rev-parse --short HEAD', { cwd: RAIZ }).toString().trim(); } catch { /* */ }

    d.abiertos.push({
        area: areaId,
        motivo,
        desde: hoy(),
        commit_al_abrir: sha,
        pct_al_abrir: pctDe(entrada),
        // Qué hay que volver a mirar al cerrar. Por defecto TODO: acotarlo es
        // una decisión de quien audita, y tiene que quedar escrita.
        reverificar: EJES.map(e => e.id),
    });
    escribir(DESBLOQUEOS, d);

    registro.areas[areaId].estado = 'en-curso';
    registro.areas[areaId].descongelada_el = hoy();
    escribir(REGISTRO, registro);

    console.log(`\n  🔓 «${areaId}» descongelada.\n`);
    console.log(`     motivo: ${motivo}`);
    console.log(`     Al terminar:  npm run auditoria:sellar -- ${areaId} "qué se corrió"`);
    console.log(`     Hasta entonces, \`npm run gate:auditoria\` va a fallar. Es a propósito.\n`);
    break;
}

// ── sellar ──────────────────────────────────────────────────────────────────
case 'sellar': {
    const [areaId, ...evidenciaPartes] = resto;
    const evidencia = evidenciaPartes.join(' ').trim();
    if (!areaId || !evidencia) morir('Uso: npm run auditoria:sellar -- <area> "qué se corrió para verificarlo"');
    if (!AREAS.some(a => a.id === areaId)) morir(`No existe el área «${areaId}».`);

    const registro = leer(REGISTRO, { areas: {} });
    const entrada = registro.areas[areaId];
    if (!entrada) morir(`«${areaId}» no está en el registro. Auditala antes de sellarla.`);

    const p = pctDe(entrada);
    if (p < 100) morir(
        `«${areaId}» está en ${p}%. No se sella lo que no llegó a 100.\n`
      + `    Ejes bajos: ${EJES.filter(e => (entrada.ejes?.[e.id]?.pct ?? 0) < 100).map(e => `${e.id}(${entrada.ejes?.[e.id]?.pct ?? 0})`).join(', ')}`
      + (entrada.sello_sala ? '' : `\n    Y falta el sello de sala: sin una corrida real el tope es ${TOPE_SIN_SELLO}%.`)
    );

    entrada.verificaciones = entrada.verificaciones || [];
    entrada.verificaciones.push({ fecha: hoy(), evidencia });
    entrada.estado = 'congelado';
    delete entrada.descongelada_el;
    entrada.pct = p;
    escribir(REGISTRO, registro);

    const d = leer(DESBLOQUEOS, { abiertos: [] });
    d.abiertos = d.abiertos.filter(x => x.area !== areaId);
    escribir(DESBLOQUEOS, d);

    console.log(`\n  🔒 «${areaId}» sellada al ${p}%.\n     ${evidencia}\n`);
    break;
}

// ── recalcular ──────────────────────────────────────────────────────────────
case 'recalcular': {
    const registro = leer(REGISTRO, { areas: {} });
    const d = leer(DESBLOQUEOS, { abiertos: [] });
    const abiertas = new Set(d.abiertos.map(x => x.area));
    const cambios = [];

    for (const area of AREAS) {
        const e = registro.areas[area.id] ||= { ejes: {}, sello_sala: null, hallazgos: [] };
        const antesPct = e.pct, antesEstado = e.estado;
        e.pct = pctDe(e);
        // Un área con desbloqueo abierto NO vuelve sola a «congelado» aunque el
        // puntaje dé 100: el sello lo pone `sellar`, que exige escribir qué se
        // corrió. Si recalcular pudiera congelar, la verificación de después
        // sería opcional — que es justo lo que el candado existe para impedir.
        e.estado = abiertas.has(area.id) ? 'en-curso' : estadoDe(e);
        if (e.pct !== antesPct || e.estado !== antesEstado)
            cambios.push(`${area.id}: ${antesPct ?? '—'}% ${antesEstado ?? '—'} → ${e.pct}% ${e.estado}`);
    }
    registro.recalculado = hoy();
    escribir(REGISTRO, registro);
    console.log(cambios.length ? `\n  ${cambios.length} cambio(s):\n` + cambios.map(x => `    ${x}`).join('\n') + '\n'
                               : '\n  Sin cambios.\n');
    break;
}

// ── sincronizar ─────────────────────────────────────────────────────────────
case 'sincronizar': {
    const origen = resto[0];
    if (!origen) morir(
        'Uso: npm run auditoria:sincronizar -- <archivo.json>\n'
      + '    El archivo lleva {"tablas": [...], "crons": [...]} tal como están HOY en producción.\n'
      + '    Se genera con el MCP de Supabase (list_tables / cron.job) — no desde acá, porque\n'
      + '    este script también corre sin red.'
    );
    const datos = leer(path.resolve(origen), null);
    if (!datos?.tablas || !datos?.crons) morir('El archivo tiene que traer `tablas` y `crons`.');
    escribir(SNAPSHOT, {
        generado: new Date().toISOString(),
        tablas: datos.tablas.sort(),
        crons: datos.crons.sort(),
        // Lo que se puede tocar SIN iniciar sesión. Se guarda en el mismo
        // snapshot porque se mide en la misma corrida: separarlo garantiza que
        // uno de los dos se quede viejo.
        anon: datos.anon ? { funciones: (datos.anon.funciones || []).sort(), tablas: (datos.anon.tablas || []).sort() } : undefined,
    });
    console.log(`\n  ✓ Snapshot actualizado: ${datos.tablas.length} tablas, ${datos.crons.length} crons`
        + (datos.anon ? `, superficie anon: ${(datos.anon.funciones || []).length} funciones y ${(datos.anon.tablas || []).length} tablas.` : '.') + '\n');
    break;
}

default:
    console.log(`
  Registro de auditoría del portal

    npm run auditoria                              informe por área
    npm run auditoria:desbloquear -- <area> "..."  abrir un área congelada
    npm run auditoria:sellar -- <area> "..."       volver a cerrarla tras verificar
    npm run auditoria:recalcular                   derivar pct y estado de los ejes
    npm run auditoria:sincronizar -- <json>        refrescar el snapshot de producción

  Áreas: ${AREAS.map(a => a.id).join(', ')}
`);
}
