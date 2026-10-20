/**
 * Escanear el código de un premio y entregarlo (2026-10-19, pedido del usuario:
 * «al escanear y confirmar, se da como entregado, y se descarta»).
 *
 * El cliente muestra en la app el código del premio en barras o en QR; la
 * sala lo pasa por el lector (o la cámara) en Puntos → Escanear o en Puntos →
 * Premios. Esto busca ESE premio y pide UNA confirmación: al confirmar,
 * `entregar-premio` lo marca entregado y, si es un producto, lo descarga del
 * inventario de la sala. Si no se puede (otra sala, vencido, ya entregado, sin
 * existencia del regalo), lo dice en vez de ofrecer el botón.
 */
import React, { useEffect, useState } from 'react';
import ConfirmModal from '../../components/common/ConfirmModal';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { entregarPremio, fetchPremiosPorEntregar } from '@nucleo/data/puntos';

/** Por qué un premio no se puede entregar acá, o `null` si se puede. */
function impedimento(p, miSala, puedeAdministrar) {
    if (p.estado === 'ENTREGADO') return 'Ese premio ya se entregó.';
    if (p.estado === 'VENCIDO') return 'Ese premio ya venció.';
    if (p.estado === 'ENTREGANDO') return 'Ese premio se está entregando en este momento.';
    if (!p.branch_id) return 'El cliente todavía no eligió en qué sucursal lo retira: que lo elija en la app.';
    if (!puedeAdministrar && Number(p.branch_id) !== Number(miSala)) return 'Ese premio se retira en otra sucursal.';
    if (p.tipo === 'promocional' && p.hay_en_sala === false) return 'En esta sucursal no hay de ese regalo: hay que pedirlo a Bodega.';
    return null;
}

export default function EntregarPremioEscaneado({ codigo, miSala, puedeAdministrar, onCerrar, onEntregado }) {
    const showToast = useToastStore((s) => s.showToast);
    const [premio, setPremio] = useState(null);
    const [problema, setProblema] = useState(null);
    const [entregando, setEntregando] = useState(false);

    useEffect(() => {
        let vivo = true;
        // Quien administra busca en todas; la sala, en la suya. Con los
        // entregados, para poder decir «ya se entregó» en vez de «no existe».
        fetchPremiosPorEntregar(puedeAdministrar ? null : miSala, codigo, true)
            .then((lista) => {
                if (!vivo) return;
                const p = (lista ?? []).find((x) => x.codigo === codigo);
                if (!p) { setProblema(`No hay un premio ${codigo}${puedeAdministrar ? '' : ' para esta sucursal'}.`); return; }
                const no = impedimento(p, miSala, puedeAdministrar);
                if (no) setProblema(no); else setPremio(p);
            })
            .catch((e) => { if (vivo) setProblema(mensajeAmigable(e)); });
        return () => { vivo = false; };
    }, [codigo, miSala, puedeAdministrar]);

    // Lo que no se puede entregar se avisa y se cierra solo: el lector queda
    // listo para el siguiente.
    useEffect(() => {
        if (!problema) return;
        showToast('No se puede entregar', problema, 'warning');
        onCerrar?.();
    }, [problema, showToast, onCerrar]);

    const entregar = async () => {
        setEntregando(true);
        try {
            await entregarPremio(premio.id);
            showToast('Premio entregado', `${premio.codigo} · ${premio.nombre} a ${premio.cliente?.nombre ?? 'el cliente'}`, 'success');
            onEntregado?.(premio);
            onCerrar?.();
        } catch (e) {
            showToast('No se pudo entregar', mensajeAmigable(e), 'error');
        } finally {
            setEntregando(false);
        }
    };

    if (!premio) return null;
    const cantidad = Number(premio.cantidad) > 1 ? `${premio.cantidad} × ` : '';
    return (
        <ConfirmModal isOpen isDestructive={false} isProcessing={entregando}
            onClose={() => { if (!entregando) onCerrar?.(); }}
            title={`¿Entregar ${cantidad}${premio.nombre}?`}
            message={`Premio ${premio.codigo} de ${premio.cliente?.nombre ?? 'el cliente'}${premio.cliente?.documento ? ` (${premio.cliente.documento})` : ''}. ${premio.tipo === 'producto'
                ? 'Al confirmar se descarga del inventario de esta sucursal.'
                : 'Al confirmar sale del inventario de regalos de esta sucursal.'} Confirma con su documento que es la persona.`}
            confirmText="Entregar" onConfirm={entregar} />
    );
}
