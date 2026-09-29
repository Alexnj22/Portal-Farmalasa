// Una pantalla del portal web dentro de la app, con la sesión de la app.
// Es el puente de la estrategia mixta (decisión del usuario, 2026-09-28): todo
// abre desde el primer día, y las pantallas nativas lo van reemplazando.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useIsFocused } from 'expo-router';
import { supabase } from '@nucleo/supabaseClient';
import { useAuth } from '@nucleo/context/AuthContext';
import { PORTAL_URL } from '@plataforma/config';
import { scriptDeEntrada } from './sesionCompartida';
import { useTema } from '../tema/tema';

// `enPestana`: la pantalla va sin barra de título (Inicio, Avisos). La WebView
// ocupa la pantalla ENTERA y el fondo del portal pasa detrás de la hora y de la
// barra de vidrio; es el portal el que corre su contenido (ver
// `scriptDeEntrada`). Con márgenes por fuera quedaban dos franjas del color de
// la app arriba y abajo, que es justo lo que no hace una app del sistema.
// Dentro de una pestaña, el área segura de abajo ya incluye la barra.
export default function PortalIncrustado({ ruta, enPestana = false }) {
  const tema = useTema();
  const margen = useSafeAreaInsets();
  const { logout } = useAuth();
  const [cargando, setCargando] = useState(true);
  const abajo = enPestana ? Math.round(margen.bottom) : null;
  const script = useMemo(() => scriptDeEntrada({ abajo }), [abajo]);
  const ultimo = useRef(null);

  // Con la barra de abajo puede haber varios portales montados a la vez
  // (Inicio, Avisos y el que se abrió desde el Menú). Si cada uno renovara el
  // token por su cuenta, dos gastarían la MISMA llave de renovación y Supabase
  // cerraría la sesión. Por eso sólo vive el que está a la vista: los demás
  // sueltan su WebView y vuelven a cargar al regresar.
  const enFoco = useIsFocused();

  // Mientras el portal está a la vista, él es el único que renueva el token.
  useEffect(() => {
    if (!enFoco) return undefined;
    supabase.auth.stopAutoRefresh();
    return () => { supabase.auth.startAutoRefresh(); setCargando(true); };
  }, [enFoco]);

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
      {enFoco ? <WebView
        source={{ uri: PORTAL_URL + ruta }}
        injectedJavaScriptBeforeContentLoaded={script}
        onMessage={alRecibir}
        onLoadEnd={() => setCargando(false)}
        sharedCookiesEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        style={{ flex: 1, backgroundColor: tema.color.fondo }}
      /> : null}
      {cargando ? (
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={tema.color.marca} />
        </View>
      ) : null}
    </View>
  );
}
