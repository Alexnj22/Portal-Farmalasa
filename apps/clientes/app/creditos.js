// Mis créditos (2026-10-15, aprobado por el dueño): lo que el cliente compró al
// crédito y todavía debe. Sólo para MIRAR — desde la app no se paga. La lista
// sale del servidor (`mis_creditos`), que la arma con la ficha de la SESIÓN;
// el estado (al día / vence pronto / vencido) también lo decide el servidor,
// con la misma política del portal: un mes de plazo desde la fecha.
// Sólo se llega acá si hay algo pendiente (alerta del Inicio, fila de Cuenta o
// el aviso del teléfono); si se entra igual sin deuda, se dice que está al día.
//
// Pagar en línea (2026-10-20, decisión del dueño): cada crédito se paga por su
// saldo TOTAL con Wompi (`pagar_credito`). Quien abona en la caja es el
// servidor apenas Wompi aprueba, nunca esta pantalla: acá sólo se vuelve a
// leer. Los pagos hechos quedan abajo con su comprobante, también después de
// que el crédito sale de la lista por estar pagado.
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Share, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { sinBloquear } from '../lib/bloqueo';
import { useFocusEffect } from 'expo-router';
import { Cargando, Pantalla, Tarjeta, Texto, Vacio } from '../componentes/ui';
import { Entrada, NumeroAnimado } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import Presionable from '../componentes/Presionable';
import Icono from '../componentes/Icono';
import { useSesion } from '../lib/sesion';
import { dolares, fecha } from '../lib/formato';
import { navegar } from '../lib/navegar';
import { suave, useTema } from '../tema/tema';
import { copiaParaEmpezar } from '../lib/sinConexion';

const ROTULO_ESTADO = { al_dia: 'Al día', vence_pronto: 'Vence pronto', vencido: 'Vencido' };
const ROTULO_DOC = { credito_fiscal: 'Crédito fiscal', consumidor_final: 'Factura' };
const fechaHora = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${fecha(iso.slice(0, 10))} · ${d.toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit', timeZone: 'America/El_Salvador' })}`;
};

