import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    AlertTriangle, ArrowLeft, CalendarX2, CheckCircle2, ChevronRight, Loader2,
    PackageMinus, PackagePlus, Plus, Stethoscope, Trash2, X,
} from 'lucide-react';
import ListRow from '../../components/common/ListRow';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import LanzadorSolicitud from './LanzadorSolicitud';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import SearchInput from '../../components/common/SearchInput';
import { SkeletonText } from '../../components/common/StateViews';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import {
    fetchLotesPorVencer, buscarConExistencia, fetchPresentaciones, fetchLotesDeProducto,
    fetchPerecederos, insertMovimientoInventario, contarVencidos, TOPE_LISTA,
} from '../../data/inventoryMovements';

// Widget «Ajuste de Inventario».
//
// Sigue la forma del widget de Facturación: primero se elige QUÉ se va a hacer
// —una columna de tarjetas, no tres desplegables apilados— y recién después se
// arma la solicitud, con su encabezado, su vuelta atrás y su botón al pie.
//
// La solicitud no mueve nada: la crea, Supervisión la aprueba y recién ahí se
// aplica, con la existencia releída en ese momento.
//
// ── Lo que cada línea necesita, medido y no supuesto (2026-08-06) ──────────
//   · CON control de lote: la descarga ELIGE un lote existente; la carga elige
//     uno o agrega nuevo con su fecha. La identidad de un lote es número +
//     fecha: hay productos con dos lotes del mismo número y vencimientos
//     distintos, y son existencias separadas.
//   · Perecedero sin control de lote: la carga pide fecha; el lote va vacío a
//     propósito — ponerle un número le inventa un lote que no debería existir.
//   · Ninguno de los dos: ni lote ni fecha.
//
// Quién lleva control de lote NO se puede deducir de acá: `es_antibiotico`
// acertó 49 de 52 productos probados. Se ofrece el selector cuando el producto
// tiene lotes, y quien decide de verdad es el sistema de origen al aplicar.

const OPERACIONES = [
    {
        key: 'VENCIMIENTO', movimiento: 'DESCARTE', icon: CalendarX2,
        label: 'Descargar por vencimiento',
        desc: 'La lista sale sola con lo vencido de la sala',
        color: 'text-danger-text', bg: 'bg-danger/10 border-danger/30', iconBg: 'bg-danger/10',
    },
    {
        key: 'DESCARTE', movimiento: 'DESCARTE', icon: Trash2,
        label: 'Descargar por descarte',
        desc: 'Producto que se retira sin estar vencido',
        color: 'text-warning-text', bg: 'bg-warning/10 border-warning/20', iconBg: 'bg-warning/10',
    },
    {
        key: 'PRODUCTO DAÑADO', movimiento: 'DESCARTE', icon: AlertTriangle,
        label: 'Descargar por daño',
        desc: 'Producto roto, golpeado o inservible',
        color: 'text-chart-6-text', bg: 'bg-chart-6/10 border-chart-6/30', iconBg: 'bg-chart-6/10',
    },
    {
        key: 'CONSUMO INTERNO', movimiento: 'DESCARTE', icon: Stethoscope,
        label: 'Descargar por consumo interno',
        desc: 'Usado en inyecciones, curaciones o la sala',
        color: 'text-chart-3-text', bg: 'bg-chart-3/10 border-chart-3/30', iconBg: 'bg-chart-3/10',
    },
    {
        key: 'CARGA', movimiento: 'CARGA', icon: PackagePlus,
        label: 'Cargar producto',
        desc: 'Ingresar existencia que no entró por compra',
        color: 'text-success-text', bg: 'bg-success/10 border-success/30', iconBg: 'bg-success/10',
    },
];

const PLAZOS = [
    { value: '0',  label: 'Ya vencidos' },
    { value: '30', label: 'Vencen en 30 días' },
    { value: '60', label: 'Vencen en 60 días' },
    { value: '90', label: 'Vencen en 90 días' },
];

const SUPERVISOR_ROLE_ID = 13; // Supervisor/a de Ventas

/** Quién resuelve: SIEMPRE Supervisión. La jefatura se entera del resultado. */
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

function diasHasta(fecha) {
    if (!fecha) return null;
    const hoy = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return Math.round((new Date(fecha) - new Date(hoy)) / 86400000);
}

const LOTE_NUEVO = '__nuevo__';
let contador = 0;

