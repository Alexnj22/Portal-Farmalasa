// La configuración global de Mín·Máx, NATIVA — los dos paneles del portal
// (`tabminmax/ConfigPanel` y `tabminmax/LabsPanel`):
//   · Parámetros: el ciclo, los días de reorden y el buffer por clase XYZ, los
//     umbrales ABC y XYZ, la alerta «próximo a mínimo» y el corte de ventas
//     atípicas. Validación y escritura del núcleo (`configMinMax`,
//     `updateStockConfig`, que anota en la bitácora).
//   · Laboratorios: cuáles se ocultan de Mín·Máx (al mostrar uno se
//     desocultan sus productos), con cuántos productos activos tiene cada uno.
//
// Pide `minmax.can_edit` con alcance de TODA la red, igual que el portal. Y la
// confirmación es fuerte a propósito: el reorden es plano (CLAUDE.md §MIN·MAX),
// así que estos números reescriben el MIN·MAX de TODO el catálogo, en todas
// las salas, en el próximo cálculo.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchStockConfigFull, updateStockConfig } from '@nucleo/data/stockParams';
import { cambiarVisibilidadLaboratorioMinMax, fetchActiveProductLabCounts, fetchLaboratoriosMinMaxVisibility } from '@nucleo/data/minmaxLabs';
import { usuarioDeLaSesion } from '@nucleo/data/auth';
import { SECCIONES_CONFIG_MINMAX, cambiaElCatalogo, payloadDeConfigMinMax, validarConfigMinMax } from '@nucleo/utils/configMinMax';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import Segmentos from '../componentes/Segmentos';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';

function Parametros({ puede }) {
  const [orig, setOrig] = useState(null);
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    Promise.resolve(fetchStockConfigFull()).then(({ data }) => { setOrig(data ?? {}); setForm(data ?? {}); }).catch((e) => fallo('No se pudo cargar', mensajeAmigable(e)));
  }, []);
  if (!form) return <ActivityIndicator style={{ marginTop: 30 }} />;
  const motivo = validarConfigMinMax(form);
  const cambio = SECCIONES_CONFIG_MINMAX.some((s) => s.campos.some((c) => Number(form[c.k]) !== Number(orig[c.k])));

  const escribir = async () => {
    setGuardando(true);
    try {
      const user = await usuarioDeLaSesion();
      const payload = payloadDeConfigMinMax(form, user?.email ?? null);
      const { error } = await updateStockConfig(payload);
      if (error) throw error;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setOrig({ ...orig, ...payload });
      listo('Configuración guardada', 'Recalcula las salas para aplicarla.');
    } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); } finally { setGuardando(false); }
  };
  const guardar = () => {
    const todo = cambiaElCatalogo(orig, form);
    const cambios = SECCIONES_CONFIG_MINMAX.flatMap((s) => s.campos).filter((c) => Number(form[c.k]) !== Number(orig[c.k]))
      .map((c) => `${c.label}: ${orig[c.k]} → ${form[c.k]}`).join('\n');
    Alert.alert(todo ? '⚠️ Esto reescribe TODO el catálogo' : 'Guardar la configuración',
      `${todo ? 'El reorden es el mismo para todos los productos: este cambio reescribe el MIN·MAX de TODOS los productos, en TODAS las salas, en el próximo cálculo. No se deshace solo.\n\n' : ''}${cambios}`,
      [{ text: 'Cancelar', style: 'cancel' }, { text: todo ? 'Sí, reescribir el catálogo' : 'Guardar', style: todo ? 'destructive' : 'default', onPress: todo
        ? () => Alert.alert('¿Seguro?', 'Confirma otra vez: el MIN·MAX de todo el catálogo va a cambiar.', [{ text: 'No', style: 'cancel' }, { text: 'Sí, guardar', style: 'destructive', onPress: escribir }])
        : escribir }]);
  };

  return (
    <View style={{ gap: 16, marginHorizontal: 16 }}>
      <Aviso tono="cuidado" texto="Estos números valen para todo el catálogo y todas las salas: el MIN·MAX de cada producto se recalcula con ellos." />
      {SECCIONES_CONFIG_MINMAX.map((s) => (
        <Seccion key={s.titulo} titulo={s.titulo} pie={s.nota ?? null}>
          {s.campos.map((c, i) => (
            <View key={c.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 8 : 0 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{c.label}</Text>
              <View style={{ width: 76 }}><Campo multiline={false} keyboardType="number-pad" editable={puede} value={String(form[c.k] ?? '')} style={{ textAlign: 'right' }}
                onChangeText={(t) => setForm((f) => ({ ...f, [c.k]: t.replace(/[^\d.]/g, '') }))} /></View>
              <Text style={{ width: 34, color: colorSistema.texto2, fontSize: 12 }}>{c.unit}</Text>
            </View>
          ))}
        </Seccion>
      ))}
      {cambio && motivo ? <Aviso tono="freno" texto={motivo} /> : null}
      {puede ? <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} color={MARCA.rojo} deshabilitado={guardando || !cambio || !!motivo} onPress={guardar} /> : <Aviso texto="Cambiar la configuración pide Mín·Máx con alcance de toda la red." />}
    </View>
  );
}

