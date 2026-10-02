import React, { useCallback, useEffect, useState } from 'react';
import { Users, CalendarCheck, Phone, Clock, Copy, ExternalLink, QrCode, Tablet, AlertTriangle, RefreshCw } from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import QrDeCaptura from '../../components/common/QrDeCaptura';
import { LoadingState } from '../../components/common/StateViews';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { formatPct } from '@nucleo/utils/formatNumber';
import { canalDe, metaTotal } from '@nucleo/utils/encuestasClientes';
import { fetchAvance } from '@nucleo/data/encuestasClientes';
import IncentivosEncuesta from './IncentivosEncuesta';

/**
 * Cómo va la encuesta en campo: respuestas contra la meta, por sucursal y por
 * canal, y el QR de cada sucursal para imprimir o compartir.
 *
 * Los RESULTADOS (NPS, dimensiones, comentarios) son la fase 4: acá sólo se
 * cuenta, para saber si la muestra se está llenando.
 */
export default function AvanceEncuesta({ encuesta, puedeEditar }) {
    const showToast = useToastStore((s) => s.showToast);
    const [avance, setAvance] = useState(null);
    const [error, setError] = useState(null);
    const [qrAbierto, setQrAbierto] = useState(null);

    const cargar = useCallback(async () => {
        try {
            setAvance(await fetchAvance(encuesta.id));
            setError(null);
        } catch (err) {
            setError(err);
        }
    }, [encuesta.id]);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga del avance

    if (!['publicada', 'cerrada'].includes(encuesta.estado)) {
        return <Notice variant="info" compact>El avance y los códigos QR aparecen cuando la encuesta se publica.</Notice>;
    }
    if (error) return <Notice variant="danger" icon={AlertTriangle}>{mensajeAmigable(error, 'No se pudo cargar el avance.')}</Notice>;
    if (!avance) return <LoadingState label="Contando respuestas…" />;

    const enlace = (token, tablet) => `${window.location.origin}/e/${token}${tablet ? '?modo=tablet' : ''}`;
    const copiar = async (texto) => {
        try {
            await navigator.clipboard.writeText(texto);
            showToast('Enlace copiado', null, 'success');
        } catch {
            showToast('No se pudo copiar', texto, 'error');
        }
    };
    const meta = metaTotal(encuesta, avance.por_sucursal);
    const publica = encuesta.estado === 'publicada';
    const conQr = encuesta.canales.includes('qr');
    const conTablet = encuesta.canales.includes('kiosco');

    return (
        <div className="space-y-5">
            <div className="flex items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Avance de la encuesta">
                    <StatCard icon={Users} label="Respuestas" value={avance.total}
                        sub={meta ? `de ${meta} · ${formatPct((avance.total / meta) * 100, { decimales: 0 })}` : 'Sin meta'} />
                    <StatCard icon={CalendarCheck} label="Hoy" value={avance.hoy} sub="Respuestas de hoy" />
                    <StatCard icon={Phone} label="Con datos" value={avance.con_contacto}
                        sub="Dejaron teléfono o nombre" />
                    <StatCard icon={Clock} label="Última"
                        value={avance.ultima ? hora12(avance.ultima) : '—'}
                        sub={avance.ultima ? fechaTexto(avance.ultima, { day: 'numeric', month: 'short' }) : 'Sin respuestas'} />
                </CarrilCards>
                <Button variant="ghost" iconOnly icon={RefreshCw} title="Actualizar" onClick={cargar} />
            </div>

            <section data-surface="card" className="p-4 space-y-3">
                <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">Por sucursal</h3>
                <ul className="space-y-3">
                    {avance.por_sucursal.map((s) => {
                        const cuota = encuesta.alcance === 'sucursales' ? s.meta : null;
                        const pct = cuota ? Math.min(100, (s.respuestas / cuota) * 100) : null;
                        return (
                            <li key={s.branch_id} className="space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-body-sm font-semibold text-content flex-1 min-w-0">{s.nombre}</span>
                                    <span className="text-body-sm text-content-2">
                                        {s.respuestas}{cuota ? ` de ${cuota}` : ''}
                                    </span>
                                    {publica && (conQr || conTablet) && (
                                        <Button variant="ghost" size="sm" icon={QrCode}
                                            onClick={() => setQrAbierto((a) => (a === s.branch_id ? null : s.branch_id))}>
                                            {qrAbierto === s.branch_id ? 'Ocultar' : 'QR y enlace'}
                                        </Button>
                                    )}
                                </div>
                                {pct != null && (
                                    <div className="h-2 rounded-full bg-surface-card-hover overflow-hidden" data-medida="dato">
                                        <div className={`h-full ${pct >= 100 ? 'bg-success' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
                                    </div>
                                )}
                                {qrAbierto === s.branch_id && (
                                    <div className="grid sm:grid-cols-[auto_1fr] gap-4 items-start rounded-xl bg-surface-card-hover p-3">
                                        {conQr && (
                                            <div className="w-44">
                                                <QrDeCaptura enlace={enlace(s.token)} leyenda={`Encuesta · ${s.nombre}`} />
                                            </div>
                                        )}
                                        <div className="space-y-2 min-w-0">
                                            {conQr && (
                                                <LineaEnlace etiqueta="Enlace para el cliente (QR, ticket, mensaje)" url={enlace(s.token)} onCopiar={copiar} />
                                            )}
                                            {conTablet && (
                                                <LineaEnlace etiqueta="Tablet de la sala (vuelve a empezar sola)" icono={Tablet}
                                                    url={enlace(s.token, true)} onCopiar={copiar} />
                                            )}
                                        </div>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </section>

            <section data-surface="card" className="p-4 space-y-2">
                <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">Por canal</h3>
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                    {encuesta.canales.map((c) => (
                        <span key={c} className="text-body-sm text-content-2">
                            {canalDe(c).label}: <strong className="text-content">{avance.por_canal?.[c] || 0}</strong>
                        </span>
                    ))}
                </div>
            </section>
            {encuesta.incentivo_tipo !== 'ninguno' && <IncentivosEncuesta encuesta={encuesta} puedeEditar={puedeEditar} />}
        </div>
    );
}

function LineaEnlace({ etiqueta, url, icono: Icono, onCopiar }) {
    return (
        <div className="space-y-1">
            <p className="text-micro font-semibold text-content-3 flex items-center gap-1">{Icono && <Icono size={12} />}{etiqueta}</p>
            <div className="flex items-center gap-1">
                <code className="text-micro text-content-2 truncate flex-1 min-w-0">{url}</code>
                <Button variant="ghost" size="sm" iconOnly icon={Copy} title="Copiar enlace" onClick={() => onCopiar(url)} />
                <Button variant="ghost" size="sm" iconOnly icon={ExternalLink} title="Abrir"
                    onClick={() => window.open(url, '_blank', 'noopener')} />
            </div>
        </div>
    );
}
