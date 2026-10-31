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
import { revisarCalidad } from '@nucleo/utils/calidadDeFoto';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { buscarParaCarga, fetchColaDeCarga, fetchNombresDePrincipios, fetchResumenDeCarga, guardarCarga, tomarProducto } from '@nucleo/data/fotosProductos';
import { buscarEnSrsParaProducto } from '@nucleo/data/srs';
import { resultadoDeSrs } from '@nucleo/utils/srs';
import { SRS_AUTO_MIN, decidirSrs, principiosDeSrs } from '@nucleo/utils/enriquecerSrs';
import {
  UNIDADES, claveDePrincipio, corregirConElNombre, escribirConcentracion, leerConcentracion, normalizarConcentracion, normalizarPrincipio,
} from '@nucleo/utils/concentracion';
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
  // La misma regla que el portal (utils/calidadDeFoto): una miniatura no se guarda.
  const { width = 0, height = 0 } = r.assets[0];
  const problemas = revisarCalidad({ ancho: width, alto: height });
  const grave = problemas.find((p) => p.bloquea);
  if (grave) { Alert.alert('Foto muy pequeña', grave.texto); return null; }
  if (problemas[0]) Alert.alert('Foto algo pequeña', problemas[0].texto);
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

  const [nombres, setNombres] = useState([]);
  const cargarResumen = useCallback(() => { fetchResumenDeCarga().then(setResumen).catch(() => {}); }, []);
  // Los principios del catálogo, para elegir en vez de escribir (una vez por visita).
  useEffect(() => { fetchNombresDePrincipios().then(setNombres).catch(() => {}); }, []);
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

  // Productos, no cambios: un producto con foto y principio cuenta UNO.
  const hoy = (resumen?.personas ?? []).reduce((s, p) => s + (p.productos_hoy ?? p.fotos_hoy + p.principios_hoy), 0);

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
          <Ficha key={actual.id} producto={actual} puedeEditar={puedeEditar} nombres={nombres} quedan={elegido ? null : cola.length}
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

