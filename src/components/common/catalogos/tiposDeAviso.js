// El ícono de cada tipo de aviso y solicitud — la mitad de la INTERFAZ.
//
// El catálogo vive en el núcleo (`constants/tipoIconos.js`) con cada ícono por NOMBRE
// (`icono: 'Home'`), porque una app nativa no puede reutilizar un catálogo que
// trae adentro componentes de la web. Esto le pone los componentes de
// `lucide-react` y entrega la MISMA API de siempre —las pantallas sólo cambian
// de dónde la importan—. Importa exactamente los íconos que importaba el
// catálogo, así ninguna pantalla carga más que antes. Enfrentado entrada por
// entrada contra la versión anterior: mismo componente. Plan en
// `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`.
import {
    Palmtree,
    FileText,
    RefreshCw,
    Coffee,
    DollarSign,
    FileCheck,
    Stethoscope,
    Ban,
    CreditCard,
    UserCog,
    Contact,
    CalendarClock,
    CalendarX2,
    Package,
    BarChart2,
    ClipboardList,
    Info,
    Bell,
    PackagePlus,
    Trash2,
    ArrowLeftRight,
    Wallet,
    Target,
    Landmark,
    Archive,
} from 'lucide-react';
import { NOMBRE_DE_ICONO_POR_TIPO, nombreDelIconoDeTipo } from '../../../constants/tipoIconos';

export * from '../../../constants/tipoIconos';

const ICONOS = {
    Archive,
    ArrowLeftRight,
    Ban,
    BarChart2,
    Bell,
    CalendarClock,
    CalendarX2,
    ClipboardList,
    Coffee,
    Contact,
    CreditCard,
    DollarSign,
    FileCheck,
    FileText,
    Info,
    Landmark,
    Package,
    PackagePlus,
    Palmtree,
    RefreshCw,
    Stethoscope,
    Target,
    Trash2,
    UserCog,
    Wallet,
};

export const ICONO_POR_TIPO = Object.fromEntries(
    Object.entries(NOMBRE_DE_ICONO_POR_TIPO).map(([tipo, nombre]) => [tipo, ICONOS[nombre]]),
);

/** Ícono de un tipo. Nunca devuelve undefined. */
export const iconoDeTipo = (type = '') => ICONOS[nombreDelIconoDeTipo(type)];
