// «¿Olvidaste tu contraseña?» (2026-11-17, pedido del usuario: automático,
// seguro y gratis). Se abre desde la entrada, sin sesión.
//
//  1. El usuario.  → `recuperar-contrasena` / `pedir`.
//  2a. Con correo en la ficha: llega un código de 6 dígitos a ese correo; aquí
//      se escribe el código y la contraseña nueva, y se entra con ella.
//  2b. Sin correo: se avisó a Talento Humano, Administrador y Supervisor/a de
//      Ventas, que le dan una contraseña temporal desde su perfil.
//
// El código NUNCA llega a este teléfono: va al correo. Así, saber el usuario
// de otra persona no alcanza para entrar con su cuenta.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Button, Host } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { cambiarClaveConCodigo, pedirCodigoDeClave } from '@nucleo/data/auth';
import { problemaDeContrasenaNueva } from '@nucleo/utils/contrasena';
import { colorSistema, FilaCampo, FilaClave, Formulario, Grupo } from '../componentes/Formulario';
import { Presionable as Pressable } from '../componentes/Tocable';
import { activarBiometria, biometriaActiva } from '../componentes/biometria';
import { SEMILLA } from '../tema/material';

function Boton({ texto, onPress, disabled, variante = 'filled' }) {
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Host seedColor={SEMILLA} matchContents={{ vertical: true }} style={{ width: '100%' }}>
        <Button variant={variante} label={texto} disabled={disabled} onPress={onPress} />
      </Host>
    </View>
  );
}

// Los 6 números, vengan como vengan: «123456», «123 456» o «Tu código es 123456».
function soloCodigo(texto) {
  const t = String(texto ?? '');
  const seis = t.match(/(^|\D)(\d{6})(?!\d)/);   // sin lookbehind: más seguro en Hermes
  return (seis ? seis[2] : t.replace(/\D/g, '')).slice(0, 6);
}

function Explicacion({ children }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginHorizontal: 28, lineHeight: 21 }}>{children}</Text>;
}

