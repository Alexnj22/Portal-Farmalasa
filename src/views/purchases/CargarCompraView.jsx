import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    PackagePlus, AlertTriangle, CheckCircle2, ScanBarcode, BookMarked,
    Search, HelpCircle, CalendarRange, ListChecks, RefreshCw, EyeOff, Layers,
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
import { saveDraft, loadDraft } from '@nucleo/utils/draftUtils';
import AvisoParecidos from '../../components/common/AvisoParecidos';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination, { PAGE_SIZE_OPTIONS } from '../../components/common/TablePagination';
import {
    fetchDocumentosSinCargar, fetchPropuesta, confirmarProducto, buscarProductos,
    fetchProductosPorConfirmar, barrerDocumentos, apartarRenglon, simularCarga, simularProductoNuevo, enviarCarga,
} from '@nucleo/data/cargarCompra';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { useAuth } from '@nucleo/context/AuthContext';
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
];

const COLS = [
    { key: 'fecha',      label: 'Fecha',      align: 'left'   },
    { key: 'proveedor',  label: 'Proveedor',  align: 'left'   },
    { key: 'documento',  label: 'Documento',  align: 'left',   hideBelow: 'lg' },
    { key: 'renglones',  label: 'Renglones',  align: 'center', hideBelow: 'md' },
    { key: 'total',      label: 'Total',      align: 'right'  },
    { key: 'espera',     label: 'Esperando',  align: 'center' },
];

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

// ── Producto nuevo desde un renglón (paso 4) ──────────────────────────────
//
// Copia a un producto PARECIDO —categoría, laboratorio, proveedor, si vence,
// si es exento— y sólo pide lo que el modelo no puede saber. Por ahora revisa
// el alta sin crearla: crear de verdad se enciende después de la primera
// carga con Bodega mirando.
const nombreDelRenglon = (t) => String(t ?? '').split('|')[0].replace(/\s+/g, ' ').trim().toUpperCase();
const barrasDelRenglon = (t) => /\b(\d{12,14})\b/.exec(String(t ?? ''))?.[1] ?? '';
const ROTULO_PRECIO = ['Precio 1', 'Precio 2', 'Precio 3', 'Precio 4', 'Precio 5', 'Precio 6', 'Precio 7'];

