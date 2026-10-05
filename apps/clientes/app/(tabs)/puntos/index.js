// Mis puntos. Se habla en DÓLARES primero —«$4.20 de descuento» se entiende,
// «420 puntos» no— y el número de puntos va como el detalle de la cifra.
// Misma decisión que /mis-puntos de la web.
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Aviso, Cargando, Pantalla, Tarjeta, Texto, Titulo } from '../../../componentes/ui';
import { useCuenta } from '../../../lib/cuenta';
import { diasHasta, entero, fecha, nombrePropio } from '../../../lib/formato';
import { BarraAnimada, Confeti, Entrada, Latido, NumeroAnimado, Tocable } from '../../../componentes/animacion';
import { useSesion } from '../../../lib/sesion';
import { suave, useTema } from '../../../tema/tema';
import { colorSistema } from '../../../componentes/sistema';

const MINIMO_DE_CANJE = 100;
// El signo sale del NÚMERO, no del tipo: un ajuste puede sumar o restar.
const ROTULOS = {
  compra: 'Compra', canje: 'Canje', vencimiento: 'Vencieron', anulacion: 'Compra anulada', ajuste: 'Ajuste',
  cumpleanos: 'Regalo de cumpleaños', canje_devuelto: 'Canje devuelto',
};

export default function Puntos() {
  const t = useTema();
  const { resumen, error, cargar } = useCuenta();
  const [refrescando, setRefrescando] = useState(false);
  const pedir = useSesion((s) => s.pedir);
  const [mas, setMas] = useState([]);
  const [cargandoMas, setCargandoMas] = useState(false);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  // Al refrescar el resumen, lo cargado de más se descarta: vuelve a empezar.
  useEffect(() => { setMas([]); }, [resumen]);

  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  if (!resumen && !error) return <Cargando />;
  if (!resumen) return <Pantalla alRefrescar={refrescar} refrescando={refrescando}><Aviso>{error}</Aviso></Pantalla>;

  if (resumen.pendiente) {
    return (
      <Pantalla alRefrescar={refrescar} refrescando={refrescando}>
        <Tarjeta tono={t.color.verde}>
          <Titulo>¡Ya casi!</Titulo>
          <Texto>
            Tu registro está guardado. En tu próxima compra en cualquiera de nuestras salas di que te uniste desde la
            app y muestra tu DUI: desde esa compra empiezas a acumular.
          </Texto>
          <Texto nivel={3}>Mientras tanto ya puedes ver las ofertas.</Texto>
        </Tarjeta>
      </Pantalla>
    );
  }

  const saldo = Number(resumen.saldo ?? 0);
  const falta = Math.max(0, MINIMO_DE_CANJE - saldo);
  const congelado = resumen.consentimiento?.programa === false;
  const movimientos = [...resumen.movimientos, ...mas];
  const total = resumen.movimientos_total ?? movimientos.length;
  const verMas = async () => {
    setCargandoMas(true);
    const r = await pedir('movimientos', { desde: movimientos.length });
    if (r?.ok) setMas((x) => [...x, ...r.movimientos]);
    setCargandoMas(false);
  };
  const primerNombre = nombrePropio(String(resumen.nombre ?? '').split(' ')[0]);

  return (
    <Pantalla alRefrescar={refrescar} refrescando={refrescando}>
      <Entrada indice={0}>
        <Texto nivel={2} estilo={{ fontSize: 17 }}>Hola, {primerNombre}</Texto>
      </Entrada>

      {/* El saldo cuenta hacia arriba al abrir y la barra se llena con resorte:
          lo primero que la persona ve es la cifra MOVERSE hacia lo que tiene. */}
      <Entrada indice={1}>
        <Tarjeta tono={t.color.magenta} estilo={{ paddingVertical: 24 }}>
          <Texto nivel={2}>Tienes de descuento</Texto>
          <NumeroAnimado valor={resumen.equivale} formato="dolares"
            estilo={{ fontSize: 52, fontWeight: '800', color: t.color.magentaTexto, fontVariant: ['tabular-nums'], letterSpacing: -1 }} />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <NumeroAnimado valor={saldo} formato="entero" estilo={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }} />
            <Texto nivel={2}>puntos</Texto>
          </View>
          {falta > 0 ? (
            <View style={{ gap: 8, marginTop: 8 }}>
              <BarraAnimada avance={saldo / MINIMO_DE_CANJE} color={t.color.magenta} fondo={suave(t.color.magenta, 0.18)} />
              <Texto nivel={2} estilo={{ fontSize: 14 }}>Te faltan {entero(falta)} puntos para tu primer canje.</Texto>
            </View>
          ) : (
            <View style={{ gap: 8, marginTop: 6 }}>
              {/* Alcanzó el mínimo: se anuncia, late y suelta confeti una vez. */}
              <Latido estilo={{ alignSelf: 'flex-start' }}>
                <View style={{ backgroundColor: t.color.verde, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: '#1A2600' }}>¡Ya puedes canjear!</Text>
                </View>
              </Latido>
              <Texto nivel={2} estilo={{ fontSize: 14 }}>En caja di tu nombre o muestra esta pantalla, y se descuenta de tu compra.</Texto>
            </View>
          )}
          {falta === 0 ? <Confeti colores={[t.color.verde, t.color.magenta, '#FFD60A', '#5AC8FA']} /> : null}
        </Tarjeta>
      </Entrada>

      {congelado ? (
        <Aviso tipo="aviso">Tu saldo está en pausa porque no aceptaste el programa. Puedes volver a aceptarlo en Cuenta.</Aviso>
      ) : null}

      {resumen.vencimientos?.length ? (
        <Entrada indice={2}>
          <Tarjeta>
            <Titulo>Por vencer</Titulo>
            {resumen.vencimientos.map((v) => {
              const d = diasHasta(v.vence);
              return (
                <Fila key={v.vence} izquierda={`${fecha(v.vence)}${d != null && d <= 30 ? ` · en ${d} días` : ''}`}
                  derecha={`${entero(v.puntos)} pts`} color={d != null && d <= 30 ? colorSistema.naranja : colorSistema.texto2} />
              );
            })}
          </Tarjeta>
        </Entrada>
      ) : null}

      <Entrada indice={3} estilo={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Tarjeta>
            <Texto nivel={3}>Ganados</Texto>
            <NumeroAnimado valor={resumen.acumulados} formato="entero" estilo={{ fontSize: 24, fontWeight: '700', color: t.color.verdeTexto }} />
          </Tarjeta>
        </View>
        <View style={{ flex: 1 }}>
          <Tarjeta>
            <Texto nivel={3}>Usados</Texto>
            <NumeroAnimado valor={resumen.canjeados} formato="entero" estilo={{ fontSize: 24, fontWeight: '700', color: t.color.magentaTexto }} />
          </Tarjeta>
        </View>
      </Entrada>

      {/* Las compras, con sus productos: de ahí salen los puntos y las inyecciones. */}
      <Entrada indice={4}>
        <Tocable alTocar={() => router.push('/compras')}>
          <Tarjeta estilo={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ gap: 2 }}>
              <Titulo>Mis compras</Titulo>
              <Texto nivel={2} estilo={{ fontSize: 14 }}>Qué compraste, dónde y cuántos puntos te dio.</Texto>
            </View>
            <Text style={{ fontSize: 22, color: colorSistema.texto3 }}>›</Text>
          </Tarjeta>
        </Tocable>
      </Entrada>

      <Entrada indice={5}>
        <Tarjeta>
          <Titulo>Movimientos</Titulo>
          {movimientos.length === 0 ? <Texto nivel={2}>Todavía no hay movimientos.</Texto> : null}
          {movimientos.map((m, i) => {
            const gana = Number(m.puntos) > 0;
            return (
              <View key={`${m.fecha}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Texto>{ROTULOS[m.tipo] ?? 'Movimiento'}</Texto>
                  <Texto nivel={3}>{fecha(m.fecha)}{m.sala ? ` · ${m.sala}` : ''}</Texto>
                </View>
                <Text style={{ fontSize: 17, fontWeight: '700', color: gana ? t.color.verdeTexto : t.color.magentaTexto, fontVariant: ['tabular-nums'] }}>
                  {gana ? '+' : '−'}{entero(Math.abs(m.puntos))}
                </Text>
              </View>
            );
          })}
          {movimientos.length < total ? (
            <Text onPress={cargandoMas ? undefined : verMas} style={{ color: t.color.magentaTexto, fontWeight: '600', paddingVertical: 10 }}>
              {cargandoMas ? 'Cargando…' : `Ver más · ${movimientos.length} de ${total}`}
            </Text>
          ) : null}
        </Tarjeta>
      </Entrada>
    </Pantalla>
  );
}

function Fila({ izquierda, derecha, color }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={{ fontSize: 15, color }}>{izquierda}</Text>
      <Text style={{ fontSize: 15, fontWeight: '700', color, fontVariant: ['tabular-nums'] }}>{derecha}</Text>
    </View>
  );
}
