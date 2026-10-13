// La hoja de opciones en Android: la hoja inferior de Material 3
// (ModalBottomSheet de Compose), la que usa cualquier app de Android para
// «¿qué hacer con esto?». La arma `HojasAndroid.js`.
//
// Copia de apps/mobile/componentes/HojaDeOpciones.android.js (2026-10-13; las
// dos apps no comparten código).
import { Host, LazyColumn, ListItem, ModalBottomSheet, Text as TextoCompose } from '@expo/ui/jetpack-compose';
import { clickable, padding } from '@expo/ui/jetpack-compose/modifiers';

export default function HojaDeOpciones({ hoja, fondo, tinta, tenue, cerrar, cancelar }) {
  const visibles = hoja.opciones.filter((o) => !o.cancelar);
  return (
    <Host style={{ position: 'absolute', width: 1, height: 1 }}>
      <ModalBottomSheet onDismissRequest={cancelar} containerColor={fondo} contentColor={tinta}>
        <LazyColumn contentPadding={{ bottom: 24 }}>
          {[
            hoja.titulo ? <TextoCompose key="t" color={tinta} style={{ fontSize: 18, fontWeight: '600' }} modifiers={[padding(24, 4, 24, 4)]}>{hoja.titulo}</TextoCompose> : null,
            hoja.mensaje ? <TextoCompose key="m" color={tenue} style={{ fontSize: 14 }} modifiers={[padding(24, 0, 24, 8)]}>{hoja.mensaje}</TextoCompose> : null,
            ...visibles.map((o) => (
              <ListItem key={o.i} colors={{ containerColor: fondo }}
                modifiers={o.apagado ? [] : [clickable(() => cerrar(() => hoja.alElegir(o.i)))]}>
                <ListItem.HeadlineContent>
                  <TextoCompose color={o.apagado ? tenue : o.destructivo ? '#B3261E' : tinta} style={{ fontSize: 16 }}>{o.texto}</TextoCompose>
                </ListItem.HeadlineContent>
              </ListItem>
            )),
          ].filter(Boolean)}
        </LazyColumn>
      </ModalBottomSheet>
    </Host>
  );
}