function Ficha({ producto, puedeEditar, nombres, quedan, onGuardado, onSaltar }) {
  const [foto, setFoto] = useState(null);           // uri local, todavía sin subir
  // Cada principio: nombre, cantidad y unidad por separado (como el portal).
  const [ed, setEd] = useState(() => { const e = editorDePrincipios(producto.principios || []); return { ...e, items: e.items.map(aRenglon) }; });
  const [toco, setToco] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [deSrs, setDeSrs] = useState(null);
  const [enfocado, setEnfocado] = useState(null);   // renglón cuyo nombre se está escribiendo
  const cambiar = (fn) => { setToco(true); setEd(fn); };
  const set = (i, campo, v) => cambiar((e) => ({ ...e, items: e.items.map((p, j) => (j === i ? { ...p, [campo]: v } : p)) }));

  const usarSrs = useCallback((crudo) => {
    const lista = principiosDeSrs(crudo);
    if (!lista.length) { Alert.alert('Registro sanitario', 'Ese registro no trae principio activo.'); return; }
    // El registro a veces trae otro número que el empaque (F064815112006: «…20MG» con «21 mg.»).
    const corregido = lista.length === 1 ? corregirConElNombre(lista[0].concentracion, producto.nombre) : null;
    setToco(true);
    setEd({ preset: null, items: (corregido ? [{ ...lista[0], concentracion: corregido }] : lista).map(aRenglon) });
    setDeSrs({ ...resultadoDeSrs(crudo), corregido: corregido && { srs: normalizarConcentracion(lista[0].concentracion), nombre: corregido } });
  }, [producto.nombre]);

  const principios = toco
    ? principiosParaGuardar(producto.id, { preset: ed.preset, items: ed.items.map((it) => ({ nombre: it.nombre, concentracion: escribirConcentracion(it.cantidad, it.unidad) ?? it.crudo })) })
    : null;
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
            <Pressable key={p} disabled={!puedeEditar} onPress={() => { setDeSrs(null); cambiar((e) => (e.preset === p ? { preset: null, items: [renglonVacio()] } : { preset: p, items: [] })); }}
              style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: ed.preset === p ? MARCA.violetaClaro : 'rgba(127,127,127,0.16)' }}>
              <Text style={{ color: ed.preset === p ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{p}</Text>
            </Pressable>
          ))}
        </View>
      </Seccion>
      {!ed.preset ? (
        <Seccion titulo="Principio activo" pie={principios?.text ? `Quedará: ${principios.text}` : 'Elige el principio del catálogo; la cantidad y la unidad, como dice el empaque.'}>
          {ed.items.map((p, i) => {
            const sugeridos = enfocado === i && p.nombre.trim().length >= 2
              ? nombres.filter((n) => claveDePrincipio(n).includes(claveDePrincipio(p.nombre)) && n !== p.nombre).slice(0, 5) : [];
            return (
              <View key={p._key} style={{ gap: 8, paddingVertical: 6, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <Campo multiline={false} editable={puedeEditar} value={p.nombre} autoCapitalize="characters" autoCorrect={false}
                  onFocus={() => setEnfocado(i)} onBlur={() => { setEnfocado(null); if (p.nombre) set(i, 'nombre', normalizarPrincipio(p.nombre)); }}
                  onChangeText={(t) => set(i, 'nombre', t)} placeholder="Principio (ej. AMOXICILINA)" />
                {sugeridos.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {sugeridos.map((n) => (
                      <Pressable key={n} onPress={() => { set(i, 'nombre', n); setEnfocado(null); }}
                        style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.16)', opacity: pressed ? 0.6 : 1 })}>
                        <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{n}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <View style={{ width: 96 }}>
                    <Campo multiline={false} editable={puedeEditar} value={p.cantidad} keyboardType="decimal-pad" textAlign="center"
                      onChangeText={(t) => set(i, 'cantidad', t.replace(/[^\d.,]/g, ''))} placeholder="500" />
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: 'center' }} style={{ flex: 1 }}>
                    {UNIDADES.map((u) => (
                      <Pressable key={u} disabled={!puedeEditar} onPress={() => set(i, 'unidad', u)}
                        style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: 20, justifyContent: 'center', backgroundColor: p.unidad === u ? MARCA.azulClaro : 'rgba(127,127,127,0.16)' }}>
                        <Text style={{ color: p.unidad === u ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{u}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
                {p.crudo && !p.cantidad ? <Aviso tono="cuidado" texto={`Estaba escrito «${p.crudo}»: pon la cantidad y la unidad para corregirlo.`} /> : null}
                {ed.items.length > 1 ? (
                  <Pressable hitSlop={8} onPress={() => cambiar((e) => ({ ...e, items: e.items.filter((_, j) => j !== i) }))} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Quitar este principio</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          {puedeEditar ? (
            <Pressable onPress={() => cambiar((e) => ({ ...e, items: [...e.items, renglonVacio()] }))} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Agregar otro principio</Text>
            </Pressable>
          ) : null}
        </Seccion>
      ) : null}
      {deSrs && !ed.preset ? <Aviso texto={`Tomado del registro ${deSrs.noregistro || 'sanitario'} (${deSrs.nombre}). Revísalo contra el empaque antes de guardar.`} /> : null}
      {deSrs?.corregido && !ed.preset ? (
        <Aviso tono="cuidado" texto={`El registro dice ${deSrs.corregido.srs}, pero el nombre del producto dice ${deSrs.corregido.nombre}: se dejó ${deSrs.corregido.nombre}. Confírmalo en el empaque.`} />
      ) : null}
      <SugerenciasSrs producto={producto} onUsar={usarSrs} autoAplicar={puedeEditar && producto.falta_principio && !toco} />

      {puedeEditar ? (
        <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar y siguiente'} color={MARCA.verde} deshabilitado={!hayCambios || guardando} onPress={guardar} />
      ) : null}
      <Pressable onPress={onSaltar} disabled={guardando} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '600' }}>Saltar</Text>
      </Pressable>
    </View>
  );
}

// ── Un renglón del principio (la misma forma que el portal) ─────────────────
const renglonVacio = () => ({ nombre: '', cantidad: '', unidad: 'mg', crudo: null, _key: `n-${Date.now()}-${Math.random()}` });
function aRenglon(p, i = 0) {
  const l = leerConcentracion(p.concentracion);
  return {
    nombre: p.nombre ? normalizarPrincipio(p.nombre) : '',
    cantidad: l.cantidad, unidad: l.unidad || (l.cantidad ? '' : 'mg'), crudo: l.crudo,
    _key: p._key ?? `r-${Date.now()}-${i}`,
  };
}

// ── Lo que dice el registro sanitario de este producto ──────────────────────
// Las mismas búsquedas y el mismo parecido que el portal (`decidirSrs`): hasta
// tres coincidencias con «Usar». Si el producto no tenía principio y la mejor
// pasa el 70%, queda escrita — nunca se guarda sola.
function SugerenciasSrs({ producto, onUsar, autoAplicar }) {
  const [estado, setEstado] = useState({ cargando: true, lista: [] });
  const aplicada = useRef(false);
  useEffect(() => {
    let vivo = true;
    buscarEnSrsParaProducto({ nombre: producto.nombre, laboratorios: { nombre: producto.laboratorio } })
      .then((json) => {
        if (!vivo) return;
        const d = decidirSrs({ nombre: producto.nombre }, json.data || []);
        const lista = (d.entrada?.candidates || []).filter((c) => principiosDeSrs(c.srs).length);
        setEstado({ cargando: false, lista });
        if (d.tipo === 'auto' && autoAplicar && !aplicada.current && lista[0]) { aplicada.current = true; onUsar(lista[0].srs); }
      })
      .catch(() => { if (vivo) setEstado({ cargando: false, lista: [], error: true }); });
    return () => { vivo = false; };
  }, [producto.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Seccion titulo="Registro sanitario" pie={estado.error ? 'No se pudo consultar el registro.' : !estado.cargando && !estado.lista.length ? 'Sin coincidencias con principio activo: escríbelo del empaque.' : null}>
      {estado.cargando ? <ActivityIndicator style={{ marginVertical: 8 }} /> : estado.lista.map(({ srs, score }, i) => {
        const r = resultadoDeSrs(srs);
        const titulo = principiosDeSrs(srs).map((p) => [normalizarPrincipio(p.nombre), normalizarConcentracion(p.concentracion)].filter(Boolean).join(' ')).join(' + ');
        return (
          <Pressable key={`${r.noregistro}-${i}`} onPress={() => onUsar(srs)}
            style={({ pressed }) => ({ minHeight: 52, paddingVertical: 6, gap: 2, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{titulo}</Text>
              <Pildora texto={`${Math.round(score * 100)}%`} color={score >= SRS_AUTO_MIN ? MARCA.verde : colorSistema.texto2} />
            </View>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={2}>{[r.nombre, r.titular, r.noregistro].filter(Boolean).join(' · ')}</Text>
            <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Usar</Text>
          </Pressable>
        );
      })}
    </Seccion>
  );
}
