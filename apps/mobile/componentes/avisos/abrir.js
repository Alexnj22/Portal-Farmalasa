// Qué pasa al tocar un aviso — el mismo toque en la pestaña de Notificaciones
// y en el historial: lo marca leído y abre su pantalla. Un corte nuevo abre ESE
// corte; una solicitud (también Min·Máx), la solicitud; lo demás, su enlace.
import { router } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { esAvisoDeMinMax } from '@nucleo/data/solicitudDeAviso';
import { abrirRuta, abrirSolicitud } from '../../pantallas';

export function abrirAviso(n) {
  if (!n.read_at && !n.deleted_at) useStaffStore.getState().markNotificationRead?.(n.id);
  if (n.type === 'CORTE_NUEVO' && n.metadata?.corte_id) {
    return router.push({ pathname: '/corte/[id]', params: { id: String(n.metadata.corte_id), fecha: n.metadata.fecha ?? '' } });
  }
  const id = n.metadata?.request_id;
  if (id) return abrirSolicitud(esAvisoDeMinMax(n) ? `minmax:${id}` : id);
  if (n.link) return abrirRuta(n.link);
  return null;
}
