// Torogoz, la distribuidora, NATIVO — la entrada: el mismo menú del portal
// (`TorogozLayout`), con los mismos permisos. Vender (`distribucion` editar)
// abre «Nueva venta»; las secciones marcadas `soloConfig` sólo las ve quien
// configura (`distribucion_config` editar). Los números del menú —descuentos
// por decidir y lo que falta con Hacienda— salen de las mismas consultas.
//
// Cada sección es su propia pantalla (`/torogoz/<seccion>`), igual que la
// dirección del portal, así un enlace de un aviso abre la misma.
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { contarDescuentosPendientes, contarFacturacionPendiente } from '@nucleo/data/distribucion';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { BotonGrande } from '../../componentes/formulario/Piezas';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { iconoDe } from '../../tema/iconos';
import { useRastreoDeRuta } from '../../componentes/torogoz/rutas/rastreo';

// El color de la marca de la distribuidora (COLORES_DISTRIBUIDORA.petroleo).
const PETROLEO = '#0f6e7d';

const MENU = [
  { seccion: 'inicio', label: 'Inicio', icono: 'Gauge' },
  { seccion: 'rutas', label: 'Rutas', icono: 'Truck' },
  { seccion: 'pedidos', label: 'Pedidos', icono: 'ClipboardList' },
  { seccion: 'documentos', label: 'Facturación', icono: 'FileCheck', contador: 'facturacion' },
  { seccion: 'cobros', label: 'Cuentas por cobrar', icono: 'HandCoins' },
  { seccion: 'liquidacion', label: 'Caja y liquidación', icono: 'Wallet' },
  { seccion: 'clientes', label: 'Clientes', icono: 'Users' },
  { seccion: 'catalogo', label: 'Catálogo', icono: 'Search' },
  { seccion: 'compras', label: 'Compras', icono: 'ShoppingCart', soloConfig: true },
  { seccion: 'inventario', label: 'Inventario', icono: 'Boxes' },
  { seccion: 'perdidas', label: 'Ventas perdidas', icono: 'PackageMinus' },
  { seccion: 'reportes', label: 'Reportes', icono: 'TrendingUp', soloConfig: true },
  { seccion: 'solicitudes', label: 'Solicitudes', icono: 'Percent', contador: 'descuentos' },
  { seccion: 'emisor', label: 'Empresa', icono: 'Landmark', soloConfig: true },
];

function Mosaico({ item, numero, grave }) {
  return (
    <Pressable style={{ width: '48%' }} accessibilityRole="button" accessibilityLabel={item.label}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push(`/torogoz/${item.seccion}`); }}>
      {({ pressed }) => (
        <Vidrio radio={20} interactivo>
          <View style={{ padding: 14, gap: 10, minHeight: 92, transform: [{ scale: pressed ? 0.97 : 1 }] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: `${PETROLEO}55` }}>
                <Host matchContents><Icon name={iconoDe(item.icono)} size={18} color="#fff" /></Host>
              </View>
              {numero ? (
                <View style={{ minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: grave ? MARCA.rojo : MARCA.ambar }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>{numero > 99 ? '99+' : numero}</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{item.label}</Text>
          </View>
        </Vidrio>
      )}
    </Pressable>
  );
}

export default function Torogoz() {
  const { user, hasPermission } = useAuth();
  const puedeVender = !!hasPermission?.('distribucion', 'can_edit');
  // Como el marco de Torogoz en el portal: si el teléfono quedó en ruta hoy,
  // el recorrido se retoma al entrar (ver `componentes/torogoz/rutas/rastreo.js`).
  const { enRuta, fondo } = useRastreoDeRuta(puedeVender ? user?.id : null);
  const puedeConfigurar = !!hasPermission?.('distribucion_config', 'can_edit');
  const [cuentas, setCuentas] = useState({ descuentos: 0, facturacion: 0, grave: false });
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const [d, f] = await Promise.all([
      contarDescuentosPendientes().catch(() => 0),
      contarFacturacionPendiente().catch(() => ({})),
    ]);
    setCuentas({
      descuentos: d ?? 0,
      facturacion: (f.por_enviar ?? 0) + (f.rechazados ?? 0) + (f.invalidaciones ?? 0) + (f.contingencia ?? 0),
      grave: (f.rechazados ?? 0) > 0,
    });
  }, []);
  // Se relee al volver: el número del menú no se queda viejo.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const items = MENU.filter((i) => !i.soloConfig || puedeConfigurar);
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Torogoz', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>La distribuidora: ventas en ruta, facturación y bodega.</Text>
        {enRuta ? (
          <Pressable onPress={() => router.push('/torogoz/rutas')} accessibilityRole="button" accessibilityLabel="En ruta: ver la ruta de hoy">
            <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '600', marginHorizontal: 4 }}>{fondo ? '● En ruta: se anota tu recorrido, aun con la app cerrada ›' : '● En ruta: se anota tu recorrido mientras la app esté abierta ›'}</Text>
          </Pressable>
        ) : null}
        {puedeVender ? <BotonGrande texto="Nueva venta" color={PETROLEO} onPress={() => router.push('/torogoz/venta')} /> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 }}>
          {items.map((i) => (
            <Mosaico key={i.seccion} item={i} numero={i.contador ? cuentas[i.contador] : 0} grave={i.contador === 'facturacion' && cuentas.grave} />
          ))}
        </View>
      </ScrollView>
    </>
  );
}
