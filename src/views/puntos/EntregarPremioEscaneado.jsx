/**
 * Escanear el código de un premio y entregarlo (2026-10-19, pedido del usuario:
 * «al escanear y confirmar, se da como entregado, y se descarta»).
 *
 * El cliente muestra en la app el código del premio en barras o en QR; la
 * sala lo pasa por el lector (o la cámara) en Puntos → Escanear o en Puntos →
 * Premios. Esto busca ESE premio y pide UNA confirmación: al confirmar,
 * `entregar-premio` lo marca entregado y, si es un producto, lo descarga del
 * inventario de la sala.
 *
 * Desde el 2026-10-20 se retira en CUALQUIER sucursal: la que escanea es la
 * que entrega. Un regalo promocional que esta sala no tiene NO se entrega: se
 * dice dónde hay y el cliente elige (decisión del usuario) —apartarlo en una
 * de esas salas, o pedirlo para ésta: cuando llegue se le avisa en la app—.
 */
import React, { useEffect, useState } from 'react';
import ConfirmModal from '../../components/common/ConfirmModal';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore } from '@nucleo/store/staffStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { apartarPremio, entregarPremio, fetchPremiosPorEntregar, pedirPremio } from '@nucleo/data/puntos';

/** Por qué un premio no se puede entregar acá, o `null` si se puede. */
function impedimento(p, sala) {
    if (p.estado === 'ENTREGADO') return 'Ese premio ya se entregó.';
    if (p.estado === 'VENCIDO') return 'Ese premio ya venció.';
    if (p.estado === 'ENTREGANDO') return 'Ese premio se está entregando en este momento.';
    if (p.tipo === 'promocional' && p.reserva_branch && Number(p.reserva_branch) !== Number(sala)) return 'APARTADO_EN_OTRA';
    if (p.tipo === 'promocional' && p.hay_en_sala === false) return 'SIN_REGALO';
    return null;
}

export default function EntregarPremioEscaneado({ codigo, miSala, puedeAdministrar, onCerrar, onEntregado }) {
    const showToast = useToastStore((s) => s.showToast);
    const salas = useStaffStore((s) => s.branches);
    const nombreSala = (id) => (salas || []).find((b) => Number(b.id) === Number(id))?.name ?? 'otra sucursal';
    const [premio, setPremio] = useState(null);
    const [sinRegalo, setSinRegalo] = useState(null);
    const [problema, setProblema] = useState(null);
    const [ocupado, setOcupado] = useState(false);

    useEffect(() => {
        let vivo = true;
        // La sala que entrega es la de quien escanea. Con los entregados, para
        // poder decir «ya se entregó» en vez de «no existe».
        fetchPremiosPorEntregar(miSala, codigo, true)
            .then((lista) => {
                if (!vivo) return;
                const p = (lista ?? []).find((x) => x.codigo === codigo);
                if (!p) { setProblema(`No hay un premio ${codigo}.`); return; }
                const no = impedimento(p, miSala);
                if (no === 'APARTADO_EN_OTRA') setProblema(`Ese regalo está apartado para el cliente en ${nombreSala(p.reserva_branch)}: se retira allá.`);
                else if (no === 'SIN_REGALO') setSinRegalo(p);
                else if (no) setProblema(no);
                else setPremio(p);
            })
            .catch((e) => { if (vivo) setProblema(mensajeAmigable(e)); });
        return () => { vivo = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `nombreSala` sólo traduce un id para el aviso
    }, [codigo, miSala, puedeAdministrar]);

    // Lo que no se puede entregar se avisa y se cierra solo: el lector queda
    // listo para el siguiente.
    useEffect(() => {
        if (!problema) return;
        showToast('No se puede entregar', problema, 'warning');
        onCerrar?.();
    }, [problema, showToast, onCerrar]);

    const entregar = async () => {
        setOcupado(true);
        try {
            await entregarPremio(premio.id, miSala);
            showToast('Premio entregado', `${premio.codigo} · ${premio.nombre} a ${premio.cliente?.nombre ?? 'el cliente'}`, 'success');
            onEntregado?.(premio);
            onCerrar?.();
        } catch (e) {
            showToast('No se pudo entregar', mensajeAmigable(e), 'error');
        } finally {
            setOcupado(false);
        }
    };

    const resolver = async (accion, sala) => {
        setOcupado(true);
        try {
            if (accion === 'apartar') {
                await apartarPremio(sinRegalo.id, sala);
                showToast('Regalo apartado', `Queda en ${nombreSala(sala)} para ${sinRegalo.cliente?.nombre ?? 'el cliente'}. Se le avisa en la app.`, 'success');
            } else {
                await pedirPremio(sinRegalo.id, sala);
                showToast('Regalo pedido', 'Cuando llegue a esta sucursal se le avisa al cliente en la app.', 'success');
            }
            onEntregado?.(sinRegalo);
            onCerrar?.();
        } catch (e) {
            showToast('No se pudo', mensajeAmigable(e), 'error');
        } finally {
            setOcupado(false);
        }
    };

    if (sinRegalo) {
        const hay = (sinRegalo.hay_en ?? []).filter((x) => Number(x.branch_id) !== Number(miSala));
        return (
            <LiquidModal open onClose={ocupado ? undefined : onCerrar} maxWidth="max-w-md" ariaLabel="Regalo sin existencia en esta sala">
                <LiquidModal.Header titulo={`Aquí no hay ${sinRegalo.nombre}`}
                    subtitulo={`Premio ${sinRegalo.codigo} de ${sinRegalo.cliente?.nombre ?? 'el cliente'}. Pregúntale qué prefiere.`}
                    onClose={ocupado ? undefined : onCerrar} />
                <LiquidModal.Body>
                    <div className="flex flex-col gap-2">
                        {hay.length ? hay.map((x) => (
                            <Button key={x.branch_id} variant="secondary" disabled={ocupado} onClick={() => resolver('apartar', x.branch_id)}>
                                Apartarlo en {nombreSala(x.branch_id)}
                            </Button>
                        )) : (
                            <p className="text-body-sm text-content-3">No hay en ninguna sucursal por ahora.</p>
                        )}
                        <Button variant="primary" disabled={ocupado || !miSala} onClick={() => resolver('pedir', miSala)}>
                            Pedirlo para esta sucursal
                        </Button>
                        <p className="text-caption text-content-3">
                            Apartado o pedido, el cliente lo ve en la app y recibe el aviso cuando ya puede retirarlo.
                        </p>
                    </div>
                </LiquidModal.Body>
                <LiquidModal.Footer>
                    <Button variant="ghost" onClick={onCerrar} disabled={ocupado}>Cancelar</Button>
                </LiquidModal.Footer>
            </LiquidModal>
        );
    }

    if (!premio) return null;
    const cantidad = Number(premio.cantidad) > 1 ? `${premio.cantidad} × ` : '';
    return (
        <ConfirmModal isOpen isDestructive={false} isProcessing={ocupado}
            onClose={() => { if (!ocupado) onCerrar?.(); }}
            title={`¿Entregar ${cantidad}${premio.nombre}?`}
            message={`Premio ${premio.codigo} de ${premio.cliente?.nombre ?? 'el cliente'}${premio.cliente?.documento ? ` (${premio.cliente.documento})` : ''}. ${premio.tipo === 'producto'
                ? 'Al confirmar se descarga del inventario de esta sucursal.'
                : 'Al confirmar sale del inventario de regalos de esta sucursal.'} Confirma con su documento que es la persona.`}
            confirmText="Entregar" onConfirm={entregar} />
    );
}
