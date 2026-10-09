// Marketing · Biblioteca de marca, NATIVO — `TabBiblioteca` del portal: logos,
// paleta, tipografías, fotos y plantillas de cada farmacia (o de todas), para
// que quien diseña no tenga que pedirlos cada vez. Un color se guarda como
// `#RRGGBB` y se comparte con un toque. Quien edita o aprueba agrega (archivo
// del teléfono, foto o enlace) y quita. Validar y agrupar sale del núcleo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, Linking, Pressable, Share, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { fetchRecursos, firmarDisenos, guardarRecurso, quitarRecurso } from '@nucleo/data/marketing';
import { TIPOS_DE_RECURSO, colorEscrito, colorValido, faltaEnRecurso, recursosPorMarca } from '@nucleo/utils/marketing';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';

const VACIO = { tipo: 'logo', marca_id: '', nombre: '', enlace: '', color: '' };
const hoja = (titulo, lista, onElegir) => ActionSheetIOS.showActionSheetWithOptions(
  { title: titulo, options: [...lista.map((x) => x.label), 'Cancelar'], cancelButtonIndex: lista.length },
  (i) => { if (i < lista.length) onElegir(lista[i].value); });

export default function Biblioteca({ marcas, puedeGestionar, yoId, recarga }) {
  const [recursos, setRecursos] = useState(null);
  const [firmas, setFirmas] = useState(new Map());
  const [form, setForm] = useState(VACIO);
  const [archivo, setArchivo] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const l = await fetchRecursos();
      setRecursos(l);
      // Las miniaturas se firman como los diseños: el bucket es privado.
      setFirmas(await firmarDisenos([{ archivos: l.filter((r) => r.url).map((r) => ({ url: r.url, mime: r.mime })) }]).catch(() => new Map()));
    } catch (e) { setRecursos((x) => x ?? []); fallo('No se pudo cargar la biblioteca', mensajeAmigable(e)); }
  }, []);
  useEffect(() => { cargar(); }, [cargar, recarga]); // eslint-disable-line react-hooks/set-state-in-effect -- carga de datos

  const grupos = useMemo(() => recursosPorMarca(recursos, marcas), [recursos, marcas]);
  const esColor = form.tipo === 'color';
  const falta = faltaEnRecurso(form, !!archivo);
  const marcaNombre = (id) => (marcas || []).find((m) => m.id === id)?.nombre ?? 'Todas';

  const elegirArchivo = async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    setArchivo({ uri: a.uri, name: a.name, type: a.mimeType || 'application/octet-stream' });
  };
  const agregar = () => Alert.alert('Agregar a la biblioteca', `«${form.nombre.trim()}» queda a la vista de quien diseña.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Agregar', onPress: async () => {
      setGuardando(true); trabajando('Subiendo…');
      try {
        const arch = !esColor && archivo ? { name: archivo.name, type: archivo.type, datos: await (await fetch(archivo.uri)).arrayBuffer() } : null;
        await guardarRecurso({ ...form, color: esColor ? form.color.toUpperCase() : null, enlace: esColor ? null : form.enlace }, arch, yoId);
        setForm((f) => ({ ...VACIO, tipo: f.tipo, marca_id: f.marca_id })); setArchivo(null);
        listo('Agregado', ''); cargar();
      } catch (e) { fallo('No se pudo agregar', mensajeAmigable(e)); }
      setGuardando(false);
    } },
  ]);
  const quitar = (r) => Alert.alert('Quitar el recurso', `«${r.nombre}» se quita de la biblioteca.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', style: 'destructive', onPress: async () => {
      try { await quitarRecurso(r); listo('Quitado', ''); cargar(); } catch (e) { fallo('No se pudo quitar', mensajeAmigable(e)); }
    } },
  ]);
  const abrir = (r) => {
    if (r.color) { Share.share({ message: r.color, title: r.nombre }).catch(() => {}); return; }
    if (r.url) { Promise.resolve(openStoredFile(r.url)).catch((e) => fallo('No se pudo abrir', mensajeAmigable(e))); return; }
    if (r.enlace) Linking.openURL(r.enlace).catch(() => fallo('No se pudo abrir el enlace', r.enlace));
  };

  if (recursos == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      {puedeGestionar ? (
        <View style={{ marginHorizontal: 16 }}>
          <Seccion titulo="Agregar a la biblioteca">
            <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
              <Pressable hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }} onPress={() => hoja('Qué es', TIPOS_DE_RECURSO, (v) => setForm((f) => ({ ...f, tipo: v })))}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{`${TIPOS_DE_RECURSO.find((t) => t.value === form.tipo)?.label} ▾`}</Text>
              </Pressable>
              <Pressable hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}
                onPress={() => hoja('De qué marca', [{ value: '', label: 'Todas' }, ...(marcas || []).map((m) => ({ value: m.id, label: m.nombre }))], (v) => setForm((f) => ({ ...f, marca_id: v })))}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{`Marca: ${marcaNombre(form.marca_id)} ▾`}</Text>
              </Pressable>
            </View>
            <Campo multiline={false} placeholder={esColor ? 'Ej. Azul principal' : 'Ej. Logo horizontal blanco'} value={form.nombre} onChangeText={(t) => setForm((f) => ({ ...f, nombre: t }))} />
            {esColor ? (
              <Campo multiline={false} autoCapitalize="characters" autoCorrect={false} placeholder="Color: seis dígitos, ej. 1A47C5" value={form.color}
                onChangeText={(t) => setForm((f) => ({ ...f, color: colorEscrito(t) }))} />
            ) : (
              <>
                <Pressable onPress={elegirArchivo} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center' }}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{archivo ? `Archivo: ${archivo.name}` : 'Elegir un archivo'}</Text>
                </Pressable>
                <Campo multiline={false} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="O un enlace (Drive, Canva): https://…" value={form.enlace}
                  onChangeText={(t) => setForm((f) => ({ ...f, enlace: t }))} />
              </>
            )}
            {esColor && form.color && !colorValido(form.color) ? <Text style={{ color: MARCA.ambar, fontSize: 13 }}>Un color son seis dígitos, ej. #1A47C5.</Text> : null}
            <BotonGrande texto={guardando ? 'Subiendo…' : 'Agregar'} deshabilitado={falta || guardando} onPress={agregar} />
          </Seccion>
        </View>
      ) : null}
      {!grupos.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin recursos de marca</Text> : null}
      {grupos.map((g) => (
        <View key={g.id || 'todas'} style={{ marginHorizontal: 16, gap: 8 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginLeft: 4 }}>{`${g.nombre} · ${g.items.length}`}</Text>
          {g.items.map((r) => {
            const src = r.url && /^image\//.test(r.mime || '') ? firmas.get(r.url) : null;
            return (
              <Vidrio key={r.id} radio={16}>
                <Pressable onPress={() => abrir(r)} style={({ pressed }) => ({ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.7 : 1 })}>
                  {r.color ? <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: r.color }} />
                    : src ? <Image source={{ uri: src }} style={{ width: 40, height: 40, borderRadius: 8 }} resizeMode="cover" />
                      : <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(127,127,127,0.2)' }} />}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{r.nombre}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[TIPOS_DE_RECURSO.find((t) => t.value === r.tipo)?.label, r.color, r.enlace ? 'enlace' : null].filter(Boolean).join(' · ')}</Text>
                  </View>
                  {puedeGestionar ? (
                    <Pressable onPress={() => quitar(r)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                      <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Quitar</Text>
                    </Pressable>
                  ) : null}
                </Pressable>
              </Vidrio>
            );
          })}
        </View>
      ))}
    </>
  );
}
