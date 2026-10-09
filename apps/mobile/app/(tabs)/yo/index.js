// Yo: lo personal —perfil, documentos, solicitudes— y salir. Es lo que en el
// portal vive en el menú del empleado y en la esquina del usuario.
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Switch as SwitchRN, Text, useColorScheme, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, Icon, ListItem, Switch } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { MODULE_MAP } from '@nucleo/constants/moduleMap';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Seccion from '../../../componentes/Seccion';
import Lista from '../../../componentes/Lista';
import Vidrio from '../../../componentes/Vidrio';
import { colorSistema } from '../../../componentes/Formulario';
import { useTema } from '../../../tema/tema';
import { ICONO_SALIR, iconoDe } from '../../../tema/iconos';
import { abrirModulo } from '../../../pantallas';
import { biometriaActiva, nombreBiometria, olvidarBiometria } from '../../../componentes/biometria';
import { soltarAvisos } from '../../../componentes/avisos';

const PERSONALES = ['emp_profile', 'emp_documents', 'requests_personales'];

export default function Yo() {
  const { user, hasPermission, logout } = useAuth();
  const salas = useStaffStore((s) => s.branches);
  const tema = useTema();
  const oscuro = useColorScheme() === 'dark';
  const [biometria, setBiometria] = useState({ nombre: null, activa: false });
  useEffect(() => {
    (async () => setBiometria({ nombre: await nombreBiometria(), activa: await biometriaActiva() }))();
  }, []);
  if (!user) return null;

  // Activar pide la contraseña, así que se hace al entrar: desde acá sólo se
  // quita. Encenderlo acá lleva a salir y entrar con la contraseña.
  const cambiarBiometria = (quiere) => {
    if (!quiere) {
      olvidarBiometria();
      setBiometria((b) => ({ ...b, activa: false }));
      return;
    }
    Alert.alert(`Activar ${biometria.nombre}`,
      `Para guardarlo hay que entrar una vez con la contraseña. Sal y, al entrar, elige «Usar ${biometria.nombre}».`,
      [{ text: 'Entendido' }]);
  };

  const idSala = salaDelUsuario(user);
  const sala = (salas || []).find((b) => String(b.id) === String(idSala))?.name;
  const cargo = typeof user.role === 'string' && isNaN(Number(user.role)) ? user.role : '';
  const modulos = PERSONALES.filter((k) => hasPermission(k)).map((k) => ({ key: k, ...MODULE_MAP[k] }));

  const salir = () => Alert.alert('¿Salir de la app?', 'Vas a tener que volver a entrar con tu usuario.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Salir', style: 'destructive', onPress: async () => { await soltarAvisos(); logout?.(); } },
  ]);

  if (Platform.OS !== 'ios') {
    return <YoAndroid nombre={shortEmployeeName(user)} detalle={[cargo, sala].filter(Boolean).join(' · ')} modulos={modulos}
      biometria={biometria} cambiarBiometria={cambiarBiometria} salir={salir} tema={tema} />;
  }

  return (
    <Host style={{ flex: 1 }} colorScheme={oscuro ? 'dark' : 'light'}>
      <Lista>
        <Seccion>
          <ListItem supporting={[cargo, sala].filter(Boolean).join(' · ') || undefined}
            leading={<Icon name={iconoDe('User')} size={28} color={tema.color.marca} />}>
            {shortEmployeeName(user)}
          </ListItem>
        </Seccion>
        {modulos.length > 0 && (
          <Seccion>
            {modulos.map((m) => (
              <ListItem key={m.key} onPress={() => abrirModulo(m)}
                leading={<Icon name={iconoDe(m.icono)} size={20} color={tema.color.marca} />}>
                {m.label}
              </ListItem>
            ))}
          </Seccion>
        )}
        {biometria.nombre ? (
          <Seccion>
            <ListItem trailing={<Switch value={biometria.activa} onValueChange={cambiarBiometria} />}>
              {`Entrar con ${biometria.nombre}`}
            </ListItem>
          </Seccion>
        ) : null}
        <Seccion>
          <ListItem onPress={salir} leading={<Icon name={ICONO_SALIR} size={20} color={tema.color.peligro} />}>
            Salir
          </ListItem>
        </Seccion>
      </Lista>
    </Host>
  );
}

// Android (2026-10-09): la lista de Compose salía como filas blancas de borde a
// borde, sin las tarjetas que tiene en iPhone. Acá va con las MISMAS piezas
// que el Menú (vidrio y renglones), que es como se ve el resto de la app.
function Renglon({ icono, color, texto, alTocar, primero, derecha, peligro }) {
  return (
    <Pressable disabled={!alTocar} onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar?.(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14, paddingRight: 12,
        backgroundColor: pressed ? 'rgba(127,127,127,0.18)' : 'transparent' })}>
      <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Host matchContents><Icon name={icono} size={17} color="#FFFFFF" /></Host>
      </View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 50,
        borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
        <Text style={{ flex: 1, color: peligro ? colorSistema.rojo : colorSistema.texto, fontSize: 17 }} numberOfLines={1}>{texto}</Text>
        {derecha ?? (alTocar && !peligro ? <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text> : null)}
      </View>
    </Pressable>
  );
}

function YoAndroid({ nombre, detalle, modulos, biometria, cambiarBiometria, salir, tema }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 22 }}>
      <Vidrio radio={22}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: tema.color.marca, alignItems: 'center', justifyContent: 'center' }}>
            <Host matchContents><Icon name={iconoDe('User')} size={26} color="#FFFFFF" /></Host>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 19, fontWeight: '700' }} numberOfLines={1}>{nombre}</Text>
            {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }} numberOfLines={1}>{detalle}</Text> : null}
          </View>
        </View>
      </Vidrio>
      {modulos.length > 0 ? (
        <Vidrio radio={22}>
          <View style={{ paddingVertical: 2 }}>
            {modulos.map((m, i) => <Renglon key={m.key} primero={!i} icono={iconoDe(m.icono)} color={tema.color.marca} texto={m.label} alTocar={() => abrirModulo(m)} />)}
          </View>
        </Vidrio>
      ) : null}
      {biometria.nombre ? (
        <Vidrio radio={22}>
          <View style={{ paddingVertical: 2 }}>
            <Renglon primero icono={iconoDe('Lock')} color="#12B76A" texto={`Entrar con ${biometria.nombre}`}
              derecha={<SwitchRN value={biometria.activa} onValueChange={cambiarBiometria} />} />
          </View>
        </Vidrio>
      ) : null}
      <Vidrio radio={22}>
        <View style={{ paddingVertical: 2 }}>
          <Renglon primero icono={ICONO_SALIR} color={tema.color.peligro} texto="Salir" alTocar={salir} peligro />
        </View>
      </Vidrio>
    </ScrollView>
  );
}
