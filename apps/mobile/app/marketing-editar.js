// Crear o editar una pieza de marketing, NATIVO — el formulario de `PiezaModal`:
// marca, fecha y hora, formato, redes, pilar, el texto y los hashtags, notas,
// el estado (los que mueve el diseñador), si se pauta y cuánto, y los diseños
// (subir desde Fotos, quitar). La pieza vacía, lo que falta para guardar y la
// fila que se manda salen del núcleo (`marketing`), lo mismo del portal; la
// pauta va a su propia tabla y no puede pasar el tope del mes.
//
// Llega con `?mes=AAAA-MM` para una nueva (si el mes no existe, se crea al
// guardar) o con la pieza elegida en la lista para editarla.
import { volver } from '../componentes/volver';
import { leer } from '../componentes/comercial/elegido';
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, KeyboardAvoidingView, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  crearMes, fetchCatalogos, fetchMes, fetchPiezas, firmarDisenos, guardarPauta, guardarPieza, quitarArchivo, quitarPauta, subirDiseno, moverIdea,
} from '@nucleo/data/marketing';
import {
  asignadoEnPauta, datosDePieza, ESTADOS_DE_SALIDA, ESTADOS_DEL_DISENADOR, ESTADOS_PIEZA, faltaEnPieza, FORMATOS, PIEZA_VACIA, PILARES, tipoDeArchivo,
} from '@nucleo/utils/marketing';
import { etiquetaMes, mesSV } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import Fecha from '../componentes/formulario/Fecha';
import { MARCA } from '../componentes/inicio/marca';
import { guardarPieza as recordarPieza, piezaElegida } from '../componentes/marketing/elegida';
import { fallo, listo } from '../componentes/Progreso';
import Tocable from '../componentes/Tocable';

function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4 }}>{texto}</Text>;
}
function Fila({ titulo, valor, onPress }) {
  return (
    <Tocable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{titulo}</Text>
      <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{valor} ›</Text>
    </Tocable>
  );
}
function Chips({ opciones, elegidas, onAlternar }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {opciones.map((o) => {
        const on = elegidas.includes(o.id);
        return (
          <Tocable key={o.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); onAlternar(o.id); }}
            style={{ paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: on ? MARCA.azul : 'rgba(127,127,127,0.18)' }}>
            <Text style={{ color: on ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{o.label}</Text>
          </Tocable>
        );
      })}
    </View>
  );
}
const elegir = (titulo, lista, onElegir) => {
  const opciones = [...lista.map((x) => x.label), 'Cancelar'];
  ActionSheetIOS.showActionSheetWithOptions({ title: titulo, options: opciones, cancelButtonIndex: opciones.length - 1 }, (i) => { if (i < lista.length) onElegir(lista[i].value); });
};

