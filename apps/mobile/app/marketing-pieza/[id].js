// Una pieza del calendario de marketing, NATIVO — lo de leer y decidir de
// `PiezaModal`: el texto, los hashtags y los diseños en grande; la REVISIÓN
// (Aprobar / Pedir cambios con lo que hay que cambiar) para quien aprueba, una
// vez enviada; «Enviar a revisión» de una pieza terminada para quien edita;
// el historial con quién hizo cada cambio, y la conversación (comentar y dar
// por resuelto). Las funciones son las del núcleo (`data/marketing`), así que
// la base decide igual que en el portal.
//
// Quien edita además la edita con sus diseños (`marketing-editar`), la pauta
// (`marketing-pauta`) y la duplica a otro mes (`duplicarPiezas`, la del portal).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  comentar, duplicarPiezas, enviarPieza, fetchComentarios, fetchHistorial, fetchPersonas, marcarResuelto, revisarPieza,
} from '@nucleo/data/marketing';
import { correrMes, etiquetaMes } from '@nucleo/utils/fecha';
import { estadoDe, formatoDe, fraseDeHistorial, tipoDeArchivo } from '@nucleo/utils/marketing';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12, hora12 } from '@nucleo/utils/hora';
import { fechaTexto } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Avatar from '../../componentes/Avatar';
import { MARCA } from '../../componentes/inicio/marca';
import { colorDeVariante } from '../../componentes/colorDeVariante';
import { piezaElegida } from '../../componentes/marketing/elegida';
import { fallo, listo } from '../../componentes/Progreso';

function Quien({ id, personas }) {
  if (!id) return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>Automático</Text>;
  const p = personas[id];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Avatar empleado={p || { id, name: '?' }} tamano={22} />
      <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{p?.name ? shortEmployeeName(p.name) : '—'}</Text>
    </View>
  );
}