/* ─── Paso 1 · qué se va a hacer ──────────────────────────────────────────── */
function SelectorOperacion({ onSelect }) {
    return (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
            <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1 shrink-0">
                Tipo de movimiento
            </p>
            <div className="flex flex-col gap-2 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {OPERACIONES.map(({ key, icon: Icon, label, desc, color, bg, iconBg }) => (
                    <button
                        key={key}
                        onClick={() => onSelect(key)}
                        className={`w-full flex items-center gap-3 p-3 rounded-2xl border text-left hover:translate-y-[var(--lift-hover)] transition-all ${bg}`}
                    >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
                            <Icon size={15} strokeWidth={2} className={color} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className={`text-body-sm font-black ${color}`}>{label}</p>
                            <p className="text-caption text-content-3 mt-0.5">{desc}</p>
                        </div>
                        <ChevronRight size={13} strokeWidth={2.5} className="text-content-3 shrink-0" />
                    </button>
                ))}
            </div>
        </div>
    );
}

/* ─── Encabezado del armado ───────────────────────────────────────────────── */
function CabeceraMovimiento({ op, branchName, onBack, lineas, unidades }) {
    const Icon = op.icon;
    return (
        <div className="flex flex-col gap-1 shrink-0 pb-2 border-b border-divider">
            <div className="flex items-center gap-2">
                <Button variant="secondary" size="xs" icon={ArrowLeft} iconOnly onClick={onBack} aria-label="Volver" />
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${op.iconBg}`}>
                    <Icon size={13} strokeWidth={2} className={op.color} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-black text-content truncate leading-tight">{op.label}</p>
                    <p className="text-micro text-content-3 leading-tight">{branchName}</p>
                </div>
                {lineas > 0 && (
                    <p className="text-body-sm font-black text-content shrink-0">
                        {lineas} · {unidades}u
                    </p>
                )}
            </div>
        </div>
    );
}

function FormularioAjuste({ erpSucursalId, branchId, branchName, erpUbicacionId, selectorSucursal, onHecho }) {
    const { user } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const appendAuditLog = useStaffStore(s => s.appendAuditLog);

    const [opKey, setOpKey] = useState(null);      // null = paso 1
    const [plazo, setPlazo] = useState('0');
    const [busqueda, setBusqueda] = useState('');

    const [candidatos, setCandidatos] = useState([]);
    const [hayMas,     setHayMas]     = useState(false);
    const [cargando,   setCargando]   = useState(false);

    const [lineas, setLineas] = useState([]);
    const [presPorProducto, setPresPorProducto] = useState(new Map());
    const [lotesPorProducto, setLotesPorProducto] = useState(new Map());
    const [perecederos, setPerecederos] = useState(new Set());

    const [causa, setCausa]       = useState('');
    const [enviando, setEnviando] = useState(false);
    const [error, setError]       = useState('');
    const [listo, setListo]       = useState(false);

    const op = OPERACIONES.find(o => o.key === opKey) ?? null;
    const esCarga = op?.movimiento === 'CARGA';
    const porVencimiento = opKey === 'VENCIMIENTO';

    const volver = useCallback(() => {
        setOpKey(null); setLineas([]); setCausa(''); setBusqueda(''); setError('');
    }, []);

    useEffect(() => { volver(); }, [erpSucursalId, volver]);

    // ── La lista propuesta: lo que venció en esta sala ────────────────────
    useEffect(() => {
        if (!erpSucursalId || !porVencimiento) { setCandidatos([]); setHayMas(false); return; }
        let cancelado = false;
        setCargando(true);
        fetchLotesPorVencer({ erpSucursalId, dias: Number(plazo) }).then(r => {
            if (cancelado) return;
            setCandidatos(r.filas); setHayMas(r.hayMas); setCargando(false);
        });
        return () => { cancelado = true; };
    }, [erpSucursalId, plazo, porVencimiento]);

    // ── El buscador, para todo lo demás ───────────────────────────────────
    useEffect(() => {
        if (!op || porVencimiento) return;
        const q = busqueda.trim();
        if (q.length < 2) { setCandidatos([]); return; }
        let cancelado = false;
        setCargando(true);
        const t = setTimeout(() => {
            buscarConExistencia({ erpSucursalId, texto: q }).then(r => {
                if (cancelado) return;
                // Un producto por fila: el lote se elige después, y verlo
                // repetido en el buscador confunde.
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
    }, [busqueda, erpSucursalId, porVencimiento, op]);

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

    const agregar = useCallback(async (fila) => {
        const pres = presPorProducto.get(fila.erp_product_id) ?? [];
        const unidad = pres.find(p => p.factor === 1) ?? pres[0];
        setLineas(prev => [...prev, {
            id: `l${++contador}`,
            erp_product_id: fila.erp_product_id,
            descripcion: fila.descripcion,
            tipo:   unidad?.tipo ?? 'UNIDAD',
            factor: unidad?.factor ?? 1,
            cantidad: String(fila.cantidad ?? 1),
            existencia: fila.cantidad ?? null,
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

    const quitar = useCallback(id => setLineas(prev => prev.filter(l => l.id !== id)), []);
    const editar = useCallback((id, patch) =>
        setLineas(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l))), []);

    const totales = useMemo(() => ({
        lineas: lineas.length,
        unidades: lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0),
    }), [lineas]);

    const faltantes = useMemo(() => lineas.map(l => {
        const llevaLote = (lotesPorProducto.get(l.erp_product_id) ?? []).length > 0;
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
                    movimiento: op.movimiento,
                    subtipo: esCarga ? undefined : opKey,
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
                { subtipo: opKey, lineas: totales.lineas, unidades: totales.unidades, causa: causa.trim() },
            );

            // El aviso lo crea el trigger junto con la fila. Mandarlo desde acá
            // sería la llamada aparte que este módulo ya perdió una vez.
            setListo(true);
            setTimeout(() => { setListo(false); volver(); onHecho?.(); }, 2800);
        } catch (e) {
            setError(String(e?.message ?? '').includes('row-level security')
                ? 'No tienes permiso para crear solicitudes de inventario.'
                : (e?.message || 'No se pudo enviar la solicitud.'));
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

    if (!op) return (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
            {selectorSucursal}
            <SelectorOperacion onSelect={setOpKey} />
        </div>
    );

    return (
        <div className="flex flex-col gap-3 flex-1 min-h-0 animate-in slide-in-from-right-3 duration-[var(--dur-base)]">
            <CabeceraMovimiento
                op={op} branchName={branchName} onBack={volver}
                lineas={totales.lineas} unidades={totales.unidades}
            />

            {/* Cómo se agregan productos */}
            <div className="shrink-0">
                {porVencimiento
                    ? <LiquidSelect nano value={plazo} onChange={setPlazo} options={PLAZOS} />
                    : (
                        <SearchInput
                            accentColor="var(--warning)"
                            value={busqueda} onChange={setBusqueda}
                            placeholder="Buscar producto para agregar…"
                        />
                    )}
            </div>

            {/* Lo que ya va en la solicitud */}
            {lineas.length > 0 && (
                <div className="shrink-0 max-h-[42%] overflow-y-auto space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
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
                                    <Button variant="ghost" size="xs" icon={X} iconOnly
                                        aria-label="Quitar producto" onClick={() => quitar(l.id)} />
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
                                            placeholder="N.º de lote" className="w-32"
                                        />
                                    )}

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
                        <op.icon size={26} strokeWidth={1.5} />
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
                    {incompletas.length > 0 && (
                        <span className="flex items-center gap-1 text-micro text-danger-text font-semibold px-1">
                            <AlertTriangle size={12} strokeWidth={2.5} />
                            {incompletas.length} {incompletas.length === 1 ? 'línea sin completar' : 'líneas sin completar'}
                        </span>
                    )}

                    <PortalTextarea
                        value={causa}
                        onChange={e => setCausa(e.target.value)}
                        rows={2}
                        placeholder="Por qué se mueve — queda escrito en el movimiento"
                    />

                    {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}

                    <Button disabled={!puedeEnviar || enviando} onClick={enviar}>
                        {enviando && <Loader2 size={14} className="animate-spin" />}
                        {enviando ? 'Enviando...' : (esCarga ? 'Enviar solicitud de carga' : 'Enviar solicitud de descarga')}
                    </Button>
                </div>
            )}
        </div>
    );
}


/* ─── La baldosa del tablero ──────────────────────────────────────────────── */
export default function WidgetInventoryMovement(props) {
    const [vencidos, setVencidos] = useState(null);

    useEffect(() => {
        let cancelado = false;
        contarVencidos({ erpSucursalId: props.erpSucursalId }).then(r => {
            if (!cancelado) setVencidos(r.total);
        });
        return () => { cancelado = true; };
    }, [props.erpSucursalId]);

    return (
        <LanzadorSolicitud
            icon={PackageMinus}
            label="Ajuste de Inventario"
            pendientes={vencidos}
            etiquetaPendientes="línea vencida"
            etiquetaPendientesPlural="líneas vencidas"
            vacio="Nada vencido"
            tono="danger"
        >
            {(cerrar) => (
                <div className="p-5 max-h-[80dvh] min-h-[24rem] flex flex-col">
                    <FormularioAjuste {...props} onHecho={cerrar} />
                </div>
            )}
        </LanzadorSolicitud>
    );
}
