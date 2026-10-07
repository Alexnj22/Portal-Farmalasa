// Promociones, NATIVO — `PromocionesView` con sus pestañas: Activas,
// Descuentos, Excedentes, Pagos e Histórico. El seguimiento de cada promoción
// (lo vendido contra el lote, «quién vendió», la matriz de laboratorio) se abre
// tocando su tarjeta (`promocion/[id]`).
//
// Las tarjetas de arriba describen LO QUE SE ESTÁ MIRANDO —se cuentan sobre la
// lista ya filtrada, con `conteoDePromociones` del núcleo, las mismas del
// portal—: una fila de números que ignora el filtro dice 30 mientras la
// pantalla muestra 4. Estado, Tipo y Laboratorio van en el menú de filtros.
//
// Mantener presionada una tarjeta: Volver a borrador / Activar (con la misma
// confirmación del portal) y Duplicar. Crear y editar siguen en el portal.
import { useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchPromociones } from '@nucleo/data/promociones';
import {
  conteoDePromociones, diasRestantes, esLaboratorio, estadoVisible, fmtLote, fmtUnidades, fmtVigencia,
  mensajeDeCarga, rotuloMes, textoBuscable,
} from '@nucleo/utils/promocionesUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import Segmentos from '../componentes/Segmentos';
import { MenuDeFiltros, FiltrosActivos } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import { MARCA } from '../componentes/inicio/marca';
import { colorDeVariante } from '../componentes/colorDeVariante';
import { Icono, TresDatos } from '../componentes/promociones/Piezas';
import { alternarPromocion, duplicarConPreguntas } from '../componentes/promociones/acciones';
import { Descuentos, Excedentes, Pagos } from '../componentes/promociones/Listas';
import { guardarPromocion } from '../componentes/promociones/elegida';

