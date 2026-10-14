/**
 * Leer un QR de una FOTO tomada con la cámara del sistema.
 *
 * Es el camino que funciona en cualquier navegador: el de la cámara o de Google
 * Lens en Android (que no dan cámara en vivo), una vista web incrustada sin
 * permiso de cámara, o un teléfono sin `getUserMedia`. Una foto con
 * `<input capture>` sí se puede en todos lados.
 *
 * ── Por qué prueba varios tamaños ──────────────────────────────────────────
 *
 * Una foto de cámara de 12 megapíxeles con un QR chico en el medio es lo peor
 * para el decodificador: busca patrones de un tamaño que en la foto entera
 * quedan diminutos o, al revés, recorre millones de píxeles de fondo. Primero
 * se intenta tal cual y después reducida a 1600 y a 1000 px del lado mayor —
 * el mismo QR, a escalas donde el lector suele encontrarlo.
 *
 * @param {File} file
 * @returns {Promise<string|null>} el texto del código, o `null` si no se leyó
 */
export async function leerQrDeFoto(file) {
    if (!file) return null;
    const { leerQrDeImagen } = await import('@nucleo/utils/leerQrDeImagen');
    const url = URL.createObjectURL(file);
    try {
        const tal = await leerQrDeImagen(url);
        if (tal) return tal;
    } catch { /* la foto entera no abrió: se prueba reducida */ } finally {
        URL.revokeObjectURL(url);
    }
    const { reducirAJpeg } = await import('./imagenes');
    for (const ladoMaximo of [1600, 1000]) {
        try {
            const reducida = await reducirAJpeg(file, { ladoMaximo, calidad: 0.92, mensaje: 'No se pudo abrir la foto.' });
            const texto = await leerQrDeImagen(reducida);
            if (texto) return texto;
        } catch { /* un tamaño que no abre no impide probar el siguiente */ }
    }
    return null;
}

/** ¿Este navegador da la cámara EN VIVO? El de la app de cámara de Android, no. */
export const hayCamaraEnVivo = () =>
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
