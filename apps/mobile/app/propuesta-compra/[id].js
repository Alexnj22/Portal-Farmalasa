// La compra armada de una factura, NATIVA — la `Propuesta` de «Cargar compra»
// del portal (`PropuestaDeCompra.jsx`), con todo lo que hace allá: confirmar o
// elegir el producto de cada renglón (el diccionario), producto nuevo, separar
// un renglón, lote, vencimiento, precio regular, «¿llegó todo?», a vencidos, a
// sucursales, flete / servicio, producto erróneo, pedir las fechas a la
// sucursal, «Revisar carga» y «Cargar en Bodega», y sacar la factura de la
// lista. Las reglas son las del núcleo (`@nucleo/utils/cargaDeCompra`) y las
// escrituras las de `@nucleo/data/cargarCompra`: se revisa y se manda la MISMA
// firma, y el servidor se niega si algo cambió.
//
// `id` es el documento; una factura en papel llega con `manual` (y `id`
// «papel»). Con las compras en pausa la app no carga ni crea productos.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  confirmarProducto, enviarCarga, factorParaProducto, fetchEstadosDeCarga, fetchFacturasEnPapel, fetchPausaDeCompras,
  fetchPistasSinCargar, fetchPropuesta, refrescarCatalogo, resolverDocumento, simularCarga,
} from '@nucleo/data/cargarCompra';
import { notificarVenceCorto } from '@nucleo/data/venceCorto';
import {
  ajusteInicial, claveDe, conBorrador, conCarga, costoDeLaRevision, decisionDeRenglon, faltaDelRenglon, huellaDe,
  productoDelRenglon, tamanoAprendible, vencesDeDecision,
} from '@nucleo/utils/cargaDeCompra';
import { juzgarPresentacion } from '@nucleo/utils/presentacionDeCompra';
import { venceCorto } from '@nucleo/utils/venceCorto';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Ficha, Seccion } from '../../componentes/formulario/Piezas';
import Indicador from '../../componentes/Indicador';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { avisar, fallo, listo, trabajando, cerrarProgreso } from '../../componentes/Progreso';
import { Accion, PausaDeCompras, Rotulo, avisarSacada, colorDe, estadoDeCarga, fmtFecha } from '../../componentes/compras/carga';
import RenglonDeCarga from '../../componentes/compras/RenglonDeCarga';
import PedirFechas from '../../componentes/compras/PedirFechas';
import NuevoProducto from '../../componentes/compras/NuevoProducto';
import PartirRenglon from '../../componentes/compras/PartirRenglon';
import FacturaEnPapel from '../../componentes/compras/FacturaEnPapel';

const FILAS_TOTALES = [['gravada', 'Gravado (sin IVA)'], ['exenta', 'Exento / no sujeto'], ['descuento', 'Descuento'], ['iva', 'IVA 13 %'],
  ['percepcion', 'Percepción 1 %'], ['retencion', 'Retención'], ['total', 'Total']];

/** Los totales de la factura contra los que se cargan, para confirmarlos a ojo. */
function Totales({ t }) {
  const filas = FILAS_TOTALES.filter(([k]) => Number(t.documento?.[k]) || Number(t.carga?.[k]) || k === 'total' || k === 'iva');
  const difiere = filas.some(([k]) => t.documento?.[k] != null && t.carga?.[k] != null && Math.abs(Number(t.documento[k]) - Number(t.carga[k])) > 0.05);
  return (
    <Seccion titulo="Montos · factura y lo que se carga" pie={difiere ? 'Hay montos que no coinciden con la factura: revísalos antes de cargar.' : 'El descuento ya va dentro de cada costo.'}>
      {filas.map(([k, rotulo], i) => {
        const d = t.documento?.[k], c = t.carga?.[k];
        const igual = d != null && c != null && Math.abs(Number(d) - Number(c)) <= 0.05;
        const marca = d != null && c != null ? (igual ? ' ✓' : ' ✕') : '';
        return <Dato key={k} primero={i === 0} fuerte={k === 'total'} rotulo={`${rotulo}${marca}`} valor={`${d != null ? formatMoney(d) : '—'} · ${c != null ? formatMoney(c) : '—'}`} />;
      })}
    </Seccion>
  );
}

/**
 * La nota de crédito de descuento que la revisión encontró (Vijosa manda las
 * regalías aparte): la compra entra por la factura menos la nota, y cada
 * producto lleva sus regalías. Las regalías se anotan en el portal.
 */
