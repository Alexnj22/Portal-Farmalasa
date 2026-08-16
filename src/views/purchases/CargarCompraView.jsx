import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    PackagePlus, AlertTriangle, CheckCircle2, ScanBarcode, BookMarked,
    Search, HelpCircle, CalendarRange,
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
} from '../../data/cargarCompra';
import { formatMoney } from '../../utils/formatNumber';
import { normalizeText } from '../../utils/helpers';
import { useAuth } from '../../context/AuthContext';
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

const COLS = [
    { key: 'fecha',      label: 'Fecha',      align: 'left'   },
    { key: 'proveedor',  label: 'Proveedor',  align: 'left'   },
    { key: 'documento',  label: 'Documento',  align: 'left',   hideBelow: 'lg' },
    { key: 'renglones',  label: 'Renglones',  align: 'center', hideBelow: 'md' },
    { key: 'total',      label: 'Total',      align: 'right'  },
    { key: 'espera',     label: 'Esperando',  align: 'center' },
];

const PERIODOS = [
    { value: '30',  label: 'Últimos 30 días' },
    { value: '60',  label: 'Últimos 60 días' },
    { value: '180', label: 'Últimos 6 meses' },
];

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
                            <b>{faltan}</b> de {resumen.renglones} renglones necesitan un ojo:
                            {resumen.sin_producto > 0 && <> <b>{resumen.sin_producto}</b> sin producto,</>}
                            {' '}<b>{resumen.a_confirmar}</b> a confirmar,
                            {' '}<b>{resumen.sin_lote}</b> sin lote,
                            {' '}<b>{resumen.sin_vencimiento}</b> sin vencimiento.
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

/* ─── La vista ────────────────────────────────────────────────────────────── */
export default function CargarCompraView() {
    const { hasPermission } = useAuth();
    const puedeEditar = hasPermission('compras', 'can_edit')
        || hasPermission('facturas_compra', 'can_edit');

    const [filas, setFilas] = useState(null);
    const [error, setError] = useState('');
    const [busca, setBusca] = useState('');
    const [dias, setDias]   = useState('60');
    const [sel, setSel]     = useState(null);
    const [pagina, setPagina] = useState(1);
    const [porPagina, setPorPagina] = useState(PAGE_SIZE_OPTIONS[0]);

    const cargar = useCallback(async () => {
        const { filas: f, error: e } = await fetchDocumentosSinCargar(Number(dias));
        setError(e?.message ?? '');
        setFilas(f);
    }, [dias]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);
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
        <ViewTabBar tabs={[]} activeTab="" onTabChange={() => {}}
            searchValue={busca} onSearchChange={setBusca} showSearch
            placeholder="Buscar proveedor o número de documento…" />
    );

    return (
        <GlassViewLayout icon={PackagePlus} title="Cargar compra" filtersContent={filtersContent}>
            <div className="p-5 md:p-6 space-y-5">

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
                        <FilterBar onClear={() => setDias('60')} activeCount={dias !== '60' ? 1 : 0}>
                            <FilterBar.Section active={dias !== '60'} onClear={() => setDias('60')} label="período">
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
                </Notice>

                <DataTable columns={COLS} dense loading={filas === null}
                    empty={{ icon: CheckCircle2, message: 'Sin facturas esperando carga en este período' }}
                    movil={{ identidad: 'proveedor', ancla: 'total' }}>
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
            </div>

            {sel && <Propuesta doc={sel} puedeEditar={puedeEditar} onCerrar={() => setSel(null)} />}
        </GlassViewLayout>
    );
}
