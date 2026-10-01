// Bolsas de efectivo de la sala, NATIVO — lo que el widget del portal
// (`WidgetBolsasSala.jsx`) deja hacer en el día:
//
//   · ver el efectivo que espera el retiro (el SALDO, no lo guardado; sin el
//     permiso `bolsas_ver_montos` se cuentan bolsas, nunca dinero);
//   · GUARDAR un corte confirmado que quedó sin bolsa (`cerrarBolsa`) — es una
//     excepción: la bolsa nace sola al confirmar;
//   · REIMPRIMIR la etiqueta de una bolsa, con sus salidas y cheques;
//   · ENTREGAR las bolsas de uno o varios días a quien pasa a recogerlas: la
//     persona se prueba con su carné (`Identidad`) y la base no deja que reciba
//     quien firma ni que se mezclen salas (`entregar_bolsas`).
//
// «Sacar dinero» abre `app/sacar-dinero.js`: sale primero del cajón y sólo si
// no alcanza de las bolsas (regla del usuario del 3-sep, «todo debe pasar
// desde efectivo»).
import { useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cerrarBolsa, entregarBolsas, fetchBolsas, fetchCortesPorEmbolsar, fetchSaldos } from '@nucleo/data/bolsas';
import { saldoDeBolsa } from '@nucleo/utils/bolsasReparto';
import { ordenDeSala } from '@nucleo/constants/erp';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { diasEntre, fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../componentes/formulario/Piezas';
import { MenuDeFiltros } from '../componentes/Filtros';
import Vidrio from '../componentes/Vidrio';
import Identidad from '../componentes/Identidad';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { etiquetaDeLaBolsa, reimprimirEtiqueta } from '../componentes/cortes/papel';

const DIAS_DE_ALARMA = 4;
const rotularDia = (f) => {
  const hoy = hoySV();
  if (f === hoy) return 'Hoy';
  if (f === sumarDias(hoy, -1)) return 'Ayer';
  return fechaTexto(f, { weekday: 'short', day: 'numeric', month: 'short' });
};

function Renglon({ titulo, detalle, derecha, colorDerecha, onPress, primero, marcado }) {
  return (
    <Pressable disabled={!onPress} onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 8,
        borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
      {marcado != null ? <Text style={{ color: marcado ? MARCA.azulClaro : colorSistema.texto2, fontSize: 20 }}>{marcado ? '●' : '○'}</Text> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle}</Text> : null}
      </View>
      {derecha ? <Text style={{ color: colorDerecha ?? colorSistema.texto, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{derecha}</Text> : null}
    </Pressable>
  );
}

export default function BolsasDeLaSala() {
  const { user, hasPermission, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const puedeGuardar = hasPermission('bolsas', 'can_edit');
  const verMontos = hasPermission('bolsas_ver_montos');
  const todas = getScope?.('dash_bolsas_sala') === 'ALL' || getScope?.('bolsas') === 'ALL';
  const miSala = String(salaDelUsuario(user) ?? '');
  const [salaElegida, setSala] = useState(null);
  const [datos, setDatos] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const [dias, setDias] = useState(null);         // Set de fechas a entregar
  const [identidad, setIdentidad] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const hoy = hoySV();
    const [abiertas, faltan] = await Promise.all([
      fetchBolsas({ estados: ['ABIERTA'] }),
      fetchCortesPorEmbolsar({ desde: sumarDias(hoy, -1), hasta: hoy }),
    ]);
    if (!abiertas) { setDatos({ error: true, bolsas: [], faltan: [] }); return; }
    const saldos = await fetchSaldos(abiertas.map((b) => b.id));
    setDatos({ bolsas: abiertas.map((b) => ({ ...b, ...(saldos.get(b.id) || {}) })), faltan: faltan || [] });
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const nombre = (id) => (sucursales || []).find((b) => Number(b.id) === Number(id))?.name ?? `Sala ${id}`;
  const salasConAlgo = useMemo(() => [...new Set([...(datos?.bolsas || []), ...(datos?.faltan || [])].map((x) => String(x.branch_id)))]
    .sort((a, b) => ordenDeSala(a) - ordenDeSala(b)), [datos]);
  const sala = todas ? (salaElegida ?? (salasConAlgo.includes(miSala) ? miSala : salasConAlgo[0] ?? null)) : miSala;
  const enSala = (datos?.bolsas || []).filter((b) => String(b.branch_id) === String(sala));
  const faltan = (datos?.faltan || []).filter((c) => String(c.branch_id) === String(sala));
  const hoy = hoySV();
  const total = enSala.reduce((a, b) => a + saldoDeBolsa(b), 0);
  const vencidas = enSala.filter((b) => diasEntre(b.fecha, hoy) >= DIAS_DE_ALARMA).length;
  const porDia = useMemo(() => {
    const m = new Map();
    for (const b of enSala) { if (!m.has(b.fecha)) m.set(b.fecha, []); m.get(b.fecha).push(b); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [enSala]);
  const elegidos = dias ?? new Set(porDia.map(([f]) => f));
  const ids = porDia.filter(([f]) => elegidos.has(f)).flatMap(([, l]) => l.map((b) => b.id));

  const guardar = (c) => {
    Alert.alert(`¿Guardar el efectivo del corte de las ${hora12(c.hora)}?`,
      verMontos ? `Se registra una bolsa con ${formatMoney(c.sugerida)} y sale su etiqueta en la caja.` : 'Se registra la bolsa y sale su etiqueta en la caja.',
      [{ text: 'Cancelar', style: 'cancel' }, { text: 'Guardar', onPress: async () => {
        trabajando('Guardando la bolsa…');
        const { data, error } = await cerrarBolsa(c.corte_id, c.sugerida, { origen: 'app' });
        if (error) { fallo('No se pudo guardar', mensajeAmigable(error, 'Vuelve a intentar en un momento.')); return; }
        const r = await etiquetaDeLaBolsa(c.corte_id, c.branch_id, nombre(c.branch_id), user?.name || '');
        if (r.ok) listo('Bolsa guardada', `${data?.folio ?? ''} · pega la etiqueta en la bolsa`);
        else fallo('Bolsa guardada, pero la etiqueta no salió', `${r.detalle}`);
        cargar();
      } }]);
  };

  const opcionesDeBolsa = (b) => {
    const reimprimir = async () => {
      trabajando('Mandando la etiqueta a la caja…');
      const r = await reimprimirEtiqueta(b, nombre(b.branch_id), user?.name || '');
      if (r.ok) listo('Etiqueta enviada', `${b.folio} · sale en la caja de la sala`);
      else fallo('La etiqueta no salió', r.detalle);
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ title: b.folio, options: ['Reimprimir la etiqueta', 'Cancelar'], cancelButtonIndex: 1 },
        (i) => { if (i === 0) reimprimir(); });
    } else {
      Alert.alert(b.folio, null, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Reimprimir la etiqueta', onPress: reimprimir }]);
    }
  };

  const entregar = async () => {
    setOcupado(true); trabajando('Entregando las bolsas…');
    const { data, error } = await entregarBolsas(ids, identidad.persona.id, identidad.vale);
    setOcupado(false);
    if (error) {
      setIdentidad(null);   // el vale ya se gastó o venció: hay que volver a escanear
      fallo('No se pudo entregar', mensajeAmigable(error, 'Vuelve a escanear el carné e intenta de nuevo.'));
      return;
    }
    listo('Bolsas entregadas', `${ids.length} bolsa${ids.length === 1 ? '' : 's'}${data?.folio ? ` · entrega ${data.folio}` : ''}`);
    setEntregando(false); setIdentidad(null); setDias(null);
    cargar();
  };

  const grupos = todas && salasConAlgo.length > 1 ? [{ id: 'sala', titulo: 'Sala', activa: sala, porDefecto: sala, onCambiar: (v) => { setSala(v); setDias(null); },
    opciones: salasConAlgo.map((s) => ({ id: s, label: nombre(s) })) }] : [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Bolsas de efectivo', headerLargeTitle: true }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {datos?.error ? <Aviso tono="freno" texto="No se pudieron cargar las bolsas. Desliza hacia abajo para reintentar." /> : null}
        {sala ? <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '700', marginHorizontal: 4 }}>{nombre(sala)}</Text> : null}

        <Vidrio radio={24}>
          <View style={{ padding: 18, gap: 4 }}>
            <Text style={{ color: MARCA.verde, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {verMontos ? formatMoney(total) : `${enSala.length}`}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>
              {verMontos ? `guardado en ${enSala.length} bolsa${enSala.length === 1 ? '' : 's'}` : `bolsa${enSala.length === 1 ? '' : 's'} esperando el retiro`}
            </Text>
          </View>
        </Vidrio>

        {vencidas ? <Aviso tono="freno" texto={`${vencidas === 1 ? 'Una bolsa lleva' : `${vencidas} bolsas llevan`} ${DIAS_DE_ALARMA} días o más esperando el retiro. Avisa para que pasen a recogerlas.`} /> : null}

        {faltan.length ? (
          <Seccion titulo="Cortes sin bolsa">
            {faltan.map((c, i) => (
              <Renglon key={c.corte_id} primero={!i} titulo={`${rotularDia(c.fecha)} · ${hora12(c.hora)}`} detalle={c.caja || 'Sin nombre'}
                derecha={puedeGuardar ? 'Guardar ›' : (verMontos ? formatMoney(c.sugerida) : null)} colorDerecha={puedeGuardar ? colorSistema.acento : null}
                onPress={puedeGuardar ? () => guardar(c) : null} />
            ))}
          </Seccion>
        ) : null}

        {entregando ? (
          <Seccion titulo="Entregar al retiro">
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Elige los días que se llevan. Quien recoge escanea su carné.</Text>
            {porDia.map(([f, l], i) => (
              <Renglon key={f} primero={!i} marcado={elegidos.has(f)} titulo={rotularDia(f)} detalle={`${l.length} bolsa${l.length === 1 ? '' : 's'}`}
                derecha={verMontos ? formatMoney(l.reduce((a, b) => a + saldoDeBolsa(b), 0)) : null}
                onPress={() => { const s = new Set(elegidos); if (s.has(f)) s.delete(f); else s.add(f); setDias(s); }} />
            ))}
            <Identidad identidad={identidad} onIdentidad={setIdentidad} titulo="Escanea el carné de quien recoge" />
            {identidad ? (
              <BotonGrande texto={ocupado ? 'Entregando…' : `Entregar ${ids.length} bolsa${ids.length === 1 ? '' : 's'}`} color={MARCA.verde}
                deshabilitado={ocupado || !ids.length} onPress={entregar} />
            ) : null}
            <BotonGrande texto="Cancelar" borde onPress={() => { setEntregando(false); setIdentidad(null); setDias(null); }} />
          </Seccion>
        ) : (
          <>
            {enSala.length ? (
              <Seccion titulo="En la sala" pie="Toca una bolsa para reimprimir su etiqueta.">
                {enSala.map((b, i) => {
                  const d = diasEntre(b.fecha, hoy);
                  return (
                    <Renglon key={b.id} primero={!i} titulo={b.folio} detalle={`${rotularDia(b.fecha)}${b.hora ? ` · ${hora12(b.hora)}` : ''} · ${d === 0 ? 'de hoy' : `${d} día${d === 1 ? '' : 's'}`}`}
                      derecha={verMontos ? formatMoney(saldoDeBolsa(b)) : null} colorDerecha={d >= DIAS_DE_ALARMA ? MARCA.rojo : null}
                      onPress={puedeGuardar ? () => opcionesDeBolsa(b) : null} />
                  );
                })}
              </Seccion>
            ) : datos && !faltan.length ? (
              <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 12 }}>No hay bolsas esperando el retiro.</Text>
            ) : null}
            {puedeGuardar && enSala.length ? (
              <View style={{ gap: 10 }}>
                <BotonGrande texto="Entregar al retiro" color={MARCA.verde} onPress={() => setEntregando(true)} />
                <BotonGrande texto="Sacar dinero" borde onPress={() => router.push({ pathname: '/sacar-dinero', params: { sala } })} />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}
