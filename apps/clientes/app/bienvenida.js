import { Image, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Boton, Tarjeta, Texto } from '../componentes/ui';
import { useTema } from '../tema/tema';

export default function Bienvenida() {
  const t = useTema();
  const ins = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, padding: 24, paddingTop: ins.top + 48, paddingBottom: ins.bottom + 24, justifyContent: 'space-between' }}>
      <View style={{ gap: 18, alignItems: 'center' }}>
        <Image source={require('../assets/icono.png')} style={{ width: 96, height: 96, borderRadius: 22 }} />
        <Text style={{ fontSize: 30, fontWeight: '800', color: t.color.texto, textAlign: 'center' }}>Puntos Salud</Text>
        <Texto nivel={2} estilo={{ textAlign: 'center', fontSize: 16, lineHeight: 23 }}>
          Tu saldo, tus ofertas y tus inyecciones, en tu teléfono.
        </Texto>
        <Tarjeta estilo={{ width: '100%', marginTop: 12 }}>
          <Regla color={t.color.verdeTexto} titulo="$1 de compra = 1 punto" />
          <Regla color={t.color.magentaTexto} titulo="100 puntos = $1 de descuento" />
        </Tarjeta>
      </View>
      <View style={{ gap: 12 }}>
        <Boton alTocar={() => router.push('/entrar')}>Ya soy cliente</Boton>
        <Boton tipo="secundario" alTocar={() => router.push('/registro')}>Quiero unirme</Boton>
      </View>
    </View>
  );
}

function Regla({ color, titulo }) {
  return <Text style={{ fontSize: 16, fontWeight: '700', color, textAlign: 'center' }}>{titulo}</Text>;
}
