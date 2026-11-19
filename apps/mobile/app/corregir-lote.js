// Corregir lote o vencimiento en la sucursal, NATIVO. Hace lo que el portal hace
// en `src/views/dashboard/CorregirLoteSala.jsx` (dentro del Ajuste de
// inventario), con sus mismas funciones del núcleo:
//
//   1. Buscar el producto entre lo que la sucursal tiene (`buscarConExistencia`).
//      Lo que un conteo abierto está contando no se ofrece.
//   2. Elegir el lote que está mal (`fetchLotesEnUnidades`). Lo sin lote
//      asignado sólo en un producto con control de lote (`fetchExigenciasDe`).
//   3. Cuántas unidades, el lote y el vencimiento correctos, y por qué.
//      `corregirLoteEnSala` lo manda y deja la bitácora salga bien o mal.
//
// Directo, sin aprobación (decisión del usuario, 2026-11-16). No suma ni resta
// unidades. Las reglas finas las decide la función del servidor.
//
// Se abre desde Ajuste de inventario (`nueva/ajuste.js`) con `?sala=<branchId>`.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Presionable as Pressable } from '../componentes/Tocable';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { buscarConExistencia, corregirLoteEnSala, fetchLotesEnUnidades, fetchSucursalEnConteo } from '@nucleo/data/inventoryMovements';
import { fetchExigenciasDe, fetchLotesConocidosDeProducto } from '@nucleo/data/traslados';
import { choqueDeLote, loteDeCajaParaEnviar, motivoDeLoteDeCaja, motivoDeVenceDeCaja, venceDeCajaParaEnviar } from '@nucleo/utils/loteDeCaja';
import { venceNormal } from '@nucleo/utils/cobroDeAplicacion';
import { esLoteGenerico } from '@nucleo/utils/unidadesInventario';
import { fechaNumerica, hoySV } from '@nucleo/utils/fecha';
import { BRANCH_A_ERP } from '@nucleo/constants/erp';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { avisar, fallo, listo, trabajando } from '../componentes/Progreso';

// El vencimiento se guarda como día 1 del mes: se muestra como en el empaque.
const fmtVence = (d) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(d ?? ''));
  return m ? `${m[2]}/${m[1]}` : fechaNumerica(d, { vacio: null });
};
const yaVencio = (d) => !!d && String(d).slice(0, 10) <= hoySV();
const rotulo = (l) => (esLoteGenerico(l.lote) ? 'Sin lote asignado' : `Lote ${l.lote}`);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const mesAnio = (v) => { const [a, m] = String(v).split('-'); return `${m}/${a}`; };
const aGuardado = (t) => {
  const limpio = String(t).replace(/[^\d/]/g, '').slice(0, 7);
  const v = venceNormal(limpio);
  return /^\d{4}-\d{2}$/.test(v) ? v : limpio;
};
const aPantalla = (v) => (/^\d{4}-\d{2}$/.test(String(v)) ? mesAnio(v) : String(v ?? ''));

