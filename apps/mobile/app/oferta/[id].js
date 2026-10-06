// Crear o editar una oferta de la app de clientes, NATIVO — `OfertaModal`.
//
// Dos clases de oferta, y la diferencia importa:
//  · Suelta: la escribe quien la publica — fechas, salas, todo.
//  · De un descuento de la caja (`descuento_erp_id`): las fechas, las salas y
//    los productos con su precio SIGUEN al descuento (los pone al día
//    `descuentos-erp`). Acá no se editan: un campo editable que después se pisa
//    solo es un campo que miente. Se escribe lo que el cliente lee: título,
//    texto, imagen, color.
// Se guarda con `guardarOferta` del núcleo, el mismo del portal; la imagen va al
// bucket privado con `subirImagen`, que ahora acepta lo que da el teléfono.
import { useMemo, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { guardarOferta, subirImagen } from '@nucleo/data/ofertasClientes';
import { ACENTOS_DE_OFERTA, etiquetaDeDescuento } from '@nucleo/utils/ofertasClientes';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { useStaffStore } from '@nucleo/store/staffStore';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { MARCA } from '../../componentes/inicio/marca';
import { colorDeAcento, ofertaElegida } from '../../componentes/ofertas/acentos';
import { fallo, listo } from '../../componentes/Progreso';

// El rótulo encima de un campo: con el campo lleno, el texto de ayuda ya no se
// ve y no se sabe qué es cada caja.
function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

export default function EditarOferta() {
  const { id } = useLocalSearchParams();
  const oferta = (id !== 'nueva' && ofertaElegida()?.id && String(ofertaElegida().id) === String(id)) ? ofertaElegida() : {};
  const nueva = !oferta.id;
  const deDescuento = !!oferta.descuento_erp_id;
  // Seleccionar la lista ENTERA y filtrar aparte: un `.filter` dentro del
  // selector devuelve un arreglo nuevo en cada lectura y la pantalla se
  // vuelve a pintar sin fin.
  const branches = useStaffStore((s) => s.branches);
  const salas = useMemo(() => (branches || []).filter((b) => b.type === 'FARMACIA'), [branches]);
  const [f, setF] = useState({
    titulo: oferta.titulo ?? '', etiqueta: oferta.etiqueta ?? '', descripcion: oferta.descripcion ?? '',
    condiciones: oferta.condiciones ?? '', inicio: oferta.inicio ?? hoySV(), fin: oferta.fin ?? hoySV(),
    exclusiva: oferta.exclusiva ?? false, branch_ids: oferta.branch_ids ?? [], publicada: oferta.publicada ?? false,
    acento: oferta.acento ?? 'magenta',
  });
  const [foto, setFoto] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const alternarSala = (sid) => setF((x) => ({ ...x, branch_ids: x.branch_ids.includes(sid) ? x.branch_ids.filter((b) => b !== sid) : [...x.branch_ids, sid] }));
  const productos = Array.isArray(oferta.productos) ? oferta.productos : [];
  const valido = f.titulo.trim().length >= 3 && f.inicio && f.fin && f.fin >= f.inicio && (!deDescuento || productos.length > 0);
  const nombreSala = (sid) => salas.find((s) => Number(s.id) === Number(sid))?.name;

  const elegirFoto = async () => {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) { Alert.alert('Sin permiso', 'La app necesita tus fotos para elegir la imagen.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 9], quality: 0.8 });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    Haptics.selectionAsync().catch(() => {});
    setFoto({ uri: a.uri, tipo: a.mimeType || 'image/jpeg', nombre: a.fileName || `oferta-${Date.now()}.jpg` });
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      let imagen_path = oferta.imagen_path ?? null;
      if (foto) {
        const datos = await (await fetch(foto.uri)).arrayBuffer();
        imagen_path = await subirImagen({ datos, tipo: foto.tipo, nombre: foto.nombre });
      }
      await guardarOferta(oferta.id, {
        titulo: f.titulo.trim(), etiqueta: f.etiqueta.trim() || null, descripcion: f.descripcion.trim() || null,
        condiciones: f.condiciones.trim() || null, exclusiva: f.exclusiva, publicada: f.publicada, imagen_path, acento: f.acento,
        ...(deDescuento ? {
          descuento_erp_id: oferta.descuento_erp_id, promocion_id: oferta.promocion_id ?? null,
          descuento_tipo: oferta.descuento_tipo, descuento_monto: oferta.descuento_monto,
          productos, foto_at: oferta.foto_at ?? null, inicio: oferta.inicio, fin: oferta.fin, branch_ids: oferta.branch_ids ?? null,
        } : { inicio: f.inicio, fin: f.fin, branch_ids: f.branch_ids.length ? f.branch_ids : null }),
      });
      listo('Oferta guardada', f.publicada ? 'Se ve en la app durante sus fechas.' : 'Queda sin publicar.');
      router.back();
    } catch (e) {
      fallo('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setGuardando(false);
    }
  };

  const acento = colorDeAcento(f.acento);
  const imagen = foto?.uri ?? oferta.imagen_url ?? null;
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: deDescuento ? 'Oferta en la app' : nueva ? 'Nueva oferta' : 'Editar oferta', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          {/* Cómo la verá el cliente: la foto con el color de su acento. */}
          <Pressable onPress={elegirFoto} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            <View style={{ borderRadius: 20, overflow: 'hidden', aspectRatio: 16 / 9, backgroundColor: `${acento}33`, alignItems: 'center', justifyContent: 'center' }}>
              {imagen ? <Image source={{ uri: imagen }} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" /> : null}
              {f.etiqueta.trim() ? (
                <View style={{ position: 'absolute', top: 10, left: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: acento }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>{f.etiqueta.trim()}</Text>
                </View>
              ) : null}
              <View style={{ position: 'absolute', bottom: 10, right: 10, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)' }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{imagen ? 'Cambiar imagen' : 'Elegir imagen (16:9)'}</Text>
              </View>
            </View>
          </Pressable>

          {deDescuento ? <Aviso texto="Las fechas, las salas y los precios siguen al descuento solos: si lo corriges o lo borras en la caja, la app se entera." /> : null}
          {deDescuento && oferta.sin_receta > 0 ? <Aviso tono="cuidado" texto={`${oferta.sin_receta === 1 ? 'Un producto bajo receta no se muestra' : `${oferta.sin_receta} productos bajo receta no se muestran`} en la app. El descuento sigue valiendo en caja.`} /> : null}
          {deDescuento && !productos.length ? <Aviso tono="cuidado" texto="Todos los productos de este descuento van bajo receta: no hay nada que anunciar." /> : null}

          <Seccion titulo="Lo que lee el cliente">
            <Rotulo texto="Título" />
            <Campo multiline={false} value={f.titulo} onChangeText={cambiar('titulo')} maxLength={80} placeholder="Ej. 20% en vitaminas" />
            <Rotulo texto="Etiqueta sobre la foto (opcional)" />
            <Campo multiline={false} value={f.etiqueta} onChangeText={cambiar('etiqueta')} maxLength={16} placeholder="Ej. −20% · 2×1" />
            <Rotulo texto="Descripción" />
            <Campo value={f.descripcion} onChangeText={cambiar('descripcion')} maxLength={600} placeholder="Qué incluye la oferta" style={{ minHeight: 88 }} />
            <Rotulo texto="Condiciones (opcional)" />
            <Campo value={f.condiciones} onChangeText={cambiar('condiciones')} maxLength={400} placeholder="Ej. Hasta agotar existencias." />
          </Seccion>

          <Seccion titulo="Color">
            <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
              {ACENTOS_DE_OFERTA.map((a) => (
                <Pressable key={a.valor} accessibilityRole="radio" accessibilityState={{ selected: f.acento === a.valor }} accessibilityLabel={a.rotulo}
                  onPress={() => { Haptics.selectionAsync().catch(() => {}); cambiar('acento')(a.valor); }} hitSlop={6}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colorDeAcento(a.valor), borderWidth: f.acento === a.valor ? 3 : 0, borderColor: '#fff' }} />
              ))}
            </View>
          </Seccion>

          {deDescuento ? (
            <Seccion titulo="Sigue al descuento">
              <Dato primero rotulo="Fechas" valor={`${fechaTexto(oferta.inicio, { day: 'numeric', month: 'short' })} – ${fechaTexto(oferta.fin, { day: 'numeric', month: 'short' })}`} />
              <Dato rotulo="Salas" valor={oferta.branch_ids?.length ? oferta.branch_ids.map(nombreSala).filter(Boolean).join(', ') : 'Todas'} />
              {oferta.descuento_tipo ? <Dato rotulo="Descuento" valor={etiquetaDeDescuento(oferta.descuento_tipo, oferta.descuento_monto)} /> : null}
              {productos.map((p, i) => <Dato key={`${p.nombre}-${i}`} rotulo={p.nombre} valor={p.precio != null ? formatMoney(p.precio) : '—'} />)}
            </Seccion>
          ) : (
            <>
              <Seccion titulo="Fechas">
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Desde</Text>
                  <Fecha valor={f.inicio} onCambiar={cambiar('inicio')} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Hasta</Text>
                  <Fecha valor={f.fin} onCambiar={cambiar('fin')} desde={f.inicio} />
                </View>
                {f.fin < f.inicio ? <Aviso tono="cuidado" texto="La fecha final es anterior a la inicial." /> : null}
              </Seccion>
              <Seccion titulo="Salas" pie={f.branch_ids.length ? null : 'Sin ninguna elegida, vale en todas.'}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {salas.map((s) => {
                    const on = f.branch_ids.includes(s.id);
                    return (
                      <Pressable key={s.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); alternarSala(s.id); }}
                        style={{ paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: on ? MARCA.azul : 'rgba(127,127,127,0.18)' }}>
                        <Text style={{ color: on ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{s.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Seccion>
            </>
          )}

          <Seccion>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Exclusiva para socios</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Todos la ven anunciada; el detalle, sólo los del programa de puntos.</Text>
              </View>
              <Switch value={f.exclusiva} onValueChange={cambiar('exclusiva')} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Publicada</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Se ve en la app mientras hoy esté entre sus fechas.</Text>
              </View>
              <Switch value={f.publicada} onValueChange={cambiar('publicada')} />
            </View>
          </Seccion>

          <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} onPress={guardar} deshabilitado={!valido || guardando} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
