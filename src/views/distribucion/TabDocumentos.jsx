import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FileCheck2, AlertTriangle, Search, Clock, CheckCircle2, ShieldCheck, RefreshCw, Loader2, FileX2, XCircle, WifiOff, Mail, Send } from 'lucide-react';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { usePestanaEnUrl } from '../../plataforma/usePestanaEnUrl';
import { useNavigate } from 'react-router-dom';
import { fetchDocumentos, fetchDocumento, reintentarDocumento, enviarContingencia, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { enviarDocumentoPorCorreo } from './correo';
import DocumentoModal from './DocumentoModal';
import { ESTADO_DOCUMENTO, TIPO_DOCUMENTO, CUBETAS_FACTURACION as CUBETAS, revisionHacienda, pideAccion, selloValido } from './comun';
import { rutaVenta } from './rutas';

// Facturación de la distribuidora: el control con Hacienda. Pedido del usuario
// (2026-09-29): «una parte de facturación para ver, como en el portal, si hay
// algo pendiente, o mejor, llevar el control mucho más claro».
//
// Arriba, un semáforo que contesta la pregunta de una vez —¿está todo bien
// con Hacienda?—; debajo, las cubetas de lo que pide acción (tocar una
// filtra) y «Reenviar pendientes», que manda de a uno todo lo que quedó sin
// sello. Cada documento dice en su columna si tiene código y sello, y al
// abrirlo, la lista de chequeo completa con el botón de lo que toca.
//
// La cubeta vive en la dirección (`?cubeta=`), como toda pestaña del portal.

const COLS = [
    { key: 'documento', label: 'Documento', align: 'left', className: 'w-[200px]' },
    { key: 'cliente',   label: 'Cliente',   align: 'left', hideBelow: 'md' },
    { key: 'hacienda',  label: 'Hacienda',  align: 'left' },
    { key: 'fecha',     label: 'Emitido',   align: 'left', hideBelow: 'sm' },
    { key: 'total',     label: 'Total',     align: 'right' },
];

const esPorEnviar = (d) => revisionHacienda(d)?.accion === 'reenviar';

export default function TabDocumentos({ puedeVender, buscar }) {
    const navigate = useNavigate();
    const showToast = useToastStore(s => s.showToast);
    const [docs, setDocs] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [tipo, setTipo] = useState('');
    const [sub, setSub] = useState('');            // dentro de «Por resolver»: por_enviar | rechazados | invalidaciones
    const [abierto, setAbierto] = useState(null);
    const [reenvio, setReenvio] = useState(null);  // { hecho, total } mientras se reenvía en bloque
    const [avisoFirma, setAvisoFirma] = useState('');
    const [cubeta, setCubeta] = usePestanaEnUrl(CUBETAS, 'accion', 'cubeta');
    const pedidoRef = useRef(0);

    const cargar = useCallback(async () => {
        const mio = ++pedidoRef.current;
        setCargando(true);
        setError('');
        try {
            const r = await fetchDocumentos({ desde: sumarDias(hoySV(), -120) });
            if (mio === pedidoRef.current) setDocs(r);
        } catch (e) {
            if (mio !== pedidoRef.current) return;
            console.error('TabDocumentos', e);
            setError('No se pudieron cargar los documentos. Revisa la conexión e intenta de nuevo.');
        } finally {
            if (mio === pedidoRef.current) setCargando(false);
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const grupos = useMemo(() => {
        const accion = docs.filter(pideAccion);
        return {
            accion,
            porEnviar: accion.filter(esPorEnviar),
            rechazados: accion.filter(d => d.estado === 'rechazado'),
            invalidaciones: accion.filter(d => ['pendiente', 'rechazada'].includes(d.invalidacion_estado)),
            contingencia: accion.filter(d => d.estado === 'contingencia'),
            sellados: docs.filter(d => d.estado === 'sellado' && selloValido(d.sello_recibido)),
            vendido: docs.filter(d => d.estado === 'sellado' && (d.tipo === '01' || d.tipo === '03'))
                .reduce((a, d) => a + Number(d.total_pagar), 0),
            // Sellados que todavía no le llegaron al cliente (borrador 0019).
            sinEntregar: docs.filter(d => d.estado === 'sellado' && ['pendiente', 'fallido', 'sin_correo'].includes(d.correo?.[0]?.estado)),
        };
    }, [docs]);

    const filtrados = useMemo(() => {
        const q = buscar.trim();
        let base = cubeta === 'accion' ? grupos.accion
            : cubeta === 'sellados' ? grupos.sellados
            : cubeta === 'invalidados' ? docs.filter(d => d.estado === 'invalidado')
            : docs;
        if (cubeta === 'accion' && sub === 'por_enviar') base = grupos.porEnviar;
        if (cubeta === 'accion' && sub === 'rechazados') base = grupos.rechazados;
        if (cubeta === 'accion' && sub === 'invalidaciones') base = grupos.invalidaciones;
        return base.filter(d => (!tipo || d.tipo === tipo) && (!q || tokenMatch(q, d.dist_clientes?.nombre, d.numero_control, d.codigo_generacion)));
    }, [docs, grupos, cubeta, sub, buscar, tipo]);

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
    useEffect(() => { setPage(1); }, [buscar, cubeta, sub, tipo]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

    /** Reenvía, de a uno, todo lo que quedó sin sello. Se detiene si falta el certificado. */
    const reenviarPendientes = async () => {
        const lista = grupos.porEnviar;
        if (!lista.length) return;
        setAvisoFirma('');
        setReenvio({ hecho: 0, total: lista.length });
        const cuenta = { sellado: 0, rechazado: 0, pendiente: 0, error: 0 };
        for (const [i, d] of lista.entries()) {
            try {
                const r = await reintentarDocumento(d.id);
                if (r?.estado === 'sellado') cuenta.sellado += 1;
                else if (r?.estado === 'rechazado') cuenta.rechazado += 1;
                else cuenta.pendiente += 1;
                // Sin certificado no hay nada que reintentar: los demás darían lo mismo.
                if (r?.estado === 'sin_firmar' && /certificado/i.test(r?.aviso ?? '')) {
                    setAvisoFirma(r.aviso);
                    break;
                }
            } catch (e) {
                cuenta.error += 1;
                console.error('reenviar', d.id, e);
            }
            setReenvio({ hecho: i + 1, total: lista.length });
        }
        useStaff.getState().appendAuditLog('DISTRIBUCION_DTE_REENVIO_EN_BLOQUE', null, { total: lista.length, ...cuenta });
        setReenvio(null);
        showToast('Reenvío terminado',
            `${cuenta.sellado} recibidos por Hacienda · ${cuenta.rechazado} rechazados · ${cuenta.pendiente + cuenta.error} siguen pendientes`,
            cuenta.rechazado || cuenta.error ? 'warning' : 'success');
        cargar();
    };

    const [avisando, setAvisando] = useState(false);
    /** El aviso de contingencia de todo lo emitido sin poder transmitirlo. */
    const avisoContingencia = async () => {
        setAvisando(true);
        try {
            const r = await enviarContingencia();
            useStaff.getState().appendAuditLog('DISTRIBUCION_CONTINGENCIA_AVISO', null, { avisos: r?.avisos?.length ?? 0, sellados: r?.sellados });
            const rechazado = (r?.avisos ?? []).find(a => a.estado === 'rechazado');
            if (rechazado) showToast('Hacienda rechazó el aviso de contingencia', rechazado.mensaje ?? '', 'error');
            else showToast('Aviso de contingencia enviado', `${r?.sellados ?? 0} recibidos por Hacienda · ${r?.pendientes ?? 0} pendientes`, 'success');
        } catch (e) {
            setAvisoFirma(mensajeDeDistribucion(e));
        } finally {
            setAvisando(false);
            cargar();
        }
    };
    const sinAviso = grupos.contingencia.filter(d => !d.contingencia_id);

    const todoBien = !cargando && grupos.accion.length === 0;

    const [enviandoCorreos, setEnviandoCorreos] = useState(null); // { hecho, total }
    const enviables = grupos.sinEntregar.filter(d => d.correo?.[0]?.estado !== 'sin_correo');
    /** Manda, de a uno, los correos pendientes. Cada PDF se arma acá. */
    const enviarCorreos = async () => {
        if (!enviables.length) return;
        setEnviandoCorreos({ hecho: 0, total: enviables.length });
        let ok = 0, mal = 0;
        for (const [i, d] of enviables.entries()) {
            try {
                await enviarDocumentoPorCorreo(await fetchDocumento(d.id));
                ok += 1;
            } catch (e) {
                mal += 1;
                console.error('correo', d.id, e);
                // Sin proveedor configurado, los demás darían lo mismo.
                if (/configurar el correo/i.test(e?.message ?? '')) { setAvisoFirma(mensajeDeDistribucion(e)); break; }
            }
            setEnviandoCorreos({ hecho: i + 1, total: enviables.length });
        }
        useStaff.getState().appendAuditLog('DISTRIBUCION_DTE_CORREO_EN_BLOQUE', null, { total: enviables.length, ok, mal });
        setEnviandoCorreos(null);
        showToast('Correos enviados', `${ok} enviados${mal ? ` · ${mal} no se pudieron` : ''}`, mal ? 'warning' : 'success');
        cargar();
    };

    return (
        <div className="p-3 md:p-5 flex flex-col gap-4">
            {/* ── El semáforo: ¿está todo bien con Hacienda? ── */}
            {!cargando && !error && (
                <section data-testid="semaforo-hacienda" data-nivel={todoBien ? 'ok' : grupos.rechazados.length || grupos.invalidaciones.some(d => d.invalidacion_estado === 'rechazada') ? 'error' : 'pendiente'}
                    className={`rounded-2xl border p-4 flex flex-col md:flex-row md:items-center gap-3 ${todoBien ? 'border-success/40 bg-success/5' : grupos.rechazados.length ? 'border-danger/40 bg-danger/5' : 'border-warning/40 bg-warning/5'}`}>
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                        {todoBien
                            ? <ShieldCheck size={26} className="text-success-text shrink-0" />
                            : <AlertTriangle size={26} className={`${grupos.rechazados.length ? 'text-danger-text' : 'text-warning-text'} shrink-0`} />}
                        <div className="min-w-0">
                            <p className={`text-title font-black ${todoBien ? 'text-success-text' : grupos.rechazados.length ? 'text-danger-text' : 'text-warning-text'}`}>
                                {todoBien ? 'Todo al día con Hacienda' : `${formatQty(grupos.accion.length)} documento${grupos.accion.length === 1 ? '' : 's'} por resolver`}
                            </p>
                            <p className="text-caption text-content-2">
                                {todoBien
                                    ? `Los ${formatQty(grupos.sellados.length)} documentos de los últimos 120 días tienen código de generación y sello de recepción.`
                                    : [
                                        grupos.porEnviar.length && `${formatQty(grupos.porEnviar.length)} sin sello de Hacienda`,
                                        grupos.rechazados.length && `${formatQty(grupos.rechazados.length)} rechazado${grupos.rechazados.length === 1 ? '' : 's'} por corregir`,
                                        grupos.invalidaciones.length && `${formatQty(grupos.invalidaciones.length)} invalidación pendiente`,
                                        grupos.contingencia.length && `${formatQty(grupos.contingencia.length)} en contingencia`,
                                    ].filter(Boolean).join(' · ')}
                            </p>
                        </div>
                    </div>
                    {puedeVender && sinAviso.length > 0 && (
                        <Button variant="primary" icon={avisando ? Loader2 : WifiOff} disabled={avisando} onClick={avisoContingencia} data-aviso-contingencia>
                            {`Enviar aviso de contingencia (${formatQty(sinAviso.length)})`}
                        </Button>
                    )}
                    {puedeVender && grupos.porEnviar.length > 0 && (
                        <Button variant="primary" icon={reenvio ? Loader2 : RefreshCw} disabled={!!reenvio} onClick={reenviarPendientes} data-reenviar-todos>
                            {reenvio ? `Reenviando ${reenvio.hecho} de ${reenvio.total}…` : `Reenviar pendientes (${formatQty(grupos.porEnviar.length)})`}
                        </Button>
                    )}
                </section>
            )}
            {!cargando && !error && grupos.sinEntregar.length > 0 && (
                <Notice variant="warning" icon={Mail} data-testid="sin-entregar">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                            {formatQty(grupos.sinEntregar.length)} documento{grupos.sinEntregar.length === 1 ? '' : 's'} sellado{grupos.sinEntregar.length === 1 ? '' : 's'} todavía no le
                            {grupos.sinEntregar.length === 1 ? ' llegó' : ' llegaron'} al cliente por correo
                            {grupos.sinEntregar.length > enviables.length ? ` (${formatQty(grupos.sinEntregar.length - enviables.length)} sin correo en la ficha)` : ''}.
                        </span>
                        {puedeVender && enviables.length > 0 && (
                            <Button size="sm" variant="secondary" icon={enviandoCorreos ? Loader2 : Send} disabled={!!enviandoCorreos} onClick={enviarCorreos}>
                                {enviandoCorreos ? `Enviando ${enviandoCorreos.hecho} de ${enviandoCorreos.total}…` : `Enviar correos (${formatQty(enviables.length)})`}
                            </Button>
                        )}
                    </div>
                </Notice>
            )}
            {avisoFirma && (
                <Notice variant="warning" icon={AlertTriangle}>
                    {avisoFirma} Sin el certificado de la empresa no se puede firmar: hay que cargar las credenciales de Hacienda.
                </Notice>
            )}

            {/* ── Las cubetas: tocar una filtra la lista ── */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Qué falta con Hacienda">
                    <StatCard icon={Clock} label="Sin sello" value={formatQty(grupos.porEnviar.length)} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" valueCls={grupos.porEnviar.length ? 'text-warning-text' : undefined}
                        sub="Firmar o reenviar a Hacienda" active={cubeta === 'accion' && sub === 'por_enviar'} tono="warning"
                        onClick={() => { setCubeta('accion'); setSub(v => (v === 'por_enviar' ? '' : 'por_enviar')); }} />
                    <StatCard icon={XCircle} label="Rechazados" value={formatQty(grupos.rechazados.length)} loading={cargando}
                        iconBg="bg-danger/10" iconCls="text-danger" valueCls={grupos.rechazados.length ? 'text-danger-text' : undefined}
                        sub="Corregir y volver a facturar" active={cubeta === 'accion' && sub === 'rechazados'} tono="danger"
                        onClick={() => { setCubeta('accion'); setSub(v => (v === 'rechazados' ? '' : 'rechazados')); }} />
                    <StatCard icon={FileX2} label="Invalidaciones" value={formatQty(grupos.invalidaciones.length)} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" sub="Por enviar o rechazadas"
                        active={cubeta === 'accion' && sub === 'invalidaciones'} tono="warning"
                        onClick={() => { setCubeta('accion'); setSub(v => (v === 'invalidaciones' ? '' : 'invalidaciones')); }} />
                    <StatCard icon={CheckCircle2} label="Sellados" value={formatQty(grupos.sellados.length)} loading={cargando}
                        iconBg="bg-success/10" iconCls="text-success" sub={`${formatMoney(grupos.vendido)} vendidos · 120 días`}
                        active={cubeta === 'sellados'} tono="success" onClick={() => { setCubeta('sellados'); setSub(''); }} />
                </CarrilCards>
                <FilterBar onClear={() => setTipo('')} activeCount={tipo ? 1 : 0}>
                    <FilterBar.Section active={!!tipo} onClear={() => setTipo('')} label="tipo">
                        <FilterBar.Opciones value={tipo} onChange={v => setTipo(v || '')} label="Tipo" placeholder="Tipo"
                            options={Object.entries(TIPO_DOCUMENTO).map(([value, t]) => ({ value, label: t.largo }))} />
                    </FilterBar.Section>
                </FilterBar>
            </div>

            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            <DataTable
                columns={COLS}
                movil={{ usarAccionDeFila: true }}
                loading={cargando}
                minWidth="320px"
                empty={buscar || tipo
                    ? { icon: Search, message: 'Sin resultados', subtext: 'Ningún documento coincide con la búsqueda o el filtro.' }
                    : cubeta === 'accion'
                        ? { icon: ShieldCheck, message: 'Sin pendientes', subtext: 'Todo lo facturado está recibido por Hacienda.' }
                        : { icon: FileCheck2, message: 'Sin documentos', subtext: 'Se crean al facturar un pedido.' }}
            >
                {pagina.map((d, i) => {
                    const r = revisionHacienda(d);
                    const est = ESTADO_DOCUMENTO[d.estado];
                    const codigoOk = r.pasos.find(p => p.clave === 'codigo')?.ok;
                    const selloOk = r.pasos.find(p => p.clave === 'sello')?.ok;
                    return (
                        <DataRow key={d.id} index={i} onClick={() => setAbierto(d.id)}>
                            <DataCell>
                                <div className="min-w-0 max-w-[190px]">
                                    <p className="text-body-sm font-bold text-content-2 truncate">
                                        {TIPO_DOCUMENTO[d.tipo]?.largo}
                                        {d.ambiente === '00' && <span className="text-caption text-content-3 font-normal"> · prueba</span>}
                                    </p>
                                    <p className="font-mono text-caption text-content-3 truncate">{d.numero_control}</p>
                                </div>
                            </DataCell>
                            <DataCell hideBelow="md">
                                <span className="text-caption text-content-2 truncate block max-w-[200px]">{d.dist_clientes?.nombre ?? '—'}</span>
                            </DataCell>
                            <DataCell>
                                <div className="flex flex-col items-start gap-1">
                                    <Badge size="sm" variant={r.nivel === 'ok' ? 'success' : r.nivel === 'error' ? 'danger' : r.nivel === 'info' ? 'neutral' : 'warning'} uppercase={false}>
                                        {r.nivel === 'ok' ? 'Recibido' : r.nivel === 'info' ? (est?.label ?? r.titulo) : r.titulo}
                                    </Badge>
                                    <span className="text-micro text-content-3 flex items-center gap-2">
                                        <span className={codigoOk ? 'text-success-text' : 'text-danger-text'}>{codigoOk ? '✓' : '✗'} Código</span>
                                        <span className={selloOk ? 'text-success-text' : 'text-danger-text'}>{selloOk ? '✓' : '✗'} Sello</span>
                                        {d.intentos > 1 && <span>{d.intentos} envíos</span>}
                                        {est && d.estado !== 'sellado' && r.nivel !== 'error' && <span className="sr-only">{est.label}</span>}
                                    </span>
                                </div>
                            </DataCell>
                            <DataCell hideBelow="sm">
                                <span className="text-label text-content-2 tabular-nums">{fechaNumerica(d.fec_emi)}</span>
                            </DataCell>
                            <DataCell align="right">
                                <span className="tabular-nums font-bold text-content-2">{formatMoney(d.total_pagar)}</span>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            {!cargando && filtrados.length > 0 && (
                <TablePagination pageSize={pageSize} onPageSizeChange={setPageSize} page={page}
                    totalPages={totalPages} onPageChange={setPage} total={filtrados.length} unit="documentos" />
            )}

            {abierto && (
                <DocumentoModal id={abierto} puedeVender={puedeVender} onClose={() => setAbierto(null)}
                    onCambio={cargar}
                    onCorregirPedido={(pedidoId) => navigate(rutaVenta(pedidoId))} />
            )}
        </div>
    );
}
