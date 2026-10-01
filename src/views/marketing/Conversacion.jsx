import React, { useState } from 'react';
import { Send, CheckCircle2, Circle, PenLine } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import PortalTextarea from '../../components/common/PortalTextarea';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import { comentar, marcarResuelto } from '@nucleo/data/marketing';

const TIPO = {
    cambio:     { label: 'Cambio pedido', variant: 'warning' },
    aprobacion: { label: 'Aprobado',      variant: 'success' },
};

/**
 * La conversación de una pieza (o del mes entero, con `piezaId` vacío). Los
 * pedidos de cambio se marcan resueltos cuando el diseñador los corrige: así
 * quien revisa ve qué quedó pendiente sin releer todo el hilo.
 */
export default function Conversacion({ comentarios, personas, mesId, piezaId = null, yoId, puedeResolver, onCambio, onVerMarca }) {
    const showToast = useToastStore((s) => s.showToast);
    const [texto, setTexto] = useState('');
    const [enviando, setEnviando] = useState(false);

    const enviar = async () => {
        if (!texto.trim()) return;
        setEnviando(true);
        try {
            await comentar({ mesId, piezaId, texto, autorId: yoId });
            setTexto('');
            onCambio?.();
        } catch (err) {
            showToast('No se pudo enviar el comentario', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setEnviando(false);
        }
    };

    const resolver = async (c) => {
        try {
            await marcarResuelto(c.id, !c.resuelto);
            onCambio?.();
        } catch (err) {
            showToast('No se pudo actualizar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    };

    return (
        <div className="space-y-3">
            {!comentarios?.length && <p className="text-body-sm text-content-3">Sin comentarios.</p>}
            <ul className="space-y-3">
                {(comentarios || []).map((c) => {
                    const quien = personas?.[c.autor_id];
                    const tipo = TIPO[c.tipo];
                    return (
                        <li key={c.id} className="flex gap-2.5">
                            <AvatarConEstado emp={quien || { id: c.autor_id }} px={28} radio="rounded-full" marco="" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-label font-semibold text-content">{shortEmployeeName(quien?.name)}</span>
                                    <span className="text-micro text-content-3">
                                        {fechaHora12(c.created_at, { day: 'numeric', month: 'short' })}
                                    </span>
                                    {tipo && <Badge variant={tipo.variant} size="sm">{tipo.label}</Badge>}
                                </div>
                                <p className={`text-body-sm whitespace-pre-wrap ${c.resuelto ? 'text-content-3 line-through' : 'text-content-2'}`}>
                                    {c.texto}
                                </p>
                                {c.archivo_id && c.marca && onVerMarca && (
                                    <Button variant="ghost" size="xs" icon={PenLine} onClick={() => onVerMarca(c)}>
                                        Marcado sobre el diseño
                                    </Button>
                                )}
                                {(c.tipo === 'cambio' || c.marca) && puedeResolver && (
                                    <Button variant="ghost" size="xs" icon={c.resuelto ? CheckCircle2 : Circle}
                                        onClick={() => resolver(c)}>
                                        {c.resuelto ? 'Resuelto' : 'Marcar resuelto'}
                                    </Button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
            <div className="space-y-2">
                <PortalTextarea label="Comentar" name="comentario" value={texto}
                    onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Escribe un comentario…" />
                <div className="flex justify-end">
                    <Button size="sm" icon={Send} loading={enviando} disabled={!texto.trim()} onClick={enviar}>Enviar</Button>
                </div>
            </div>
        </div>
    );
}
