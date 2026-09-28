// La entrada decide a dónde ir con la sesión que devuelve el núcleo.
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@nucleo/context/AuthContext';
import { useTema } from '../tema/tema';

export default function Entrada() {
  const { loading, isAuthenticated } = useAuth();
  const tema = useTema();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={tema.color.marca} />
      </View>
    );
  }
  return <Redirect href={isAuthenticated ? '/inicio' : '/entrar'} />;
}
