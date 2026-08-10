import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    AlertTriangle, ArrowLeft, CalendarX2, Camera, Check, CheckCircle2, ChevronRight, Loader2,
    PackageMinus, PackagePlus, Pencil, Plus, Stethoscope, Trash2, X,
} from 'lucide-react';
import ListRow from '../../components/common/ListRow';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import SegmentedControl from '../../components/common/SegmentedControl';
import { supabase } from '../../supabaseClient';
import LanzadorSolicitud, { PieModal, EncabezadoModal } from './LanzadorSolicitud';
import { BarraTramos, FranjaVacia } from './InstrumentoBaldosa';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import SearchInput from '../../components/common/SearchInput';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import {
    buscarConExistencia, fetchPresentaciones, fetchLotesDeProducto,
    fetchPerecederos, insertMovimientoInventario, contarPorVencer,
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

// ── ⏳ POR AHORA EL VENCIMIENTO NO DECIDE NADA ACÁ (2026-08-07) ────────────
// «Descargar por vencimiento» nació armando sola la lista de lo que vencía en la
// sala, con un plazo (ya vencidos / 30 / 60 / 90 días) para acotarla. Se quitó a
// pedido del usuario: «que no importe cuándo vence, por ahora; así que no quiero
// listado de producto, solo selector de producto».
//
// Hoy la operación es idéntica a las otras cuatro —se busca el producto, se
// arma la línea— y lo único que la distingue es el concepto con el que sale el
// movimiento. La fecha sigue viajando en la línea; lo que ya no hace es ELEGIR
// qué se ofrece.
//
// ⏳ CUÁNDO VOLVER A ESTO: cuando el portal tenga facturación. El motivo es el
// mismo que ya está escrito en `PedirTrasladoModal` para el aviso de
// vencimiento: la fecha sola no aconseja nada. «Vence en tres meses» no dice si
// es un problema sin saber cuánto rota — una caja que vence en tres meses y sale
// en dos semanas está bien; una que vence en seis y no se mueve, no. Esa cuenta
// necesita la venta, y `product_stock_params.velocity` ya la calcula para el
// MIN/MAX. Con eso, la lista propuesta vuelve a tener sentido: no «lo que vence»
// sino «lo que vence y no te va a dar tiempo de vender».
//
// Lo que se borró y habría que rehacer: el efecto que llamaba a
// `fetchLotesPorVencer` (sigue existiendo en `data/inventoryMovements.js`, con
// su `TOPE_LISTA`), el selector de plazo, y el prellenado del compositor con la
// cantidad/lote/fecha de la fila vencida. La baldosa del tablero SÍ sigue
// contando las líneas vencidas (hoy dentro de `contarPorVencer`, junto con los
// tramos de 7 y 30 días de la franja): ese número no depende de nada de esto y
// sigue siendo cierto.
const OPERACIONES = [
    {
        key: 'VENCIMIENTO', movimiento: 'DESCARTE', icon: CalendarX2,
        label: 'Descargar por vencimiento',
        desc: 'Producto vencido que se retira de la sala',
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

/**
 * Lo que le falta a una línea para poder enviarse.
 *
 * Una sola definición para los dos lugares que la necesitan: el compositor
 * —que decide si «Agregar» se habilita— y el banco, que marca lo incompleto.
 * Escrita dos veces, la diferencia se paga al revés de como se descubre: se
 * agrega una línea que el compositor da por buena y el envío la rechaza desde
 * otra pestaña, sin decir cuál.
 */
function problemasDeLinea(l, { llevaLote, esCarga, esPerecedero }) {
    const problemas = [];
    if (!(Number(l.cantidad) > 0)) problemas.push('cantidad');
    if (!esCarga && l.existencia != null && Number(l.cantidad) > Number(l.existencia))
        problemas.push('sin existencia');
    if (llevaLote && !String(l.lote).trim()) problemas.push('lote');
    if (esCarga && llevaLote && !String(l.vence).trim()) problemas.push('vence');
    if (esCarga && !llevaLote && esPerecedero && !String(l.vence).trim()) problemas.push('vence');
    return problemas;
}

/* ─── Paso 1 · qué se va a hacer ──────────────────────────────────────────── */
function SelectorOperacion({ onSelect }) {
    return (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
            <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1 shrink-0">
                Tipo de movimiento
            </p>
            <div className="flex flex-col gap-2 flex-1 overflow-y-auto -mx-1 px-1 py-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
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
// Va DENTRO del encabezado del modal (ranura `EncabezadoModal`), no debajo.
// Reportado el 2026-08-07: «no me gusta el doble encabezado que crea, hazlo uno
// solo». La puerta decía «Ajuste de Inventario / Cargar o descargar producto de
// tu sala» y esto repetía el gesto justo abajo, con su propio borde: dos
// títulos para una pantalla. Ahora reemplaza a aquél mientras hay una operación
// elegida, y al volver atrás reaparece el de la puerta.
//
// Sin `border-b` ni `pb-2` propios: el borde lo pone `LiquidModal.Header`. Y sin
// `flex-col`, porque acá los hijos son los de la fila del encabezado.
function CabeceraMovimiento({ op, branchName, onBack, lineas, unidades }) {
    const Icon = op.icon;
    return (
        <>
            <Button variant="secondary" size="xs" icon={ArrowLeft} iconOnly onClick={onBack} aria-label="Volver" />
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${op.iconBg}`}>
                <Icon size={16} strokeWidth={2} className={op.color} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-body font-black text-content truncate leading-tight">{op.label}</p>
                <p className="text-label text-content-3 mt-0.5 truncate">{branchName}</p>
            </div>
            {lineas > 0 && (
                <p className="text-body-sm font-black text-content shrink-0">
                    {lineas} · {unidades}u
                </p>
            )}
        </>
    );
}

function FormularioAjuste({ erpSucursalId, branchId, branchName, erpUbicacionId, selectorSucursal, onHecho }) {
    const { user } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const appendAuditLog = useStaffStore(s => s.appendAuditLog);

    const [opKey, setOpKey] = useState(null);      // null = paso 1
    const [busqueda, setBusqueda] = useState('');

    const [candidatos, setCandidatos] = useState([]);
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
    // Qué línea de la solicitud está abierta para editar. Una sola a la vez: el
    // punto de colapsarlas es que la solicitud entre de un vistazo, y dos
    // abiertas ya devuelven la pantalla al estado que se quería dejar atrás.
    const [editandoId, setEditandoId] = useState(null);

    // ── El compositor: buscar, completar, agregar. Y el siguiente ─────────
    // Reportado: «al agregar un producto a la solicitud, ¿por qué pone cantidad?
    // me puso 7 solo». Ese 7 era la EXISTENCIA de la sala, prellenada como si
    // fuera lo que se quiere mover. En una carga no tiene ninguna relación con
    // lo que entra, y en una descarga es el tope, no la respuesta: aceptarla sin
    // mirar descarga la sala entera. Sale, y el campo arranca vacío.
    //
    // Y el flujo pedido es el que ya se estaba usando a la fuerza: «busco el
    // producto, agrego cantidad y lote, y lo agrego, luego el siguiente». Antes
    // tocar un resultado empujaba una línea a medio llenar a la otra pestaña,
    // así que agregar tres productos eran tres viajes de ida y vuelta entre
    // «Agregar» y «En la solicitud» — y el banco pasó a ser el lugar donde se
    // llenan los datos en vez de donde se revisa lo ya armado.
    //
    // `borrador` es la línea mientras se arma; `lotesBorrador` sus lotes
    // (`null` = todavía se están pidiendo, que es distinto de «no tiene»).
    const [borrador,      setBorrador]      = useState(null);
    const [lotesBorrador, setLotesBorrador] = useState(null);
    const [ultimo,        setUltimo]        = useState('');
    const buscadorRef = useRef(null);
    // Cada apertura lleva su número: si se abre otro producto mientras los lotes
    // del anterior siguen viajando, la respuesta vieja no puede pisar al nuevo.
    const pedidoLotes = useRef(0);

    const op = OPERACIONES.find(o => o.key === opKey) ?? null;
    const esCarga = op?.movimiento === 'CARGA';
    const motivos = MOTIVOS[opKey] ?? null;
    const pideFoto = OPS_CON_FOTO.includes(opKey);

    const volver = useCallback(() => {
        setOpKey(null); setLineas([]); setCausa(''); setBusqueda(''); setError('');
        setMotivo(''); setFotos([]); setPestana('agregar');
        setBorrador(null); setLotesBorrador(null); setUltimo('');
    }, []);

    useEffect(() => { volver(); }, [erpSucursalId, volver]);

    // ── El buscador, para TODAS las operaciones ───────────────────────────
    // Hasta el 2026-08-07 «Descargar por vencimiento» no tenía buscador: armaba
    // sola la lista de lo que vencía en la sala, con un plazo para acotarla.
    // Se quitó a pedido del usuario — ver la nota de `OPERACIONES`.
    useEffect(() => {
        if (!op) return;
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
    }, [busqueda, erpSucursalId, op]);

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

    // ── Abrir una fila en el compositor ───────────────────────────────────
    // Por vencimiento la fila YA es una línea: un lote concreto, con su fecha y
    // con las unidades que vencieron. Por eso entra con todo prellenado —
    // cantidad, lote y vencimiento— y el compositor sólo pide confirmar.
    //
    // Antes se agregaba de un toque, sin pasar por acá: la cantidad propuesta se
    // daba por buena porque «no hay nada que preguntar». Corregido el 2026-08-07
    // a pedido del usuario («aquí no me deja poner la cantidad»): que el número
    // venga del inventario no significa que sea el que se quiere descargar —
    // puede que de las 3 unidades vencidas se descarten 2 y una se devuelva al
    // proveedor. El paso extra es teclear Enter, porque el foco cae en la
    // cantidad y ya trae el total escrito.
    const abrirBorrador = useCallback(async (fila) => {
        const pres = presPorProducto.get(fila.erp_product_id) ?? [];
        const unidad = pres.find(p => p.factor === 1) ?? pres[0];
        setUltimo('');
        setBorrador({
            erp_product_id: fila.erp_product_id,
            descripcion: fila.descripcion,
            tipo:   unidad?.tipo ?? 'UNIDAD',
            factor: unidad?.factor ?? 1,
            cantidad: '',
            existencia: fila.cantidad ?? null,
            lote: '',
            vence: '',
            loteNuevo: false,
        });

        const token = ++pedidoLotes.current;
        const cacheados = lotesPorProducto.get(fila.erp_product_id);
        if (cacheados) { setLotesBorrador(cacheados); return; }
        setLotesBorrador(null);
        const { lotes } = await fetchLotesDeProducto({
            erpProductId: fila.erp_product_id, erpSucursalId,
        });
        setLotesPorProducto(prev => new Map(prev).set(fila.erp_product_id, lotes));
        if (pedidoLotes.current === token) setLotesBorrador(lotes);
    }, [presPorProducto, lotesPorProducto, erpSucursalId]);

    const cerrarBorrador = useCallback(() => {
        pedidoLotes.current++;
        setBorrador(null); setLotesBorrador(null);
    }, []);

    // ── El foco cae en el buscador al llegar al paso de armar ─────────────
    // «Que el focus al entrar a alguna sección o modal sean los input, así
    // siempre está listo para escribir». `ModalShell` cubre la APERTURA del
    // modal; esto cubre los pasos de adentro, que él no ve: se llegó eligiendo
    // «Cargar producto» y lo único que sigue es teclear el nombre.
    //
    // Corre también al cerrar el compositor, que es el «y luego el siguiente».
    //
    // Antes la lista de vencidos quedaba fuera —«ahí no hay buscador, hay un
    // plazo»—, pero desde el 2026-08-07 sí lo hay: filtra la lista ya cargada.
    // Así que ahora también recibe el foco.
    useEffect(() => {
        if (!op || borrador || pestana !== 'agregar') return undefined;
        const t = setTimeout(() => buscadorRef.current?.focus(), 80);
        return () => clearTimeout(t);
    }, [op, borrador, pestana]);

    const quitar = useCallback(id => setLineas(prev => prev.filter(l => l.id !== id)), []);
    const editar = useCallback((id, patch) =>
        setLineas(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l))), []);

    const totales = useMemo(() => ({
        lineas: lineas.length,
        unidades: lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0),
    }), [lineas]);

    const faltantes = useMemo(() => lineas.map(l => ({
        id: l.id,
        problemas: problemasDeLinea(l, {
            llevaLote: (lotesPorProducto.get(l.erp_product_id) ?? []).length > 0,
            esCarga,
            esPerecedero: perecederos.has(l.erp_product_id),
        }),
    })), [lineas, lotesPorProducto, perecederos, esCarga]);

    // ── Lo que le falta al borrador, con la misma vara que al banco ───────
    // Mientras los lotes viajan no se puede juzgar: sin saber si el producto
    // lleva control de lote, «falta lote» sería una afirmación inventada. Por
    // eso el botón espera, en vez de decir que está bien o que está mal.
    const loteRepetido = Boolean(borrador) && lineas.some(l =>
        l.erp_product_id === borrador.erp_product_id
        && String(l.lote).trim() === String(borrador.lote).trim());
    const faltaBorrador = useMemo(() => {
        if (!borrador || lotesBorrador === null) return ['cargando'];
        return problemasDeLinea(borrador, {
            llevaLote: lotesBorrador.length > 0,
            esCarga,
            esPerecedero: perecederos.has(borrador.erp_product_id),
        });
    }, [borrador, lotesBorrador, esCarga, perecederos]);

    const editarBorrador = useCallback(patch => setBorrador(b => (b ? { ...b, ...patch } : b)), []);

    const confirmarBorrador = useCallback(() => {
        if (!borrador || faltaBorrador.length || loteRepetido) return;
        setLineas(prev => [...prev, { id: `l${++contador}`, ...borrador }]);
        setUltimo(borrador.descripcion);
        pedidoLotes.current++;
        setBorrador(null); setLotesBorrador(null);
        // Se limpia la búsqueda y el foco vuelve al buscador: «luego el
        // siguiente si hay» se teclea sin tocar nada más.
        setBusqueda('');
        setTimeout(() => buscadorRef.current?.focus(), 0);
    }, [borrador, faltaBorrador, loteRepetido]);

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
            <EncabezadoModal>
                <CabeceraMovimiento
                    op={op} branchName={branchName} onBack={volver}
                    lineas={totales.lineas} unidades={totales.unidades}
                />
            </EncabezadoModal>

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

            {/* Cómo se agregan productos. Con un producto en el compositor el
                buscador se retira: mientras se completa una línea no hay una
                lista debajo que mirar, y dejarlo invita a escribir encima y
                perder lo que se estaba armando. */}
            {pestana === 'agregar' && !borrador && (
              <div className="shrink-0">
                <SearchInput
                    ref={buscadorRef}
                    accentColor="var(--warning)"
                    value={busqueda} onChange={setBusqueda}
                    placeholder="Buscar producto para agregar…"
                    ariaLabel="Buscar producto para agregar"
                />
              </div>
            )}

            {/* Lo último que entró. El contador de la pestaña sube, pero un
                número que cambia no dice CUÁL entró — y en una tanda de diez
                productos parecidos eso es justo lo que hay que poder confirmar
                sin cambiar de pestaña. Se va solo al buscar el siguiente. */}
            {pestana === 'agregar' && !borrador && ultimo && !busqueda && (
                <p className="shrink-0 flex items-center gap-1.5 text-micro font-semibold text-success-text px-1">
                    <CheckCircle2 size={12} strokeWidth={2.5} className="shrink-0" />
                    <span className="truncate">{ultimo} — agregado</span>
                </p>
            )}

            {/* ── El compositor ────────────────────────────────────────────
                La línea se completa ACÁ y entra armada. Ver la nota larga en
                el estado: antes entraba a medio llenar con la existencia de la
                sala como cantidad, y se terminaba en la otra pestaña. */}
            {pestana === 'agregar' && borrador && (
              <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 py-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                <div data-surface="card" className="p-3 flex flex-col gap-3">
                    <div className="flex items-start gap-2">
                        <Button variant="secondary" size="xs" icon={ArrowLeft} iconOnly
                            onClick={cerrarBorrador} aria-label="Volver a la búsqueda" />
                        <div className="flex-1 min-w-0">
                            <p className="text-body-sm font-black text-content leading-tight">
                                {borrador.descripcion}
                            </p>
                            {borrador.existencia != null && (
                                <p className="text-micro text-content-2 font-semibold mt-0.5">
                                    {borrador.existencia} en la sala
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                        {/* `autoFocus`: el campo que sigue después de elegir el
                            producto es éste. Y `onKeyDown` con Enter, porque
                            teclear la cantidad y estirar la mano al ratón para
                            confirmarla es lo que hace lenta una tanda de diez. */}
                        <PortalInput
                            autoFocus
                            label="Cantidad" name="borrador-cantidad"
                            type="number" min="1" inputMode="numeric"
                            value={borrador.cantidad}
                            onChange={e => editarBorrador({ cantidad: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarBorrador(); } }}
                            placeholder="0"
                            className="w-24"
                        />

                        {(presPorProducto.get(borrador.erp_product_id) ?? []).length > 1 && (
                            <div className="flex-1 min-w-[8rem]">
                                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">
                                    Presentación
                                </p>
                                <LiquidSelect
                                    nano clearable={false} ariaLabel="Presentación"
                                    value={`${borrador.tipo}|${borrador.factor}`}
                                    onChange={v => {
                                        const [tipo, factor] = String(v).split('|');
                                        editarBorrador({ tipo, factor: Number(factor) });
                                    }}
                                    options={(presPorProducto.get(borrador.erp_product_id) ?? []).map(p => ({
                                        value: `${p.tipo}|${p.factor}`,
                                        label: p.factor > 1 ? `${p.tipo} (${p.factor})` : p.tipo,
                                    }))}
                                />
                            </div>
                        )}
                    </div>

                    {/* Los lotes todavía viajando. Se dice, en vez de dibujar un
                        formulario sin el campo que quizá haga falta. */}
                    {lotesBorrador === null && (
                        <p className="flex items-center gap-1.5 text-micro text-content-3 font-semibold px-1">
                            <Loader2 size={11} className="animate-spin" /> Buscando los lotes…
                        </p>
                    )}

                    {lotesBorrador !== null && lotesBorrador.length > 0 && (
                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">
                                Lote
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                                {/* `clearable={false}`: sin esto `LiquidSelect`
                                    agrega su opción de limpiar, rotulada
                                    «Todos» — y un lote «Todos» no existe. */}
                                <LiquidSelect
                                    nano clearable={false} ariaLabel="Lote"
                                    value={borrador.loteNuevo ? LOTE_NUEVO
                                        : (borrador.lote ? `${borrador.lote}|${borrador.vence ?? ''}` : '')}
                                    onChange={v => {
                                        if (v === LOTE_NUEVO) { editarBorrador({ loteNuevo: true, lote: '', vence: '' }); return; }
                                        const [lote, vence] = String(v).split('|');
                                        editarBorrador({ loteNuevo: false, lote, vence });
                                    }}
                                    options={[
                                        ...lotesBorrador.map(x => ({
                                            value: `${x.lote}|${x.vence ?? ''}`,
                                            label: `${x.lote}${x.vence ? ` · ${fmtFecha(x.vence)}` : ''}`,
                                        })),
                                        ...(esCarga ? [{ value: LOTE_NUEVO, label: '+ Lote nuevo' }] : []),
                                    ]}
                                    placeholder="Elegir lote…"
                                />

                                {esCarga && borrador.loteNuevo && (
                                    <PortalInput
                                        value={borrador.lote}
                                        onChange={e => editarBorrador({ lote: e.target.value })}
                                        aria-label="Número del lote nuevo"
                                        placeholder="N.º de lote" className="w-32"
                                    />
                                )}

                                {/* El vencimiento solo cuando NO se sabe ya: el
                                    lote elegido lo trae adentro y su etiqueta lo
                                    muestra. Pedirlo otra vez es pedir dos veces
                                    el mismo dato y dejar que los dos difieran. */}
                                {esCarga && borrador.loteNuevo && (
                                    <PortalInput
                                        type="date" value={borrador.vence ?? ''}
                                        onChange={e => editarBorrador({ vence: e.target.value })}
                                        aria-label="Vencimiento del lote nuevo"
                                        className="w-36"
                                    />
                                )}

                                {!borrador.loteNuevo && borrador.vence && (
                                    <span className="text-micro font-semibold text-content-2 px-1">
                                        Vence {fmtFecha(borrador.vence)}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Perecedero sin control de lote: la fecha no tiene de dónde
                        salir, así que se pide. El número de lote NO — ponerle uno
                        le inventa un lote que no debería existir. */}
                    {esCarga && lotesBorrador?.length === 0 && perecederos.has(borrador.erp_product_id) && (
                        <PortalInput
                            label="Vence" name="borrador-vence"
                            type="date" value={borrador.vence ?? ''}
                            onChange={e => editarBorrador({ vence: e.target.value })}
                            className="w-40"
                        />
                    )}

                    {loteRepetido && (
                        <p className="flex items-center gap-1 text-micro text-warning-text font-semibold px-1">
                            <AlertTriangle size={11} strokeWidth={2.5} />
                            Ese producto ya está en la solicitud con ese lote — cámbiale la cantidad ahí.
                        </p>
                    )}

                    {!loteRepetido && faltaBorrador.length > 0 && faltaBorrador[0] !== 'cargando' && (
                        <p className="flex items-center gap-1 text-micro text-content-3 font-semibold px-1">
                            <AlertTriangle size={11} strokeWidth={2.5} />
                            Falta {faltaBorrador.join(', ')}
                            {faltaBorrador.includes('sin existencia') && borrador.existencia != null
                                && ` · hay ${borrador.existencia}`}
                        </p>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                        <Button variant="secondary" size="sm" className="flex-1" onClick={cerrarBorrador}>
                            Cancelar
                        </Button>
                        <Button
                            size="sm" className="flex-1"
                            disabled={faltaBorrador.length > 0 || loteRepetido}
                            onClick={confirmarBorrador}
                        >
                            Agregar a la solicitud
                        </Button>
                    </div>
                </div>
              </div>
            )}

            {/* El banco: lo que ya va en la solicitud */}
            {pestana === 'banco' && (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 -mx-1 px-1 py-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {lineas.length === 0 && (
                    <EmptyState linea icon={op.icon} title="Todavía no agregas ningún producto"
                        action={<Button variant="secondary" size="sm" onClick={() => setPestana('agregar')}>Ir a agregar</Button>} />
                )}
                {lineas.length > 0 && (
                <div className="space-y-1.5">
                    {lineas.map(l => {
                        const pres = presPorProducto.get(l.erp_product_id) ?? [];
                        const lotes = lotesPorProducto.get(l.erp_product_id) ?? [];
                        const llevaLote = lotes.length > 0;
                        const pide = faltantes.find(f => f.id === l.id)?.problemas ?? [];
                        // ── La línea nace CERRADA (2026-08-07) ──────────────
                        // Pedido del usuario: «que solo aparezcan cards
                        // producto, blister, cantidad, y 2 botones». Con los
                        // campos siempre desplegados, una sola línea ocupaba
                        // media pantalla del modal —cantidad, presentación,
                        // lote, vencimiento, cada uno en su control— y una
                        // solicitud de tres productos no entraba de un vistazo.
                        //
                        // Cerrada muestra lo que hace falta para reconocerla;
                        // abierta, los mismos campos de siempre.
                        //
                        // Una línea INCOMPLETA se abre sola: cerrada mostraría
                        // el aviso de lo que le falta y ningún campo donde
                        // arreglarlo, que es un callejón sin salida.
                        const abierta = editandoId === l.id || pide.length > 0;
                        const presLabel = l.factor > 1 ? `${l.tipo} (${l.factor})` : l.tipo;
                        return (
                            // `data-surface="card"` y no las tres clases del
                            // color: la clase copia el tono y deja afuera la
                            // escarcha, la sombra y el lente del filo. En claro
                            // eso deja la tarjeta pegada al fondo.
                            <div key={l.id} data-surface="card" className="px-3 py-2.5">
                                <div className="flex items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-body-sm font-black text-content truncate">
                                            {l.descripcion}
                                        </p>
                                        {/* El renglón que reemplaza a los campos
                                            mientras está cerrada. Lleva el lote y
                                            el vencimiento porque son lo que
                                            distingue dos líneas del MISMO
                                            producto — sin eso, dos filas iguales
                                            no se pueden diferenciar. */}
                                        {!abierta && (
                                            <p className="text-micro font-semibold text-content-2 mt-0.5 truncate">
                                                {l.cantidad || 0} × {presLabel}
                                                {l.lote && ` · Lote ${l.lote}`}
                                                {l.vence && ` · Vence ${fmtFecha(l.vence)}`}
                                            </p>
                                        )}
                                    </div>
                                    {/* Editar y borrar, y nada más. El de editar
                                        pasa a «listo» con la línea abierta: es el
                                        mismo control, y mandar el foco a otro
                                        botón para cerrar sería un salto de más.
                                        Deshabilitado mientras falte un dato —
                                        cerrarla ahí sólo escondería el problema. */}
                                    <Button variant="ghost" size="xs" iconOnly
                                        icon={abierta ? Check : Pencil}
                                        aria-label={abierta ? 'Listo' : 'Editar la línea'}
                                        disabled={abierta && pide.length > 0}
                                        onClick={() => setEditandoId(abierta ? null : l.id)} />
                                    <Button variant="ghost" size="xs" icon={Trash2} iconOnly
                                        aria-label="Quitar producto"
                                        onClick={() => {
                                            if (editandoId === l.id) setEditandoId(null);
                                            quitar(l.id);
                                        }} />
                                </div>

                                {abierta && (
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
                                )}

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
            {pestana === 'agregar' && !borrador && (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 -mx-1 px-1 py-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {cargando && <div className="flex justify-center py-6"><SkeletonText lines={3} className="w-full max-w-md" /></div>}

                {!cargando && candidatos.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-content-3 px-4 text-center py-6">
                        <op.icon size={26} strokeWidth={1.5} />
                        <p className="text-body-sm font-semibold">
                            {busqueda.trim().length < 2
                                ? 'Busca el producto que quieres mover'
                                : `Sin coincidencias para "${busqueda}"`}
                        </p>
                    </div>
                )}

                {!cargando && candidatos.map(f => {
                    const dias = diasHasta(f.fecha_vencimiento);
                    // La fila es un PRODUCTO y el lote lo elige el compositor, así
                    // que «ya está» es un aviso y no un freno: dos lotes distintos
                    // del mismo producto son dos líneas legítimas. El freno contra
                    // el duplicado exacto lo pone el compositor, que sí sabe qué
                    // lote se eligió.
                    const yaEsta = lineas.some(l => l.erp_product_id === f.erp_product_id);
                    const bloqueada = false;
                    return (
                        <ListRow
                            key={`${f.erp_product_id}|${f.lote ?? ''}|${f.fecha_vencimiento ?? ''}`}
                            onClick={() => {
                                if (bloqueada) return;
                                abrirBorrador(f);
                            }}
                            leading={<Plus size={14} className={bloqueada ? 'text-content-3' : 'text-brand-text'} strokeWidth={2.5} />}
                            className={`border-divider bg-surface-card ${bloqueada ? 'opacity-50' : 'hover:border-brand/40'}`}
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

            {/* El aviso de lo incompleto vive FUERA del bloque de abajo: es lo
                único de acá que sirve mientras se agrega, porque lleva a la
                pestaña donde se arregla. */}
            {totales.lineas > 0 && incompletas.length > 0 && pestana !== 'banco' && (
                <button type="button" onClick={() => setPestana('banco')}
                    className="shrink-0 flex items-center gap-1 text-micro text-danger-text font-semibold px-1 text-left">
                    <AlertTriangle size={12} strokeWidth={2.5} />
                    {incompletas.length} {incompletas.length === 1 ? 'línea sin completar' : 'líneas sin completar'}
                    {' — toca para verlas'}
                </button>
            )}

            {/* ── La causa, la foto y el envío: SÓLO en «En la solicitud» ──────
                Reportado el 2026-08-07: «no tiene sentido que esté el cuadro de
                comentario y el de enviar solicitud si no estoy en la solicitud».
                Y es cierto — mientras se busca el siguiente producto, el motivo
                de la solicitud entera y el botón de mandarla no son parte de lo
                que se está haciendo: ocupan media pantalla y compiten con la
                lista de resultados, que es lo que se vino a mirar.

                La vuelta atrás no se pierde con el pie: la flecha del encabezado
                hace lo mismo y está siempre. */}
            {pestana === 'banco' && totales.lineas > 0 && (
                <div className="shrink-0 flex flex-col gap-2 pt-2 border-t border-divider">
                    {incompletas.length > 0 && (
                        <p className="flex items-center gap-1 text-micro text-danger-text font-semibold px-1">
                            <AlertTriangle size={12} strokeWidth={2.5} />
                            {incompletas.length} {incompletas.length === 1 ? 'línea sin completar' : 'líneas sin completar'}
                        </p>
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
                        // ── Se ve como lo que es: la evidencia (2026-08-07) ──
                        // Antes era un cuadradito de 56px con el rótulo «Foto» y
                        // una advertencia gris debajo. Con eso, lo único
                        // obligatorio de la pantalla parecía un accesorio — y
                        // encima las miniaturas quedaban tan chicas que no se
                        // distinguía qué se había fotografiado.
                        //
                        // Ahora dice cuántas van, la zona de agregar es del
                        // tamaño de una foto (80px) y las miniaturas se pueden
                        // reconocer. El aviso de que falta se pinta en `warning`,
                        // que es lo que es: falta algo para poder enviar.
                        <div className="flex flex-col gap-2">
                            <div className="flex items-baseline gap-2 px-1">
                                <p className="text-micro font-black text-content-2 uppercase tracking-widest">
                                    Foto del daño
                                </p>
                                <span className="text-micro text-content-3 font-semibold">
                                    {fotos.length} de {MAX_FOTOS}
                                </span>
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                                {fotos.map((f, i) => (
                                    <div key={`${f.name}-${i}`} className="relative w-20 h-20 rounded-xl overflow-hidden border border-border-card bg-surface-card-hover group/foto">
                                        <img src={URL.createObjectURL(f)} alt={`Daño ${i + 1}`}
                                            className="w-full h-full object-cover"
                                            onLoad={ev => URL.revokeObjectURL(ev.currentTarget.src)} />
                                        {/* 24px y no 16: es un objetivo táctil sobre
                                            una foto, y errarle borra la evidencia que
                                            se acaba de tomar. */}
                                        <button type="button" aria-label={`Quitar la foto ${i + 1}`}
                                            onClick={() => setFotos(prev => prev.filter((_, j) => j !== i))}
                                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-surface-card border border-divider shadow-sm flex items-center justify-center hover:bg-danger/10 transition-colors">
                                            <X size={12} strokeWidth={3} className="text-content-2" />
                                        </button>
                                    </div>
                                ))}
                                {fotos.length < MAX_FOTOS && (
                                    <label className={`w-20 h-20 rounded-xl border border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                                        fotos.length === 0
                                            ? 'border-warning/50 bg-warning/[0.06] hover:border-warning'
                                            : 'border-border-card bg-surface-card-hover hover:border-brand/40'
                                    }`}>
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
                                        <Camera size={20} strokeWidth={2}
                                            className={fotos.length === 0 ? 'text-warning-text' : 'text-content-3'} />
                                        <span className={`text-micro font-bold ${fotos.length === 0 ? 'text-warning-text' : 'text-content-3'}`}>
                                            {fotos.length === 0 ? 'Agregar' : 'Otra'}
                                        </span>
                                    </label>
                                )}
                            </div>

                            {fotos.length === 0 && (
                                <p className="text-micro text-warning-text font-semibold px-1 leading-snug">
                                    Falta la foto: es lo único que quien aprueba puede mirar para
                                    saber que el producto está dañado.
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
            {pestana === 'banco' && totales.lineas > 0 && (
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
    const [plazo, setPlazo] = useState(null);

    useEffect(() => {
        let cancelado = false;
        contarPorVencer({ erpSucursalId: props.erpSucursalId }).then(r => {
            if (!cancelado) setPlazo(r);
        });
        return () => { cancelado = true; };
    }, [props.erpSucursalId]);

    // ── La franja: lo que todavía se puede salvar ────────────────────────────
    // La baldosa avisaba de una pérdida ya consumada —lo vencido— y de nada
    // más. Lo que vence dentro de 7 y de 30 días todavía se puede trasladar o
    // rebajar, así que es el dato que permite ACTUAR; el de vencidas sólo
    // permite descargar.
    //
    // Los tres tramos se reparten sobre el total de los tres, no sobre el
    // inventario entero: la franja compara urgencias entre sí, que es la
    // pregunta («¿cuánto de esto es ya y cuánto tiene margen?»).
    const franja = useMemo(() => {
        if (!plazo) return null;
        const total = plazo.vencidas + plazo.en7 + plazo.en30;
        if (!total) return { tramos: [], detalle: null };
        return {
            tramos: [
                { frac: plazo.vencidas / total, tinta: 'alerta' },
                { frac: plazo.en7      / total, tinta: 'fuerte' },
                { frac: plazo.en30     / total, tinta: 'medio'  },
            ],
            // El orden del texto sigue al de los tramos. Lo vencido ya lo dice
            // el contador, así que acá empieza en el segundo.
            detalle: [
                plazo.en7  ? `${plazo.en7} en 7 d`  : null,
                plazo.en30 ? `${plazo.en30} en 30 d` : null,
            ].filter(Boolean).join(' · ') || null,
        };
    }, [plazo]);

    return (
        <LanzadorSolicitud
            icon={PackageMinus}
            label="Ajuste de Inventario"
            pendientes={plazo === null ? null : plazo.vencidas}
            etiquetaPendientes="línea vencida"
            etiquetaPendientesPlural="líneas vencidas"
            vacio="Sin vencidos"
            tono="danger"
            descripcion="Cargar o descargar producto de tu sala"
            instrumento={franja === null
                ? <FranjaVacia />
                : <BarraTramos tramos={franja.tramos} />}
            detalle={franja?.detalle}
        >
            {/* El encabezado lo pone `LanzadorSolicitud` con las ranuras del
                canónico (`LiquidModal.Header`), igual que en sus hermanos. */}
            {(cerrar) => <FormularioAjuste {...props} onHecho={cerrar} />}
        </LanzadorSolicitud>
    );
}
