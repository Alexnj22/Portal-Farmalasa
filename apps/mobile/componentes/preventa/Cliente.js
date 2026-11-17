// El cliente de la preventa — `Cliente`, `FichaDelCliente`, `SaldoDelCliente`
// e `Historial` de `PreventaView` del portal: buscarlo (nombre, DUI, NIT o
// teléfono), y elegido, su ficha: precio que le toca, categoría, programa y
// nivel; sus datos y lo que le falta (un toque abre su ficha para
// completarlo); sus puntos y cuánto compró en el año; lo que suele llevar y sus
// últimas compras, todo agregable de un toque.
//
// Crear un cliente nuevo todavía no es nativo en la app (la ficha nueva vive en
// el portal): «Crear cliente» abre esa pantalla del portal.
import { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { buscarClientes } from '@nucleo/data/customers';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { datosDeLoBuscado, esContribuyente } from '@nucleo/utils/clienteValidacion';
import {
  NOMBRE_DE_PROGRAMA, datosQueFaltan, descuentoDePuntos, nombreDeComprobante, nombreDeLista, porQueEsaLista,
} from '@nucleo/utils/preventaDirecta';
import Vidrio from '../Vidrio';
import ConAurora from '../ConAurora';
import EncabezadoDeHoja from '../EncabezadoDeHoja';
import Avatar from '../Avatar';
import { colorSistema } from '../Formulario';
import { Campo } from '../formulario/Piezas';
import { Presionable as Pressable } from '../Tocable';
import { MARCA } from '../inicio/marca';
import { Anillo, Pildora } from '../avisos/Piezas';
import { BotonChico, Miniatura } from './Linea';

const abrirFicha = (id) => router.push({ pathname: '/cliente/[id]', params: { id: String(id) } });

function Resultado({ x, onElegir }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onElegir(x); }} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
      <Avatar empleado={{ name: x.name }} tamano={36} pendientes={false} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{x.name}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>
          {[x.nit && `NIT ${x.nit}`, !x.nit && x.dui && `DUI ${x.dui}`, x.nrc && `NRC ${x.nrc}`, x.phone].filter(Boolean).join(' · ') || 'Sin datos'}
        </Text>
      </View>
      {x.categoria && x.categoria !== 'Consumidor' ? <Pildora texto={x.categoria} color={MARCA.azulInfo} /> : null}
    </Pressable>
  );
}

