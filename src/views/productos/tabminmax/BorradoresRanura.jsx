import React, { memo, useCallback, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, EyeOff, Filter, GitCompare, Loader2, Trash2, Upload, X } from 'lucide-react';
import TabBarAction from '../../../components/common/TabBarAction';
import LiquidTooltip from '../../../components/common/LiquidTooltip';
import useAnclaje from '../../../hooks/useAnclaje';
import useLayoutCompacto from '../../../hooks/useLayoutCompacto';

/**
 * BorradoresRanura — los borradores de MIN·MAX, dentro de la píldora de filtros.
 *
 * Antes era una barra propia debajo de las tarjetas de costo: contador, «Solo
 * borradores», «Cambios (308)», «Ocultar», «Descartar» y «Publicar todo (371)»
 * en línea, unos 640px. O sea una **segunda** barra de filtros a 40px de la
 * primera, que es justo lo que §17 existe para que no pase: el sitio único
 * donde uno mira para saber qué está filtrando dejaba de ser único.
 *
 * Acá va como una ranura más, y compacta: **sin los números**. El rótulo dice
 * qué es, el punto que late dice que hay algo, y las cuentas —371 borradores,
 * 308 con cambios— viven en el tooltip y en el panel, que es donde hay sitio
 * para escribirlas enteras. Un contador dentro de la píldora se lleva ~40px
 * para repetir un dato que el panel ya da al abrirlo.
 *
 * Las ACCIONES viajan con el filtro y no con el resto de acciones de la vista a
 * propósito: descartar y publicar solo existen mientras haya borradores, y solo
 * se entienden al lado de «ver solo los borradores». Separarlas dejaría un
 * botón «Publicar» suelto en una barra donde nada más habla de borradores.
 */
