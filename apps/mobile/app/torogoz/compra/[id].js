// Torogoz · una compra a proveedor, NATIVA — el `CompraModal` del portal, de
// la captura a la bodega. `id = nueva` abre una vacía.
//
// Se escriben los MONTOS DEL PAPEL (o se leen del JSON del documento del
// proveedor, que acá se PEGA) y los renglones por separado, y la pantalla dice
// en vivo si cuadran —lo mismo que va a exigir la base al recibir—. Sin
// cuadrar, no entra. «Guardar borrador» deja la captura en Borradores (y una
// compra nueva guarda borrador local mientras se escribe: la sesión se cierra
// sola). «Recibir en bodega» mueve inventario y costo promedio, y no se
// deshace: se anula, sólo mientras todo lo que entró siga en bodega.
//
// Todas las cuentas y la forma de lo que se guarda salen del núcleo
// (`distribucionCompras`, `distribucionComercial`), las mismas del portal.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useAuth } from '@nucleo/context/AuthContext';
import useBorrador from '@nucleo/hooks/useBorrador';
import { fetchCatalogo, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import {
  anularCompra, fetchCompra, fetchMemoriaProveedor, fetchProveedores, fetchReferenciasRelacionada, guardarCompra, recibirCompra,
} from '@nucleo/data/distribucionCompras';
import { anotar } from '@nucleo/data/audit';
import {
  TIPOS_COMPRA, evaluarPrecioRelacionada, leerDteDelProveedor, problemasDeCompra, toleranciaDeCuadre, totalEsperado, totalesCalculados,
} from '@nucleo/utils/distribucionCompras';
import {
  compraConLectura, compraConMontosCalculados, compraDesdeDetalle, compraVacia, costoSinIvaDeRenglon, payloadDeCompra, renglonDeCompraVacio,
} from '@nucleo/utils/distribucionComercial';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema, Formulario } from '../../../componentes/Formulario';
import { BotonGrande, Campo, Opciones, Seccion } from '../../../componentes/formulario/Piezas';
import { CampoConRotulo } from '../../../componentes/personas/Formulario';
import { Pildora } from '../../../componentes/avisos/Piezas';
import Fecha from '../../../componentes/formulario/Fecha';
import ConAurora from '../../../componentes/ConAurora';
import { MARCA } from '../../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../../componentes/Progreso';
import { volver } from '../../../componentes/volver';
import { ElegirLargo, Nota, PETROLEO, useEmisor } from '../../../componentes/torogoz/comercial/Piezas';
import RenglonDeCompra from '../../../componentes/torogoz/comercial/RenglonDeCompra';
import FormularioProveedor from '../../../componentes/torogoz/comercial/FormularioProveedor';

const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

/** Un monto del papel; si se sabe cuánto DEBERÍA ser y no lo es, lo dice. */
function CampoMonto({ rotulo, valor, onCambiar, esperado, editable }) {
  const ok = esperado === undefined || valor === '' || Math.abs(num(valor) - esperado) <= 0.01;
  return (
    <View style={{ flex: 1, minWidth: 130 }}>
      <CampoConRotulo rotulo={rotulo} value={valor} editable={editable} keyboardType="decimal-pad" onChangeText={onCambiar}
        error={!ok ? `Debería ser ${formatMoney(esperado)}` : undefined} />
    </View>
  );
}

