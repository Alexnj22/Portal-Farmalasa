// Comentar SOBRE un diseño de marketing, NATIVO — el `AnotadorModal` del
// portal: se marca un punto, se encierra una zona o se dibuja a lápiz, y el
// texto queda atado a esa marca. Las marcas que ya existen se ven numeradas,
// con su comentario debajo; tocar uno lo resalta en la imagen.
//
// Las coordenadas se guardan RELATIVAS (0–1) a la imagen, con las mismas
// reglas del portal (`utils/marcasDeDiseno`): una marca hecha acá cae en el
// mismo sitio en el monitor y al revés.
//
// La imagen se acerca pellizcando (el ScrollView del sistema, sin librerías).
// «Mover» deja acercar y desplazar; con Punto, Recuadro o Lápiz el dedo marca
// (pellizcar sigue acercando). El toque se mide en el espacio de la imagen,
// no de la pantalla, así que el acercamiento no corre la marca.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useAuth } from '@nucleo/context/AuthContext';
import { comentar, fetchComentarios, fetchPersonas, marcarResuelto, quitarComentario } from '@nucleo/data/marketing';
import { anclaDeMarca, aRelativo, caminoDeTrazo, empezarMarca, marcadosDelArchivo, moverMarca, terminarMarca } from '@nucleo/utils/marcasDeDiseno';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import Segmentos from '../componentes/Segmentos';
import Avatar from '../componentes/Avatar';
import Tocable from '../componentes/Tocable';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';
import { piezaElegida } from '../componentes/marketing/elegida';

const HERRAMIENTAS = [
  { id: 'mover', label: 'Mover' },
  { id: 'punto', label: 'Punto' },
  { id: 'recuadro', label: 'Recuadro' },
  { id: 'trazo', label: 'Lápiz' },
];
const AYUDA = {
  mover: 'Pellizca para acercar y arrastra para moverte por el diseño.',
  punto: 'Toca el sitio exacto del diseño.',
  recuadro: 'Arrastra para encerrar la zona.',
  trazo: 'Dibuja encima con el dedo.',
};

// Las marcas sobre la imagen, en píxeles de la caja `ancho × alto`.
function MarcasEnImagen({ marcas, borrador, resaltada, ancho, alto }) {
  const todas = [...marcas, ...(borrador ? [{ ...borrador, numero: '+' }] : [])];
  const r = Math.max(4, ancho * 0.016);
  const letra = Math.max(12, ancho * 0.034);
  return (
    <Svg width={ancho} height={alto} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      {todas.map((m, i) => {
        const op = resaltada == null || resaltada === m.numero ? 1 : 0.35;
        const [ax, ay] = anclaDeMarca(m);
        const rotulo = (
          <SvgText x={ax * ancho + r + 2} y={ay * alto - r} fontSize={letra} fontWeight="700" fill={MARCA.rojo}
            stroke="#FFFFFF" strokeWidth={2.5} paintOrder="stroke">{String(m.numero)}</SvgText>
        );
        if (m.tipo === 'recuadro') {
          return (
            <G key={i} opacity={op}>
              <Rect x={m.x * ancho} y={m.y * alto} width={m.w * ancho} height={m.h * alto} fill="none" stroke={MARCA.rojo} strokeWidth={2.5} />
              {rotulo}
            </G>
          );
        }
        if (m.tipo === 'trazo' && m.puntos?.length) {
          return (
            <G key={i} opacity={op}>
              <Path d={caminoDeTrazo(m.puntos, ancho, alto)} fill="none" stroke={MARCA.rojo} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              {rotulo}
            </G>
          );
        }
        return (
          <G key={i} opacity={op}>
            <Circle cx={m.x * ancho} cy={m.y * alto} r={r} fill={MARCA.rojo} stroke="#FFFFFF" strokeWidth={1.5} />
            {rotulo}
          </G>
        );
      })}
    </Svg>
  );
}

