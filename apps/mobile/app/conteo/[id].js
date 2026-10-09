// Contar, NATIVO — la pantalla de un conteo de inventario
// (`ConteoDetailView`) para hacerlo de pie frente al estante: buscar o escanear
// el producto, ver sus renglones (presentación, lote y vencimiento) y escribir
// cuánto hay. Cada renglón se guarda solo al terminar de escribirlo
// (`guardarConteoItem`): el conteo es largo y no puede depender de un botón al
// final. Qué estado deja un número (vacío = pendiente, número = contado, «no
// ubicado» = 0 aparte) lo decide el núcleo (`conteoDeInventario`).
//
// Si el conteo es CIEGO para este cargo, la base no manda la cantidad del
// sistema y acá no se muestra: contar viendo la cifra es lo que el ciego evita.
// Un renglón ya contado queda cerrado; «Editar» lo abre (como el candado del
// portal) para que un toque no cambie un conteo hecho.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, AppState, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FiltrosActivos, MenuDeFiltros } from '../../componentes/Filtros';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cantidadValida, conteoEditable, ESTADO_CONTEO, FILTROS_CONTEO, faltaAjusteDelConteo, guardadoDelRenglon, noUbicado } from '@nucleo/utils/conteoDeInventario';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { Chip } from '../../componentes/inicio/Widget';
import Escaner from '../../componentes/Escaner';
import Segmentos from '../../componentes/Segmentos';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { cerrarProgreso, fallo, listo, trabajando } from '../../componentes/Progreso';
import { compartirPdf } from '../../componentes/pdf';
import { compartirCsv } from '../../componentes/fiscal/csv';
import { csvDeAjustesConteo } from '@nucleo/utils/conteoPapel';
import { ajusteDeConteoHtml, hojaDeConteoHtml, resultadosDeConteoHtml } from '@nucleo/utils/conteoPapelHtml';
import { registrarEgreso } from '@nucleo/data/egreso';
import Resumen from '../../componentes/conteos/Resumen';
import Historial from '../../componentes/conteos/Historial';
import AgregarRenglon from '../../componentes/conteos/AgregarRenglon';
import AccionDeRenglon from '../../componentes/conteos/AccionDeRenglon';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fmtHM } from '@nucleo/utils/tableroDePedidos';

const POR_PAGINA = 20;
const vence = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'short', year: '2-digit' }) : 'sin fecha');

