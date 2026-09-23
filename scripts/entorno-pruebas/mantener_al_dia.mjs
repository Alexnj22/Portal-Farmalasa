#!/usr/bin/env node
// Mantiene el entorno de pruebas (branch `staging`) igual a producción.
//
//   SUPABASE_ACCESS_TOKEN=sbp_… node scripts/entorno-pruebas/mantener_al_dia.mjs            # sólo mira
//   SUPABASE_ACCESS_TOKEN=sbp_… node scripts/entorno-pruebas/mantener_al_dia.mjs --aplicar  # lo pone al día
//   SUPABASE_ACCESS_TOKEN=sbp_… node scripts/entorno-pruebas/mantener_al_dia.mjs --env      # reescribe .env.staging
//
// Lo corre todos los días `.github/workflows/entorno-pruebas.yml`.
//
// ── Por qué existe ────────────────────────────────────────────────────────────
// El branch no se actualiza solo. El 2026-08-24 tenía 130 migraciones de atraso;
// el 2026-09-23, un mes después de rehacerlo, 455 (546 contra 1,001). Nadie lo
// notaba hasta que una medición contra él hablaba de un portal que ya no existía.
//
// ── Qué hace, y por qué en este orden ─────────────────────────────────────────
//   1. Iguales → sólo corre las fechas a hoy y los permisos de la cuenta de pruebas.
//   2. Si le faltan migraciones → `push` (aplica las que faltan, conserva datos).
//   3. Si el push falla, o el branch tiene migraciones que producción no tiene
//      → REHACERLO: quitarle «permanente», borrarlo y crearlo de nuevo con el
//      mismo nombre. Sale con las 1,000+ migraciones y las semillas.
//
// Lo de (3) no es exageración, está medido el 2026-09-23:
//   · `reset` NO sirve: reconstruye con la historia PROPIA del branch (se quedó
//     en 546) y además deja vivos los objetos creados a mano.
//   · `push` falla con cualquier resto de un ensayo: probar DDL con `execute_sql`
//     —que es lo que manda CLAUDE.md— deja en el branch tablas y policies que la
//     migración real de producción después quiere crear. Pasó con
//     `security_config` («policy … already exists») y cortó el push en la 37.
// O sea que el branch se ensucia por usarlo bien, y la única limpieza completa
// es rehacerlo. Es un entorno de pruebas: rehacerlo es barato.
//
// Rehacerlo CAMBIA su dirección (`ref`). Por eso `--env` reescribe
// `.env.staging` desde la API: URL y clave anónima del branch nuevo, y las dos
// claves que no son de Supabase se copian del `.env`.
//
// ── Lo que NO hace ────────────────────────────────────────────────────────────
// Nunca escribe en producción: a producción sólo le LEE la lista de migraciones,
// y `sql()` se niega a correr escrituras contra ella.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROD = 'sacecdkdmsdvgqnrsett';
const NOMBRE = 'staging';
const API = 'https://api.supabase.com/v1';
const aplicar = process.argv.includes('--aplicar');
const soloEnv = process.argv.includes('--env');
const token = process.env.SUPABASE_ACCESS_TOKEN;
const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..', '..');

if (!token) {
    console.error('Falta SUPABASE_ACCESS_TOKEN (token personal de Supabase, «sbp_…»).');
    process.exit(1);
}

async function api(metodo, ruta, cuerpo) {
    const r = await fetch(`${API}${ruta}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(180_000),
    });
    const texto = await r.text();
    if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status}: ${texto.slice(0, 300)}`);
    return texto ? JSON.parse(texto) : null;
}

async function sql(ref, query, { escribe = false } = {}) {
    if (escribe && ref === PROD) throw new Error('Negado: este script no escribe en producción.');
    return api('POST', `/projects/${ref}/database/query`, { query });
}

const versiones = async (ref) =>
    (await sql(ref, 'select version from supabase_migrations.schema_migrations order by version'))
        .map((f) => f.version);

const buscarBranch = async () =>
    (await api('GET', `/projects/${PROD}/branches`)).find((x) => x.name === NOMBRE) || null;

async function esperar(nombre) {
    const hasta = Date.now() + 40 * 60_000;
    for (;;) {
        await new Promise((r) => setTimeout(r, 20_000));
        const b = await buscarBranch();
        const estado = b?.status;
        if (estado === 'FUNCTIONS_DEPLOYED' || estado === 'MIGRATIONS_PASSED') return b;
        if (estado === 'MIGRATIONS_FAILED' || estado === 'FUNCTIONS_FAILED') return b;
        if (Date.now() > hasta) throw new Error(`Pasaron 40 minutos y «${nombre}» sigue en ${estado}.`);
    }
}

function comparar(prod, branch) {
    const enProd = new Set(prod);
    const huerfanas = branch.filter((v) => !enProd.has(v));
    return {
        huerfanas,
        faltan: prod.filter((v) => !branch.includes(v)).length,
        igual: huerfanas.length === 0 && prod.length === branch.length,
    };
}

