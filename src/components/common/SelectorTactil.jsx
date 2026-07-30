import React, { memo, useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { X, Check, Search } from 'lucide-react';
import ModalShell from './ModalShell';
import SearchInput from './SearchInput';
import Button from './Button';
import { SkeletonText } from './StateViews';
import { agruparPorLetra } from '../../utils/alfabetico';

/**
 * SelectorTactil — elegir de una lista LARGA con el pulgar.
 *
 * ── Por qué existe (medido el 2026-07-30) ─────────────────────────────────
 * `LiquidSelect` abre un dropdown ANCLADO al trigger. Eso funciona con mouse,
 * y en un teléfono se rompe de tres maneras a la vez. Medido en WebKit con
 * perfil de iPhone, sobre el filtro de laboratorio del conteo (220 opciones):
 *
 *   · el dropdown hereda el ancho del trigger — **190px**, y 216px de alto,
 *     o sea ~4 opciones visibles de 220;
 *   · el trigger vivía dentro de la hoja de filtros, o sea abajo de la
 *     pantalla, y el dropdown se abre ahí mismo: en un dispositivo real el
 *     teclado del sistema tapa justo esa zona. Headless no lo reproduce porque
 *     no tiene teclado (memoria `feedback_headless_lies_about_performance`);
 *   · con más opciones que `searchThreshold` la lista arranca VACÍA y dice
 *     "Escribe para buscar". El campo existe —superpuesto al trigger— pero es
 *     invisible, así que el usuario lee una instrucción sin ver dónde
 *     ejecutarla.
 *
 * O sea que no era un problema de tamaño: el patrón de dropdown anclado no es
 * el correcto para táctil. Esto lo reemplaza por una hoja de pantalla completa.
 *
 * ── Anatomía ──────────────────────────────────────────────────────────────
 * Título + cerrar · buscador fijo · lista agrupada por letra con encabezado
 * pegajoso · riel A–Z arrastrable con burbuja de letra.
 *
 * El riel es lo que hace que 356 laboratorios sean recorribles sin escribir:
 * sin él son 18 pantallas de scroll para llegar a la Z.
 *
 * ── La letra de agrupación NO es el primer carácter ────────────────────────
 * En este catálogo 71 de 356 laboratorios empiezan con un prefijo numérico
 * (`1-ABBOTT NUTRICIONAL`, `1.1-INSUMOS`). Agrupar por el primer carácter
 * mandaría a Abbott al cajón "1", donde nadie lo va a buscar. La clave de
 * agrupación salta los dígitos y la puntuación inicial, y **el orden usa la
 * misma clave** — si no, los grupos no quedarían contiguos y el riel saltaría
 * a lugares equivocados.
 *
 * Lo que no empieza con letra ni después del prefijo cae en `#`, que va primero.
 */

const RAIL_W = 26;          // ancho del riel; el suficiente para un dedo sin comerse la lista
const LETRA_H = 30;         // alto de cada encabezado pegajoso

const sinTildes = (s) => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '');

