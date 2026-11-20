// El segmentado del sistema cuando las secciones NO caben en él (2026-11-12,
// usuario: «en editar la ficha, las tabs siguen como antes y no canónico»).
//
// El control de SwiftUI reparte el ancho en partes iguales y corta lo que no
// cabe («Nómin…»). Hasta hoy, en ese caso `Segmentos` caía a las píldoras de
// vidrio del Inicio, que se ven distintas: dos pantallas vecinas parecían de
// dos apps. Ésta es la MISMA forma del segmentado —la pista gris en cápsula y
// la elegida en blanco encima— dibujada con vistas comunes, para que pueda
// desplazarse de lado y cada rótulo se lea entero.
//
// Sólo vistas de React Native: nada de capas SwiftUI (`Host`), que dentro de
// algo que se desplaza no siguen a su lugar (ver componentes/IconoFijo.ios.js).
import { useEffect, useRef } from 'react';
import { ScrollView, Text, View, useColorScheme } from 'react-native';
import { Presionable as Pressable } from './Tocable';
import * as Haptics from 'expo-haptics';
import { dinamico, papel, pozo, relieve } from '../tema/papel';

export default function PistaSegmentada({ opciones, activa, onCambiar, margen = 16 }) {
  const oscuro = useColorScheme() === 'dark';
  const scroll = useRef(null);
  const xs = useRef({});
  // La elegida siempre a la vista: al cambiar (o al abrir en una sección del
  // final), la pista se corre hasta ella.
  useEffect(() => {
    const p = xs.current[activa];
    if (p) scroll.current?.scrollTo({ x: Math.max(0, p.x - 24), animated: true });
  }, [activa]);
  return (
    // Línea Mostrador · Segmentado «Pozo con luz»: el riel hundido (papel
    // hundido con sombra interior) y la ficha clara con relieve encima.
    <View style={{ marginHorizontal: margen, borderRadius: 999, padding: 3, backgroundColor: papel(oscuro).hundida, boxShadow: pozo(oscuro), overflow: 'hidden' }}>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 2, flexGrow: 1 }}>
        {opciones.map((o) => {
          const esta = o.id === activa;
          return (
            <Pressable key={o.id} accessibilityRole="tab" accessibilityState={{ selected: esta }}
              onLayout={(e) => { xs.current[o.id] = e.nativeEvent.layout; }}
              onPress={() => { if (!esta) { Haptics.selectionAsync().catch(() => {}); onCambiar(o.id); } }}
              style={{ flexGrow: 1, minHeight: 32, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
                backgroundColor: esta ? papel(oscuro).superficie : 'transparent',
                boxShadow: esta ? relieve(oscuro, 'control') : undefined,
                borderTopWidth: esta ? 1.5 : 0, borderTopColor: esta ? `${papel(oscuro).marca}80` : 'transparent' }}>
              <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: esta ? '600' : '500', color: esta ? dinamico('tinta') : dinamico('tinta2') }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
