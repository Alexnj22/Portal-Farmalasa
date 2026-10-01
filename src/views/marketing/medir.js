// Las medidas de un archivo elegido, antes de subirlo: el ancho y alto dicen
// si sirve como estado de WhatsApp (vertical) y quedan guardados con él. Vive
// en la pantalla y no en el núcleo porque necesita al navegador (`Image`,
// `video`, `URL.createObjectURL`).

export async function medirArchivo(archivo) {
    const base = { tamano: archivo?.size ?? null, ancho: null, alto: null };
    if (!archivo) return base;
    const tipo = String(archivo.type || '');
    if (!tipo.startsWith('image/') && !tipo.startsWith('video/')) return base;
    const url = URL.createObjectURL(archivo);
    try {
        const { ancho, alto } = await new Promise((resolve) => {
            const listo = (w, h) => resolve({ ancho: w || null, alto: h || null });
            if (tipo.startsWith('image/')) {
                const img = new Image();
                img.onload = () => listo(img.naturalWidth, img.naturalHeight);
                img.onerror = () => listo(null, null);
                img.src = url;
            } else {
                const v = document.createElement('video');
                v.preload = 'metadata';
                v.onloadedmetadata = () => listo(v.videoWidth, v.videoHeight);
                v.onerror = () => listo(null, null);
                v.src = url;
            }
            // Un formato que el navegador no sabe abrir (HEIC en Chrome) no
            // dispara ni carga ni error: no se queda esperando.
            setTimeout(() => listo(null, null), 4000);
        });
        return { ...base, ancho, alto };
    } catch {
        // Sin medidas se sube igual: sólo se pierde el aviso de «no es vertical».
        return base;
    } finally {
        URL.revokeObjectURL(url);
    }
}
