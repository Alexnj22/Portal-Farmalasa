// La pauta de una pieza, NATIVO — `PautaModal`: lo que se invierte (objetivo,
// redes, público, presupuesto y fechas) y lo que trajo (gastado, alcance,
// impresiones, interacciones, mensajes, clics). Un resultado vacío es «todavía
// no se anotó», no cero: `guardarPauta` del núcleo lo guarda así. El
// presupuesto no puede pasar el tope del mes (lo fija gerencia).
import { volver } from 'componentes/volver';
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { fetchCatalogos, fetchPiezas, guardarPauta, quitarPauta } from '@nucleo/data/marketing';
import { asignadoEnPauta, OBJETIVOS_PAUTA } from '@nucleo/utils/marketing';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import Fecha from '../componentes/formulario/Fecha';
import { MARCA } from '../componentes/inicio/marca';
import { guardarPieza as recordarPieza, piezaElegida } from '../componentes/marketing/elegida';
import { fallo, listo } from '../componentes/Progreso';

const CAMPOS = ['redes', 'objetivo', 'publico', 'presupuesto', 'fecha_inicio', 'fecha_fin', 'gastado', 'alcance', 'impresiones', 'interacciones', 'mensajes', 'clics', 'notas'];
const RESULTADOS = [['gastado', 'Gastado ($)'], ['alcance', 'Alcance'], ['impresiones', 'Impresiones'], ['interacciones', 'Interacciones'], ['mensajes', 'Mensajes'], ['clics', 'Clics']];
const desde = (pauta, pieza) => Object.fromEntries(CAMPOS.map((k) => {
  const v = pauta?.[k];
  if (k === 'redes') return [k, v?.length ? v : (pieza?.redes || [])];
  if (k === 'fecha_inicio' && !v) return [k, pieza?.fecha || ''];
  return [k, v == null ? '' : String(v)];
}));

function Numero({ titulo, valor, onCambiar }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{titulo}</Text>
      <TextInput value={valor} onChangeText={onCambiar} keyboardType="decimal-pad" placeholder="—" placeholderTextColor={colorSistema.placeholder}
        style={{ minWidth: 110, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(127,127,127,0.14)', color: colorSistema.texto, fontSize: 16, textAlign: 'right' }} />
    </View>
  );
}

export default function PautaDePieza() {
  const sel = piezaElegida();
  const pieza = sel?.pieza;
  const [form, setForm] = useState(() => desde(pieza?.pauta, pieza));
  const [redes, setRedes] = useState([]);
  const [otros, setOtros] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const limite = Number(sel?.mes?.presupuesto_pauta) || 0;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    fetchCatalogos().then((c) => setRedes((c.redes || []).filter((r) => r.activo))).catch(() => {});
    if (sel?.mes?.id) fetchPiezas(sel.mes.id).then((ps) => setOtros(asignadoEnPauta(ps, pieza?.id))).catch(() => {});
  }, [sel?.mes?.id, pieza?.id]);
  const libre = limite - otros - (Number(form.presupuesto) || 0);
  const pasado = libre < 0 && Number(form.presupuesto) > 0;
  const nombreRedes = useMemo(() => redes.filter((r) => form.redes.includes(r.clave)).map((r) => r.nombre).join(', ') || 'Elegir', [redes, form.redes]);

  if (!pieza) return <Aviso tono="freno" texto="No se encontró la pieza." />;
  const elegirRed = () => {
    const opciones = [...redes.map((r) => `${form.redes.includes(r.clave) ? '✓ ' : ''}${r.nombre}`), 'Listo'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Dónde se pauta', options: opciones, cancelButtonIndex: opciones.length - 1 }, (i) => {
      if (i >= redes.length) return;
      const c = redes[i].clave;
      setForm((f) => ({ ...f, redes: f.redes.includes(c) ? f.redes.filter((x) => x !== c) : [...f.redes, c] }));
    });
  };
  const guardar = async () => {
    setGuardando(true);
    try { const pauta = await guardarPauta(pieza.id, form); recordarPieza({ ...pieza, pauta, pautar: true }, sel.mes, sel.firmas); listo('Pauta guardada', pieza.titulo); volver('/marketing'); }
    catch (e) { fallo('No se pudo guardar la pauta', mensajeAmigable(e, 'Revisa los montos e intenta de nuevo.')); }
    finally { setGuardando(false); }
  };
  const quitar = () => Alert.alert('Quitar la pauta', 'La pieza deja de pautarse y libera su presupuesto.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', style: 'destructive', onPress: async () => {
      try { await quitarPauta(pieza.id); recordarPieza({ ...pieza, pauta: null }, sel.mes, sel.firmas); listo('Pauta quitada', ''); volver('/marketing'); }
      catch (e) { fallo('No se pudo quitar', mensajeAmigable(e, '')); }
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pauta', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '700' }}>{pieza.titulo}</Text>
          <Seccion titulo="El plan" pie={limite ? `Presupuesto del mes ${formatMoney(limite)} · otras piezas ${formatMoney(otros)} · queda ${formatMoney(Math.max(libre, 0))}` : 'Gerencia todavía no fija el presupuesto del mes.'}>
            <Pressable onPress={() => {
              const opciones = [...OBJETIVOS_PAUTA.map((o) => o.label), 'Cancelar'];
              ActionSheetIOS.showActionSheetWithOptions({ title: 'Objetivo', options: opciones, cancelButtonIndex: opciones.length - 1 }, (i) => { if (i < OBJETIVOS_PAUTA.length) set('objetivo')(OBJETIVOS_PAUTA[i].value); });
            }} style={{ flexDirection: 'row', minHeight: 44, alignItems: 'center' }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Objetivo</Text>
              <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{OBJETIVOS_PAUTA.find((o) => o.value === form.objetivo)?.label || 'Elegir'} ›</Text>
            </Pressable>
            <Pressable onPress={elegirRed} style={{ flexDirection: 'row', minHeight: 44, alignItems: 'center' }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Redes</Text>
              <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{nombreRedes} ›</Text>
            </Pressable>
            <Numero titulo="Presupuesto ($)" valor={form.presupuesto} onCambiar={set('presupuesto')} />
            {pasado ? <Aviso tono="cuidado" texto="Se pasa del presupuesto del mes." /> : null}
            <Campo multiline={false} value={form.publico} onChangeText={set('publico')} placeholder="Público (edad, zona, intereses)" />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Desde</Text>
              <Fecha valor={form.fecha_inicio || pieza.fecha} onCambiar={set('fecha_inicio')} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Hasta</Text>
              {form.fecha_fin ? <Fecha valor={form.fecha_fin} onCambiar={set('fecha_fin')} desde={form.fecha_inicio} />
                : <Pressable onPress={() => set('fecha_fin')(form.fecha_inicio || pieza.fecha)}><Text style={{ color: colorSistema.acento, fontSize: 16 }}>Elegir</Text></Pressable>}
            </View>
          </Seccion>
          <Seccion titulo="Lo que trajo" pie="Vacío es «todavía no se anotó», no cero.">
            {RESULTADOS.map(([k, t]) => <Numero key={k} titulo={t} valor={form[k]} onCambiar={set(k)} />)}
            <Campo value={form.notas} onChangeText={set('notas')} placeholder="Notas" />
          </Seccion>
          <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar la pauta'} deshabilitado={guardando || pasado} onPress={guardar} />
          {pieza.pauta ? <BotonGrande borde color={MARCA.rojo} texto="Quitar la pauta" onPress={quitar} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
