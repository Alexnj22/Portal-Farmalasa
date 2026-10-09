// Inyecciones, NATIVO — lo que la sala hace con el teléfono en la mano
// (`InyeccionesView`):
//
//   · Pendientes: lo pagado y sin aplicar, una tarjeta por PAGO y producto
//     («2 de 5»), de TODAS las salas —el cliente puede venir a aplicarse acá
//     aunque haya pagado en otra—. Quien opera una caja marca cuántas aplica
//     ahora con el contador y confirma.
//   · Bitácora: cada aplicación de los últimos días, quién cobró, quién aplicó,
//     cuándo y dónde.
//
//   · Por cobrar: las ventas con inyección y su cobro, por vendedor, y los
//     cobros sueltos para asignar a mano (`componentes/inyecciones/PorCobrar`).
//   · Ajustes: precio por aplicación y aplicaciones por producto
//     (`componentes/inyecciones/Ajustes`).
// Las cuatro pestañas del portal, con sus mismos permisos. Agrupar y contar
// sale del núcleo (`inyeccionesPendientes`, `inyeccionesPorCobrar`,
// `inyeccionesAjustes`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { aplicarPendientes, fetchAplicacionesPendientes, fetchBitacoraDeAplicaciones } from '@nucleo/data/inyecciones';
import { diasDesde, gruposDePendientes, idsElegidos, resumenDePendientes } from '@nucleo/utils/inyeccionesPendientes';
import { fmtMl } from '@nucleo/utils/inyeccionDosis';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaHora12 } from '@nucleo/utils/hora';
import { fechaNumerica, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { MenuDeFiltros } from '../componentes/Filtros';
import PorCobrar, { periodosDePorCobrar } from '../componentes/inyecciones/PorCobrar';
import Ajustes from '../componentes/inyecciones/Ajustes';

const factura = (c) => String(c || '').replace(/^0+/, '');
const fechaCorta = (f) => fechaNumerica(String(f || '').slice(0, 10), { anio: false });

function Persona({ nombre, id, rol }) {
  if (!nombre) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Avatar empleado={{ id, name: nombre }} tamano={18} />
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{`${rol} ${shortEmployeeName({ name: nombre })}`}</Text>
    </View>
  );
}

function Contador({ valor, maximo, onCambiar }) {
  const boton = (texto, delta, apagado) => (
    <Pressable disabled={apagado} onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(valor + delta); }}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)', opacity: apagado ? 0.3 : pressed ? 0.5 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {boton('−', -1, valor <= 0)}
      <Text style={{ color: valor ? MARCA.verde : colorSistema.texto2, fontSize: 17, fontWeight: '800', minWidth: 54, textAlign: 'center' }}>{`${valor} de ${maximo}`}</Text>
      {boton('+', 1, valor >= maximo)}
    </View>
  );
}

