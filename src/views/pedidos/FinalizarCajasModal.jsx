import React, { useRef, useState, useEffect } from 'react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { ChevronLeft, Loader2, X, Package, PackageCheck, RotateCcw, TriangleAlert, Search, Ban, SearchX } from 'lucide-react';
import PedidoModal from './PedidoModal';
import { getExactPageGroups } from '@nucleo/utils/pedidoPrint';
import { saveDraft, loadDraft, clearDraft } from '@nucleo/utils/draftUtils';
import FilterBar from '../../components/common/FilterBar';
import PortalInput from '../../components/common/PortalInput';
import Notice from '../../components/common/Notice';
import useMontadoParaSalida from '../../plataforma/useMontadoParaSalida';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { lanzarSimulacroTraslado, fetchTrasladoErp, guardarPaginasDeSala } from '@nucleo/data/pedidos';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import { esperaDeSondeo } from './logicaDeRutas';
import { buscarProductos } from '@nucleo/data/busquedaProductos';
import {
    ajustesDeEnvio, ajustesDelSimulacro, alternarCaja, armarCajaMap, armarPaginaItems, asignacionCompleta, asignacionInicial,
    cuantasCajas, despachablesDe,
} from '@nucleo/utils/finalizarCajas';

// Un solo «sin productos» para siempre: `items` es dependencia del efecto que
// reinicia el diálogo, y un `[]` nuevo en cada render lo volvía a correr —y a
// pintar— aunque el diálogo estuviera cerrado. Ver `SIN_CLAVES` en
// `CrearRutaModal`, donde el mismo patrón sí era un ciclo sin fin.
const SIN_PRODUCTOS = [];

