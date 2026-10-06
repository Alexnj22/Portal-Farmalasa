// Una sala en el mes en curso, NATIVO — lo que el portal muestra al elegir la
// sala en el Tablero de Metas: «Cómo va el mes» (día por día contra el ritmo,
// o el termómetro con lo que falta por día), el ranking de sus vendedores y de
// dónde sale su meta. Todo de lectura.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchMesEnCurso, fetchMetasRows } from '@nucleo/data/metas';
import { ymHoySV, ymLabel } from '@nucleo/utils/metasUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso } from '../../componentes/formulario/Piezas';
import { GraficaDelMes, Ranking } from '../../componentes/metas/Mes';
import Explicacion from '../../componentes/metas/Explicacion';

export default function MetaSala() {
  const { id, ym: ymParam } = useLocalSearchParams();
  const ym = String(ymParam || ymHoySV());
  const sala = useStaffStore((s) => (s.branches || []).find((b) => String(b.id) === String(id)));
  const [mes, setMes] = useState(undefined);
  const [fila, setFila] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const cargar = useCallback(async () => {
    try {
      const [m, filas] = await Promise.all([fetchMesEnCurso(id), fetchMetasRows([ym]).catch(() => [])]);
      setMes(m ?? null);
      setFila((filas || []).find((f) => String(f.branch_id) === String(id)) ?? null);
      setError(null);
    } catch (e) { setError(mensajeAmigable(e, 'Error al cargar la sala')); setMes(null); }
  }, [id, ym]);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: sala?.name ?? 'Sala', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center' }}>{ymLabel(ym)}</Text>
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {mes === undefined && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
        {mes ? (
          <>
            <GraficaDelMes data={mes} />
            <Ranking data={mes} />
          </>
        ) : mes === null && !error ? <Aviso tono="nota" texto="Esta sala todavía no tiene ventas este mes." /> : null}
        {fila?.monto_meta != null || fila?.monto_propuesto != null ? (
          <Explicacion branchId={id} yearMonth={ym} montoPropuesto={fila?.monto_propuesto ?? null} />
        ) : null}
      </ScrollView>
    </>
  );
}
