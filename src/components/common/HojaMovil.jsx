import React, { memo, useRef, useContext } from 'react';
import AsaHoja from './AsaHoja';
import { useArrastreHoja } from './arrastreHoja';
import { EstadoDialogoCtx } from './estadoDialogo';
import useMediaQuery from '../../hooks/useMediaQuery';
import { usePanelLateral } from '../../hooks/useLayoutCompacto';

/**
 * HojaMovil — el CUERPO canónico de un modal en el teléfono.
 *
 * `ModalShell` ya resuelve *cómo entra* (desde abajo, en táctil, desde
 * v2.265.0). Lo que faltaba es *cómo se ve por dentro*: cada modal seguía
 * rendeando el cuerpo que se escribió para un panel centrado de escritorio —
 * ícono grande centrado, título centrado, botones en fila— y eso en una hoja se
 * lee mal por tres razones concretas:
 *
 * · **El título centrado no tiene con qué alinearse.** Una hoja ocupa el ancho
 *   entero; el ojo entra por el borde izquierdo, que es donde arranca la lectura.
 *   La hoja de filtros y la de acciones ya ponen su título a la izquierda.
 * · **Los botones en fila se reparten el ancho**, así que en 390px quedan dos
 *   blancos de ~180px con el texto apretado. Apilados son dos objetivos de ancho
 *   completo, que es lo que el pulgar acierta sin mirar.
 * · **El ícono de 64px centrado** es la mitad del alto útil de una hoja corta.
 *   Al lado del título dice lo mismo ocupando una línea.
 *
 * ── El material sale de los TOKENS, no de clases sueltas ──────────────────
 * `data-surface="modal"` aplica fondo, borde, sombra, radio y `backdrop-filter`
 * desde `index.css`, así que la hoja responde a los cuatro temas sola. Es la
 * misma lección que ya está escrita en `GlassViewLayout` y en `BarraFlotante`:
 * con `bg-surface-*` a mano se obtiene un translúcido, no vidrio.
 *
 * ── Nace del control que la abrió ─────────────────────────────────────────
 * La hoja no "aparece": empieza siendo el rectángulo exacto del control que se
 * tocó y se abre hasta el panel. No hace falta pasarle nada — si nadie da un
 * `origen`, lo toma de `leerUltimoToque()`, así que la gota es canónica y no una
 * prop que alguien tenga que recordar.
 *
 * Se anima `clip-path` y NO `transform`: escalar la hoja escala también su
 * `backdrop-filter`, y a `scale(0.14)` los 24px de blur valen ~3 — el vidrio
 * llegaba al final en vez de estar desde el principio. Recortando, la hoja está
 * siempre a tamaño real y lo único que crece es la ventana por la que se la ve.
 *
 * `ModalShell` recibe `animacionPropia` para apagar la suya: si animara el
 * envoltorio, ese `transform` sí sería ANCESTRO y mataría el vidrio.
 *
 * ── `data-hoja`, para que `ModalShell` no la parchee ──────────────────────
 * `ModalShell` le corrige al hijo las esquinas de abajo y el área segura, porque
 * los 17 llamadores traen cuerpos pensados para un panel centrado. Esta hoja ya
 * hace las dos cosas bien, así que se marca y el parche la saltea.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *   <ModalShell open={abierto} onClose={cerrar} surface={null}>
 *       <HojaMovil titulo="¿Publicar 12 borradores?" icono={Upload} tono="brand"
 *           pie={<><Button …>Publicar</Button><Button variant="secondary" …/></>}>
 *           …contenido…
 *       </HojaMovil>
 *   </ModalShell>
 */

/**
 * DOS materiales, porque son dos superficies con dos trabajos distintos.
 *
 * Vivían en una sola constante —"la barra y lo que la barra despliega son la
 * misma capa"— y el argumento era bueno para el color, pero esconde que no
 * hacen lo mismo:
 *
 * · **El clúster FLOTA sobre la vista.** Es cromo: se lo mira de reojo y se lo
 *   toca. Que se vea la lista pasar por detrás es la gracia, y por eso está en
 *   `card` (16%) — fue una decisión explícita del usuario cuando reportó que "el
 *   liquidglass del filterpill no es liquidglass". No se toca.
 *
 * · **La hoja es donde se LEE y se decide.** Ahí lo de atrás no es ambiente: es
 *   ruido encima del texto que hay que leer. A 16% el usuario preguntó "¿qué son
 *   esos recuadros en los botones?" — no había ningún recuadro dibujado, eran
 *   los bordes de las celdas de la tabla de atrás atravesando la hoja.
 *
 * La medición que ya estaba escrita en `BarraFlotante` decía exactamente esto y
 * se leyó como si valiera para las dos: con `card`, *"SALUD 2 se lee ENTERO y
 * cae encima de ACCIONES. Es vidrio, pero ilegible"*; con `dropdown` (72%), *"lo
 * de atrás queda como un fantasma y los rótulos se leen limpios"*. Vidrio pero
 * ilegible es un buen trato para el clúster y uno malo para un formulario.
 *
 * Ninguno de los dos es un color nuevo: los dos son tokens que ya existían.
 */
export const MATERIAL_CLUSTER = 'card';
export const MATERIAL_HOJA = 'dropdown';

const TONO = {
    brand:   'text-brand-text bg-brand/12',
    danger:  'text-danger-text bg-danger/12',
    warning: 'text-warning-text bg-warning/12',
    success: 'text-success-text bg-success/12',
};

