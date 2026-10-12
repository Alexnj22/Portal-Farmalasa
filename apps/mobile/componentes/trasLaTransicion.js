// Montar lo pesado DESPUÉS de que la pantalla terminó de entrar.
//
// En Android la animación de la pila corre en el hilo de la interfaz, el
// mismo que tiene que crear cada vista nueva: una pantalla que monta cientos
// de vistas (una lista, gráficas) a la vez que entra hace que la animación dé
// saltos (2026-10-12, «las transiciones no las hace bien»). Con esto la
// pantalla entra con su barra y un indicador, y el contenido aparece al
// terminar la animación (o a los 350 ms, lo que llegue primero). Los datos se
// piden igual desde el principio: sólo se difiere el DIBUJO.
//
// En iPhone devuelve `true` de una: su animación no compite así.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { useNavigation } from 'expo-router';

const ANDROID = Platform.OS === 'android';

export function useTrasLaTransicion() {
  const nav = useNavigation();
  const [listo, setListo] = useState(!ANDROID);
  useEffect(() => {
    if (listo) return undefined;
    let hecho = false;
    const fin = () => { if (!hecho) { hecho = true; setListo(true); } };
    const quitar = nav?.addListener?.('transitionEnd', fin);
    const reloj = setTimeout(fin, 350);
    return () => { quitar?.(); clearTimeout(reloj); };
  }, [listo, nav]);
  return listo;
}

/** El contenido pesado, sólo cuando la pantalla ya entró; antes, un indicador. */
export function TrasLaTransicion({ children }) {
  const listo = useTrasLaTransicion();
  if (listo) return children;
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingTop: 48 }}>
      <ActivityIndicator />
    </View>
  );
}
