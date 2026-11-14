#!/usr/bin/env node
// Control diario del gasto en Vercel — `npm run vercel:consumo`.
//
// Nació el 2026-11-14: la factura de noviembre fue $40 (Pro $20 + el paquete
// «Flat Rate CDN 10M» $20). Se quitó el paquete, así que desde el ciclo
// 14-nov → 14-dic las peticiones ($2 por millón) y la transferencia ($0.15/GB)
// se cobran por uso y se pagan del crédito de $20 que trae el Pro, junto con
// los minutos de compilación (el mes anterior: 4,564 min = $15.97, el 70 % del
// consumo). El mes anterior el uso habría sido ~$23 sin el paquete: el margen
// es chico, por eso se mira TODOS LOS DÍAS y no al llegar la factura.
//
// Qué hace:
//   1. Lee el consumo del ciclo actual (`vercel billing usage --json`).
//   2. Lee el ritmo de los últimos 7 días y proyecta el cierre del ciclo:
//      acumulado + (ritmo diario × días que faltan).
//   3. Lee el tope de gasto extra (`vercel billing budgets`), hoy $10, sin
//      pausa: pausar apaga el portal entero, no sólo los despliegues.
//   4. Dictamen:
//        verde    proyección ≤ crédito                → sale 0
//        amarillo proyección ≤ crédito + tope         → sale 0, con aviso
//        rojo     proyección > crédito + tope         → sale 1
//      Rojo hace fallar el workflow `consumo-vercel.yml` y GitHub manda el
//      correo. También sale rojo si no pudo leer: un control que no midió no
//      puede dar verde.
//
// Los montos son de uso de infraestructura (categoría `usage`), sin las
// licencias: las licencias son fijas y no se controlan día a día.
//
// Variables: VERCEL_TOKEN (en GitHub; en la Mac usa la sesión del CLI),
// VERCEL_TEAM_ID o VERCEL_SCOPE (por defecto el equipo del portal).
// Escribe un resumen en $GITHUB_STEP_SUMMARY si existe.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const CLI = process.env.VERCEL_CLI || 'vercel';
const SCOPE = process.env.VERCEL_TEAM_ID || process.env.VERCEL_SCOPE || 'edjoya15-1435s-projects';
const TOPE_POR_DEFECTO = 10; // si no se puede leer el tope, se asume el que se puso el 2026-11-14

