// Las marcas sobre un diseño de marketing (`marketing_comentarios.marca`): un
// punto, un recuadro o un trazo a lápiz, con coordenadas RELATIVAS (0–1) a la
// imagen. Así una marca hecha en el teléfono cae en el mismo sitio en el
// monitor y al revés, a cualquier tamaño. Las reglas viven acá UNA vez: las
// usan el anotador del portal (`views/marketing/AnotadorModal`) y el de la app.
//
// Forma de la marca (la que guarda la base, sin cambios):
//   { tipo: 'punto', x, y }
//   { tipo: 'recuadro', x, y, w, h }      (x,y = esquina superior izquierda)
//   { tipo: 'trazo', puntos: [[x, y], …] }

export const acotar = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/** Un toque en píxeles dentro de una caja de `ancho × alto` → coordenadas 0–1. */
export const aRelativo = (px, py, ancho, alto) => [acotar(px / (ancho || 1)), acotar(py / (alto || 1))];

/** Coordenadas 0–1 → píxeles dentro de una caja de `ancho × alto`. */
export const aPixeles = (x, y, ancho, alto) => [x * ancho, y * alto];

/** Comenzar una marca con la herramienta elegida en el punto (x, y) relativo. */
export function empezarMarca(herramienta, x, y) {
    if (herramienta === 'recuadro') return { tipo: 'recuadro', x, y, w: 0, h: 0 };
    if (herramienta === 'trazo') return { tipo: 'trazo', puntos: [[x, y]] };
    return { tipo: 'punto', x, y };
}

/** Seguir el arrastre: el recuadro se rehace desde el origen; el trazo suma el punto. */
export function moverMarca(marca, origen, x, y) {
    if (marca?.tipo === 'recuadro') {
        return { tipo: 'recuadro', x: Math.min(origen[0], x), y: Math.min(origen[1], y), w: Math.abs(x - origen[0]), h: Math.abs(y - origen[1]) };
    }
    if (marca?.tipo === 'trazo') return { ...marca, puntos: [...marca.puntos, [x, y]] };
    return marca;
}

/**
 * Al soltar: un recuadro sin área o un trazo de menos de tres puntos fue un
 * toque sin querer (null). El trazo se aligera —uno de cada tres puntos, más el
 * último— y se redondea a milésimas: alcanza para el dibujo y pesa menos.
 */
export function terminarMarca(marca) {
    if (marca?.tipo === 'recuadro' && (marca.w < 0.01 || marca.h < 0.01)) return null;
    if (marca?.tipo === 'trazo') {
        if (marca.puntos.length < 3) return null;
        return { ...marca, puntos: marca.puntos.filter((_, i) => i % 3 === 0 || i === marca.puntos.length - 1)
            .map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]) };
    }
    return marca ?? null;
}

/** Los comentarios de ESTE diseño que llevan marca, numerados en orden. */
export const marcadosDelArchivo = (comentarios, archivoId) => (comentarios || [])
    .filter((c) => c.archivo_id === archivoId && c.marca)
    .map((c, i) => ({ ...c, numero: i + 1 }));

/** Dónde va el número de una marca (su primer punto), relativo 0–1. */
export function anclaDeMarca(m) {
    if (m?.tipo === 'trazo') return m.puntos?.[0] ?? [0, 0];
    return [m?.x ?? 0, m?.y ?? 0];
}

/**
 * El `d` de un trazo en una caja de `ancho × alto` (el SVG del portal usa una
 * caja de 100 × 100·proporción; el de la app, los píxeles de la imagen).
 */
export const caminoDeTrazo = (puntos, ancho, alto) => (puntos || [])
    .map(([x, y], k) => `${k ? 'L' : 'M'}${x * ancho},${y * alto}`).join(' ');
