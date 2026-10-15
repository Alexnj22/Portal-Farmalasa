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
// Filtros (como el portal): período de «Contadas» (7, 30, 90 días o fechas
// libres), sucursal y un buscador por folio, caja o persona; en «Contadas»,
// además, «sólo sin resolver» y la tanda de conteo. La cuarta cifra, «El
// corte y su bolsa» (`get_bolsas_invariante`), cuenta los días en que el
// efectivo de un corte confirmado no llegó entero a una bolsa.
//
// Contando, una bolsa anotada que no cuadró se puede «Anotar la causa» antes
// de confirmar, y «Contar de nuevo» pregunta (borra el conteo y la causa).
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
  confirmarConteo, desmarcarConteoBolsa, fetchBolsas, fetchBolsasConDiferencia, fetchInvariante, fetchPorDepositar, fetchSaldos, marcarConteoBolsa, recibirBolsas,
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
import { useMasAlFinal } from '../componentes/ListaPaginada';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import RangoDeFechas from '../componentes/formulario/RangoDeFechas';
import { MenuDeFiltros } from '../componentes/Filtros';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import DetalleDeBolsa from '../componentes/caja/DetalleDeBolsa';
import Resolver from '../componentes/caja/ResolverDiferencia';

// Las contadas de 30 días son cientos (362 medidas el 2026-10-09): se pintan
// de a 40 para que la lista no se trabe en un teléfono chico.
const POR_PAGINA = 40;
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

