import { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import LiquidSelect from './LiquidSelect';
import useLayoutCompacto from '../../hooks/useLayoutCompacto';

// eslint-disable-next-line react-refresh/only-export-components -- constante chica usada solo junto a este componente; solo afecta Fast Refresh en dev
export const PAGE_SIZE_OPTIONS = [25, 50, 100];

/**
 * TablePagination — paginación de tabla o lista.
 *
 * Reescrito el 2026-07-27 sobre el diseño P1 aprobado. Lo que tenía la versión
 * anterior, medido antes de tocarla:
 *
 *   1 · El orden estaba al revés. Lo primero que uno pregunta es "¿cuántos
 *       hay?" y eso vivía en el extremo derecho, lo último que se lee.
 *   2 · Eran TRES islas separadas por `justify-between`: en pantalla ancha
 *       quedaban tan lejos que leían como tres controles sin relación.
 *   3 · El tamaño de página y la página activa usaban el MISMO `bg-brand` con
 *       glow, así que competían por significar "activo".
 *   4 · 13 paradas de tabulación para pasar de página.
 *   5 · `framer-motion`, que DESIGN.md §11 marca como "no agregar más" — y su
 *       `layoutId="activePage"` hacía que la píldora azul VOLARA entre dos
 *       paginaciones si había dos en pantalla.
 *   6 · Sin semántica: ni `<nav>` ni `aria-current`. Un lector de pantalla oía
 *       siete botones sin nombre.
 *   7 · En móvil se partía en tres filas y empujaba la tabla fuera de pantalla.
 *
 * Ahora: una sola píldora, orden de lectura (tamaño → navegación → rango), 3
 * paradas de tabulación, `<nav>` con `aria-live`, y el hover sale de
 * `--lift-hover` — o sea que en Solid no se levanta.
 *
 * **El rango, no el total.** Dice `1–25 de 1,284`, que responde "¿dónde estoy?"
 * y "¿cuánto hay?" a la vez. El total solo no decía dónde estabas.
 *
 * **Sin números de página.** En 52 páginas nadie salta a la 37 mirando: el
 * salto real se hace escribiendo el número, y para eso el "pág. 1/52" es
 * clickeable y se vuelve un campo. Así el "Ir a" deja de ocupar espacio
 * permanente para una acción que casi no se usa.
 */

const NAV = `w-[max(36px,var(--tap-min))] h-[max(36px,var(--tap-min))] rounded-btn flex items-center justify-center shrink-0
    text-content-3 transition-[background-color,color,transform] duration-[var(--dur-fast)]
    hover:bg-surface-card-hover hover:text-brand-text hover:translate-y-[var(--lift-hover)]
    disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent
    disabled:hover:text-content-3 disabled:hover:translate-y-0`;

export default function TablePagination({
    pageSize,
    onPageSizeChange,
    page,
    totalPages,
    onPageChange,
    total,
    unit = 'total',
    filteredTotal,
}) {
    const rootRef = useRef();
    const inputRef = useRef();
    const [editando, setEditando] = useState(false);
    const [borrador, setBorrador] = useState('');
    const compacto = useLayoutCompacto();

    const mostrado = filteredTotal ?? total ?? 0;
    const desde = mostrado === 0 ? 0 : (page - 1) * pageSize + 1;
    const hasta = Math.min(page * pageSize, mostrado);

    // Tras cambiar de página, mantener la paginación a la vista. Si la tabla
    // era más larga que la ventana, al pasar de página el usuario quedaba
    // mirando el medio de la lista nueva sin referencia.
    const navegar = useCallback((fn) => {
        fn();
        requestAnimationFrame(() => {
            rootRef.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
        });
    }, []);

    useEffect(() => { if (editando) inputRef.current?.select(); }, [editando]);

    const confirmar = () => {
        const n = parseInt(borrador, 10);
        if (!isNaN(n) && n >= 1 && n <= totalPages && n !== page) navegar(() => onPageChange(n));
        setEditando(false);
        setBorrador('');
    };

    if (!totalPages || totalPages < 1) return null;

    // ── Móvil: una sola fila, ancho completo ──────────────────────────────
    // Las flechas van pegadas a los bordes, que es donde llega el pulgar, y
    // miden 40px de lado. El selector de tamaño de página no aparece: nadie
    // cambia cuántas filas ve desde un teléfono.
    if (compacto) {
        return (
            <nav ref={rootRef} aria-label="Paginación"
                className="w-full flex items-center justify-between gap-2 h-14 px-2
                    rounded-card border border-border-card bg-surface-card">
                <button type="button" className={`${NAV} w-10 h-10`} disabled={page <= 1}
                    onClick={() => navegar(() => onPageChange(page - 1))} aria-label="Página anterior">
                    <ChevronLeft size={18} strokeWidth={2.5} />
                </button>

                <span className="flex flex-col items-center leading-tight min-w-0" aria-live="polite">
                    <span className="text-body-sm font-black text-content tabular-nums">
                        {page} / {totalPages}
                    </span>
                    <span className="text-micro text-content-3 tabular-nums truncate">
                        {desde.toLocaleString()}–{hasta.toLocaleString()} de {mostrado.toLocaleString()}
                    </span>
                </span>

                <button type="button" className={`${NAV} w-10 h-10`} disabled={page >= totalPages}
                    onClick={() => navegar(() => onPageChange(page + 1))} aria-label="Página siguiente">
                    <ChevronRight size={18} strokeWidth={2.5} />
                </button>
            </nav>
        );
    }

    // ── Escritorio: una píldora en TRES ZONAS ─────────────────────────────
    // PLAN-MATERIALES §15.2. Antes era un `inline-flex` que quedaba pegado a una
    // esquina: ni centrado ni ocupando el ancho, o sea leyéndose como un
    // elemento que se quedó donde cayó. Ahora es una grilla `1fr auto 1fr`
    // —cuántas filas mostrar · pasar página · cuánto hay— y NO un
    // `space-between` de dos bloques: con la grilla el paginador queda en el
    // centro REAL del ancho y no se corre según lo largo que sea el texto de
    // los costados.
    return (
        <nav ref={rootRef} aria-label="Paginación"
            className="grid grid-cols-[1fr_auto_1fr] items-center w-full h-[52px] px-3 rounded-card
                border border-border-card bg-surface-card shadow-[var(--shadow-glass-1)]">

            {/* zona 1 · cuántas filas por página
                Acá vivía "40 páginas", que decía lo mismo que el "/40" del
                centro — dos veces el mismo número, y el de la izquierda encima
                sin la mitad que importa (en cuál estoy). En su lugar va el
                único control que faltaba, que además gana lo que le faltaba a
                la derecha: espacio libre para abrir su lista sin chocar contra
                el borde de la ventana. */}
            <span className="justify-self-start flex items-center gap-1.5">
                {onPageSizeChange && (
                <>
                    <span className="text-micro font-black uppercase tracking-widest text-content-3">Ver</span>
                    <LiquidSelect
                        value={String(pageSize)}
                        onChange={v => navegar(() => { onPageSizeChange(Number(v)); onPageChange(1); })}
                        options={PAGE_SIZE_OPTIONS.map(n => ({ value: String(n), label: String(n) }))}
                        ariaLabel="Filas por página"
                        // `nano` y no `compact bare`: la primera versión
                        // mostraba lupa y × de limpiar. No se busca entre
                        // tres opciones, y "limpiar" el tamaño de página no
                        // significa nada — dejaría la tabla sin saber
                        // cuántas filas mostrar.
                        nano clearable={false}
                    />
                </>
                )}
            </span>

            {/* zona 2 · pasar página — al centro real del ancho */}
            <span className="justify-self-center flex items-center">
                <button type="button" className={NAV} disabled={page <= 1}
                    onClick={() => navegar(() => onPageChange(page - 1))}
                    aria-label="Página anterior">
                    <ChevronLeft size={16} strokeWidth={2.5} />
                </button>

                {editando ? (
                    <input
                        ref={inputRef}
                        type="text"
                        inputMode="numeric"
                        value={borrador}
                        onChange={e => setBorrador(e.target.value.replace(/\D/g, ''))}
                        onBlur={confirmar}
                        onKeyDown={e => {
                            if (e.key === 'Enter') confirmar();
                            if (e.key === 'Escape') { setEditando(false); setBorrador(''); }
                        }}
                        aria-label={`Ir a la página, entre 1 y ${totalPages}`}
                        className="w-16 h-8 mx-1 text-center bg-transparent text-body-sm font-black
                            text-content outline-solid outline-1 outline-brand outline-offset-[-1px]
                            rounded-btn tabular-nums"
                    />
                ) : (
                    // Clickeable: reemplaza al campo "Ir a" que antes ocupaba
                    // lugar siempre para una acción que casi no se usa.
                    <button type="button"
                        onClick={() => { setBorrador(String(page)); setEditando(true); }}
                        title="Ir a una página"
                        className="h-8 min-h-[var(--tap-min)] px-2.5 mx-0.5 rounded-btn text-body-sm text-content-2 tabular-nums
                            whitespace-nowrap hover:bg-surface-card-hover hover:text-content
                            transition-colors duration-[var(--dur-fast)]">
                        pág. <b className="text-content font-black">{page}</b>
                        <span className="text-content-3">/{totalPages}</span>
                    </button>
                )}

                <button type="button" className={NAV} disabled={page >= totalPages}
                    onClick={() => navegar(() => onPageChange(page + 1))}
                    aria-label="Página siguiente">
                    <ChevronRight size={16} strokeWidth={2.5} />
                </button>
            </span>

            {/* zona 3 · cuánto hay — el rango y el total, a la derecha */}
            <span className="justify-self-end flex items-center gap-2 min-w-0">
                <span className="text-body-sm text-content-2 whitespace-nowrap tabular-nums" aria-live="polite">
                    <b className="text-content font-black">{desde.toLocaleString()}–{hasta.toLocaleString()}</b>
                    {' de '}
                    <b className="text-content font-black">{mostrado.toLocaleString()}</b>
                    {filteredTotal != null && filteredTotal !== total && (
                        <span className="text-content-3"> ({total.toLocaleString()} sin filtrar)</span>
                    )}
                    <span className="text-content-3"> {unit}</span>
                </span>
            </span>
        </nav>
    );
}