function Buscar({ lista, puedeCrear, onElegir }) {
  const [texto, setTexto] = useState('');
  const q = useTextoRebotado(texto, 250);
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  useEffect(() => {
    let vivo = true;
    if (q.trim().length < 3) { setResultados([]); setBuscando(false); return undefined; }
    setBuscando(true);
    buscarClientes(q, { select: 'id, name, dui, nit, nrc, phone, categoria', limite: 6 }).then(({ data, error }) => {
      if (!vivo) return;
      setBuscando(false);
      if (error) console.error('preventa: no se pudo buscar el cliente', error);
      setResultados(data ?? []);
    });
    return () => { vivo = false; };
  }, [q]);
  const noAparece = !buscando && q.trim().length >= 3 && !resultados.length;
  const d = datosDeLoBuscado(q);
  return (
    <View style={{ gap: 8 }}>
      <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Nombre, DUI, NIT o teléfono" autoCorrect={false}
        clearButtonMode="while-editing" accessibilityLabel="Buscar cliente" />
      {resultados.map((x, i) => (
        <View key={x.id} style={{ borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
          <Resultado x={x} onElegir={(c) => { setTexto(''); onElegir(c); }} />
        </View>
      ))}
      <Text style={{ color: colorSistema.texto2, fontSize: 13, lineHeight: 18 }}>
        {buscando ? 'Buscando…' : noAparece ? `No aparece «${q.trim()}».`
          : `Sin cliente va como frecuente, con precio ${nombreDeLista(lista ?? 'descuento_1')}. Con cliente gana su precio y sus puntos.`}
      </Text>
      {puedeCrear && noAparece ? (
        <BotonChico texto={d.dui ? `Crear cliente con DUI ${d.dui}` : d.phone ? `Crear cliente con teléfono ${d.phone}` : d.name ? `Crear «${d.name}»` : 'Crear cliente'}
          onPress={() => router.push({ pathname: '/portal', params: { ruta: '/clientes', nombre: 'Clientes' } })} />
      ) : null}
    </View>
  );
}

function Historial({ info, visible, onCerrar, onAgregar, onAgregarVarios }) {
  const frecuentes = info.frecuentes ?? [];
  const ultimas = info.ultimas_compras ?? [];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onCerrar}>
      <ConAurora>
        <EncabezadoDeHoja titulo="Últimas compras"
          subtitulo={`${info.name ?? ''} · ${info.compra_12m != null ? `${formatMoney(info.compra_12m)} en 12 meses` : 'sin compras en el año'}`} onCerrar={onCerrar} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }}>
          {frecuentes.length ? (
            <Vidrio radio={20}>
              <View style={{ padding: 14, gap: 4 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>Lo que más compra en el año</Text>
                {frecuentes.map((f, i) => (
                  <View key={f.producto_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    <Miniatura src={f.foto_url} tamano={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{f.nombre}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{f.veces} {f.veces === 1 ? 'vez' : 'veces'} · última {fechaTexto(f.ultima)}</Text>
                    </View>
                    <BotonChico texto="Agregar" onPress={() => onAgregar(f)} />
                  </View>
                ))}
              </View>
            </Vidrio>
          ) : null}
          {ultimas.map((u) => {
            const vendibles = (u.productos ?? []).filter((x) => x.activo && x.producto_id);
            return (
              <Vidrio key={u.id} radio={20}>
                <View style={{ padding: 14, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{fechaTexto(u.fecha)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{u.sucursal} · {nombreDeComprobante(u.tipo_documento)}</Text>
                    </View>
                    <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{formatMoney(Number(u.total))}</Text>
                  </View>
                  {(u.productos ?? []).map((x, i) => (
                    <View key={`${x.producto_id}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                      <Miniatura src={x.foto_url} tamano={32} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>{x.nombre}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{Number(x.cantidad)} {x.presentacion ?? ''}{x.activo ? '' : ' · ya no se vende'} · {formatMoney(Number(x.total ?? 0))}</Text>
                      </View>
                      {x.activo && x.producto_id ? <BotonChico texto="Agregar" onPress={() => onAgregar(x)} /> : null}
                    </View>
                  ))}
                  {vendibles.length > 1 ? <BotonChico texto="Agregar toda la compra" onPress={() => { onAgregarVarios(vendibles); onCerrar(); }} /> : null}
                </View>
              </Vidrio>
            );
          })}
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}

function Ficha({ cliente, info, cotizacion, faltanCcf, puedeEditar, onQuitar, onAgregar, onAgregarVarios }) {
  const [historial, setHistorial] = useState(false);
  const p = info?.puntos;
  const tipo = info?.empleado ? 'Empleado' : info?.programa === 'mayorista'
    ? `Mayorista${info?.mayorista?.precio === 'mayoreo_plus' ? ' Plus' : ''}${info?.rango ? ` · ${info.rango}` : ''}`
    : NOMBRE_DE_PROGRAMA[info?.programa] ?? '';
  const faltan = datosQueFaltan(info);
  const ccf = new Set(esContribuyente(info?.categoria) ? faltanCcf : []);
  const fiscal = new Set(['NIT', 'NRC', 'Giro']);
  const datos = [
    ['DUI', info?.dui, ccf.has('DUI')], ['NIT', info?.nit, ccf.has('NIT')], ['NRC', info?.nrc, ccf.has('NRC')],
    ['Teléfono', info?.phone, false], ['Correo', info?.email, false], ['Giro', info?.giro, ccf.has('Giro')],
    ['Dirección', info?.direccion, ccf.has('Dirección')],
  ].filter(([k, v, pide]) => !fiscal.has(k) || esContribuyente(info?.categoria) || String(v ?? '').trim() || pide);
  const importante = (k) => faltan.some((f) => f === k || (f === 'DUI o NIT' && (k === 'DUI' || k === 'NIT')));
  const tiene = datos.filter(([, v]) => String(v ?? '').trim());
  const faltaCcf = datos.filter(([, v, exigido]) => !String(v ?? '').trim() && exigido).map(([k]) => k);
  const faltaOtro = datos.filter(([k, v, exigido]) => !String(v ?? '').trim() && !exigido && importante(k)).map(([k]) => k);
  const listaDe = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0] ?? '').replace('Teléfono', 'teléfono')
    .replace('Correo', 'correo').replace('Giro', 'giro').replace('Dirección', 'dirección');
  const minimo = Number(p?.minimo_canje) || 0;
  const disp = Number(p?.disponibles) || 0;
  const listoCanje = Boolean(p?.puede_canjear) && disp >= minimo && disp > 0;
  const frecuentes = info?.frecuentes ?? [];
  const ultimas = info?.ultimas_compras ?? [];
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Avatar empleado={{ name: cliente.name, photo: info?.foto ?? null }} tamano={48} pendientes={false} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }} numberOfLines={2}>{cliente.name}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Pildora texto={`Precio ${nombreDeLista(cotizacion?.lista)}`} color={cotizacion?.generico ? MARCA.gris : MARCA.verde} />
            {info?.categoria ? <Pildora texto={info.categoria} color={info.categoria === 'Consumidor' ? MARCA.gris : MARCA.azulInfo} /> : null}
            {tipo ? <Pildora texto={tipo} color={MARCA.gris} /> : null}
            {info?.nivel ? <Pildora texto={info.nivel} color={MARCA.ambar} /> : null}
          </View>
        </View>
        <Pressable onPress={onQuitar} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cambiar de cliente"
          style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Cambiar</Text>
        </Pressable>
      </View>
      {cotizacion?.lista ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{porQueEsaLista(cotizacion?.lista, cotizacion?.generico)}</Text> : null}
      {info && tiene.length ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 13, lineHeight: 18 }}>
          {tiene.map(([k, v], i) => `${i ? ' · ' : ''}${k !== 'Teléfono' && k !== 'Dirección' ? `${k} ` : ''}${v}`).join('')}
        </Text>
      ) : null}
      {info && (faltaCcf.length || faltaOtro.length) ? (
        <Pressable disabled={!puedeEditar} onPress={() => abrirFicha(cliente.id)} accessibilityRole="button"
          style={({ pressed }) => ({ borderRadius: 14, padding: 10, gap: 2, backgroundColor: `${faltaCcf.length ? MARCA.rojo : MARCA.ambar}1F`, opacity: pressed ? 0.7 : 1 })}>
          <Text style={{ color: faltaCcf.length ? MARCA.rojo : MARCA.ambar, fontSize: 14, fontWeight: '700' }}>
            {faltaCcf.length ? `Para crédito fiscal falta ${listaDe(faltaCcf)}.` : ''}{faltaOtro.length ? `${faltaCcf.length ? ' ' : ''}Falta ${listaDe(faltaOtro)}.` : ''}
          </Text>
          {puedeEditar ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Toca para completar sus datos.</Text> : null}
        </Pressable>
      ) : null}
      {info ? (
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          {p ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Anillo pct={minimo > 0 ? Math.min(100, (disp / minimo) * 100) : 100} color={listoCanje ? MARCA.verde : MARCA.ambar} texto={String(disp)} tamano={48} />
              <Text style={{ color: listoCanje ? MARCA.verde : colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>
                {!p.puede_canjear ? 'No canjea' : listoCanje ? `puntos · ${formatMoney(descuentoDePuntos(disp, p.valor))}` : `faltan ${minimo - disp}`}
              </Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{info.compra_12m != null ? formatMoney(info.compra_12m) : '—'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>en 12 meses{info.ultima_compra ? ` · última ${fechaTexto(info.ultima_compra.fecha)}` : ''}</Text>
          </View>
          {puedeEditar ? <BotonChico texto="Sus datos" onPress={() => abrirFicha(cliente.id)} /> : null}
        </View>
      ) : null}
      {frecuentes.length ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>Suele llevar</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {frecuentes.map((f) => (
              <Pressable key={f.producto_id} onPress={() => { Haptics.selectionAsync().catch(() => {}); onAgregar(f); }} accessibilityRole="button"
                accessibilityLabel={`Agregar ${f.nombre}`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 220, minHeight: 44, paddingLeft: 4, paddingRight: 12,
                  borderRadius: 22, backgroundColor: 'rgba(127,127,127,0.16)', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                <Miniatura src={f.foto_url} tamano={32} />
                <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{f.nombre}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700' }}>+</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {ultimas.length ? <BotonChico texto={`Últimas compras · ${ultimas.length}`} onPress={() => setHistorial(true)} /> : null}
      {info && historial ? <Historial info={info} visible onCerrar={() => setHistorial(false)} onAgregar={onAgregar} onAgregarVarios={onAgregarVarios} /> : null}
    </View>
  );
}

export default function Cliente({ cliente, info, cotizacion, alerta, faltanCcf, puedeEditar, puedeCrear, onElegir, onAgregar, onAgregarVarios }) {
  return (
    <Vidrio radio={20} tinte={alerta ? `${MARCA.rojo}1A` : undefined}>
      <View style={{ padding: 14, gap: 10 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>Cliente</Text>
        {cliente ? (
          <Ficha cliente={cliente} info={info} cotizacion={cotizacion} faltanCcf={faltanCcf} puedeEditar={puedeEditar}
            onQuitar={() => onElegir(null)} onAgregar={onAgregar} onAgregarVarios={onAgregarVarios} />
        ) : (
          <Buscar lista={cotizacion?.lista} puedeCrear={puedeCrear} onElegir={onElegir} />
        )}
      </View>
    </Vidrio>
  );
}
