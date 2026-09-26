import { Banknote, Package, Scale, Send, ShieldCheck } from 'lucide-react';
import { ETAPAS_DE_BOLSA } from '../../constants/bolsas';

// Las etapas (claves, estados, alcance) viven en `constants/bolsas.js` —con el
// porqué de cada una—; acá sólo se les pone el ícono. `rangoDeDias` vive en
// `utils/bolsasTexto.js` y se re-exporta para quien ya lo importaba de acá.
const ICONOS = { Banknote, Package, Scale, Send, ShieldCheck };

export const ETAPAS = ETAPAS_DE_BOLSA.map((e) => ({ ...e, icon: ICONOS[e.icono] }));

export { rangoDeDias } from '../../utils/bolsasTexto';
