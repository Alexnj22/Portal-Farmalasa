// Cierre de período, NATIVO — `CierrePeriodoView` para revisarlo: la cadena del
// remanente mes a mes (qué se paga, qué queda a favor y qué pasa al mes
// siguiente), con el interruptor entre el libro que se declara hoy y el
// declarable, y cada período con su estado, su desglose y si el libro se movió
// después de cerrarlo.
//
// La cadena sale del núcleo (`cierrePeriodo`), la misma fórmula del portal,
// y arriba se dibuja como en el portal: «El remanente, mes a mes», un eslabón
// por mes en un carrusel horizontal.
//
// Cerrar congela las cifras con nombre y fecha (`cerrarPeriodoFiscal`, con
// confirmación) y reabrir exige un motivo que queda en la bitácora del período
// (`reabrirPeriodoFiscal`). Las dos con `libros_iva` · editar, como el portal;
// si un período no se puede cerrar, el motivo lo dice el servidor.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { cerrarPeriodoFiscal, fetchPeriodosFiscales, reabrirPeriodoFiscal } from '@nucleo/data/cierrePeriodo';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { cadenaDelRemanente, derivoDelCierre, totalesDeLaCadena } from '@nucleo/utils/cierrePeriodo';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { etiquetaMes, fechaTexto, NOMBRES_DE_MES } from '@nucleo/utils/fecha';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Dato } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';

const mesCorto = (iso) => NOMBRES_DE_MES[Number(String(iso).slice(5, 7)) - 1];

// Cuánto más crédito trae el libro declarable que el de hoy (el portal lo
// anota debajo del crédito cuando se mira el declarable).
const deltaCred = (f) => Math.round((Number(f.credito_declarable || 0) - Number(f.credito_fiscal || 0)) * 100) / 100;

export default function CierrePeriodo() {
  const canEdit = useAuth().hasPermission('libros_iva', 'can_edit');
  const [busy, setBusy] = useState(false);
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

  const cerrar = (f) => Alert.alert(`¿Cerrar ${etiquetaMes(f.periodo)}?`,
    `Congela estas cifras con tu nombre y la fecha. ${f.aPagar > 0 ? `A pagar ${formatMoney(f.aPagar)}.` : `El mes siguiente arranca de ${formatMoney(f.remanente)} a favor.`}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar', onPress: async () => {
        setBusy(true);
        try {
          await cerrarPeriodoFiscal(f.periodo, null, null, { debito: f.debito_fiscal, credito: f.credito, a_pagar: f.aPagar, remanente: f.remanente, desde: 'app' });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          listo('Período cerrado', `${etiquetaMes(f.periodo)} queda congelado.`);
          await cargar();
        } catch (e) { fallo('No se pudo cerrar', mensajeAmigable(e, 'Intenta de nuevo.')); }
        finally { setBusy(false); }
      } },
    ]);
  // El motivo lo exige el servidor: se pide con el cuadro de texto del sistema.
  const reabrir = (f) => Alert.prompt(`Reabrir ${etiquetaMes(f.periodo)}`,
    'Vuelve a quedar abierto y sus cifras dejan de estar congeladas. El motivo queda en la bitácora del período.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Reabrir', style: 'destructive', onPress: async (motivo) => {
        if (!motivo?.trim()) { fallo('Falta el motivo', 'Escribe por qué se reabre.'); return; }
        setBusy(true);
        try {
          await reabrirPeriodoFiscal(f.periodo, motivo.trim());
          listo('Período reabierto', `${etiquetaMes(f.periodo)} vuelve a estar abierto.`);
          await cargar();
        } catch (e) { fallo('No se pudo reabrir', mensajeAmigable(e, 'Intenta de nuevo.')); }
        finally { setBusy(false); }
      } },
    ], 'plain-text', '', 'default');

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
        {cadena.length ? (
          <View style={{ gap: 6 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20 }}>El remanente, mes a mes</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              {cadena.map((f, i) => {
                const paga = f.aPagar > 0;
                const sig = cadena[i + 1];
                const color = paga ? MARCA.rojo : MARCA.verde;
                return (
                  <View key={f.periodo} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Vidrio radio={16}>
                      <View style={{ padding: 12, width: 132, gap: 2, borderStyle: f.en_curso ? 'dashed' : 'solid' }}>
                        <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>{`${mesCorto(f.periodo)}${f.en_curso ? ' · en curso' : ''}`}</Text>
                        <Text style={{ color, fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(paga ? f.aPagar : f.remanente)}</Text>
                        <Text style={{ color, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>{paga ? 'a pagar' : 'a favor'}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 12, marginTop: 4 }}>
                          {f.en_curso ? 'todavía no se cierra' : f.remanente > 0 && sig ? `pasa a ${mesCorto(sig.periodo)}: ${formatMoney(f.remanente)}` : 'no pasa nada'}
                        </Text>
                      </View>
                    </Vidrio>
                    {sig ? <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>→</Text> : null}
                  </View>
                );
              })}
            </ScrollView>
            {t.perdido > 0 ? <View style={{ marginHorizontal: 16 }}><Aviso texto={`Hoy ese arrastre no ocurre: el mes siguiente se declara como si el anterior no hubiera existido. Son ${formatMoney(t.perdido)} que se pierden.`} /></View> : null}
          </View>
        ) : null}
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
                    <Dato primero rotulo="Débito fiscal" valor={formatMoney(f.debito_fiscal)} />
                    <Dato rotulo="Crédito fiscal" valor={`− ${formatMoney(f.credito)}${deltaCred(f) && declarable ? `  (+${formatMoney(deltaCred(f))} vs el de hoy)` : ''}`} />
                    <Dato rotulo="Percepción pagada" valor={`− ${formatMoney(f.percepcion_pagada)}`} />
                    <Dato rotulo="Retención sufrida" valor={`− ${formatMoney(f.retencion_sufrida)}`} />
                    <Dato rotulo="Remanente que entra" valor={`− ${formatMoney(f.entra)}`} />
                  </View>
                  {f.es_inicial ? <Aviso tono="cuidado" texto="Es el primer mes que lleva el portal: su remanente que entra es cero por definición, no un resultado." /> : null}
                  {derivoDelCierre(f) ? <Aviso tono="freno" texto={`El libro se movió después de cerrarlo: débito ${formatMoney(f.deriva_debito)} · crédito ${formatMoney(f.deriva_credito)}. Si ya se presentó, esta diferencia no está declarada.`} /> : null}
                  {!cerrado && !f.en_curso && !f.puede_cerrarse && f.motivo_no_puede ? <Aviso texto={f.motivo_no_puede} /> : null}
                  {canEdit && cerrado ? <BotonGrande texto="Reabrir" borde color={MARCA.ambar} deshabilitado={busy} onPress={() => reabrir(f)} /> : null}
                  {canEdit && !cerrado && f.puede_cerrarse ? <BotonGrande texto={`Cerrar ${mesCorto(f.periodo)}`} deshabilitado={busy} onPress={() => cerrar(f)} /> : null}
                </View>
              </Vidrio>
            </View>
          );
        })}
      </ScrollView>
    </>
  );
}
