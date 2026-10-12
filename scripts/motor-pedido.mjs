#!/usr/bin/env node
// Empaqueta la imprenta del pedido para el teléfono:
//   apps/mobile/motor/entrada.js  (pdfmake + src/utils/pedidoPdfDoc.js)
//   → apps/mobile/motor/motor-pedido.html  (un solo archivo, sin red)
//
// La app lo carga en un WebView oculto sólo al imprimir o finalizar un pedido
// (`apps/mobile/componentes/pedidos/motorPedido.js`).
//
// HAY QUE REGENERARLO al tocar `pedidoPdfDoc.js` (o lo que importa): si no,
// el teléfono imprime con la definición vieja y sus hojas dejan de ser las del
// portal. Lo vigila `tests/unit/motorPedido.test.js`, que vuelve a empaquetar y
// falla si el archivo quedó viejo.
//
//   node scripts/motor-pedido.mjs           → escribe el .html
//   node scripts/motor-pedido.mjs --revisar → sólo dice si está al día (exit 1 si no)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRADA = path.join(raiz, 'apps/mobile/motor/entrada.js');
export const SALIDA = path.join(raiz, 'apps/mobile/motor/motor-pedido.html');

export async function armarMotor() {
    const logo = `data:image/png;base64,${fs.readFileSync(path.join(raiz, 'public/Logo512.png')).toString('base64')}`;
    const r = await build({
        entryPoints: [ENTRADA],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: ['safari15', 'chrome100'],
        minify: true,
        legalComments: 'none',
        nodePaths: [path.join(raiz, 'node_modules')],
        define: { __LOGO_DEL_PORTAL__: JSON.stringify(logo) },
        logLevel: 'silent',
    });
    const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    return `<!doctype html><html><head><meta charset="utf-8"><title>motor</title></head><body><script>${js}</script></body></html>\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const html = await armarMotor();
    if (process.argv.includes('--revisar')) {
        const actual = fs.existsSync(SALIDA) ? fs.readFileSync(SALIDA, 'utf8') : '';
        if (actual !== html) { console.error('✗ motor-pedido.html está viejo: corre `node scripts/motor-pedido.mjs`'); process.exit(1); }
        console.log('✓ motor-pedido.html al día');
    } else {
        fs.writeFileSync(SALIDA, html);
        console.log(`✓ ${path.relative(raiz, SALIDA)} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
    }
}
