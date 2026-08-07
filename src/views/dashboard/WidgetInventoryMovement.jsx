import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    AlertTriangle, ArrowLeft, CalendarX2, Camera, CheckCircle2, ChevronRight, Loader2,
    PackageMinus, PackagePlus, Plus, Stethoscope, Trash2, X,
} from 'lucide-react';
import ListRow from '../../components/common/ListRow';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import SegmentedControl from '../../components/common/SegmentedControl';
import { supabase } from '../../supabaseClient';
import LanzadorSolicitud, { PieModal } from './LanzadorSolicitud';
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

// ── El motivo, para las operaciones donde «descargar» no dice nada ──────────
// «Descargar por descarte» y «Descargar por consumo interno» son cajones: lo
// que hay que poder contar después es POR QUÉ. Escrito a mano en el campo libre
// cada quien lo dice distinto ("cruce", "x cruce", "mal conteo") y no se puede
// agrupar; con una lista, sí — y el campo libre queda para el detalle, que es
// lo que de verdad hace falta leer una por una.
//
// «Otro» está a propósito: sin él la gente elige cualquiera con tal de seguir,
// y eso ensucia la lista entera. Al elegirlo, el detalle pasa a ser obligatorio.
//
// Vencimiento, daño y carga no llevan motivo: el motivo ES la operación.
const MOTIVOS = {
    'DESCARTE': [
        { value: 'CRUCE',       label: 'Cruce de producto' },
        { value: 'DESCUADRE',   label: 'Descuadre de inventario' },
        { value: 'MAL_ESTADO',  label: 'Llegó en mal estado' },
        { value: 'DEVOLUCION',  label: 'Devolución al proveedor' },
        { value: 'RETIRO',      label: 'Retiro sanitario' },
        { value: 'OTRO',        label: 'Otro' },
    ],
    'CONSUMO INTERNO': [
        { value: 'ENFERMERIA',  label: 'Enfermería — inyecciones' },
        { value: 'CURACIONES',  label: 'Curaciones' },
        { value: 'INSUMO',      label: 'Insumo de la sala' },
        { value: 'MUESTRA',     label: 'Muestra o demostración' },
        { value: 'PERSONAL',    label: 'Uso del personal' },
        { value: 'OTRO',        label: 'Otro' },
    ],
};

