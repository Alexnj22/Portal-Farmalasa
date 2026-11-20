// Los widgets de la pestaña Operación, nativos — los mismos del tablero del
// portal (`PESTANAS_TEMATICAS.operacion`) con los mismos datos del núcleo:
// consulta de inventario, traslados, bitácoras, recetas
// pendientes y los atajos para pedir un ajuste.
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { fetchTrasladosPorConfirmar, fetchTrasladosPorRecibir, fetchSalasQueCubro } from '@nucleo/data/traslados';
import { fetchFaltantesConStockEnOtraSala } from '@nucleo/data/inventory';
import { contarPorVencer } from '@nucleo/data/inventoryMovements';
import { BRANCH_A_ERP } from '@nucleo/constants/erp';
import { fetchBitacoraDia, fetchLibro, pendientesDelDia } from '@nucleo/data/bitacoras';
import { diasEntre, fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import Widget, { Chip, Cuenta, Esqueleto, Renglon, Vacio } from '../Widget';
import { Avance } from '../Kpi';
import { useDato } from '../useDato';
import { MARCA } from '../marca';
import { colorSistema } from '../../Formulario';
import { MAYUSCULAS } from '../../../tema/mayusculas';

// ── Pedir un ajuste ─────────────────────────────────────────────────────────
// Los tres widgets del portal para pedir algo (anulación o cambio de una
// factura, ajuste de inventario, ajuste de Mín·Máx) son formularios; en la
// app cada uno es su pantalla nativa y el widget es la puerta. Cada renglón
// sale con su propio permiso, el mismo del portal.
const AJUSTES = [
  { permiso: 'dash_annulment_req', ruta: '/nueva/facturas', icono: 'Receipt', titulo: 'Anular o cambiar una factura', detalle: 'Anulación, forma de pago, datos del cliente', color: MARCA.rojo },
  { permiso: 'dash_inv_movement', ruta: '/nueva/ajuste', icono: 'PackageMinus', titulo: 'Ajuste de inventario', detalle: 'Vencidos, dañados, faltantes o sobrantes', color: MARCA.ambar },
  { permiso: 'dash_minmax_req', ruta: '/nueva/minmax', icono: 'BarChart2', titulo: 'Ajuste de Mín/Máx', detalle: 'Cambiar el par de un producto en la sucursal', get color() { return MARCA.azul; } },
];
export const PERMISOS_DE_AJUSTE = AJUSTES.map((a) => a.permiso);

export function PedirAjuste({ ctx }) {
  const mias = AJUSTES.filter((a) => ctx.puede(a.permiso));
  // La sala del ajuste de inventario, como la baldosa del portal: la propia;
  // con alcance «todas» y sin sala, La Popular.
  const erpAjuste = BRANCH_A_ERP[ctx?.sala] ?? (ctx.getScope?.('dash_inv_movement') === 'ALL' ? 5 : null);
  return (
    <Widget titulo="Pedir un ajuste" icono="ClipboardList" color={MARCA.ambar} onAbrir={() => router.push('/nueva-solicitud')} accion="Todas">
      {mias.map((a, i) => (a.permiso === 'dash_inv_movement' && erpAjuste ? (
        <PorVencer key={a.ruta} ajuste={a} erp={erpAjuste} primero={!i} />
      ) : (
        <Renglon key={a.ruta} primero={!i} titulo={a.titulo} detalle={a.detalle}
          izquierda={<Chip icono={a.icono} color={a.color} tamano={30} />} onPress={() => router.push(a.ruta)} />
      )))}
    </Widget>
  );
}

// El ajuste de inventario con lo que vence (`contarPorVencer`, el de la
// baldosa del portal): vencidas, en 7 y en 30 días. Lo que vence pronto
// todavía se puede trasladar o rebajar. La franja reparte los tres tramos
// sobre su total: compara urgencias entre sí.
function PorVencer({ ajuste: a, erp, primero }) {
  const { dato } = useDato(`por-vencer:${erp}`, async () => {
    const r = await contarPorVencer({ erpSucursalId: erp });
    if (r.error) throw r.error;
    return r;
  });
  const total = dato ? dato.vencidas + dato.en7 + dato.en30 : 0;
  const detalle = dato
    ? [dato.vencidas ? `${dato.vencidas} vencido${dato.vencidas === 1 ? '' : 's'}` : 'Sin vencidos',
      dato.en7 ? `${dato.en7} en 7 d` : null, dato.en30 ? `${dato.en30} en 30 d` : null].filter(Boolean).join(' · ')
    : a.detalle;
  const tramos = dato && total ? [
    { frac: dato.vencidas / total, color: MARCA.rojo },
    { frac: dato.en7 / total, color: MARCA.ambar },
    { frac: dato.en30 / total, color: MARCA.amarillo },
  ].filter((t) => t.frac > 0) : [];
  return (
    <View>
      <Renglon primero={primero} titulo={a.titulo} detalle={detalle}
        izquierda={<Chip icono={a.icono} color={a.color} tamano={30} />}
        derecha={dato?.vencidas ? <Cuenta n={dato.vencidas} color={MARCA.rojo} /> : undefined}
        onPress={() => router.push(a.ruta)} />
      {tramos.length ? (
        <View style={{ flexDirection: 'row', height: 5, borderRadius: 3, overflow: 'hidden', gap: 2, marginLeft: 42, marginBottom: 6 }}>
          {tramos.map((t, i) => <View key={i} style={{ flex: t.frac, backgroundColor: t.color }} />)}
        </View>
      ) : null}
    </View>
  );
}

// ── Consulta de precios ─────────────────────────────────────────────────────
// En el portal es un buscador dentro del widget; en la app, como la consulta de
// inventario, es la puerta a su pantalla (`/consulta-precios`), con el buscador
// en la barra. Los precios por presentación se ven en `/precio/[id]`.
export function ConsultaPrecios() {
  const abrir = () => router.push('/consulta-precios');
  return (
    <Widget titulo="Consulta de precios" icono="Tag" color={MARCA.ambar} onAbrir={abrir} accion="Buscar">
      <Renglon primero titulo="Busca un producto o su principio activo" detalle="Regular, Preferente y demás precios por presentación"
        izquierda={<Chip icono="Tag" color={MARCA.ambar} tamano={30} />} onPress={abrir} />
    </Widget>
  );
}

// ── Consulta de inventario ──────────────────────────────────────────────────
// En el portal es un buscador dentro del widget; en la app la búsqueda vive en
// su pestaña (la de iOS 26), así que acá es la puerta hacia ella. Debajo, como
// el portal, lo que a MI sala le falta y otra sala tiene
// (`get_faltantes_con_stock_en_otra_sala`), cada uno con «Solicitar» — abre
// el pedido a otra sala con el producto ya elegido. Sólo para quien está en
// una sala: sin sala no hay «lo que me falta» (decisión del 2026-08-06). Pedir
// desde una sala concreta —incluida el área de vencidos de Bodega— se hace en
// la ficha del producto.
export function ConsultaInventario({ ctx }) {
  const miErp = BRANCH_A_ERP[ctx?.sala] ?? null;
  const { dato, cargando } = useDato(miErp ? `faltantes-otra-sala:${miErp}` : null, async () => {
    const { filas, error } = await fetchFaltantesConStockEnOtraSala(miErp, 20);
    if (error) throw error;
    return filas;
  });
  const faltantes = dato || [];
  const pedir = (f) => router.push({ pathname: '/pedir-traslado', params: { producto: String(f.erp_product_id), descripcion: f.descripcion } });
  return (
    <Widget titulo="Consulta de inventario" icono="Package" color={MARCA.azul} onAbrir={() => router.navigate('/buscar')} accion="Buscar">
      <Renglon primero titulo="Busca un producto o su principio activo" detalle="Existencia por sucursal y por lote"
        izquierda={<Chip icono="Search" color={MARCA.azul} tamano={30} />} onPress={() => router.navigate('/buscar')} />
      {miErp && cargando && !dato ? <Esqueleto lineas={2} /> : null}
      {faltantes.length ? (
        <>
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: MAYUSCULAS, letterSpacing: 0.4, marginTop: 8, marginBottom: 2 }}>Sin existencia, puedes solicitar en estas sucursales</Text>
          {faltantes.map((f, i) => (
            <Renglon key={f.erp_product_id} primero={!i} titulo={f.descripcion}
              detalle={`${(f.donde ?? []).slice(0, 3).map((d) => `${d.sala} ${d.unidades}`).join(' · ')}${f.min_units != null ? ` · mín ${f.min_units}` : ''}`}
              izquierda={<Chip icono="PackageMinus" color={MARCA.ambar} tamano={26} />}
              derecha={<Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>Solicitar</Text>}
              onPress={() => pedir(f)} />
          ))}
        </>
      ) : null}
    </Widget>
  );
}

