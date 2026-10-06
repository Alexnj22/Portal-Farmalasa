// La etapa y el rótulo de una tarjeta de pedido en la app — la lista y la
// ficha la leen igual. La etapa sale de `getBranchStage` (núcleo, la del
// tablero); un pedido ya ENVIADO está en camino aunque su sala no tenga hora de
// salida propia: el portal ofrece «Confirmar llegada» igual.
import { getBranchStage } from '@nucleo/utils/tableroDePedidos';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';

export const ETAPA = {
  sin_iniciar: ['En cola', colorSistema.texto2], preparando: ['Preparando', MARCA.azulClaro], pausado: ['En pausa', MARCA.ambar],
  preparado: ['Listo para salir', MARCA.azulClaro], transito: ['En camino', MARCA.azulClaro], contando: ['Por contar', MARCA.ambar], erp: ['Recibido', MARCA.verde],
};

export const PASOS = [
  { id: 'preparando', rotulo: 'Preparando' }, { id: 'transito', rotulo: 'En camino' },
  { id: 'contando', rotulo: 'Llegó' }, { id: 'erp', rotulo: 'Recibido' },
];

export const pasoDeLaEtapa = (e) => (e === 'sin_iniciar' || e === 'pausado' || e === 'preparado' ? 'preparando' : e);

export function etapaDeLaTarjeta(r) {
  const base = getBranchStage(r);
  return base === 'preparado' && (r.pedido_status ?? r.status) === 'enviado' ? 'transito' : base;
}
