import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Tag, CheckCircle2, XCircle, Clock, Loader2, ExternalLink, Inbox, Ban, Undo2 } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PortalTextarea from '../../components/common/PortalTextarea';
import SegmentedControl from '../../components/common/SegmentedControl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaHora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fetchSolicitudesDescuento, resolverSolicitudDistribucion, avisoDeDecision, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { rutaVenta } from './rutas';
import { ESTADO_SOLICITUD_DESCUENTO } from '@nucleo/utils/distribucionComercial';

// Las solicitudes de descuento de la distribuidora: el vendedor pide un
// descuento que no puede dar solo y la venta espera como preventa (borrador
// 0008). Vivían en Solicitudes del portal de las farmacias; desde que la
// distribuidora tiene su propia entrada, se deciden acá.
//
// Decidir lo hace `dist_resolver_descuento` en la base: aplica o descarta,
// firma, avisa al vendedor y no deja que quien pidió se lo apruebe. Acá se
// esconde el botón en ese caso para no ofrecer lo que la base va a rechazar.
//
// Desde la auditoría H3 llegan también las de INVALIDAR un documento sellado
// (corregirlo o deshacer la venta): el vendedor ya no invalida por su cuenta.
// Aprobarla la ejecuta en el servidor con el nombre de quien aprueba; la
// tarjeta dice antes qué pasa con el dinero (cuánto efectivo sale de la caja y
// cuánto queda a favor del cliente).

const ICONO_ESTADO = { PENDING: Clock, APPROVED: CheckCircle2, REJECTED: XCircle, CANCELLED: XCircle };
const ESTADO = Object.fromEntries(Object.entries(ESTADO_SOLICITUD_DESCUENTO).map(([k, v]) => [k, { ...v, icon: ICONO_ESTADO[k] }]));

const FILTROS = [
    { value: 'pendientes', label: 'Por decidir' },
    { value: 'resueltas', label: 'Resueltas' },
];

