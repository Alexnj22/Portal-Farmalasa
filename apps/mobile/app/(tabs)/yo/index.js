// Cuenta: lo personal —perfil, documentos, solicitudes— y salir. Es lo que en el
// portal vive en el menú del empleado y en la esquina del usuario.
//
// También lo del menú de Ajustes de la barra del portal: el código del kiosco
// y el SU para copiarlos (mismos permisos: `kiosk_pin` y `su_pin`, ver
// `componentes/perfil/codigoDeKiosco`) y la apariencia —los cuatro temas del
// portal, Estilo × Modo— que se guarda en el teléfono (`tema/preferencia`).
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';
import Interruptor from '../../../componentes/Interruptor';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { MODULE_MAP } from '@nucleo/constants/moduleMap';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Vidrio from '../../../componentes/Vidrio';
import { colorSistema } from '../../../componentes/Formulario';
import { useTema } from '../../../tema/tema';
import { ICONO_SALIR, iconoDe } from '../../../tema/iconos';
import { abrirModulo } from '../../../pantallas';
import { biometriaActiva, nombreBiometria, olvidarBiometria } from '../../../componentes/biometria';
import { soltarAvisos } from '../../../componentes/avisos';
import * as Clipboard from 'expo-clipboard';
import { useCodigoDeKiosco } from '../../../componentes/perfil/codigoDeKiosco';
import { ESTILOS, MODOS, usePreferenciaDeTema } from '../../../tema/preferencia';
import { listo } from '../../../componentes/Progreso';
import { MARCA } from '../../../componentes/inicio/marca';
import { usePestanaRapida } from '../../../componentes/pestanaRapida';
import { router } from 'expo-router';

const ES_IOS = Platform.OS === 'ios';

function copiar(texto, que) {
  if (!texto || texto.includes('·')) return;
  Clipboard.setStringAsync(texto).then(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    listo('Copiado', que);
  }).catch(() => {});
}

// La hoja de opciones del sistema. `ActionSheetIOS` no existe en Android (tocar
// «Modo» fallaba ahí): en Android va el diálogo del sistema, que admite hasta
// tres botones —los tres modos— y se cierra tocando afuera.
function elegir(titulo, opciones, onElegir) {
  if (!ES_IOS) {
    Alert.alert(titulo, undefined, opciones.map((o) => ({ text: o.label, onPress: () => onElegir(o.id) })), { cancelable: true });
    return;
  }
  ActionSheetIOS.showActionSheetWithOptions(
    { title: titulo, options: [...opciones.map((o) => o.label), 'Cancelar'], cancelButtonIndex: opciones.length },
    (i) => { if (i < opciones.length) onElegir(opciones[i].id); },
  );
}

const PERSONALES = ['emp_announcements', 'emp_profile', 'emp_documents', 'requests_personales'];

export default function Yo() {
  const { user, hasPermission, logout } = useAuth();
  const salas = useStaffStore((s) => s.branches);
  const tema = useTema();
  const oscuro = useColorScheme() === 'dark';
  const [biometria, setBiometria] = useState({ nombre: null, activa: false });
  const verPin = hasPermission('kiosk_pin', 'can_view');
  const verSu = hasPermission('su_pin', 'can_view');
  const { codigo, sufijo } = useCodigoDeKiosco(verPin);
  const { modo, estilo, ponerModo, ponerEstilo } = usePreferenciaDeTema();
  const rotuloModo = MODOS.find((m) => m.id === modo)?.label;
  const rotuloEstilo = ESTILOS.find((m) => m.id === estilo)?.label;
  const codigos = [
    ...(verPin ? [{ id: 'pin', titulo: 'Código de kiosco', valor: codigo }] : []),
    ...(verSu ? [{ id: 'su', titulo: 'Código SU', valor: `${codigo}${sufijo}` }] : []),
  ];
  const { actual: rapida } = usePestanaRapida(user, hasPermission, salas);
  const elegirModo = () => elegir('Modo', MODOS, ponerModo);
  const elegirEstilo = () => elegir('Estilo', ESTILOS, ponerEstilo);
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

  // Las mismas piezas que el Menú (vidrio y renglones) en los dos sistemas
  // (2026-11-05, usuario: «todo lo demás es vidrio pero ahí es sólido»). Antes
  // iPhone usaba la lista de SwiftUI, cuyas filas son opacas: era la única
  // pantalla sin vidrio. `Vidrio` es el Liquid Glass del sistema y respeta el
  // estilo «Sólido» de Apariencia.
  return <Tarjetas nombre={shortEmployeeName(user)} detalle={[cargo, sala].filter(Boolean).join(' · ')} modulos={modulos}
    biometria={biometria} cambiarBiometria={cambiarBiometria} salir={salir} tema={tema} oscuro={oscuro}
    codigos={codigos} rapida={rapida} rotuloModo={rotuloModo} elegirModo={elegirModo} rotuloEstilo={rotuloEstilo} elegirEstilo={elegirEstilo} />;
}

