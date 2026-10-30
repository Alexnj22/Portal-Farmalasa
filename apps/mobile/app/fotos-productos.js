// Fotos de productos, NATIVO — la cola del portal (`FotosProductosView`) para
// completar la foto y el principio activo del catálogo, uno detrás de otro.
//
// Es la pantalla que más sentido tiene en el teléfono: quien la usa tiene el
// producto en la mano. La pantalla pone el siguiente (los que más se venden
// primero), abrirlo lo TOMA por 15 minutos para que otra persona no haga el
// mismo, y «Guardar y siguiente» sube la foto y los principios juntos.
//
// La foto se sube recién al guardar —saltar no deja archivos sueltos— y sale
// igual que en `componentes/producto/Foto.js`: cuadrada, 800 px, JPEG, pisando
// `product-photos/<id>.jpg`. La cola, la toma y el guardado son del núcleo
// (`@nucleo/data/fotosProductos`), los mismos del portal.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { PRINCIPIO_PRESETS, editorDePrincipios, principiosParaGuardar } from '@nucleo/utils/edicionDeProducto';
import { subirArchivo } from '@nucleo/utils/storageFiles';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { buscarParaCarga, fetchColaDeCarga, fetchResumenDeCarga, guardarCarga, tomarProducto } from '@nucleo/data/fotosProductos';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const FALTAS = [
  { id: 'cualquiera', label: 'Todo' },
  { id: 'foto', label: 'Sin foto' },
  { id: 'principio', label: 'Sin principio' },
];

async function elegir(desdeCamara) {
  const permiso = desdeCamara ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) {
    Alert.alert('Sin permiso', desdeCamara ? 'La app necesita la cámara para tomar la foto.' : 'La app necesita tus fotos para elegir una.');
    return null;
  }
  const op = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
  const r = desdeCamara ? await ImagePicker.launchCameraAsync(op) : await ImagePicker.launchImageLibraryAsync(op);
  if (r.canceled || !r.assets?.[0]) return null;
  const ref = await ImageManipulator.manipulate(r.assets[0].uri).resize({ width: 800 }).renderAsync();
  const hecha = await ref.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
  return hecha.uri;
}

// iPhone: la hoja de acciones del sistema; Android: el diálogo de Material.
const preguntar = () => new Promise((resolve) => {
  const tomar = async (i) => { try { resolve(i === 2 ? null : await elegir(i === 0)); } catch (e) { fallo('No se pudo leer la imagen', mensajeAmigable(e)); resolve(null); } };
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions({ options: ['Tomar foto', 'Elegir de la galería', 'Cancelar'], cancelButtonIndex: 2 }, tomar);
  } else {
    Alert.alert('Foto', '', [{ text: 'Tomar foto', onPress: () => tomar(0) }, { text: 'Elegir de la galería', onPress: () => tomar(1) }, { text: 'Cancelar', style: 'cancel', onPress: () => tomar(2) }]);
  }
});

