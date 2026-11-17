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
//
// Como el portal: la bodega y el área de vencidos son DOS estantes (pestañas
// con lo que falta en cada uno); el encabezado dice contra qué se compara («En
// vivo» o «Según la hoja») y el alcance; el aviso de conteo ciego y el de
// conteo parcial; el orden por columna (el del estante por defecto); el «Modo
// recuento» del supervisor —a ciegas, sobre lo que tiene diferencia, en orden
// de estante—; y la hoja compacta entre los papeles.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, AppState, Dimensions, Image, Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Presionable as Pressable } from '../../componentes/Tocable';
import { useBotonFlotante } from '../../componentes/chat/acompanante';
import ElegirLaboratorio from '../../componentes/conteos/ElegirLaboratorio';
import Indicador from '../../componentes/Indicador';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FiltrosActivos, MenuDeFiltros } from '../../componentes/Filtros';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ALCANCE_CONTEO, cantidadValida, conteoEditable, ESTADO_CONTEO, FILTROS_CONTEO, faltaAjusteDelConteo, guardadoDelRenglon, noUbicado, unidadDeConteo, esLoteGenerico, rotuloDeAjuste, PROBLEMA_DE_AJUSTE, avanceSinLote, estadoDelProducto, totalesDelProducto, faltaDelRenglon, reglaDeLoteYVence, rotuloDeLoQuePide } from '@nucleo/utils/conteoDeInventario';
import { avisoDeConteoParcial } from '@nucleo/utils/conteoPapel';
import Interruptor from '../../componentes/Interruptor';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Cargando, Vacio } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { Chip } from '../../componentes/inicio/Widget';
import Escaner from '../../componentes/Escaner';
import Subfiltro from '../../componentes/Subfiltro';
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
import LoteReal from '../../componentes/conteos/LoteReal';
import AjusteDelInventario from '../../componentes/conteos/AjusteDelInventario';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fmtHM } from '@nucleo/utils/tableroDePedidos';

const POR_PAGINA = 20;
const vence = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'short', year: '2-digit' }) : 'sin fecha');

// La diferencia de un renglón, dicha junto al número (no en una píldora aparte).
const TONO = { ok: () => MARCA.verde, sobra: () => MARCA.ambar, falta: () => MARCA.rojo, pendiente: () => MARCA.ambar };

