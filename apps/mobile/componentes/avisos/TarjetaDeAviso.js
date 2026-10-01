// La tarjeta de UN aviso en la app — la de la campana del portal
// (`TarjetaDeAviso.jsx`), nativa. Reporte del usuario del 2026-10-01, con las
// dos pantallas lado a lado: «mira la diferencia… en la app nativa se ve
// plano, sólo texto, no se ve moderno».
//
// Lo que había perdido la app no era el estilo sino lo que la tarjeta DIBUJA:
// el anillo del cierre del día con una barra por sala, la solicitud con quién
// la pide y sus datos en grilla, el corte con lo que faltó o sobró… Los datos
// salen de las MISMAS funciones del núcleo que usa el portal
// (`utils/avisosDeOperacion`, `cierreDeMeta`, `faltanteDeCaja`,
// `aperturasDeLaManana`, `creditosVencidos`): si un aviso cambia de forma, las
// dos tarjetas se enteran juntas. Lo que no tiene tarjeta propia cae al texto.
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { REQUEST_TYPES } from '@nucleo/store/slices/requestsSlice';
import { cuandoLlego, tituloSinEmoji } from '@nucleo/utils/notificacionTexto';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { datosDeCierreDeEmpresa, datosDeCierreDeMeta, datosDeCierreDelDia } from '@nucleo/utils/cierreDeMeta';
import { datosDeDiferenciasPendientes, datosDeFaltanteDeCaja } from '@nucleo/utils/faltanteDeCaja';
import { datosDeAperturasDeLaManana } from '@nucleo/utils/aperturasDeLaManana';
import { datosDeCreditosVencidos } from '@nucleo/utils/creditosVencidos';
import {
  datosDeAlertaDeVentas, datosDeBitacoraPorVencer, datosDeBolsaNoCuadra, datosDeConteo, datosDeCorteNuevo,
  datosDeCortesPendientes, datosDeDecision, datosDeDeposito, datosDeDiferencia, datosDeFacturaDeSala,
  datosDeHacienda, datosDeMinmaxPendiente, datosDePedido, datosDeRespuesta, datosDeSolicitud,
  datosDeTrasladosPorRespaldo,
} from '@nucleo/utils/avisosDeOperacion';
import Vidrio from '../Vidrio';
import Avatar from '../Avatar';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { Anillo, BarrasDeSalas, Cifra, Fichas, Grilla, Insignia, Lista, Nota, Pasos, Pildora } from './Piezas';

