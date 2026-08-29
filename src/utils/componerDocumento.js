/**
 * De la foto al archivo: enderezar, ajustar al papel y darle el acabado.
 *
 * ── Por qué es un archivo aparte ────────────────────────────────────────────
 *
 * Porque desde el 2026-08-29 hay DOS caminos que tienen que producir exactamente
 * el mismo resultado:
 *
 *  · el automático, que corre al elegir el archivo y no le pregunta nada a
 *    nadie (`data/prepararDocumento.js`);
 *  · el manual, que es el editor, cuando alguien quiere corregir el encuadre o
 *    cambiar el acabado.
 *
 * Si cada uno tuviera su propia tubería, el documento que el portal prepara solo
 * y el que sale de tocar «Ajustar» y confirmar sin cambiar nada saldrían
 * distintos — y nadie lo notaría hasta comparar dos archivos del mismo papel.
 * Es la lección de las dos copias del carné, aplicada a los píxeles.
 */
import { medidaAjustada } from './formatosDePapel';
import { medidaDelPapel, rectificar } from './perspectiva';
import { escalaDeSalida } from './fotoDocumento';
import { aplicarAcabado } from './tratamientoDeFoto';

const CALIDAD = 0.92;

/** Escala un lienzo. Nunca agranda: estirar una foto chica no agrega nada. */
export function aEscala(fuente, escala) {
    const salida = document.createElement('canvas');
    salida.width = Math.max(1, Math.round(fuente.width * escala));
    salida.height = Math.max(1, Math.round(fuente.height * escala));
    const ctx = salida.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    // Blanco y no transparente: lo que asome por una esquina al enderezar es el
    // color del papel, así que no se lee como un recorte fallido.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, salida.width, salida.height);
    ctx.drawImage(fuente, 0, 0, salida.width, salida.height);
    return { canvas: salida, ctx };
}

/**
 * Endereza el papel marcado por sus cuatro esquinas y lo deja con la forma del
 * papel REAL cuando se reconoce (carta, oficio o cédula).
 *
 * Ese ajuste es la mitad silenciosa del trabajo: marcar cuatro esquinas siempre
 * queda con un par de milímetros de error, así que sin él la hoja sale «casi
 * carta» —levemente trapezoidal en la proporción— y eso se nota al imprimirla o
 * al ponerla al lado de otra.
 *
 * @param {HTMLImageElement} imagen
 * @param {{x:number,y:number}[]} esquinas  en fracciones, orden ↖ ↗ ↘ ↙
 * @returns {{canvas: HTMLCanvasElement, formato: object|null}|null}
 */
export function rectificarPapel(imagen, esquinas) {
    if (!imagen || !Array.isArray(esquinas) || esquinas.length !== 4) return null;
    const enPx = esquinas.map(p => ({
        x: p.x * imagen.naturalWidth, y: p.y * imagen.naturalHeight,
    }));
    // El lado medido de cada par es el más LARGO: el que está más lejos de la
    // cámara sale más corto, y recortar contra él perdería documento.
    const crudo = medidaDelPapel(enPx);
    if (!crudo) return null;

    const { ancho, alto, formato } = medidaAjustada(crudo.ancho, crudo.alto);
    // `yaOrdenadas`: el orden ES la orientación elegida (el botón de girar rota
    // el orden), y reordenarlo acá la desharía en silencio.
    const canvas = rectificar(imagen, enPx, ancho, alto, { yaOrdenadas: true });
    return canvas ? { canvas, formato } : null;
}

/**
 * El lienzo enderezado, ya como archivo: a su tamaño de salida y con el acabado.
 *
 * @param {HTMLCanvasElement} lienzo
 * @param {{doc: object, acabado: string, nombre?: string}} opciones
 */
export async function aArchivo(lienzo, { doc, acabado, nombre }) {
    const escala = escalaDeSalida(lienzo.width, lienzo.height, doc);
    const { canvas, ctx } = aEscala(lienzo, escala);
    aplicarAcabado(ctx, canvas.width, canvas.height, acabado);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', CALIDAD));
    const base = String(nombre || doc?.archivo || 'documento').replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}