const BorradoresRanura = memo(({
    draftCount,
    changesCount,
    hasPublishedData,
    filterDraft,
    filterChangesOnly,
    onSoloBorradores,
    onSoloCambios,
    hasActiveFilter,
    filterLabel,
    filtradosCount,
    filteredDraftIds,
    onOcultarFiltrados,
    ocultando,
    onDescartar,
    descartando,
    onPublicar,
    publicando,
}) => {
    const compacto = useLayoutCompacto();
    const [abierto, setAbierto] = useState(false);
    const cerrar = useCallback(() => setAbierto(false), []);
    const id = useId();
    const { btnRef, caja } = useAnclaje(abierto && !compacto, cerrar, id);

    const publicarFiltrados = hasActiveFilter && filteredDraftIds.length > 0;

    // Un solo descriptor para las dos formas —panel de escritorio y columna de
    // la hoja táctil—. Escribirlas dos veces era garantizar que se separaran:
    // ya pasó con «Ocultar filtrados», que existía en la barra y no en móvil.
    const acciones = [
        {
            key: 'solo',
            icon: filterDraft ? X : Filter,
            label: filterDraft ? 'Ver todos' : `Ver solo los borradores (${draftCount.toLocaleString()})`,
            activo: filterDraft,
            onClick: onSoloBorradores,
        },
        ...(hasPublishedData && changesCount > 0 ? [{
            key: 'cambios',
            icon: filterChangesOnly ? X : GitCompare,
            label: filterChangesOnly ? 'Ver todos' : `Solo los que cambian (${changesCount.toLocaleString()})`,
            activo: filterChangesOnly,
            onClick: onSoloCambios,
        }] : []),
        ...(hasActiveFilter && filtradosCount > 0 ? [{
            key: 'ocultar',
            icon: ocultando ? Loader2 : EyeOff,
            label: `Ocultar ${filterLabel} (${filtradosCount.toLocaleString()})`,
            tone: 'danger',
            disabled: ocultando,
            onClick: onOcultarFiltrados,
        }] : []),
        {
            key: 'descartar',
            icon: descartando ? Loader2 : Trash2,
            label: 'Descartar todos',
            tone: 'danger',
            disabled: descartando,
            onClick: onDescartar,
        },
    ];

    const publicar = {
        icon: publicando ? Loader2 : Upload,
        label: publicarFiltrados
            ? `Publicar ${filterLabel} (${filteredDraftIds.length.toLocaleString()})`
            : `Publicar todo (${draftCount.toLocaleString()})`,
        disabled: publicando,
        onClick: () => (publicarFiltrados ? onPublicar(filteredDraftIds) : onPublicar()),
    };

    const lista = (
        <>
            {acciones.map(a => (
                <TabBarAction key={a.key} size="sm" icon={a.icon} tone={a.tone}
                    disabled={a.disabled}
                    onClick={a.disabled ? undefined : () => { a.onClick?.(); cerrar(); }}
                    aria-pressed={a.activo != null ? !!a.activo : undefined}
                    className={`w-full justify-start ${a.activo ? '!bg-brand/10 !border-brand/30 !text-brand-text' : ''}`}>
                    {a.label}
                </TabBarAction>
            ))}
            {/* Publicar va abajo y separado: es la única irreversible del grupo,
                y pegada a «Descartar» dos rojos y un azul se leen como una tira
                de opciones equivalentes. */}
            <div className="pt-2 mt-1 border-t border-divider">
                <TabBarAction size="sm" variant="primary" icon={publicar.icon}
                    disabled={publicar.disabled}
                    onClick={publicar.disabled ? undefined : () => { publicar.onClick(); cerrar(); }}
                    className="w-full justify-start">
                    {publicar.label}
                </TabBarAction>
            </div>
        </>
    );

    // ── Táctil: la ranura se apila dentro de la hoja de filtros ───────────
    // Sin panel ni tooltip: no hay hover que revele la cuenta, así que el
    // encabezado la dice, y la hoja ya da el ancho para los botones enteros.
    if (compacto) return (
        <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center gap-1.5">
                <Punto />
                <span className="text-body-sm font-black text-content tabular-nums">{draftCount.toLocaleString()}</span>
                <span className="text-caption text-content-3 font-medium">
                    borrador{draftCount !== 1 ? 'es' : ''} sin publicar
                </span>
            </div>
            {lista}
        </div>
    );

    // ── Escritorio: el botón compacto y su panel ──────────────────────────
    const resumen = changesCount > 0
        ? `${draftCount.toLocaleString()} borrador${draftCount !== 1 ? 'es' : ''} · ${changesCount.toLocaleString()} cambia${changesCount !== 1 ? 'n' : ''} el MIN/MAX`
        : `${draftCount.toLocaleString()} borrador${draftCount !== 1 ? 'es' : ''} sin publicar`;

    return (
        <>
            {/* El tooltip se APAGA con el panel abierto. Nace del mismo gesto —se
                pasa el mouse por encima y después se hace clic— así que sigue
                colgando bajo el botón y tapa el encabezado del panel, que dice
                exactamente lo mismo. Verificado en captura antes de corregirlo. */}
            <LiquidTooltip content={abierto ? null : resumen} side="bottom">
                <button ref={btnRef} type="button"
                    onClick={() => setAbierto(v => !v)}
                    aria-expanded={abierto} aria-haspopup="dialog"
                    aria-label={`Borradores — ${resumen}`}
                    className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-btn shrink-0
                        text-body-sm font-bold text-content-2 whitespace-nowrap
                        hover:bg-surface-card-hover hover:text-content
                        transition-[background-color,color] duration-200">
                    <Punto />
                    Borradores
                    <ChevronDown size={12} strokeWidth={2.5}
                        className={`shrink-0 text-content-3 transition-transform duration-200 ${abierto ? 'rotate-180' : ''}`} />
                </button>
            </LiquidTooltip>

            {abierto && caja && createPortal(
                <div data-panel={id} role="dialog" aria-label="Borradores de MIN y MAX"
                    data-surface="dropdown"
                    style={{ top: caja.top, right: caja.right }}
                    className="fixed z-dropdown w-[280px] p-2 flex flex-col gap-2
                        animate-in fade-in zoom-in-95 duration-150 ease-out">
                    <div className="flex items-center gap-1.5 px-1.5 pt-1 pb-0.5">
                        <Punto />
                        <span className="text-body-sm font-black text-content tabular-nums">{draftCount.toLocaleString()}</span>
                        <span className="text-caption text-content-3 font-medium">
                            borrador{draftCount !== 1 ? 'es' : ''} sin publicar
                        </span>
                    </div>
                    {lista}
                </div>,
                document.body,
            )}
        </>
    );
});

// El punto que late: es lo que dice "hay algo esperando" sin gastar el ancho de
// un número. Mismo par ping + sólido que ya usaba la barra vieja.
const Punto = () => (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-chart-1 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-chart-1" />
    </span>
);

BorradoresRanura.displayName = 'BorradoresRanura';

export default BorradoresRanura;
