// ¿Sirve esta foto para el catálogo? (2026-10-30)
//
// Las fotos de producto salen en la app de clientes en tarjetas y en la ficha
// a pantalla completa; se guardan a 800 px. Una imagen bajada de internet suele
// ser una miniatura de 150–300 px: estirada a la ficha se ve borrosa, y no hay
// forma de notarlo en el editor porque el recorte la muestra chica.
//
// Este archivo sólo DECIDE con números ya medidos (la medición vive en
// `plataforma/fotoDeProducto.js`, que necesita un lienzo). Así se prueba sin
// navegador y la app puede usar la misma regla.

/** Por debajo no se guarda: en la app se vería pixelada. */
export const LADO_MINIMO = 250;
/** Por debajo se avisa: sirve en la lista, pero en la ficha se nota. */
export const LADO_RECOMENDADO = 500;
/** Varianza del laplaciano (escala de grises, lado 256) bajo la cual la foto está desenfocada. */
export const NITIDEZ_MINIMA = 40;
/** Desviación de brillo bajo la cual la imagen es un color plano (vacía, negra, captura fallida). */
export const CONTRASTE_MINIMO = 6;

/**
 * `{ ancho, alto, nitidez, contraste }` → lista de problemas, del más grave al
 * menos. `bloquea: true` = no se deja guardar.
 */
export function revisarCalidad({ ancho, alto, nitidez = null, contraste = null }) {
    const problemas = [];
    const lado = Math.min(ancho || 0, alto || 0);
    if (contraste != null && contraste < CONTRASTE_MINIMO) {
        problemas.push({ clave: 'vacia', bloquea: true, texto: 'La imagen es de un solo color: parece vacía o mal copiada.' });
    }
    if (lado < LADO_MINIMO) {
        problemas.push({ clave: 'pequena', bloquea: true, texto: `Muy pequeña (${ancho}×${alto} px): en la app se vería pixelada. Busca una de al menos ${LADO_RECOMENDADO} px.` });
    } else if (lado < LADO_RECOMENDADO) {
        problemas.push({ clave: 'justa', bloquea: false, texto: `Algo pequeña (${ancho}×${alto} px): sirve, pero en la ficha de la app se notará. Si hay una más grande, mejor.` });
    }
    if (nitidez != null && nitidez < NITIDEZ_MINIMA && !problemas.some((p) => p.clave === 'vacia')) {
        problemas.push({ clave: 'borrosa', bloquea: false, texto: 'Se ve borrosa o desenfocada. Si es foto propia, tómala de nuevo con buena luz.' });
    }
    return problemas;
}
