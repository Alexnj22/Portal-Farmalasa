#!/usr/bin/env node
// Borra los archivos huérfanos del álbum: los que se subieron con un permiso
// pero nunca llegaron a ser foto ni mensaje de voz (el invitado cerró la página,
// se cortó la señal…), con más de 1 hora. Después limpia permisos y frenos
// vencidos.
//
// Por qué un script y no SQL: borrar una fila de storage.objects deja el
// archivo guardado (y ocupando la cuota); en proyectos nuevos Supabase ni
// siquiera lo deja hacer. Lo correcto es la API de almacenamiento, que borra
// los dos. Eso exige la service key, que NUNCA va en el sitio.
//
// Uso (desde boda/):
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/limpiar-huerfanos.mjs
//   … --ver      sólo lista, no borra
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
const soloVer = process.argv.includes('--ver');
if (!url || !clave) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (Project Settings → API → service_role).');
  process.exit(1);
}
const sb = createClient(url, clave, { auth: { persistSession: false } });

let total = 0;
const vistos = new Set();
for (;;) {
  const { data, error } = await sb.rpc('huerfanos_album', { p_limite: 500 });
  if (error) { console.error('No se pudo leer la lista de huérfanos:', error.message); process.exit(1); }
  const nombres = data.map((x) => (typeof x === 'string' ? x : x.huerfanos_album)).filter((n) => !vistos.has(n));
  if (!nombres.length) break;
  nombres.forEach((n) => vistos.add(n));
  if (soloVer) { nombres.forEach((n) => console.log(n)); total += nombres.length; break; }
  for (let i = 0; i < nombres.length; i += 100) {
    const tanda = nombres.slice(i, i + 100);
    const { error: e } = await sb.storage.from('album').remove(tanda);
    if (e) { console.error('Falló el borrado de una tanda:', e.message); process.exit(1); }
    total += tanda.length;
  }
}
console.log(soloVer ? `${total} huérfanos (primeros 500 como mucho).` : `${total} archivos huérfanos borrados.`);

if (!soloVer) {
  const { data, error } = await sb.rpc('limpiar_vencidos');
  if (error) { console.error('limpiar_vencidos falló:', error.message); process.exit(1); }
  console.log('Permisos y frenos vencidos borrados:', JSON.stringify(data));
}
