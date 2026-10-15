// Entrar con usuario y contraseña — las MISMAS funciones del portal
// (`loginWithUsername`, `cambiarClaveInicial`)
// con sus mismos mensajes y las mismas reglas de contraseña. La forma es la
// del sistema: un formulario agrupado como el de Ajustes (ver
// componentes/Formulario.js) y el botón nativo de @expo/ui.
//
// «Entrar con el carné», como el lector y la cámara del portal (`LoginView`):
// la cámara del teléfono lee el código del carné y lo manda a la MISMA
// función (`login`), que lo trata como contraseña. El código leído no se
// muestra en ningún lado: la pantalla de entrada es pública.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Host, Icon } from '@expo/ui';
import Vidrio from '../componentes/Vidrio';
import Escaner from '../componentes/Escaner';
import { colorSistema, FilaCampo, Formulario, Grupo } from '../componentes/Formulario';

const ICONO_FACE = Icon.select({ ios: 'faceid', android: require('@expo/material-symbols/face.xml') });
const ICONO_HUELLA = Icon.select({ ios: 'touchid', android: require('@expo/material-symbols/fingerprint.xml') });
const ICONO_CARNE = Icon.select({ ios: 'barcode.viewfinder', android: require('@expo/material-symbols/barcode_scanner.xml') });
import { useAuth } from '@nucleo/context/AuthContext';
import { esFalloDeCredencial } from '@nucleo/utils/sesionDelNavegador';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { problemaDeContrasenaNueva } from '@nucleo/utils/contrasena';
import {
  activarBiometria, biometriaActiva, leerConBiometria, nombreBiometria,
  noVolverAPreguntar, olvidarBiometria, yaSePregunto,
} from '../componentes/biometria';

// Después de entrar con contraseña, una sola vez: ¿usar Face ID la próxima?
async function ofrecerBiometria(usuario, clave) {
  const nombre = await nombreBiometria();
  if (!nombre || (await biometriaActiva()) || (await yaSePregunto())) return;
  await new Promise((listo) => Alert.alert(`¿Entrar con ${nombre}?`,
    `La próxima vez entras con ${nombre}, sin escribir la contraseña. Se puede quitar en «Yo».`, [
      { text: 'Ahora no', style: 'cancel', onPress: async () => { await noVolverAPreguntar(); listo(); } },
      { text: `Usar ${nombre}`, onPress: async () => { await activarBiometria(usuario, clave); listo(); } },
    ]));
}

