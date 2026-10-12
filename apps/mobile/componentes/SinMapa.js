// Donde no hay mapa dentro de la app, la ruta se abre en Google Maps.
//
// En iPhone el mapa es el de Apple y no pide llave. En Android
// `react-native-maps` usa el SDK de Google Maps, que CIERRA LA APP entera
// («API key not found») si el binario no trae una llave — medido el
// 2026-10-12 en el emulador: tocar una ruta de reparto mataba el proceso.
// Por eso cada mapa pregunta `hayMapa` antes de montarse, y sin llave se pinta
// esto: la misma ruta, en la app de mapas del teléfono.
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import Vidrio from './Vidrio';
import { colorSistema } from './Formulario';
import { MARCA } from './inicio/marca';

export const hayMapa = Platform.OS !== 'android'
  || !!Constants.expoConfig?.android?.config?.googleMaps?.apiKey;

const txt = (p) => `${Number(p.lat)},${Number(p.lng)}`;

/** La URL de Google Maps con el recorrido: origen, paradas (hasta 9) y destino. */
export function enlaceDeRuta(puntos) {
  const validos = (puntos ?? []).filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
  if (!validos.length) return null;
  if (validos.length === 1) return `https://www.google.com/maps/search/?api=1&query=${txt(validos[0])}`;
  const [origen, ...resto] = validos;
  const destino = resto[resto.length - 1];
  const medio = resto.slice(0, -1).slice(0, 9);
  return `https://www.google.com/maps/dir/?api=1&origin=${txt(origen)}&destination=${txt(destino)}`
    + (medio.length ? `&waypoints=${medio.map(txt).join('|')}` : '') + '&travelmode=driving';
}

export default function SinMapa({ puntos, texto = 'El mapa de la ruta se abre en Google Maps.' }) {
  const url = enlaceDeRuta(puntos);
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={20}>
        <View style={{ padding: 16, gap: 10 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{texto}</Text>
          {url ? (
            <Pressable accessibilityRole="button" onPress={() => { Linking.openURL(url).catch(() => {}); }}
              style={({ pressed }) => ({ minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                backgroundColor: MARCA.azulClaro, opacity: pressed ? 0.8 : 1 })}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Abrir en Google Maps</Text>
            </Pressable>
          ) : null}
        </View>
      </Vidrio>
    </View>
  );
}
