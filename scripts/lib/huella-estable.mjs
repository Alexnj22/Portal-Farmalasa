/**
 * La huella de lo nativo (`runtimeVersion` con política `fingerprint`) depende
 * de DÓNDE están los `node_modules`, no sólo de qué tienen (2026-11-03).
 *
 * `@expo/fingerprint` arma el id de cada fuente con su ruta. En el árbol
 * principal es `node_modules/@bacons/apple-targets/…`; en un worktree, donde
 * `npm run worktree` ENLAZA los `node_modules` del árbol principal, la ruta
 * real es `../../../Portal-Farmalasa/apps/clientes/node_modules/…`. Mismo
 * código nativo, otra huella — y una actualización por aire sólo llega a los
 * teléfonos con la MISMA huella. Medido ese día: la publicación hecha desde un
 * worktree salió con una huella que no tenía ningún teléfono, y la de las
 * 17:00 (otra sesión, otro worktree) con una tercera.
 *
 * Lo mismo vale para compilar: un binario hecho en un worktree lleva adentro
 * una huella que después no reproduce una publicación hecha desde el árbol
 * principal. Por eso la guarda la comparten `publicar-actualizacion`,
 * `subir-ios` y `subir-android`: publicar y compilar, siempre desde una carpeta
 * cuyos `node_modules` son suyos.
 */
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';

export function exigirHuellaEstable(app) {
  const nm = join(app, 'node_modules');
  if (!existsSync(nm)) {
    console.error(`${nm} no existe: corré \`npm install\` en ${app}.`);
    process.exit(1);
  }
  const real = realpathSync(nm);
  const fuera = relative(realpathSync(app), real).startsWith('..');
  if (lstatSync(nm).isSymbolicLink() || fuera) {
    console.error(`✗ ${nm} es un enlace a ${real}.\n`
      + '  La huella de lo nativo incluye esa ruta: lo que salga de acá no llega a los teléfonos\n'
      + '  (o el binario no recibe las actualizaciones que se publiquen desde el árbol principal).\n'
      + '  Publicá y compilá desde el árbol principal, con el código ya commiteado y en main.');
    process.exit(1);
  }
}
