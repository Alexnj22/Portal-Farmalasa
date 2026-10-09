// Ofertas para clientes · Banners, NATIVO — `BannersPanel` del portal: las
// imágenes horizontales arriba del catálogo de la app de clientes. Cada uno con
// su estado (el de una oferta: `estadoDeOferta`, por fechas y publicado) y sus
// fechas; tocar edita, mantener presionado publica, retira o borra.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { borrarBanner, fetchBanners, publicarBanner } from '@nucleo/data/ofertasClientes';
import { DESTINOS_DE_LA_APP, estadoDeOferta } from '@nucleo/utils/ofertasClientes';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import { colorDeVariante } from '../colorDeVariante';
import { fallo, listo } from '../Progreso';
import { guardar } from '../comercial/elegido';

export function abrirBanner(b) {
  guardar('banner-app', b ?? {});
  router.push({ pathname: '/banner/[id]', params: { id: b?.id ? String(b.id) : 'nuevo' } });
}

const rango = (b) => `${fechaTexto(b.inicio, { day: 'numeric', month: 'short' })} – ${fechaTexto(b.fin, { day: 'numeric', month: 'short' })}`;

export default function Banners({ busqueda, estado, puedeEditar, recarga }) {
  const [banners, setBanners] = useState(null);
  const [error, setError] = useState(null);
  const hoy = hoySV();
  const cargar = useCallback(async () => {
    try { setBanners(await fetchBanners()); setError(null); }
    catch (e) { setBanners((x) => x ?? []); setError(mensajeAmigable(e, 'No se pudieron cargar los banners.')); }
  }, []);
  useEffect(() => { cargar(); }, [cargar, recarga]); // eslint-disable-line react-hooks/set-state-in-effect -- carga de datos

  const filas = useMemo(() => (banners ?? [])
    .filter((b) => estado === 'todas' || estadoDeOferta(b, hoy).key === estado)
    .filter((b) => !busqueda || tokenMatch(busqueda, b.titulo)), [banners, estado, busqueda, hoy]);

  const alternar = async (b) => {
    try {
      await publicarBanner(b.id, !b.publicada);
      listo(b.publicada ? 'Banner retirado' : 'Banner publicado', b.publicada ? 'Ya no se ve en la app.' : 'Se ve en la app entre sus fechas.');
      cargar();
    } catch (e) { fallo('No se pudo cambiar', mensajeAmigable(e, 'Intenta de nuevo.')); }
  };
  const borrar = (b) => Alert.alert('Borrar banner', `«${b.titulo}» deja de verse en la app y se borra su imagen.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Borrar', style: 'destructive', onPress: async () => {
      try { await borrarBanner(b); listo('Banner borrado', ''); cargar(); }
      catch (e) { fallo('No se pudo borrar', mensajeAmigable(e, 'Intenta de nuevo.')); }
    } },
  ]);
  const menu = (b) => {
    if (!puedeEditar) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const primera = b.publicada ? 'Retirar de la app' : 'Publicar en la app';
    ActionSheetIOS.showActionSheetWithOptions({
      title: b.titulo, options: [primera, 'Editar', 'Borrar', 'Cancelar'], destructiveButtonIndex: 2, cancelButtonIndex: 3,
    }, (i) => {
      if (i === 0) Alert.alert(primera, b.publicada ? 'Deja de verse en la app.' : 'Se ve en la app entre sus fechas.', [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Confirmar', onPress: () => alternar(b) },
      ]);
      else if (i === 1) abrirBanner(b);
      else if (i === 2) borrar(b);
    });
  };

  if (banners == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <View style={{ marginHorizontal: 16 }}><Aviso texto="Se pasan con el dedo arriba del catálogo de la app. Sin banners vigentes, la app muestra las ofertas." /></View>
      {filas.map((b) => {
        const est = estadoDeOferta(b, hoy);
        return (
          <Pressable key={b.id} onPress={() => (puedeEditar ? abrirBanner(b) : null)} onLongPress={() => menu(b)} delayLongPress={350}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={18} interactivo>
              {b.imagen_url ? <Image source={{ uri: b.imagen_url }} style={{ width: '100%', aspectRatio: 12 / 5, borderTopLeftRadius: 18, borderTopRightRadius: 18 }} resizeMode="cover" /> : null}
              <View style={{ padding: 12, gap: 4 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{b.titulo}</Text>
                  <Pildora texto={est.label} color={colorDeVariante(est.variant)} />
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {[rango(b), b.oferta_id ? 'Abre una oferta' : b.enlace ? `Abre ${DESTINOS_DE_LA_APP.find((d) => d.valor === b.enlace)?.rotulo ?? 'una pantalla'}` : null, b.titulo_visible ? 'Título sobre la imagen' : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Vidrio>
          </Pressable>
        );
      })}
      {!filas.length && !error ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin banners con ese filtro</Text> : null}
      {puedeEditar && filas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>Mantén presionado un banner para publicarlo, retirarlo o borrarlo.</Text> : null}
    </>
  );
}
