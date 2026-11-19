// Las pestañas «Productos erróneos», «Por llegar» y «Registro» de Cargar
// compra, NATIVAS — las de `CargarCompraPestanas.jsx` del portal, con las
// mismas consultas y acciones del núcleo (`@nucleo/data/cargarCompra`), los
// mismos frenos y la misma bitácora.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  adjuntarNotaAFaltante, adjuntarNotaDeCredito, adjuntarNotaEnPapel, adjuntarNotaEnPapelAFaltante, comprobarSalidaErroneo,
  comprobarSalidaFaltante, darSalidaErroneo, darSalidaFaltante, deshacerErroneo, erroneoYaEnVencidos, fetchErroneos,
  fetchPorLlegar, fetchRegistroDeCompras, marcarPorLlegar,
} from '@nucleo/data/cargarCompra';
import { useStaffStore } from '@nucleo/store/staffStore';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Cargando, Opciones, Vacio } from '../formulario/Piezas';
import Fecha from '../formulario/Fecha';
import RangoDeFechas from '../formulario/RangoDeFechas';
import { Pildora } from '../avisos/Piezas';
import { compartirCsv } from '../fiscal/csv';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando, cerrarProgreso } from '../Progreso';
import { Accion, Cuenta, Rotulo, colorDe } from './carga';

const POR_PAGINA = 40;
const DIAS_PARA_RECLAMAR = 15;

const ESTADO_POR_LLEGAR = {
  por_llegar: ['Por llegar', 'ambar'], reclamar: ['Pedir nota', 'rojo'], llego: ['Llegó', 'verde'],
  con_nota: ['Con nota de crédito', 'verde'], saliendo: ['Saliendo…', 'ambar'], sin_verificar: ['Comprobar si salió', 'rojo'],
  nota_credito: ['Salió con su nota', 'gris'],
};
const ESTADO_ERRONEO = {
  por_mover: ['Por pasar a vencidos', 'ambar'], en_vencidos: ['En vencidos · falta nota', 'azul'], con_nota: ['Con nota de crédito', 'verde'],
  saliendo: ['Saliendo…', 'ambar'], salio: ['Ya salió', 'gris'], sin_verificar: ['Comprobar si salió', 'rojo'], deshaciendo: ['Volviendo al estante…', 'ambar'],
};
const LIBRO_PAPEL = {
  enviando: 'registrándose en el libro…', registrada: 'ya está en el libro de compras',
  sin_verificar: 'se mandó al libro y no se pudo comprobar. Revísala', fallida: 'el libro no la aceptó',
};
const TIPO_REGISTRO = { regalo: ['Regalo', 'azul'], erroneo: ['Erróneo', 'ambar'], consumo: ['Consumo', 'gris'] };
const EN_SISTEMA = { cuadra: ['Cuadra', 'verde'], difiere: ['Difiere', 'rojo'], sin_copia: ['Pendiente', 'gris'] };
const pct = (a, b) => (a > 0 && b > 0 ? (b - a) / a * 100 : null);
const noPermiso = (e) => (e === 'FORBIDDEN' ? 'No tienes permiso para adjuntar la nota.' : e);

function Tarjeta({ children }) {
  return <View style={{ marginHorizontal: 16 }}><Vidrio radio={20}><View style={{ padding: 14, gap: 6 }}>{children}</View></Vidrio></View>;
}
const Linea = ({ children, color, fuerte }) => <Text style={{ color: color ?? colorSistema.texto2, fontSize: 13, fontWeight: fuerte ? '700' : '400' }}>{children}</Text>;

