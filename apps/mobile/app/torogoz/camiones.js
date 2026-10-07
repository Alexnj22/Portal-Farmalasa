// Torogoz · Camiones, NATIVO — la misma pieza que la pestaña «Camiones» de
// Rutas, sola, para entrar desde Inventario (en el portal es la cuarta
// pestaña de Inventario, `?inventario=camiones`).
import { useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import Camiones from '../../componentes/torogoz/rutas/Camiones';

export default function TorogozCamiones() {
  const { hasPermission } = useAuth();
  const puedeConfigurar = !!hasPermission?.('distribucion_config', 'can_edit');
  const [vuelta, setVuelta] = useState(0);
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Camiones', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => setVuelta((v) => v + 1)} />}>
        <Camiones key={vuelta} puedeConfigurar={puedeConfigurar} />
      </ScrollView>
    </>
  );
}