// ── Traslados entre salas ───────────────────────────────────────────────────
// Por contestar (lo que otra sala le pide a la mía) y en camino (lo que viene
// para acá). Con alcance «todas» cuenta todas las salas, como el portal.
export function Traslados({ ctx }) {
  const todas = ctx.getScope?.('traslados') === 'ALL';
  const { dato, cargando } = useDato(`traslados:${todas ? 'todas' : ctx.sala}`, async () => {
    const cubro = todas || !ctx.sala ? [] : await fetchSalasQueCubro(ctx.sala).catch(() => []);
    const salas = todas ? null : [String(ctx.sala), ...(cubro || []).map((s) => String(s.branch_id ?? s))];
    const [c, r] = await Promise.all([
      fetchTrasladosPorConfirmar({ branchIds: salas }),
      fetchTrasladosPorRecibir({ branchId: todas ? null : ctx.sala }),
    ]);
    if (c.error) throw c.error;
    return { porContestar: c.total ?? c.filas?.length ?? 0, porRecibir: (r.filas || []).length };
  });
  const d = dato || { porContestar: 0, porRecibir: 0 };
  return (
    <Widget titulo="Traslados entre sucursales" icono="ArrowLeftRight" color={MARCA.azul} cuenta={d.porContestar} onAbrir={() => ctx.abrir('/traslados')}>
      {cargando && !dato ? <Esqueleto lineas={2} /> : (
        <>
          <Renglon primero titulo="Por contestar" detalle="Lo que otra sucursal pide a la tuya" onPress={() => ctx.abrir('/traslados')}
            izquierda={<Chip icono="ClipboardList" color={MARCA.ambar} tamano={30} />} derecha={<Cuenta n={d.porContestar} color={MARCA.ambar} />} />
          <Renglon titulo="En camino" detalle="Lo que viene para tu sucursal" onPress={() => ctx.abrir('/traslados')}
            izquierda={<Chip icono="Truck" color={MARCA.azul} tamano={30} />} derecha={d.porRecibir ? `${d.porRecibir}` : '—'} />
        </>
      )}
    </Widget>
  );
}

