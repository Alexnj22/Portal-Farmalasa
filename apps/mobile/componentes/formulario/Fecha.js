// Android: el selector de fecha de Material 3. Se ve como un campo con la
// fecha; al tocarlo se abre el diálogo de calendario del sistema, como en
// cualquier app de Android. Entra y sale como texto AAAA-MM-DD, que es como la
// guarda el núcleo. La de iPhone es `Fecha.ios.js` (el compacto de iOS).
//
// 2026-11-23 (Bodega, conteo de inventario: «no les deja poner la fecha»). Dos
// defectos de la versión anterior, que armaba el diálogo a mano (un Modal de
// React Native con el `DateTimePicker` en línea adentro):
//   · Las fechas de Material son MEDIANOCHE EN UTC. Se leían con la hora local
//     (El Salvador, UTC−6), y la medianoche UTC cae en el día ANTERIOR: tocar el
//     1 de septiembre guardaba el 31 de agosto, y como el selector en línea
//     emite apenas abre, «Aceptar» sin tocar nada guardaba ayer. Cada intento
//     corría la fecha un día. Ahora se leen con los métodos UTC — la misma
//     lección que ya tenía la app de clientes (`FechaNacimiento.android.js`).
//   · El calendario no se achicaba: en un teléfono chico o con la letra grande
//     el botón «Aceptar» quedaba fuera de la pantalla. `DatePickerDialog` es el
//     diálogo del sistema, que se acomoda solo y deja cambiar a escribir la
//     fecha con el lápiz.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Presionable as Pressable } from '../Tocable';
import { Host, DatePickerDialog } from '@expo/ui/jetpack-compose';
import { fechaTexto } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { MARCA, FONDO_CONTROL } from '../inicio/marca';
import { SEMILLA } from '../../tema/material';

const dos = (n) => String(n).padStart(2, '0');
// 'AAAA-MM-DD' → mediodía UTC de ese día: cae en el mismo día en UTC y en El
// Salvador, así que el límite no se corre para ningún lado.
const aLimite = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)) : undefined;
};
const aTexto = (d) => `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;

export default function Fecha({ valor, onCambiar, desde, hasta }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Pressable onPress={() => setAbierto(true)} accessibilityRole="button"
        style={({ pressed }) => ({ minHeight: 44, minWidth: 130, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12,
          backgroundColor: FONDO_CONTROL, opacity: pressed ? 0.7 : 1 })}>
        <Text style={{ color: valor ? colorSistema.texto : colorSistema.texto2, fontSize: 16 }}>
          {valor ? fechaTexto(valor, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Elegir fecha'}
        </Text>
      </Pressable>
      {abierto ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', width: 1, height: 1 }}>
          <Host seedColor={SEMILLA} style={{ width: 1, height: 1 }}>
            <DatePickerDialog initialDate={/^\d{4}-\d{2}-\d{2}/.test(String(valor ?? '')) ? String(valor).slice(0, 10) : null}
              color={MARCA.azulClaro} elementColors={{ containerColor: colorSistema.fila }}
              confirmButtonLabel="Aceptar" dismissButtonLabel="Cancelar"
              selectableDates={{ start: aLimite(desde), end: aLimite(hasta) }}
              onDateSelected={(d) => { setAbierto(false); onCambiar(aTexto(d)); }}
              onDismissRequest={() => setAbierto(false)} />
          </Host>
        </View>
      ) : null}
    </>
  );
}