function TarjetaPromocion({ p, puedeEditar, onAbrir, onMenu }) {
  const e = estadoVisible(p);
  const lab = esLaboratorio(p);
  const labs = Array.isArray(p.laboratorios) ? p.laboratorios : [];
  const dias = diasRestantes(p.fin);
  return (
    <Pressable onPress={onAbrir} onLongPress={puedeEditar ? onMenu : undefined} delayLongPress={350}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={20} interactivo>
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{p.nombre}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                {lab ? rotuloMes(p.year_month) : fmtVigencia(p.inicio, p.fin)}
                {dias !== null && dias >= 0 && p.estado === 'activa' ? ` · quedan ${dias} ${dias === 1 ? 'día' : 'días'}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Pildora texto={e.rotulo} color={colorDeVariante(e.variant)} />
              {Number(p.descuentos) > 0 ? <Pildora texto="Baja el precio" color={MARCA.azulClaro} /> : null}
            </View>
          </View>
          {labs.length ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {lab ? <Icono nombre="FlaskConical" tamano={13} /> : null}
              <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{labs.join(' · ')}</Text>
            </View>
          ) : null}
          <TresDatos datos={lab ? [
            { rotulo: 'Laboratorios', valor: fmtUnidades(labs.length) },
            { rotulo: 'Niveles', valor: fmtUnidades(p.niveles) },
            { rotulo: 'Salas', valor: fmtUnidades(p.salas) },
          ] : [
            { rotulo: 'Productos', valor: fmtUnidades(p.renglones) },
            { rotulo: 'Abiertos', valor: fmtUnidades(p.abiertos) },
            { rotulo: 'Lote', valor: p.lote_total == null ? '—' : `${fmtLote(p.lote_total)} u.` },
          ]} />
          {p.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontStyle: 'italic' }}>{p.nota}</Text> : null}
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function Promociones() {
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('promociones', 'can_edit');
  const puedeAprobar = hasPermission('promociones', 'can_approve');
  const branches = useStaffStore((s) => s.branches);
  const [pestana, setPestana] = useState('activas');
  const [promos, setPromos] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState('');
  const [fEstado, setFEstado] = useState('todos');
  const [fTipo, setFTipo] = useState('todos');
  const [fLab, setFLab] = useState('todos');
  const [fPagos, setFPagos] = useState('pendientes');
  const [recargando, setRecargando] = useState(false);
  const [vuelta, setVuelta] = useState(0); // remonta las pestañas hijas al deslizar

  const cargar = useCallback(async () => {
    try { setPromos(await fetchPromociones()); setError(null); }
    catch (e) { setError(mensajeDeCarga(e, 'No se pudieron cargar las promociones.')); setPromos((x) => x ?? []); }
  }, []);
  // Al volver del detalle se relee: lo que se pausó o duplicó tiene que verse.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const q = texto.trim();
  const labsDisponibles = useMemo(() => [...new Set((promos || []).flatMap((p) => p.laboratorios || []))].sort((a, b) => a.localeCompare(b, 'es')), [promos]);
  const filtradas = useMemo(() => (promos || []).filter((p) => {
    if (q && !tokenMatch(q, textoBuscable(p))) return false;
    if (fTipo !== 'todos' && (esLaboratorio(p) ? 'laboratorio' : 'producto') !== fTipo) return false;
    if (fLab !== 'todos' && !(p.laboratorios || []).includes(fLab)) return false;
    return true;
  }), [promos, q, fTipo, fLab]);
  const vivas = useMemo(() => filtradas.filter((p) => p.estado !== 'finalizada' && (fEstado === 'todos' || estadoVisible(p).clave === fEstado)), [filtradas, fEstado]);
  const terminadas = useMemo(() => filtradas.filter((p) => p.estado === 'finalizada'), [filtradas]);
  const c = conteoDePromociones(vivas);
  const salaDe = useCallback((id) => (branches || []).find((b) => String(b.id) === String(id))?.name ?? null, [branches]);

  const recortaLista = pestana === 'activas' || pestana === 'historico';
  const grupos = [
    ...(pestana === 'activas' ? [{ id: 'estado', titulo: 'Estado', activa: fEstado, porDefecto: 'todos', onCambiar: setFEstado,
      opciones: [{ id: 'todos', label: 'Todos los estados' }, { id: 'activa', label: 'Activa' }, { id: 'por_vencer', label: 'Por vencer' }, { id: 'borrador', label: 'Borrador' }] }] : []),
    ...(recortaLista ? [
      { id: 'tipo', titulo: 'Tipo', activa: fTipo, porDefecto: 'todos', onCambiar: setFTipo,
        opciones: [{ id: 'todos', label: 'Todos los tipos' }, { id: 'producto', label: 'Por producto' }, { id: 'laboratorio', label: 'Por laboratorio' }] },
      { id: 'lab', titulo: 'Laboratorio', activa: fLab, porDefecto: 'todos', onCambiar: setFLab,
        opciones: [{ id: 'todos', label: 'Todos los laboratorios' }, ...labsDisponibles.map((l) => ({ id: l, label: l }))] },
    ] : []),
    ...(pestana === 'pagos' ? [{ id: 'pagos', titulo: 'Pagos', activa: fPagos, porDefecto: 'pendientes', onCambiar: setFPagos,
      opciones: [{ id: 'pendientes', label: 'Sólo con algo por pagar' }, { id: 'todas', label: 'Todas' }] }] : []),
  ];

  const abrir = (p) => { Haptics.selectionAsync().catch(() => {}); guardarPromocion(p); router.push({ pathname: '/promocion/[id]', params: { id: String(p.id), tipo: p.tipo || 'producto' } }); };
  const menu = (p) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const pausable = p.estado !== 'finalizada';
    // Reactivar: las terminadas de producto (la de laboratorio vive por mes: se duplica).
    const reactivable = p.estado === 'finalizada' && !esLaboratorio(p);
    // Editar en la app: las dos (laboratorio y producto), mientras no terminen.
    const editable = p.estado !== 'finalizada';
    const opciones = [...(editable ? ['Editar'] : []), ...(pausable ? [p.estado === 'activa' ? 'Volver a borrador' : 'Activar'] : []), ...(reactivable ? ['Reactivar'] : []), 'Duplicar', 'Ver el seguimiento', 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: p.nombre, options: opciones, cancelButtonIndex: opciones.length - 1, destructiveButtonIndex: pausable && p.estado === 'activa' ? opciones.indexOf('Volver a borrador') : undefined }, (i) => {
      const o = opciones[i];
      if (o === 'Editar') { router.push({ pathname: esLaboratorio(p) ? '/promocion-laboratorio/[id]' : '/promocion-producto/[id]', params: { id: String(p.id) } }); return; }
      if (o === 'Volver a borrador' || o === 'Activar') alternarPromocion(p, cargar);
      else if (o === 'Reactivar') { guardarPromocion(p); router.push({ pathname: '/promocion-reactivar/[id]', params: { id: String(p.id) } }); }
      else if (o === 'Duplicar') duplicarConPreguntas(p, branches, cargar);
      else if (o === 'Ver el seguimiento') abrir(p);
    });
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Promociones', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: pestana === 'excedentes' ? 'Persona, producto o sala' : 'Nombre, laboratorio o nota', hideWhenScrolling: false,
          onChangeText: (ev) => setTexto(ev.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setVuelta((n) => n + 1); setRecargando(false); }} />}>
        <Segmentos activa={pestana} onCambiar={setPestana} opciones={[
          { id: 'activas', label: 'Activas' }, { id: 'descuentos', label: 'Descuentos' },
          { id: 'excedentes', label: 'Excedentes' }, { id: 'pagos', label: 'Pagos' }, { id: 'historico', label: 'Histórico' },
        ]} />
        <FiltrosActivos grupos={grupos} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}

        {pestana === 'activas' ? (
          promos == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
            <>
              <FilaDeKpis>
                <Kpi icono="Star" rotulo="Activas" valor={String(c.activas)} color={MARCA.verde} onPress={() => setFEstado(fEstado === 'activa' ? 'todos' : 'activa')} />
                <Kpi icono="CalendarClock" rotulo="Por vencer" valor={String(c.porVencer)} color={MARCA.ambar} pide={c.porVencer > 0}
                  onPress={() => setFEstado(fEstado === 'por_vencer' ? 'todos' : 'por_vencer')} />
              </FilaDeKpis>
              <FilaDeKpis>
                <Kpi icono="FileText" rotulo="En borrador" valor={String(c.borrador)} color={colorSistema.texto2} onPress={() => setFEstado(fEstado === 'borrador' ? 'todos' : 'borrador')} />
                <Kpi icono="Package" rotulo="Abiertos" valor={fmtUnidades(c.abiertos)} color={MARCA.azulClaro} apoyo={`${c.bajanPrecio} bajan el precio`} />
              </FilaDeKpis>
              {vivas.map((p) => <TarjetaPromocion key={p.id} p={p} puedeEditar={puedeEditar} onAbrir={() => abrir(p)} onMenu={() => menu(p)} />)}
              {!vivas.length ? (
                <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>
                  {q || fEstado !== 'todos' || fTipo !== 'todos' || fLab !== 'todos' ? 'Ninguna promoción vigente con ese filtro'
                    : terminadas.length ? 'Sin promociones vigentes: las demás están en Histórico' : 'Todavía no hay promociones'}
                </Text>
              ) : null}
              {puedeEditar && vivas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>Mantén presionada una promoción para editarla, pausarla, activarla o duplicarla.</Text> : null}
            </>
          )
        ) : null}

        {pestana === 'historico' ? (
          promos == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
            <>
              <FilaDeKpis>
                <Kpi icono="Archive" rotulo="Terminadas" valor={String(terminadas.length)} color={colorSistema.texto2} />
                <Kpi icono="Package" rotulo="Productos" valor={fmtUnidades(terminadas.reduce((a, p) => a + (Number(p.renglones) || 0), 0))} color={MARCA.azulClaro}
                  apoyo={`${new Set(terminadas.flatMap((p) => p.laboratorios || [])).size} laboratorios`} />
              </FilaDeKpis>
              {terminadas.map((p) => <TarjetaPromocion key={p.id} p={p} puedeEditar={puedeEditar} onAbrir={() => abrir(p)} onMenu={() => menu(p)} />)}
              {!terminadas.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin promociones terminadas</Text> : null}
            </>
          )
        ) : null}

        {pestana === 'descuentos' ? <Descuentos key={`d${vuelta}`} busqueda={q} salaDe={salaDe} /> : null}
        {pestana === 'excedentes' ? <Excedentes key={`e${vuelta}`} busqueda={q} puedeAprobar={puedeAprobar} /> : null}
        {pestana === 'pagos' ? <Pagos key={`p${vuelta}`} busqueda={q} soloPendientes={fPagos === 'pendientes'} /> : null}

        {puedeEditar ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <View style={{ marginBottom: 10 }}>
              <BotonGrande texto="Nueva promoción por laboratorio" color={MARCA.azul}
                onPress={() => router.push({ pathname: '/promocion-laboratorio/[id]', params: { id: 'nueva' } })} />
            </View>
            <BotonGrande texto="Nueva promoción por producto" borde color={MARCA.azulClaro}
              onPress={() => router.push('/promocion-producto/nueva')} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
