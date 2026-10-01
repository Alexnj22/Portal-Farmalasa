// «¿Quién recibe?» — la identidad de la persona que toma el dinero o la caja,
// a la manera del portal (`IdentidadDeQuienRetira.jsx`): se PRUEBA, no se
// elige de una lista. Con el carné (la cámara lee su código) o, si el carné no
// lee, con su usuario y su contraseña. Las dos devuelven `{ persona, vale }`:
// el vale es de un solo uso y dura cinco minutos (`consumir_vale_de_identidad`).
//
// La contraseña la escribe la persona que recibe, en este teléfono, y viaja
// sólo en esta llamada. No se guarda en ningún lado.
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { identificarPorCarne, identificarPorUsuario } from '@nucleo/data/bolsas';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Escaner from './Escaner';
import Avatar from './Avatar';
import { colorSistema } from './Formulario';
import { BotonGrande, Aviso } from './formulario/Piezas';
import { MARCA } from './inicio/marca';

const campo = {
  minHeight: 46, paddingHorizontal: 12, borderRadius: 12, fontSize: 16,
  color: colorSistema.texto, backgroundColor: 'rgba(127,127,127,0.16)',
};

export default function Identidad({ identidad, onIdentidad, titulo = 'Escanea el carné de quien recibe' }) {
  const [escaneando, setEscaneando] = useState(false);
  const [conUsuario, setConUsuario] = useState(false);
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState(null);
  const [probando, setProbando] = useState(false);

  const resultado = (r) => {
    if (r?.persona && r?.vale) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setError(null); setClave('');
      onIdentidad({ persona: r.persona, vale: r.vale });
      return true;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setError(r?.motivo || r?.error?.message || 'No se pudo confirmar quién es.');
    return false;
  };

  if (identidad?.persona) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar empleado={identidad.persona} tamano={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>Recibe</Text>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{shortEmployeeName(identidad.persona)}</Text>
        </View>
        <Pressable onPress={() => onIdentidad(null)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colorSistema.acento, fontSize: 15 }}>Cambiar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      <BotonGrande texto="Escanear el carné" color={MARCA.azul} onPress={() => { setError(null); setEscaneando(true); }} />
      {error ? <Aviso tono="freno" texto={error} /> : null}
      {conUsuario ? (
        <View style={{ gap: 8 }}>
          <TextInput value={usuario} onChangeText={setUsuario} placeholder="Usuario de quien recibe" placeholderTextColor={colorSistema.texto2}
            autoCapitalize="none" autoCorrect={false} style={campo} />
          <TextInput value={clave} onChangeText={setClave} placeholder="Su contraseña" placeholderTextColor={colorSistema.texto2}
            secureTextEntry autoCapitalize="none" autoCorrect={false} style={campo} />
          <BotonGrande texto={probando ? 'Comprobando…' : 'Comprobar'} color={MARCA.azul} borde
            deshabilitado={probando || !usuario.trim() || !clave}
            onPress={async () => { setProbando(true); resultado(await identificarPorUsuario(usuario.trim(), clave)); setProbando(false); }} />
        </View>
      ) : (
        <Pressable onPress={() => setConUsuario(true)} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'center' }}>
          <Text style={{ color: colorSistema.acento, fontSize: 15 }}>El carné no lee: usar usuario y contraseña</Text>
        </Pressable>
      )}
      <Escaner visible={escaneando} titulo={titulo} ayuda="Apunta al código del carné"
        onCodigo={async (codigo) => {
          const ok = resultado(await identificarPorCarne(codigo));
          if (ok) setEscaneando(false);
          return ok;
        }}
        onCerrar={() => setEscaneando(false)}
        pie={error ? <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{error}</Text> : null} />
    </View>
  );
}