export default function EditarPiezaDeMarketing() {
  const { user } = useAuth();
  const { mes: mesParam, desde } = useLocalSearchParams();
  const sel = mesParam ? null : piezaElegida();
  // Una pieza nueva que nace de una idea o de una solicitud aceptada trae lo suyo
  // (`prellenadoDeIdea` / `prellenadoDeSolicitud`, núcleo, lo mismo del portal).
  const pre = useMemo(() => (mesParam && desde ? leer('marketing-prellenado') : null), [mesParam, desde]);
  const pieza = sel?.pieza ?? null;
  const mesTexto = String(mesParam || sel?.mes?.mes || mesSV()).slice(0, 7);
  const [mesFila, setMesFila] = useState(sel?.mes ?? null);
  const [piezasDelMes, setPiezasDelMes] = useState([]);
  const [catalogos, setCatalogos] = useState({ marcas: [], redes: [] });
  const [form, setForm] = useState(() => (pieza ? {
    ...PIEZA_VACIA, ...pieza,
    marcas: pieza.marcas?.length ? pieza.marcas : (pieza.marca_id ? [pieza.marca_id] : []),
    redes: pieza.redes || [], hora: pieza.hora ? String(pieza.hora).slice(0, 5) : '',
    copy: pieza.copy || '', hashtags: pieza.hashtags || '', notas: pieza.notas || '', pilar: pieza.pilar || '',
    pautar: !!pieza.pautar, monto: pieza.pauta?.presupuesto != null ? String(pieza.pauta.presupuesto) : '',
  } : {
    ...PIEZA_VACIA, fecha: `${mesTexto}-01`,
    ...(pre ? { titulo: pre.titulo || '', notas: pre.notas || '', formato: pre.formato || PIEZA_VACIA.formato, marcas: pre.marca_id ? [pre.marca_id] : [],
      fecha: pre.fecha || `${mesTexto}-01`, ...(pre.solicitud_id ? { solicitud_id: pre.solicitud_id } : {}) } : {}),
  }));
  const [archivos, setArchivos] = useState(pieza?.archivos ?? []);
  const [firmas, setFirmas] = useState(sel?.firmas ?? new Map());
  const [nuevos, setNuevos] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    fetchCatalogos().then((c) => {
      setCatalogos(c);
      const activas = (c.marcas || []).filter((m) => m.activo);
      if (!pieza && activas.length === 1) setForm((f) => (f.marcas.length ? f : { ...f, marcas: [activas[0].id] }));
    }).catch(() => {});
    fetchMes(mesTexto).then(async (fila) => {
      if (fila) setMesFila(fila);
      const ps = fila ? await fetchPiezas(fila.id) : [];
      setPiezasDelMes(ps);
    }).catch(() => {});
  }, [mesTexto, pieza]);

  const marcasActivas = useMemo(() => (catalogos.marcas || []).filter((m) => m.activo || form.marcas.includes(m.id)).map((m) => ({ id: m.id, label: m.nombre })), [catalogos, form.marcas]);
  const redes = useMemo(() => (catalogos.redes || []).filter((r) => r.activo || form.redes.includes(r.clave)).map((r) => ({ id: r.clave, label: r.nombre })), [catalogos, form.redes]);
  const despuesDeAprobar = ['aprobado', ...ESTADOS_DE_SALIDA].includes(pieza?.estado);
  const estados = ESTADOS_PIEZA.filter((e) => ESTADOS_DEL_DISENADOR.includes(e.value) || e.value === form.estado || (ESTADOS_DE_SALIDA.includes(e.value) && despuesDeAprobar));
  const limite = Number(mesFila?.presupuesto_pauta) || 0;
  const otros = asignadoEnPauta(piezasDelMes, pieza?.id);
  const disponible = limite - otros - (Number(form.monto) || 0);
  const falta = faltaEnPieza(form, { limite, otros });
  const alternar = (k, id) => setForm((f) => ({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] }));

  const elegirFoto = async () => {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) { Alert.alert('Sin permiso', 'La app necesita tus fotos para subir el diseño.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.9, allowsMultipleSelection: true });
    if (r.canceled || !r.assets?.length) return;
    setNuevos((n) => [...n, ...r.assets.map((a) => ({ uri: a.uri, name: a.fileName || `diseno-${Date.now()}.jpg`, type: a.mimeType || 'image/jpeg', size: a.fileSize, ancho: a.width, alto: a.height }))]);
  };
  const quitarExistente = (a) => Alert.alert('Quitar el diseño', a.nombre || 'Este archivo deja de estar en la pieza.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', style: 'destructive', onPress: async () => {
      try { await quitarArchivo(a); setArchivos((l) => l.filter((x) => x.id !== a.id)); listo('Diseño quitado', ''); }
      catch (e) { fallo('No se pudo quitar', mensajeAmigable(e, '')); }
    } },
  ]);

  const guardar = async () => {
    setGuardando(true);
    try {
      let mesId = mesFila?.id;
      if (!mesId) { const creado = await crearMes(mesTexto); mesId = creado.id; setMesFila(creado); }
      const fila = await guardarPieza(mesId, { ...datosDePieza(form, pieza), id: pieza?.id });
      // La idea que la originó queda «usada» y ligada a esta pieza, como en el portal.
      if (!pieza && pre?.idea_id) await moverIdea(pre.idea_id, 'usada', { piezaId: fila.id }).catch(() => {});
      const monto = Number(form.monto) || 0;
      if (form.pautar && (monto !== Number(pieza?.pauta?.presupuesto || 0) || !pieza?.pauta)) await guardarPauta(fila.id, { presupuesto: monto, redes: form.redes });
      else if (!form.pautar && pieza?.pauta) await quitarPauta(fila.id);
      for (const [i, n] of nuevos.entries()) {
        const datos = await (await fetch(n.uri)).arrayBuffer();
        await subirDiseno({ mesId, piezaId: fila.id, archivo: { name: n.name, type: n.type, size: n.size, datos }, orden: archivos.length + i, subidoPor: user?.id, medidas: { tamano: n.size, ancho: n.ancho, alto: n.alto } });
      }
      // El detalle que la abrió lee la pieza recordada: que vea lo guardado.
      if (pieza) recordarPieza({ ...pieza, ...fila, pauta: form.pautar ? { ...(pieza.pauta || {}), presupuesto: Number(form.monto) || 0 } : null }, mesFila, firmas);
      listo(pieza ? 'Pieza guardada' : 'Pieza agregada', form.titulo.trim());
      volver('/marketing');
    } catch (e) {
      fallo('No se pudo guardar la pieza', mensajeAmigable(e, 'Revisa los datos e intenta de nuevo.'));
    } finally {
      setGuardando(false);
    }
  };
  useEffect(() => { if (archivos.length && !firmas.size) firmarDisenos([{ archivos }]).then(setFirmas).catch(() => {}); }, [archivos, firmas]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: pieza ? 'Editar pieza' : 'Nueva pieza', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Mes de ${etiquetaMes(mesTexto)}`}</Text>
          <Seccion titulo="La pieza">
            <Rotulo texto="Título" />
            <Campo multiline={false} value={form.titulo} onChangeText={set('titulo')} placeholder="De qué trata" />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Fecha</Text>
              <Fecha valor={form.fecha} onCambiar={set('fecha')} desde={`${mesTexto}-01`} />
            </View>
            <Rotulo texto="Hora (opcional, HH:MM)" />
            <Campo multiline={false} value={form.hora} onChangeText={set('hora')} placeholder="10:00" keyboardType="numbers-and-punctuation" />
            <Fila titulo="Formato" valor={FORMATOS.find((f) => f.value === form.formato)?.label || 'Elegir'} onPress={() => elegir('Formato', FORMATOS, set('formato'))} />
            <Fila titulo="Pilar" valor={PILARES.find((p) => p.value === form.pilar)?.label || 'Sin pilar'} onPress={() => elegir('De qué habla', [{ value: '', label: 'Sin pilar' }, ...PILARES], set('pilar'))} />
            {pieza ? <Fila titulo="Estado" valor={ESTADOS_PIEZA.find((e) => e.value === form.estado)?.label || form.estado} onPress={() => elegir('Estado', estados, set('estado'))} /> : null}
          </Seccion>
          <Seccion titulo="Marca">
            {marcasActivas.length ? <Chips opciones={marcasActivas} elegidas={form.marcas} onAlternar={(id) => alternar('marcas', id)} /> : <ActivityIndicator />}
          </Seccion>
          <Seccion titulo="Redes">
            <Chips opciones={redes} elegidas={form.redes} onAlternar={(id) => alternar('redes', id)} />
          </Seccion>
          <Seccion titulo="El texto" pie={`${(form.copy || '').length} caracteres · la red muestra ~125 antes del «más».`}>
            <Campo value={form.copy} onChangeText={set('copy')} placeholder="Lo que se publica" style={{ minHeight: 110 }} />
            <Rotulo texto="Hashtags" />
            <Campo value={form.hashtags} onChangeText={set('hashtags')} placeholder="#FarmaciaLaSalud" />
            <Rotulo texto="Notas para el diseñador" />
            <Campo value={form.notas} onChangeText={set('notas')} placeholder="Opcional" />
          </Seccion>
          <Seccion titulo="Pauta" pie={limite ? `Presupuesto del mes ${formatMoney(limite)} · asignado a otras ${formatMoney(otros)} · disponible ${formatMoney(Math.max(disponible, 0))}` : 'Gerencia todavía no fija el presupuesto del mes.'}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Se pautará</Text>
              <Switch value={!!form.pautar} onValueChange={set('pautar')} />
            </View>
            {form.pautar ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Monto ($)</Text>
                <TextInput value={form.monto} onChangeText={set('monto')} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colorSistema.placeholder}
                  style={{ minWidth: 100, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(127,127,127,0.14)', color: colorSistema.texto, fontSize: 16, textAlign: 'right' }} />
              </View>
            ) : null}
            {form.pautar && disponible < 0 ? <Aviso tono="cuidado" texto="Se pasa del presupuesto del mes." /> : null}
          </Seccion>
          <Seccion titulo="Diseños">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {archivos.filter((a) => !a.reemplazado).map((a) => {
                const url = firmas.get?.(a.url) || a.url;
                return (
                  <Tocable key={a.id} onLongPress={() => quitarExistente(a)}>
                    {tipoDeArchivo(a) === 'imagen' && url ? <Image source={{ uri: url }} style={{ width: 84, height: 84, borderRadius: 12 }} />
                      : <View style={{ width: 84, height: 84, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.18)', alignItems: 'center', justifyContent: 'center', padding: 6 }}><Text style={{ color: colorSistema.texto2, fontSize: 11, textAlign: 'center' }} numberOfLines={3}>{a.nombre || a.enlace || 'Archivo'}</Text></View>}
                  </Tocable>
                );
              })}
              {nuevos.map((n, i) => (
                <Tocable key={n.uri} onPress={() => setNuevos((l) => l.filter((_, j) => j !== i))}>
                  <Image source={{ uri: n.uri }} style={{ width: 84, height: 84, borderRadius: 12, opacity: 0.8 }} />
                  <Text style={{ position: 'absolute', top: 4, right: 6, color: '#fff', fontWeight: '800' }}>✕</Text>
                </Tocable>
              ))}
            </View>
            <BotonGrande borde texto="Agregar desde Fotos" onPress={elegirFoto} />
            {archivos.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Mantén presionado un diseño para quitarlo. Los nuevos se suben al guardar.</Text> : null}
          </Seccion>
          <BotonGrande texto={guardando ? 'Guardando…' : pieza ? 'Guardar la pieza' : 'Agregar la pieza'} deshabilitado={falta || guardando}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); guardar(); }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
