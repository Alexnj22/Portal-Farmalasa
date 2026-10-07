// Torogoz · Rutas, NATIVO (`TabRutas` del portal): «Hoy» —los clientes de la
// ruta del día con su avance y la visita—, «Armar rutas» para quien administra
// y «Camiones», lo que lleva cada uno (en el portal vive en Inventario; acá va
// al lado de la ruta, que es donde se usa en la calle).
//
// La pestaña, el día y el vendedor van en la dirección, como en el portal.
// «Iniciar ruta» (el rastreo por GPS) NO está: la app todavía no tiene el
// permiso de ubicación.
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchVendedores } from '@nucleo/data/distribucion';
import { hoySV } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { FiltrosActivos, MenuDeFiltros } from '../../componentes/Filtros';
import Segmentos from '../../componentes/Segmentos';
import Hoy from '../../componentes/torogoz/rutas/Hoy';
import Armar from '../../componentes/torogoz/rutas/Armar';
import Camiones from '../../componentes/torogoz/rutas/Camiones';

const VISTAS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'armar', label: 'Armar rutas', soloConfig: true },
  { id: 'camiones', label: 'Camiones' },
];

export default function TorogozRutas() {
  const { hasPermission } = useAuth();
  const puedeConfigurar = !!hasPermission?.('distribucion_config', 'can_edit');
  const params = useLocalSearchParams();
  const vistas = VISTAS.filter((v) => !v.soloConfig || puedeConfigurar);
  const vista = vistas.some((v) => v.id === params.rutas) ? params.rutas : 'hoy';
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(params.fecha ?? '')) ? params.fecha : hoySV();
  const vendedor = puedeConfigurar && typeof params.vendedor === 'string' ? params.vendedor : '';
  const [vendedores, setVendedores] = useState([]);
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    if (!puedeConfigurar) return;
    Promise.resolve(fetchVendedores()).then(setVendedores).catch(() => {});
  }, [puedeConfigurar]);

  const opcionesVendedor = vendedores.map((v) => ({ id: v.id, label: shortEmployeeName(v) }));
  const grupos = vista === 'hoy' && puedeConfigurar ? [
    { id: 'vendedor', titulo: 'Vendedor', porDefecto: '', activa: vendedor, onCambiar: (v) => router.setParams({ vendedor: v || undefined }),
      opciones: [{ id: '', label: 'Mi ruta' }, ...opcionesVendedor] },
  ] : [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Rutas', headerLargeTitle: false }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => setVuelta((v) => v + 1)} />}>
        <Segmentos opciones={vistas} activa={vista} onCambiar={(v) => router.setParams({ rutas: v })} />
        <FiltrosActivos grupos={grupos} />
        {vista === 'hoy' ? (
          <Hoy key={vuelta} puedeConfigurar={puedeConfigurar} fecha={fecha} vendedorElegido={vendedor}
            vendedores={opcionesVendedor} onFecha={(d) => router.setParams({ fecha: d !== hoySV() ? d : undefined })} />
        ) : vista === 'armar' ? <Armar key={vuelta} /> : <Camiones key={vuelta} puedeConfigurar={puedeConfigurar} />}
      </ScrollView>
    </>
  );
}
