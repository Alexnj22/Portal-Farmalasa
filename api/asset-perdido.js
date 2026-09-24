// Un archivo de /assets/ que NO existe (2026-09-24).
//
// `vercel.json` le pone a todo /assets/ «guardalo un año, no cambia nunca»
// (`immutable`), que es correcto para un archivo con hash: su contenido no
// cambia jamás. Pero la regla se aplicaba también a la respuesta 404 de un
// archivo que no existe, y el 404 se guardaba un año igual.
//
// Pasó con v2.1047.1: el portal cargó 5 s después de que el deploy quedara
// vivo, un pedazo (`shield-alert-*.js`) todavía no estaba en el servidor y
// respondió 404 — y ese 404 quedó guardado en el navegador como permanente.
// Cada recarga fallaba aunque el archivo ya existiera. Se tuvo que volver a
// la versión anterior.
//
// Un archivo que existe lo sirve Vercel directo y nunca llega acá (las
// reescrituras sólo aplican cuando no hay archivo). A esta función sólo llegan
// los que faltan, y los contesta 404 SIN guardar: el próximo intento vuelve a
// preguntar.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.status(404).send('No encontrado');
}
