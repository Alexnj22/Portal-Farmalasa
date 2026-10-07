// Torogoz › Caja y liquidación, NATIVO — la sección del portal con sus dos
// vistas (`VISTAS_CAJA`): «Por vendedor» (la liquidación y la caja del día) y
// «Cierre del día» (la empresa entera), que sólo ve quien configura
// (`distribucion_config`). El día y el vendedor se comparten entre las dos:
// tocar un vendedor en el cierre abre su liquidación de ese mismo día.
// `?fecha=`, `?vendedor=` y `?caja=dia` abren exactamente esa vista, como la
// dirección del portal.
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchEmisor } from '@nucleo/data/distribucion';
import { VISTAS_CAJA } from '@nucleo/utils/distribucionCaja';
import { hoySV } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import Segmentos from '../../componentes/Segmentos';
import Liquidacion from '../../componentes/torogoz/caja/Liquidacion';
import CierreDelDia from '../../componentes/torogoz/caja/CierreDelDia';

const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));

export default function CajaYLiquidacion() {
  const p = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeConfigurar = !!hasPermission?.('distribucion_config', 'can_edit');
  const vistas = VISTAS_CAJA.filter((v) => puedeConfigurar || v.key !== 'dia');
  const [vista, setVista] = useState(p.caja === 'dia' && puedeConfigurar ? 'dia' : 'vendedor');
  const [fecha, setFecha] = useState(esFecha(p.fecha) ? p.fecha : hoySV());
  const [vendedor, setVendedor] = useState(p.vendedor ? String(p.vendedor) : null);
  const [emisor, setEmisor] = useState(null);
  const [recarga, setRecarga] = useState(0);
  const [recargando, setRecargando] = useState(false);

  useEffect(() => { fetchEmisor().then(setEmisor).catch(() => setEmisor(null)); }, []);
  const refrescar = useCallback(() => { setRecargando(true); setRecarga((n) => n + 1); setTimeout(() => setRecargando(false), 600); }, []);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Caja y liquidación', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 14, paddingBottom: 56 }}
        contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={refrescar} />}>
        {vistas.length > 1 ? <Segmentos activa={vista} onCambiar={setVista} opciones={vistas.map((v) => ({ id: v.key, label: v.label }))} /> : null}
        {vista === 'dia' && puedeConfigurar ? (
          <CierreDelDia fecha={fecha} onFecha={setFecha} emisor={emisor} recarga={recarga}
            onVendedor={(id) => { setVendedor(String(id)); setVista('vendedor'); }} />
        ) : (
          <Liquidacion fecha={fecha} onFecha={setFecha} vendedor={vendedor} onVendedor={(id) => setVendedor(String(id))}
            puedeConfigurar={puedeConfigurar} emisor={emisor} recarga={recarga} />
        )}
      </ScrollView>
    </>
  );
}