// Un renglón del conteo, hecho para teclear seguido (2026-11-16, Bodega: «debo
// dar muchísimos toques»): el campo está siempre a la vista, «Siguiente» en el
// teclado guarda y salta al próximo renglón sin contar —también al del producto
// de abajo— y lo contado queda cerrado con su diferencia al lado.
function Renglon({ it, producto, editable, aCiegas = false, ajusta = true, onGuardado, onHistorial, onLote, onLoteReal, onRecontar, registrar, onSiguiente, onEnfocar, onEnCurso }) {
  const guardarConteoItem = useStaffStore((s) => s.guardarConteoItem);
  const [valor, setValor] = useState(it.fisico_cantidad ?? '');
  const [abierto, setAbierto] = useState(it.estado_item === 'PENDIENTE');
  const [recienAbierto, setRecienAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [noSeGuardo, setNoSeGuardo] = useState(false);
  const ultimo = useRef(it.fisico_cantidad ?? '');
  const enviando = useRef(null);
  const campo = useRef(null);
  const contado = it.estado_item !== 'PENDIENTE';
  const puedeEscribir = editable && abierto;

  // El campo se anota en la cadena de «Siguiente» mientras se puede escribir.
  useEffect(() => {
    if (!puedeEscribir) return undefined;
    registrar?.(it.id, campo);
    return () => registrar?.(it.id, null);
  }, [puedeEscribir, it.id, registrar]);

  const guardar = (payload) => {
    // En Android «Siguiente» guarda y, al pasar el foco, `onEndEditing` volvía a
    // guardar lo mismo: dos llamadas y dos entradas en el historial.
    const firma = `${payload.fisicoCantidad ?? ''}|${payload.estadoItem}`;
    if (enviando.current === firma) return undefined;
    enviando.current = firma;
    setGuardando(true);
    const promesa = (async () => {
      try {
        const r = await guardarConteoItem(it.id, payload);
        ultimo.current = payload.fisicoCantidad ?? '';
        setNoSeGuardo(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setAbierto(payload.estadoItem === 'PENDIENTE');
        onGuardado(it.id, { ...payload, sistema: r?.sistema_cantidad, diferencia: r?.diferencia });
      } catch (e) {
        // Lo escrito se queda y la fila lo dice: con mala señal, devolver el
        // campo al valor anterior era perder la cantidad sin rastro.
        setNoSeGuardo(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        fallo('No se guardó el conteo', `${it.product_nombre || 'Este producto'}: ${mensajeAmigable(e)}`);
      } finally {
        enviando.current = null;
        setGuardando(false);
      }
    })();
    onEnCurso?.(promesa);
    return promesa;
  };
  const alTerminar = () => {
    if (String(valor) === String(ultimo.current)) { if (contado) setAbierto(false); return; }
    if (!cantidadValida(valor)) { fallo('Cantidad inválida', 'El conteo físico debe ser un número entero de 0 o más.'); setValor(ultimo.current); return; }
    guardar(guardadoDelRenglon(valor, it.nota));
  };
  // Recuento a ciegas: hasta recontar la línea no se ve ni el sistema ni el
  // primer conteo — si no, el supervisor copia el número en vez de contarlo.
  const tapado = aCiegas && !it.recontado_at;
  const verSist = it.ver_sistema && it.sistema_cantidad != null && !tapado;
  const dif = verSist && contado && it.fisico_cantidad != null ? Number(it.fisico_cantidad) - it.sistema_cantidad : null;
  const estadoDif = dif == null ? null : dif === 0 ? { texto: 'Cuadra', tono: 'ok' } : { texto: `${dif > 0 ? '+' : ''}${dif}`, tono: dif > 0 ? 'sobra' : 'falta' };
  const lote = esLoteGenerico(it.lote) ? 'Sin lote' : `Lote ${it.lote}`;
  // Lo que el producto pide y este renglón todavía no tiene (regulado sin
  // lote, perecedero sin vencimiento).
  const falta = faltaDelRenglon(it, producto);
  // «Corregir lote» de un producto que no pide lote corrige sólo el vence; y
  // si no pide ninguno de los dos, no hay nada que corregir.
  const regla = producto?.regulado == null && producto?.perecedero == null ? null : reglaDeLoteYVence(producto);
  const textoCorregir = !regla || regla.pideLote ? 'Corregir lote' : regla.pideVence ? 'Corregir vence' : null;
  const detalle = [it.fecha_vencimiento ? `vence ${vence(it.fecha_vencimiento)}` : 'sin vencimiento', unidadDeConteo(it).texto.toLowerCase(), it.is_vencidos ? 'área de vencidos' : null].filter(Boolean).join(' · ');

  const enlace = (texto, color, onPress) => (
    <Pressable key={texto} onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} hitSlop={8}
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
      <Text style={{ color, fontSize: 14, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: 4, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>
            {lote}
            {falta ? <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '800' }}>{`  ·  ${falta}`}</Text> : null}
          </Text>
          {/* En qué se cuenta, entero («cajas de 100»): con la presentación a
              secas, una caja de 100 pastillas se anotaba como 100 cajas. */}
          <Text style={{ color: it.is_vencidos ? MARCA.rojo : colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{detalle}</Text>
          {verSist ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Sistema: ${it.sistema_cantidad}`}</Text> : null}
        </View>
        {puedeEscribir ? (
          <View style={{ width: 96 }}>
            <Campo ref={campo} multiline={false} value={String(valor)} keyboardType="number-pad" placeholder="Cant." selectTextOnFocus
              autoFocus={recienAbierto}
              style={{ textAlign: 'center', fontSize: 22, fontWeight: '800', minHeight: 50 }}
              onFocus={() => onEnfocar?.(campo)}
              onChangeText={(v) => setValor(v.replace(/[^\d]/g, ''))} onEndEditing={alTerminar} onSubmitEditing={alTerminar}
              onSiguiente={() => onSiguiente?.(it.id)} editable={!guardando} />
          </View>
        ) : (
          <Pressable disabled={!editable} onPress={() => { Haptics.selectionAsync().catch(() => {}); setRecienAbierto(true); setAbierto(true); }}
            hitSlop={8} style={({ pressed }) => ({ alignItems: 'flex-end', minHeight: 50, minWidth: 96, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              {estadoDif ? <Text style={{ color: TONO[estadoDif.tono](), fontSize: 14, fontWeight: '800' }}>{estadoDif.texto}</Text> : null}
              <Text style={{ color: it.estado_item === 'SIN_UBICAR' ? MARCA.ambar : colorSistema.texto, fontSize: 22, fontWeight: '800' }}>
                {tapado ? '•••' : it.estado_item === 'SIN_UBICAR' ? 'No ubicado' : String(it.fisico_cantidad ?? '—')}
              </Text>
            </View>
            {editable ? <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Editar</Text> : null}
          </Pressable>
        )}
      </View>
      {guardando ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Guardando…</Text>
        : noSeGuardo ? enlace('No se guardó. Toca para reintentar', MARCA.rojo, alTerminar) : null}
      {/* Una sola línea de enlaces: quién contó (con su historial), no lo
          encuentro, y las acciones del lote. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 16 }}>
        {contado ? enlace(`${it.contado_por_nombre ? shortEmployeeName(it.contado_por_nombre) : 'Contado'}${it.contado_at ? ` · ${fmtHM(it.contado_at)}` : ''}`, colorSistema.texto2, () => onHistorial(it)) : null}
        {puedeEscribir && it.ver_sistema && it.sistema_cantidad > 0 ? enlace('No lo encuentro', MARCA.ambar, () => guardar(noUbicado(it.nota))) : null}
        {onLoteReal ? enlace(esLoteGenerico(it.lote) ? 'Anotar lote' : ajusta ? 'Lote y vence' : '+ Lote', MARCA.azulClaro, () => onLoteReal(it)) : null}
        {onLote && textoCorregir ? enlace(textoCorregir, falta ? MARCA.ambar : MARCA.azulClaro, () => onLote(it)) : null}
        {onRecontar ? enlace(it.recontado_at ? 'Recontar otra vez' : 'Recontar', MARCA.ambar, () => onRecontar(it)) : null}
      </View>
      {it.recontado_at ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Recontado${it.fisico_primer_conteo != null ? ` · primer conteo ${it.fisico_primer_conteo}` : ''}`}</Text> : null}
    </View>
  );
}

const contadosVivos = (r) => Number(r?.contados ?? 0);

// Escanear va pegado a la burbuja del chat (`useBotonFlotante`): mismo tamaño,
// y al moverla se mueven los dos (2026-11-17, lo pidió el usuario).

// Un botón compacto del tamaño de su texto (2026-11-17, el usuario: «me salen 5
// botones que ocupan todo el ancho»). Lleno = la acción principal; con borde,
// las demás. 44 de alto: sigue siendo un blanco de dedo.
function Pastilla({ texto, color, lleno = false, onPress }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 18, borderRadius: 22, justifyContent: 'center', alignItems: 'center',
        backgroundColor: lleno ? color : 'transparent', borderWidth: lleno ? 0 : 1.5, borderColor: color,
        transform: [{ scale: pressed ? 0.97 : 1 }], opacity: pressed ? 0.85 : 1 })}>
      <Text style={{ color: lleno ? '#fff' : color, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

// Lo último que se vio de cada conteo, mientras la app está abierta: al
// volver a entrar se pinta al instante y se actualiza por detrás.
const RECUERDO = new Map();

export default function Conteo() {
  const { id } = useLocalSearchParams();
  const { hasPermission, user } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const fetchConteoDetalle = useStaffStore((s) => s.fetchConteoDetalle);
  const fetchConteoPagina = useStaffStore((s) => s.fetchConteoPagina);
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
  // El código escaneado no se escribe en el buscador nativo: se muestra aparte,
  // con su forma de quitarlo (antes la lista quedaba filtrada sin decir por qué).
  const [porCodigo, setPorCodigo] = useState(null);
  const [verComo, setVerComo] = useState(false);
  // Volver a la lista de antes del escaneo: sin código y en «Pendientes».
  const quitarCodigo = () => { setPorCodigo(null); setTexto(''); setFiltro('PENDIENTES'); };
  const busqueda = useTextoRebotado(texto, 350).trim();
  const [filtro, setFiltro] = useState('PENDIENTES');
  const [pagina, setPagina] = useState(1);
  const [productos, setProductos] = useState({ filas: [], total: 0, aproximado: false });
  const [items, setItems] = useState({});
  const [loteReal, setLoteReal] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [escaneando, setEscaneando] = useState(false);
  const [historial, setHistorial] = useState(null);
  const [area, setArea] = useState('NORMAL');
  const [orden, setOrden] = useState('');
  const [recuento, setRecuento] = useState(false);
  const pedido = useRef(0);
  // La lista se pide SIEMPRE por estante, sin esperar al resumen: en un conteo
  // sin área de vencidos, «inventario» es todo. Esperar a saberlo (v2.1554.10,
  // por KISS en Bodega, que sólo está en vencidos) sumaba un viaje entero antes
  // de ver un producto: 1 a 3 s al abrir.

  // Si el conteo no se pudo leer, se dice y se ofrece reintentar: antes la
  // pantalla quedaba sin campos y sin explicación.
  const [errorConteo, setErrorConteo] = useState(null);
  const cargarConteo = useCallback(async () => {
    const [c, r] = await Promise.all([
      Promise.resolve(fetchConteoDetalle(id)).then((x) => ({ x }), (e) => ({ e })),
      Promise.resolve(fetchConteoResumen(id)).catch(() => undefined),
    ]);
    if (c.e) setErrorConteo(c.e);
    else { setErrorConteo(null); setConteo(c.x ?? null); }
    if (r !== undefined) setResumen(r);
  }, [id, fetchConteoDetalle, fetchConteoResumen]);
  useEffect(() => { cargarConteo(); }, [cargarConteo]);
  // Mientras se cuenta sólo cambia el resumen: se relee con espera, una vez por
  // ráfaga. Antes cada cantidad guardada pedía el detalle y el resumen.
  const relojCabecera = useRef(null);
  useEffect(() => () => clearTimeout(relojCabecera.current), []);
  const refrescarCabecera = useCallback(() => {
    clearTimeout(relojCabecera.current);
    relojCabecera.current = setTimeout(() => {
      Promise.resolve(fetchConteoResumen(id)).then((r) => { if (r) setResumen(r); }).catch(() => {});
    }, 1500);
  }, [id, fetchConteoResumen]);
  // Los guardados en vuelo: finalizar y escanear esperan a que terminen.
  const enCurso = useRef(new Set());
  const anotarEnCurso = useCallback((p) => {
    enCurso.current.add(p);
    p.finally(() => enCurso.current.delete(p));
  }, []);
  const esperarGuardados = async () => {
    // Tocar un botón no le quita el foco al campo (`keyboardShouldPersistTaps`):
    // sin esto, lo último escrito no se guardaba antes de finalizar.
    Keyboard.dismiss();
    await new Promise((r) => { setTimeout(r, 150); });
    await Promise.allSettled([...enCurso.current]);
  };

  // Regulados con existencia «sin lote»: cuántos ya contó este conteo y cuántos
  // le quedan a la sucursal (2026-11-06). Contexto: si no se lee, no se muestra.
  const fetchReguladosSinLote = useStaffStore((s) => s.fetchReguladosSinLote);
  const [sinLote, setSinLote] = useState(null);
  useEffect(() => {
    if (!conteo?.aplica_en_caja) return undefined;
    let vivo = true;
    fetchReguladosSinLote({ branchId: conteo.branch_id, conteoId: id })
      .then((d) => { if (vivo) setSinLote(d); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [conteo?.aplica_en_caja, conteo?.branch_id, conteo?.total_contados, conteo?.status, id, fetchReguladosSinLote]);
  const avanceSuc = sinLote ? avanceSinLote(sinLote.sucursales, conteo?.branch_id) : null;
  const textoSinLote = sinLote ? [
    sinLote.conteo?.sin_lote ? `En este conteo: ${sinLote.conteo.contados} de ${sinLote.conteo.sin_lote} regulados con existencia sin lote ya contados.` : null,
    avanceSuc?.regulados ? `En ${avanceSuc.sucursal ?? 'la sucursal'} quedan ${avanceSuc.sinLote} de ${avanceSuc.regulados} regulados con existencia sin lote. El ${avanceSuc.limpios}% ya tiene toda su existencia en lotes. Se reduce al aprobar cada conteo.` : null,
  ].filter(Boolean).join('\n') : '';
  useEffect(() => { setPagina(1); }, [busqueda, filtro, laboratorioId, area, orden]);
  // Cambiar de estante descarta lo abierto: un producto puede estar en los dos
  // con renglones distintos.
  useEffect(() => { setItems({}); }, [area]);
  // Los laboratorios del conteo no cambian mientras se cuenta: una vez.
  useEffect(() => {
    let vivo = true;
    Promise.resolve(fetchConteoLaboratorios(id)).then((r) => { if (vivo) setLabs(r ?? []); }).catch(() => {});
    return () => { vivo = false; };
  }, [id, fetchConteoLaboratorios]);

  // La página llega en UN viaje con su total y sus lotes (`get_conteo_pagina`).
  // Lo último que se vio de cada conteo queda en memoria (`RECUERDO`) y se pinta
  // al instante al volver a entrar, mientras llega lo actualizado; y la página
  // siguiente se trae por detrás, para que «Ver más» no espere.
  const clave = [id, area, filtro, busqueda, laboratorioId, orden].join('|');
  const siguiente = useRef(null);   // { clave, pagina, promesa }
  const claveMostrada = useRef(null); // de qué filtro es lo que está en pantalla
  const pedirPagina = useCallback((n) => {
    const [orderBy, orderDir] = orden ? orden.split(':') : [null, 'asc'];
    return fetchConteoPagina(id, { page: n, pageSize: POR_PAGINA, search: busqueda, filtro,
      laboratorioId: laboratorioId === 'todos' ? null : Number(laboratorioId), area, orderBy, orderDir });
  }, [id, busqueda, filtro, laboratorioId, area, orden, fetchConteoPagina]);
  const cargar = useCallback(async () => {
    const yo = ++pedido.current;
    if (pagina === 1 && RECUERDO.has(clave)) {
      const r = RECUERDO.get(clave);
      setProductos(r.productos); setItems(r.items); claveMostrada.current = clave;
    }
    setCargando(true);
    try {
      const listo = siguiente.current?.clave === clave && siguiente.current?.pagina === pagina ? siguiente.current.promesa : null;
      siguiente.current = null;
      const r = await (listo || pedirPagina(pagina)).catch((e) => { if (listo) return pedirPagina(pagina); throw e; });
      if (yo !== pedido.current) return;
      // Al juntar páginas, sin repetidos: con «Pendientes», lo que se contó sale
      // de la lista y el tramo siguiente se corre.
      setProductos((p) => {
        const ya = new Set(pagina === 1 ? [] : p.filas.map((f) => f.erp_product_id));
        return { filas: pagina === 1 ? r.rows : [...p.filas, ...r.rows.filter((f) => !ya.has(f.erp_product_id))], total: r.total, aproximado: r.aproximado };
      });
      claveMostrada.current = clave;
      setItems((m) => (pagina === 1 ? r.lotes : { ...m, ...r.lotes }));
      if (r.total > pagina * POR_PAGINA) {
        const promesa = pedirPagina(pagina + 1);
        promesa.catch(() => {});
        siguiente.current = { clave, pagina: pagina + 1, promesa };
      }
    } catch (e) {
      if (yo === pedido.current) fallo('No se pudo cargar el conteo', mensajeAmigable(e));
    } finally {
      if (yo === pedido.current) setCargando(false);
    }
  }, [pagina, clave, pedirPagina]);
  // Lo que se ve, recordado para la próxima vez que se entre a este conteo.
  useEffect(() => {
    if (!productos.filas.length || claveMostrada.current !== clave) return;
    // Sólo la primera página: es la que se pinta al volver a entrar.
    const filas = productos.filas.slice(0, POR_PAGINA);
    RECUERDO.set(clave, { productos: { ...productos, filas }, items: Object.fromEntries(filas.map((f) => [f.erp_product_id, items[f.erp_product_id] || []])) });
  }, [clave, productos, items]);
  useEffect(() => { cargar(); }, [cargar]);


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
  // Releer UN producto (sus renglones, su píldora y la cabecera) sin tocar la
  // lista: agregar un lote recargaba la página y se perdía el lugar (Bodega,
  // 2026-11-16).
  const refrescarProducto = useCallback(async (erp) => {
    cargarConteo();
    try {
      const filas = await fetchConteoItemsForProducts(id, [erp], { area });
      setItems((m) => ({ ...m, [erp]: filas }));
      const tot = totalesDelProducto(filas);
      setProductos((p) => ({ ...p, filas: p.filas.map((f) => (f.erp_product_id === erp ? { ...f, ...tot } : f)) }));
    } catch {
      setItems((m) => { const n = { ...m }; delete n[erp]; return n; });
    }
  }, [id, area, cargarConteo, fetchConteoItemsForProducts]);

  // En la página 2 o más, `cargar` AGREGA la página al final: releerla repetía
  // productos. Ahí sólo se relee la cabecera.
  useEffect(() => { cargarRef.current = () => {
    cargarConteo();
    if (pagina === 1) cargar();
  }; });
  const abiertoParaContar = conteoEditable(conteo);
  useEffect(() => {
    if (!abiertoParaContar) return undefined;
    let vivo = true;
    const traer = () => Promise.resolve(sincronizarConteoEnVivo(id)).then((r) => {
      if (!vivo || !r?.agregados) return;
      const n = r.agregados;
      listo('Llegaron productos nuevos', `Se ${n === 1 ? 'agregó 1 producto que entró' : `agregaron ${n} productos que entraron`} a la sucursal después de empezar el conteo. Ya se pueden contar.`);
      cargarRef.current?.();
    }).catch(() => {});
    traer();
    const sub = AppState.addEventListener('change', (e) => { if (e === 'active') traer(); });
    return () => { vivo = false; sub.remove(); };
  }, [id, abiertoParaContar, sincronizarConteoEnVivo]);

  // Eliminar: con el permiso propio, o mientras no se haya contado nada. Sin
  // resumen no se sabe si se contó: no se ofrece.
  const puedeEliminar = puedeEditar && (hasPermission('conteo_inventario_eliminar') || (conteoEditable(conteo) && resumen != null && contadosVivos(resumen) === 0));
  const eliminar = () => Alert.alert('Eliminar el conteo', `Se borra el conteo de ${sala ?? 'la sucursal'} con todos sus productos. No se puede deshacer.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Eliminar', style: 'destructive', onPress: async () => {
      trabajando('Eliminando…');
      try {
        const r = await eliminarConteoInventario(id);
        listo('Conteo eliminado', r?.total_items ? `Se borró con sus ${r.total_items} ${r.total_items === 1 ? 'producto' : 'productos'}.` : 'Se borró el conteo.');
        router.back();
      } catch (e) { fallo('No se pudo eliminar', mensajeAmigable(e)); }
    } },
  ]);
  // El papel del conteo: hoja para contar (ciega si el dato no viene), resultados,
  // ajuste en PDF o CSV — el contenido del núcleo (`conteoPapel`), el del portal.
  const puedePapel = hasPermission('conteo_inventario_descargar');
  const papel = () => {
    const op = [['Hoja para contar', 'hoja'], ['Hoja compacta (la mitad de páginas)', 'compacta'], ['Resultados', 'resultados'], ['Ajuste (PDF)', 'ajuste'], ['Ajuste (CSV)', 'csv']];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Papel del conteo', options: [...op.map((o) => o[0]), 'Cancelar'], cancelButtonIndex: op.length }, async (i) => {
      const tipo = op[i]?.[1];
      if (!tipo) return;
      trabajando('Preparando el archivo…');
      try {
        const todos = await fetchTodosLosItemsConteo(id);
        const c = { ...conteo, branches: { name: sala } };
        if (tipo === 'csv') {
          const { headers, rows, nombre } = csvDeAjustesConteo(c, todos);
          cerrarProgreso();
          await compartirCsv({ headers, rows, nombre, modulo: 'conteo_inventario', detalle: { conteo_id: id } });
          return;
        }
        const html = tipo === 'hoja' || tipo === 'compacta' ? hojaDeConteoHtml(c, todos, { ciego: !todos[0]?.ver_sistema, compacta: tipo === 'compacta' })
          : tipo === 'resultados' ? resultadosDeConteoHtml(c, todos) : ajusteDeConteoHtml(c, todos);
        cerrarProgreso();
        if (await compartirPdf({ html, nombre: `${op[i][0]} ${sala ?? ''}` })) registrarEgreso('conteo_inventario', { formato: 'pdf', filas: todos.length, detalle: { conteo_id: id, tipo, via: 'app' } });
      } catch (e) { fallo('No se pudo armar el archivo', mensajeAmigable(e)); }
    });
  };

  // Lo que no se usa al contar va en «…» arriba: antes eran botones a todo lo
  // ancho al final de la lista (Finalizar, Eliminar) y junto al escáner (Agregar).
  const masAcciones = () => {
    const ops = [
      ...(editable ? [['Agregar producto', () => setAgregando(true)]] : []),
      ...(puedePapel && conteo ? [['Papel del conteo', papel]] : []),
      ...(puedeEliminar ? [['Eliminar el conteo', eliminar]] : []),
    ];
    if (!ops.length) return;
    const destructivo = puedeEliminar ? ops.length - 1 : undefined;
    ActionSheetIOS.showActionSheetWithOptions({ options: [...ops.map((o) => o[0]), 'Cancelar'], cancelButtonIndex: ops.length, destructiveButtonIndex: destructivo },
      (i) => { ops[i]?.[1](); });
  };
  const hayMas = editable || (puedePapel && conteo) || puedeEliminar;

  // El laboratorio ya no va en el menú de la barra: son cientos y no se podía
  // buscar. Se elige en su hoja con buscador (`ElegirLaboratorio`).
  const opcionesLab = labs.map((l) => ({ id: String(l.laboratorio_id ?? l.id), label: l.laboratorio_nombre ?? l.nombre ?? '—' }));
  const labElegido = laboratorioId === 'todos' ? null : opcionesLab.find((o) => o.id === String(laboratorioId));
  const [eligiendoLab, setEligiendoLab] = useState(false);
  const gruposLab = [];
  useBotonFlotante(editable && !escaneando ? { icono: 'ScanLine', etiqueta: 'Escanear código', onPress: () => { esperarGuardados(); setEscaneando(true); } } : null);
  const gruposOrden = [{ id: 'orden', titulo: 'Ordenar', activa: orden, porDefecto: '', onCambiar: setOrden, opciones: [
    { id: '', label: 'Orden del estante' },
    ...[['producto', 'Producto'], ...(verSistema ? [['sistema', 'Sistema']] : []), ['fisico', 'Físico'], ...(verSistema ? [['diferencia', 'Diferencia']] : []), ['progreso', 'Estado']]
      .flatMap(([k, l]) => [{ id: `${k}:asc`, label: `${l} ↑` }, { id: `${k}:desc`, label: `${l} ↓` }]),
  ] }];
  const grupos = [...gruposLab, ...(recuento ? [] : gruposOrden)];
  const hayVencidos = (resumen?.productos_vencidos ?? 0) > 0;
  const avisoParcial = conteo && ['FINALIZADO', 'CERRADO'].includes(conteo.status) ? avisoDeConteoParcial(conteo) : null;
  // Mientras el conteo está abierto, los totales de la fila vienen vacíos: manda el resumen en vivo.
  const total = Number(resumen?.total_items ?? conteo?.total_items) || 0;
  const contados = Number(resumen?.contados ?? conteo?.total_contados) || 0;

  // Sobre lo ÚLTIMO de la lista, no sobre lo que había al pintar: dos lotes
  // guardados seguidos con «Siguiente» se pisaban y el primero volvía a
  // pendiente.
  const porRecalcular = useRef(new Set());
  const alGuardar = (erp) => (itemId, cambio) => {
    porRecalcular.current.add(erp);
    setItems((m) => ({ ...m, [erp]: (m[erp] || []).map((it) => (it.id === itemId
      ? { ...it, fisico_cantidad: cambio.fisicoCantidad, estado_item: cambio.estadoItem, sistema_cantidad: cambio.sistema ?? it.sistema_cantidad,
        diferencia: cambio.diferencia !== undefined ? cambio.diferencia : it.diferencia }
      : it)) }));
    refrescarCabecera();
  };
  // La píldora del producto (faltan / cuadra / diferencia), sin recargar.
  useEffect(() => {
    if (!porRecalcular.current.size) return;
    const erps = [...porRecalcular.current];
    porRecalcular.current.clear();
    setProductos((p) => ({ ...p, filas: p.filas.map((f) => (erps.includes(f.erp_product_id) && items[f.erp_product_id]
      ? { ...f, ...totalesDelProducto(items[f.erp_product_id]) } : f)) }));
  }, [items]);

  // ── «Siguiente»: la cadena de campos en el orden de la pantalla ─────────
  // Cada renglón que se puede escribir anota su campo; «Siguiente» enfoca el
  // próximo de la lista (también el del producto de abajo). Al perder el foco,
  // el renglón anterior se guarda solo (`onEndEditing`).
  const campos = useRef(new Map());
  const registrar = useCallback((itemId, ref) => {
    if (ref) campos.current.set(itemId, ref); else campos.current.delete(itemId);
  }, []);
  const ordenDeCampos = productos.filas.flatMap((p) => (items[p.erp_product_id] || []).map((it) => it.id));
  const ordenRef = useRef(ordenDeCampos);
  ordenRef.current = ordenDeCampos;
  const productosRef = useRef(productos);
  productosRef.current = productos;
  const enfocarDesde = useCallback((itemId) => {
    const orden = ordenRef.current;
    const desde = itemId ? orden.indexOf(itemId) : -1;
    for (let i = desde + 1; i < orden.length; i += 1) {
      const ref = campos.current.get(orden[i]);
      if (ref?.current) { ref.current.focus(); return true; }
    }
    return false;
  }, []);
  // Qué enfocar cuando llegue la lista: el primer pendiente tras escanear, o el
  // primero de la página siguiente al terminar ésta.
  const focoPendiente = useRef(null);
  const siguienteCampo = useCallback((itemId) => {
    if (enfocarDesde(itemId)) return;
    const p = productosRef.current;
    if (p.total > p.filas.length) {
      focoPendiente.current = { despuesDe: itemId };
      setPagina((n) => n + 1);
      return;
    }
    Keyboard.dismiss();
  }, [enfocarDesde]);

  // El campo enfocado se sube a la vista: con el teclado abierto, el renglón
  // de abajo quedaba tapado y había que desplazar a mano.
  const scroll = useRef(null);
  const scrollY = useRef(0);
  const altoTeclado = useRef(340);
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', (e) => { altoTeclado.current = e?.endCoordinates?.height || altoTeclado.current; });
    return () => sub.remove();
  }, []);
  const enfocar = useCallback((ref) => {
    setTimeout(() => {
      ref?.current?.measureInWindow?.((x, y, w, h) => {
        const alto = Dimensions.get('window').height;
        const libre = alto - altoTeclado.current - 56;
        if (y > 140 && y + h < libre) return;
        scroll.current?.scrollTo({ y: Math.max(0, scrollY.current + y - Math.round(alto * 0.28)), animated: true });
      });
    }, 80);
  }, []);

  useEffect(() => {
    const f = focoPendiente.current;
    if (!f || cargando || claveMostrada.current !== clave) return undefined;
    if (f.busqueda != null && f.busqueda !== busqueda) return undefined;
    const t = setTimeout(() => {
      focoPendiente.current = null;
      // Tras escanear, sólo si el código dio con un producto: con varios, el
      // que cuenta elige.
      if (f.busqueda != null && productos.filas.length !== 1) return;
      enfocarDesde(f.despuesDe ?? null);
    }, 200);
    return () => clearTimeout(t);
  }, [productos, items, cargando, clave, busqueda, enfocarDesde]);

  // Lo que devolvió el servidor al corregir el lote o recontar, sin recargar la página.
  const alAccion = (itemId, cambio) => {
    setItems((m) => Object.fromEntries(Object.entries(m).map(([erp, filas]) => [erp, filas.map((it) => (it.id === itemId ? { ...it, ...cambio } : it))])));
    cargarConteo();
  };

  const fetchConteoCajaPlan = useStaffStore((s) => s.fetchConteoCajaPlan);

  // El que ajusta el inventario se aprueba leyendo lo que va a mover (2026-11-06).
  const aprobar = async () => {
    let mensaje = 'Queda cerrado y firmado. No puedes aprobar un conteo que finalizaste tú.';
    if (conteo?.aplica_en_caja) {
      try {
        const plan = await fetchConteoCajaPlan(id);
        const productos = plan?.productos ?? [];
        const avisos = (plan?.problemas ?? []).filter((p) => !p.bloquea);
        const lineas = productos.slice(0, 12).map((p) => `${p.producto ?? p.erp_product_id}${p.a_medio_contar ? ' (no se ajusta, faltan lotes por contar)' : ''}\n${(p.lineas ?? []).map((l) => `  ${rotuloDeAjuste(l)}`).join('\n')}`);
        mensaje = productos.length
          ? `Se ajustan ${productos.length} ${productos.length === 1 ? 'producto' : 'productos'}:\n\n${lineas.join('\n')}${productos.length > 12 ? `\n…y ${productos.length - 12} más` : ''}`
          : 'No hay diferencias. Al aprobarlo, el inventario no cambia.';
        if (avisos.length) mensaje += `\n\nRevisa antes:\n${avisos.map((a) => `• ${a.producto ?? a.erp_product_id}: ${PROBLEMA_DE_AJUSTE[a.tipo] ?? a.tipo}`).join('\n')}`;
      } catch (e) { fallo('No se pudo leer el ajuste', mensajeAmigable(e)); return; }
    }
    Alert.prompt(conteo?.aplica_en_caja ? 'Aprobar y ajustar' : 'Aprobar conteo', mensaje, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Aprobar', onPress: async (nota) => {
          trabajando('Aprobando el conteo…');
          try {
            await aprobarConteoInventario(id, (nota || '').trim() || null);
            listo('Conteo aprobado', 'Queda cerrado y firmado.');
            cargarConteo();
          } catch (e) { fallo('No se pudo aprobar', mensajeAmigable(e)); }
        },
      },
    ], 'plain-text', '', 'default');
  };

  const registrarAjuste = () => {
    Alert.prompt('Registrar ajuste aplicado', 'Esto no cambia la existencia. Solo anota que el ajuste ya se aplicó, para que el conteo no quede pendiente. Escribe la referencia si la tienes.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Ya lo apliqué', onPress: async (nota) => {
          trabajando('Registrando el ajuste…');
          try {
            await marcarAjusteErp(id, (nota || '').trim() || null);
            listo('Ajuste registrado', 'Queda anotado que el ajuste ya se aplicó.');
            cargarConteo();
          } catch (e) { fallo('No se pudo registrar', mensajeAmigable(e)); }
        },
      },
    ], 'plain-text', '', 'default');
  };

  const finalizar = async () => {
    await esperarGuardados();
    // Lo que impide ajustar, antes de cerrar: se resuelve frente al estante.
    if (conteo?.aplica_en_caja) {
      try {
        const plan = await fetchConteoCajaPlan(id);
        const frenan = (plan?.problemas ?? []).filter((p) => p.bloquea);
        if (frenan.length) {
          Alert.alert('Antes de finalizar', frenan.slice(0, 10).map((p) => `• ${p.producto ?? p.erp_product_id}. ${PROBLEMA_DE_AJUSTE[p.tipo] ?? p.tipo}: ${p.detalle}`).join('\n\n'));
          return;
        }
      } catch (e) { fallo('No se pudo revisar el conteo', mensajeAmigable(e)); return; }
    }
    // Las cifras de este momento, no las de la pantalla: el último guardado
    // todavía no estaba en el resumen.
    const fresco = await Promise.resolve(fetchConteoResumen(id)).catch(() => null);
    if (fresco) setResumen(fresco);
    const pendientes = Math.max(0, Number(fresco?.pendientes ?? (total - contados)) || 0);
    const enviar = async (comoCero) => {
      trabajando('Finalizando el conteo…');
      try {
        const r = await finalizarConteoInventario(id, comoCero);
        const n = Number(r?.total_diferencias ?? 0);
        listo('Conteo finalizado', `${n ? `Con diferencia: ${n}. ` : 'Todo cuadra. '}Falta que otra persona lo apruebe.`);
        router.back();
      } catch (e) { fallo('No se pudo finalizar', mensajeAmigable(e)); }
    };
    if (!pendientes) {
      Alert.alert('¿Finalizar el conteo?', 'Después ya no se puede contar. Otra persona tiene que aprobarlo.', [
        { text: 'Seguir contando', style: 'cancel' }, { text: 'Finalizar', onPress: () => enviar(false) }]);
      return;
    }
    // Las mismas dos opciones que la web, explicadas: es una decisión contable.
    Alert.alert(`Quedan ${pendientes.toLocaleString('es-SV')} sin contar`,
      'Después ya no se puede contar.\n\nFuera del cálculo: no cuentan como diferencia. El reporte dice que el conteo fue parcial.\n\nNo ubicados: quedan en 0 y cuentan como faltante.', [
        { text: 'Seguir contando', style: 'cancel' },
        { text: 'Dejarlos fuera del cálculo', onPress: () => enviar(false) },
        { text: 'Darlos por no ubicados (en 0)', style: 'destructive', onPress: () => enviar(true) },
      ]);
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Contar',
        headerSearchBarOptions: {
          placeholder: 'Producto, laboratorio o código', hideWhenScrolling: false,
          onChangeText: (e) => { setPorCodigo(null); setTexto(e.nativeEvent.text); }, onCancelButtonPress: () => { setPorCodigo(null); setTexto(''); },
        },
      }} />
      <MenuDeFiltros grupos={grupos} extra={hayMas ? { icono: 'ellipsis.circle', etiqueta: 'Más acciones', onPress: masAcciones } : null} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView ref={scroll} onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={32}
          style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 170 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {!conteo && errorConteo ? (
            <Vacio titulo="No se pudo abrir el conteo" detalle={mensajeAmigable(errorConteo)} accion={{ texto: 'Reintentar', onPress: cargarConteo }} />
          ) : null}
          {conteo ? (
            <View style={{ marginHorizontal: 16 }}>
              <Vidrio radio={20}>
                <View style={{ padding: 16, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{sala ?? 'Conteo'}</Text>
                    <Pildora texto={ESTADO_CONTEO[conteo.status] ?? conteo.status} color={editable ? MARCA.ambar : MARCA.azulClaro} />
                  </View>
                  <View style={{ height: 7, borderRadius: 4, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
                    <View style={{ width: `${total ? Math.round((contados / total) * 100) : 0}%`, height: 7, backgroundColor: MARCA.verde }} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{`${contados.toLocaleString('es-SV')} de ${total.toLocaleString('es-SV')} contados`}</Text>
                    {/* Finalizar vive con el avance, que es lo que dice si ya toca. */}
                    {editable ? <Pastilla texto="Finalizar" color={MARCA.verde} lleno={total > 0 && contados >= total} onPress={finalizar} /> : null}
                  </View>
                  {/* Contra qué se compara lo que se teclea: decide si una venta
                      hecha mientras se cuenta sale como diferencia. */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Pildora texto={conteo.fuente_sistema === 'VIVO' ? 'En vivo' : 'Según la hoja'} color={conteo.fuente_sistema === 'VIVO' ? MARCA.ambar : colorSistema.texto2} />
                    {conteo.aplica_en_caja ? <Pildora texto="Ajusta el inventario" color={MARCA.azulClaro} /> : null}
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                      {`Iniciado ${fechaTexto(conteo.created_at, { day: 'numeric', month: 'short', year: 'numeric' })} · Alcance: ${ALCANCE_CONTEO[conteo.scope_type] ?? conteo.scope_type ?? '—'}`}
                    </Text>
                  </View>
                </View>
              </Vidrio>
            </View>
          ) : null}
          {conteo ? <Resumen resumen={resumen} abierto={conteoEditable(conteo)} verMontos={hasPermission('conteo_inventario_ver_montos')} /> : null}
          {conteo && !verSistema ? (
            <View style={{ marginHorizontal: 16 }}>
              <Aviso tono="nota" texto="Conteo ciego. Anota lo que ves en el estante. No verás la existencia del sistema ni la diferencia hasta que se finalice el conteo." />
            </View>
          ) : null}
          {avisoParcial ? <View style={{ marginHorizontal: 16 }}><Aviso tono={conteo.pendientes_como_cero ? 'cuidado' : 'freno'} texto={avisoParcial} /></View> : null}
          {conteo && !editable && !puedeAprobar ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto={conteoEditable(conteo) ? 'Tu cargo no puede contar en este conteo.' : 'Este conteo ya no se puede contar.'} /></View> : null}
          {puedeAprobar ? (
            <View style={{ marginHorizontal: 16, gap: 10 }}>
              <Aviso tono="nota" texto="Ya está finalizado. Puedes recontar un producto antes de aprobar. Quien lo contó no puede recontarlo." />
              {/* Quien finalizó no puede aprobar: la base lo rechaza. */}
              {String(conteo.finalizado_por ?? '') === String(user?.id ?? '-')
                ? <Aviso tono="nota" texto="Lo finalizaste tú. Lo aprueba otra persona." />
                : <BotonGrande texto="Aprobar el conteo" color={MARCA.verde} onPress={aprobar} />}
              {/* El recuento del supervisor: queda en «Con diferencia» —es lo que
                  se recuenta— pero como filtro, no candado: verificar unas que
                  cuadraron es lo que detecta al que copió el número. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>Modo recuento</Text>
                <Interruptor value={recuento} onValueChange={(v) => { setRecuento(v); if (v) { setFiltro('DIFERENCIA'); setOrden(''); } }} />
              </View>
              {recuento ? <Aviso tono="nota" texto="Vuelve a contar los productos con diferencia, en orden de estante (por laboratorio). No verás el primer conteo ni el sistema hasta guardar el tuyo. No puedes recontar lo que contaste tú." /> : null}
            </View>
          ) : null}
          {/* El conteo firma la diferencia; el stock se corrige afuera. Hasta que
              alguien registre que lo aplicó, tiene que estar a la vista. */}
          {conteo?.aplica_en_caja && editable ? (
            <View style={{ marginHorizontal: 16 }}>
              {/* Dos frases a la vista y el paso a paso plegado: eran cinco
                  frases seguidas antes del primer producto. */}
              <Aviso tono="nota" texto={verComo
                ? 'Este conteo ajusta la existencia.\n• «Sin lote» es lo que no tiene lote asignado.\n• Si esas unidades traen lote impreso, agrega el lote con su vencimiento.\n• En «Sin lote» cuenta solo lo que no trae lote (0 si no hay).\n• Cuenta en lo que dice cada fila: cajas, blísteres o unidades.\n• Si un producto queda a medio contar, no se ajusta.'
                : 'Este conteo ajusta la existencia. Anota el lote de lo que lo trae y cuenta todos los lotes de cada producto.'} />
              <Pressable onPress={() => setVerComo((v) => !v)} hitSlop={8}
                style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 4, opacity: pressed ? 0.5 : 1 })}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{verComo ? 'Ocultar' : 'Cómo se hace'}</Text>
              </Pressable>
            </View>
          ) : null}
          {conteo?.aplica_en_caja && textoSinLote ? (
            <View style={{ marginHorizontal: 16 }}>
              <Aviso tono="nota" texto={textoSinLote} />
            </View>
          ) : null}
          {conteo?.aplica_en_caja && conteo.status === 'FINALIZADO' ? (
            <View style={{ marginHorizontal: 16 }}>
              <Aviso tono="cuidado" texto="Al aprobarlo, el inventario queda como se contó, lote por lote. Antes de firmar verás qué entra y qué sale. Lo que no se contó no cambia." />
            </View>
          ) : null}
          {conteo?.aplica_en_caja && conteo.status === 'CERRADO' ? (
            <View style={{ marginHorizontal: 16 }}>
              <AjusteDelInventario conteoId={conteo.id} />
            </View>
          ) : null}
          {conteo?.status === 'CERRADO' && !conteo.aplica_en_caja ? (
            <View style={{ marginHorizontal: 16, gap: 10 }}>
              {conteo.ajuste_erp_aplicado ? (
                <Aviso tono="nota" texto={`Ajuste aplicado el ${fechaTexto(conteo.ajuste_erp_at, { day: 'numeric', month: 'short', year: 'numeric' })} a las ${fmtHM(conteo.ajuste_erp_at)}.${conteo.ajuste_erp_nota ? ` Nota: «${conteo.ajuste_erp_nota}»` : ''}`} />
              ) : faltaAjusteDelConteo(conteo) ? (
                <>
                  <Aviso tono="cuidado" texto={`Falta aplicar el ajuste de ${conteo.total_diferencias} ${Number(conteo.total_diferencias) === 1 ? 'producto' : 'productos'}. Aplícalo y márcalo aquí.`} />
                  {puedeEditar ? <BotonGrande texto="Registrar ajuste" borde color={MARCA.ambar} onPress={registrarAjuste} /> : null}
                </>
              ) : <Aviso tono="nota" texto="No hay diferencias. No hay nada que ajustar." />}
            </View>
          ) : null}
          {hayVencidos ? (
            <Subfiltro activa={area} onCambiar={setArea} opciones={[
              { id: 'NORMAL', label: 'Inventario' },
              { id: 'VENCIDOS', label: 'Área de vencidos' },
            ]} />
          ) : null}
          <Subfiltro activa={filtro} onCambiar={setFiltro} opciones={filtros.map((f) => ({ id: f.key, label: f.key === 'DIFERENCIA' ? 'Diferencia' : f.label }))} />
          <FiltrosActivos grupos={grupos} />
          {porCodigo && (cargando || productos.filas.length) ? (
            <View style={{ marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }} numberOfLines={1}>{`Código ${porCodigo}`}</Text>
              <Pressable onPress={quitarCodigo} hitSlop={8}
                style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Quitar</Text>
              </Pressable>
            </View>
          ) : null}
          {productos.aproximado && busqueda ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto="No hay coincidencia exacta. Estos son productos parecidos." /></View> : null}
          {/* Con un código que no está, la tarjeta de abajo ya ofrece escanear otro. */}
          {porCodigo && !cargando && !productos.filas.length ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16 }}>
            {opcionesLab.length > 1 ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Elegir laboratorio"
                onPress={() => { Haptics.selectionAsync().catch(() => {}); setEligiendoLab(true); }}
                style={({ pressed }) => ({ flexShrink: 1, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6,
                  borderWidth: 1, borderColor: labElegido ? MARCA.azulClaro : colorSistema.separador, backgroundColor: labElegido ? `${MARCA.azul}26` : 'transparent',
                  opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ flexShrink: 1, color: labElegido ? colorSistema.texto : colorSistema.texto2, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                  {labElegido ? labElegido.label : 'Laboratorio'}
                </Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>▾</Text>
              </Pressable>
            ) : null}
            {labElegido ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Quitar laboratorio" hitSlop={8}
                onPress={() => { Haptics.selectionAsync().catch(() => {}); setLaboratorioId('todos'); }}
                style={({ pressed }) => ({ minHeight: 40, minWidth: 32, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                <Text style={{ color: colorSistema.texto2, fontSize: 16 }}>✕</Text>
              </Pressable>
            ) : null}
            <Text style={{ flex: 1, textAlign: 'right', color: colorSistema.texto2, fontSize: 13, marginRight: 4 }}>{`${productos.total.toLocaleString('es-SV')} producto${productos.total === 1 ? '' : 's'}`}</Text>
          </View>
          )}
          {productos.filas.map((p) => {
            // «3/3» era renglones contados de renglones: no decía si cuadraba.
            const estado = estadoDelProducto(p);
            const pide = rotuloDeLoQuePide(p);
            return (
              <View key={p.erp_product_id} style={{ marginHorizontal: 16 }}>
                <Vidrio radio={20}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 }}>
                    {p.foto_url ? <Image source={{ uri: p.foto_url }} style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#fff' }} resizeMode="contain" />
                      : <Chip icono="Package" color={MARCA.azulClaro} tamano={40} />}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{p.product_nombre}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{p.laboratorio_nombre}</Text>
                      {pide && !simple ? <Text style={{ color: MARCA.azulClaro, fontSize: 12, fontWeight: '700' }}>{pide}</Text> : null}
                    </View>
                    <Pildora texto={estado.texto} color={TONO[estado.tono]()} />
                  </View>
                  <View style={{ paddingHorizontal: 14, paddingBottom: 6 }}>
                    {!items[p.erp_product_id] ? <Indicador style={{ marginVertical: 10 }} />
                      : !items[p.erp_product_id].length ? <Text style={{ color: colorSistema.texto2, fontSize: 13, paddingVertical: 10 }}>Sin lotes en este estante.</Text>
                      : items[p.erp_product_id].map((it) => <Renglon key={it.id} it={it} producto={simple ? null : p} editable={editable} aCiegas={recuento} onGuardado={alGuardar(p.erp_product_id)} onHistorial={setHistorial}
                        registrar={registrar} onEnCurso={anotarEnCurso} onSiguiente={siguienteCampo} onEnfocar={enfocar}
                        // En un conteo que ajusta, el lote de un renglón del sistema no se
                        // corrige (la base lo rechaza): se agrega el lote real y aquí se cuenta 0.
                        onLote={editable && !simple && (!conteo?.aplica_en_caja || it.es_agregado_manual) ? (x) => setAccion({ item: x, modo: 'lote' }) : null}
                        // …y ése es el camino: los lotes reales de la caja (`LoteReal`).
                        // En todo conteo por lote, ajuste o no (gemelo de `llevaLotesEnLinea`
                        // de la web): en el cíclico de Salud 4, que no ajusta, no había dónde
                        // agregar el segundo lote de un producto (2026-11-17).
                        onLoteReal={editable && !simple && !it.is_vencidos && (!conteo?.aplica_en_caja || !it.es_agregado_manual) ? setLoteReal : null}
                        ajusta={!!conteo?.aplica_en_caja}
                        onRecontar={puedeAprobar ? (x) => setAccion({ item: x, modo: 'recuento' }) : null} />)}
                  </View>
                </Vidrio>
              </View>
            );
          })}
          {cargando ? <Cargando /> : null}
          {!cargando && productos.total > productos.filas.length ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setPagina((n) => n + 1)} /></View> : null}
          {/* El código escaneado no está en el conteo: la salida está aquí mismo,
              no en el buscador (el código no se escribe en la barra nativa y en
              iOS no había cómo limpiar la búsqueda). */}
          {!cargando && !productos.filas.length && porCodigo ? (
            <View style={{ marginHorizontal: 16, marginTop: 8 }}>
              <Vidrio radio={20}>
                <View style={{ padding: 18, gap: 4, alignItems: 'center' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '700' }}>No está en este conteo</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Código ${porCodigo}`}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 12 }}>
                    {editable ? <Pastilla texto="Escanear otro" color={MARCA.azul} lleno onPress={() => { quitarCodigo(); setEscaneando(true); }} /> : null}
                    {editable ? <Pastilla texto="Agregarlo" color={MARCA.azulClaro} onPress={() => setAgregando(true)} /> : null}
                  </View>
                  <Pressable onPress={quitarCodigo} hitSlop={8} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Volver a la lista</Text>
                  </Pressable>
                </View>
              </Vidrio>
            </View>
          ) : null}
          {!cargando && !productos.filas.length && !porCodigo ? (
            <Vacio accion={busqueda && editable ? { texto: 'Agregar al conteo', onPress: () => setAgregando(true) } : null}>
              {busqueda ? 'Este producto no está en el conteo' : filtro === 'PENDIENTES' ? 'No queda nada por contar' : 'Sin productos en este filtro'}
            </Vacio>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <ElegirLaboratorio visible={eligiendoLab} opciones={opcionesLab} valor={String(laboratorioId)}
        onElegir={(v) => setLaboratorioId(v)} onCerrar={() => setEligiendoLab(false)} />
      <Historial item={historial} simple={conteo?.modo === 'SIMPLE'} onCerrar={() => setHistorial(null)} />
      <LoteReal conteoId={id} item={loteReal}
        hermanos={loteReal ? (items[loteReal.erp_product_id] || []).filter((h) => String(h.presentacion ?? '').trim().toUpperCase() === String(loteReal.presentacion ?? '').trim().toUpperCase()) : []}
        onCerrar={() => setLoteReal(null)}
        onListo={() => { if (loteReal) refrescarProducto(loteReal.erp_product_id); }} />
      <AccionDeRenglon item={accion?.item ?? null} modo={accion?.modo} aCiegas={recuento}
        producto={accion ? productos.filas.find((f) => f.erp_product_id === accion.item.erp_product_id) : null}
        hermanos={accion ? (items[accion.item.erp_product_id] || []) : []} onCerrar={() => setAccion(null)} onHecho={alAccion} />
      <AgregarRenglon visible={agregando} conteoId={id} branchId={conteo?.branch_id} simple={simple} onCerrar={() => setAgregando(false)}
        onAgregado={(prod) => {
          // Ya está en la lista: se relee ése y se abre, sin moverse de lugar.
          if (productos.filas.some((f) => f.erp_product_id === prod.id)) { refrescarProducto(prod.id); return; }
          setItems((m) => { const n = { ...m }; delete n[prod.id]; return n; }); setFiltro('TODOS'); setTexto(prod.nombre); setPagina(1); cargar(); cargarConteo();
        }} />
      <Escaner visible={escaneando} titulo="Buscar en el conteo" ayuda="Apunta al código de barras del producto"
        onCodigo={(c) => {
          setEscaneando(false); setFiltro('TODOS'); setTexto(String(c)); setPorCodigo(String(c).trim());
          // Si el código da con un producto, su primer lote sin contar queda listo para escribir.
          focoPendiente.current = { busqueda: String(c).trim() };
        }} onCerrar={() => setEscaneando(false)} />
    </>
  );
}
