#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Pasa los borradores de la distribuidora (Torogoz) a PRODUCCIÓN.
// ─────────────────────────────────────────────────────────────────────────────
// Plan: docs/PLAN-TOROGOZ-A-PRODUCCION-2026-10-01.md. Lo corre una PERSONA:
//
//   node scripts/distribucion-a-produccion.mjs            # muestra qué haría
//   node scripts/distribucion-a-produccion.mjs --aplicar  # aplica
//   node scripts/distribucion-a-produccion.mjs --aplicar --desde 0012   # retoma
//
// Cada borrador va en UNA transacción que además lo registra en
// supabase_migrations.schema_migrations exactamente como `apply_migration`
// (versión UTC de 14 dígitos, statements = [sql], name). Se aplica desde el
// ARCHIVO y no copiado a mano: son 464 KB de SQL. Si un borrador falla, su
// transacción se deshace entera y el script se detiene; si el error es un
// lock timeout (los syncs escriben `products` cada minuto), reintenta.
//
// Por cada uno escribe `supabase/migrations/<versión>_<name>.sql` con el SQL
// aplicado, que va en el mismo commit (regla de CLAUDE.md).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PROD = 'sacecdkdmsdvgqnrsett';
const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BORRADORES = path.join(raiz, 'supabase', 'borradores', 'distribucion');
const DESTINO = path.join(raiz, 'supabase', 'migrations');
const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const desde = args.includes('--desde') ? args[args.indexOf('--desde') + 1] : '0001';
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const archivos = fs.readdirSync(BORRADORES).filter(f => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) >= desde).sort();
const nombre = (f) => 'distribucion_' + f.replace(/\.sql$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
console.log(`${archivos.length} borradores desde ${desde}:`);
for (const f of archivos) console.log(`  ${f} → ${nombre(f)}`);
if (!aplicar) { console.log('\nNada aplicado. Repetir con --aplicar.'); process.exit(0); }

// Una carpeta enlazada a producción, fuera del árbol: el `.env` del repo
// rompe al CLI y no se toca un archivo compartido.
const enlace = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-prod-'));
execFileSync('supabase', ['link', '--project-ref', PROD], { cwd: enlace, stdio: 'inherit' });
const query = (archivo) => execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', '-f', archivo],
    { cwd: enlace, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 }).toString();

// Freno: si ya existe alguna tabla dist_* y se arranca desde 0001, es una
// segunda corrida — los primeros borradores no son idempotentes.
const chequeo = path.join(enlace, 'chequeo.sql');
fs.writeFileSync(chequeo, "SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dist_emisores';");
const yaHay = /"n"\s*:\s*[1-9]/.test(query(chequeo));
if (yaHay && desde === '0001') {
    console.error('\n✗ dist_emisores ya existe en producción: esto ya se aplicó. Usar --desde NNNN para retomar.');
    process.exit(1);
}

let ultima = '';
for (const f of archivos) {
    const sql = fs.readFileSync(path.join(BORRADORES, f), 'utf8');
    const name = nombre(f);
    let ok = false;
    for (let intento = 1; intento <= 4 && !ok; intento++) {
        let v;
        do { v = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); if (v <= ultima) dormir(1100); } while (v <= ultima);
        const tag = `$migra_${Math.random().toString(36).slice(2, 8)}$`;
        const envuelto = `BEGIN;\n${sql}\n;\nINSERT INTO supabase_migrations.schema_migrations (version, statements, name, created_by)\n`
            + `VALUES ('${v}', ARRAY[${tag}${sql}${tag}], '${name}', current_user);\nCOMMIT;\n`;
        const tmp = path.join(enlace, 'envuelto.sql');
        fs.writeFileSync(tmp, envuelto);
        try {
            query(tmp);
            fs.writeFileSync(path.join(DESTINO, `${v}_${name}.sql`), sql);
            console.log(`✓ ${f} → ${v}_${name}.sql`);
            ultima = v; ok = true;
        } catch (e) {
            const msg = String(e.stderr ?? e.message).replace(/\s+/g, ' ').slice(0, 500);
            console.error(`✗ ${f} (intento ${intento}): ${msg}`);
            if (!/lock timeout|canceling statement due to lock/i.test(msg)) process.exit(1);
            dormir(20000);
        }
    }
    if (!ok) { console.error(`✗ se abortó en ${f}: reintentar con --desde ${f.slice(0, 4)}`); process.exit(1); }
    dormir(1100);
}
console.log('\n✓ Listo. Siguiente: desplegar las 3 funciones y el resto del plan.');
