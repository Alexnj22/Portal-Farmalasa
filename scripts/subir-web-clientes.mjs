#!/usr/bin/env node
// Publica Puntos Salud (apps/clientes) en el NAVEGADOR: app.farmasalud.lat.
//
//   node scripts/subir-web-clientes.mjs          → compila y publica
//   node scripts/subir-web-clientes.mjs --ver    → sólo compila (apps/clientes/dist)
//
// Es la MISMA app que la de iPhone y Android, compilada para web con Expo
// (`expo export --platform web`): se ve igual por construcción, no porque
// alguien copie pantallas. Lo que sólo existe en el teléfono (avisos, fotos,
// Wallet, cámara) ya tiene su rama `Platform.OS === 'web'` en la app.
//
// Igual que las apps nativas, se compila en ESTA Mac (no en Vercel: instalar
// todo Expo en cada despliegue es lento y caro) y se sube el resultado
// estático al proyecto `puntos-salud-web`, que no es el del portal: lo que
// toca `apps/` nunca dispara al portal (scripts/vercel-ignorar.sh), y esto no
// dispara nada del portal.
//
// Las variables EXPO_PUBLIC_* salen del perfil `clientes` de eas.json (las de
// PRODUCCIÓN), como en subir-ios.mjs — no del .env local, que puede apuntar al
// entorno de pruebas.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROYECTO = 'prj_Xmquqo1g1WOVCDWbuzYl1YzUKhYY'; // puntos-salud-web
const EQUIPO = 'team_ixok1wq6QmACIejj6GueVFrv';
const soloCompilar = process.argv.includes('--ver');

const app = resolve('apps/clientes');
const salida = join(app, 'dist');
const eas = JSON.parse(readFileSync(join(app, 'eas.json'), 'utf8'));
const env = { ...(eas.build?.clientes?.env ?? {}) };
if (!env.EXPO_PUBLIC_SUPABASE_URL?.includes('sacecdkdmsdvgqnrsett')) {
  console.error('El perfil «clientes» de eas.json no apunta a producción.');
  process.exit(1);
}

execSync(`npx expo export --platform web --clear --output-dir ${salida}`, {
  cwd: app, stdio: 'inherit', env: { ...process.env, ...env, NODE_ENV: 'production' },
});

// La app tiene un solo index.html (`web.output: single`): toda dirección cae
// ahí y la resuelve expo-router. Los archivos con huella en el nombre se
// guardan para siempre; index.html nunca, para que una versión nueva llegue
// al recargar.
writeFileSync(join(salida, 'vercel.json'), JSON.stringify({
  cleanUrls: false,
  rewrites: [{ source: '/((?!_expo/|assets/).*)', destination: '/index.html' }],
  headers: [
    { source: '/_expo/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
  ],
}, null, 2));

if (soloCompilar) {
  console.log(`\nCompilado en ${salida}. Para verlo: npx serve -s ${salida}`);
  process.exit(0);
}

execSync(`vercel deploy ${salida} --prod --yes`, {
  stdio: 'inherit', env: { ...process.env, VERCEL_PROJECT_ID: PROYECTO, VERCEL_ORG_ID: EQUIPO },
});
console.log('\nPublicado: https://app.farmasalud.lat');
