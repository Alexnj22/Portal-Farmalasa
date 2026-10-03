#!/usr/bin/env node
/**
 * gate:alcance — ¿alguien puede tocar lo de OTRA sucursal cambiando un número?
 *
 * ── Por qué existe (2026-10-02) ──────────────────────────────────────────────
 * Empezó con `creditos-erp · pedir_correccion`: tomaba `body.sala` del
 * navegador y nunca comparaba esa sala contra la de quien llamaba. La edge
 * function usa la llave del servidor, que salta el RLS, así que el único freno
 * posible estaba en su código, y faltaba. Al buscar el mismo patrón en el resto
 * aparecieron otros: recibir pedidos de otra sala, anotar vales en la caja de
 * otra sala, despachar desde Bodega sin ser de Bodega, cobrar un crédito con
 * permiso de sólo lectura, y dos funciones que cualquiera en internet podía
 * disparar. Plan: `docs/PLAN-ALCANCE-POR-SUCURSAL-2026-10-02.md`.
 *
 * Ninguno daba error. Las pantallas no los ofrecían; bastaba con mandar la
 * petición a mano. Por eso no lo ve ninguna prueba que pase por la interfaz.
 *
 * ── Qué hace ──────────────────────────────────────────────────────────────────
 * Cada edge function y cada función SECURITY DEFINER que recibe una sucursal
 * va DECLARADA en `scripts/alcance-manifest.json` con su guarda:
 *
 *   alcance         el código compara la sala contra la de quien llama
 *                   (verificado: tiene que contener uno de los ayudantes)
 *   modulo-de-red   sólo la ejecuta quien tiene un módulo que HOY sólo tienen
 *                   cargos de toda la red (verificado contra `role_permissions`)
 *   sin-sala        no lee ni escribe nada de una sucursal (con motivo)
 *   cruza-por-diseno  ve otras sucursales A PROPÓSITO, y el motivo dice por qué
 *                   (el recorrido de entrega existe para moverse entre salas)
 *   cron            la llama un proceso automático con secreto (verificado)
 *   publica         abierta a propósito (con motivo)
 *   solo-servidor   (rpc) no debe poder ejecutarla `authenticated` (verificado)
 *   deuda           hueco conocido, con su fase del plan; sólo puede BAJAR
 *
 * Falla si:
 *   · aparece una función sin declarar — la pregunta «¿y la sucursal?» se
 *     tiene que contestar al escribirla, no en la próxima auditoría;
 *   · una `alcance` deja de contener el chequeo;
 *   · un módulo de una `modulo-de-red` se le da a un cargo de UNA sala. Ésta es
 *     la mitad que protege a futuro: esas funciones no comparan la sala porque
 *     hoy nadie de sala tiene el módulo, y el día que alguien lo tenga quedan
 *     abiertas sin que cambie una línea de código;
 *   · una `cron` deja de validar su secreto;
 *   · hay una `deuda` que no estaba en el baseline (el baseline sólo baja).
 *
 * ── Lo que NO ve, y está medido ───────────────────────────────────────────────
 * Lee la edge function ENTERA, no acción por acción. `trasladar-pedido-erp`
 * tiene el chequeo en `recibir` y le falta en `enviar`: el archivo contiene
 * `alcanceTodo` y una regla por archivo la daría por buena. Por eso una función
 * con varias acciones y un hueco en una se declara `deuda` hasta que se cierra,
 * y por eso declarar `alcance` es una AFIRMACIÓN que hay que poder sostener
 * leyendo cada acción, no sólo que el grep encuentre la palabra.
 *
 * Uso:
 *   npm run gate:alcance             local + producción
 *   npm run gate:alcance -- --hook   sólo local (sin red): declaración y código
 *   npm run gate:alcance -- --update-baseline   quita del baseline lo ya cerrado
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;
const FUNCIONES = join(RAIZ, 'supabase/functions');
const arg = (n) => process.argv.includes(n);
const valorDe = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };

const RUTA_MANIFIESTO = valorDe('--manifiesto') || join(RAIZ, 'scripts/alcance-manifest.json');
const RUTA_BASELINE = join(RAIZ, 'scripts/alcance-baseline.json');
const MANIFIESTO = JSON.parse(readFileSync(RUTA_MANIFIESTO, 'utf8'));
const BASELINE = JSON.parse(readFileSync(RUTA_BASELINE, 'utf8'));

const GUARDAS_EDGE = ['alcance', 'modulo-de-red', 'sin-sala', 'cruza-por-diseno', 'cron', 'publica', 'deuda'];
const GUARDAS_RPC = ['alcance', 'modulo-de-red', 'sin-sala', 'cruza-por-diseno', 'solo-servidor', 'deuda'];
const CON_MOTIVO = ['sin-sala', 'publica', 'deuda', 'modulo-de-red', 'cruza-por-diseno'];

/* Cómo se reconoce que el código compara la sala. Ayudantes del proyecto, no
 * nombres de variables cualesquiera: una regla que acepte «branch» aceptaría
 * cualquier función que nombre una sucursal, que son todas. */
