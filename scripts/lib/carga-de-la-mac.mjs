// ¿Está la Mac en condiciones de recibir más trabajo?
//
// Nació el 2026-11-10: la Mac estaba lenta y la foto era load 80 en 10 núcleos
// (una compilación Android con 24 clang++ en paralelo, lanzada por una sesión),
// 15.9 GB de swap usados de 16, dos `expo start` vivos hace 29 y 35 días y seis
// sesiones de Claude abiertas, una de 7 días. Ninguna de esas cosas falla: sólo
// hace que un pre-commit de segundos tarde minutos.
//
// Sólo LEE. Nunca mata un proceso: lo que está corriendo puede ser de otra
// sesión o del usuario. Devuelve hallazgos con su PID para que alguien decida.
import { execSync } from 'node:child_process';
import { cpus, loadavg, totalmem } from 'node:os';

const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

// Umbrales. La carga se juzga por núcleo: 1.0 = cada núcleo con un proceso
// esperando; por encima de 2 la máquina ya se siente trabada.
export const UMBRAL = {
  cargaAviso: 1.0,        // load1 / núcleos
  cargaRojo: 2.0,
  swapAvisoGB: 4,
  swapRojoGB: 10,
  memLibreRojo: 10,       // % libre según memory_pressure
  servidorViejoHoras: 24, // un expo/vite que lleva más de un día vivo
  sesionViejaHoras: 72,   // una sesión de Claude de más de tres días
};

/** etime de ps ([[dd-]hh:]mm:ss) → horas. */
const horas = (etime) => {
  const [d, resto] = etime.includes('-') ? etime.split('-') : ['0', etime];
  const p = resto.split(':').map(Number);
  while (p.length < 3) p.unshift(0);
  return Number(d) * 24 + p[0] + p[1] / 60;
};

const procesos = () => sh('ps -Ao pid=,ppid=,pcpu=,rss=,etime=,command=')
  .split('\n').filter(Boolean).map((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return m && { pid: +m[1], ppid: +m[2], cpu: +m[3], mb: +m[4] / 1024, horas: horas(m[5]), cmd: m[6] };
  }).filter(Boolean);

export const corto = (cmd) => {
  const [exe, ...args] = cmd.split(' ');
  return `${exe.split('/').pop()} ${args.join(' ')}`.slice(0, 90);
};

