// El ícono de cada categoría de documento del expediente — la mitad de la INTERFAZ.
//
// El catálogo vive en el núcleo (`utils/documentosDelExpediente.js`) con cada ícono por NOMBRE
// (`icono: 'Home'`), porque una app nativa no puede reutilizar un catálogo que
// trae adentro componentes de la web. Esto le pone los componentes de
// `lucide-react` y entrega la MISMA API de siempre —las pantallas sólo cambian
// de dónde la importan—. Importa exactamente los íconos que importaba el
// catálogo, así ninguna pantalla carga más que antes. Enfrentado entrada por
// entrada contra la versión anterior: mismo componente. Plan en
// `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`.
import {
    Receipt,
    Award,
    CreditCard,
    FileText,
    Car,
    Bike,
    Stethoscope,
    ShieldCheck,
    ScrollText,
    Accessibility,
} from 'lucide-react';
import { nombreDelIconoDeCategoria } from '../../../utils/documentosDelExpediente';

export * from '../../../utils/documentosDelExpediente';

const ICONOS = {
    Accessibility,
    Award,
    Bike,
    Car,
    CreditCard,
    FileText,
    Receipt,
    ScrollText,
    ShieldCheck,
    Stethoscope,
};

/** El ícono de la categoría. `FileText` para lo que no tiene uno propio. */
export const iconoDeCategoria = (categoria) => ICONOS[nombreDelIconoDeCategoria(categoria)];
