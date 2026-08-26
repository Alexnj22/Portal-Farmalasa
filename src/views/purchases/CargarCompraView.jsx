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
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination, { PAGE_SIZE_OPTIONS } from '../../components/common/TablePagination';
import {
    fetchDocumentosSinCargar, fetchPropuesta, confirmarProducto, buscarProductos,
    fetchProductosPorConfirmar, barrerDocumentos, apartarRenglon,
} from '../../data/cargarCompra';
import { formatMoney } from '../../utils/formatNumber';
import { normalizeText } from '../../utils/helpers';
import { useAuth } from '../../context/AuthContext';
import { usePestanaEnUrl } from '../../hooks/usePestanaEnUrl';
import { useStaffStore } from '../../store/staffStore';

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

const fmtFecha = (iso) => {
    if (!iso) return '—';
    const [a, m, d] = String(iso).split('-');
    return `${d}/${m}/${a.slice(2)}`;
};

/* ─── Elegir el producto a mano ────────────────────────────────────────────── */
function BuscadorProducto({ onElegir, onCancelar }) {
    const [q, setQ] = useState('');
    const [res, setRes] = useState([]);

    useEffect(() => {
        let vivo = true;
        const t = setTimeout(async () => {
            const { filas } = await buscarProductos(q);
            if (vivo) setRes(filas);
        }, 250);
        return () => { vivo = false; clearTimeout(t); };
    }, [q]);

    return (
        <div className="mt-2 space-y-2">
            <PortalInput value={q} onChange={e => setQ(e.target.value)} tono="brand"
                placeholder="Buscar el producto por nombre…" aria-label="Buscar producto" />
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
function Propuesta({ doc, puedeEditar, onCerrar }) {
    const [p, setP]           = useState(null);
    const [error, setError]   = useState('');
    // Lo que la persona corrigió acá: {codigo_proveedor: {product_id, nombre}}
    const [elegidos, setEleg] = useState({});
    const [buscando, setBusc] = useState(null);
    const [guardando, setG]   = useState(null);

    const cargar = useCallback(async () => {
        setP(null); setError('');
        const { propuesta, error: e } = await fetchPropuesta(doc.document_id);
        if (e) { setError(e); return; }
        setP(propuesta);
    }, [doc.document_id]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);

    const confirmar = async (renglon, producto) => {
        setG(renglon.codigo_proveedor);
        const { error: e } = await confirmarProducto(
            p.documento.emisor_nit, renglon.codigo_proveedor, producto.id);
        setG(null);
        if (e) { setError(e); return; }
        setEleg(x => ({ ...x, [renglon.codigo_proveedor]: { product_id: producto.id, nombre: producto.nombre } }));
        setBusc(null);
        useStaffStore.getState().appendAuditLog('COMPRA_ALIAS_CONFIRMADO', String(producto.id), {
            proveedor: p.documento.emisor, codigo: renglon.codigo_proveedor, producto: producto.nombre,
        });
    };

    const resumen = p?.resumen;
    const faltan = (p?.renglones ?? []).filter(r => r.falta.length > 0).length;

    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-5xl"
            ariaLabel={`Compra propuesta de ${doc.emisor_nombre}`}>
            <LiquidModal.Header>
                <div className="flex items-center gap-3 min-w-0">
                    <PackagePlus size={18} className="text-brand-text shrink-0" />
                    <div className="min-w-0">
                        <p className="text-body font-black text-content truncate">{doc.emisor_nombre}</p>
                        <p className="text-micro text-content-3">
                            {fmtFecha(doc.fecha_emision)} · {formatMoney(doc.monto_total)}
                            {resumen && ` · ${resumen.renglones} renglones`}
                        </p>
                    </div>
                </div>
            </LiquidModal.Header>

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

                    {/* Lo que hay que mirar antes de nada. */}
                    {faltan > 0 && (
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
                    {faltan === 0 && (
                        <Notice variant="success" icon={CheckCircle2}>
                            Los {resumen.renglones} renglones están completos.
                        </Notice>
                    )}

                    <div className="flex flex-col gap-2 mt-3">
                        {p.renglones.map((r, i) => {
                            const elegido = elegidos[r.codigo_proveedor];
                            const o = ORIGEN[elegido ? 'aprendido' : r.match_origen] ?? null;
                            const Icono = o?.icon ?? HelpCircle;
                            return (
                                <div key={`${r.codigo_proveedor}-${i}`} data-surface="card" className="px-3 py-2.5">
                                    <div className="flex items-start gap-3 flex-wrap">
                                        <div className="flex-1 min-w-[14rem]">
                                            <p className="text-label font-black text-content">
                                                {elegido?.nombre ?? r.producto ?? '— sin producto —'}
                                            </p>
                                            <p className="text-micro text-content-3">{r.descripcion}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-label font-black text-content tabular-nums">
                                                {r.cantidad} × {formatMoney(r.costo)}
                                            </p>
                                            <p className="text-micro text-content-3">
                                                {r.lote ? `lote ${r.lote}` : 'sin lote'}
                                                {' · '}
                                                {r.vence ? `vence ${r.vence.slice(0, 7)}` : 'sin vencimiento'}
                                            </p>
                                        </div>
                                        <div className="shrink-0 flex items-center gap-2">
                                            {o && (
                                                <Badge variant={elegido ? 'success' : o.variant} size="sm">
                                                    <Icono size={11} className="mr-1 inline" />
                                                    {elegido ? 'Confirmado' : o.label}
                                                    {r.match_origen === 'parecido' && !elegido && r.match_similitud != null
                                                        && ` · ${Math.round(r.match_similitud * 100)}%`}
                                                </Badge>
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
                                                    onClick={() => confirmar(r, { id: r.producto_id, nombre: r.producto })}>
                                                    Es correcto
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    {buscando === r.codigo_proveedor && (
                                        <BuscadorProducto
                                            onElegir={(prod) => confirmar(r, prod)}
                                            onCancelar={() => setBusc(null)} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>)}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex items-center gap-2 w-full">
                    <p className="text-micro text-content-3 flex-1">
                        Esto no registra nada todavía: es la compra armada para revisarla.
                    </p>
                    <Button size="sm" variant="ghost" onClick={onCerrar}>Cerrar</Button>
                </div>
            </LiquidModal.Footer>
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
        const { error: e } = await confirmarProducto(fila.emisor_nit, fila.llave, producto.id);
        setG(null);
        if (e) { setError(e); return; }
        setBusc(null);
        useStaffStore.getState().appendAuditLog('COMPRA_ALIAS_CONFIRMADO', String(producto.id), {
            proveedor: fila.proveedor, codigo: fila.llave, producto: producto.nombre,
            renglones: fila.renglones,
        });
        await cargar();
    };

    // Un clic. No pregunta por qué: eran dos decisiones por cada flete, que es
    // justo lo que uno quiere sacarse de encima rápido. Se sigue sabiendo quién
    // y cuándo —la base lo guarda y acá queda en la bitácora—, y lo apartado se
    // revisa con el filtro «No son productos», no leyendo motivos.
    const apartar = async (fila) => {
        setG(fila.id);
        const { error: e } = await apartarRenglon(fila.id, false);
        setG(null);
        if (e) { setError(e); return; }
        useStaffStore.getState().appendAuditLog('COMPRA_RENGLON_APARTADO', String(fila.id), {
            proveedor: fila.proveedor, codigo: fila.codigo_proveedor,
            descripcion: fila.descripcion, renglones: fila.renglones,
        });
        await cargar();
    };

    const visibles = useMemo(() => {
        const q = normalizeText(busca.trim());
        if (!q) return filas ?? [];
        return (filas ?? []).filter(f =>
            normalizeText(f.proveedor || '').includes(q)
            || normalizeText(f.descripcion || '').includes(q)
            || normalizeText(f.codigo_proveedor || '').includes(q)
            || normalizeText(f.sugerido_nombre || '').includes(q));
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
                                            const { error: e } = await apartarRenglon(f.id, true);
                                            setG(null);
                                            if (e) { setError(e); return; }
                                            useStaffStore.getState().appendAuditLog(
                                                'COMPRA_RENGLON_DEVUELTO', String(f.id),
                                                { proveedor: f.proveedor, codigo: f.codigo_proveedor });
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
        const q = normalizeText(busca.trim());
        if (!q) return filas ?? [];
        return (filas ?? []).filter(f =>
            normalizeText(f.emisor_nombre || '').includes(q)
            || normalizeText(f.proveedor_ficha || '').includes(q)
            || normalizeText(f.codigo_generacion || '').includes(q));
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
