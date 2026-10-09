// Ofertas para clientes · Historias, NATIVO — `HistoriasPanel` del portal: las
// imágenes tipo «estados» que la app de clientes muestra arriba de Mis puntos.
// Cada una con su estado (`estadoDeHistoria`), cuántos la vieron y cuántos
// tocaron un botón (tocar el número abre quién la vio), hasta cuándo se ve, y
// —con permiso— publicar, retirar, publicar otras 24 horas, editar y borrar.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { borrarHistoria, fetchHistorias, fetchVistasHistorias, publicarHistoria } from '@nucleo/data/ofertasClientes';
import { estadoDeHistoria, venceHistoria } from '@nucleo/utils/ofertasClientes';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import { colorDeVariante } from '../colorDeVariante';
import { fallo, listo } from '../Progreso';
import { guardar } from '../comercial/elegido';
import Tocable from '../Tocable';

export const ESTADOS_DE_HISTORIA = [
  { id: 'todas', label: 'Todas' }, { id: 'vigente', label: 'En la app' }, { id: 'borrador', label: 'Sin publicar' }, { id: 'terminada', label: 'Terminó' },
];

export function abrirHistoria(h) {
  guardar('historia-app', h ?? {});
  router.push({ pathname: '/historia/[id]', params: { id: h?.id ? String(h.id) : 'nueva' } });
}

export default function Historias({ busqueda, estado, puedeEditar, recarga }) {
  const [historias, setHistorias] = useState(null);
  const [vistas, setVistas] = useState(new Map());
  const [error, setError] = useState(null);
  const cargar = useCallback(async () => {
    try {
      const [hs, vs] = await Promise.all([fetchHistorias(), fetchVistasHistorias().catch(() => new Map())]);
      setHistorias(hs); setVistas(vs); setError(null);
    } catch (e) { setHistorias((x) => x ?? []); setError(mensajeAmigable(e, 'No se pudieron cargar las historias.')); }
  }, []);
  useEffect(() => { cargar(); }, [cargar, recarga]); // eslint-disable-line react-hooks/set-state-in-effect -- carga de datos

  const filas = useMemo(() => (historias ?? [])
    .filter((h) => estado === 'todas' || estadoDeHistoria(h).key === estado)
    .filter((h) => !busqueda || tokenMatch(busqueda, h.titulo, h.texto ?? '')), [historias, estado, busqueda]);

  // Una que ya terminó se vuelve a publicar: se retira y se publica, y la base
  // le renueva las 24 horas.
  const alternar = async (h, renovar = false) => {
    try {
      if (renovar) await publicarHistoria(h.id, false);
      const publicar = renovar || !h.publicada;
      await publicarHistoria(h.id, publicar);
      listo(publicar ? 'Historia publicada' : 'Historia retirada', publicar ? 'Se ve en la app durante 24 horas.' : 'Ya no se ve en la app.');
      cargar();
    } catch (e) { fallo('No se pudo cambiar', mensajeAmigable(e, 'Intenta de nuevo.')); }
  };
  const borrar = (h) => Alert.alert('Borrar historia', `«${h.titulo}» deja de verse en la app y se borra su imagen.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Borrar', style: 'destructive', onPress: async () => {
      try { await borrarHistoria(h); listo('Historia borrada', ''); cargar(); }
      catch (e) { fallo('No se pudo borrar', mensajeAmigable(e, 'Intenta de nuevo.')); }
    } },
  ]);
  const menu = (h) => {
    if (!puedeEditar) return;
    const est = estadoDeHistoria(h);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const primera = est.key === 'vigente' ? 'Retirar de la app' : est.key === 'terminada' ? 'Publicar otras 24 horas' : 'Publicar en la app';
    ActionSheetIOS.showActionSheetWithOptions({
      title: h.titulo, options: [primera, 'Editar', 'Borrar', 'Cancelar'], destructiveButtonIndex: 2, cancelButtonIndex: 3,
    }, (i) => {
      if (i === 0) Alert.alert(primera, est.key === 'vigente' ? 'Deja de verse en la app.' : 'Se ve en la app durante 24 horas.', [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Confirmar', onPress: () => alternar(h, est.key === 'terminada') },
      ]);
      else if (i === 1) abrirHistoria(h);
      else if (i === 2) borrar(h);
    });
  };
  const verQuienes = (h) => { guardar('historia-vistas', { historia: h, resumen: vistas.get(h.id) }); router.push('/historia-vistas'); };

  if (historias == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {filas.map((h) => {
        const est = estadoDeHistoria(h);
        const vence = venceHistoria(h);
        const v = vistas.get(h.id);
        return (
          <Tocable key={h.id} onPress={() => (puedeEditar ? abrirHistoria(h) : null)} onLongPress={() => menu(h)} delayLongPress={350}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={18} interactivo>
              <View style={{ padding: 12, flexDirection: 'row', gap: 12 }}>
                {h.imagen_url
                  ? <Image source={{ uri: h.imagen_url }} style={{ width: 54, aspectRatio: 9 / 16, borderRadius: 8 }} resizeMode="cover" />
                  : <View style={{ width: 54, aspectRatio: 9 / 16, borderRadius: 8, backgroundColor: 'rgba(127,127,127,0.2)' }} />}
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{h.titulo}</Text>
                    <Pildora texto={est.label} color={colorDeVariante(est.variant)} />
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{h.boton ? `Botón: ${h.boton}` : 'Sin botón'}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{vence ? `Se ve hasta el ${fechaTexto(vence, { day: 'numeric', month: 'short' })} · ${hora12(vence)}` : 'Sin publicar'}</Text>
                  {v?.vistas ? (
                    <Tocable onPress={() => verQuienes(h)} hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{`${v.vistas.toLocaleString('es-SV')} la vieron${v.tocaron ? ` · ${v.tocaron} tocaron` : ''} ›`}</Text>
                    </Tocable>
                  ) : <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Nadie la ha visto todavía</Text>}
                </View>
              </View>
            </Vidrio>
          </Tocable>
        );
      })}
      {!filas.length && !error ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin historias con ese filtro</Text> : null}
      {puedeEditar && filas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>Mantén presionada una historia para publicarla, retirarla o borrarla.</Text> : null}
    </>
  );
}
