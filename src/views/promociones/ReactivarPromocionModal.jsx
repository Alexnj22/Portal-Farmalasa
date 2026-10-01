import React, { useState } from 'react';
import { AlertTriangle, Percent, RotateCcw } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { reactivarPromocion } from '@nucleo/data/promociones';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hoySV, mesSV, ultimoDiaDelMes } from '@nucleo/utils/fecha';
import { fmtVigencia } from '@nucleo/utils/promocionesUtils';
import Campo from './Campo';

/**
 * Reactivar una promoción terminada (usuario, 2026-10-01: «si la quiero
 * reactivar, ¿cómo hago?»).
 *
 * Ya se podía, pero sólo de a un producto y desde una ficha a la que una
 * terminada no llegaba: Histórico no tenía acciones, y «Editar» vivía en las
 * tarjetas de Activas, donde las terminadas no se listan. Con 102 productos en
 * una sola promoción, de a uno tampoco era un camino.
 *
 * Se pide UNA fecha porque es lo que se negocia: «la extendemos hasta el 31».
 * Tiene que ser hoy o después — con una fecha pasada el ciclo diario la vuelve
 * a cerrar a la mañana siguiente y parecería que el botón no hizo nada.
 */
export default function ReactivarPromocionModal({ promo, open, onClose, onReactivada }) {
    // Sugiere el fin del mes en curso, que es como se negocian casi todas.
    const [fin, setFin] = useState(() => ultimoDiaDelMes(mesSV()));
    const [ocupado, setOcupado] = useState(false);
    const [fallo, setFallo] = useState(null);
    const hoy = hoySV();
    const fechaValida = !!fin && fin >= hoy;

    const guardar = async () => {
        setFallo(null);
        setOcupado(true);
        try {
            await reactivarPromocion(promo.id, fin);
            onReactivada?.();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo reactivar la promoción.'));
        } finally {
            setOcupado(false);
        }
    };

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-lg" ariaLabel="Reactivar promoción">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Reactivar promoción</h2>
                <p className="text-caption text-content-3 break-words">
                    {promo?.nombre} · {fmtVigencia(promo?.inicio, promo?.fin)}
                </p>
            </LiquidModal.Header>

            <LiquidModal.Body>
                <div className="space-y-4">
                    <Campo rotulo="Hasta cuándo">
                        <LiquidDatePicker value={fin} onChange={setFin} min={hoy} />
                    </Campo>
                    {fin && !fechaValida && (
                        <p className="text-caption text-danger-text">
                            Tiene que ser hoy o una fecha posterior.
                        </p>
                    )}

                    <p className="text-caption text-content-3">
                        Todos sus productos vuelven a contar hasta esa fecha, con el mismo lote,
                        reparto y bono. Los que cerraron porque se vendió el lote no se reabren:
                        mover la fecha no agrega producto.
                    </p>

                    {/* El descuento vive en el sistema de la caja con sus propias
                        fechas: reactivar la promoción NO lo mueve. Escribir allá
                        en silencio es lo que este módulo evita en todos lados. */}
                    {promo?.descuentos > 0 && (
                        <Notice variant="warning" icon={Percent}>
                            Esta promoción <span className="font-semibold">baja el precio en la venta</span>.
                            El descuento tiene sus propias fechas: después de reactivarla, muévelo
                            también desde la pestaña <span className="font-semibold">Descuentos</span>.
                        </Notice>
                    )}

                    {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={RotateCcw} loading={ocupado} disabled={!fechaValida} onClick={guardar}>
                    Reactivar
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
