import React, { useState } from 'react';
import { Plus, Check } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import Switch from '../../components/common/Switch';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { guardarMarca, activarRed } from '@nucleo/data/marketing';
import { COLORES_MARCA, puntoDeMarca } from './iconos';

/**
 * Las marcas y las redes. Una marca nueva entra con el siguiente color libre;
 * apagar una marca o una red la saca de los formularios sin tocar lo ya
 * planificado.
 */
export default function AjustesModal({ open, onClose, marcas, redes, onCambio }) {
    const showToast = useToastStore((s) => s.showToast);
    const [nueva, setNueva] = useState('');
    const [guardando, setGuardando] = useState(false);

    if (!open) return null;

    const usados = new Set(marcas.map((m) => m.color));
    const libre = COLORES_MARCA.find((c) => !usados.has(c)) || COLORES_MARCA[marcas.length % COLORES_MARCA.length];

    const intentar = async (fn) => {
        setGuardando(true);
        try {
            await fn();
            onCambio?.();
        } catch (err) {
            showToast('No se pudo guardar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    const agregar = () => intentar(async () => {
        await guardarMarca({ nombre: nueva, color: libre, activo: true, orden: marcas.length + 1 });
        setNueva('');
    });

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-md" ariaLabel="Marcas y redes">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Marcas y redes</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-6">
                    <section className="space-y-2">
                        <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">Marcas</h3>
                        {marcas.map((m) => (
                            <div key={m.id} className="flex items-center gap-3 min-h-[var(--tap-min)]">
                                <span className={`w-3 h-3 rounded-full shrink-0 ${puntoDeMarca(m.color)}`} aria-hidden />
                                <span className="flex-1 text-body-sm text-content truncate">{m.nombre}</span>
                                <Switch checked={m.activo} label={`${m.nombre} activa`} disabled={guardando}
                                    onChange={(on) => intentar(() => guardarMarca({ ...m, activo: on }))} />
                            </div>
                        ))}
                        <div className="flex items-end gap-2">
                            <div className="flex-1 min-w-0">
                                <PortalInput label="Nueva marca" name="nueva_marca" value={nueva}
                                    onChange={(e) => setNueva(e.target.value)} placeholder="Nombre de la página" />
                            </div>
                            <Button variant="secondary" icon={Plus} disabled={!nueva.trim()} loading={guardando} onClick={agregar}>
                                Agregar
                            </Button>
                        </div>
                    </section>
                    <section className="space-y-2">
                        <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">Redes</h3>
                        {redes.map((r) => (
                            <div key={r.clave} className="flex items-center gap-3 min-h-[var(--tap-min)]">
                                <span className="flex-1 text-body-sm text-content">{r.nombre}</span>
                                <Switch checked={r.activo} label={`${r.nombre} activa`} disabled={guardando}
                                    onChange={(on) => intentar(() => activarRed(r.clave, on))} />
                            </div>
                        ))}
                    </section>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button icon={Check} onClick={onClose}>Listo</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
