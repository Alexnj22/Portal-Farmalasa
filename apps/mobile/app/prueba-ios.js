// Prueba iOS, NATIVO — `IOSTestView`. En el portal existe para diagnosticar el
// navegador del iPhone (las áreas seguras, el vidrio, la caja negra que
// sobrevive a una recarga). En la app el equivalente es el diagnóstico del
// TELÉFONO: qué versión corre, en qué equipo, cómo mide la pantalla y sus áreas
// seguras ahora mismo (cambia al girar), qué permisos tiene y si el rastreo de
// la ruta está activo, más la caja negra de la app (los últimos sucesos en
// memoria) para leerla o compartirla entera.
import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, Share, Text, useWindowDimensions, View } from 'react-native';
import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Camera } from 'expo-camera';
import * as LocalAuthentication from 'expo-local-authentication';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hora12ConSegundos } from '@nucleo/utils/hora';
import { APP_VERSION } from '@nucleo/version';
import { leerCajaNegra, limpiarCajaNegra } from '../plataforma/cajaNegra';
import { rutasDeFondo } from '../plataforma/rastreoDeFondo';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande, Dato, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';

const PERMISO = { granted: 'Concedido', denied: 'Negado', undetermined: 'Sin preguntar' };
const esFallo = (tipo) => /error|fallido|no-cargo|sin-capturar|murio/.test(String(tipo));

export default function PruebaIos() {
  const { width, height, scale, fontScale } = useWindowDimensions();
  const inset = useSafeAreaInsets();
  const [registro, setRegistro] = useState(() => leerCajaNegra());
  const [permisos, setPermisos] = useState(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await Promise.allSettled([
        Notifications.getPermissionsAsync(), Location.getForegroundPermissionsAsync(), Location.getBackgroundPermissionsAsync(),
        Camera.getCameraPermissionsAsync(), LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync(),
      ]);
      const v = (i) => (r[i].status === 'fulfilled' ? r[i].value : null);
      if (vivo) setPermisos({ notif: v(0)?.status, ubic: v(1)?.status, siempre: v(2)?.status, camara: v(3)?.status, bio: v(4), bioInscrita: v(5) });
    })();
    return () => { vivo = false; };
  }, []);

  const rutas = rutasDeFondo();
  const texto = () => `caja negra · v${APP_VERSION} · ${Device.modelName || Platform.OS} · ${Platform.OS} ${Platform.Version}\n(las horas son de este teléfono)\n\n`
    + leerCajaNegra().map((e) => `${hora12ConSegundos(e.t) || '—'}  ${String(e.tipo).padEnd(20)} ${e.ruta ?? ''}\n           ${e.msg || e.src || e.url || e.estado || e.version || ''}`).join('\n');

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Prueba iOS', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 16 }}>
        <Seccion titulo="Entorno">
          <Dato rotulo="Versión que corre" valor={`v${APP_VERSION}`} primero />
          <Dato rotulo="Compilación" valor={String(Constants.expoConfig?.ios?.buildNumber ?? Constants.nativeBuildVersion ?? '—')} />
          <Dato rotulo="Equipo" valor={Device.modelName || '—'} />
          <Dato rotulo="Sistema" valor={`${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Platform.Version}`} />
          <Dato rotulo="Modo" valor={Constants.appOwnership === 'expo' ? 'Expo Go (pruebas)' : 'App instalada'} />
        </Seccion>

        <Seccion titulo="Pantalla — ahora" pie="Gira el teléfono: los números cambian solos. Si el contenido queda bajo la isla o la barra de inicio, aquí se ve cuánto mide cada borde.">
          <Dato rotulo="Tamaño" valor={`${Math.round(width)} × ${Math.round(height)} pt · ${width > height ? 'acostado' : 'parado'}`} primero />
          <Dato rotulo="Densidad · letra" valor={`${scale}× · ${fontScale.toFixed(2)}×`} />
          <Dato rotulo="Área segura" valor={`arriba ${Math.round(inset.top)} · abajo ${Math.round(inset.bottom)} · izq ${Math.round(inset.left)} · der ${Math.round(inset.right)}`} />
        </Seccion>

        <Seccion titulo="Permisos" pie="Lo que el teléfono le dio a la app. Para cambiar uno, en Ajustes.">
          <Dato rotulo="Avisos" valor={PERMISO[permisos?.notif] ?? '—'} primero />
          <Dato rotulo="Ubicación" valor={PERMISO[permisos?.ubic] ?? '—'} />
          <Dato rotulo="Ubicación «Siempre»" valor={PERMISO[permisos?.siempre] ?? '—'} />
          <Dato rotulo="Cámara" valor={PERMISO[permisos?.camara] ?? '—'} />
          <Dato rotulo="Face ID / huella" valor={permisos ? (permisos.bio ? (permisos.bioInscrita ? 'Disponible' : 'Sin registrar') : 'No hay') : '—'} />
          <Dato rotulo="Rastreo de ruta" valor={Object.keys(rutas).length ? `Activo: ${Object.keys(rutas).join(', ')}` : 'Apagado'} />
          <BotonGrande texto="Abrir Ajustes" borde onPress={() => Linking.openSettings().catch(() => {})} />
        </Seccion>

        <Seccion titulo={`Caja negra · ${registro.length} sucesos`} pie="Los últimos sucesos de la app en este rato (se borran al cerrarla del todo). Si algo falló, compártela entera: es lo que hace falta para diagnosticarlo.">
          {!registro.length ? <Text style={{ color: colorSistema.texto2, fontStyle: 'italic' }}>Sin sucesos registrados.</Text> : null}
          {[...registro].reverse().slice(0, 60).map((e, i) => (
            <View key={i} style={{ borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 6 : 0 }}>
              <Text style={{ color: esFallo(e.tipo) ? MARCA.rojo : colorSistema.texto, fontSize: 13, fontWeight: '700' }}>{e.tipo}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{e.msg || e.src || e.url || e.estado || e.version || '—'}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`${hora12ConSegundos(e.t) || ''}${e.ruta ? ` · ${e.ruta}` : ''}`}</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><BotonGrande texto="Actualizar" borde onPress={() => setRegistro(leerCajaNegra())} /></View>
            <View style={{ flex: 1 }}><BotonGrande texto="Vaciar" borde color={MARCA.rojo} onPress={() => { limpiarCajaNegra(); setRegistro([]); }} /></View>
          </View>
          <BotonGrande texto="Compartir todo" onPress={() => Share.share({ message: texto() }).catch(() => {})} />
        </Seccion>
      </ScrollView>
    </>
  );
}
