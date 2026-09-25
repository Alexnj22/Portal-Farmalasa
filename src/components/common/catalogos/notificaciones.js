// La severidad de un aviso por su emoji — la mitad de la INTERFAZ.
//
// El catálogo vive en el núcleo (`utils/notificacionTexto.js`) con cada ícono por NOMBRE
// (`icono: 'Home'`), porque una app nativa no puede reutilizar un catálogo que
// trae adentro componentes de la web. Esto le pone los componentes de
// `lucide-react` y entrega la MISMA API de siempre —las pantallas sólo cambian
// de dónde la importan—. Importa exactamente los íconos que importaba el
// catálogo, así ninguna pantalla carga más que antes. Enfrentado entrada por
// entrada contra la versión anterior: mismo componente. Plan en
// `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`.
import {
    AlertCircle,
    AlertTriangle,
    CheckCircle2,
} from 'lucide-react';
import { SEVERIDAD as BASE, severidadDelTitulo as severidadBase } from '../../../utils/notificacionTexto';

export * from '../../../utils/notificacionTexto';

const ICONOS = {
    AlertCircle,
    AlertTriangle,
    CheckCircle2,
};

// Con `Icono` (mayúscula): es el nombre de campo que siempre leyó la tarjeta.
const conIcono = (s) => (s ? { ...s, Icono: ICONOS[s.icono] } : s);

export const SEVERIDAD = BASE.map(conIcono);
export const severidadDelTitulo = (titulo = '') => conIcono(severidadBase(titulo));