function NuevoProducto({ renglon, factor, onCerrar }) {
    const costo = Number(renglon.costo) / (Number(factor) > 0 ? Number(factor) : 1);
    const [nombre, setNombre]   = useState(nombreDelRenglon(renglon.descripcion));
    const [barras, setBarras]   = useState(barrasDelRenglon(renglon.descripcion));
    const [precio, setPrecio]   = useState('');
    const [modelo, setModelo]   = useState(null);
    const [eligiendo, setElig]  = useState(true);
    const [revisando, setRev]   = useState(false);
    const [res, setRes]         = useState(null);
    const [error, setError]     = useState('');

    const revisar = async () => {
        setRev(true); setError(''); setRes(null);
        const { resultado, error: e } = await simularProductoNuevo({
            nombre, barcode: barras, modeloId: modelo?.id, costo: Math.round(costo * 1e4) / 1e4, precio: Number(precio),
        });
        setRev(false);
        if (e) { setError(e); return; }
        setRes(resultado.revision);
    };
    const cambiar = (set) => (e) => { set(e.target.value); setRes(null); };
    const margen = Number(precio) > 0 ? Math.round((1 - costo / Number(precio)) * 100) : null;

    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-2xl" ariaLabel="Crear producto">
            <LiquidModal.Header titulo="Crear producto" subtitulo={renglon.descripcion} icono={PackagePlus} onClose={onCerrar} />
            <LiquidModal.Body>
                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                        <PortalInput label="Nombre" value={nombre} onChange={cambiar(setNombre)} />
                    </div>
                    <PortalInput label="Código de barras" value={barras} onChange={cambiar(setBarras)} inputMode="numeric" />
                    <PortalInput label="Precio de venta por unidad" inputMode="decimal" maskType="DECIMAL" prefix="$"
                        value={precio} onChange={cambiar(setPrecio)}
                        helperText={margen != null ? `margen ${margen} %` : null} />
                </div>
                <p className="text-micro text-content-3 mt-2">
                    Costo por unidad: <b>{formatMoney(costo)}</b>
                    {Number(factor) > 1 && ` (${formatMoney(renglon.costo)} la caja de ${factor})`}
                </p>

                <div className="mt-4">
                    <p className="text-label font-black text-content">Igual que…</p>
                    <p className="text-micro text-content-3 mb-2">
                        Un producto parecido ya existente: se copian su categoría, laboratorio, proveedor, si vence y
                        si es exento, y los otros precios guardan su misma proporción.
                    </p>
                    {modelo && !eligiendo ? (
                        <div className="flex items-center gap-2">
                            <Badge variant="info" size="sm">{modelo.nombre}</Badge>
                            <Button size="xs" variant="ghost" onClick={() => setElig(true)}>Cambiar</Button>
                        </div>
                    ) : (
                        <BuscadorProducto
                            onElegir={(prod) => { setModelo(prod); setElig(false); setRes(null); }}
                            onCancelar={() => setElig(false)} />
                    )}
                </div>

                {res && (res.listo ? (
                    <div className="mt-4">
                        <Notice variant="success" icon={CheckCircle2}>
                            <b>El alta está bien armada.</b> Se crearía <b>{res.nombre}</b> como «{res.modelo.nombre}»:
                            {' '}{res.modelo.categoria} · {res.modelo.laboratorio} · {res.modelo.proveedor}
                            {res.modelo.perecedero ? ' · vence' : ''}{res.modelo.exento ? ' · exento' : ''}.
                        </Notice>
                        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mt-2">
                            {res.precios.map((p, k) => (
                                <Dato key={k} titulo={ROTULO_PRECIO[k]} valor={formatMoney(p)} />
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="mt-4">
                        <Notice variant="warning" icon={AlertTriangle}>
                            <ul className="list-disc pl-5">{res.problemas.map((x, k) => <li key={k}>{x}</li>)}</ul>
                        </Notice>
                    </div>
                ))}
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center gap-2 w-full">
                    <p className="text-micro text-content-3 flex-1">Revisa el alta sin crearla todavía.</p>
                    <Button size="sm" variant="ghost" onClick={onCerrar}>Cerrar</Button>
                    <Button size="sm" loading={revisando} disabled={!modelo || !nombre.trim() || !(Number(precio) > 0)}
                        onClick={revisar}>Revisar alta</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

function Propuesta({ doc, puedeEditar, onCerrar }) {
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

    const cargar = useCallback(async () => {
        setP(null); setError(''); setRes(null);
        const { propuesta, error: e } = await fetchPropuesta(doc.document_id);
        if (e) { setError(e); return; }
        setP(propuesta);
        // Lo que la persona ya había ajustado sobre ESTE documento vuelve: la
        // sesión se cierra sola a los pocos minutos y una factura de 30
        // renglones no se vuelve a teclear.
        const b = loadDraft(`cargar-compra:${doc.document_id}`);
        setAjustes(b?.ajustes ?? Object.fromEntries(propuesta.renglones.map((r, i) => [i, ajusteInicial(r)])));
        setUso(b?.uso ?? 'venta');
        setDias(b?.dias ?? (propuesta.encabezado.dias_credito != null ? String(propuesta.encabezado.dias_credito) : ''));
    }, [doc.document_id]);

    useEffect(() => {
        if (p) saveDraft(`cargar-compra:${doc.document_id}`, { ajustes, uso, dias });
    }, [p, ajustes, uso, dias, doc.document_id]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);

    const ajustar = (i, campo, valor) => {
        setAjustes(a => ({ ...a, [i]: { ...a[i], [campo]: valor } }));
        setRes(null);   // lo revisado ya no es lo que se ve
    };

    const confirmar = async (renglon, i, producto) => {
        setG(renglon.codigo_proveedor);
        const { error: e } = await confirmarProducto(
            p.documento.emisor_nit, renglon.codigo_proveedor, producto.id,
            { proveedor: p.documento.emisor, producto: producto.nombre },
            ajustes[i]?.factor);
        setG(null);
        if (e) { setError(e); return; }
        setEleg(x => ({ ...x, [renglon.codigo_proveedor]: { product_id: producto.id, nombre: producto.nombre, factor: ajustes[i]?.factor } }));
        setBusc(null);
        setRes(null);
    };

    // El producto que se mandaría: lo elegido acá, o lo que llegó por código
    // de barras o por el diccionario. Un parecido NUNCA viaja sin confirmar,
    // por alto que sea: acierta 91.5 % y un inventario mal cargado no avisa.
    // La revisión lo devuelve como «sin producto elegido», que es lo que es.
    const productoDe = (r) => elegidos[r.codigo_proveedor]?.product_id
        ?? (['codigo_barras', 'aprendido'].includes(r.match_origen) ? r.producto_id : null);

    const decisiones = () => Object.fromEntries(p.renglones.map((r, i) => [i, {
        product_id: productoDe(r),
        factor: Number(ajustes[i]?.factor) || 1,
        lote: ajustes[i]?.lote || null,
        vence: ajustes[i]?.vence || null,
    }]));

    // Manda EXACTAMENTE lo revisado: la función lo vuelve a armar y se niega si
    // algo cambió, así que acá se le pasan las mismas decisiones.
    const enviar = async () => {
        setEnv(true); setError('');
        const { resultado: r, error: e } = await enviarCarga({
            documentId: doc.document_id, cargaId: resultado.carga_id, uso, renglones: decisiones(),
            diasCredito: dias === '' ? null : Number(dias),
        });
        setEnv(false); setConf(false);
        setEnvio({ ...(r ?? {}), error: e });
        setRes(null);
    };

    const revisar = async () => {
        setRev(true); setError(''); setRes(null); setEnvio(null);
        const renglones = decisiones();
        const { resultado: res, error: e } = await simularCarga({
            documentId: doc.document_id, uso, renglones,
            diasCredito: dias === '' ? null : Number(dias),
        });
        setRev(false);
        if (e) { setError(e); return; }
        setRes(res);
    };

    const resumen = p?.resumen;
    const faltan = (p?.renglones ?? []).filter(r => r.falta.length > 0).length;
    const revision = resultado?.revision;
    const pendientesDeVence = (revision?.renglones ?? []).filter(x => x.vence_pendiente).length;
    const entraComo = useMemo(() => new Map((revision?.renglones ?? []).map(x => [x.renglon, x])), [revision]);

    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-5xl"
            ariaLabel={`Compra propuesta de ${doc.emisor_nombre}`}>
            <LiquidModal.Header icono={PackagePlus} tono="brand" titulo={doc.emisor_nombre} onClose={onCerrar}
                subtitulo={<>
                    {fmtFecha(doc.fecha_emision)} · {formatMoney(doc.monto_total)}
                    {resumen && ` · ${resumen.renglones} renglones`}
                </>} />

            <LiquidModal.Body>
                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
                {!p && !error && <p className="text-label text-content-3">Leyendo el documento y su archivo…</p>}

                {p && (<>
                    {/* El encabezado: lo que iría en la parte de arriba del
                        formulario del otro sistema. */}
                    <div data-surface="card" className="p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Dato titulo="Proveedor"        valor={p.encabezado.proveedor} />
                        <Dato titulo="Número"           valor={p.documento.codigo_generacion} mono />
                        <Dato titulo="Sello"            valor={p.documento.sello ? 'sí' : 'no lo trae'} />
                        <Dato titulo="Días de crédito"
                              valor={p.encabezado.dias_credito != null
                                  ? `${p.encabezado.dias_credito} días`
                                  : 'lo pone la persona'}
                              nota={p.encabezado.dias_credito_origen} />
                    </div>

                    {/* Para qué es la compra. Consumo se registra igual en el
                        libro, pero como gasto y sin sumar existencias. */}
                    <div className="flex flex-wrap items-end gap-3 mb-3">
                        <SegmentedControl label="La compra es" value={uso} onChange={(v) => { setUso(v); setRes(null); }} options={USOS} />
                        <div className="w-32">
                            <PortalInput compact label="Días de crédito" type="number" min="0" value={dias}
                                onChange={e => { setDias(e.target.value); setRes(null); }} />
                        </div>
                    </div>
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
                        </Notice>
                    ) : envio.enviada === false ? (
                        <Notice variant="danger" icon={AlertTriangle}>
                            <b>No entró.</b> {envio.error}
                        </Notice>
                    ) : (
                        <Notice variant="danger" icon={AlertTriangle}>
                            <b>No se sabe si entró.</b> {envio.error} No la mandes de nuevo: avisá a Bodega para que la busque.
                        </Notice>
                    ))}

                    {revision && (revision.listo ? (
                        <Notice variant="success" icon={CheckCircle2}>
                            <b>Lista para cargar.</b> {revision.renglones.length} renglones · total{' '}
                            {formatMoney(revision.total_armado)}, igual al del documento.
                            {pendientesDeVence > 0 && (
                                <span className="block mt-1">
                                    {pendientesDeVence === 1 ? 'Un renglón va' : `${pendientesDeVence} renglones van`} sin
                                    vencimiento: se le va a pedir a la sala que lo reciba.
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
                    {!revision && uso === 'venta' && faltan === 0 && (
                        <Notice variant="success" icon={CheckCircle2}>
                            Los {resumen.renglones} renglones están completos.
                        </Notice>
                    )}

                    <div className="flex flex-col gap-2 mt-3">
                        {p.renglones.map((r, i) => {
                            const elegido = elegidos[r.codigo_proveedor];
                            const o = ORIGEN[elegido ? 'aprendido' : r.match_origen] ?? null;
                            const Icono = o?.icon ?? HelpCircle;
                            const aj = ajustes[i] ?? ajusteInicial(r);
                            const conProducto = !!productoDe(r);
                            const factorCambio = conProducto && r.codigo_proveedor
                                && Number(aj.factor) !== Number(elegido?.factor ?? r.factor_proveedor ?? 1);
                            const sim = entraComo.get(i);
                            return (
                                <div key={`${r.codigo_proveedor}-${i}`} data-surface="card" className="px-3 py-2.5">
                                    <div className="flex items-start gap-3 flex-wrap">
                                        <div className="flex-1 min-w-[14rem]">
                                            <p className="text-label font-black text-content">
                                                {uso === 'consumo' ? r.descripcion : (elegido?.nombre ?? r.producto ?? '— sin producto —')}
                                            </p>
                                            {uso === 'venta' && <p className="text-micro text-content-3">{r.descripcion}</p>}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-label font-black text-content tabular-nums">
                                                {r.cantidad} × {formatMoney(r.costo)}
                                            </p>
                                            {sim?.existencias != null && (
                                                <p className="text-micro text-success-text">
                                                    entran {sim.existencias} unid.{sim.presentacion > 1 ? ` (en cajas de ${sim.presentacion})` : ''}
                                                </p>
                                            )}
                                            {sim?.vence_pendiente && (
                                                <p className="text-micro text-warning-text">el vencimiento lo pone la sala</p>
                                            )}
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
                                                {puedeEditar && !conProducto && (
                                                    <Button size="xs" variant="ghost" onClick={() => setCreando(i)}>
                                                        Crear producto
                                                    </Button>
                                                )}
                                                {puedeEditar && r.codigo_proveedor && !elegido && !r.listo && (
                                                    <Button size="xs" variant="ghost"
                                                        loading={guardando === r.codigo_proveedor}
                                                        onClick={() => setBusc(buscando === r.codigo_proveedor ? null : r.codigo_proveedor)}>
                                                        {r.producto_id ? 'Es otro' : 'Elegir'}
                                                    </Button>
                                                )}
                                                {puedeEditar && r.producto_id && !elegido && r.match_origen === 'parecido' && (
                                                    <Button size="xs"
                                                        loading={guardando === r.codigo_proveedor}
                                                        onClick={() => confirmar(r, i, { id: r.producto_id, nombre: r.producto })}>
                                                        Es correcto
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    {uso === 'venta' && (
                                        <div className="mt-2 grid grid-cols-3 gap-2 max-w-xl">
                                            <PortalInput compact labelDenso label="Unid. por caja" type="number" min="1"
                                                helperText={ORIGEN_FACTOR[r.factor_origen] ?? null}
                                                value={aj.factor} onChange={e => ajustar(i, 'factor', e.target.value)}
                                                labelAction={factorCambio && puedeEditar ? (
                                                    <Button size="xs" variant="ghost" loading={guardando === r.codigo_proveedor}
                                                        onClick={() => confirmar(r, i, { id: productoDe(r), nombre: elegido?.nombre ?? r.producto })}>
                                                        Recordar
                                                    </Button>
                                                ) : null} />
                                            <PortalInput compact labelDenso label="Lote" value={aj.lote}
                                                onChange={e => ajustar(i, 'lote', e.target.value)} />
                                            <PortalInput compact labelDenso label="Vence" type="month" value={aj.vence}
                                                onChange={e => ajustar(i, 'vence', e.target.value)} />
                                        </div>
                                    )}
                                    {buscando === r.codigo_proveedor && (
                                        <BuscadorProducto
                                            onElegir={(prod) => confirmar(r, i, prod)}
                                            onCancelar={() => setBusc(null)} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>)}
                {creando != null && p && (
                    <NuevoProducto renglon={p.renglones[creando]} factor={ajustes[creando]?.factor}
                        onCerrar={() => setCreando(null)} />
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex items-center gap-2 w-full">
                    <p className="text-micro text-content-3 flex-1">
                        «Revisar carga» arma la compra como la recibiría Bodega y la compara con el documento. Se registra sólo con «Cargar en Bodega».
                    </p>
                    <Button size="sm" variant="ghost" onClick={onCerrar}>Cerrar</Button>
                    {puedeEditar && p && !envio?.enviada && (
                        <Button size="sm" variant={revision?.listo ? 'ghost' : 'primary'} loading={revisando}
                            disabled={enviando} onClick={revisar}>Revisar carga</Button>
                    )}
                    {puedeEditar && revision?.listo && resultado?.carga_id && (
                        <Button size="sm" onClick={() => setConf(true)} disabled={revisando}>Cargar en Bodega</Button>
                    )}
                </div>
            </LiquidModal.Footer>
            <ConfirmModal isOpen={confirmando} onClose={() => !enviando && setConf(false)} onConfirm={enviar}
                isProcessing={enviando} isDestructive={false}
                title="¿Cargar esta compra en Bodega?"
                message={`Se registra la compra de ${doc.emisor_nombre} por ${formatMoney(revision?.total_armado)} en Bodega. Sólo se deshace anulándola allá.`}
                confirmText="Sí, cargar" />
        </LiquidModal>
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

function TabPorConfirmar({ puedeEditar }) {
    const [filas, setFilas]   = useState(null);
    const [error, setError]   = useState('');
    const [busca, setBusca]   = useState('');
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

        <PortalInput value={busca} onChange={e => setBusca(e.target.value)} tono="brand"
            placeholder="Buscar proveedor, producto o código…" aria-label="Buscar" />

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

/* ─── La vista ────────────────────────────────────────────────────────────── */
export default function CargarCompraView() {
    const { hasPermission } = useAuth();
    const puedeEditar = hasPermission('compras', 'can_edit')
        || hasPermission('facturas_compra', 'can_edit');

    const [tab, setTab]     = usePestanaEnUrl(TABS, 'facturas');
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState('');
    const [busca, setBusca] = useState('');
    // Arranca en el último mes: es el período en el que de verdad se carga una
    // compra, y son ~600 documentos en vez de ~1,400.
    const [dias, setDias]   = useState('30');
    const [sel, setSel]     = useState(null);
    const [pagina, setPagina] = useState(1);
    const [porPagina, setPorPagina] = useState(PAGE_SIZE_OPTIONS[0]);

    const cargar = useCallback(async () => {
        const { filas: f, error: e } = await fetchDocumentosSinCargar(Number(dias));
        setError(e?.message ?? '');
        setFilas(f);
    }, [dias]);

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
            searchValue={busca} onSearchChange={setBusca} showSearch={tab === 'facturas'}
            placeholder="Buscar proveedor o número de documento…" />
    );

    return (
        <GlassViewLayout icon={PackagePlus} title="Cargar compra" filtersContent={filtersContent}>
            <div className="p-5 md:p-6 space-y-5">

            {tab === 'confirmar' ? <TabPorConfirmar puedeEditar={puedeEditar} /> : (<>

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

                    <div className="flex justify-end min-w-0">
                        <FilterBar onClear={() => setDias('30')} activeCount={dias !== '30' ? 1 : 0}>
                            <FilterBar.Section active={dias !== '30'} onClear={() => setDias('30')} label="período">
                                <div style={{ width: '175px' }}>
                                    <LiquidSelect value={dias} onChange={v => setDias(v || '60')}
                                        options={PERIODOS} icon={CalendarRange} compact bare clearable={false} />
                                </div>
                            </FilterBar.Section>
                        </FilterBar>
                    </div>
                </div>

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

                <Notice variant="info" icon={PackagePlus} compact>
                    El portal arma la compra desde el documento —producto, cantidad, costo, lote y
                    vencimiento— y cada renglón dice de dónde salió su dato. <b>Todavía no registra
                    nada en el sistema</b>: es para revisarla. Lo que sí queda guardado es cada
                    producto que confirmes, y de ahí en adelante ese proveedor no vuelve a preguntar.
                    Toda compra entra a <b>Bodega</b>, y desde ahí el producto se mueve a las salas.
                </Notice>

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

            {sel && <Propuesta doc={sel} puedeEditar={puedeEditar} onCerrar={() => setSel(null)} />}
        </GlassViewLayout>
    );
}
