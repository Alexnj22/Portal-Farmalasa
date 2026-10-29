import React, { useState } from 'react';
import { MessageCircle, Phone, PhoneCall, Smartphone } from 'lucide-react';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import PortalTextarea from '../../components/common/PortalTextarea';
import SegmentedControl from '../../components/common/SegmentedControl';
import { registrarAvisoDeReserva } from '@nucleo/data/reservas';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { useToastStore } from '@nucleo/store/toastStore';

// ═══════════════════════════════════════════════════════════════════════════
// Reglamento de reservas v2 (rige desde `reglas_v2_desde()`, 2026-11-15).
//
// Cláusula 9: la Empresa avisa por la app, por mensaje o por llamada, y el
// plazo corre desde ese aviso. Para poder decir CUÁNDO se avisó y CÓMO, cada
// aviso hecho a mano queda en `reserva_avisos_log` —quién, cuándo y qué
// respondió el cliente—, y la pantalla los muestra con la cara de quien avisó.
//
// Los botones los habilita la base (`registrar_llamada`, `avisos`): antes de la
// fecha no llegan, y la pantalla se ve como siempre.
// ═══════════════════════════════════════════════════════════════════════════

/** El nivel como insignia, para la tarjeta y el detalle. */
export function InsigniaDeNivel({ nivel }) {
    if (!nivel?.prioridad) return null;
    return <Badge variant="info" uppercase={false} title="Se atiende primero">{`Cliente ${nivel.nombre}`}</Badge>;
}


const CANAL = {
    llamada: { icono: PhoneCall, texto: 'Llamada' },
    whatsapp: { icono: MessageCircle, texto: 'WhatsApp' },
    app: { icono: Smartphone, texto: 'App' },
};

/**
 * La lista de avisos de una reserva o un encargo: el de la app (lo manda el
 * sistema solo) y los hechos a mano, cada uno con quién lo hizo.
 */
export function HistorialDeAvisos({ avisos, avisoApp }) {
    const cuando = (v) => fechaTexto(v, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const filas = [
        ...(avisoApp?.at ? [{ canal: 'app', at: avisoApp.at, leido: avisoApp.leido_at }] : []),
        ...(avisos ?? []),
    ];
    if (!filas.length) return <p className="text-body-sm text-content-3">Todavía no hay avisos anotados.</p>;
    return (
        <ul className="space-y-2">
            {filas.map((a, i) => {
                const c = CANAL[a.canal] ?? CANAL.app;
                const Icono = c.icono;
                const persona = a.por_id ? { id: a.por_id, first_names: a.por_nombres, last_names: a.por_apellidos, name: a.por } : null;
                return (
                    <li key={`${a.canal}-${a.at}-${i}`} className="flex items-start gap-2.5 min-w-0">
                        {persona ? <AvatarConEstado emp={persona} px={28} mostrarChip={false} />
                            : <span className="w-7 h-7 rounded-xl bg-surface-card-hover flex items-center justify-center shrink-0"><Icono size={14} aria-hidden /></span>}
                        <div className="min-w-0 flex-1">
                            <p className="text-body-sm text-content">
                                <span className="font-semibold">{c.texto}</span>
                                {a.canal === 'llamada' && <span className="text-content-2">{a.contesto ? ' · contestó' : ' · no contestó'}</span>}
                                {a.canal === 'app' && <span className="text-content-2">{a.leido ? ' · lo leyó' : ' · enviado'}</span>}
                                <span className="text-content-3">{` · ${cuando(a.at)}`}</span>
                            </p>
                            {persona && <p className="text-caption text-content-3">{shortEmployeeName(persona)}</p>}
                            {a.respuesta && <p className="text-body-sm text-content-2 break-words">«{a.respuesta}»</p>}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

/**
 * Anotar una llamada al cliente: si contestó y, si contestó, qué dijo. La base
 * exige la respuesta cuando contestó (`reserva_registrar_aviso`).
 */
export function RegistrarLlamada({ reserva = null, encargo = null, titulo, telefono, onClose, onListo }) {
    const showToast = useToastStore((s) => s.showToast);
    const [contesto, setContesto] = useState('si');
    const [respuesta, setRespuesta] = useState('');
    const [enviando, setEnviando] = useState(false);
    const falta = contesto === 'si' && respuesta.trim().length < 3;
    const guardar = async () => {
        setEnviando(true);
        try {
            await registrarAvisoDeReserva({ reserva, encargo, canal: 'llamada', contesto: contesto === 'si', respuesta: contesto === 'si' ? respuesta : (respuesta || null) });
            showToast('Llamada anotada', contesto === 'si' ? 'Quedó lo que respondió el cliente.' : 'Quedó anotado que no contestó.', 'success');
            onListo?.();
        } catch (err) {
            showToast('No se pudo anotar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setEnviando(false);
        }
    };
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Registrar llamada">
            <LiquidModal.Header titulo="Registrar llamada" subtitulo={titulo || undefined} onClose={onClose} />
            <LiquidModal.Body>
                <div className="space-y-4">
                    {telefono && (
                        <a href={`tel:${String(telefono).replace(/\D/g, '')}`}
                            className="inline-flex items-center gap-1.5 rounded-btn text-body-sm font-semibold text-brand-text tabular-nums min-h-[var(--tap-min)] active:scale-[0.97]">
                            <Phone size={14} aria-hidden /> {telefono}
                        </a>
                    )}
                    <SegmentedControl label="¿Contestó?" value={contesto} onChange={setContesto} layout="block" columns={2}
                        options={[{ value: 'si', label: 'Contestó' }, { value: 'no', label: 'No contestó' }]} />
                    <PortalTextarea label={contesto === 'si' ? 'Qué respondió' : 'Nota (opcional)'} rows={3} maxLength={300}
                        value={respuesta} onChange={(e) => setRespuesta(e.target.value)}
                        placeholder={contesto === 'si' ? 'Ej. Pasa a retirarla el sábado' : 'Ej. Sonó y no contestó; se vuelve a llamar mañana'} />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Volver</Button>
                <Button icon={PhoneCall} loading={enviando} disabled={falta} onClick={guardar}>Anotar llamada</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