export default function RecuperarContrasena() {
  const { loginWithUsername } = useAuth();
  const params = useLocalSearchParams();
  const [usuario, setUsuario] = useState(typeof params.usuario === 'string' ? params.usuario : '');
  const [paso, setPaso] = useState('usuario'); // usuario | codigo | aviso
  const [envio, setEnvio] = useState(null);    // { reto, correo, minutos }
  const [codigo, setCodigo] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  // Cada envío nuevo rearma los campos del código (el campo nativo no
  // obedece un `value` puesto desde afuera).
  const [vuelta, setVuelta] = useState(0);

  const pedir = async () => {
    if (!usuario.trim() || ocupado) return;
    setError('');
    setOcupado(true);
    try {
      const r = await pedirCodigoDeClave(usuario);
      if (!r?.ok) { setError(r?.mensaje || 'No se pudo completar. Intenta de nuevo.'); return; }
      if (r.canal === 'correo') {
        setEnvio({ reto: r.reto, correo: r.correo, minutos: r.minutos ?? 15 });
        setCodigo(''); setNueva(''); setConfirmacion('');
        setVuelta((v) => v + 1);
        setPaso('codigo');
      } else {
        setPaso('aviso');
      }
    } finally {
      setOcupado(false);
    }
  };

  const pegar = async () => {
    const t = await Clipboard.getStringAsync().catch(() => '');
    const c = soloCodigo(t);
    if (c.length === 6) { setCodigo(c); setError(''); } else setError('No hay un código copiado. Cópialo del correo y vuelve a tocar Pegar.');
  };

  const cambiar = async () => {
    if (ocupado || !envio) return;
    setError('');
    if (codigo.replace(/\D/g, '').length !== 6) { setError('Escribe los 6 números del código.'); return; }
    const problema = problemaDeContrasenaNueva(nueva, confirmacion);
    if (problema) { setError(problema); return; }
    setOcupado(true);
    try {
      const r = await cambiarClaveConCodigo(envio.reto, codigo, nueva);
      if (!r?.ok) {
        setError(r?.mensaje || 'No se pudo completar. Intenta de nuevo.');
        if (r?.vencido) { setEnvio(null); setPaso('usuario'); }
        return;
      }
      const limpio = usuario.toLowerCase().trim();
      // Lo guardado para Face ID / huella tenía la contraseña vieja.
      if (await biometriaActiva()) await activarBiometria(limpio, nueva);
      const entrada = await loginWithUsername(limpio, nueva);
      if (entrada?.ok && !entrada.mustChangePassword) { router.replace('/inicio'); return; }
      // La contraseña ya cambió: si entrar falla, se entra a mano con ella.
      router.replace('/entrar');
    } catch {
      setError('No hay conexión. Intenta de nuevo.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Formulario contentContainerStyle={{ paddingTop: 24, gap: 22 }}>
      {paso === 'usuario' ? (
        <>
          <Explicacion>Escribe tu usuario. Te mandamos un código a tu correo para que elijas una contraseña nueva.</Explicacion>
          <Grupo vidrio>
            <FilaCampo key="usuario" placeholder="Usuario" defaultValue={usuario} autoCapitalize="none" autoCorrect={false}
              textContentType="username" autoFocus={!usuario} onChangeText={setUsuario} returnKeyType="send" onSubmitEditing={pedir} />
          </Grupo>
          {error ? <Text style={{ color: colorSistema.rojo, fontSize: 15, textAlign: 'center', marginHorizontal: 24 }}>{error}</Text> : null}
          <Boton texto={ocupado ? 'Enviando…' : 'Enviar código'} disabled={ocupado || !usuario.trim()} onPress={pedir} />
        </>
      ) : null}

      {paso === 'codigo' && envio ? (
        <>
          <Explicacion>Te mandamos un código a {envio.correo}. Vence en {envio.minutos} minutos. Si no lo ves, revisa el correo no deseado.</Explicacion>
          <Grupo vidrio>
            <View key={`codigo-${vuelta}`} style={{ flexDirection: 'row', alignItems: 'center' }}>
              {/* Sin `maxLength`: pegar «123 456» o la frase entera del correo
                  se recortaba antes de limpiar. Se queda con los números. */}
              <FilaCampo style={{ flex: 1 }} placeholder="Código de 6 números" keyboardType="number-pad" value={codigo}
                textContentType="oneTimeCode" autoComplete="one-time-code" autoFocus onChangeText={(t) => setCodigo(soloCodigo(t))} />
              <Pressable onPress={pegar} accessibilityRole="button" accessibilityLabel="Pegar el código"
                style={({ pressed }) => ({ minHeight: 52, paddingHorizontal: 16, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '600' }}>Pegar</Text>
              </Pressable>
            </View>
          </Grupo>
          <Grupo vidrio pie="Mínimo 8 caracteres, con una mayúscula y un número.">
            <FilaClave key={`nueva-${vuelta}`} placeholder="Contraseña nueva" textContentType="newPassword" onChangeText={setNueva} returnKeyType="next" />
            <FilaClave key={`repite-${vuelta}`} placeholder="Repítela" textContentType="newPassword" onChangeText={setConfirmacion} returnKeyType="done" onSubmitEditing={cambiar} />
          </Grupo>
          {error ? <Text style={{ color: colorSistema.rojo, fontSize: 15, textAlign: 'center', marginHorizontal: 24 }}>{error}</Text> : null}
          <Boton texto={ocupado ? 'Guardando…' : 'Guardar y entrar'} disabled={ocupado || !codigo || !nueva || !confirmacion} onPress={cambiar} />
          <Pressable onPress={pedir} disabled={ocupado} accessibilityRole="button"
            style={({ pressed }) => ({ minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed || ocupado ? 0.5 : 1 })}>
            <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '600' }}>Mandar otro código</Text>
          </Pressable>
        </>
      ) : null}

      {paso === 'aviso' ? (
        <>
          <Explicacion>Tu perfil no tiene correo. Ya le avisamos a Talento Humano: te van a dar una contraseña temporal para entrar.</Explicacion>
          <Boton texto="Volver a entrar" onPress={() => router.replace('/entrar')} />
        </>
      ) : null}
    </Formulario>
  );
}