const MODO_NOTA = {
  regalias: 'Cada producto lleva sus regalías. El resto del descuento va parejo en todos.',
  proporcional: 'Ningún producto tiene su regalía anotada. El descuento va parejo en todos.',
  escalado: 'Las regalías suman más que la nota. Se ajustaron a lo que dice la nota.',
};
function NotaDeDescuento({ nota, sinNota, puedeEditar, ocupado, onSinNota }) {
  const total = (nota.notas ?? []).reduce((a, n) => a + Number(n.total || 0), 0);
  const cercana = (nota.notas ?? []).some((n) => n.como === 'cercana');
  const filas = (nota.renglones ?? []).filter((r) => Number(r.rebaja) > 0);
  return (
    <Seccion titulo={`Nota de crédito de descuento · ${formatMoney(total)}`}
      pie={nota.aplicada ? `La compra entra por la factura menos esta nota. ${MODO_NOTA[nota.modo] ?? ''}` : 'Esta nota no se aplica. La compra entra por el total de la factura.'}>
      {cercana ? <Aviso texto="La nota no dice a qué factura va. Es la que llegó junto con esta." /> : null}
      {nota.aplicada ? filas.map((r, i) => (
        <Dato key={r.renglon} primero={i === 0} rotulo={`${r.descripcion}${r.nivel ? ` · ${r.nivel.compra}+${r.nivel.regalo}` : ''}${Number(r.regalo) > 0 ? ` · ${r.regalo} de regalo` : ''}`}
          valor={`−${formatMoney(r.rebaja)}`} />
      )) : null}
      {puedeEditar ? (
        <BotonGrande borde texto={sinNota ? 'Aplicar la nota' : 'Esta nota no es de esta factura'} deshabilitado={ocupado}
          onPress={() => onSinNota(!sinNota)} />
      ) : null}
    </Seccion>
  );
}

