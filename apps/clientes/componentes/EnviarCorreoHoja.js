// Enviar facturas por correo (2026-10-09). Una hoja con los correos que el
// cliente ya usó —el de su ficha primero—, un campo para uno nuevo y el botón
// de enviar. Los correos guardados viven en el SERVIDOR (`app_cliente_correos`,
// acción `correos_lista`): así siguen ahí al cambiar de teléfono. Se guardan
// solos al enviar; mantener presionado uno (o el ícono de basura) lo quita.
//
// El envío lo hace la función (`facturas_enviar`): valida que las facturas
// sean de esta cuenta, el correo y los topes (30 facturas, 10 correos al día).
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { Boton } from './ui';
import { useSesion } from '../lib/sesion';
import { suave, useTema } from '../tema/tema';

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const limpiar = (v) => String(v ?? '').trim().toLowerCase();

/** `ids`: lo que se envía (ids de factura o «muestra-N»); `resumen`: el rótulo de arriba. */
export default function EnviarCorreoHoja({ ids, resumen, alCerrar, alEnviar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const pedir = useSesion((s) => s.pedir);
  const [correos, setCorreos] = useState(null);
  const [elegido, setElegido] = useState(null);
  const [nuevo, setNuevo] = useState('');
  const [tocadoNuevo, setTocadoNuevo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [hecho, setHecho] = useState(null);
  const campo = useRef(null);
  const fondo = t.oscuro ? '#121016' : '#F5F4F8';
  const superficie = t.oscuro ? '#1E1B24' : '#FFFFFF';

  useEffect(() => {
    let vivo = true;
    pedir('correos_lista').then((r) => {
      if (!vivo) return;
      const lista = r?.ok ? r.correos ?? [] : [];
      setCorreos(lista);
      if (lista.length) setElegido(lista[0].correo);
    });
    return () => { vivo = false; };
  }, [pedir]);

  const escrito = limpiar(nuevo);
  const usandoNuevo = escrito.length > 0;
  const nuevoValido = CORREO.test(escrito) && escrito.length <= 254;
  const destino = usandoNuevo ? (nuevoValido ? escrito : null) : elegido;

  const elegir = (c) => { Haptics.selectionAsync().catch(() => {}); setElegido(c); setNuevo(''); setTocadoNuevo(false); setError(null); };

  const borrar = (c) => {
    if (c.de_ficha) { Alert.alert('Es el correo de tu ficha', 'Para cambiarlo, pídelo en tu sucursal.'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Alert.alert('¿Quitar este correo?', `${c.correo} ya no aparecerá en la lista.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar', style: 'destructive', onPress: async () => {
          const r = await pedir('correo_borrar', { correo: c.correo });
          if (!r?.ok) { Alert.alert('No se pudo quitar', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
          setCorreos((l) => (l ?? []).filter((x) => x.correo !== c.correo));
          if (elegido === c.correo) setElegido(null);
        },
      },
    ]);
  };

  const enviar = async () => {
    if (enviando) return;
    if (!destino) { setTocadoNuevo(true); setError(usandoNuevo ? 'Ese correo no parece válido.' : 'Elige o escribe un correo.'); return; }
    setEnviando(true); setError(null);
    const r = await pedir('facturas_enviar', { ids, correo: destino });
    setEnviando(false);
    if (!r?.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setHecho(r);
    alEnviar?.(r);
  };

  const n = ids.length;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={alCerrar}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: fondo }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto }}>{hecho ? '¡Enviado!' : 'Enviar por correo'}</Text>
          <Pressable onPress={alCerrar} hitSlop={12} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }}>{hecho ? 'Listo' : 'Cancelar'}</Text>
          </Pressable>
        </View>
        {hecho ? (
          <View style={{ padding: 18, gap: 14, alignItems: 'center' }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.verde, 0.25) }}>
              <Icono sf="paperplane.fill" respaldo="✓" tam={28} color={t.color.verdeTexto} />
            </View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colorSistema.texto, textAlign: 'center' }}>{hecho.correo}</Text>
            <Text style={{ fontSize: 15, lineHeight: 21, color: colorSistema.texto2, textAlign: 'center' }}>
              {hecho.cantidad === 1 ? 'Te enviamos la factura' : `Te enviamos ${hecho.cantidad} facturas`}
              {hecho.modo === 'enlaces' ? ' con enlaces para descargarlas (valen 7 días).' : ' con su PDF y su JSON adjuntos.'}
              {' '}Si no lo ves en unos minutos, revisa la carpeta de correo no deseado.
            </Text>
            <View style={{ alignSelf: 'stretch' }}><Boton alTocar={alCerrar}>Listo</Boton></View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: ins.bottom + 24, gap: 14 }} keyboardShouldPersistTaps="handled">
            <View style={{ backgroundColor: superficie, borderRadius: 18, padding: 16, gap: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>{n === 1 ? '1 factura' : `${n} facturas`}</Text>
              {resumen ? <Text style={{ fontSize: 14, color: colorSistema.texto2 }} numberOfLines={2}>{resumen}</Text> : null}
              <Text style={{ fontSize: 13, color: colorSistema.texto3, marginTop: 4 }}>Cada una va con su PDF y su archivo JSON.</Text>
            </View>

            {correos === null ? <ActivityIndicator style={{ marginVertical: 12 }} /> : correos.length ? (
              <>
                <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4 }}>Tus correos</Text>
                <View style={{ backgroundColor: superficie, borderRadius: 18, overflow: 'hidden' }}>
                  {correos.map((c, i) => {
                    const activo = !usandoNuevo && elegido === c.correo;
                    return (
                      <View key={c.correo}>
                        {i > 0 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 50 }} /> : null}
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Pressable onPress={() => elegir(c.correo)} onLongPress={() => borrar(c)} accessibilityRole="radio" accessibilityState={{ selected: activo }}
                            style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 52, opacity: pressed ? 0.6 : 1 })}>
                            <Icono sf={activo ? 'checkmark.circle.fill' : 'circle'} respaldo={activo ? '●' : '○'} tam={22} color={activo ? t.color.magenta : colorSistema.texto3} />
                            <View style={{ flex: 1, gap: 2 }}>
                              <Text style={{ fontSize: 15, fontWeight: activo ? '700' : '500', color: colorSistema.texto }} numberOfLines={1}>{c.correo}</Text>
                              {c.de_ficha ? <Text style={{ fontSize: 12, color: colorSistema.texto3 }}>El de tu ficha</Text> : null}
                            </View>
                          </Pressable>
                          {!c.de_ficha ? (
                            <Pressable onPress={() => borrar(c)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Quitar ${c.correo}`}
                              style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                              <Icono sf="trash" respaldo="×" tam={16} color={colorSistema.texto3} />
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </>
            ) : null}

            <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4 }}>
              {correos?.length ? 'Otro correo' : 'Correo'}
            </Text>
            <TextInput ref={campo} value={nuevo} onChangeText={(v) => { setNuevo(v); setError(null); }} onBlur={() => setTocadoNuevo(true)}
              placeholder="nombre@correo.com" placeholderTextColor={colorSistema.texto3}
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress"
              returnKeyType="send" onSubmitEditing={enviar} maxLength={254}
              accessibilityLabel="Escribe un correo"
              style={{ minHeight: 52, borderRadius: 16, paddingHorizontal: 14, fontSize: 16, color: colorSistema.texto, backgroundColor: superficie,
                borderWidth: 1.5, borderColor: usandoNuevo && tocadoNuevo && !nuevoValido ? t.color.peligro : usandoNuevo ? t.color.magenta : 'transparent' }} />
            {usandoNuevo && tocadoNuevo && !nuevoValido ? (
              <Text style={{ fontSize: 13, color: t.color.peligroTexto, marginLeft: 4 }}>Revisa el correo: falta algo (por ejemplo, la @ o el dominio).</Text>
            ) : usandoNuevo ? (
              <Text style={{ fontSize: 13, color: colorSistema.texto3, marginLeft: 4 }}>Lo guardamos para la próxima vez.</Text>
            ) : null}

            {error ? <Text style={{ fontSize: 14, color: t.color.peligroTexto }}>{error}</Text> : null}
            {enviando ? <ActivityIndicator style={{ marginVertical: 8 }} />
              : <Boton alTocar={enviar} deshabilitado={!destino}>{n === 1 ? 'Enviar factura' : `Enviar ${n} facturas`}</Boton>}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}
