// Lotes del libro por revisar, NATIVO — `src/views/bitacoras/TabLotesPorRevisar.jsx`
// del portal (PENDIENTES 22), con sus mismas funciones del núcleo.
//
// El lote del renglón sale de la venta: si ahí dice dos lotes en uno, «GENERICO»
// o nada, el libro lo hereda. Lo que pide la norma es el lote de la caja que se
// entregó, y eso sólo lo sabe quien tiene la caja en la mano: corrige la
// sucursal (`bitacoras_corregir_lote`) escribiéndolo, y el regente lo confirma
// o lo devuelve con el motivo (`bitacoras_confirmar_lote`). Cada paso queda en
// la bitácora de acciones igual que en el portal.
//
// `?sala=` la sucursal que se miraba en Bitácoras. Quien ve todas las salas
// puede mirar toda la red (es una cola, sin fecha).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { confirmarLoteDelLibro, corregirLoteDelLibro, fetchLotesPorRevisar } from '@nucleo/data/bitacoras';
import { loteFundido, queFaltaAlCorregirLote, vencidoAlVender } from '@nucleo/utils/libroBajoReceta';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { salasDeBitacora } from '@nucleo/utils/rondaDeBitacora';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Refrescar from '../componentes/Refrescar';
import { useEnTramos } from '../componentes/alFinal';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Cargando, Seccion, Vacio } from '../componentes/formulario/Piezas';
import Fecha from '../componentes/formulario/Fecha';
import { Casilla } from '../componentes/comunes';
import { Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import FijoArriba from '../componentes/FijoArriba';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';
import { BotonChico, Hoja, Rotulo, pedirMotivo } from '../componentes/bitacoras/Piezas';

const VACIO = [];
const RED = 'red';
const MOTIVO_LOTE = {
  fundido: { label: 'Dos lotes en uno', color: MARCA.rojo },
  generico: { label: 'Lote genérico', color: MARCA.rojo },
  sin_lote: { label: 'Sin lote', color: MARCA.rojo },
  vencido: { label: 'Vencido al vender', color: MARCA.ambar },
};
const ESTADO = {
  pendiente: { label: 'Por corregir', color: MARCA.ambar },
  devuelta: { label: 'Devuelto', color: MARCA.rojo },
  corregida: { label: 'Por confirmar', get color() { return MARCA.azulClaro; } },
  confirmada: { label: 'Confirmado', color: MARCA.verde },
};
const num = (v) => (v === null || v === undefined ? '—' : String(Number(v)));
const fmt = (f) => (f ? fechaTexto(f, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const T = ({ children, tenue, fuerte, tam = 15, color, style }) => (
  <Text style={[{ color: color ?? (tenue ? colorSistema.texto2 : colorSistema.texto), fontSize: tam, fontWeight: fuerte ? '700' : '400' }, style]}>{children}</Text>
);
const anotar = (accion, id, detalle) => useStaffStore.getState().appendAuditLog?.(accion, id, detalle);

export default function LotesPorRevisar() {
  const { sala: salaParam } = useLocalSearchParams();
  const { user, hasPermission, getScope } = useAuth();
  const branches = useStaffStore((s) => s.branches) || VACIO;
  const puedeCorregir = hasPermission('bitacoras_corregir_lote', 'can_edit');
  const puedeConfirmar = hasPermission('bitacoras_confirmar_lote', 'can_edit');
  const alcanceTodas = getScope('bitacoras') === 'ALL';
  const salas = useMemo(() => salasDeBitacora(branches, { libro: true }), [branches]);
  const pedida = String(salaParam || salaDelUsuario(user) || '');
  const [elegida, setElegida] = useState(null);
  // Como el portal: la sala elegida si dispensa; si no, con alcance todas, la red.
  const porDefecto = salas.some((o) => o.value === pedida) ? pedida : (alcanceTodas ? RED : pedida);
  const sala = elegida ?? porDefecto;
  const branchId = sala === RED ? null : (sala || null);
  const nombreSala = branchId ? (branches.find((b) => String(b.id) === String(branchId))?.name || '') : 'Toda la red';

  const [vista, setVista] = useState('abiertas');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { revisiones, error: e } = await fetchLotesPorRevisar(branchId);
    setError(e || null);
    setFilas(e ? [] : revisiones);
  }, [branchId]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]);

  const abiertas = useMemo(() => (filas || []).filter((f) => f.estado !== 'confirmada'), [filas]);
  const confirmadas = useMemo(() => (filas || []).filter((f) => f.estado === 'confirmada'), [filas]);
  const lista = vista === 'abiertas' ? abiertas : confirmadas;
  const porCorregir = abiertas.filter((f) => f.estado === 'pendiente' || f.estado === 'devuelta').length;
  const porConfirmar = abiertas.filter((f) => f.estado === 'corregida').length;
  const tramo = useEnTramos(lista, 40, `${vista}|${sala}`);

  const confirmar = async (f) => {
    setOcupado(f.id);
    const { error: e } = await confirmarLoteDelLibro({ revisionId: f.id, aceptar: true });
    setOcupado(null);
    if (e) { fallo('No se pudo confirmar', mensajeAmigable(e)); return; }
    anotar('BITACORA_LOTE_CONFIRMADO', String(f.dispensacion_id), { revision_id: f.id, folio: f.folio_txt });
    listo('Lote confirmado', `${f.folio_txt} · ${f.producto_nombre}`);
    cargar();
  };
  const devolver = async (f) => {
    const motivo = await pedirMotivo({ titulo: 'Devolver a la sucursal', mensaje: `${f.folio_txt} · ${f.producto_nombre}. Escribe qué está mal.`, confirmar: 'Devolver' });
    if (!motivo) return;
    setOcupado(f.id);
    const { error: e } = await confirmarLoteDelLibro({ revisionId: f.id, aceptar: false, motivo });
    setOcupado(null);
    if (e) { fallo('No se pudo devolver', mensajeAmigable(e)); return; }
    anotar('BITACORA_LOTE_DEVUELTO', String(f.dispensacion_id), { revision_id: f.id, folio: f.folio_txt, motivo });
    listo('Devuelto a la sucursal', f.folio_txt);
    cargar();
  };

  const grupos = alcanceTodas ? [{ id: 'sala', titulo: 'Sucursal', activa: sala, porDefecto, onCambiar: setElegida,
    opciones: [{ id: RED, label: 'Toda la red' }, ...salas.map((o) => ({ id: o.value, label: o.label }))] }] : [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_FIJA, title: 'Lotes por revisar' }} />
      <MenuDeFiltros grupos={grupos} />
      <FijoArriba>
        <Segmentos activa={vista} onCambiar={setVista} opciones={[
          { id: 'abiertas', label: `Abiertas (${filas ? abiertas.length : '…'})` },
          { id: 'confirmadas', label: `Confirmadas (${filas ? confirmadas.length : '…'})` },
        ]} />
      </FijoArriba>
      <ScrollView {...tramo.scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {nombreSala ? <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '700', marginHorizontal: 20 }}>{nombreSala}</Text> : null}
        {abiertas.length > 0 ? (
          <View style={{ marginHorizontal: 16, gap: 2 }}>
            <Aviso tono={porCorregir ? 'cuidado' : 'nota'} texto={[porCorregir && `${porCorregir} por corregir`, porConfirmar && `${porConfirmar} por confirmar`].filter(Boolean).join(' · ')} />
            <Aviso texto="Escribe el lote y el vencimiento impresos en la caja entregada. Después lo confirma el regente." />
          </View>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={mensajeAmigable(error)} /></View> : null}
        {filas == null ? <Cargando /> : !lista.length ? (
          <Vacio titulo={vista === 'abiertas' ? 'No hay lotes del libro por revisar.' : 'Ninguno confirmado todavía'} tono={vista === 'abiertas' ? 'bien' : undefined} />
        ) : tramo.visibles.map((f) => {
          const m = MOTIVO_LOTE[f.motivo];
          const e = ESTADO[f.estado];
          const partes = Array.isArray(f.partes) ? f.partes : [];
          const corrige = puedeCorregir && (f.estado === 'pendiente' || f.estado === 'devuelta');
          const confirma = puedeConfirmar && f.estado === 'corregida';
          return (
            <View key={f.id} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={20}>
                <View style={{ padding: 14, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <T fuerte style={{ flex: 1 }}>{f.producto_nombre}</T>
                    {e ? <Pildora texto={e.label} color={e.color} /> : null}
                  </View>
                  <T tenue tam={13} style={{ fontVariant: ['tabular-nums'] }}>
                    {`${f.folio_txt} · ${fmt(f.fecha)} · ${num(f.cantidad)} ${Number(f.cantidad) === 1 ? 'unidad' : 'unidades'}${branchId ? '' : ` · ${f.sala}`}`}
                  </T>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    {m ? <Pildora texto={m.label} color={m.color} /> : null}
                    <T tam={14} color={partes.length ? colorSistema.texto2 : undefined}
                      style={{ fontVariant: ['tabular-nums'], textDecorationLine: partes.length ? 'line-through' : 'none' }}>
                      {`${f.lote_original || 'sin lote'} · vence ${fmt(f.vence_original)}`}
                    </T>
                  </View>
                  {partes.map((p, k) => (
                    <T key={k} fuerte tam={14} style={{ fontVariant: ['tabular-nums'] }}>{`${p.lote} · vence ${fmt(p.vence)}${partes.length > 1 ? ` · ${num(p.cantidad)}` : ''}`}</T>
                  ))}
                  {f.vendido_vencido ? <Pildora texto="Se vendió vencido" color={MARCA.rojo} /> : null}
                  {f.nota ? <T tenue tam={13}>{f.nota}</T> : null}
                  {f.estado === 'devuelta' && f.devuelta_motivo ? <T tam={13} color={MARCA.rojo}>{f.devuelta_motivo}</T> : null}
                  {f.corregida_por_nombre ? <T tenue tam={13}>{`Corrigió ${shortEmployeeName(f.corregida_por_nombre)}`}</T> : null}
                  {f.confirmada_por_nombre ? <T tenue tam={13}>{`Confirmó ${shortEmployeeName(f.confirmada_por_nombre)}`}</T> : null}
                  {corrige || confirma ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                      {corrige ? <BotonChico texto="Escribir el lote" relleno color={MARCA.azul} onPress={() => setCorrigiendo(f)} /> : null}
                      {confirma ? <BotonChico texto="Devolver" deshabilitado={ocupado === f.id} onPress={() => devolver(f)} /> : null}
                      {confirma ? <BotonChico texto={ocupado === f.id ? 'Confirmando…' : 'Confirmar'} relleno color={MARCA.azul} deshabilitado={ocupado === f.id} onPress={() => confirmar(f)} /> : null}
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </View>
          );
        })}
      </ScrollView>
      {corrigiendo ? (
        <CorregirLote revision={corrigiendo} onCerrar={(guardado) => {
          if (guardado) {
            anotar('BITACORA_LOTE_CORREGIDO', String(corrigiendo.dispensacion_id), { revision_id: corrigiendo.id, folio: corrigiendo.folio_txt });
            listo('Lote guardado', 'Queda para que lo confirme el regente.');
            cargar();
          }
          setCorrigiendo(null);
        }} />
      ) : null}
    </>
  );
}

const PARTE_VACIA = { lote: '', vence: '', cantidad: '' };

// Escribir el lote real de un renglón. Lo escrito se guarda como borrador (por
// revisión): la sesión se cierra sola por inactividad y se perdería.
function CorregirLote({ revision, onCerrar }) {
  const cantidad = Number(revision.cantidad);
  const BORRADOR = `bitacora-lote-${revision.id}`;
  const [inicial] = useState(() => loadDraft(BORRADOR));
  const previas = Array.isArray(revision.partes) && revision.partes.length ? revision.partes : null;
  const [partes, setPartes] = useState(() => inicial?.partes ?? (previas
    ? previas.map((p) => ({ lote: p.lote, vence: p.vence, cantidad: String(p.cantidad) }))
    : [{ ...PARTE_VACIA, cantidad: String(cantidad) }]));
  const [vendidoVencido, setVendidoVencido] = useState(inicial?.vendidoVencido ?? Boolean(revision.vendido_vencido));
  const [nota, setNota] = useState(inicial?.nota ?? (revision.nota || ''));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { saveDraft(BORRADOR, { partes, vendidoVencido, nota }); }, [BORRADOR, partes, vendidoVencido, nota]);

  const cambiar = (k, campo, valor) => setPartes((ps) => ps.map((p, i) => (i === k ? { ...p, [campo]: valor } : p)));
  const suma = partes.reduce((s, p) => s + (Number(p.cantidad) || 0), 0);
  const cuadra = Math.abs(suma - cantidad) < 1e-9;
  const algunaVencida = partes.some((p) => vencidoAlVender(p.vence, revision.fecha));
  const queFalta = queFaltaAlCorregirLote({ partes, cantidad, vendidoVencido, fechaVenta: revision.fecha });
  const motivo = MOTIVO_LOTE[revision.motivo];

  const guardar = async () => {
    setGuardando(true); setError(null);
    const { error: e } = await corregirLoteDelLibro({ revisionId: revision.id, partes, vendidoVencido, nota: nota.trim() || null });
    setGuardando(false);
    if (e) { setError(mensajeAmigable(e)); return; }
    clearDraft(BORRADOR);
    onCerrar(true);
  };

  return (
    <Hoja titulo={revision.producto_nombre} onCerrar={() => onCerrar(false)} ocupado={guardando}
      subtitulo={`${revision.folio_txt} · ${fmt(revision.fecha)} · ${num(cantidad)} ${cantidad === 1 ? 'entregada' : 'entregadas'}`}
      pie={(
        <>
          {queFalta && !guardando ? <Aviso tono="cuidado" texto={queFalta.texto} /> : null}
          <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar el lote'} onPress={guardar} deshabilitado={guardando || !!queFalta} />
        </>
      )}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {motivo ? <Pildora texto={motivo.label} color={motivo.color} /> : null}
        <T tenue tam={13}>{`Dice: ${revision.lote_original || 'sin lote'} · vence ${fmt(revision.vence_original)}`}</T>
      </View>
      {revision.estado === 'devuelta' && revision.devuelta_motivo ? <Aviso tono="freno" texto={`El regente lo devolvió: ${revision.devuelta_motivo}`} /> : null}
      <T tenue tam={14}>Escribe el lote y el vencimiento tal como están impresos en la caja. Si se entregó de dos lotes, agrega una fila por cada uno.</T>

      {partes.map((p, k) => (
        <Seccion key={k} titulo={partes.length > 1 ? `Lote ${k + 1}` : 'Lote'}>
          <Campo multiline={false} value={p.lote} autoCapitalize="characters" placeholder="Como dice la caja"
            onChangeText={(v) => cambiar(k, 'lote', v.toUpperCase())} />
          {p.lote && loteFundido(p.lote) ? <Aviso tono="freno" texto="Un lote por fila" /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Rotulo>{p.vence ? 'Vence' : 'Vence · sin elegir'}</Rotulo>
              <Fecha valor={p.vence || null} onCambiar={(v) => cambiar(k, 'vence', v || '')} />
            </View>
            <View style={{ width: 110, gap: 4 }}>
              <Rotulo>Cantidad</Rotulo>
              <Campo multiline={false} keyboardType="decimal-pad" value={p.cantidad}
                onChangeText={(v) => cambiar(k, 'cantidad', v.replace(',', '.'))} />
            </View>
          </View>
          {partes.length > 1 ? <BotonChico texto="Quitar este lote" color={MARCA.rojo} onPress={() => setPartes((ps) => ps.filter((_, i) => i !== k))} /> : null}
        </Seccion>
      ))}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {partes.length < 5 ? <BotonChico texto="Salió de otro lote" onPress={() => setPartes((ps) => [...ps, { ...PARTE_VACIA }])} /> : <View />}
        <T fuerte tam={14} color={cuadra ? MARCA.verde : MARCA.ambar} style={{ fontVariant: ['tabular-nums'] }}>
          {cuadra ? `Suma ${num(suma)} de ${num(cantidad)}` : `Suman ${num(suma)} y se entregaron ${num(cantidad)}`}
        </T>
      </View>

      {algunaVencida || vendidoVencido ? (
        <Seccion titulo="Vencimiento">
          <Aviso tono="freno" texto={`Ese vencimiento es anterior a la venta (${fmt(revision.fecha)}).`} />
          <T tenue tam={14}>Revisa la fecha. Si de verdad se entregó vencido, márcalo: queda anotado en el libro y le llega al regente.</T>
          <Casilla marcada={vendidoVencido} onCambio={setVendidoVencido} etiqueta="Sí, se entregó vencido">
            <T>Sí, se entregó vencido</T>
          </Casilla>
        </Seccion>
      ) : null}

      <Seccion titulo="Nota (opcional)">
        <Campo value={nota} onChangeText={setNota} placeholder="Por ejemplo: la caja trae dos lotes pegados en la misma etiqueta." />
      </Seccion>
      {error ? <Aviso tono="freno" texto={error} /> : null}
    </Hoja>
  );
}
