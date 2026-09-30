// Nueva solicitud — Ajuste de inventario, NATIVO. Hace lo que el portal hace en
// `WidgetInventoryMovement.jsx`, con las reglas del núcleo
// (`utils/ajusteInventario`) y sus mismas lecturas (`data/inventoryMovements`):
//
//   1. Qué se hace: vencimiento, descarte, daño, consumo interno o carga.
//   2. Qué productos: se buscan (al descargar, sólo los que la sala tiene), se
//      elige presentación, cantidad y lote —al descargar, de los lotes que hay;
//      al cargar, se escribe con su vencimiento— y se agregan a la lista.
//      `problemasDeLinea` decide qué le falta a cada renglón.
//   3. Por qué: motivo de la lista (descarte y consumo interno), la causa por
//      escrito cuando no hay lista o es «Otro», y fotos si es producto dañado.
//
// Si la sala está contando inventario, no se puede ajustar (lo frena también
// la base). A Supervisión le avisa la base. Guarda borrador: la sesión se
// cierra sola y un ajuste de veinte renglones no se puede perder.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { buscarConExistencia, buscarEnCatalogo, fetchLotesDeProducto, fetchPerecederos, fetchPresentaciones, fetchSucursalEnConteo, insertMovimientoInventario } from '@nucleo/data/inventoryMovements';
import { BUCKET_EVIDENCIA, causaObligatoria, llevaControlDeLote, MAX_FOTOS_AJUSTE, MOTIVOS_AJUSTE, OPERACIONES_AJUSTE, OPS_CON_FOTO, problemasDeLinea, solicitudDeAjuste } from '@nucleo/utils/ajusteInventario';
import { supervisorQueResuelve } from '@nucleo/utils/aprobadorOperativo';
import { BRANCH_A_ERP, ERP_ORDEN, ERP_UBICACION_POR_SUCURSAL } from '@nucleo/constants/erp';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { fechaNumerica, hoySV } from '@nucleo/utils/fecha';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import Fotos, { subirFotos } from '../../componentes/formulario/Fotos';
import { MenuDeFiltros } from '../../componentes/Filtros';
import { Chip } from '../../componentes/inicio/Widget';
import Vidrio from '../../componentes/Vidrio';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

const TONO = { peligro: MARCA.rojo, aviso: MARCA.ambar, dano: '#E0457B', interno: MARCA.violeta, exito: MARCA.verde };
const FALTA = { cantidad: 'la cantidad', 'sin existencia': 'no alcanza la existencia', lote: 'el lote', vence: 'el vencimiento' };
let contador = 0;

function Pastilla({ texto, activa, onPress }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}>
      <View style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: activa ? MARCA.azulClaro : 'rgba(127,127,127,0.2)' }}>
        <Text style={{ color: activa ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{texto}</Text>
      </View>
    </Pressable>
  );
}

