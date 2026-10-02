import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeftRight, RotateCw, Hand, CheckCircle2 } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import PortalInput from '../../components/common/PortalInput';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatQty } from '@nucleo/utils/formatNumber';
import { fechaHora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import {
    fetchCambiosPendientes, reintentarCambioDeCliente, marcarCambioResueltoAMano,
} from '@nucleo/data/puntos';

/**
 * Traspasos de puntos que no terminaron (2026-10-01).
 *
 * Cuando una solicitud de cambio de cliente se aprueba, los puntos de la venta
 * pasan al cliente nuevo. Si eso falla, la aprobación lo reintenta tres veces y
 * después el aviso de cada 5 minutos lo sigue intentando solo. Lo que llega acá
 * es lo que todavía no entró (y lo resuelto en la última semana, para ver cómo
 * terminó). Pedido del usuario: «así lo reintenta y si no, me avisa para
 * hacerlo manualmente».
 *
 * «Lo hice a mano» NO mueve puntos: es para cuando ya se resolvió con un ajuste
 * (quitarle al cliente anterior y darle al nuevo desde su ficha). Sólo deja
 * constancia y apaga los reintentos. Sin nada pendiente, no se pinta.
 */
const pts = (n) => formatQty(Number(n) || 0);
const COMO = { automatico: 'solo, al reintentar', reintento: 'con «Reintentar»', a_mano: 'a mano' };

export default function TraspasosPendientes({ puedeResolver }) {
    const showToast = useToastStore((s) => s.showToast);
    const [filas, setFilas] = useState([]);
    const [ocupado, setOcupado] = useState(null);
    const [aMano, setAMano] = useState(null);
    const [nota, setNota] = useState('');

    const cargar = useCallback(() => {
        fetchCambiosPendientes()
            .then((r) => setFilas(Array.isArray(r) ? r : []))
            .catch((e) => console.warn('[TraspasosPendientes]', e?.message ?? e));
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const reintentar = async (f) => {
        setOcupado(f.solicitud_id);
        try {
            const r = await reintentarCambioDeCliente(f.solicitud_id, { documento: f.documento });
            if (r?.ok) showToast('Puntos movidos', `La venta ${f.documento ?? ''} ya tiene sus puntos en ${f.a_nombre}.`, 'success');
            else showToast('Todavía no entra', r?.error ?? 'No se pudo mover los puntos.', 'error');
            cargar();
        } catch (e) {
            showToast('No se pudo reintentar', mensajeAmigable(e), 'error');
        } finally {
            setOcupado(null);
        }
    };

    const cerrarAMano = async (f) => {
        if (!nota.trim()) return;
        setOcupado(f.solicitud_id);
        try {
            await marcarCambioResueltoAMano(f.solicitud_id, nota, { documento: f.documento });
            showToast('Marcado como resuelto', 'Ya no se va a reintentar.', 'success');
            setAMano(null); setNota('');
            cargar();
        } catch (e) {
            showToast('No se pudo marcar', mensajeAmigable(e), 'error');
        } finally {
            setOcupado(null);
        }
    };

    if (!filas.length) return null;

    return (
        <section data-surface="card" className="p-4 flex flex-col gap-3 min-w-0">
            <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                <ArrowLeftRight size={14} /> Puntos de cambios de cliente
            </h3>
            {filas.map((f) => {
                const abierto = !f.resuelto_at;
                return (
                    <div key={f.solicitud_id} className="flex flex-col gap-2 border-t border-border-card pt-3 first:border-t-0 first:pt-0">
                        <div className="flex flex-wrap items-center gap-2">
                            {abierto
                                ? <Badge variant="danger" tone="soft" uppercase={false}>Sin terminar</Badge>
                                : <Badge variant="success" tone="soft" uppercase={false} icon={CheckCircle2}>Resuelto {COMO[f.resuelto_como] ?? ''}</Badge>}
                            <span className="text-label font-bold text-content">
                                Venta {f.documento ?? `#${f.invoice_id}`}
                                {f.puntos != null && ` · ${pts(f.puntos)} puntos`}
                            </span>
                        </div>
                        <p className="text-body-sm text-content-2">
                            {f.de_nombre ? `De ${f.de_nombre} a ${f.a_nombre}.` : `Para ${f.a_nombre}.`}
                            {abierto && ` ${pts(f.intentos)} intentos${f.ultimo_intento_at ? ` · el último, ${fechaHora12(f.ultimo_intento_at)}` : ''}`}
                        </p>
                        {abierto && f.ultimo_error && (
                            <p className="text-caption text-danger-text">Último error: {f.ultimo_error}</p>
                        )}
                        {!abierto && f.resuelto_como === 'a_mano' && (
                            <p className="text-caption text-content-3">
                                {f.resuelto_por_nombre ? `${shortEmployeeName({ name: f.resuelto_por_nombre })}: ` : ''}{f.nota}
                            </p>
                        )}
                        {abierto && puedeResolver && (
                            aMano === f.solicitud_id ? (
                                <div className="flex flex-col gap-2">
                                    <PortalInput label="Qué se hizo" name={`nota_traspaso_${f.solicitud_id}`} value={nota}
                                        placeholder="Ej.: le quité 40 a … y le di 40 a … desde su ficha"
                                        onChange={(e) => setNota(e.target.value.slice(0, 300))} />
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => { setAMano(null); setNota(''); }}
                                            disabled={ocupado === f.solicitud_id}>Cancelar</Button>
                                        <Button variant="primary" size="sm" onClick={() => cerrarAMano(f)}
                                            disabled={!nota.trim() || ocupado === f.solicitud_id} loading={ocupado === f.solicitud_id}>
                                            Marcar como resuelto
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    <Button variant="secondary" size="sm" icon={RotateCw} onClick={() => reintentar(f)}
                                        disabled={ocupado === f.solicitud_id} loading={ocupado === f.solicitud_id}>
                                        Reintentar
                                    </Button>
                                    <Button variant="ghost" size="sm" icon={Hand} onClick={() => { setAMano(f.solicitud_id); setNota(''); }}
                                        disabled={ocupado === f.solicitud_id}>
                                        Lo hice a mano
                                    </Button>
                                </div>
                            )
                        )}
                    </div>
                );
            })}
        </section>
    );
}
