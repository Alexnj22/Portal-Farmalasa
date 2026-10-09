// Un día con diferencia, NATIVO — la ficha que el portal abre desde
// «Diferencias»: cómo cerró el día y, en orden, los cortes que no cuadraron,
// cada uno con lo que se hizo con él (causa encontrada, quién repone y cuánto
// lleva abonado, o nada todavía). Las cuentas son las del núcleo
// (`desgloseDelDia`, `estadoDeCorte`, `pendienteDe`, `saldoDeDiferencia`).
//
// Tocar un corte abre su detalle nativo (confirmar o descartar); «Resolver la
// diferencia» abre `diferencia-corte`: causa con comprobante, responsables y
// sus abonos, igual que la ficha del corte del portal.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import useDiasConDiferencia from '@nucleo/hooks/useDiasConDiferencia';
import { desgloseDelDia, movimientoDe, pendienteDe, porSigno, resolucionesDe, saldoDeDiferencia } from '@nucleo/utils/diferenciasDeCaja';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { BarraDelDia, ESTADO_DIF, montoDelDia } from '../componentes/cortes/diferencias';

const VIA = { JUSTIFICA: 'Con causa', REPONE: 'Lo repone', RETIRA: 'Se retira del acumulado' };

export default function CajaDia() {
  const { sala, fecha, signo = 'falta' } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const nombre = (sucursales || []).find((b) => String(b.id) === String(sala))?.name ?? `Sala ${sala}`;
  const { dias, cargando, error, recargar } = useDiasConDiferencia({ activo: true, hasta: hoySV() });
  const [recargando, setRecargando] = useState(false);
  useFocusEffect(useCallback(() => { recargar(); }, [recargar]));

  const dia = useMemo(() => porSigno(dias, signo).find((d) => String(d.branch_id) === String(sala) && d.fecha === fecha) || null, [dias, signo, sala, fecha]);
  const desglose = dia ? desgloseDelDia(dia, signo) : null;
  const [estado, color] = dia ? (ESTADO_DIF[dia.estadoDif] ?? ESTADO_DIF.resuelto) : [null, null];
  const cortes = [...(dia?.cortes || [])].sort((a, b) => String(a.hora).localeCompare(String(b.hora)));

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'El día' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await recargar(); setRecargando(false); }} />}>
        {error ? <Aviso tono="freno" texto="No se pudo leer el día." /> : null}
        {cargando && !dia ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
        {!cargando && !dia && !error ? <Aviso tono="nota" texto="Este día ya no tiene diferencias en esta vista." /> : null}
        {dia ? (
          <>
            <Vidrio radio={24}>
              <View style={{ padding: 18, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{nombre}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{fechaTexto(fecha, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
                  </View>
                  <Pildora texto={estado} color={color} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{ color: signo === 'sobra' ? MARCA.ambar : MARCA.rojo, fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(montoDelDia(dia, signo))}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{signo === 'sobra' ? 'sobraron' : 'faltaron'}</Text>
                </View>
                {signo === 'falta' ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Recuperado ${formatMoney(desglose.cubierto)} · ${desglose.pct}%`}</Text> : null}
                <BarraDelDia desglose={desglose} signo={signo} />
              </View>
            </Vidrio>

            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>
              {`Los cortes que no cuadraron · ${cortes.length}`}
            </Text>
            {cortes.map((c) => {
              const [est, col] = ESTADO_DIF[c.estadoDif] ?? ESTADO_DIF.resuelto;
              const resoluciones = resolucionesDe(c);
              const mov = movimientoDe(c);
              const queda = pendienteDe(c);
              return (
                <Pressable key={c.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/corte/[id]', params: { id: String(c.id), fecha } }); }}
                  style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                  <Vidrio radio={20} interactivo>
                    <View style={{ padding: 14, gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>
                          {`${hora12(c.hora)}${c.empleado_texto ? ` · ${c.empleado_texto}` : ''}`}
                        </Text>
                        <Text style={{ color: Number(c.tramo) < 0 ? MARCA.rojo : MARCA.ambar, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                          {`${Number(c.tramo) < 0 ? '−' : '+'}${formatMoney(Math.abs(Number(c.tramo)))}`}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                        <Pildora texto={est} color={col} />
                        {queda > 0.004 && c.estadoDif !== 'resuelto' ? <Pildora texto={`Sin explicar ${formatMoney(queda)}`} color={colorSistema.texto2} /> : null}
                      </View>
                      {resoluciones.map((r, i) => (
                        <View key={i} style={{ gap: 4 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
                            {`${VIA[r.via] ?? r.via}${r.causa ? `: ${r.causa}` : ''}${r.monto != null ? ` · ${formatMoney(r.monto)}` : ''}`}
                          </Text>
                          {(r.personas || []).length ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              {r.personas.slice(0, 4).map((p) => <Avatar key={p.employee_id ?? p.nombre} empleado={{ name: p.nombre }} tamano={22} />)}
                              <Text style={{ color: colorSistema.texto2, fontSize: 13, flex: 1 }}>
                                {r.personas.map((p) => shortEmployeeName({ name: p.nombre })).join(', ')}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      ))}
                      {mov?.via === 'REPONE' && saldoDeDiferencia(mov) > 0 ? (
                        <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>{`Falta cobrar ${formatMoney(saldoDeDiferencia(mov))}`}</Text>
                      ) : null}
                      <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/diferencia-corte', params: { sala: String(sala), fecha, signo, corte: String(c.id) } }); }}
                        accessibilityRole="button" style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: `${MARCA.azulClaro}26`, opacity: pressed ? 0.7 : 1 })}>
                        <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>
                          {hasPermission('cortes_caja_resolver') && (queda > 0.004 || (mov?.via === 'REPONE' && saldoDeDiferencia(mov) > 0)) ? 'Resolver la diferencia' : 'Ver la diferencia'}
                        </Text>
                      </Pressable>
                    </View>
                  </Vidrio>
                </Pressable>
              );
            })}

          </>
        ) : null}
      </ScrollView>
    </>
  );
}
