// Enviar producto a otra sala, NATIVO — el «Enviar producto» de Traslados en
// el portal (`EnviarProductoModal.jsx`), con las reglas del núcleo:
//
//   · se busca el producto y sale de MI sala (con alcance todas, de la que se
//     elija), del estante de operación o del de vencidos;
//   · la cantidad va en una presentación (`opcionesDePresentacion`) y se
//     reparte entre los lotes, del que vence primero (`repartirPedido`); nunca
//     más de lo que hay;
//   · el motivo depende de la dirección (`motivosEnvioPorDireccion`): a Bodega
//     no se manda «Impulso», desde Bodega no se manda «Baja rotación»; «Avería»
//     pide foto; a Bodega por «Baja rotación», sólo presentaciones completas;
//   · la nota es obligatoria (no puede repetir el motivo);
//   · tope de `TOPE_RENGLONES_ENVIO` renglones (el despacho vive 110 s).
//
// Al transferir se crea el envío y se despacha (`enviarAOtraSala`, que ya
// anota en la bitácora); el ticket de la bolsa sale por la caja de la sala.
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { BRANCH_A_ERP, ERP_BODEGA, ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { buscarInventarioGlobalV2, fetchUnidadDeDespacho } from '@nucleo/data/inventory';
import { fetchPresentaciones } from '@nucleo/data/inventoryMovements';
import { MAX_FOTOS_ENVIO, TOPE_RENGLONES_ENVIO, enviarAOtraSala, envioNecesitaFoto, motivosEnvioPorDireccion } from '@nucleo/data/envios';
import { BUCKET_EVIDENCIA } from '@nucleo/data/evidencia';
import { lotesEnUnidades, repartirPedido, sumaUnidades } from '@nucleo/utils/unidadesInventario';
import { opcionesDePresentacion } from '@nucleo/utils/presentacion';
import { nombreDeDespacho, renglonCompleto } from '@nucleo/utils/unidadDeDespacho';
import { fmtVence } from '@nucleo/utils/pedirTraslado';
import { construirTicketDeTraslado } from '@nucleo/utils/trasladoTicket';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import Fotos, { subirFotos } from '../componentes/formulario/Fotos';
import { MenuDeFiltros } from '../componentes/Filtros';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { imprimirEnLaSala } from '../componentes/imprimir';

const estante = (erp, vencidos) => `${ERP_NAMES[erp] ?? erp}${vencidos ? ' · vencidos' : ''}`;

export default function EnviarProducto() {
  const { user, getScope } = useAuth();
  const todas = getScope?.('traslados') === 'ALL';
  const miSala = salaDelUsuario(user);
  const miErp = BRANCH_A_ERP[Number(miSala)] ?? null;
  const clave = `envio_app_${miSala ?? 'todas'}`;

  const [origenErp, setOrigenErp] = useState(miErp ?? ERP_ORDEN[0]);
  const [vencidos, setVencidos] = useState(false);
  const [destino, setDestino] = useState(null);
  const [texto, setTexto, aplicado] = useBusqueda();
  const [resultados, setResultados] = useState([]);
  const [producto, setProducto] = useState(null);     // { erp_product_id, descripcion, filas }
  const [presentaciones, setPresentaciones] = useState([]);
  const [presIdx, setPresIdx] = useState('0');
  const [cantidad, setCantidad] = useState('1');
  const [renglones, setRenglones] = useState([]);
  const [motivo, setMotivo] = useState(null);
  const [nota, setNota] = useState('');
  const [fotos, setFotos] = useState([]);
  const [despacho, setDespacho] = useState(new Map());
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const b = loadDraft(clave);
    if (b?.renglones?.length) { setRenglones(b.renglones); setDestino(b.destino ?? null); setMotivo(b.motivo ?? null); setNota(b.nota ?? ''); }
  }, [clave]);
  useEffect(() => { saveDraft(clave, { renglones, destino, motivo, nota }); }, [clave, renglones, destino, motivo, nota]);

  // Buscar en el estante de origen.
  useEffect(() => {
    if (producto || aplicado.trim().length < 3) { setResultados([]); return undefined; }
    let vivo = true;
    buscarInventarioGlobalV2(aplicado.trim()).then((r) => {
      if (!vivo) return;
      const m = new Map();
      for (const f of r.filas || []) {
        if (Number(f.erp_sucursal_id) !== Number(origenErp) || Boolean(f.is_vencidos) !== vencidos) continue;
        const k = String(f.erp_product_id);
        if (!m.has(k)) m.set(k, { erp_product_id: f.erp_product_id, descripcion: f.descripcion, filas: [] });
        m.get(k).filas.push(f);
      }
      setResultados([...m.values()].map((p) => ({ ...p, unidades: sumaUnidades(p.filas) })).filter((p) => p.unidades > 0).slice(0, 25));
    });
    return () => { vivo = false; };
  }, [aplicado, producto, origenErp, vencidos]);

  useEffect(() => {
    if (!producto) { setPresentaciones([]); return undefined; }
    let vivo = true;
    fetchPresentaciones([producto.erp_product_id]).then(({ porProducto }) => {
      if (vivo) { setPresentaciones(porProducto.get(Number(producto.erp_product_id)) ?? []); setPresIdx('0'); }
    });
    return () => { vivo = false; };
  }, [producto]);

  const lotes = useMemo(() => (producto ? lotesEnUnidades(producto.filas) : []), [producto]);
  const hay = producto ? sumaUnidades(producto.filas) : 0;
  const yaEnLista = renglones.filter((r) => r.erp_product_id === producto?.erp_product_id).reduce((s, r) => s + r.unidades, 0);
  const pres = presentaciones[Number(presIdx)] ?? null;
  const unidades = (Number(cantidad) || 0) * (Number(pres?.factor) || 0);
  const reparto = useMemo(() => (unidades > 0 ? repartirPedido(lotes, unidades + yaEnLista) : { reparto: [], faltan: 0 }), [lotes, unidades, yaEnLista]);
  const problema = !producto ? null
    : renglones.length >= TOPE_RENGLONES_ENVIO ? `Un envío lleva hasta ${TOPE_RENGLONES_ENVIO} productos: manda éste en otro.`
      : !pres ? 'Cargando las presentaciones…'
        : unidades <= 0 ? 'Indica cuántas.'
          : unidades + yaEnLista > hay ? `En ${estante(origenErp, vencidos)} hay ${hay} unidades${yaEnLista ? ` (ya pusiste ${yaEnLista})` : ''}.`
            : reparto.faltan > 0 ? 'Los lotes no alcanzan.' : null;

  const agregar = () => {
    // El reparto de ESTE renglón: lo que toma por encima de lo que ya se llevó.
    const previo = repartirPedido(lotes, yaEnLista).reparto;
    const total = repartirPedido(lotes, yaEnLista + unidades).reparto;
    const propio = total.map((l) => ({ lote: l.lote, vence: l.vence, unidades: l.toma - (previo.find((p) => p.clave === l.clave)?.toma ?? 0) })).filter((l) => l.unidades > 0);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setRenglones((rs) => [...rs, {
      erp_product_id: producto.erp_product_id, descripcion: producto.descripcion,
      presentacion_tipo: pres.tipo, factor: Number(pres.factor), cantidad: Number(cantidad), unidades, lotes: propio,
    }]);
    setProducto(null); setTexto(''); setCantidad('1');
  };

  const origenEsBodega = Number(origenErp) === ERP_BODEGA;
  const destinoEsBodega = Number(destino) === ERP_BODEGA;
  const motivos = destino != null ? motivosEnvioPorDireccion(origenEsBodega, destinoEsBodega) : [];
  useEffect(() => { if (motivo && !motivos.includes(motivo)) setMotivo(null); }, [motivos, motivo]);

  const freno = destinoEsBodega && motivo === 'Baja rotación';
  const ids = useMemo(() => [...new Set(renglones.map((r) => Number(r.erp_product_id)))].sort().join(','), [renglones]);
  useEffect(() => {
    if (!freno || !ids) return undefined;
    let vivo = true;
    fetchUnidadDeDespacho(ids.split(',').map(Number)).then((m) => { if (vivo) setDespacho(m); }).catch(() => {});
    return () => { vivo = false; };
  }, [freno, ids]);
  const sueltos = freno ? renglones.filter((r) => despacho.has(Number(r.erp_product_id)) && !renglonCompleto(r, despacho.get(Number(r.erp_product_id)))) : [];

  const falta = !renglones.length ? 'Agrega al menos un producto.'
    : destino == null ? 'Elige a qué sala va.'
      : !motivo ? 'Elige el motivo.'
        : envioNecesitaFoto(motivo) && !fotos.length ? `«${motivo}» lleva foto.`
          : nota.trim().length < 4 || nota.trim() === motivo ? 'Escribe una nota que explique el envío.'
            : sueltos.length ? `A Bodega por baja rotación van presentaciones completas: ${sueltos.map((r) => `${r.descripcion} (${nombreDeDespacho(despacho.get(Number(r.erp_product_id)))})`).join(', ')}.`
              : null;

  const transferir = async () => {
    setEnviando(true); trabajando('Enviando el producto…');
    try {
      const evidencia = fotos.length ? await subirFotos(fotos, { bucket: BUCKET_EVIDENCIA, carpeta: `envios/${miSala ?? 'sin-sala'}/${user?.id ?? 'anon'}` }) : [];
      const fila = {
        employee_id: user?.id, type: 'INVENTORY_TRANSFER_PUSH', status: 'PENDING', note: nota.trim() || motivo,
        metadata: {
          motivo_tipo: motivo, reason: nota.trim() || motivo,
          ...(evidencia.length ? { evidencia_urls: evidencia } : {}),
          origen_erp_sucursal_id: Number(origenErp),
          ...(vencidos ? { origen_vencidos: true } : {}),
          origen_branch_name: ERP_NAMES[origenErp] ?? '',
          erp_sucursal_id: Number(destino), branch_name: ERP_NAMES[destino] ?? '',
          items: renglones.map((r) => ({ erp_product_id: r.erp_product_id, descripcion: r.descripcion, presentacion_tipo: r.presentacion_tipo, factor: r.factor, cantidad: r.cantidad, lotes: r.lotes })),
        },
      };
      const salaOrigen = Object.keys(BRANCH_A_ERP).find((b) => BRANCH_A_ERP[b] === Number(origenErp)) ?? miSala;
      let ticket = null;
      const { error, salidas } = await enviarAOtraSala([fila], {
        salaId: salaOrigen, sala: ERP_NAMES[origenErp], desde: 'app', productos: renglones.length,
        unidades: renglones.reduce((s, r) => s + r.unidades, 0), motivo, fotos: evidencia.length,
        alDespachar: (creado, r) => {
          if ((r?.enviadas ?? 0) > 0) {
            ticket = imprimirEnLaSala(construirTicketDeTraslado({
              familia: 'envio', codigo: creado?.metadata?.codigo_bolsa ?? '',
              aplicado: { by_name: user?.name ?? null, at: new Date().toISOString(), por_respaldo: false },
              origen: estante(origenErp, vencidos), destino: ERP_NAMES[destino] ?? '', pide: '',
              items: (r.hechas ?? []).map((h) => ({ nombre: h?.producto, cantidad: h?.cantidad })),
              motivo: [motivo, nota.trim() && nota.trim() !== motivo ? nota.trim() : null].filter(Boolean).join(' — '),
            }), salaOrigen, ['ENVIO', creado?.metadata?.codigo_bolsa, ERP_NAMES[destino]].filter(Boolean).join(' '));
          }
        },
      });
      if (error) throw error;
      const s = salidas[0] ?? {};
      const enviadas = s.enviadas ?? 0;
      const fallos = (s.fallos ?? []).length;
      const papel = ticket ? await ticket : null;
      clearDraft(clave);
      if (!enviadas) fallo('No salió nada', s.error ?? 'El envío quedó creado pero no se despachó. Reintenta desde Envíos.');
      else if (fallos) fallo('Salió una parte', `${enviadas} renglón(es) salieron y ${fallos} no. Revisa el envío en Traslados → Envíos.`);
      else if (papel && !papel.ok) fallo('Producto en camino, pero el ticket no salió', papel.detalle);
      else listo('Producto en camino', `A ${ERP_NAMES[destino]} · pega el ticket en la bolsa`);
      router.back();
    } catch (e) {
      fallo('No se pudo enviar', e?.message);
    } finally {
      setEnviando(false);
    }
  };

  const destinos = ERP_ORDEN.filter((e) => e !== Number(origenErp)).map((e) => ({ id: String(e), label: ERP_NAMES[e] }));
  const grupos = todas ? [{ id: 'origen', titulo: 'Sale de', activa: `${origenErp}${vencidos ? ':V' : ''}`, porDefecto: `${miErp ?? ERP_ORDEN[0]}`,
    onCambiar: (v) => { const [e, f] = String(v).split(':'); setOrigenErp(Number(e)); setVencidos(f === 'V'); setRenglones([]); setProducto(null); },
    opciones: ERP_ORDEN.flatMap((e) => [{ id: `${e}`, label: ERP_NAMES[e] }, { id: `${e}:V`, label: `${ERP_NAMES[e]} · vencidos` }]) }] : [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Enviar producto' }} />
      <MenuDeFiltros grupos={grupos} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {!todas && miErp == null ? <Aviso tono="freno" texto="Tu usuario no tiene una sala desde la cual enviar." /> : null}
          <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>{`Sale de ${estante(origenErp, vencidos)}`}</Text>

          <Seccion titulo={`Productos · ${renglones.length} de ${TOPE_RENGLONES_ENVIO}`}>
            {renglones.map((r, i) => (
              <View key={`${r.erp_product_id}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{r.descripcion}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${r.cantidad} ${r.presentacion_tipo} · ${r.unidades} u.`}</Text>
                </View>
                <Pressable hitSlop={8} onPress={() => setRenglones((rs) => rs.filter((_, j) => j !== i))} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text style={{ color: MARCA.rojo, fontSize: 15 }}>Quitar</Text>
                </Pressable>
              </View>
            ))}
            {!producto ? (
              <>
                <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Buscar un producto para agregar" autoCorrect={false} />
                {resultados.map((p) => (
                  <Pressable key={p.erp_product_id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setProducto(p); }}
                    style={({ pressed }) => ({ flexDirection: 'row', gap: 10, paddingVertical: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{p.descripcion}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 15, fontVariant: ['tabular-nums'] }}>{p.unidades}</Text>
                  </Pressable>
                ))}
              </>
            ) : (
              <View style={{ gap: 10 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{producto.descripcion}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Hay ${hay} unidades en ${estante(origenErp, vencidos)}`}</Text>
                <Opciones opciones={opcionesDePresentacion(presentaciones, hay).map((o) => ({ id: o.value, label: o.label, detalle: o.disabled ? 'No alcanza para una' : null }))}
                  valor={presIdx} onCambiar={setPresIdx} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Cantidad</Text>
                  <View style={{ width: 110 }}><Campo multiline={false} value={cantidad} onChangeText={(t) => setCantidad(t.replace(/\D/g, ''))} keyboardType="number-pad" style={{ textAlign: 'center' }} /></View>
                </View>
                {reparto.reparto.length > 0 && !problema ? (
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {repartirPedido(lotes, yaEnLista + unidades).reparto.map((l) => `${l.lote ? `Lote ${l.lote}` : 'Sin lote'}${l.vence ? ` (vence ${fmtVence(l.vence)})` : ''}: ${l.toma}`).join(' · ')}
                  </Text>
                ) : null}
                {problema ? <Aviso tono="cuidado" texto={problema} /> : null}
                <BotonGrande texto="Agregar al envío" color={MARCA.azul} deshabilitado={!!problema} onPress={agregar} />
                <BotonGrande texto="Otro producto" borde onPress={() => setProducto(null)} />
              </View>
            )}
          </Seccion>

          {renglones.length ? (
            <>
              <Seccion titulo="Va a">
                <Opciones opciones={destinos} valor={destino != null ? String(destino) : null} onCambiar={(v) => setDestino(Number(v))} />
              </Seccion>
              {destino != null ? (
                <Seccion titulo="Motivo">
                  <Opciones opciones={motivos} valor={motivo} onCambiar={setMotivo} />
                  {motivo && envioNecesitaFoto(motivo) ? <Fotos fotos={fotos} onCambiar={setFotos} max={MAX_FOTOS_ENVIO} /> : null}
                  <Campo value={nota} onChangeText={setNota} placeholder="Nota: por qué se manda" />
                </Seccion>
              ) : null}
              {falta ? <Aviso tono="cuidado" texto={falta} /> : null}
              <BotonGrande texto={enviando ? 'Enviando…' : 'Transferir'} color={MARCA.verde} deshabilitado={enviando || !!falta} onPress={transferir} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