export default function AnotarDiseno() {
  const { archivo: archivoId, resaltar } = useLocalSearchParams();
  const { hasPermission, user } = useAuth();
  const puedeResolver = hasPermission('marketing', 'can_edit') || hasPermission('marketing', 'can_approve');
  const yoId = user?.id;
  const abierta = piezaElegida();
  const pieza = abierta?.pieza ?? null;
  const mes = abierta?.mes ?? null;
  const archivo = (pieza?.archivos || []).find((a) => String(a.id) === String(archivoId)) ?? null;
  const src = archivo ? abierta?.firmas?.get?.(archivo.url) : null;

  const { width, height } = useWindowDimensions();
  const [proporcion, setProporcion] = useState(archivo?.ancho && archivo?.alto ? archivo.alto / archivo.ancho : null);
  const [herramienta, setHerramienta] = useState('punto');
  const [borrador, setBorrador] = useState(null);
  const [texto, setTexto] = useState('');
  const [comentarios, setComentarios] = useState(null);
  const [personas, setPersonas] = useState({});
  const [resaltada, setResaltada] = useState(resaltar ? Number(resaltar) : null);
  const [ocupado, setOcupado] = useState(false);
  // Mientras el dedo dibuja, la página no se desplaza (si no, el trazo se la lleva).
  const [dibujando, setDibujando] = useState(false);
  const origen = useRef(null);

  // Si la base no trae las medidas, se miden de la imagen.
  useEffect(() => {
    if (proporcion || !src) return;
    Image.getSize(src, (w, h) => setProporcion(h / w), () => setProporcion(1));
  }, [proporcion, src]);

  const cargar = useCallback(async () => {
    if (!mes?.id) return;
    try {
      const c = await fetchComentarios(mes.id);
      setComentarios(c || []);
      setPersonas(await fetchPersonas((c || []).map((x) => x.autor_id)));
    } catch { setComentarios([]); }
  }, [mes?.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const marcados = useMemo(() => marcadosDelArchivo(comentarios, archivo?.id), [comentarios, archivo?.id]);
  const marcas = useMemo(() => marcados.map((c) => ({ ...c.marca, numero: c.numero })), [marcados]);

  // La caja de la imagen: cabe a lo ancho y en el 55 % del alto de la pantalla.
  const alto0 = height * 0.55;
  const ancho0 = width - 32;
  const caja = useMemo(() => {
    const p = proporcion || 1;
    const w = Math.min(ancho0, alto0 / p);
    return { ancho: w, alto: w * p };
  }, [proporcion, ancho0, alto0]);

  const marcando = herramienta !== 'mover';
  const relativo = (e) => aRelativo(e.nativeEvent.locationX, e.nativeEvent.locationY, caja.ancho, caja.alto);
  const tocar = (e) => {
    const [x, y] = relativo(e);
    origen.current = herramienta === 'punto' ? null : [x, y];
    setBorrador(empezarMarca(herramienta, x, y));
    setDibujando(true);
    Haptics.selectionAsync().catch(() => {});
  };
  const arrastrar = (e) => {
    if (!origen.current) return;
    const [x, y] = relativo(e);
    const o = origen.current;
    setBorrador((b) => moverMarca(b, o, x, y));
  };
  const soltar = () => { origen.current = null; setDibujando(false); setBorrador((b) => terminarMarca(b)); };

  const correr = async (fn, exito) => {
    setOcupado(true);
    try {
      await fn();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(exito, archivo?.nombre || pieza?.titulo || '');
      await cargar();
    } catch (e) {
      fallo('No se pudo completar', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally { setOcupado(false); }
  };
  const enviar = () => {
    const v = texto.trim();
    if (!borrador || !v) return;
    correr(async () => {
      await comentar({ mesId: mes.id, piezaId: pieza.id, texto: v, autorId: yoId, archivoId: archivo.id, marca: borrador });
      setBorrador(null);
      setTexto('');
    }, 'Comentario enviado');
  };
  const quitar = (c) => Alert.alert('Quitar el comentario', 'Se borra la marca y su comentario para todos.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', style: 'destructive', onPress: () => correr(() => quitarComentario(c.id), 'Comentario quitado') },
  ]);

  if (!archivo || !mes) {
    return <View style={{ margin: 16 }}><Aviso tono="freno" texto="No se encontró el diseño. Vuelve a abrirlo desde la pieza." /></View>;
  }
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: `Comentar el diseño${archivo.version > 1 ? ` · V${archivo.version}` : ''}` }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40, gap: 12 }}
          scrollEnabled={!dibujando}>
          <Segmentos opciones={HERRAMIENTAS} activa={herramienta} onCambiar={(v) => { setHerramienta(v); setBorrador(null); }} />
          <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>{AYUDA[herramienta]}</Text>

          <View style={{ height: alto0, marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', backgroundColor: colorSistema.separador }}>
            {!src ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View> : (
              <ScrollView maximumZoomScale={5} minimumZoomScale={1} bouncesZoom centerContent scrollEnabled={!marcando}
                showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
                contentContainerStyle={{ minWidth: ancho0, minHeight: alto0, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: caja.ancho, height: caja.alto }}
                  onStartShouldSetResponder={() => marcando} onMoveShouldSetResponder={() => marcando}
                  onResponderTerminationRequest={() => false}
                  onResponderGrant={tocar} onResponderMove={arrastrar} onResponderRelease={soltar} onResponderTerminate={soltar}>
                  <Image source={{ uri: src }} style={{ width: caja.ancho, height: caja.alto }} resizeMode="contain" accessibilityLabel={archivo.nombre || 'Diseño'} />
                  <MarcasEnImagen marcas={marcas} borrador={borrador} resaltada={resaltada} ancho={caja.ancho} alto={caja.alto} />
                </View>
              </ScrollView>
            )}
          </View>

          <View style={{ marginHorizontal: 16, gap: 10 }}>
            <Campo value={texto} onChangeText={setTexto} multiline maxLength={2000}
              placeholder={borrador ? 'Qué hay que cambiar ahí. Ej. este precio va en $4.99' : 'Primero marca el diseño'} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {borrador ? <View style={{ flex: 1 }}><BotonGrande texto="Borrar la marca" borde onPress={() => setBorrador(null)} /></View> : null}
              <View style={{ flex: 1 }}><BotonGrande texto="Comentar" onPress={enviar} deshabilitado={ocupado || !borrador || !texto.trim()} /></View>
            </View>
          </View>

          <Seccion titulo={`Marcas en este diseño${marcados.length ? ` · ${marcados.length}` : ''}`}>
            {comentarios == null ? <ActivityIndicator /> : marcados.length ? marcados.map((c, i) => {
              const p = personas[c.autor_id];
              const activa = resaltada === c.numero;
              return (
                <Tocable key={c.id} onPress={() => setResaltada((r) => (r === c.numero ? null : c.numero))}
                  accessibilityRole="button" accessibilityState={{ selected: activa }}
                  style={{ gap: 4, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '800', width: 22 }}>{c.numero}</Text>
                    <Avatar empleado={p || { id: c.autor_id, name: '?' }} tamano={22} />
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{p?.name ? shortEmployeeName(p.name) : '—'}</Text>
                    {c.resuelto ? <Text style={{ color: MARCA.verde, fontSize: 12, fontWeight: '700' }}>Resuelto</Text> : null}
                  </View>
                  <Text style={{ color: c.resuelto ? colorSistema.texto2 : colorSistema.texto, fontSize: 14, marginLeft: 30,
                    textDecorationLine: c.resuelto ? 'line-through' : 'none' }}>{c.texto}</Text>
                  <View style={{ flexDirection: 'row', gap: 16, marginLeft: 30 }}>
                    {puedeResolver ? (
                      <Tocable onPress={() => correr(() => marcarResuelto(c.id, !c.resuelto), c.resuelto ? 'Reabierto' : 'Resuelto')} hitSlop={6}>
                        <Text style={{ color: c.resuelto ? MARCA.ambar : MARCA.verde, fontSize: 13, fontWeight: '700' }}>{c.resuelto ? 'Reabrir' : 'Marcar resuelto'}</Text>
                      </Tocable>
                    ) : null}
                    {c.autor_id === yoId && c.tipo === 'comentario' ? (
                      <Tocable onPress={() => quitar(c)} hitSlop={6}><Text style={{ color: MARCA.rojo, fontSize: 13, fontWeight: '600' }}>Quitar</Text></Tocable>
                    ) : null}
                  </View>
                </Tocable>
              );
            }) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin marcas en este diseño.</Text>}
          </Seccion>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
