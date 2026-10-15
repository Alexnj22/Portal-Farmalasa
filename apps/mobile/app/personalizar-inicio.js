// Personalizar el Inicio, NATIVO — la parte de «Personalizar» del tablero del
// portal (`AcomodarModal`) que tiene sentido en el teléfono: ENCENDER o APAGAR
// cada widget. Se guarda en la MISMA preferencia del portal
// (`user_dashboard_prefs.widgets`, `[{ id, enabled }]` con los ids del portal),
// así que apagar algo acá lo apaga también en el escritorio y al revés.
//
// Acomodar y redimensionar en una rejilla no existen en el teléfono: el Inicio
// es una lista y la ordena el uso (las secciones que más se abren suben,
// `componentes/inicio/uso.js`). Publicar el acomodo temático es del portal.
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchUserDashboardPrefs, upsertUserDashboardPrefs } from '@nucleo/data/dashboard';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Seccion } from '../componentes/formulario/Piezas';
import Interruptor from '../componentes/Interruptor';
import { SECCIONES, WIDGET_WEB, ROTULO_WIDGET } from '../componentes/inicio/Secciones';
import { fallo } from '../componentes/Progreso';

export default function PersonalizarInicio() {
  const { user, hasPermission } = useAuth();
  const [widgets, setWidgets] = useState(null);   // [{ id, enabled }] del portal
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    if (!user?.id) return undefined;
    Promise.resolve(fetchUserDashboardPrefs(user.id)).then(({ data, error }) => {
      if (!vivo) return;
      if (error) { fallo('No se pudo leer tu Inicio', mensajeAmigable(error)); setWidgets([]); return; }
      setWidgets(Array.isArray(data?.widgets) ? data.widgets : []);
    }).catch(() => { if (vivo) setWidgets([]); });
    return () => { vivo = false; };
  }, [user?.id]);

  // Los widgets que este cargo puede ver, una vez cada uno (dos secciones de la
  // app pueden ser el mismo widget del portal: «Ventas» y «Ventas por hora»).
  const ids = [...new Set(SECCIONES
    .filter((s) => WIDGET_WEB[s.id] && (!s.permiso || [].concat(s.permiso).some((p) => hasPermission(p))))
    .map((s) => WIDGET_WEB[s.id]))];
  const encendido = (id) => (widgets || []).find((w) => w.id === id)?.enabled !== false;

  const cambiar = async (id, valor) => {
    const antes = widgets;
    const siguiente = (widgets || []).some((w) => w.id === id)
      ? widgets.map((w) => (w.id === id ? { ...w, enabled: valor } : w))
      : [...(widgets || []), { id, enabled: valor }];
    setWidgets(siguiente);
    setGuardando(true);
    // Sólo la columna `widgets` viaja: el acomodo del escritorio no se toca.
    const { error } = await upsertUserDashboardPrefs({ user_id: user.id, widgets: siguiente, updated_at: new Date().toISOString() });
    setGuardando(false);
    if (error) { setWidgets(antes); fallo('No se pudo guardar', mensajeAmigable(error)); return; }
    Haptics.selectionAsync().catch(() => {});
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Personalizar el Inicio' }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 15, marginHorizontal: 4 }}>
          Enciende o apaga cada widget. Es la misma elección del portal: lo que apagues aquí también se apaga en el escritorio. El orden lo decide el uso: lo que más abres sube solo.
        </Text>
        {widgets == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : !ids.length ? (
          <Aviso texto="Tu cargo no tiene widgets para elegir." />
        ) : (
          <Seccion titulo="Widgets" pie={guardando ? 'Guardando…' : null}>
            {ids.map((id, i) => (
              <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{ROTULO_WIDGET[id] ?? id}</Text>
                <Interruptor value={encendido(id)} onValueChange={(v) => cambiar(id, v)} disabled={guardando} />
              </View>
            ))}
          </Seccion>
        )}
      </ScrollView>
    </>
  );
}
