// Traslados — la entrada nativa. Lo que la sala hace de pie es PEDIR a otra
// sala (932 solicitudes en 30 días, 36 personas, al 2026-09-28): eso es nativo.
// Las cuatro pestañas del portal (en camino, envíos, faltantes, historial) se
// abren como el portal, con la misma sesión, hasta que tengan su versión nativa.
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useComposicionTraslado } from '@nucleo/store/composicionTraslado';
import Boton from '../componentes/Boton';
import { Texto } from '../componentes/comunes';
import { useTema } from '../tema/tema';

const PESTANAS = [
  { tab: 'recibir', label: 'En camino' },
  { tab: 'envios', label: 'Envíos' },
  { tab: 'faltantes', label: 'Faltantes' },
  { tab: 'historial', label: 'Historial' },
];

export default function Traslados() {
  const t = useTema();
  const enLaSolicitud = useComposicionTraslado((s) => s.renglones.length);
  return (
    <>
      <Stack.Screen options={{ title: 'Traslados entre salas' }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Boton onPress={() => router.push('/pedir-traslado')}>
          {enLaSolicitud ? `Seguir la solicitud · ${enLaSolicitud}` : 'Pedir a otra sala'}
        </Boton>
        <Texto tenue>Busca el producto, elige de qué sala y cuánto. Cada sala recibe sólo lo suyo.</Texto>
        <View style={{ gap: 8, marginTop: 8 }}>
          {PESTANAS.map(p => (
            <Pressable key={p.tab} accessibilityRole="button"
              onPress={() => router.push({ pathname: '/portal', params: { ruta: `/traslados?tab=${p.tab}`, nombre: p.label } })}
              style={({ pressed }) => ({ minHeight: t.tam.toque + 4, paddingHorizontal: 14, justifyContent: 'center', borderRadius: t.radio.tarjeta, borderWidth: 1, borderColor: t.color.borde, backgroundColor: t.color.tarjeta, opacity: pressed ? 0.7 : 1 })}>
              <Text style={{ color: t.color.texto, fontWeight: '700', fontSize: t.texto.cuerpo + 2 }}>{p.label}  ›</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </>
  );
}
