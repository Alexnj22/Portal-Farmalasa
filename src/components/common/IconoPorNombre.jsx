// Dibuja el ícono de un catálogo a partir de su NOMBRE.
//
// Los catálogos del núcleo (tipos de evento, módulos, categorías de
// documento…) guardan el nombre del ícono —`icono: 'Palmtree'`— y no el
// componente de `lucide-react`: una app nativa no puede reutilizar un catálogo
// que trae adentro un componente de la web. La pantalla que lo dibuja declara
// SUS íconos en un mapa (`{ Palmtree, HeartPulse }`) y los pinta con esto.
// Un mapa por pantalla y no uno global: cada una sigue cargando sólo los suyos,
// igual que cuando el catálogo los importaba. Plan en
// `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`.
//
// Es un componente y no una función que devuelve uno: elegir el componente
// durante el render de otro lo marca el compilador de React como «crear un
// componente en el render» (lo mismo que resolvió `IconoDelKiosco`).
export default function IconoPorNombre({ iconos, nombre, respaldo = null, ...props }) {
    const Icono = (nombre && iconos[nombre]) || respaldo;
    return Icono ? <Icono {...props} /> : null;
}
