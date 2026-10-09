// Los colores institucionales del PAPEL (carné, documento de bienvenida,
// constancia de sanción). Salen del logo de la empresa (`public/Logo192.png`),
// muestreados píxel por píxel: la cruz es `#981D97` y el arco `#8EC30F`. No son
// tokens del tema porque un papel impreso no tiene tema. Vivían en el
// adaptador web del documento de bienvenida; se mudaron al núcleo para que la
// constancia se pueda armar también en el teléfono.
export const MARCA = {
    magenta: '#981D97',
    verde:   '#8EC30F',
    tinta:   '#231F20',
    gris:    '#6B7280',
    tenue:   '#F3E9F3',
};
