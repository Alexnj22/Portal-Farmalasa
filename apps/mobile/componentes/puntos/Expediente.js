// Lo que el portal muestra al escanear la tarjeta de un cliente
// (`views/puntos/ExpedienteDelCliente`), NATIVO: marcas (empleado, mayorista,
// convenio, nivel), la app, lo que espera algo de la sala (reservas, encargos,
// inyecciones por aplicar), créditos con su plazo, tratamientos y últimas
// compras. Va debajo del saldo en la cuenta del cliente cuando se llegó
// escaneando (`puntos-cliente/[id]` con `como`).
//
// Los rótulos y las marcas salen del núcleo (`expedienteDelCliente`), y el
// plazo del crédito de `edadDelCredito`: los mismos jueces que el portal.
// `creditos`/`inyecciones` vienen `null` si el cargo no ve esa pantalla.
import { Text, View } from 'react-native';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';
import { edadDelCredito } from '@nucleo/data/creditos';
import { ESTADO_DE_ENCARGO, ESTADO_DE_RESERVA, estadoDeLaApp, marcasDelCliente } from '@nucleo/utils/expedienteDelCliente';
import { colorSistema } from '../Formulario';
import { Seccion } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';

const COLOR_TONO = { success: MARCA.verde, warning: MARCA.ambar, danger: MARCA.rojo, info: MARCA.azulClaro, neutral: '#8E8E93' };

function Renglon({ titulo, detalle, cifra, pildora, primero }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingTop: primero ? 0 : 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{detalle}</Text> : null}
        {pildora ? <Pildora texto={pildora.texto} color={pildora.color} /> : null}
      </View>
      {cifra ? <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800' }}>{cifra}</Text> : null}
    </View>
  );
}

const Nada = ({ texto }) => <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{texto}</Text>;

export default function Expediente({ exp }) {
  if (!exp?.cliente) return null;
  const marcas = marcasDelCliente(exp);
  const app = estadoDeLaApp(exp.app);
  const reservas = exp.reservas ?? [];
  const encargos = exp.encargos ?? [];
  const inyecciones = exp.inyecciones ?? [];
  const pendientes = [
    ...reservas.map((r) => {
      const e = ESTADO_DE_RESERVA[r.estado] ?? { rotulo: r.estado, tono: 'neutral' };
      return { clave: `r${r.id}`, titulo: `${r.cantidad} × ${r.producto_nombre}`,
        detalle: [r.pedido ? `Reserva ${r.pedido}` : 'Reserva', r.sala, r.entrega === 'domicilio' ? 'a domicilio' : null].filter(Boolean).join(' · '),
        cifra: r.precio_unitario != null ? formatMoney(Number(r.precio_unitario) * Number(r.cantidad || 1)) : null,
        pildora: { texto: e.rotulo, color: COLOR_TONO[e.tono] } };
    }),
    ...encargos.map((g) => {
      const e = ESTADO_DE_ENCARGO[g.estado] ?? { rotulo: g.estado, tono: 'neutral' };
      return { clave: `e${g.id}`, titulo: `${g.cantidad} × ${g.producto_nombre}`,
        detalle: ['Encargo', g.sala, g.fecha_estimada ? `para el ${fechaNumerica(g.fecha_estimada)}` : null].filter(Boolean).join(' · '),
        cifra: g.precio_unitario != null ? formatMoney(Number(g.precio_unitario) * Number(g.cantidad || 1)) : null,
        pildora: { texto: e.rotulo, color: COLOR_TONO[e.tono] } };
    }),
    ...inyecciones.map((i) => ({ clave: `i${i.id}`, titulo: i.producto,
      detalle: ['Inyección pagada sin aplicar', i.sala].filter(Boolean).join(' · '),
      cifra: i.precio != null ? formatMoney(i.precio) : null,
      pildora: { texto: 'Por aplicar', color: MARCA.ambar } })),
  ];
  const creditos = exp.creditos == null ? null : exp.creditos.map((cr) => ({ ...cr, ...edadDelCredito(cr.fecha, cr.saldo) }));
  const deuda = (creditos ?? []).reduce((s, cr) => s + (Number(cr.saldo) || 0), 0);

  return (
    <>
      {marcas.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {marcas.map((m) => <Pildora key={m.clave} texto={m.rotulo} color={COLOR_TONO[m.tono] ?? MARCA.azulClaro} />)}
        </View>
      ) : null}

      <Seccion titulo="App Puntos Salud">
        {!app ? <Nada texto={`No ha entrado a la app.${exp.puntos?.tiene_codigo ? ' Ya tiene su código de acceso.' : ''}`} /> : (
          <>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{app.rotulo}</Text>
            {app.tiene ? <Text style={{ color: app.avisos ? MARCA.verde : colorSistema.texto2, fontSize: 14 }}>{app.avisos ? 'Le llegan los avisos' : 'Tiene los avisos apagados'}</Text> : null}
            {app.ultimoUso ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Último uso: ${fechaHora12(app.ultimoUso)}`}</Text> : null}
          </>
        )}
      </Seccion>

      <Seccion titulo="Pendientes">
        {pendientes.length ? pendientes.map((p, i) => <Renglon key={p.clave} primero={!i} {...p} />)
          : <Nada texto="Sin reservas, encargos ni inyecciones por aplicar." />}
      </Seccion>

      {creditos ? (
        <Seccion titulo="Créditos" pie={creditos.length ? `Debe ${formatMoney(deuda)}` : null}>
          {creditos.length ? creditos.map((cr, i) => (
            <Renglon key={cr.id} primero={!i} titulo={`${cr.tipo_doc || 'Documento'} ${cr.numero_doc || ''}`.trim()}
              detalle={[fechaNumerica(cr.fecha), cr.sala].filter(Boolean).join(' · ')}
              cifra={formatMoney(cr.saldo)}
              pildora={{ texto: cr.vencido ? `Vencido · ${cr.dias} días` : `${cr.dias} días`, color: cr.vencido ? MARCA.rojo : '#8E8E93' }} />
          )) : <Nada texto="No debe nada." />}
        </Seccion>
      ) : null}

      {(exp.tratamientos ?? []).length ? (
        <Seccion titulo="Tratamientos">
          {exp.tratamientos.map((t, i) => (
            <Renglon key={t.id} primero={!i} titulo={t.nombre}
              detalle={`Cada ${t.intervalo_dias} días${t.proxima ? ` · le toca el ${fechaNumerica(t.proxima)}` : ''}`} />
          ))}
        </Seccion>
      ) : null}

      <Seccion titulo="Últimas compras">
        {(exp.compras ?? []).length ? exp.compras.map((f, i) => (
          <Renglon key={f.id} primero={!i} titulo={f.sala || 'Sala'}
            detalle={`${fechaNumerica(f.fecha)} · ${f.tipo_documento || ''}`.trim()} cifra={formatMoney(f.total)} />
        )) : <Nada texto="Sin compras registradas." />}
      </Seccion>
    </>
  );
}