// ── Bitácoras de mi sala ────────────────────────────────────────────────────
export function Bitacoras({ ctx }) {
  const { dato, cargando } = useDato(`bitacora:${ctx.sala}`, async () => {
    const r = await fetchBitacoraDia(ctx.sala, hoySV());
    if (r.error) throw r.error;
    return pendientesDelDia(r.dia);
  });
  const p = dato || { abiertas: 0, vencidas: 0, hechas: 0, total: 0, desvios: 0 };
  const ronda = p.abiertas + p.vencidas >= 2;
  const ir = () => ctx.abrir(ronda ? '/bitacoras?ronda=1' : '/bitacoras');
  return (
    <Widget titulo="Bitácoras de mi sucursal" icono="Thermometer" color={MARCA.rojo} cuenta={p.vencidas} onAbrir={ir} accion={ronda ? 'Pasar la ronda' : 'Anotar'}>
      {cargando && !dato ? <Esqueleto lineas={2} /> : (
        <View style={{ gap: 10 }}>
          {p.vencidas ? <Renglon primero titulo={`${p.vencidas} lectura${p.vencidas > 1 ? 's' : ''} vencida${p.vencidas > 1 ? 's' : ''}`} onPress={ir}
            izquierda={<Chip icono="AlertTriangle" color={MARCA.rojo} tamano={30} />} /> : null}
          {p.abiertas ? <Renglon primero={!p.vencidas} titulo={`${p.abiertas} por anotar ahora`} onPress={ir}
            izquierda={<Chip icono="Clock" color={MARCA.ambar} tamano={30} />} /> : null}
          {!p.vencidas && !p.abiertas ? <Vacio texto={p.total ? `Al día. ${p.hechas} de ${p.total}` : 'Sin pendientes'} bien /> : null}
          {p.total ? <Avance parte={p.hechas} total={p.total} color={MARCA.verde} /> : null}
          {p.desvios ? <Vacio texto={`${p.desvios} fuera de rango hoy`} /> : null}
        </View>
      )}
    </Widget>
  );
}

