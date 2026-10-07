// Conteo físico y bajas de Torogoz, NATIVO — `TabConteo` del portal.
//
// Conteo A CIEGAS: quien cuenta no ve lo que dice el sistema —si lo ve, tiende
// a encontrarlo—; quien administra sí, con la diferencia. Cada renglón se
// cuenta con la ventana del sistema (o escaneando la caja: el código lleva al
// producto y, si tiene un solo lote en el conteo, abre ese renglón). Al cerrar,
// el ajuste es relativo a lo que había cuando se contó, así una venta hecha
// mientras se contaba no se pisa.
//
// Bajas: se piden acá (`PedirBaja`) y las aprueba quien administra; recién
// aprobadas salen del lote. Las funciones son las del portal.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  anularConteo, cerrarConteo, contar, fetchBajas, fetchCatalogo, fetchConteo, fetchConteos, iniciarConteo, mensajeDeDistribucion, resolverBaja,
} from '@nucleo/data/distribucion';
import { fetchLotes } from '@nucleo/data/distribucionInventario';
import {
  estadoDeBaja, leerEntero, productoPorCodigo, renglonesDeConteo, resumenDeConteo, rotuloMotivoBaja, valorDeBajas,
} from '@nucleo/utils/distribucionBodega';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { useStaffStore } from '@nucleo/store/staffStore';
import Escaner from '../../Escaner';
import { FiltrosActivos, MenuDeFiltros } from '../../Filtros';
import { colorSistema } from '../../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../formulario/Piezas';
import Kpi, { FilaDeKpis } from '../../inicio/Kpi';
import { MARCA } from '../../inicio/marca';
import { fallo, listo, trabajando } from '../../Progreso';
import PedirBaja from './PedirBaja';
import { Chapa, Ficha, PETROLEO, confirmar } from './piezas';

const pedirTexto = (titulo, mensaje, boton, { teclado = 'default', inicial = '' } = {}) => new Promise((resolve) => {
  Alert.prompt(titulo, mensaje, [
    { text: 'Cancelar', style: 'cancel', onPress: () => resolve(null) },
    { text: boton, onPress: (v) => resolve(v ?? '') },
  ], 'plain-text', inicial, teclado);
});

