// Agregar una meta a mano, NATIVO — `MetaModal` del portal: el histórico que
// alguien tiene anotado, o la corrección del monto de una propuesta en
// revisión. `?sala=&ym=` la abre ya elegida.
//
// Antes de guardar dice qué va a pasar con la meta que ya existe en ese mes y
// esa sala (`situacionDeMetaManual`, núcleo — la misma regla del portal): si
// está esperando al gerente o ya es oficial del mes en curso, no se puede; si
// es de un mes cerrado, pide el motivo. El servidor tiene el candado igual.
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchMetasRows, guardarMetaManual } from '@nucleo/data/metas';
import { SALAS_VENTA, YM_INICIO_HISTORIA, situacionDeMetaManual, ymHoySV, ymLabel, ymSumar } from '@nucleo/utils/metasUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { fallo, listo } from '../componentes/Progreso';

function Eleccion({ rotulo, valor, opciones, onCambiar }) {
  const elegir = () => {
    Haptics.selectionAsync().catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions(
      { title: rotulo, options: [...opciones.map((o) => o.label), 'Cancelar'], cancelButtonIndex: opciones.length },
      (i) => { if (i < opciones.length) onCambiar(opciones[i].value); },
    );
  };
  const actual = opciones.find((o) => String(o.value) === String(valor));
  return (
    <Pressable onPress={elegir} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
      <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{actual?.label ?? 'Elegir'}  ›</Text>
    </Pressable>
  );
}

export default function MetaNueva() {
  const params = useLocalSearchParams();
  const ymActual = ymHoySV();
  const sucursales = useStaffStore((s) => s.branches);
  const [ym, setYm] = useState(params.ym || ymActual);
  const [sala, setSala] = useState(params.sala ? String(params.sala) : '');
  const [monto, setMonto] = useState('');
  const [nota, setNota] = useState('');
  const [estados, setEstados] = useState(null);
  const [guardando, setGuardando] = useState(false);

  // Del primer mes con ventas en el portal al mes que viene, el más reciente primero.
  const meses = useMemo(() => {
    const out = [];
    for (let c = ymSumar(ymActual, 1); c >= YM_INICIO_HISTORIA; c = ymSumar(c, -1)) out.push({ value: c, label: ymLabel(c) });
    return out;
  }, [ymActual]);
  const salas = useMemo(() => SALAS_VENTA.map((id) => ({
    value: String(id), label: (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? `Sala ${id}`,
  })).sort((a, b) => a.label.localeCompare(b.label)), [sucursales]);

  // El estado de cada meta existente, una vez: pocas filas.
  useEffect(() => {
    let vivo = true;
    fetchMetasRows(meses.map((m) => m.value))
      .then((rows) => { if (vivo) setEstados(Object.fromEntries(rows.map((r) => [`${r.branch_id}|${r.year_month}`, r.estado]))); })
      .catch(() => { if (vivo) setEstados({}); });   // sin la lectura, contesta el servidor
    return () => { vivo = false; };
  }, [meses]);

  const estado = sala && ym ? estados?.[`${sala}|${ym}`] : undefined;
  const sit = sala && ym && estados ? situacionDeMetaManual(estado, ym, ymActual) : null;
  const montoNum = parseFloat(String(monto).replace(/,/g, ''));
  const valido = ym && sala && Number.isFinite(montoNum) && montoNum > 0 && sit?.puede !== false && (!sit?.pideNota || !!nota.trim());

  const guardar = async () => {
    if (!valido || guardando) return;
    setGuardando(true);
    try {
      await guardarMetaManual({ branchId: sala, yearMonth: ym, monto: montoNum, nota }, { estadoPrevio: estado || 'sin meta', desde: 'app' });
      listo('Meta guardada', `${ymLabel(ym)} quedó con su meta registrada.`);
      router.back();
    } catch (e) {
      fallo('No se pudo guardar la meta', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Agregar meta', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Seccion>
            <Eleccion rotulo="Mes" valor={ym} opciones={meses} onCambiar={setYm} />
            <View style={{ borderTopWidth: 0.5, borderTopColor: colorSistema.separador }} />
            <Eleccion rotulo="Sala" valor={sala} opciones={salas} onCambiar={setSala} />
          </Seccion>
          {sit ? <Aviso tono={sit.tono === 'warning' ? 'cuidado' : 'nota'} texto={sit.texto} /> : null}
          <Seccion titulo="Monto de la meta">
            <Campo multiline={false} keyboardType="decimal-pad" value={monto} onChangeText={setMonto} placeholder="$0.00" style={{ fontSize: 22, fontWeight: '700' }} />
            {Number.isFinite(montoNum) && montoNum > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{formatMoney(montoNum)}</Text> : null}
          </Seccion>
          <Seccion titulo={sit?.pideNota ? 'Por qué se corrige (obligatorio)' : 'Nota (opcional)'}>
            <Campo value={nota} onChangeText={setNota} placeholder="De dónde sale el monto" style={{ minHeight: 70 }} />
          </Seccion>
          <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar meta'} onPress={guardar} deshabilitado={!valido || guardando} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
