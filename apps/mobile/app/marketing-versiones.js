// Las versiones de un diseño, NATIVO — `VersionesModal` del portal: todas las
// versiones (V1, V2, V3…) de un diseño de la pieza abierta, dos lado a lado
// para comparar —por defecto la última contra la anterior, que es la pregunta
// de quien revisa: «¿qué cambió?»— y, para quien edita, subir la siguiente
// (la anterior queda guardada). La cadena sale del núcleo (`versionesDe`) y se
// sube con `subirDiseno` (con `anteriorId`), lo mismo del portal.
import { useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Image, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@nucleo/context/AuthContext';
import { firmarDisenos, subirDiseno } from '@nucleo/data/marketing';
import { ROTULO_SIN_ENVIAR, tipoDeArchivo, versionesDe } from '@nucleo/utils/marketing';
import { fechaHora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import Tocable from '../componentes/Tocable';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { guardarPieza, piezaElegida } from '../componentes/marketing/elegida';

export default function VersionesDelDiseno() {
  const { archivo: archivoId } = useLocalSearchParams();
  const { hasPermission, user } = useAuth();
  const puedeEditar = hasPermission('marketing', 'can_edit');
  const elegida = piezaElegida();
  const [pieza, setPieza] = useState(elegida?.pieza ?? null);
  const [firmas, setFirmas] = useState(elegida?.firmas ?? new Map());
  const archivos = useMemo(() => pieza?.archivos || [], [pieza]);
  const base = archivos.find((a) => String(a.id) === String(archivoId));
  const cadena = useMemo(() => versionesDe(archivos, base), [archivos, base]);
  const ultima = cadena[cadena.length - 1];
  const [izq, setIzq] = useState(() => (cadena.length > 1 ? cadena[cadena.length - 2].id : ultima?.id));
  const [der, setDer] = useState(ultima?.id);
  const [subiendo, setSubiendo] = useState(false);

  if (!pieza || !ultima) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Versiones' }} />
        <View style={{ padding: 16 }}><Aviso tono="freno" texto="Ese diseño ya no está disponible." /></View>
      </>
    );
  }

  const rotulo = (a) => `V${a.version} · ${fechaHora12(a.created_at, { day: 'numeric', month: 'short' })}${a.borrador ? ` · ${ROTULO_SIN_ENVIAR}` : ''}`;
  const elegir = (setId) => {
    const opciones = [...cadena.map(rotulo), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Versión', options: opciones, cancelButtonIndex: opciones.length - 1 }, (i) => { if (i < cadena.length) setId(cadena[i].id); });
  };
  const panel = (id, setId, titulo) => {
    const a = cadena.find((x) => x.id === id) || ultima;
    const src = firmas.get(a.url);
    return (
      <View style={{ gap: 6 }}>
        <Tocable onPress={() => elegir(setId)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>{`${titulo}: ${rotulo(a)} ▾`}</Text>
        </Tocable>
        {tipoDeArchivo(a) === 'imagen' && src
          ? <Image source={{ uri: src }} style={{ width: '100%', aspectRatio: a.ancho && a.alto ? a.ancho / a.alto : 1, borderRadius: 14 }} resizeMode="contain" />
          : <Aviso texto={`${a.nombre || 'Archivo'}${src ? '' : ' — se ve cuando la pieza se envía a revisión.'}`} />}
      </View>
    );
  };

  const subir = async () => {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) { Alert.alert('Sin permiso', 'La app necesita tus fotos para subir la versión.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.9 });
    if (r.canceled || !r.assets?.[0]) return;
    const n = r.assets[0];
    setSubiendo(true); trabajando('Subiendo la versión…');
    try {
      const datos = await (await fetch(n.uri)).arrayBuffer();
      const nombre = n.fileName || `diseno-${Date.now()}.jpg`;
      const nuevo = await subirDiseno({
        mesId: pieza.mes_id ?? elegida?.mes?.id, piezaId: pieza.id, archivo: { name: nombre, type: n.mimeType || 'image/jpeg', size: n.fileSize, datos },
        subidoPor: user?.id, anteriorId: ultima.id, medidas: { tamano: n.fileSize, ancho: n.width, alto: n.height },
      });
      const nuevos = [...archivos.map((a) => (a.id === ultima.id ? { ...a, reemplazado: true } : a)), nuevo];
      const piezaNueva = { ...pieza, archivos: nuevos };
      const firmasNuevas = new Map([...firmas, ...(await firmarDisenos([{ archivos: [nuevo] }]).catch(() => new Map()))]);
      setPieza(piezaNueva); setFirmas(firmasNuevas);
      guardarPieza(piezaNueva, elegida?.mes, firmasNuevas);
      setIzq(ultima.id); setDer(nuevo.id);
      listo(`V${ultima.version + 1} subida`, nombre);
    } catch (e) { fallo('No se pudo subir la versión', mensajeAmigable(e, 'Intenta de nuevo.')); }
    setSubiendo(false);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: `Versiones (${cadena.length})`, headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic">
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }} numberOfLines={2}>{ultima.nombre || 'Diseño'}</Text>
        {cadena.length > 1 ? (
          <>
            {panel(izq, setIzq, 'Antes')}
            {panel(der, setDer, 'Después')}
          </>
        ) : (
          <>
            <Aviso texto="Es la primera versión: todavía no hay con qué comparar." />
            {panel(ultima.id, () => {}, 'Versión')}
          </>
        )}
        {puedeEditar ? (
          <>
            <BotonGrande texto={subiendo ? 'Subiendo…' : `Subir la V${ultima.version + 1}`} deshabilitado={subiendo} onPress={subir} />
            <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>La anterior queda guardada.</Text>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
