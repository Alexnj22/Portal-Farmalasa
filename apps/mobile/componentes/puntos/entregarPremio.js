// Entregar un premio del raspable (producto o regalo promocional) por su
// código, NATIVO — `EntregarPremioEscaneado` del portal. Lo usan los dos
// caminos de la app: escanear el código en la pestaña Consulta y «Entregar
// aquí» en la pestaña Premios (2026-10-22). La misma regla del portal: se
// retira en CUALQUIER sucursal y entrega la que lo atiende; un regalo apartado
// se retira en la suya; si aquí no hay el regalo, el cliente elige apartarlo
// donde hay o pedirlo para esta sala. Confirma antes de entregar: el producto
// se descarga del inventario de la sala y no se deshace desde aquí.
import { Alert } from 'react-native';
import { apartarPremio, entregarPremio, fetchPremiosPorEntregar, pedirPremio } from '@nucleo/data/puntos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fallo, listo, trabajando } from '../Progreso';

/** `sala`: la que entrega. `alTerminar`: se llama cuando algo cambió (para recargar). */
export async function entregarPremioPorCodigo({ codigo, sala, nombreSala, alTerminar }) {
  try {
    const lista = await fetchPremiosPorEntregar(sala, codigo, true);
    const p = (lista ?? []).find((x) => x.codigo === codigo);
    const no = !p ? `No hay un premio ${codigo}.`
      : p.estado === 'ENTREGADO' ? 'Ese premio ya se entregó.'
        : p.estado === 'VENCIDO' ? 'Ese premio ya venció.'
          : p.tipo === 'promocional' && p.reserva_branch && Number(p.reserva_branch) !== Number(sala)
            ? `Ese regalo está apartado para el cliente en ${nombreSala(p.reserva_branch)}: se retira allá.`
            : null;
    if (no) { Alert.alert('No se puede entregar', no); return; }
    // Un regalo que aquí no hay: se dice dónde hay y el cliente elige.
    if (p.tipo === 'promocional' && p.hay_en_sala === false) {
      const otras = (p.hay_en ?? []).filter((x) => Number(x.branch_id) !== Number(sala));
      const hacer = async (fn, donde, ok) => {
        trabajando('Guardando…');
        try { await fn(p.id, donde); listo(ok); alTerminar?.(); } catch (e) { fallo('No se pudo', mensajeAmigable(e)); }
      };
      Alert.alert(`Aquí no hay ${p.nombre}`, 'Pregúntale al cliente qué prefiere. Se le avisa en la app.', [
        ...otras.slice(0, 2).map((x) => ({ text: `Apartarlo en ${nombreSala(x.branch_id)}`, onPress: () => hacer(apartarPremio, x.branch_id, 'Regalo apartado') })),
        { text: 'Pedirlo para esta sucursal', onPress: () => hacer(pedirPremio, sala, 'Regalo pedido') },
        { text: 'Cancelar', style: 'cancel' },
      ]);
      return;
    }
    const cuantos = Number(p.cantidad) > 1 ? `${p.cantidad} × ` : '';
    Alert.alert(`¿Entregar ${cuantos}${p.nombre}?`,
      `Premio ${p.codigo} de ${p.cliente?.nombre ?? 'el cliente'}. ${p.tipo === 'producto' ? 'Se descarga del inventario de esta sucursal.' : 'Sale del inventario de regalos de esta sucursal.'} Confirma con su documento que es la persona.`,
      [{ text: 'Cancelar', style: 'cancel' }, { text: 'Entregar', onPress: async () => {
        trabajando('Entregando…');
        try { await entregarPremio(p.id, sala); listo('Premio entregado', `${p.codigo} · ${p.nombre}`); alTerminar?.(); }
        catch (e) { fallo('No se pudo entregar', mensajeAmigable(e)); }
      } }]);
  } catch (e) {
    Alert.alert('No se pudo buscar el premio', mensajeAmigable(e));
  }
}