// ── Recetas pendientes de mi sala ───────────────────────────────────────────
// Los renglones del libro bajo receta que quedaron sin completar. Dos días o
// más ya es tarde (en rojo). Con permiso de editar bitácoras, tocar uno abre
// `app/receta/[id].js` para completarlo; sin él, el libro.
export function RecetasPendientes({ ctx }) {
  const farmacia = (ctx.sucursales || []).find((b) => String(b.id) === String(ctx.sala))?.type === 'FARMACIA';
  const { dato, cargando } = useDato(farmacia ? `recetas:${ctx.sala}` : null, async () => {
    const hoy = hoySV();
    const r = await fetchLibro(ctx.sala, { desde: sumarDias(hoy, -400), hasta: hoy, estado: 'pendiente' });
    if (r.error) throw r.error;
    return [...(r.renglones || [])].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  });
  if (!farmacia) return null;
  const hoy = hoySV();
  const lista = dato || [];
  const completa = ctx.puede('bitacoras', 'can_edit');
  const tarde = lista.filter((r) => diasEntre(String(r.fecha).slice(0, 10), hoy) >= 2).length;
  return (
    <Widget titulo="Recetas pendientes" icono="Pill" color={MARCA.violeta} cuenta={lista.length} onAbrir={() => ctx.abrir('/bitacoras')} accion="Ver el libro">
      {cargando && !dato ? <Esqueleto lineas={3} /> : lista.length ? (
        <View>
          {tarde ? <Vacio texto={`${tarde} llevan 2 días o más`} /> : null}
          {lista.slice(0, 5).map((r, i) => (
            <Renglon key={r.id} primero={!i} titulo={r.producto_nombre} lineas={1}
              detalle={[r.folio_txt, fechaTexto(String(r.fecha).slice(0, 10)), r.cliente].filter(Boolean).join(' · ')}
              colorDerecha={diasEntre(String(r.fecha).slice(0, 10), hoy) >= 2 ? MARCA.rojo : undefined}
              derecha={`${diasEntre(String(r.fecha).slice(0, 10), hoy)} d`}
              onPress={completa ? () => router.push({ pathname: '/receta/[id]', params: { id: String(r.id), sala: String(ctx.sala), fecha: String(r.fecha).slice(0, 10) } }) : () => ctx.abrir('/bitacoras')} />
          ))}
          {lista.length > 5 ? <Vacio texto={`y ${lista.length - 5} más`} /> : null}
        </View>
      ) : <Vacio texto="Libro al día" bien />}
    </Widget>
  );
}
