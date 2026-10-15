// Mis créditos (2026-10-15, aprobado por el dueño): lo que el cliente compró al
// crédito y todavía debe. Sólo para MIRAR — desde la app no se paga. La lista
// sale del servidor (`mis_creditos`), que la arma con la ficha de la SESIÓN;
// el estado (al día / vence pronto / vencido) también lo decide el servidor,
// con la misma política del portal: un mes de plazo desde la fecha.
// Sólo se llega acá si hay algo pendiente (alerta del Inicio, fila de Cuenta o
// el aviso del teléfono); si se entra igual sin deuda, se dice que está al día.
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
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
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

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
  const vencidos = Number(datos.vencidos) || 0;

  if (!creditos.length) {
    return (
      <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
        <Vacio titulo="Estás al día" icono="checkmark.circle.fill" respaldo="✓" tono={t.color.verde}>
          No tienes créditos pendientes. ¡Gracias por tu confianza!
        </Vacio>
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
              </View>
            </Tarjeta>
          </Entrada>
        );
      })}

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
          El plazo de cada crédito es de {Number(datos.plazo_dias) || 30} días desde la compra. Los abonos se hacen en la sucursal; si ya pagaste, el saldo se actualiza en unas horas.
        </Texto>
      </View>
    </Pantalla>
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
