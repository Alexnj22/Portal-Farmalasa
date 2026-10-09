// Bolsas de efectivo, NATIVO — el circuito de administración de `BolsasView`
// después de que la sala entrega:
//
//   · Esperando recepción: acusar recibo de la valija, sin contar (`recibir_bolsas`).
//   · Por contar: contar bolsa por bolsa. Contar MARCA —la bolsa sigue en «Por
//     contar» con su monto— y recién «Confirmar el conteo» cierra la tanda
//     entera (usuario, 24-ago). Lo marcado vive en el SERVIDOR: es efectivo
//     contado a mano y no se pierde con la app cerrada.
//   · Diferencias: las que no cuadraron y nadie resolvió, cada una con
//     «Anotar la causa» (justificar, repuesto o retirado, con foto de respaldo).
//   · Contado y sin cerrar: «Finalizar el efectivo» (banco / en mano /
//     remanente) y el archivo de depósitos y de conteos por tanda.
//   · En la sala y Contadas (las de los últimos 30 días): las dos puntas del
//     circuito, como las pestañas del portal, para LEER.
//
// Arriba, las tres cifras que ninguna etapa contesta porque las cruzan: cuánto
// sigue sin recibir (sala + camino), cuántos días lleva la más vieja
// pendiente (núcleo: `laMasVieja`, alarma desde `DIAS_DE_ALARMA_BOLSA`) y
// cuánto quedó sin cuadrar. Tocar una bolsa abre su detalle (salidas, vales,
// comprobantes y bitácora).
//
// La sala ve sólo su etapa: con alcance de sala esta pantalla manda a
// `bolsas-sala`. El monto que se cuenta se compara contra el SALDO
// (`saldoDeBolsa`), no contra lo guardado, y el servidor rechaza si no coincide
// con el suyo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  confirmarConteo, desmarcarConteoBolsa, fetchBolsas, fetchBolsasConDiferencia, fetchPorDepositar, fetchSaldos, marcarConteoBolsa, recibirBolsas,
  resolverDiferenciaBolsa,
} from '@nucleo/data/bolsas';
import { contadoDeBolsa, diferenciaDeBolsa, rotuloDeVia, saldoDeBolsa } from '@nucleo/utils/bolsasReparto';
import { contadoDeBolsas } from '@nucleo/utils/depositoDeEfectivo';
import { DIAS_DE_ALARMA_BOLSA, laMasVieja } from '@nucleo/utils/bolsasTexto';
import { ordenDeSala } from '@nucleo/constants/erp';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo } from '../componentes/formulario/Piezas';
import Fotos, { subirFotos } from '../componentes/formulario/Fotos';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import DetalleDeBolsa from '../componentes/caja/DetalleDeBolsa';

const dia = (f) => fechaTexto(f, { weekday: 'short', day: 'numeric', month: 'short' });

/** Agrupa por sala, en el orden de la red, y dentro por fecha. */
function porSala(lista) {
  const m = new Map();
  for (const b of [...lista].sort((a, c) => ordenDeSala(a.branch_id) - ordenDeSala(c.branch_id) || String(a.fecha).localeCompare(String(c.fecha)))) {
    if (!m.has(b.branch_id)) m.set(b.branch_id, []);
    m.get(b.branch_id).push(b);
  }
  return [...m.entries()];
}

