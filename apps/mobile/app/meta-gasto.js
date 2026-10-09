// Agregar un gasto por recuperar, NATIVO — `GastoModal` del portal: un gasto
// que se suma a la meta de una o varias salas, repartido en N meses desde el
// siguiente (nunca en un mes ya arrancado).
//
// El reparto y la conversión los hace el SERVIDOR: la vista previa se pide
// (`previewMetaGasto`), no se deduce. Antes de guardar se dice qué metas ya
// aprobadas vuelven a revisión. Se guarda solo como borrador mientras se
// escribe, igual que en el portal (son varias filas y la sesión de sala se
// cierra a los 5 minutos).
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { crearMetaGasto, fetchMetasRows, previewMetaGasto } from '@nucleo/data/metas';
import {
  MESES_PARA_RECUPERAR, SALAS_VENTA, mesesParaArrancarGasto, metasQueReabreElGasto, salasDelGasto,
  ymHoySV, ymLabel, ymLabelCorto, ymSumar,
} from '@nucleo/utils/metasUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';
import Tocable from '../componentes/Tocable';

const BORRADOR = 'meta_gasto';
const FILA_VACIA = { branchId: '', monto: '' };

function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

function Elegir({ rotulo, valor, onPress, primero }) {
  return (
    <Tocable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10, opacity: pressed ? 0.6 : 1,
        borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador })}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
      <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{valor}</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>
    </Tocable>
  );
}

const hoja = (titulo, opciones, onElegir) => ActionSheetIOS.showActionSheetWithOptions(
  { title: titulo, options: [...opciones.map((o) => o.label), 'Cancelar'], cancelButtonIndex: opciones.length },
  (i) => { if (i < opciones.length) onElegir(opciones[i].value); },
);