export default function PiezaDeMarketing() {
  const { hasPermission, user } = useAuth();
  const puedeEditar = hasPermission('marketing', 'can_edit');
  const puedeAprobar = hasPermission('marketing', 'can_approve');
  const abierta = piezaElegida();
  const [pieza, setPieza] = useState(abierta?.pieza ?? null);
  // Al volver de editarla o pautarla, la pieza recordada trae lo guardado.
  useFocusEffect(useCallback(() => { const p = piezaElegida()?.pieza; if (p) setPieza(p); }, []));
  const mes = abierta?.mes ?? null;
  const firmas = abierta?.firmas ?? new Map();
  const [comentarios, setComentarios] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [personas, setPersonas] = useState({});
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);

  // Duplicar a otro mes: la copia nace pendiente, sin diseños ni pauta. «Semana»
  // la pone en la misma semana del mes; «día», en el mismo número de día.
  const duplicar = () => {
    const base = String(mes?.mes || pieza?.fecha || '').slice(0, 7);
    const destinos = [1, 2, 3].map((n) => correrMes(base, n));
    const opciones = [...destinos.map((m) => etiquetaMes(m)), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Duplicar a', options: opciones, cancelButtonIndex: opciones.length - 1 }, (i) => {
      if (i >= destinos.length) return;
      const destino = destinos[i];
      ActionSheetIOS.showActionSheetWithOptions({ title: `Duplicar a ${etiquetaMes(destino)}`, message: 'La copia nace pendiente, sin diseños ni pauta.', options: ['Misma semana del mes', 'Mismo número de día', 'Cancelar'], cancelButtonIndex: 2 }, (j) => {
        if (j > 1) return;
        correr(() => duplicarPiezas([pieza.id], destino, j === 0 ? 'semana' : 'dia'), `Duplicada a ${etiquetaMes(destino)}`);
      });
    });
  };

  const cargar = useCallback(async () => {
    if (!mes?.id || !pieza?.id) return;
    try {
      const [c, h] = await Promise.all([fetchComentarios(mes.id), fetchHistorial(mes.id)]);
      const mios = (c || []).filter((x) => x.pieza_id === pieza.id);
      const suyo = (h || []).filter((x) => x.pieza_id === pieza.id);
      setComentarios(mios);
      setHistorial(suyo);
      setPersonas(await fetchPersonas([...mios.map((x) => x.autor_id), ...suyo.map((x) => x.actor)]));
    } catch { setComentarios([]); }
  }, [mes?.id, pieza?.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const publicado = !!mes?.publicado_at || !!pieza?.enviada_at;
  const puedeRevisar = puedeAprobar && publicado && ['finalizado', 'cambios', 'aprobado'].includes(pieza?.estado);
  const puedeEnviarSola = puedeEditar && pieza?.estado === 'finalizado';
  const imagenes = useMemo(() => (pieza?.archivos || []).filter((a) => !a.reemplazado && tipoDeArchivo(a) === 'imagen' && firmas.get(a.url)), [pieza, firmas]);

  if (!pieza) return <View style={{ margin: 16 }}><Aviso tono="freno" texto="No se encontró la pieza. Vuelve a abrirla desde el calendario." /></View>;
  const est = estadoDe(pieza.estado);

  const correr = async (fn, exito, nuevoEstado) => {
    setOcupado(true);
    try {
      await fn();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(exito, pieza.titulo || '');
      if (nuevoEstado) setPieza((p) => ({ ...p, ...nuevoEstado }));
      cargar();
    } catch (e) {
      fallo('No se pudo completar', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setOcupado(false);
    }
  };

  const aprobar = () => Alert.alert('Aprobar la pieza', pieza.titulo || '', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Aprobar', onPress: () => correr(() => revisarPieza(pieza.id, 'aprobar', null), 'Pieza aprobada', { estado: 'aprobado' }) },
  ]);
  const pedirCambios = () => Alert.prompt('Pedir cambios', '¿Qué hay que cambiar? Sé específico: texto, colores, producto, fecha…', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Pedir cambios', onPress: (t) => {
      const v = String(t ?? '').trim();
      if (!v) { Alert.alert('Pedir cambios', 'Hace falta escribir qué cambiar.'); return; }
      correr(() => revisarPieza(pieza.id, 'cambios', v), 'Cambios pedidos', { estado: 'cambios' });
    } },
  ], 'plain-text');
  const enviarSola = () => Alert.alert(pieza.enviada_at ? 'Reenviar a revisión' : 'Enviar a revisión', 'Se manda sólo esta pieza a quien aprueba.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Enviar', onPress: () => correr(() => enviarPieza(pieza.id), 'Enviada a revisión', { enviada_at: new Date().toISOString() }) },
  ]);
  const mandarComentario = () => {
    const v = texto.trim();
    if (!v) return;
    correr(async () => { await comentar({ mesId: mes.id, piezaId: pieza.id, texto: v, autorId: user?.id }); setTexto(''); }, 'Comentario enviado');
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: formatoDe(pieza.formato).label, headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <View style={{ gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{pieza.titulo || formatoDe(pieza.formato).label}</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Pildora texto={est.label} color={colorDeVariante(est.variant)} />
              {pieza.pautar ? <Pildora texto="Con pauta" color={MARCA.violetaClaro} /> : null}
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {[pieza.fecha ? fechaTexto(pieza.fecha, { weekday: 'long', day: 'numeric', month: 'short' }) : null, pieza.hora ? hora12(pieza.hora) : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
          {pieza.copy || pieza.hashtags ? (
            <Seccion titulo="Texto">
              {pieza.copy ? <Text selectable style={{ color: colorSistema.texto, fontSize: 15 }}>{pieza.copy}</Text> : null}
              {pieza.hashtags ? <Text selectable style={{ color: MARCA.azulClaro, fontSize: 14 }}>{pieza.hashtags}</Text> : null}
            </Seccion>
          ) : null}
          {imagenes.map((a) => <Image key={a.id ?? a.url} source={{ uri: firmas.get(a.url) }} style={{ width: '100%', aspectRatio: 1, borderRadius: 16 }} resizeMode="cover" />)}
          {!imagenes.length ? <Aviso texto={(pieza.archivos || []).length ? 'Los diseños se ven cuando el mes o la pieza se envía a revisión.' : 'Sin diseños todavía.'} /> : null}

          {puedeRevisar ? (
            <Seccion titulo="Revisión">
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {pieza.estado !== 'aprobado' ? (
                  <View style={{ flex: 1 }}><BotonGrande texto="Aprobar" color={MARCA.verde} onPress={aprobar} deshabilitado={ocupado} /></View>
                ) : null}
                <View style={{ flex: 1 }}><BotonGrande texto="Pedir cambios" color={MARCA.ambar} borde onPress={pedirCambios} deshabilitado={ocupado} /></View>
              </View>
            </Seccion>
          ) : null}
          {puedeEnviarSola ? <BotonGrande texto={pieza.enviada_at ? 'Reenviar a revisión' : 'Enviar a revisión'} color={MARCA.azul} borde onPress={enviarSola} deshabilitado={ocupado} /> : null}

          <Seccion titulo="Historial">
            {historial.length ? historial.map((h, i) => (
              <View key={h.id} style={{ gap: 3, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}><Quien id={h.actor} personas={personas} /></View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fechaHora12(h.created_at, { day: 'numeric', month: 'short' })}</Text>
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, marginLeft: 28 }}>{fraseDeHistorial(h)}</Text>
              </View>
            )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin cambios todavía.</Text>}
          </Seccion>

          <Seccion titulo="Comentarios">
            {comentarios == null ? <ActivityIndicator /> : comentarios.length ? comentarios.map((c, i) => (
              <View key={c.id} style={{ gap: 3, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: c.resuelto ? 0.6 : 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ flex: 1 }}><Quien id={c.autor_id} personas={personas} /></View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fechaHora12(c.created_at, { day: 'numeric', month: 'short' })}</Text>
                </View>
                <Text style={{ color: colorSistema.texto, fontSize: 14, marginLeft: 28 }}>{c.texto}</Text>
                {c.marca ? <Text style={{ color: colorSistema.texto2, fontSize: 12, marginLeft: 28 }}>Marcado sobre un diseño (se ve en el portal)</Text> : null}
                {puedeEditar || puedeAprobar ? (
                  <Pressable onPress={() => correr(() => marcarResuelto(c.id, !c.resuelto), c.resuelto ? 'Reabierto' : 'Resuelto')} hitSlop={6} style={{ marginLeft: 28 }}>
                    <Text style={{ color: c.resuelto ? MARCA.ambar : MARCA.verde, fontSize: 13, fontWeight: '700' }}>{c.resuelto ? 'Reabrir' : 'Marcar resuelto'}</Text>
                  </Pressable>
                ) : null}
              </View>
            )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin comentarios.</Text>}
            <Campo value={texto} onChangeText={setTexto} placeholder="Escribe un comentario…" maxLength={2000} />
            <BotonGrande texto="Comentar" onPress={mandarComentario} deshabilitado={ocupado || !texto.trim()} />
          </Seccion>
          {puedeEditar ? (
            <Seccion titulo="Diseñador">
              <BotonGrande texto="Editar la pieza y sus diseños" onPress={() => router.push('/marketing-editar')} />
              <BotonGrande borde texto={pieza?.pauta ? 'La pauta' : 'Pautarla'} color={MARCA.azulClaro} onPress={() => router.push('/marketing-pauta')} />
              <BotonGrande borde texto="Duplicar a otro mes" color={MARCA.azulClaro} onPress={duplicar} />
            </Seccion>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
