/**
 * Anonimizar la ficha de quien pidió cancelar sus datos (2026-10-26).
 *
 * Sólo aparece en una solicitud RESUELTA, no negada, que pide cancelación: la
 * decisión ya se tomó y quedó por escrito en la resolución; esto la ejecuta.
 * Nunca sobre una ficha cualquiera.
 *
 * Qué ficha, qué se borra, qué se resguarda, qué se conserva porque lo exige
 * otra ley y qué lo impide lo decide UNA función de la base
 * (`datos_anonimizacion_evaluar`), la misma que vuelve a preguntar justo antes
 * de escribir. La pantalla sólo muestra su respuesta, para que el aviso y el
 * candado no puedan contestar distinto.
 *
 * Los puntos se PIERDEN y no vuelven aunque la persona regrese: por eso el
 * número va arriba y en rojo, antes del botón.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { UserX, AlertTriangle, Check, RefreshCw, Search } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import {
    fetchAnonimizacion, anonimizarCliente, reintentarArchivosAnonimizacion, RUBROS_ANONIMIZACION,
} from '@nucleo/data/solicitudesDatos';
import ConsultaResguardo from './ConsultaResguardo';

const CONFIRMAR = 'ANONIMIZAR';
const numero = (n) => Number(n ?? 0).toLocaleString('es-SV');

/** El rótulo de la ficha: es un CLIENTE, no un empleado. */
const rotuloDeFicha = (ficha) => `#${ficha?.id} · ${ficha?.name ?? ''}`;

function Lista({ titulo, rubros, conteos, tono }) {
    const filas = Object.entries(rubros).filter(([k]) => Number(conteos?.[k] ?? 0) > 0);
    return (
        <div className="flex flex-col gap-1 min-w-0">
            <h4 className="text-caption font-bold text-content-2">{titulo}</h4>
            {filas.length ? filas.map(([k, rotulo]) => (
                <div key={k} className="flex items-center justify-between gap-2">
                    <span className="text-body-sm text-content-2 min-w-0">{rotulo}</span>
                    <Badge variant={tono} uppercase={false}>{numero(conteos[k])}</Badge>
                </div>
            )) : <p className="text-caption text-content-3">Nada</p>}
        </div>
    );
}