export default function Creditos() {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  const [datos, setDatos] = useState(null);
  const [refrescando, setRefrescando] = useState(false);

  // Si falla la red y ya había datos, se conservan; lo de la vez anterior se
  // pinta al instante mientras llega lo fresco (como las demás pantallas).
  const cargar = useCallback(async () => {
    copiaParaEmpezar('mis_creditos', {}).then((c) => { if (c) setDatos((ant) => ant ?? c); });
    const r = await pedir('mis_creditos');
    setDatos((ant) => (r?.ok || !ant?.ok ? r : ant));
  }, [pedir]);
  useFocusEffect(useCallback(() => { cargar(); pedir('pago_preparar'); }, [cargar, pedir]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  // Pagar el saldo total con Wompi. La hoja vuelve sola a
  // `puntossalud://creditos`; después se relee un par de veces porque el
  // abono en la caja tarda unos segundos.
  const pagandoYa = useRef(false);
  const [pagando, setPagando] = useState(null);
  const pagar = (c) => {
    if (pagandoYa.current) return;
    Alert.alert(`Pagar ${dolares(c.saldo)}`,
      `Pagas el saldo completo de ${ROTULO_DOC[c.tipo] ?? 'la factura'}${c.numero ? ` N.° ${c.numero}` : ''} con tarjeta. Se abona solo apenas se apruebe.`,
      [{ text: 'Cancelar', style: 'cancel' }, { text: 'Pagar', onPress: () => cobrar(c) }]);
  };
  const cobrar = async (c) => {
    pagandoYa.current = true;
    setPagando(c.id);
    try {
      const res = await pedir('pagar_credito', { id: c.id });
      if (!res?.ok) { Alert.alert('No se pudo abrir el pago', res?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); await cargar(); return; }
      try {
        await sinBloquear(() => WebBrowser.openAuthSessionAsync(res.url, 'puntossalud://creditos'));
      } catch {
        Alert.alert('No se pudo abrir el pago', 'Intenta de nuevo en un momento.');
        return;
      }
      if (res.prueba) Alert.alert('Cobro de prueba', 'Este cobro fue de prueba: no se cargó dinero y tu crédito sigue igual.');
      for (let i = 0; i < 5; i++) {
        const r = await pedir('mis_creditos');
        if (r?.ok) setDatos(r);
        const suyo = r?.pagos?.find((p) => p.credito_id === c.id);
        if (suyo && suyo.estado !== 'en_proceso') {
          if (suyo.estado === 'aplicado') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          break;
        }
        await new Promise((ok) => setTimeout(ok, 2000));
      }
    } finally {
      pagandoYa.current = false;
      setPagando(null);
    }
  };

  // El color de cada estado: el rojo y el naranja del sistema para lo que pide
  // atención, el verde de la marca para lo que está bien.
  const colorDe = (estado) => (estado === 'vencido' ? colorSistema.rojo : estado === 'vence_pronto' ? colorSistema.naranja : t.color.verde);
  const textoDe = (estado) => (estado === 'vencido' ? colorSistema.rojo : estado === 'vence_pronto' ? colorSistema.naranja : t.color.verdeTexto);

  if (!datos) return <Cargando />;
  if (!datos.ok) {
    return (
      <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
        <Vacio titulo="No se pudo cargar" accion="Reintentar" alAccion={refrescar}>{datos.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'}</Vacio>
      </Pantalla>
    );
  }

  const creditos = Array.isArray(datos.creditos) ? datos.creditos : [];
  const pagos = Array.isArray(datos.pagos) ? datos.pagos : [];
  const vencidos = Number(datos.vencidos) || 0;

  if (!creditos.length) {
    return (
      <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
        <Vacio titulo="Estás al día" icono="checkmark.circle.fill" respaldo="✓" tono={t.color.verde}>
          No tienes créditos pendientes. ¡Gracias por tu confianza!
        </Vacio>
        <PagosEnLaApp pagos={pagos} t={t} />
      </Pantalla>
    );
  }

  return (
    <Pantalla sinVidrio conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
      {/* Lo que se debe en total, arriba y grande. */}
      <Entrada indice={0}>
        <Tarjeta estilo={{ alignItems: 'center', paddingVertical: 24, gap: 6 }}>
          <Texto nivel={2} estilo={{ fontSize: 15 }}>Total pendiente</Texto>
          <NumeroAnimado valor={Number(datos.total) || 0} formato="dolares"
            estilo={{ fontSize: 40, fontWeight: '900', color: colorSistema.texto, textAlign: 'center', fontVariant: ['tabular-nums'] }} />
          <Texto nivel={2} estilo={{ fontSize: 14, textAlign: 'center' }}>
            {creditos.length === 1 ? '1 crédito pendiente' : `${creditos.length} créditos pendientes`}
          </Texto>
          {vencidos ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 }}>
              <Icono sf="exclamationmark.circle.fill" respaldo="!" tam={16} color={colorSistema.rojo} />
              <Text style={{ flex: 1, fontSize: 14, lineHeight: 19, color: colorSistema.texto }}>
                {vencidos === 1 ? 'Uno ya pasó su fecha límite.' : `${vencidos} ya pasaron su fecha límite.`} Cuando puedas, pasa por la sucursal para ponerte al día.
              </Text>
            </View>
          ) : null}
        </Tarjeta>
      </Entrada>

      {creditos.map((c, i) => {
        const color = colorDe(c.estado);
        const pagado = Math.max(0, Number(c.total) - Number(c.saldo));
        return (
          <Entrada key={c.id} indice={Math.min(i + 1, 6)}>
            <Tarjeta estilo={{ flexDirection: 'row', gap: 14, padding: 0 }}>
              {/* La barra de acento: el color del estado. */}
              <View style={{ width: 6, backgroundColor: color }} />
              <View style={{ flex: 1, paddingVertical: 16, paddingRight: 16, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: 17, fontWeight: '700', color: colorSistema.texto }} numberOfLines={1}>
                      {ROTULO_DOC[c.tipo] ?? 'Factura'}{c.numero ? ` N.° ${c.numero}` : ''}
                    </Text>
                    <Text style={{ fontSize: 13, color: colorSistema.texto2 }} numberOfLines={1}>
                      {fecha(c.fecha)}{c.sala ? ` · ${c.sala}` : ''}
                    </Text>
                  </View>
                  <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: color }}>
                    <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '800', color: textoDe(c.estado) }}>{ROTULO_ESTADO[c.estado] ?? ''}</Text>
                  </View>
                </View>

                <Dato rotulo="Monto original" valor={dolares(c.total)} />
                {pagado > 0.004 ? <Dato rotulo="Abonado" valor={dolares(pagado)} /> : null}
                <Dato rotulo="Saldo" valor={dolares(c.saldo)} fuerte />
                <Dato rotulo={c.estado === 'vencido' ? 'Fecha límite (ya pasó)' : 'Fecha límite'} valor={fecha(c.fecha_limite)}
                  color={c.estado === 'al_dia' ? null : textoDe(c.estado)} />
                {c.pago_en_proceso ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, padding: 10, borderRadius: 12, backgroundColor: suave(t.color.verde, t.oscuro ? 0.22 : 0.12) }}>
                    <ActivityIndicator size="small" color={t.color.verdeTexto} />
                    <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: t.color.verdeTexto }}>Pago recibido. Se está aplicando a tu crédito.</Text>
                  </View>
                ) : datos.pagar_en_linea ? (
                  <Presionable onPress={() => pagar(c)} disabled={pagando != null} accessibilityRole="button"
                    accessibilityLabel={`Pagar ${dolares(c.saldo)} en línea`}
                    style={({ pressed }) => ({ marginTop: 6, minHeight: 46, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                      backgroundColor: t.color.magenta, opacity: pagando != null && pagando !== c.id ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                    {pagando === c.id ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Icono sf="creditcard.fill" respaldo="$" tam={16} color="#FFFFFF" />}
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#FFFFFF' }}>{pagando === c.id ? 'Abriendo el pago…' : `Pagar ${dolares(c.saldo)}`}</Text>
                  </Presionable>
                ) : null}
              </View>
            </Tarjeta>
          </Entrada>
        );
      })}

      <PagosEnLaApp pagos={pagos} t={t} />

      {/* ¿Dudas?: al chat, que es donde contesta una persona. */}
      <Presionable onPress={() => navegar('/chat')} accessibilityRole="button" accessibilityLabel="¿Dudas? Escríbenos por el chat"
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}>
        <Tarjeta estilo={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.15) }}>
            <Icono sf="bubble.left.and.bubble.right.fill" respaldo="💬" tam={18} color={t.color.magentaTexto} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>¿Dudas? Escríbenos</Text>
            <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>Te ayudamos con cualquier consulta sobre tus créditos.</Text>
          </View>
          <Icono sf="chevron.right" respaldo="›" tam={14} color={colorSistema.texto3} />
        </Tarjeta>
      </Presionable>

      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginHorizontal: 8, marginTop: 4 }}>
        <Icono sf="info.circle" respaldo="i" tam={15} color={colorSistema.texto3} />
        <Texto nivel={3} estilo={{ flex: 1, fontSize: 13 }}>
          El plazo de cada crédito es de {Number(datos.plazo_dias) || 30} días desde la compra. Puedes pagar aquí el saldo completo con tarjeta, o abonar en la sucursal; lo que pagas en sala se refleja en unos minutos.
        </Texto>
      </View>
    </Pantalla>
  );
}

