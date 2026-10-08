// Si una pantalla falla al dibujarse, la app NO se cierra (2026-10-08): la
// compilación 28 se cerraba entera por un `nivel.nombre` sobre un nivel vacío.
// expo-router usa el `ErrorBoundary` que exporta cada ruta o layout.
import { Text, View } from 'react-native';
import { Boton } from './ui';
import { colorSistema } from './sistema';
import { reportarError } from '../lib/errores';

export default function ErrorDePantalla({ error, retry }) {
  console.error('Pantalla con error:', error?.message ?? error);
  reportarError(error, { fatal: false });
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 }}>
      <Text style={{ fontSize: 44 }}>😕</Text>
      <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto, textAlign: 'center' }}>Algo salió mal</Text>
      <Text style={{ fontSize: 15, color: colorSistema.texto2, textAlign: 'center' }}>
        No pudimos mostrar esta pantalla. Intenta de nuevo; si sigue pasando, cierra y abre la app.
      </Text>
      <View style={{ alignSelf: 'stretch' }}><Boton alTocar={retry}>Reintentar</Boton></View>
    </View>
  );
}
