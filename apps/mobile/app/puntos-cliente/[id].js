// La cuenta de puntos de un cliente, NATIVO — lo que `ClientePuntosModal` del
// portal muestra para revisar un saldo antes de un canje: cuánto tiene (en
// dólares primero: «$4.20 de descuento» se entiende, «420 puntos» no), cuánto
// ganó y usó, qué vence y cada movimiento con quién lo hizo.
//
// Dar o quitar puntos a mano, el código de acceso del cliente y asignar cuentas
// del sistema anterior se hacen en el portal (dentro de la app).
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchPuntosCliente } from '@nucleo/data/puntos';
import { claveDeMovimiento, detalleDeMovimiento, dolaresDePuntos, puntosTexto, rotuloDeMovimiento } from '@nucleo/utils/puntosTexto';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Avatar from '../../componentes/Avatar';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';

const ROL = { 'vendió': 'Vendió', 'ajustó': 'Ajustó' };
const MINIMO = 100;

export default function PuntosCliente() {
  const { id, nombre } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [mostrar, setMostrar] = useState(30);
  const [recargando, setRecargando] = useState(false);
  const cargar = useCallback(async () => {
    try { setD(await fetchPuntosCliente(Number(id))); setError(null); } catch (e) { setError(mensajeAmigable(e)); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const cuenta = d?.cuenta || {};
  const saldo = Number(cuenta.saldo) || 0;
  const movs = cuenta.movimientos || [];
  const titulo = d?.cliente?.nombre || nombre || 'Cliente';

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Puntos', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {!d && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
        {d ? (
          <>
            <Vidrio radio={24} tinte="rgba(140,198,63,0.12)">
              <View style={{ padding: 18, gap: 6 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '700' }} numberOfLines={2}>{titulo}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[d.cliente?.dui, d.cliente?.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</Text>
                <Text style={{ color: colorSistema.texto, fontSize: 40, fontWeight: '800', marginTop: 6 }}>{dolaresDePuntos(saldo)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`${puntosTexto(saldo)} puntos de descuento`}</Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {d.cliente?.acumula === false ? <Pildora texto="Esta ficha no acumula" color={colorSistema.texto2} />
                    : saldo >= MINIMO ? <Pildora texto="Puede canjear" color={MARCA.verde} />
                      : <Pildora texto={`Le faltan ${puntosTexto(MINIMO - saldo)} para canjear`} color={MARCA.ambar} />}
                  <Pildora texto={`Ganó ${puntosTexto(cuenta.ganados)}`} color={colorSistema.texto2} />
                  <Pildora texto={`Usó ${puntosTexto(cuenta.usados)}`} color={colorSistema.texto2} />
                </View>
              </View>
            </Vidrio>
            {(cuenta.vencimientos || []).length ? (
              <Seccion titulo="Por vencer">
                {(cuenta.vencimientos || []).map((v) => (
                  <Text key={v.vence_el} style={{ color: colorSistema.texto, fontSize: 15 }}>{`${puntosTexto(v.puntos)} puntos (${dolaresDePuntos(v.puntos)}) el ${fechaNumerica(v.vence_el)}`}</Text>
                ))}
              </Seccion>
            ) : null}
            <Seccion titulo={`Movimientos · ${movs.length}`}>
              {movs.length ? movs.slice(0, mostrar).map((m, i) => {
                const info = d.detalle?.[claveDeMovimiento(m)] || {};
                const p = Number(m.puntos) || 0;
                const detalle = detalleDeMovimiento(m, info);
                const persona = info.quien && info.quien !== 'Automático' ? { id: info.quien_id, name: info.quien } : null;
                return (
                  <View key={claveDeMovimiento(m)} style={{ flexDirection: 'row', gap: 10, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>
                        {rotuloDeMovimiento(m)}{detalle ? <Text style={{ fontWeight: '400', color: colorSistema.texto2 }}>{` · ${detalle}`}</Text> : null}
                      </Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[fechaNumerica(m.fecha), d.salas?.[m.sucursal] ?? m.sucursal].filter(Boolean).join(' · ')}</Text>
                      {persona ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Avatar empleado={persona} tamano={18} />
                          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${ROL[info.rol] ?? ''} ${shortEmployeeName(persona)}`.trim()}</Text>
                        </View>
                      ) : info.quien === 'Automático' ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Automático</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: p > 0 ? MARCA.verde : colorSistema.texto, fontSize: 15, fontWeight: '800' }}>{`${p > 0 ? '+' : '−'}${puntosTexto(Math.abs(p))}`}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{dolaresDePuntos(Math.abs(p))}</Text>
                    </View>
                  </View>
                );
              }) : <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Todavía no tiene movimientos.</Text>}
            </Seccion>
            {movs.length > mostrar ? <BotonGrande texto="Ver más" borde onPress={() => setMostrar((n) => n + 30)} /> : null}
            {hasPermission('puntos_ajustar') || hasPermission('puntos', 'can_edit') ? (
              <BotonGrande texto="Ajustar o dar código de acceso (portal)" borde color={MARCA.azulClaro}
                onPress={() => router.push({ pathname: '/portal', params: { ruta: '/puntos?tab=consulta', nombre: 'Puntos' } })} />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