const ALCANCE_EDGE = /\balcanceTodo\b|\bpuedeObrarPor\b/;
const ALCANCE_RPC = /auth_module_scope|auth_employee_branch_id|auth_employee_erp_sucursal_id|auth_can_edit_scope_all|alcance_de_ventas|bitacora_exigir_acceso|facturas_sala_guarda/i;
/* El secreto se valida con el ayudante o escrito a mano contra el encabezado
 * (`apply-scheduled-employee-events`, `backup-critical-tables`): las dos formas
 * cuentan, lo que no cuenta es nombrarlo sin compararlo. */
const SECRETO_CRON = /\b(checkCronSecret|requireInvokeSecret)\s*\(|ADMIN_INVOKE_SECRET[\s\S]{0,300}?Authorization[\s\S]{0,200}?Bearer \$\{|Authorization[\s\S]{0,300}?ADMIN_INVOKE_SECRET/;

const hallazgos = [];
const fallar = (donde, msg) => hallazgos.push(`${donde}: ${msg}`);

// ── 1. Edge functions (local) ───────────────────────────────────────────────
const edges = readdirSync(FUNCIONES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(FUNCIONES, d.name, 'index.ts')))
  .map((d) => d.name);

const deudas = { edge: [], rpc: [] };
const modulosAVerificar = [];   // [donde, modulo]

for (const nombre of edges) {
  const decl = MANIFIESTO.edge?.[nombre];
  const donde = `edge ${nombre}`;
  if (!decl) { fallar(donde, 'no está declarada en alcance-manifest.json — ¿cómo se protege por sucursal?'); continue; }
  if (!GUARDAS_EDGE.includes(decl.guarda)) { fallar(donde, `guarda desconocida «${decl.guarda}»`); continue; }
  if (CON_MOTIVO.includes(decl.guarda) && !String(decl.motivo ?? '').trim()) fallar(donde, `«${decl.guarda}» exige motivo escrito`);
  const src = readFileSync(join(FUNCIONES, nombre, 'index.ts'), 'utf8');

  if (decl.guarda === 'alcance' && !ALCANCE_EDGE.test(src)) {
    fallar(donde, 'declarada «alcance» pero no compara la sala (falta alcanceTodo / puedeObrarPor)');
  }
  if (decl.guarda === 'cron' && !SECRETO_CRON.test(src)) {
    fallar(donde, 'declarada «cron» pero no valida el secreto (checkCronSecret / requireInvokeSecret): cualquiera puede llamarla');
  }
  if (decl.guarda === 'modulo-de-red') {
    if (!decl.modulos?.length) fallar(donde, '«modulo-de-red» sin `modulos`');
    for (const m of decl.modulos ?? []) {
      if (!src.includes(`'${m}'`) && !src.includes(`"${m}"`)) fallar(donde, `declara el módulo «${m}» y el código no lo nombra`);
      modulosAVerificar.push([donde, m]);
    }
  }
  if (decl.guarda === 'deuda') {
    if (!decl.plan) fallar(donde, 'una deuda lleva su fase del plan (`plan`)');
    deudas.edge.push(nombre);
  }
}
for (const nombre of Object.keys(MANIFIESTO.edge ?? {})) {
  if (!edges.includes(nombre)) fallar(`edge ${nombre}`, 'declarada en el manifiesto y ya no existe — sacarla');
}

// ── 2. Funciones de la base (producción) ────────────────────────────────────
let midioRemoto = false;
if (!arg('--hook')) {
  const { abrirCanal } = await import('./lib/canal-supabase.mjs');
  let canal;
  try {
    canal = abrirCanal('alcance-gate');
    const rpcs = canal.consultar(`
      select p.proname as nombre, p.prosrc as src,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as autenticado
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and pg_get_function_identity_arguments(p.oid) ~* '(branch|sala|sucursal)'`);
    const porNombre = new Map();
    for (const r of rpcs) porNombre.set(r.nombre, { ...r, src: (porNombre.get(r.nombre)?.src ?? '') + r.src,
      autenticado: r.autenticado || porNombre.get(r.nombre)?.autenticado });

    for (const [nombre, r] of porNombre) {
      const decl = MANIFIESTO.rpc?.[nombre];
      const donde = `rpc ${nombre}`;
      if (!decl) {
        // Sólo cuenta si `authenticated` la puede ejecutar: si no, no hay puerta.
        if (r.autenticado) fallar(donde, 'SECURITY DEFINER con sucursal, ejecutable por authenticated y sin declarar');
        continue;
      }
      if (!GUARDAS_RPC.includes(decl.guarda)) { fallar(donde, `guarda desconocida «${decl.guarda}»`); continue; }
      if (CON_MOTIVO.includes(decl.guarda) && !String(decl.motivo ?? '').trim()) fallar(donde, `«${decl.guarda}» exige motivo escrito`);
      if (decl.guarda === 'alcance' && !ALCANCE_RPC.test(r.src)) fallar(donde, 'declarada «alcance» pero su cuerpo no compara la sala');
      if (decl.guarda === 'solo-servidor' && r.autenticado) fallar(donde, '«solo-servidor» pero authenticated la puede ejecutar — REVOKE EXECUTE');
      if (decl.guarda === 'modulo-de-red') {
        if (!decl.modulos?.length) fallar(donde, '«modulo-de-red» sin `modulos`');
        for (const m of decl.modulos ?? []) {
          if (!r.src.includes(`'${m}'`)) fallar(donde, `declara el módulo «${m}» y el cuerpo no lo nombra`);
          modulosAVerificar.push([donde, m]);
        }
      }
      if (decl.guarda === 'deuda') {
        if (!decl.plan) fallar(donde, 'una deuda lleva su fase del plan (`plan`)');
        deudas.rpc.push(nombre);
      }
    }
    for (const nombre of Object.keys(MANIFIESTO.rpc ?? {})) {
      if (!porNombre.has(nombre)) fallar(`rpc ${nombre}`, 'declarada en el manifiesto y ya no existe (o ya no recibe sucursal) — sacarla');
    }

    // ¿Algún cargo de UNA sala tiene un módulo «de red»?
    const modulos = [...new Set(modulosAVerificar.map(([, m]) => m))];
    if (modulos.length) {
      const lista = modulos.map((m) => `'${m.replace(/'/g, "''")}'`).join(',');
      const deSala = canal.consultar(`
        select rp.module_key as modulo, r.name as cargo,
               (select count(*) from employees e where e.role_id = r.id and e.status = 'ACTIVO')::int as activos
          from role_permissions rp join roles r on r.id = rp.role_id
         where rp.module_key in (${lista})
           and coalesce(rp.scope, 'ALL') <> 'ALL'
           and (rp.can_view or rp.can_edit or coalesce(rp.can_approve, false))`);
      for (const [donde, m] of modulosAVerificar) {
        for (const f of deSala.filter((x) => x.modulo === m)) {
          fallar(donde, `«modulo-de-red» pero el cargo «${f.cargo}» (${f.activos} activos) tiene «${m}» con alcance de una sala — esta función ya no frena a nadie`);
        }
      }
    }
    midioRemoto = true;
  } catch (e) {
    fallar('producción', `no se pudo medir: ${e.message}`);
  } finally {
    canal?.cerrar?.();
  }
}

// ── 3. Trinquete de deudas ──────────────────────────────────────────────────
for (const tipo of ['edge', 'rpc']) {
  if (tipo === 'rpc' && !midioRemoto) continue;
  for (const n of deudas[tipo]) {
    if (!BASELINE[tipo].includes(n)) fallar(`${tipo} ${n}`, 'deuda NUEVA: el baseline sólo baja. Cerrarla, no declararla');
  }
}
const cerradas = ['edge', 'rpc'].flatMap((t) => (t === 'rpc' && !midioRemoto) ? []
  : BASELINE[t].filter((n) => !deudas[t].includes(n)).map((n) => `${t} ${n}`));

if (arg('--update-baseline')) {
  const nuevo = {
    ...BASELINE,
    edge: BASELINE.edge.filter((n) => deudas.edge.includes(n)),
    rpc: midioRemoto ? BASELINE.rpc.filter((n) => deudas.rpc.includes(n)) : BASELINE.rpc,
  };
  writeFileSync(RUTA_BASELINE, JSON.stringify(nuevo, null, 2) + '\n');
  console.log(`  baseline: ${cerradas.length} deuda(s) cerrada(s) quitada(s).`);
}

// ── Informe ─────────────────────────────────────────────────────────────────
const nEdge = Object.keys(MANIFIESTO.edge ?? {}).length;
const nRpc = Object.keys(MANIFIESTO.rpc ?? {}).length;
console.log(`\n  gate:alcance — ${edges.length} edge functions (${nEdge} declaradas), ${nRpc} funciones de la base declaradas${midioRemoto ? '' : ' (sin medir: --hook)'}`);
console.log(`  deuda: ${deudas.edge.length} edge · ${midioRemoto ? deudas.rpc.length : '?'} rpc (baseline ${BASELINE.edge.length} · ${BASELINE.rpc.length})`);
if (cerradas.length && !arg('--update-baseline')) {
  console.log(`  ✓ ya no son deuda: ${cerradas.join(', ')} — correr con --update-baseline para bajarlo`);
}
if (hallazgos.length) {
  console.log(`\n  ✗ ${hallazgos.length} hallazgo(s):`);
  for (const h of hallazgos) console.log(`     ${h}`);
  console.log('');
  process.exit(1);
}
console.log('  ✓ gate:alcance en verde\n');