/** Una hoja del sistema con su título y «Cerrar». */
function Hoja({ titulo, onCerrar, children }) {
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <Formulario contentContainerStyle={{ paddingHorizontal: 16, gap: 16, paddingBottom: 60 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{titulo}</Text>
            <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text>
            </Pressable>
          </View>
          {children}
        </Formulario>
      </ConAurora>
    </Modal>
  );
}

export default function CompraTorogoz() {
  const { id } = useLocalSearchParams();
  const nueva = id === 'nueva';
  const { hasPermission } = useAuth();
  const puedeEditar = !!hasPermission?.('distribucion_config', 'can_edit');
  const { emisor } = useEmisor();
  const [c, setC] = useState(() => (nueva ? compraVacia(hoySV()) : null));
  const [estado, setEstado] = useState(nueva ? 'borrador' : null);
  const [detalle, setDetalle] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [jsonCrudo, setJsonCrudo] = useState(null);
  const [emisorDelJson, setEmisorDelJson] = useState(null);
  const [pegando, setPegando] = useState(false);
  const [textoJson, setTextoJson] = useState('');
  const [altaProveedor, setAltaProveedor] = useState(null);
  const [ocupado, setOcupado] = useState('');
  const [error, setError] = useState('');
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const editable = puedeEditar && estado === 'borrador';

  const cargarProveedores = useCallback(async () => {
    const p = await fetchProveedores();
    setProveedores(p);
    return p;
  }, []);
  useEffect(() => {
    cargarProveedores().catch((e) => setError(mensajeDeDistribucion(e)));
    let vivo = true;
    fetchCatalogo().then((r) => { if (vivo) setCatalogo(r.filter((p) => p.activo)); }).catch(() => {});
    return () => { vivo = false; };
  }, [cargarProveedores]);

  useEffect(() => {
    if (nueva) return undefined;
    let vivo = true;
    fetchCompra(id).then((d) => {
      if (!vivo) return;
      setDetalle(d); setEstado(d.estado); setC(compraDesdeDetalle(d));
    }).catch((e) => { if (vivo) setError(mensajeDeDistribucion(e)); });
    return () => { vivo = false; };
  }, [id, nueva]);

  // Una compra nueva se guarda sola mientras se captura.
  const { recuperado, descartar } = useBorrador(nueva && emisor?.id ? `distribucion-compra-nueva-${emisor.id}` : null, c,
    { vale: (v) => !!(v?.numero || v?.items?.length) });
  const repuesto = useRef(false);
  useEffect(() => {
    if (repuesto.current || !recuperado || !nueva) return;
    repuesto.current = true;
    setC({ ...compraVacia(hoySV()), ...recuperado });
  }, [recuperado, nueva]);

  const proveedor = proveedores.find((p) => String(p.id) === String(c?.proveedor_id ?? ''));
  const set = (k) => (v) => setC((x) => ({ ...x, [k]: v }));
  const setItem = (i, cambios, reemplaza = false) => setC((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? (reemplaza ? cambios : { ...it, ...cambios }) : it)) }));

  // Al crédito, el vencimiento sale del plazo del proveedor si nadie lo escribió.
  useEffect(() => {
    if (!editable || !c || Number(c.condicion) !== 2 || c.vence || !proveedor?.plazo_dias || !c.fecha) return;
    setC((x) => ({ ...x, vence: sumarDias(x.fecha, proveedor.plazo_dias) }));
  }, [editable, c?.condicion, c?.fecha, proveedor?.plazo_dias]); // eslint-disable-line react-hooks/exhaustive-deps

  const opcionesProducto = useMemo(() => catalogo.map((p) => ({ id: String(p.product_id), label: p.nombre })), [catalogo]);
  const opcionesProveedor = useMemo(() => proveedores.filter((p) => p.activo || String(p.id) === String(c?.proveedor_id))
    .map((p) => ({ id: String(p.id), label: p.nombre, detalle: p.nit ? `NIT ${p.nit}` : undefined })), [proveedores, c?.proveedor_id]);
  const calc = useMemo(() => (c ? totalesCalculados(c.items, c.tipo_doc) : { productos: 0, iva: 0 }), [c]);

  // Parte relacionada: el precio tiene que ser el de mercado. Avisa, no bloquea.
  const [refs, setRefs] = useState({});
  const ids = (c?.items ?? []).map((it) => it.product_id).filter(Boolean).sort().join(',');
  useEffect(() => {
    if (!proveedor?.relacionada || !ids) { setRefs({}); return undefined; }
    let vivo = true;
    const t = setTimeout(() => {
      fetchReferenciasRelacionada(ids.split(',')).then((r) => { if (vivo) setRefs(r); }).catch(() => {});
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [proveedor?.relacionada, ids]);
  const avisosPrecio = useMemo(() => (!proveedor?.relacionada || !c ? []
    : c.items.map((it) => evaluarPrecioRelacionada(costoSinIvaDeRenglon(it, c.tipo_doc), refs[it.product_id]))), [proveedor?.relacionada, c, refs]);
  const conAviso = avisosPrecio.filter((a) => a.length).length;
  const problemas = useMemo(() => (c ? problemasDeCompra(c) : []), [c]);
  const conProblema = useMemo(() => new Set(problemas.map((p) => p.campo)), [problemas]);

  // ── El JSON del proveedor ──
  const aplicarJson = useCallback(async (json, provs = proveedores) => {
    const pre = leerDteDelProveedor(json);
    const prov = pre.emisor.nit ? provs.find((p) => p.nit === pre.emisor.nit) : null;
    const mem = prov ? await fetchMemoriaProveedor(prov.id).catch(() => ({})) : {};
    const leida = leerDteDelProveedor(json, { memoria: mem });
    setEmisorDelJson(prov ? null : pre.emisor);
    setC((x) => compraConLectura(x, leida, prov));
  }, [proveedores]);

  const leerPegado = async () => {
    try {
      const json = JSON.parse(textoJson);
      await aplicarJson(json);
      setJsonCrudo(json); setPegando(false); setTextoJson('');
      listo('Documento leído', 'Revisa los productos, el lote y el vencimiento.');
    } catch (e) {
      fallo('No se pudo leer', e instanceof SyntaxError ? 'El texto no es un JSON válido.' : (e?.message || 'No se pudo leer el documento.'));
    }
  };

  // El archivo del proveedor (el .json que mandó por correo): se lee igual
  // que lo pegado, con el mismo lector del núcleo.
  const elegirArchivo = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', 'public.json'], copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.[0]) return;
      const texto = await new File(r.assets[0].uri).text();
      const json = JSON.parse(texto);
      await aplicarJson(json);
      setJsonCrudo(json);
      listo('Documento leído', 'Revisa los productos, el lote y el vencimiento.');
    } catch (e) {
      fallo('No se pudo leer', e instanceof SyntaxError ? 'El archivo no es un JSON válido.' : (e?.message || 'No se pudo leer el documento.'));
    }
  };

  const guardar = (recibir) => {
    const p = payloadDeCompra(c);
    const mensaje = recibir
      ? `${p.items.length} productos entran a bodega con su costo. Esto mueve el inventario y no se deshace: sólo se puede anular mientras todo siga en bodega.`
      : 'Queda en Borradores para seguir después.';
    Alert.alert(recibir ? 'Recibir en bodega' : 'Guardar borrador', `${proveedor?.nombre ?? ''} · ${c.numero.trim()}\n\n${mensaje}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: recibir ? 'Recibir' : 'Guardar', onPress: async () => {
        setOcupado(recibir ? 'recibir' : 'guardar'); setError('');
        trabajando(recibir ? 'Recibiendo la compra…' : 'Guardando el borrador…');
        try {
          const nuevoId = await guardarCompra(p);
          setC((x) => ({ ...x, id: nuevoId }));
          descartar();
          if (recibir) {
            const r = await recibirCompra(nuevoId);
            anotar('DISTRIBUCION_COMPRA_RECIBIDA', String(nuevoId), { proveedor: proveedor?.nombre, numero: c.numero.trim(), total: num(c.total), renglones: r?.renglones });
            listo('Compra recibida', `${r?.renglones ?? ''} productos entraron a bodega con su costo.`);
            volver('/torogoz/compras');
            return;
          }
          anotar('DISTRIBUCION_COMPRA_BORRADOR', String(nuevoId), { numero: c.numero.trim() });
          listo('Borrador guardado', 'Puedes seguir después: queda en Borradores.');
        } catch (e) {
          const m = mensajeDeDistribucion(e);
          setError(m); fallo(recibir ? 'No se recibió' : 'No se guardó', m);
        } finally { setOcupado(''); }
      } },
    ]);
  };

  const anular = () => {
    const recibida = estado === 'recibida';
    Alert.alert(recibida ? 'Anular la compra' : 'Descartar el borrador',
      recibida ? 'Las unidades salen de bodega y el costo se recalcula. Sólo se puede si todo lo que entró sigue en bodega.' : 'El borrador deja de estar en la lista.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: recibida ? 'Anular' : 'Descartar', style: 'destructive', onPress: async () => {
          setOcupado('anular'); setError('');
          trabajando(recibida ? 'Anulando…' : 'Descartando…');
          try {
            await anularCompra(c.id, motivo.trim());
            anotar('DISTRIBUCION_COMPRA_ANULADA', String(c.id), { numero: c.numero, estado_previo: estado, motivo: motivo.trim() });
            listo(recibida ? 'Compra anulada' : 'Borrador descartado', recibida ? 'Las unidades salieron de bodega y el costo se recalculó.' : '');
            volver('/torogoz/compras');
          } catch (e) {
            const m = mensajeDeDistribucion(e);
            setError(m); fallo('No se pudo', m);
          } finally { setOcupado(''); }
        } },
      ]);
  };

  if (!c) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Compra' }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {error ? <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center' }}>{error}</Text> : <ActivityIndicator />}
        </View>
      </>
    );
  }

  const base = num(c.gravada) + num(c.exenta);
  const cuadra = c.items.length > 0 && Math.abs(calc.productos - base) <= toleranciaDeCuadre(c.items.length);
  const nombreDe = (it) => it.nombre ?? catalogo.find((p) => p.product_id === it.product_id)?.nombre ?? `Producto ${it.product_id}`;
  const titulo = nueva ? 'Nueva compra' : `Compra ${c.numero ?? ''}`;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: titulo }} />
      <Formulario contentContainerStyle={{ paddingHorizontal: 16, gap: 18, paddingBottom: 60 }}>
        {estado && !nueva ? (
          <View style={{ flexDirection: 'row' }}>
            <Pildora texto={estado === 'recibida' ? 'Recibida' : estado === 'anulada' ? 'Anulada' : 'Borrador'}
              color={estado === 'recibida' ? MARCA.verde : estado === 'anulada' ? MARCA.rojo : MARCA.ambar} />
          </View>
        ) : null}
        {detalle && estado === 'recibida' && detalle.recibida_at ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {`Recibida el ${fechaNumerica(detalle.recibida_at)}${detalle.recibio ? ` por ${shortEmployeeName(detalle.recibio)}` : ''}.`}
          </Text>
        ) : null}
        {detalle && estado === 'anulada' ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Anulada${detalle.anulo ? ` por ${shortEmployeeName(detalle.anulo)}` : ''}: ${detalle.anulada_motivo ?? ''}`}</Text>
        ) : null}
        {error ? <Nota tono="danger" texto={error} /> : null}

        {editable ? (
          <Seccion pie="Se llena solo: número, fecha, montos y productos.">
            <Text style={{ color: colorSistema.texto, fontSize: 15 }}>¿Tienes el JSON del documento del proveedor?</Text>
            <BotonGrande texto="Elegir el archivo" color={PETROLEO} onPress={elegirArchivo} />
            <BotonGrande texto="Pegar el JSON" borde color={PETROLEO} onPress={() => setPegando(true)} />
          </Seccion>
        ) : null}
        {editable && emisorDelJson ? (
          <View style={{ gap: 8 }}>
            <Nota tono="warning" texto={`${emisorDelJson.nombre || 'El proveedor del documento'} (NIT ${emisorDelJson.nit ?? '—'}) todavía no está registrado.`} />
            <BotonGrande texto="Registrarlo" borde color={PETROLEO} onPress={() => setAltaProveedor(emisorDelJson)} />
          </View>
        ) : null}

        <Seccion titulo="Documento">
          <ElegirLargo rotulo="Proveedor" valor={c.proveedor_id} opciones={opcionesProveedor} deshabilitado={!editable} textoBoton="Elegir proveedor…"
            error={editable && conProblema.has('proveedor') && !!c.numero ? 'Elige el proveedor.' : undefined}
            onCambiar={(v) => set('proveedor_id')(v)} />
          {editable ? <Text onPress={() => setAltaProveedor({})} style={{ color: PETROLEO, fontSize: 15, fontWeight: '600' }}>+ Nuevo proveedor</Text> : null}
          {proveedor?.relacionada ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              Empresa relacionada: es una venta de ella y una compra de Torogoz, y el precio tiene que ser el de mercado.
            </Text>
          ) : null}
          <ElegirLargo rotulo="Tipo de documento" valor={c.tipo_doc} opciones={TIPOS_COMPRA.map((t) => ({ id: t.value, label: t.label }))}
            deshabilitado={!editable} onCambiar={(v) => set('tipo_doc')(v || '03')} />
          <CampoConRotulo rotulo="Número de control" value={c.numero} editable={editable} autoCapitalize="characters" placeholder="DTE-03-…"
            onChangeText={(v) => set('numero')(v.toUpperCase())} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Fecha del documento</Text>
            {editable ? <Fecha valor={c.fecha} hasta={hoySV()} onCambiar={set('fecha')} />
              : <Text style={{ color: colorSistema.texto2, fontSize: 16 }}>{c.fecha ? fechaNumerica(c.fecha) : '—'}</Text>}
          </View>
          {editable ? (
            <Opciones color={PETROLEO} valor={String(c.condicion)} onCambiar={(v) => setC((x) => ({ ...x, condicion: Number(v), vence: '' }))}
              opciones={[{ id: '1', label: 'Contado' }, { id: '2', label: 'Crédito' }]} />
          ) : <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{Number(c.condicion) === 2 ? 'Crédito' : 'Contado'}</Text>}
          {Number(c.condicion) === 2 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Vence el pago</Text>
              {!editable ? <Text style={{ color: colorSistema.texto2, fontSize: 16 }}>{c.vence ? fechaNumerica(c.vence) : '—'}</Text>
                : c.vence ? <Fecha valor={c.vence} onCambiar={set('vence')} />
                  : <Text onPress={() => set('vence')(hoySV())} style={{ color: PETROLEO, fontSize: 15, fontWeight: '600' }}>Poner fecha</Text>}
            </View>
          ) : null}
          <CampoConRotulo rotulo="Código de generación (opcional)" value={c.codigo_generacion} editable={editable} autoCapitalize="none"
            onChangeText={(v) => set('codigo_generacion')(v.trim().toLowerCase())} />
        </Seccion>

        <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16, marginBottom: -10 }}>Productos</Text>
        {!c.items.length ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>Sin productos todavía. Lee el JSON del proveedor o agrégalos a mano.</Text>
        ) : null}
        {c.items.map((it, i) => (
          <RenglonDeCompra key={it.key} it={it} i={i} editable={editable} tipoDoc={c.tipo_doc} opcionesProducto={opcionesProducto} nombreDe={nombreDe}
            mal={editable && conProblema.has(`item-${i}`)} avisos={avisosPrecio[i] ?? []}
            onCambiar={(cambios, reemplaza) => setItem(i, cambios, reemplaza)}
            onQuitar={() => setC((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }))} />
        ))}
        {editable ? <BotonGrande texto="Agregar producto" borde color={PETROLEO} onPress={() => { Haptics.selectionAsync().catch(() => {}); setC((x) => ({ ...x, items: [...x.items, renglonDeCompraVacio()] })); }} /> : null}
        {conAviso > 0 ? (
          <Nota tono="warning" texto={`${conAviso} producto${conAviso === 1 ? '' : 's'} con precio fuera de lo razonable entre empresas del mismo grupo. Se puede recibir igual, pero conviene que el contador lo revise: entre relacionadas el precio tiene que ser el que se le cobraría a un tercero.`} />
        ) : null}

        <Seccion titulo="Montos del documento" pie="Escríbelos como vienen en el papel: la compra sólo se recibe si cuadran con los productos.">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: cuadra ? MARCA.verde : colorSistema.texto2, fontSize: 15, fontWeight: '700' }}>
              {`${cuadra ? '✓ ' : ''}Productos: ${formatMoney(calc.productos)}`}
            </Text>
            {editable && c.items.length ? (
              <Text onPress={() => setC(compraConMontosCalculados)} style={{ color: PETROLEO, fontSize: 14, fontWeight: '600' }}>Copiar de los productos</Text>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <CampoMonto rotulo="Gravado" valor={c.gravada} onCambiar={set('gravada')} editable={editable} />
            <CampoMonto rotulo="Exento" valor={c.exenta} onCambiar={set('exenta')} editable={editable} />
            <CampoMonto rotulo="IVA" valor={c.iva} onCambiar={set('iva')} editable={editable}
              esperado={c.tipo_doc === '03' && c.gravada !== '' ? Math.round(num(c.gravada) * 13) / 100 : undefined} />
            <CampoMonto rotulo="Percepción 1 %" valor={c.percepcion} onCambiar={set('percepcion')} editable={editable} />
            <CampoMonto rotulo="Retención" valor={c.retencion} onCambiar={set('retencion')} editable={editable} />
            <CampoMonto rotulo="Total" valor={c.total} onCambiar={set('total')} editable={editable}
              esperado={c.gravada !== '' ? totalEsperado(c) : undefined} />
          </View>
        </Seccion>

        {editable ? (
          <Seccion titulo="Nota (opcional)">
            <Campo value={c.nota} onChangeText={set('nota')} placeholder="Quién la entregó, faltantes, condiciones…" />
          </Seccion>
        ) : null}

        {editable && problemas.length > 0 && (c.numero || c.items.length > 0) ? (
          <Nota tono="warning" titulo="Para recibirla falta:"
            texto={[...problemas.slice(0, 6).map((p) => `• ${p.texto}`), ...(problemas.length > 6 ? [`y ${problemas.length - 6} más.`] : [])].join('\n')} />
        ) : null}

        {editable ? (
          <View style={{ gap: 10 }}>
            <BotonGrande texto="Recibir en bodega" color={PETROLEO} deshabilitado={!!ocupado || problemas.length > 0} onPress={() => guardar(true)} />
            <BotonGrande texto="Guardar borrador" borde color={PETROLEO} deshabilitado={!!ocupado || !c.proveedor_id || !c.numero.trim()} onPress={() => guardar(false)} />
          </View>
        ) : null}

        {puedeEditar && estado !== 'anulada' && c.id ? (
          anulando ? (
            <Seccion titulo={estado === 'recibida' ? '¿Por qué se anula la compra?' : '¿Por qué se descarta?'}
              pie={estado === 'recibida' ? 'Sólo se puede si todo lo que entró sigue en bodega.' : undefined}>
              <Campo value={motivo} onChangeText={setMotivo} autoFocus placeholder="Motivo" />
              <BotonGrande texto={estado === 'recibida' ? 'Anular compra' : 'Descartar borrador'} color={MARCA.rojo}
                deshabilitado={!motivo.trim() || !!ocupado} onPress={anular} />
              <Text onPress={() => setAnulando(false)} style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center' }}>Cancelar</Text>
            </Seccion>
          ) : (
            <Text onPress={() => { setAnulando(true); setMotivo(''); }} style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600', textAlign: 'center' }}>
              {estado === 'recibida' ? 'Anular esta compra' : 'Descartar borrador'}
            </Text>
          )
        ) : null}
      </Formulario>

      {pegando ? (
        <Hoja titulo="JSON del proveedor" onCerrar={() => setPegando(false)}>
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
            Copia el contenido del archivo .json que te mandó el proveedor y pégalo aquí. Se llenan solos el número, la fecha, los montos y los productos.
          </Text>
          <Campo value={textoJson} onChangeText={setTextoJson} placeholder="Pega aquí el JSON" autoCorrect={false} autoCapitalize="none"
            style={{ minHeight: 200, fontSize: 13, textAlignVertical: 'top' }} />
          <BotonGrande texto="Leer el documento" color={PETROLEO} deshabilitado={!textoJson.trim()} onPress={leerPegado} />
        </Hoja>
      ) : null}

      {altaProveedor ? (
        <Hoja titulo={altaProveedor.nit ? 'Registrar proveedor' : 'Nuevo proveedor'} onCerrar={() => setAltaProveedor(null)}>
          <FormularioProveedor emisorId={emisor?.id} inicial={altaProveedor} onGuardado={async (nuevoId) => {
            setAltaProveedor(null);
            const provs = await cargarProveedores().catch(() => proveedores);
            set('proveedor_id')(String(nuevoId));
            if (jsonCrudo) await aplicarJson(jsonCrudo, provs).catch(() => {});
          }} />
        </Hoja>
      ) : null}
    </>
  );
}
