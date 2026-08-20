/**
 * El canal de sólo lectura contra producción, compartido por los gates.
 *
 * ── Por qué vive acá y no adentro de un gate ──────────────────────────────────
 * Nació en `gate:perf`. Cuando `gate:eficiencia` necesitó lo mismo, copiarlo
 * habría dejado dos versiones del mismo manejo de ruido y de errores del CLI —
 * y este repo ya pagó ese precio con los parsers de las pantallas de traslado,
 * donde la copia buena se arregló y la otra siguió rota meses. Una sola copia.
 */
import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Lo que el CLI escribe SIEMPRE, salga bien o mal. Si al filtrarlo no queda
 * nada, el fallo no vino de él y el mensaje de `execFileSync` es todo lo que
 * hay. */
const RUIDO_DEL_CLI = [
  /^Using workdir/,
  /^Initialising login role/,
  /^A new version of Supabase CLI/,
  /^We recommend updating/,
];
const sinRuidoDelCli = (txt) => String(txt ?? '')
  .split('\n')
  .map(l => l.trimEnd())
  .filter(l => l && !RUIDO_DEL_CLI.some(r => r.test(l)))
  .join('\n');

export function abrirCanal(quien = 'gate') {
  const dir = join(tmpdir(), `${quien}-${process.pid}`);
  mkdirSync(join(dir, 'supabase'), { recursive: true });
  for (const f of ['config.toml', '.temp']) {
    const origen = join('supabase', f);
    if (existsSync(origen)) cpSync(origen, join(dir, 'supabase', f), { recursive: true });
  }
  if (!existsSync(join(dir, 'supabase', '.temp'))) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error('el proyecto no está linkeado (falta supabase/.temp)');
  }
  /* El stderr se CAPTURA, no se descarta.
   *
   * Descartarlo tenía su motivo: el CLI escribe «Using workdir…»,
   * «Initialising login role…» y el aviso de versión nueva en CADA llamada, o
   * sea nueve párrafos de ruido por corrida. Pero cuando la llamada falla, ese
   * mismo canal es lo ÚNICO que dice por qué, y el gate quedaba anunciando «no
   * pude medir» sin poder decir de qué. Pasó el 2026-08-19: hubo que
   * reproducir la corrida a mano, con el stderr a la vista, para descubrir que
   * había sido transitorio — y la conclusión «transitorio» tampoco se podía
   * sostener sin haber visto el mensaje.
   *
   * Capturado y mostrado SÓLO al fallar, el ruido sigue sin aparecer y el
   * diagnóstico deja de exigir una segunda corrida. */
  const consultar = (sql) => {
    let salida;
    try {
      salida = execFileSync('supabase',
        ['db', 'query', '--workdir', dir, '--linked', '--agent', 'no', '-o', 'json', sql],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
    } catch (e) {
      e.detalleCli = sinRuidoDelCli(e.stderr);
      throw e;
    }
    const i = salida.indexOf('[');
    if (i < 0) throw new Error('la respuesta no traía filas');
    return JSON.parse(salida.slice(i));
  };
  return { consultar, cerrar: () => rmSync(dir, { recursive: true, force: true }) };
}

