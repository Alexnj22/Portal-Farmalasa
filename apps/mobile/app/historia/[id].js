// Una historia de la app de clientes, NATIVO — el `HistoriaModal` del portal:
// imagen vertical (1080 × 1920), título, rótulo corto, texto, a dónde lleva el
// botón (lista cerrada, `DESTINOS_DE_LA_APP`), la oferta que manda a reservar y
// si queda publicada (se ve 24 horas desde que se publica). La fila que se
// guarda sale del núcleo (`filaDeHistoria`), la misma que arma el portal.
import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { fetchOfertasParaHistoria, guardarHistoria, subirImagen } from '@nucleo/data/ofertasClientes';
import { DESTINOS_DE_LA_APP, filaDeHistoria, historiaValida } from '@nucleo/utils/ofertasClientes';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { leer } from '../../componentes/comercial/elegido';
import { volver } from '../../componentes/volver';

export default function Historia() {
  const historia = useMemo(() => leer('historia-app') ?? {}, []);
  const nueva = !historia.id;
  const clave = `historia-app:${historia.id ?? 'nueva'}`;
  const [f, setF] = useState(() => loadDraft(clave) ?? {
    titulo: historia.titulo ?? '', rotulo: historia.rotulo ?? '', texto: historia.texto ?? '', enlace: historia.enlace ?? '',
    publicada: historia.publicada ?? false, oferta_id: historia.oferta_id ?? '',
  });
  useEffect(() => { saveDraft(clave, f); }, [clave, f]);
  const [foto, setFoto] = useState(null);
  const [ofertas, setOfertas] = useState([]);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { fetchOfertasParaHistoria(hoySV()).then(setOfertas).catch(() => setOfertas([])); }, []);
  const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const valido = historiaValida(f, foto || historia.imagen_path);

  const elegirFoto = async () => {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) { Alert.alert('Sin permiso', 'La app necesita tus fotos para elegir la imagen.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [9, 16], quality: 0.85 });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    Haptics.selectionAsync().catch(() => {});
    setFoto({ uri: a.uri, tipo: a.mimeType || 'image/jpeg', nombre: a.fileName || `historia-${Date.now()}.jpg` });
  };

  const guardar = () => Alert.alert(nueva ? 'Crear la historia' : 'Guardar la historia',
    f.publicada ? 'Se ve en la app de clientes durante 24 horas desde que se publica.' : 'Queda sin publicar.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', onPress: async () => {
        setGuardando(true); trabajando('Guardando…');
        try {
          let imagen_path = historia.imagen_path ?? null;
          if (foto) imagen_path = await subirImagen({ datos: await (await fetch(foto.uri)).arrayBuffer(), tipo: foto.tipo, nombre: foto.nombre });
          await guardarHistoria(historia.id, filaDeHistoria(f, imagen_path, hoySV(), sumarDias(hoySV(), 1)));
          clearDraft(clave);
          listo('Historia guardada', f.publicada ? 'Se ve en la app 24 horas.' : 'Queda sin publicar.');
          volver('/ofertas-clientes');
        } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.')); }
        setGuardando(false);
      } },
    ]);

  const imagen = foto?.uri ?? historia.imagen_url ?? null;
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: nueva ? 'Nueva historia' : 'Editar historia' }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Pressable onPress={elegirFoto} accessibilityRole="button" accessibilityLabel="Elegir la imagen" style={({ pressed }) => ({ alignSelf: 'center', opacity: pressed ? 0.85 : 1 })}>
            <View style={{ width: 180, aspectRatio: 9 / 16, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(127,127,127,0.2)', alignItems: 'center', justifyContent: 'center' }}>
              {imagen ? <Image source={{ uri: imagen }} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" /> : null}
              {!imagen ? <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center', padding: 12 }}>Toca para elegir una imagen vertical (1080 × 1920)</Text> : null}
            </View>
          </Pressable>
          {historia.imagen_path && !foto ? <Aviso texto="Ya tiene imagen; toca la foto para reemplazarla." /> : null}
          <Seccion titulo="Título">
            <Campo multiline={false} maxLength={60} placeholder="Ej. Semana del bebé" value={f.titulo} onChangeText={cambiar('titulo')} />
          </Seccion>
          <Seccion titulo="Rótulo corto" pie="Va debajo del círculo en la app. Una o dos palabras; si lo dejas vacío, se usa la primera del título.">
            <Campo multiline={false} maxLength={12} placeholder="Ej. Bebé" value={f.rotulo} onChangeText={cambiar('rotulo')} />
          </Seccion>
          <Seccion titulo="Texto (opcional)" pie="Una o dos líneas: se leen sobre la foto.">
            <Campo maxLength={240} placeholder="Texto" value={f.texto} onChangeText={cambiar('texto')} />
          </Seccion>
          <Seccion titulo="Botón" pie="A dónde lleva el botón de la historia en la app.">
            <Opciones valor={f.enlace} onCambiar={cambiar('enlace')} opciones={DESTINOS_DE_LA_APP.map((d) => ({ id: d.valor, label: d.rotulo }))} />
          </Seccion>
          <Seccion titulo="Oferta para reservar" pie="Con una oferta, la historia muestra «Reservar» en lugar del botón. «Más información» sale siempre.">
            <Opciones valor={f.oferta_id} onCambiar={cambiar('oferta_id')}
              opciones={[{ id: '', label: 'Ninguna' }, ...ofertas.map((o) => ({ id: o.id, label: `${o.titulo}${o.publicada ? '' : ' (sin publicar)'}` }))]} />
          </Seccion>
          <Seccion>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Publicada</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Se ve en la app 24 horas desde que se publica.</Text>
              </View>
              <Switch value={f.publicada} onValueChange={cambiar('publicada')} />
            </View>
          </Seccion>
          <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} color={MARCA.azul} onPress={guardar} deshabilitado={!valido || guardando} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
