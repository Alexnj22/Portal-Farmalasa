import React from 'react';
import { Crown } from 'lucide-react';
import Badge from '../../components/common/Badge';
import { PREFERENTE, esPreferente } from '@nucleo/utils/chatClientes';

// El chip «Preferente» (2026-10-14): cliente Platino o Mayorista aprobado. Va
// SÓLIDO para que no se confunda con el chip suave de su nivel ni con las
// etiquetas que pone el equipo. Nada si el cliente no lo es.
export default function ChipPreferente({ conversacion }) {
    if (!esPreferente(conversacion)) return null;
    return (
        <Badge variant={PREFERENTE.variant} tone="solid" size="sm" icon={Crown} uppercase={false}
            title="Cliente Platino o Mayorista: se atiende primero">
            {PREFERENTE.label}
        </Badge>
    );
}
