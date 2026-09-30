// Los widgets de la pestaña Comercial, nativos — los del tablero del portal
// (`PESTANAS_TEMATICAS.comercial`): facturación de hoy, cotizaciones, los
// productos que más venden, quién está vendiendo y los cortes de caja.
import { Text, View } from 'react-native';
import { fetchRecentCotizaciones, fetchTodayInvoicesSummary } from '@nucleo/data/dashboard';
import { fetchTopProductosDelMes } from '@nucleo/data/ventas';
import { fetchMesEnCurso } from '@nucleo/data/metas';
import { fetchCortesResumen } from '@nucleo/data/cortes';
import { conTramoPorSalaYDia, resumenDeCortes } from '@nucleo/utils/cortesDiagnostico';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import Widget, { Esqueleto, Renglon, Vacio } from '../Widget';
import { useDato, datos } from '../useDato';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../marca';

const dinero0 = (v) => formatMoney(v, { decimales: 0 });

function Cifra({ valor, rotulo, color }) {
  return (
    <View style={{ flex: 1, padding: 10, borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.12)', gap: 2 }}>
      <Text style={{ color: color ?? colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>{valor}</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{rotulo}</Text>
    </View>
  );
}

// ── Facturación de hoy ──────────────────────────────────────────────────────
export function Facturacion({ ctx }) {
  const hoy = hoySV();
  const { dato, cargando } = useDato(`facturacion:${hoy}`, async () => {
    const filas = await fetchTodayInvoicesSummary(hoy);
    return datos(filas) || [];
  });
  const f = dato || [];
  const total = f.reduce((s, x) => s + (Number(x.total) || 0), 0);
  const ccf = f.filter((x) => x.tipo_documento === 'CCF').length;
  return (
    <Widget titulo="Facturación de hoy" icono="FileText" color={MARCA.verde} onAbrir={ctx.puede('facturacion') ? () => ctx.abrir('/facturacion') : null}>
      {cargando && !dato ? <Esqueleto lineas={2} /> : (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Cifra valor={`${f.length}`} rotulo="documentos" />
            <Cifra valor={dinero0(total)} rotulo="emitido" color={MARCA.verde} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Cifra valor={`${ccf}`} rotulo="crédito fiscal" color={MARCA.rojo} />
            <Cifra valor={`${f.length - ccf}`} rotulo="consumidor final y otros" />
          </View>
        </View>
      )}
    </Widget>
  );
}

// ── Cotizaciones activas ────────────────────────────────────────────────────
export function Cotizaciones({ ctx }) {
  const hoy = hoySV();
  const { dato, cargando } = useDato(`cotizaciones:${hoy}`, async () => {
    const filas = datos(await fetchRecentCotizaciones(sumarDias(hoy, -30))) || [];
    return filas.filter((c) => c.status === 'ACTIVA');
  });
  const lista = dato || [];
  const total = lista.reduce((s, c) => s + (Number(c.total) || 0), 0);
  return (
    <Widget titulo="Cotizaciones activas" icono="Receipt" color={MARCA.azul} cuenta={lista.length}
      onAbrir={ctx.puede('cotizaciones') ? () => ctx.abrir('/cotizaciones') : null}>
      {cargando && !dato ? <Esqueleto lineas={3} /> : lista.length ? (
        <View>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginBottom: 4 }}>
            <Text style={{ color: MARCA.verde, fontWeight: '800', fontSize: 17 }}>{dinero0(total)}</Text>  en los últimos 30 días
          </Text>
          {lista.slice(0, 4).map((c, i) => (
            <Renglon key={c.id} primero={!i} titulo={c.customer_name || 'Cliente'} detalle={`N.º ${c.numero} · ${fechaTexto(String(c.fecha).slice(0, 10))}`}
              derecha={formatMoney(c.total)} />
          ))}
        </View>
      ) : <Vacio texto="Ninguna activa" />}
    </Widget>
  );
}

// ── Lo que más se vende este mes ────────────────────────────────────────────
export function TopProductos({ ctx }) {
  const hoy = hoySV();
  const { dato, cargando } = useDato(`top:${hoy}`, async () =>
    datos(await fetchTopProductosDelMes({ p_fini: `${hoy.slice(0, 7)}-01`, p_ffin: hoy, p_limite: 10 })) || []);
  const lista = (dato || []).slice(0, 6);
  const max = Number(lista[0]?.neto) || 1;
  return (
    <Widget titulo="Lo que más se vende" icono="TrendingUp" color={MARCA.violeta} onAbrir={ctx.puede('ventas') ? () => ctx.abrir('/ventas') : null}>
      {cargando && !dato ? <Esqueleto lineas={4} /> : lista.length ? (
        <View style={{ gap: 9 }}>
          {lista.map((p, i) => (
            <View key={`${p.descripcion}-${i}`} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ width: 16, color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>{i + 1}</Text>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>{p.descripcion}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{dinero0(p.neto)}</Text>
              </View>
              <View style={{ marginLeft: 24, height: 5, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.18)' }}>
                <View style={{ width: `${Math.max(4, (Number(p.neto) / max) * 100)}%`, height: '100%', borderRadius: 3, backgroundColor: MARCA.violeta }} />
              </View>
            </View>
          ))}
        </View>
      ) : <Vacio texto="Todavía sin ventas este mes" />}
    </Widget>
  );
}

// ── Quién está vendiendo ────────────────────────────────────────────────────
// El ranking del mes. Sin el permiso de ver montos, cada quien aparece con su
// parte de la venta de la sala (igual que el portal).
export function Vendedores({ ctx }) {
  const todas = ctx.getScope?.('dash_vendedores') === 'ALL';
  const { dato, cargando } = useDato(`vendedores:${todas ? 'todas' : ctx.sala}`, () => fetchMesEnCurso(todas ? ctx.sala : null));
  const montos = ctx.puede('dash_vendedores_vista_completa');
  const filas = [...(dato?.vendedores || [])].map((v) => ({ ...v, venta: Number(v.venta) || 0 })).sort((a, b) => b.venta - a.venta);
  const total = filas.reduce((s, v) => s + v.venta, 0) || 1;
  const max = filas[0]?.venta || 1;
  return (
    <Widget titulo="Quién está vendiendo" icono="Users" color={MARCA.verde} onAbrir={ctx.puede('metas') ? () => ctx.abrir('/metas') : null}>
      {cargando && !dato ? <Esqueleto lineas={4} /> : filas.length ? (
        <View style={{ gap: 9 }}>
          {filas.slice(0, 6).map((v, i) => (
            <View key={`${v.nombre}-${i}`} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ width: 16, color: i < 2 ? MARCA.verde : colorSistema.texto2, fontSize: 13, fontWeight: '800' }}>{i + 1}</Text>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>{v.nombre}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
                  {montos ? dinero0(v.venta) : `${Math.round((v.venta / total) * 100)}%`}
                </Text>
              </View>
              <View style={{ marginLeft: 24, height: 5, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.18)' }}>
                <View style={{ width: `${Math.max(4, (v.venta / max) * 100)}%`, height: '100%', borderRadius: 3, backgroundColor: i < 2 ? MARCA.verde : MARCA.azul }} />
              </View>
            </View>
          ))}
        </View>
      ) : <Vacio texto="Sin ventas este mes" />}
    </Widget>
  );
}

// ── Cortes de caja del mes ──────────────────────────────────────────────────
// Cuántos cuadraron, cuántos sobraron y cuántos faltaron, con el mismo juez
// del portal (`conTramoPorSalaYDia` + `resumenDeCortes`).
export function Cortes({ ctx }) {
  const hoy = hoySV();
  const todas = ctx.getScope?.('dash_cortes_sala') === 'ALL';
  const { dato, cargando } = useDato(`cortes-mes:${hoy}`, async () => fetchCortesResumen({ desde: `${hoy.slice(0, 7)}-01`, hasta: hoy }));
  const deLaSala = (dato || []).filter((c) => todas || String(c.branch_id) === String(ctx.sala));
  const r = resumenDeCortes(conTramoPorSalaYDia(deLaSala));
  return (
    <Widget titulo="Cortes de caja del mes" icono="Wallet" color={MARCA.verde} cuenta={r.pendientes}
      onAbrir={ctx.puede('cortes_caja') ? () => ctx.abrir('/caja') : null}>
      {cargando && !dato ? <Esqueleto lineas={2} /> : r.vivos ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Cifra valor={`${r.cuadrados}`} rotulo="cuadraron" color={MARCA.verde} />
            <Cifra valor={`${r.exceso}`} rotulo="sobró" color={MARCA.ambar} />
            <Cifra valor={`${r.faltante}`} rotulo="faltó" color={MARCA.rojo} />
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{r.pendientes} sin confirmar · {r.confirmados} confirmados</Text>
        </View>
      ) : <Vacio texto="Sin cortes este mes" />}
    </Widget>
  );
}
