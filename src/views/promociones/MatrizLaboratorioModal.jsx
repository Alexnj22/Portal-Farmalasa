import React, { useState } from 'react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import MatrizLaboratorio from './MatrizLaboratorio';
import { rotuloMes } from './promocionesUtils';

/**
 * La matriz de una promoción de laboratorio, en un diálogo.
 *
 * El contenido es `MatrizLaboratorio`, el mismo panel que usa la pestaña de
 * Seguimiento: acá sólo se le pone el marco y el encabezado. El nombre y el mes
 * salen de lo que el panel ya cargó —por eso `onCabecera`— para no pedir la
 * misma promoción dos veces.
 */
export default function MatrizLaboratorioModal({ open, promocionId, onClose }) {
    const [cab, setCab] = useState(null);

    if (!open) return null;

    return (
        <LiquidModal
            open={open}
            onClose={onClose}
            maxWidth="max-w-3xl"
            ariaLabel="Avance de la promoción por laboratorio"
        >
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h2 className="text-body-xl font-semibold text-content truncate">
                        {cab?.nombre || 'Promoción por laboratorio'}
                    </h2>
                    {cab && (
                        <p className="text-caption text-content-3 mt-0.5">
                            {rotuloMes(cab.mes_medido)}
                        </p>
                    )}
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body>
                <MatrizLaboratorio key={promocionId} promocionId={promocionId} onCabecera={setCab} />
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cerrar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