// La foto sólo se pide donde se puede ver algo: un producto roto se muestra.
// Un descuadre no se fotografía, y pedirla ahí sería un trámite vacío.
const OPS_CON_FOTO = ['PRODUCTO DAÑADO'];
const BUCKET_EVIDENCIA = 'inventario-evidencia';
const MAX_FOTOS = 3;

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
    const [motivo, setMotivo]     = useState('');
    const [fotos, setFotos]       = useState([]);   // File[] sin subir todavía
    const [subiendo, setSubiendo] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [error, setError]       = useState('');
    const [listo, setListo]       = useState(false);
    // «Agregar» o «En la solicitud». El banco necesitaba ser un lugar, no una
    // franja apretada entre el buscador y los resultados.
    const [pestana, setPestana]   = useState('agregar');

    const op = OPERACIONES.find(o => o.key === opKey) ?? null;
    const esCarga = op?.movimiento === 'CARGA';
    const porVencimiento = opKey === 'VENCIMIENTO';
    const motivos = MOTIVOS[opKey] ?? null;
    const pideFoto = OPS_CON_FOTO.includes(opKey);

    const volver = useCallback(() => {
        setOpKey(null); setLineas([]); setCausa(''); setBusqueda(''); setError('');
        setMotivo(''); setFotos([]); setPestana('agregar');
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
    // El motivo es obligatorio donde existe; la foto, donde se pide. Y el texto
    // libre pasa a ser obligatorio sólo cuando el motivo es «Otro» —ahí la lista
    // no dijo nada— o cuando no hay lista: en el resto, el motivo ya explica y
    // exigir además un párrafo es lo que hace que la gente escriba "x".
    const detalleObligatorio = !motivos || motivo === 'OTRO';
    const puedeEnviar = totales.lineas > 0 && incompletas.length === 0
        && (!motivos || Boolean(motivo))
        && (!detalleObligatorio || causa.trim().length > 0)
        && (!pideFoto || fotos.length > 0)
        && Boolean(erpSucursalId && erpUbicacionId);

    const enviar = async () => {
        setError('');
        if (!puedeEnviar) return;
        setEnviando(true);
        try {
            // ── La evidencia va PRIMERO ──────────────────────────────────
            // Si la subida falla, la solicitud no se crea: una descarga por
            // daño sin la foto es exactamente la que no se puede aprobar, y
            // dejarla entrar "para no perder lo escrito" la convierte en una
            // fila que alguien va a tener que rechazar a mano.
            //
            // Se guarda la URL en formato público como identificador —regla 10
            // de CLAUDE.md— aunque el bucket sea privado: la firma expira, así
            // que lo que se persiste no puede ser una URL firmada.
            let evidencia = [];
            if (fotos.length) {
                setSubiendo(true);
                const carpeta = `${branchId ?? 'sin-sala'}/${user?.id ?? 'anon'}`;
                for (const [i, f] of fotos.entries()) {
                    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
                    const path = `${carpeta}/${Date.now()}-${i}.${ext}`;
                    const { error: errUp } = await supabase.storage
                        .from(BUCKET_EVIDENCIA).upload(path, f, { contentType: f.type });
                    if (errUp) throw new Error(`No se pudo subir la foto: ${errUp.message}`);
                    const { data } = supabase.storage.from(BUCKET_EVIDENCIA).getPublicUrl(path);
                    evidencia.push(data?.publicUrl ?? null);
                }
                evidencia = evidencia.filter(Boolean);
                setSubiendo(false);
            }

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
                    // El motivo va como código Y como rótulo: el código para
                    // poder agrupar, el rótulo para que quien lea la solicitud
                    // dentro de un año no tenga que buscar qué era 'CRUCE'.
                    motivo: motivo || undefined,
                    motivo_label: motivos?.find(m => m.value === motivo)?.label,
                    evidencia_urls: evidencia.length ? evidencia : undefined,
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
                { subtipo: opKey, motivo: motivo || null, lineas: totales.lineas,
                  unidades: totales.unidades, causa: causa.trim(), fotos: evidencia.length },
            );

            // El aviso lo crea el trigger junto con la fila. Mandarlo desde acá
            // sería la llamada aparte que este módulo ya perdió una vez.
            setListo(true);
            setTimeout(() => { setListo(false); volver(); onHecho?.(); }, 2800);
        } catch (e) {
            setError(String(e?.message ?? '').includes('row-level security')
                ? 'No tienes permiso para crear solicitudes de inventario.'
                : (e?.message || 'No se pudo enviar la solicitud.'));
            setSubiendo(false);
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

            {/* ── Dos lugares, no una franja ────────────────────────────────
                Reportado: «¿cómo agrego más? si agrego uno, que se vaya a un
                banco de productos a enviar en la solicitud».

                Y era literal: lo agregado se dibujaba en una tira de 42% de
                alto metida ENTRE el buscador y los resultados, así que a la
                vez tapaba media lista de resultados y no se leía como una
                lista propia. Con dos pestañas, «Agregar» tiene toda la altura
                para buscar y «En la solicitud» toda para revisar, editar y
                quitar. El contador en la pestaña es el que dice que el banco
                existe sin tener que ir a mirarlo. */}
            <div className="shrink-0">
                <SegmentedControl
                    value={pestana}
                    onChange={setPestana}
                    options={[
                        { value: 'agregar', label: 'Agregar' },
                        { value: 'banco',   label: `En la solicitud${totales.lineas ? ` · ${totales.lineas}` : ''}` },
                    ]}
                />
            </div>

            {/* Cómo se agregan productos */}
            {pestana === 'agregar' && (
              <div className="shrink-0">
                {porVencimiento
                    ? <LiquidSelect nano clearable={false} value={plazo} onChange={setPlazo} options={PLAZOS} />
                    : (
                        <SearchInput
                            accentColor="var(--warning)"
                            value={busqueda} onChange={setBusqueda}
                            placeholder="Buscar producto para agregar…"
                        />
                    )}
              </div>
            )}

            {/* El banco: lo que ya va en la solicitud */}
            {pestana === 'banco' && (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {lineas.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-content-3 px-4 text-center py-8">
                        <op.icon size={26} strokeWidth={1.5} />
                        <p className="text-body-sm font-semibold">Todavía no agregas ningún producto</p>
                        <Button variant="secondary" size="sm" onClick={() => setPestana('agregar')}>
                            Ir a agregar
                        </Button>
                    </div>
                )}
                {lineas.length > 0 && (
                <div className="space-y-1.5">
                    {lineas.map(l => {
                        const pres = presPorProducto.get(l.erp_product_id) ?? [];
                        const lotes = lotesPorProducto.get(l.erp_product_id) ?? [];
                        const llevaLote = lotes.length > 0;
                        const pide = faltantes.find(f => f.id === l.id)?.problemas ?? [];
                        return (
                            // `data-surface="card"` y no las tres clases del
                            // color: la clase copia el tono y deja afuera la
                            // escarcha, la sombra y el lente del filo. En claro
                            // eso deja la tarjeta pegada al fondo.
                            <div key={l.id} data-surface="card" className="px-3 py-2.5">
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
                                        // `clearable={false}`: sin esto `LiquidSelect`
                                        // agrega su opción de limpiar, que se rotula
                                        // «Todos» — y un lote «Todos» no existe. La
                                        // línea mueve UN lote; el «Todos» de un filtro
                                        // no tiene sentido en un campo de dato.
                                        <LiquidSelect
                                            nano clearable={false}
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

                                    {/* ── El vencimiento sólo cuando NO se sabe ya ──
                                        Elegir un lote de la lista trae su fecha
                                        adentro —la etiqueta la muestra: «LSVF10697 ·
                                        01/11/27»— y aun así se pedía otra vez en un
                                        campo aparte, que además arrancaba con esa
                                        misma fecha ya escrita. Era pedir dos veces el
                                        mismo dato y dejar abierta la puerta a que los
                                        dos no coincidan.
                                        Queda para lote nuevo (ahí la fecha es dato
                                        nuevo) y para el perecedero sin control de
                                        lote, que no tiene de dónde sacarla. */}
                                    {esCarga && (l.loteNuevo || (!llevaLote && perecederos.has(l.erp_product_id))) && (
                                        <PortalInput
                                            type="date" value={l.vence ?? ''}
                                            onChange={e => editar(l.id, { vence: e.target.value })}
                                            className="w-36"
                                        />
                                    )}

                                    {/* El vencimiento que YA vino con el lote: se
                                        muestra, no se edita. */}
                                    {/* `text-content-2` y no `-3`: sobre el vidrio
                                        del modal el token más flojo se pierde
                                        contra lo que pasa por detrás. */}
                                    {!l.loteNuevo && l.vence && (
                                        <span className="text-micro font-semibold text-content-2 px-1">
                                            Vence {fmtFecha(l.vence)}
                                        </span>
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
              </div>
            )}

            {/* De dónde se agrega */}
            {pestana === 'agregar' && (
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
            )}

            {/* La causa y el envío */}
            {totales.lineas > 0 && (
                <div className="shrink-0 flex flex-col gap-2 pt-2 border-t border-divider">
                    {incompletas.length > 0 && (
                        <button type="button" onClick={() => setPestana('banco')}
                            className="flex items-center gap-1 text-micro text-danger-text font-semibold px-1 text-left">
                            <AlertTriangle size={12} strokeWidth={2.5} />
                            {incompletas.length} {incompletas.length === 1 ? 'línea sin completar' : 'líneas sin completar'}
                            {pestana !== 'banco' && ' — toca para verlas'}
                        </button>
                    )}

                    {/* ── El motivo ─────────────────────────────────────────
                        «Descargar por descarte» y «Descargar por consumo
                        interno» no dicen nada por sí solos: lo que hay que
                        poder contar después es por qué. Ver `MOTIVOS`. */}
                    {motivos && (
                        <LiquidSelect
                            nano clearable={false}
                            value={motivo} onChange={v => setMotivo(v ?? '')}
                            options={motivos}
                            placeholder={opKey === 'CONSUMO INTERNO' ? '¿Para qué se usó?…' : '¿Por qué se descarta?…'}
                        />
                    )}

                    <PortalTextarea
                        value={causa}
                        onChange={e => setCausa(e.target.value)}
                        rows={2}
                        placeholder={detalleObligatorio
                            ? 'Explica la razón — queda escrita en el movimiento'
                            : 'Detalle (opcional) — queda escrito en el movimiento'}
                    />

                    {/* ── La foto del daño ──────────────────────────────────
                        Quien aprueba una descarga por daño está en otra sala:
                        sin ver el producto, «producto roto» es una afirmación
                        que no puede comprobar. Sólo acá — un descuadre no se
                        fotografía, y pedirla ahí sería un trámite vacío. */}
                    {pideFoto && (
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                                {fotos.map((f, i) => (
                                    <div key={`${f.name}-${i}`} className="relative w-14 h-14 rounded-xl overflow-hidden border border-border-card bg-surface-card-hover">
                                        <img src={URL.createObjectURL(f)} alt=""
                                            className="w-full h-full object-cover"
                                            onLoad={ev => URL.revokeObjectURL(ev.currentTarget.src)} />
                                        <button type="button" aria-label="Quitar foto"
                                            onClick={() => setFotos(prev => prev.filter((_, j) => j !== i))}
                                            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-surface-card-hover border border-divider flex items-center justify-center">
                                            <X size={9} strokeWidth={3} className="text-content-2" />
                                        </button>
                                    </div>
                                ))}
                                {fotos.length < MAX_FOTOS && (
                                    <label className="w-14 h-14 rounded-xl border border-dashed border-border-card bg-surface-card-hover flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:border-brand/40 transition-colors">
                                        {/* `capture="environment"`: en el teléfono abre la
                                            cámara de atrás directo, que es donde está el
                                            producto. En escritorio el atributo se ignora y
                                            queda el selector de archivos de siempre. */}
                                        <input type="file" accept="image/jpeg,image/png,image/webp"
                                            capture="environment" className="sr-only"
                                            onChange={(ev) => {
                                                const f = ev.target.files?.[0];
                                                ev.target.value = '';   // permite volver a elegir la misma
                                                if (!f) return;
                                                if (f.size > 10 * 1024 * 1024) { setError('La foto no puede pasar de 10 MB'); return; }
                                                setError('');
                                                setFotos(prev => [...prev, f].slice(0, MAX_FOTOS));
                                            }} />
                                        <Camera size={15} strokeWidth={2} className="text-content-3" />
                                        <span className="text-micro font-bold text-content-3">Foto</span>
                                    </label>
                                )}
                            </div>
                            {fotos.length === 0 && (
                                <p className="text-micro text-content-2 font-medium px-1">
                                    Agrega al menos una foto del daño — es lo que mira quien aprueba.
                                </p>
                            )}
                        </div>
                    )}

                    {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}
                </div>
            )}

            {/* El envío va al PIE canónico del modal. Adentro del cuerpo quedaba
                al final de una lista que puede tener decenas de líneas: había que
                scrollear hasta abajo para enviar lo que ya estaba armado. */}
            {totales.lineas > 0 && (
                <PieModal>
                    <Button variant="secondary" onClick={volver}>Volver</Button>
                    <Button disabled={!puedeEnviar || enviando} onClick={enviar}>
                        {enviando && <Loader2 size={14} className="animate-spin" />}
                        {/* La subida de la foto es el tramo largo y va primero:
                            decirlo evita que se lea como que se colgó. */}
                        {subiendo ? 'Subiendo la foto...'
                            : enviando ? 'Enviando...'
                            : (esCarga ? 'Enviar solicitud de carga' : 'Enviar solicitud de descarga')}
                    </Button>
                </PieModal>
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
            descripcion="Cargar o descargar producto de tu sala"
        >
            {/* El encabezado lo pone `LanzadorSolicitud` con las ranuras del
                canónico (`LiquidModal.Header`), igual que en sus hermanos. */}
            {(cerrar) => <FormularioAjuste {...props} onHecho={cerrar} />}
        </LanzadorSolicitud>
    );
}