// Nació para Android (2026-10-09: la lista de Compose salía como filas blancas
// de borde a borde); desde el 2026-11-05 es también la de iPhone.
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

function Tarjetas({ nombre, detalle, modulos, biometria, cambiarBiometria, salir, tema, oscuro, codigos, rapida, rotuloModo, elegirModo, rotuloEstilo, elegirEstilo }) {
  return (
    <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 22 }}>
      <Vidrio radio={20}>
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
        <Vidrio radio={20}>
          <View style={{ paddingVertical: 2 }}>
            {modulos.map((m, i) => <Renglon key={m.key} primero={!i} icono={iconoDe(m.icono)} color={tema.color.marca} texto={m.label} alTocar={() => abrirModulo(m)} />)}
          </View>
        </Vidrio>
      ) : null}
      {biometria.nombre ? (
        <Vidrio radio={20}>
          <View style={{ paddingVertical: 2 }}>
            <Renglon primero icono={iconoDe('Lock')} color={MARCA.verde} texto={`Entrar con ${biometria.nombre}`}
              derecha={<Interruptor value={biometria.activa} onValueChange={cambiarBiometria} />} />
          </View>
        </Vidrio>
      ) : null}
      {codigos.length ? (
        <Vidrio radio={20}>
          <View style={{ paddingVertical: 2 }}>
            {codigos.map((c, i) => (
              <Renglon key={c.id} primero={!i} icono={iconoDe('Lock')} color={tema.color.marca} texto={c.titulo} alTocar={() => copiar(c.valor, c.titulo)}
                derecha={<Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: 1 }}>{c.valor}</Text>} />
            ))}
          </View>
        </Vidrio>
      ) : null}
      <Vidrio radio={20}>
        <View style={{ paddingVertical: 2 }}>
          {rapida ? (
            <Renglon primero icono={iconoDe('Star')} color={MARCA.violeta} texto="Pestaña rápida" alTocar={() => router.push('/pestana-rapida')}
              derecha={<Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{rapida.label}</Text>} />
          ) : null}
          <Renglon primero={!rapida} icono={iconoDe(oscuro ? 'Moon' : 'Sun')} color={MARCA.violeta} texto="Modo" alTocar={elegirModo}
            derecha={<Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{rotuloModo}</Text>} />
          {ES_IOS ? (
            <Renglon icono={iconoDe('Layers')} color={MARCA.violeta} texto="Estilo" alTocar={elegirEstilo}
              derecha={<Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{rotuloEstilo}</Text>} />
          ) : null}
        </View>
      </Vidrio>
      <Vidrio radio={20}>
        <View style={{ paddingVertical: 2 }}>
          <Renglon primero icono={ICONO_SALIR} color={tema.color.peligro} texto="Salir" alTocar={salir} peligro />
        </View>
      </Vidrio>
    </ScrollView>
  );
}
