import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import {
    TrendingUp, Coins, Percent, Receipt, AlertTriangle, Search, Download, Landmark, BookOpen, CalendarRange, Layers, Info, FileX2, ShoppingCart as ShoppingCartIcono, Archive, Loader2 } from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica, rangoDelMes, hoySV } from '@nucleo/utils/fecha';
import { exportCsv } from '@nucleo/utils/csvExport';
import { useToastStore } from '@nucleo/store/toastStore';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { usePestanaEnUrl } from '../../plataforma/usePestanaEnUrl';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { fetchUtilidad, fetchLibroCompras, fetchLibrosVentas, fetchRelacionadas } from '@nucleo/data/distribucionCompras';
import { armarPaqueteDelMes } from './paquete';
import { descargarArchivo } from '@plataforma/descargas';
import { registrarEgreso } from '@nucleo/data/egreso';
import FilterBar from '../../components/common/FilterBar';
import { PERIODOS, rangoDe } from './comun';
import { TIPOS_COMPRA } from './compras';
import {
    AGRUPAR_UTILIDAD, margen, mesesRecientes, totalesDelLibro, LIBROS_VENTAS, totalesContribuyente, totalesConsumidor, aniosRecientes, resumenFiscal,
    gruposDeUtilidad, filasRelacionadas, csvRelacionadas, archivoDeLibroDeVentas, archivoDeLibroDeCompras, listadosDeRetenciones, archivoDeRetencion,
} from './reportes';
import { TIPO_DOCUMENTO } from './comun';

// Reportes de la distribuidora (borrador 0016). Sólo quien administra: el
// costo es el margen de la empresa. La pestaña va en `?reporte=`.
//
//   · Utilidad — venta sin IVA contra el costo que se congeló al vender. Lo
//     que se vendió antes de que existiera el costo usa el promedio actual y
//     se marca «estimado»; lo que no tiene costo de ninguna forma queda FUERA
//     del margen y se dice cuánto es, en vez de contarlo con costo cero.
//   · Libro de compras — las compras recibidas del mes; el archivo sale con el
//     mismo generador de 23 columnas que el libro de las farmacias.

const GraficaUtilidadDiaria = lazy(() => import('./GraficasTablero').then(m => ({ default: m.GraficaUtilidadDiaria })));

const COLS_UTILIDAD = [
    { key: 'nombre',   label: 'Nombre',   align: 'left', className: 'w-[260px]' },
    { key: 'venta',    label: 'Venta',    align: 'right', hideBelow: 'sm' },
    { key: 'costo',    label: 'Costo',    align: 'right', hideBelow: 'lg' },
    { key: 'utilidad', label: 'Utilidad y margen', align: 'right' },
];
const COLS_LIBRO = [
    { key: 'fecha',      label: 'Fecha',      align: 'left' },
    { key: 'documento',  label: 'Proveedor',  align: 'left', className: 'w-[260px]' },
    { key: 'gravada',    label: 'Gravado',    align: 'right', hideBelow: 'md' },
    { key: 'iva',        label: 'Crédito fiscal', align: 'right', hideBelow: 'sm' },
    { key: 'percepcion', label: 'Percepción', align: 'right', hideBelow: 'lg' },
    { key: 'total',      label: 'Total',      align: 'right' },
];
const rotuloTipo = (t) => TIPOS_COMPRA.find(x => x.value === t)?.label ?? t;

function BarraMargen({ pct }) {
    if (pct === null) return <span className="text-caption text-content-3">—</span>;
    const tono = pct < 10 ? 'bg-danger' : pct < 20 ? 'bg-warning' : 'bg-success';
    return (
        <div className="w-32 flex items-center gap-2">
            <span className="flex-1 h-1.5 rounded-full bg-surface-card-hover overflow-hidden" data-medida="dato">
                <span className={`block h-full rounded-full ${tono}`} style={{ width: `${Math.max(3, Math.min(100, pct))}%` }} />
            </span>
            <span className="text-caption font-bold tabular-nums text-content-2 w-11 text-right">{pct.toFixed(1)}%</span>
        </div>
    );
}

