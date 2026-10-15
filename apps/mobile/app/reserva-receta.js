// Revisar la receta de una reserva, NATIVO — `RevisarReceta` del portal. Un
// producto bajo receta queda «en revisión» hasta que la sala del retiro mira la
// foto y decide: aprobarla (la reserva se confirma y el cliente ya puede
// pagar), pedir otra foto (con el motivo, que le llega al cliente) o
// rechazarla (la reserva se cancela). La función de la base
// (`reserva_receta_decidir`, por `decidirReceta` del núcleo) avisa al cliente
// y anota la bitácora; acá sólo se decide, igual que en el portal.
//
// Params: `id` de la reserva; `sala` (o vacío con `todas=1`) para releerla.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { codigoDeReserva, decidirReceta, fetchReservasDeSucursal } from '@nucleo/data/reservas';
import { firmarRuta } from '@nucleo/data/chatClientes';
import { pilaDelCliente } from '@nucleo/utils/reservasDeSala';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

// Las razones de siempre para pedir otra foto (las mismas del portal): un
// toque, y el texto se puede completar a mano.
const MOTIVOS_OTRA_FOTO = ['No se lee', 'Está vencida', 'No corresponde al producto', 'Falta firma o sello'];
const ZOOMS = [1, 1.5, 2, 3];