async function herramientas(ref) {
    const leer = (f) => fs.readFileSync(path.join(aqui, f), 'utf8');
    // Los crons que llaman a PRODUCCIÓN por HTTP se apagan en cada corrida, no
    // sólo al crear el branch: la semilla `20260903185033` apaga los que existían
    // ese día, y cada migración posterior que programe uno nuevo lo trae
    // encendido. Medido el 2026-09-23: dos de aperturas de caja quedaban vivos
    // apuntando a producción. `sql()` se niega a escribir en producción.
    await sql(ref, `select cron.alter_job(jobid, active := false) from cron.job
                     where active and command ilike '%net.http_post%'
                       and command ilike '%${PROD}%'`, { escribe: true });
    await sql(ref, leer('correr_fechas.sql'), { escribe: true });
    await sql(ref, 'select * from public.correr_fechas_del_branch_de_pruebas()', { escribe: true });
    await sql(ref, leer('permisos_de_la_cuenta_de_pruebas.sql'), { escribe: true });
}

async function rehacer(viejo) {
    console.log('→ rehaciendo el branch desde cero…');
    if (viejo) {
        if (viejo.persistent) await api('PATCH', `/branches/${viejo.id}`, { persistent: false });
        await api('DELETE', `/branches/${viejo.id}`);
    }
    await api('POST', `/projects/${PROD}/branches`, { branch_name: NOMBRE, persistent: true });
    const b = await esperar(NOMBRE);
    if (b.status !== 'FUNCTIONS_DEPLOYED' && b.status !== 'MIGRATIONS_PASSED') {
        throw new Error(`El branch nuevo terminó en ${b.status}.`);
    }
    console.log(`  nuevo ref: ${b.project_ref} — correr «--env» para actualizar .env.staging`);
    return b;
}

async function escribirEnv(ref) {
    const claves = await api('GET', `/projects/${ref}/api-keys`);
    const anon = claves.find((k) => k.name === 'anon' && !k.disabled)?.api_key;
    if (!anon) throw new Error('El branch no devolvió la clave anónima.');
    const env = fs.readFileSync(path.join(raiz, '.env'), 'utf8');
    const copiar = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '';
    const archivo = path.join(raiz, '.env.staging');
    const cabecera = fs.existsSync(archivo)
        ? fs.readFileSync(archivo, 'utf8').split('\n').filter((l) => l.startsWith('#')).join('\n')
        : '# Entorno de PRUEBAS — branch \'staging\'. Lo reescribe mantener_al_dia.mjs --env.';
    fs.writeFileSync(archivo, [
        cabecera, '',
        `VITE_SUPABASE_URL=https://${ref}.supabase.co`,
        `VITE_SUPABASE_ANON_KEY=${anon}`,
        `VITE_VAPID_PUBLIC_KEY=${copiar('VITE_VAPID_PUBLIC_KEY')}`,
        `VITE_GOOGLE_MAPS_API_KEY=${copiar('VITE_GOOGLE_MAPS_API_KEY')}`,
        '',
    ].join('\n'));
    console.log(`✓ .env.staging apunta a ${ref}`);
}

(async () => {
    let b = await buscarBranch();

    if (soloEnv) {
        if (!b) throw new Error(`No existe el branch «${NOMBRE}».`);
        await escribirEnv(b.project_ref);
        return;
    }

    if (!b) {
        console.log(`No existe el branch «${NOMBRE}».`);
        if (!aplicar) process.exit(2);
        b = await rehacer(null);
        await herramientas(b.project_ref);
        return;
    }

    const [prod, br] = await Promise.all([versiones(PROD), versiones(b.project_ref)]);
    let c = comparar(prod, br);
    console.log(`producción: ${prod.length} migraciones (última ${prod.at(-1)})`);
    console.log(`pruebas:    ${br.length} migraciones (última ${br.at(-1)}) · ref ${b.project_ref}`);

    if (!c.igual) {
        console.log(`Le faltan ${c.faltan}; tiene ${c.huerfanas.length} que producción no tiene.`);
        if (!aplicar) {
            console.log('(sólo mirando — con --aplicar lo pone al día)');
            process.exit(2);
        }
        if (c.huerfanas.length === 0) {
            console.log('→ push…');
            await api('POST', `/branches/${b.id}/push`);
            b = await esperar(NOMBRE);
            c = comparar(await versiones(PROD), await versiones(b.project_ref));
            console.log(`  push terminó en ${b.status}; faltan ${c.faltan}`);
        }
        if (!c.igual) b = await rehacer(b);

        c = comparar(await versiones(PROD), await versiones(b.project_ref));
        if (!c.igual) {
            console.error(`✗ Sigue distinto: faltan ${c.faltan}, huérfanas ${c.huerfanas.length}.`);
            process.exit(1);
        }
    } else {
        console.log('✓ Igual a producción.');
    }

    if (aplicar) {
        await herramientas(b.project_ref);
        console.log('✓ Fechas a hoy y permisos de la cuenta de pruebas al día.');
    }
})().catch((e) => {
    console.error(`✗ ${e.message}`);
    process.exit(1);
});