function ReporteUtilidad({ buscar }) {
    const [periodo, setPeriodo] = usePestanaEnUrl(PERIODOS, '30d', 'periodo');
    const [agrupar, setAgrupar] = usePestanaEnUrl(AGRUPAR_UTILIDAD, 'producto', 'agrupar');
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            setDatos(await fetchUtilidad(rangoDe(periodo)));
        } catch (e) {
            console.error('utilidad', e);
            setError(mensajeDeDistribucion(e));
        } finally {
            setCargando(false);
        }
    }, [periodo]);
    useEffect(() => { cargar(); }, [cargar]);

    const r = datos?.resumen ?? {};
    const venta = Number(r.venta ?? 0);
    const costo = Number(r.costo ?? 0);
    const filas = useMemo(() => {
        return gruposDeUtilidad(datos, agrupar, buscar);
    }, [datos, agrupar, buscar]);
    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filas.length });
    useEffect(() => { setPage(1); }, [agrupar, periodo, buscar]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filas.slice((page - 1) * pageSize, page * pageSize);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de la utilidad">
                    <StatCard icon={Receipt} label="Venta sin IVA" value={formatMoney(venta)} loading={cargando}
                        iconBg="bg-brand/10" iconCls="text-brand-text"
                        sub={`${formatQty(Number(r.documentos ?? 0))} documentos${Number(r.devuelto) > 0 ? ` · ${formatMoney(Number(r.devuelto))} devuelto` : ''}`} />
                    <StatCard icon={Coins} label="Costo de lo vendido" value={formatMoney(costo)} loading={cargando}
                        iconBg="bg-chart-3/10" iconCls="text-chart-3" sub="Al costo del día de la venta" />
                    <StatCard icon={TrendingUp} label="Utilidad bruta" value={formatMoney(venta - costo)} loading={cargando}
                        iconBg="bg-success/10" iconCls="text-success" valueCls={venta - costo < 0 ? 'text-danger-text' : undefined} sub="Venta menos costo" />
                    <StatCard icon={Percent} label="Margen" value={margen(venta, costo) === null ? '—' : `${margen(venta, costo).toFixed(1)}%`} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" sub="Sobre la venta sin IVA" />
                </CarrilCards>
                <div className="flex justify-end min-w-0">
                    <FilterBar onClear={() => { setPeriodo('30d'); setAgrupar('producto'); }} activeCount={(periodo !== '30d' ? 1 : 0) + (agrupar !== 'producto' ? 1 : 0)}>
                        <FilterBar.Section active={periodo !== '30d'} onClear={() => setPeriodo('30d')} label="período">
                            <FilterBar.Opciones label="Período" icon={CalendarRange} value={periodo} onChange={(v) => setPeriodo(v || '30d')}
                                options={PERIODOS.map(p => ({ value: p.key, label: p.label }))} ancho="170px" />
                        </FilterBar.Section>
                        <FilterBar.Section active={agrupar !== 'producto'} onClear={() => setAgrupar('producto')} label="agrupar">
                            <FilterBar.Opciones label="Agrupar" icon={Layers} value={agrupar} onChange={(v) => setAgrupar(v || 'producto')}
                                options={AGRUPAR_UTILIDAD} ancho="170px" />
                        </FilterBar.Section>
                    </FilterBar>
                </div>
            </div>
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}


            {!cargando && Number(r.sin_costo) > 0 && (
                <Notice variant="warning" icon={AlertTriangle}>
                    {formatMoney(Number(r.sin_costo))} de venta son de {formatQty(Number(r.productos_sin_costo))} productos que todavía no
                    tienen costo (nunca entraron por una compra). No se cuentan en la utilidad: con costo cero la inflarían.
                </Notice>
            )}
            {!cargando && Number(r.estimado) > 0 && (
                <Notice variant="info" icon={Info}>
                    {formatMoney(Number(r.estimado))} de venta son de antes de que se guardara el costo al vender: usan el costo
                    promedio de hoy y se marcan «estimado».
                </Notice>
            )}

            {(datos?.por_dia?.length ?? 0) > 1 && (
                <section data-surface="card" className="p-4" aria-label="Utilidad por día">
                    <h3 className="text-body font-black text-content mb-2">Venta y utilidad por día</h3>
                    <Suspense fallback={<div className="h-[220px]" />}><GraficaUtilidadDiaria serie={datos.por_dia} /></Suspense>
                </section>
            )}

            <DataTable columns={COLS_UTILIDAD} movil={{ usarAccionDeFila: false }} loading={cargando} minWidth="320px"
                empty={buscar ? { icon: Search, message: 'Sin resultados', subtext: 'Nada coincide con la búsqueda.' }
                    : { icon: TrendingUp, message: 'Sin ventas', subtext: 'No hay ventas en el período.' }}>
                {pagina.map((g, i) => {
                    const pct = margen(g.venta, g.costo);
                    const util = Number(g.venta) - Number(g.costo);
                    return (
                        <DataRow key={`${g.por}-${g.clave}`} index={i}>
                            <DataCell>
                                <div className="min-w-0 max-w-[260px]">
                                    <p className="text-body-sm font-bold text-content-2 truncate" title={g.nombre}>{g.nombre}</p>
                                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                        <span className="text-caption text-content-3 tabular-nums">{formatQty(Number(g.unidades))} unidades</span>
                                        {g.estimado && <Badge size="sm" variant="info" uppercase={false}>estimado</Badge>}
                                        {Number(g.sin_costo) > 0 && <Badge size="sm" variant="warning" uppercase={false}>{formatMoney(Number(g.sin_costo))} sin costo</Badge>}
                                    </div>
                                </div>
                            </DataCell>
                            <DataCell align="right" hideBelow="sm"><span className="tabular-nums text-content-2">{formatMoney(Number(g.venta))}</span></DataCell>
                            <DataCell align="right" hideBelow="lg"><span className="tabular-nums text-content-3">{formatMoney(Number(g.costo))}</span></DataCell>
                            <DataCell align="right">
                                <div className="flex flex-col items-end gap-1">
                                    <span className={`tabular-nums font-black ${util < 0 ? 'text-danger-text' : 'text-content'}`}>{formatMoney(util)}</span>
                                    <BarraMargen pct={pct} />
                                </div>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
            {!cargando && filas.length > 0 && (
                <TablePagination pageSize={pageSize} onPageSizeChange={setPageSize} page={page} totalPages={totalPages}
                    onPageChange={setPage} total={filas.length} unit="filas" />
            )}
        </div>
    );
}

function LibroCompras({ buscar }) {
    const meses = useMemo(() => mesesRecientes(13), []);
    const [mes, setMes] = usePestanaEnUrl(meses, meses[0].key, 'mes');
    const paquete = usePaquete(mes);
    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            const [desde, hasta] = rangoDelMes(mes);
            setFilas(await fetchLibroCompras({ desde, hasta }));
        } catch (e) {
            console.error('libro de compras', e);
            setError(mensajeDeDistribucion(e));
        } finally {
            setCargando(false);
        }
    }, [mes]);
    useEffect(() => { cargar(); }, [cargar]);

    const t = useMemo(() => totalesDelLibro(filas), [filas]);
    const visibles = useMemo(() => {
        const q = (buscar ?? '').trim();
        return filas.filter(f => !q || tokenMatch(q, f.proveedor, f.numero, f.nit));
    }, [filas, buscar]);
    const fuera = filas.filter(f => !f.en_libro).length;

    const exportar = () => {
        const a = archivoDeLibroDeCompras(filas, mes);
        exportCsv(a.headers, a.rows, a.nombre, 'distribucion');
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Totales del libro de compras">
                    <StatCard icon={BookOpen} label="Compras gravadas" value={formatMoney(t.gravada)} loading={cargando}
                        iconBg="bg-brand/10" iconCls="text-brand-text" sub={`${formatQty(t.documentos)} Créditos Fiscales`} />
                    <StatCard icon={Landmark} label="Crédito fiscal" value={formatMoney(t.iva)} loading={cargando}
                        iconBg="bg-success/10" iconCls="text-success" sub="IVA acreditable del mes" />
                    <StatCard icon={Percent} label="Percepción" value={formatMoney(t.percepcion)} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" sub="Anticipo a cuenta de IVA" />
                    <StatCard icon={Receipt} label="Total" value={formatMoney(t.total)} loading={cargando}
                        iconBg="bg-chart-3/10" iconCls="text-chart-3" sub={t.exenta ? `${formatMoney(t.exenta)} exento` : 'Con IVA y percepción'} />
                </CarrilCards>
                <div className="flex justify-end min-w-0">
                    <FilterBar onClear={() => setMes(meses[0].key)} activeCount={mes !== meses[0].key ? 1 : 0}
                        acciones={[{ key: 'csv', icon: Download, label: 'Descargar CSV', onClick: exportar, disabled: cargando || t.documentos === 0 }, paquete]}>
                        <FilterBar.Section active={mes !== meses[0].key} onClear={() => setMes(meses[0].key)} label="mes">
                            <FilterBar.Opciones label="Mes" icon={CalendarRange} value={mes} onChange={(v) => setMes(v || meses[0].key)}
                                options={meses.map(m => ({ value: m.key, label: m.label }))} umbral={1} ancho="180px" />
                        </FilterBar.Section>
                    </FilterBar>
                </div>
            </div>
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            {!cargando && fuera > 0 && (
                <Notice variant="info" icon={Info}>
                    {fuera} compra{fuera === 1 ? '' : 's'} con Factura o Sujeto excluido se listan abajo pero no entran al libro: no dan crédito fiscal.
                </Notice>
            )}

            <DataTable columns={COLS_LIBRO} movil={{ usarAccionDeFila: false }} loading={cargando} minWidth="320px"
                empty={buscar ? { icon: Search, message: 'Sin resultados', subtext: 'Ninguna compra coincide con la búsqueda.' }
                    : { icon: BookOpen, message: 'Sin compras', subtext: 'No se recibió ninguna compra en este mes.' }}>
                {visibles.map((f, i) => (
                    <DataRow key={f.id} index={i}>
                        <DataCell><span className="text-caption tabular-nums text-content-2">{fechaNumerica(f.fecha)}</span></DataCell>
                        <DataCell>
                            <div className="min-w-0 max-w-[260px]">
                                <p className="text-body-sm font-bold text-content-2 truncate">{f.proveedor}</p>
                                <p className="text-caption text-content-3 truncate">{rotuloTipo(f.tipo_doc)} · {f.numero}{f.nit ? ` · NIT ${f.nit}` : ''}</p>
                                {!f.en_libro && <Badge size="sm" variant="neutral" uppercase={false}>Fuera del libro</Badge>}
                            </div>
                        </DataCell>
                        <DataCell align="right" hideBelow="md"><span className="tabular-nums text-content-2">{formatMoney(Number(f.gravada))}</span></DataCell>
                        <DataCell align="right" hideBelow="sm"><span className="tabular-nums text-content-2">{formatMoney(Number(f.iva))}</span></DataCell>
                        <DataCell align="right" hideBelow="lg"><span className="tabular-nums text-content-3">{formatMoney(Number(f.percepcion))}</span></DataCell>
                        <DataCell align="right"><span className="tabular-nums font-black text-content">{formatMoney(Number(f.total))}</span></DataCell>
                    </DataRow>
                ))}
            </DataTable>
        </div>
    );
}

