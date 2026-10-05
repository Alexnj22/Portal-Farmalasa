// Cierre de período, NATIVO — `CierrePeriodoView` para revisarlo: la cadena del
// remanente mes a mes (qué se paga, qué queda a favor y qué pasa al mes
// siguiente), con el interruptor entre el libro que se declara hoy y el
// declarable, y cada período con su estado, su desglose y si el libro se movió
// después de cerrarlo.
//
// La cadena sale del núcleo (`cierrePeriodo`), la misma fórmula del portal.
// Cerrar y reabrir congelan cifras fiscales con nombre y fecha: siguen en el
// portal, donde la contadora decide con el libro a la vista.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { fetchPeriodosFiscales } from '@nucleo/data/cierrePeriodo';
import { cadenaDelRemanente, derivoDelCierre, totalesDeLaCadena } from '@nucleo/utils/cierrePeriodo';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { etiquetaMes, fechaTexto } from '@nucleo/utils/fecha';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Dato } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

export default function CierrePeriodo() {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [declarable, setDeclarable] = useState(false);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    setError('');
    try { setFilas(await fetchPeriodosFiscales()); } catch (e) { setError(e?.message || 'No se pudo cargar'); setFilas([]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const cadena = useMemo(() => cadenaDelRemanente(filas, declarable), [filas, declarable]);
  const t = totalesDeLaCadena(cadena);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Cierre de período', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FilaDeKpis>
          <Kpi icono="Lock" rotulo="Cerrados" valor={String(t.cerrados)} color={MARCA.verde} apoyo={`${t.abiertos} sin cerrar`} />
          <Kpi icono="TrendingDown" rotulo="Sin arrastrar" valor={formatMoney(t.perdido)} color={t.perdido > 0 ? MARCA.rojo : MARCA.verde} apoyo={t.perdido > 0 ? 'se pierde si no se cierra' : 'nada'} />
        </FilaDeKpis>
        <Segmentos activa={declarable ? 'decl' : 'hoy'} onCambiar={(v) => setDeclarable(v === 'decl')} opciones={[{ id: 'hoy', label: 'El que se declara hoy' }, { id: 'decl', label: 'El declarable' }]} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : !cadena.length ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Sin períodos</Text>
        ) : [...cadena].reverse().map((f) => {
          const idx = cadena.indexOf(f);
          const siguiente = cadena[idx + 1];
          const paga = f.aPagar > 0;
          const cerrado = f.estado === 'cerrado';
          return (
            <View key={f.periodo} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={20} tinte={derivoDelCierre(f) ? 'rgba(240,68,56,0.12)' : undefined}>
                <View style={{ padding: 14, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{etiquetaMes(f.periodo)}</Text>
                    <Pildora texto={cerrado ? 'cerrado' : f.en_curso ? 'en curso' : 'abierto'} color={cerrado ? MARCA.verde : f.en_curso ? colorSistema.texto2 : MARCA.azulClaro} />
                  </View>
                  <Text style={{ color: paga ? MARCA.rojo : MARCA.verde, fontSize: 26, fontWeight: '800' }}>{formatMoney(paga ? f.aPagar : f.remanente)}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {`${paga ? 'a pagar' : 'remanente a favor'} · ${f.en_curso ? 'todavía no se cierra' : f.remanente > 0 && siguiente ? `pasa a ${etiquetaMes(siguiente.periodo)}` : 'no pasa nada al mes siguiente'}`}
                  </Text>
                  {cerrado ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Cerrado${f.cerrado_por ? ` por ${f.cerrado_por}` : ''}${f.cerrado_at ? ` el ${fechaTexto(String(f.cerrado_at).slice(0, 10))}` : ''}`}</Text> : null}
                  <View style={{ marginTop: 4 }}>
                    <Dato rotulo="Débito fiscal" valor={formatMoney(f.debito_fiscal)} />
                    <Dato rotulo="Crédito fiscal" valor={`− ${formatMoney(f.credito)}`} />
                    <Dato rotulo="Percepción pagada" valor={`− ${formatMoney(f.percepcion_pagada)}`} />
                    <Dato rotulo="Retención sufrida" valor={`− ${formatMoney(f.retencion_sufrida)}`} />
                    <Dato rotulo="Remanente que entra" valor={`− ${formatMoney(f.entra)}`} />
                  </View>
                  {f.es_inicial ? <Aviso tono="cuidado" texto="Es el primer mes que lleva el portal: su remanente que entra es cero por definición, no un resultado." /> : null}
                  {derivoDelCierre(f) ? <Aviso tono="freno" texto={`El libro se movió después de cerrarlo: débito ${formatMoney(f.deriva_debito)} · crédito ${formatMoney(f.deriva_credito)}. Si ya se presentó, esta diferencia no está declarada.`} /> : null}
                  {!cerrado && !f.en_curso && !f.puede_cerrarse && f.motivo_no_puede ? <Aviso texto={f.motivo_no_puede} /> : null}
                </View>
              </Vidrio>
            </View>
          );
        })}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Cerrar o reabrir (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/cierre-periodo', nombre: 'Cierre de período' } })} />
        </View>
      </ScrollView>
    </>
  );
}
