// Archivos en espera — el gemelo de la APP. Ver `src/plataforma/archivosEnEspera.js`.
//
// La app todavía no guarda fotos para subirlas después: `guardar` lo dice en
// voz alta y quien llama vuelve al camino de siempre (avisar y no anotar).
// `listar` devuelve la lista vacía porque ES la verdad: si nada se puede
// guardar, nada está esperando.
import { pendiente } from './_pendiente';

export async function guardar() { throw pendiente('guardar una foto para subirla después'); }
export async function listar() { return []; }
export async function quitar() {}
