// Metro para la app del teléfono (F8 de docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md).
//
// El núcleo NO se copia: se lee de `src/` del portal, el mismo código que usa la
// web. Dos alias, los mismos nombres que en `vite.config.js`:
//   @nucleo/…      → src/…            (data, utils, store, hooks, constants…)
//   @plataforma/…  → ./plataforma/…   (los adaptadores de ESTA app; la web
//                                      tiene los suyos en src/plataforma)
//
// Un paquete que pide un archivo de `src/` (`react`, `zustand`…) se resuelve
// como si lo pidiera la app, nunca desde la raíz del portal: con dos copias de
// React los hooks revientan («Invalid hook call») y el mensaje no nombra la
// causa. Por eso todo paquete que el núcleo use va en el package.json de la app.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const app = __dirname;
const raiz = path.resolve(app, '../..');
const config = getDefaultConfig(app);

const nucleo = path.join(raiz, 'src') + path.sep;
config.watchFolders = [nucleo];

const ALIAS = {
  '@nucleo/': path.join(raiz, 'src') + '/',
  '@plataforma/': path.join(app, 'plataforma') + '/',
};
// Paquetes que el núcleo carga con `import()` SÓLO en la web — `@zxing/library`
// dibuja el código de barras y el QR de la vista previa del ticket. En el
// teléfono el papel va por la cola como texto del rollo y nunca se dibuja, pero
// Metro resuelve todo `import()` al compilar: sin esto, importar
// `utils/ticketPrint` rompe el bundle. El sustituto lanza si alguien lo usa.
const SOLO_WEB = new Set(['@zxing/library', 'pdfmake/build/pdfmake', 'pdfmake/build/vfs_fonts']);
const resolverOriginal = config.resolver.resolveRequest;
config.resolver.resolveRequest = (contexto, nombre, plataforma) => {
  for (const [prefijo, destino] of Object.entries(ALIAS)) {
    if (nombre.startsWith(prefijo)) {
      return contexto.resolveRequest(contexto, destino + nombre.slice(prefijo.length), plataforma);
    }
  }
  if (SOLO_WEB.has(nombre)) {
    return { type: 'sourceFile', filePath: path.join(app, 'plataforma', '_soloWeb.js') };
  }
  const resolver = resolverOriginal || contexto.resolveRequest;
  const esPaquete = !nombre.startsWith('.') && !path.isAbsolute(nombre);
  if (esPaquete && contexto.originModulePath.startsWith(nucleo)) {
    return resolver({ ...contexto, originModulePath: path.join(app, 'package.json') }, nombre, plataforma);
  }
  return resolver(contexto, nombre, plataforma);
};

module.exports = config;