const SelectorTactil = memo(({
    open,
    onClose,
    options = [],
    value,
    onChange,
    title = 'Elegir',
    placeholder = 'Buscar...',
    // Cuando el filtrado lo hace el servidor, este componente NO filtra: solo
    // muestra lo que llegó y avisa lo que se tecleó (mismo contrato que
    // `LiquidSelect`).
    serverSearch = false,
    onSearchChange,
    isLoading = false,
    clearable = true,
    clearLabel = 'Todos',
}) => {
    const [q, setQ] = useState('');
    const [letraActiva, setLetraActiva] = useState(null);
    const listaRef = useRef(null);
    const rielRef = useRef(null);
    const debounceRef = useRef(null);

    // Al cerrar se limpia lo tecleado: la próxima apertura tiene que empezar
    // desde la lista completa, no desde el filtro de la vez pasada.
    useEffect(() => {
        if (open) return;
        setQ('');            // eslint-disable-line react-hooks/set-state-in-effect -- reset al cerrar; el estado ES la sesión de búsqueda
        setLetraActiva(null);
    }, [open]);

    useEffect(() => () => clearTimeout(debounceRef.current), []);

    const alTeclear = useCallback((texto) => {
        setQ(texto);
        if (!onSearchChange) return;
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => onSearchChange(texto), 300);
    }, [onSearchChange]);

    // ── Filtrado y agrupación ────────────────────────────────────────────
    const grupos = useMemo(() => {
        const term = sinTildes(q).trim().toUpperCase();
        const visibles = serverSearch || !term
            ? options
            : options.filter((o) => sinTildes(o.label).toUpperCase().includes(term));
        return agruparPorLetra(visibles);
    }, [options, q, serverSearch]);

    const letras = grupos.map((g) => g.letra);
    const totalVisible = grupos.reduce((n, g) => n + g.items.length, 0);

    // ── Riel: llevar a la letra ──────────────────────────────────────────
    const irA = useCallback((letra) => {
        const cont = listaRef.current;
        // Se apunta a la SECCIÓN, no al encabezado: el encabezado es `sticky`, así
        // que cuando está pinchado arriba su rect coincide con el del contenedor y
        // el delta sale 0 — el riel no movía nada.
        const destino = cont?.querySelector(`[data-seccion="${letra}"]`);
        if (!cont || !destino) return;
        // Delta por rects y no `offsetTop`: `offsetTop` se mide contra el ancestro
        // POSICIONADO más cercano, que acá no es el contenedor scrolleable (no
        // tiene `position`), así que daba un número de otra caja.
        const dy = destino.getBoundingClientRect().top - cont.getBoundingClientRect().top;
        cont.scrollTop += dy;
        setLetraActiva(letra);
    }, []);

    // Un solo manejador para tocar y arrastrar: la letra sale de la posición
    // del dedo sobre el riel, así que arrastrar recorre el índice sin soltar.
    const desdeElDedo = useCallback((clientY) => {
        const riel = rielRef.current;
        if (!riel || !letras.length) return;
        const r = riel.getBoundingClientRect();
        const prop = Math.min(Math.max((clientY - r.top) / r.height, 0), 0.9999);
        irA(letras[Math.floor(prop * letras.length)]);
    }, [letras, irA]);

    const onPointerDown = (e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        desdeElDedo(e.clientY);
    };
    const onPointerMove = (e) => {
        if (e.buttons === 0 && e.pointerType === 'mouse') return;
        desdeElDedo(e.clientY);
    };
    const soltar = () => setLetraActiva(null);

    const elegir = (v) => { onChange?.(v); onClose?.(); };

    return (
        <ModalShell
            open={open}
            onClose={onClose}
            align="bottom"
            maxWidthClass="max-w-none"
            surface={null}
            panelClassName="h-[100dvh]"
            ariaLabel={title}
        >
            <div data-surface="modal" data-selector-tactil=""
                className="flex flex-col h-full overflow-hidden">
                {/* Encabezado */}
                <div className="flex-none flex items-center justify-between gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 border-b border-border-card">
                    <div className="min-w-0">
                        <h2 className="text-body-lg font-black text-content truncate">{title}</h2>
                        <p className="text-micro text-content-3 tabular-nums">
                            {totalVisible} {totalVisible === 1 ? 'opción' : 'opciones'}
                        </p>
                    </div>
                    <Button variant="destructive" size="sm" icon={X} iconOnly onClick={onClose} aria-label={`Cerrar ${title}`} />
                </div>

                {/* Buscador fijo. `SearchInput` estático es lo que DESIGN.md §25
                    manda para el buscador de un picker: la lista y el campo son
                    una sola pieza, no un control que tenga sentido ocultar. */}
                <div className="flex-none px-4 py-3 border-b border-border-card">
                    {/* `autoFocus={false}` a propósito: al abrir se quiere VER la
                        lista, y el teclado del sistema se come media pantalla. Se
                        toca el campo cuando se quiere escribir. */}
                    <SearchInput value={q} onChange={alTeclear} placeholder={placeholder} loading={isLoading} autoFocus={false} />
                </div>

                {/* Lista + riel */}
                <div className="relative flex-1 min-h-0">
                    <div
                        ref={listaRef}
                        data-lista=""
                        className="h-full overflow-y-auto overscroll-contain pb-[max(16px,env(safe-area-inset-bottom))]"
                        style={{ paddingRight: RAIL_W }}
                    >
                        {clearable && !q && (
                            <Fila
                                label={clearLabel}
                                seleccionada={value == null || value === ''}
                                onClick={() => elegir(null)}
                                destacada
                            />
                        )}

                        {isLoading && !totalVisible ? (
                            <div className="px-4 py-6"><SkeletonText lines={6} /></div>
                        ) : !totalVisible ? (
                            <div className="px-6 py-16 flex flex-col items-center gap-2 text-center">
                                <Search size={28} strokeWidth={1.5} className="text-content-3" />
                                <p className="text-body-sm font-bold text-content-3">
                                    {serverSearch && !q ? 'Escribe para buscar' : 'Sin resultados'}
                                </p>
                                {!!q && <p className="text-caption text-content-3">Prueba con menos letras.</p>}
                            </div>
                        ) : grupos.map((g) => (
                            <section key={g.letra} data-seccion={g.letra}>
                                <h3
                                    data-letra={g.letra}
                                    className="sticky top-0 z-base flex items-center px-4 bg-surface-card-hover
                                        text-caption font-black tracking-widest text-content-3 border-y border-border-card"
                                    style={{ height: LETRA_H }}
                                >
                                    {g.letra}
                                </h3>
                                {g.items.map((o) => (
                                    <Fila
                                        key={o.value}
                                        label={o.label}
                                        sublabel={o.sublabel}
                                        badge={o.badge}
                                        seleccionada={String(o.value) === String(value)}
                                        onClick={() => elegir(o.value)}
                                    />
                                ))}
                            </section>
                        ))}
                    </div>

                    {/* Riel A–Z. `touch-none` es obligatorio: sin él el navegador
                        interpreta el arrastre como scroll de la página y el
                        índice no llega a recibir el movimiento. */}
                    {letras.length > 2 && (
                        <div
                            ref={rielRef}
                            role="navigation"
                            aria-label="Índice alfabético"
                            onPointerDown={onPointerDown}
                            onPointerMove={onPointerMove}
                            onPointerUp={soltar}
                            onPointerCancel={soltar}
                            className="absolute right-0 top-0 bottom-0 flex flex-col items-center justify-center
                                select-none touch-none cursor-pointer"
                            style={{ width: RAIL_W }}
                        >
                            {letras.map((l) => (
                                <span
                                    key={l}
                                    className={`text-micro font-black leading-none py-[1px] transition-colors duration-100
                                        ${l === letraActiva ? 'text-brand-text' : 'text-content-3'}`}
                                >
                                    {l}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Burbuja: al arrastrar, el dedo tapa la letra del riel. */}
                    {letraActiva && (
                        <span
                            aria-hidden="true"
                            className="pointer-events-none absolute top-1/2 -translate-y-1/2 grid place-items-center
                                w-14 h-14 rounded-full bg-brand text-white text-display-sm font-black shadow-lg"
                            style={{ right: RAIL_W + 12 }}
                        >
                            {letraActiva}
                        </span>
                    )}
                </div>
            </div>
        </ModalShell>
    );
});

// 56px de alto: es una fila que se toca, no que se lee de pasada. El piso del
// dedo son 44px (DESIGN.md §25) y acá sobra pantalla, así que se usa.
const Fila = memo(({ label, sublabel, badge, seleccionada, destacada, onClick }) => (
    <button
        type="button"
        role="option"
        aria-selected={seleccionada}
        onClick={onClick}
        className={`w-full min-h-14 px-4 py-2 flex items-center gap-3 text-left
            border-b border-border-card/60 transition-colors duration-100
            ${seleccionada ? 'bg-brand/10' : 'active:bg-surface-card-hover'}`}
    >
        <span className="flex-1 min-w-0">
            <span className={`block text-body-sm leading-tight ${destacada || seleccionada ? 'font-black text-content' : 'font-bold text-content-2'}`}>
                {label}
            </span>
            {sublabel && <span className="block text-caption text-content-3 truncate mt-0.5">{sublabel}</span>}
        </span>
        {badge != null && (
            <span className="text-caption font-bold text-content-3 tabular-nums shrink-0">{badge}</span>
        )}
        {seleccionada && <Check size={16} strokeWidth={3} className="text-brand-text shrink-0" />}
    </button>
));
Fila.displayName = 'SelectorTactil.Fila';

SelectorTactil.displayName = 'SelectorTactil';
export default SelectorTactil;