export default function Entrar() {
  const { login, loginWithUsername, cambioDeClave, cambiarClaveInicial } = useAuth();
  const [escaneando, setEscaneando] = useState(false);
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  // Quien debe cambiar la contraseña: lo dice el contexto, que también cierra
  // ese trámite solo si nadie lo termina (y entonces dice por qué).
  const pendiente = cambioDeClave?.estado === 'pendiente';
  const motivoDeCierre = cambioDeClave?.estado === 'cerrado' ? cambioDeClave.motivo : '';
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  // El campo nativo (SwiftUI / Compose) no obedece un `value` puesto desde
  // afuera: vaciar el estado dejaba los puntos en pantalla y «Entrar» apagado
  // con el campo aparentemente lleno. Se vacía pidiéndoselo al campo.
  const claveRef = useRef(null);
  const [biometria, setBiometria] = useState(null); // «Face ID» si está activa

  const entrarConBiometria = useCallback(async () => {
    const c = await leerConBiometria();
    if (!c) return;
    setError('');
    setOcupado(true);
    try {
      const r = await loginWithUsername(c.usuario, c.clave);
      if (!r?.ok) {
        // Sólo si el servidor dijo que la credencial no sirve (la contraseña
        // cambió, la cuenta no existe o está bloqueada) lo guardado se olvida.
        // Sin señal, con el tope de intentos o con un error del servidor, la
        // contraseña guardada sigue siendo buena: borrarla obligaba a
        // escribirla de nuevo por un corte de red.
        if (esFalloDeCredencial(r)) {
          await olvidarBiometria();
          setBiometria(null);
          setError(`${r?.error || 'Credenciales inválidas.'} Escribe tu contraseña.`);
        } else {
          setError(r?.error || 'No se pudo entrar. Intenta de nuevo.');
        }
        return;
      }
      if (r.mustChangePassword) { setUsuario(c.usuario); return; }
      router.replace('/inicio');
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setOcupado(false);
    }
  }, [loginWithUsername]);

  // Sólo en desarrollo (`__DEV__`, nunca en una compilación de tienda): entra
  // solo con la cuenta de pruebas del `.env` local, para poder revisar
  // pantallas en el simulador sin escribir.
  useEffect(() => {
    const u = process.env.EXPO_PUBLIC_PRUEBA_USUARIO, c = process.env.EXPO_PUBLIC_PRUEBA_CLAVE;
    if (!__DEV__ || !u || !c) return;
    loginWithUsername(u, c).then((r) => { if (r?.ok && !r.mustChangePassword) router.replace('/inicio'); }).catch(() => {});
  }, [loginWithUsername]);

  // Al abrir, si está activa, se pide la cara de una vez.
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!(await biometriaActiva())) return;
      const nombre = await nombreBiometria();
      if (!vivo || !nombre) return;
      setBiometria(nombre);
      entrarConBiometria();
    })();
    return () => { vivo = false; };
  }, [entrarConBiometria]);

  const entrar = async () => {
    if (!usuario || !clave || ocupado) return;
    setError('');
    setOcupado(true);
    try {
      const r = await loginWithUsername(usuario, clave);
      if (!r?.ok) { setError(r?.error || 'Credenciales inválidas.'); setClave(''); claveRef.current?.clear(); return; }
      if (r.mustChangePassword) return;
      await ofrecerBiometria(usuario, clave);
      router.replace('/inicio');
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setOcupado(false);
    }
  };

  // El carné leído por la cámara. Mismo trato que el portal: en mayúsculas y
  // sin espacios. Si no lo reconoce, la cámara se cierra y se dice por qué: si
  // siguiera abierta, volvería a leer el mismo carné cada pocos segundos y cada
  // lectura sería un intento de entrada más.
  const entrarConCarne = async (leido) => {
    const codigo = String(leido ?? '').trim().toUpperCase();
    if (!codigo || ocupado) return false;
    setError('');
    setOcupado(true);
    try {
      const r = await login(codigo);
      setEscaneando(false);
      if (!r?.ok) { setError(r?.error || 'Carné no reconocido.'); return false; }
      router.replace('/inicio');
      return true;
    } catch {
      setEscaneando(false);
      setError('Error de conexión. Intenta de nuevo.');
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const cambiar = async () => {
    if (ocupado) return;
    setError('');
    const problema = problemaDeContrasenaNueva(nueva, confirmacion);
    if (problema) { setError(problema); return; }
    setOcupado(true);
    try {
      const r = await cambiarClaveInicial(nueva);
      // Con `reentrar` la sesión ya se cerró: el formulario vuelve a la
      // entrada solo y el motivo sale abajo.
      if (!r.ok) {
        if (r.reentrar) setClave('');   // la temporal ya no sirve: se entra con la nueva
        else setError(mensajeAmigable(r.error));
        return;
      }
      // Lo guardado tenía la contraseña temporal: se reemplaza por la nueva.
      if (await biometriaActiva()) await activarBiometria(usuario, nueva);
      else await ofrecerBiometria(usuario, nueva);
      router.replace('/inicio');
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setOcupado(false);
    }
  };

  // El ícono del botón según lo que tenga el teléfono.
  const iconoBio = biometria === 'Face ID' ? ICONO_FACE : ICONO_HUELLA;

  return (
    <Formulario contentContainerStyle={{ paddingTop: 64, gap: 22 }}>
      {/* La marca: el logo con su resplandor, sobre la aurora de toda la app. */}
      <View style={{ alignItems: 'center', gap: 10 }}>
        <View style={{ shadowColor: '#981D97', shadowOpacity: 0.45, shadowRadius: 28, shadowOffset: { width: 0, height: 8 }, elevation: 12 }}>
          <Image source={require('../assets/icono.png')} style={{ width: 96, height: 96, borderRadius: 24 }} />
        </View>
        <Text style={{ color: colorSistema.texto, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 }}>
          {pendiente ? 'Elige tu contraseña' : 'Farmalasa'}
        </Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginHorizontal: 32 }}>
          {pendiente ? 'Es tu primera entrada: la contraseña que te dieron es temporal.' : 'Portal del equipo'}
        </Text>
      </View>

      {/* Con la biometría activa, ése es el camino principal: arriba y grande. */}
      {!pendiente && biometria ? (
        <View style={{ marginHorizontal: 16 }}>
          <Pressable onPress={entrarConBiometria} disabled={ocupado} accessibilityRole="button"
            style={({ pressed }) => ({ opacity: pressed || ocupado ? 0.7 : 1 })}>
            <Vidrio radio={26} interactivo tinte={colorSistema.acentoTinte}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 18 }}>
                <Host matchContents><Icon name={iconoBio} size={28} color={colorSistema.acento} /></Host>
                <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>Entrar con {biometria}</Text>
              </View>
            </Vidrio>
          </Pressable>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center', marginTop: 14 }}>o con tu usuario y contraseña</Text>
        </View>
      ) : null}

      {pendiente ? (
        <Grupo vidrio pie="Mínimo 8 caracteres, con una mayúscula y un número.">
          <FilaCampo placeholder="Contraseña nueva" secureTextEntry textContentType="newPassword" onChangeText={setNueva} returnKeyType="next" />
          <FilaCampo placeholder="Repítela" secureTextEntry textContentType="newPassword" onChangeText={setConfirmacion} returnKeyType="done" onSubmitEditing={cambiar} />
        </Grupo>
      ) : (
        <Grupo vidrio>
          <FilaCampo placeholder="Usuario" autoCapitalize="none" autoCorrect={false} textContentType="username" onChangeText={setUsuario} returnKeyType="next" />
          <FilaCampo ref={claveRef} placeholder="Contraseña" secureTextEntry textContentType="password" value={clave} onChangeText={setClave} returnKeyType="go" onSubmitEditing={entrar} />
        </Grupo>
      )}

      {error || motivoDeCierre ? <Text style={{ color: colorSistema.rojo, fontSize: 15, textAlign: 'center', marginHorizontal: 24 }}>{error || motivoDeCierre}</Text> : null}

      <View style={{ marginHorizontal: 16 }}>
        <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
          {pendiente
            ? <Button variant="filled" label={ocupado ? 'Guardando…' : 'Guardar y entrar'} disabled={ocupado || !nueva || !confirmacion} onPress={cambiar} />
            : <Button variant="filled" label={ocupado ? 'Entrando…' : 'Entrar'} disabled={ocupado || !usuario || !clave} onPress={entrar} />}
        </Host>
      </View>

      {!pendiente ? (
        <View style={{ marginHorizontal: 16 }}>
          <Pressable onPress={() => { setError(''); setEscaneando(true); }} disabled={ocupado} accessibilityRole="button"
            style={({ pressed }) => ({ opacity: pressed || ocupado ? 0.7 : 1 })}>
            <Vidrio radio={26} interactivo>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14 }}>
                <Host matchContents><Icon name={ICONO_CARNE} size={22} color={colorSistema.acento} /></Host>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>Entrar con el carné</Text>
              </View>
            </Vidrio>
          </Pressable>
        </View>
      ) : null}

      <Escaner visible={escaneando} titulo="Entrar con el carné" ayuda="Acerca el código de tu carné a la cámara."
        onCodigo={entrarConCarne} onCerrar={() => setEscaneando(false)}
        pie={ocupado ? <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' }}>Verificando…</Text> : null} />
    </Formulario>
  );
}
