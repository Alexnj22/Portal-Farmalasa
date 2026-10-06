// ¿Se está viendo esto AHORA? Pantalla enfocada y app en primer plano. Lo usan
// las animaciones que corren solas (la aurora, la tarjeta de socio) para
// pararse cuando nadie las ve: NativeTabs deja montadas las pestañas visitadas
// y sus animaciones seguían gastando batería (revisión 2026-10-06).
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

export function useAppActiva() {
  const [activa, setActiva] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (e) => setActiva(e === 'active'));
    return () => sub.remove();
  }, []);
  return activa;
}

export function useVisible() {
  const [enfocada, setEnfocada] = useState(true);
  useFocusEffect(useCallback(() => { setEnfocada(true); return () => setEnfocada(false); }, []));
  return useAppActiva() && enfocada;
}