function Chip({ texto, onPress, color = MARCA.azulClaro }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 22,
      borderWidth: 1, borderColor: color, opacity: pressed ? 0.6 : 1,
    })}>
      <Text style={{ color, fontSize: 14, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

/* El lote correcto. Es `componentes/LoteDeLaCaja.js` con los dos agregados que
 * el portal le dio SÓLO para corregir (`src/views/traslados/LoteDeLaCaja.jsx`):
 *   · `excluir`: el par que se corrige no cuenta como «registrado» (si no,
 *     corregirle la fecha chocaría consigo mismo).
 *   · `permitirOtraFecha`: con el mismo número registrado con otra fecha,
 *     ofrece «Esa fecha también está mal».
 * Vive aquí porque esta tarea no podía tocar el componente compartido; cuando
 * se pueda, estos dos agregados van a `LoteDeLaCaja.js` y esto se borra. */
function LoteCorrecto({ erpProductId, producto, valor, onChange, excluir, permitirOtraFecha }) {
  const [todos, setTodos] = useState([]);
  useEffect(() => {
    let vivo = true;
    fetchLotesConocidosDeProducto(erpProductId).then((l) => { if (vivo) setTodos(l ?? []); }).catch(() => {});
    return () => { vivo = false; };
  }, [erpProductId]);
  const exLote = String(excluir?.lote ?? '').trim().toUpperCase();
  const exFecha = String(excluir?.fecha ?? '').slice(0, 10);
  const conocidos = useMemo(() => (exLote ? todos.filter((c) => !(c.lote === exLote && c.fecha === exFecha)) : todos), [todos, exLote, exFecha]);

  const choqueCrudo = choqueDeLote(valor, conocidos);
  const otraFechaVale = permitirOtraFecha && choqueCrudo?.mismoNumero && valor?.otraFecha === String(valor?.lote || '').trim().toUpperCase();
  const choque = otraFechaVale ? null : choqueCrudo;
  const motivo = otraFechaVale ? motivoDeVenceDeCaja(valor) : motivoDeLoteDeCaja(valor, conocidos);
  const envio = motivo ? null
    : otraFechaVale ? { lote: String(valor.lote).trim().toUpperCase(), vence: venceDeCajaParaEnviar(valor).vence }
    : loteDeCajaParaEnviar(valor, conocidos);
  const tocado = Boolean(valor?.lote || valor?.vence);

  const envioLote = envio ? envio.lote : null;
  const envioVence = envio?.vence ?? null;
  useEffect(() => {
    if ((valor?.envio?.lote ?? null) !== envioLote || (valor?.envio?.vence ?? null) !== envioVence)
      onChange({ ...valor, envio: envioVence ? { lote: envioLote, vence: envioVence } : null });
  }, [envioLote, envioVence, valor, onChange]);

  const usar = (c) => onChange({ lote: c.lote, vence: c.vence, envio: valor?.envio ?? null });
  const escrito = String(valor?.lote || '').trim().toUpperCase();
  const sugeridos = conocidos.filter((c) => !escrito || c.lote.startsWith(escrito)).slice(0, 6);

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Lote correcto</Text>
      <Campo multiline={false} value={valor?.lote ?? ''} autoCapitalize="characters" autoCorrect={false}
        accessibilityLabel={`Lote de ${producto}`} placeholder="Lote"
        onChangeText={(t) => {
          const lote = t.toUpperCase();
          const c = conocidos.find((k) => k.lote === lote);
          onChange({ ...valor, lote, nuevo: false, ...(c && !valor?.vence ? { vence: c.vence } : {}) });
        }} />
      {sugeridos.length && !(sugeridos.length === 1 && sugeridos[0].lote === escrito) ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {sugeridos.map((c) => <Chip key={`${c.lote}|${c.fecha}`} texto={`${c.lote} · ${mesAnio(c.vence)}`} onPress={() => usar(c)} />)}
        </View>
      ) : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Vencimiento correcto</Text>
      <Campo multiline={false} value={aPantalla(valor?.vence)} placeholder="MM/AAAA" keyboardType="numbers-and-punctuation"
        accessibilityLabel={`Vencimiento de ${producto}`}
        onChangeText={(t) => onChange({ ...valor, vence: aGuardado(t), nuevo: false })} />
      {choque ? (
        <View style={{ gap: 8 }}>
          <Aviso tono="cuidado" texto={choque.mismoNumero
            ? `El lote ${choque.lote} ya está registrado con vencimiento ${mesAnio(choque.vence)}. Un lote tiene un solo vencimiento. Revisa la caja.`
            : `¿Es el lote ${choque.lote} · ${mesAnio(choque.vence)}? Se parece al que escribiste.`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip texto={`Usar ${choque.lote} · ${mesAnio(choque.vence)}`} onPress={() => usar(choque)} />
            {!choque.mismoNumero ? <Chip texto="No, es otro lote" color={colorSistema.texto2} onPress={() => onChange({ ...valor, nuevo: true })} /> : null}
            {choque.mismoNumero && permitirOtraFecha ? (
              <Chip texto="Esa fecha también está mal" color={MARCA.ambar} onPress={() => onChange({ ...valor, otraFecha: String(valor?.lote || '').trim().toUpperCase() })} />
            ) : null}
          </View>
        </View>
      ) : motivo ? <Aviso tono={tocado ? 'cuidado' : 'nota'} texto={motivo} /> : null}
    </View>
  );
}

function Fila({ titulo, detalle, detalleColor, derecha, onPress, deshabilitada, primera }) {
  return (
    <Pressable disabled={deshabilitada} onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingTop: primera ? 0 : 9,
        borderTopWidth: primera ? 0 : 0.5, borderTopColor: colorSistema.separador, opacity: deshabilitada ? 0.4 : pressed ? 0.6 : 1 })}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15 }} numberOfLines={2}>{titulo}</Text>
        {detalle ? <Text style={{ color: detalleColor ?? colorSistema.texto2, fontSize: 13 }}>{detalle}</Text> : null}
      </View>
      {derecha ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{derecha}</Text> : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text>
    </Pressable>
  );
}