function Renglon({ it, veSistema, abierto, onContar }) {
  const dif = veSistema && it.contado != null && it.sistema != null ? it.contado - it.sistema : null;
  return (
    <Ficha onPress={abierto ? () => onContar(it) : undefined}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{it.nombre}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {`Lote ${it.lote}${it.vence ? ` · vence ${fechaNumerica(it.vence)}` : ''}${it.contado_por ? ` · contó ${shortEmployeeName(it.contado_por)}` : ''}`}
          </Text>
          {veSistema && it.sistema != null ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Sistema ${formatQty(it.sistema)}`}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {it.contado != null
            ? <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatQty(it.contado)}</Text>
            : <Text style={{ color: abierto ? MARCA.azulClaro : colorSistema.texto2, fontSize: 15, fontWeight: '600' }}>{abierto ? 'Contar' : 'Sin contar'}</Text>}
          {dif != null ? (dif === 0
            ? <Chapa variante="success" texto="cuadra" />
            : <Chapa variante={dif < 0 ? 'danger' : 'warning'} texto={`${dif > 0 ? '+' : ''}${dif}${it.costo ? ` · ${formatMoney(Math.abs(dif) * Number(it.costo))}` : ''}`} />)
            : it.contado != null ? <Chapa variante="success" texto="✓ contado" /> : null}
        </View>
      </View>
    </Ficha>
  );
}

export default function Conteo({ puedeVender, puedeConfigurar, buscar }) {
  const [conteos, setConteos] = useState([]);
  const [conteo, setConteo] = useState(null);
  const [bajas, setBajas] = useState([]);
  const [lotes, setLotes] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [nota, setNota] = useState('');
  const [soloSinContar, setSoloSinContar] = useState('todos');
  const [producto, setProducto] = useState(null);
  const [escaneando, setEscaneando] = useState(false);
  const [pidiendoBaja, setPidiendoBaja] = useState(false);

  const cargar = useCallback(async () => {
    setError('');
    try {
      const [cs, bs, ls, cat] = await Promise.all([fetchConteos(), fetchBajas(), fetchLotes(), fetchCatalogo().catch(() => [])]);
      setConteos(cs); setBajas(bs); setLotes(ls.filter((l) => l.existencia > 0 && !l.en_camion_de)); setCatalogo(cat);
      const abierto = cs.find((c) => c.estado === 'abierto');
      setConteo(abierto ? await fetchConteo(abierto.id) : null);
    } catch (e) {
      setError(mensajeDeDistribucion(e));
    } finally {
      setCargado(true);
    }
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const items = useMemo(() => renglonesDeConteo(conteo, { buscar, soloSinContar: soloSinContar === 'sin', producto: producto?.product_id ?? null }),
    [conteo, buscar, soloSinContar, producto]);
  const dif = useMemo(() => resumenDeConteo(conteo), [conteo]);
  const pendientes = bajas.filter((b) => b.estado === 'pendiente');
  const anteriores = conteos.filter((c) => c.estado !== 'abierto').slice(0, 3);
  const abierto = conteo?.estado === 'abierto';

  const contarRenglon = async (it) => {
    const v = await pedirTexto(`${it.nombre}`, `Lote ${it.lote}. ¿Cuántas unidades hay? (puede ser 0)`, 'Guardar',
      { teclado: 'number-pad', inicial: it.contado != null ? String(it.contado) : '' });
    if (v == null) return;
    const n = leerEntero(v);
    if (n == null) { fallo('Número no válido', 'Escribe un número entero de unidades.'); return; }
    if (n === it.contado) return;
    try {
      await contar(it.id, n);
      setConteo((c) => ({ ...c, items: c.items.map((x) => (x.id === it.id ? { ...x, contado: n } : x)) }));
      listo('Contado', `${it.nombre} · ${formatQty(n)}`);
    } catch (e) {
      fallo('No se pudo guardar', mensajeDeDistribucion(e));
    }
  };

  const alEscanear = async (codigo) => {
    const p = productoPorCodigo(catalogo, codigo);
    if (!p) { fallo('Código sin producto', `${codigo} no es de ningún producto del catálogo de la distribuidora.`); return false; }
    const suyos = (conteo?.items ?? []).filter((it) => Number(it.product_id) === Number(p.product_id));
    if (!suyos.length) { fallo('No está en el conteo', `${p.nombre} no tiene lotes en este conteo.`); return false; }
    setEscaneando(false);
    setProducto({ product_id: p.product_id, nombre: p.nombre });
    if (suyos.length === 1) setTimeout(() => contarRenglon(suyos[0]), 400);
    return true;
  };

  const correr = async ({ clave, titulo, mensaje, boton, destructivo, fn, ok }) => {
    if (!(await confirmar(titulo, mensaje, boton, { destructivo }))) return;
    setOcupado(clave);
    trabajando(`${boton}…`);
    try { const r = await fn(); await ok?.(r); await cargar(); } catch (e) { fallo('No se pudo', mensajeDeDistribucion(e)); } finally { setOcupado(''); }
  };
  const audit = (accion, id, det) => useStaffStore.getState().appendAuditLog?.(accion, String(id), { ...det, desde: 'app' });

  const iniciar = () => correr({
    clave: 'iniciar', titulo: '¿Iniciar el conteo?', mensaje: 'Se congela lo que dice el sistema de cada lote y se cuenta a ciegas.', boton: 'Iniciar',
    fn: () => iniciarConteo(null, nota.trim()),
    ok: (id) => { audit('DISTRIBUCION_CONTEO_INICIADO', id, { nota: nota.trim() }); setNota(''); listo('Conteo iniciado'); },
  });
  const cerrar = () => correr({
    clave: 'cerrar', titulo: '¿Cerrar y ajustar?',
    mensaje: `Se ajustan los lotes contados que no cuadran.${dif.total - dif.contados ? ` ${dif.total - dif.contados} sin contar no se tocan.` : ''} No se deshace.`,
    boton: 'Cerrar y ajustar', destructivo: true,
    fn: () => cerrarConteo(conteo.id, nota.trim()),
    ok: (r) => {
      audit('DISTRIBUCION_CONTEO_CERRADO', conteo.id, r);
      setNota('');
      listo('Conteo cerrado', `${r.ajustados} lotes ajustados · faltante ${formatMoney(Number(r.faltante))} · sobrante ${formatMoney(Number(r.sobrante))}${r.sin_contar ? ` · ${r.sin_contar} sin contar` : ''}`);
    },
  });
  const anular = () => correr({
    clave: 'anular', titulo: '¿Anular el conteo?', mensaje: `No se ajusta nada. Motivo: ${nota.trim()}`, boton: 'Anular', destructivo: true,
    fn: () => anularConteo(conteo.id, nota.trim()),
    ok: () => { audit('DISTRIBUCION_CONTEO_ANULADO', conteo.id, { motivo: nota.trim() }); setNota(''); listo('Conteo anulado'); },
  });
  const aprobarBaja = (b) => correr({
    clave: `res-${b.id}`, titulo: '¿Aprobar la baja?', mensaje: `${b.products?.nombre} · lote ${b.dist_lotes?.lote} · ${b.unidades} u. Sale del lote.`, boton: 'Aprobar baja', destructivo: true,
    fn: () => resolverBaja(b.id, true, ''),
    ok: () => { audit('DISTRIBUCION_BAJA_APROBADA', b.id, { unidades: b.unidades }); listo('Baja aprobada'); },
  });
  const rechazarBaja = async (b) => {
    const motivo = await pedirTexto('Rechazar la baja', `${b.products?.nombre} · ${b.unidades} u. Escribe por qué (obligatorio).`, 'Rechazar');
    if (motivo == null) return;
    if (!motivo.trim()) { fallo('Falta el motivo', 'Para rechazar hay que decir por qué.'); return; }
    setOcupado(`res-${b.id}`);
    try {
      await resolverBaja(b.id, false, motivo.trim());
      audit('DISTRIBUCION_BAJA_RECHAZADA', b.id, { unidades: b.unidades });
      listo('Baja rechazada');
      await cargar();
    } catch (e) { fallo('No se pudo', mensajeDeDistribucion(e)); } finally { setOcupado(''); }
  };

  const grupos = abierto ? [
    { id: 'sin', titulo: 'Lotes', activa: soloSinContar, porDefecto: 'todos', onCambiar: setSoloSinContar, opciones: [{ id: 'todos', label: 'Todos' }, { id: 'sin', label: 'Sin contar' }] },
    ...(producto ? [{ id: 'prod', titulo: 'Producto', activa: 'uno', porDefecto: 'todos', onCambiar: () => setProducto(null), opciones: [{ id: 'todos', label: 'Todos' }, { id: 'uno', label: producto.nombre }] }] : []),
  ] : [];

  if (!cargado) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <View style={{ gap: 12 }}>
      <MenuDeFiltros grupos={grupos} extra={abierto && (puedeVender || puedeConfigurar) ? { icono: 'barcode.viewfinder', etiqueta: 'Escanear', onPress: () => setEscaneando(true) } : null} />
      <FiltrosActivos grupos={grupos} />
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <FilaDeKpis>
        <Kpi icono="ClipboardCheck" rotulo="Conteo" color={PETROLEO} valor={conteo ? `${formatQty(dif.contados)} / ${formatQty(dif.total)}` : 'Sin abrir'}
          apoyo={conteo ? 'lotes contados' : 'Nadie está contando'} />
        <Kpi icono="PackageMinus" rotulo="Bajas por aprobar" color={MARCA.rojo} valor={formatQty(pendientes.length)} pide={pendientes.length > 0}
          apoyo={`aprobadas: ${formatMoney(valorDeBajas(bajas))}`} />
      </FilaDeKpis>
      {conteo?.ve_sistema ? (
        <FilaDeKpis>
          <Kpi icono="AlertTriangle" rotulo="Diferencias" color={MARCA.ambar} valor={formatQty(dif.conDif)} pide={dif.conDif > 0}
            apoyo={`faltante ${formatMoney(dif.faltante)} · sobrante ${formatMoney(dif.sobrante)}`} />
        </FilaDeKpis>
      ) : null}

      <View style={{ marginHorizontal: 16 }}>
        <Seccion titulo="Conteo físico" pie={conteo ? `Abierto por ${shortEmployeeName(conteo.creado_por)}${conteo.nota ? ` · ${conteo.nota}` : ''}` : null}>
          {!conteo ? (puedeConfigurar ? (
            <>
              <Campo multiline={false} value={nota} onChangeText={setNota} placeholder="Nota (opcional): conteo de fin de mes" />
              <BotonGrande texto={ocupado === 'iniciar' ? 'Iniciando…' : 'Iniciar conteo'} color={PETROLEO} onPress={iniciar} deshabilitado={!!ocupado} />
            </>
          ) : <Aviso texto="No hay conteo abierto. Lo inicia quien administra." />) : (
            <>
              {!conteo.ve_sistema ? <Aviso texto="Cuenta lo que hay en cada lote. No se muestra lo que dice el sistema, a propósito." /> : null}
              <Aviso texto={(puedeVender || puedeConfigurar) ? 'Toca un lote para anotar lo contado, o escanea la caja con el botón de arriba.' : 'Sólo lectura.'} />
            </>
          )}
        </Seccion>
      </View>

      {conteo ? (items.length === 0
        ? <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginVertical: 12 }}>{soloSinContar === 'sin' ? 'Todo está contado.' : 'Ningún lote coincide.'}</Text>
        : items.map((it) => <Renglon key={it.id} it={it} veSistema={conteo.ve_sistema} abierto={abierto && (puedeVender || puedeConfigurar)} onContar={contarRenglon} />)
      ) : null}

      {conteo && puedeConfigurar ? (
        <View style={{ marginHorizontal: 16 }}>
          <Seccion titulo="Cerrar el conteo">
            <Campo multiline={false} value={nota} onChangeText={setNota} placeholder="Nota del cierre (o motivo para anular)" />
            <BotonGrande texto={ocupado === 'cerrar' ? 'Cerrando…' : `Cerrar y ajustar${dif.total - dif.contados ? ` (${dif.total - dif.contados} sin contar)` : ''}`}
              color={PETROLEO} onPress={cerrar} deshabilitado={!dif.contados || !!ocupado} />
            <BotonGrande borde texto="Anular" color={MARCA.rojo} onPress={anular} deshabilitado={!nota.trim() || !!ocupado} />
          </Seccion>
        </View>
      ) : null}

      {anteriores.length ? (
        <View style={{ marginHorizontal: 16 }}>
          <Seccion titulo="Conteos anteriores">
            {anteriores.map((c) => (
              <Text key={c.id} style={{ color: colorSistema.texto2, fontSize: 14 }}>
                {`${fechaNumerica(c.created_at)} · ${c.estado === 'anulado' ? `anulado: ${c.nota}` : `${c.resumen?.ajustados ?? 0} ajustes · faltante ${formatMoney(Number(c.resumen?.faltante ?? 0))} · sobrante ${formatMoney(Number(c.resumen?.sobrante ?? 0))}`}`}
              </Text>
            ))}
          </Seccion>
        </View>
      ) : null}

      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 32, marginTop: 8 }}>Bajas</Text>
      {(puedeVender || puedeConfigurar) ? (
        <View style={{ marginHorizontal: 16 }}>
          <BotonGrande borde texto="Pedir una baja" color={MARCA.rojo} onPress={() => setPidiendoBaja(true)} deshabilitado={!lotes.length} />
        </View>
      ) : null}
      {bajas.length === 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center' }}>Sin bajas.</Text> : bajas.slice(0, 20).map((b) => (
        <Ficha key={b.id}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{b.products?.nombre}</Text>
            <Chapa variante={b.estado === 'aprobada' ? 'danger' : b.estado === 'rechazada' ? 'neutral' : 'warning'} texto={estadoDeBaja(b, formatMoney)} />
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Lote ${b.dist_lotes?.lote} · ${b.unidades} u · ${rotuloMotivoBaja(b.motivo)}`}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {`${b.detalle} · pidió ${shortEmployeeName(b.solicitante?.name)} el ${fechaNumerica(b.created_at)}${b.nota_resolucion ? ` · ${b.nota_resolucion}` : ''}`}
          </Text>
          {b.estado === 'pendiente' && puedeConfigurar ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <Pressable disabled={!!ocupado} onPress={() => rechazarBaja(b)} style={({ pressed }) => ({ flex: 1, minHeight: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colorSistema.texto2, alignItems: 'center', justifyContent: 'center', opacity: pressed || ocupado ? 0.6 : 1 })}>
                <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>Rechazar</Text>
              </Pressable>
              <Pressable disabled={!!ocupado} onPress={() => aprobarBaja(b)} style={({ pressed }) => ({ flex: 1, minHeight: 44, borderRadius: 22, backgroundColor: MARCA.rojo, alignItems: 'center', justifyContent: 'center', opacity: pressed || ocupado ? 0.6 : 1 })}>
                {ocupado === `res-${b.id}` ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Aprobar baja</Text>}
              </Pressable>
            </View>
          ) : null}
        </Ficha>
      ))}

      <Escaner visible={escaneando} titulo="Contar escaneando" ayuda="Apunta al código de barras de la caja." onCodigo={alEscanear} onCerrar={() => setEscaneando(false)} />
      {pidiendoBaja ? (
        <PedirBaja lotes={lotes} puedeConfigurar={puedeConfigurar} onCerrar={() => setPidiendoBaja(false)}
          onGuardado={() => { setPidiendoBaja(false); cargar(); }} />
      ) : null}
    </View>
  );
}
