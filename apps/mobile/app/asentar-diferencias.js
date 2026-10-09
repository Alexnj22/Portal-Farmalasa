// Anotar en el sistema, NATIVO — `AsentarDiferencias` de Efectivo: el dinero
// que ya entró o salió del cajón por una diferencia (los retiros de sobrante y
// los abonos de faltante) y que todavía no se anotó allá. Allá se hace UN
// documento por el total; acá se le pone su número a todas las filas que cubre,
// agrupadas por sala y por signo (un ingreso y un vale son dos documentos).
// Sale el comprobante del asiento por la caja de la sala.
//
// «No lleva movimiento» corrige una diferencia guardada como retiro cuando en
// realidad ya se encontró la causa: queda como causa encontrada y sale de esta
// lista (`justificar_diferencia_corte`, en una sola transacción). Un abono no
// lo lleva: es dinero que alguien entregó; si estuvo mal, se anula desde el
// faltante.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import useDiasConDiferencia from '@nucleo/hooks/useDiasConDiferencia';
import { asentarDiferencias, justificarDiferencia } from '@nucleo/data/cortes';
import { claveDeFilaDeAsiento, gruposParaAsentar, pendientesDeRegistrar } from '@nucleo/utils/diferenciasDeCaja';
import { construirComprobanteDeAsiento } from '@nucleo/utils/corteComprobante';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { imprimirEnLaSala } from '../componentes/imprimir';

const corta = (f) => fechaTexto(f, { day: 'numeric', month: 'short' });