export default function MetaGasto() {
  const branches = useStaffStore((s) => s.branches);
  const ymActual = ymHoySV();
  const mesOpciones = useMemo(() => mesesParaArrancarGasto(ymActual), [ymActual]);
  const salaOpciones = useMemo(() => {
    const ids = new Set(SALAS_VENTA);
    return (branches || []).filter((b) => ids.has(b.id)).map((b) => ({ value: String(b.id), label: b.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [branches]);

  const [b] = useState(() => loadDraft(BORRADOR));
  const [concepto, setConcepto] = useState(b?.concepto ?? '');
  const [ym, setYm] = useState(b?.ym && b.ym > ymActual ? b.ym : ymSumar(ymActual, 1));
  const [meses, setMeses] = useState(b?.meses ?? '1');
  const [filas, setFilas] = useState(Array.isArray(b?.filas) && b.filas.length ? b.filas : [FILA_VACIA]);
  const [nota, setNota] = useState(b?.nota ?? '');
  const [preview, setPreview] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [metasPorClave, setMetasPorClave] = useState({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { saveDraft(BORRADOR, { concepto, ym, meses, filas, nota }); }, [concepto, ym, meses, filas, nota]);

  // El estado de las metas de los próximos meses: para decir cuáles reabre.
  useEffect(() => {
    let vivo = true;
    fetchMetasRows(Array.from({ length: 13 }, (_, i) => ymSumar(ymActual, i)))
      .then((rows) => {
        if (!vivo) return;
        const map = {};
        for (const r of rows) map[`${r.branch_id}|${r.year_month}`] = r.estado;
        setMetasPorClave(map);
      })
      .catch(() => { /* sin esto el aviso previo no sale; el servidor igual decide */ });
    return () => { vivo = false; };
  }, [ymActual]);

  const salasValidas = useMemo(() => salasDelGasto(filas), [filas]);
  const total = salasValidas.reduce((s, f) => s + f.monto, 0);
  const listoParaPreview = salasValidas.length > 0 && !!ym && Number(meses) > 0;

  // La vista previa se pide al servidor a cada cambio (barata: no escribe).
  useEffect(() => {
    if (!listoParaPreview) { setPreview(null); return undefined; }
    let vivo = true;
    setCargando(true);
    const t = setTimeout(() => {
      previewMetaGasto({ salas: salasValidas, ymInicio: ym, meses: Number(meses) })
        .then((p) => { if (vivo) { setPreview(p); setCargando(false); } })
        .catch(() => { if (vivo) { setPreview(null); setCargando(false); } });
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [listoParaPreview, ym, meses, salasValidas]);

  const reabre = useMemo(() => metasQueReabreElGasto(preview, metasPorClave), [preview, metasPorClave]);
  const valido = concepto.trim() && salasValidas.length > 0 && !!ym && Number(meses) > 0;
  const setFila = (i, cambio) => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
  const libres = (i) => salaOpciones.filter((o) => !filas.some((f, j) => j !== i && f.branchId === o.value));

  const guardar = () => {
    if (!valido) return;
    Alert.alert('Guardar el gasto',
      `${formatMoney(total)} se suma a la meta${reabre.length ? `. Vuelven a revisión: ${reabre.join(', ')}.` : '.'}`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Guardar', onPress: async () => {
          setGuardando(true);
          try {
            const res = await crearMetaGasto({ concepto: concepto.trim(), salas: salasValidas, ymInicio: ym, meses: Number(meses), nota }, { monto: total });
            clearDraft(BORRADOR);
            listo('Gasto cargado', `${formatMoney(total)} le agregan ${formatMoney(res?.venta_total ?? 0)} de meta${res?.metas_reabiertas ? `. ${res.metas_reabiertas} meta(s) volvieron a revisión.` : '.'}`);
            router.back();
          } catch (err) {
            fallo('No se pudo cargar el gasto', mensajeAmigable(err));
          } finally {
            setGuardando(false);
          }
        } },
      ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Agregar gasto', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
          contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Seccion titulo="El gasto">
            <Rotulo texto="¿Qué gasto es?" />
            <Campo multiline={false} value={concepto} onChangeText={setConcepto} placeholder="Ej. aire acondicionado" />
            <Elegir rotulo="Desde qué mes" valor={ymLabel(ym)} onPress={() => hoja('Desde qué mes', mesOpciones, setYm)} />
            <Elegir rotulo="Se recupera en" valor={MESES_PARA_RECUPERAR.find((o) => o.value === String(meses))?.label ?? meses}
              onPress={() => hoja('¿En cuántos meses?', MESES_PARA_RECUPERAR, setMeses)} />
          </Seccion>

          <Seccion titulo="Salas y cuánto le toca a cada una">
            {filas.map((f, i) => (
              <View key={i} style={{ gap: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0 }}>
                <Elegir primero rotulo="Sala" valor={salaOpciones.find((o) => o.value === f.branchId)?.label ?? 'Elegir'}
                  onPress={() => hoja('Sala', libres(i), (v) => setFila(i, { branchId: v }))} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Campo multiline={false} keyboardType="decimal-pad" value={String(f.monto)} onChangeText={(v) => setFila(i, { monto: v })} placeholder="Monto $0.00" style={{ flex: 1 }} />
                  {filas.length > 1 ? (
                    <Tocable hitSlop={8} onPress={() => setFilas((fs) => fs.filter((_, j) => j !== i))}>
                      <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600' }}>Quitar</Text>
                    </Tocable>
                  ) : null}
                </View>
              </View>
            ))}
            {filas.length < salaOpciones.length ? (
              <Tocable onPress={() => setFilas((fs) => [...fs, FILA_VACIA])}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>+ Otra sala</Text>
              </Tocable>
            ) : null}
            {total > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Total: ${formatMoney(total)}`}</Text> : null}
          </Seccion>

          {listoParaPreview ? (
            <Seccion titulo="Cómo se suma a las metas">
              {cargando || !preview ? <ActivityIndicator /> : (preview.cuotas || []).map((c) => (
                <View key={`${c.branch_id}-${c.year_month}`} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{`${ymLabelCorto(c.year_month)} · ${c.sala}`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`${formatMoney(c.monto_gasto)} → `}<Text style={{ color: MARCA.azulClaro, fontWeight: '700' }}>{formatMoney(c.monto_venta)}</Text></Text>
                </View>
              ))}
            </Seccion>
          ) : null}
          {reabre.length ? (
            <Aviso tono="cuidado" texto={`${reabre.length === 1 ? `La meta de ${reabre[0]} ya estaba aprobada.` : `Estas metas ya estaban aprobadas: ${reabre.join(', ')}.`} Al guardar vuelven a revisión y hay que confirmarlas y aprobarlas otra vez.`} />
          ) : null}

          <Seccion titulo="Nota (opcional)">
            <Campo value={nota} onChangeText={setNota} placeholder="Ej. se compró con el proveedor de siempre" />
          </Seccion>
          <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar gasto'} onPress={guardar} deshabilitado={!valido || guardando} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
