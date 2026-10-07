// Inventario de Torogoz, NATIVO — la sección «Inventario» del portal con sus
// cuatro vistas: Lotes (existencia por lote y vencimiento, cuarentena),
// Reposición (mínimo, máximo y pedido sugerido), Conteo y bajas, y Camiones
// (que es su propia pantalla, `/torogoz/camiones`). La vista va en la
// dirección (`?vista=`), como el `?inventario=` del portal: un enlace o volver
// atrás abre la misma. El buscador de arriba es de la vista.
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchEmisor } from '@nucleo/data/distribucion';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import Segmentos from '../../componentes/Segmentos';
import { colorSistema } from '../../componentes/Formulario';
import Lotes from '../../componentes/torogoz/bodega/Lotes';
import Reposicion from '../../componentes/torogoz/bodega/Reposicion';
import Conteo from '../../componentes/torogoz/bodega/Conteo';

const VISTAS = [
  { id: 'lotes', label: 'Lotes' },
  { id: 'reposicion', label: 'Reposición' },
  { id: 'conteo', label: 'Conteo y bajas' },
  { id: 'camiones', label: 'Camiones' },
];
const BUSCAR = { lotes: 'Producto o lote', reposicion: 'Producto o proveedor', conteo: 'Producto o lote' };

export default function Inventario() {
  const { vista: enUrl } = useLocalSearchParams();
  const vista = VISTAS.some((v) => v.id === enUrl && v.id !== 'camiones') ? enUrl : 'lotes';
  const { hasPermission } = useAuth();
  const puedeVender = !!hasPermission?.('distribucion', 'can_edit');
  const puedeConfigurar = !!hasPermission?.('distribucion_config', 'can_edit');
  const [emisor, setEmisor] = useState(undefined);
  const [buscar, setBuscar] = useState('');
  const [llave, setLlave] = useState(0);
  const [recargando, setRecargando] = useState(false);

  useEffect(() => { fetchEmisor().then((e) => setEmisor(e ?? null)).catch(() => setEmisor(null)); }, []);
  // El buscador es de la vista: al cambiar, se limpia.
  useEffect(() => { setBuscar(''); }, [vista]);

  const cambiar = (v) => {
    if (v === 'camiones') { router.push('/torogoz/camiones'); return; }
    router.setParams({ vista: v });
  };
  const comunes = { emisor: emisor ?? null, puedeVender, puedeConfigurar, buscar };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Inventario', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: BUSCAR[vista], hideWhenScrolling: true,
          onChangeText: (e) => setBuscar(e.nativeEvent.text), onCancelButtonPress: () => setBuscar(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={() => { setRecargando(true); setLlave((k) => k + 1); setTimeout(() => setRecargando(false), 600); }} />}>
        <Segmentos opciones={VISTAS} activa={vista} onCambiar={cambiar} />
        {emisor === null && puedeVender ? (
          <View style={{ marginHorizontal: 20 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {puedeConfigurar ? 'Todavía no están los datos de la empresa que factura: complétalos en Empresa para registrar entradas.'
                : 'Todavía no están los datos de la empresa que factura. Pídele a quien administra la distribuidora que los complete.'}
            </Text>
          </View>
        ) : null}
        {vista === 'reposicion' ? <Reposicion key={`r${llave}`} {...comunes} />
          : vista === 'conteo' ? <Conteo key={`c${llave}`} {...comunes} />
            : <Lotes key={`l${llave}`} {...comunes} />}
      </ScrollView>
    </>
  );
}