/** La nota de crédito en papel: se escribe lo que dice el papel; el total se calcula. */
function NotaEnPapel({ fila, adjuntar, onListo, onCancelar }) {
  const [n, setN] = useState({ serie: '', numero: '', fecha: '', subtotal: '', iva: '' });
  const [guardando, setG] = useState(false);
  const poner = (k) => (v) => setN((x) => ({ ...x, [k]: k === 'subtotal' || k === 'iva' ? String(v).replace(/[^\d.]/g, '') : v }));
  const total = Math.round(((Number(n.subtotal) || 0) + (Number(n.iva) || 0)) * 100) / 100;
  const listoParaGuardar = n.serie.trim() && n.numero.trim() && n.fecha && Number(n.subtotal) > 0 && Number(n.iva) > 0;
  const guardar = async () => {
    setG(true); trabajando('Adjuntando la nota…');
    const { error } = await adjuntar(fila.id, { ...n, subtotal: Number(n.subtotal), iva: Number(n.iva), total });
    setG(false);
    if (error) { fallo('No se pudo adjuntar', noPermiso(error)); return; }
    listo('Nota adjunta', `${n.numero} · ${formatMoney(total)}`);
    onListo();
  };
  return (
    <View style={{ gap: 8, paddingTop: 4 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}><Rotulo>Serie</Rotulo><Campo multiline={false} value={n.serie} onChangeText={poner('serie')} autoCapitalize="characters" /></View>
        <View style={{ flex: 1, gap: 4 }}><Rotulo>Número</Rotulo><Campo multiline={false} value={n.numero} onChangeText={poner('numero')} /></View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Rotulo>Fecha</Rotulo><Fecha valor={n.fecha} onCambiar={poner('fecha')} hasta={hoySV()} /></View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}><Rotulo>Subtotal ($)</Rotulo><Campo multiline={false} keyboardType="decimal-pad" value={n.subtotal} onChangeText={poner('subtotal')} /></View>
        <View style={{ flex: 1, gap: 4 }}><Rotulo>IVA ($)</Rotulo><Campo multiline={false} keyboardType="decimal-pad" value={n.iva} onChangeText={poner('iva')} /></View>
      </View>
      <Text style={{ color: colorSistema.texto, fontSize: 15, fontVariant: ['tabular-nums'] }}>{`Total ${formatMoney(total)}`}</Text>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <Accion texto="Adjuntar nota en papel" ocupado={guardando} deshabilitado={!listoParaGuardar} onPress={guardar} />
        <Accion texto="Cancelar" color={colorSistema.texto2} onPress={onCancelar} />
      </View>
    </View>
  );
}

/** La nota que trae una fila (electrónica o en papel) y su estado en el libro. */
function NotaAdjunta({ f }) {
  const libro = LIBRO_PAPEL[f.nota_papel?.estado];
  return (
    <Linea color={colorSistema.texto}>
      {`Nota de crédito${f.nota_papel ? ' en papel' : ''} ${f.nota_papel?.serie ? `${f.nota_papel.serie} · ` : ''}${f.nota_numero} · ${fechaNumerica(f.nota_fecha)} · ${formatMoney(f.nota_total)}`}
      {libro ? <Text style={{ color: f.nota_papel.estado === 'registrada' ? colorSistema.texto2 : MARCA.ambar, fontWeight: f.nota_papel.estado === 'registrada' ? '400' : '700' }}>{` · ${libro}${f.nota_papel.error ? `: ${f.nota_papel.error}` : ''}`}</Text> : null}
    </Linea>
  );
}

/** Elegir una nota electrónica del proveedor, o abrir la de papel. */
function ElegirNota({ f, elegida, onElegir, onAdjuntar, onPapel, ocupado }) {
  const candidatas = f.notas_candidatas ?? [];
  // Se propone sólo la nota que dice corregir ESTA factura; otra se elige a mano.
  const relacionada = candidatas.find((x) => x.relacionada);
  const nota = elegida ?? (relacionada ? String(relacionada.id) : '');
  return (
    <View style={{ gap: 4 }}>
      {candidatas.length ? (
        <>
          <Opciones valor={nota} onCambiar={onElegir} opciones={candidatas.map((x) => ({ id: String(x.id),
            label: `${x.numero ?? x.id} · ${fechaNumerica(x.fecha)} · ${formatMoney(x.total)}`, detalle: x.relacionada ? 'de esta factura' : null }))} />
          <Accion texto="Adjuntar nota" ocupado={ocupado} deshabilitado={!nota} onPress={() => onAdjuntar(nota)} />
        </>
      ) : <Linea>Todavía no llega ninguna nota de crédito electrónica de este proveedor.</Linea>}
      <Accion texto="La nota vino en papel" onPress={onPapel} />
    </View>
  );
}