export default function AsentarDiferenciasApp() {
  const { user, hasPermission } = useAuth();
  const puede = hasPermission('cortes_caja_resolver');
  const sucursales = useStaffStore((s) => s.branches);
  const nombreSala = useMemo(() => Object.fromEntries((sucursales || []).map((b) => [b.id, b.name])), [sucursales]);
  const { resoluciones, cargando, recargar } = useDiasConDiferencia({ activo: true, hasta: hoySV() });
  useFocusEffect(useCallback(() => { recargar(); }, [recargar]));
  const grupos = useMemo(() => gruposParaAsentar(pendientesDeRegistrar(resoluciones)), [resoluciones]);
  const [excluidas, setExcluidas] = useState(() => new Set());
  const [refs, setRefs] = useState({});
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [causa, setCausa] = useState('');
  const [refCorregir, setRefCorregir] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const alternar = (k) => setExcluidas((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; });

  const registrar = (g) => {
    const incluidas = g.filas.filter((d) => !excluidas.has(claveDeFilaDeAsiento(d)));
    const ref = (refs[g.k] || '').trim();
    const total = incluidas.reduce((a, d) => a + Math.abs(Number(d.monto)), 0);
    Alert.alert(g.entra ? '¿Registrar el ingreso?' : '¿Registrar el vale?',
      `${nombreSala[g.branchId] ?? ''}: ${incluidas.length} ${incluidas.length === 1 ? 'movimiento' : 'movimientos'} por ${formatMoney(total)} con el número ${ref}.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Registrar', onPress: async () => {
          setOcupado(true);
          trabajando('Registrando…');
          const { error } = await asentarDiferencias(
            incluidas.filter((d) => d.kind !== 'abono').map((d) => d.id), ref,
            incluidas.filter((d) => d.kind === 'abono').map((d) => d.id),
            { sucursal: nombreSala[g.branchId] || '' },
          );
          if (error) { setOcupado(false); fallo('No se pudo registrar', mensajeAmigable(error, 'Vuelve a cargar la lista.')); return; }
          const papel = await imprimirEnLaSala(construirComprobanteDeAsiento({
            sala: nombreSala[g.branchId] || '', entra: g.entra, referencia: ref, filas: incluidas,
            registradoPor: user?.name || '', cuando: new Date().toISOString(),
          }), g.branchId, 'Asiento de diferencias');
          setOcupado(false);
          if (papel.ok) listo(g.entra ? 'Ingreso registrado' : 'Vale registrado', `Número ${ref}`);
          else fallo('Registrado, pero el comprobante no salió', papel.detalle);
          setRefs((r) => ({ ...r, [g.k]: '' }));
          recargar();
        } },
      ]);
  };

  const corregir = (d) => Alert.alert('¿No lleva movimiento?', 'Queda como causa encontrada: no mueve dinero, así que sale de esta lista.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Corregir', onPress: async () => {
      setOcupado(true);
      trabajando('Corrigiendo…');
      const { error } = await justificarDiferencia(d.id, motivo.trim(), causa, { evidenciaRef: refCorregir.trim() }, {
        corte_id: d.corte_id, sucursal: nombreSala[d.branch_id] || '', fecha: d.fecha, monto: d.monto, via_anterior: d.via,
      });
      setOcupado(false);
      if (error) { fallo('No se pudo corregir', mensajeAmigable(error, 'Vuelve a cargar la lista.')); return; }
      listo('Diferencia corregida', 'Queda como causa encontrada.');
      setCorrigiendo(null);
      recargar();
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Anotar en el sistema' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {!puede ? <Aviso tono="freno" texto="Anotar diferencias es de quien tiene el permiso de resolver cortes." />
            : cargando && !grupos.length ? <ActivityIndicator style={{ marginTop: 40 }} />
              : !grupos.length ? <Aviso texto="No queda nada por anotar en el sistema." /> : (
                <>
                  <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>
                    Haz UN documento por el total en el sistema y escribe acá su número: queda puesto en todas las filas que cubre.
                  </Text>
                  {grupos.map((g) => {
                    const incluidas = g.filas.filter((d) => !excluidas.has(claveDeFilaDeAsiento(d)));
                    const total = incluidas.reduce((a, d) => a + Math.abs(Number(d.monto)), 0);
                    return (
                      <Seccion key={g.k} titulo={`${nombreSala[g.branchId] ?? `Sucursal ${g.branchId}`} · ${g.entra ? 'Ingreso' : 'Vale'} · ${formatMoney(total)}`}>
                        {g.filas.map((d) => {
                          const k = claveDeFilaDeAsiento(d);
                          const dentro = !excluidas.has(k);
                          return (
                            <View key={k} style={{ gap: 6, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                              <Pressable onPress={() => alternar(k)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 }}>
                                <Text style={{ color: dentro ? MARCA.verde : colorSistema.texto2, fontSize: 20 }}>{dentro ? '☑' : '☐'}</Text>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{`${corta(d.fecha)} · ${formatMoney(Math.abs(Number(d.monto)))}`}</Text>
                                  {d.causa ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{d.causa}</Text> : null}
                                </View>
                              </Pressable>
                              {d.kind !== 'abono' ? (
                                corrigiendo === d.id ? (
                                  <View style={{ gap: 6 }}>
                                    <Campo value={causa} onChangeText={setCausa} placeholder="La causa que se encontró" />
                                    <Campo multiline={false} value={refCorregir} onChangeText={setRefCorregir} placeholder="Número del documento corregido (opcional)" />
                                    <Campo value={motivo} onChangeText={setMotivo} placeholder="Por qué se corrige (obligatorio)" />
                                    <View style={{ flexDirection: 'row', gap: 8 }}>
                                      <View style={{ flex: 1 }}><BotonGrande texto="Volver" borde onPress={() => setCorrigiendo(null)} /></View>
                                      <View style={{ flex: 1 }}><BotonGrande texto="Corregir" color={MARCA.ambar} deshabilitado={ocupado || !motivo.trim()} onPress={() => corregir(d)} /></View>
                                    </View>
                                  </View>
                                ) : (
                                  <Pressable onPress={() => { setCorrigiendo(d.id); setMotivo(''); setRefCorregir(''); setCausa(d.causa || ''); }} style={{ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' }}>
                                    <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '700' }}>No lleva movimiento</Text>
                                  </Pressable>
                                )
                              ) : null}
                            </View>
                          );
                        })}
                        <Campo multiline={false} value={refs[g.k] || ''} onChangeText={(v) => setRefs((r) => ({ ...r, [g.k]: v }))}
                          placeholder={g.entra ? 'Número del ingreso en el sistema' : 'Número del vale en el sistema'} autoCapitalize="characters" />
                        <BotonGrande texto={ocupado ? 'Registrando…' : g.entra ? 'Registrar el ingreso' : 'Registrar el vale'} color={MARCA.verde}
                          deshabilitado={ocupado || !incluidas.length || !(refs[g.k] || '').trim()} onPress={() => registrar(g)} />
                      </Seccion>
                    );
                  })}
                </>
              )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