export default function CorregirLote() {
  const { sala: salaParam } = useLocalSearchParams();
  const { user, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  // La misma regla que el Ajuste: quien no ve todas, sólo su sucursal.
  const todas = getScope?.('dash_inv_movement') === 'ALL';
  const propia = String(salaDelUsuario(user) ?? '');
  const branchId = todas && salaParam ? String(salaParam) : propia;
  const erpSucursalId = BRANCH_A_ERP[branchId] ?? null;
  const nombreSala = (sucursales || []).find((b) => String(b.id) === branchId)?.name ?? '';

  const [enConteo, setEnConteo] = useState(null);
  useEffect(() => {
    let vivo = true;
    fetchSucursalEnConteo(branchId).then((r) => { if (vivo) setEnConteo(r); }).catch(() => {});
    return () => { vivo = false; };
  }, [branchId]);
  const enElConteo = useMemo(() => new Set(enConteo?.productos ?? []), [enConteo]);

  const [texto, setTexto, aplicado] = useBusqueda();
  const [candidatos, setCandidatos] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [producto, setProducto] = useState(null);   // { erp_product_id, descripcion }
  const [lotes, setLotes] = useState(null);         // null = cargando
  const [regulado, setRegulado] = useState(null);
  const [origen, setOrigen] = useState(null);       // el lote que está mal
  const [unidades, setUnidades] = useState(0);
  const [caja, setCaja] = useState({ lote: '', vence: '' });
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(null);
  const [vuelta, setVuelta] = useState(0);

  // ── Paso 1 · el producto ──
  useEffect(() => {
    const q = aplicado.trim();
    if (q.length < 2 || !erpSucursalId) { setCandidatos([]); return undefined; }
    let vivo = true;
    setBuscando(true);
    buscarConExistencia({ erpSucursalId, texto: q }).then(({ filas, error }) => {
      if (!vivo) return;
      setBuscando(false);
      if (error) { fallo('No se pudo buscar', error.message ?? String(error)); return; }
      const vistos = new Set();
      setCandidatos((filas ?? []).filter((f) => (vistos.has(f.erp_product_id) ? false : vistos.add(f.erp_product_id))));
    });
    return () => { vivo = false; };
  }, [aplicado, erpSucursalId]);

  // ── Paso 2 · sus lotes, en unidades ──
  useEffect(() => {
    if (!producto) return undefined;
    let vivo = true;
    setLotes(null); setRegulado(null);
    Promise.all([
      fetchLotesEnUnidades({ erpProductId: producto.erp_product_id, erpSucursalId }),
      fetchExigenciasDe([producto.erp_product_id]),
    ]).then(([r, ex]) => {
      if (!vivo) return;
      if (r.error) fallo('No se pudieron leer los lotes', r.error.message ?? String(r.error));
      setLotes(r.lotes ?? []);
      setRegulado(ex.get(Number(producto.erp_product_id))?.regulado ?? false);
    }).catch((e) => { if (vivo) { setLotes([]); fallo('No se pudieron leer los lotes', e?.message); } });
    return () => { vivo = false; };
  }, [producto, erpSucursalId, vuelta]);

  // Lo sin lote asignado sólo se corrige en un producto con control de lote.
  const ofrecidos = useMemo(() => (lotes ?? []).filter((l) => !esLoteGenerico(l.lote) || regulado), [lotes, regulado]);

  const elegirLote = (l) => {
    setOrigen(l);
    setUnidades(l.unidades);
    // El vencimiento va VACÍO: casi siempre es lo que está mal.
    setCaja({ lote: esLoteGenerico(l.lote) ? '' : l.lote, vence: '' });
  };

  const loteNuevo = caja.envio?.lote ?? '';
  const venceListo = caja.envio?.vence ?? null;
  const mismoNumero = origen && !esLoteGenerico(origen.lote) && norm(origen.lote) === norm(caja.lote);
  const sinCambio = mismoNumero && venceListo && String(origen.vence ?? '').slice(0, 10) === venceListo;
  // Si el número se queda, el lote va completo: un lote físico tiene una fecha.
  const loteCompleto = mismoNumero && origen && unidades !== origen.unidades;
  const faltan = !origen ? 'el lote'
    : !(unidades > 0) ? 'cuántas unidades'
    : !caja.envio ? 'el lote correcto'
    : motivo.trim().length < 4 ? 'por qué' : null;
  const puedeEnviar = !faltan && !sinCambio && !loteCompleto && !enviando;

  // Así queda la sucursal: el total no cambia nunca.
  const asiQueda = useMemo(() => {
    if (!origen || !caja.envio || sinCambio || loteCompleto || !(unidades > 0)) return null;
    const filas = (lotes ?? []).map((l) => ({ ...l, antes: l.unidades }));
    const o = filas.find((l) => l.clave === origen.clave);
    if (o) o.unidades -= unidades;
    const destino = filas.find((l) => norm(l.lote) === norm(caja.envio.lote) && String(l.vence ?? '').slice(0, 10) === caja.envio.vence);
    if (destino) destino.unidades += unidades;
    else filas.push({ clave: 'nuevo', lote: caja.envio.lote, vence: caja.envio.vence, unidades, antes: 0, nuevo: true });
    const total = (lotes ?? []).reduce((n, l) => n + l.unidades, 0);
    return { filas: filas.filter((l) => l.unidades > 0 || l.antes > 0), total };
  }, [origen, caja.envio, sinCambio, loteCompleto, unidades, lotes]);

  const enviar = async () => {
    if (!puedeEnviar) return;
    setEnviando(true); trabajando('Corrigiendo…');
    try {
      // La bitácora la anota `corregirLoteEnSala`, salga bien o mal.
      const { resultado, error } = await corregirLoteEnSala({
        erpSucursalId, erpProductId: producto.erp_product_id, descripcion: producto.descripcion,
        lote: origen.lote, vence: origen.vence, unidades,
        loteNuevo: loteNuevo.trim(), venceNuevo: venceListo, motivo: motivo.trim(),
      });
      if (error) { fallo('No se pudo corregir', error); return; }
      setHecho(resultado);
      const texto = `${resultado?.unidades ?? unidades} ${(resultado?.unidades ?? unidades) === 1 ? 'unidad' : 'unidades'} ahora son del lote ${resultado?.lote ?? loteNuevo}, vence ${fmtVence(resultado?.vence ?? venceListo)}.`;
      if (resultado?.avisos?.length) avisar('Lote corregido', [texto, ...resultado.avisos].join('\n\n'));
      else listo('Lote corregido', texto);
    } catch (e) {
      fallo('No se pudo corregir', e?.message ?? String(e));
    } finally {
      setEnviando(false);
    }
  };

  const atrasUnPaso = useCallback(() => {
    if (origen) { setOrigen(null); return; }
    if (producto) { setProducto(null); return; }
    router.back();
  }, [origen, producto]);

  const titulo = 'Corregir lote o vencimiento';
  const pasoAtras = (rotuloAtras) => (
    <Pressable onPress={atrasUnPaso} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: colorSistema.acento, fontSize: 15, marginHorizontal: 4 }}>‹ {rotuloAtras}</Text>
    </Pressable>
  );

  if (!erpSucursalId) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: titulo }} />
        <ScrollView contentContainerStyle={{ padding: 16 }} contentInsetAdjustmentBehavior="automatic">
          <Aviso tono="freno" texto="No se sabe de qué sucursal es el inventario." />
        </ScrollView>
      </>
    );
  }

  // ── Hecho ──
  if (hecho) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: titulo }} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
          <Seccion titulo="Lote corregido">
            <Text style={{ color: colorSistema.texto, fontSize: 15 }}>
              {`${hecho.unidades} ${hecho.unidades === 1 ? 'unidad' : 'unidades'} de ${producto.descripcion} ahora son del lote ${hecho.lote}, vence ${fmtVence(hecho.vence)}.`}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>En unos minutos se ve así en el inventario.</Text>
            {(hecho.avisos ?? []).map((a) => <Aviso key={a} tono="cuidado" texto={a} />)}
          </Seccion>
          {/* Otro lote del MISMO producto: se corrige un renglón por vez. */}
          <BotonGrande texto="Corregir otro lote" borde onPress={() => { setHecho(null); setOrigen(null); setMotivo(''); setVuelta((v) => v + 1); }} />
          <BotonGrande texto="Listo" onPress={() => router.back()} />
        </ScrollView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: titulo }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {nombreSala ? <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>{nombreSala}</Text> : null}
          {enConteo?.en_conteo ? (
            <Aviso tono="freno" texto={`Hay un conteo de inventario abierto en ${enConteo.sala ?? 'la sucursal'}. Mientras se cuenta no se puede corregir. Cierra el conteo y vuelve a intentarlo.`} />
          ) : !producto ? (
            <Seccion titulo="Producto" pie="Cambia el lote o el vencimiento de lo que ya está en la sucursal. No quita ni agrega unidades. No necesita aprobación. Queda anotado quién lo hizo y por qué.">
              <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Busca el producto con el lote mal puesto" autoCorrect={false} />
              {aplicado.trim().length >= 2 ? (
                buscando ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Buscando…</Text>
                  : !candidatos.length ? <Aviso texto="Ese producto no está en la sucursal." />
                    : candidatos.slice(0, 30).map((f, i) => {
                      const contando = enElConteo.has(Number(f.erp_product_id)) || enElConteo.has(f.erp_product_id);
                      return (
                        <Fila key={f.erp_product_id} primera={i === 0} titulo={f.descripcion} deshabilitada={contando}
                          detalle={contando ? 'Se está contando' : null} detalleColor={MARCA.ambar}
                          onPress={() => { setProducto({ erp_product_id: f.erp_product_id, descripcion: f.descripcion }); setTexto(''); }} />
                      );
                    })
              ) : null}
            </Seccion>
          ) : !origen ? (
            <>
              {pasoAtras('Otro producto')}
              <Seccion titulo="¿Qué lote está mal?">
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{producto.descripcion}</Text>
                {lotes === null || regulado === null ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Leyendo los lotes…</Text>
                  : !ofrecidos.length ? <Aviso texto="Este producto no lleva control de lote en la sucursal." />
                    : ofrecidos.map((l, i) => (
                      <Fila key={l.clave} primera={false} titulo={rotulo(l)} derecha={`${l.unidades} u.`}
                        detalle={l.vence ? `${yaVencio(l.vence) ? 'Venció' : 'Vence'} ${fmtVence(l.vence)}` : 'Sin vencimiento'}
                        detalleColor={yaVencio(l.vence) ? MARCA.rojo : undefined} onPress={() => elegirLote(l)} />
                    ))}
              </Seccion>
            </>
          ) : (
            <>
              {pasoAtras('Otro lote')}
              <Seccion titulo="Lo que está mal">
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{producto.descripcion}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Ahora: ${rotulo(origen)}${origen.vence ? ` · vence ${fmtVence(origen.vence)}` : ''} · ${origen.unidades} u.`}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Unidades que se corrigen</Text>
                  <Pressable accessibilityLabel="Una menos" onPress={() => { Haptics.selectionAsync().catch(() => {}); setUnidades((u) => Math.max(1, u - 1)); }}
                    style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(127,127,127,0.35)' : 'rgba(127,127,127,0.2)' })}>
                    <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '600' }}>−</Text>
                  </Pressable>
                  <Text style={{ width: 44, textAlign: 'center', color: colorSistema.texto, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{unidades}</Text>
                  <Pressable accessibilityLabel="Una más" onPress={() => { Haptics.selectionAsync().catch(() => {}); setUnidades((u) => Math.min(origen.unidades, u + 1)); }}
                    style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(127,127,127,0.35)' : 'rgba(127,127,127,0.2)' })}>
                    <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '600' }}>+</Text>
                  </Pressable>
                </View>
              </Seccion>
              <Seccion titulo="Lo correcto">
                <LoteCorrecto erpProductId={producto.erp_product_id} producto={producto.descripcion} valor={caja} onChange={setCaja}
                  excluir={esLoteGenerico(origen.lote) ? null : { lote: origen.lote, fecha: origen.vence }}
                  permitirOtraFecha={!esLoteGenerico(origen.lote)} />
                <Campo value={motivo} onChangeText={setMotivo} placeholder="¿Por qué se corrige? (obligatorio)" />
                {sinCambio ? <Aviso tono="cuidado" texto="Es el mismo lote con el mismo vencimiento. No hay nada que corregir." /> : null}
                {loteCompleto ? <Aviso tono="cuidado" texto={`Si sólo cambia el vencimiento, se corrige el lote completo (${origen.unidades} u.). Un lote no puede tener dos fechas.`} /> : null}
              </Seccion>
              {asiQueda ? (
                <Seccion titulo="Así queda la sucursal" pie={`Total ${asiQueda.total} u., igual que antes.`}>
                  {asiQueda.filas.map((l) => (
                    <View key={l.clave} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ flex: 1, color: l.unidades === 0 ? colorSistema.texto2 : colorSistema.texto, fontSize: 14, textDecorationLine: l.unidades === 0 ? 'line-through' : 'none' }} numberOfLines={1}>
                        {`${rotulo(l)}${l.vence ? ` · ${fmtVence(l.vence)}` : ''}`}
                        {l.nuevo ? <Text style={{ color: MARCA.azulClaro, fontWeight: '700' }}> · nuevo</Text> : null}
                      </Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 14, fontVariant: ['tabular-nums'] }}>{`${l.antes} →`}</Text>
                      <Text style={{ width: 44, textAlign: 'right', color: colorSistema.texto, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{l.unidades}</Text>
                    </View>
                  ))}
                </Seccion>
              ) : null}
              <BotonGrande texto={enviando ? 'Corrigiendo…' : faltan ? `Falta ${faltan}` : 'Corregir'} deshabilitado={!puedeEnviar} onPress={enviar} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
