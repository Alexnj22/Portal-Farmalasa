import React, { useState } from 'react';
import { Send, ThumbsUp, Check } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { etiquetaMes } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { publicarMes, aprobarMes, actualizarMes } from '@nucleo/data/marketing';

// Los dos se montan frescos (la vista los pinta sólo abiertos): el estado nace
// de la fila y no hay que resincronizarlo con un efecto.

/**
 * Enviar el mes a revisión (quien edita) o aprobarlo (quien aprueba). Las dos
 * van con una nota opcional, que llega en el aviso.
 */
export function DecisionMesModal({ modo, mes, resumen, onClose, onCambio }) {
    const showToast = useToastStore((s) => s.showToast);
    const [nota, setNota] = useState('');
    const [enviando, setEnviando] = useState(false);

    if (!modo || !mes) return null;
    const publicar = modo === 'publicar';
    const reenvio = publicar && mes.version > 0;
    const etiqueta = etiquetaMes(mes.mes);

    const confirmar = async () => {
        setEnviando(true);
        try {
            if (publicar) {
                await publicarMes(mes.id, nota);
                showToast(reenvio ? 'Calendario reenviado' : 'Calendario enviado a revisión', etiqueta, 'success');
            } else {
                const r = await aprobarMes(mes.id, nota);
                showToast('Calendario aprobado', `${r?.piezas_aprobadas ?? 0} pieza(s) aprobadas de una vez`, 'success');
            }
            onCambio?.();
            onClose();
        } catch (err) {
            showToast(publicar ? 'No se pudo enviar' : 'No se pudo aprobar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setEnviando(false);
        }
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md"
            ariaLabel={publicar ? 'Enviar el calendario a revisión' : 'Aprobar el calendario'}>
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">
                    {publicar ? (reenvio ? `Reenviar ${etiqueta}` : `Enviar ${etiqueta} a revisión`) : `Aprobar ${etiqueta}`}
                </h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    {publicar ? (
                        <p className="text-body-sm text-content-2">
                            Quien revisa recibe el aviso y desde ese momento ve los diseños de las {resumen.total} piezas.
                            {resumen.abiertas > 0 && ` Hay ${resumen.abiertas} que todavía no están terminadas: se ven con su estado.`}
                        </p>
                    ) : (
                        <>
                            <p className="text-body-sm text-content-2">
                                Se aprueban de una vez las piezas finalizadas y el calendario queda listo para publicar.
                            </p>
                            {resumen.abiertas > 0 && (
                                <Notice variant="warning" compact>
                                    Quedan {resumen.abiertas} pieza(s) sin terminar o con cambios pedidos. Se puede aprobar cuando estén listas.
                                </Notice>
                            )}
                        </>
                    )}
                    <PortalTextarea label={publicar ? 'Nota para quien revisa' : 'Comentario'} name="nota" value={nota}
                        onChange={(e) => setNota(e.target.value)} rows={3}
                        placeholder={publicar ? 'Opcional: qué cambió, qué mirar primero…' : 'Opcional'} />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={publicar ? Send : ThumbsUp} tone={publicar ? undefined : 'success'} loading={enviando}
                    disabled={!publicar && resumen.abiertas > 0} onClick={confirmar}>
                    {publicar ? (reenvio ? 'Reenviar' : 'Enviar') : 'Aprobar'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

/** El objetivo del mes y el presupuesto de pauta. */
export function DatosDelMesModal({ open, mes, puedeAprobar, asignado = 0, onClose, onCambio }) {
    const showToast = useToastStore((s) => s.showToast);
    const [objetivo, setObjetivo] = useState(() => mes?.objetivo || '');
    const [presupuesto, setPresupuesto] = useState(() => (mes?.presupuesto_pauta ? String(mes.presupuesto_pauta) : ''));
    const [guardando, setGuardando] = useState(false);

    if (!open || !mes) return null;

    const guardar = async () => {
        setGuardando(true);
        try {
            // El presupuesto sólo lo manda quien aprueba: si lo mandara el
            // diseñador con el mismo valor la base lo dejaría pasar, pero con
            // otro lo rechazaría — mejor no mandarlo.
            await actualizarMes(mes.id, puedeAprobar ? { objetivo, presupuesto_pauta: presupuesto } : { objetivo });
            onCambio?.();
            onClose();
        } catch (err) {
            showToast('No se pudo guardar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-md" ariaLabel="Datos del mes">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">{etiquetaMes(mes.mes)}</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-4">
                    <PortalTextarea label="Objetivo del mes" name="objetivo" value={objetivo}
                        onChange={(e) => setObjetivo(e.target.value)} rows={3}
                        placeholder="Ej. Lanzar la temporada de vitaminas y crecer en Instagram" />
                    <PortalInput label="Presupuesto de pauta del mes" name="presupuesto_pauta" inputMode="decimal" maskType="DECIMAL" prefix="$"
                        value={presupuesto} onChange={(e) => setPresupuesto(e.target.value)} placeholder="0.00"
                        readOnly={!puedeAprobar}
                        helperText={puedeAprobar
                            ? `${formatMoney(asignado)} ya repartidos en piezas: no puede quedar por debajo.`
                            : 'Lo fija gerencia. Tú lo repartes al marcar cada pieza para pautar.'} />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={Check} loading={guardando} onClick={guardar}>Guardar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
