// Entrar con usuario y contraseña — las MISMAS funciones del portal
// (`loginWithUsername`, `cambiarMiContrasenaInicial`, `completePasswordChange`)
// con sus mismos mensajes y las mismas reglas de contraseña.
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { cambiarMiContrasenaInicial } from '@nucleo/data/auth';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { problemaDeContrasenaNueva } from '@nucleo/utils/contrasena';
import Boton from '../componentes/Boton';
import Campo from '../componentes/Campo';
import { useTema } from '../tema/tema';

export default function Entrar() {
  const { loginWithUsername, completePasswordChange } = useAuth();
  const tema = useTema();
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [pendiente, setPendiente] = useState(null); // quien debe cambiar la contraseña
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const entrar = async () => {
    setError('');
    setOcupado(true);
    try {
      const r = await loginWithUsername(usuario, clave);
      if (!r?.ok) { setError(r?.error || 'Credenciales inválidas.'); setClave(''); return; }
      if (r.mustChangePassword) { setPendiente(r.user); return; }
      router.replace('/inicio');
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setOcupado(false);
    }
  };

  const cambiar = async () => {
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
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
      <View style={{ gap: 16, backgroundColor: tema.color.tarjeta, borderRadius: tema.radio.tarjeta, padding: tema.tam.relleno + 6, borderWidth: 1, borderColor: tema.color.borde }}>
        <Image source={require('../assets/icono.png')} style={{ width: 72, height: 72, alignSelf: 'center', borderRadius: 16 }} />
        <Text style={{ color: tema.color.texto, fontSize: tema.texto.titulo, fontWeight: '800', textAlign: 'center' }}>
          {pendiente ? 'Elige tu contraseña' : 'Portal Farmalasa'}
        </Text>
        {pendiente ? (
          <>
            <Text style={{ color: tema.color.texto2, fontSize: tema.texto.cuerpo + 1 }}>
              Es tu primera entrada: la contraseña que te dieron es temporal.
            </Text>
            <Campo etiqueta="Contraseña nueva" value={nueva} onChangeText={setNueva} secureTextEntry textContentType="newPassword" />
            <Campo etiqueta="Repítela" value={confirmacion} onChangeText={setConfirmacion} secureTextEntry textContentType="newPassword" onSubmitEditing={cambiar} />
          </>
        ) : (
          <>
            <Campo etiqueta="Usuario" value={usuario} onChangeText={setUsuario} autoCapitalize="none" autoCorrect={false} textContentType="username" />
            <Campo etiqueta="Contraseña" value={clave} onChangeText={setClave} secureTextEntry textContentType="password" onSubmitEditing={entrar} />
          </>
        )}
        {error ? <Text accessibilityRole="alert" style={{ color: tema.color.peligroTexto, fontSize: tema.texto.cuerpo + 1 }}>{error}</Text> : null}
        {pendiente
          ? <Boton onPress={cambiar} ocupado={ocupado} deshabilitado={!nueva || !confirmacion}>Guardar y entrar</Boton>
          : <Boton onPress={entrar} ocupado={ocupado} deshabilitado={!usuario || !clave}>Entrar</Boton>}
      </View>
    </KeyboardAvoidingView>
  );
}
