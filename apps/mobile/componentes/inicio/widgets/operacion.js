// Los widgets de la pestaña Operación, nativos — los mismos del tablero del
// portal (`PESTANAS_TEMATICAS.operacion`) con los mismos datos del núcleo:
// consulta de inventario, traslados, facturas de la sala, bitácoras, recetas
// pendientes y los atajos para pedir un ajuste.
import { View } from 'react-native';
import { router } from 'expo-router';
import { fetchTrasladosPorConfirmar, fetchTrasladosPorRecibir, fetchSalasQueCubro } from '@nucleo/data/traslados';
import { fetchFacturasSala } from '@nucleo/data/facturasSala';
import { fetchBitacoraDia, fetchLibro, pendientesDelDia } from '@nucleo/data/bitacoras';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { diasEntre, fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import Widget, { Chip, Cuenta, Esqueleto, Renglon, Vacio } from '../Widget';
import { Avance } from '../Kpi';
import { useDato } from '../useDato';
import { MARCA } from '../marca';

// ── Pedir un ajuste ─────────────────────────────────────────────────────────
// Los tres widgets del portal para pedir algo (anulación o cambio de una
// factura, ajuste de inventario, ajuste de Mín·Máx) son formularios; en la
// app cada uno es su pantalla nativa y el widget es la puerta. Cada renglón
// sale con su propio permiso, el mismo del portal.
const AJUSTES = [
  { permiso: 'dash_annulment_req', ruta: '/nueva/facturas', icono: 'Receipt', titulo: 'Anular o cambiar una factura', detalle: 'Anulación, forma de pago, datos del cliente', color: MARCA.rojo },
  { permiso: 'dash_inv_movement', ruta: '/nueva/ajuste', icono: 'PackageMinus', titulo: 'Ajuste de inventario', detalle: 'Vencidos, dañados, faltantes o sobrantes', color: MARCA.ambar },
  { permiso: 'dash_minmax_req', ruta: '/nueva/minmax', icono: 'BarChart2', titulo: 'Ajuste de Mín·Máx', detalle: 'Cambiar el par de un producto en la sala', color: MARCA.azul },
];
export const PERMISOS_DE_AJUSTE = AJUSTES.map((a) => a.permiso);

export function PedirAjuste({ ctx }) {
  const mias = AJUSTES.filter((a) => ctx.puede(a.permiso));
  return (
    <Widget titulo="Pedir un ajuste" icono="ClipboardList" color={MARCA.ambar} onAbrir={() => router.push('/nueva-solicitud')} accion="Todas">
      {mias.map((a, i) => (
        <Renglon key={a.ruta} primero={!i} titulo={a.titulo} detalle={a.detalle}
          izquierda={<Chip icono={a.icono} color={a.color} tamano={30} />} onPress={() => router.push(a.ruta)} />
      ))}
    </Widget>
  );
}

// ── Consulta de inventario ──────────────────────────────────────────────────
// En el portal es un buscador dentro del widget; en la app la búsqueda vive en
// su pestaña (la de iOS 26), así que acá es la puerta hacia ella.
export function ConsultaInventario() {
  return (
    <Widget titulo="Consulta de inventario" icono="Package" color={MARCA.azul} onAbrir={() => router.navigate('/buscar')} accion="Buscar">
      <Renglon primero titulo="Busca un producto o su principio activo" detalle="Existencias por sala y por lote"
        izquierda={<Chip icono="Search" color={MARCA.azul} tamano={30} />} onPress={() => router.navigate('/buscar')} />
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
    <Widget titulo="Traslados entre salas" icono="ArrowLeftRight" color={MARCA.azul} cuenta={d.porContestar} onAbrir={() => ctx.abrir('/traslados')}>
      {cargando && !dato ? <Esqueleto lineas={2} /> : (
        <>
          <Renglon primero titulo="Por contestar" detalle="Lo que otra sala pide a la tuya" onPress={() => ctx.abrir('/traslados')}
            izquierda={<Chip icono="ClipboardList" color={MARCA.ambar} tamano={30} />} derecha={<Cuenta n={d.porContestar} color={MARCA.ambar} />} />
          <Renglon titulo="En camino" detalle="Lo que viene para tu sala" onPress={() => ctx.abrir('/traslados')}
            izquierda={<Chip icono="Truck" color={MARCA.azul} tamano={30} />} derecha={d.porRecibir ? `${d.porRecibir}` : '—'} />
        </>
      )}
    </Widget>
  );
}

// ── Facturas de mi sala ─────────────────────────────────────────────────────
// Las facturas de compra que falta cargar, y cuánto llevan esperando: la barra
// se parte en menos de 2 días, de 2 a 7, y más de 7 (las que ya pesan).
export function FacturasSala({ ctx }) {
  const { dato, cargando } = useDato(`facturas-sala:${ctx.sala}`, async () => {
    const r = await fetchFacturasSala(ctx.sala, { dias: 30 });
    if (r.error) throw r.error;
    return r.filas;
  });
  const hoy = hoySV();
  const pend = (dato || []).filter((f) => f.estado === 'disponible' || f.estado === 'mia_linea');
  const edad = (f) => diasEntre(String(f.fecha_emision).slice(0, 10), hoy);
  const viejas = pend.filter((f) => edad(f) > 7).length;
  const monto = pend.reduce((s, f) => s + (Number(f.monto_total) || 0), 0);
  return (
    <Widget titulo="Facturas de mi sala" icono="FileText" color={MARCA.violeta} cuenta={pend.length} onAbrir={() => ctx.abrir('/facturas-sala')}>
      {cargando && !dato ? <Esqueleto lineas={2} /> : pend.length ? (
        <View style={{ gap: 10 }}>
          <Renglon primero titulo={`${pend.length} por cargar`} detalle={`${formatMoney(monto)}${viejas ? ` · ${viejas} con más de 7 días` : ''}`}
            colorDerecha={viejas ? MARCA.rojo : undefined} derecha={viejas ? `${viejas} +7 d` : null} />
          <Avance parte={pend.length - viejas} total={pend.length} color={viejas ? MARCA.ambar : MARCA.verde} />
          {pend.slice(0, 3).map((f) => (
            <Renglon key={f.id ?? f.document_id} titulo={f.emisor_nombre || 'Proveedor'} detalle={fechaTexto(String(f.fecha_emision).slice(0, 10))}
              derecha={formatMoney(f.monto_total)} colorDerecha={edad(f) > 7 ? MARCA.rojo : undefined} />
          ))}
        </View>
      ) : <Vacio texto="Todo cargado" bien />}
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
    <Widget titulo="Bitácoras de mi sala" icono="Thermometer" color={MARCA.rojo} cuenta={p.vencidas} onAbrir={ir} accion={ronda ? 'Pasar la ronda' : 'Anotar'}>
      {cargando && !dato ? <Esqueleto lineas={2} /> : (
        <View style={{ gap: 10 }}>
          {p.vencidas ? <Renglon primero titulo={`${p.vencidas} lectura${p.vencidas > 1 ? 's' : ''} vencida${p.vencidas > 1 ? 's' : ''}`} onPress={ir}
            izquierda={<Chip icono="AlertTriangle" color={MARCA.rojo} tamano={30} />} /> : null}
          {p.abiertas ? <Renglon primero={!p.vencidas} titulo={`${p.abiertas} por anotar ahora`} onPress={ir}
            izquierda={<Chip icono="Clock" color={MARCA.ambar} tamano={30} />} /> : null}
          {!p.vencidas && !p.abiertas ? <Vacio texto={p.total ? `Al día: ${p.hechas} de ${p.total}` : 'Sin pendientes'} bien /> : null}
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
