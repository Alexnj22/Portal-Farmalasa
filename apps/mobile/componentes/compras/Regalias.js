// Pestaña «Regalías» de Cargar compra en la app (gemela de
// src/views/purchases/RegaliasProveedor.jsx). El banco de regalías por
// proveedor: cada producto con su nivel compra + regalo, quién lo cambió y el
// historial, que no se borra. La carga lo usa para repartir la nota de
// crédito de descuento.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { fetchProveedoresParaRegalias, fetchRegaliasDeProveedor, guardarRegalia } from '@nucleo/data/cargarCompra';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Cargando, Vacio } from '../formulario/Piezas';
import { fallo, listo } from '../Progreso';

const POR_PAGINA = 40;
const nivel = (c, r) => (c != null && r != null ? `${c} + ${r}` : null);
function textoDelCambio(h) {
  const antes = nivel(h.compra_antes, h.regalo_antes), despues = nivel(h.compra_despues, h.regalo_despues);
  if (h.accion === 'alta') return `Nueva: ${despues}`;
  if (h.accion === 'baja') return `Quitada (era ${antes})`;
  return `${antes} → ${despues}`;
}

function Tarjeta({ children }) {
  return <View style={{ marginHorizontal: 16 }}><Vidrio radio={20}><View style={{ padding: 14, gap: 6 }}>{children}</View></Vidrio></View>;
}
const Linea = ({ children }) => <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{children}</Text>;
function Quien({ id, nombre, cuando }) {
  if (!id) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Avatar empleado={{ id, name: nombre }} tamano={20} />
      <Linea>{[shortEmployeeName(nombre ?? ''), cuando ? fechaHora12(cuando) : null].filter(Boolean).join(' · ')}</Linea>
    </View>
  );
}

