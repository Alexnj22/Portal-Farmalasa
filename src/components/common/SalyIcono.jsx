import React from 'react';
import SalyAvatar from './SalyAvatar';
import { SALY_TAMANO_MINIMO } from '@nucleo/utils/saly';

/** Saly como ícono de un botón que le pide algo («Pedirle el resumen a Saly»).
 * Va al tamaño mínimo aunque el botón pida 15 px; el margen negativo evita que
 * el botón crezca por ella. */
export default function SalyIcono({ className = '' }) {
    return <SalyAvatar animo="atencion" size={SALY_TAMANO_MINIMO} className={`-my-2 -ml-1 ${className}`} decorativa />;
}