/* ─── Productos erróneos ─────────────────────────────────────────────────── */
export function PestanaErroneos({ puedeEditar, pausada }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [elegida, setEleg] = useState({});
  const [guardando, setG] = useState(null);
  const [enPapel, setEnPapel] = useState(null);
  const cargar = useCallback(async () => {
    const { filas: f, error: e } = await fetchErroneos();
    if (e) setError(e);
    setFilas(f);
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const adjuntar = async (fila, nota) => {
    setG(fila.id);
    const { error: e } = await adjuntarNotaDeCredito(fila.id, nota);
    setG(null);
    if (e) { fallo('No se pudo', noPermiso(e)); return; }
    useStaffStore.getState().appendAuditLog(nota ? 'COMPRA_ERRONEO_NOTA_ADJUNTA' : 'COMPRA_ERRONEO_NOTA_QUITADA', String(fila.id), {
      nota, descripcion: fila.descripcion, proveedor: fila.emisor_nombre, desde: 'app',
    });
    cargar();
  };
  const conSistema = async (fila, fn) => {
    setG(fila.id); setError('');
    const { error: e } = await fn(fila.id);
    setG(null);
    if (e) setError(e);
    cargar();
  };
  const darSalida = (fila) => Alert.alert('Dar salida', `Se registra la nota de crédito ${fila.nota_numero} en el libro de compras y se descargan ${Number(fila.unidades)} unidades de «${fila.descripcion}» de Bodega de vencidos. No se puede deshacer.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Dar salida', onPress: async () => {
      setG(fila.id); setError(''); trabajando('Dando salida…');
      const { resultado, error: e } = await darSalidaErroneo(fila.id);
      setG(null); cerrarProgreso();
      if (e) setError(e);
      else if (!resultado?.comprobado) setError('Se le dio salida, pero la existencia de vencidos no bajó lo esperado. Revísala.');
      else listo('Salida registrada', fila.descripcion);
      cargar();
    } },
  ]);
  const deshacer = (fila) => Alert.alert('No era error', `${Number(fila.unidades)} ${Number(fila.unidades) === 1 ? 'unidad' : 'unidades'} de «${fila.descripcion}» vuelven de Bodega de vencidos al estante y el producto sale de esta lista. La compra no cambia.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Devolver al estante', onPress: async () => {
      setG(fila.id); setError(''); trabajando('Devolviendo al estante…');
      const { error: e } = await deshacerErroneo(fila.id);
      setG(null); cerrarProgreso();
      if (e) setError(e); else listo('Vuelve al estante', fila.descripcion);
      cargar();
    } },
  ]);

  if (!filas) return <Cargando />;
  return (
    <View style={{ gap: 12 }}>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <View style={{ marginHorizontal: 16 }}><Aviso texto="Lo que un proveedor mandó por error. Entra con su compra, pasa a Bodega de vencidos y espera la nota de crédito. Si no está en el catálogo, en Bodega sale como «PRODUCTO ERRONEO DE PROVEEDOR». Aquí ves qué era." /></View>
      {pausada && puedeEditar ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto="Con las compras en pausa no se da salida ni se devuelve al estante." /></View> : null}
      {!filas.length ? <Vacio titulo="No hay productos erróneos." tono="bien" /> : filas.map((f) => {
        const [estRot, estTono] = ESTADO_ERRONEO[f.estado] ?? ESTADO_ERRONEO.por_mover;
        const ocupado = guardando === f.id;
        return (
          <Tarjeta key={f.id}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{f.descripcion}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Pildora texto={f.motivo ? `A vencidos · ${f.motivo}` : 'Error del proveedor'} color={f.motivo ? MARCA.azulClaro : MARCA.ambar} />
              <Pildora texto={estRot} color={colorDe(estTono)} />
            </View>
            <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{`${Number(f.unidades)} u · ${formatMoney(Number(f.unidades) * Number(f.costo_unitario))}`}</Text>
            <Linea>{[`${f.emisor_nombre}`, `factura ${f.factura} (${fechaNumerica(f.factura_fecha)})`, f.erp_compra_id ? `compra ${f.erp_compra_id}` : null, f.es_generico ? 'en Bodega como PRODUCTO ERRONEO DE PROVEEDOR' : null].filter(Boolean).join(' · ')}</Linea>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Avatar empleado={{ id: f.marcado_por, name: f.marcado_nombre }} tamano={20} />
              <Linea>{[shortEmployeeName(f.marcado_nombre ?? ''), fechaNumerica(f.created_at), f.erp_traslado_id ? `traslado ${f.erp_traslado_id}` : null].filter(Boolean).join(' · ')}</Linea>
            </View>
            {f.nota ? <Linea color={MARCA.ambar} fuerte>{f.nota}</Linea> : null}
            {puedeEditar && !f.en_vencidos_at && f.erp_traslado_id && !['salio', 'saliendo', 'sin_verificar'].includes(f.estado)
              ? <Accion texto="Ya se recibió en vencidos" ocupado={ocupado} onPress={() => conSistema(f, erroneoYaEnVencidos)} /> : null}
            {(f.nota_credito_document_id || f.nota_papel_id) ? (
              <View style={{ gap: 2 }}>
                <NotaAdjunta f={f} />
                {puedeEditar ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
                    {f.estado === 'con_nota' ? <Accion texto="Quitar" color={colorSistema.texto2} deshabilitado={ocupado} onPress={() => adjuntar(f, null)} /> : null}
                    {f.estado === 'con_nota' && f.en_vencidos_at ? <Accion texto="Dar salida" ocupado={ocupado} deshabilitado={pausada} onPress={() => darSalida(f)} /> : null}
                    {f.estado === 'sin_verificar' ? <Accion texto="Comprobar" ocupado={ocupado} onPress={() => conSistema(f, comprobarSalidaErroneo)} /> : null}
                  </View>
                ) : null}
              </View>
            ) : puedeEditar && enPapel === f.id ? (
              <NotaEnPapel fila={f} adjuntar={adjuntarNotaEnPapel} onCancelar={() => setEnPapel(null)} onListo={() => { setEnPapel(null); cargar(); }} />
            ) : puedeEditar ? (
              <>
                <ElegirNota f={f} elegida={elegida[f.id]} ocupado={ocupado} onElegir={(v) => setEleg((x) => ({ ...x, [f.id]: v }))}
                  onAdjuntar={(nota) => adjuntar(f, nota)} onPapel={() => setEnPapel(f.id)} />
                {f.estado === 'en_vencidos' && f.en_vencidos_at && !f.motivo
                  ? <Accion texto="No era error" color={colorSistema.texto2} deshabilitado={ocupado || pausada} onPress={() => deshacer(f)} /> : null}
              </>
            ) : null}
          </Tarjeta>
        );
      })}
    </View>
  );
}

