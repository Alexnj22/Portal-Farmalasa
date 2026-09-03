import React, { memo } from 'react';
import { Info, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

/**
 * Notice — aviso inline dentro de una vista o un formulario.
 *
 * Canónico creado en D3.5 (2026-07-27). Al auditar los "badges" escritos a mano
 * aparecieron **316 chips**, y al separarlos por forma resultaron ser tres cosas
 * distintas:
 *
 *   249  chip inline corto        → eso sí es `Badge`
 *    58  **aviso con ícono**      → no tenía canónico: esto
 *     9  contador flotante        → viven pegados a su ícono, quedan aparte
 *
 * El aviso es el que no existía. Lo que había: `AlertModal` (que interrumpe),
 * `OfflineBanner`/`SyncHealthBanner` (que van a nivel de página). Faltaba lo del
 * medio: decir algo *acá*, junto al campo o la lista de la que se habla, sin
 * tapar la pantalla.
 *
 * Medido sobre los 58: 22 eran de aviso (`warning`), y el radio se repartía en
 * `rounded-xl` 44 · `lg` 8 · `full` 6. Otra vez tres radios para una sola idea:
 * acá va uno solo, del token.
 */

// El texto va SIEMPRE con el token `-text` de su color, no con el color puro.
// Bug real, reportado el 2026-07-29 sobre un aviso de este componente que no se
// podía leer: `warning` y `success` usaban el color de acento crudo mientras
// `info` y `danger` sí usaban su `-text`. Medido sobre el fondo efectivo del
// propio aviso (bg-warning/10 sobre tarjeta clara = #fef4e6):
//
//   text-warning      #F79009 → 2.16:1   ✗ (WCAG AA pide 4.5:1)
//   text-warning-text #9a4507 → 5.98:1   ✓
//
// Los dos tokens `-text` ya existen y tienen override por tema (index.css), así
// que esto arregla los 22 avisos de tipo warning de la app de una sola vez, y no
// solo el que se reportó.
const VARIANTES = {
    info:    { caja: 'bg-brand/10 border-brand/25 text-brand-text',       icono: Info },
    success: { caja: 'bg-success/10 border-success/30 text-success-text', icono: CheckCircle2 },
    warning: { caja: 'bg-warning/10 border-warning/30 text-warning-text', icono: AlertTriangle },
    danger:  { caja: 'bg-danger/10 border-danger/30 text-danger-text',    icono: XCircle },
    neutral: { caja: 'bg-surface-card-hover border-border-card text-content-2', icono: Info },
};

// Categóricos — un color por CATEGORÍA, sin significado de severidad. Es la
// misma extensión que `Badge` ya tenía y por el mismo motivo: hay avisos cuyo
// color no dice «qué tan grave» sino «de qué circuito es». En Pedidos, chart-3
// es el color del tránsito y del Sistema de Ventas, y lo comparten la tarjeta
// de ruta, la barra de progreso y estos avisos; mapearlos a `info` los habría
// desconectado de la ruta a la que pertenecen.
//
// ESCRITOS LITERALES A PROPÓSITO, no generados en un bucle — misma trampa que
// documenta `Badge`: Tailwind escanea strings literales del fuente, así que con
// `bg-chart-${n}/10` no emite ninguna clase y el aviso saldría SIN FONDO y en
// silencio.
Object.assign(VARIANTES, {
    'chart-3': { caja: 'bg-chart-3/10 border-chart-3/30 text-chart-3-text', icono: Info },
});

/**
 * `bloque` — el aviso que ocupa varios renglones.
 *
 * El radio del aviso sale de `--btn-radius`, y en el tema Liquid ese token vale
 * **9999px**. En un aviso de un renglón eso es exactamente lo que se quiere: se
 * ve como los botones y las píldoras que tiene al lado. En uno de siete —un
 * título, una explicación y una lista de días— el mismo token dibuja un óvalo
 * gigante con las esquinas comiéndose el texto. Reportado el 2026-08-26 sobre el
 * aviso del invariante de Bolsas: «se ve fatal».
 *
 * Con `bloque`, el radio pasa a ser el de una tarjeta y el relleno crece — que
 * es lo que un párrafo con lista adentro necesita.
 *
 * ── Pero `bloque` NO puede ser la única defensa ─────────────────────────────
 * Se reportó otra vez el 2026-09-03, sobre el aviso de «Mis puntos», con la
 * regla dicha en general: **un mensaje largo dentro de una píldora redondeada
 * está prohibido.** Y lo estaba desde agosto — lo que faltaba no era la
 * decisión, era que no dependiera de acordarse. Una prop opt-in es una prop
 * olvidada, y ésta se olvidó en el primer aviso escrito después de crearla.
 *
 * Acá decía «no se puede deducir: desde adentro, `children` es una caja
 * cerrada». Es cierto para un `children` de JSX, y **falso para el caso que
 * causa el defecto**: los avisos que se ven mal son los de un texto largo, y un
 * texto es medible en tiempo de render. Misma corrección que `data-destino` en
 * `DataTable` — decidir donde sí se sabe la respuesta.
 *
 * Así que el RADIO se decide solo cuando el contenido es texto: pasado el
 * corte, ya no es una píldora. El relleno lo sigue declarando `bloque`, que es
 * la decisión de composición —un párrafo con lista adentro respira distinto— y
 * ésa sí no se puede medir desde acá.
 */

/**
 * A partir de cuántos caracteres un aviso deja de ser una píldora.
 *
 * En un teléfono el aviso mide ~280 px útiles y el texto va en `text-label`:
 * entran unos 40 caracteres por renglón. Con 56 el segundo renglón ya empezó, y
 * dos renglones dentro de un óvalo de radio 9999px es exactamente lo que se
 * reportó dos veces.
 */
const LARGO_QUE_YA_NO_ES_PILDORA = 56;

/**
 * El texto plano de un `children`, o `null` si no se puede saber.
 *
 * `null` significa «no lo puedo medir» y NO «es corto»: ante un `children` de
 * JSX se respeta lo que declaró quien lo escribió. Confundir las dos cosas
 * volvería a dejar sin defensa justo a los avisos más compuestos.
 */
function textoDe(children) {
    if (typeof children === 'string' || typeof children === 'number') return String(children);
    if (Array.isArray(children)) {
        const partes = children.map(textoDe);
        return partes.some(p => p === null) ? null : partes.join('');
    }
    return children == null || children === false ? '' : null;
}
const Notice = memo(({
    variant = 'info',
    icon: IconoPropio,
    children,
    action,
    compact = false,
    bloque = false,
    className = '',
    ...rest
}) => {
    const v = VARIANTES[variant] || VARIANTES.info;
    const Icono = IconoPropio ?? v.icono;

    // Sólo cuando el contenido es texto medible. Con JSX adentro manda `bloque`.
    const texto = textoDe(children);
    const largo = texto !== null && texto.trim().length > LARGO_QUE_YA_NO_ES_PILDORA;
    const comoTarjeta = bloque || largo;

    return (
        // `role="status"` y no `alert`: un aviso inline informa, no interrumpe.
        // `alert` obliga al lector de pantalla a cortar lo que esté leyendo, y
        // eso es para errores de verdad, no para una nota al pie de un campo.
        <div role="status"
            data-aviso={comoTarjeta ? 'bloque' : 'pildora'}
            className={`flex items-start gap-2 border font-bold
                ${comoTarjeta ? 'rounded-card' : 'rounded-btn'}
                ${compact ? 'px-2.5 py-1.5 text-micro'
                          : bloque ? 'px-4 py-3 text-label' : 'px-3 py-2 text-label'}
                ${v.caja} ${className}`}
            {...rest}>
            {Icono && <Icono size={compact ? 12 : 14} strokeWidth={2.5}
                className={`shrink-0 ${comoTarjeta ? 'mt-0.5' : 'mt-px'}`} />}
            <span className="min-w-0 flex-1 leading-snug">{children}</span>
            {action && <span className="shrink-0 -my-0.5">{action}</span>}
        </div>
    );
});

export default Notice;
