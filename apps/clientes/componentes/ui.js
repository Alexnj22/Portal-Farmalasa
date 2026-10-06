// Las piezas de las pantallas de contenido (puntos, ofertas, inyecciones).
// Canon: superficies de VIDRIO sobre la aurora (Liquid Glass en iOS 26),
// texto en los colores del sistema (`label`; los secundarios, sólidos — ver sistema.js), el botón del
// sistema, y los colores del logo SÓLO para lo que es de la marca: lo que se
// gana (verde) y lo que se usa (magenta).
import { ActivityIndicator, Platform, ScrollView, Text, View, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BotonNativo from './BotonNativo';
import Vidrio from './Vidrio';
import { colorSistema } from './sistema';
import { suave, useTema } from '../tema/tema';

export function Pantalla({ children, alRefrescar, refrescando = false, conPestanas = true }) {
  const ins = useSafeAreaInsets();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      // Tope de ancho: en un iPad o en el navegador las tarjetas se estiraban
      // de borde a borde y una cifra quedaba a medio metro de su rótulo.
      contentContainerStyle={{
        padding: 16, paddingBottom: (conPestanas ? 24 : 32) + (Platform.OS === 'ios' ? 0 : ins.bottom), gap: 14,
        width: '100%', maxWidth: 560, alignSelf: 'center',
      }}
      keyboardShouldPersistTaps="handled"
      refreshControl={alRefrescar ? <RefreshControl refreshing={refrescando} onRefresh={alRefrescar} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

/** Una tarjeta de vidrio. `tono` la tiñe (verde o magenta) cuando ES de la marca. */
export function Tarjeta({ children, estilo, tono }) {
  const t = useTema();
  // Con tono, el tinte de la marca va ENCIMA de un velo del fondo: sólo el
  // tinte dejaba el texto sobre magenta translúcido, difícil de leer.
  return (
    <Vidrio radio={26} tinte={tono ? suave(tono, 0.22) : undefined}>
      <View style={[{ padding: 18, gap: 8 },
        tono && { backgroundColor: t.oscuro ? 'rgba(18,16,24,0.4)' : 'rgba(255,255,255,0.5)' }, estilo]}>{children}</View>
    </Vidrio>
  );
}

export function Titulo({ children, estilo }) {
  return <Text style={[{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }, estilo]}>{children}</Text>;
}

export function Texto({ children, nivel = 1, estilo, ...resto }) {
  const color = nivel === 1 ? colorSistema.texto : nivel === 2 ? colorSistema.texto2 : colorSistema.texto3;
  return <Text style={[{ fontSize: nivel === 1 ? 17 : 15, color, lineHeight: nivel === 1 ? 22 : 20, fontWeight: nivel === 1 ? '400' : '500' }, estilo]} {...resto}>{children}</Text>;
}

/**
 * El botón del sistema (SwiftUI / Material). `principal` va tintado con el
 * magenta del logo; `secundario` es el botón con borde; `peligro` el rojo
 * del sistema, como «Borrar» en cualquier app de iOS.
 */
export function Boton({ children, alTocar, tipo = 'principal', cargando = false, deshabilitado = false }) {
  const t = useTema();
  const variante = tipo === 'principal' ? 'filled' : tipo === 'peligro' ? 'text' : 'outlined';
  return (
    <BotonNativo etiqueta={cargando ? 'Un momento…' : String(children)} alTocar={alTocar} variante={variante}
      deshabilitado={deshabilitado || cargando} color={tipo === 'peligro' ? colorSistema.rojo : t.color.magenta} />
  );
}

export function Aviso({ children, tipo = 'error' }) {
  const color = tipo === 'error' ? colorSistema.rojo : tipo === 'exito' ? colorSistema.texto : colorSistema.naranja;
  return <Text style={{ color, fontSize: 15, textAlign: 'center', marginHorizontal: 8 }}>{children}</Text>;
}

export function Cargando() {
  return <View style={{ padding: 60, alignItems: 'center' }}><ActivityIndicator /></View>;
}

export function Vacio({ titulo, children }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 6 }}>
      <Titulo estilo={{ textAlign: 'center', fontSize: 20 }}>{titulo}</Titulo>
      <Texto nivel={2} estilo={{ textAlign: 'center' }}>{children}</Texto>
    </View>
  );
}
