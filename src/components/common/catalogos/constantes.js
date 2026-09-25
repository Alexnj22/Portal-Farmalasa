// Los tipos de evento de personal — la mitad de la INTERFAZ.
//
// El catálogo vive en el núcleo (`data/constants.js`) con cada ícono por NOMBRE
// (`icono: 'Home'`), porque una app nativa no puede reutilizar un catálogo que
// trae adentro componentes de la web. Esto le pone los componentes de
// `lucide-react` y entrega la MISMA API de siempre —las pantallas sólo cambian
// de dónde la importan—. Importa exactamente los íconos que importaba el
// catálogo, así ninguna pantalla carga más que antes. Enfrentado entrada por
// entrada contra la versión anterior: mismo componente. Plan en
// `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`.
import {
    FileText,
    IdCard,
    User,
    HeartPulse,
    AlertCircle,
    Paperclip,
    Calendar,
    TrendingUp,
    ArrowRightLeft,
    Building2,
    Watch,
    LogOut,
    GraduationCap,
    ClipboardList,
    DollarSign,
    RefreshCw,
    MessageSquareWarning,
    FileWarning,
    Ban,
    ShieldCheck,
} from 'lucide-react';
import { EVENT_TYPES as BASE } from '../../../data/constants';

export * from '../../../data/constants';

const ICONOS = {
    AlertCircle,
    ArrowRightLeft,
    Ban,
    Building2,
    Calendar,
    ClipboardList,
    DollarSign,
    FileText,
    FileWarning,
    GraduationCap,
    HeartPulse,
    IdCard,
    LogOut,
    MessageSquareWarning,
    Paperclip,
    RefreshCw,
    ShieldCheck,
    TrendingUp,
    User,
    Watch,
};

// Le agrega `.icon` a todo objeto del catálogo que tenga `icono`, a cualquier
// profundidad (los módulos traen sub-permisos adentro).
const conIconos = (v) => {
    if (Array.isArray(v)) return v.map(conIconos);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
        const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conIconos(x)]));
        if (typeof v.icono === 'string') o.icon = ICONOS[v.icono];
        return o;
    }
    return v;
};

export const EVENT_TYPES = conIconos(BASE);
