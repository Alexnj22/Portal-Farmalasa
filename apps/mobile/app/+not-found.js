// Un enlace viejo o mal escrito: sin esto, la pantalla por defecto sale en
// inglés y sin forma de volver.
import { Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande } from '../componentes/formulario/Piezas';

export default function NoEncontrada() {
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: '' }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '700', textAlign: 'center' }}>Esta pantalla no existe</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginBottom: 12 }}>El enlace ya no sirve o está incompleto.</Text>
        <BotonGrande texto="Ir al inicio" onPress={() => router.replace('/')} />
      </View>
    </>
  );
}
