// ─────────────────────────────────────────────────────────────────────────────
// Qué es el archivo que se está viendo
// ─────────────────────────────────────────────────────────────────────────────
//
// La primera versión se lo preguntaba al NOMBRE, y falló en el primer documento
// real: el nombre llegó vacío —la fila no lo tenía guardado— así que el visor lo
// dio por PDF.
//
// Y de esa sola causa salieron los DOS síntomas que reportó el usuario: la foto
// se veía ampliada en vez de entera (un marco muestra la imagen a tamaño
// natural, no ajustada) y el botón de recortar no aparecía, porque un PDF no se
// edita. Un solo dato mal deducido apagó media pantalla.
//
// El tipo autoritativo es el del CONTENIDO. El nombre y la URL quedan de
// respaldo para cuando el servidor no dice nada útil, que también pasa.

import { describe, it, expect } from 'vitest';
import { esImagen } from '../../src/components/common/VisorDeDocumento';

describe('esImagen', () => {
    it('EL CASO QUE FALLÓ: contenido de imagen y nombre vacío', () => {
        expect(esImagen('image/jpeg', '', undefined)).toBe(true);
        expect(esImagen('image/png', 'Documento', null)).toBe(true);
    });

    it('el contenido MANDA sobre el nombre', () => {
        // Un archivo llamado `.pdf` que en realidad es una foto se ve como foto.
        expect(esImagen('image/jpeg', 'escaneado.pdf', null)).toBe(true);
        // Y al revés: un PDF con nombre de foto no se ofrece para recortar.
        expect(esImagen('application/pdf', 'dui.jpg', null)).toBe(false);
    });

    it('sin tipo útil, cae al nombre y después a la URL', () => {
        // `application/octet-stream` es lo que contesta un servidor que no sabe.
        expect(esImagen('application/octet-stream', 'dui.jpeg', null)).toBe(true);
        expect(esImagen('application/octet-stream', '', 'https://x/y/dui.PNG')).toBe(true);
        expect(esImagen(null, '', 'https://x/y/contrato.pdf')).toBe(false);
    });

    it('aguanta una URL con parámetros detrás de la extensión', () => {
        // Una URL firmada trae `?token=…` colgando.
        expect(esImagen(null, '', 'https://x/y/dui.jpg?token=abc&x=1')).toBe(true);
    });

    it('sin nada, no inventa que es una imagen', () => {
        // Se prefiere el marco: muestra cualquier cosa. Al revés, un `<img>` con
        // un PDF adentro es un icono roto.
        expect(esImagen(null, '', '')).toBe(false);
        expect(esImagen(undefined, undefined, undefined)).toBe(false);
    });
});