export default function SolicitudesDescuento() {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const { hasPermission, user } = useAuth();
    const puedeDecidir = hasPermission('requests_distribucion', 'can_approve');
    const showToast = useToastStore(s => s.showToast);

    const [filas, setFilas] = useState(null);
    const [error, setError] = useState('');
    const [rechazando, setRechazando] = useState(null); // id
    const [motivo, setMotivo] = useState('');
    const [ocupado, setOcupado] = useState(null);
    // La pestaña vive en la dirección (regla del portal): F5 no la pierde.
    const filtro = params.get('estado') === 'resueltas' ? 'resueltas' : 'pendientes';
    const destacada = params.get('solicitud');
    const refDestacada = useRef(null);

    const cargar = useCallback(async () => {
        setError('');
        try {
            setFilas(await fetchSolicitudesDescuento());
        } catch (e) {
            console.error('SolicitudesDescuento: cargar', e);
            setError('No se pudieron cargar las solicitudes. Revisa la conexión e intenta de nuevo.');
            setFilas([]);
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    // El aviso trae `?solicitud=`: se muestra en su lista y se lleva a la vista.
    useEffect(() => {
        if (!destacada || !filas) return;
        const fila = filas.find(f => String(f.id) === destacada);
        if (fila && (fila.status === 'PENDING') !== (filtro === 'pendientes')) {
            const p = new URLSearchParams(params);
            p.set('estado', fila.status === 'PENDING' ? 'pendientes' : 'resueltas');
            setParams(p, { replace: true });
            return;
        }
        refDestacada.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [destacada, filas, filtro, params, setParams]);

    const cambiarFiltro = (v) => {
        const p = new URLSearchParams(params);
        p.set('estado', v);
        p.delete('solicitud');
        setParams(p, { replace: true });
    };

    const decidir = async (fila, aprobar) => {
        setOcupado(`${fila.id}-${aprobar ? 'a' : 'r'}`);
        try {
            const r = await resolverSolicitudDistribucion(fila.id, fila.type, aprobar, aprobar ? null : motivo);
            const aviso = avisoDeDecision(fila.type, fila.metadata?.accion, aprobar, r);
            showToast(aviso.titulo, aviso.texto, aviso.tono);
            setRechazando(null);
            setMotivo('');
            await cargar();
        } catch (e) {
            showToast(aprobar ? 'No se aprobó' : 'No se rechazó', mensajeDeDistribucion(e), 'error');
        } finally {
            setOcupado(null);
        }
    };

    const visibles = (filas ?? []).filter(f => (filtro === 'pendientes' ? f.status === 'PENDING' : f.status !== 'PENDING'));
    const pendientes = (filas ?? []).filter(f => f.status === 'PENDING').length;

    return (
        <div className="p-4 md:p-6 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <SegmentedControl value={filtro} onChange={cambiarFiltro}
                    options={FILTROS.map(f => (f.value === 'pendientes' && pendientes ? { ...f, label: `${f.label} · ${pendientes}` } : f))} />
                {!puedeDecidir && (
                    <p className="text-caption text-content-3">Ves las que pediste. Las decide quien tiene permiso para aprobar solicitudes de Distribución.</p>
                )}
            </div>
            {error && <Notice variant="danger">{error}</Notice>}
            {filas === null && <p className="text-caption text-content-3">Cargando…</p>}
            {filas !== null && visibles.length === 0 && !error && (
                <div data-surface="card" className="p-10 flex flex-col items-center gap-2 text-center">
                    <Inbox size={28} className="text-content-3" />
                    <p className="text-body-sm font-bold text-content-2">
                        {filtro === 'pendientes' ? 'No hay solicitudes esperando decisión' : 'Todavía no hay solicitudes resueltas'}
                    </p>
                </div>
            )}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {visibles.map(f => {
                    const m = f.metadata ?? {};
                    const est = ESTADO[f.status] ?? ESTADO.PENDING;
                    const mia = user?.id && f.employee_id === user.id;
                    const renglones = Array.isArray(m.renglones) ? m.renglones : [];
                    const esDestacada = destacada && String(f.id) === destacada;
                    const invalida = f.type === 'DIST_INVALIDACION';
                    return (
                        <article key={f.id} ref={esDestacada ? refDestacada : undefined} data-surface="card"
                            className={`p-4 flex flex-col gap-3 ${esDestacada ? 'ring-2 ring-brand/45' : ''}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-body font-black text-content truncate">{m.cliente || 'Cliente'}</p>
                                    <p className="text-caption text-content-3">
                                        {invalida ? `${m.accion === 'corregir' ? 'Corregir' : 'Deshacer'} ${m.numero_control ?? ''}` : `Venta ${m.pedido_id}`}
                                        {' '}· pidió {shortEmployeeName(f.solicitante?.name) || '—'} · {fechaHora12(f.created_at)}
                                    </p>
                                </div>
                                <Badge size="sm" variant={est.variant} icon={est.icon} uppercase={false}>{est.label}</Badge>
                            </div>

                            {invalida ? (
                                <div className="rounded-xl border border-divider overflow-hidden">
                                    <div className="flex items-baseline justify-between gap-3 px-3 py-2 border-b border-divider">
                                        <span className="text-caption text-content-3 flex items-center gap-1.5">
                                            {m.accion === 'corregir' ? <Undo2 size={12} /> : <Ban size={12} />}
                                            {m.tipo_documento === '03' ? 'Crédito Fiscal' : 'Factura'} · total del documento
                                        </span>
                                        <span className="text-body font-black text-content tabular-nums">{formatMoney(m.total)}</span>
                                    </div>
                                    {m.accion === 'corregir' ? (
                                        <p className="px-3 py-2 text-caption text-content-3">
                                            Se abre una venta nueva con lo mismo; al facturarla, ésta se invalida ante Hacienda con tu nombre.
                                            {Number(m.abonado) > 0 ? ` Lo abonado (${formatMoney(m.abonado)}) pasa a la cuenta nueva.` : ''}
                                        </p>
                                    ) : (<>
                                        <div className="flex items-baseline justify-between gap-3 px-3 py-2 border-b border-divider">
                                            <span className="text-caption text-content-3">Efectivo que se le devuelve (sale de la caja del vendedor)</span>
                                            <span className="text-body-sm font-black text-content-2 tabular-nums">{formatMoney(m.devolver_efectivo ?? 0)}</span>
                                        </div>
                                        <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                                            <span className="text-caption text-content-3">Queda a favor del cliente (tarjeta, transferencia, cheque)</span>
                                            <span className="text-body-sm font-black text-content-2 tabular-nums">{formatMoney(m.a_favor ?? 0)}</span>
                                        </div>
                                    </>)}
                                </div>
                            ) : (
                            <div className="rounded-xl border border-divider overflow-hidden">
                                {renglones.map((r, i) => (
                                    <div key={i} className="flex items-start justify-between gap-3 px-3 py-2 border-b border-divider last:border-b-0">
                                        <div className="min-w-0">
                                            <p className="text-body-sm font-bold text-content-2 truncate">{r?.descripcion}</p>
                                            <p className="text-caption text-content-3 tabular-nums">{Number(r?.cantidad)} × {formatMoney(r?.precio)} con IVA</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-body-sm font-black text-content-2 tabular-nums">−{formatMoney(r?.descuento)}</p>
                                            {r?.pct != null && <p className="text-caption text-content-3 tabular-nums">{Number(r.pct)}%</p>}
                                        </div>
                                    </div>
                                ))}
                                <div className="flex items-baseline justify-between gap-3 px-3 py-2 bg-surface-card-hover/40">
                                    <span className="text-caption text-content-3 flex items-center gap-1.5">
                                        <Tag size={12} /> Descuento pedido{m.tope_pct != null ? ` · tope ${Number(m.tope_pct)}%` : ''}
                                    </span>
                                    <span className="text-body font-black text-brand-text tabular-nums">{formatMoney(m.total)}</span>
                                </div>
                            </div>
                            )}

                            {f.note && <p className="text-body-sm text-content-2"><span className="text-content-3">Motivo: </span>«{f.note}»</p>}
                            {f.status !== 'PENDING' && (
                                <p className="text-caption text-content-3">
                                    {est.label} por {shortEmployeeName(f.decidio?.name) || '—'} · {fechaHora12(f.updated_at)}
                                    {f.approver_note ? ` — «${f.approver_note}»` : ''}
                                </p>
                            )}

                            {rechazando === f.id && (
                                <PortalTextarea label="¿Por qué se rechaza? (lo lee el vendedor)" name={`motivo-${f.id}`} value={motivo}
                                    rows={2} compact onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: pasa del margen de este producto" />
                            )}

                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => navigate(rutaVenta(m.pedido_id))}>Ver la venta</Button>
                                {f.status === 'PENDING' && puedeDecidir && !mia && (rechazando === f.id ? (
                                    <>
                                        <Button size="sm" variant="ghost" onClick={() => { setRechazando(null); setMotivo(''); }}>Cancelar</Button>
                                        <Button size="sm" variant="danger" icon={ocupado === `${f.id}-r` ? Loader2 : XCircle}
                                            disabled={!motivo.trim() || !!ocupado} onClick={() => decidir(f, false)}>Rechazar</Button>
                                    </>
                                ) : (
                                    <>
                                        <Button size="sm" variant="secondary" icon={XCircle} disabled={!!ocupado}
                                            onClick={() => { setRechazando(f.id); setMotivo(''); }}>Rechazar</Button>
                                        <Button size="sm" variant="primary" icon={ocupado === `${f.id}-a` ? Loader2 : CheckCircle2}
                                            disabled={!!ocupado} onClick={() => decidir(f, true)}>Aprobar</Button>
                                    </>
                                ))}
                                {f.status === 'PENDING' && mia && puedeDecidir && (
                                    <span className="text-caption text-content-3">La pediste tú: la decide otra persona.</span>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>
        </div>
    );
}