function Contar({ bolsa, verMontos, ocupado, onMarcar, onDesmarcar }) {
  const marcado = contadoDeBolsa(bolsa);
  const [texto, setTexto] = useState('');
  const saldo = saldoDeBolsa(bolsa);
  if (marcado != null) {
    const dif = diferenciaDeBolsa(bolsa);
    const cuadra = Math.abs(dif) < 0.01;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pildora texto={cuadra ? `Cuadra · ${formatMoney(marcado)}` : `${formatMoney(marcado)} · ${dif > 0 ? '+' : ''}${formatMoney(dif)}`} color={cuadra ? MARCA.verde : MARCA.rojo} />
        <View style={{ flex: 1 }} />
        <Pressable disabled={ocupado} onPress={() => onDesmarcar(bolsa)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', opacity: ocupado ? 0.5 : 1 }}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>Deshacer</Text>
        </Pressable>
      </View>
    );
  }
  const valor = Number(texto.replace(',', '.'));
  const valido = texto.trim() !== '' && Number.isFinite(valor) && valor >= 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {verMontos ? (
        <Pressable disabled={ocupado} onPress={() => onMarcar(bolsa, saldo)}
          style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: 'rgba(18,183,106,0.18)', opacity: pressed || ocupado ? 0.5 : 1 })}>
          <Text style={{ color: MARCA.verde, fontSize: 15, fontWeight: '700' }}>Cuadra</Text>
        </Pressable>
      ) : null}
      <TextInput value={texto} onChangeText={(v) => setTexto(v.replace(/[^\d.,]/g, ''))} placeholder="Contado $" placeholderTextColor={colorSistema.texto2}
        keyboardType="decimal-pad" returnKeyType="done"
        style={{ flex: 1, minHeight: 44, borderRadius: 12, paddingHorizontal: 12, color: colorSistema.texto, fontSize: 17, fontWeight: '700', backgroundColor: 'rgba(255,255,255,0.08)', textAlign: 'right' }} />
      <Pressable disabled={!valido || ocupado} onPress={() => { onMarcar(bolsa, Math.round(valor * 100) / 100); setTexto(''); }}
        style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: 'rgba(52,120,246,0.22)', opacity: !valido || pressed || ocupado ? 0.5 : 1 })}>
        <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>Anotar</Text>
      </Pressable>
    </View>
  );
}

/** La causa de una diferencia: justificar, o repuesto/retirado, con foto opcional
 *  de respaldo. La foto se sube ANTES de resolver: saldar diciendo que hay
 *  respaldo cuando no llegó es peor que no adjuntarlo (igual que el portal). */
function Resolver({ bolsa, userId, onResuelta, onCancelar }) {
  const [causa, setCausa] = useState('');
  const [fotos, setFotos] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const dif = diferenciaDeBolsa(bolsa) ?? 0;
  const falta = dif < 0;
  const saldar = (via) => Alert.alert(`¿${rotuloDeVia(via)}?`, `${bolsa.folio}: ${falta ? 'faltaron' : 'sobraron'} ${formatMoney(Math.abs(dif))}.\n«${causa.trim()}»`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: rotuloDeVia(via), onPress: async () => {
      setOcupado(true);
      try {
        const url = fotos.length
          ? (await subirFotos(fotos, { bucket: 'payment-proofs', carpeta: `bolsas/${bolsa.branch_id ?? 'sin-sala'}/${userId ?? 'anon'}` }))[0] ?? null : null;
        const { error } = await resolverDiferenciaBolsa(bolsa.id, via, causa.trim(), url);
        if (error) throw error;
        listo(`${bolsa.folio} · ${rotuloDeVia(via).toLowerCase()}`);
        onResuelta();
      } catch (e) {
        fallo('No se pudo resolver', mensajeAmigable(e));
      } finally { setOcupado(false); }
    } },
  ]);
  return (
    <View style={{ gap: 8 }}>
      <Campo value={causa} onChangeText={setCausa} placeholder={falta ? 'Por qué faltó y qué se hizo…' : 'Por qué sobró y qué se hizo…'} />
      <Fotos fotos={fotos} onCambiar={setFotos} max={1} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><BotonGrande texto="Justificar" borde deshabilitado={ocupado || !causa.trim()} onPress={() => saldar('JUSTIFICA')} /></View>
        <View style={{ flex: 1 }}><BotonGrande texto={falta ? 'Repuesto' : 'Retirado'} color={MARCA.verde} deshabilitado={ocupado || !causa.trim()} onPress={() => saldar(falta ? 'REPONE' : 'RETIRA')} /></View>
      </View>
      <BotonGrande texto="Cancelar" borde color={colorSistema.texto2} onPress={onCancelar} />
    </View>
  );
}