function Contar({ bolsa, verMontos, ocupado, onMarcar, onDesmarcar, userId, onResuelta }) {
  const marcado = contadoDeBolsa(bolsa);
  const [texto, setTexto] = useState('');
  const [resolviendo, setResolviendo] = useState(false);
  const saldo = saldoDeBolsa(bolsa);
  if (marcado != null) {
    const dif = diferenciaDeBolsa(bolsa);
    const cuadra = Math.abs(dif) < 0.01;
    const resuelta = !!bolsa.dif_at;
    // Volver a contar BORRA lo anotado —el monto y, si ya se anotó, la causa y
    // su foto—, y por eso pregunta (igual que el portal).
    const contarDeNuevo = () => Alert.alert(`¿Volver a contar ${bolsa.folio}?`, [
      verMontos ? `Se borra el conteo de ${formatMoney(marcado)} y la bolsa vuelve a quedar sin contar.` : 'Se borra el conteo y la bolsa vuelve a quedar sin contar.',
      resuelta ? 'También se borra la causa anotada y su foto de respaldo.' : '',
    ].filter(Boolean).join(' '), [
      { text: 'Dejarlo como está', style: 'cancel' },
      { text: 'Volver a contar', style: 'destructive', onPress: () => { setResolviendo(false); onDesmarcar(bolsa); } },
    ]);
    return (
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Pildora texto={cuadra ? 'Cuadró' : `${dif < 0 ? 'Faltó' : 'Sobró'}${verMontos ? ` ${formatMoney(Math.abs(dif))}` : ''}`} color={cuadra ? MARCA.verde : dif < 0 ? MARCA.rojo : MARCA.ambar} />
          {!cuadra && verMontos ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Se contaron ${formatMoney(marcado)}`}</Text> : null}
          {resuelta ? <Pildora texto={rotuloDeVia(bolsa.dif_via)} color={colorSistema.texto2} /> : null}
          <View style={{ flex: 1 }} />
          <Pressable disabled={ocupado} onPress={contarDeNuevo} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', opacity: ocupado ? 0.5 : 1 }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>Contar de nuevo</Text>
          </Pressable>
        </View>
        {resuelta && bolsa.dif_causa ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{bolsa.dif_causa}</Text> : null}
        {!cuadra && !resuelta ? (resolviendo
          ? <Resolver bolsa={bolsa} userId={userId} onCancelar={() => setResolviendo(false)} onResuelta={() => { setResolviendo(false); onResuelta?.(); }} />
          : <BotonGrande texto="Anotar la causa" borde onPress={() => setResolviendo(true)} />) : null}
      </View>
    );
  }
  const valor = Number(texto.replace(',', '.'));
  const valido = texto.trim() !== '' && Number.isFinite(valor) && valor >= 0;
  // Contar CERO sobre una bolsa con dinero casi nunca es un conteo: es un
  // retiro que no se registró. Pregunta una vez y no bloquea (como el portal);
  // el aviso no dice el monto, para no revelarlo sin `bolsas_ver_montos`.
  const anotar = () => {
    const monto = Math.round(valor * 100) / 100;
    const seguir = () => { onMarcar(bolsa, monto); setTexto(''); };
    if (monto === 0 && saldo >= 0.01) {
      Alert.alert('Anotar cero dice que la bolsa vino vacía',
        'Si alguien retiró ese efectivo, eso es una salida y va con su vale: se registra desde Efectivo → «Sacar dinero», y entonces el conteo cuadra solo. Anotarlo aquí deja una diferencia que hay que explicar a mano.',
        [{ text: 'Cancelar', style: 'cancel' }, { text: 'Sí, vino vacía', onPress: seguir }]);
      return;
    }
    seguir();
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {verMontos ? (
        <Pressable disabled={ocupado} onPress={() => onMarcar(bolsa, saldo)}
          style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: 'rgba(18,183,106,0.18)', opacity: pressed || ocupado ? 0.5 : 1 })}>
          <Text style={{ color: MARCA.verde, fontSize: 15, fontWeight: '700' }}>Cuadra</Text>
        </Pressable>
      ) : null}
      <TextInput value={texto} onChangeText={(v) => setTexto(v.replace(/[^\d.,]/g, ''))} placeholder="Contado $" placeholderTextColor={colorSistema.texto2}
        keyboardType="decimal-pad" returnKeyType="done" onSubmitEditing={() => { if (valido && !ocupado) anotar(); }}
        style={{ flex: 1, minHeight: 44, borderRadius: 12, paddingHorizontal: 12, color: colorSistema.texto, fontSize: 17, fontWeight: '700', backgroundColor: 'rgba(255,255,255,0.08)', textAlign: 'right' }} />
      <Pressable disabled={!valido || ocupado} onPress={anotar}
        style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: 'rgba(52,120,246,0.22)', opacity: !valido || pressed || ocupado ? 0.5 : 1 })}>
        <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>Anotar</Text>
      </Pressable>
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
  const verCards = hasPermission('bolsas_ver_cards');
  const [resolviendo, setResolviendo] = useState(null);
  const [porDepositar, setPorDepositar] = useState([]);
  const [etapa, setEtapa] = useState('camino');
  const [cuantos, setCuantos] = useState(POR_PAGINA);
  // La página siguiente se pinta sola al acercarse al final (el botón queda de respaldo).
  const alFinal = useMasAlFinal(() => setCuantos((n) => n + POR_PAGINA));
  useEffect(() => { setCuantos(POR_PAGINA); }, [etapa]); // eslint-disable-line react-hooks/set-state-in-effect -- cada etapa empieza en la primera página
  const [bolsas, setBolsas] = useState(null);
  const [diferencias, setDiferencias] = useState([]);
  const [contadas, setContadas] = useState([]);
  const [abierta, setAbierta] = useState(null);
  const [elegidas, setElegidas] = useState(() => new Set());
  const [ocupado, setOcupado] = useState(null);
  const [recargando, setRecargando] = useState(false);
  // Filtros: período de «Contadas» (por fecha de conteo), sala, texto, y en
  // «Contadas» sólo sin resolver o una tanda.
  const [periodo, setPeriodo] = useState('30');
  const [rango, setRango] = useState(() => ({ desde: sumarDias(hoySV(), -29), hasta: hoySV() }));
  const [salaFiltro, setSalaFiltro] = useState('todas');
  const [buscar, setBuscar] = useState('');
  const [tanda, setTanda] = useState('todas');
  const [invariante, setInvariante] = useState([]);
  const desdeContadas = periodo === 'rango' ? rango.desde : sumarDias(hoySV(), -(Number(periodo) - 1));
  const hastaContadas = periodo === 'rango' ? rango.hasta : hoySV();

  useEffect(() => { if (getScope && !alcanceTodos) router.replace('/bolsas-sala'); }, [alcanceTodos, getScope]);

  const cargar = useCallback(async () => {
    const [vivas, conDif, contadas, paraBanco, invar] = await Promise.all([
      fetchBolsas({ estados: ['ABIERTA', 'ENTREGADA', 'RECIBIDA'] }),
      fetchBolsasConDiferencia(),
      // Las contadas por FECHA DE CONTEO: la de un corte del martes que se
      // cuenta hoy no puede desaparecer al firmarla.
      fetchBolsas({ desde: desdeContadas, hasta: hastaContadas, estados: ['CONTADA'], porFechaDeConteo: true }),
      // Sin rango a propósito: efectivo confirmado que nadie cerró es un pendiente.
      puedeContar ? fetchPorDepositar() : Promise.resolve([]),
      fetchInvariante({ desde: desdeContadas, hasta: hastaContadas }),
    ]);
    setInvariante(invar || []);
    setPorDepositar(paraBanco || []);
    const todas = [...(vivas || []), ...(conDif || []), ...(contadas || [])];
    const saldos = await fetchSaldos([...new Set(todas.map((b) => b.id))]);
    const conSaldo = (b) => ({ ...b, ...(saldos.get(b.id) || {}) });
    setBolsas((vivas || []).map(conSaldo));
    setDiferencias((conDif || []).map(conSaldo));
    setContadas((contadas || []).map(conSaldo));
  }, [puedeContar, desdeContadas, hastaContadas]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

  const nombreDeSala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? `Sala ${id}`;
  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  const quien = (id) => { const e = porId.get(String(id)); return e ? shortEmployeeName(e) : null; };

  const enSala = useMemo(() => (bolsas || []).filter((b) => b.estado === 'ABIERTA'), [bolsas]);
  const enCamino = useMemo(() => (bolsas || []).filter((b) => b.estado === 'ENTREGADA'), [bolsas]);
  const porContar = useMemo(() => (bolsas || []).filter((b) => b.estado === 'RECIBIDA'), [bolsas]);
  const marcadas = porContar.filter((b) => contadoDeBolsa(b) != null);
  // Sala y texto filtran TODAS las etapas; tanda y «sólo sin resolver», «Contadas».
  const q = buscar.trim().toLowerCase();
  const pasa = (b) => {
    if (salaFiltro !== 'todas' && String(b.branch_id) !== salaFiltro) return false;
    if (!q) return true;
    const personas = [b.cerrada_por, b.entregada_por, b.recibida_por, b.contado_por].map((id) => quien(id) || '').join(' ');
    return [b.folio, b.caja, nombreDeSala(b.branch_id), personas].join(' ').toLowerCase().includes(q);
  };
  const tandas = useMemo(() => {
    const m = new Map();
    for (const b of contadas) if (b.conteo_id != null && !m.has(String(b.conteo_id))) m.set(String(b.conteo_id), b.contado_at || b.fecha);
    return [...m.entries()].sort((x, y) => String(y[1]).localeCompare(String(x[1])));
  }, [contadas]);
  const contadasVistas = tanda === 'sin-resolver' ? diferencias : tanda === 'todas' ? contadas : contadas.filter((b) => String(b.conteo_id) === tanda);
  const lista = (etapa === 'sala' ? enSala : etapa === 'camino' ? enCamino : etapa === 'contar' ? porContar : etapa === 'contadas' ? contadasVistas : diferencias).filter(pasa);
  // «El corte y su bolsa»: los días cuyo efectivo declarado no llegó entero a una bolsa.
  const diasQueNoCuadran = invariante.filter((d) => (salaFiltro === 'todas' || String(d.branch_id) === salaFiltro) && Math.abs(Number(d.descuadre || 0)) >= 0.01);
  // Contar y recibir necesitan todas a la vista (se eligen y se anotan una por una).
  const paginar = etapa === 'contadas' || etapa === 'diferencias';
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
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Bolsas', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Folio, caja, sala o persona', hideWhenScrolling: false, onChangeText: (e) => setBuscar(e.nativeEvent.text), onCancelButtonPress: () => setBuscar('') } }} />
      <MenuDeFiltros grupos={[
        { id: 'sala', titulo: 'Sucursal', activa: salaFiltro, porDefecto: 'todas', onCambiar: setSalaFiltro,
          opciones: [{ id: 'todas', label: 'Todas' }, ...[...new Set([...(bolsas || []), ...contadas, ...diferencias].map((b) => String(b.branch_id)))]
            .sort((x, y) => ordenDeSala(x) - ordenDeSala(y)).map((id) => ({ id, label: nombreDeSala(id) }))] },
        { id: 'periodo', titulo: 'Contadas y el corte y su bolsa', activa: periodo, porDefecto: '30', onCambiar: setPeriodo,
          opciones: [{ id: '7', label: 'Últimos 7 días' }, { id: '30', label: 'Últimos 30 días' }, { id: '90', label: 'Últimos 90 días' }, { id: 'rango', label: 'Fechas…' }] },
        ...(etapa === 'contadas' ? [{ id: 'tanda', titulo: 'Contadas', activa: tanda, porDefecto: 'todas', onCambiar: setTanda,
          opciones: [{ id: 'todas', label: 'Todas' }, { id: 'sin-resolver', label: 'Sólo sin resolver' },
            ...tandas.map(([id, cuando]) => ({ id, label: `Tanda del ${fechaTexto(String(cuando).slice(0, 10), { day: 'numeric', month: 'short' })}${cuando && String(cuando).length > 10 ? ` · ${hora12(cuando)}` : ''}` }))] }] : []),
      ]} />
      <ScrollView {...alFinal} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
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
        {bolsas && verCards ? (
          <FilaDeKpis>
            <Kpi icono="ShieldCheck" rotulo="El corte y su bolsa" color={diasQueNoCuadran.length ? MARCA.rojo : MARCA.verde} pide={diasQueNoCuadran.length > 0}
              valor={String(diasQueNoCuadran.length)}
              apoyo={invariante.length ? (diasQueNoCuadran.length ? `${diasQueNoCuadran.length === 1 ? 'día' : 'días'} sin guardar · ${invariante.length} revisados` : `${invariante.length} ${invariante.length === 1 ? 'día revisado' : 'días revisados'}`) : 'sin días que revisar'} />
          </FilaDeKpis>
        ) : null}
        {diasQueNoCuadran.length ? (
          <View style={{ marginHorizontal: 16, gap: 4 }}>
            <Aviso tono="freno" texto={diasQueNoCuadran.every((d) => Number(d.bolsas) === 0)
              ? `${diasQueNoCuadran.length === 1 ? 'Un día cerró' : `${diasQueNoCuadran.length} días cerraron`} sin guardar nada del efectivo que declaró el corte: ese efectivo nunca entró al circuito.`
              : `${diasQueNoCuadran.length === 1 ? 'Un día no cuadra' : `${diasQueNoCuadran.length} días no cuadran`} entre lo que declaró el corte y lo que se guardó en bolsas. Hay que revisar la caja de esa sala.`} />
            {diasQueNoCuadran.map((d) => (
              <Text key={`${d.branch_id}-${d.fecha}`} style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>
                {`${nombreDeSala(d.branch_id)} · ${dia(d.fecha)} · ${Number(d.bolsas) === 0 ? (verMontos ? `${formatMoney(d.declarado)} sin guardar · ninguna bolsa` : 'ninguna bolsa') : (verMontos ? `${Number(d.descuadre) > 0 ? 'sobran' : 'faltan'} ${formatMoney(Math.abs(Number(d.descuadre)))} de ${formatMoney(d.declarado)}` : (Number(d.descuadre) > 0 ? 'se guardó de más' : 'se guardó de menos'))}`}
              </Text>
            ))}
          </View>
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
        {periodo === 'rango' ? <RangoDeFechas desde={rango.desde} hasta={rango.hasta} onCambiar={setRango} /> : null}
        <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
          {[
            etapa === 'sala' ? 'En la sala, esperando que la entreguen' : etapa === 'camino' ? 'Entregadas, esperando recepción'
              : etapa === 'contar' ? `Por contar · ${marcadas.length} de ${porContar.length} anotadas` : etapa === 'contadas' ? (tanda === 'sin-resolver' ? 'Contadas sin resolver (de cualquier fecha)' : `Contadas ${periodo === 'rango' ? `del ${dia(rango.desde)} al ${dia(rango.hasta)}` : `en los últimos ${periodo} días`}`) : 'Contadas que no cuadraron',
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
        {bolsas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : porSala(paginar ? lista.slice(0, cuantos) : lista).map(([sala, del]) => (
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
                      ? <Contar bolsa={b} verMontos={verMontos} ocupado={ocupado === b.id || ocupado === 'confirmar'} onMarcar={marcar} onDesmarcar={desmarcar} userId={user?.id} onResuelta={cargar} />
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
        {paginar && lista.length > cuantos ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande borde texto={`Ver ${Math.min(POR_PAGINA, lista.length - cuantos)} más · quedan ${lista.length - cuantos}`} onPress={() => setCuantos((n) => n + POR_PAGINA)} />
          </View>
        ) : null}
        {bolsas && !lista.length ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
            {etapa === 'sala' ? 'Ninguna bolsa en las salas' : etapa === 'camino' ? 'No hay bolsas esperando recepción' : etapa === 'contar' ? 'No hay bolsas por contar'
              : etapa === 'contadas' ? 'Ninguna contada en ese período' : 'Sin diferencias por resolver'}
          </Text>
        ) : null}
        {puedeEntregar ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <BotonGrande texto="Bolsas de una sala: entregar y sacar dinero" borde color={MARCA.azulClaro} onPress={() => router.push('/bolsas-sala')} />
          </View>
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