function Producto({ x, nit, puedeEditar, onGuardado }) {
  const [compra, setCompra] = useState(x.compra != null ? String(x.compra) : '');
  const [regalo, setRegalo] = useState(x.regalo != null ? String(x.regalo) : '');
  const [guardando, setG] = useState(false);
  const cambiado = compra !== String(x.compra ?? '') || regalo !== String(x.regalo ?? '');
  const guardar = async (quitar = false) => {
    if (!quitar && !(Number(compra) > 0 && Number(regalo) > 0)) { fallo('Regalía incompleta', 'Escribe cuántas se compran y cuántas van de regalo.'); return; }
    setG(true);
    const { ok, error } = await guardarRegalia({ nit, codigo: x.codigo, descripcion: x.descripcion ?? x.producto,
      compra: quitar ? null : Number(compra), regalo: quitar ? null : Number(regalo) });
    setG(false);
    if (!ok) { fallo('No se guardó la regalía', error ?? ''); return; }
    listo(quitar ? 'Regalía quitada' : 'Regalía guardada');
    onGuardado();
  };
  return (
    <Tarjeta>
      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{x.producto ?? 'Producto sin emparejar'}</Text>
      <Linea>{x.codigo}</Linea>
      {puedeEditar ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Campo multiline={false} keyboardType="number-pad" placeholder="Compra" value={compra} onChangeText={(v) => setCompra(v.replace(/\D/g, ''))} /></View>
          <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>+</Text>
          <View style={{ flex: 1 }}><Campo multiline={false} keyboardType="number-pad" placeholder="Regalo" value={regalo} onChangeText={(v) => setRegalo(v.replace(/\D/g, ''))} /></View>
        </View>
      ) : (
        <Text style={{ color: colorSistema.texto, fontSize: 14, fontVariant: ['tabular-nums'] }}>{nivel(x.compra, x.regalo) ?? 'Sin regalía'}</Text>
      )}
      {puedeEditar && cambiado ? <BotonGrande texto="Guardar" deshabilitado={guardando} onPress={() => guardar()} /> : null}
      {puedeEditar && !cambiado && x.compra != null ? <BotonGrande texto="Quitar regalía" borde deshabilitado={guardando} onPress={() => Alert.alert('Quitar regalía', `«${x.producto ?? x.codigo}» deja de tener la regalía ${x.compra} + ${x.regalo}. Queda en el historial.`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Quitar', style: 'destructive', onPress: () => guardar(true) }])} /> : null}
      {x.compra != null ? <Quien id={x.actualizado_por} nombre={x.actualizado_por_nombre} cuando={x.updated_at} /> : null}
    </Tarjeta>
  );
}

export function PestanaRegalias({ busca, puedeEditar }) {
  const [proveedores, setProveedores] = useState(null);
  const [prov, setProv] = useState(null);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [historial, setHistorial] = useState(false);
  const [hasta, setHasta] = useState(POR_PAGINA);

  useEffect(() => {
    fetchProveedoresParaRegalias().then(({ proveedores: p, error: e }) => { setError(e ?? ''); setProveedores(p); });
  }, []);
  const cargar = useCallback(async (nit) => {
    setDatos(null);
    const r = await fetchRegaliasDeProveedor(nit);
    setError(r.error ?? '');
    setDatos(r);
  }, []);
  useEffect(() => { if (prov) cargar(prov.nit); }, [prov, cargar]);

  const provs = useMemo(() => (proveedores ?? []).filter((p) => !busca?.trim() || tokenMatch(busca, p.nombre, p.nit)), [proveedores, busca]);
  const productos = useMemo(() => (datos?.productos ?? []).filter((x) => !busca?.trim() || tokenMatch(busca, x.producto ?? '', x.codigo)), [datos, busca]);
  const cambios = useMemo(() => (datos?.historial ?? []).filter((x) => !busca?.trim() || tokenMatch(busca, x.descripcion ?? '', x.codigo_proveedor)), [datos, busca]);

  if (!prov) {
    return (
      <View style={{ gap: 12 }}>
        <View style={{ marginHorizontal: 16 }}><Aviso texto="La regalía de cada producto se anota una vez. Cuando el proveedor manda las regalías en una nota de crédito, la carga baja el costo de cada producto con este nivel." /></View>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {proveedores == null ? <Cargando /> : !provs.length ? <Vacio titulo="Sin proveedores" /> : provs.slice(0, hasta).map((p) => (
          <View key={p.nit} style={{ marginHorizontal: 16 }}>
            <BotonGrande borde texto={p.regalias > 0 ? `${p.nombre} · ${p.regalias} con regalía` : p.nombre} onPress={() => { setProv(p); setHasta(POR_PAGINA); setHistorial(false); }} />
          </View>
        ))}
        {provs.length > hasta ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto={`Ver más (${provs.length - hasta})`} borde onPress={() => setHasta((h) => h + POR_PAGINA)} /></View> : null}
      </View>
    );
  }

  const conRegalia = (datos?.productos ?? []).filter((x) => x.compra != null).length;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ marginHorizontal: 16, gap: 8 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{prov.nombre}</Text>
        {datos ? <Linea>{`${conRegalia} de ${datos.productos.length} con regalía`}</Linea> : null}
        <BotonGrande borde texto="Otro proveedor" onPress={() => { setProv(null); setDatos(null); setHasta(POR_PAGINA); }} />
        <BotonGrande borde texto={historial ? 'Ver productos' : 'Ver historial'} onPress={() => { setHistorial((h) => !h); setHasta(POR_PAGINA); }} />
      </View>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {datos == null ? <Cargando /> : historial ? (
        !cambios.length ? <Vacio titulo="Sin cambios de regalías para este proveedor" /> : cambios.slice(0, hasta).map((h) => (
          <Tarjeta key={h.id}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{h.descripcion ?? h.codigo_proveedor}</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 14, fontVariant: ['tabular-nums'] }}>{textoDelCambio(h)}</Text>
            <Linea>{fechaHora12(h.created_at)}</Linea>
            <Quien id={h.cambiado_por} nombre={h.cambiado_por_nombre} />
          </Tarjeta>
        ))
      ) : (
        !productos.length ? <Vacio titulo="Este proveedor no tiene productos emparejados" /> : productos.slice(0, hasta).map((x) => (
          <Producto key={`${x.codigo}-${x.compra}-${x.regalo}`} x={x} nit={prov.nit} puedeEditar={puedeEditar} onGuardado={() => cargar(prov.nit)} />
        ))
      )}
      {(historial ? cambios : productos).length > hasta ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto={`Ver más (${(historial ? cambios : productos).length - hasta})`} borde onPress={() => setHasta((h) => h + POR_PAGINA)} /></View> : null}
    </View>
  );
}