const HojaMovil = memo(({
    titulo,
    // Texto chico bajo el título. Va acá y no en el cuerpo para que el cuerpo
    // pueda scrollear sin llevarse el contexto de qué se está decidiendo.
    subtitulo,
    icono: Icono,
    tono = 'brand',
    children,
    // Las acciones. Se apilan de ancho completo en el orden en que llegan, así
    // que la principal va PRIMERA: es la que queda más arriba, más lejos del
    // borde y más cerca del pulgar en reposo.
    pie,
    // La superficie. El MISMO material para TODAS las hojas: el usuario reportó
    // que "Calcular" y "Parámetros" no se veían igual que la hoja de la barra, y
    // era literal — esas usaban `modal` (85%) y la de la barra `card` (16%). Un
    // canónico con dos materiales no es un canónico. Lo que sí es otra cosa es
    // el CLÚSTER (`MATERIAL_CLUSTER`): flota sobre la vista en vez de ser la
    // superficie sobre la que se lee.
    superficie = MATERIAL_HOJA,
    className = '',
}) => {
    const hojaRef = useRef(null);
    const { alCerrar } = useContext(EstadoDialogoCtx);
    const sinMovimiento = useMediaQuery('(prefers-reduced-motion: reduce)');
    const gesto = useArrastreHoja({ refPanel: hojaRef, alCerrar, activo: !sinMovimiento && !!alCerrar });
    // De costado con el teléfono acostado. Se lee del `data-eje` que puso
    // `ModalShell` en el envoltorio en vez de recibirlo por prop: los 18
    // llamadores no tienen por qué enterarse de la orientación, y una prop que
    // hay que reenviar es una prop que alguien va a olvidar.
    const lateral = usePanelLateral();

    return (
    <div
        ref={hojaRef}
        data-hoja="true"
        data-surface={superficie}
        // `rounded-b-none!` con el modificador de importancia, no a secas: el
        // radio lo fija `[data-surface="modal"]` en index.css, que es un selector
        // de atributo —misma especificidad que una clase— y le gana por orden de
        // hoja. Sin el `!` las cuatro esquinas quedaban en 32px y las de abajo
        // dibujaban una curva contra el filo de la pantalla.
        // La sombra de arriba NO va acá: `data-surface` fija el `box-shadow` y le
        // gana por orden de hoja, igual que hace con el radio. La pone
        // `ModalShell` en el envoltorio, que calza exacto con la hoja y no tiene
        // sombra propia con la que pelearse.
        // De costado toma el alto COMPLETO —es el motivo de la posición— y el
        // radio se muda al borde izquierdo, que pasa a ser el único a la vista.
        className={`flex flex-col overflow-hidden ${lateral
            ? 'h-full rounded-l-modal rounded-r-none!'
            : 'max-h-[88dvh] rounded-t-modal rounded-b-none!'} ${className}`}
    >
    {/* De costado el asa va a la IZQUIERDA y en vertical, así que la fila
        principal se vuelve un renglón horizontal con el asa a un lado y el
        contenido al otro. Es el mismo árbol: solo cambia la dirección. */}
    <div className={`flex min-h-0 ${lateral ? 'flex-row h-full' : 'flex-col'}`}>
        <AsaHoja className={lateral ? 'my-3 ml-1' : 'mt-3 mb-1'} vertical={lateral} {...gesto} />
        {/* El área segura va acá, sobre el CONTENIDO, y no en el envoltorio: así
            el material sigue llegando al filo de la pantalla y lo único que se
            corre es lo que hay que poder leer y tocar. Acostado, el notch se
            come ~59px del costado derecho. */}
        <div className={`flex flex-col min-h-0 ${lateral
            ? 'flex-1 pr-[var(--sa-right)]' : ''}`}>

        {(titulo || Icono) && (
            <div className="flex items-start gap-3 px-4 pt-3 pb-3 shrink-0">
                {Icono && (
                    <div className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${TONO[tono] || TONO.brand}`}>
                        <Icono size={18} strokeWidth={2.5} />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    {titulo && (
                        <h2 className="text-body-lg font-black text-content leading-tight text-balance">
                            {titulo}
                        </h2>
                    )}
                    {subtitulo && (
                        <p className="text-caption text-content-3 font-medium mt-0.5">{subtitulo}</p>
                    )}
                </div>
            </div>
        )}

        {/* El cuerpo es lo ÚNICO que scrollea: el título se queda arriba y las
            acciones abajo, así que en una hoja larga nunca hay que scrollear
            para volver a ver qué se estaba decidiendo ni para confirmarlo. */}
        {children != null && (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 text-body text-content-2 leading-relaxed">
                {children}
            </div>
        )}

        {/* ── El pie: fila cuando entran, apilados cuando no ───────────────
            Apilar cuesta ~52px de alto, y con el teclado abierto en un teléfono
            de 844px eso es el 11% del área útil — justo en las hojas que abren
            teclado, que son las que más lo necesitan. Pero en fila, tres
            acciones o un rótulo largo se aprietan.

            Así que no se elige: `flex-wrap` con un mínimo de 9rem deja que el
            layout resuelva cada caso. Dos rótulos cortos entran en fila; una
            tercera acción o un rótulo largo empujan el salto solos. Una prop
            para decidirlo sería una prop que alguien olvida.

            `flex-row-reverse`: en escritorio la principal va a la DERECHA, o sea
            que es la última del DOM. Invertida, en fila queda a la derecha
            igual, y al envolver cae ARRIBA — que es donde llega el pulgar. */}
        {pie && (
            <div className="shrink-0 flex flex-row-reverse flex-wrap gap-2 px-4 pt-3 border-t border-divider
                pb-[max(16px,var(--sa-bottom))] bg-surface-card-hover
                [&>*]:flex-1 [&>*]:basis-36 [&>*]:min-w-0">
                {pie}
            </div>
        )}
        </div>
    </div>
    </div>
    );
});

HojaMovil.displayName = 'HojaMovil';
export default HojaMovil;
