// Resolver una reserva de sala que no llegó entera, NATIVO (2026-10-22) —
// gemela de `ResolverReserva` del portal. La otra sala no la mandó, mandó
// menos, o Bodega no la consigue:
//   1. pedir lo que falta a OTRA sala que lo tenga (el mismo
//      `usePedirTraslado` del núcleo; el traslado viaja con `reserva_id` y,
//      al recibirlo, la reserva queda lista sola);
//   2. encargarlo a Bodega — si responde con otro precio, decide el cliente;
//   3. lo que decida el cliente: quedarse con una parte, una alternativa de
//      esta sala (puede ser mixto) o todo a su favor.
// Las cuentas del dinero las hace la base (`reserva_ajustar`); acá sólo se
// muestran antes de confirmar, con el mismo `repartoDelAjuste`.
//
// (2026-10-22, v2.1346.0 del portal) También las reservas de la APP: si la
// sala no tiene lo que el cliente reservó («Traer de otra sala»,
// `reservaPorTraer`) o la otra sala no lo mandó (`reservaPorResolver`), se
// pide a otra sala o a Bodega, y mientras viene en camino su plazo de 24 h
// para preparar está detenido. Desde el 2026-10-26 también se ajusta como una
// de sala (reglamento, cláusula 3.6), pagada en caja o en línea: se le llama
// al cliente antes y la app le avisa lo que quedó.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { usePedirTraslado } from '@nucleo/hooks/usePedirTraslado';
import {
  ajustarReserva, codigoDeReserva, decidirPrecioDeBodega, encargarRestoABodega, faltaDeReserva, fetchReservasDeSucursal, pagadoDeReserva, preciosDeProducto, repartoDelAjuste,
  reservaPorTraer,
} from '@nucleo/data/reservas';
import { pilaDelCliente, textoAlNoAceptarElPrecio, textoDeResolverDeLaApp } from '@nucleo/utils/reservasDeSala';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../componentes/formulario/Piezas';
import Segmentos from '../componentes/Segmentos';
import BuscadorProducto from '../componentes/compras/BuscadorProducto';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';