const $ = (v) => formatMoney(v);
const fechaCorta = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'short' }) : null);
const mayuscula = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t);
const firmado = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${$(Math.abs(v))}`;
const VISIBLES = 3;

const ESTADO = {
  APPROVED: ['Aprobada', MARCA.verde], REJECTED: ['Rechazada', MARCA.rojo],
  PARTIAL: ['Parcial', MARCA.ambar], PARCIAL: ['Parcial', MARCA.ambar], CANCELLED: ['Cancelada', MARCA.rojo],
};
const ETAPAS = [
  { id: 'preparacion', rotulo: 'Preparando' }, { id: 'en_camino', rotulo: 'En camino' },
  { id: 'llego', rotulo: 'Llegó' }, { id: 'recibido', rotulo: 'Recibido' },
];

function productos(lista, mas, derecha) {
  const filas = lista.slice(0, VISIBLES).map((p) => [p.nombre, derecha(p)]);
  const resto = lista.length - VISIBLES + (mas || 0);
  return { filas, resto: resto > 0 ? `y ${resto === 1 ? '1 producto más' : `${resto} productos más`}` : null };
}

// Para cada aviso: qué va a la izquierda (anillo, cara o insignia) y qué va en
// el cuerpo. `null` = no tiene tarjeta propia y se muestra el texto.
function armar(n, persona) {
  const quien = (id, nombre, foto) => persona(id) ?? (nombre ? { name: nombre, photo_url: foto } : null);

  let d = datosDeCierreDelDia(n);
  if (d) {
    const dif = d.sucursales.filter((s) => s.diferencia != null && Math.abs(s.diferencia) >= 0.01);
    return {
      lado: <Anillo pct={d.pct} />,
      cuerpo: (
        <>
          <Cifra valor={$(d.venta)} de={d.meta != null ? `de ${$(d.meta)}` : null} />
          {d.variacion != null && d.contra ? (
            <Text style={{ color: d.variacion >= 0 ? MARCA.verde : MARCA.rojo, fontSize: 14, fontWeight: '600' }}>
              {`${Math.abs(Math.round(d.variacion))}% ${d.variacion >= 0 ? 'más' : 'menos'} que ${d.contra}`}
            </Text>
          ) : null}
          <BarrasDeSalas salas={[...d.sucursales].sort((a, b) => b.pct - a.pct).map((s) => ({ sala: s.sala, pct: s.pct, valor: s.venta != null ? $(s.venta) : null }))} />
          <Lista filas={dif.map((s) => [s.sala, `${firmado(s.diferencia)} ${s.diferencia > 0 ? 'sobraron' : 'faltaron'}`, s.diferencia > 0 ? MARCA.ambar : MARCA.rojo])} />
          {d.salasSinCerrar.length ? <Nota rotulo="Sin cerrar" texto={d.salasSinCerrar.join(' · ')} /> : null}
        </>
      ),
    };
  }
  d = datosDeCierreDeMeta(n);
  if (d) {
    return {
      lado: <Anillo pct={d.pct} />,
      cuerpo: (
        <>
          <Cifra valor={d.venta != null ? $(d.venta) : `${Math.round(d.pct)}%`} de={d.meta != null ? `de ${$(d.meta)}` : null} />
          {d.puesto ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Puesto ${d.puesto} de ${d.de}`}</Text> : null}
          <Lista filas={d.tabla.slice(0, 5).map((f) => [`${f.yo ? '★ ' : ''}${f.nombre}`, `${Math.round(f.parte)}%`, f.yo ? MARCA.azulClaro : null])} />
          {d.metaNueva != null ? <Nota rotulo={`Meta de ${d.mesNuevo || 'este mes'}`} texto={$(d.metaNueva)} /> : null}
        </>
      ),
    };
  }
  d = datosDeCierreDeEmpresa(n);
  if (d) {
    return {
      lado: <Anillo pct={d.pct} />,
      cuerpo: (
        <>
          <Cifra valor={d.venta != null ? $(d.venta) : `${Math.round(d.pct)}%`} de={d.meta != null ? `de ${$(d.meta)}` : null} />
          <BarrasDeSalas salas={[...d.sucursales].sort((a, b) => b.pct - a.pct)} />
          <Lista filas={d.top3.map((t, i) => [`${i + 1}. ${t.nombre} · ${t.sala}`, t.venta != null ? $(t.venta) : null])} />
        </>
      ),
    };
  }
  d = datosDeFaltanteDeCaja(n);
  if (d) {
    return {
      lado: <Anillo pct={d.proporcion != null ? 100 - d.proporcion * 100 : 0} color={MARCA.rojo} texto="−" />,
      cuerpo: (
        <>
          <Cifra valor={`Faltaron ${$(d.falta)}`} color={MARCA.rojo} />
          <Grilla celdas={[
            { k: 'c', rotulo: 'Se contó', valor: d.contado != null ? $(d.contado) : '—' },
            { k: 'e', rotulo: 'Debía haber', valor: d.esperado != null ? $(d.esperado) : '—' },
            d.sala && { k: 's', rotulo: 'Sala', valor: d.sala },
            d.hora && { k: 'h', rotulo: 'Corte', valor: hora12(d.hora) || d.hora },
            d.confirmoNombre && { k: 'q', rotulo: 'Lo confirmó', persona: quien(d.confirmoId, d.confirmoNombre), valor: d.confirmoNombre, fila: true },
          ]} />
        </>
      ),
    };
  }
  d = datosDeDiferenciasPendientes(n);
  if (d) {
    return {
      lado: <Insignia icono="Wallet" color={MARCA.rojo} />,
      cuerpo: (
        <>
          <Cifra valor={$(d.total)} de="pendientes" color={MARCA.rojo} />
          <Grilla celdas={[
            { k: 'a', rotulo: 'Sin resolver', valor: `${d.sinResolver} · ${$(d.montoSinResolver)}` },
            { k: 'b', rotulo: 'Por cobrar', valor: `${d.conSaldo} · ${$(d.porCobrar)}` },
          ]} />
        </>
      ),
    };
  }
  d = datosDeAperturasDeLaManana(n);
  if (d) {
    return {
      lado: <Anillo pct={(d.abiertas / d.total) * 100} color={d.completa ? MARCA.verde : MARCA.ambar} texto={`${d.abiertas}/${d.total}`} />,
      cuerpo: (
        <>
          <Lista filas={d.salas.map((s) => [s.quien ? `${s.sala} · ${s.quien}` : s.sala, hora12(s.hora) || s.hora, s.tarde ? MARCA.rojo : MARCA.verde])} />
          {d.noAbrieron.length ? <Nota rotulo="No abrieron" texto={d.noAbrieron.join(' · ')} /> : null}
        </>
      ),
    };
  }
  d = datosDeCreditosVencidos(n);
  if (d) {
    return {
      lado: <Insignia icono="CreditCard" color={MARCA.rojo} />,
      cuerpo: (
        <>
          <Cifra valor={$(d.total)} de={`${d.creditos} crédito${d.creditos === 1 ? '' : 's'}${d.dias ? ` · hasta ${d.dias} días` : ''}`} />
          <Lista filas={d.salas.map((s) => [`${s.sala} · ${s.creditos}`, $(s.total)])} />
        </>
      ),
    };
  }
  d = datosDeCorteNuevo(n);
  if (d) {
    const [texto, color] = d.estado === 'falta' ? [`Faltan ${$(Math.abs(d.tramo))}`, MARCA.rojo]
      : d.estado === 'sobra' ? [`Sobran ${$(d.tramo)}`, MARCA.ambar]
        : d.estado === 'cuadra' ? ['Cuadra', MARCA.verde] : ['Sin conteo', colorSistema.texto2];
    return {
      lado: <Avatar empleado={quien(d.quienId, d.quien, d.quienFoto)} tamano={44} />,
      cuerpo: (
        <>
          <Pildora texto={texto} color={color} />
          <Grilla celdas={[
            d.contado != null && { k: 'c', rotulo: 'Contó', valor: $(d.contado) },
            d.ventas != null && { k: 'v', rotulo: 'Ventas', valor: $(d.ventas) },
            d.sala && { k: 's', rotulo: 'Sala', valor: d.sala },
            d.hora && { k: 'h', rotulo: 'Hora', valor: hora12(d.hora) || d.hora },
          ]} />
        </>
      ),
    };
  }
  d = datosDeBitacoraPorVencer(n);
  if (d) {
    return {
      lado: <Insignia icono="Thermometer" color={d.cerrada ? MARCA.rojo : MARCA.ambar} />,
      cuerpo: (
        <>
          <Pildora texto={d.cerrada ? `Cerró a las ${hora12(d.cierra) || d.cierra}` : `Cierra en ${d.quedan} min`} color={d.cerrada ? MARCA.rojo : MARCA.ambar} />
          <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
            {`${d.pendientes} pendiente${d.pendientes === 1 ? '' : 's'}`}
            {d.lecturas ? ` · ${d.lecturas} lectura${d.lecturas === 1 ? '' : 's'}` : ''}
            {d.limpiezas ? ` · ${d.limpiezas} limpieza${d.limpiezas === 1 ? '' : 's'}` : ''}
          </Text>
          <Fichas textos={d.areas} color={MARCA.ambar} />
        </>
      ),
    };
  }
  d = datosDeTrasladosPorRespaldo(n);
  if (d) {
    const resto = d.traslados.length - VISIBLES;
    return {
      lado: <Insignia icono="ArrowLeftRight" />,
      cuerpo: <Lista filas={d.traslados.slice(0, VISIBLES).map((t) => [`${t.destino} · ${t.producto ?? ''}${t.mas ? ` y ${t.mas} más` : ''}`, t.unidades != null ? `${t.unidades} u.` : null])}
        resto={resto > 0 ? `y ${resto} traslado${resto === 1 ? '' : 's'} más` : null} />,
    };
  }
  d = datosDeMinmaxPendiente(n);
  if (d) {
    return {
      lado: <Avatar empleado={quien(d.quienId, d.quien, d.quienFoto)} tamano={44} />,
      cuerpo: (
        <>
          {d.producto ? <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{d.producto}</Text> : null}
          <Grilla celdas={[
            { k: 'h', rotulo: 'Hoy', valor: d.minHoy != null ? `${d.minHoy} · ${d.maxHoy}` : 'Sin par' },
            { k: 'n', rotulo: 'Propone', valor: `${d.minNuevo} · ${d.maxNuevo}`, color: MARCA.azulClaro },
            d.existencia != null && { k: 'e', rotulo: 'Existencia', valor: `${d.existencia}` },
            d.ventasMesCurso != null && { k: 'v', rotulo: 'Vendido este mes', valor: `${d.ventasMesCurso}` },
          ]} />
          <Nota rotulo="Por qué" texto={d.motivo} />
        </>
      ),
    };
  }
  d = datosDeBolsaNoCuadra(n);
  if (d) {
    return {
      lado: <Insignia icono="Package" color={MARCA.rojo} />,
      cuerpo: (
        <>
          <Cifra valor={firmado(d.neto)} de="de diferencia" color={d.neto < 0 ? MARCA.rojo : MARCA.ambar} />
          <Lista filas={d.lista.map((b) => [`Bolsa ${b.folio}${b.fecha ? ` · ${fechaCorta(b.fecha)}` : ''}`, firmado(b.dif), b.dif < 0 ? MARCA.rojo : MARCA.ambar])} />
        </>
      ),
    };
  }
  d = datosDeDeposito(n);
  if (d) {
    return {
      lado: <Insignia icono="Landmark" color={MARCA.verde} />,
      cuerpo: (
        <Grilla celdas={[
          { k: 'b', rotulo: d.destino === 'BANCO' ? 'Al banco' : 'Destino', valor: d.banco || mayuscula(d.destino) },
          d.bolsas != null && { k: 'n', rotulo: 'Bolsas', valor: `${d.bolsas}` },
          d.montoBanco ? { k: 'm', rotulo: 'Depositado', valor: $(d.montoBanco), color: MARCA.verde } : null,
          d.montoEfectivo ? { k: 'e', rotulo: 'En efectivo', valor: $(d.montoEfectivo) } : null,
          d.quien && { k: 'q', rotulo: d.quienLleva ? 'Lo lleva' : 'Lo entregó', persona: quien(d.quienId, d.quien, d.quienFoto), valor: d.quien, fila: true },
        ]} />
      ),
    };
  }
  d = datosDeAlertaDeVentas(n);
  if (d) {
    return {
      lado: <Insignia icono="AlertTriangle" color={d.urgente ? MARCA.rojo : MARCA.ambar} />,
      cuerpo: (
        <>
          <Grilla celdas={[
            { k: 'n', rotulo: 'Documento', valor: d.numero },
            d.total != null && { k: 't', rotulo: 'Total', valor: $(d.total) },
            d.cliente && { k: 'c', rotulo: 'Cliente', valor: d.cliente, fila: true },
            d.vendedor && { k: 'v', rotulo: 'Vendedor', persona: quien(d.vendedorId, d.vendedor, d.vendedorFoto), valor: d.vendedor, fila: true },
          ]} />
          <Fichas textos={d.problemas} color={MARCA.rojo} />
        </>
      ),
    };
  }
  d = datosDeFacturaDeSala(n);
  if (d) {
    return {
      lado: <Insignia icono="ReceiptText" />,
      cuerpo: (
        <>
          <Cifra valor={$(d.total)} />
          <Lista filas={d.lista.map((f) => [`${f.etiqueta}${f.fecha ? ` · ${fechaCorta(f.fecha)}` : ''}`, f.monto != null ? $(f.monto) : null])} />
        </>
      ),
    };
  }
  d = datosDeCortesPendientes(n);
  if (d) {
    return {
      lado: <Insignia icono="Wallet" color={MARCA.ambar} />,
      cuerpo: <Lista filas={d.lista.map((c) => [`${fechaCorta(c.fecha) ?? ''} ${hora12(c.hora) || ''} · ${c.quien ?? ''}`,
        c.sinConteo ? 'Sin conteo' : firmado(c.tramo), c.sinConteo ? null : c.tramo < 0 ? MARCA.rojo : c.tramo > 0 ? MARCA.ambar : MARCA.verde])} />,
    };
  }
  d = datosDePedido(n);
  if (d) {
    return {
      lado: <Insignia icono="Truck" color={n.type === 'PEDIDO_PROBLEMA' ? MARCA.rojo : MARCA.azulClaro} />,
      cuerpo: (
        <>
          <Pasos pasos={ETAPAS} actual={d.etapa} color={n.type === 'PEDIDO_PROBLEMA' ? MARCA.rojo : MARCA.azulClaro} />
          <Grilla celdas={[
            d.sala && { k: 's', rotulo: 'Sala', valor: d.sala },
            d.cajas != null && { k: 'c', rotulo: 'Cajas', valor: `${d.cajas}` },
            !d.numerosEnTitulo && d.numeros.length && { k: 'n', rotulo: 'Pedido', valor: d.numeros.map((x) => `#${x}`).join(' · '), fila: true },
            d.conductor && { k: 'q', rotulo: 'Lo lleva', persona: quien(d.conductorId, d.conductor), valor: d.conductor, fila: true },
          ]} />
          <Nota texto={d.detalle} />
        </>
      ),
    };
  }
  d = datosDeSolicitud(n);
  if (d) {
    const deFactura = !!(d.doc || d.fecha);
    const abono = d.tipo === 'ABONO_APROBACION';
    const lista = d.productos.length ? productos(d.productos, d.mas, (p) => (p.cantidad != null ? `×${p.cantidad}` : null)) : null;
    return {
      lado: <Insignia icono={d.tipo.startsWith('INVENTORY_TRANSFER') ? 'ArrowLeftRight' : 'ClipboardList'} color={MARCA.ambar} />,
      encabezado: [d.sala, d.etiqueta ?? REQUEST_TYPES[d.tipo]?.label].filter(Boolean).join(' · '),
      cuerpo: (
        <>
          <Grilla celdas={[
            { k: 'q', rotulo: d.tipo === 'INVENTORY_TRANSFER_PUSH' ? 'Lo envía' : 'Lo pide', persona: quien(d.quienId, d.quien, d.quienFoto), valor: d.quien ?? 'Sin nombre', fila: true },
            d.fecha && { k: 'f', rotulo: 'Fecha', valor: fechaCorta(d.fecha) },
            d.monto != null && (deFactura || abono) && { k: 'm', rotulo: 'Monto', valor: $(d.monto) },
            d.doc && { k: 'd', rotulo: 'Documento', valor: d.doc },
            d.pago && { k: 'p', rotulo: 'Pago', valor: mayuscula(d.pago) },
            d.cliente && (deFactura || abono) && { k: 'c', rotulo: 'Cliente', valor: d.cliente, fila: true },
            d.antes && { k: 'a', rotulo: 'Hoy', valor: mayuscula(d.antes) },
            d.despues && { k: 'n', rotulo: d.antes ? 'Pasa a' : d.tipo === 'VENDOR_CHANGE_REQUEST' ? 'Nuevo vendedor' : 'Nuevo', valor: mayuscula(d.despues), color: MARCA.azulClaro },
            (d.desde || d.hasta) && { k: 'r', rotulo: 'Fechas', valor: [fechaCorta(d.desde), fechaCorta(d.hasta)].filter(Boolean).join(' – '), fila: true },
          ]} />
          {lista ? <Lista filas={lista.filas} resto={lista.resto} /> : null}
          <Nota rotulo={d.tipo === 'INVENTORY_TRANSFER_PUSH' ? 'Por qué lo envía' : 'Por qué lo pide'} texto={d.motivo} />
        </>
      ),
    };
  }
  d = datosDeRespuesta(n);
  if (d) {
    const [texto, color] = ESTADO[d.estado] ?? [mayuscula(d.estado), MARCA.azulClaro];
    const lista = d.productos.length ? productos(d.productos, d.mas, (p) => (p.enviada != null ? `${p.enviada} de ${p.pedida ?? '—'}` : null)) : null;
    return {
      lado: <Avatar empleado={quien(d.quienId, d.quien, d.quienFoto)} tamano={44} />,
      cuerpo: (
        <>
          <Pildora texto={texto} color={color} />
          {lista ? <Lista filas={lista.filas} resto={lista.resto} /> : null}
          {d.devueltos.length ? <Lista filas={d.devueltos.map((p) => [p.nombre, p.motivo ?? 'Devuelto', MARCA.rojo])} /> : null}
          <Nota rotulo="Motivo" texto={d.motivo} />
          <Nota rotulo="Nota" texto={d.nota} />
          <Nota rotulo="En su lugar" texto={d.alternativa} />
        </>
      ),
    };
  }
  d = datosDeDecision(n);
  if (d) {
    return {
      lado: <Avatar empleado={quien(d.quienId, d.quien, d.quienFoto)} tamano={44} />,
      encabezado: [d.sala, d.etiqueta ?? (d.tipo ? REQUEST_TYPES[d.tipo]?.label : null)].filter(Boolean).join(' · '),
      cuerpo: (
        <>
          <Pildora texto={d.aprobada ? 'Aprobada' : 'Rechazada'} color={d.aprobada ? MARCA.verde : MARCA.rojo} />
          <Grilla celdas={[
            d.producto && { k: 'pr', rotulo: 'Producto', valor: d.producto, fila: true },
            d.min != null && { k: 'mm', rotulo: 'MIN · MAX', valor: `${d.min} · ${d.max}`, color: MARCA.azulClaro },
            d.fecha && { k: 'f', rotulo: 'Fecha', valor: fechaCorta(d.fecha) },
            d.monto != null && { k: 'm', rotulo: 'Monto', valor: $(d.monto) },
            d.doc && { k: 'd', rotulo: 'Documento', valor: d.doc },
            d.cliente && { k: 'c', rotulo: 'Cliente', valor: d.cliente, fila: true },
            d.antes && { k: 'a', rotulo: 'Antes', valor: mayuscula(d.antes) },
            d.despues && { k: 'n', rotulo: 'Ahora', valor: mayuscula(d.despues), color: MARCA.azulClaro },
          ]} />
          {d.productos.length ? <Lista filas={d.productos.slice(0, VISIBLES).map((p) => [p.nombre, p.cantidad != null ? `×${p.cantidad}` : null])} /> : null}
          <Nota rotulo="Nota" texto={d.nota} />
          <Nota rotulo="Qué hacer" texto={d.instruccion} />
        </>
      ),
    };
  }
  d = datosDeDiferencia(n);
  if (d) {
    return {
      lado: <Insignia icono="PackageMinus" color={MARCA.ambar} />,
      cuerpo: (
        <>
          {d.producto ? <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{d.producto}</Text> : null}
          <Grilla celdas={[
            d.enviada != null && { k: 'e', rotulo: 'Se envió', valor: `${d.enviada}` },
            d.recibida != null && { k: 'r', rotulo: 'Llegó', valor: `${d.recibida}`, color: d.recibida < (d.enviada ?? 0) ? MARCA.rojo : null },
            d.sala && { k: 's', rotulo: 'Sala', valor: d.sala },
            d.corto && { k: 'q', rotulo: 'Qué pasa', valor: d.corto },
          ]} />
          <Nota texto={d.nota} />
        </>
      ),
    };
  }
  d = datosDeConteo(n);
  if (d) {
    return {
      lado: <Insignia icono="ClipboardCheck" />,
      cuerpo: (
        <>
          <Cifra valor={`${d.productos}`} de={`producto${d.productos === 1 ? '' : 's'} por contar${d.sala ? ` · ${d.sala}` : ''}`} />
          <Fichas textos={d.grupos.map((g) => `${g.clave === 'BAJO_RECETA' ? 'Bajo receta' : g.clave} · ${g.n}`)} />
        </>
      ),
    };
  }
  d = datosDeHacienda(n);
  if (d) {
    return {
      lado: <Insignia icono="FileCheck" color={d.fallidas ? MARCA.rojo : MARCA.verde} />,
      cuerpo: (
        <>
          <Grilla celdas={[
            { k: 'r', rotulo: 'Entraron', valor: `${d.resueltas}`, color: MARCA.verde },
            { k: 'f', rotulo: 'Rechazadas', valor: `${d.fallidas}`, color: d.fallidas ? MARCA.rojo : null },
          ]} />
          <Lista filas={d.facturas.slice(0, VISIBLES).map((f) => [`${f.sala ?? ''} ${f.doc ?? ''} · ${f.motivo ?? ''}`, f.monto != null ? $(f.monto) : null])} />
        </>
      ),
    };
  }
  return null;
}

export default function TarjetaDeAviso({ n, persona, detalle, onAbrir }) {
  const t = armar(n, persona);
  const autor = persona(n.created_by);
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onAbrir(); }}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={22} interactivo>
        <View style={{ padding: 14, gap: 10 }}>
          {t?.encabezado ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{t.encabezado}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            {t?.lado ?? (autor ? <Avatar empleado={autor} tamano={44} /> : <Insignia icono="Bell" />)}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{tituloSinEmoji(n.title)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{cuandoLlego(n.created_at)}</Text>
            </View>
          </View>
          {t?.cuerpo ?? (
            <>
              {detalle?.contexto ? <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{detalle.contexto}</Text> : null}
              {detalle?.renglones?.length ? (
                <Lista filas={detalle.renglones.map(([a, b]) => [a, b])} resto={detalle.resto ? `y ${detalle.resto} más` : null} />
              ) : null}
              {!detalle && n.body ? <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={6}>{n.body}</Text> : null}
              {detalle?.pie ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{detalle.pie}</Text> : null}
            </>
          )}
        </View>
      </Vidrio>
    </Pressable>
  );
}
