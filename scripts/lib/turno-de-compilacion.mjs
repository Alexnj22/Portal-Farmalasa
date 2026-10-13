// Una plataforma a la vez por app: iOS y Android de la MISMA app no compilan
// juntos en esta Mac.
//
// Nació el 2026-10-13: `subir-ios` y `subir-android` de Puntos Salud corrían a
// la vez (más el Android de la app del personal) y la carga llegó a 65 en una
// máquina que además atiende varias sesiones de trabajo — un pre-commit de
// segundos tardaba más de diez minutos. Decisión del usuario: «que siempre sea
// así, una plataforma a la vez por cada app».
//
// El turno es un archivo por app en el directorio temporal del sistema (no en
// el repo: las compilaciones corren desde worktrees distintos y tienen que ver
// el MISMO turno). Se toma con `wx`, que es atómico; si el dueño ya no existe
// —se cayó sin soltarlo— el turno se considera libre. Quien llega segundo
// espera y avisa cada minuto, no falla: el que lo lanzó quería la compilación,
// sólo que después.
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const DIR = join(tmpdir(), 'farmalasa-turno-de-compilacion');

const vivo = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

const leer = (ruta) => {
  try { return JSON.parse(readFileSync(ruta, 'utf8')); } catch { return null; }
};

/**
 * Espera hasta que ninguna otra compilación de esta app esté corriendo y toma
 * el turno. Lo suelta solo al salir el proceso.
 *
 * @param {string} carpetaApp  la carpeta de la app (`apps/clientes`); el turno
 *                             es por su nombre, así un worktree comparte turno
 *                             con el árbol principal.
 * @param {'ios'|'android'} plataforma
 */
export async function esperarTurno(carpetaApp, plataforma) {
  mkdirSync(DIR, { recursive: true });
  const app = basename(carpetaApp);
  const ruta = join(DIR, `${app}.json`);
  const mio = JSON.stringify({ pid: process.pid, plataforma, desde: new Date().toISOString() });
  let avisado = 0;

  for (;;) {
    try {
      writeFileSync(ruta, mio, { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const dueno = leer(ruta);
    if (!dueno || !vivo(dueno.pid)) {
      // Un turno huérfano (el dueño murió sin soltarlo) o a medio escribir.
      try { unlinkSync(ruta); } catch { /* otro lo limpió primero */ }
      continue;
    }
    if (Date.now() - avisado > 60_000) {
      console.log(`⏳ ${app}: esperando a que termine la compilación de ${dueno.plataforma} `
        + `(pid ${dueno.pid}, desde ${dueno.desde}). Una plataforma a la vez por app.`);
      avisado = Date.now();
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }

  const soltar = () => {
    if (leer(ruta)?.pid === process.pid) {
      try { unlinkSync(ruta); } catch { /* ya no estaba */ }
    }
  };
  process.on('exit', soltar);
  for (const senal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(senal, () => { soltar(); process.exit(130); });
  }
  if (avisado) console.log(`▶ ${app}: turno tomado para ${plataforma}.`);
}