function Hecha({ a, onCambio }) {
    const showToast = useToastStore((s) => s.showToast);
    const [ocupado, setOcupado] = useState(false);
    const [verResguardo, setVerResguardo] = useState(false);

    const reintentar = async () => {
        setOcupado(true);
        try {
            const r = await reintentarArchivosAnonimizacion(a.id);
            showToast(r.archivos_pendientes ? 'Quedan archivos' : 'Listo',
                r.archivos_pendientes ? `${r.archivos_pendientes} sin borrar todavía` : 'Archivos borrados', r.archivos_pendientes ? 'warning' : 'success');
            onCambio?.();
        } catch (e) {
            showToast('No se pudo', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally { setOcupado(false); }
    };

    return (
        <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant={a.reactivada_at ? 'info' : 'neutral'} uppercase={false}>
                    {a.reactivada_at ? `Reactivada el ${fechaTexto(a.reactivada_at)}` : `Anonimizada el ${fechaTexto(a.anonimizada_at)}`}
                </Badge>
                <span className="text-caption text-content-3">Ficha #{a.customer_id}</span>
                {Number(a.puntos_perdidos) > 0 && (
                    <span className="text-caption text-content-3">· {numero(a.puntos_perdidos)} puntos perdidos</span>
                )}
            </div>
            {!a.reactivada_at && (
                <>
                    <p className="text-body-sm text-content-2">
                        {Number(a.caja_total) === 0
                            ? 'La ficha no existe en la caja: no hubo nada que anonimizar allá.'
                            : Number(a.caja_pendientes) > 0
                                ? `La ficha de la caja se anonimiza en los próximos minutos (${a.caja_pendientes} de ${a.caja_total} datos pendientes).`
                                : 'La ficha de la caja ya quedó anonimizada.'}
                    </p>
                    {Number(a.archivos_pendientes) > 0 && (
                        <Notice variant="warning" compact>
                            Quedaron {a.archivos_pendientes} carpeta(s) o archivo(s) sin borrar.{' '}
                            <Button variant="ghost" size="sm" icon={RefreshCw} loading={ocupado} onClick={reintentar}>Reintentar</Button>
                        </Notice>
                    )}
                </>
            )}
            {verResguardo
                ? <ConsultaResguardo anonimizacionId={a.id} />
                : (
                    <div>
                        <Button variant="secondary" size="sm" onClick={() => setVerResguardo(true)}>
                            Consultar el resguardo{Number(a.lecturas) > 0 ? ` (${a.lecturas} consulta${Number(a.lecturas) === 1 ? '' : 's'})` : ''}
                        </Button>
                    </div>
                )}
        </div>
    );
}

export default function AnonimizarCliente({ solicitud }) {
    const showToast = useToastStore((s) => s.showToast);
    const [estado, setEstado] = useState(null);
    const [elegida, setElegida] = useState(null);
    const [fichaManual, setFichaManual] = useState('');
    const [confirmacion, setConfirmacion] = useState('');
    const [motivoSinDoc, setMotivoSinDoc] = useState('');
    const [ocupado, setOcupado] = useState(false);

    const cargar = useCallback(async (customerId = null) => {
        try {
            const d = await fetchAnonimizacion(solicitud.id, customerId);
            setEstado(d);
            setElegida((prev) => {
                const ids = (d.candidatos ?? []).map((c) => c.ficha?.id);
                if (prev && ids.includes(prev)) return prev;
                return ids.length === 1 ? ids[0] : null;
            });
        } catch (e) {
            setEstado({ hecha: [], candidatos: [], error: mensajeAmigable(e) });
        }
    }, [solicitud.id]);

    useEffect(() => { cargar(); }, [cargar]);

    if (!estado) return <p className="text-caption text-content-3">Revisando la ficha…</p>;
    if (estado.error) return <Notice variant="warning" compact>{estado.error}</Notice>;

    const vigente = (estado.hecha ?? []).find((a) => !a.reactivada_at);
    const candidato = (estado.candidatos ?? []).find((c) => c.ficha?.id === elegida);
    const confirmado = confirmacion.trim().toUpperCase() === CONFIRMAR;
    const faltaMotivo = candidato?.requiere_motivo_sin_documento && motivoSinDoc.trim().length < 15;

    const anonimizar = async () => {
        setOcupado(true);
        try {
            const r = await anonimizarCliente({
                solicitudId: solicitud.id, customerId: candidato.ficha.id, confirmacion,
                sinDocumentoMotivo: candidato.requiere_motivo_sin_documento ? motivoSinDoc.trim() : null,
            });
            showToast('Datos anonimizados', r.archivos_pendientes
                ? `Ficha #${candidato.ficha.id}. Quedaron ${r.archivos_pendientes} archivo(s) por borrar: se pueden reintentar.`
                : `Ficha #${candidato.ficha.id}`, r.archivos_pendientes ? 'warning' : 'success');
            setConfirmacion(''); setMotivoSinDoc('');
            await cargar();
        } catch (e) {
            showToast('No se pudo anonimizar', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally { setOcupado(false); }
    };

    return (
        <div className="flex flex-col gap-3">
            {(estado.hecha ?? []).map((a) => <Hecha key={a.id} a={a} onCambio={() => cargar()} />)}

            {!vigente && (
                <>
                    {(estado.candidatos ?? []).length === 0 && (
                        <div className="flex flex-col gap-2">
                            <p className="text-body-sm text-content-2">
                                Ninguna ficha de cliente tiene el documento de esta solicitud. Si la persona es cliente con
                                una ficha sin documento, escribe el número de ficha (aparece en Clientes).
                            </p>
                            <div className="flex flex-wrap items-end gap-2">
                                <PortalInput label="Número de ficha" inputMode="numeric" value={fichaManual}
                                    onChange={(e) => setFichaManual(e.target.value.replace(/\D/g, ''))} />
                                <Button variant="secondary" size="sm" icon={Search} disabled={!fichaManual}
                                    onClick={() => cargar(Number(fichaManual))}>Revisar</Button>
                            </div>
                        </div>
                    )}

                    {(estado.candidatos ?? []).length > 1 && (
                        <div className="flex flex-col gap-1">
                            <p className="text-body-sm text-content-2">Hay más de una ficha con ese documento. ¿Cuál?</p>
                            <LiquidSelect value={elegida ?? ''} onChange={(v) => setElegida(v ? Number(v) : null)}
                                placeholder="Elige la ficha"
                                options={estado.candidatos.map((c) => ({ value: c.ficha.id, label: rotuloDeFicha(c.ficha) }))} />
                        </div>
                    )}

                    {candidato && (
                        <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
                            <p className="text-body-sm font-semibold text-content">{rotuloDeFicha(candidato.ficha)}</p>
                            {(candidato.fichas ?? []).length > 1 && (
                                <p className="text-caption text-content-3">
                                    Incluye {candidato.fichas.length - 1} ficha(s) que ya se habían unido a esta.
                                </p>
                            )}

                            {(candidato.bloqueos ?? []).map((b, i) => (
                                <Notice key={i} variant="warning" icon={AlertTriangle} compact>{b}</Notice>
                            ))}

                            {Number(candidato.puntos_que_se_pierden) > 0 && (
                                <Notice variant="danger" icon={AlertTriangle} bloque>
                                    Se pierden {numero(candidato.puntos_que_se_pierden)} puntos. No vuelven aunque la persona
                                    regrese y reactive sus datos.
                                </Notice>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <Lista titulo="Se borra" rubros={RUBROS_ANONIMIZACION.borra} conteos={candidato.conteos?.borra} tono="danger" />
                                <Lista titulo="Se guarda en el resguardo" rubros={RUBROS_ANONIMIZACION.resguarda} conteos={candidato.conteos?.resguarda} tono="warning" />
                                <Lista titulo="Se conserva (lo exige la ley)" rubros={RUBROS_ANONIMIZACION.conserva} conteos={candidato.conteos?.conserva} tono="neutral" />
                            </div>
                            <p className="text-caption text-content-3">
                                La ficha queda como «CLIENTE ANÓNIMO» sin nombre, documentos, teléfonos, correo, dirección ni
                                fecha de nacimiento, también en la caja. Las facturas conservan el nombre con que se
                                emitieron: son documentos fiscales. Si la persona vuelve, sus datos se pueden reactivar
                                presentando el mismo documento.
                            </p>

                            {candidato.puede && (
                                <>
                                    {candidato.requiere_motivo_sin_documento && (
                                        <PortalTextarea label="La ficha no tiene documento: ¿por qué es la de esta persona?"
                                            rows={2} maxLength={500} value={motivoSinDoc}
                                            onChange={(e) => setMotivoSinDoc(e.target.value)} />
                                    )}
                                    <PortalInput label={`Para confirmar, escribe ${CONFIRMAR}`} value={confirmacion}
                                        autoComplete="off" onChange={(e) => setConfirmacion(e.target.value)} />
                                    <div className="flex justify-end">
                                        <Button variant="destructive" icon={ocupado ? undefined : UserX} loading={ocupado}
                                            disabled={!confirmado || faltaMotivo} onClick={anonimizar}>
                                            Anonimizar datos
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </>
            )}
            {vigente && (
                <p className="text-caption text-content-3 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" aria-hidden /> Esta solicitud ya se ejecutó.
                </p>
            )}
        </div>
    );
}