// ── Libros de ventas (borrador 0021) ─────────────────────────────────────
// Sólo lo SELLADO entra; lo que falta enviar se dice arriba, para que nadie
// crea que el libro está completo. El archivo sale con el mismo generador de
// los libros de las farmacias (`construirLibro`).
const COLS_CONTRIB = [
    { key: 'fecha', label: 'Fecha', align: 'left' },
    { key: 'documento', label: 'Documento', align: 'left', className: 'w-[260px]' },
    { key: 'gravadas', label: 'Gravado', align: 'right', hideBelow: 'md' },
    { key: 'debito', label: 'Débito', align: 'right', hideBelow: 'sm' },
    { key: 'percibido', label: 'Percibido', align: 'right', hideBelow: 'lg' },
    { key: 'total', label: 'Total', align: 'right' },
];
const COLS_CONSUMIDOR = [
    { key: 'fecha', label: 'Día', align: 'left' },
    { key: 'rango', label: 'Del — al', align: 'left', className: 'w-[300px]' },
    { key: 'documentos', label: 'Documentos', align: 'right', hideBelow: 'sm' },
    { key: 'total', label: 'Total', align: 'right' },
];
const COLS_ANULADOS = [
    { key: 'documento', label: 'Documento', align: 'left', className: 'w-[260px]' },
    { key: 'anulado', label: 'Anulado el', align: 'left', hideBelow: 'sm' },
    { key: 'motivo', label: 'Motivo', align: 'left', hideBelow: 'md' },
    { key: 'total', label: 'Total', align: 'right' },
];

