import React, { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, CheckCircle2, XCircle } from 'lucide-react';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import FilaConAcciones from './FilaConAcciones';
import Encabezado from './EncabezadoDeLista';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { decidirProrroga, fetchProrrogasPendientes, pedirProrroga } from '@nucleo/data/reservas';

// ═══════════════════════════════════════════════════════════════════════════
// La prórroga por solicitud (Reglamento de reservas v2, cláusula 6.4 ·
// 2026-10-30). El plazo para retirar ya no se alarga solo ni lo alarga la
// sala: se PIDE con los días que necesita el cliente y el motivo, y lo decide
// quien tenga `dash_reservas_prorroga` (Talento Humano y Supervisión de
// ventas). Una sola autorizada por reserva o encargo; mientras espera, el
// plazo no vence (lo frena la base, no esta pantalla).
//
// Un pedido de varios productos se pide ENTERO: una solicitud por renglón con
// los mismos días y motivo, y la bandeja los junta por código para decidirlos
// de una vez.
// ═══════════════════════════════════════════════════════════════════════════

const diasTexto = (n) => `${n} ${Number(n) === 1 ? 'día' : 'días'}`;
const dia = (v) => fechaTexto(v, { weekday: 'short', day: 'numeric', month: 'short' });

/** Pedir la prórroga de una reserva (todos sus renglones listos) o de un encargo. */
export function PedirProrroga({ tipo, ids, titulo, vence, onCerrar, onListo }) {
    const showToast = useToastStore((s) => s.showToast);
    const [dias, setDias] = useState('');
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);
    const n = Number(dias);
    const valido = Number.isInteger(n) && n >= 1 && n <= 365 && motivo.trim().length >= 3;
    const pedir = async () => {
        setEnviando(true);
        try {
            for (const id of ids) await pedirProrroga(tipo, id, n, motivo);
            showToast('Prórroga pedida', 'Talento Humano o Supervisión de ventas la autoriza. Mientras tanto, el plazo no vence.', 'success');
            onListo?.();
        } catch (err) {
            showToast('No se pudo pedir la prórroga', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setEnviando(false);
        }
    };
    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-md" ariaLabel="Pedir prórroga">
            <LiquidModal.Header titulo={`Pedir prórroga · ${titulo}`} onClose={onCerrar} />
            <LiquidModal.Body>
                <div className="space-y-3">
                    <p className="text-body-sm text-content-2">
                        {vence ? `Hoy puede retirar hasta el ${dia(vence)}. ` : ''}
                        Se pide una sola vez: la autoriza Talento Humano o Supervisión de ventas, y al cliente le llega el aviso.
                    </p>
                    <PortalInput label="Días que necesita" name="dias" inputMode="numeric" maskType="PERCENT" autoFocus
                        value={dias} onChange={(e) => setDias(e.target.value)} placeholder="Ej. 15"
                        helperText={n >= 1 && vence ? `Quedaría hasta el ${dia(new Date(new Date(vence).getTime() + n * 86400000))}.` : undefined} />
                    <PortalTextarea label="Motivo" name="motivo" rows={3} maxLength={300} value={motivo}
                        onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué el cliente no puede venir en el plazo" />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onCerrar}>Ahora no</Button>
                <Button icon={CalendarPlus} loading={enviando} disabled={!valido} onClick={pedir}>Pedir prórroga</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

/** Junta las solicitudes de un mismo pedido: se deciden de una vez. */
function agrupar(lista) {
    const grupos = new Map();
    for (const p of lista || []) {
        const clave = `${p.tipo}:${p.codigo}`;
        const g = grupos.get(clave);
        if (g) { g.ids.push(p.id); g.productos.push(p.producto); continue; }
        grupos.set(clave, { ...p, ids: [p.id], productos: [p.producto] });
    }
    return [...grupos.values()];
}

/**
 * La bandeja de quien autoriza. Se pinta sola cuando hay algo pendiente y
 * quien mira tiene el permiso; si no, no ocupa lugar.
 */
export function ProrrogasPorAutorizar({ soloLectura = false }) {
    const { hasPermission } = useAuth();
    const puede = hasPermission('dash_reservas_prorroga');
    const [lista, setLista] = useState([]);
    const [decidiendo, setDecidiendo] = useState(null);

    const cargar = useCallback(() => {
        if (!puede) return;
        fetchProrrogasPendientes()
            .then((l) => setLista(agrupar(l)))
            .catch((err) => console.error('ProrrogasPorAutorizar: no se pudieron leer las prórrogas pendientes', err));
    }, [puede]);
    useEffect(() => { cargar(); }, [cargar]);

    if (!puede || !lista.length) return null;
    return (
        <div className="space-y-1.5">
            <Encabezado titulo="Prórrogas por autorizar" n={lista.length} ayuda="Mientras esperan, el plazo no vence" />
            <ul className="space-y-1.5 min-w-0">
                {lista.map((p) => (
                    <li key={`${p.tipo}:${p.codigo}`}>
                        <FilaConAcciones icon={CalendarPlus} tone="warning"
                            titulo={`${diasTexto(p.dias)} más · ${p.codigo} · ${String(p.cliente ?? '').split(/\s+/)[0]}`}
                            detalle={[
                                p.productos.length > 1 ? `${p.productos.length} productos` : p.producto,
                                p.sala,
                                p.vence && `hoy vence el ${dia(p.vence)}`,
                                p.origen === 'app' ? 'pedida por el cliente en la app' : 'pedida por la sala',
                                `motivo: ${p.motivo}`,
                            ].filter(Boolean).join(' · ')}
                            acciones={soloLectura ? null : (
                                <>
                                    <Button variant="ghost" size="xs" icon={XCircle} onClick={() => setDecidiendo({ ...p, autorizar: false })}>No autorizar</Button>
                                    <Button variant="primary" size="xs" icon={CheckCircle2} onClick={() => setDecidiendo({ ...p, autorizar: true })}>Autorizar</Button>
                                </>
                            )} />
                    </li>
                ))}
            </ul>
            {decidiendo && (
                <DecidirProrroga p={decidiendo} onCerrar={() => setDecidiendo(null)}
                    onListo={() => { setDecidiendo(null); cargar(); }} />
            )}
        </div>
    );
}

function DecidirProrroga({ p, onCerrar, onListo }) {
    const showToast = useToastStore((s) => s.showToast);
    const [dias, setDias] = useState(String(p.dias));
    const [nota, setNota] = useState('');
    const [enviando, setEnviando] = useState(false);
    const n = Number(dias);
    const valido = p.autorizar ? Number.isInteger(n) && n >= 1 && n <= 365 : nota.trim().length >= 3;
    const decidir = async () => {
        setEnviando(true);
        try {
            let vence = null;
            for (const id of p.ids) vence = (await decidirProrroga(id, p.autorizar, nota, p.autorizar ? n : null))?.vence ?? vence;
            showToast(p.autorizar ? 'Prórroga autorizada' : 'Prórroga no autorizada',
                p.autorizar ? `Puede retirar hasta el ${dia(vence)}. La sala y el cliente reciben el aviso.` : 'La sala y el cliente reciben el aviso con el motivo.',
                'success');
            onListo();
        } catch (err) {
            showToast('No se pudo', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setEnviando(false);
        }
    };
    const titulo = `${p.autorizar ? 'Autorizar' : 'No autorizar'} prórroga · ${p.codigo}`;
    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-md" ariaLabel={titulo}>
            <LiquidModal.Header titulo={titulo} onClose={onCerrar} />
            <LiquidModal.Body>
                <div className="space-y-3">
                    <p className="text-body-sm text-content-2 break-words">
                        {shortEmployeeName(p.cliente ?? '')} · {p.productos.join(', ')} · {p.sala}. Pide {diasTexto(p.dias)}: «{p.motivo}».
                        {p.vence ? ` Hoy vence el ${dia(p.vence)}.` : ''}
                    </p>
                    {p.autorizar && (
                        <PortalInput label="Días que se autorizan" name="dias" inputMode="numeric" maskType="PERCENT"
                            value={dias} onChange={(e) => setDias(e.target.value)}
                            helperText={n >= 1 && p.vence ? `Quedaría hasta el ${dia(new Date(new Date(`${p.vence}T12:00:00`).getTime() + n * 86400000))}.` : undefined} />
                    )}
                    <PortalTextarea label={p.autorizar ? 'Nota (opcional)' : 'Motivo (se le dice al cliente)'} name="nota" rows={3}
                        maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onCerrar}>Ahora no</Button>
                <Button loading={enviando} disabled={!valido} onClick={decidir}>{p.autorizar ? 'Autorizar' : 'No autorizar'}</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
