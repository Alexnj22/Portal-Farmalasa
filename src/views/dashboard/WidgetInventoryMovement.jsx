import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, PackageMinus, PackagePlus, Plus, X } from 'lucide-react';
import ListRow from '../../components/common/ListRow';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import SearchInput from '../../components/common/SearchInput';
import { SkeletonText } from '../../components/common/StateViews';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import {
    fetchLotesPorVencer, buscarConExistencia, fetchPresentaciones, fetchLotesDeProducto,
    fetchPerecederos, insertMovimientoInventario, TOPE_LISTA,
} from '../../data/inventoryMovements';

// Widget «Ajuste de Inventario».
//
// Se piden varios productos en una sola solicitud. Para el descarte por
// vencimiento la lista se PROPONE —el portal ya sabe qué venció en cada sala,
// lote por lote— y en el resto se busca y se agrega.
//
// La solicitud no mueve nada: la crea, Supervisión la aprueba y recién ahí se
// aplica, con la existencia releída en ese momento.
//
// ── Lo que cada línea necesita, y por qué ──────────────────────────────────
// Medido contra el sistema de origen el 2026-08-06, no supuesto:
//
//   · Producto CON control de lote (regulado) — descarte: se ELIGE un lote de
//     los que existen. Carga: se elige uno o se agrega nuevo, con su fecha.
//     La identidad de un lote es número + fecha, no el número: GLIMEPIRIDA
//     tiene dos «L31800» con vencimientos distintos y son existencias aparte.
//
//   · Producto perecedero sin control de lote — la carga pide fecha; el lote
//     va VACÍO a propósito. Mandarle un número le inventa un lote que no
//     debería existir (pasó en la prueba del 2026-08-06).
//
//   · Ninguno de los dos — ni lote ni fecha.
//
// Quién lleva control de lote no se puede deducir del portal: `es_antibiotico`
// acertó 49 de 52 y la señal de "tiene lote real" 50 — glimepirida, prednisona
// y ciprofibrato son regulados sin ser antibióticos. Acá se ofrece el selector
// cuando el producto TIENE lotes reales, y quien decide de verdad es el
// sistema de origen al aplicar.

const SUBTIPOS = [
    { value: 'VENCIMIENTO',     label: 'Vencimiento' },
    { value: 'DESCARTE',        label: 'Descarte' },
    { value: 'PRODUCTO DAÑADO', label: 'Producto dañado' },
    { value: 'CONSUMO INTERNO', label: 'Consumo interno' },
];

const PLAZOS = [
    { value: '0',  label: 'Ya vencidos' },
    { value: '30', label: 'Vencen en 30 días' },
    { value: '60', label: 'Vencen en 60 días' },
    { value: '90', label: 'Vencen en 90 días' },
];

const SUPERVISOR_ROLE_ID = 13; // Supervisor/a de Ventas

/**
 * Quién resuelve: SIEMPRE Supervisión, no la jefatura de la sala. La jefatura
 * se entera del RESULTADO, y de eso se encarga un trigger.
 */
function findTargetEmployee(employees) {
    const disponible = employees.find(e => {
        if (e.status !== 'ACTIVO') return false;
        if (e.role_id !== SUPERVISOR_ROLE_ID && e.roleId !== SUPERVISOR_ROLE_ID) return false;
        const ev = e.activeEventType ?? e.active_event_type;
        return !ev || !['VACATION', 'DISABILITY'].includes(ev);
    });
    if (disponible) return disponible;
    return employees.find(e => ['ADMIN', 'SUPERADMIN'].includes(String(e.system_role ?? '').toUpperCase()));
}

const fmtFecha = (d) => {
    if (!d) return null;
    const [a, m, dd] = String(d).split('-');
    return `${dd}/${m}/${a.slice(2)}`;
};

/** Días entre hoy (El Salvador) y una fecha. Negativo = ya pasó. */
function diasHasta(fecha) {
    if (!fecha) return null;
    const hoy = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return Math.round((new Date(fecha) - new Date(hoy)) / 86400000);
}

const LOTE_NUEVO = '__nuevo__';
let contador = 0;

