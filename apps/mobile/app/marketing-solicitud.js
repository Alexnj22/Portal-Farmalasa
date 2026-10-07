// Pedirle una pieza al diseñador, NATIVO — `SolicitudModal` (la mitad de
// pedir): para redes o impresa; qué se necesita, el detalle, la marca, el
// formato (y el tamaño si es impresa), para cuándo y la prioridad. Lo manda
// `crearSolicitud` del núcleo, la misma del portal, y el diseñador recibe el
// aviso. Guarda borrador como el portal.
import { volver } from '../componentes/volver';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { crearSolicitud, fetchCatalogos } from '@nucleo/data/marketing';
import { FORMATOS, FORMATOS_IMPRESOS, PRIORIDADES, tamanosDe } from '@nucleo/utils/marketing';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hoySV } from '@nucleo/utils/fecha';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import Fecha from '../componentes/formulario/Fecha';
import { fallo, listo } from '../componentes/Progreso';

const BORRADOR = 'marketing_solicitud_nueva';
const VACIA = { tipo: 'digital', titulo: '', descripcion: '', marca_id: '', formato: '', tamano: '', fecha_deseada: '', prioridad: 'normal' };

function Fila({ titulo, valor, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{titulo}</Text>
      <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{valor} ›</Text>
    </Pressable>
  );
}
const elegir = (titulo, lista, onElegir) => {
  const opciones = [...lista.map((x) => x.label), 'Cancelar'];
  ActionSheetIOS.showActionSheetWithOptions({ title: titulo, options: opciones, cancelButtonIndex: opciones.length - 1 }, (i) => { if (i < lista.length) onElegir(lista[i].value); });
};

export default function PedirAlDisenador() {
  const { user } = useAuth();
  const [form, setForm] = useState(VACIA);
  const [marcas, setMarcas] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const repuesto = useRef(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => { fetchCatalogos().then((c) => setMarcas((c.marcas || []).filter((m) => m.activo))).catch(() => {}); }, []);
  useEffect(() => {
    if (repuesto.current) return;
    repuesto.current = true;
    const b = loadDraft(BORRADOR);
    if (b?.titulo) Alert.alert('Solicitud sin enviar', `«${b.titulo}»`, [{ text: 'Descartar', style: 'destructive', onPress: () => clearDraft(BORRADOR) }, { text: 'Seguirla', onPress: () => setForm({ ...VACIA, ...b }) }]);
  }, []);
  useEffect(() => { if (form.titulo || form.descripcion) saveDraft(BORRADOR, form); }, [form]);

  const impreso = form.tipo === 'impreso';
  const falta = !form.titulo.trim() || (impreso && (!form.formato || !form.tamano?.trim()));
  const formatos = impreso ? FORMATOS_IMPRESOS : FORMATOS;
  const enviar = async () => {
    setEnviando(true);
    try { await crearSolicitud(form, user?.id); clearDraft(BORRADOR); listo('Solicitud enviada', 'El diseñador recibe el aviso.'); volver('/marketing'); }
    catch (e) { fallo('No se pudo enviar', mensajeAmigable(e, 'Intenta de nuevo.')); }
    finally { setEnviando(false); }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pedir un diseño', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Seccion titulo="Tipo de pieza">
            <Opciones valor={form.tipo} onCambiar={(v) => setForm((f) => ({ ...f, tipo: v, formato: '', tamano: '' }))} opciones={[{ id: 'digital', label: 'Para redes' }, { id: 'impreso', label: 'Impreso' }]} />
          </Seccion>
          <Seccion titulo="Qué necesitas">
            <Campo multiline={false} value={form.titulo} onChangeText={set('titulo')} placeholder="Ej. Banner de la promoción de Ensure" />
            <Campo value={form.descripcion} onChangeText={set('descripcion')} placeholder="Detalle: textos, precios, fotos que usar…" style={{ minHeight: 90 }} />
          </Seccion>
          <Seccion>
            <Fila titulo="Marca" valor={marcas.find((m) => String(m.id) === String(form.marca_id))?.nombre || 'Sin marca'} onPress={() => elegir('Marca', [{ value: '', label: 'Sin marca' }, ...marcas.map((m) => ({ value: m.id, label: m.nombre }))], set('marca_id'))} />
            <Fila titulo="Formato" valor={formatos.find((f) => f.value === form.formato)?.label || (impreso ? 'Elegir' : 'Sin formato')} onPress={() => elegir('Formato', formatos, (v) => setForm((f) => ({ ...f, formato: v, tamano: '' })))} />
            {impreso && form.formato ? (
              <>
                {tamanosDe(form.formato).length ? <Fila titulo="Tamaño" valor={form.tamano || 'Elegir'} onPress={() => elegir('Tamaño', tamanosDe(form.formato).map((t) => ({ value: t, label: t })), set('tamano'))} /> : null}
                <Campo multiline={false} value={form.tamano} onChangeText={set('tamano')} placeholder="O escribe el tamaño" />
              </>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Para cuándo</Text>
              {form.fecha_deseada ? <Fecha valor={form.fecha_deseada} onCambiar={set('fecha_deseada')} />
                : <Pressable onPress={() => set('fecha_deseada')(hoySV())}><Text style={{ color: colorSistema.acento, fontSize: 16 }}>Elegir</Text></Pressable>}
            </View>
            <Fila titulo="Prioridad" valor={PRIORIDADES.find((p) => p.value === form.prioridad)?.label} onPress={() => elegir('Prioridad', PRIORIDADES, set('prioridad'))} />
          </Seccion>
          <BotonGrande texto={enviando ? 'Enviando…' : 'Enviar al diseñador'} deshabilitado={falta || enviando} onPress={enviar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
