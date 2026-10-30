import React, { useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import {
    PackagePlus, AlertTriangle, CheckCircle2, ScanBarcode, BookMarked,
    Search, HelpCircle, CalendarRange, ListChecks, RefreshCw, EyeOff, Layers, Truck,
    FileText, Plus, Trash2,
} from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidModal from '../../components/common/LiquidModal';
import PortalInput from '../../components/common/PortalInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import ConfirmModal from '../../components/common/ConfirmModal';
import Checkbox from '../../components/common/Checkbox';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { saveDraft, loadDraft, clearDraft } from '@nucleo/utils/draftUtils';
import AvisoParecidos from '../../components/common/AvisoParecidos';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination, { PAGE_SIZE_OPTIONS } from '../../components/common/TablePagination';
import {
    fetchDocumentosSinCargar, fetchEstadosDeCarga, fetchPistasSinCargar, resolverDocumento, fetchPropuesta, confirmarProducto, buscarProductos,
    fetchProductosPorConfirmar, barrerDocumentos, apartarRenglon, simularCarga, simularProductoNuevo, crearProductoNuevo, enviarCarga, fetchErroneos, adjuntarNotaDeCredito, adjuntarNotaEnPapel, darSalidaErroneo, comprobarSalidaErroneo, erroneoYaEnVencidos,
    fetchPedidosDeVence, pedirVencesASala, cancelarPedidoDeVence,
    fetchProveedoresParaPapel, fetchFacturasEnPapel, guardarFacturaEnPapel, descartarFacturaEnPapel,
} from '@nucleo/data/cargarCompra';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import { calcMargin, marginLabel } from '@nucleo/utils/preciosDeProducto';

// El mismo visor de Facturas de compra (lleva el PDF): sólo se baja al abrir
// la pestaña «Documento».
const VisorDte = lazy(() => import('../../components/forms/FormPurchaseDteViewer'));
const VISTAS = [
    { value: 'carga',     label: 'La carga' },
    { value: 'documento', label: 'El documento' },
];
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { usePestanaEnUrl } from '../../plataforma/usePestanaEnUrl';
import { fechaNumerica } from '@nucleo/utils/fecha';

// Vista «Cargar compra».
//
// La factura llega por correo, el portal la guarda entera, y hasta hoy alguien
// la tecleaba renglón por renglón en el otro sistema. Esta pantalla **arma la
// compra y la muestra**: producto, cantidad, costo, lote y vencimiento, con un
// rótulo por renglón que dice de dónde salió cada dato.
//
// ── NO ESCRIBE EN EL SISTEMA DE ORIGEN ────────────────────────────────────
// A propósito, y es la primera entrega completa: convierte «teclear 40
// renglones» en «revisar 40 renglones», sin ningún riesgo, y es lo que prueba
// el emparejador contra facturas reales antes de dejarlo tocar nada.
//
// ── Lo único que sí escribe ───────────────────────────────────────────────
// El diccionario. Cuando alguien confirma que el código `21AG` de GAMMA es
// nuestro producto 1046, eso queda guardado y **ese proveedor no vuelve a
// preguntar por ese producto**. Está medido que el 87% de los renglones usan un
// código que se repite, así que el trabajo baja solo con el uso.
//
// ── Por qué el parecido de nombre nunca llega «listo» ─────────────────────
// Medido: acierta 91.5% entre 0.45 y 0.75 de similitud — una de cada doce
// líneas entraría al inventario como otro producto, y un inventario mal cargado
// no avisa: se descubre contando. Sólo el código de barras y el diccionario
// llegan marcados; el parecido siempre pide un ojo.

const ORIGEN = {
    codigo_barras: { label: 'Código de barras', icon: ScanBarcode, variant: 'success' },
    aprendido:     { label: 'Ya confirmado',    icon: BookMarked,  variant: 'success' },
    parecido:      { label: 'Por parecido',     icon: Search,      variant: 'warning' },
};

const TABS = [
    { key: 'facturas',  label: 'Facturas'      },
    { key: 'confirmar', label: 'Por confirmar' },
    { key: 'erroneos',  label: 'Productos erróneos' },
];

const COLS = [
    { key: 'fecha',      label: 'Fecha',      align: 'left'   },
    { key: 'proveedor',  label: 'Proveedor',  align: 'left'   },
    { key: 'documento',  label: 'Documento',  align: 'left',   hideBelow: 'lg' },
    { key: 'renglones',  label: 'Renglones',  align: 'center', hideBelow: 'md' },
    { key: 'total',      label: 'Total',      align: 'right'  },
    { key: 'espera',     label: 'Esperando',  align: 'center' },
    { key: 'estado',     label: 'Estado',     align: 'center' },
];

// Lo que pasó con el documento en Bodega. Sin envío desde el portal, está
// pendiente; una revisión sola no lo cambia. Una compra ya cargada sale de
// esta lista cuando el portal la ve en Bodega (≤10 min).
const ESTADO_CARGA = {
    pendiente:     { label: 'Pendiente',          variant: 'neutral' },
    enviando:      { label: 'Mandándose…',        variant: 'info'    },
    verificada:    { label: 'Cargada en Bodega',  variant: 'success' },
    sin_verificar: { label: 'Por confirmar',      variant: 'warning' },
    fallida:       { label: 'No entró',           variant: 'danger'  },
};
const estadoDeCarga = (fila) => ESTADO_CARGA[fila?.estado] ?? ESTADO_CARGA.pendiente;

// El primero es el que se abre por defecto. El último mes es lo que se está
// cargando; lo de más atrás se busca a propósito, no se mira de entrada.
const PERIODOS = [
    { value: '30',  label: 'Último mes'       },
    { value: '60',  label: 'Últimos 2 meses'  },
    { value: '180', label: 'Últimos 6 meses'  },
];

/** «1 renglón» / «3 renglones» — el «(es)» de las plantillas se lee a máquina. */
const plural = (n, uno, muchos) => `${n} ${Number(n) === 1 ? uno : muchos}`;

const fmtFecha = (iso) => fechaNumerica(iso, { anio: 'corto', vacio: '—' });

/* ─── Elegir el producto a mano ────────────────────────────────────────────── */
function BuscadorProducto({ onElegir, onCancelar }) {
    const [q, setQ] = useState('');
    const [res, setRes] = useState([]);
    const [sonParecidos, setSonParecidos] = useState(false);

    useEffect(() => {
        let vivo = true;
        const t = setTimeout(async () => {
            const { filas, aproximado } = await buscarProductos(q);
            if (vivo) { setRes(filas); setSonParecidos(!!aproximado); }
        }, 250);
        return () => { vivo = false; clearTimeout(t); };
    }, [q]);

    return (
        <div className="mt-2 space-y-2">
            <PortalInput value={q} onChange={e => setQ(e.target.value)} tono="brand"
                placeholder="Buscar el producto por nombre…" aria-label="Buscar producto" />
            {sonParecidos && res.length > 0 && <AvisoParecidos texto={q} />}
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                {res.map(p => (
                    <button key={p.id} type="button" onClick={() => onElegir(p)}
                        className="text-left px-3 py-2 rounded-xl hover:bg-surface-tab-active transition-colors">
                        <span className="text-label text-content">{p.nombre}</span>
                        {p.codigo_barras && (
                            <span className="block text-micro text-content-3 font-mono">{p.codigo_barras}</span>
                        )}
                    </button>
                ))}
                {q.length >= 3 && res.length === 0 && (
                    <p className="text-micro text-content-3 px-1">Nada coincide con «{q}».</p>
                )}
            </div>
            <Button size="xs" variant="ghost" onClick={onCancelar}>Cancelar</Button>
        </div>
    );
}

/* ─── La compra armada ─────────────────────────────────────────────────────── */
// De dónde salió el tamaño que se propone (lo decide `leer-dte-json`).
const ORIGEN_FACTOR = {
    documento: 'factura',
    aprendido: 'confirmado',
    costo:     'por costo',
};

const USOS = [
    { value: 'venta',   label: 'Para vender' },
    { value: 'consumo', label: 'Para consumo' },
];

// Lo que la persona ajustó en un renglón: unidades por cada una del proveedor,
// lote y vencimiento. Arranca con lo que trae la propuesta.
const ajusteInicial = (r) => ({
    factor: String(r.factor_proveedor ?? 1),
    lote: r.lote ?? '',
    vence: r.vence ? r.vence.slice(0, 7) : '',
});

// Las unidades que entran con un factor dado, y la línea de ayuda debajo del
// campo: de dónde salió y cómo se reparte en lo que factura el proveedor.
const cargarDe = (r, factor) => {
    const n = Number(r.cantidad) * Number(factor || 1);
    return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '';
};
const cargarAyuda = (r, aj) => {
    const cant = Number(r.cantidad), f = Number(aj.factor);
    if (!(f > 0)) return 'Escribe cuántas unidades entran.';
    if (!Number.isInteger(Math.round(f * 1000) / 1000)) {
        return `No da parejo: ${cant} de la factura no se reparten en ${aj.cargar ?? cargarDe(r, f)} unidades.`;
    }
    // Lo normal no se dice: con el rótulo denso la ayuda va al lado del título
    // y se cortaba («60 DE LA I»). Cómo entra lo dice la fila de abajo.
    return null;
};

// ── Producto nuevo desde un renglón (paso 4) ──────────────────────────────
//
// Copia a un producto PARECIDO —categoría, laboratorio, proveedor, si vence,
// si es exento— y sólo pide lo que el modelo no puede saber. Por ahora revisa
// el alta sin crearla: crear de verdad se enciende después de la primera
// carga con Bodega mirando.
const nombreDelRenglon = (t) => String(t ?? '').split('|')[0].replace(/\s+/g, ' ').trim().toUpperCase();
const barrasDelRenglon = (t) => /\b(\d{12,14})\b/.exec(String(t ?? ''))?.[1] ?? '';
const ROTULO_PRECIO = ['Precio 1', 'Precio 2', 'Precio 3', 'Precio 4', 'Precio 5', 'Precio 6', 'Precio 7'];

/* El alta de un producto que la factura trae y Bodega no tiene. Pide lo
 * mismo que el formulario de productos del sistema, pero llega prellenado:
 * proveedor de la factura, y del producto parecido (si lo hay) la categoría,
 * el laboratorio, la marca, las casillas y un precio con su mismo margen.
 * La persona sólo corrige lo que no calce. */
const VACIO = { proveedor: null, categoria: null, laboratorio: null, marca: null, perecedero: null, exento: null, decimal: null };

function NuevoProducto({ renglon, factor, documentId, manualId = null, onCerrar, onCreado, onUsar }) {
    const costo = Number(renglon.costo) / (Number(factor) > 0 ? Number(factor) : 1);
    const clave = `producto-nuevo:${documentId ?? `m${manualId}`}:${renglon.codigo_proveedor ?? renglon.descripcion}`;
    const [f, setF] = useState(() => loadDraft(clave)?.f ?? {
        nombre: nombreDelRenglon(renglon.descripcion), barcode: barrasDelRenglon(renglon.descripcion), precio: '', ...VACIO,
    });
    const [modelo, setModelo]   = useState(() => loadDraft(clave)?.modelo
        ?? (renglon.producto_id ? { id: renglon.producto_id, nombre: renglon.producto } : null));
    const [eligiendo, setElig]  = useState(false);
    const [catalogos, setCat]   = useState(null);
    const [res, setRes]         = useState(null);   // la última revisión; null = cambió algo
    const [revisando, setRev]   = useState(false);
    const [creando, setCreando] = useState(false);
    const [error, setError]     = useState('');

    useEffect(() => { saveDraft(clave, { f, modelo }); }, [clave, f, modelo]);

    const datos = (campos) => ({
        documentId, manualId, modeloId: modelo?.id ?? null, costo: Math.round(costo * 1e4) / 1e4,
        nombre: campos.nombre, barcode: campos.barcode, precio: Number(campos.precio) || null,
        ...Object.fromEntries(Object.keys(VACIO).filter(k => campos[k] != null).map(k => [k, campos[k]])),
    });

    const revisar = useCallback(async (campos, conCatalogos) => {
        setRev(true); setError('');
        const { resultado, error: e } = await simularProductoNuevo({ ...datos(campos), catalogos: conCatalogos });
        setRev(false);
        if (e) { setError(e); return; }
        if (resultado.catalogos) setCat(resultado.catalogos);
        const r = resultado.revision;
        // Lo que la persona no tocó toma lo sugerido.
        setF(x => ({
            ...x,
            ...Object.fromEntries(Object.keys(VACIO).map(k => [k, x[k] ?? r.valores[k]])),
            precio: x.precio !== '' ? x.precio : (r.precio_sugerido != null ? String(r.precio_sugerido) : ''),
        }));
        setRes(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `datos` lee el estado del momento
    }, [modelo?.id, documentId, manualId, costo]);

    // Al abrir y al cambiar el parecido: pedir sugerencias de nuevo, soltando
    // lo que venía del parecido anterior.
    useEffect(() => {
        revisar(f, !catalogos);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir y al cambiar el parecido
    }, [modelo?.id]);

    const poner = (k, v) => { setF(x => ({ ...x, [k]: v })); setRes(null); };
    const elegirModelo = (prod) => {
        setElig(false);
        setF(x => ({ ...x, categoria: null, laboratorio: null, marca: null, perecedero: null, exento: null, decimal: null, precio: '' }));
        setModelo(prod);
    };
    // Lo que la base dice que YA es este producto, o se le parece: elegirlo
    // en vez de crear un duplicado.
    const usarExistente = (x) => { clearDraft(clave); onUsar({ id: x.id, nombre: x.nombre }); };
    const crear = async () => {
        setCreando(true); setError('');
        const { resultado, error: e } = await crearProductoNuevo(datos(f));
        setCreando(false);
        if (e) { setError(e); return; }
        clearDraft(clave);
        onCreado(resultado.producto, resultado.notas ?? []);
    };

    const margen = Number(f.precio) > 0 ? Math.round((1 - costo / Number(f.precio)) * 100) : null;
    const opciones = (k) => catalogos?.[k] ?? [];

    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-2xl" ariaLabel="Producto nuevo">
            <LiquidModal.Header titulo="Producto nuevo" subtitulo={renglon.descripcion} icono={PackagePlus} onClose={onCerrar} />
            <LiquidModal.Body>
                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
                <div className="mb-3">
                    <p className="text-micro text-content-3 mb-1">
                        Parecido a… <span className="text-content-3">(de él se copian categoría, laboratorio, marca y el margen)</span>
                    </p>
                    {modelo && !eligiendo ? (
                        <div className="flex items-center gap-2">
                            <Badge variant="info" size="sm">{modelo.nombre}</Badge>
                            <Button size="xs" variant="ghost" onClick={() => setElig(true)}>Cambiar</Button>
                        </div>
                    ) : eligiendo || !modelo ? (
                        <BuscadorProducto onElegir={elegirModelo} onCancelar={() => setElig(false)} />
                    ) : null}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                        <PortalInput label="Nombre" value={f.nombre} onChange={e => poner('nombre', e.target.value)} />
                    </div>
                    <PortalInput label="Código de barras" value={f.barcode} inputMode="numeric"
                        onChange={e => poner('barcode', e.target.value)} />
                    <PortalInput label="Precio de venta por unidad" inputMode="decimal" maskType="DECIMAL" prefix="$"
                        value={f.precio} onChange={e => poner('precio', e.target.value)}
                        helperText={`costo ${formatMoney(costo)}${margen != null ? ` · margen ${margen} %` : ''}${res?.precio_sugerido ? ` · sugerido ${formatMoney(res.precio_sugerido)}` : ''}`} />
                    <LiquidSelect value={f.proveedor ?? ''} onChange={v => poner('proveedor', v || '')} options={opciones('proveedores')}
                        placeholder="Proveedor" ariaLabel="Proveedor" clearable={false} isLoading={!catalogos} />
                    <LiquidSelect value={f.laboratorio ?? ''} onChange={v => poner('laboratorio', v || '')} options={opciones('laboratorios')}
                        placeholder="Laboratorio" ariaLabel="Laboratorio" clearable={false} isLoading={!catalogos} />
                    <LiquidSelect value={f.categoria ?? ''} onChange={v => poner('categoria', v || '')} options={opciones('categorias')}
                        placeholder="Categoría" ariaLabel="Categoría" clearable={false} isLoading={!catalogos} />
                    <PortalInput label="Marca" value={f.marca ?? ''} onChange={e => poner('marca', e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-4 mt-3">
                    <Checkbox size="sm" label="Vence" checked={!!f.perecedero} onChange={() => poner('perecedero', !f.perecedero)} />
                    <Checkbox size="sm" label="Exento de IVA" checked={!!f.exento} onChange={() => poner('exento', !f.exento)} />
                    <Checkbox size="sm" label="Se vende por fracción" checked={!!f.decimal} onChange={() => poner('decimal', !f.decimal)} />
                </div>

                {res && !res.listo && (
                    <div className="mt-4">
                        <Notice variant="warning" icon={AlertTriangle}>
                            <ul className="list-disc pl-5">{res.problemas.map((x, k) => <li key={k}>{x}</li>)}</ul>
                        </Notice>
                    </div>
                )}
                {[...(res?.existentes ?? []), ...(res?.parecidos ?? [])].some(x => x.activo) && (
                    <div className="mt-3 flex flex-col gap-1.5">
                        <p className="text-micro text-content-3">
                            {res.existentes?.length ? '¿Es éste?' : 'Se parece a productos que ya existen. Si es uno de ellos, úsalo:'}
                        </p>
                        {[...(res.existentes ?? []), ...(res.parecidos ?? [])].filter(x => x.activo).map(x => (
                            <div key={x.id} className="flex items-center gap-2">
                                <span className="text-label text-content flex-1 min-w-0 truncate">{x.nombre}</span>
                                <Button size="xs" variant="secondary" onClick={() => usarExistente(x)}>Usar este</Button>
                            </div>
                        ))}
                    </div>
                )}
                {res?.listo && (
                    <div className="mt-4">
                        <Notice variant="success" icon={CheckCircle2}>
                            Listo para crear <b>{res.nombre}</b>, presentación de 1 unidad a {formatMoney(res.precio)}.
                        </Notice>
                        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mt-2">
                            {res.precios.map((p, k) => <Dato key={k} titulo={ROTULO_PRECIO[k]} valor={formatMoney(p)} />)}
                        </div>
                    </div>
                )}
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center gap-2 w-full flex-wrap">
                    <p className="text-micro text-content-3 flex-1 min-w-[12rem]">
                        {res?.listo ? 'Se crea en el sistema y queda elegido en este renglón.' : 'Revisa los datos antes de crearlo.'}
                    </p>
                    <Button size="sm" variant="ghost" onClick={onCerrar}>Cerrar</Button>
                    {res?.listo ? (
                        <Button size="sm" disabled={creando} onClick={crear} icon={creando ? undefined : PackagePlus}>
                            {creando ? 'Creando…' : 'Crear producto'}
                        </Button>
                    ) : (
                        <Button size="sm" disabled={revisando || !f.nombre.trim()} onClick={() => revisar(f, !catalogos)}>
                            {revisando ? 'Revisando…' : 'Revisar'}
                        </Button>
                    )}
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

/** Qué renglones trae el documento, para no aplicar un borrador a otros. */
const huellaDe = (renglones) => (renglones ?? []).map(r => [r.codigo_proveedor, r.descripcion, r.cantidad].join('|')).join('\n');

/** La llave de un renglón: su código del proveedor, o su posición si no trae. */
const claveDe = (r, i) => r.codigo_proveedor || `#${i}`;

function Propuesta({ doc, puedeEditar, estadoCarga, pista, onCerrar, onCorregirPapel = null }) {
    const [p, setP]           = useState(null);
    const [error, setError]   = useState('');
    // Lo que la persona corrigió acá: {codigo_proveedor: {product_id, nombre}}
    const [elegidos, setEleg] = useState({});
    const [buscando, setBusc] = useState(null);
    const [guardando, setG]   = useState(null);
    // ── Para armar la carga ──
    const [uso, setUso]         = useState('venta');
    const [ajustes, setAjustes] = useState({});   // {índice: ajusteInicial}
    const [dias, setDias]       = useState('');
    const [revisando, setRev]   = useState(false);
    const [resultado, setRes]   = useState(null);
    const [creando, setCreando] = useState(null);   // índice del renglón
    const [confirmando, setConf] = useState(false);
    const [enviando, setEnv]     = useState(false);
    const [envio, setEnvio]      = useState(null);   // respuesta del envío
    const [vista, setVista]      = useState('carga');
    // Sacar el documento de la cola sin cargarlo: ya estaba cargado a mano, o
    // no es mercadería. `saliendo` = qué se está por decidir en el pie.
    const [saliendo, setSaliendo] = useState(false);
    const [resolviendo, setResolv] = useState(false);
    const [confProv, setConfProv] = useState(false);
    const sacarDeLaLista = async (motivo, receiptId = null) => {
        setResolv(true);
        const { error: e } = await resolverDocumento(doc.document_id, motivo, receiptId);
        setResolv(false);
        if (e) { setError(e === 'FORBIDDEN' ? 'No tienes permiso para sacarla de la lista.' : e); return; }
        useStaff.getState().appendAuditLog('COMPRA_SACADA_DE_LA_COLA', String(doc.document_id), {
            motivo, compra: receiptId, proveedor: doc.emisor_nombre, total: doc.monto_total,
        });
        onCerrar();
    };

    // Una factura en papel (`doc.manual_id`) va por el mismo camino que un DTE.
    const papel = !!doc.manual_id;
    const claveBorrador = `cargar-compra:${papel ? `m${doc.manual_id}` : doc.document_id}`;
    const cargar = useCallback(async () => {
        setP(null); setError(''); setRes(null);
        const { propuesta, error: e } = await fetchPropuesta(doc.document_id, doc.manual_id ?? null);
        if (e) { setError(e); return; }
        setP(propuesta);
        // Lo que la persona ya había ajustado sobre ESTE documento vuelve: la
        // sesión se cierra sola a los pocos minutos y una factura de 30
        // renglones no se vuelve a teclear.
        // Sólo si los renglones son LOS MISMOS: el borrador va por posición, y
        // una factura en papel corregida puede haber cambiado el orden.
        const guardado = loadDraft(claveBorrador);
        const b = guardado?.huella === huellaDe(propuesta.renglones) ? guardado : null;
        setAjustes(Object.fromEntries(propuesta.renglones.map((r, i) => [i, b?.ajustes?.[i] ?? ajusteInicial(r)])));
        setUso(b?.uso ?? 'venta');
        setDias(b?.dias ?? (propuesta.encabezado.dias_credito != null ? String(propuesta.encabezado.dias_credito) : ''));
    }, [doc.document_id, doc.manual_id, claveBorrador]);

    useEffect(() => {
        if (p) saveDraft(claveBorrador, { ajustes, uso, dias, huella: huellaDe(p.renglones) });
    }, [p, ajustes, uso, dias, claveBorrador]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);

    // Las salas a las que se puede enviar al cargar: las seis farmacias.
    const branches = useStaff(st => st.branches);
    const salasReparto = useMemo(() => (branches ?? []).filter(b => b.type === 'FARMACIA')
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })), [branches]);

    const ajustar = (i, campo, valor) => {
        setAjustes(a => ({ ...a, [i]: { ...a[i], [campo]: valor } }));
        setRes(null);   // lo revisado ya no es lo que se ve
    };
    // Las fechas que contestó la sala: sólo llenan los renglones VACÍOS — lo
    // que Bodega ya escribió a mano no se pisa.
    const usarFechas = useCallback((respuestas) => {
        let cambio = false;
        setAjustes(a => {
            const n = { ...a };
            for (const [i, v] of Object.entries(respuestas ?? {})) {
                if (v && !n[i]?.vence) { n[i] = { ...n[i], vence: v }; cambio = true; }
            }
            return cambio ? n : a;
        });
        if (cambio) setRes(null);
    }, []);

    // La persona escribe las UNIDADES que entran (usuario, 2026-10-29: «pon la
    // cantidad a cargar»); lo que viaja sigue siendo el factor —unidades por
    // cada una que factura el proveedor—, que es lo que elige la presentación
    // de Bodega. Se guarda lo tecleado tal cual para no pelearle a medio número.
    const ajustarCarga = (i, r, valor) => {
        const limpio = String(valor).replace(/[^\d]/g, '');
        const n = Number(limpio), cant = Number(r.cantidad);
        setAjustes(a => ({
            ...a,
            [i]: { ...a[i], cargar: limpio, ...(n > 0 && cant > 0 ? { factor: String(n / cant) } : {}) },
        }));
        setRes(null);
    };

    // Sin código del proveedor (un papel, algunos DTE) no hay qué aprender:
    // la elección vale para ESTE renglón y nada más.
    const confirmar = async (renglon, i, producto) => {
        const k = claveDe(renglon, i);
        if (renglon.codigo_proveedor) {
            setG(k);
            const { error: e } = await confirmarProducto(
                p.documento.emisor_nit, renglon.codigo_proveedor, producto.id,
                { proveedor: p.documento.emisor, producto: producto.nombre },
                ajustes[i]?.factor);
            setG(null);
            if (e) { setError(e); return; }
        }
        setEleg(x => ({ ...x, [k]: { product_id: producto.id, nombre: producto.nombre, factor: ajustes[i]?.factor } }));
        setBusc(null);
        setRes(null);
    };

    // El producto que se mandaría: lo elegido acá, o lo que llegó por código
    // de barras o por el diccionario. Un parecido NUNCA viaja sin confirmar,
    // por alto que sea: acierta 91.5 % y un inventario mal cargado no avisa.
    // La revisión lo devuelve como «sin producto elegido», que es lo que es.
    const productoDe = (r, i) => elegidos[claveDe(r, i)]?.product_id
        ?? (['codigo_barras', 'aprendido'].includes(r.match_origen) ? r.producto_id : null);

    const decisiones = () => Object.fromEntries(p.renglones.map((r, i) => [i, {
        product_id: productoDe(r, i),
        factor: Number(ajustes[i]?.factor) || 1,
        lote: ajustes[i]?.lote || null,
        vence: ajustes[i]?.vence || null,
        erroneo: ajustes[i]?.erroneo === true,
        reparto: aRepartir(ajustes[i]?.reparto),
    }]));

    // Lo que se revisa y lo que se manda es esta MISMA firma.
    const firmaActual = () => JSON.stringify({ uso, renglones: decisiones(), diasCredito: dias === '' ? null : Number(dias) });

    // Manda EXACTAMENTE lo revisado: la función lo vuelve a armar y se niega si
    // algo cambió, así que acá se le pasan las mismas decisiones.
    const enviar = async () => {
        setEnv(true); setError('');
        const rev = JSON.parse(resultado.firma);
        const { resultado: r, error: e } = await enviarCarga({
            documentId: doc.document_id ?? null, manualId: doc.manual_id ?? null, cargaId: resultado.carga_id, ...rev,
        });
        setEnv(false); setConf(false);
        setEnvio({ ...(r ?? {}), error: e });
        setRes(null);
    };

    const revisar = async () => {
        setRev(true); setError(''); setRes(null); setEnvio(null);
        const firma = firmaActual();
        const { resultado: res, error: e } = await simularCarga({
            documentId: doc.document_id ?? null, manualId: doc.manual_id ?? null, ...JSON.parse(firma),
        });
        setRev(false);
        if (e) { setError(e); return; }
        // La firma viaja con el resultado: si mientras se revisaba la persona
        // cambió algo, la revisión que llega ya no es la de la pantalla.
        setRes({ ...res, firma });
    };

    // El aviso se cuenta ACÁ, con lo que la persona ya resolvió en pantalla
    // (lo confirmado y el lote/vencimiento tecleados). El `resumen` del
    // servidor es la foto de cuando se abrió: con él, dos renglones recién
    // confirmados seguían saliendo «por confirmar» junto a su sello verde.
    const estado = (p?.renglones ?? []).map((r, i) => {
        const confirmado = !!elegidos[claveDe(r, i)];
        return {
            sin_producto: !r.producto_id && !confirmado,
            a_confirmar: !!r.producto_id && !r.seguro && !confirmado,
            sin_lote: !ajustes[i]?.lote,
            sin_vencimiento: !ajustes[i]?.vence,
        };
    });
    const contar = (k) => estado.filter(e => e[k]).length;
    const resumen = p && {
        renglones: p.renglones.length,
        sin_producto: contar('sin_producto'), a_confirmar: contar('a_confirmar'),
        sin_lote: contar('sin_lote'), sin_vencimiento: contar('sin_vencimiento'),
    };
    const faltan = estado.filter(e => e.sin_producto || e.a_confirmar || e.sin_lote || e.sin_vencimiento).length;
    const revision = resultado?.revision;
    const revisionVigente = !!(p && resultado?.firma && resultado.firma === firmaActual());
    // Ya se mandó (o no se sabe): no se revisa ni se manda de nuevo desde acá.
    const yaMandada = envio?.enviada === true || envio?.enviada === null
        || ['enviando', 'sin_verificar', 'verificada'].includes(estadoCarga?.estado);
    const pendientesDeVence = (revision?.renglones ?? []).filter(x => x.vence_pendiente).length;
    const entraComo = useMemo(() => new Map((revision?.renglones ?? []).map(x => [x.renglon, x])), [revision]);
    // El costo que trae ESTA factura contra el que tiene Bodega, y el margen
    // con el precio de venta actual (la misma regla del catálogo). Sale de la
    // revisión: `linea.compra` ya lleva el descuento y el reparto de regalos.
    const costos = useMemo(() => {
        const m = new Map();
        for (const x of revision?.renglones ?? []) {
            if (!x.linea || x.linea.bandera !== 'PRODUCTO') continue;
            const nuevo = Number(x.linea.compra), antes = x.costo_anterior, venta = Number(x.linea.venta);
            const cambio = antes ? (nuevo - antes) / antes * 100 : null;
            const margen = calcMargin(venta, nuevo);
            m.set(x.renglon, { nuevo, antes, venta, cambio, margen, alerta: marginLabel(margen) });
        }
        return m;
    }, [revision]);
    const subenDeCosto = [...costos.values()].filter(c => c.cambio != null && c.cambio >= 0.5).length;
    const bajanDeCosto = [...costos.values()].filter(c => c.cambio != null && c.cambio <= -0.5).length;
    const conMargenMalo = [...costos.values()].filter(c => c.alerta).length;

    return (
        <LiquidModal open onClose={() => !enviando && onCerrar()} maxWidth="max-w-5xl"
            ariaLabel={`Compra propuesta de ${doc.emisor_nombre}`}>
            <LiquidModal.Header icono={PackagePlus} tono="brand" titulo={doc.emisor_nombre} onClose={() => !enviando && onCerrar()}
                subtitulo={<>
                    {fmtFecha(doc.fecha_emision)} · {formatMoney(doc.monto_total)}
                    {resumen && ` · ${resumen.renglones} renglones`}
                    {(() => {
                        // Lo que acaba de pasar en este modal manda sobre lo que trajo la lista.
                        const e = envio?.enviada === true ? (envio.verificada ? ESTADO_CARGA.verificada : ESTADO_CARGA.sin_verificar)
                            : envio?.enviada === null ? ESTADO_CARGA.sin_verificar
                            : estadoDeCarga(estadoCarga);
                        return <Badge variant={e.variant} size="sm" className="ml-2 align-middle">{e.label}</Badge>;
                    })()}
                </>} />

            <LiquidModal.Body>
                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
                {pista?.compra && !envio?.enviada && !estadoCarga && (
                    <Notice variant="warning" icon={HelpCircle}>
                        <div className="flex items-center gap-3 flex-wrap">
                            <span className="flex-1 min-w-[16rem]">
                                <b>Parece que ya se cargó a mano</b> en {pista.compra.sucursal ?? 'otra sucursal'}:
                                compra del {fmtFecha(pista.compra.fecha)} por {formatMoney(pista.compra.total)},
                                número <span className="font-mono">{pista.compra.numero}</span>. Mismo proveedor y
                                mismo total, otro número. Si es la misma, no la cargues de nuevo.
                            </span>
                            {puedeEditar && (
                                <Button size="sm" loading={resolviendo}
                                    onClick={() => sacarDeLaLista('cargada_a_mano', pista.compra.id)}>
                                    Sí, es esa
                                </Button>
                            )}
                        </div>
                    </Notice>
                )}
                {!pista?.compra && pista?.gasto && !envio?.enviada && !estadoCarga && (
                    <Notice variant="info" icon={HelpCircle}>
                        El proveedor está clasificado como <b>{pista.gasto}</b>: parece un gasto y no
                        mercadería. Si no va a Bodega, sácala con «No va a Bodega».
                    </Notice>
                )}
                {!p && !error && <p className="text-label text-content-3">Leyendo el documento y su archivo…</p>}

                {p && (<>
                    {/* El encabezado: lo que iría en la parte de arriba del
                        formulario del otro sistema. */}
                    <div data-surface="card" className="p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Dato titulo="Proveedor"        valor={p.encabezado.proveedor} />
                        <Dato titulo="Número"           valor={p.documento.codigo_generacion} mono />
                        <Dato titulo="Fecha de la factura" valor={fmtFecha(p.documento.fecha)} nota="con ésta entra a Bodega" />
                        <Dato titulo="Sello de Hacienda" valor={p.documento.sello ? 'Sí' : 'No lo trae'} />
                    </div>

                    {/* Una sola barra: qué se mira a la izquierda; cómo se carga a
                        la derecha (sólo tiene sentido mirando la carga). */}
                    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
                        {papel ? <span /> : <SegmentedControl size="sm" label="Ver" value={vista} onChange={setVista} options={VISTAS} />}
                        {vista === 'carga' && (
                            <div className="flex flex-wrap items-end gap-3">
                                <SegmentedControl size="sm" label="La compra es" value={uso}
                                    onChange={(v) => { setUso(v); setRes(null); }} options={USOS} />
                                <div className="w-28">
                                    <PortalInput compact label="Días de crédito" type="number" min="0" value={dias}
                                        placeholder={p.encabezado.dias_credito != null ? String(p.encabezado.dias_credito) : '—'}
                                        onChange={e => { setDias(e.target.value); setRes(null); }} />
                                </div>
                            </div>
                        )}
                    </div>

                    {vista === 'documento' && !papel ? (
                        <div data-surface="card" className="h-[70vh] flex flex-col overflow-hidden">
                            <Suspense fallback={<p className="p-4 text-label text-content-3">Abriendo el documento…</p>}>
                                <VisorDte formData={{ document: {
                                    id: p.documento.id, json_path: p.documento.json_path, pdf_path: p.documento.pdf_path,
                                    fecha_emision: p.documento.fecha, codigo_generacion: p.documento.codigo_generacion,
                                    emisor_nombre: p.documento.emisor, tipo_dte: p.documento.tipo_dte,
                                } }} />
                            </Suspense>
                        </div>
                    ) : (<>
                    {/* Para qué es la compra. Consumo se registra igual en el
                        libro, pero como gasto y sin sumar existencias. */}
                    {uso === 'consumo' && (
                        <Notice variant="info" icon={HelpCircle}>
                            Se registra en el libro de compras como <b>gasto</b>: no suma existencias y cada renglón
                            entra con su descripción. Lo de consumo no se reparte a las salas.
                        </Notice>
                    )}

                    {envio && (envio.enviada === true ? (
                        <Notice variant={envio.verificada ? 'success' : 'warning'} icon={envio.verificada ? CheckCircle2 : AlertTriangle}>
                            <b>Cargada en Bodega{envio.erp_compra_id ? ` (compra ${envio.erp_compra_id})` : ''}.</b>{' '}
                            {envio.verificada
                                ? 'Se leyó de vuelta y cuadra renglón por renglón.'
                                : <>Entró, pero al leerla de vuelta algo no cuadró: {(envio.notas ?? []).join(' ')}</>}
                            {envio.reparto && (envio.reparto.enviando
                                ? <> Se está enviando a {envio.reparto.salas === 1 ? '1 sala' : `${envio.reparto.salas} salas`}: lo reciben en Traslados → En camino.</>
                                : <> <b>No se envió a las salas</b> porque la carga no se pudo comprobar: hay que enviarlo a mano.</>)}
                            {envio.vencidos && (envio.vencidos.en_curso
                                ? <> Lo marcado como error se está pasando a Bodega de vencidos: se ve en la pestaña «Por error».</>
                                : <> <b>Lo marcado como error NO se pasó a vencidos</b> porque la carga no se pudo comprobar: hay que pasarlo a mano.</>)}
                        </Notice>
                    ) : envio.enviada === false ? (
                        <Notice variant="danger" icon={AlertTriangle}>
                            <b>No entró.</b> {envio.error}
                        </Notice>
                    ) : (
                        <Notice variant="danger" icon={AlertTriangle}>
                            <b>No se sabe si entró.</b> {envio.error} No la mandes de nuevo: avisa a Bodega para que la busque.
                        </Notice>
                    ))}

                    {revision && (revision.listo ? (
                        <Notice variant="success" icon={CheckCircle2}>
                            <b>Lista para cargar.</b> {revision.renglones.length} renglones · total{' '}
                            {formatMoney(revision.total_armado)}, igual al del documento.
                            {pendientesDeVence > 0 && (
                                <span className="block mt-1">
                                    {pendientesDeVence === 1 ? 'Un renglón va' : `${pendientesDeVence} renglones van`} sin
                                    vencimiento: la sala que lo reciba la va a tener que poner.
                                </span>
                            )}
                            {(subenDeCosto > 0 || bajanDeCosto > 0 || conMargenMalo > 0) && (
                                <span className="block mt-1">
                                    {[
                                        subenDeCosto > 0 && `${subenDeCosto} ${subenDeCosto === 1 ? 'sube' : 'suben'} de costo`,
                                        bajanDeCosto > 0 && `${bajanDeCosto} ${bajanDeCosto === 1 ? 'baja' : 'bajan'} de costo`,
                                        conMargenMalo > 0 && `${conMargenMalo} con margen bajo o en pérdida: revisa el precio de venta`,
                                    ].filter(Boolean).join(' · ')}.
                                </span>
                            )}
                            {revision.regalos > 0 && (
                                <span className="block mt-1">
                                    Trae {revision.regalos === 1 ? 'un producto' : `${revision.regalos} productos`} de
                                    regalo: su costo se reparte entre todas las unidades, como lo carga Bodega.
                                </span>
                            )}
                            <span className="block text-micro mt-1">Todavía no se manda: esto fue una revisión.</span>
                        </Notice>
                    ) : (
                        <Notice variant="warning" icon={AlertTriangle}>
                            <b>Antes de cargarla hay que resolver {revision.problemas.length === 1 ? 'esto' : `${revision.problemas.length} cosas`}:</b>
                            <ul className="list-disc pl-5 mt-1">
                                {revision.problemas.map((x, k) => (
                                    <li key={k}>{x.renglon != null ? `Renglón ${x.renglon + 1}: ` : ''}{x.texto}</li>
                                ))}
                            </ul>
                        </Notice>
                    ))}

                    {revision?.totales && <TotalesLadoALado t={revision.totales} />}

                    {/* Lo que hay que mirar antes de nada. */}
                    {!revision && uso === 'venta' && faltan > 0 && (
                        <Notice variant="warning" icon={AlertTriangle}>
                            <b>{faltan}</b> de {resumen.renglones} renglones necesitan un ojo:{' '}
                            {/* Sólo lo que de verdad falta. Enumerar las cuatro
                                categorías siempre —incluso en cero— hacía leer
                                «0 sin producto» como si fuera un hallazgo. */}
                            {[
                                [resumen.sin_producto,    'sin producto'],
                                [resumen.a_confirmar,     'con el producto por confirmar'],
                                [resumen.sin_lote,        'sin lote'],
                                [resumen.sin_vencimiento, 'sin vencimiento'],
                            ].filter(([n]) => n > 0).map(([n, texto], i, arr) => (
                                <span key={texto}>
                                    <b>{n}</b> {texto}{i < arr.length - 1 ? ' · ' : '.'}
                                </span>
                            ))}
                        </Notice>
                    )}
                    {uso === 'venta' && !papel && (
                        <PedirFechas documentId={doc.document_id} salas={salasReparto} puedeEditar={puedeEditar}
                            sinFecha={p.renglones.map((r, i) => ({ renglon: i, descripcion: r.descripcion, cantidad: r.cantidad }))
                                .filter(x => !ajustes[x.renglon]?.vence && !ajustes[x.renglon]?.erroneo)}
                            onFechas={usarFechas} />
                    )}
                    {!revision && uso === 'venta' && faltan === 0 && (
                        <Notice variant="success" icon={CheckCircle2}>
                            Los {resumen.renglones} renglones están completos.
                        </Notice>
                    )}

                    <div className="flex flex-col gap-2 mt-3">
                        {p.renglones.map((r, i) => {
                            const k = claveDe(r, i);
                            const elegido = elegidos[k];
                            const o = ORIGEN[elegido ? 'aprendido' : r.match_origen] ?? null;
                            const Icono = o?.icon ?? HelpCircle;
                            const aj = ajustes[i] ?? ajusteInicial(r);
                            const conProducto = !!productoDe(r, i);
                            const factorCambio = conProducto && r.codigo_proveedor
                                && Number(aj.factor) !== Number(elegido?.factor ?? r.factor_proveedor ?? 1);
                            const sim = entraComo.get(i);
                            return (
                                <div key={`${r.codigo_proveedor}-${i}`} data-surface="card" className="px-3 py-2.5">
                                    <div className="flex items-start gap-3 flex-wrap">
                                        <div className="flex-1 min-w-[14rem]">
                                            <p className="text-label font-black text-content">
                                                {uso === 'consumo' ? r.descripcion
                                                    : aj.erroneo && !conProducto ? 'PRODUCTO ERRONEO DE PROVEEDOR'
                                                    : (elegido?.nombre ?? r.producto ?? '— sin producto —')}
                                            </p>
                                            {uso === 'venta' && <p className="text-micro text-content-3">{r.descripcion}</p>}
                                            {uso === 'venta' && !aj.erroneo && !conProducto && !r.producto_id && (
                                                <p className="text-micro text-warning font-bold">
                                                    No está en Bodega: ¿es nuevo, o es uno que ya tenemos con otro nombre? ¿O vino por error?
                                                </p>
                                            )}
                                            {uso === 'venta' && aj.erroneo && (
                                                <p className="text-micro text-danger font-bold">
                                                    Error del proveedor: entra con la compra y pasa a Bodega de vencidos hasta que llegue la nota de crédito.
                                                </p>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-label font-black text-content tabular-nums">
                                                {r.cantidad} × {formatMoney(r.costo)}
                                            </p>
                                        </div>
                                        {uso === 'venta' && (
                                            <div className="shrink-0 flex items-center gap-2">
                                                {o && (
                                                    <Badge variant={elegido ? 'success' : o.variant} size="sm">
                                                        <Icono size={11} className="mr-1 inline" />
                                                        {elegido ? 'Confirmado' : o.label}
                                                        {r.match_origen === 'parecido' && !elegido && r.match_similitud != null
                                                            && ` · ${Math.round(r.match_similitud * 100)}%`}
                                                    </Badge>
                                                )}
                                                {puedeEditar && !conProducto && !aj.erroneo && (
                                                    <Button size="xs" onClick={() => setCreando(i)} icon={PackagePlus}>
                                                        Es nuevo
                                                    </Button>
                                                )}
                                                {puedeEditar && (
                                                    <Button size="xs" variant={aj.erroneo ? 'secondary' : 'ghost'}
                                                        onClick={() => ajustar(i, 'erroneo', !aj.erroneo)}>
                                                        {aj.erroneo ? 'No es erróneo' : 'Producto erróneo'}
                                                    </Button>
                                                )}
                                                {puedeEditar && !elegido && !r.listo && (
                                                    <Button size="xs" variant="ghost"
                                                        loading={guardando === k}
                                                        onClick={() => setBusc(buscando === k ? null : k)}>
                                                        {r.producto_id ? 'Es otro' : 'Elegir'}
                                                    </Button>
                                                )}
                                                {puedeEditar && r.producto_id && !elegido && r.match_origen === 'parecido' && (
                                                    <Button size="xs"
                                                        loading={guardando === k}
                                                        onClick={() => confirmar(r, i, { id: r.producto_id, nombre: r.producto })}>
                                                        Es correcto
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    {uso === 'venta' && (
                                        <div className="mt-2 grid grid-cols-3 gap-2 max-w-xl">
                                            <PortalInput compact labelDenso label="Cantidad a cargar" inputMode="numeric"
                                                helperText={cargarAyuda(r, aj)}
                                                value={aj.cargar ?? cargarDe(r, aj.factor)}
                                                onChange={e => ajustarCarga(i, r, e.target.value)}
                                                labelAction={factorCambio && puedeEditar ? (
                                                    <Button size="xs" variant="ghost" loading={guardando === k}
                                                        onClick={() => confirmar(r, i, { id: productoDe(r, i), nombre: elegido?.nombre ?? r.producto })}>
                                                        Recordar
                                                    </Button>
                                                ) : null} />
                                            <PortalInput compact labelDenso label="Lote" value={aj.lote}
                                                onChange={e => ajustar(i, 'lote', e.target.value)} />
                                            <PortalInput compact labelDenso label="Vence" type="month" value={aj.vence}
                                                onChange={e => ajustar(i, 'vence', e.target.value)} />
                                        </div>
                                    )}
                                    {uso === 'venta' && conProducto && !aj.erroneo && (
                                        <RepartoASalas salas={salasReparto} puedeEditar={puedeEditar}
                                            total={Number(aj.cargar ?? cargarDe(r, aj.factor)) || 0}
                                            valor={aj.reparto} onChange={v => ajustar(i, 'reparto', v)} />
                                    )}
                                    {sim?.linea && <ComoEntra sim={sim} costo={costos.get(i)} />}
                                    {buscando === k && (
                                        <BuscadorProducto
                                            onElegir={(prod) => confirmar(r, i, prod)}
                                            onCancelar={() => setBusc(null)} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    </>)}
                </>)}
                {creando != null && p && (
                    <NuevoProducto renglon={p.renglones[creando]} factor={ajustes[creando]?.factor}
                        documentId={doc.document_id ?? null} manualId={doc.manual_id ?? null}
                        onCerrar={() => setCreando(null)}
                        onUsar={async (producto) => {
                            const i = creando;
                            setCreando(null);
                            await confirmar(p.renglones[i], i, producto);
                        }}
                        onCreado={async (producto, notas) => {
                            const i = creando;
                            setCreando(null);
                            useStaff.getState().appendAuditLog('PRODUCTO_NUEVO_CREADO', String(producto.id), {
                                nombre: producto.nombre, documento: doc.document_id, notas,
                            });
                            await confirmar(p.renglones[i], i, producto);
                            if (notas.length) setError(`Se creó ${producto.nombre} (${producto.id}), pero revisa su ficha: ${notas.join(' · ')}.`);
                        }} />
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                {saliendo ? (
                <div className="flex items-center gap-2 w-full flex-wrap">
                    <p className="text-label text-content-2 flex-1 min-w-[12rem]">¿Qué no va a Bodega?</p>
                    <Button size="sm" variant="ghost" disabled={resolviendo} onClick={() => setSaliendo(false)}>Cancelar</Button>
                    <Button size="sm" variant="secondary" loading={resolviendo}
                        onClick={() => sacarDeLaLista('no_va_a_bodega')}>Sólo esta factura</Button>
                    <Button size="sm" variant="secondary" loading={resolviendo} disabled={!doc.emisor_nit}
                        onClick={() => setConfProv(true)}>Nada de este proveedor</Button>
                </div>
                ) : (
                <div className="flex items-center gap-2 w-full flex-wrap">
                    <p className="text-micro text-content-3 flex-1 min-w-[12rem]">
                        «Revisar carga» arma la compra como la recibiría Bodega y la compara con el documento. Se registra sólo con «Cargar en Bodega».
                    </p>
                    {puedeEditar && !papel && !envio?.enviada && !estadoCarga && (
                        <Button size="sm" variant="ghost" onClick={() => setSaliendo(true)}>No va a Bodega</Button>
                    )}
                    {puedeEditar && papel && !envio?.enviada && onCorregirPapel && (
                        <Button size="sm" variant="ghost" onClick={() => { clearDraft(claveBorrador); onCorregirPapel(); }}>Corregir factura</Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={enviando} onClick={onCerrar}>Cerrar</Button>
                    {puedeEditar && p && !yaMandada && (
                        <Button size="sm" variant={revision?.listo && revisionVigente ? 'ghost' : 'primary'} loading={revisando}
                            disabled={enviando} onClick={revisar}>Revisar carga</Button>
                    )}
                    {puedeEditar && !yaMandada && revision?.listo && revisionVigente && resultado?.carga_id && (
                        <Button size="sm" onClick={() => setConf(true)} disabled={revisando}>Cargar en Bodega</Button>
                    )}
                </div>
                )}
            </LiquidModal.Footer>
            <ConfirmModal isOpen={confProv} onClose={() => !resolviendo && setConfProv(false)}
                onConfirm={async () => { await sacarDeLaLista('proveedor_no_va'); setConfProv(false); }}
                isProcessing={resolviendo} isDestructive={false}
                title="¿Nada de este proveedor va a Bodega?"
                message={`Las facturas de ${doc.emisor_nombre} salen de esta lista: las de hoy y todas las que lleguen después.`}
                confirmText="Sí, sacarlas" />
            <ConfirmModal isOpen={confirmando} onClose={() => !enviando && setConf(false)} onConfirm={enviar}
                isProcessing={enviando} isDestructive={false}
                title="¿Cargar esta compra en Bodega?"
                message={`Se registra la compra de ${doc.emisor_nombre} por ${formatMoney(revision?.total_armado)} en Bodega. Sólo se deshace anulándola allá.`}
                confirmText="Sí, cargar" />
        </LiquidModal>
    );
}

/* Los totales de la factura contra los que se cargan, renglón por renglón,
   para confirmarlos a ojo aunque la revisión diga que cuadran. Una fila sin
   número en la carga (descuento, retención) es algo que la carga no lleva
   aparte: el descuento ya está dentro de cada costo. */
const FILAS_TOTALES = [
    ['gravada',    'Gravado (sin IVA)'],
    ['exenta',     'Exento / no sujeto'],
    ['descuento',  'Descuento'],
    ['iva',        'IVA 13 %'],
    ['percepcion', 'Percepción 1 %'],
    ['retencion',  'Retención'],
    ['total',      'Total'],
];
function TotalesLadoALado({ t }) {
    const filas = FILAS_TOTALES.filter(([k]) => Number(t.documento?.[k]) || Number(t.carga?.[k]) || k === 'total' || k === 'iva');
    // Cada fila es su propia grilla: así la raya del total cruza de lado a lado
    // en vez de cortarse por columna.
    const cols = 'grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_1.5rem] items-center gap-x-4';
    return (
        <div data-surface="card" className="mt-3 px-4 py-3">
            <div className={`${cols} pb-1.5`}>
                <span className="text-caption font-black text-content-3 uppercase tracking-widest">Montos</span>
                <span className="text-caption font-black text-content-3 uppercase tracking-widest text-right">Factura</span>
                <span className="text-caption font-black text-content-3 uppercase tracking-widest text-right">Se carga</span>
                <span />
            </div>
            {filas.map(([k, rotulo]) => {
                const d = t.documento?.[k], c = t.carga?.[k];
                const comparable = d != null && c != null;
                const igual = comparable && Math.abs(Number(d) - Number(c)) <= 0.05;
                const esTotal = k === 'total';
                return (
                    <div key={k} className={`${cols} tabular-nums ${esTotal ? 'mt-1.5 pt-2 border-t border-divider' : 'py-1'}`}>
                        <span className={`min-w-0 ${esTotal ? 'text-body font-black text-content' : 'text-label text-content-2'}`}>
                            {rotulo}
                            {k === 'descuento' && <span className="ml-2 text-micro text-content-3">ya va dentro de cada costo</span>}
                        </span>
                        <span className={`text-right ${esTotal ? 'text-body font-black text-content' : 'text-label text-content'}`}>
                            {d != null ? formatMoney(d) : '—'}
                        </span>
                        <span className={`text-right ${esTotal ? 'text-body font-black text-content' : 'text-label text-content'}`}>
                            {c != null ? formatMoney(c) : <span className="text-content-3">—</span>}
                        </span>
                        <span className="flex justify-end">
                            {comparable && (igual
                                ? <CheckCircle2 size={15} className="text-success-text" aria-label="igual" />
                                : <AlertTriangle size={15} className="text-danger-text" aria-label={`diferencia ${formatMoney(Number(c) - Number(d))}`} />)}
                        </span>
                    </div>
                );
            })}
            {filas.some(([k]) => t.documento?.[k] != null && t.carga?.[k] != null
                && Math.abs(Number(t.documento[k]) - Number(t.carga[k])) > 0.05) && (
                <p className="mt-2 text-micro text-danger-text">Hay montos que no coinciden con la factura: revísalos antes de cargar.</p>
            )}
        </div>
    );
}

/* Cómo entra un renglón a Bodega, después de revisar: en qué presentación,
   cuántas unidades, el costo contra el anterior y el margen con el precio de
   hoy. Cuatro datos en fila, cada uno con su rótulo, en vez de un párrafo. */
/**
 * Facturas sin vencimiento (Sarita): la mercadería llegó a una sala y la
 * factura a Bodega. Bodega le pide las fechas a esa sala; la sala contesta en
 * Traslados y las fechas llenan los renglones vacíos solas (usuario,
 * 2026-10-30: «que bodega pueda solicitar a la sucursal, son para estos casos»).
 */
function PedirFechas({ documentId, sinFecha, salas, puedeEditar, onFechas }) {
    const [pedidos, setPedidos] = useState(null);
    const [sala, setSala] = useState('');
    const [ocupado, setOcupado] = useState(false);
    const [error, setError] = useState('');

    const cargar = useCallback(async () => {
        const { pedidos: p, error: e } = await fetchPedidosDeVence();
        if (e) setError(e);
        setPedidos(p.filter(x => x.document_id === documentId && x.estado !== 'cancelado'));
    }, [documentId]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);

    const vivo = (pedidos ?? []).find(x => x.estado === 'pendiente');
    const contestado = (pedidos ?? []).find(x => x.estado === 'respondido');
    useEffect(() => { if (contestado?.respuestas) onFechas(contestado.respuestas); }, [contestado, onFechas]);

    const pedir = async () => {
        setOcupado(true); setError('');
        const { error: e } = await pedirVencesASala(documentId, sala, sinFecha);
        setOcupado(false);
        if (e) { setError(e); return; }
        cargar();
    };
    const cancelar = async () => {
        setOcupado(true); setError('');
        const { error: e } = await cancelarPedidoDeVence(vivo.id);
        setOcupado(false);
        if (e) setError(e);
        cargar();
    };

    if (!pedidos) return null;
    if (vivo) {
        return (
            <Notice variant="info" icon={CalendarRange}>
                <b>Fechas pedidas a {vivo.sala}</b> ({(vivo.renglones ?? []).length} productos), esperando respuesta.
                Cuando conteste, se llenan solas.
                <span className="flex items-center gap-2 mt-1 text-micro">
                    <AvatarConEstado emp={{ id: vivo.pedido_por, name: vivo.pedido_nombre }} px={16} radio="rounded-full" marco="" />
                    {shortEmployeeName(vivo.pedido_nombre)}
                    {puedeEditar && <Button size="xs" variant="ghost" loading={ocupado} onClick={cancelar}>Cancelar pedido</Button>}
                </span>
                {error && <span className="block text-danger-text">{error}</span>}
            </Notice>
        );
    }
    return (
        <>
            {contestado && (
                <Notice variant="success" icon={CheckCircle2}>
                    <b>{contestado.sala} contestó las fechas</b> y ya están puestas en los renglones.
                    <span className="flex items-center gap-2 mt-1 text-micro">
                        <AvatarConEstado emp={{ id: contestado.respondido_por, name: contestado.respondido_nombre }} px={16} radio="rounded-full" marco="" />
                        {shortEmployeeName(contestado.respondido_nombre)}
                    </span>
                </Notice>
            )}
            {sinFecha.length > 0 && puedeEditar && (
                <Notice variant="warning" icon={CalendarRange}>
                    <b>{sinFecha.length === 1 ? 'Un producto no trae' : `${sinFecha.length} productos no traen`} fecha de vencimiento.</b>{' '}
                    Si la mercadería llegó a una sala, pídele las fechas:
                    <span className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="w-[12rem]">
                            <LiquidSelect value={sala} onChange={v => setSala(v || '')} placeholder="¿Qué sala la recibió?"
                                options={salas.map(b => ({ value: String(b.id), label: b.name }))} compact />
                        </span>
                        <Button size="sm" icon={CalendarRange} disabled={!sala || ocupado} loading={ocupado} onClick={pedir}>
                            Pedir fechas
                        </Button>
                    </span>
                    {error && <span className="block mt-1 text-danger-text">{error}</span>}
                </Notice>
            )}
        </>
    );
}

/** `{ branchId: '12' }` tecleado → `{ branchId: 12 }` sin vacíos, o null. */
function aRepartir(reparto) {
    if (!reparto) return null;
    const limpio = Object.fromEntries(Object.entries(reparto)
        .map(([b, v]) => [b, Number(v)]).filter(([, n]) => n > 0));
    return Object.keys(limpio).length ? limpio : null;
}

/**
 * ¿Se envía parte de este renglón a otras salas? (usuario, 2026-10-30). La
 * cantidad va en UNIDADES, igual que «Cantidad a cargar»; nunca más de lo que
 * entra, y si se envía menos se dice cuánto queda en Bodega.
 */
function RepartoASalas({ salas, total, valor, onChange, puedeEditar }) {
    if (!valor) {
        return puedeEditar && salas.length > 0 ? (
            <div className="mt-2">
                <Button size="xs" variant="ghost" icon={Truck} onClick={() => onChange({})}>
                    Enviar a sucursales
                </Button>
            </div>
        ) : null;
    }
    const suma = Object.values(valor).reduce((t, v) => t + (Number(v) || 0), 0);
    const quedan = total - suma;
    return (
        <div className="mt-2 pt-2 border-t border-divider">
            <div className="flex items-center justify-between gap-2">
                <p className="text-caption font-black text-content-3 uppercase tracking-widest flex items-center gap-1">
                    <Truck size={12} /> Enviar a sucursales
                </p>
                {puedeEditar && (
                    <Button size="xs" variant="ghost" onClick={() => onChange(null)}>No enviar</Button>
                )}
            </div>
            <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {salas.map(sala => (
                    <PortalInput key={sala.id} compact labelDenso label={sala.name} inputMode="numeric"
                        readOnly={!puedeEditar} placeholder="0"
                        value={valor[sala.id] ?? ''}
                        onChange={e => onChange({ ...valor, [sala.id]: String(e.target.value).replace(/[^\d]/g, '') })} />
                ))}
            </div>
            {suma > 0 && (
                <p className={`mt-1 text-micro font-bold tabular-nums ${quedan < 0 ? 'text-danger' : quedan > 0 ? 'text-warning' : 'text-content-2'}`}>
                    {quedan < 0 ? `Se envían ${suma} y entran ${total}: no se puede enviar más de lo que entra.`
                        : quedan > 0 ? `Se envían ${suma} · quedan ${quedan} en el inventario de Bodega.`
                        : `Se envían las ${suma}: no queda nada en Bodega.`}
                </p>
            )}
        </div>
    );
}

function ComoEntra({ sim, costo }) {
    const nombre = sim.presentacion_nombre || (sim.presentacion > 1 ? `Caja de ${sim.presentacion}` : 'Unidad');
    const cambio = costo?.cambio;
    const parejo = cambio == null || Math.abs(cambio) < 0.5;
    const notaCosto = costo?.antes == null ? 'sin costo anterior'
        : parejo ? 'igual que antes'
        : `${cambio > 0 ? 'sube' : 'baja'} ${Math.abs(cambio).toFixed(1)} % · antes ${formatMoney(costo.antes, { decimales: 4 })}`;
    return (
        <div className="mt-2 pt-2 border-t border-divider grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
            <Dato titulo="Se carga como" valor={nombre}
                nota={sim.presentacion > 1 ? `${sim.presentacion} unidades c/u` : '1 unidad c/u'} />
            <Dato titulo="Entran" valor={`${sim.existencias} unid.`}
                nota={sim.vence_pendiente ? 'el vencimiento lo pone la sala' : null} />
            {costo && (
                <div className="min-w-0">
                    <p className="text-caption font-black text-content-3 uppercase tracking-widest">Costo</p>
                    <p className="text-label font-bold text-content tabular-nums">{formatMoney(costo.nuevo, { decimales: 4 })}</p>
                    <p className={`text-micro tabular-nums truncate ${parejo ? 'text-content-3' : cambio > 0 ? 'text-warning-text' : 'text-success-text'}`}>
                        {notaCosto}
                    </p>
                </div>
            )}
            {costo && (
                <div className="min-w-0">
                    <p className="text-caption font-black text-content-3 uppercase tracking-widest">Precio de venta</p>
                    <p className="text-label font-bold text-content tabular-nums">{formatMoney(costo.venta)}</p>
                    <p className="text-micro text-content-3 tabular-nums flex items-center gap-1">
                        {costo.margen != null ? `margen ${Math.round(costo.margen)} %` : 'sin margen'}
                        {costo.alerta && <Badge variant={costo.alerta.variante} size="sm">{costo.alerta.label}</Badge>}
                    </p>
                </div>
            )}
        </div>
    );
}

function Dato({ titulo, valor, nota, mono }) {
    return (
        <div className="min-w-0">
            <p className="text-caption font-black text-content-3 uppercase tracking-widest">{titulo}</p>
            <p className={`text-label text-content truncate ${mono ? 'font-mono text-micro' : 'font-bold'}`}>
                {valor ?? '—'}
            </p>
            {nota && <p className="text-micro text-content-3 truncate">{nota}</p>}
        </div>
    );
}

/* ─── Todo lo que hay por confirmar, en una sola lista ─────────────────────── */
//
// La otra pestaña se recorre documento por documento, que es lo correcto para
// cargar una factura pero pésimo para sembrar el diccionario: la misma pregunta
// —«¿qué producto es el código 21AG de GAMMA?»— vuelve a aparecer en cada
// factura de ese proveedor. Acá la pregunta aparece **una vez**, con cuánto
// destraba, y la respuesta vale para todas.
//
// Por eso la lista se ordena por peso y no por fecha: responder las primeras
// diez resuelve muchísimos más renglones que responder diez cualesquiera.

// El filtro NO se llama «Por confirmar»: así se llama la pestaña, y dos
// controles con el mismo rótulo en la misma pantalla se leen como uno solo.
//
// Los cuatro estados los recorta la BASE. Con dos —«Sin resolver» y «Todos»— no
// alcanzaba y además «Todos» mentía: la consulta trae 500 filas de 3,016 con
// las pendientes adelante, así que lo apartado y lo confirmado no entraba nunca
// y no había forma de llegar a ninguno de los dos desde la pantalla.
const ESTADOS = [
    { value: 'pendientes', label: 'Sin resolver'     },
    { value: 'apartados',  label: 'No son productos' },
    { value: 'resueltos',  label: 'Confirmados'      },
    { value: 'todos',      label: 'Todos'            },
];

// Las tarjetas de arriba cuentan lo que hay en pantalla, así que su rótulo
// tiene que decir QUÉ están contando. «Preguntas» sobre una lista de apartados
// es un número correcto con el nombre de otra cosa.
const RESUMEN = {
    pendientes: { icon: ListChecks, label: 'Preguntas',   renglones: 'que se destraban' },
    apartados:  { icon: EyeOff,     label: 'Apartados',   renglones: 'que dejan de preguntarse' },
    resueltos:  { icon: BookMarked, label: 'Confirmados', renglones: 'ya resueltos' },
    todos:      { icon: Layers,     label: 'En la lista', renglones: 'en total' },
};

/* Lo que un proveedor mandó por error: entró con su compra, pasó a Bodega de
 * vencidos, y espera su nota de crédito. Acá se ve qué era de verdad —aunque
 * en el sistema figure como el genérico— y se le adjunta la nota. */
const ESTADO_ERRONEO = {
    por_mover:   { label: 'Por pasar a vencidos', variant: 'warning' },
    en_vencidos: { label: 'En vencidos · falta nota', variant: 'info' },
    con_nota:    { label: 'Con nota de crédito', variant: 'success' },
    saliendo:    { label: 'Saliendo…', variant: 'warning' },
    salio:       { label: 'Ya salió', variant: 'neutral' },
    sin_verificar: { label: 'Comprobar si salió', variant: 'danger' },
};

/**
 * La nota de crédito en PAPEL de un producto erróneo (2026-10-30). Se escribe
 * lo que dice el papel; al dar salida, el portal la registra en el libro de
 * compras como documento impreso. El total se calcula: escribirlo aparte era
 * una tercera cifra que podía no cuadrar con las otras dos.
 */
function NotaEnPapel({ fila, onListo, onCancelar }) {
    const [n, setN] = useState({ serie: '', numero: '', fecha: '', subtotal: '', iva: '' });
    const [guardando, setG] = useState(false);
    const [error, setError] = useState('');
    const poner = (k, v) => setN(x => ({ ...x, [k]: v }));
    const total = Math.round(((Number(n.subtotal) || 0) + (Number(n.iva) || 0)) * 100) / 100;
    const guardar = async () => {
        setG(true); setError('');
        const { error: e } = await adjuntarNotaEnPapel(fila.id, {
            ...n, subtotal: Number(n.subtotal), iva: Number(n.iva), total,
        });
        setG(false);
        if (e) { setError(e === 'FORBIDDEN' ? 'No tienes permiso para adjuntar la nota.' : e); return; }
        onListo();
    };
    return (
        <div className="mt-2 flex flex-col gap-2">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
                <PortalInput compact labelDenso label="Serie" value={n.serie} onChange={e => poner('serie', e.target.value)} />
                <PortalInput compact labelDenso label="Número" value={n.numero} onChange={e => poner('numero', e.target.value)} />
                <PortalInput compact labelDenso label="Fecha" type="date" value={n.fecha} onChange={e => poner('fecha', e.target.value)} />
                <PortalInput compact labelDenso label="Subtotal" prefix="$" inputMode="decimal" maskType="DECIMAL"
                    value={n.subtotal} onChange={e => poner('subtotal', e.target.value)} />
                <PortalInput compact labelDenso label="IVA" prefix="$" inputMode="decimal" maskType="DECIMAL"
                    value={n.iva} onChange={e => poner('iva', e.target.value)} />
                <p className="text-label text-content tabular-nums pb-2">Total <b>{formatMoney(total)}</b></p>
            </div>
            {error && <p className="text-micro text-danger-text font-medium">{error}</p>}
            <div className="flex items-center gap-2">
                <Button size="xs" loading={guardando} onClick={guardar}
                    disabled={!n.serie.trim() || !n.numero.trim() || !n.fecha || !(Number(n.subtotal) > 0) || !(Number(n.iva) > 0)}>
                    Adjuntar nota en papel
                </Button>
                <Button size="xs" variant="ghost" onClick={onCancelar}>Cancelar</Button>
            </div>
        </div>
    );
}

const LIBRO_PAPEL = {
    pendiente: null,
    enviando: 'registrándose en el libro…',
    registrada: 'ya está en el libro de compras',
    sin_verificar: 'se mandó al libro pero no se pudo comprobar: revisarla',
    fallida: 'el libro no la aceptó',
};

function TabErroneos({ puedeEditar }) {
    const [filas, setFilas]   = useState(null);
    const [error, setError]   = useState('');
    const [elegida, setEleg]  = useState({});   // {id: nota}
    const [guardando, setG]   = useState(null);
    const [enPapel, setEnPapel] = useState(null);   // id del renglón con el formulario abierto

    // El error de la LISTA no borra el de una acción: «Dar salida» avisaba y
    // la recarga que venía detrás lo dejaba en blanco.
    const cargar = useCallback(async () => {
        const { filas: f, error: e } = await fetchErroneos();
        if (e) setError(e);
        setFilas(f);
    }, []);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);

    const adjuntar = async (fila, nota) => {
        setG(fila.id);
        const { error: e } = await adjuntarNotaDeCredito(fila.id, nota);
        setG(null);
        if (e) { setError(e === 'FORBIDDEN' ? 'No tienes permiso para adjuntar la nota.' : e); return; }
        useStaff.getState().appendAuditLog(nota ? 'COMPRA_ERRONEO_NOTA_ADJUNTA' : 'COMPRA_ERRONEO_NOTA_QUITADA', String(fila.id), {
            nota, descripcion: fila.descripcion, proveedor: fila.emisor_nombre,
        });
        cargar();
    };
    const [confirmaSalida, setConfSal] = useState(null);
    const conSistema = async (fila, fn) => {
        setG(fila.id); setError('');
        const { error: e } = await fn(fila.id);
        setG(null);
        if (e) setError(e);
        cargar();
    };
    const darSalida = async (fila) => {
        setG(fila.id); setError('');
        const { resultado, error: e } = await darSalidaErroneo(fila.id);
        setG(null); setConfSal(null);
        if (e) setError(e);
        else if (!resultado?.comprobado) setError('Se le dio salida, pero la existencia de vencidos no bajó lo esperado: revísalo.');
        cargar();
    };

    if (!filas) return <p className="text-label text-content-3">Cargando…</p>;
    return (
        <div className="space-y-3">
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            <Notice variant="info" icon={HelpCircle}>
                Lo que un proveedor mandó por error. Entra con su compra, pasa a Bodega de vencidos y espera la nota de
                crédito. Si no lo tenemos en el catálogo, en Bodega figura como «PRODUCTO ERRONEO DE PROVEEDOR»; aquí queda lo que era.
            </Notice>
            {!filas.length && <p className="text-label text-content-3">No hay productos erróneos.</p>}
            {confirmaSalida && (
                <ConfirmModal isOpen onClose={() => guardando !== confirmaSalida.id && setConfSal(null)} onConfirm={() => darSalida(confirmaSalida)}
                    isProcessing={guardando === confirmaSalida.id} isDestructive={false}
                    title="Dar salida"
                    message={`Se registra la nota de crédito ${confirmaSalida.nota_numero} en el libro de compras y se descargan ${Number(confirmaSalida.unidades)} unidades de «${confirmaSalida.descripcion}» de Bodega de vencidos. No se puede deshacer.`}
                    confirmText="Dar salida" />
            )}
            {filas.map(f => {
                const est = ESTADO_ERRONEO[f.estado] ?? ESTADO_ERRONEO.por_mover;
                const opciones = (f.notas_candidatas ?? []).map(n => ({
                    value: String(n.id),
                    label: `${n.numero ?? n.id} · ${fechaNumerica(n.fecha)} · ${formatMoney(n.total)}${n.relacionada ? ' · de esta factura' : ''}`,
                }));
                // Se propone sólo la nota que dice corregir ESTA factura; otra
                // del mismo proveedor se elige a mano.
                const relacionada = (f.notas_candidatas ?? []).find(n => n.relacionada);
                const nota = elegida[f.id] ?? (relacionada ? String(relacionada.id) : '');
                return (
                    <div key={f.id} data-surface="card" className="px-3 py-2.5">
                        <div className="flex items-start gap-3 flex-wrap">
                            <div className="flex-1 min-w-[14rem]">
                                <p className="text-label font-black text-content">{f.descripcion}</p>
                                <p className="text-micro text-content-3">
                                    {f.emisor_nombre} · factura {f.factura} ({fechaNumerica(f.factura_fecha)})
                                    {f.erp_compra_id ? ` · compra ${f.erp_compra_id}` : ''}
                                    {f.es_generico ? ' · en Bodega como PRODUCTO ERRONEO DE PROVEEDOR' : ''}
                                </p>
                                <p className="text-micro text-content-3 flex items-center gap-1 mt-0.5">
                                    <AvatarConEstado emp={{ id: f.marcado_por, name: f.marcado_nombre }} px={16} radio="rounded-full" marco="" />
                                    {shortEmployeeName(f.marcado_nombre ?? '')} · {fechaNumerica(f.created_at)}
                                    {f.erp_traslado_id ? ` · traslado ${f.erp_traslado_id}` : ''}
                                </p>
                                {f.nota && <p className="text-micro text-warning font-bold mt-0.5">{f.nota}</p>}
                                {/* El traslado a vencidos salió pero no se comprobó (o se recibió a
                                    mano): se le pregunta al sistema antes de poder darle salida. */}
                                {puedeEditar && !f.en_vencidos_at && f.erp_traslado_id && !['salio', 'saliendo', 'sin_verificar'].includes(f.estado) && (
                                    <Button size="xs" variant="ghost" className="mt-1" loading={guardando === f.id}
                                        onClick={() => conSistema(f, erroneoYaEnVencidos)}>
                                        Ya se recibió en vencidos
                                    </Button>
                                )}
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-label font-black text-content tabular-nums">
                                    {Number(f.unidades)} u · {formatMoney(Number(f.unidades) * Number(f.costo_unitario))}
                                </p>
                                <Badge variant={est.variant} size="sm">{est.label}</Badge>
                            </div>
                        </div>
                        {(f.nota_credito_document_id || f.nota_papel_id) ? (
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                                <p className="text-micro text-content">
                                    Nota de crédito{f.nota_papel ? ' en papel' : ''}{' '}
                                    <b>{f.nota_papel?.serie ? `${f.nota_papel.serie} · ` : ''}{f.nota_numero}</b> · {fechaNumerica(f.nota_fecha)} · {formatMoney(f.nota_total)}
                                    {LIBRO_PAPEL[f.nota_papel?.estado] && (
                                        <span className={f.nota_papel.estado === 'registrada' ? 'text-content-3' : 'text-warning-text font-bold'}>
                                            {' · '}{LIBRO_PAPEL[f.nota_papel.estado]}{f.nota_papel.error ? `: ${f.nota_papel.error}` : ''}
                                        </span>
                                    )}
                                </p>
                                {puedeEditar && f.estado === 'con_nota' && (
                                    <Button size="xs" variant="ghost" disabled={guardando === f.id} onClick={() => adjuntar(f, null)}>
                                        Quitar
                                    </Button>
                                )}
                                {puedeEditar && f.estado === 'con_nota' && f.en_vencidos_at && (
                                    <Button size="xs" disabled={guardando === f.id} onClick={() => setConfSal(f)}>
                                        {guardando === f.id ? 'Dando salida…' : 'Dar salida'}
                                    </Button>
                                )}
                                {puedeEditar && f.estado === 'sin_verificar' && (
                                    <Button size="xs" loading={guardando === f.id} onClick={() => conSistema(f, comprobarSalidaErroneo)}>
                                        Comprobar
                                    </Button>
                                )}
                            </div>
                        ) : puedeEditar && enPapel === f.id ? (
                            <NotaEnPapel fila={f} onCancelar={() => setEnPapel(null)} onListo={() => { setEnPapel(null); cargar(); }} />
                        ) : puedeEditar && (<>
                            {opciones.length ? (
                                <div className="mt-2 flex items-center gap-2 flex-wrap">
                                    <div className="min-w-[16rem] flex-1 max-w-md">
                                        <LiquidSelect value={nota} onChange={v => setEleg(x => ({ ...x, [f.id]: v || '' }))}
                                            options={opciones} placeholder="Nota de crédito" ariaLabel="Nota de crédito" clearable={false} compact />
                                    </div>
                                    <Button size="xs" disabled={!nota || guardando === f.id} onClick={() => adjuntar(f, nota)}>
                                        Adjuntar nota
                                    </Button>
                                </div>
                            ) : (
                                <p className="text-micro text-content-3 mt-2">Todavía no llega ninguna nota de crédito electrónica de este proveedor.</p>
                            )}
                            <Button size="xs" variant="ghost" icon={FileText} className="mt-1" onClick={() => setEnPapel(f.id)}>
                                La nota vino en papel
                            </Button>
                        </>)}
                    </div>
                );
            })}
        </div>
    );
}

function TabPorConfirmar({ puedeEditar, busca = '' }) {
    const [filas, setFilas]   = useState(null);
    const [error, setError]   = useState('');
    const [estado, setEstado] = useState('pendientes');
    const [barriendo, setBarr] = useState(null);   // texto de progreso
    const [buscando, setBusc] = useState(null);    // id del renglón abierto
    const [guardando, setG]   = useState(null);
    const [pagina, setPagina] = useState(1);
    const [porPagina, setPorPagina] = useState(PAGE_SIZE_OPTIONS[0]);

    const cargar = useCallback(async () => {
        const { filas: f, error: e } = await fetchProductosPorConfirmar(estado);
        setError(e?.message ?? '');
        setFilas(f);
    }, [estado]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el filtro cambió, la página vieja ya no existe
    useEffect(() => { setPagina(1); }, [busca, estado]);

    // Leer los documentos de a tandas hasta que no quede ninguno **o hasta que
    // una tanda no avance**: un archivo ilegible no se marca leído, así que
    // sin ese segundo freno el bucle no terminaría nunca.
    const barrer = async () => {
        setError(''); setBarr('Leyendo los documentos…');
        for (let vuelta = 0; vuelta < 30; vuelta++) {
            const { resultado, error: e } = await barrerDocumentos({ dias: 90, tanda: 40 });
            if (e) { setError(e); break; }
            setBarr(`Leídos ${resultado.leidos} · quedan ${resultado.restantes}`);
            if (resultado.leidos === 0 || resultado.restantes === 0) break;
        }
        setBarr(null);
        await cargar();
    };

    const confirmar = async (fila, producto) => {
        setG(fila.id);
        const { error: e } = await confirmarProducto(fila.emisor_nit, fila.llave, producto.id, {
            proveedor: fila.proveedor, producto: producto.nombre, renglones: fila.renglones,
        });
        setG(null);
        if (e) { setError(e); return; }
        setBusc(null);
        await cargar();
    };

    // Un clic. No pregunta por qué: eran dos decisiones por cada flete, que es
    // justo lo que uno quiere sacarse de encima rápido. Se sigue sabiendo quién
    // y cuándo —la base lo guarda y acá queda en la bitácora—, y lo apartado se
    // revisa con el filtro «No son productos», no leyendo motivos.
    const apartar = async (fila) => {
        setG(fila.id);
        const { error: e } = await apartarRenglon(fila.id, false, {
            proveedor: fila.proveedor, codigo: fila.codigo_proveedor,
            descripcion: fila.descripcion, renglones: fila.renglones,
        });
        setG(null);
        if (e) { setError(e); return; }
        await cargar();
    };

    const visibles = useMemo(() => {
        if (!busca.trim()) return filas ?? [];
        return (filas ?? []).filter(f => tokenMatch(busca,
            f.proveedor, f.descripcion, f.codigo_proveedor, f.sugerido_nombre));
    }, [filas, busca]);

    // El recorte por estado lo hace la base, así que lo que hay en `filas` ES
    // lo que se está mirando: contar otra cosa acá sería contar dos veces con
    // criterios distintos. El salteo sólo tiene sentido en «Sin resolver», donde
    // la lista puede traer algo que se acaba de confirmar sin recargar.
    const totales = useMemo(() => {
        const t = { preguntas: 0, renglones: 0, sinCandidato: 0 };
        for (const f of filas ?? []) {
            if (estado === 'pendientes' && (f.resuelto || f.ignorado)) continue;
            t.preguntas++;
            t.renglones += Number(f.renglones || 0);
            if (!f.sugerido_product_id) t.sinCandidato++;
        }
        return t;
    }, [filas, estado]);

    const totalPaginas = Math.ceil(visibles.length / porPagina);
    const enPantalla = useMemo(
        () => visibles.slice((pagina - 1) * porPagina, pagina * porPagina),
        [visibles, pagina, porPagina]);

    return (<>
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <CarrilCards className="flex-1" ariaLabel="Resumen de lo que falta confirmar">
                <StatCard icon={RESUMEN[estado].icon} label={RESUMEN[estado].label}
                    value={totales.preguntas} sub="productos distintos"
                    loading={filas === null} tono="brand" />
                <StatCard icon={Layers} label="Renglones" value={totales.renglones}
                    sub={RESUMEN[estado].renglones} loading={filas === null} tono="brand" />
                {/* «Sin candidato» sólo dice algo de lo que falta contestar. En
                    los otros estados sería un número que nadie va a accionar. */}
                {estado === 'pendientes' && (
                    <StatCard icon={HelpCircle} label="Sin candidato" value={totales.sinCandidato}
                        sub="hay que buscarlos a mano" loading={filas === null} tono="warning"
                        valueCls={totales.sinCandidato ? 'text-warning-text' : 'text-content'} />
                )}
            </CarrilCards>

            {/* «Actualizar lista» es una acción de la vista, así que va DENTRO
                de la píldora (§17): las acciones son descriptores y no JSX
                porque el mismo botón se dibuja distinto en la píldora de
                escritorio y en el clúster táctil. Suelto al lado quedaba fuera
                de ese contrato — y en el teléfono, fuera del clúster.
                El descriptor no tiene `loading`, así que el avance del barrido
                se cuenta abajo en su propio aviso y acá sólo se deshabilita: un
                rótulo que cambia por tanda re-mide la píldora en cada vuelta. */}
            <div className="flex justify-end min-w-0">
                <FilterBar onClear={() => setEstado('pendientes')} activeCount={estado !== 'pendientes' ? 1 : 0}
                    acciones={[{
                        key: 'barrer', icon: RefreshCw, label: 'Actualizar lista',
                        disabled: !!barriendo, onClick: barrer,
                    }]}>
                    <FilterBar.Section active={estado !== 'pendientes'}
                        onClear={() => setEstado('pendientes')} label="estado">
                        <div style={{ width: '160px' }}>
                            <LiquidSelect value={estado} onChange={v => setEstado(v || 'pendientes')}
                                options={ESTADOS} icon={ListChecks} compact bare clearable={false} />
                        </div>
                    </FilterBar.Section>
                </FilterBar>
            </div>
        </div>

        {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

        {barriendo && <Notice variant="info" icon={RefreshCw} compact>{barriendo}</Notice>}

        {estado === 'apartados' ? (
            <Notice variant="info" icon={EyeOff} compact>
                Lo que alguien marcó como <b>que no es un producto</b> —un flete, un servicio, un
                descuento—. Está aquí para poder revisarlo: si fue un error, o si desde entonces
                el producto empezó a existir, <b>Devolver a la lista</b> lo pone otra vez a la cola.
            </Notice>
        ) : (
            <Notice variant="info" icon={ListChecks} compact>
                Cada línea es <b>un producto de un proveedor</b>, no un renglón: confirmarla resuelve
                todas las facturas donde aparece, las de hoy y las que vengan. Está ordenada por
                cuánto destraba cada una. Si la lista se ve corta o vieja, <b>Actualizar lista</b> lee
                los documentos nuevos.
            </Notice>
        )}

        <div className="flex flex-col gap-2">
            {filas === null && <p className="text-label text-content-3">Cargando…</p>}
            {filas !== null && visibles.length === 0 && (
                estado === 'apartados' ? (
                    <Notice variant="info" icon={EyeOff}>
                        Nadie apartó nada todavía. Aquí van a aparecer los renglones que se marquen
                        como <b>que no son un producto</b>, por si hay que revisarlos.
                    </Notice>
                ) : estado === 'resueltos' ? (
                    <Notice variant="info" icon={BookMarked}>
                        Todavía no hay ningún producto confirmado. Cada uno que confirmes queda aquí,
                        y desde aquí se corrige si te equivocaste.
                    </Notice>
                ) : (
                    <Notice variant="success" icon={CheckCircle2}>
                        Sin productos por confirmar. Si acaban de llegar facturas nuevas,
                        toca <b>Actualizar lista</b>.
                    </Notice>
                )
            )}
            {enPantalla.map((f) => {
                const o = ORIGEN[f.sugerido_origen] ?? null;
                const Icono = o?.icon ?? HelpCircle;
                return (
                    <div key={f.id} data-surface="card"
                        className={`px-3 py-2.5 ${f.ignorado ? 'opacity-60' : ''}`}>
                        <div className="flex items-start gap-3 flex-wrap">
                            <div className="flex-1 min-w-[16rem]">
                                <p className="text-label font-black text-content">
                                    {f.sugerido_nombre ?? '— sin candidato —'}
                                </p>
                                <p className="text-micro text-content-3">
                                    {f.descripcion}
                                </p>
                                <p className="text-micro text-content-3">
                                    {f.proveedor}
                                    {f.codigo_proveedor && <> · código <span className="font-mono">{f.codigo_proveedor}</span></>}
                                </p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-label font-black text-content tabular-nums">
                                    {plural(f.renglones, 'renglón', 'renglones')}
                                </p>
                                <p className="text-micro text-content-3">
                                    en {plural(f.documentos, 'factura', 'facturas')}
                                    {' · '}{Number(f.unidades ?? 0)} unidades
                                </p>
                            </div>
                            <div className="shrink-0 flex items-center gap-2 flex-wrap">
                                {f.ignorado && <Badge variant="neutral" size="sm">Apartado</Badge>}
                                {f.resuelto && <Badge variant="success" size="sm">Confirmado</Badge>}
                                {!f.resuelto && !f.ignorado && o && (
                                    <Badge variant={o.variant} size="sm">
                                        <Icono size={11} className="mr-1 inline" />
                                        {o.label}
                                        {f.sugerido_origen === 'parecido' && f.sugerido_similitud != null
                                            && ` · ${Math.round(f.sugerido_similitud * 100)}%`}
                                    </Badge>
                                )}
                                {puedeEditar && !f.resuelto && !f.ignorado && (<>
                                    {f.sugerido_product_id && (
                                        <Button size="xs" loading={guardando === f.id}
                                            onClick={() => confirmar(f, { id: f.sugerido_product_id, nombre: f.sugerido_nombre })}>
                                            Es correcto
                                        </Button>
                                    )}
                                    <Button size="xs" variant="ghost"
                                        onClick={() => setBusc(buscando === f.id ? null : f.id)}>
                                        {f.sugerido_product_id ? 'Es otro' : 'Elegir'}
                                    </Button>
                                    <Button size="xs" variant="ghost" icon={EyeOff}
                                        loading={guardando === f.id}
                                        onClick={() => apartar(f)}>
                                        No es un producto
                                    </Button>
                                </>)}
                                {/* Una confirmación equivocada tiene que poder
                                    corregirse desde donde se hizo: el
                                    diccionario se sobrescribe, pero si la
                                    pantalla esconde el botón, el único camino
                                    es la base de datos. */}
                                {puedeEditar && f.resuelto && (
                                    <Button size="xs" variant="ghost"
                                        onClick={() => setBusc(buscando === f.id ? null : f.id)}>
                                        Es otro
                                    </Button>
                                )}
                                {puedeEditar && f.ignorado && (
                                    <Button size="xs" variant="ghost" loading={guardando === f.id}
                                        onClick={async () => {
                                            setG(f.id);
                                            const { error: e } = await apartarRenglon(f.id, true,
                                                { proveedor: f.proveedor, codigo: f.codigo_proveedor });
                                            setG(null);
                                            if (e) { setError(e); return; }
                                            await cargar();
                                        }}>
                                        Devolver a la lista
                                    </Button>
                                )}
                            </div>
                        </div>

                        {buscando === f.id && (
                            <BuscadorProducto
                                onElegir={(prod) => confirmar(f, prod)}
                                onCancelar={() => setBusc(null)} />
                        )}

                    </div>
                );
            })}
        </div>

        <TablePagination
            page={pagina} totalPages={totalPaginas} onPageChange={setPagina}
            pageSize={porPagina} onPageSizeChange={setPorPagina}
            total={filas?.length ?? 0} filteredTotal={visibles.length}
            unit="productos" />
    </>);
}

/* ─── Factura en papel (2026-10-30) ─────────────────────────────────────────
 * Proveedores que no mandan DTE (La Constancia): se copia el papel y de ahí en
 * adelante es la misma carga — revisión, envío, verificación. Usuario,
 * 2026-10-29: «que se pueda llenar a mano si no hay QR/foto». */

const TIPOS_PAPEL = [
    { value: 'CCF', label: 'Crédito fiscal' },
    { value: 'COF', label: 'Factura' },
    { value: 'FSE', label: 'Sujeto excluido' },
];
const RENGLON_VACIO = { codigo: '', descripcion: '', cantidad: '', importe: '', exento: false };
const PAPEL_VACIO = { proveedor_nit: '', tipo_doc: 'CCF', numero: '', serie: '', fecha: '', total: '', renglones: [{ ...RENGLON_VACIO }] };

/** El doc que abre la carga, armado desde la fila del papel. */
const docDePapel = (m) => ({
    manual_id: m.id, emisor_nombre: m.proveedor_nombre, emisor_nit: m.proveedor_nit,
    fecha_emision: m.fecha_emision, monto_total: m.total,
});

function FacturaEnPapel({ inicial, onCerrar, onGuardada }) {
    const clave = `factura-en-papel:${inicial?.id ?? 'nueva'}`;
    const [f, setF] = useState(() => loadDraft(clave)?.f ?? (inicial ? {
        id: inicial.id, proveedor_nit: inicial.proveedor_nit, tipo_doc: inicial.tipo_doc, numero: inicial.numero,
        serie: inicial.serie ?? '', fecha: inicial.fecha_emision, total: String(inicial.total),
        renglones: (inicial.renglones ?? []).map(r => ({
            codigo: r.codigo ?? '', descripcion: r.descripcion, cantidad: String(r.cantidad),
            importe: String(r.importe), exento: !!r.exento,
        })),
    } : PAPEL_VACIO));
    const [proveedores, setProv] = useState(null);
    const [guardando, setG] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { saveDraft(clave, { f }); }, [clave, f]);
    useEffect(() => {
        let vivo = true;
        fetchProveedoresParaPapel().then(({ proveedores: p, error: e }) => {
            if (!vivo) return;
            setProv(p);
            if (e) setError(e);
        });
        return () => { vivo = false; };
    }, []);

    const poner = (campo, valor) => setF(x => ({ ...x, [campo]: valor }));
    const ponerRenglon = (i, campo, valor) => setF(x => ({
        ...x, renglones: x.renglones.map((r, k) => (k === i ? { ...r, [campo]: valor } : r)),
    }));
    const agregar = () => setF(x => ({ ...x, renglones: [...x.renglones, { ...RENGLON_VACIO }] }));
    const quitar = (i) => setF(x => ({ ...x, renglones: x.renglones.filter((_, k) => k !== i) }));

    // La suma de lo escrito, para que la persona la compare con el papel antes
    // de seguir. En crédito fiscal el importe va sin IVA: se le suma el 13 % a
    // lo gravado (la percepción, si la hay, la agrega la revisión).
    const suma = f.renglones.reduce((a, r) => {
        const m = Number(r.importe) || 0;
        return { gravado: a.gravado + (r.exento ? 0 : m), exento: a.exento + (r.exento ? m : 0) };
    }, { gravado: 0, exento: 0 });
    const estimado = Math.round(((f.tipo_doc === 'CCF' ? suma.gravado * 1.13 : suma.gravado) + suma.exento) * 100) / 100;
    const total = Number(f.total) || 0;
    const descuadre = total > 0 && estimado > 0 && Math.abs(estimado - total) > 0.05;

    const guardar = async () => {
        setG(true); setError('');
        const { manualId, error: e } = await guardarFacturaEnPapel({
            ...f, numero: f.numero.trim(), total: Number(f.total),
            renglones: f.renglones.map(r => ({
                codigo: r.codigo, descripcion: r.descripcion, cantidad: Number(r.cantidad),
                importe: Number(r.importe), exento: r.exento,
            })),
        });
        setG(false);
        if (e) { setError(e); return; }
        clearDraft(clave);
        onGuardada(manualId);
    };

    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-4xl" ariaLabel="Factura en papel">
            <LiquidModal.Header icono={FileText} tono="brand" onClose={onCerrar}
                titulo={inicial ? 'Corregir factura en papel' : 'Factura en papel'}
                subtitulo="Para proveedores que no mandan factura electrónica: copia el papel tal como viene." />
            <LiquidModal.Body>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                    <div className="md:col-span-4">
                        <label className={rotuloCampo('text-content-3')}>Proveedor</label>
                        <LiquidSelect ariaLabel="Proveedor" value={f.proveedor_nit} onChange={v => poner('proveedor_nit', v || '')}
                            placeholder={proveedores ? '¿De quién es la factura?' : 'Cargando proveedores…'}
                            options={(proveedores ?? []).map(p => ({ value: p.nit, label: p.nombre }))}
                            isLoading={!proveedores} />
                    </div>
                    <div className="md:col-span-2">
                        <PortalInput label="Fecha de la factura" type="date" value={f.fecha} onChange={e => poner('fecha', e.target.value)} />
                    </div>
                    <div className="md:col-span-2">
                        <SegmentedControl size="sm" label="Tipo" value={f.tipo_doc} onChange={v => poner('tipo_doc', v)} options={TIPOS_PAPEL} />
                    </div>
                    <div className="md:col-span-1">
                        <PortalInput label="Serie" value={f.serie} onChange={e => poner('serie', e.target.value)} placeholder="Opcional" />
                    </div>
                    <div className="md:col-span-2">
                        <PortalInput label="Número" value={f.numero} onChange={e => poner('numero', e.target.value)} placeholder="Como sale en el papel" />
                    </div>
                    <div className="md:col-span-1">
                        <PortalInput label="Total" prefix="$" inputMode="decimal" maskType="DECIMAL" value={f.total} onChange={e => poner('total', e.target.value)} />
                    </div>
                </div>

                <p className="mt-5 mb-2 text-caption font-black text-content-2 uppercase tracking-widest">
                    Productos · el importe de cada línea{f.tipo_doc === 'COF' ? ', con IVA' : ', sin IVA'}, como en el papel
                </p>
                <div className="flex flex-col gap-2">
                    {f.renglones.map((r, i) => (
                        <div key={i} data-surface="card" className="px-3 py-2 grid grid-cols-2 md:grid-cols-12 gap-2 items-end">
                            <div className="col-span-2 md:col-span-5">
                                <PortalInput compact labelDenso label="Descripción" value={r.descripcion}
                                    onChange={e => ponerRenglon(i, 'descripcion', e.target.value)} />
                            </div>
                            <div className="md:col-span-2">
                                <PortalInput compact labelDenso label="Código" value={r.codigo} placeholder="Opcional"
                                    onChange={e => ponerRenglon(i, 'codigo', e.target.value)} />
                            </div>
                            <div className="md:col-span-1">
                                <PortalInput compact labelDenso label="Cant." type="number" min="0" value={r.cantidad}
                                    onChange={e => ponerRenglon(i, 'cantidad', e.target.value)} />
                            </div>
                            <div className="md:col-span-3">
                                <PortalInput compact labelDenso label="Importe" prefix="$" inputMode="decimal" maskType="DECIMAL" value={r.importe}
                                    onChange={e => ponerRenglon(i, 'importe', e.target.value)} />
                            </div>
                            <div className="col-span-2 md:col-span-1 flex items-center justify-between gap-1 min-h-[var(--tap-min)]">
                                <Checkbox size="sm" label="Exento" checked={r.exento} onChange={() => ponerRenglon(i, 'exento', !r.exento)} />
                                {f.renglones.length > 1 && (
                                    <Button size="xs" variant="ghost" iconOnly icon={Trash2} title="Quitar producto" onClick={() => quitar(i)} />
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <Button size="sm" variant="ghost" icon={Plus} onClick={agregar}>Otro producto</Button>
                    <p className={`text-label tabular-nums ${descuadre ? 'text-warning-text font-bold' : 'text-content-2'}`}>
                        Suma de los productos{f.tipo_doc === 'CCF' ? ' con IVA' : ''}: {formatMoney(estimado)}
                        {descuadre && ` · el papel dice ${formatMoney(total)}: revisa`}
                    </p>
                </div>
                {error && <Notice variant="danger" icon={AlertTriangle} className="mt-3">{error}</Notice>}
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center gap-2 w-full flex-wrap">
                    <p className="text-micro text-content-3 flex-1 min-w-[12rem]">
                        Al guardar se abre la carga: ahí se eligen los productos, el lote y el vencimiento, igual que con una factura electrónica.
                    </p>
                    <Button size="sm" variant="ghost" onClick={onCerrar}>Cerrar</Button>
                    <Button size="sm" loading={guardando} onClick={guardar}>Guardar y seguir</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

/** Las facturas en papel escritas y todavía sin cargar. */
function FacturasEnPapel({ facturas, puedeEditar, onAbrir, onDescartada }) {
    const [descartando, setDesc] = useState(null);
    const [procesando, setProc] = useState(false);
    const [error, setError] = useState('');
    if (!facturas?.length) return null;
    const descartar = async () => {
        if (procesando) return;
        setProc(true);
        const { error: e } = await descartarFacturaEnPapel(descartando.id);
        setProc(false);
        setDesc(null);
        if (e) { setError(e); return; }
        onDescartada();
    };
    return (
        <div className="flex flex-col gap-2">
            <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                Facturas en papel por cargar · {facturas.length}
            </p>
            {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {facturas.map(m => (
                    <div key={m.id} data-surface="card" className="px-3 py-2 flex items-center gap-2">
                        <FileText size={16} className="text-content-3 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-label font-black text-content truncate">{m.proveedor_nombre}</p>
                            <p className="text-micro text-content-3 tabular-nums">
                                {m.tipo_doc} {m.serie ? `${m.serie} · ` : ''}{m.numero} · {fmtFecha(m.fecha_emision)} · {formatMoney(m.total)}
                            </p>
                        </div>
                        {puedeEditar && (
                            <Button size="xs" variant="ghost" iconOnly icon={Trash2} title="Descartar" onClick={() => setDesc(m)} />
                        )}
                        <Button size="xs" className="min-h-[var(--tap-min)]" onClick={() => onAbrir(m)}>Cargar</Button>
                    </div>
                ))}
            </div>
            <ConfirmModal isOpen={!!descartando} onClose={() => !procesando && setDesc(null)} onConfirm={descartar}
                isProcessing={procesando}
                title="Descartar factura en papel"
                message={descartando ? `La factura ${descartando.numero} de ${descartando.proveedor_nombre} sale de la lista sin cargarse.` : ''}
                confirmText="Descartar" />
        </div>
    );
}

/* ─── La vista ────────────────────────────────────────────────────────────── */
export default function CargarCompraView() {
    const { hasPermission } = useAuth();
    // El módulo de esta pantalla es `cargar_compra`: es el que mira la ruta y
    // el servidor. Con sólo `compras`, quien carga (Jefe/a de Compras) la veía
    // en solo lectura.
    const puedeEditar = hasPermission('cargar_compra', 'can_edit')
        || hasPermission('compras', 'can_edit');

    const [tab, setTab]     = usePestanaEnUrl(TABS, 'facturas');
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState('');
    const [busca, setBusca] = useState('');
    // El buscador vive en la lupa de la barra (canónico); cada pestaña con
    // lista guarda su propio texto.
    const [buscaConfirmar, setBuscaConfirmar] = useState('');
    // Arranca en el último mes: es el período en el que de verdad se carga una
    // compra, y son ~600 documentos en vez de ~1,400.
    const [dias, setDias]   = useState('30');
    const [sel, setSel]     = useState(null);
    const [pagina, setPagina] = useState(1);
    const [porPagina, setPorPagina] = useState(PAGE_SIZE_OPTIONS[0]);

    const [estados, setEstados] = useState({});
    const [pistas, setPistas]   = useState({});
    const [papeles, setPapeles] = useState([]);
    const [escribiendo, setEscr] = useState(null);   // null · 'nueva' · la fila a corregir
    const cargarPapeles = useCallback(async () => {
        const { facturas, error: e } = await fetchFacturasEnPapel();
        if (e) console.warn('[cargar-compra] facturas en papel:', e);
        setPapeles(facturas);
    }, []);
    const cargar = useCallback(async () => {
        cargarPapeles();
        const { filas: f, error: e } = await fetchDocumentosSinCargar(Number(dias));
        setError(e?.message ?? '');
        setFilas(f);
        const ids = (f ?? []).map(x => x.document_id);
        const [{ estados: es }, { pistas: ps, error: ep }] = await Promise.all([
            fetchEstadosDeCarga(ids), fetchPistasSinCargar(ids)]);
        if (ep) console.warn('[cargar-compra] sin pistas:', ep.message);
        setEstados(es);
        setPistas(ps);
    }, [dias, cargarPapeles]);

    // **Sólo se pide si se está mirando.** Esta lista no vive en la pestaña «Por
    // confirmar», pero se pedía igual al montar la vista y en cada cambio de
    // período: entrar por «Por confirmar» pagaba una consulta que no se usaba
    // para nada. Medido en producción antes de arreglar la consulta, era lo que
    // hacía lenta a la OTRA pestaña —10.5 s de media, 16.8 s la peor— mientras
    // su propio RPC contestaba en 16 ms. La consulta ya está arreglada; pedirla
    // igual seguiría siendo trabajo tirado.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { if (tab === 'facturas') cargar(); }, [tab, cargar]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el filtro cambió, la página vieja ya no existe
    useEffect(() => { setPagina(1); }, [busca, dias]);

    const visibles = useMemo(() => {
        if (!busca.trim()) return filas ?? [];
        return (filas ?? []).filter(f => tokenMatch(busca,
            f.emisor_nombre, f.proveedor_ficha, f.codigo_generacion));
    }, [filas, busca]);

    const totales = useMemo(() => {
        const t = { monto: 0, renglones: 0, viejos: 0 };
        for (const f of filas ?? []) {
            t.monto += Number(f.monto_total || 0);
            t.renglones += Number(f.renglones || 0);
            if (Number(f.dias_desde) > 15) t.viejos++;
        }
        return t;
    }, [filas]);

    const totalPaginas = Math.ceil(visibles.length / porPagina);
    const enPantalla = useMemo(
        () => visibles.slice((pagina - 1) * porPagina, pagina * porPagina),
        [visibles, pagina, porPagina]);

    const filtersContent = (
        <ViewTabBar tabs={TABS} activeTab={tab} onTabChange={setTab}
            searchValue={tab === 'confirmar' ? buscaConfirmar : busca}
            onSearchChange={tab === 'confirmar' ? setBuscaConfirmar : setBusca}
            showSearch={tab === 'facturas' || tab === 'confirmar'}
            placeholder={tab === 'confirmar' ? 'Buscar proveedor, producto o código…' : 'Buscar proveedor o número de documento…'} />
    );

    return (
        <GlassViewLayout icon={PackagePlus} title="Cargar compra" filtersContent={filtersContent}>
            <div className="p-5 md:p-6 space-y-5">

            {tab === 'erroneos' ? <TabErroneos puedeEditar={puedeEditar} />
            : tab === 'confirmar' ? <TabPorConfirmar puedeEditar={puedeEditar} busca={buscaConfirmar} /> : (<>

                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <CarrilCards className="flex-1" ariaLabel="Resumen de lo que falta cargar">
                        <StatCard icon={PackagePlus} label="Sin cargar" value={filas?.length ?? 0}
                            sub={`${totales.renglones} renglones`} loading={filas === null} tono="brand" />
                        <StatCard icon={AlertTriangle} label="Monto" value={formatMoney(totales.monto)}
                            sub="de facturas que esperan" loading={filas === null} tono="warning" />
                        <StatCard icon={CalendarRange} label="De más de 15 días" value={totales.viejos}
                            sub="documentos" loading={filas === null} tono="warning"
                            valueCls={totales.viejos ? 'text-warning-text' : 'text-content'} />
                    </CarrilCards>

                    <div className="flex justify-end items-center gap-2 min-w-0">
                        {puedeEditar && (
                            <Button size="sm" variant="secondary" icon={FileText} onClick={() => setEscr('nueva')}>
                                Factura en papel
                            </Button>
                        )}
                        <FilterBar onClear={() => setDias('30')} activeCount={dias !== '30' ? 1 : 0}>
                            <FilterBar.Section active={dias !== '30'} onClear={() => setDias('30')} label="período">
                                <div style={{ width: '175px' }}>
                                    <LiquidSelect value={dias} onChange={v => setDias(v || '30')}
                                        options={PERIODOS} icon={CalendarRange} compact bare clearable={false} />
                                </div>
                            </FilterBar.Section>
                        </FilterBar>
                    </div>
                </div>

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

                <FacturasEnPapel facturas={papeles} puedeEditar={puedeEditar}
                    onAbrir={m => setSel(docDePapel(m))} onDescartada={cargarPapeles} />

                <Notice variant="info" icon={PackagePlus} compact>
                    El portal arma la compra desde el documento —producto, cantidad, costo, lote y
                    vencimiento— y cada renglón dice de dónde salió su dato. Se revisa con «Revisar
                    carga» y entra a <b>Bodega</b> con «Cargar en Bodega»; desde ahí el producto se
                    mueve a las salas. Cada producto que confirmes queda guardado y ese proveedor no
                    vuelve a preguntar.
                </Notice>

                {(() => {
                    const ya = (filas ?? []).filter(f => !estados[f.document_id] && pistas[f.document_id]?.compra).length;
                    const gasto = (filas ?? []).filter(f => !estados[f.document_id] && !pistas[f.document_id]?.compra && pistas[f.document_id]?.gasto).length;
                    if (!ya && !gasto) return null;
                    return (
                        <Notice variant="warning" icon={HelpCircle} compact>
                            {ya > 0 && <><b>{ya}</b> parece{ya === 1 ? '' : 'n'} ya cargada{ya === 1 ? '' : 's'} a mano con otro número
                                («¿Ya cargada?»). </>}
                            {gasto > 0 && <><b>{gasto}</b> parece{gasto === 1 ? '' : 'n'} gasto y no mercadería («¿Es gasto?»). </>}
                            Ábrelas para confirmarlo y sacarlas de la lista.
                        </Notice>
                    );
                })()}

                <DataTable columns={COLS} dense loading={filas === null}
                    empty={{ icon: CheckCircle2, message: 'Sin facturas esperando carga en este período' }}
                    movil={{ identidad: 'proveedor', ancla: 'total', usarAccionDeFila: true }}>
                    {enPantalla.map((f, i) => (
                        <DataRow key={f.document_id} index={i} onClick={() => setSel(f)}>
                            <DataCell><span className="tabular-nums text-content-2 text-label">{fmtFecha(f.fecha_emision)}</span></DataCell>
                            <DataCell>
                                <span className="font-bold text-content text-label">
                                    {f.proveedor_ficha ?? f.emisor_nombre}
                                </span>
                                {!f.tiene_pdf && (
                                    <span className="block text-micro text-content-3">sin archivo impreso</span>
                                )}
                            </DataCell>
                            <DataCell hideBelow="lg">
                                <span className="font-mono text-micro text-content-3 break-all">{f.codigo_generacion}</span>
                            </DataCell>
                            <DataCell align="center" hideBelow="md">
                                <span className="tabular-nums text-content-2 text-label">{f.renglones}</span>
                            </DataCell>
                            <DataCell align="right">
                                <span className="tabular-nums font-black text-content text-label">{formatMoney(f.monto_total)}</span>
                            </DataCell>
                            <DataCell align="center" className="whitespace-nowrap">
                                {f.dias_desde > 15
                                    ? <Badge variant="warning" size="sm">{f.dias_desde} días</Badge>
                                    : <span className="text-content-2 text-label">{f.dias_desde} d</span>}
                            </DataCell>
                            <DataCell align="center" className="whitespace-nowrap">
                                {(() => {
                                    const e = estadoDeCarga(estados[f.document_id]);
                                    const pista = pistas[f.document_id];
                                    if (!estados[f.document_id] && pista?.compra)
                                        return <Badge variant="warning" size="sm">¿Ya cargada?</Badge>;
                                    if (!estados[f.document_id] && pista?.gasto)
                                        return <Badge variant="neutral" size="sm">¿Es gasto?</Badge>;
                                    return <Badge variant={e.variant} size="sm">{e.label}</Badge>;
                                })()}
                            </DataCell>
                        </DataRow>
                    ))}
                </DataTable>

                <TablePagination
                    page={pagina} totalPages={totalPaginas} onPageChange={setPagina}
                    pageSize={porPagina} onPageSizeChange={setPorPagina}
                    total={filas?.length ?? 0} filteredTotal={visibles.length}
                    unit="documentos" />
            </>)}
            </div>

            {sel && <Propuesta doc={sel} puedeEditar={puedeEditar}
                estadoCarga={sel.manual_id ? null : estados[sel.document_id]}
                pista={sel.manual_id ? null : pistas[sel.document_id]}
                onCorregirPapel={sel.manual_id ? () => {
                    const m = papeles.find(x => x.id === sel.manual_id);
                    setSel(null);
                    if (m) setEscr(m);
                } : null}
                onCerrar={() => { setSel(null); cargar(); }} />}
            {escribiendo && <FacturaEnPapel inicial={escribiendo === 'nueva' ? null : escribiendo}
                onCerrar={() => setEscr(null)}
                onGuardada={async (id) => {
                    setEscr(null);
                    const { facturas } = await fetchFacturasEnPapel();
                    setPapeles(facturas);
                    const m = facturas.find(x => x.id === id);
                    if (m) setSel(docDePapel(m));
                }} />}
        </GlassViewLayout>
    );
}