export default function WidgetInventoryMovement({ erpSucursalId, branchId, branchName, erpUbicacionId }) {
    const { user } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const appendAuditLog = useStaffStore(s => s.appendAuditLog);

    const [movimiento, setMovimiento] = useState('DESCARTE');
    const [subtipo,    setSubtipo]    = useState('VENCIMIENTO');
    const [plazo,      setPlazo]      = useState('0');
    const [busqueda,   setBusqueda]   = useState('');

    const [candidatos, setCandidatos] = useState([]);
    const [hayMas,     setHayMas]     = useState(false);
    const [cargando,   setCargando]   = useState(false);

    const [lineas, setLineas] = useState([]);   // lo que va en la solicitud
    const [presPorProducto, setPresPorProducto] = useState(new Map());
    const [lotesPorProducto, setLotesPorProducto] = useState(new Map());
    const [perecederos, setPerecederos] = useState(new Set());

    const [causa, setCausa]       = useState('');
    const [enviando, setEnviando] = useState(false);
    const [error, setError]       = useState('');
    const [listo, setListo]       = useState(false);

    const esCarga = movimiento === 'CARGA';
    const porVencimiento = !esCarga && subtipo === 'VENCIMIENTO';

    // ── La lista propuesta: lo que venció en esta sala ────────────────────
    useEffect(() => {
        if (!erpSucursalId || !porVencimiento) { setCandidatos([]); setHayMas(false); return; }
        let cancelado = false;
        setCargando(true);
        fetchLotesPorVencer({ erpSucursalId, dias: Number(plazo) }).then(r => {
            if (cancelado) return;
            setCandidatos(r.filas);
            setHayMas(r.hayMas);
            setCargando(false);
        });
        return () => { cancelado = true; };
    }, [erpSucursalId, plazo, porVencimiento]);

    // ── El buscador, para todo lo demás ───────────────────────────────────
    useEffect(() => {
        if (porVencimiento) return;
        const q = busqueda.trim();
        if (q.length < 2) { setCandidatos([]); return; }
        let cancelado = false;
        setCargando(true);
        const t = setTimeout(() => {
            buscarConExistencia({ erpSucursalId, texto: q }).then(r => {
                if (cancelado) return;
                // Un producto por fila, no un renglón por lote: el lote se
                // elige después, y verlo repetido en el buscador confunde.
                const vistos = new Set();
                setCandidatos((r.filas ?? []).filter(f => {
                    if (vistos.has(f.erp_product_id)) return false;
                    vistos.add(f.erp_product_id);
                    return true;
                }));
                setCargando(false);
            });
        }, 300);
        return () => { cancelado = true; clearTimeout(t); };
    }, [busqueda, erpSucursalId, porVencimiento]);

    useEffect(() => {
        const ids = candidatos.map(f => f.erp_product_id);
        if (!ids.length) return;
        let cancelado = false;
        Promise.all([fetchPresentaciones(ids), fetchPerecederos(ids)]).then(([p, per]) => {
            if (cancelado) return;
            if (!p.error)   setPresPorProducto(p.porProducto);
            if (!per.error) setPerecederos(per.perecederos);
        });
        return () => { cancelado = true; };
    }, [candidatos]);

    // Cambiar de operación o de sala invalida lo elegido.
    useEffect(() => { setLineas([]); setError(''); }, [movimiento, subtipo, erpSucursalId]);

    // ── Agregar una línea ─────────────────────────────────────────────────
    const agregar = useCallback(async (fila) => {
        const pres = presPorProducto.get(fila.erp_product_id) ?? [];
        const unidad = pres.find(p => p.factor === 1) ?? pres[0];
        const id = `l${++contador}`;

        setLineas(prev => [...prev, {
            id,
            erp_product_id: fila.erp_product_id,
            descripcion: fila.descripcion,
            tipo:   unidad?.tipo ?? 'UNIDAD',
            factor: unidad?.factor ?? 1,
            cantidad: String(fila.cantidad ?? 1),
            existencia: fila.cantidad ?? null,
            // Si vino de la lista propuesta, ya trae su lote y su fecha.
            lote:  fila.lote && fila.lote !== 'GENERICO' ? fila.lote : '',
            vence: fila.fecha_vencimiento ?? '',
            loteNuevo: false,
        }]);

        if (!lotesPorProducto.has(fila.erp_product_id)) {
            const { lotes } = await fetchLotesDeProducto({
                erpProductId: fila.erp_product_id, erpSucursalId,
            });
            setLotesPorProducto(prev => new Map(prev).set(fila.erp_product_id, lotes));
        }
    }, [presPorProducto, lotesPorProducto, erpSucursalId]);

    const quitar = useCallback((id) => setLineas(prev => prev.filter(l => l.id !== id)), []);
    const editar = useCallback((id, patch) =>
        setLineas(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l))), []);

    const totales = useMemo(() => ({
        lineas: lineas.length,
        unidades: lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0),
    }), [lineas]);

    /** Lo que a cada línea le falta. Vacío = está lista. */
    const faltantes = useMemo(() => lineas.map(l => {
        const lotes = lotesPorProducto.get(l.erp_product_id) ?? [];
        const llevaLote = lotes.length > 0;
        const problemas = [];
        if (!(Number(l.cantidad) > 0)) problemas.push('cantidad');
        if (!esCarga && l.existencia != null && Number(l.cantidad) > Number(l.existencia))
            problemas.push('sin existencia');
        if (llevaLote && !String(l.lote).trim()) problemas.push('lote');
        if (esCarga && llevaLote && !String(l.vence).trim()) problemas.push('vence');
        if (esCarga && !llevaLote && perecederos.has(l.erp_product_id) && !String(l.vence).trim())
            problemas.push('vence');
        return { id: l.id, problemas };
    }), [lineas, lotesPorProducto, perecederos, esCarga]);

    const incompletas = faltantes.filter(f => f.problemas.length > 0);
    const puedeEnviar = totales.lineas > 0 && incompletas.length === 0
        && causa.trim().length > 0 && Boolean(erpSucursalId && erpUbicacionId);

    const enviar = async () => {
        setError('');
        if (!puedeEnviar) return;
        setEnviando(true);
        try {
            const target = findTargetEmployee(employees);
            const items = lineas.map(l => ({
                erp_product_id:    l.erp_product_id,
                descripcion:       l.descripcion,
                presentacion_tipo: l.tipo,
                factor:            l.factor,
                cantidad:          Number(l.cantidad),
                lote:              String(l.lote).trim() || null,
                numero_lote:       String(l.lote).trim() || null,
                vence:             String(l.vence).trim() || null,
                existencia:        l.existencia,
            }));

            const { error: errIns } = await insertMovimientoInventario({
                employee_id: user?.id,
                approver_id: target?.id ?? null,
                type: esCarga ? 'INVENTORY_LOAD_REQUEST' : 'INVENTORY_DISCARD_REQUEST',
                status: 'PENDING',
                note: causa.trim(),
                metadata: {
                    movimiento,
                    subtipo: esCarga ? undefined : subtipo,
                    reason: causa.trim(),
                    branch_id: branchId,
                    branch_name: branchName,
                    // Los ids con los que se ubica el movimiento fuera del
                    // portal: son numeraciones distintas de las de acá.
                    erp_sucursal_id: erpSucursalId,
                    erp_ubicacion_id: erpUbicacionId,
                    items,
                    total_unidades: totales.unidades,
                    notified_employee_id: target?.id ?? null,
                    notified_employee: target?.name ?? 'Sin supervisión asignada',
                },
            });
            if (errIns) throw errIns;

            await appendAuditLog(
                esCarga ? 'INVENTARIO_CARGA_SOLICITADA' : 'INVENTARIO_DESCARTE_SOLICITADO',
                String(branchId ?? ''),
                { subtipo, lineas: totales.lineas, unidades: totales.unidades, causa: causa.trim() },
            );

            // El aviso lo crea el trigger junto con la fila. Mandarlo desde acá
            // sería la llamada aparte que este módulo ya perdió una vez.
            setListo(true);
            setLineas([]);
            setCausa('');
            setBusqueda('');
            setTimeout(() => setListo(false), 2800);
        } catch (e) {
            setError(String(e?.message ?? '').includes('row-level security')
                ? 'No tienes permiso para crear solicitudes de inventario.'
                : (e?.message || 'No se pudo enviar la solicitud.'));
        } finally {
            setEnviando(false);
        }
    };

    if (listo) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-3">
                <CheckCircle2 size={40} className="text-success" strokeWidth={1.5} />
                <div className="text-center">
                    <p className="text-body-lg font-black text-content">Solicitud enviada</p>
                    <p className="text-body-sm text-content-3 mt-1">
                        Supervisión fue notificada. El inventario se mueve al aprobarla.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 h-full min-h-0">
            {/* Qué se hace */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
                <LiquidSelect
                    nano value={movimiento} onChange={setMovimiento}
                    options={[
                        { value: 'DESCARTE', label: 'Descargar' },
                        { value: 'CARGA',    label: 'Cargar' },
                    ]}
                />
                {!esCarga && <LiquidSelect nano value={subtipo} onChange={setSubtipo} options={SUBTIPOS} />}
                {porVencimiento && <LiquidSelect nano value={plazo} onChange={setPlazo} options={PLAZOS} />}
                {!porVencimiento && (
                    <SearchInput
                        expandable accentColor="var(--warning)"
                        value={busqueda} onChange={setBusqueda}
                        placeholder="Buscar producto para agregar…"
                    />
                )}
            </div>

            {/* Lo elegido */}
            {lineas.length > 0 && (
                <div className="shrink-0 max-h-[45%] overflow-y-auto space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                    {lineas.map(l => {
                        const pres = presPorProducto.get(l.erp_product_id) ?? [];
                        const lotes = lotesPorProducto.get(l.erp_product_id) ?? [];
                        const llevaLote = lotes.length > 0;
                        const pide = faltantes.find(f => f.id === l.id)?.problemas ?? [];
                        return (
                            <div key={l.id} className="rounded-2xl border border-border-card bg-surface-card px-3 py-2.5">
                                <div className="flex items-start gap-2">
                                    <p className="flex-1 min-w-0 text-body-sm font-black text-content truncate">
                                        {l.descripcion}
                                    </p>
                                    <Button
                                        variant="ghost" nano aria-label="Quitar producto"
                                        onClick={() => quitar(l.id)}
                                    >
                                        <X size={13} strokeWidth={2.5} />
                                    </Button>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                    <PortalInput
                                        type="number" min="0" value={l.cantidad}
                                        onChange={e => editar(l.id, { cantidad: e.target.value })}
                                        className="w-20"
                                    />
                                    {pres.length > 1 && (
                                        <LiquidSelect
                                            nano value={`${l.tipo}|${l.factor}`}
                                            onChange={v => {
                                                const [tipo, factor] = String(v).split('|');
                                                editar(l.id, { tipo, factor: Number(factor) });
                                            }}
                                            options={pres.map(p => ({
                                                value: `${p.tipo}|${p.factor}`,
                                                label: p.factor > 1 ? `${p.tipo} (${p.factor})` : p.tipo,
                                            }))}
                                        />
                                    )}

                                    {/* El lote: se elige de los que hay, y en una carga
                                        además se puede agregar uno nuevo. */}
                                    {llevaLote && (
                                        <LiquidSelect
                                            nano
                                            value={l.loteNuevo ? LOTE_NUEVO : `${l.lote}|${l.vence ?? ''}`}
                                            onChange={v => {
                                                if (v === LOTE_NUEVO) { editar(l.id, { loteNuevo: true, lote: '', vence: '' }); return; }
                                                const [lote, vence] = String(v).split('|');
                                                editar(l.id, { loteNuevo: false, lote, vence });
                                            }}
                                            options={[
                                                ...lotes.map(x => ({
                                                    value: `${x.lote}|${x.vence ?? ''}`,
                                                    label: `${x.lote}${x.vence ? ` · ${fmtFecha(x.vence)}` : ''}`,
                                                })),
                                                ...(esCarga ? [{ value: LOTE_NUEVO, label: '+ Lote nuevo' }] : []),
                                            ]}
                                            placeholder="Lote…"
                                        />
                                    )}

                                    {llevaLote && esCarga && l.loteNuevo && (
                                        <PortalInput
                                            value={l.lote}
                                            onChange={e => editar(l.id, { lote: e.target.value })}
                                            placeholder="N.º de lote"
                                            className="w-32"
                                        />
                                    )}

                                    {/* La fecha: en una carga, si el producto la lleva. */}
                                    {esCarga && (llevaLote || perecederos.has(l.erp_product_id)) && (
                                        <PortalInput
                                            type="date" value={l.vence ?? ''}
                                            onChange={e => editar(l.id, { vence: e.target.value })}
                                            className="w-36"
                                        />
                                    )}
                                </div>

                                {pide.length > 0 && (
                                    <p className="flex items-center gap-1 text-micro text-danger-text font-semibold mt-1.5">
                                        <AlertTriangle size={11} strokeWidth={2.5} />
                                        Falta {pide.join(', ')}
                                        {pide.includes('sin existencia') && l.existencia != null && ` · hay ${l.existencia}`}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* De dónde se agrega */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {cargando && <div className="flex justify-center py-6"><SkeletonText lines={3} className="w-full max-w-md" /></div>}

                {!cargando && hayMas && (
                    <p className="text-micro text-warning-text font-semibold px-1">
                        Se muestran los {TOPE_LISTA} más próximos a vencer. Hay más: envía esta tanda y vuelve.
                    </p>
                )}

                {!cargando && candidatos.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-content-3 px-4 text-center py-6">
                        {esCarga ? <PackagePlus size={26} strokeWidth={1.5} /> : <PackageMinus size={26} strokeWidth={1.5} />}
                        <p className="text-body-sm font-semibold">
                            {porVencimiento
                                ? 'No hay nada por vencer en este plazo'
                                : busqueda.trim().length < 2
                                    ? 'Busca el producto que quieres mover'
                                    : `Sin coincidencias para "${busqueda}"`}
                        </p>
                    </div>
                )}

                {!cargando && candidatos.map(f => {
                    const dias = diasHasta(f.fecha_vencimiento);
                    const yaEsta = lineas.some(l =>
                        l.erp_product_id === f.erp_product_id &&
                        (!f.lote || f.lote === 'GENERICO' || l.lote === f.lote));
                    return (
                        <ListRow
                            key={`${f.erp_product_id}|${f.lote ?? ''}|${f.fecha_vencimiento ?? ''}`}
                            onClick={() => !yaEsta && agregar(f)}
                            leading={<Plus size={14} className={yaEsta ? 'text-content-3' : 'text-brand-text'} strokeWidth={2.5} />}
                            className={`border-divider bg-surface-card ${yaEsta ? 'opacity-50' : 'hover:border-brand/40'}`}
                            title={f.descripcion}
                            trailing={<span className="text-caption font-black text-content-3">{f.cantidad}</span>}
                        >
                            <span className="block text-micro text-content-3 truncate">
                                {[
                                    f.lote && f.lote !== 'GENERICO' ? `Lote ${f.lote}` : null,
                                    f.fecha_vencimiento ? `Vence ${fmtFecha(f.fecha_vencimiento)}` : null,
                                    dias !== null && dias < 0 ? `hace ${Math.abs(dias)} días` : null,
                                    yaEsta ? 'ya agregado' : null,
                                ].filter(Boolean).join(' · ')}
                            </span>
                        </ListRow>
                    );
                })}
            </div>

            {/* La causa y el envío */}
            {totales.lineas > 0 && (
                <div className="shrink-0 flex flex-col gap-2 pt-2 border-t border-divider">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-caption font-black text-content-3 uppercase tracking-widest">
                            {totales.lineas} {totales.lineas === 1 ? 'producto' : 'productos'}
                            {' · '}
                            {totales.unidades} {totales.unidades === 1 ? 'unidad' : 'unidades'}
                        </p>
                        {incompletas.length > 0 && (
                            <span className="flex items-center gap-1 text-micro text-danger-text font-semibold">
                                <AlertTriangle size={12} strokeWidth={2.5} />
                                {incompletas.length} sin completar
                            </span>
                        )}
                    </div>

                    <PortalTextarea
                        value={causa}
                        onChange={e => setCausa(e.target.value)}
                        rows={2}
                        placeholder="Por qué se mueve — queda escrito en el movimiento"
                    />

                    {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}

                    <Button variant="primary" onClick={enviar} disabled={!puedeEnviar} loading={enviando}>
                        {esCarga ? 'Enviar solicitud de carga' : 'Enviar solicitud de descarga'}
                    </Button>
                </div>
            )}
        </div>
    );
}
