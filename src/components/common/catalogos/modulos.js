// Los módulos del menú — la mitad de la INTERFAZ.
//
// El catálogo vive en el núcleo (`constants/moduleMap.js`) con cada ícono por NOMBRE
// (`icono: 'Home'`), porque una app nativa no puede reutilizar un catálogo que
// trae adentro componentes de la web. Esto le pone los componentes de
// `lucide-react` y entrega la MISMA API de siempre —las pantallas sólo cambian
// de dónde la importan—. Importa exactamente los íconos que importaba el
// catálogo, así ninguna pantalla carga más que antes. Enfrentado entrada por
// entrada contra la versión anterior: mismo componente. Plan en
// `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`.
import {
    CalendarCheck,
    HandCoins,
    Monitor,
    Calendar,
    Building2,
    ShieldCheck,
    LogOut,
    Menu,
    User,
    Megaphone,
    AlertTriangle,
    Activity,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    X,
    ClipboardList,
    Palmtree,
    Lock,
    Home,
    Bell,
    FolderOpen,
    Cake,
    TrendingUp,
    Gift,
    Users,
    Package,
    DollarSign,
    FileText,
    BarChart2,
    PenLine,
    Receipt,
    Target,
    FlaskConical,
    Smartphone,
    PackageMinus,
    ShoppingCart,
    ClipboardCheck,
    RadioTower,
    Ghost,
    Mail,
    Truck,
    Boxes,
    Search,
    Wrench,
    BookOpen,
    Contact,
    Calculator,
    ArrowLeftRight,
    ReceiptText,
    MonitorSmartphone,
    Printer,
    IdCard,
    Wallet,
    Landmark,
    PackagePlus,
    Thermometer,
} from 'lucide-react';
import { MODULE_MAP as BASE } from '../../../constants/moduleMap';

export * from '../../../constants/moduleMap';

const ICONOS = {
    Activity,
    AlertTriangle,
    ArrowLeftRight,
    BarChart2,
    Bell,
    BookOpen,
    Boxes,
    Building2,
    Cake,
    Calculator,
    Calendar,
    CalendarCheck,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ClipboardCheck,
    ClipboardList,
    Contact,
    DollarSign,
    FileText,
    FlaskConical,
    FolderOpen,
    Ghost,
    Gift,
    HandCoins,
    Home,
    IdCard,
    Landmark,
    Lock,
    LogOut,
    Mail,
    Megaphone,
    Menu,
    Monitor,
    MonitorSmartphone,
    Package,
    PackageMinus,
    PackagePlus,
    Palmtree,
    PenLine,
    Printer,
    RadioTower,
    Receipt,
    ReceiptText,
    Search,
    ShieldCheck,
    ShoppingCart,
    Smartphone,
    Target,
    Thermometer,
    TrendingUp,
    Truck,
    User,
    Users,
    Wallet,
    Wrench,
    X,
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

export const MODULE_MAP = conIconos(BASE);
