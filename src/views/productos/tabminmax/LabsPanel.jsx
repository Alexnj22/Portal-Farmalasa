// Extracted from TabMinMax.jsx (Bloque 6.C)
import { useState, useEffect, useRef } from 'react';
import HojaMovil from '../../../components/common/HojaMovil';
import useMediaQuery from '../../../hooks/useMediaQuery';
import Badge from '../../../components/common/Badge';
import Button from '../../../components/common/Button';
import ModalShell from '../../../components/common/ModalShell';
import Switch from '../../../components/common/Switch';
import { SkeletonText } from '../../../components/common/StateViews';
import { FlaskConical, X, Search, Loader2 } from 'lucide-react';
import { useStaffStore as useStaff } from '../../../store/staffStore';
import { smartFilter } from '../../../utils/searchUtils';
import {
    fetchLaboratoriosMinMaxVisibility, fetchActiveProductLabCounts, updateLaboratorioMinMaxVisibility,
    fetchProductIdsByLaboratorio, unhideStockParamsForProducts,
} from '../../../data/minmaxLabs';
import SearchInput from '../../../components/common/SearchInput';
import { EmptyState } from '../../../components/common/StateViews';

export default function LabsPanel({ onClose, onChanged }) {
    const [labs,      setLabs]      = useState([]);
    const [counts,    setCounts]    = useState({});  // laboratorio_id → product count
    const [loading,   setLoading]   = useState(true);
    const [saving,    setSaving]    = useState(null);
    const [err,       setErr]       = useState(null);
    const [search,    setSearch]    = useState('');
    const searchRef = useRef();

    useEffect(() => {
        Promise.all([
            fetchLaboratoriosMinMaxVisibility(),
            fetchActiveProductLabCounts(),
        ]).then(([{ data: labData }, { data: countData }]) => {
            setLabs(labData || []);
            const cm = {};
            (countData || []).forEach(r => { cm[r.laboratorio_id] = Number(r.product_count); });
            setCounts(cm);
            setLoading(false);
        });
        // Auto-focus search after mount
        setTimeout(() => searchRef.current?.focus(), 80);
    }, []);

    const toggle = async (lab) => {
        setSaving(lab.id);
        setErr(null);
        const newVal = !lab.ocultar_en_minmax;
        const { error } = await updateLaboratorioMinMaxVisibility(lab.id, newVal);
        if (!error) {
            // Al desocultar un lab, limpia is_hidden individual para que los productos
            // reaparezcan sin estar marcados como ocultos a nivel de producto
            if (!newVal) {
                const { data: prods } = await fetchProductIdsByLaboratorio(lab.id);
                if (prods?.length) {
                    // unhideStockParamsForProducts devuelve un array de resultados
                    // (uno por chunk de 1000) — un chunk fallido antes quedaba en
                    // silencio (hallazgo de /code-review post-auditoría).
                    const results = await unhideStockParamsForProducts(prods.map(p => p.id));
                    const failed = results.find(r => r.error);
                    if (failed) {
                        setErr(`Algunos productos no se pudieron desocultar: ${failed.error.message}`);
                        setSaving(null);
                        return;
                    }
                }
            }
            setLabs(prev => prev.map(l => l.id === lab.id ? { ...l, ocultar_en_minmax: newVal } : l));
            useStaff.getState().appendAuditLog('MINMAX_LAB_VISIBILITY', String(lab.id), {
                lab: lab.nombre, ocultar: newVal,
            });
            onChanged?.();
        } else {
            setErr(error.message);
        }
        setSaving(null);
    };

    const visible = search.trim() ? smartFilter(search, labs, l => [l.nombre]).results : labs;
    const hiddenCount = labs.filter(l => l.ocultar_en_minmax).length;

    // Glassmorphism tokens shared across elements
    const glass = {
        panel:  { background: 'var(--surface-modal)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-glass-5)' },
        divider:{ borderColor: 'var(--divider)' },
        search: { background: 'var(--surface-input)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-input)', boxShadow: 'var(--shadow-shine)' },
        row:    { background: 'var(--surface-card)', border: '1px solid var(--divider)' },
        rowOff: { background: 'color-mix(in srgb, var(--danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)' },
        footer: { background: 'var(--surface-card)', border: '1px solid var(--divider)' },
    };

    // En el teléfono el cuerpo es el canónico de hoja; en escritorio, el panel
    // de siempre.
    const enTactil = useMediaQuery('(hover: none)');
    // Una FUNCIÓN que devuelve JSX, no un componente definido en el render:
    // definir un componente ahí adentro lo re-crea en cada pasada y React
    // remonta el subárbol entero, perdiendo el estado del formulario. El lint lo
    // marca ("Cannot create components during render") y tiene razón.
    //
    // Cuerpo y pie POR SEPARADO: en la hoja los `children` caen dentro del cuerpo
    // scrolleable, así que un pie pasado como hijo se va con el scroll en vez de
    // quedar anclado. `HojaMovil` tiene la ranura `pie` justo para eso.
    const envolver = (cuerpo, pie) => enTactil
        ? <HojaMovil titulo="Visibilidad de laboratorios" icono={FlaskConical} pie={pie}>{cuerpo}</HojaMovil>
        : <div className="flex flex-col">{cuerpo}
            <div className="px-3 pb-3 pt-1 border-t mt-auto" style={glass.divider}>{pie}</div></div>;

    return (
        // `ModalShell` y no un overlay a mano (2026-07-30): sin scrim, sin
        // `role="dialog"`, sin Escape y sin atrapar el foco, este panel no era un
        // diálogo para nadie más que para el ojo. La entrada la anima el canónico,
        // que ya pasa por los dos gates de movimiento (tema y reduced-motion).
        // Sin `align`: el default. Estaba en `"top"`, que `ModalShell` respeta
        // siempre por ser el gesto del ⌘K — y en un teléfono eso deja el panel
        // flotando a 10vh del borde de arriba, que es exactamente el
        // antipatrón que el paso a hojas vino a quitar. Este no es una paleta
        // de comandos, es un formulario.
        <ModalShell open onClose={onClose} maxWidthClass="max-w-xs"
            zClass="z-modal" ariaLabel="Laboratorios ocultos en Min/Max"
            surface={enTactil ? null : undefined}
            // SIN `animacionPropia`: significa "el hijo se anima solo", y este
            // panel no se animaba — solo apagaba la de `ModalShell`. Sin la gota
            // no hay `__gota`, y sin `__gota` el asa no arrastra.
            panelClassName="overflow-hidden">
            {envolver(<>

                {/* Header — solo en escritorio: en el teléfono el título y el asa
                    los pone `HojaMovil`. */}
                {!enTactil && (
                <div className="flex items-center justify-between px-4 py-3 border-b" style={glass.divider}>
                    <div className="flex items-center gap-2">
                        <FlaskConical size={14} className="text-brand-text" />
                        <span className="text-body-sm font-black text-content">Visibilidad de laboratorios</span>
                        {hiddenCount > 0 && (
                            <Badge variant="chart-1" size="sm" uppercase={false}>{hiddenCount} oculto{hiddenCount !== 1 ? 's' : ''}</Badge>
                        )}
                    </div>
                    <Button variant="ghost" size="xs" icon={X} iconOnly onClick={onClose} />
                </div>
                )}

                {/* Search */}
                <div className="px-3 pt-3 pb-1.5">
                    <SearchInput
                        ref={searchRef}
                        size="sm"
                        placeholder="Buscar laboratorio…"
                        value={search}
                        onChange={setSearch}
                    />
                </div>

                {/* Hint */}
                <p className="px-4 pb-1.5 text-[9.5px] text-content-3 leading-relaxed">
                    Ocultos: no aparecen en MinMax ni en el cálculo. No se cuentan como productos ocultos individualmente.
                </p>

                {err && (
                    <p className="mx-3 mb-1.5 px-2.5 py-1.5 rounded-lg bg-danger/10 border border-danger/30 text-caption text-danger-text font-semibold">
                        {err}
                    </p>
                )}

                {/* List */}
                <div className="px-3 pb-2 flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: '54vh' }}>
                    {loading ? (
                        <div className="flex items-center justify-center py-10"><SkeletonText lines={4} className="w-full max-w-md" /></div>
                    ) : visible.length === 0 ? (
                        <EmptyState compact icon={FlaskConical} title="Sin resultados" subtitle="Ningún laboratorio coincide con la búsqueda." />
                    ) : visible.map(lab => {
                        const hidden = lab.ocultar_en_minmax;
                        const count  = counts[lab.id] ?? 0;
                        return (
                            <button key={lab.id}
                                aria-pressed={hidden}
                                aria-label={`${lab.nombre}: ${hidden ? 'oculto, mostrar' : 'visible, ocultar'}`}
                                onClick={() => toggle(lab)}
                                disabled={saving === lab.id}
                                className="flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all duration-[var(--dur-base)] disabled:opacity-60 hover:scale-[1.01] active:scale-[0.99]"
                                style={hidden ? glass.rowOff : glass.row}>
                                <div className="flex-1 min-w-0">
                                    <div className={`text-label font-semibold truncate ${hidden ? 'text-danger-text' : 'text-content-2'}`}>
                                        {lab.nombre}
                                    </div>
                                    {count > 0 && (
                                        <div className={`text-micro tabular-nums ${hidden ? 'text-danger' : 'text-content-3'}`}>
                                            {count} producto{count !== 1 ? 's' : ''}
                                        </div>
                                    )}
                                </div>
                                <div className="shrink-0">
                                    {saving === lab.id ? (
                                        <Loader2 size={12} className="animate-spin text-content-3" />
                                    ) : (
                                        /* Indicador, no control: la fila ya es el botón (ver DashboardView). */
                                        <Switch checked={!hidden} size="sm"
                                            variant={hidden ? 'danger' : 'success'} />
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </>,
            <Button variant="ghost" onClick={onClose}>Cerrar</Button>)}
        </ModalShell>
    );
}
