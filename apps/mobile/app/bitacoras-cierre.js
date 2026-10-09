// Cierre de mes de las bitácoras, NATIVO — `bitacoras/TabCierre` del portal.
// `?sala=` la sucursal y `?fecha=` el día que se estaba mirando (arranca en el
// mes ANTERIOR: el mes en curso no se puede cerrar).
//
// Lo mismo que el portal: el resumen del mes (lecturas, limpieza, por área,
// calibraciones vencidas, renglones del libro sin receta), firmar y cerrar
// —un mes imperfecto SE PUEDE cerrar y el cierre guarda cuán imperfecto era;
// con renglones del libro sin receta, el motivo es obligatorio—, reabrir con
// motivo, la historia del mes, e imprimirlo (el mismo papel del núcleo,
// `armarHtmlDelMes`, por AirPrint o PDF, anotado como salida de datos).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cerrarMes, correrPeriodo, fetchCierres, fetchLibroPendientes, fetchMesImpreso, fetchResumenMes, periodoDe, reabrirMes } from '@nucleo/data/bitacoras';
import { armarHtmlDelMes } from '@nucleo/utils/bitacoraPapel';
import { registrarEgreso } from '@nucleo/data/egreso';
import { hoySV } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';
import { cumplimiento, nombreDelPeriodo, puedeFirmarElCierre, rotularCumplimiento, tonoDelCumplimiento } from '@nucleo/utils/cierreDeBitacoras';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import { Pildora } from '../componentes/avisos/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';
import { compartirPdf, imprimirPapel } from '../componentes/pdf';

const TONO = { success: MARCA.verde, warning: MARCA.ambar, danger: MARCA.rojo };