export function medirCarga() {
  const nucleos = cpus().length;
  const [l1, l5, l15] = loadavg();
  const swap = sh('sysctl -n vm.swapusage').match(/used = ([\d.]+)M/);
  const swapGB = swap ? +swap[1] / 1024 : 0;
  const libre = sh('memory_pressure').match(/free percentage: (\d+)%/);
  const memLibre = libre ? +libre[1] : null;
  const arranque = sh('sysctl -n kern.boottime').match(/sec = (\d+)/);
  const diasEncendida = arranque ? (Date.now() / 1000 - +arranque[1]) / 86400 : null;
  const ps = procesos();

  const compilando = ps.filter((p) => /GradleDaemon|gradlew|xcodebuild|\/ninja |clang\+\+|swift-frontend|vite build|playwright|vitest/.test(p.cmd));
  const servidores = ps.filter((p) => /expo start|vite( |$)|next dev|npm run (dev|preview)/.test(p.cmd)
    && !/npm exec/.test(p.cmd) && p.horas > UMBRAL.servidorViejoHoras);
  const sesiones = ps.filter((p) => /(^|\/)claude( |$)/.test(p.cmd));
  const sesionesViejas = sesiones.filter((p) => p.horas > UMBRAL.sesionViejaHoras);
  const topCpu = [...ps].sort((a, b) => b.cpu - a.cpu).slice(0, 5);

  const hallazgos = [];
  const add = (nivel, texto, detalle = [], sugerencia = null) => hallazgos.push({ nivel, texto, detalle, sugerencia });

  // Memoria por aplicación (todo lo que vive dentro de un mismo .app suma junto).
  const porApp = new Map();
  for (const p of ps) {
    // Gradle corre con el Java que trae Android Studio: sin esto, una
    // compilación se leía como «Android Studio · 2 GB» y la sugerencia era
    // cerrar una app que ni estaba abierta.
    const m = p.cmd.match(/\/([^/]+)\.app\//);
    const nombre = /gradle|\.gradle\/|\/jbr\/.*\/java /.test(p.cmd) ? 'Gradle (compilación)'
      : m ? m[1] : p.cmd.split(' ')[0].split('/').pop();
    porApp.set(nombre, (porApp.get(nombre) || 0) + p.mb);
  }
  const apps = [...porApp].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([n, mb]) => `${n} · ${(mb / 1024).toFixed(1)} GB`);

  const porNucleo = l1 / nucleos;
  const sugCarga = compilando.length
    ? 'No lances otra compilación, pruebas e2e ni `npm run build` hasta que termine la que corre; baja sola.'
    : `Mirá «Más CPU ahora»: el primero (pid ${topCpu[0]?.pid}) es quien la ocupa. Si no es tuyo de trabajo, cerralo.`;
  if (porNucleo >= UMBRAL.cargaRojo) add('rojo', `Carga ${l1.toFixed(0)} en ${nucleos} núcleos (${porNucleo.toFixed(1)} por núcleo).`, [], sugCarga);
  else if (porNucleo >= UMBRAL.cargaAviso) add('aviso', `Carga ${l1.toFixed(0)} en ${nucleos} núcleos.`, [], sugCarga);

  const sugMemoria = 'Cerrá las aplicaciones que no estés usando (las que más ocupan, arriba). '
    + 'Lo que ya se fue al swap no vuelve solo: reiniciá la Mac cuando no haya una compilación corriendo.';
  if (swapGB >= UMBRAL.swapRojoGB) add('rojo', `Swap: ${swapGB.toFixed(1)} GB usados (RAM ${(totalmem() / 2 ** 30).toFixed(0)} GB).`, apps, sugMemoria);
  else if (swapGB >= UMBRAL.swapAvisoGB) add('aviso', `Swap: ${swapGB.toFixed(1)} GB usados.`, apps, sugMemoria);

  if (memLibre !== null && memLibre < UMBRAL.memLibreRojo) add('rojo', `Memoria libre: ${memLibre}%.`, apps, sugMemoria);

  if (compilando.length) {
    const raices = new Set(compilando.filter((p) => /gradlew|xcodebuild|vite build|playwright|vitest/.test(p.cmd)).map((p) => p.pid));
    add(compilando.length > nucleos ? 'rojo' : 'aviso',
      `${compilando.length} procesos de compilación/pruebas corriendo.`,
      [...raices].slice(0, 6).map((pid) => { const p = ps.find((x) => x.pid === pid); return `pid ${pid} · ${Math.round(p.horas * 60)} min · ${corto(p.cmd)}`; }),
      'Dejala terminar. Si lleva mucho más de lo normal o nadie la espera, `kill <pid>` del proceso de arriba la corta entera.');
  }
  if (servidores.length) add('aviso', `${servidores.length} servidor(es) de desarrollo vivos hace más de ${UMBRAL.servidorViejoHoras} h.`,
    servidores.map((p) => `pid ${p.pid} · ${Math.round(p.horas / 24)} días · ${corto(p.cmd)}`),
    `Si no los estás usando: \`kill ${servidores.map((p) => p.pid).join(' ')}\` (se vuelven a levantar en segundos cuando haga falta).`);
  if (sesionesViejas.length) add('aviso', `${sesiones.length} sesiones de Claude abiertas; ${sesionesViejas.length} con más de ${UMBRAL.sesionViejaHoras / 24} días.`,
    sesionesViejas.map((p) => `pid ${p.pid} · ${Math.round(p.horas / 24)} días · ${p.mb.toFixed(0)} MB`),
    'Cerrá las sesiones que ya no uses con /exit en su terminal (no con kill: puede tener trabajo a medias).');
  if (diasEncendida !== null && diasEncendida > 14) add('aviso', `Encendida hace ${Math.floor(diasEncendida)} días sin reiniciar.`, [],
    'Reiniciala al terminar el día: libera el swap y los procesos olvidados de una vez.');

  const nivel = hallazgos.some((h) => h.nivel === 'rojo') ? 'rojo' : hallazgos.length ? 'aviso' : 'ok';
  return { nivel, nucleos, carga: [l1, l5, l15], swapGB, memLibre, diasEncendida, hallazgos, topCpu };
}

/**
 * Antes de arrancar trabajo pesado (una compilación): espera mientras la carga
 * por núcleo esté por encima de `tope`. No falla: quien la lanzó quería la
 * compilación, sólo que después. `SIN_ESPERAR_CARGA=1` la salta.
 */
export async function esperarCarga({ que = 'la compilación', tope = 1.5, maxMinutos = 30 } = {}) {
  if (process.env.SIN_ESPERAR_CARGA === '1') return;
  const nucleos = cpus().length;
  const inicio = Date.now();
  let avisado = 0;
  for (;;) {
    const l1 = loadavg()[0];
    if (l1 / nucleos < tope) break;
    if (Date.now() - inicio > maxMinutos * 60_000) {
      console.log(`⚠ La carga sigue en ${l1.toFixed(0)} tras ${maxMinutos} min: se arranca ${que} igual.`);
      break;
    }
    if (Date.now() - avisado > 60_000) {
      console.log(`⏳ Mac cargada (load ${l1.toFixed(0)} en ${nucleos} núcleos): ${que} espera a que baje de ${(tope * nucleos).toFixed(0)}. `
        + '`npm run mac:carga` dice quién la ocupa.');
      avisado = Date.now();
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  if (avisado) console.log(`▶ Carga en ${loadavg()[0].toFixed(0)}: arranca ${que}.`);
}
