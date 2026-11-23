// La dirección de la copia chica de una foto del catálogo (2026-11-23).
//
// Las miniaturas del portal (40-48 px) bajaban la foto ORIGINAL: 76-97 kB por
// foto, cuatro veces por pantalla en Productos, Mín·Máx y el buscador. La copia
// chica ya existe: se escribe al subir la foto, al lado, en
// `product-photos/chicas/<ruta>` a 400 px de lado mayor
// (src/plataforma/fotoConMiniatura.js, la función recortar-foto-producto, la
// app del personal y, para las viejas, scripts/miniaturas-catalogo.py).
// Es la misma convención que usa la app de clientes
// (apps/clientes/componentes/FotoProducto.js).
//
// NO se usa el servidor de imágenes del almacenamiento (`/render/image/…`):
// cobra por cada foto distinta que achica en el mes y la app ya pasó el cupo.
//
// En la base se sigue guardando la dirección de la foto original; esto sólo
// la traduce al pintar. Cualquier dirección que no sea del catálogo va tal
// cual, y si la copia no existe la pantalla cae a la original
// (`FotoMiniatura`).
const CATALOGO = '/storage/v1/object/public/product-photos/';

/** La dirección chica de una foto del catálogo, o `null` si no aplica. */
export function urlFotoChica(url) {
    if (typeof url !== 'string' || !url.includes(CATALOGO) || url.includes(`${CATALOGO}chicas/`)) return null;
    return url.replace(CATALOGO, `${CATALOGO}chicas/`);
}
