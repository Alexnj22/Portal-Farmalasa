// El cuadro para responder, NATIVO — el `Compositor` del portal: texto, una
// foto (cámara o galería, reducida a 1600 px en JPEG), una respuesta rápida
// guardada (compartidas por todo el equipo: guardar y borrar), o un producto /
// una oferta vigente que el cliente puede tocar en su app. Mismas funciones del
// portal (`data/chatClientes`). Enviar no pide confirmación, igual que el portal.
//
// Desde el 2026-10-21 el envío lo hace la pantalla del hilo (`onEnviar`): el
// globo aparece al tocar y acá el cuadro se vacía sin esperar a la red, como en
// la app de puntos. Con el cuadro vacío, el botón es un micrófono (`Voz.js`).
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  borrarRespuestaRapida, fetchOfertasVigentes, fetchRespuestasRapidas, guardarRespuestaRapida, marcarEscribiendo,
} from '@nucleo/data/chatClientes';
import { preciosDeProducto } from '@nucleo/data/reservas';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { nombreDeAutor, recorteDeMensaje } from '@nucleo/utils/chatClientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import Tocable from '../Tocable';
import ConAurora from '../ConAurora';
import BuscadorProducto from '../compras/BuscadorProducto';
import { MARCA } from '../inicio/marca';
import { iconoDe } from '../../tema/iconos';
import { fallo, listo } from '../Progreso';
import { Grabadora, HAY_AUDIO, permisoMicrofono } from './Voz';

// «Está escribiendo» vale 6 s en la base; se renueva a lo sumo cada 3 s (igual que el portal).
const CADA_CUANTO_ESCRIBIENDO_MS = 3_000;

function BotonIcono({ icono, etiqueta, onPress, color = colorSistema.texto2 }) {
  return (
    <Tocable onPress={onPress} accessibilityRole="button" accessibilityLabel={etiqueta} hitSlop={6}
      style={{ width: 40, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
      <Host matchContents><Icon name={iconoDe(icono)} size={20} color={color} /></Host>
    </Tocable>
  );
}

function Hoja({ titulo, abierta, onCerrar, children }) {
  return (
    <Modal visible={abierta} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: Platform.OS === 'ios' ? 20 : 16 }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{titulo}</Text>
          <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </ConAurora>
    </Modal>
  );
}

function RespuestasRapidas({ abierta, textoActual, onCerrar, onElegir }) {
  const { user } = useAuth();
  const [filas, setFilas] = useState(null);
  const [busca, setBusca] = useState('');
  const [titulo, setTitulo] = useState('');
  const [nuevo, setNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const cargar = () => Promise.resolve(fetchRespuestasRapidas()).then(setFilas).catch((e) => { setFilas([]); fallo('No se pudieron cargar', mensajeAmigable(e)); });
  useEffect(() => { if (abierta) { setNuevo(textoActual ?? ''); setTitulo(''); setBusca(''); cargar(); } }, [abierta]); // eslint-disable-line react-hooks/exhaustive-deps -- al abrir la hoja
  const guardar = async () => {
    setGuardando(true);
    try { await guardarRespuestaRapida({ titulo, texto: nuevo }, user?.id); setTitulo(''); setNuevo(''); listo('Respuesta guardada', 'Ya la puede usar todo el equipo.'); cargar(); }
    catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); }
    finally { setGuardando(false); }
  };
  const borrar = (r) => Alert.alert('¿Borrar la respuesta?', `«${r.titulo}» deja de estar disponible para todo el equipo.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Borrar', style: 'destructive', onPress: () => Promise.resolve(borrarRespuestaRapida(r.id)).then(cargar).catch((e) => fallo('No se pudo borrar', mensajeAmigable(e))) },
  ]);
  const visibles = (filas ?? []).filter((r) => !busca || tokenMatch(busca, r.titulo, r.texto));
  return (
    <Hoja titulo="Respuestas rápidas" abierta={abierta} onCerrar={onCerrar}>
      <Campo multiline={false} value={busca} onChangeText={setBusca} placeholder="Buscar respuesta…" />
      {filas == null ? <ActivityIndicator /> : !visibles.length ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{busca ? 'Sin resultados.' : 'Todavía no hay respuestas. Guarda abajo las que el equipo escribe seguido.'}</Text>
      ) : visibles.map((r) => (
        <Tocable key={r.id} onPress={() => onElegir(r.texto)} onLongPress={() => borrar(r)} accessibilityRole="button" accessibilityHint="Mantén presionado para borrarla"
          style={{ padding: 12, borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.12)', gap: 2 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{r.titulo}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={3}>{r.texto}</Text>
        </Tocable>
      ))}
      <Seccion titulo="Guardar una respuesta nueva" pie="Mantén presionada una respuesta para borrarla.">
        <Campo multiline={false} maxLength={60} value={titulo} onChangeText={setTitulo} placeholder="Título" />
        <Campo maxLength={1000} value={nuevo} onChangeText={setNuevo} placeholder="Texto" />
      </Seccion>
      <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar respuesta'} deshabilitado={guardando || !titulo.trim() || !nuevo.trim()} onPress={guardar} />
    </Hoja>
  );
}

function ElegirOferta({ abierta, onCerrar, onElegir }) {
  const [ofertas, setOfertas] = useState(null);
  const [busca, setBusca] = useState('');
  useEffect(() => {
    if (!abierta) return undefined;
    let vivo = true;
    Promise.resolve(fetchOfertasVigentes(hoySV())).then((o) => { if (vivo) setOfertas(o); })
      .catch((e) => { if (vivo) { setOfertas([]); fallo('No se pudieron cargar las ofertas', mensajeAmigable(e)); } });
    return () => { vivo = false; };
  }, [abierta]);
  const visibles = (ofertas ?? []).filter((o) => !busca || tokenMatch(busca, o.titulo, o.etiqueta ?? ''));
  return (
    <Hoja titulo="Enviar una oferta" abierta={abierta} onCerrar={onCerrar}>
      <Campo multiline={false} value={busca} onChangeText={setBusca} placeholder="Buscar oferta…" />
      {ofertas == null ? <ActivityIndicator /> : !visibles.length ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin ofertas vigentes. Sólo se pueden enviar las que el cliente ve hoy en la app.</Text>
      ) : visibles.map((o) => (
        <Tocable key={o.id} onPress={() => onElegir({ tipo: 'oferta', id: o.id, titulo: o.titulo })} accessibilityRole="button"
          style={{ padding: 12, borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.12)', gap: 2 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{o.titulo}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${o.etiqueta ? `${o.etiqueta} · ` : ''}hasta el ${fechaTexto(o.fin, { day: 'numeric', month: 'short' })}`}</Text>
        </Tocable>
      ))}
    </Hoja>
  );
}

