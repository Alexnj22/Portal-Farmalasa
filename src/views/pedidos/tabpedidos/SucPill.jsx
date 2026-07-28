// Extracted from TabPedidos.jsx (Bloque 6.C)
import { Building2 } from 'lucide-react';
import { ERP_NAMES } from '../../../constants/erp';
import { SUC_VARIANTE } from './constants';
import Badge from '../../../components/common/Badge';

export default function SucPill({ sucId }) {
    return (
        <Badge variant={SUC_VARIANTE[sucId] ?? 'neutral'} icon={Building2}
            uppercase={false} className="shrink-0">
            {ERP_NAMES[sucId] ?? `Suc. ${sucId}`}
        </Badge>
    );
}