export default function FinalizarCajasModal({ open, onClose, onConfirm, items = SIN_PRODUCTOS, sucId, pedidoId, pedidoNumero, paginas = null, draftKey = null }) {
    const montadoParaSalida = useMontadoParaSalida(open);
    const [screen,          setScreen]          = useState(1);
    const [totalCajasInput, setTotalCajasInput] = useState('');
    const [pageAssignments, setPageAssignments] = useState([]);
    const [submitting,      setSubmitting]      = useState(false);
    const [pageGroups,      setPageGroups]      = useState([]);
    const [loadingPages,    setLoadingPages]    = useState(false);
    const [hasDraft,        setHasDraft]        = useState(false);

    // ── Lo que realmente sale ────────────────────────────────────────────────
    // `ajustes`: { [pedido_item_id]: { cantidad, motivo } }. Solo viven acá las
    // EXCEPCIONES — lo que no está en este mapa sale como se asignó.
    const [ajustes,   setAjustes]   = useState({});
    const [busqueda,  setBusqueda]  = useState('');
    const [simuId,    setSimuId]    = useState(null);
    const [simu,      setSimu]      = useState(null);
    const [simuError, setSimuError] = useState(null);

    useEffect(() => {
        if (!open) {
            // Resetear estado al cerrar para que la próxima apertura empiece limpio
            setSubmitting(false); // eslint-disable-line react-hooks/set-state-in-effect
            setScreen(1);
            setTotalCajasInput('');
            setPageAssignments([]);
            setHasDraft(false);
            setAjustes({});
            setBusqueda('');
            setSimuId(null);
            setSimu(null);
            setSimuError(null);
            return;
        }
        // Check for draft on open
        if (draftKey) setHasDraft(!!loadDraft(draftKey));
        if (paginas) {
            setPageGroups(paginas);
            setLoadingPages(false);
            return;
        }
        if (!items.length || !sucId) return;
        setLoadingPages(true);
        setPageGroups([]);
        getExactPageGroups(sucId, items)
            .then(groups => {
                setPageGroups(groups);
                // Y se GUARDA. Antes se recalculaba en memoria y se perdía: el
                // pedido seguía sin hojas, así que el traslado no podía salir y
                // la próxima apertura volvía a calcular. Acá es donde se repara
                // de verdad un pedido al que se le cortó la captura —le pasó al
                // #97, con 460 productos—.
                if (groups.length && pedidoId) {
                    guardarPaginasDeSala(pedidoId, sucId, groups)
                        .then(({ error }) => { if (error) console.error('guardar hojas:', error.message); });
                }
            })
            .catch(e => { console.error('recalcular hojas:', e); setPageGroups([]); })
            .finally(() => setLoadingPages(false));
    }, [open, items, sucId, pedidoId, paginas, draftKey]);

    // La verificación arranca al ABRIR, no al llegar a la pantalla 3: tarda ~40 s
    // para una sucursal grande, y ese es justo el rato que lleva contar las cajas
    // y repartir las páginas. Así llega hecha en vez de hacer esperar.
    useEffect(() => {
        if (!open || !pedidoId || !sucId) return;
        let vivo = true;
        lanzarSimulacroTraslado(pedidoId, sucId).then(({ trasladoId, error }) => {
            if (!vivo) return;
            if (error) setSimuError(error);
            else       setSimuId(trasladoId);
        });
        return () => { vivo = false; };
    }, [open, pedidoId, sucId]);

    // Sondeo hasta que deje de estar en curso, con ESPERA CRECIENTE (3, 6, 12,
    // 24, 24… s — `esperaDeSondeo`) y el mismo tope total de 2 minutos. Antes
    // era cada 3 s hasta 40 veces: 40 lecturas para algo que suele tardar ~40 s.
    // Lo rápido se entera igual de pronto; lo lento cuesta 8 lecturas y no 40.
    // Un fallo de red no corta el sondeo — se reintenta en la siguiente vuelta.
    //
    // Con TOPE (2026-10-07): sin él, una revisión trabada en «en curso» sondeaba
    // hasta cerrar el modal y dejaba el botón de finalizar bloqueado para
    // siempre. A los 2 minutos se da por no respondida y se puede confirmar
    // igual, ajustando a mano — lo mismo que cuando la revisión falla.
    //
    // Depende SÓLO de `simuId`: antes dependía también de `simu`, y cada lectura
    // rearmaba el intervalo; el contador vivía en un ref que nunca volvía a cero,
    // así que al reabrir el modal el sondeo arrancaba ya agotado.
    useEffect(() => {
        if (!simuId) return undefined;
        let vivo = true;
        let t = null;
        let intento = 0;
        const vuelta = async () => {
            try {
                const { data } = await fetchTrasladoErp(simuId);
                if (!vivo) return;
                if (data) {
                    setSimu(data);
                    if (data.estado !== 'en_curso') return;
                }
            } catch { /* se reintenta en la próxima vuelta */ }
            if (!vivo) return;
            intento += 1;
            const espera = esperaDeSondeo(intento);
            if (espera == null) { setSimuError(e => e ?? 'la revisión tardó demasiado'); return; }
            t = setTimeout(vuelta, espera);
        };
        t = setTimeout(vuelta, esperaDeSondeo(0));
        return () => { vivo = false; clearTimeout(t); };
    }, [simuId]);

    // No se finaliza mientras se revisa la existencia (2026-10-07): lo que el
    // sistema dice que no hay arranca en cero cuando llega la revisión, y
    // confirmar antes mandaba esos productos con lo asignado y hacía fallar el
    // traslado entero. Si la revisión falla o tarda, se puede confirmar igual.
    const verificando = !simuError && (!simu || simu.estado === 'en_curso');
    // Y si la revisión ni siquiera arranca (sin respuesta del lanzamiento), el
    // mismo tope: el botón nunca queda bloqueado más de 2 minutos.
    const verificandoRef = useRef(verificando);
    useEffect(() => { verificandoRef.current = verificando; }, [verificando]);
    useEffect(() => {
        if (!open) return undefined;
        const t = setTimeout(() => {
            if (verificandoRef.current) setSimuError(e => e ?? 'la revisión tardó demasiado');
        }, 120_000);
        return () => clearTimeout(t);
    }, [open]);

    // Lo que el sistema no pudo resolver arranca en CERO: si dice que no hay
    // existencia, mandarlo igual hace fallar el traslado entero. Queda editable
    // —el sistema informa, Bodega decide— y se muestra al lado lo asignado.
    // No pisa lo que quien despacha ya tocó.
    useEffect(() => {
        if (simu?.estado !== 'verificado') return;
        const nuevos = ajustesDelSimulacro(simu, items);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAjustes(prev => ({ ...nuevos, ...prev }));
    }, [simu, items]);

    const totalPages = pageGroups.length;
    const cajaCount  = cuantasCajas(totalCajasInput);

    const handleGoScreen2 = () => {
        setPageAssignments(asignacionInicial(totalPages, cajaCount));
        setScreen(2);
    };

    const toggleBox = (pageIdx, boxNum) => {
        setPageAssignments(prev => alternarCaja(prev, pageIdx, boxNum));
    };

    const isValid = asignacionCompleta(pageAssignments, totalPages);

    // Solo los productos que de verdad salen: los que la bodega no pudo cubrir
    // nunca estuvieron en la caja, así que no hay nada que confirmar sobre ellos.
    const despachables = despachablesDe(items);

    // La búsqueda dice POR QUÉ no encuentra (2026-10-08): «zx» sin resultados
    // no decía si el producto no existe, no va en el pedido o ya se está
    // corrigiendo arriba. Lo del pedido se mira acá; el catálogo, sólo si
    // aquí no hay nada, con la búsqueda canónica.
    const termino = busqueda.trim();
    const nombresDe = r => [r.products?.nombre, r.products?.laboratorios?.nombre];
    const resultados = termino.length >= 2
        ? smartFilter(termino, despachables.filter(r => !(String(r.id) in ajustes)), nombresDe).results
        : [];
    const yaCorregido = termino.length >= 2 && resultados.length === 0
        ? smartFilter(termino, despachables.filter(r => String(r.id) in ajustes), nombresDe).results[0] ?? null : null;
    const sinAsignar = termino.length >= 2 && resultados.length === 0 && !yaCorregido
        ? smartFilter(termino, items.filter(r => !despachables.includes(r)), nombresDe).results[0] ?? null : null;
    const buscarEnCatalogo = termino.length >= 2 && resultados.length === 0 && !yaCorregido && !sinAsignar;
    const [catalogo, setCatalogo] = useState({ termino: '', nombre: null, cargando: false });
    useEffect(() => {
        if (!buscarEnCatalogo) return undefined;
        let vivo = true;
        const t = setTimeout(async () => {
            const { data, error } = await buscarProductos(termino, { select: 'id, nombre', limite: 1 });
            if (!vivo) return;
            if (error) console.warn('[FinalizarCajas] búsqueda en catálogo:', error.message);
            setCatalogo({ termino, nombre: data?.[0]?.nombre ?? null, cargando: false, fallo: !!error });
        }, 300);
        return () => { vivo = false; clearTimeout(t); };
    }, [buscarEnCatalogo, termino]);

    // Un ajuste es una EXCEPCIÓN: solo cuenta si difiere de lo asignado.
    const ajustesLista = ajustesDeEnvio(ajustes, items);

    const noEnviados = ajustesLista.filter(a => a.cantidad_enviada === 0).length;

    // Espera a que se guarde: si falla, el modal sigue abierto con lo anotado
    // y el borrador intacto. Antes se borraba el borrador y se cerraba antes
    // de saber si se había guardado (2026-10-07).
    const handleConfirm = async () => {
        if (submitting || !isValid) return;
        setSubmitting(true);

        // El reparto sale del núcleo (`finalizarCajas`), el mismo de la app.
        const cajaMap = armarCajaMap(pageAssignments, cajaCount);
        const paginaItems = armarPaginaItems(pageGroups);

        const ok = await onConfirm({ totalCajas: cajaCount, cajaMap, paginaItems, ajustesEnvio: ajustesLista });
        if (ok === false) { setSubmitting(false); return; }
        if (draftKey) clearDraft(draftKey);
    };

    const setCantidad = (itemId, valor, motivo) => {
        setAjustes(prev => ({
            ...prev,
            [itemId]: { cantidad: valor, motivo: motivo ?? prev[itemId]?.motivo ?? '' },
        }));
    };
    const quitarAjuste = (itemId) => {
        setAjustes(prev => {
            const n = { ...prev };
            delete n[itemId];
            return n;
        });
    };

    const handleClose = () => {
        if (submitting) return;
        if (draftKey && totalCajasInput) {
            saveDraft(draftKey, { totalCajasInput });
        }
        setScreen(1); setTotalCajasInput(''); setPageAssignments([]);
        setSubmitting(false); setPageGroups([]); setLoadingPages(false); setHasDraft(false);
        onClose();
    };

    const handleRestoreDraft = () => {
        if (!draftKey) return;
        const d = loadDraft(draftKey);
        if (!d) return;
        if (d.totalCajasInput) setTotalCajasInput(d.totalCajasInput);
        setHasDraft(false);
        clearDraft(draftKey);
    };

    // El gate mira el montaje-para-SALIDA y no `open` a secas: cortar en el
    // mismo tick del cierre desmontaba el componente antes de que
    // `ModalShell` pudiera animar nada. Ver `useMontadoParaSalida`.
    if (!montadoParaSalida) return null;

    const boxes = Array.from({ length: cajaCount }, (_, b) => b + 1);
    const parsedCajas = parseInt(totalCajasInput, 10);

    return (
        <PedidoModal open={open} onClose={handleClose} maxWidth="max-w-sm">

            {/* ── Header ─────────────────────────────────── */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border-card">
                {screen > 1 && (
                    <Button variant="secondary" size="xs" icon={ChevronLeft} disabled={submitting} iconOnly onClick={() => setScreen(screen - 1)} />
                )}
                <div className="flex-1 min-w-0">
                    <p className="text-caption font-semibold text-chart-3-text uppercase tracking-wider">Pedido #{pedidoNumero}</p>
                    <h3 className="text-subtitle font-black text-content leading-tight">
                        {screen === 1 ? 'Asignar cajas' : screen === 2 ? 'Página → Caja' : 'Confirmar lo que sale'}
                    </h3>
                </div>
                <Button variant="ghost" size="xs" icon={X} disabled={submitting} iconOnly onClick={handleClose} />
            </div>

            {/* Draft restore banner */}
            {hasDraft && screen === 1 && (
                <div className="mx-5 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-chart-3/10 border border-chart-3/30">
                    <RotateCcw size={12} className="text-chart-3-text shrink-0" />
                    <span className="text-label text-chart-3-text flex-1">Tienes un borrador guardado</span>
                    <Button variant="ghost" onClick={handleRestoreDraft}>Restaurar</Button>
                    <Button variant="ghost" icon={X} iconOnly onClick={() => { if (draftKey) clearDraft(draftKey); setHasDraft(false); }} />
                </div>
            )}

            {/* ── Screen 1 ───────────────────────────────── */}
            {screen === 1 && (
                <div className="px-5 py-5 space-y-5">
                    {/* Page count card */}
                    <div className="flex items-center gap-4 px-4 py-4 rounded-2xl bg-chart-3/10 border border-chart-3/20">
                        <div className="w-12 h-12 rounded-2xl bg-chart-3 shadow-[var(--shadow-glow-chart-3)] flex items-center justify-center shrink-0">
                            {loadingPages
                                ? <Loader2 size={18} className="animate-spin text-white" />
                                : <Package size={18} className="text-white" />
                            }
                        </div>
                        <div className="flex-1 min-w-0">
                            {loadingPages ? (
                                <p className="text-body-sm text-content-3 font-medium">Calculando páginas del PDF…</p>
                            ) : (
                                <>
                                    <p className="text-display font-black text-content leading-none tabular-nums">
                                        {totalPages}
                                        <span className="text-body font-semibold text-content-3 ml-1.5">
                                            {totalPages === 1 ? 'página' : 'páginas'}
                                        </span>
                                    </p>
                                    <p className="text-label text-content-3 mt-0.5">en el PDF del pedido</p>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Box count input */}
                    <div>
                        <label className={rotuloCampo('text-content-2')}>
                            ¿Cuántas cajas salen?
                        </label>
                        <div className="relative">
                            <PortalInput
                                aria-label="Total de cajas recibidas"
                                type="number"
                                value={totalCajasInput}
                                onChange={e => setTotalCajasInput(e.target.value)}
                                placeholder="Ej. 4"
                                min={1}
                                max={99}
                                autoFocus
                                inputClassName="text-title-lg font-black text-content"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-label font-semibold text-content-3 pointer-events-none">
                                cajas
                            </span>
                        </div>
                        {totalCajasInput && parsedCajas > 0 && !loadingPages && totalPages > 0 && (
                            <p className="text-caption text-content-3 mt-1.5 pl-1">
                                {parsedCajas >= totalPages
                                    ? `1 página por caja`
                                    : `~${(totalPages / parsedCajas).toFixed(1)} páginas por caja`
                                }
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* ── Screen 2 ───────────────────────────────── */}
            {screen === 2 && (
                <div className="px-4 py-3 max-h-[56vh] overflow-y-auto scrollbar-hide">
                    {/* Box legend */}
                    <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                        <span className="text-caption font-semibold text-content-2 uppercase tracking-wide mr-1">Cajas:</span>
                        {boxes.map(b => (
                            <Badge key={b} variant="chart-3" uppercase={false}>C{b}</Badge>
                        ))}
                        <span className="ml-auto text-caption text-content-3">{totalPages} pág.</span>
                    </div>

                    {/* Page rows */}
                    <div className="space-y-2">
                        {pageGroups.map((pg, idx) => {
                            const assigned     = pageAssignments[idx] ?? [];
                            const hasAssignment = assigned.length > 0;
                            return (
                                <div key={idx}
                                    data-surface={hasAssignment ? 'card' : undefined} className={`rounded-2xl border transition-all ${hasAssignment ? '' : 'bg-warning/10 border-warning/30'}`}>
                                    {/* Page info row */}
                                    <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                                        <div className={`shrink-0 flex flex-col items-center justify-center px-2 py-1.5 rounded-xl min-w-[44px] transition-all ${
                                            hasAssignment
                                                ? 'bg-chart-3-solid text-white shadow-[var(--shadow-glow-chart-3)]'
                                                : 'bg-warning-solid text-white'
                                        }`}>
                                            <span className="text-micro font-bold opacity-75 uppercase leading-none tracking-wide">Pág.</span>
                                            <span className="text-subtitle font-black tabular-nums leading-tight">{idx + 1}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-micro font-semibold text-content-2 uppercase tracking-wide leading-none mb-0.5">Primer producto</p>
                                            <p className="text-label font-semibold text-content-2 truncate leading-tight">{pg.firstItem}</p>
                                            <p className="text-micro text-content-3 truncate mt-0.5">{pg.firstLab} · {pg.itemCount} prod.</p>
                                        </div>
                                    </div>
                                    {/* Box selector */}
                                    <div className="flex gap-1.5 px-3 pb-3 flex-wrap">
                                        {boxes.map(box => {
                                            const sel = assigned.includes(box);
                                            return (
                                                <FilterBar.Chip key={box} tone="brand" active={sel}
                                                    onToggle={() => toggleBox(idx, box)}>
                                                    Caja {box}
                                                </FilterBar.Chip>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Screen 3 — qué sale de verdad ──────────── */}
            {screen === 3 && (
                <div className="px-4 py-3 max-h-[56vh] overflow-y-auto scrollbar-hide space-y-3">

                    {/* Estado de la verificación contra el sistema */}
                    {simuError ? (
                        <Notice variant="warning" icon={TriangleAlert}>
                            No se pudo revisar la existencia: {simuError}. Puedes confirmar igual y ajustar a mano.
                        </Notice>
                    ) : !simu || simu.estado === 'en_curso' ? (
                        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-chart-3/10 border border-chart-3/20">
                            <Loader2 size={16} className="animate-spin text-chart-3-text shrink-0" />
                            <p className="text-label text-content-2">
                                Revisando la existencia de {despachables.length} productos…
                            </p>
                        </div>
                    ) : (simu.hallazgos ?? []).length > 0 ? (
                        <Notice variant="warning" icon={TriangleAlert}>
                            {(simu.hallazgos ?? []).length} producto{(simu.hallazgos ?? []).length !== 1 ? 's' : ''} con
                            problema de existencia. Se marcaron en cero — revísalos y corrige si sí van en la caja.
                        </Notice>
                    ) : (
                        <Notice variant="success" icon={PackageCheck}>
                            Los {despachables.length} productos tienen existencia. Sale todo como se asignó.
                        </Notice>
                    )}

                    {/* Los renglones ajustados */}
                    {Object.keys(ajustes).length > 0 && (
                        <div className="space-y-2">
                            {Object.entries(ajustes).map(([id, a]) => {
                                const it = despachables.find(r => String(r.id) === String(id));
                                if (!it) return null;
                                const asignado = Number(it.cantidad_asignada ?? 0);
                                const cant     = a.cantidad === '' ? '' : Number(a.cantidad);
                                const enCero   = cant === 0;
                                return (
                                    <div key={id} data-surface="card"
                                        className={`rounded-2xl border px-3 py-2.5 ${enCero ? 'bg-danger/10 border-danger/30' : ''}`}>
                                        <div className="flex items-start gap-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-label font-semibold text-content-2 leading-tight truncate">
                                                    {it.products?.nombre ?? '—'}
                                                </p>
                                                {a.motivo && (
                                                    <p className="text-micro text-content-3 mt-0.5 leading-snug">{a.motivo}</p>
                                                )}
                                            </div>
                                            {/* Cerrar = el producto vuelve a salir como se
                                                asignó. Era una flecha circular, que se leía
                                                como «actualizar». */}
                                            <Button variant="ghost" size="xs" icon={X} iconOnly
                                                aria-label="Quitar la corrección: sale como se asignó"
                                                title="Quitar la corrección"
                                                onClick={() => quitarAjuste(id)} />
                                        </div>
                                        <div className="flex items-center gap-2 mt-2">
                                            <Badge variant="neutral" size="sm" uppercase={false}>
                                                asignado {asignado}
                                            </Badge>
                                            <span className="text-content-3 text-label">→</span>
                                            <div className="w-24">
                                                <PortalInput
                                                    aria-label={`Cantidad que sale de ${it.products?.nombre ?? 'el producto'}`}
                                                    type="number"
                                                    min={0}
                                                    value={String(a.cantidad ?? '')}
                                                    onChange={e => setCantidad(id, e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                                                    inputClassName="text-body font-bold text-content text-center"
                                                />
                                            </div>
                                            <span className="text-label text-content-3">sale</span>
                                            {enCero ? (
                                                <Badge variant="danger" size="sm" uppercase={false} className="ml-auto">no sale</Badge>
                                            ) : (
                                                // Un toque para «no salió nada» en vez de borrar y
                                                // escribir un cero.
                                                <Button variant="ghost" size="xs" icon={Ban} className="ml-auto text-danger-text"
                                                    onClick={() => setCantidad(id, 0)}>
                                                    No sale
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Corregir cualquier otro producto */}
                    <div>
                        <PortalInput
                            aria-label="Buscar un producto para corregir la cantidad que sale"
                            icon={Search}
                            value={busqueda}
                            onChange={e => setBusqueda(e.target.value)}
                            placeholder="¿Salió distinto algún otro? Búscalo aquí"
                        />
                        {resultados.length > 0 && (
                            <div className="mt-2 space-y-1">
                                {resultados.slice(0, 6).map(r => (
                                    <div key={r.id} className="flex items-center gap-1 pl-3 pr-1 py-1 rounded-xl bg-surface-card-hover border border-divider hover:border-chart-1/40 transition-colors">
                                        <button type="button"
                                            onClick={() => { setCantidad(r.id, Number(r.cantidad_asignada ?? 0), ''); setBusqueda(''); }}
                                            className="flex-1 min-w-0 text-left py-1">
                                            <span className="text-label font-medium text-content-2 truncate block">
                                                {r.products?.nombre ?? '—'}
                                            </span>
                                            <span className="text-micro text-content-3">
                                                asignado {r.cantidad_asignada}
                                            </span>
                                        </button>
                                        <Button variant="ghost" size="xs" icon={Ban} className="text-danger-text"
                                            onClick={() => { setCantidad(r.id, 0, ''); setBusqueda(''); }}>
                                            No sale
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {termino.length >= 2 && resultados.length === 0 && (
                            <p className="mt-2 flex items-start gap-2 px-1 text-caption text-content-3" role="status">
                                <SearchX size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
                                <span>
                                    {yaCorregido ? <>Ya lo estás corrigiendo arriba: <strong className="text-content-2">{yaCorregido.products?.nombre}</strong>.</>
                                        : sinAsignar ? <><strong className="text-content-2">{sinAsignar.products?.nombre}</strong> va en el pedido, pero no se le asignó nada: no hay de dónde sacarlo.</>
                                        : catalogo.cargando || catalogo.termino !== termino ? 'Buscando en el catálogo…'
                                        : catalogo.fallo ? <>Ningún producto de este pedido coincide con «{termino}».</>
                                        : catalogo.nombre ? <><strong className="text-content-2">{catalogo.nombre}</strong> no va en este pedido.</>
                                        : <>No existe ningún producto con «{termino}». Revisa cómo lo escribiste.</>}
                                </span>
                            </p>
                        )}
                    </div>

                    {/* Resumen */}
                    <div className="flex items-center gap-2 flex-wrap px-1">
                        <span className="text-caption text-content-3">
                            {despachables.length - ajustesLista.length} salen como se asignaron
                        </span>
                        {ajustesLista.length > 0 && (
                            <Badge variant="warning" size="sm" uppercase={false}>{ajustesLista.length} ajustados</Badge>
                        )}
                        {noEnviados > 0 && (
                            <Badge variant="danger" size="sm" uppercase={false}>{noEnviados} no salen</Badge>
                        )}
                    </div>
                </div>
            )}

            {/* ── Footer ─────────────────────────────────── */}
            <div className="px-5 pb-5 pt-3 flex items-center justify-between gap-2 border-t border-border-card">
                <Button variant="secondary" disabled={submitting} onClick={handleClose}>Cancelar</Button>
                {screen === 1 ? (
                    <Button tone="chart-3" disabled={loadingPages || !totalCajasInput || parsedCajas < 1 || totalPages === 0} onClick={handleGoScreen2}>{loadingPages
                            ? <Loader2 size={12} className="animate-spin" />
                            : <>Siguiente <span className="opacity-60">→</span></>
                        }</Button>
                ) : screen === 2 ? (
                    <Button tone="chart-3" disabled={!isValid} onClick={() => setScreen(3)}>
                        Siguiente <span className="opacity-60">→</span>
                    </Button>
                ) : (
                    <Button tone="chart-3" disabled={submitting || !isValid || verificando} onClick={handleConfirm}>{submitting || verificando
                            ? <Loader2 size={12} className="animate-spin" />
                            : <PackageCheck size={13} />
                        }
                        {verificando ? 'Revisando existencias…' : 'Confirmar y Finalizar'}</Button>
                )}
            </div>
        </PedidoModal>
    );
}
