import React, { useCallback, useEffect, useState } from 'react';
import { Ban, ShieldCheck } from 'lucide-react';
import Button from '../common/Button';
import ConfirmModal from '../common/ConfirmModal';
import BotonCarneDePapel from './BotonCarneDePapel';
import { fetchCarnesTemporales, anularCarneTemporal, carneVigente } from '../../data/carneTemporal';
import { useToastStore } from '../../store/toastStore';
import { useStaffStore } from '../../store/staffStore';
import { mensajeAmigable } from '../../utils/errorMessages';

/**
 * El carné de papel de una persona: imprimirlo, ver si tiene uno vivo y matarlo.
 *
 * ── Por qué el «anular» no es opcional ──────────────────────────────────────
 * Un carné de papel se pierde, se olvida sobre un mostrador o se lo lleva quien
 * ya no trabaja ese día. Vence solo a medianoche, pero entre que se pierde y
 * que vence puede haber doce horas — y en esas doce horas abre el portal y marca
 * en el kiosco igual que el carné de plástico. Sin este botón, la única salida
 * sería reimprimirlo (que sí mata el anterior) y tirar el papel nuevo, o sea
 * usar un efecto secundario como si fuera la función.
 *
 * Anular apaga las TRES puertas de una vez —el escaneo, la sesión abierta con
 * ese papel y la cuenta que lo respalda—; lo hace el servidor, en
 * `anular_carne_temporal`.
 *
 * ── Lo que esta pantalla NO muestra ─────────────────────────────────────────
 * El secreto. Existió entre la respuesta del servidor y el papel, y ahí se
 * acabó: en la base sólo hay un hash. Un carné que se traspapeló no se puede
 * «volver a ver» — se anula y se imprime otro.
 */
export default function CarneDelDia({ employeeId, nombre, cargo = '', sala = '' }) {
    const [vigente, setVigente] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [anulando, setAnulando] = useState(false);
    const [confirmando, setConfirmando] = useState(false);
    const [falloLaLectura, setFalloLaLectura] = useState(false);

    const releer = useCallback(async () => {
        if (!employeeId) return;
        setCargando(true);
        try {
            const { data, error } = await fetchCarnesTemporales(employeeId, 5);
            // «No lo pude leer» NO se pinta como «no tiene»: un carné vivo que
            // no se ve es un papel que nadie va a anular. Se dice que falló.
            if (error) throw error;
            setVigente((data || []).find(carneVigente) || null);
            setFalloLaLectura(false);
        } catch {
            setVigente(null);
            setFalloLaLectura(true);
        } finally {
            setCargando(false);
        }
    }, [employeeId]);

    useEffect(() => { releer(); }, [releer]);

    const anular = useCallback(async () => {
        if (!vigente) return;
        setAnulando(true);
        const { showToast } = useToastStore.getState();
        try {
            const r = await anularCarneTemporal(vigente.id);
            if (r?.ok) {
                useStaffStore.getState().appendAuditLog?.('CARNE_TEMPORAL_ANULADO', employeeId, {
                    carne_id: vigente.id,
                });
                showToast('Carné anulado', 'Ese papel ya no sirve para nada.', 'success');
            } else {
                showToast('No se anuló', r?.motivo || 'Intenta de nuevo.', 'error');
            }
        } catch (err) {
            showToast('No se anuló', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setAnulando(false);
            setConfirmando(false);
            releer();
        }
    }, [vigente, employeeId, releer]);

    return (
        <div className="flex flex-col items-center gap-2">
            <div className="flex flex-wrap gap-2 justify-center">
                <BotonCarneDePapel
                    employeeId={employeeId} nombre={nombre} cargo={cargo} sala={sala}
                    motivo="Desde el perfil" alImprimir={releer}
                >Carné del día</BotonCarneDePapel>

                {vigente && (
                    <Button variant="destructive" icon={Ban} loading={anulando}
                        onClick={() => setConfirmando(true)}>
                        Anular el vigente
                    </Button>
                )}
            </div>

            {/* El estado se dice SIEMPRE, también cuando no hay ninguno: «no
                tiene» y «no lo pude leer» se ven igual si la línea desaparece. */}
            {!cargando && (
                <p className="text-micro font-bold text-content-3 flex items-center gap-1.5 text-center">
                    <ShieldCheck size={12} className={vigente ? 'text-success' : 'text-content-3'} />
                    {falloLaLectura
                        ? 'No se pudo leer si tiene un carné de papel vigente.'
                        : vigente
                            ? 'Tiene un carné de papel vigente hasta medianoche de hoy.'
                            : 'No tiene ningún carné de papel vigente.'}
                </p>
            )}

            <ConfirmModal
                isOpen={confirmando}
                onClose={() => setConfirmando(false)}
                onConfirm={anular}
                title="Anular el carné de papel"
                confirmText="Anular"
                isProcessing={anulando}
                message={`El papel que tenga ${nombre || 'esta persona'} deja de servir en el acto: no abre el portal, no marca en el kiosco y no firma nada. Si tiene una sesión abierta con él, se le cierra. Para darle otro hay que imprimirlo de nuevo.`}
            />
        </div>
    );
}
