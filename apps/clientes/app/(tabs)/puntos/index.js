// Mis puntos. Se habla en DÓLARES primero —«$4.20 de descuento» se entiende,
// «420 puntos» no— y el número de puntos va como el detalle de la cifra.
// Misma decisión que /mis-puntos de la web.
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Aviso, Cargando, Pantalla, Tarjeta, Texto, Titulo } from '../../../componentes/ui';
import { useCuenta } from '../../../lib/cuenta';
import { dolares, diasHasta, entero, fecha } from '../../../lib/formato';
import { suave, useTema } from '../../../tema/tema';

const MINIMO_DE_CANJE = 100;
// El signo sale del NÚMERO, no del tipo: un ajuste puede sumar o restar.
const ROTULOS = { compra: 'Compra', canje: 'Canje', vencimiento: 'Vencieron', anulacion: 'Compra anulada', ajuste: 'Ajuste' };

export default function Puntos() {
  const t = useTema();
  const { resumen, error, cargar } = useCuenta();
  const [refrescando, setRefrescando] = useState(false);
  const [verTodo, setVerTodo] = useState(false);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  useEffect(() => { setVerTodo(false); }, [resumen?.nombre]);

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
  const movimientos = verTodo ? resumen.movimientos : resumen.movimientos.slice(0, 8);
  const primerNombre = String(resumen.nombre ?? '').split(' ')[0];

  return (
    <Pantalla alRefrescar={refrescar} refrescando={refrescando}>
      <Texto nivel={2}>Hola, {primerNombre.charAt(0) + primerNombre.slice(1).toLowerCase()}</Texto>

      <Tarjeta tono={t.color.magenta} estilo={{ paddingVertical: 22 }}>
        <Texto nivel={2}>Tienes de descuento</Texto>
        <Text style={{ fontSize: 46, fontWeight: '800', color: t.color.magentaTexto, fontVariant: ['tabular-nums'] }}>
          {dolares(resumen.equivale)}
        </Text>
        <Texto nivel={2}>{entero(saldo)} puntos</Texto>
        {falta > 0 ? (
          <View style={{ gap: 6, marginTop: 6 }}>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: suave(t.color.magenta, 0.18) }}>
              <View style={{ width: `${Math.min(100, (saldo / MINIMO_DE_CANJE) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: t.color.magenta }} />
            </View>
            <Texto nivel={3}>Te faltan {entero(falta)} puntos para tu primer canje.</Texto>
          </View>
        ) : (
          <Texto nivel={2}>Úsalo en caja: di tu nombre o muestra esta pantalla.</Texto>
        )}
      </Tarjeta>

      {congelado ? (
        <Aviso tipo="aviso">Tu saldo está en pausa porque no aceptaste el programa. Puedes volver a aceptarlo en Cuenta.</Aviso>
      ) : null}

      {resumen.vencimientos?.length ? (
        <Tarjeta>
          <Titulo>Por vencer</Titulo>
          {resumen.vencimientos.map((v) => {
            const d = diasHasta(v.vence);
            return (
              <Fila key={v.vence} izquierda={`${fecha(v.vence)}${d != null && d <= 30 ? ` · en ${d} días` : ''}`}
                derecha={`${entero(v.puntos)} pts`} color={d != null && d <= 30 ? t.color.avisoTexto : t.color.texto2} />
            );
          })}
        </Tarjeta>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Tarjeta estilo={{ flex: 1 }}>
          <Texto nivel={3}>Ganados</Texto>
          <Text style={{ fontSize: 22, fontWeight: '700', color: t.color.verdeTexto }}>{entero(resumen.acumulados)}</Text>
        </Tarjeta>
        <Tarjeta estilo={{ flex: 1 }}>
          <Texto nivel={3}>Usados</Texto>
          <Text style={{ fontSize: 22, fontWeight: '700', color: t.color.magentaTexto }}>{entero(resumen.canjeados)}</Text>
        </Tarjeta>
      </View>

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
              <Text style={{ fontSize: 16, fontWeight: '700', color: gana ? t.color.verdeTexto : t.color.magentaTexto, fontVariant: ['tabular-nums'] }}>
                {gana ? '+' : '−'}{entero(Math.abs(m.puntos))}
              </Text>
            </View>
          );
        })}
        {!verTodo && resumen.movimientos.length > 8 ? (
          <Text onPress={() => setVerTodo(true)} style={{ color: t.color.magentaTexto, fontWeight: '600', paddingVertical: 10 }}>
            Ver todos ({resumen.movimientos.length})
          </Text>
        ) : null}
      </Tarjeta>
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
