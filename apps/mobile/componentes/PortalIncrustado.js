// Una pantalla del portal web dentro de la app, con la sesión de la app.
// Es el puente de la estrategia mixta (decisión del usuario, 2026-09-28): todo
// abre desde el primer día, y las pantallas nativas lo van reemplazando.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { supabase } from '@nucleo/supabaseClient';
import { useAuth } from '@nucleo/context/AuthContext';
import { PORTAL_URL } from '@plataforma/config';
import { scriptDeEntrada } from './sesionCompartida';
import { useTema } from '../tema/tema';

export default function PortalIncrustado({ ruta }) {
  const tema = useTema();
  const { logout } = useAuth();
  const [cargando, setCargando] = useState(true);
  const script = useMemo(() => scriptDeEntrada(), []);
  const ultimo = useRef(null);

  // Mientras el portal está abierto, él es el único que renueva el token.
  useEffect(() => {
    supabase.auth.stopAutoRefresh();
    return () => { supabase.auth.startAutoRefresh(); };
  }, []);

  const alRecibir = async (e) => {
    let msg;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.tipo === 'sesion' && msg.valor && msg.valor !== ultimo.current) {
      ultimo.current = msg.valor;
      try {
        const s = JSON.parse(msg.valor);
        if (s?.access_token && s?.refresh_token) {
          await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
        }
      } catch { /* un valor que no es una sesión no se adopta */ }
    } else if (msg.tipo === 'salio') {
      // Cerró sesión adentro del portal: la app también.
      logout?.();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: tema.color.fondo }}>
      <WebView
        source={{ uri: PORTAL_URL + ruta }}
        injectedJavaScriptBeforeContentLoaded={script}
        onMessage={alRecibir}
        onLoadEnd={() => setCargando(false)}
        sharedCookiesEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        style={{ flex: 1, backgroundColor: tema.color.fondo }}
      />
      {cargando ? (
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={tema.color.marca} />
        </View>
      ) : null}
    </View>
  );
}
