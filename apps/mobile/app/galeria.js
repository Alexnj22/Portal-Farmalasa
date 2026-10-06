// Galería, NATIVO — `GaleriaView`: el material de redes que Marketing liberó
// para las salas (aprobado), de los últimos seis meses, en cuadrícula. Tocar
// una pieza la abre en grande con su texto listo para copiar (se mantiene
// presionado) y «Compartir», que abre la hoja del sistema con el texto y el
// diseño para publicarlo en el estado de WhatsApp. Dice si el archivo sirve
// para un estado de WhatsApp.
//
// Qué entra a la galería, el texto y los archivos vigentes salen del núcleo
// (`marketing`), lo mismo del portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, RefreshControl, ScrollView, Share, Text, View, useWindowDimensions } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchGaleria, firmarDisenos } from '@nucleo/data/marketing';
import { aptoParaWhatsApp, esDeGaleria, formatoDe, FORMATOS, mediosDe, textoParaPublicar, tipoDeArchivo } from '@nucleo/utils/marketing';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { correrMes, fechaTexto, mesSV } from '@nucleo/utils/fecha';
import { registrarEgreso } from '@nucleo/data/egreso';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import ConAurora from '../componentes/ConAurora';
import { MARCA } from '../componentes/inicio/marca';
import { fallo } from '../componentes/Progreso';

function Detalle({ pieza, firmadas, onCerrar }) {
  const medios = mediosDe(pieza);
  const texto = textoParaPublicar(pieza);
  const whatsapp = medios.map(aptoParaWhatsApp);
  const compartir = async () => {
    const url = medios.map((a) => firmadas.get(a.url)).find(Boolean);
    try {
      const r = await Share.share({ message: texto || pieza.titulo, url });
      if (r.action === Share.sharedAction) registrarEgreso('galeria', { formato: 'diseno', filas: medios.length, detalle: { pieza: pieza.id, via: 'app' } });
    } catch (e) { fallo('No se pudo compartir', e?.message || ''); }
  };
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 48 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }} numberOfLines={2}>{pieza.titulo}</Text>
            <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text></Pressable>
          </View>
          {medios.map((a, i) => (tipoDeArchivo(a) === 'imagen' && firmadas.get(a.url)
            ? <Image key={a.id ?? a.url} source={{ uri: firmadas.get(a.url) }} style={{ width: '100%', aspectRatio: a.ancho && a.alto ? a.ancho / a.alto : 1, borderRadius: 16 }} resizeMode="contain" />
            : <Aviso key={a.id ?? a.url} texto={`Archivo ${i + 1}: ${tipoDeArchivo(a) === 'video' ? 'video' : 'documento'} — se comparte con el botón.`} />))}
          {whatsapp.some((w) => !w.apto) ? <Aviso tono="cuidado" texto={whatsapp.find((w) => !w.apto).motivo} /> : null}
          {texto ? <Text selectable style={{ color: colorSistema.texto, fontSize: 15, lineHeight: 21 }}>{texto}</Text> : null}
          {texto ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Mantén presionado el texto para copiarlo.</Text> : null}
          <BotonGrande texto="Compartir" color={MARCA.verde} onPress={compartir} />
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}

export default function Galeria() {
  const { width } = useWindowDimensions();
  const [piezas, setPiezas] = useState(null);
  const [firmadas, setFirmadas] = useState(new Map());
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState('');
  const [formato, setFormato] = useState('');
  const [abierta, setAbierta] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const ps = (await fetchGaleria({ desde: `${correrMes(mesSV(), -6)}-01` })).filter(esDeGaleria);
      setPiezas(ps);
      setFirmadas(await firmarDisenos(ps));
      setError(null);
    } catch (e) { setError(e?.message || 'No se pudo cargar la galería.'); setPiezas([]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => (piezas || []).filter((p) => (!formato || p.formato === formato) && (!texto.trim() || tokenMatch(texto.trim(), p.titulo, p.copy, p.hashtags))), [piezas, formato, texto]);
  const lado = (width - 16 * 2 - 10) / 2;
  const grupos = [{ id: 'formato', titulo: 'Formato', activa: formato, porDefecto: '', onCambiar: setFormato,
    opciones: [{ id: '', label: 'Todos' }, ...FORMATOS.map((f) => ({ id: f.value, label: f.label }))] }];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Galería', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Título o texto', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {piezas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <View style={{ marginHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {visibles.map((p) => {
              const portada = mediosDe(p).find((a) => tipoDeArchivo(a) === 'imagen' && firmadas.get(a.url));
              return (
                <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(p); }}
                  style={({ pressed }) => ({ width: lado, gap: 4, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                  {portada ? <Image source={{ uri: firmadas.get(portada.url) }} style={{ width: lado, height: lado, borderRadius: 14 }} />
                    : <View style={{ width: lado, height: lado, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{formatoDe(p.formato).label}</Text></View>}
                  <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }} numberOfLines={2}>{p.titulo}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`${formatoDe(p.formato).label} · ${fechaTexto(p.fecha, { day: 'numeric', month: 'short' })}`}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {piezas && !visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Todavía no hay piezas liberadas</Text> : null}
        {piezas?.length ? <View style={{ marginHorizontal: 16 }}><Pildora texto={`${visibles.length} pieza${visibles.length === 1 ? '' : 's'}`} color={MARCA.azulClaro} /></View> : null}
      </ScrollView>
      {abierta ? <Detalle pieza={abierta} firmadas={firmadas} onCerrar={() => setAbierta(null)} /> : null}
    </>
  );
}