function vercel(args) {
  const extra = ['--scope', SCOPE, '--json'];
  if (process.env.VERCEL_TOKEN) extra.push('--token', process.env.VERCEL_TOKEN);
  const [cmd, ...pre] = CLI.split(' ');
  const out = execFileSync(cmd, [...pre, ...args, ...extra], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
  const ini = out.indexOf('{');
  if (ini < 0) throw new Error(`respuesta sin JSON de «vercel ${args.join(' ')}»`);
  return JSON.parse(out.slice(ini));
}

const usd = (n) => `$${n.toFixed(2)}`;
const usoDe = (servicios) =>
  servicios.filter((s) => s.category === 'usage' && !s.included);
const suma = (servicios) => usoDe(servicios).reduce((t, s) => t + (s.cost || 0), 0);

function resumen(md) {
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

let ciclo, semana, tope;
try {
  ciclo = vercel(['billing', 'usage']);
  semana = vercel(['billing', 'usage', '--since', '7d', '--breakdown', 'daily']);
} catch (e) {
  console.error(`🔴 No se pudo leer el consumo de Vercel: ${e.message}`);
  if (e.stderr) console.error(String(e.stderr).slice(0, 2000));
  process.exit(1);
}
try {
  const b = vercel(['billing', 'budgets']);
  const delEquipo = (b.budgets || []).find((x) => x.scope === 'team' && x.status === 'active');
  tope = delEquipo ? delEquipo.amount : 0;
} catch {
  tope = TOPE_POR_DEFECTO;
}

const desde = new Date(ciclo.period.from);
const hasta = new Date(ciclo.period.to);
const ahora = new Date();
const diasCiclo = (hasta - desde) / 86_400_000;
const diasPasados = Math.max((ahora - desde) / 86_400_000, 0.01);
const diasFaltan = Math.max(diasCiclo - diasPasados, 0);

const acumulado = suma(ciclo.services || []);
const dias = (semana.breakdown?.data || []).filter((d) => d.periodKey !== ahora.toISOString().slice(0, 10));
const porDia = dias.map((d) => ({ dia: d.periodKey, costo: suma(d.services || []), servicios: usoDe(d.services || []) }));
const ritmoMedido = porDia.length ? porDia.reduce((t, d) => t + d.costo, 0) / porDia.length : acumulado / diasPasados;
// Mientras la ventana de 7 días tenga días del paquete de CDN, las peticiones
// no aparecen cobradas: se suman estimadas con el mes oct-nov (2.79 millones
// en 30 días ≈ 93 mil por día × $2 por millón). Desaparece sola cuando las
// peticiones ya se ven en el consumo.
const PETICIONES_ESTIMADAS_DIA = 0.19;
const peticionesCobradas = porDia.some((d) => d.servicios.some((s) => s.product === 'edgeRequest' && s.cost > 0));
const ritmo = ritmoMedido + (peticionesCobradas ? 0 : PETICIONES_ESTIMADAS_DIA);
const proyeccion = acumulado + ritmo * diasFaltan;

const credito = ciclo.creditBalance?.allocated ?? 20;
const limite = credito + tope;
const color = proyeccion <= credito ? 'verde' : proyeccion <= limite ? 'amarillo' : 'rojo';
const icono = { verde: '🟢', amarillo: '🟡', rojo: '🔴' }[color];

// Las licencias del ciclo: si reaparece el paquete de CDN, decirlo.
const licencias = (ciclo.services || []).filter((s) => s.category === 'subscription');

const filas = usoDe(ciclo.services || [])
  .sort((a, b) => b.cost - a.cost)
  .slice(0, 8)
  .map((s) => `| ${s.name} | ${Number(s.quantity).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${s.unit} | ${usd(s.cost)} |`);

resumen(`## ${icono} Consumo de Vercel — ${color}

Ciclo ${desde.toISOString().slice(0, 10)} → ${hasta.toISOString().slice(0, 10)} · día ${Math.ceil(diasPasados)} de ${Math.round(diasCiclo)}

| | |
|---|---|
| Uso acumulado | **${usd(acumulado)}** |
| Ritmo (últimos ${porDia.length} días) | ${usd(ritmo)} por día${peticionesCobradas ? '' : ` (incluye ${usd(PETICIONES_ESTIMADAS_DIA)} estimados de peticiones)`} |
| Proyección al cierre | **${usd(proyeccion)}** |
| Crédito incluido en el Pro | ${usd(credito)} |
| Tope de gasto extra | ${usd(tope)} (sin pausa) |
| Se pagaría aparte (proyectado) | ${usd(Math.max(proyeccion - credito, 0))} |

### En qué se va
| Servicio | Uso | Costo |
|---|---|---|
${filas.join('\n') || '| (sin uso) | | |'}

### Por día
| Día | Costo | Compilación |
|---|---|---|
${porDia.map((d) => {
  const b = d.servicios.find((s) => s.product === 'buildCpuMinutes');
  return `| ${d.dia} | ${usd(d.costo)} | ${b ? `${Math.round(b.quantity)} min` : '—'} |`;
}).join('\n')}

Licencias del ciclo: ${licencias.map((s) => `${s.name} ${usd(s.cost)}`).join(' · ') || '—'}
`);

if (color === 'amarillo') {
  console.log(`::warning::Vercel proyecta ${usd(proyeccion)}: pasa el crédito de ${usd(credito)} por ${usd(proyeccion - credito)}.`);
}
if (color === 'rojo') {
  console.log(`::error::Vercel proyecta ${usd(proyeccion)}: pasa el crédito más el tope (${usd(limite)}). Revisar compilaciones y tráfico.`);
  process.exit(1);
}