async function tomarFoto(desdeCamara) {
  const permiso = desdeCamara ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) { Alert.alert('Sin permiso', desdeCamara ? 'La app necesita la cámara para tomar la foto.' : 'La app necesita tus fotos para elegir una.'); return null; }
  const op = { mediaTypes: ['images'], quality: 1 };
  const r = desdeCamara ? await ImagePicker.launchCameraAsync(op) : await ImagePicker.launchImageLibraryAsync(op);
  if (r.canceled || !r.assets?.[0]) return null;
  const ref = await ImageManipulator.manipulate(r.assets[0].uri).resize({ width: 1600 }).renderAsync();
  const hecha = await ref.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
  return hecha.uri;
}

export default function Compositor({ conversacion, onEnviar, respondiendoA = null, onQuitarRespuesta, equipo, cliente }) {
  const [texto, setTexto] = useState('');
  const ultimoAviso = useRef(0);
  const escribir = (valor) => {
    setTexto(valor);
    if (!valor.trim()) return;
    const ahora = Date.now();
    if (ahora - ultimoAviso.current < CADA_CUANTO_ESCRIBIENDO_MS) return;
    ultimoAviso.current = ahora;
    // Una señal efímera: si falla, no se le dice nada a quien escribe.
    Promise.resolve(marcarEscribiendo(conversacion.id)).catch(() => {});
  };
  const [foto, setFoto] = useState(null);
  const [adjunto, setAdjunto] = useState(null);
  const [hoja, setHoja] = useState(null);
  const [grabando, setGrabando] = useState(false);

  const elegirFoto = () => Alert.alert('Adjuntar una foto', undefined, [
    { text: 'Tomar foto', onPress: () => Promise.resolve(tomarFoto(true)).then((u) => u && setFoto(u)).catch((e) => fallo('No se pudo', mensajeAmigable(e))) },
    { text: 'Elegir de la galería', onPress: () => Promise.resolve(tomarFoto(false)).then((u) => u && setFoto(u)).catch((e) => fallo('No se pudo', mensajeAmigable(e))) },
    { text: 'Cancelar', style: 'cancel' },
  ]);
  const elegirProducto = async (p) => {
    try {
      const precios = await preciosDeProducto(p.id);
      // La presentación más chica es la que el cliente compra suelta (igual que el portal).
      setAdjunto({ tipo: 'producto', id: p.id, nombre: p.nombre, precio: precios[0]?.precio ?? null });
      setHoja(null);
    } catch (e) { fallo('No se pudo leer el precio', mensajeAmigable(e)); }
  };

  const puedeEnviar = !!(texto.trim() || foto || adjunto);
  const enviar = () => {
    if (!puedeEnviar) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onEnviar?.({ texto, foto, adjunto, respuestaA: respondiendoA });
    setTexto(''); setFoto(null); setAdjunto(null); onQuitarRespuesta?.();
  };
  const grabar = async () => {
    if (await permisoMicrofono()) setGrabando(true);
  };
  const alTerminarDeGrabar = (voz) => {
    setGrabando(false);
    if (!voz) return;
    onEnviar?.({ voz, respuestaA: respondiendoA });
    onQuitarRespuesta?.();
  };

  return (
    <View style={{ borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, gap: 6 }}>
      {respondiendoA ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: MARCA.azulClaro }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 12, fontWeight: '700' }}>{`Respondiendo a ${nombreDeAutor(respondiendoA, equipo ?? new Map(), cliente)}`}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{recorteDeMensaje(respondiendoA)}</Text>
          </View>
          <Pressable onPress={onQuitarRespuesta} hitSlop={10} accessibilityLabel="Quitar la cita" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>×</Text>
          </Pressable>
        </View>
      ) : null}
      {foto || adjunto ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {foto ? (
            <Pressable onPress={() => setFoto(null)} accessibilityLabel="Quitar la foto">
              <Image source={{ uri: foto }} style={{ width: 56, height: 56, borderRadius: 10 }} />
              <Text style={{ position: 'absolute', top: -6, right: -6, color: '#fff', backgroundColor: MARCA.rojo, borderRadius: 10, width: 20, height: 20, textAlign: 'center', fontSize: 13, overflow: 'hidden' }}>×</Text>
            </Pressable>
          ) : null}
          {adjunto ? (
            <Pressable onPress={() => setAdjunto(null)} accessibilityLabel="Quitar el adjunto"
              style={{ paddingHorizontal: 12, minHeight: 36, borderRadius: 18, justifyContent: 'center', backgroundColor: 'rgba(0,82,204,0.14)' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '700' }}>
                {`${adjunto.tipo === 'producto' ? `📦 ${adjunto.nombre}${adjunto.precio != null ? ` · ${formatMoney(adjunto.precio)}` : ''}` : `🏷 ${adjunto.titulo}`}  ×`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {grabando ? <Grabadora alFin={alTerminarDeGrabar} /> : (
      <>
      {/* El campo y el botón redondo en la MISMA fila, del mismo alto (44),
          como en el portal y en cualquier app de mensajería; las herramientas
          en una tira debajo. Antes el botón vivía en la tira y quedaba
          desalineado del campo (2026-10-21). */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
      <TextInput value={texto} onChangeText={escribir} placeholder="Escribe una respuesta…" placeholderTextColor={colorSistema.texto2}
        multiline maxLength={2000} accessibilityLabel="Escribe una respuesta"
        style={{ flex: 1, minHeight: 44, maxHeight: 140, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderRadius: 22, fontSize: 16,
          color: colorSistema.texto, backgroundColor: 'rgba(127,127,127,0.14)' }} />
        {!puedeEnviar && HAY_AUDIO ? (
          <Tocable onPress={grabar} accessibilityRole="button" accessibilityLabel="Grabar una nota de voz"
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: MARCA.azul }}>
            <Host matchContents><Icon name={iconoDe('Mic')} size={20} color="#fff" /></Host>
          </Tocable>
        ) : (
          <Tocable onPress={enviar} disabled={!puedeEnviar} accessibilityRole="button" accessibilityLabel="Enviar"
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
              backgroundColor: puedeEnviar ? MARCA.azul : 'rgba(127,127,127,0.25)' }}>
            <Host matchContents><Icon name={iconoDe('ArrowUp')} size={20} color="#fff" /></Host>
          </Tocable>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: -4 }}>
        <BotonIcono icono="ImagePlus" etiqueta="Adjuntar una foto" onPress={elegirFoto} />
        <BotonIcono icono="MessageSquareText" etiqueta="Respuestas rápidas" onPress={() => setHoja('respuestas')} />
        <BotonIcono icono="Package" etiqueta="Enviar un producto" onPress={() => setHoja('producto')} />
        <BotonIcono icono="Tag" etiqueta="Enviar una oferta" onPress={() => setHoja('oferta')} />
      </View>
      </>
      )}

      <RespuestasRapidas abierta={hoja === 'respuestas'} textoActual={texto} onCerrar={() => setHoja(null)}
        onElegir={(t) => { setTexto((prev) => (prev.trim() ? `${prev.trimEnd()} ${t}` : t)); setHoja(null); }} />
      <Hoja titulo="Enviar un producto" abierta={hoja === 'producto'} onCerrar={() => setHoja(null)}>
        <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Busca el producto que le quieres mostrar al cliente.</Text>
        <BuscadorProducto onElegir={elegirProducto} onCancelar={() => setHoja(null)} />
      </Hoja>
      <ElegirOferta abierta={hoja === 'oferta'} onCerrar={() => setHoja(null)} onElegir={(a) => { setAdjunto(a); setHoja(null); }} />
    </View>
  );
}
