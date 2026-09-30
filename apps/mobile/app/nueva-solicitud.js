// Nueva solicitud: qué se quiere pedir. Las familias operativas salen del
// núcleo (`familiasDisponibles`, las mismas del portal con su permiso) y las
// personales, del permiso `requests_personales.can_edit`.
//
// Cada una abre su formulario NATIVO; las que todavía no lo tienen abren el
// formulario del portal dentro de la app (y lo dicen), hasta que lo tengan.
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { familiasDisponibles } from '@nucleo/constants/familiasOperativas';
import { REQUEST_TYPES } from '@nucleo/store/slices/requestsSlice';
import { nombreDelIconoDeTipo } from '@nucleo/constants/tipoIconos';
import { Chip } from '../componentes/inicio/Widget';
import Vidrio from '../componentes/Vidrio';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { MARCA } from '../componentes/inicio/marca';

// Dónde abre cada familia. `null` = todavía en el portal.
const NATIVA = { facturacion: '/nueva/facturas', traslado: '/pedir-traslado', inventario: null, minmax: null };
const COLOR = { inventario: MARCA.ambar, facturacion: MARCA.rojo, minmax: MARCA.azulClaro, traslado: MARCA.verde };
const PERSONALES = ['VACATION', 'PERMIT', 'DISABILITY', 'SHIFT_CHANGE', 'OVERTIME', 'ADVANCE', 'CERTIFICATE'];

function Opcion({ icono, color, titulo, detalle, enPortal, onPress, primero }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
        borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
      <Chip icono={icono} color={color} tamano={34} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{detalle}</Text> : null}
        {enPortal ? <Text style={{ color: colorSistema.texto2, fontSize: 12, marginTop: 2 }}>Se abre en el portal</Text> : null}
      </View>
      <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text>
    </Pressable>
  );
}

export default function NuevaSolicitud() {
  const { hasPermission } = useAuth();
  // Igual que los lanzadores del tablero del portal: cada familia con el
  // permiso de SU widget (`dash_*`), no con `requests.can_edit`.
  const familias = familiasDisponibles(hasPermission);
  const personales = hasPermission('requests_personales', 'can_edit');
  const alPortal = (ruta, nombre) => router.push({ pathname: '/portal', params: { ruta, nombre } });

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Nueva solicitud', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 22, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        {familias.length ? (
          <View style={{ gap: 7 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>De la sala</Text>
            <Vidrio radio={22}><View style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
              {familias.map((f, i) => (
                <Opcion key={f.key} primero={!i} icono={f.icono} color={COLOR[f.key] ?? MARCA.azul} titulo={f.label} detalle={f.desc}
                  enPortal={!NATIVA[f.key]}
                  onPress={() => (NATIVA[f.key] ? router.push(NATIVA[f.key]) : alPortal('/solicitudes', f.label))} />
              ))}
            </View></Vidrio>
          </View>
        ) : null}

        {personales ? (
          <View style={{ gap: 7 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>Personales</Text>
            <Vidrio radio={22}><View style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
              {PERSONALES.map((t, i) => (
                <Opcion key={t} primero={!i} icono={nombreDelIconoDeTipo(t)} color={MARCA.violeta} titulo={REQUEST_TYPES[t]?.label ?? t} enPortal
                  onPress={() => alPortal('/solicitudes-personales', REQUEST_TYPES[t]?.label)} />
              ))}
            </View></Vidrio>
          </View>
        ) : null}

        {!familias.length && !personales ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 60 }}>Tu cargo no puede crear solicitudes.</Text>
        ) : null}
      </ScrollView>
    </>
  );
}