function LibrosVentas({ buscar }) {
    const meses = useMemo(() => mesesRecientes(13), []);
    const [mes, setMes] = usePestanaEnUrl(meses, meses[0].key, 'mes');
    const paquete = usePaquete(mes);
    const [libro, setLibro] = usePestanaEnUrl(LIBROS_VENTAS, 'contribuyente', 'libro');
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            const [desde, hasta] = rangoDelMes(mes);
            setDatos(await fetchLibrosVentas({ desde, hasta }));
        } catch (e) {
            console.error('libros de ventas', e);
            setError(mensajeDeDistribucion(e));
        } finally {
            setCargando(false);
        }
    }, [mes]);
    useEffect(() => { cargar(); }, [cargar]);

    const filas = useMemo(() => {
        const q = (buscar ?? '').trim();
        const base = datos?.[libro] ?? [];
        return !q ? base : base.filter(f => tokenMatch(q, f.cliente, f.numero_control, f.numero_control_del, f.numero_control_al));
    }, [datos, libro, buscar]);
    const tc = useMemo(() => totalesContribuyente(datos?.contribuyente), [datos]);
    const tf = useMemo(() => totalesConsumidor(datos?.consumidor), [datos]);
    const sinArchivo = (datos?.[libro] ?? []).some(f => f.sin_archivo);

    const exportar = () => {
        const a = archivoDeLibroDeVentas(libro, datos, mes);
        exportCsv(a.headers, a.rows, a.nombre, 'distribucion');
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" key={libro} ariaLabel={`Totales del libro: ${LIBROS_VENTAS.find(l => l.key === libro)?.label ?? ''}`}>
                    {libro === 'contribuyente' ? (<>
                            <StatCard icon={Receipt} label="Ventas gravadas" value={formatMoney(tc.gravadas)} loading={cargando}
                                iconBg="bg-brand/10" iconCls="text-brand-text" sub={`${formatQty(tc.documentos)} Créditos Fiscales${tc.notas ? ` · ${formatQty(tc.notas)} notas restan` : ''}`} />
                            <StatCard icon={Landmark} label="Débito fiscal" value={formatMoney(tc.debito)} loading={cargando}
                                iconBg="bg-success/10" iconCls="text-success" sub="IVA 13 % neto de notas" />
                            <StatCard icon={Percent} label="IVA percibido" value={formatMoney(tc.percibido)} loading={cargando}
                                iconBg="bg-warning/10" iconCls="text-warning" sub="Percepción 1 %" />
                            <StatCard icon={Percent} label="IVA retenido" value={formatMoney(tc.retenido)} loading={cargando}
                                iconBg="bg-chart-3/10" iconCls="text-chart-3" sub="No va en el libro: en la declaración" />
                    </>) : libro === 'consumidor' ? (<>
                            <StatCard icon={Receipt} label="Ventas del mes" value={formatMoney(tf.total)} loading={cargando}
                                iconBg="bg-brand/10" iconCls="text-brand-text" sub={`${formatQty(tf.documentos)} Facturas en ${formatQty(tf.dias)} días`} />
                            <StatCard icon={Landmark} label="IVA contenido" value={formatMoney(tf.debito)} loading={cargando}
                                iconBg="bg-success/10" iconCls="text-success" sub="Débito fiscal de consumidor final" />
                            <StatCard icon={Receipt} label="Exentas" value={formatMoney(tf.exentas)} loading={cargando}
                                iconBg="bg-chart-3/10" iconCls="text-chart-3" sub="Ventas exentas" />
                    </>) : (
                        <StatCard icon={FileX2} label="Documentos anulados" value={formatQty(filas.length)} loading={cargando}
                            iconBg="bg-danger/10" iconCls="text-danger" sub="Invalidados en el mes" />
                    )}
                </CarrilCards>
                <div className="flex justify-end min-w-0">
                    <FilterBar onClear={() => { setMes(meses[0].key); setLibro('contribuyente'); }} activeCount={mes !== meses[0].key ? 1 : 0}
                        acciones={[{ key: 'csv', icon: Download, label: 'Descargar CSV', onClick: exportar, disabled: cargando || !(datos?.[libro]?.length) }, paquete]}>
                        <FilterBar.Section label="libro">
                            <FilterBar.Opciones label="Libro" icon={BookOpen} value={libro} onChange={(v) => setLibro(v || 'contribuyente')}
                                options={LIBROS_VENTAS.map(l => ({ value: l.key, label: l.label, icon: l.icon }))} umbral={1} ancho="190px" />
                        </FilterBar.Section>
                        <FilterBar.Section active={mes !== meses[0].key} onClear={() => setMes(meses[0].key)} label="mes">
                            <FilterBar.Opciones label="Mes" icon={CalendarRange} value={mes} onChange={(v) => setMes(v || meses[0].key)}
                                options={meses.map(m => ({ value: m.key, label: m.label }))} umbral={1} ancho="180px" />
                        </FilterBar.Section>
                    </FilterBar>
                </div>
            </div>
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            {!cargando && Number(datos?.sin_sello?.documentos) > 0 && (
                <Notice variant="warning" icon={AlertTriangle} data-testid="libro-sin-sello">
                    {formatQty(Number(datos.sin_sello.documentos))} documentos del mes ({formatMoney(Number(datos.sin_sello.total))}) todavía no tienen sello de
                    Hacienda y no entran al libro. Envíalos desde Facturación antes de declarar.
                </Notice>
            )}
            {!cargando && sinArchivo && (
                <Notice variant="info" icon={Info}>Algunas filas son datos de muestra sin su archivo: sus montos se derivaron del total.</Notice>
            )}


            {libro === 'contribuyente' && (
                <DataTable columns={COLS_CONTRIB} movil={{ usarAccionDeFila: false }} loading={cargando} minWidth="320px"
                    empty={{ icon: BookOpen, message: 'Sin documentos', subtext: 'No hay Créditos Fiscales sellados este mes.' }}>
                    {filas.map((f, i) => (
                        <DataRow key={f.id} index={i}>
                            <DataCell><span className="text-caption tabular-nums text-content-2">{fechaNumerica(f.fecha)}</span></DataCell>
                            <DataCell>
                                <div className="min-w-0 max-w-[260px]">
                                    <p className="text-body-sm font-bold text-content-2 truncate">{f.cliente}</p>
                                    <p className="text-caption text-content-3 truncate">{TIPO_DOCUMENTO[f.tipo_dte]?.corto} · {f.numero_control} · NRC {f.nrc}</p>
                                </div>
                            </DataCell>
                            <DataCell align="right" hideBelow="md"><span className="tabular-nums text-content-2">{formatMoney(Number(f.ventas_gravadas))}</span></DataCell>
                            <DataCell align="right" hideBelow="sm"><span className="tabular-nums text-content-2">{formatMoney(Number(f.debito_fiscal))}</span></DataCell>
                            <DataCell align="right" hideBelow="lg"><span className="tabular-nums text-content-3">{formatMoney(Number(f.percibido))}</span></DataCell>
                            <DataCell align="right">
                                <span className={`tabular-nums font-black ${f.tipo_dte === '05' ? 'text-danger-text' : 'text-content'}`}>
                                    {f.tipo_dte === '05' ? '−' : ''}{formatMoney(Number(f.ventas_gravadas) + Number(f.ventas_exentas))}
                                </span>
                            </DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            )}
            {libro === 'consumidor' && (
                <DataTable columns={COLS_CONSUMIDOR} movil={{ usarAccionDeFila: false }} loading={cargando} minWidth="320px"
                    empty={{ icon: BookOpen, message: 'Sin ventas', subtext: 'No hay Facturas selladas este mes.' }}>
                    {filas.map((f, i) => (
                        <DataRow key={f.fecha} index={i}>
                            <DataCell><span className="text-caption tabular-nums text-content-2">{fechaNumerica(f.fecha)}</span></DataCell>
                            <DataCell>
                                <p className="text-caption font-mono text-content-3 truncate max-w-[300px]">{f.numero_control_del}</p>
                                <p className="text-caption font-mono text-content-3 truncate max-w-[300px]">{f.numero_control_al}</p>
                            </DataCell>
                            <DataCell align="right" hideBelow="sm"><span className="tabular-nums text-content-2">{formatQty(Number(f.documentos))}</span></DataCell>
                            <DataCell align="right"><span className="tabular-nums font-black text-content">{formatMoney(Number(f.total_diario))}</span></DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            )}
            {libro === 'anulados' && (
                <DataTable columns={COLS_ANULADOS} movil={{ usarAccionDeFila: false }} loading={cargando} minWidth="320px"
                    empty={{ icon: FileX2, message: 'Sin anulados', subtext: 'No se invalidó ningún documento este mes.' }}>
                    {filas.map((f, i) => (
                        <DataRow key={f.id} index={i}>
                            <DataCell>
                                <div className="min-w-0 max-w-[260px]">
                                    <p className="text-body-sm font-bold text-content-2 truncate">{f.cliente}</p>
                                    <p className="text-caption text-content-3 truncate">{TIPO_DOCUMENTO[f.tipo_dte]?.corto} · {f.numero_control}</p>
                                </div>
                            </DataCell>
                            <DataCell hideBelow="sm"><span className="text-caption tabular-nums text-content-2">{fechaNumerica(f.anulado_el)}</span></DataCell>
                            <DataCell hideBelow="md"><span className="text-caption text-content-2 truncate">{f.motivo ?? '—'}</span></DataCell>
                            <DataCell align="right"><span className="tabular-nums font-black text-content">{formatMoney(Number(f.total))}</span></DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            )}
        </div>
    );
}

// ── Compras a partes relacionadas (borrador 0022) ───────────────────────
// Lo que Torogoz le compró a empresas del grupo, con las referencias de precio
// de mercado y los mismos avisos que la compra. Es papel de trabajo para el
// contador: el F-982 y el margen los decide él.
const COLS_RELACIONADAS = [
    { key: 'producto', label: 'Producto', align: 'left', className: 'w-[240px]' },
    { key: 'pagado', label: 'Pagado c/u', align: 'right' },
    { key: 'costo', label: 'Costo Farmalasa', align: 'right', hideBelow: 'md' },
    { key: 'mayoreo', label: 'Mayoreo s/IVA', align: 'right', hideBelow: 'lg' },
    { key: 'venta', label: 'Venta Torogoz', align: 'right', hideBelow: 'lg' },
];

function ReporteRelacionadas({ buscar }) {
    const anios = useMemo(() => aniosRecientes(hoySV()), []);
    const [anio, setAnio] = usePestanaEnUrl(anios, anios[0].key, 'anio');
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            const hasta = anio === anios[0].key ? hoySV() : `${anio}-12-31`;
            setDatos(await fetchRelacionadas({ desde: `${anio}-01-01`, hasta }));
        } catch (e) {
            console.error('relacionadas', e);
            setError(mensajeDeDistribucion(e));
        } finally {
            setCargando(false);
        }
    }, [anio, anios]);
    useEffect(() => { cargar(); }, [cargar]);

    const filas = useMemo(() => {
        return filasRelacionadas(datos, buscar);
    }, [datos, buscar]);
    const conAviso = filas.filter(f => f.avisos.length).length;
    const r = datos?.resumen ?? {};

    const exportar = () => {
        const a = csvRelacionadas(filas, anio);
        exportCsv(a.headers, a.rows, a.nombre, 'distribucion');
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de compras a relacionadas">
                    <StatCard icon={ShoppingCartIcono} label="Comprado a relacionadas" value={formatMoney(Number(datos?.anio?.total ?? 0))} loading={cargando}
                        iconBg="bg-brand/10" iconCls="text-brand-text" sub={`${formatQty(Number(r.compras ?? 0))} compras en ${anio} (sin IVA)`} />
                    <StatCard icon={Landmark} label="IVA de esas compras" value={formatMoney(Number(r.iva ?? 0))} loading={cargando}
                        iconBg="bg-success/10" iconCls="text-success" sub="Crédito fiscal" />
                    <StatCard icon={AlertTriangle} label="Productos con aviso" value={formatQty(conAviso)} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" valueCls={conAviso ? 'text-warning-text' : undefined} sub="Precio fuera de lo razonable" />
                </CarrilCards>
                <div className="flex justify-end min-w-0">
                    <FilterBar onClear={() => setAnio(anios[0].key)} activeCount={anio !== anios[0].key ? 1 : 0}
                        acciones={[{ key: 'csv', icon: Download, label: 'Descargar CSV', onClick: exportar, disabled: cargando || !filas.length }]}>
                        <FilterBar.Section active={anio !== anios[0].key} onClear={() => setAnio(anios[0].key)} label="año">
                            <FilterBar.Opciones label="Año" icon={CalendarRange} value={anio} onChange={(v) => setAnio(v || anios[0].key)}
                                options={anios.map(a => ({ value: a.key, label: a.label }))} umbral={1} ancho="130px" />
                        </FilterBar.Section>
                    </FilterBar>
                </div>
            </div>
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            <Notice variant="info" icon={Info}>
                Entre empresas del mismo grupo el precio tiene que ser el de mercado, el que se le cobraría a un tercero. Si las operaciones con
                relacionadas del año superan el monto que fija el Código Tributario, se presenta el informe de precios de transferencia (F-982).
                El margen y si aplica el informe los confirma el contador.
            </Notice>
            <DataTable columns={COLS_RELACIONADAS} movil={{ usarAccionDeFila: false }} loading={cargando} minWidth="320px"
                empty={{ icon: Info, message: 'Sin compras a relacionadas', subtext: 'Marca al proveedor como «empresa relacionada» y sus compras aparecen aquí.' }}>
                {filas.map((f, i) => (
                    <DataRow key={f.product_id} index={i}>
                        <DataCell>
                            <div className="min-w-0 max-w-[240px]">
                                <p className="text-body-sm font-bold text-content-2 truncate" title={f.nombre}>{f.nombre}</p>
                                <p className="text-caption text-content-3">{formatQty(Number(f.unidades))} unidades · {formatMoney(Number(f.pagado))}</p>
                                {f.avisos.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1" data-aviso-precio={f.avisos[0].clave}>
                                        {f.avisos.map(a => <Badge key={a.clave} size="sm" variant={a.nivel} uppercase={false}>{a.texto}</Badge>)}
                                    </div>
                                )}
                            </div>
                        </DataCell>
                        <DataCell align="right"><span className="tabular-nums font-black text-content">{formatMoney(Number(f.pagado_u))}</span></DataCell>
                        <DataCell align="right" hideBelow="md"><span className="tabular-nums text-content-2">{f.ref?.costo_farmalasa ? formatMoney(Number(f.ref.costo_farmalasa)) : '—'}</span></DataCell>
                        <DataCell align="right" hideBelow="lg"><span className="tabular-nums text-content-2">{f.ref?.mayoreo_sin_iva ? formatMoney(Number(f.ref.mayoreo_sin_iva)) : '—'}</span></DataCell>
                        <DataCell align="right" hideBelow="lg"><span className="tabular-nums text-content-2">{f.ref?.precio_torogoz_sin_iva ? formatMoney(Number(f.ref.precio_torogoz_sin_iva)) : '—'}</span></DataCell>
                    </DataRow>
                ))}
            </DataTable>
        </div>
    );
}

// ── El paquete del mes: todo lo fiscal en un ZIP ──────────────────────────
// La acción «Paquete del mes» para la píldora: un descriptor (DESIGN §17 —
// las acciones son descriptores, no JSX) con su propio estado de carga.
function usePaquete(mes) {
    const showToast = useToastStore(s => s.showToast);
    const [armando, setArmando] = useState(false);
    const descargar = () => {
        setArmando(true);
        armarPaqueteDelMes(mes)
            .then(p => {
                if (!p) { showToast('Sin datos', 'No hay libros con datos en este mes.', 'warning'); return; }
                descargarArchivo(p.blob, p.nombre);
                registrarEgreso('distribucion', { formato: 'zip', filas: p.archivos, detalle: { mes, paquete: 'torogoz-mes' } });
                showToast('Paquete del mes', `${p.archivos} archivos${p.sinSello ? ` · ojo: ${p.sinSello} documentos sin sello quedaron fuera` : ''}`, p.sinSello ? 'warning' : 'success');
            })
            .catch(e => showToast('No se pudo armar el paquete', mensajeDeDistribucion(e), 'error'))
            .finally(() => setArmando(false));
    };
    return { key: 'paquete', icon: armando ? Loader2 : Archive, label: 'Paquete del mes', variant: 'primary', disabled: armando, onClick: descargar };
}

// ── Retenciones y percepciones ───────────────────────────────────────────
// Cuatro listados del mes, sacados de los libros de ventas y de compras: lo
// que nos retuvieron los clientes grandes, lo que percibimos a clientes, y lo
// que los proveedores nos percibieron o les retuvimos.
function ReporteRetenciones() {
    const meses = useMemo(() => mesesRecientes(13), []);
    const [mes, setMes] = usePestanaEnUrl(meses, meses[0].key, 'mes');
    const paquete = usePaquete(mes);
    const [ventas, setVentas] = useState(null);
    const [compras, setCompras] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            const [desde, hasta] = rangoDelMes(mes);
            const [v, c] = await Promise.all([fetchLibrosVentas({ desde, hasta }), fetchLibroCompras({ desde, hasta })]);
            setVentas(v); setCompras(c);
        } catch (e) {
            console.error('retenciones', e);
            setError(mensajeDeDistribucion(e));
        } finally {
            setCargando(false);
        }
    }, [mes]);
    useEffect(() => { cargar(); }, [cargar]);

    const r = useMemo(() => resumenFiscal({ tc: totalesContribuyente(ventas?.contribuyente), tf: totalesConsumidor(ventas?.consumidor), compras }), [ventas, compras]);
    const LISTADOS = useMemo(() => listadosDeRetenciones(ventas, compras), [ventas, compras]);

    const bajar = (clave) => {
        const a = archivoDeRetencion(LISTADOS.find(l => l.clave === clave), mes);
        exportCsv(a.headers, a.rows, a.nombre, 'distribucion');
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen fiscal del mes">
                    <StatCard icon={Landmark} label="Débito fiscal" value={formatMoney(r.debito)} loading={cargando}
                        iconBg="bg-brand/10" iconCls="text-brand-text" sub="Contribuyentes + consumidor final" />
                    <StatCard icon={Receipt} label="Crédito fiscal" value={formatMoney(r.credito)} loading={cargando}
                        iconBg="bg-success/10" iconCls="text-success" sub="De las compras del mes" />
                    <StatCard icon={Percent} label="Impuesto (referencial)" value={formatMoney(r.impuesto)} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" sub="Débito − crédito; lo liquida el contador" />
                </CarrilCards>
                <div className="flex justify-end min-w-0">
                    <FilterBar onClear={() => setMes(meses[0].key)} activeCount={mes !== meses[0].key ? 1 : 0} acciones={[paquete]}>
                        <FilterBar.Section active={mes !== meses[0].key} onClear={() => setMes(meses[0].key)} label="mes">
                            <FilterBar.Opciones label="Mes" icon={CalendarRange} value={mes} onChange={(v) => setMes(v || meses[0].key)}
                                options={meses.map(m => ({ value: m.key, label: m.label }))} umbral={1} ancho="180px" />
                        </FilterBar.Section>
                    </FilterBar>
                </div>
            </div>
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {LISTADOS.map(l => (
                    <section key={l.clave} data-surface="card" className="p-4 flex flex-col gap-2" aria-label={l.titulo} data-listado={l.clave}>
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <h3 className="text-body font-black text-content">{l.titulo}</h3>
                                <p className="text-caption text-content-3">{l.sub}</p>
                            </div>
                            <span className="text-title font-black tabular-nums text-content">{formatMoney(l.total)}</span>
                        </div>
                        {l.n === 0 ? <p className="text-caption text-content-3">Sin documentos este mes.</p> : (
                            <ul className="divide-y divide-divider text-body-sm">
                                {l.filas.slice(0, 6).map((f, i) => (
                                    <li key={i} className="py-1.5 flex items-center justify-between gap-2">
                                        <span className="min-w-0 truncate text-content-2">{f[0]} <span className="text-caption text-content-3 font-mono">{f[1]}</span></span>
                                        <span className={`tabular-nums font-bold ${Number(f[2]) < 0 ? 'text-danger-text' : ''}`}>{formatMoney(Number(f[2]))}</span>
                                    </li>
                                ))}
                                {l.n > 6 && <li className="py-1.5 text-caption text-content-3">y {l.n - 6} más en el archivo.</li>}
                            </ul>
                        )}
                        <div><Button size="sm" variant="secondary" icon={Download} disabled={!l.n} onClick={() => bajar(l.clave)}>Descargar CSV</Button></div>
                    </section>
                ))}
            </div>
        </div>
    );
}

export default function TabReportes({ buscar, vista = 'utilidad' }) {
    return (
        <div className="p-3 md:p-5">
            {vista === 'compras' ? <LibroCompras buscar={buscar} /> : vista === 'ventas' ? <LibrosVentas buscar={buscar} />
                : vista === 'relacionadas' ? <ReporteRelacionadas buscar={buscar} /> : vista === 'retenciones' ? <ReporteRetenciones />
                    : <ReporteUtilidad buscar={buscar} />}
        </div>
    );
}