function Chip({ texto, onPress, activo }) {
  return (
    <Pressable onPress={onPress} hitSlop={4} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 999,
        backgroundColor: activo ? `${MARCA.azulClaro}40` : 'rgba(127,127,127,0.16)', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

export default function RevisarReceta() {
  const { id, sala, todas } = useLocalSearchParams();
  const [reserva, setReserva] = useState(undefined);
  const [url, setUrl] = useState(null);
  const [tam, setTam] = useState(null);
  const [zoom, setZoom] = useState(0);
  // null = mirando; 'otra_foto' | 'rechazada' = escribiendo el motivo.
  const [modo, setModo] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const filas = await fetchReservasDeSucursal(todas === '1' ? null : sala, true);
      setReserva(filas.find((r) => String(r.id) === String(id)) ?? null);
    } catch (e) { fallo('No se pudo abrir la reserva', mensajeAmigable(e)); setReserva(null); }
  }, [id, sala, todas]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial

  useEffect(() => {
    let vivo = true;
    if (!reserva?.receta_ruta) return undefined;
    firmarRuta(reserva.receta_ruta).then((u) => {
      if (!vivo || !u) return;
      setUrl(u);
      Image.getSize(u, (w, h) => { if (vivo) setTam({ w, h }); }, () => { if (vivo) setTam({ w: 3, h: 4 }); });
    }).catch(() => {});
    return () => { vivo = false; };
  }, [reserva?.receta_ruta]);

  const decidible = reserva?.estado === 'en_revision' && reserva?.receta_estado === 'pendiente';
  const codigo = reserva ? (reserva.pedido ?? codigoDeReserva(reserva.id)) : '';

  const decidir = (decision) => {
    if (decision !== 'aprobada' && !motivo.trim()) { Alert.alert('Falta el motivo', 'El cliente lo recibe en la app: dile qué pasó.'); return; }
    const textos = {
      aprobada: ['¿Aprobar la receta?', 'La reserva queda confirmada y el cliente recibe el aviso.', 'Aprobar'],
      otra_foto: ['¿Pedir otra foto?', `El cliente recibe el aviso: «${motivo.trim()}».`, 'Pedir otra foto'],
      rechazada: ['¿Rechazar la receta?', `La reserva se cancela y el cliente recibe el aviso: «${motivo.trim()}».`, 'Rechazar'],
    }[decision];
    Alert.alert(textos[0], textos[1], [
      { text: 'Volver', style: 'cancel' },
      { text: textos[2], style: decision === 'rechazada' ? 'destructive' : 'default', onPress: async () => {
        setEnviando(true); trabajando('Guardando…');
        try {
          await decidirReceta(reserva.id, decision, decision === 'aprobada' ? null : motivo);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          listo(decision === 'aprobada' ? 'Receta aprobada' : decision === 'otra_foto' ? 'Se pidió otra foto' : 'Receta rechazada',
            decision === 'aprobada' ? 'La reserva quedó confirmada y el cliente recibió el aviso.'
              : decision === 'otra_foto' ? 'El cliente recibió el aviso para subir otra.' : 'La reserva se canceló y el cliente recibió el aviso.');
          router.back();
        } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setEnviando(false); }
      } },
    ]);
  };

  const ancho = Dimensions.get('window').width - 32;
  const anchoFoto = ancho * ZOOMS[zoom];
  const altoFoto = tam ? anchoFoto * (tam.h / tam.w) : ancho * 1.3;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: reserva ? `Receta de ${pilaDelCliente(reserva)}` : 'Receta' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}>
          {reserva === undefined ? <ActivityIndicator style={{ marginTop: 24 }} /> : !reserva ? (
            <Aviso tono="cuidado" texto="Esa reserva ya no está abierta: alguien la decidió o se canceló." />
          ) : (
            <>
              <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>
                {`${reserva.cantidad} × ${reserva.producto} · ${codigo}${reserva.receta_subida_at ? ` · subida el ${fechaTexto(reserva.receta_subida_at, { day: 'numeric', month: 'short' })}, ${hora12(reserva.receta_subida_at)}` : ''}${Number(reserva.receta_fotos) > 1 ? ` · foto ${reserva.receta_fotos}` : ''}`}
              </Text>
              {!decidible && reserva.receta_estado === 'otra_foto' ? (
                <Aviso texto={`Esperando nueva foto del cliente${reserva.receta_motivo ? ` · se le pidió: ${reserva.receta_motivo}` : ''}.`} />
              ) : null}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                <Chip texto="−" onPress={() => setZoom((z) => Math.max(0, z - 1))} />
                <Text style={{ color: colorSistema.texto2, fontSize: 14, fontVariant: ['tabular-nums'], minWidth: 54, textAlign: 'center' }}>{`${Math.round(ZOOMS[zoom] * 100)} %`}</Text>
                <Chip texto="+" onPress={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} />
              </View>
              <View style={{ borderRadius: 14, overflow: 'hidden', backgroundColor: colorSistema.separador, maxHeight: Dimensions.get('window').height * 0.6 }}>
                {!reserva.receta_ruta ? <Text style={{ padding: 16, color: colorSistema.texto2 }}>El cliente todavía no subió la foto.</Text>
                  : !url ? <ActivityIndicator style={{ margin: 32 }} /> : (
                    <ScrollView nestedScrollEnabled maximumZoomScale={4} minimumZoomScale={1} bouncesZoom>
                      <ScrollView horizontal nestedScrollEnabled>
                        <Image source={{ uri: url }} style={{ width: anchoFoto, height: altoFoto }} resizeMode="contain"
                          accessibilityLabel={`Receta de la reserva ${codigo}`} />
                      </ScrollView>
                    </ScrollView>
                  )}
              </View>
              {decidible && modo ? (
                <Seccion titulo={modo === 'otra_foto' ? '¿Por qué hace falta otra foto?' : '¿Por qué se rechaza?'} pie="El cliente lo recibe en la app.">
                  {modo === 'otra_foto' ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {MOTIVOS_OTRA_FOTO.map((m) => <Chip key={m} texto={m} activo={motivo === m} onPress={() => setMotivo(m)} />)}
                    </View>
                  ) : null}
                  <Campo value={motivo} onChangeText={setMotivo} maxLength={300} placeholder="Motivo" />
                </Seccion>
              ) : null}
              {!decidible ? null : modo ? (
                <View style={{ gap: 10 }}>
                  <BotonGrande texto={modo === 'rechazada' ? 'Rechazar receta' : 'Pedir otra foto'} color={modo === 'rechazada' ? MARCA.rojo : MARCA.azul}
                    deshabilitado={enviando || !motivo.trim()} onPress={() => decidir(modo)} />
                  <BotonGrande texto="Volver" borde onPress={() => { setModo(null); setMotivo(''); }} />
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  <BotonGrande texto="Aprobar" color={MARCA.verde} deshabilitado={enviando || !url} onPress={() => decidir('aprobada')} />
                  <BotonGrande texto="Pedir otra foto" borde onPress={() => { setModo('otra_foto'); setMotivo(''); }} />
                  <BotonGrande texto="Rechazar" borde color={MARCA.rojo} onPress={() => { setModo('rechazada'); setMotivo(''); }} />
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