export default function ResolverReservaNativo() {
  const { id, sala: salaParam } = useLocalSearchParams();
  const { user } = useAuth();
  const sala = salaParam ?? user?.branchId ?? user?.branch_id ?? null;
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [vista, setVista] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchReservasDeSucursal(sala, true).then((filas) => {
      if (!vivo) return;
      const f = (filas || []).find((x) => String(x.id) === String(id));
      if (!f) { setError('Esa reserva ya no está abierta.'); return; }
      setR(f);
      const precio = f.traslado_estado === 'precio' && f.encargo?.estado === 'confirmado';
      setVista(precio ? 'precio' : faltaDeReserva(f) > 0 ? 'pedir' : 'cliente');
    }).catch((e) => { if (vivo) setError(mensajeAmigable(e, 'No se pudo cargar la reserva.')); });
    return () => { vivo = false; };
  }, [id, sala]);

  const hacer = useCallback(async (fn, titulo, detalle) => {
    setOcupado(true);
    try {
      const res = await fn();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(titulo, typeof detalle === 'function' ? detalle(res) : detalle);
      router.back();
    } catch (e) {
      fallo('No se pudo', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally { setOcupado(false); }
  }, []);

  if (!r) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Resolver' }} />
        <View style={{ padding: 16 }}>{error ? <Aviso tono="cuidado" texto={error} /> : <ActivityIndicator />}</View>
      </>
    );
  }

  const falta = faltaDeReserva(r);
  const precioDistinto = r.traslado_estado === 'precio' && r.encargo?.estado === 'confirmado';
  const opciones = [
    ...(precioDistinto ? [{ id: 'precio', label: 'Precio' }] : []),
    ...(falta > 0 && !precioDistinto ? [{ id: 'pedir', label: 'Otra sala' }, { id: 'bodega', label: 'Bodega' }] : []),
    { id: 'cliente', label: 'El cliente' },
  ];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: `${reservaPorTraer(r) ? 'Traer' : 'Resolver'} ${codigoDeReserva(r.id)}` }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <Seccion titulo={`${r.cantidad} × ${r.producto}`} pie={pilaDelCliente(r)}>
            <Dato rotulo="Llegaron" valor={String(r.traslado_llegaron ?? 0)} primero />
            <Dato rotulo="Vienen en camino" valor={String(r.traslado_por_llegar ?? 0)} />
            <Dato rotulo="Faltan" valor={String(falta)} fuerte />
          </Seccion>
          {r.traslado_nota ? <Aviso tono="cuidado" texto={r.traslado_nota} /> : null}
          {opciones.length > 1 ? <Segmentos opciones={opciones} activa={vista} onCambiar={setVista} margen={0} /> : null}
          {vista === 'precio' ? <PrecioDeBodega r={r} ocupado={ocupado} hacer={hacer} /> : null}
          {vista === 'pedir' ? <PedirAOtraSala r={r} falta={falta} ocupado={ocupado} hacer={hacer} /> : null}
          {vista === 'bodega' ? (
            <>
              <Aviso texto="Bodega confirma el precio y para cuándo. Si es el mismo precio sigue sola; si es otro, decide el cliente. Cuando llegue, la reserva queda lista sola." />
              {falta > 20 ? <Aviso tono="cuidado" texto={`Bodega encarga hasta 20 por pedido y faltan ${falta}.`} /> : null}
              <BotonGrande texto={ocupado ? 'Encargando…' : `Encargar ${falta} a Bodega`} color={MARCA.azulClaro} deshabilitado={ocupado || falta > 20}
                onPress={() => hacer(() => encargarRestoABodega(r.id), 'Encargado a Bodega', (res) => `${res?.codigo ?? ''} · ${falta} × ${r.producto}`)} />
            </>
          ) : null}
          {vista === 'cliente' ? <LoDecideElCliente r={r} ocupado={ocupado} hacer={hacer} /> : null}
          {textoDeResolverDeLaApp(r) ? <Aviso texto={textoDeResolverDeLaApp(r)} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function PrecioDeBodega({ r, ocupado, hacer }) {
  const e = r.encargo;
  const decidir = (acepta) => hacer(() => decidirPrecioDeBodega(r.id, acepta),
    acepta ? 'Precio aceptado' : 'Precio no aceptado',
    (res) => (acepta ? (res?.codigo_nueva ? `El resto quedó en ${res.codigo_nueva}, a su precio.` : 'Bodega sigue con el pedido.')
      : textoAlNoAceptarElPrecio()));
  return (
    <>
      <Seccion titulo="Bodega lo consigue a otro precio" pie="Pregúntale al cliente.">
        <Dato rotulo="Bodega" valor={`${formatMoney(Number(e.precio))} c/u`} primero fuerte />
        <Dato rotulo="Se reservó a" valor={`${formatMoney(Number(r.precio))} c/u`} />
        {e.fecha ? <Dato rotulo="Llega aprox." valor={e.fecha.split('-').reverse().slice(0, 2).join('/')} /> : null}
      </Seccion>
      <BotonGrande texto={`Acepta ${formatMoney(Number(e.precio))}`} color={MARCA.verde} deshabilitado={ocupado} onPress={() => decidir(true)} />
      <BotonGrande texto="No acepta" borde deshabilitado={ocupado} onPress={() => decidir(false)} />
    </>
  );
}

function PedirAOtraSala({ r, falta, ocupado, hacer }) {
  const factor = Number(r.factor ?? 1);
  const productoInicial = useMemo(() => ({ erp_product_id: r.producto_id, descripcion: r.producto }), [r.producto_id, r.producto]);
  const h = usePedirTraslado({ productoInicial });
  const { setCantidad, setPresIdx, setOrigenId, presentaciones } = h;
  const necesita = falta * factor;
  // Sólo el estante de operación y sólo quien alcanza (igual que `DeOtraSala`).
  const candidatos = useMemo(() => h.donde.filter((d) => !d.vencidos && d.branch_id && Number(d.unidades) >= necesita), [h.donde, necesita]);
  const [eleccion, setEleccion] = useState(null);
  const efectiva = eleccion ?? (candidatos[0] ? String(candidatos[0].erp_sucursal_id) : null);
  const elegido = candidatos.find((d) => String(d.erp_sucursal_id) === efectiva) ?? null;

  useEffect(() => { setCantidad(String(falta)); }, [falta, setCantidad]);
  useEffect(() => {
    const i = (presentaciones ?? []).findIndex((p) => Number(p.factor || 1) === factor);
    if (i >= 0) setPresIdx(String(i));
  }, [presentaciones, factor, setPresIdx]);
  useEffect(() => { if (elegido) setOrigenId(`${elegido.erp_sucursal_id}`); }, [elegido, setOrigenId]);
  const lista = Boolean(elegido && h.lineaLista && String(h.origenId) === String(elegido.erp_sucursal_id));

  if (!h.donde.length) return <ActivityIndicator />;
  if (!candidatos.length) return <Aviso texto={`Ninguna otra sala tiene ${necesita} unidades. Encárgalo a Bodega.`} />;
  return (
    <>
      <Seccion titulo={`Faltan ${falta}: ¿quién los tiene?`}>
        <Opciones valor={efectiva} onCambiar={setEleccion}
          opciones={candidatos.map((d) => ({ id: String(d.erp_sucursal_id), label: d.sala, detalle: `Tiene ${Number(d.unidades)} unidades` }))} />
      </Seccion>
      {elegido && h.avisoVence ? <Aviso tono={h.avisoVence.grave ? 'freno' : 'cuidado'} texto={h.avisoVence.texto} /> : null}
      <BotonGrande texto={ocupado ? 'Pidiendo…' : elegido ? `Pedir ${falta} a ${elegido.sala}` : 'Pedir'} color={MARCA.azulClaro}
        deshabilitado={ocupado || !lista}
        onPress={() => hacer(() => h.enviarSoloEsta(`Reserva ${codigoDeReserva(r.id)} para ${pilaDelCliente(r)}`, { reserva_id: r.id }),
          'Traslado pedido', `${elegido?.sala ?? 'La sala'} manda ${falta}. Cuando llegue, la reserva queda lista sola.`)} />
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Si ninguna sala lo tiene, encárgalo a Bodega.</Text>
    </>
  );
}

function LoDecideElCliente({ r, ocupado, hacer }) {
  const yaViene = Number(r.traslado_llegaron ?? 0) + Number(r.traslado_por_llegar ?? 0);
  const [queda, setQueda] = useState(String(Math.min(yaViene, Number(r.cantidad))));
  const [conAlternativa, setConAlternativa] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [alt, setAlt] = useState(null);
  const [precios, setPrecios] = useState(null);
  const [pres, setPres] = useState('');
  const [cantAlt, setCantAlt] = useState('1');
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    let vivo = true;
    if (!alt) return undefined;
    preciosDeProducto(alt.id).then((p) => {
      if (!vivo) return;
      setPrecios(p);
      if (p[0]) setPres(`${p[0].factor}|${p[0].precio}`);
    }).catch(() => { if (vivo) setPrecios([]); });
    return () => { vivo = false; };
  }, [alt]);

  const n = Number.parseInt(queda, 10);
  const nAlt = Number.parseInt(cantAlt, 10);
  const [factorAlt, precioAlt] = pres ? pres.split('|').map(Number) : [null, null];
  const usaAlt = conAlternativa && alt && pres && nAlt >= 1;
  const pagado = pagadoDeReserva(r);
  const reparto = repartoDelAjuste({ pagado, precio: Number(r.precio ?? 0), cantidad: Number.isFinite(n) ? n : 0,
    totalAlternativa: usaAlt ? precioAlt * nAlt : 0 });
  const falta = !Number.isFinite(n) || n < 0 || n > Number(r.cantidad) ? `Del original se queda de 0 a ${r.cantidad}.`
    : conAlternativa && !usaAlt ? 'Elige la alternativa, su presentación y cuántas.'
      : n === Number(r.cantidad) && !usaAlt ? 'Así no cambia nada.'
        : n === 0 && !usaAlt ? 'Si no lleva nada, cancela la reserva desde la lista: lo pagado queda a su favor.'
          : motivo.trim().length < 3 ? 'Escribe qué decidió el cliente.' : null;

  const confirmar = () => hacer(() => ajustarReserva(r.id, {
    cantidad: n, motivo,
    alternativa: usaAlt ? { producto_id: alt.id, producto_nombre: alt.nombre, factor: factorAlt, cantidad: nAlt, precio: precioAlt } : null,
  }), 'Reserva ajustada', (res) => [
    res?.alternativa ? `La alternativa quedó apartada en ${res.alternativa}.` : '',
    Number(res?.a_favor) > 0 ? `${formatMoney(Number(res.a_favor))} quedan a su favor.` : '',
  ].filter(Boolean).join(' ') || 'Listo.');

  return (
    <>
      <Seccion titulo={`Del original se queda (de ${r.cantidad})`} pie={yaViene ? `Llegó o viene: ${yaViene}.` : undefined}>
        <Campo multiline={false} value={queda} onChangeText={setQueda} keyboardType="number-pad" />
      </Seccion>
      <BotonGrande texto={conAlternativa ? 'Quitar la alternativa' : 'Agregar una alternativa de esta sala'} borde
        onPress={() => { setConAlternativa((v) => !v); setBuscando(!conAlternativa && !alt); }} />
      {conAlternativa ? (
        <Seccion titulo="Alternativa" pie="Se aparta de lo que hay en esta sala, con el precio de hoy.">
          {buscando || !alt ? (
            <BuscadorProducto onElegir={(p) => { setAlt({ id: Number(p.id), nombre: p.nombre }); setPrecios(null); setPres(''); setBuscando(false); }}
              onCancelar={() => { setBuscando(false); if (!alt) setConAlternativa(false); }} />
          ) : (
            <>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} onPress={() => setBuscando(true)}>{`${alt.nombre} · cambiar`}</Text>
              {precios == null ? <ActivityIndicator /> : (
                <Opciones valor={pres} onCambiar={setPres}
                  opciones={precios.map((p) => ({ id: `${p.factor}|${p.precio}`, label: `${p.tipo} · ${formatMoney(p.precio)}` }))} />
              )}
              <Campo multiline={false} value={cantAlt} onChangeText={setCantAlt} keyboardType="number-pad" placeholder="Cantidad" />
            </>
          )}
        </Seccion>
      ) : null}
      <Seccion titulo="Qué decidió el cliente">
        <Campo value={motivo} onChangeText={setMotivo} maxLength={300} placeholder="Ej.: se lleva las 2 que llegaron y 2 de la alternativa" />
      </Seccion>
      {Number.isFinite(n) && pagado > 0 ? (
        <Aviso texto={`De ${formatMoney(pagado)} pagados: ${formatMoney(reparto.queda)} quedan en esta reserva${usaAlt ? `, ${formatMoney(reparto.alternativa)} pasan a la alternativa` : ''}${reparto.aFavor > 0 ? ` y ${formatMoney(reparto.aFavor)} quedan a su favor` : ''}.`} />
      ) : null}
      {falta ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{falta}</Text> : null}
      <BotonGrande texto={ocupado ? 'Guardando…' : 'Confirmar lo que decidió'} color={MARCA.verde} deshabilitado={ocupado || !!falta} onPress={confirmar} />
    </>
  );
}
