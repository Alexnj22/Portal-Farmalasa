// Buscar en el chat y su galería (2026-10-20, «como las apps de mensajería»):
// la lupa del título abre esta hoja, como «Buscar» y «Fotos y archivos» de
// WhatsApp o los detalles de una conversación de Mensajes.
//
//   · Mensajes: busca en TODO el hilo (`chat_buscar`, en el servidor), con la
//     palabra resaltada y la fecha. Tocar uno cierra la hoja y lleva a él.
//   · Fotos: la cuadrícula de todas las fotos (`chat_galeria`); tocar una abre
//     el visor con todas.
//   · Productos: los productos que se mandaron, para volver a abrirlos.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import Presionable from './Presionable';
import Icono from './Icono';
import Segmentos from './Segmentos';
import { colorSistema } from './sistema';
import { useSesion } from '../lib/sesion';
import { navegar } from '../lib/navegar';
import { nombreProducto } from '../lib/catalogo';
import { dolares } from '../lib/formato';
import { suave, useTema } from '../tema/tema';

const IOS = Platform.OS === 'ios';
const SECCIONES = [{ valor: 'mensajes', rotulo: 'Mensajes' }, { valor: 'fotos', rotulo: 'Fotos' }, { valor: 'productos', rotulo: 'Productos' }];
const fecha = (iso) => {
  try { return new Date(iso).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: '2-digit' }); } catch { return ''; }
};
const sinTildes = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function BuscarEnChat({ visible, alCerrar, alIr, alVerFotos }) {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  const [seccion, setSeccion] = useState('mensajes');
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [galeria, setGaleria] = useState(null);
  const pedido = useRef(0);

  // Cerrada se olvida todo: al volver a abrirla, la galería se trae de nuevo (pudo llegar una foto).
  useEffect(() => { if (!visible) { setQ(''); setResultados(null); setSeccion('mensajes'); setGaleria(null); } }, [visible]);
  // La búsqueda sale 300 ms después de la última tecla, y una respuesta vieja no pisa a una nueva.
  useEffect(() => {
    const x = q.trim();
    if (!visible || x.length < 2) { setResultados(null); return undefined; }
    const n = ++pedido.current;
    const id = setTimeout(async () => {
      setBuscando(true);
      const r = await pedir('chat_buscar', { q: x });
      if (n !== pedido.current) return;
      setBuscando(false);
      setResultados(r?.ok ? r.mensajes ?? [] : []);
    }, 300);
    return () => clearTimeout(id);
  }, [q, visible, pedir]);
  useEffect(() => {
    if (!visible || seccion === 'mensajes' || galeria) return;
    pedir('chat_galeria').then((r) => { if (r?.ok) setGaleria({ fotos: r.fotos ?? [], productos: r.productos ?? [] }); });
  }, [visible, seccion, galeria, pedir]);

  const fuentes = useMemo(() => (galeria?.fotos ?? []).map((m) => (m.foto_clave ? { uri: m.foto_url, cacheKey: m.foto_clave } : { uri: m.foto_url })), [galeria]);
  const fondo = t.oscuro ? '#1C1C1E' : '#F2F2F7';
  const tarjeta = t.oscuro ? '#2C2C2E' : '#FFFFFF';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={IOS ? 'pageSheet' : 'fullScreen'} onRequestClose={alCerrar}>
      <View style={{ flex: 1, backgroundColor: fondo }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: IOS ? 14 : 18, paddingBottom: 8 }}>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto }}>Buscar en el chat</Text>
          <Presionable onPress={alCerrar} hitSlop={10} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: t.color.magentaTexto }}>Listo</Text>
          </Presionable>
        </View>
        <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 10 }}>
          <Segmentos opciones={SECCIONES} valor={seccion} alCambiar={(v) => { Haptics.selectionAsync().catch(() => {}); setSeccion(v); }} />
          {seccion === 'mensajes' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 40, borderRadius: 12, backgroundColor: tarjeta }}>
              <Icono sf="magnifyingglass" respaldo="⌕" tam={15} color={colorSistema.texto3} />
              <TextInput value={q} onChangeText={setQ} placeholder="Una palabra del mensaje" placeholderTextColor={colorSistema.texto3}
                autoFocus returnKeyType="search" clearButtonMode="while-editing" autoCorrect={false}
                style={{ flex: 1, fontSize: 17, color: colorSistema.texto, paddingVertical: 8 }} />
              {buscando ? <ActivityIndicator size="small" /> : null}
            </View>
          ) : null}
        </View>

        {seccion === 'mensajes' ? (
          <FlatList data={resultados ?? []} keyExtractor={(m) => String(m.id)} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}
            ListEmptyComponent={(
              <Text style={{ textAlign: 'center', color: colorSistema.texto3, fontSize: 15, marginTop: 30 }}>
                {q.trim().length < 2 ? 'Escribe al menos dos letras.' : buscando ? '' : 'No hay mensajes con eso.'}
              </Text>
            )}
            renderItem={({ item: m }) => (
              <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); alIr(m); }} accessibilityRole="button"
                style={{ padding: 12, borderRadius: 14, backgroundColor: tarjeta, gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: m.autor === 'cliente' ? t.color.magentaTexto : colorSistema.texto2 }}>
                    {m.autor === 'cliente' ? 'Tú' : m.equipo?.nombre ?? 'Farmacia Salud'}
                  </Text>
                  <Text style={{ fontSize: 12, color: colorSistema.texto3 }}>{fecha(m.created_at)}</Text>
                </View>
                <Resaltado texto={m.texto} q={q} color={colorSistema.texto} marca={suave(t.color.magenta, t.oscuro ? 0.45 : 0.25)} />
              </Presionable>
            )} />
        ) : seccion === 'fotos' ? (
          <FlatList data={galeria?.fotos ?? []} keyExtractor={(m) => String(m.id)} numColumns={3}
            contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 40, gap: 4 }} columnWrapperStyle={{ gap: 4 }}
            ListEmptyComponent={<Vacio cargando={!galeria} texto="Todavía no hay fotos en el chat." />}
            renderItem={({ item: m, index }) => (
              <Presionable onPress={() => alVerFotos(fuentes, index)} accessibilityRole="imagebutton" accessibilityLabel={`Foto del ${fecha(m.created_at)}`}
                style={{ flex: 1 / 3, aspectRatio: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: colorSistema.separador }}>
                <Image source={fuentes[index]} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="memory-disk"
                  recyclingKey={m.foto_clave || m.foto_url} transition={120} />
              </Presionable>
            )} />
        ) : (
          <FlatList data={galeria?.productos ?? []} keyExtractor={(m) => String(m.id)}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}
            ListEmptyComponent={<Vacio cargando={!galeria} texto="Todavía no se mandó ningún producto." />}
            renderItem={({ item: m }) => {
              const a = m.adjunto;
              const abrir = () => { alCerrar(); setTimeout(() => navegar(a.tipo === 'oferta' ? `/oferta/${a.id}` : `/producto/${a.id}`), 300); };
              return (
                <Presionable onPress={abrir} accessibilityRole="button"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: tarjeta }}>
                  {a.foto ? <Image source={{ uri: a.foto }} style={{ width: 48, height: 48, borderRadius: 10 }} contentFit="cover" />
                    : <View style={{ width: 48, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.magenta, 0.15) }}>
                      <Icono sf={a.tipo === 'oferta' ? 'tag.fill' : 'pills.fill'} respaldo="•" tam={20} color={t.color.magentaTexto} />
                    </View>}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }}>{a.tipo === 'oferta' ? a.titulo : nombreProducto(a.nombre)}</Text>
                    <Text style={{ fontSize: 12, color: colorSistema.texto3 }}>{a.precio != null ? `${dolares(a.precio)} · ` : ''}{fecha(m.created_at)}</Text>
                  </View>
                  <Icono sf="chevron.right" respaldo="›" tam={13} color={colorSistema.texto3} />
                </Presionable>
              );
            }} />
        )}
      </View>
    </Modal>
  );
}

function Vacio({ cargando, texto }) {
  return cargando ? <ActivityIndicator style={{ marginTop: 30 }} />
    : <Text style={{ textAlign: 'center', color: colorSistema.texto3, fontSize: 15, marginTop: 30 }}>{texto}</Text>;
}

// El texto con lo buscado resaltado (sin distinguir tildes ni mayúsculas).
function Resaltado({ texto, q, color, marca }) {
  const s = String(texto ?? '');
  const k = sinTildes(q.trim());
  const i = k ? sinTildes(s).indexOf(k) : -1;
  if (i < 0) return <Text numberOfLines={3} style={{ fontSize: 15, lineHeight: 20, color }}>{s}</Text>;
  // Un poco de contexto antes, si lo encontrado queda lejos del principio.
  const desde = i > 60 ? i - 40 : 0;
  return (
    <Text numberOfLines={3} style={{ fontSize: 15, lineHeight: 20, color }}>
      {desde ? '…' : ''}{s.slice(desde, i)}
      <Text style={{ backgroundColor: marca, fontWeight: '700' }}>{s.slice(i, i + k.length)}</Text>
      {s.slice(i + k.length)}
    </Text>
  );
}