export default function PropuestaDeCompra() {
  const { id, manual, proveedor, nit, fecha, total } = useLocalSearchParams();
  const doc = useMemo(() => ({
    document_id: manual ? null : Number(id), manual_id: manual ? Number(manual) : null,
    emisor_nombre: proveedor, emisor_nit: nit || null, fecha_emision: fecha || null, monto_total: total !== '' && total != null ? Number(total) : null,
  }), [id, manual, proveedor, nit, fecha, total]);
  const papel = !!doc.manual_id;
  const { hasPermission } = useAuth();
  // El mismo permiso que la web (CargarCompraView): quien carga tiene `cargar_compra`.
  const puedeEditar = hasPermission('cargar_compra', 'can_edit') || hasPermission('compras', 'can_edit');
  const salas = useStaffStore((s) => s.branches);
  const salasReparto = useMemo(() => (salas ?? []).filter((b) => b.type === 'FARMACIA').sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })), [salas]);

  const [p, setP] = useState(null);
  // La nota de descuento que encontró la revisión NO es de esta factura.
  const [sinNota, setSinNota] = useState(false);
  const [error, setError] = useState('');
  const [elegidos, setEleg] = useState({});
  const [buscando, setBusc] = useState(null);
  const [guardando, setG] = useState(null);
  const [duda, setDuda] = useState(null);
  const [partiendo, setPartiendo] = useState(null);
  const [uso, setUso] = useState('venta');
  const [ajustes, setAjustes] = useState({});
  const [dias, setDias] = useState('');
  const [revisando, setRev] = useState(false);
  const [resultado, setRes] = useState(null);
  const [ultimaRev, setUltimaRev] = useState(null);
  const [creando, setCreando] = useState(null);
  const [enviando, setEnv] = useState(false);
  const [envio, setEnvio] = useState(null);
  const [resolviendo, setResolv] = useState(false);
  const [estadoCarga, setEstadoCarga] = useState(null);
  const [pista, setPista] = useState(null);
  const [pausa, setPausa] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null);
  const pausada = !!pausa?.pausada;

  const claveBorrador = `cargar-compra:${papel ? `m${doc.manual_id}` : doc.document_id}`;
  const cargar = useCallback(async () => {
    setP(null); setError(''); setRes(null);
    const refresco = refrescarCatalogo();
    const { propuesta, error: e } = await fetchPropuesta(doc.document_id, doc.manual_id ?? null);
    if (e) { setError(String(e)); return; }
    setP(propuesta);
    // Si la actualización del catálogo trajo cambios, se vuelve a pedir y se
    // reemplaza conservando lo que la persona tocó.
    refresco.then(async (rf) => {
      if (!rf?.refrescado || !(rf.cambios > 0)) return;
      const { propuesta: nueva, error: e2 } = await fetchPropuesta(doc.document_id, doc.manual_id ?? null);
      if (e2 || huellaDe(nueva.renglones) !== huellaDe(propuesta.renglones)) return;
      setP(nueva);
      setAjustes((a) => Object.fromEntries(nueva.renglones.map((r, i) => [i, conBorrador(ajusteInicial(r), a[i])])));
    }).catch(() => {});
    // Lo ajustado sobre ESTE documento vuelve, sólo si los renglones son los mismos.
    const guardado = loadDraft(claveBorrador);
    const b = guardado?.huella === huellaDe(propuesta.renglones) ? guardado : null;
    setAjustes(Object.fromEntries(propuesta.renglones.map((r, i) => [i, conBorrador(ajusteInicial(r), b?.ajustes?.[i])])));
    setUso(b?.uso ?? 'venta');
    setDias(b?.dias ?? (propuesta.encabezado.dias_credito != null ? String(propuesta.encabezado.dias_credito) : ''));
  }, [doc.document_id, doc.manual_id, claveBorrador]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial
  useEffect(() => { if (p) saveDraft(claveBorrador, { ajustes, uso, dias, huella: huellaDe(p.renglones) }); }, [p, ajustes, uso, dias, claveBorrador]);
  useEffect(() => {
    fetchPausaDeCompras().then(({ estado }) => setPausa(estado));
    if (papel) return;
    fetchEstadosDeCarga([doc.document_id]).then(({ estados }) => setEstadoCarga(estados?.[doc.document_id] ?? null));
    fetchPistasSinCargar([doc.document_id]).then(({ pistas }) => setPista(pistas?.[doc.document_id] ?? null));
  }, [doc.document_id, papel]);

  const ajustar = (i, campo, valor) => { setAjustes((a) => ({ ...a, [i]: { ...a[i], [campo]: valor } })); setRes(null); };
  const ajustarCarga = (i, r, valor) => { setAjustes((a) => ({ ...a, [i]: conCarga(a[i], r, valor) })); setRes(null); };
  // Las fechas que contestó la sala sólo llenan los renglones VACÍOS.
  const usarFechas = useCallback((respuestas) => {
    let cambio = false;
    setAjustes((a) => {
      const n = { ...a };
      for (const [i, v] of Object.entries(respuestas ?? {})) if (v && !n[i]?.vence) { n[i] = { ...n[i], vence: v }; cambio = true; }
      return cambio ? n : a;
    });
    if (cambio) setRes(null);
  }, []);

  // Se aprende por la llave del diccionario. Elegir otro producto trae SUS
  // presentaciones y recalcula el tamaño si nadie tocó la cantidad.
  const confirmar = async (renglon, i, producto, { explicito = false } = {}) => {
    const k = claveDe(renglon, i);
    const llave = renglon.llave || renglon.codigo_proveedor;
    const intacto = ajustes[i]?.cargar == null && String(ajustes[i]?.factor) === String(renglon.factor_proveedor ?? 1);
    let factor = ajustes[i]?.factor;
    let vinetas = null; let saldo; let numeros; let costoUnidadAntes;
    if (producto.id !== renglon.producto_id) {
      setG(k);
      const r = await factorParaProducto({ productId: producto.id, costoNeto: renglon.costo_neto, descripcion: renglon.descripcion, cantidad: renglon.cantidad, emisor: p.documento.emisor });
      setG(null);
      vinetas = r.presentaciones; saldo = r.saldo; numeros = r.numeros; costoUnidadAntes = r.costoUnidadAntes;
      if (intacto && !['documento', 'aprendido'].includes(renglon.factor_origen)) factor = r.factor ? String(r.factor) : '1';
    }
    if (factor !== ajustes[i]?.factor) setAjustes((a) => ({ ...a, [i]: { ...a[i], factor } }));
    if (llave && p.documento.emisor_nit) {
      // Confirmar el PRODUCTO no confirma un tamaño raro: sólo «Siempre así».
      const lista = vinetas ?? (producto.id === renglon.producto_id ? (renglon.vinetas ?? []) : []);
      const aprender = explicito || tamanoAprendible(factor, lista, renglon) ? factor : '1';
      setG(k);
      const { error: e } = await confirmarProducto(p.documento.emisor_nit, llave, producto.id, { proveedor: p.documento.emisor, producto: producto.nombre, desde: 'app' }, aprender);
      setG(null);
      if (e) { fallo('No se pudo confirmar', String(e?.message ?? e)); return; }
    }
    setEleg((x) => ({ ...x, [k]: { product_id: producto.id, nombre: producto.nombre, factor, ...(vinetas ? { vinetas } : {}), ...(saldo !== undefined ? { saldo } : {}), ...(numeros?.length ? { numeros } : {}), ...(costoUnidadAntes !== undefined ? { costoUnidadAntes } : {}) } }));
    setBusc(null); setRes(null);
  };

  const vinetasDe = (r, i) => {
    const e = elegidos[claveDe(r, i)];
    if (e?.vinetas) return e.vinetas;
    return !e || e.product_id === r.producto_id ? (r.vinetas ?? []) : [];
  };
  const productoDe = (r, i) => productoDelRenglon(r, elegidos[claveDe(r, i)]);
  const decisiones = () => Object.fromEntries(p.renglones.map((r, i) => [i, decisionDeRenglon(ajustes[i], productoDe(r, i), r)]));
  const firmaActual = () => JSON.stringify({ uso, renglones: decisiones(), diasCredito: dias === '' ? null : Number(dias), particionFirma: p?.particion_firma ?? '', sinNotaDescuento: sinNota });

  const revisar = async (sinNotaAhora = sinNota) => {
    if (sinNotaAhora !== sinNota) setSinNota(sinNotaAhora);
    setRev(true); setError(''); setRes(null); setEnvio(null);
    const firma = JSON.stringify({ ...JSON.parse(firmaActual()), sinNotaDescuento: sinNotaAhora });
    const { resultado: res, error: e } = await simularCarga({ documentId: doc.document_id, manualId: doc.manual_id, ...JSON.parse(firma) });
    setRev(false);
    if (e) { setError(e); return; }
    setRes({ ...res, firma });
    setUltimaRev({ ...res, firma });
  };

  // Manda EXACTAMENTE lo revisado.
  const enviar = async () => {
    setEnv(true); setError(''); trabajando('Cargando en Bodega…');
    const rev = JSON.parse(resultado.firma);
    const { resultado: r, error: e } = await enviarCarga({ documentId: doc.document_id, manualId: doc.manual_id, cargaId: resultado.carga_id, ...rev });
    setEnv(false); cerrarProgreso();
    if (r?.enviada) {
      for (const [i, x] of Object.entries(rev.renglones ?? {})) {
        if (!(x.venta > 0)) continue;
        const x0 = (resultado?.revision?.renglones ?? []).find((y) => y.renglon === Number(i));
        const ant = x0?.venta_anterior ?? null;
        if (ant != null && Math.abs(ant - x.venta) < 0.005) continue;
        useStaffStore.getState().appendAuditLog('COMPRA_VINETA_CAMBIADA', String(x.product_id), {
          documento: doc.document_id, papel: doc.manual_id, proveedor: doc.emisor_nombre, producto: x0?.descripcion ?? null, antes: ant, ahora: x.venta, desde: 'app',
        });
      }
    }
    if (r?.enviada === true && !e) {
      // Vence en 6 meses o menos: se avisa a Bodega.
      const cortos = Object.entries(rev.renglones ?? {}).filter(([, x]) => !x.servicio && !x.erroneo && vencesDeDecision(x).some(v => venceCorto(v)))
        .map(([i, x]) => ({ nombre: p.renglones[Number(i)]?.descripcion ?? `Producto ${Number(i) + 1}`, vence: vencesDeDecision(x).sort()[0], cantidad: p.renglones[Number(i)]?.cantidad ?? null }));
      if (cortos.length) {
        notificarVenceCorto({ origen: 'compra', referencia: doc.document_id ?? `papel-${doc.manual_id}`, detalle: doc.emisor_nombre, productos: cortos })
          .then(({ error: ea }) => { if (ea) avisar('No se pudo avisar a Bodega', 'Hay productos que vencen en 6 meses o menos. Avísales tú.'); });
      }
      clearDraft(claveBorrador);
      listo('Compra cargada', `${doc.emisor_nombre} · ${formatMoney(doc.monto_total)} ${r.verificada ? 'entró a Bodega.' : 'se mandó a Bodega. Se confirma en unos minutos.'}`);
      router.back();
      return;
    }
    setEnvio({ ...(r ?? {}), error: e });
    setRes(null);
  };
  const preguntarEnviar = () => Alert.alert('¿Cargar esta compra en Bodega?', `Se registra la compra de ${doc.emisor_nombre} por ${formatMoney(resultado?.revision?.total_armado)} en Bodega. Solo se deshace anulando la compra.`, [
    { text: 'Cancelar', style: 'cancel' }, { text: 'Sí, cargar', onPress: enviar },
  ]);

  // Sacar el documento de la lista sin cargarlo.
  const sacarDeLaLista = async (motivo, receiptId = null) => {
    setResolv(true);
    const { error: e } = await resolverDocumento(doc.document_id, motivo, receiptId);
    setResolv(false);
    if (e) { fallo('No se pudo', e === 'FORBIDDEN' ? 'No tienes permiso para sacarla de la lista.' : e); return; }
    useStaffStore.getState().appendAuditLog('COMPRA_SACADA_DE_LA_COLA', String(doc.document_id), { motivo, compra: receiptId, proveedor: doc.emisor_nombre, total: doc.monto_total, desde: 'app' });
    if (motivo !== 'cargada_a_mano') avisarSacada({ doc, proveedor: motivo === 'proveedor_no_va' });
    clearDraft(claveBorrador);
    listo('Salió de la lista', doc.emisor_nombre);
    router.back();
  };
  const noEsMercaderia = () => Alert.alert('Esta factura no entra a Bodega ni a ninguna sucursal',
    'Solo sale de esta lista. Úsalo si es un gasto o servicio (luz, ferretería, papelería) o si ya se cargó.\n\n¿Querías mandar productos a una sucursal? Usa «Enviar a sucursales» en cada producto.', [
      { text: 'No, volver', style: 'cancel' },
      { text: 'Sí, quitar esta factura', onPress: () => sacarDeLaLista('no_va_a_bodega') },
      ...(doc.emisor_nit ? [{ text: 'Quitar todo lo de este proveedor', onPress: () => Alert.alert('¿Quitar todo lo de este proveedor?', `Las facturas de ${doc.emisor_nombre} salen de esta lista: las de hoy y todas las que lleguen después.`, [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Sí, sacarlas', onPress: () => sacarDeLaLista('proveedor_no_va') },
      ]) }] : []),
    ]);
  const marcarErroneo = (i, nombre) => Alert.alert('¿El proveedor lo mandó por error?', `«${nombre}» entra con la compra y pasa a Bodega de vencidos hasta que llegue la nota de crédito. Márcalo sólo si NO es lo que pedimos.`, [
    { text: 'Cancelar', style: 'cancel' }, { text: 'Sí, vino por error', onPress: () => ajustar(i, 'erroneo', true) },
  ]);
  const corregirPapel = async () => {
    const { facturas } = await fetchFacturasEnPapel();
    const m = (facturas ?? []).find((x) => x.id === doc.manual_id);
    if (!m) { fallo('No se encontró la factura', 'Ya no está entre las facturas en papel por cargar.'); return; }
    clearDraft(claveBorrador);
    setCorrigiendo(m);
  };

  // El aviso se cuenta con lo que la persona ya resolvió en pantalla.
  const estado = (p?.renglones ?? []).map((r, i) => faltaDelRenglon(r, ajustes[i], !!elegidos[claveDe(r, i)]));
  const contar = (k) => estado.filter((e) => e[k]).length;
  const resumen = p && { renglones: p.renglones.length, sin_producto: contar('sin_producto'), a_confirmar: contar('a_confirmar'), sin_lote: contar('sin_lote'), sin_vencimiento: contar('sin_vencimiento'), lotes_sin_cuadrar: contar('lotes_sin_cuadrar') };
  const faltan = estado.filter((e) => e.sin_producto || e.a_confirmar || e.sin_lote || e.sin_vencimiento || e.lotes_sin_cuadrar).length;
  const revision = resultado?.revision;
  const revisionVigente = !!(p && resultado?.firma && resultado.firma === firmaActual());
  const yaMandada = envio?.enviada === true || envio?.enviada === null || ['enviando', 'sin_verificar', 'verificada'].includes(estadoCarga?.estado);
  const pendientesDeVence = (revision?.renglones ?? []).filter((x) => x.vence_pendiente).length;
  // Se revisa sola al abrir (revisar sólo lee), una vez por apertura.
  const autoRevisada = useRef(false);
  useEffect(() => {
    if (autoRevisada.current || !p || !puedeEditar || yaMandada || resultado || revisando) return;
    if (Object.keys(ajustes).length !== p.renglones.length) return;
    autoRevisada.current = true;
    revisar(); // eslint-disable-line react-hooks/set-state-in-effect -- revisa sola una vez al abrir, como el portal
  }, [p, faltan, ajustes, puedeEditar, yaMandada]); // eslint-disable-line react-hooks/exhaustive-deps -- dispara una vez
  const decisionesAhora = p ? JSON.stringify({ uso, r: decisiones() }) : '';
  const entraComo = useMemo(() => {
    if (revision) return new Map((revision.renglones ?? []).map((x) => [x.renglon, x]));
    if (!ultimaRev?.revision || !decisionesAhora) return new Map();
    const antes = JSON.parse(ultimaRev.firma), ahora = JSON.parse(decisionesAhora);
    if (antes.uso !== ahora.uso) return new Map();
    return new Map((ultimaRev.revision.renglones ?? []).filter((x) => JSON.stringify(antes.renglones?.[x.renglon]) === JSON.stringify(ahora.r?.[x.renglon])).map((x) => [x.renglon, x]));
  }, [revision, ultimaRev, decisionesAhora]);
  const costos = useMemo(() => {
    const m = new Map();
    for (const x of entraComo.values()) { const c = costoDeLaRevision(x); if (c) m.set(x.renglon, c); }
    return m;
  }, [entraComo]);
  const subenDeCosto = [...costos.values()].filter((c) => c.cambio != null && c.cambio >= 0.5).length;
  const bajanDeCosto = [...costos.values()].filter((c) => c.cambio != null && c.cambio <= -0.5).length;
  const conMargenMalo = [...costos.values()].filter((c) => c.alerta).length;
  const lista = !!(p && faltan === 0);
  const est = envio?.enviada === true ? (envio.verificada ? estadoDeCarga({ estado: 'verificada' }) : estadoDeCarga({ estado: 'sin_verificar' }))
    : envio?.enviada === null ? estadoDeCarga({ estado: 'sin_verificar' }) : estadoDeCarga(estadoCarga);
  const puedeSacar = puedeEditar && !papel && !envio?.enviada && !estadoCarga;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Compra armada', headerLargeTitle: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={{ marginHorizontal: 4, gap: 4 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{proveedor}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{[fmtFecha(doc.fecha_emision), doc.monto_total != null ? formatMoney(doc.monto_total) : null, resumen ? `${resumen.renglones} productos` : null].filter(Boolean).join(' · ')}</Text>
            <View style={{ flexDirection: 'row' }}><Pildora texto={est[0]} color={colorDe(est[1])} /></View>
          </View>
          <PausaDeCompras estado={pausa} onCambio={setPausa} />
          {error ? <Aviso tono="freno" texto={error} /> : null}

          {pista?.compra && !envio?.enviada && !estadoCarga ? (
            <Seccion titulo="¿Ya cargada?">
              <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`Parece que ya se cargó a mano en ${pista.compra.sucursal ?? 'otra sucursal'}: compra del ${fmtFecha(pista.compra.fecha)} por ${formatMoney(pista.compra.total)}, número ${pista.compra.numero}. Mismo proveedor y mismo total, otro número. Si es la misma, no la cargues de nuevo.`}</Text>
              {puedeEditar ? <Accion texto="Sí, es esa" ocupado={resolviendo} onPress={() => sacarDeLaLista('cargada_a_mano', pista.compra.id)} /> : null}
            </Seccion>
          ) : null}
          {pista?.nota_credito && !envio?.enviada && !estadoCarga ? (
            Math.abs(Number(pista.nota_credito.total) - Number(doc.monto_total)) <= 0.02 ? (
              <Seccion titulo="¿Anulada?">
                <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`Parece anulada: el proveedor emitió una nota de crédito del ${fmtFecha(pista.nota_credito.fecha)} por el mismo total (${formatMoney(pista.nota_credito.total)}). Si la anuló, no se carga.`}</Text>
                {puedeEditar ? <Accion texto="Sí, está anulada" ocupado={resolviendo} onPress={() => sacarDeLaLista('anulada_nc')} /> : null}
              </Seccion>
            ) : <Aviso tono="cuidado" texto={`Esta factura tiene una nota de crédito del ${fmtFecha(pista.nota_credito.fecha)} por ${formatMoney(pista.nota_credito.total)}: el proveedor devolvió o descontó una parte.`} />
          ) : null}
          {!pista?.compra && pista?.gasto && !envio?.enviada && !estadoCarga ? <Aviso tono="cuidado" texto={`El proveedor está clasificado como ${pista.gasto}: parece un gasto y no mercadería. Si no es para el inventario, quítala con «No es mercadería».`} /> : null}

          {!p && !error ? <View style={{ alignItems: 'center', gap: 8, marginTop: 20 }}><Indicador /><Text style={{ color: colorSistema.texto2 }}>Leyendo la factura…</Text></View> : null}
          {p ? (
            <>
              <Seccion titulo="Encabezado">
                <Dato primero rotulo="Proveedor" valor={p.encabezado.proveedor ?? '—'} />
                <Dato rotulo="Número" valor={p.documento.codigo_generacion ?? '—'} />
                <Dato rotulo="Fecha de la factura" valor={fmtFecha(p.documento.fecha)} />
                <Dato rotulo="Sello de MH" valor={(revision?.sello || p.documento.sello) ? 'Sí' : 'No lo trae'} />
                {!papel && p.documento.id ? <Accion texto="Ver la factura" onPress={() => router.push({ pathname: '/factura-compra/[id]', params: { id: String(p.documento.id), fecha: p.documento.fecha ?? '' } })} /> : null}
              </Seccion>
              <Seccion titulo="La compra">
                <Rotulo>La compra es</Rotulo>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Ficha texto="Para vender" activa={uso === 'venta'} deshabilitada={!puedeEditar} onPress={() => { setUso('venta'); setRes(null); }} />
                  <Ficha texto="Para consumo" activa={uso === 'consumo'} deshabilitada={!puedeEditar} onPress={() => { setUso('consumo'); setRes(null); }} />
                </View>
                <Rotulo>Días de crédito</Rotulo>
                <Campo multiline={false} keyboardType="number-pad" editable={puedeEditar} value={dias} placeholder={p.encabezado.dias_credito != null ? String(p.encabezado.dias_credito) : '—'}
                  onChangeText={(v) => { setDias(v.replace(/[^\d]/g, '')); setRes(null); }} />
              </Seccion>
              {uso === 'consumo' ? <Aviso texto="Se registra en el libro de compras como gasto. No suma existencias y cada producto entra con su descripción. No se reparte a las sucursales." /> : null}

              {envio ? (envio.enviada === true ? (
                <Aviso tono={envio.verificada ? 'nota' : 'cuidado'} texto={[`Cargada en Bodega${envio.erp_compra_id ? ` (compra ${envio.erp_compra_id})` : ''}.`,
                  envio.verificada ? 'Se comprobó y cuadra producto por producto.' : envio.comprobando ? 'Se está comprobando. En unos minutos queda revisada.' : `Entró, pero al comprobarla algo no cuadró: ${(envio.notas ?? []).join(' ')}`,
                  envio.reparto ? (envio.reparto.enviando ? `Se está enviando a ${envio.reparto.salas === 1 ? '1 sucursal' : `${envio.reparto.salas} sucursales`}. Lo reciben en Traslados → En camino.` : 'No se envió a las sucursales. La carga no se pudo comprobar. Envíalo a mano.') : null,
                  envio.vencidos ? (envio.vencidos.en_curso ? 'Lo marcado como error se está pasando a Bodega de vencidos.' : 'Lo marcado como error no se pasó a vencidos. La carga no se pudo comprobar. Pásalo a mano.') : null,
                ].filter(Boolean).join(' ')} />
              ) : envio.enviada === false ? <Aviso tono="freno" texto={`No entró. ${envio.error ?? ''}`} />
                : <Aviso tono="freno" texto={`No se sabe si entró. ${envio.error ?? ''} No la mandes de nuevo. Avisa a Bodega para que la busque.`} />) : null}

              {revision ? (revision.listo ? (
                <Seccion titulo="Lista para cargar">
                  <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '700' }}>{`${revision.renglones.length} productos · total ${formatMoney(revision.total_armado)}, igual al de la factura.`}</Text>
                  {pendientesDeVence > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${pendientesDeVence === 1 ? 'Un producto va' : `${pendientesDeVence} productos van`} sin vencimiento. Lo pone la sucursal que lo reciba.`}</Text> : null}
                  {subenDeCosto || bajanDeCosto || conMargenMalo ? <Text style={{ color: MARCA.ambar, fontSize: 13 }}>{[subenDeCosto > 0 && `${subenDeCosto} ${subenDeCosto === 1 ? 'sube' : 'suben'} de costo`, bajanDeCosto > 0 && `${bajanDeCosto} ${bajanDeCosto === 1 ? 'baja' : 'bajan'} de costo`, conMargenMalo > 0 && `${conMargenMalo} con margen bajo o en pérdida: revisa el precio de venta`].filter(Boolean).join(' · ')}.</Text> : null}
                  {revision.regalos > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Trae ${revision.regalos === 1 ? 'un producto' : `${revision.regalos} productos`} de regalo. Su costo se reparte entre todas las unidades.`}</Text> : null}
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Todavía no se carga. Esto fue una revisión.</Text>
                </Seccion>
              ) : (
                <Seccion titulo={`Antes de cargarla hay que resolver ${revision.problemas.length === 1 ? 'esto' : `${revision.problemas.length} cosas`}`}>
                  {revision.problemas.map((x, k) => (
                    <View key={k} style={{ gap: 2 }}>
                      <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '600' }}>{`${x.renglon != null ? `Producto ${x.renglon + 1}: ` : ''}${x.texto}`}</Text>
                      {x.pistas?.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Qué revisar: ${x.pistas.join(' · ')}`}</Text> : null}
                    </View>
                  ))}
                </Seccion>
              )) : null}
              {revision?.totales ? <Totales t={revision.totales} /> : null}
              {revision?.nota_descuento ? (
                <NotaDeDescuento nota={revision.nota_descuento} sinNota={sinNota} puedeEditar={puedeEditar && !yaMandada}
                  ocupado={revisando || enviando} onSinNota={(v) => revisar(v)} />
              ) : null}

              {!revision && uso === 'venta' && faltan > 0 ? (
                <Aviso tono="cuidado" texto={`${faltan} de ${resumen.renglones} productos necesitan revisión: ${[[resumen.sin_producto, 'sin producto'], [resumen.a_confirmar, 'con el producto por confirmar'], [resumen.sin_lote, 'sin lote'], [resumen.sin_vencimiento, 'sin vencimiento'], [resumen.lotes_sin_cuadrar, 'con los lotes sin cuadrar']].filter(([n]) => n > 0).map(([n, t]) => `${n} ${t}`).join(' · ')}.`} />
              ) : null}
              {uso === 'venta' && !papel ? (
                <PedirFechas documentId={doc.document_id} salas={salasReparto} puedeEditar={puedeEditar}
                  sinFecha={p.renglones.map((r, i) => ({ renglon: i, descripcion: r.descripcion, cantidad: r.cantidad })).filter((x) => !ajustes[x.renglon]?.vence && !ajustes[x.renglon]?.erroneo && !ajustes[x.renglon]?.servicio)}
                  onFechas={usarFechas} />
              ) : null}
              {uso === 'venta' && (() => {
                const n = p.renglones.filter((r, i) => !ajustes[i]?.servicio && !ajustes[i]?.erroneo && vencesDeDecision(decisionDeRenglon(ajustes[i], null, r)).some(v => venceCorto(v))).length;
                return n > 0 ? <Aviso tono="cuidado" texto={`${n === 1 ? 'Un producto vence' : `${n} productos vencen`} en 6 meses o menos. Al cargar la compra se le avisa a Bodega.`} /> : null;
              })()}
              {!revision && uso === 'venta' && faltan === 0 ? <Aviso texto={`Los ${resumen.renglones} productos están completos.`} /> : null}

              {p.renglones.map((r, i) => {
                const k = claveDe(r, i);
                const elegido = elegidos[k];
                const aj = ajustes[i] ?? ajusteInicial(r);
                const conProducto = !!productoDe(r, i);
                const vinetas = vinetasDe(r, i);
                const fCarga = Number(aj.factor) || 1;
                const juicio = juzgarPresentacion({
                  tam: Number(r.tamano_factura) || null, presentaciones: vinetas, nombre: elegido?.nombre ?? r.producto, factor: fCarga,
                  costoNuevoUnidad: Number(r.costo_neto) > 0 ? Number(r.costo_neto) / fCarga : null,
                  costoAntesUnidad: elegido && elegido.product_id !== r.producto_id ? (elegido.costoUnidadAntes ?? null) : (Number(r.costo_unidad_antes) > 0 ? Number(r.costo_unidad_antes) : null),
                });
                return (
                  <RenglonDeCarga key={`${r.codigo_proveedor}-${i}`} r={r} i={i} aj={aj} elegido={elegido} uso={uso} puedeEditar={puedeEditar}
                    conProducto={conProducto} vinetas={vinetas} juicio={juicio} sim={entraComo.get(i)} costo={costos.get(i)} salas={salasReparto}
                    guardando={guardando === k} buscando={buscando === k} duda={duda === k}
                    factorCambio={!r.parte && conProducto && (r.llave || r.codigo_proveedor) && Number(aj.factor) !== Number(elegido?.factor ?? r.factor_proveedor ?? 1)}
                    onAjustar={(campo, v) => ajustar(i, campo, v)} onCargar={(v) => ajustarCarga(i, r, v)}
                    onDudar={() => setDuda(k)} onSinDuda={() => setDuda(null)}
                    onRecordar={() => { setDuda(null); confirmar(r, i, { id: productoDe(r, i), nombre: elegido?.nombre ?? r.producto }, { explicito: true }); }}
                    onEsCorrecto={() => confirmar(r, i, { id: r.producto_id, nombre: r.producto })}
                    onEsNuevo={() => setCreando(i)} onPartir={() => setPartiendo(i)}
                    onBuscar={() => setBusc(buscando === k ? null : k)} onElegir={(prod) => confirmar(r, i, prod)}
                    onErroneo={() => (aj.erroneo ? ajustar(i, 'erroneo', false) : marcarErroneo(i, elegido?.nombre ?? r.producto ?? r.descripcion))} />
                );
              })}

              {pausada && puedeEditar ? <Aviso tono="cuidado" texto="Con las compras en pausa puedes revisar, pero no cargar." /> : null}
              {lista && revision?.listo && revisionVigente && !yaMandada
                ? <Aviso texto="Lista: todo emparejado y revisado. Sólo falta «Cargar en Bodega»." />
                : <Aviso texto="«Revisar carga» compara la compra con la factura. Se registra solo con «Cargar en Bodega»." />}
              {puedeEditar && !yaMandada && revision?.listo && revisionVigente && resultado?.carga_id
                ? <BotonGrande texto={enviando ? 'Cargando…' : 'Cargar en Bodega'} deshabilitado={revisando || enviando || pausada} onPress={preguntarEnviar} /> : null}
              {puedeEditar && !yaMandada
                ? <BotonGrande texto={revisando ? 'Revisando…' : 'Revisar carga'} borde={!!(revision?.listo && revisionVigente)} deshabilitado={enviando || revisando} onPress={() => revisar()} /> : null}
              {!yaMandada ? <BotonGrande texto="Actualizar productos" borde deshabilitado={enviando || revisando} onPress={cargar} /> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 20 }}>
                {puedeSacar ? <Accion texto="No es mercadería" color={colorSistema.texto2} ocupado={resolviendo} onPress={noEsMercaderia} /> : null}
                {puedeEditar && papel && !envio?.enviada ? <Accion texto="Corregir factura" color={colorSistema.texto2} onPress={corregirPapel} /> : null}
              </View>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {partiendo != null && p?.renglones[partiendo] ? (() => {
        const r = p.renglones[partiendo];
        return (
          <PartirRenglon renglon={r} llave={r.parte?.llave ?? r.llave ?? r.codigo_proveedor}
            partesActuales={r.parte ? p.renglones.filter((x) => x.parte?.llave === r.parte.llave) : []}
            emisorNit={p.documento.emisor_nit} documentId={doc.document_id} proveedor={doc.emisor_nombre}
            onCerrar={() => setPartiendo(null)} onGuardado={() => { setPartiendo(null); cargar(); }} />
        );
      })() : null}
      {creando != null && p ? (
        <NuevoProducto renglon={p.renglones[creando]} factor={ajustes[creando]?.factor} documentId={doc.document_id} manualId={doc.manual_id} pausada={pausada}
          onCerrar={() => setCreando(null)}
          onUsar={async (producto) => { const i = creando; setCreando(null); await confirmar(p.renglones[i], i, producto); }}
          onCreado={async (producto, notas) => {
            const i = creando;
            setCreando(null);
            useStaffStore.getState().appendAuditLog('PRODUCTO_NUEVO_CREADO', String(producto.id), { nombre: producto.nombre, documento: doc.document_id, notas, desde: 'app' });
            await confirmar(p.renglones[i], i, producto);
            if (notas.length) avisar('Producto creado', `Se creó ${producto.nombre} (${producto.id}). Revisa sus datos: ${notas.join(' · ')}.`);
            else listo('Producto creado', producto.nombre);
          }} />
      ) : null}
      {corrigiendo ? (
        <FacturaEnPapel inicial={corrigiendo} onCerrar={() => setCorrigiendo(null)}
          onGuardada={() => { setCorrigiendo(null); cargar(); }} />
      ) : null}
    </>
  );
}
