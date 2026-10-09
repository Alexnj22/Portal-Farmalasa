// Un banner de la app de clientes, NATIVO — el `BannerModal` del portal:
// imagen horizontal (1200 × 500), título (lo lee VoiceOver), si se escribe el
// título sobre la imagen, a qué oferta o pantalla lleva, sus fechas y si queda
// publicado. A diferencia de una historia, un banner tiene fechas. Validar y
// armar la fila salen del núcleo (`bannerValido`, `filaDeBanner`).
import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { fetchOfertasParaHistoria, guardarBanner, subirImagen } from '@nucleo/data/ofertasClientes';
import { DESTINOS_DE_LA_APP, bannerValido, filaDeBanner } from '@nucleo/utils/ofertasClientes';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { leer } from '../../componentes/comercial/elegido';
import { volver } from '../../componentes/volver';

export default function Banner() {
  const banner = useMemo(() => leer('banner-app') ?? {}, []);
  const nuevo = !banner.id;
  const clave = `banner-app:${banner.id ?? 'nuevo'}`;
  const hoy = hoySV();
  const [f, setF] = useState(() => loadDraft(clave) ?? {
    titulo: banner.titulo ?? '', titulo_visible: banner.titulo_visible ?? false, oferta_id: banner.oferta_id ?? '', enlace: banner.enlace ?? '',
    inicio: banner.inicio ?? hoy, fin: banner.fin ?? sumarDias(hoy, 14), publicada: banner.publicada ?? false,
  });
  useEffect(() => { saveDraft(clave, f); }, [clave, f]);
  const [foto, setFoto] = useState(null);
  const [ofertas, setOfertas] = useState([]);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { fetchOfertasParaHistoria(hoySV()).then(setOfertas).catch(() => setOfertas([])); }, []);
  const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const valido = bannerValido(f, foto || banner.imagen_path);

  const elegirFoto = async () => {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) { Alert.alert('Sin permiso', 'La app necesita tus fotos para elegir la imagen.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [12, 5], quality: 0.85 });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    Haptics.selectionAsync().catch(() => {});
    setFoto({ uri: a.uri, tipo: a.mimeType || 'image/jpeg', nombre: a.fileName || `banner-${Date.now()}.jpg` });
  };

  const guardar = () => Alert.alert(nuevo ? 'Crear el banner' : 'Guardar el banner',
    f.publicada ? 'Se ve en la app entre esas fechas.' : 'Queda sin publicar.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', onPress: async () => {
        setGuardando(true); trabajando('Guardando…');
        try {
          let imagen_path = banner.imagen_path ?? null;
          if (foto) imagen_path = await subirImagen({ datos: await (await fetch(foto.uri)).arrayBuffer(), tipo: foto.tipo, nombre: foto.nombre });
          await guardarBanner(banner.id, filaDeBanner(f, imagen_path));
          clearDraft(clave);
          listo('Banner guardado', f.publicada ? 'Se ve en la app entre esas fechas.' : 'Queda sin publicar.');
          volver('/ofertas-clientes');
        } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.')); }
        setGuardando(false);
      } },
    ]);

  const imagen = foto?.uri ?? banner.imagen_url ?? null;
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: nuevo ? 'Nuevo banner' : 'Editar banner' }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Pressable onPress={elegirFoto} accessibilityRole="button" accessibilityLabel="Elegir la imagen" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            <View style={{ aspectRatio: 12 / 5, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(127,127,127,0.2)', alignItems: 'center', justifyContent: 'center' }}>
              {imagen ? <Image source={{ uri: imagen }} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" /> : null}
              {imagen && f.titulo_visible && f.titulo.trim() ? (
                <Text style={{ position: 'absolute', left: 12, bottom: 10, color: '#fff', fontSize: 18, fontWeight: '800' }}>{f.titulo.trim()}</Text>
              ) : null}
              {!imagen ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Toca para elegir una imagen horizontal (1200 × 500)</Text> : null}
            </View>
          </Pressable>
          {banner.imagen_path && !foto ? <Aviso texto="Ya tiene imagen; toca la foto para reemplazarla." /> : null}
          <Seccion titulo="Título" pie="Lo lee VoiceOver y sirve para encontrarlo aquí.">
            <Campo multiline={false} maxLength={60} placeholder="Ej. Semana del bebé" value={f.titulo} onChangeText={cambiar('titulo')} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Escribir el título sobre la imagen</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Apágalo si la imagen ya trae su texto.</Text>
              </View>
              <Switch value={f.titulo_visible} onValueChange={cambiar('titulo_visible')} />
            </View>
          </Seccion>
          <Seccion titulo="Al tocarlo abre">
            <Opciones valor={f.oferta_id} onCambiar={cambiar('oferta_id')}
              opciones={[{ id: '', label: 'Ninguna oferta' }, ...ofertas.map((o) => ({ id: o.id, label: `${o.titulo}${o.publicada ? '' : ' (sin publicar)'}` }))]} />
          </Seccion>
          {!f.oferta_id ? (
            <Seccion titulo="O una pantalla">
              <Opciones valor={f.enlace} onCambiar={cambiar('enlace')} opciones={DESTINOS_DE_LA_APP.map((d) => ({ id: d.valor, label: d.valor ? d.rotulo : 'Ninguno' }))} />
            </Seccion>
          ) : null}
          <Seccion titulo="Fechas">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Desde</Text>
              <Fecha valor={f.inicio} onCambiar={cambiar('inicio')} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Hasta</Text>
              <Fecha valor={f.fin} onCambiar={cambiar('fin')} desde={f.inicio} />
            </View>
            {f.fin && f.inicio && f.fin < f.inicio ? <Aviso tono="cuidado" texto="La fecha final es antes que la inicial." /> : null}
          </Seccion>
          <Seccion>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Publicado</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Se ve en la app entre esas fechas.</Text>
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
