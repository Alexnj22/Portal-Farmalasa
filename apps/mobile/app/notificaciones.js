// Historial de notificaciones, NATIVO — `NotificacionesView`: TODO lo que el
// portal guarda (los últimos 60 días), leído o no, incluidos los avisos que se
// quitaron de la bandeja, que se pueden devolver. La pestaña de Notificaciones
// muestra sólo lo que falta atender; esto es el resto.
//
// Pagina contra el servidor (`fetchNotificationsPage`), no filtra una lista
// recortada: más de la mitad del personal ya pasó los 100 avisos. La búsqueda
// se resuelve en la base (sin tildes, palabras en cualquier orden). Cada aviso
// es la MISMA tarjeta de la bandeja, con su detalle y sus acciones.
//
// La lista es `ListaPaginada`: virtualizada, pide la página siguiente al
// acercarse al final y trae los estados de carga, vacío y error con reintento.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { DIAS_VISIBLES, fetchNotificationsPage } from '@nucleo/data/notifications';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { MARCA } from '../componentes/inicio/marca';
import TarjetaDeAviso from '../componentes/avisos/TarjetaDeAviso';
import { abrirAviso } from '../componentes/avisos/abrir';
import { fallo, listo } from '../componentes/Progreso';
import ListaPaginada from '../componentes/ListaPaginada';

const POR_PAGINA = 25;

export default function Notificaciones() {
  const devolver = useStaffStore((s) => s.restoreNotificationsByIds);
  const [estado, setEstado] = useState('todas');
  const [texto, setTexto] = useState('');
  const busca = useTextoRebotado(texto);
  const [total, setTotal] = useState(null);
  const [vuelta, setVuelta] = useState(0); // al devolver un aviso, la lista se relee desde la página 1

  const cargarPagina = async (desdeFila, porPagina) => {
    const r = await fetchNotificationsPage({ estado, busca: busca.trim() || null, pagina: Math.floor(desdeFila / porPagina), porPagina });
    if (!r.error) setTotal(r.count ?? 0);
    return r;
  };

  const restaurar = async (n) => {
    try { await devolver([n.id]); listo('Devuelta a la bandeja', ''); setVuelta((v) => v + 1); }
    catch (e) { fallo('No se pudo devolver', e?.message || ''); }
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Historial', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Buscar en el texto del aviso', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ListaPaginada
        porPagina={POR_PAGINA}
        dependencias={[estado, busca, vuelta]}
        cargarPagina={cargarPagina}
        keyExtractor={(n) => String(n.id)}
        vacio={busca.trim() ? 'Ningún aviso con ese texto' : 'Sin avisos'}
        cabecera={(
          <View style={{ gap: 12, marginBottom: 12 }}>
            <Segmentos activa={estado} onCambiar={setEstado} opciones={[{ id: 'todas', label: 'Todas' }, { id: 'sin_leer', label: 'Sin leer' }]} />
            {total != null ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${total} aviso${total === 1 ? '' : 's'} · últimos ${DIAS_VISIBLES} días`}</Text> : null}
          </View>
        )}
        renderItem={(n) => (
          <TarjetaDeAviso n={n} margen={0} onAbrir={() => abrirAviso(n)} sinAcciones={!!n.deleted_at}
            pie={n.deleted_at ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>{`Fuera de la bandeja desde las ${cuandoLlego(n.deleted_at)}`}</Text>
                <Pressable onPress={(e) => { e.stopPropagation?.(); Haptics.selectionAsync().catch(() => {}); restaurar(n); }} hitSlop={8}
                  style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: `${MARCA.azulClaro}2E`, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>Devolver</Text>
                </Pressable>
              </View>
            ) : null} />
        )} />
    </>
  );
}
