// «Las cajas», NATIVO — `FichasDeCaja` del portal, arriba de los cortes:
// quién abrió cada caja (sólo si se abrió desde el portal: el nombre de la
// cuenta de la caja NO es quién abrió), desde cuándo, el cruce con su
// marcación de entrada (un hallazgo, no un candado), la venta del día y el
// efectivo en el cajón con sus piezas. Las cuentas salen del núcleo
// (`utils/fichasDeCaja`), las mismas del portal.
//
// El dinero sólo con alcance TODAS de `cortes_caja` (como el portal y Mi
// caja): quien opera la sala cuenta ese cajón, y la cifra sería la respuesta
// anticipada. A él se le dice cuántas ventas lleva, no cuánto hay.
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import {
  aperturasOrdenadas, detalleDelCajon, lineaDeQuien, minutosAntes, piezasPorSalaYDia, primeraEntradaPorPersona, ventasPorSalaYDia,
} from '@nucleo/utils/fichasDeCaja';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';

function Ficha({ apertura, sala, marca, hayConQueCruzar, ventas, piezas, veLosMontos }) {
  const abierta = !apertura.cerrada_at;
  const quien = apertura.abrio?.name || null;
  const dif = minutosAntes(apertura.abierta_a, marca);
  const detalle = piezas ? detalleDelCajon(piezas) : (Number(apertura.monto_apertura) > 0.005 ? `abrió con ${formatMoney(apertura.monto_apertura)}` : '');
  return (
    <Vidrio radio={18}>
      <View style={{ padding: 12, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{sala}</Text>
          <Pildora texto={abierta ? `abierta · ${hora12(apertura.abierta_a) || '—'}` : `cerró · ${hora12(apertura.cerrada_at) || '—'}`} color={abierta ? MARCA.verde : colorSistema.texto2} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {quien ? <Avatar empleado={{ id: apertura.employee_id, name: quien }} tamano={32} /> : (
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: `${MARCA.ambar}26`, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: MARCA.ambar, fontSize: 15, fontWeight: '800' }}>?</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{quien ? shortEmployeeName({ name: quien }) : 'Sin identificar'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{lineaDeQuien({ quien, hayConQueCruzar, dif, apertura })}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>{veLosMontos ? 'Venta del día' : 'Ventas del día'}</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {veLosMontos ? (ventas ? formatMoney(ventas.efectivo + ventas.otras) : '—') : (ventas ? String(ventas.documentos) : '—')}
            </Text>
            {veLosMontos && ventas && ventas.otras > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`${formatMoney(ventas.otras)} en otras formas`}</Text> : null}
            {!veLosMontos ? <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>se cuenta al cortar</Text> : null}
          </View>
          {veLosMontos ? (
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>{piezas ? 'Efectivo en caja' : 'De eso, en efectivo'}</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                {piezas ? formatMoney(piezas.efectivo) : ventas ? formatMoney(ventas.efectivo) : '—'}
              </Text>
              {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 11, textAlign: 'right' }}>{detalle}</Text> : null}
            </View>
          ) : null}
        </View>
      </View>
    </Vidrio>
  );
}

export default function FichasDeCaja({ aperturas = [], entradas = [], pudeLeerAsistencia = true, salas, ventas = [], piezas = [], veLosMontos = false }) {
  const porPersona = useMemo(() => primeraEntradaPorPersona(entradas), [entradas]);
  const ordenadas = useMemo(() => aperturasOrdenadas(aperturas, salas), [aperturas, salas]);
  const porVenta = useMemo(() => ventasPorSalaYDia(ventas), [ventas]);
  const porPieza = useMemo(() => piezasPorSalaYDia(piezas), [piezas]);
  if (!ordenadas.length) return null;
  const hayConQueCruzar = pudeLeerAsistencia && entradas.length > 0;
  const abiertas = aperturas.filter((a) => !a.cerrada_at).length;
  const sinPersona = aperturas.filter((a) => !a.employee_id).length;
  return (
    <View style={{ marginHorizontal: 16, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>Las cajas</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
          {`${abiertas} abierta${abiertas === 1 ? '' : 's'}${aperturas.length > ordenadas.length ? ` · se muestran ${ordenadas.length} de ${aperturas.length}` : ''}`}
        </Text>
      </View>
      {ordenadas.map((a) => (
        <Ficha key={`${a.branch_id}:${a.erp_apertura_id}`} apertura={a} sala={salas?.get(a.branch_id) || `Sucursal ${a.branch_id}`}
          marca={porPersona.get(`${a.employee_id}:${a.abierta_el}`) || null} hayConQueCruzar={hayConQueCruzar}
          ventas={porVenta.get(`${a.branch_id}:${a.abierta_el}`) || null} piezas={porPieza.get(`${a.branch_id}:${a.abierta_el}`) || null}
          veLosMontos={veLosMontos} />
      ))}
      {!pudeLeerAsistencia ? <Aviso texto="No se puede leer la asistencia con este permiso, así que las fichas no dicen quién marcó entrada. No significa que nadie haya marcado." /> : null}
      {sinPersona ? <Aviso tono="cuidado" texto={`${sinPersona === 1 ? 'Una caja abrió' : `${sinPersona} cajas abrieron`} con una cuenta compartida: sus cortes no quedan a nombre de nadie. Se arregla dándole a cada persona su propio usuario en la caja.`} /> : null}
    </View>
  );
}