function Flecha({ texto, onPress, deshabilitado }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={deshabilitado} hitSlop={10} accessibilityRole="button"
      style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: deshabilitado ? 0.3 : 1, transform: [{ scale: pressed ? 0.9 : 1 }] })}>
      <Text style={{ color: MARCA.azulClaro, fontSize: 24, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

function PorArea({ titulo, filas, sinRegistrar }) {
  if (!filas?.length) return null;
  return (
    <Seccion titulo={titulo}>
      {filas.map((a, i) => (
        <View key={a.area_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 8 : 0 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{a.nombre}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${a.hechas} de ${a.esperadas} · ${a.tarde} fuera de hora`}</Text>
          </View>
          <Pildora texto={a.faltantes > 0 ? `${a.faltantes} ${sinRegistrar}` : 'Completa'} color={a.faltantes > 0 ? MARCA.ambar : MARCA.verde} />
        </View>
      ))}
    </Seccion>
  );
}

export default function CierreDeBitacoras() {
  const { sala, fecha } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeFirmar = hasPermission('bitacoras_cerrar_mes', 'can_edit');
  const puedeImprimir = hasPermission('bitacoras_descargar', 'can_view');
  const nombreSala = useStaffStore((s) => s.branches?.find((b) => String(b.id) === String(sala))?.name) || '';

  const [periodo, setPeriodo] = useState(() => correrPeriodo(periodoDe(fecha || hoySV()), -1));
  const [resumen, setResumen] = useState(null);
  const [cierres, setCierres] = useState([]);
  const [libroPend, setLibroPend] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [obs, setObs] = useState('');
  const [motivo, setMotivo] = useState('');
  const [reabriendo, setReabriendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!sala) return;
    setCargando(true);
    const [{ resumen: r }, { cierres: c }, { pendientes: p }] = await Promise.all([
      Promise.resolve(fetchResumenMes(sala, periodo)).catch(() => ({ resumen: null })),
      Promise.resolve(fetchCierres(sala)).catch(() => ({ cierres: [] })),
      Promise.resolve(fetchLibroPendientes(sala, periodo)).catch(() => ({ pendientes: 0 })),
    ]);
    setResumen(r ?? null); setCierres(c ?? []); setLibroPend(p ?? 0); setCargando(false);
  }, [sala, periodo]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial y al cambiar el mes

  const enCurso = periodo >= periodoDe(hoySV());
  const cerrado = Boolean(resumen?.cerrado);
  const historia = useMemo(() => cierres.filter((c) => c.periodo === periodo), [cierres, periodo]);
  const L = resumen?.lecturas;
  const Li = resumen?.limpiezas;
  const nombreMes = nombreDelPeriodo(periodo);

  const firmar = () => {
    const faltan = (L?.faltantes ?? 0) + (Li?.faltantes ?? 0);
    Alert.alert('Firmar y cerrar el mes', `${nombreMes} de ${nombreSala || 'la sucursal'} queda cerrado${faltan ? ` con ${faltan} registros sin anotar` : ''}.${libroPend ? ` Los ${libroPend} renglones del libro sin receta ya no se podrán completar sin reabrirlo.` : ''}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Firmar', onPress: async () => {
        setGuardando(true);
        const { error } = await Promise.resolve(cerrarMes({ branchId: sala, periodo, observaciones: obs })).catch((e) => ({ error: e?.message || 'No se pudo cerrar.' }));
        setGuardando(false);
        if (error) { fallo('No se pudo cerrar el mes', typeof error === 'string' ? error : error.message || ''); return; }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        listo('Mes cerrado y firmado', nombreMes);
        setObs(''); cargar();
      } },
    ]);
  };

  const reabrir = () => Alert.alert('Reabrir el mes', 'Queda registrado con quién, cuándo y por qué.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Reabrir', style: 'destructive', onPress: async () => {
      setGuardando(true);
      const { error } = await Promise.resolve(reabrirMes({ branchId: sala, periodo, motivo })).catch((e) => ({ error: e?.message || 'No se pudo reabrir.' }));
      setGuardando(false);
      if (error) { fallo('No se pudo reabrir', typeof error === 'string' ? error : error.message || ''); return; }
      listo('Mes reabierto', nombreMes);
      setMotivo(''); setReabriendo(false); cargar();
    } },
  ]);

  const imprimir = async (comoPdf) => {
    const { mes, error } = await Promise.resolve(fetchMesImpreso(sala, periodo)).catch((e) => ({ error: e }));
    if (error) { fallo('No se pudo armar el mes', error.message ?? ''); return; }
    // Sin logo: en el teléfono el papel sale con el nombre de la empresa en
    // texto, igual que el portal cuando el logo no llega.
    const html = armarHtmlDelMes(mes, null);
    try {
      const salio = comoPdf ? await compartirPdf({ html, nombre: `Bitácoras ${mes?.sucursal || nombreSala} ${nombreMes}` }) : (await imprimirPapel(html), true);
      if (salio) registrarEgreso('bitacoras', { formato: 'pdf', filas: mes?.areas?.length ?? null, detalle: { periodo, branch_id: sala, sucursal: mes?.sucursal ?? null, via: 'app' } });
    } catch (e) { fallo('No se imprimió', e?.message || ''); }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Cierre de mes', headerLargeTitle: true }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 60, gap: 14 }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
          <Seccion titulo={nombreSala || 'Sucursal'}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Flecha texto="‹" onPress={() => setPeriodo((p) => correrPeriodo(p, -1))} />
              <Text style={{ flex: 1, textAlign: 'center', color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{nombreMes}</Text>
              <Flecha texto="›" onPress={() => setPeriodo((p) => correrPeriodo(p, 1))} deshabilitado={periodo >= periodoDe(hoySV())} />
            </View>
            <View style={{ alignItems: 'center' }}>
              <Pildora texto={cerrado ? 'Mes cerrado y firmado' : enCurso ? 'Todavía en curso' : 'Sin cerrar'} color={cerrado ? MARCA.verde : enCurso ? colorSistema.texto2 : MARCA.ambar} />
            </View>
          </Seccion>

          {cargando ? <ActivityIndicator style={{ marginTop: 24 }} /> : !resumen ? (
            <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto="No se pudo calcular el resumen del mes." /></View>
          ) : resumen.sin_dias ? (
            <View style={{ marginHorizontal: 16 }}><Aviso texto="Ese mes es anterior a la puesta en marcha de las bitácoras." /></View>
          ) : (
            <>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginHorizontal: 32 }}>Lecturas de temperatura y humedad</Text>
              <FilaDeKpis>
                <Kpi icono="Thermometer" rotulo="Cumplimiento" valor={rotularCumplimiento(cumplimiento(L.hechas, L.esperadas))} color={TONO[tonoDelCumplimiento(cumplimiento(L.hechas, L.esperadas))] || MARCA.azulClaro} apoyo={`${L.hechas}/${L.esperadas} anotadas`} />
                <Kpi icono="AlertTriangle" rotulo="Faltantes" valor={String(L.faltantes)} color={L.faltantes > 0 ? MARCA.rojo : MARCA.verde} apoyo={`${L.tarde} fuera de hora · ${L.fuera_de_rango} fuera de rango`} />
              </FilaDeKpis>
              {L.sin_accion > 0 ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={`${L.sin_accion} ${L.sin_accion === 1 ? 'lectura fuera de rango' : 'lecturas fuera de rango'} sin acción correctiva anotada. Hay que completarlas antes de firmar: la norma pide investigar la desviación y dejar constancia de qué se hizo.`} /></View> : null}
              {L.fuera_de_plan > 0 ? <View style={{ marginHorizontal: 16 }}><Aviso texto={`${L.fuera_de_plan} ${L.fuera_de_plan === 1 ? 'lectura quedó' : 'lecturas quedaron'} fuera del plan del área (otro día u otra franja). Se anotaron y cuentan como trabajo hecho, pero no cierran un hueco del plan.`} /></View> : null}

              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginHorizontal: 32 }}>Limpieza y orden</Text>
              <FilaDeKpis>
                <Kpi icono="CheckCircle2" rotulo="Cumplimiento" valor={rotularCumplimiento(cumplimiento(Li.hechas, Li.esperadas))} color={TONO[tonoDelCumplimiento(cumplimiento(Li.hechas, Li.esperadas))] || MARCA.azulClaro} apoyo={`${Li.hechas}/${Li.esperadas} registradas`} />
                <Kpi icono="AlertTriangle" rotulo="Faltantes" valor={String(Li.faltantes)} color={Li.faltantes > 0 ? MARCA.rojo : MARCA.verde} />
              </FilaDeKpis>
              {(resumen.limpieza_por_area || []).length > 1 ? <PorArea titulo="Limpieza por área" filas={resumen.limpieza_por_area} sinRegistrar="sin registrar" /> : null}

              {(resumen.calibracion_vencida || []).length ? (
                <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={`Hay instrumentos con la calibración vencida: ${resumen.calibracion_vencida.map((c) => `${c.area}${c.instrumento ? ` (${c.instrumento})` : ''}`).join(', ')}. Un termómetro sin certificado vigente invalida las lecturas que tomó.`} /></View>
              ) : null}
              <PorArea titulo="Por área" filas={resumen.por_area} sinRegistrar="sin anotar" />

              {!cerrado && !enCurso && puedeFirmar ? (
                <Seccion titulo={`Dar por finalizado ${nombreMes.toLowerCase()}`}>
                  {L.faltantes + Li.faltantes > 0 ? <Aviso tono="cuidado" texto={`El mes se puede cerrar así, y el cierre va a guardar que quedaron ${L.faltantes + Li.faltantes} registros sin anotar. Es a propósito: un cierre que exige perfección enseña a inventar las lecturas que faltan.`} /> : null}
                  {libroPend > 0 ? <Aviso tono="freno" texto={`En el libro quedan ${libroPend} ${libroPend === 1 ? 'renglón' : 'renglones'} esperando la receta. Al cerrar el mes ya no se pueden completar sin volver a abrirlo; si la receta no va a llegar, escribe abajo por qué se cierra así.`} /> : null}
                  <Campo value={obs} onChangeText={setObs} placeholder={libroPend > 0 ? 'Por qué se cierra con renglones sin completar' : 'Observaciones del regente (opcional)'} />
                  <BotonGrande texto={guardando ? 'Cerrando…' : 'Firmar y cerrar el mes'} onPress={firmar} deshabilitado={guardando || !puedeFirmarElCierre(libroPend, obs)} />
                </Seccion>
              ) : null}
              {!cerrado && !enCurso && !puedeFirmar ? <View style={{ marginHorizontal: 16 }}><Aviso texto="El mes lo da por finalizado el regente. Aquí puedes revisar cómo va." /></View> : null}

              {cerrado && puedeFirmar ? (
                <Seccion titulo="Reabrir" pie="Reabrir un mes firmado queda registrado: con quién, cuándo y por qué.">
                  {reabriendo ? (
                    <>
                      <Campo value={motivo} onChangeText={setMotivo} placeholder="Por qué se reabre (p. ej. apareció el registro en papel del 12)" />
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={{ flex: 1 }}><BotonGrande texto="Cancelar" borde onPress={() => setReabriendo(false)} deshabilitado={guardando} /></View>
                        <View style={{ flex: 1 }}><BotonGrande texto="Reabrir" color={MARCA.ambar} onPress={reabrir} deshabilitado={guardando || !motivo.trim()} /></View>
                      </View>
                    </>
                  ) : <BotonGrande texto="Reabrir el mes" borde color={MARCA.ambar} onPress={() => setReabriendo(true)} />}
                </Seccion>
              ) : null}

              {puedeImprimir ? (
                <Seccion titulo="Imprimir el mes" pie="La grilla, la limpieza y el libro del mes en un solo papel.">
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}><BotonGrande texto="AirPrint" borde onPress={() => imprimir(false)} /></View>
                    <View style={{ flex: 1 }}><BotonGrande texto="Compartir PDF" borde onPress={() => imprimir(true)} /></View>
                  </View>
                </Seccion>
              ) : null}

              {historia.length ? (
                <Seccion titulo="Qué pasó con este mes">
                  {historia.map((c) => (
                    <Text key={c.id} style={{ color: colorSistema.texto2, fontSize: 14 }}>
                      {`${c.accion === 'cerrar' ? 'Cerrado' : 'Reabierto'} · ${fechaHora12(c.created_at, { day: '2-digit', month: 'short', year: 'numeric' })}${c.motivo ? ` · ${c.motivo}` : ''}`}
                    </Text>
                  ))}
                </Seccion>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