function Pendientes({ busqueda, salaPropia, nombreSala, puedeAplicar }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [cuantas, setCuantas] = useState({});
  const [enviando, setEnviando] = useState(false);
  const cargar = useCallback(() => fetchAplicacionesPendientes({ buscar: busqueda, sala: null })
    .then((d) => { setFilas(d); setError(null); setCuantas({}); })
    .catch((e) => { setFilas([]); setError(mensajeAmigable(e, 'No se pudieron cargar las pendientes')); }), [busqueda]);
  useEffect(() => { cargar(); }, [cargar]);
  const grupos = useMemo(() => gruposDePendientes(filas), [filas]);
  const elegidas = useMemo(() => idsElegidos(grupos, cuantas), [grupos, cuantas]);
  const r = useMemo(() => resumenDePendientes(filas, salaPropia), [filas, salaPropia]);

  const aplicar = async () => {
    setEnviando(true); trabajando('Marcando…');
    try {
      const n = await aplicarPendientes(elegidas, salaPropia || null);
      useStaffStore.getState().appendAuditLog('INYECCION_APLICADA', elegidas.join(','), { aplicaciones: n, desde: 'app' });
      listo(n === 1 ? 'Aplicación marcada' : `${n} aplicaciones marcadas`, 'Quedan como aplicadas por ti.');
    } catch (e) { fallo('No se pudieron marcar', mensajeAmigable(e)); }
    setEnviando(false);
    cargar();
  };

  if (filas == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      <FilaDeKpis>
        <Kpi icono="Hourglass" rotulo="Por aplicar" valor={String(r.aplicaciones)} color={MARCA.azul} apoyo={`${formatMoney(r.total)} cobrados · ${r.clientes} clientes`} />
        <Kpi icono="AlertTriangle" rotulo="Con 7 días o más" valor={String(r.viejas)} color={r.viejas ? MARCA.ambar : MARCA.verde} apoyo="¿volvió el cliente?" />
      </FilaDeKpis>
      {salaPropia ? (
        <View style={{ marginHorizontal: 16 }}>
          <Aviso tono="nota" texto={`Se ven las de todas las sucursales: el cliente puede venir a aplicarse aquí aunque haya pagado en otra.${r.deOtras ? ` ${r.deOtras === 1 ? '1 es' : `${r.deOtras} son`} de otra sucursal.` : ''}`} />
        </View>
      ) : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {puedeAplicar && elegidas.length ? (
        <View style={{ marginHorizontal: 16 }}>
          <BotonGrande texto={enviando ? 'Marcando…' : elegidas.length > 1 ? `Marcar ${elegidas.length} aplicadas` : 'Marcar aplicada'} color={MARCA.verde} deshabilitado={enviando} onPress={aplicar} />
        </View>
      ) : null}
      {grupos.map(({ clave, p, ids }) => {
        const dias = diasDesde(p.pagada_at);
        const otraSala = salaPropia && p.branch_id !== salaPropia;
        const historial = Array.isArray(p.historial) ? p.historial : [];
        return (
          <View key={clave} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={20} tinte={(cuantas[clave] || 0) ? 'rgba(18,183,106,0.12)' : undefined}>
              <View style={{ padding: 14, gap: 6 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{p.cliente || 'Sin nombre'}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={2}>{p.producto}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{ids.length}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{ids.length === 1 ? 'pendiente' : 'pendientes'}</Text>
                  </View>
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {[p.correlativo ? `Factura ${factura(p.correlativo)}` : 'Traída por el cliente', `pagada ${fechaCorta(p.pagada_at)}`, dias ? `hace ${dias} día${dias === 1 ? '' : 's'}` : 'hoy', formatMoney(p.precio)].join(' · ')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {otraSala ? <Pildora texto={`Pagada en ${nombreSala(p.branch_id)}`} color={MARCA.ambar} /> : null}
                  {p.venta_sala ? <Pildora texto={`Venta de ${p.venta_sala}`} color={MARCA.azulClaro} /> : null}
                  {p.dosis_ml != null ? <Pildora texto={`${fmtMl(p.dosis_ml)} ml por aplicación`} color={MARCA.azulClaro} /> : null}
                  {p.mezclada ? <Pildora texto="Mezcladas · una aplicación" color={MARCA.azulClaro} /> : null}
                  {dias >= 7 ? <Pildora texto={`${dias} días`} color={MARCA.ambar} /> : null}
                </View>
                <Persona nombre={p.cobrada_por} id={p.cobrada_por_id} rol="Cobró" />
                {historial.map((h, i) => (
                  <Text key={i} style={{ color: colorSistema.texto2, fontSize: 12 }}>
                    {`Aplicada ${fechaHora12(h.aplicada_at)}${h.aplicada_en ? ` en ${h.aplicada_en}` : ''}${h.aplicada_por ? ` · ${shortEmployeeName({ name: h.aplicada_por })}` : ''}`}
                  </Text>
                ))}
                {puedeAplicar ? (
                  <View style={{ alignItems: 'flex-end', marginTop: 4 }}>
                    <Contador valor={cuantas[clave] || 0} maximo={ids.length} onCambiar={(n) => setCuantas((c) => ({ ...c, [clave]: n }))} />
                  </View>
                ) : null}
              </View>
            </Vidrio>
          </View>
        );
      })}
      {!grupos.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
          {busqueda ? 'Nadie con ese dato tiene aplicaciones pendientes' : 'Ninguna pendiente: todo lo pagado ya se aplicó'}
        </Text>
      ) : null}
    </>
  );
}

function Bitacora({ busqueda, salaPropia }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [dias, setDias] = useState(7);
  useEffect(() => {
    let vivo = true;
    setFilas(null);
    const hasta = hoySV();
    fetchBitacoraDeAplicaciones({ sala: salaPropia, desde: sumarDias(hasta, -(dias - 1)), hasta, buscar: busqueda })
      .then((d) => { if (vivo) { setFilas(d); setError(null); } })
      .catch((e) => { if (vivo) { setFilas([]); setError(mensajeAmigable(e)); } });
    return () => { vivo = false; };
  }, [busqueda, salaPropia, dias]);
  const aplicadas = (filas || []).filter((f) => f.estado === 'APLICADA').length;
  return (
    <>
      <Segmentos activa={String(dias)} onCambiar={(v) => setDias(Number(v))} opciones={[{ id: '1', label: 'Hoy' }, { id: '7', label: '7 días' }, { id: '30', label: '30 días' }]} />
      {filas ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${filas.length} pagadas · ${aplicadas} aplicadas`}</Text> : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : filas.map((f) => (
        <View key={f.id} style={{ marginHorizontal: 16 }}>
          <Vidrio radio={18}>
            <View style={{ padding: 12, gap: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{f.cliente || 'Sin nombre'}</Text>
                <Pildora texto={f.estado === 'APLICADA' ? 'Aplicada' : 'Pendiente'} color={f.estado === 'APLICADA' ? MARCA.verde : MARCA.ambar} />
              </View>
              <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={2}>{f.producto}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {[f.correlativo ? `Factura ${factura(f.correlativo)}` : null, f.sala, formatMoney(f.precio), fechaHora12(f.cobrada_at)].filter(Boolean).join(' · ')}
              </Text>
              <Persona nombre={f.cobrada_por} id={f.cobrada_por_id} rol="Cobró" />
              {f.estado === 'APLICADA' ? <Persona nombre={f.aplicada_por} id={f.aplicada_por_id} rol={`Aplicó${f.aplicada_en ? ` en ${f.aplicada_en}` : ''} ·`} /> : null}
            </View>
          </Vidrio>
        </View>
      ))}
      {filas && !filas.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Sin aplicaciones en el período</Text>
      ) : null}
    </>
  );
}

export default function Inyecciones() {
  const { user, hasPermission, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const puedeDosis = hasPermission('inyecciones_dosis');
  const puedePrecio = hasPermission('inyecciones_precios');
  const pestanas = useMemo(() => [
    hasPermission('inyecciones_tab_por_cobrar') && { id: 'por-cobrar', label: 'Por cobrar' },
    hasPermission('inyecciones_tab_pendientes') && { id: 'pendientes', label: 'Pendientes' },
    hasPermission('inyecciones_tab_bitacora') && { id: 'bitacora', label: 'Bitácora' },
    (hasPermission('inyecciones_dosis') || hasPermission('inyecciones_precios')) && { id: 'ajustes', label: 'Ajustes' },
  ].filter(Boolean), [hasPermission]);
  const [elegida, setPestana] = useState(null);
  const pestana = elegida && pestanas.some((p) => p.id === elegida) ? elegida : pestanas[0]?.id;
  const salaPropia = getScope?.('inyecciones') !== 'ALL' ? Number(user?.branchId) || null : null;
  const nombreSala = (id) => (sucursales || []).find((b) => b.id === id)?.name || '—';
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto, 350).trim();
  const [llave, setLlave] = useState(0);
  const [recargando, setRecargando] = useState(false);
  // Por cobrar: período y sala propios (el portal también los separa del resto).
  const periodos = useMemo(() => periodosDePorCobrar(), []);
  const [rango, setRango] = useState(periodos[0].id);
  const [salaFiltro, setSalaFiltro] = useState('todas');
  const salaPorCobrar = salaPropia || (salaFiltro === 'todas' ? null : Number(salaFiltro));
  // Al volver de asignar un cobro o de guardar por ml, se relee.
  const [vuelta, setVuelta] = useState(0);
  useFocusEffect(useCallback(() => { setVuelta((v) => v + 1); }, []));

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Inyecciones', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Cliente, factura o inyección', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      {pestana === 'por-cobrar' ? (
        <MenuDeFiltros grupos={[
          { id: 'periodo', titulo: 'Período', activa: rango, porDefecto: periodos[0].id, onCambiar: setRango, opciones: periodos },
          ...(salaPropia ? [] : [{ id: 'sala', titulo: 'Sucursal', activa: salaFiltro, porDefecto: 'todas', onCambiar: setSalaFiltro,
            opciones: [{ id: 'todas', label: 'Todas las salas' }, ...(sucursales || []).map((b) => ({ id: String(b.id), label: b.name }))] }]),
        ]} />
      ) : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={() => { setRecargando(true); setLlave((k) => k + 1); setTimeout(() => setRecargando(false), 600); }} />}>
        {pestanas.length > 1 ? <Segmentos activa={pestana} onCambiar={setPestana} opciones={pestanas} /> : null}
        {!pestana ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto="Tu cargo no tiene acceso a las inyecciones." /></View>
          : pestana === 'por-cobrar'
            ? <PorCobrar busqueda={busqueda} sala={salaPorCobrar} nombreSala={nombreSala} puedeAsignar={puedeDosis} rango={rango} recarga={`${llave}-${vuelta}`} />
            : pestana === 'ajustes'
              ? <Ajustes puedePrecio={puedePrecio} puedeDosis={puedeDosis} recarga={`${llave}-${vuelta}`} />
              : pestana === 'pendientes'
                ? <Pendientes key={llave} busqueda={busqueda} salaPropia={salaPropia} nombreSala={nombreSala} puedeAplicar={hasPermission('caja_vales', 'can_edit')} />
                : <Bitacora key={llave} busqueda={busqueda} salaPropia={salaPropia} />}
      </ScrollView>
    </>
  );
}
