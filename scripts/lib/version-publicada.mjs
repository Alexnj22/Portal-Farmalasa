/**
 * Anota en `app_version_publicada` la compilación que se acaba de subir, para
 * que la app de clientes avise «Hay una versión nueva» (2026-10-29). La usan
 * `subir-ios.mjs` y `subir-android.mjs`.
 *
 * Sólo la app de clientes tiene fila. El `build` sólo sube (`build < nuevo`):
 * volver a subir una compilación vieja no hace retroceder el aviso.
 *
 * Nunca hace fallar la subida: la compilación ya está en la tienda, y lo peor
 * que pasa sin la fila es que la app no avise. Si no se pudo, imprime el SQL
 * para correrlo a mano.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { abrirCanal } from './canal-supabase.mjs';

/* Un worktree (`npm run worktree`) no trae el enlace completo del proyecto
 * (`supabase/.temp/project-ref`): ahí el CLI contesta «Cannot find project
 * ref». Se abre el canal desde el árbol principal, que sí lo tiene. */
function dondeEstaElEnlace() {
  if (existsSync('supabase/.temp/project-ref')) return null;
  try {
    const comun = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const principal = dirname(resolve(comun));
    return existsSync(resolve(principal, 'supabase/.temp/project-ref')) ? principal : null;
  } catch { return null; }
}

export function anotarVersionPublicada({ perfil, plataforma, version, build }) {
  if (perfil !== 'clientes') return;
  const v = String(version);
  const b = Number(build);
  if (!/^[0-9.]+$/.test(v) || !Number.isInteger(b) || b <= 0 || !['ios', 'android'].includes(plataforma)) {
    console.warn(`⚠ No se anotó la versión publicada: datos raros (${plataforma} ${v} ${build}).`);
    return;
  }
  const sql = `UPDATE public.app_version_publicada SET version = '${v}', build = ${b}, publicada_at = now()
 WHERE app = 'clientes' AND plataforma = '${plataforma}' AND build < ${b} RETURNING build`;
  let canal = null;
  const antes = process.cwd();
  const otro = dondeEstaElEnlace();
  try {
    if (otro) process.chdir(otro);
    canal = abrirCanal('version-publicada');
    const filas = canal.consultar(sql);
    console.log(filas.length
      ? `✓ La app avisará «Hay una versión nueva» a quien tenga una compilación anterior a la ${b} (${plataforma}).`
      : `· La versión publicada de ${plataforma} ya era ${b} o mayor: no se cambió.`);
  } catch (e) {
    console.warn(`⚠ No se anotó la versión publicada (${e.detalleCli || e.message}). A mano:\n${sql};`);
  } finally {
    canal?.cerrar();
    process.chdir(antes);
  }
}
