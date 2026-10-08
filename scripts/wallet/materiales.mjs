// Dibuja los materiales de la tarjeta (los MISMOS shaders de la app:
// apps/clientes/componentes/minerales/shaders.js) con CanvasKit, fuera del
// teléfono. Dos usos:
//   node scripts/wallet/materiales.mjs muestra <salida.png>   → hoja para revisar
//   node scripts/wallet/materiales.mjs franjas <carpeta>      → franjas de Wallet (PNG, a subir)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CanvasKitInit = require('../../apps/clientes/node_modules/canvaskit-wasm/bin/full/canvaskit.js');
const fuente = readFileSync(new URL('../../apps/clientes/componentes/minerales/shaders.js', import.meta.url), 'utf8')
  .replace(/export const /g, 'const ') + '\nreturn { PRELUDIO, SHADERS };';
const { PRELUDIO, SHADERS } = new Function(fuente)();

const CK = await CanvasKitInit({ locateFile: (f) => require.resolve(`../../apps/clientes/node_modules/canvaskit-wasm/bin/full/${f}`) });

function dibujar(clave, w, h, { t = 3.0, tilt = [0.15, -0.1], escala = 1 } = {}) {
  const efecto = CK.RuntimeEffect.Make(PRELUDIO + SHADERS[clave], (e) => { throw new Error(`${clave}: ${e}`); });
  const sup = CK.MakeSurface(w * escala, h * escala);
  const lienzo = sup.getCanvas();
  lienzo.scale(escala, escala);
  const pintura = new CK.Paint();
  pintura.setShader(efecto.makeShader([w, h, t, tilt[0], tilt[1]]));
  lienzo.drawRect(CK.LTRBRect(0, 0, w, h), pintura);
  const img = sup.makeImageSnapshot();
  const png = img.encodeToBytes();
  return { png, img, sup };
}

const [modo, salida] = process.argv.slice(2);
if (modo === 'muestra') {
  // Cada material, en dos inclinaciones, en una hoja.
  const claves = Object.keys(SHADERS); const W = 340, H = 214, M = 12;
  const hoja = CK.MakeSurface((W * 2 + M * 3), (H + M) * claves.length + M);
  const c = hoja.getCanvas(); c.clear(CK.Color(30, 30, 34, 1));
  claves.forEach((k, i) => {
    [[-0.4, 0.2], [0.5, -0.3]].forEach((tl, j) => {
      const { img } = dibujar(k, W, H, { tilt: tl, t: 2 + j * 3 });
      c.save(); const rr = CK.RRectXY(CK.XYWHRect(M + j * (W + M), M + i * (H + M), W, H), 18, 18); c.clipRRect(rr, CK.ClipOp.Intersect, true);
      c.drawImage(img, M + j * (W + M), M + i * (H + M)); c.restore();
    });
  });
  writeFileSync(salida, hoja.makeImageSnapshot().encodeToBytes());
  console.log('ok', salida);
} else if (modo === 'franjas') {
  // La franja de Wallet: 375×144 pt, @2x y @3x, que nace y muere en el color
  // de fondo del pase de ese material (FONDOS = NIVELES de _shared/pase.ts),
  // para que la tarjeta se lea como UNA pieza. Salen como archivos a `salida/`
  // y se suben al bucket privado `wallet-materiales`.
  const FONDOS = {
    vip: [40, 10, 52], bronce: [34, 15, 6], plata: [44, 48, 56], oro: [64, 38, 4], platino: [9, 10, 13],
    jade: [4, 30, 22], zafiro: [3, 12, 48], rubi: [40, 2, 10], diamante: [16, 19, 25],
  };
  const { mkdirSync } = await import('node:fs');
  mkdirSync(salida, { recursive: true });
  for (const k of Object.keys(SHADERS)) for (const e of [2, 3]) {
    const w = 375, h = 144;
    const efecto = CK.RuntimeEffect.Make(PRELUDIO + SHADERS[k], (er) => { throw new Error(`${k}: ${er}`); });
    const sup = CK.MakeSurface(w * e, h * e); const c = sup.getCanvas(); c.scale(e, e);
    const pin = new CK.Paint(); pin.setShader(efecto.makeShader([w, h, 4.0, 0.2, -0.15])); c.drawRect(CK.LTRBRect(0, 0, w, h), pin);
    const [r, g, b] = FONDOS[k];
    const fundido = new CK.Paint();
    fundido.setShader(CK.Shader.MakeLinearGradient([0, 0], [0, h],
      [CK.Color(r, g, b, 1), CK.Color(r, g, b, 0), CK.Color(r, g, b, 0), CK.Color(r, g, b, 1)], [0, 0.2, 0.74, 1], CK.TileMode.Clamp));
    c.drawRect(CK.LTRBRect(0, 0, w, h), fundido);
    writeFileSync(`${salida}/${k}@${e}x.png`, sup.makeImageSnapshot().encodeToBytes());
  }
  console.log('ok', salida);
} else {
  console.error('uso: materiales.mjs muestra|franjas <salida>'); process.exit(1);
}