export default function FotosProductos() {
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('fotos_productos', 'can_edit') || hasPermission('productos', 'can_edit');
  const [falta, setFalta] = useState('cualquiera');
  const [cola, setCola] = useState(null);
  const [elegido, setElegido] = useState(null);
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState(null);
  const [resumen, setResumen] = useState(null);
  const saltados = useRef(new Set());
  const espera = useRef(null);

  const cargarResumen = useCallback(() => { fetchResumenDeCarga().then(setResumen).catch(() => {}); }, []);
  const cargarCola = useCallback(async () => {
    try {
      const filas = await fetchColaDeCarga({ falta, limite: 60 + saltados.current.size });
      setCola(filas.filter((f) => !saltados.current.has(f.id)));
    } catch (e) { setCola([]); fallo('No se pudo cargar la lista', mensajeAmigable(e)); }
  }, [falta]);
  useEffect(() => { setCola(null); cargarCola(); }, [cargarCola]);
  useEffect(() => { cargarResumen(); }, [cargarResumen]);
  useEffect(() => () => clearTimeout(espera.current), []);

  const buscar = (t) => {
    setQ(t);
    clearTimeout(espera.current);
    if (t.trim().length < 2) { setResultados(null); return; }
    espera.current = setTimeout(() => {
      buscarParaCarga(t.trim()).then(setResultados).catch((e) => { setResultados([]); fallo('No se pudo buscar', mensajeAmigable(e)); });
    }, 350);
  };

  const actual = elegido ?? cola?.[0] ?? null;

  const pasar = (id, saltar = false) => {
    if (saltar) saltados.current.add(id);
    if (elegido?.id === id) { setElegido(null); return; }
    setCola((prev) => {
      const resto = (prev || []).filter((f) => f.id !== id);
      if (resto.length < 5) setTimeout(cargarCola, 0);
      return resto;
    });
  };

  useEffect(() => {
    if (!actual || !puedeEditar) return undefined;
    let vivo = true;
    tomarProducto(actual.id).then((r) => {
      if (!vivo || r?.ok) return;
      Alert.alert('Ya lo están trabajando', `${shortEmployeeName(r?.tomado_por)} tiene abierto este producto. Pasamos al siguiente.`);
      pasar(actual.id, true);
    }).catch(() => {});
    return () => { vivo = false; };
  }, [actual?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hoy = (resumen?.personas ?? []).reduce((s, p) => s + p.fotos_hoy + p.principios_hoy, 0);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Fotos de productos' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>
          {resumen ? `Faltan ${resumen.faltan_foto} fotos y ${resumen.faltan_principio} principios · hoy el equipo completó ${hoy}` : 'Cargando…'}
        </Text>
        <Segmentos opciones={FALTAS} activa={falta} onCambiar={(v) => { setElegido(null); setFalta(v); }} />
        <Campo multiline={false} value={q} onChangeText={buscar} placeholder="Buscar un producto o su código" autoCorrect={false} returnKeyType="search" />
        {resultados ? (
          <Seccion titulo={resultados.length ? 'Elige el producto' : 'Sin resultados'}>
            {resultados.map((r, i) => (
              <Pressable key={r.id} onPress={() => { setElegido(r); setResultados(null); setQ(''); }}
                style={({ pressed }) => ({ minHeight: 44, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{r.nombre}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[r.laboratorio, r.principio_activo].filter(Boolean).join(' · ') || 'Sin principio activo'}</Text>
              </Pressable>
            ))}
          </Seccion>
        ) : null}
        {!puedeEditar ? <Aviso tono="freno" texto="Puedes ver la lista, pero no tienes permiso para guardar fotos ni principios." /> : null}
        {cola == null && !elegido ? <ActivityIndicator style={{ marginTop: 24 }} /> : actual ? (
          <Ficha key={actual.id} producto={actual} puedeEditar={puedeEditar} quedan={elegido ? null : cola.length}
            onGuardado={() => { cargarResumen(); pasar(actual.id); }} onSaltar={() => pasar(actual.id, true)} />
        ) : (
          <Aviso texto={saltados.current.size ? 'Sin productos pendientes; los que saltaste vuelven al recargar.' : 'Sin productos pendientes en esta lista.'} />
        )}
        {!actual && saltados.current.size ? (
          <BotonGrande texto="Volver a los saltados" color={MARCA.azulClaro} onPress={() => { saltados.current = new Set(); setCola(null); cargarCola(); }} />
        ) : null}
      </ScrollView>
    </>
  );
}

function Ficha({ producto, puedeEditar, quedan, onGuardado, onSaltar }) {
  const [foto, setFoto] = useState(null);           // uri local, todavía sin subir
  const [ed, setEd] = useState(() => editorDePrincipios(producto.principios || []));
  const [toco, setToco] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const cambiar = (fn) => { setToco(true); setEd(fn); };
  const set = (i, campo, v) => cambiar((e) => ({ ...e, items: e.items.map((p, j) => (j === i ? { ...p, [campo]: v } : p)) }));

  const principios = toco ? principiosParaGuardar(producto.id, ed) : null;
  const validos = principios && principios.rows.length ? principios : null;
  const hayCambios = !!foto || !!validos;

  const guardar = async () => {
    if (!hayCambios || guardando) return;
    setGuardando(true);
    trabajando('Guardando…');
    try {
      let fotoUrl = null;
      if (foto) {
        const datos = await (await fetch(foto)).arrayBuffer();
        const publica = await subirArchivo('product-photos', `${producto.id}.jpg`, datos, { upsert: true, contentType: 'image/jpeg' });
        fotoUrl = `${publica}?t=${Date.now()}`;
      }
      await guardarCarga(producto.id, { fotoUrl, principios: validos }, { producto: producto.nombre, desde: 'app' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo('Guardado', producto.nombre);
      onGuardado();
    } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); } finally { setGuardando(false); }
  };

  const vista = foto || producto.foto_url;
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4, marginHorizontal: 4 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{producto.nombre}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
          {[producto.laboratorio, producto.codigo_barras && `Código ${producto.codigo_barras}`, quedan != null && `${quedan} en la lista`].filter(Boolean).join(' · ')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
          {producto.falta_foto ? <Pildora texto="Sin foto" color={MARCA.ambar} /> : null}
          {producto.falta_principio ? <Pildora texto="Sin principio" color={MARCA.violetaClaro} /> : null}
        </View>
      </View>

      <View style={{ alignItems: 'center', gap: 8 }}>
        <Pressable disabled={!puedeEditar} onPress={async () => { Haptics.selectionAsync().catch(() => {}); const u = await preguntar(); if (u) setFoto(u); }}
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <View style={{ width: 220, height: 220, borderRadius: 24, overflow: 'hidden', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
            borderWidth: vista ? 0 : 1.5, borderStyle: 'dashed', borderColor: colorSistema.separador }}>
            {vista ? <Image source={{ uri: vista }} style={{ width: '100%', height: '100%' }} resizeMode="contain" /> : (
              <Text style={{ color: '#8a8a8a', fontSize: 15, fontWeight: '600' }}>{puedeEditar ? 'Tomar foto' : 'Sin foto'}</Text>
            )}
          </View>
        </Pressable>
        {foto ? (
          <Pressable onPress={() => setFoto(null)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
            <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600' }}>Descartar la foto nueva</Text>
          </Pressable>
        ) : null}
      </View>

      <Seccion titulo="No es un medicamento">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {PRINCIPIO_PRESETS.map((p) => (
            <Pressable key={p} disabled={!puedeEditar} onPress={() => cambiar((e) => (e.preset === p ? editorDePrincipios([]) : { preset: p, items: [] }))}
              style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: ed.preset === p ? MARCA.violetaClaro : 'rgba(127,127,127,0.16)' }}>
              <Text style={{ color: ed.preset === p ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{p}</Text>
            </Pressable>
          ))}
        </View>
      </Seccion>
      {!ed.preset ? (
        <Seccion titulo="Principio activo" pie="Como dice el empaque: el principio y su concentración.">
          {ed.items.map((p, i) => (
            <View key={p._key} style={{ gap: 6, paddingVertical: 4, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <Campo multiline={false} editable={puedeEditar} value={p.nombre} onChangeText={(t) => set(i, 'nombre', t)} placeholder="Nombre (ej. Amoxicilina)" />
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <View style={{ flex: 1 }}><Campo multiline={false} editable={puedeEditar} value={p.concentracion ?? ''} onChangeText={(t) => set(i, 'concentracion', t)} placeholder="Concentración (ej. 500mg)" /></View>
                {ed.items.length > 1 ? (
                  <Pressable hitSlop={8} onPress={() => cambiar((e) => ({ ...e, items: e.items.filter((_, j) => j !== i) }))} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Quitar</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
          {puedeEditar ? (
            <Pressable onPress={() => cambiar((e) => ({ ...e, items: [...e.items, { nombre: '', concentracion: '', orden: e.items.length, _key: Date.now() }] }))} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Agregar otro principio</Text>
            </Pressable>
          ) : null}
        </Seccion>
      ) : null}

      {puedeEditar ? (
        <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar y siguiente'} color={MARCA.verde} deshabilitado={!hayCambios || guardando} onPress={guardar} />
      ) : null}
      <Pressable onPress={onSaltar} disabled={guardando} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '600' }}>Saltar</Text>
      </Pressable>
    </View>
  );
}