export default function Bolsas() {
  const { getScope, hasPermission, user } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const alcanceTodos = getScope?.('bolsas') === 'ALL';
  const puedeContar = hasPermission('bolsas_conteo', 'can_edit');
  const verMontos = hasPermission('bolsas_ver_montos');
  const puedeEntregar = hasPermission('bolsas', 'can_edit');
  const [resolviendo, setResolviendo] = useState(null);
  const [porDepositar, setPorDepositar] = useState([]);
  const [etapa, setEtapa] = useState('camino');
  const [bolsas, setBolsas] = useState(null);
  const [diferencias, setDiferencias] = useState([]);
  const [contadas, setContadas] = useState([]);
  const [abierta, setAbierta] = useState(null);
  const [elegidas, setElegidas] = useState(() => new Set());
  const [ocupado, setOcupado] = useState(null);
  const [recargando, setRecargando] = useState(false);

  useEffect(() => { if (getScope && !alcanceTodos) router.replace('/bolsas-sala'); }, [alcanceTodos, getScope]);

  const cargar = useCallback(async () => {
    const hoy = hoySV();
    const [vivas, conDif, contadas, paraBanco] = await Promise.all([
      fetchBolsas({ estados: ['ABIERTA', 'ENTREGADA', 'RECIBIDA'] }),
      fetchBolsasConDiferencia(),
      // Las contadas por FECHA DE CONTEO: la de un corte del martes que se
      // cuenta hoy no puede desaparecer al firmarla.
      fetchBolsas({ desde: sumarDias(hoy, -29), hasta: hoy, estados: ['CONTADA'], porFechaDeConteo: true }),
      // Sin rango a propósito: efectivo confirmado que nadie cerró es un pendiente.
      puedeContar ? fetchPorDepositar() : Promise.resolve([]),
    ]);
    setPorDepositar(paraBanco || []);
    const todas = [...(vivas || []), ...(conDif || []), ...(contadas || [])];
    const saldos = await fetchSaldos([...new Set(todas.map((b) => b.id))]);
    const conSaldo = (b) => ({ ...b, ...(saldos.get(b.id) || {}) });
    setBolsas((vivas || []).map(conSaldo));
    setDiferencias((conDif || []).map(conSaldo));
    setContadas((contadas || []).map(conSaldo));
  }, [puedeContar]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

  const nombreDeSala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? `Sala ${id}`;
  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  const quien = (id) => { const e = porId.get(String(id)); return e ? shortEmployeeName(e) : null; };

  const enSala = useMemo(() => (bolsas || []).filter((b) => b.estado === 'ABIERTA'), [bolsas]);
  const enCamino = useMemo(() => (bolsas || []).filter((b) => b.estado === 'ENTREGADA'), [bolsas]);
  const porContar = useMemo(() => (bolsas || []).filter((b) => b.estado === 'RECIBIDA'), [bolsas]);
  const marcadas = porContar.filter((b) => contadoDeBolsa(b) != null);
  const lista = etapa === 'sala' ? enSala : etapa === 'camino' ? enCamino : etapa === 'contar' ? porContar : etapa === 'contadas' ? contadas : diferencias;
  const sinRecibir = [...enSala, ...enCamino];
  const { bolsa: masVieja, dias: diasMasVieja } = laMasVieja([...enSala, ...enCamino, ...porContar]);
  const sinCuadrar = diferencias.reduce((a, b) => a + Math.abs(diferenciaDeBolsa(b) ?? 0), 0);
  const suma = (l) => l.reduce((a, b) => a + saldoDeBolsa(b), 0);

  const alternar = (id) => setElegidas((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const recibir = async (ids) => {
    setOcupado('recibir'); trabajando('Confirmando recepción…');
    const { error } = await recibirBolsas(ids);
    setOcupado(null);
    if (error) { fallo('No se pudo confirmar', mensajeAmigable(error)); return; }
    listo('Recibidas', `${ids.length} bolsa${ids.length === 1 ? '' : 's'} · ya están en «Por contar»`);
    setElegidas(new Set());
    await cargar();
    if (enCamino.length - ids.length <= 0) setEtapa('contar');
  };
  // Marcar no recarga: cambia tres columnas de UNA bolsa y el RPC devuelve la fila.
  const pegar = (fila) => setBolsas((l) => (l || []).map((b) => (b.id === fila?.id ? { ...b, ...fila } : b)));
  const marcar = async (bolsa, monto) => {
    setOcupado(bolsa.id);
    const { data, error } = await marcarConteoBolsa(bolsa.id, monto, saldoDeBolsa(bolsa));
    setOcupado(null);
    if (error) { fallo('No se pudo anotar', mensajeAmigable(error)); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const fila = Array.isArray(data) ? data[0] : data;
    if (fila?.id) pegar(fila); else pegar({ id: bolsa.id, conteo_marcado: monto });
  };
  const desmarcar = async (bolsa) => {
    setOcupado(bolsa.id);
    const { data, error } = await desmarcarConteoBolsa(bolsa.id);
    setOcupado(null);
    if (error) { fallo('No se pudo deshacer', mensajeAmigable(error)); return; }
    const fila = Array.isArray(data) ? data[0] : data;
    pegar(fila?.id ? fila : { id: bolsa.id, conteo_marcado: null });
  };
  const confirmar = async () => {
    setOcupado('confirmar'); trabajando('Confirmando el conteo…');
    const { error } = await confirmarConteo(marcadas.map((b) => b.id));
    setOcupado(null);
    if (error) { fallo('No se pudo confirmar', mensajeAmigable(error)); return; }
    listo('Conteo confirmado', `${marcadas.length} bolsa${marcadas.length === 1 ? '' : 's'} cerrada${marcadas.length === 1 ? '' : 's'}`);
    await cargar();
  };

  const contadoMarcado = marcadas.reduce((a, b) => a + Number(contadoDeBolsa(b)), 0);
  const difMarcada = Math.round((contadoMarcado - suma(marcadas)) * 100) / 100;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Bolsas', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {bolsas ? (
          <FilaDeKpis>
            <Kpi icono="HandCoins" rotulo="Sin recibir" color={MARCA.azulClaro}
              valor={verMontos ? formatMoney(suma(sinRecibir)) : String(sinRecibir.length)}
              apoyo={sinRecibir.length ? `${sinRecibir.length} en sala o en camino` : 'todo recibido'} />
            <Kpi icono="CalendarDays" rotulo="La más vieja" color={diasMasVieja >= DIAS_DE_ALARMA_BOLSA ? MARCA.rojo : MARCA.azulClaro}
              pide={diasMasVieja >= DIAS_DE_ALARMA_BOLSA}
              valor={masVieja ? `${diasMasVieja} d` : '—'}
              apoyo={masVieja ? `${nombreDeSala(masVieja.branch_id)} · ${dia(masVieja.fecha)}` : 'sin pendientes'} />
          </FilaDeKpis>
        ) : null}
        {/* La tercera va en su propia fila: tres en un teléfono cortan los
            rótulos («Sin rec…»). */}
        {bolsas ? (
          <FilaDeKpis>
            <Kpi icono="AlertTriangle" rotulo="Sin cuadrar" color={diferencias.length ? MARCA.rojo : MARCA.verde} pide={diferencias.length > 0}
              valor={verMontos && diferencias.length ? formatMoney(sinCuadrar) : String(diferencias.length)}
              apoyo={diferencias.length ? `${diferencias.length} bolsa${diferencias.length === 1 ? '' : 's'}` : 'todo cuadrado'}
              onPress={diferencias.length ? () => { setEtapa('diferencias'); setElegidas(new Set()); } : undefined} />
          </FilaDeKpis>
        ) : null}
        {puedeContar && porDepositar.length ? (
          <View style={{ marginHorizontal: 16 }}>
            <Vidrio radio={20}>
              <View style={{ padding: 14, gap: 10 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>Contado y sin cerrar</Text>
                <Text style={{ color: colorSistema.texto, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                  {verMontos ? formatMoney(contadoDeBolsas(porDepositar)) : String(porDepositar.length)}
                </Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`en ${porDepositar.length} ${porDepositar.length === 1 ? 'bolsa' : 'bolsas'}`}</Text>
                <BotonGrande texto="Finalizar el efectivo" color={MARCA.verde} onPress={() => router.push('/finalizar-efectivo')} />
              </View>
            </Vidrio>
          </View>
        ) : null}
        <Segmentos activa={etapa} onCambiar={(e) => { setEtapa(e); setElegidas(new Set()); }} opciones={[
          { id: 'sala', label: 'Sala' },
          { id: 'camino', label: 'Recibir' },
          { id: 'contar', label: 'Contar' },
          { id: 'contadas', label: 'Contadas' },
          { id: 'diferencias', label: 'Cuadre' },
        ]} />
        <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
          {[
            etapa === 'sala' ? 'En la sala, esperando que la entreguen' : etapa === 'camino' ? 'Entregadas, esperando recepción'
              : etapa === 'contar' ? `Por contar · ${marcadas.length} de ${porContar.length} anotadas` : etapa === 'contadas' ? 'Contadas en los últimos 30 días' : 'Contadas que no cuadraron',
            `${lista.length} bolsa${lista.length === 1 ? '' : 's'}`,
            verMontos && lista.length ? formatMoney(suma(lista)) : null,
          ].filter(Boolean).join(' · ')}
        </Text>
        {etapa === 'contar' && marcadas.length && puedeContar ? (
          <View style={{ marginHorizontal: 16, gap: 8 }}>
            {verMontos ? (
              <Aviso tono={Math.abs(difMarcada) < 0.01 ? 'nota' : 'freno'}
                texto={`${marcadas.length} anotada${marcadas.length === 1 ? '' : 's'}: se esperaban ${formatMoney(suma(marcadas))} y se contaron ${formatMoney(contadoMarcado)}${Math.abs(difMarcada) < 0.01 ? ' — cuadra.' : ` — diferencia ${difMarcada > 0 ? '+' : ''}${formatMoney(difMarcada)}.`} Al confirmar ya no se puede corregir, sólo resolver la diferencia.`} />
            ) : null}
            <BotonGrande texto={ocupado === 'confirmar' ? 'Confirmando…' : `Confirmar el conteo (${marcadas.length})`} color={MARCA.verde}
              deshabilitado={!!ocupado} onPress={confirmar} />
          </View>
        ) : null}
        {etapa === 'camino' && puedeContar && enCamino.length ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto={elegidas.size ? (elegidas.size === 1 ? 'Recibir la elegida' : `Recibir las ${elegidas.size} elegidas`) : `Recibir todas (${enCamino.length})`} color={MARCA.azul}
              deshabilitado={!!ocupado} onPress={() => recibir(elegidas.size ? [...elegidas] : enCamino.map((b) => b.id))} />
          </View>
        ) : null}
        {bolsas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : porSala(lista).map(([sala, del]) => (
          <View key={sala} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginHorizontal: 20, marginTop: 6 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{nombreDeSala(sala)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {[`${del.length} bolsa${del.length === 1 ? '' : 's'}`, verMontos ? formatMoney(suma(del)) : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {del.map((b) => {
              const elegida = elegidas.has(b.id);
              const dif = diferenciaDeBolsa(b);
              const firma = etapa === 'sala' ? (quien(b.cerrada_por) ? `guardó ${quien(b.cerrada_por)}` : null)
                : etapa === 'camino' ? (quien(b.entregada_por) ? `entregó ${quien(b.entregada_por)}` : null)
                  : etapa === 'contar' ? (quien(b.recibida_por) ? `recibió ${quien(b.recibida_por)}` : null)
                    : (quien(b.contado_por) ? `contó ${quien(b.contado_por)}` : null);
              const cuerpo = (
                <Vidrio radio={18} interactivo={etapa !== 'contar'} tinte={elegida ? 'rgba(52,120,246,0.18)' : undefined}>
                  <View style={{ padding: 12, gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      {etapa === 'camino' && puedeContar ? (
                        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: elegida ? MARCA.azulClaro : colorSistema.texto2, backgroundColor: elegida ? MARCA.azulClaro : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                          {elegida ? <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>✓</Text> : null}
                        </View>
                      ) : null}
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{b.folio}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                          {[`${dia(b.fecha)}${b.hora ? ` ${hora12(b.hora)}` : ''}`, b.caja ? `Caja ${b.caja}` : null, firma].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      {verMontos ? <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{formatMoney(saldoDeBolsa(b))}</Text> : null}
                    </View>
                    {etapa === 'contar' && puedeContar
                      ? <Contar bolsa={b} verMontos={verMontos} ocupado={ocupado === b.id || ocupado === 'confirmar'} onMarcar={marcar} onDesmarcar={desmarcar} />
                      : null}
                    {etapa === 'contadas' && dif != null && Math.abs(dif) >= 0.01 ? (
                      <Pildora texto={`${dif > 0 ? 'Sobraron' : 'Faltaron'} ${formatMoney(Math.abs(dif))}`} color={MARCA.ambar} />
                    ) : null}
                    {etapa === 'diferencias' && dif != null ? (
                      <Pildora texto={`Se contaron ${formatMoney(contadoDeBolsa(b))} · ${dif > 0 ? 'sobran' : 'faltan'} ${formatMoney(Math.abs(dif))}`} color={MARCA.rojo} />
                    ) : null}
                    {etapa === 'diferencias' && (puedeContar || puedeEntregar) ? (
                      resolviendo === b.id
                        ? <Resolver bolsa={b} userId={user?.id} onCancelar={() => setResolviendo(null)} onResuelta={() => { setResolviendo(null); cargar(); }} />
                        : <BotonGrande texto="Anotar la causa" borde onPress={() => setResolviendo(b.id)} />
                    ) : null}
                  </View>
                </Vidrio>
              );
              // En «Recibir» el toque ELIGE (para recibir varias); mantener
              // presionado abre el detalle. En las demás etapas el toque abre
              // el detalle — salvo «Contar», donde la tarjeta lleva el campo.
              return etapa === 'camino' && puedeContar ? (
                <Pressable key={b.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); alternar(b.id); }}
                  onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); setAbierta(b); }}
                  style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>{cuerpo}</Pressable>
              ) : etapa === 'contar' && puedeContar ? (
                <Pressable key={b.id} onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); setAbierta(b); }}
                  style={{ marginHorizontal: 16 }}>{cuerpo}</Pressable>
              ) : (
                <Pressable key={b.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(b); }}
                  style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>{cuerpo}</Pressable>
              );
            })}
          </View>
        ))}
        {bolsas && !lista.length ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
            {etapa === 'sala' ? 'Ninguna bolsa en las salas' : etapa === 'camino' ? 'No hay bolsas esperando recepción' : etapa === 'contar' ? 'No hay bolsas por contar'
              : etapa === 'contadas' ? 'Ninguna contada en 30 días' : 'Sin diferencias por resolver'}
          </Text>
        ) : null}
        {verMontos ? (
          <View style={{ marginHorizontal: 16, marginTop: 8, flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><BotonGrande texto="Depósitos" borde color={MARCA.azulClaro} onPress={() => router.push('/depositos-banco')} /></View>
            <View style={{ flex: 1 }}><BotonGrande texto="Conteos" borde color={MARCA.azulClaro} onPress={() => router.push('/conteos-bolsas')} /></View>
          </View>
        ) : null}
      </ScrollView>
      <DetalleDeBolsa bolsa={abierta} sala={abierta ? nombreDeSala(abierta.branch_id) : ''} verMontos={verMontos} onCerrar={() => setAbierta(null)}
        onCambio={cargar} cerradaPor={abierta ? (quien(abierta.cerrada_por) || '') : ''} />
    </>
  );
}
