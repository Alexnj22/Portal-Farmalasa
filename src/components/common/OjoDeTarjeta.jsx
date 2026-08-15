import React from 'react';
import { Eye } from 'lucide-react';

/**
 * OjoDeTarjeta — la señal de que una tarjeta se abre.
 *
 * Una tarjeta no se parece a un botón: es una superficie con texto adentro, y
 * en el teléfono no hay puntero que cambie de forma ni `hover` que la ilumine.
 * Sin una marca visible, la única manera de saber si abre algo es tocarla —o
 * sea, probar—. El ojo es esa marca, y va SIEMPRE en el mismo sitio (arriba a
 * la derecha) para que se reconozca sin leerla.
 *
 * Estaba escrito a mano en una sola pantalla —la tarjeta de Solicitudes— con su
 * tamaño y su color puestos ahí. Se hizo canónico el 2026-08-15, a pedido del
 * usuario, después de barrer el portal: **de los 44 candidatos, sólo 4 tarjetas
 * abrían un detalle y ninguna lo decía.**
 *
 * ── Cuándo va, y cuándo NO ───────────────────────────────────────────────
 * El ojo dice «acá hay más para VER», y eso es lo único que promete:
 *
 *   · SÍ  — la tarjeta abre el detalle de lo que muestra (una solicitud, un
 *           corte, una sesión, la ficha de una persona).
 *   · NO  — la tarjeta ELIGE (un cargo en un formulario, un vendedor, una
 *           presentación): ahí el acuse es la marca de selección.
 *   · NO  — la tarjeta FILTRA la vista (las baldosas de métrica): tocarlas no
 *           abre nada, recorta la lista de abajo.
 *   · NO  — la tarjeta PLIEGA algo (una ruta, un grupo): eso lo dice el
 *           chevron, que además apunta a dónde va.
 *   · NO  — la tarjeta ya tiene su propio botón de ver, o un chevron de
 *           «entrar»: dos afordancias para la misma acción se leen como dos
 *           acciones.
 *
 * Por eso no lo vigila el gate de diseño: la diferencia entre «abre» y «elige»
 * está en el handler, no en las clases, y un detector que sólo mira la forma de
 * la tarjeta clasificaría mal por construcción — el mismo motivo por el que
 * `clickable()` tampoco se puede deducir de un barrido. Ver DESIGN.md §5.3.
 *
 * ── Detalles ──────────────────────────────────────────────────────────────
 * `aria-hidden`: la tarjeta ya es un control con su nombre accesible; anunciar
 * además «ojo» sería una parada de foco que no lleva a ninguna parte. Es la
 * misma decisión que en `AsaHoja`.
 *
 * El realce al pasar el puntero necesita que la tarjeta lleve `group` — sin
 * eso, `group-hover:` simplemente no dispara y el ojo se queda en su gris, que
 * es un degradado correcto y no un error.
 */
export default function OjoDeTarjeta({ size = 14, className = '' }) {
    return (
        <Eye
            size={size}
            strokeWidth={2.5}
            aria-hidden="true"
            className={`shrink-0 text-content-3 group-hover:text-brand-text
                transition-colors duration-[var(--dur-base)] ${className}`}
        />
    );
}