/* ─── Por llegar ─────────────────────────────────────────────────────────── */
export function PestanaPorLlegar({ puedeEditar, pausada, busca }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setG] = useState(null);
  const [elegida, setEleg] = useState({});
  const [enPapel, setEnPapel] = useState(null);
  const cargar = useCallback(async () => {
    const { filas: f, error: e } = await fetchPorLlegar();
    if (e) setError(e);
    setFilas(f);
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const accion = async (f, fn) => {
    setG(f.id); setError('');
    const { error: e } = await fn();
    setG(null);
    if (e) setError(e);
    cargar();
  };
  const marcar = (f, estado) => accion(f, () => marcarPorLlegar(f.id, estado));
  const darSalida = (f) => Alert.alert('Dar salida', `Se registra la nota de crédito ${f.nota_numero} en el libro de compras y se descargan ${Number(f.faltan)} unidades de «${f.producto ?? f.descripcion_proveedor}» de Bodega. No se puede deshacer.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Dar salida', onPress: async () => {
      setG(f.id); setError(''); trabajando('Dando salida…');
      const { resultado, error: e } = await darSalidaFaltante(f.id);
      setG(null); cerrarProgreso();
      if (e) setError(e);
      else if (!resultado?.comprobado) setError('Se le dio salida, pero la existencia de Bodega no bajó lo esperado. Revísala.');
      else listo('Salida registrada', f.producto ?? f.descripcion_proveedor);
      cargar();
    } },
  ]);
  const vista = useMemo(() => (filas ?? []).filter((f) => !busca?.trim()
    || tokenMatch(busca, f.producto ?? '', f.descripcion_proveedor ?? '', f.proveedor_nombre ?? '', f.numero_documento ?? '')), [filas, busca]);
  const abiertos = vista.filter((f) => f.abierto);
  const monto = abiertos.reduce((t, f) => t + Number(f.monto || 0), 0);

  if (!filas) return <Cargando />;
  return (
    <View style={{ gap: 12 }}>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16 }}>
        <Cuenta rotulo="Pendiente" valor={abiertos.length} sub="productos" color={abiertos.length ? MARCA.ambar : undefined} />
        <Cuenta rotulo="Monto" valor={formatMoney(monto)} sub="que se espera" />
      </View>
      <View style={{ marginHorizontal: 16 }}><Aviso texto={`Lo que el proveedor cobró y no mandó. Se queda aquí hasta que llegue el producto o su nota de crédito. Con la nota, «Dar salida» la registra en el libro de compras y descarga de Bodega lo que faltó. A los ${DIAS_PARA_RECLAMAR} días sin llegar se marca para reclamar.`} /></View>
      {!vista.length ? <Vacio titulo="No hay nada por llegar." tono="bien" /> : vista.map((f) => {
        const [estRot, estTono] = ESTADO_POR_LLEGAR[f.estado] ?? ESTADO_POR_LLEGAR.por_llegar;
        const viejo = f.estado === 'por_llegar' && f.dias >= DIAS_PARA_RECLAMAR;
        const esperando = f.estado === 'por_llegar' || f.estado === 'reclamar';
        const ocupado = guardando === f.id;
        return (
          <Tarjeta key={f.id}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{f.producto ?? f.descripcion_proveedor}</Text>
            <Linea>{[f.proveedor_nombre, `${f.tipo_documento ?? ''} ${f.numero_documento?.slice(0, 8) ?? ''}`.trim(), fechaNumerica(f.fecha_documento), `hace ${f.dias} días`, f.erp_compra_id ? `compra ${f.erp_compra_id}` : null].filter(Boolean).join(' · ')}</Linea>
            <Text style={{ color: colorSistema.texto, fontSize: 14, fontVariant: ['tabular-nums'] }}>{`Faltan ${Number(f.faltan)} de ${Number(f.unidades)} · ${formatMoney(f.monto)}`}</Text>
            <View style={{ flexDirection: 'row' }}><Pildora texto={viejo ? `${f.dias} días: reclamar` : estRot} color={colorDe(viejo ? 'rojo' : estTono)} /></View>
            {f.nota ? <Linea color={MARCA.ambar} fuerte>{f.nota}</Linea> : null}
            {f.cambiado_por && !f.abierto ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Avatar empleado={{ id: f.cambiado_por, name: f.cambiado_por_nombre }} tamano={20} />
                <Linea>{`${shortEmployeeName(f.cambiado_por_nombre ?? '')} · ${fechaNumerica(String(f.cambiado_at).slice(0, 10))}`}</Linea>
              </View>
            ) : null}
            {puedeEditar && esperando ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
                <Accion texto="Llegó" color={MARCA.verde} ocupado={ocupado} onPress={() => marcar(f, 'llego')} />
                {f.estado === 'por_llegar' ? <Accion texto="Pedir nota de crédito" deshabilitado={ocupado} onPress={() => marcar(f, 'reclamar')} /> : null}
              </View>
            ) : null}
            {puedeEditar && f.estado === 'llego' ? <Accion texto="Deshacer" color={colorSistema.texto2} deshabilitado={ocupado} onPress={() => marcar(f, 'por_llegar')} /> : null}
            {(f.nota_credito_document_id || f.nota_papel_id) ? (
              <View style={{ gap: 2 }}>
                <NotaAdjunta f={f} />
                {puedeEditar ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
                    {f.estado === 'con_nota' ? <Accion texto="Quitar" color={colorSistema.texto2} deshabilitado={ocupado} onPress={() => accion(f, () => adjuntarNotaAFaltante(f.id, null))} /> : null}
                    {f.estado === 'con_nota' ? <Accion texto="Dar salida" ocupado={ocupado} deshabilitado={pausada} onPress={() => darSalida(f)} /> : null}
                    {f.estado === 'sin_verificar' ? <Accion texto="Comprobar" ocupado={ocupado} onPress={() => accion(f, () => comprobarSalidaFaltante(f.id))} /> : null}
                  </View>
                ) : null}
              </View>
            ) : puedeEditar && esperando && enPapel === f.id ? (
              <NotaEnPapel fila={f} adjuntar={adjuntarNotaEnPapelAFaltante} onCancelar={() => setEnPapel(null)} onListo={() => { setEnPapel(null); cargar(); }} />
            ) : puedeEditar && esperando ? (
              <ElegirNota f={f} elegida={elegida[f.id]} ocupado={ocupado} onElegir={(v) => setEleg((x) => ({ ...x, [f.id]: v }))}
                onAdjuntar={(nota) => accion(f, () => adjuntarNotaAFaltante(f.id, nota))} onPapel={() => setEnPapel(f.id)} />
            ) : null}
          </Tarjeta>
        );
      })}
    </View>
  );
}

/* ─── Registro ───────────────────────────────────────────────────────────── */
// Lo que el portal cargó, renglón por renglón, tal como viajó a Bodega. No se
// edita. «Comprobado» lo cruza contra la compra registrada.
export function PestanaRegistro({ busca }) {
  const [rango, setRango] = useState(() => ({ desde: sumarDias(hoySV(), -30), hasta: hoySV() }));
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [hasta, setHasta] = useState(POR_PAGINA);
  useEffect(() => {
    let vivo = true;
    setFilas(null); // eslint-disable-line react-hooks/set-state-in-effect -- vuelve a cargar al cambiar las fechas
    fetchRegistroDeCompras(rango.desde, rango.hasta).then(({ filas: f, error: e }) => {
      if (!vivo) return;
      setError(e ?? ''); setFilas(f);
    });
    return () => { vivo = false; };
  }, [rango]);
  const vista = useMemo(() => (filas ?? []).filter((f) => !busca?.trim()
    || tokenMatch(busca, f.producto ?? '', f.descripcion_proveedor ?? '', f.proveedor_nombre ?? '', f.numero_documento ?? '', f.lote ?? '')), [filas, busca]);
  const difieren = vista.filter((f) => f.en_sistema === 'difiere').length;

  // Las mismas 33 columnas que descarga el portal.
  const exportar = async () => {
    const n = (v) => (v == null ? '' : v);
    try {
      await compartirCsv({
        headers: ['Fecha', 'Tipo de factura', 'Numero de factura', 'Numero de control', 'NIT proveedor', 'Proveedor', 'Uso', 'Tipo',
          'ID producto', 'Producto', 'Codigo proveedor', 'Descripcion proveedor', 'Presentacion', 'Unidades por presentacion',
          'Cantidad', 'Unidades', 'Precio lista', 'Descuento producto', 'Descuento pie %', 'Costo presentacion',
          'Costo unidad', 'Costo anterior', 'Variacion costo %', 'Regular', 'Regular anterior', 'Lote', 'Vence',
          'Enviado a sucursales', 'Comprobado', 'Cargado por', 'Cargado el', 'Carga', 'Numero de compra'],
        rows: vista.map((f) => [
          f.fecha_documento, n(f.tipo_documento), n(f.numero_documento), n(f.numero_control), n(f.proveedor_nit), n(f.proveedor_nombre),
          n(f.uso), f.tipo, n(f.erp_product_id), n(f.producto), n(f.codigo_proveedor), n(f.descripcion_proveedor), n(f.presentacion),
          n(f.unidades_por_presentacion), n(f.cantidad), n(f.unidades), n(f.precio_lista), n(f.descuento_renglon), n(f.descuento_pie_pct),
          n(f.costo), n(f.costo_unidad), n(f.costo_anterior), n(pct(f.costo_anterior, f.costo)?.toFixed(2)),
          n(f.vineta), n(f.vineta_anterior), n(f.lote), n(f.vence),
          f.reparto ? Object.values(f.reparto).reduce((a, b) => a + Number(b), 0) : '',
          n(EN_SISTEMA[f.en_sistema]?.[0]), shortEmployeeName(f.cargado_por_nombre ?? ''), n(f.cargado_at), f.carga_id, n(f.erp_compra_id),
        ]),
        nombre: `registro-de-compras-${rango.desde}-a-${rango.hasta}`, modulo: 'cargar_compra', detalle: { desde: rango.desde, hasta: rango.hasta },
      });
    } catch (e) { fallo('No se pudo compartir', e?.message || ''); }
  };

  return (
    <View style={{ gap: 12 }}>
      <RangoDeFechas desde={rango.desde} hasta={rango.hasta} onCambiar={setRango} />
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {difieren > 0 ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={`${difieren === 1 ? 'Un producto tiene' : `${difieren} productos tienen`} cantidad o costo distintos a la compra registrada en Bodega. Revísalo.`} /></View> : null}
      <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Descargar CSV" borde deshabilitado={!vista.length} onPress={exportar} /></View>
      {filas == null ? <Cargando /> : !vista.length ? <Vacio titulo="Sin compras cargadas desde el portal en estas fechas" /> : vista.slice(0, hasta).map((f) => {
        const dC = pct(f.costo_anterior, f.costo);
        const dV = pct(f.vineta_anterior, f.vineta);
        const tipo = TIPO_REGISTRO[f.tipo];
        const sis = EN_SISTEMA[f.en_sistema];
        return (
          <Tarjeta key={`${f.carga_id}-${f.renglon}`}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{f.producto ?? f.descripcion_proveedor}</Text>
            <Linea>{[fechaNumerica(f.fecha_documento), f.proveedor_nombre, f.presentacion].filter(Boolean).join(' · ')}</Linea>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {tipo ? <Pildora texto={tipo[0]} color={colorDe(tipo[1])} /> : null}
              {sis ? <Pildora texto={sis[0]} color={colorDe(sis[1])} /> : null}
            </View>
            <Text style={{ color: colorSistema.texto, fontSize: 14, fontVariant: ['tabular-nums'] }}>
              {`${Number(f.unidades ?? 0)} u · ${f.costo_unidad != null ? formatMoney(f.costo_unidad) : '—'} c/u`}
              {dC != null && Math.abs(dC) >= 0.5 ? <Text style={{ color: dC > 0 ? MARCA.rojo : MARCA.verde, fontWeight: '700' }}>{` ${dC > 0 ? '+' : ''}${dC.toFixed(1)} %`}</Text> : null}
            </Text>
            <Linea>
              {`Regular ${f.vineta != null ? formatMoney(f.vineta) : '—'}`}
              {dV != null && Math.abs(dV) >= 0.5 ? <Text style={{ color: MARCA.ambar, fontWeight: '700' }}>{` · antes ${formatMoney(f.vineta_anterior)}`}</Text> : null}
            </Linea>
            <Linea>{`${f.lote ?? 'sin lote'} · ${f.vence ? f.vence.slice(0, 7) : (f.vence_pendiente ? 'la pone la sucursal' : 'sin vencimiento')}`}</Linea>
            {f.cargado_por ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Avatar empleado={{ id: f.cargado_por, name: f.cargado_por_nombre }} tamano={20} />
                <Linea>{shortEmployeeName(f.cargado_por_nombre ?? '')}</Linea>
              </View>
            ) : null}
          </Tarjeta>
        );
      })}
      {vista.length > hasta ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto={`Ver más (${vista.length - hasta})`} borde onPress={() => setHasta((h) => h + POR_PAGINA)} /></View> : null}
    </View>
  );
}