function Renglon({ it, editable, onGuardado, onHistorial, onLote, onRecontar }) {
  const guardarConteoItem = useStaffStore((s) => s.guardarConteoItem);
  const [valor, setValor] = useState(it.fisico_cantidad ?? '');
  const [abierto, setAbierto] = useState(it.estado_item === 'PENDIENTE');
  const [guardando, setGuardando] = useState(false);
  const ultimo = useRef(it.fisico_cantidad ?? '');
  const contado = it.estado_item !== 'PENDIENTE';

  const guardar = async (payload) => {
    setGuardando(true);
    try {
      const r = await guardarConteoItem(it.id, payload);
      ultimo.current = payload.fisicoCantidad ?? '';
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setAbierto(payload.estadoItem === 'PENDIENTE');
      onGuardado(it.id, { ...payload, sistema: r?.sistema_cantidad });
    } catch (e) {
      setValor(ultimo.current);
      fallo('No se guardó el conteo', `${it.product_nombre || 'Esta línea'}: ${mensajeAmigable(e)}`);
    } finally {
      setGuardando(false);
    }
  };
  const alTerminar = () => {
    if (String(valor) === String(ultimo.current)) return;
    if (!cantidadValida(valor)) { fallo('Cantidad inválida', 'El conteo físico debe ser un número entero de 0 o más.'); setValor(ultimo.current); return; }
    guardar(guardadoDelRenglon(valor, it.nota));
  };
  const puedeEscribir = editable && abierto;
  const dif = it.ver_sistema && it.sistema_cantidad != null && valor !== '' ? Number(valor) - it.sistema_cantidad : null;

  return (
    <View style={{ gap: 6, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>
            {`${it.presentacion || 'Presentación'}${it.detalle ? ` · ${it.detalle}` : ''}`}
          </Text>
          <Text style={{ color: it.is_vencidos ? MARCA.rojo : colorSistema.texto2, fontSize: 13 }}>
            {[it.lote ? `Lote ${it.lote}` : 'Sin lote', `vence ${vence(it.fecha_vencimiento)}`, it.is_vencidos ? 'área de vencidos' : null].filter(Boolean).join(' · ')}
          </Text>
          {it.ver_sistema && it.sistema_cantidad != null ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Sistema: ${it.sistema_cantidad}`}</Text> : null}
        </View>
        {puedeEscribir ? (
          <View style={{ width: 92 }}>
            <Campo multiline={false} value={String(valor)} keyboardType="number-pad" placeholder="—" style={{ textAlign: 'center', fontSize: 18, fontWeight: '700' }}
              onChangeText={(v) => setValor(v.replace(/[^\d]/g, ''))} onEndEditing={alTerminar} onSubmitEditing={alTerminar} editable={!guardando} />
          </View>
        ) : (
          <Pressable disabled={!editable} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(true); }}
            style={({ pressed }) => ({ alignItems: 'flex-end', minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: it.estado_item === 'SIN_UBICAR' ? MARCA.ambar : colorSistema.texto, fontSize: 20, fontWeight: '800' }}>
              {it.estado_item === 'SIN_UBICAR' ? 'No ubicado' : String(it.fisico_cantidad ?? '—')}
            </Text>
            {editable ? <Text style={{ color: MARCA.azulClaro, fontSize: 12 }}>Editar</Text> : null}
          </Pressable>
        )}
      </View>
      {guardando ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Guardando…</Text> : null}
      {dif != null && contado && dif !== 0 ? <Pildora texto={`${dif > 0 ? '+' : ''}${dif} contra el sistema`} color={dif < 0 ? MARCA.rojo : MARCA.ambar} /> : null}
      {puedeEscribir && it.ver_sistema && it.sistema_cantidad > 0 ? (
        <Pressable onPress={() => guardar(noUbicado(it.nota))} style={({ pressed }) => ({ minHeight: 36, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '600' }}>No lo encuentro</Text>
        </Pressable>
      ) : null}
      {/* Quién lo contó, y su historial a un toque — `AutorLinea` del portal. */}
      {contado ? (
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onHistorial(it); }} hitSlop={6}
          style={({ pressed }) => ({ minHeight: 32, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
            {`${it.contado_por_nombre ? `Contó ${shortEmployeeName(it.contado_por_nombre)}` : 'Contado'}${it.contado_at ? ` · ${fmtHM(it.contado_at)}` : ''}  `}
            <Text style={{ color: MARCA.azulClaro, fontWeight: '600' }}>Ver historial</Text>
          </Text>
        </Pressable>
      ) : null}
      {onLote || onRecontar ? (
        <View style={{ flexDirection: 'row', gap: 18 }}>
          {onLote ? (
            <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onLote(it); }} hitSlop={6} style={({ pressed }) => ({ minHeight: 32, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '600' }}>Corregir lote</Text>
            </Pressable>
          ) : null}
          {onRecontar ? (
            <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onRecontar(it); }} hitSlop={6} style={({ pressed }) => ({ minHeight: 32, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
              <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>{it.recontado_at ? 'Recontar otra vez' : 'Recontar'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {it.recontado_at ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Recontado${it.fisico_primer_conteo != null ? ` · primer conteo ${it.fisico_primer_conteo}` : ''}`}</Text> : null}
    </View>
  );
}

const contadosVivos = (r) => Number(r?.contados ?? 0);

export default function Conteo() {
  const { id } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const fetchConteoDetalle = useStaffStore((s) => s.fetchConteoDetalle);
  const fetchConteoProductsPage = useStaffStore((s) => s.fetchConteoProductsPage);
  const fetchConteoItemsForProducts = useStaffStore((s) => s.fetchConteoItemsForProducts);
  const finalizarConteoInventario = useStaffStore((s) => s.finalizarConteoInventario);
  const fetchConteoResumen = useStaffStore((s) => s.fetchConteoResumen);
  const aprobarConteoInventario = useStaffStore((s) => s.aprobarConteoInventario);
  const marcarAjusteErp = useStaffStore((s) => s.marcarAjusteErp);
  const fetchConteoLaboratorios = useStaffStore((s) => s.fetchConteoLaboratorios);
  const sincronizarConteoEnVivo = useStaffStore((s) => s.sincronizarConteoEnVivo);
  const eliminarConteoInventario = useStaffStore((s) => s.eliminarConteoInventario);
  const fetchTodosLosItemsConteo = useStaffStore((s) => s.fetchTodosLosItemsConteo);
  const [labs, setLabs] = useState([]);
  const [laboratorioId, setLaboratorioId] = useState('todos');
  const [agregando, setAgregando] = useState(false);
  const [accion, setAccion] = useState(null);   // { item, modo: 'lote' | 'recuento' }
  const [conteo, setConteo] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto, 350).trim();
  const [filtro, setFiltro] = useState('PENDIENTES');
  const [pagina, setPagina] = useState(1);
  const [productos, setProductos] = useState({ filas: [], total: 0, aproximado: false });
  const [items, setItems] = useState({});
  const [abierto, setAbierto] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [escaneando, setEscaneando] = useState(false);
  const [historial, setHistorial] = useState(null);
  const pedido = useRef(0);

  const cargarConteo = useCallback(async () => {
    const [c, r] = await Promise.all([fetchConteoDetalle(id).catch(() => null), fetchConteoResumen(id).catch(() => null)]);
    setConteo(c); setResumen(r);
  }, [id, fetchConteoDetalle, fetchConteoResumen]);
  useEffect(() => { cargarConteo(); }, [cargarConteo]);
  useEffect(() => { setPagina(1); }, [busqueda, filtro, laboratorioId]);
  // Los laboratorios del conteo no cambian mientras se cuenta: una vez.
  useEffect(() => {
    let vivo = true;
    Promise.resolve(fetchConteoLaboratorios(id)).then((r) => { if (vivo) setLabs(r ?? []); }).catch(() => {});
    return () => { vivo = false; };
  }, [id, fetchConteoLaboratorios]);

  const cargar = useCallback(async () => {
    const yo = ++pedido.current;
    setCargando(true);
    try {
      const r = await fetchConteoProductsPage(id, { page: pagina, pageSize: POR_PAGINA, search: busqueda, filtro, laboratorioId: laboratorioId === 'todos' ? null : Number(laboratorioId) });
      if (yo !== pedido.current) return;
      setProductos((p) => ({ filas: pagina === 1 ? r.rows : [...p.filas, ...r.rows], total: r.total, aproximado: r.aproximado }));
      // Si la búsqueda deja UN producto (lo típico al escanear), se abre solo.
      if (pagina === 1 && busqueda && r.rows.length === 1) setAbierto(r.rows[0].erp_product_id);
    } catch (e) {
      if (yo === pedido.current) fallo('No se pudo cargar el conteo', mensajeAmigable(e));
    } finally {
      if (yo === pedido.current) setCargando(false);
    }
  }, [id, pagina, busqueda, filtro, laboratorioId, fetchConteoProductsPage]);
  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    if (abierto == null || items[abierto]) return;
    fetchConteoItemsForProducts(id, [abierto]).then((filas) => setItems((m) => ({ ...m, [abierto]: filas }))).catch(() => {});
  }, [abierto, id, items, fetchConteoItemsForProducts]);

  const puedeEditar = hasPermission('conteo_inventario', 'can_edit');
  const editable = conteoEditable(conteo) && puedeEditar;
  // Mismas condiciones que el portal: aprobar y recontar, finalizado y con can_approve.
  const puedeAprobar = conteo?.status === 'FINALIZADO' && hasPermission('conteo_inventario', 'can_approve');
  const simple = conteo?.modo === 'SIMPLE';
  const verSistema = resumen?.ver_sistema ?? productos.filas.some((p) => p.ver_sistema);
  const filtros = FILTROS_CONTEO.filter((f) => !f.soloConSistema || verSistema);
  const sala = (sucursales || []).find((b) => String(b.id) === String(conteo?.branch_id))?.name;

  // Lo que entra a la sala DESPUÉS de empezar el conteo se suma solo, como en el
  // portal: al abrir y cada vez que la app vuelve al frente (contar toma horas
  // y la pantalla se deja abierta). Y se avisa: el «faltan N» sube.
  const cargarRef = useRef(null);
  useEffect(() => { cargarRef.current = () => { cargar(); cargarConteo(); }; });
  const abiertoParaContar = conteoEditable(conteo);
  useEffect(() => {
    if (!abiertoParaContar) return undefined;
    let vivo = true;
    const traer = () => Promise.resolve(sincronizarConteoEnVivo(id)).then((r) => {
      if (!vivo || !r?.agregados) return;
      const n = r.agregados;
      listo('Llegaron productos nuevos', `Se ${n === 1 ? 'agregó 1 producto que entró' : `agregaron ${n} productos que entraron`} a la sala después de empezar el conteo. Ya se pueden contar.`);
      cargarRef.current?.();
    }).catch(() => {});
    traer();
    const sub = AppState.addEventListener('change', (e) => { if (e === 'active') traer(); });
    return () => { vivo = false; sub.remove(); };
  }, [id, abiertoParaContar, sincronizarConteoEnVivo]);

  // Eliminar: con el permiso propio, o mientras no se haya contado nada.
  const puedeEliminar = puedeEditar && (hasPermission('conteo_inventario_eliminar') || (conteoEditable(conteo) && contadosVivos(resumen) === 0));
  const eliminar = () => Alert.alert('Eliminar el conteo', `Se borra el conteo de ${sala ?? 'la sala'} con todos sus renglones. No se puede deshacer.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Eliminar', style: 'destructive', onPress: async () => {
      trabajando('Eliminando…');
      try {
        const r = await eliminarConteoInventario(id);
        listo('Conteo eliminado', `Se borraron ${r?.total_items ?? 0} renglón(es).`);
        router.back();
      } catch (e) { fallo('No se pudo eliminar', mensajeAmigable(e)); }
    } },
  ]);
  // El papel del conteo: hoja para contar (ciega si el dato no viene), resultados,
  // ajuste en PDF o CSV — el contenido del núcleo (`conteoPapel`), el del portal.
  const puedePapel = hasPermission('conteo_inventario_descargar');
  const papel = () => {
    const op = [['Hoja para contar', 'hoja'], ['Resultados', 'resultados'], ['Ajuste (PDF)', 'ajuste'], ['Ajuste (CSV)', 'csv']];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Papel del conteo', options: [...op.map((o) => o[0]), 'Cancelar'], cancelButtonIndex: op.length }, async (i) => {
      const tipo = op[i]?.[1];
      if (!tipo) return;
      trabajando('Preparando el documento…');
      try {
        const todos = await fetchTodosLosItemsConteo(id);
        const c = { ...conteo, branches: { name: sala } };
        if (tipo === 'csv') {
          const { headers, rows, nombre } = csvDeAjustesConteo(c, todos);
          cerrarProgreso();
          await compartirCsv({ headers, rows, nombre, modulo: 'conteo_inventario', detalle: { conteo_id: id } });
          return;
        }
        const html = tipo === 'hoja' ? hojaDeConteoHtml(c, todos, { ciego: !todos[0]?.ver_sistema })
          : tipo === 'resultados' ? resultadosDeConteoHtml(c, todos) : ajusteDeConteoHtml(c, todos);
        cerrarProgreso();
        if (await compartirPdf({ html, nombre: `${op[i][0]} ${sala ?? ''}` })) registrarEgreso('conteo_inventario', { formato: 'pdf', filas: todos.length, detalle: { conteo_id: id, tipo, via: 'app' } });
      } catch (e) { fallo('No se pudo armar el documento', mensajeAmigable(e)); }
    });
  };

  const gruposLab = labs.length > 1 ? [{ id: 'lab', titulo: 'Laboratorio', activa: laboratorioId, porDefecto: 'todos', onCambiar: setLaboratorioId,
    opciones: [{ id: 'todos', label: 'Todos' }, ...labs.map((l) => ({ id: String(l.laboratorio_id ?? l.id), label: l.laboratorio_nombre ?? l.nombre ?? '—' }))] }] : [];
  // Mientras el conteo está abierto, los totales de la fila vienen vacíos: manda el resumen en vivo.
  const total = Number(resumen?.total_items ?? conteo?.total_items) || 0;
  const contados = Number(resumen?.contados ?? conteo?.total_contados) || 0;

  const alGuardar = (erp) => (itemId, cambio) => {
    const nuevos = (items[erp] || []).map((it) => (it.id === itemId
      ? { ...it, fisico_cantidad: cambio.fisicoCantidad, estado_item: cambio.estadoItem, sistema_cantidad: cambio.sistema ?? it.sistema_cantidad }
      : it));
    setItems((m) => ({ ...m, [erp]: nuevos }));
    // La píldora «contados/total» del producto, sin esperar a recargar la página.
    const contadosDelProducto = nuevos.filter((it) => it.estado_item !== 'PENDIENTE').length;
    setProductos((p) => ({ ...p, filas: p.filas.map((f) => (f.erp_product_id === erp ? { ...f, contados_count: contadosDelProducto } : f)) }));
    cargarConteo();
  };

  // Lo que devolvió el servidor al corregir el lote o recontar, sin recargar la página.
  const alAccion = (itemId, cambio) => {
    setItems((m) => Object.fromEntries(Object.entries(m).map(([erp, filas]) => [erp, filas.map((it) => (it.id === itemId ? { ...it, ...cambio } : it))])));
    cargarConteo();
  };

  const aprobar = () => {
    Alert.prompt('Aprobar conteo', 'Queda cerrado y con firma auditable. No puedes aprobar un conteo que finalizaste tú mismo.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Aprobar', onPress: async (nota) => {
          trabajando('Aprobando el conteo…');
          try {
            await aprobarConteoInventario(id, (nota || '').trim() || null);
            listo('Conteo aprobado', 'Queda cerrado y con firma auditable.');
            cargarConteo();
          } catch (e) { fallo('No se pudo aprobar', mensajeAmigable(e)); }
        },
      },
    ], 'plain-text', '', 'default');
  };

  const registrarAjuste = () => {
    Alert.prompt('Registrar ajuste aplicado', 'Esto no modifica existencias: sólo deja constancia de que el ajuste ya se aplicó, para que este conteo no quede como pendiente. Escribe la referencia si la tienes.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Ya lo apliqué', onPress: async (nota) => {
          trabajando('Registrando el ajuste…');
          try {
            await marcarAjusteErp(id, (nota || '').trim() || null);
            listo('Ajuste registrado', 'Queda constancia de que el ajuste ya se aplicó.');
            cargarConteo();
          } catch (e) { fallo('No se pudo registrar', mensajeAmigable(e)); }
        },
      },
    ], 'plain-text', '', 'default');
  };

  const finalizar = () => {
    const pendientes = Math.max(0, total - contados);
    const enviar = async (comoCero) => {
      trabajando('Finalizando el conteo…');
      try {
        const r = await finalizarConteoInventario(id, comoCero);
        listo('Conteo finalizado', `${r?.total_diferencias ?? 0} con diferencia. Falta que lo aprueben.`);
        router.back();
      } catch (e) { fallo('No se pudo finalizar', mensajeAmigable(e)); }
    };
    if (!pendientes) {
      Alert.alert('¿Finalizar el conteo?', 'Ya no se va a poder contar. Después lo aprueba quien corresponde.', [
        { text: 'Seguir contando', style: 'cancel' }, { text: 'Finalizar', onPress: () => enviar(false) }]);
      return;
    }
    Alert.alert('Quedan renglones sin contar', `${pendientes} renglón${pendientes === 1 ? '' : 'es'} sin contar. ¿Qué se hace con ellos?`, [
      { text: 'Seguir contando', style: 'cancel' },
      { text: 'Dejarlos fuera del cálculo', onPress: () => enviar(false) },
      { text: 'Darlos por no ubicados (físico 0)', style: 'destructive', onPress: () => enviar(true) },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Contar',
        headerSearchBarOptions: {
          placeholder: 'Producto, laboratorio o código', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={gruposLab} extra={puedePapel && conteo ? { icono: 'printer', etiqueta: 'Papel del conteo', onPress: papel } : null} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 60 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {conteo ? (
            <View style={{ marginHorizontal: 16 }}>
              <Vidrio radio={22}>
                <View style={{ padding: 16, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{sala ?? 'Conteo'}</Text>
                    <Pildora texto={ESTADO_CONTEO[conteo.status] ?? conteo.status} color={editable ? MARCA.ambar : MARCA.azulClaro} />
                  </View>
                  <View style={{ height: 7, borderRadius: 4, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
                    <View style={{ width: `${total ? Math.round((contados / total) * 100) : 0}%`, height: 7, backgroundColor: MARCA.verde }} />
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${contados.toLocaleString('es-SV')} de ${total.toLocaleString('es-SV')} renglones contados`}</Text>
                </View>
              </Vidrio>
            </View>
          ) : null}
          {conteo ? <Resumen resumen={resumen} abierto={conteoEditable(conteo)} verMontos={hasPermission('conteo_inventario_ver_montos')} /> : null}
          {conteo && !editable && !puedeAprobar ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto="Este conteo ya no se puede contar." /></View> : null}
          {puedeAprobar ? (
            <View style={{ marginHorizontal: 16, gap: 10 }}>
              <Aviso tono="nota" texto="Finalizado: puedes recontar un renglón antes de aprobar. Quien lo contó no puede recontarlo." />
              <BotonGrande texto="Aprobar el conteo" color={MARCA.verde} onPress={aprobar} />
            </View>
          ) : null}
          {/* El conteo firma la diferencia; el stock se corrige afuera. Hasta que
              alguien registre que lo aplicó, tiene que estar a la vista. */}
          {conteo?.status === 'CERRADO' ? (
            <View style={{ marginHorizontal: 16, gap: 10 }}>
              {conteo.ajuste_erp_aplicado ? (
                <Aviso tono="nota" texto={`Ajuste aplicado el ${fechaTexto(conteo.ajuste_erp_at, { day: 'numeric', month: 'short', year: 'numeric' })} a las ${fmtHM(conteo.ajuste_erp_at)}.${conteo.ajuste_erp_nota ? ` — «${conteo.ajuste_erp_nota}»` : ''}`} />
              ) : faltaAjusteDelConteo(conteo) ? (
                <>
                  <Aviso tono="cuidado" texto={`Ajuste pendiente de aplicar: ${conteo.total_diferencias} línea(s). Aplícalo y regístralo aquí.`} />
                  {puedeEditar ? <BotonGrande texto="Registrar ajuste" borde color={MARCA.ambar} onPress={registrarAjuste} /> : null}
                </>
              ) : <Aviso tono="nota" texto="Sin diferencias: no hay ajuste que aplicar." />}
            </View>
          ) : null}
          {editable ? (
            <View style={{ marginHorizontal: 16 }}>
              <BotonGrande texto="Escanear un producto" color={MARCA.azul} onPress={() => setEscaneando(true)} />
              <View style={{ height: 10 }} />
              <BotonGrande texto="Agregar un renglón a mano" borde color={MARCA.azulClaro} onPress={() => setAgregando(true)} />
            </View>
          ) : null}
          <Segmentos activa={filtro} onCambiar={setFiltro} opciones={filtros.map((f) => ({ id: f.key, label: f.key === 'DIFERENCIA' ? 'Diferencia' : f.label }))} />
          <FiltrosActivos grupos={gruposLab} />
          {productos.aproximado && busqueda ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto="No hay coincidencia exacta: se muestran productos parecidos." /></View> : null}
          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${productos.total.toLocaleString('es-SV')} producto${productos.total === 1 ? '' : 's'}`}</Text>
          {productos.filas.map((p) => {
            const abiertoAqui = abierto === p.erp_product_id;
            const completo = p.contados_count >= p.item_count;
            return (
              <View key={p.erp_product_id} style={{ marginHorizontal: 16 }}>
                <Vidrio radio={20} interactivo>
                  <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(abiertoAqui ? null : p.erp_product_id); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
                    {p.foto_url ? <Image source={{ uri: p.foto_url }} style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: '#fff' }} resizeMode="contain" />
                      : <Chip icono="Package" color={MARCA.azulClaro} tamano={44} />}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{p.product_nombre}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{p.laboratorio_nombre}</Text>
                    </View>
                    <Pildora texto={`${p.contados_count}/${p.item_count}`} color={completo ? MARCA.verde : MARCA.ambar} />
                  </Pressable>
                  {abiertoAqui ? (
                    <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
                      {!items[p.erp_product_id] ? <ActivityIndicator style={{ marginVertical: 10 }} />
                        : items[p.erp_product_id].map((it) => <Renglon key={it.id} it={it} editable={editable} onGuardado={alGuardar(p.erp_product_id)} onHistorial={setHistorial}
                          onLote={editable && !simple ? (x) => setAccion({ item: x, modo: 'lote' }) : null}
                          onRecontar={puedeAprobar ? (x) => setAccion({ item: x, modo: 'recuento' }) : null} />)}
                    </View>
                  ) : null}
                </Vidrio>
              </View>
            );
          })}
          {cargando ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
          {!cargando && productos.total > productos.filas.length ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setPagina((n) => n + 1)} /></View> : null}
          {!cargando && !productos.filas.length ? (
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 30 }}>
              {busqueda ? 'Ningún producto del conteo con esa búsqueda' : filtro === 'PENDIENTES' ? 'No queda nada por contar' : 'Sin productos en este filtro'}
            </Text>
          ) : null}
          {editable ? (
            <View style={{ marginHorizontal: 16, marginTop: 8 }}>
              <BotonGrande texto="Finalizar el conteo" borde color={MARCA.verde} onPress={finalizar} />
            </View>
          ) : null}
          {puedeEliminar ? (
            <View style={{ marginHorizontal: 16, marginTop: 4 }}>
              <BotonGrande texto="Eliminar el conteo" borde color={MARCA.rojo} onPress={eliminar} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <Historial item={historial} simple={conteo?.modo === 'SIMPLE'} onCerrar={() => setHistorial(null)} />
      <AccionDeRenglon item={accion?.item ?? null} modo={accion?.modo} onCerrar={() => setAccion(null)} onHecho={alAccion} />
      <AgregarRenglon visible={agregando} conteoId={id} branchId={conteo?.branch_id} simple={simple} onCerrar={() => setAgregando(false)}
        onAgregado={(prod) => { setItems((m) => { const n = { ...m }; delete n[prod.id]; return n; }); setFiltro('TODOS'); setTexto(prod.nombre); setPagina(1); cargar(); cargarConteo(); }} />
      <Escaner visible={escaneando} titulo="Buscar en el conteo" ayuda="Apunta al código de barras del producto"
        onCodigo={(c) => { setEscaneando(false); setFiltro('TODOS'); setTexto(String(c)); }} onCerrar={() => setEscaneando(false)} />
    </>
  );
}