export default function Ajuste() {
  const { user, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const todas = getScope?.('dash_inv_movement') === 'ALL';
  const propia = String(salaDelUsuario(user) ?? '');
  const salasErp = useMemo(() => ERP_ORDEN.map((erp) => Object.entries(BRANCH_A_ERP).find(([, e]) => e === erp)?.[0]).filter(Boolean), []);
  const [salaElegida, setSala] = useState(BRANCH_A_ERP[propia] != null ? propia : salasErp[0]);
  const branchId = todas ? salaElegida : propia;
  const erpSucursalId = BRANCH_A_ERP[branchId] ?? null;
  const erpUbicacionId = erpSucursalId != null ? ERP_UBICACION_POR_SUCURSAL[erpSucursalId] : null;
  const nombreSala = (sucursales || []).find((b) => String(b.id) === String(branchId))?.name ?? '';
  const claveBorrador = `ajuste_inv_${erpSucursalId}`;

  const [opKey, setOpKey] = useState(null);
  const [lineas, setLineas] = useState([]);
  const [motivo, setMotivo] = useState(null);
  const [causa, setCausa] = useState('');
  const [fotos, setFotos] = useState([]);
  const [enConteo, setEnConteo] = useState(null);
  const [texto, setTexto, aplicado] = useBusqueda();
  const [candidatos, setCandidatos] = useState([]);
  const [presPorProducto, setPres] = useState(new Map());
  const [perecederos, setPerecederos] = useState(new Set());
  const [lotesPorProducto, setLotes] = useState(new Map());
  const [borrador, setBorrador] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const op = OPERACIONES_AJUSTE.find((o) => o.key === opKey);
  const esCarga = op?.movimiento === 'CARGA';
  const motivos = opKey ? MOTIVOS_AJUSTE[opKey] : null;
  const pideFoto = OPS_CON_FOTO.includes(opKey);

  // El borrador de la sala: al volver, se sigue donde se dejó.
  useEffect(() => {
    const b = loadDraft(claveBorrador);
    if (b?.opKey) { setOpKey(b.opKey); setLineas(b.lineas || []); setCausa(b.causa || ''); setMotivo(b.motivo || null); }
  }, [claveBorrador]);
  useEffect(() => {
    if (!opKey) return undefined;
    const t = setTimeout(() => saveDraft(claveBorrador, { opKey, lineas, causa, motivo }), 800);
    return () => clearTimeout(t);
  }, [claveBorrador, opKey, lineas, causa, motivo]);

  useEffect(() => { fetchSucursalEnConteo(branchId).then(setEnConteo); }, [branchId]);

  useEffect(() => {
    const q = aplicado.trim();
    if (!op || q.length < 2) { setCandidatos([]); return undefined; }
    let vivo = true;
    (esCarga ? buscarEnCatalogo : buscarConExistencia)({ erpSucursalId, texto: q }).then((r) => {
      if (!vivo) return;
      const vistos = new Set();
      setCandidatos((r.filas ?? []).filter((f) => (vistos.has(f.erp_product_id) ? false : vistos.add(f.erp_product_id))));
    });
    return () => { vivo = false; };
  }, [aplicado, op, esCarga, erpSucursalId]);

  useEffect(() => {
    const ids = candidatos.map((f) => f.erp_product_id);
    if (!ids.length) return;
    Promise.all([fetchPresentaciones(ids), fetchPerecederos(ids)]).then(([p, per]) => {
      if (!p.error) setPres(p.porProducto);
      if (!per.error) setPerecederos(per.perecederos);
    });
  }, [candidatos]);

  const abrirBorrador = useCallback(async (fila) => {
    const pres = presPorProducto.get(fila.erp_product_id) ?? [];
    const unidad = pres.find((p) => p.factor === 1) ?? pres[0];
    setBorrador({ erp_product_id: fila.erp_product_id, descripcion: fila.descripcion, tipo: unidad?.tipo ?? 'UNIDAD', factor: unidad?.factor ?? 1,
      cantidad: '', existencia: fila.cantidad ?? null, lote: '', vence: '', regulado: fila.regulado ?? null });
    if (!lotesPorProducto.has(fila.erp_product_id)) {
      const { lotes } = await fetchLotesDeProducto({ erpProductId: fila.erp_product_id, erpSucursalId });
      setLotes((m) => new Map(m).set(fila.erp_product_id, lotes));
    }
  }, [presPorProducto, lotesPorProducto, erpSucursalId]);

  const lotesBorrador = borrador ? lotesPorProducto.get(borrador.erp_product_id) : null;
  const faltaBorrador = !borrador || lotesBorrador === undefined ? ['cargando'] : problemasDeLinea(borrador, {
    llevaLote: llevaControlDeLote(borrador, { esCarga, lotes: lotesBorrador }), esCarga, esPerecedero: perecederos.has(borrador.erp_product_id),
  });
  const loteRepetido = !!borrador && lineas.some((l) => l.erp_product_id === borrador.erp_product_id && String(l.lote).trim() === String(borrador.lote).trim());

  const agregar = () => {
    if (faltaBorrador.length || loteRepetido) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setLineas((l) => [...l, { id: `l${++contador}`, ...borrador }]);
    setBorrador(null); setTexto('');
  };

  const puedeEnviar = lineas.length > 0 && (!motivos || !!motivo) && (!causaObligatoria(opKey, motivo) || causa.trim())
    && (!pideFoto || fotos.length > 0) && erpSucursalId != null && erpUbicacionId != null;

  const enviar = async () => {
    setEnviando(true); trabajando(fotos.length ? 'Subiendo las fotos…' : 'Enviando la solicitud…');
    try {
      const evidencia = fotos.length ? await subirFotos(fotos, { bucket: BUCKET_EVIDENCIA, carpeta: `${branchId ?? 'sin-sala'}/${user?.id ?? 'anon'}` }) : [];
      const aprobador = supervisorQueResuelve(empleados || []);
      const { error } = await insertMovimientoInventario(solicitudDeAjuste({
        op, motivo, causa, evidencia, lineas, usuarioId: user?.id, aprobador,
        sala: { branchId, nombre: nombreSala, erpSucursalId, erpUbicacionId },
      }), { lineas: lineas.length, fotos: evidencia.length });
      if (error) throw error;
      clearDraft(claveBorrador);
      listo('Solicitud enviada', `La revisa ${aprobador ? shortEmployeeName(aprobador) : 'Supervisión'}. El inventario se mueve al aprobarla.`);
      router.dismissTo('/solicitudes');
    } catch (e) {
      fallo('No se pudo enviar', String(e?.message ?? '').includes('row-level security') ? 'No tienes permiso para crear solicitudes de inventario.' : (e?.message || 'Inténtalo de nuevo.'));
    } finally {
      setEnviando(false);
    }
  };

  const grupos = todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: salaElegida, onCambiar: (v) => { setSala(v); setLineas([]); },
    opciones: salasErp.map((id) => ({ id: String(id), label: (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? `Sala ${id}` })) }] : [];

  // ── Paso 1 ──
  if (!op) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ajuste de inventario', headerLargeTitle: true }} />
        {todas ? <MenuDeFiltros grupos={grupos} /> : null}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
          <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>{nombreSala} · ¿qué vas a hacer?</Text>
          {enConteo?.en_conteo ? <Aviso tono="freno" texto={`Hay un conteo de inventario abierto en ${enConteo.sala ?? 'la sala'}. Mientras se cuenta no se puede cargar ni descargar producto.`} /> : null}
          {OPERACIONES_AJUSTE.map((o) => (
            <Pressable key={o.key} disabled={!!enConteo?.en_conteo} onPress={() => { Haptics.selectionAsync().catch(() => {}); setOpKey(o.key); }}
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }], opacity: enConteo?.en_conteo ? 0.4 : 1 })}>
              <Vidrio radio={18} interactivo>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 }}>
                  <Chip icono={o.icono} color={TONO[o.tono]} tamano={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{o.label}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{o.desc}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text>
                </View>
              </Vidrio>
            </Pressable>
          ))}
        </ScrollView>
      </>
    );
  }

  // ── Pasos 2 y 3 ──
  const pres = borrador ? (presPorProducto.get(borrador.erp_product_id) ?? []) : [];
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: op.label }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          <Pressable onPress={() => { setOpKey(null); setLineas([]); setMotivo(null); clearDraft(claveBorrador); }}>
            <Text style={{ color: colorSistema.acento, fontSize: 15, marginHorizontal: 4 }}>‹ Cambiar lo que vas a hacer</Text>
          </Pressable>

          {/* Lo que va */}
          {lineas.length ? (
            <Seccion titulo={`Lo que va · ${lineas.length}`}>
              {lineas.map((l, i) => (
                <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{l.descripcion}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{l.cantidad} {l.tipo}{l.lote ? ` · lote ${l.lote}` : ''}{l.vence ? ` · vence ${fechaNumerica(l.vence, { anio: 'corto' })}` : ''}</Text>
                  </View>
                  <Pressable onPress={() => setLineas((x) => x.filter((y) => y.id !== l.id))} hitSlop={8}>
                    <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Quitar</Text>
                  </Pressable>
                </View>
              ))}
            </Seccion>
          ) : null}

          {/* Agregar un producto */}
          {!borrador ? (
            <Seccion titulo={lineas.length ? 'Agregar otro producto' : 'Producto'}>
              <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder={esCarga ? 'Busca en el catálogo' : 'Busca en lo que tiene la sala'} autoCorrect={false} />
              {candidatos.slice(0, 12).map((f) => (
                <Pressable key={f.erp_product_id} onPress={() => abrirBorrador(f)}
                  style={({ pressed }) => ({ flexDirection: 'row', gap: 10, paddingTop: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }} numberOfLines={2}>{f.descripcion}</Text>
                  {f.cantidad != null ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{f.cantidad} en sala</Text> : null}
                </Pressable>
              ))}
            </Seccion>
          ) : (
            <Seccion titulo="Producto">
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{borrador.descripcion}</Text>
              {borrador.existencia != null ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{borrador.existencia} en la sala</Text> : null}
              {pres.length > 1 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {pres.map((p) => <Pastilla key={p.tipo} texto={p.tipo} activa={borrador.tipo === p.tipo} onPress={() => setBorrador((b) => ({ ...b, tipo: p.tipo, factor: p.factor }))} />)}
                </View>
              ) : null}
              <Campo multiline={false} value={String(borrador.cantidad)} onChangeText={(t) => setBorrador((b) => ({ ...b, cantidad: t.replace(/\D/g, '') }))}
                placeholder={`Cantidad (${borrador.tipo})`} keyboardType="number-pad" />
              {!esCarga && (lotesBorrador || []).length ? (
                <View style={{ gap: 6 }}>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Lote</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {lotesBorrador.map((lt) => (
                      <Pastilla key={`${lt.lote}|${lt.vence}`} texto={`${lt.lote}${lt.vence ? ` · ${fechaNumerica(lt.vence, { anio: 'corto' })}` : ''}`}
                        activa={borrador.lote === lt.lote && borrador.vence === (lt.vence ?? '')} onPress={() => setBorrador((b) => ({ ...b, lote: lt.lote, vence: lt.vence ?? '' }))} />
                    ))}
                  </View>
                </View>
              ) : null}
              {esCarga ? (
                <>
                  <Campo multiline={false} value={borrador.lote} onChangeText={(t) => setBorrador((b) => ({ ...b, lote: t.toUpperCase() }))} placeholder="Lote" autoCapitalize="characters" />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 15 }}>Vence</Text>
                    <Fecha valor={borrador.vence || null} desde={hoySV()} onCambiar={(v) => setBorrador((b) => ({ ...b, vence: v }))} />
                  </View>
                </>
              ) : null}
              {faltaBorrador.length && faltaBorrador[0] !== 'cargando' && borrador.cantidad ? (
                <Aviso tono="cuidado" texto={`Falta: ${faltaBorrador.map((f) => FALTA[f] ?? f).join(', ')}.`} />
              ) : null}
              {loteRepetido ? <Aviso tono="cuidado" texto="Ese producto con ese lote ya está en la lista." /> : null}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><BotonGrande texto="Cancelar" color={colorSistema.texto2} borde onPress={() => setBorrador(null)} /></View>
                <View style={{ flex: 1 }}><BotonGrande texto="Agregar" color={MARCA.verde} deshabilitado={!!faltaBorrador.length || loteRepetido} onPress={agregar} /></View>
              </View>
            </Seccion>
          )}

          {/* Por qué */}
          {motivos ? <Seccion titulo="Motivo"><Opciones opciones={motivos.map((m) => ({ id: m.value, label: m.label }))} valor={motivo} onCambiar={setMotivo} /></Seccion> : null}
          <Seccion titulo={causaObligatoria(opKey, motivo) ? 'Qué pasó (obligatorio)' : 'Qué pasó (opcional)'}>
            <Campo value={causa} onChangeText={setCausa} placeholder="Cuéntale a Supervisión qué pasó" />
          </Seccion>
          {pideFoto ? <Seccion titulo="Fotos del producto dañado (obligatorio)"><Fotos fotos={fotos} onCambiar={setFotos} max={MAX_FOTOS_AJUSTE} /></Seccion> : null}

          <BotonGrande texto={`Enviar solicitud${lineas.length ? ` · ${lineas.length}` : ''}`} color={esCarga ? MARCA.verde : MARCA.rojo}
            deshabilitado={enviando || !puedeEnviar || !!enConteo?.en_conteo} onPress={enviar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