function Laboratorios({ puede }) {
  const [labs, setLabs] = useState(null);
  const [cuentas, setCuentas] = useState({});
  const [busca, setBusca] = useState('');
  const [ocupado, setOcupado] = useState(null);
  useEffect(() => {
    Promise.all([fetchLaboratoriosMinMaxVisibility(), fetchActiveProductLabCounts()]).then(([{ data: l }, { data: c }]) => {
      setLabs(l ?? []);
      setCuentas(Object.fromEntries((c ?? []).map((r) => [r.laboratorio_id, Number(r.product_count)])));
    }).catch((e) => { fallo('No se pudo cargar', mensajeAmigable(e)); setLabs([]); });
  }, []);
  const visibles = useMemo(() => (busca.trim() ? (labs ?? []).filter((l) => tokenMatch(busca, l.nombre)) : (labs ?? [])), [labs, busca]);
  if (!labs) return <ActivityIndicator style={{ marginTop: 30 }} />;
  const ocultos = labs.filter((l) => l.ocultar_en_minmax).length;
  const alternar = (lab) => {
    const ocultar = !lab.ocultar_en_minmax;
    Alert.alert(ocultar ? 'Ocultar de Mín·Máx' : 'Mostrar en Mín·Máx', `${lab.nombre}${ocultar ? ': sus productos dejan de verse en Mín·Máx.' : ': sus productos vuelven a verse, también los ocultos uno por uno.'}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: ocultar ? 'Ocultar' : 'Mostrar', onPress: async () => {
        setOcupado(lab.id);
        const { error, errorDesocultar } = await cambiarVisibilidadLaboratorioMinMax(lab.id, ocultar, { lab: lab.nombre, desde: 'app' });
        setOcupado(null);
        if (error) { fallo('No se pudo', mensajeAmigable(error)); return; }
        if (errorDesocultar) fallo('A medias', `Algunos productos no se pudieron desocultar: ${errorDesocultar.message}`);
        setLabs((ls) => ls.map((l) => (l.id === lab.id ? { ...l, ocultar_en_minmax: ocultar } : l)));
      } },
    ]);
  };
  return (
    <View style={{ gap: 12, marginHorizontal: 16 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>{`${ocultos} de ${labs.length} laboratorios ocultos en Mín·Máx`}</Text>
      <Campo multiline={false} value={busca} onChangeText={setBusca} placeholder="Buscar laboratorio" />
      <Seccion>
        {visibles.map((l, i) => (
          <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: l.ocultar_en_minmax ? colorSistema.texto2 : colorSistema.texto, fontSize: 15 }}>{l.nombre}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${cuentas[l.id] ?? 0} productos activos${l.ocultar_en_minmax ? ' · oculto' : ''}`}</Text>
            </View>
            <Switch value={!l.ocultar_en_minmax} disabled={!puede || ocupado === l.id} onValueChange={() => alternar(l)} />
          </View>
        ))}
      </Seccion>
    </View>
  );
}

export default function ConfiguracionMinMax() {
  const { hasPermission, getScope } = useAuth();
  const puede = hasPermission('minmax', 'can_edit') && getScope?.('minmax') === 'ALL';
  const [vista, setVista] = useState('parametros');
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Configuración Mín·Máx', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 10, paddingBottom: 48, gap: 14 }} keyboardDismissMode="interactive">
        <Segmentos activa={vista} onCambiar={setVista} opciones={[{ id: 'parametros', label: 'Parámetros' }, { id: 'labs', label: 'Laboratorios' }]} />
        {vista === 'parametros' ? <Parametros puede={puede} /> : <Laboratorios puede={puede} />}
      </ScrollView>
    </>
  );
}