// Lo que dice cada pago, en palabras del cliente.
const ESTADO_PAGO = {
  aplicado: { texto: 'Aplicado a tu crédito', sf: 'checkmark.seal.fill' },
  en_proceso: { texto: 'Recibido · aplicándose', sf: 'clock.fill' },
  por_devolver: { texto: 'Te lo devolvemos en caja', sf: 'arrow.uturn.backward.circle.fill' },
  prueba: { texto: 'Cobro de prueba', sf: 'testtube.2' },
};

/** Los pagos hechos en la app, cada uno con su comprobante. */
function PagosEnLaApp({ pagos, t }) {
  if (!pagos?.length) return null;
  const compartir = (p) => {
    const lineas = [
      'Comprobante de pago · Farmacias La Salud',
      `Monto: ${dolares(p.monto)}`,
      `Fecha: ${fechaHora(p.fecha)}`,
      p.transaccion ? `Transacción: ${p.transaccion}` : null,
      p.autorizacion ? `Autorización: ${p.autorizacion}` : null,
      p.sala ? `Sucursal del crédito: ${p.sala}` : null,
      `Estado: ${ESTADO_PAGO[p.estado]?.texto ?? ''}`,
    ].filter(Boolean);
    Share.share({ message: lineas.join('\n') }).catch(() => {});
  };
  return (
    <View style={{ gap: 10, marginTop: 8 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.5, color: colorSistema.texto2, marginHorizontal: 8 }}>PAGOS EN LA APP</Text>
      {pagos.map((p) => {
        const e = ESTADO_PAGO[p.estado] ?? ESTADO_PAGO.en_proceso;
        const tono = p.estado === 'aplicado' ? t.color.verdeTexto : p.estado === 'por_devolver' ? colorSistema.naranja : colorSistema.texto2;
        return (
          <Tarjeta key={p.id} estilo={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icono sf={e.sf} respaldo="✓" tam={20} color={tono} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: '800', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(p.monto)}</Text>
                <Text style={{ fontSize: 13, color: tono, fontWeight: '600' }}>{e.texto}</Text>
              </View>
              <Presionable onPress={() => compartir(p)} accessibilityRole="button" accessibilityLabel="Compartir comprobante" hitSlop={6}
                style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.94 : 1 }] })}>
                <Icono sf="square.and.arrow.up" respaldo="↗" tam={18} color={t.color.magentaTexto} />
              </Presionable>
            </View>
            {p.estado === 'por_devolver' && p.devolver ? (
              <Text style={{ fontSize: 14, lineHeight: 19, color: colorSistema.texto }}>
                Ese crédito ya estaba pagado cuando llegó tu pago. Pasa por {p.sala ?? 'la sucursal'} y te devolvemos {dolares(p.devolver)}.
              </Text>
            ) : null}
            <Dato rotulo="Fecha" valor={fechaHora(p.fecha)} />
            {p.transaccion ? <Dato rotulo="Transacción" valor={String(p.transaccion)} /> : null}
            {p.autorizacion ? <Dato rotulo="Autorización" valor={String(p.autorizacion)} /> : null}
            {p.sala ? <Dato rotulo="Sucursal" valor={p.sala} /> : null}
          </Tarjeta>
        );
      })}
    </View>
  );
}

/** Una línea «rótulo ……… valor» del detalle de un crédito. */
function Dato({ rotulo, valor, fuerte = false, color = null }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
      <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>{rotulo}</Text>
      <Text style={{ fontSize: fuerte ? 17 : 15, fontWeight: fuerte ? '800' : '600', color: color ?? colorSistema.texto, fontVariant: ['tabular-nums'] }}>{valor}</Text>
    </View>
  );
}
