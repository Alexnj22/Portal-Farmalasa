import { supabase } from '../supabaseClient';

// La foto que acompaña a un movimiento de inventario: subirla y devolver su URL.
//
// Existía DOS veces con el mismo cuerpo —`data/devoluciones.js` y el descargue
// por daño de `WidgetInventoryMovement`— y el envío por «Avería» iba a ser la
// tercera. Es la misma señal que dejó `FotosDeEvidencia`, que nació de dos
// copias del mismo marcado con el mismo bug adentro: cuando una pieza se copia,
// lo que faltaba era nombrarla.
//
// Acá vive sólo la subida. La tira de miniaturas es `FotosDeEvidencia`, y
// mostrarlas después exige firmar la URL: el bucket es privado.

/** El bucket de la evidencia de inventario. Privado: se firma para mostrarla. */
export const BUCKET_EVIDENCIA = 'inventario-evidencia';

/** Cuántas fotos admite un formulario. Tres alcanzan para mostrar un daño. */
export const MAX_FOTOS = 3;

/**
 * Sube las fotos y devuelve sus URLs, en orden. Lanza si alguna falla.
 *
 * **La evidencia va PRIMERO**, antes de crear la fila que la necesita: una
 * solicitud por daño sin la foto es exactamente la que nadie puede decidir, y
 * dejarla entrar «para no perder lo escrito» la convierte en algo que alguien
 * va a tener que rechazar a mano.
 *
 * Se guarda la URL en formato público como identificador —regla 10 de
 * CLAUDE.md— aunque el bucket sea privado: la firma expira, así que lo que se
 * persiste no puede ser una URL firmada.
 *
 * `carpeta` separa por circuito para que se pueda mirar qué subió cada uno; el
 * bucket es el mismo porque las policies y los tipos permitidos son los mismos.
 */
export async function subirEvidencia(fotos, { carpeta = 'inventario', salaId, userId } = {}) {
    const urls = [];
    const base = `${carpeta}/${salaId ?? 'sin-sala'}/${userId ?? 'anon'}`;
    for (const [i, f] of [...(fotos ?? [])].entries()) {
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${base}/${Date.now()}-${i}.${ext}`;
        const { error } = await supabase.storage
            .from(BUCKET_EVIDENCIA).upload(path, f, { contentType: f.type });
        if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
        const { data } = supabase.storage.from(BUCKET_EVIDENCIA).getPublicUrl(path);
        if (data?.publicUrl) urls.push(data.publicUrl);
    }
    return urls;
}
