import React, { useMemo, useState } from 'react';
import { AlertTriangle, Copy } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { useStaffStore } from '../../store/staffStore';
import { SALAS_VENTA } from '../metas/metasUtils';
import { duplicarPromocion } from '../../data/promociones';
import { mensajeAmigable } from '../../utils/errorMessages';

/**
 * Copiar una promoción, opcionalmente para UNA sala.
 *
 * ── Por qué existe (2026-09-05) ───────────────────────────────────────────
 * El sistema de ventas acepta un descuento para **una sala o para todas**,
 * nunca para un conjunto con condiciones distintas. Así que cuando el
 * porcentaje, el monto o las fechas cambian de una sala a otra, **no son una
 * campaña partida: son campañas distintas**, y copiar es lo correcto.
 *
 * Es lo contrario del atajo que se descartó el mismo día —partir una campaña en
 * dos sólo para saltarse un tope— que habría duplicado lotes, tarjetas y hojas
 * de liquidación de algo negociado junto.
 *
 * ── Dos cosas que la copia NO hereda, y las dos a propósito ──────────────
 * · **Nace en borrador**, aunque el original esté activa. Duplicar no es lanzar.
 * · **No lleva el descuento del sistema de ventas.** Crearlo allá es escribir en
 *   un sistema ajeno, y hacerlo en silencio dejaría descuentos vivos que nadie
 *   pidió. Se agrega desde la copia, a la vista: **Editar → Baja el precio en la
 *   venta**. Hasta el 2026-09-05 esa frase era falsa —la ficha no tenía dónde—,
 *   así que una copia no podía tener descuento nunca.
 *
 * Y hay un límite que conviene saber ANTES de copiar: el sistema de ventas
 * admite **un descuento por producto y ventana de fechas en toda la cadena**
 * (medido cuatro veces; la sala es indiferente). O sea que una copia con los
 * mismos productos y las mismas fechas no va a poder tener el suyo — cambiarle
 * las fechas es lo que la vuelve una campaña aparte de verdad.
 */
export default function DuplicarPromocionModal({ promo, open, onClose, onDuplicada }) {
    const branches = useStaffStore((s) => s.branches);
    const salas = useMemo(
        () => SALAS_VENTA
            .map((id) => (branches || []).find((b) => Number(b.id) === id))
            .filter(Boolean),
        [branches],
    );

    const [nombre, setNombre] = useState(() => `${promo?.nombre ?? ''} (copia)`);
    const [sala, setSala] = useState('');
    const [ocupado, setOcupado] = useState(false);
    const [fallo, setFallo] = useState(null);

    const guardar = async () => {
        setFallo(null);
        setOcupado(true);
        try {
            await duplicarPromocion({ id: promo.id, nombre: nombre.trim(), branchId: sala || null });
            onDuplicada?.();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo duplicar la promoción.'));
        } finally {
            setOcupado(false);
        }
    };

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-lg" ariaLabel="Duplicar promoción">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Duplicar promoción</h2>
            </LiquidModal.Header>

            <LiquidModal.Body>
                <div className="space-y-4">
                    <PortalInput
                        label="Nombre de la copia"
                        name="nombre-copia"
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                        required
                    />

                    <div className="space-y-1 min-w-0">
                        <span className="text-label uppercase tracking-wide font-semibold text-content-2">
                            Para una sala
                        </span>
                        <LiquidSelect
                            value={sala}
                            onChange={(v) => setSala(v || '')}
                            options={salas.map((s) => ({ value: String(s.id), label: s.name }))}
                            placeholder="Copiar tal cual (mismas salas)"
                            clearLabel="Copiar tal cual"
                            ariaLabel="Sala de la copia"
                        />
                        <p className="text-caption text-content-3">
                            {sala
                                ? 'La copia sólo cuenta las ventas de esa sala.'
                                : 'La copia mantiene las salas del original.'}
                        </p>
                    </div>

                    <Notice variant="info" icon={Copy}>
                        La copia nace en <span className="font-semibold">borrador</span> y{' '}
                        <span className="font-semibold">sin descuento en la venta</span>: se le
                        agrega desde su propia ficha —<span className="font-semibold">Editar</span>—,
                        para que no quede uno vivo que nadie pidió.
                    </Notice>

                    {/* El límite del sistema de ventas, dicho ANTES de copiar y
                        no al fallar el guardado: admite UN descuento por
                        producto y ventana de fechas en toda la cadena —medido
                        cuatro veces el 2026-09-05, la sala es indiferente—, así
                        que una copia con los mismos productos y las mismas
                        fechas NO va a poder tener el suyo. Cambiarle las fechas
                        es lo que la vuelve una campaña aparte de verdad. */}
                    {promo?.descuentos > 0 && (
                        <Notice variant="warning" icon={AlertTriangle}>
                            El original ya <span className="font-semibold">baja el precio</span>. La
                            copia sólo va a poder tener el suyo si le cambias las fechas: el sistema
                            de ventas admite un solo descuento por producto en unas mismas fechas,
                            da igual la sala.
                        </Notice>
                    )}

                    {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={Copy} loading={ocupado} disabled={!nombre.trim()} onClick={guardar}>
                    Duplicar
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
