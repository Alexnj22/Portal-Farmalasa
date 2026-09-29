// Entrar con usuario y contraseña — las MISMAS funciones del portal
// (`loginWithUsername`, `cambiarMiContrasenaInicial`, `completePasswordChange`)
// con sus mismos mensajes y las mismas reglas de contraseña. La forma es la
// del sistema: un formulario agrupado como el de Ajustes (ver
// componentes/Formulario.js) y el botón nativo de @expo/ui.
import { useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Host } from '@expo/ui';
import { colorSistema, FilaCampo, FilaTexto, Formulario, Grupo } from '../componentes/Formulario';
import { useAuth } from '@nucleo/context/AuthContext';
import { cambiarMiContrasenaInicial } from '@nucleo/data/auth';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { problemaDeContrasenaNueva } from '@nucleo/utils/contrasena';

export default function Entrar() {
  const { loginWithUsername, completePasswordChange } = useAuth();
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [pendiente, setPendiente] = useState(null); // quien debe cambiar la contraseña
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  // El campo nativo (SwiftUI / Compose) no obedece un `value` puesto desde
  // afuera: vaciar el estado dejaba los puntos en pantalla y «Entrar» apagado
  // con el campo aparentemente lleno. Se vacía pidiéndoselo al campo.
  const claveRef = useRef(null);

  const entrar = async () => {
    if (!usuario || !clave || ocupado) return;
    setError('');
    setOcupado(true);
    try {
      const r = await loginWithUsername(usuario, clave);
      if (!r?.ok) { setError(r?.error || 'Credenciales inválidas.'); setClave(''); claveRef.current?.clear(); return; }
      if (r.mustChangePassword) { setPendiente(r.user); return; }
      router.replace('/inicio');
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
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
      const { error: e } = await cambiarMiContrasenaInicial(nueva);
      if (e) { setError(mensajeAmigable(e)); return; }
      await completePasswordChange(pendiente);
      router.replace('/inicio');
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Formulario contentContainerStyle={{ paddingTop: 72 }}>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Image source={require('../assets/icono.png')} style={{ width: 84, height: 84, borderRadius: 20 }} />
        <Text style={{ color: colorSistema.texto, fontSize: 26, fontWeight: '800' }}>
          {pendiente ? 'Elige tu contraseña' : 'Portal Farmalasa'}
        </Text>
        {pendiente ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginHorizontal: 32 }}>
            Es tu primera entrada: la contraseña que te dieron es temporal.
          </Text>
        ) : null}
      </View>

      {pendiente ? (
        <Grupo pie="Mínimo 8 caracteres, con una mayúscula y un número.">
          <FilaCampo placeholder="Contraseña nueva" secureTextEntry textContentType="newPassword" onChangeText={setNueva} returnKeyType="next" />
          <FilaCampo placeholder="Repítela" secureTextEntry textContentType="newPassword" onChangeText={setConfirmacion} returnKeyType="done" onSubmitEditing={cambiar} />
        </Grupo>
      ) : (
        <Grupo>
          <FilaCampo placeholder="Usuario" autoCapitalize="none" autoCorrect={false} textContentType="username" onChangeText={setUsuario} returnKeyType="next" />
          <FilaCampo ref={claveRef} placeholder="Contraseña" secureTextEntry textContentType="password" value={clave} onChangeText={setClave} returnKeyType="go" onSubmitEditing={entrar} />
        </Grupo>
      )}

      {error ? <Grupo><FilaTexto color={colorSistema.rojo}>{error}</FilaTexto></Grupo> : null}

      <View style={{ marginHorizontal: 16 }}>
        <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
          {pendiente
            ? <Button variant="filled" label={ocupado ? 'Guardando…' : 'Guardar y entrar'} disabled={ocupado || !nueva || !confirmacion} onPress={cambiar} />
            : <Button variant="filled" label={ocupado ? 'Entrando…' : 'Entrar'} disabled={ocupado || !usuario || !clave} onPress={entrar} />}
        </Host>
      </View>
    </Formulario>
  );
}
