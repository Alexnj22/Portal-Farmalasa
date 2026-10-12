// Elegir UNA opción, en Android: la hoja inferior de Material 3
// (ModalBottomSheet de Compose) con el título, un buscador cuando son muchas
// (OutlinedTextField) y la lista con botones de radio. En iPhone es la hoja
// con buscador de siempre (`HojaDeEleccion.js` no pinta nada y cada `Elegir`
// usa la suya).
//
// Antes, en Android, este selector era la hoja de iOS: una lista a pantalla
// completa con «Cerrar» arriba y una ✓ (2026-10-12, «adapta todo a los
// elementos nativos de Android»).
import { useMemo, useState } from 'react';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { Host, LazyColumn, ListItem, ModalBottomSheet, OutlinedTextField, RadioButton, Text, TextButton } from '@expo/ui/jetpack-compose';
import { clickable, fillMaxWidth, padding } from '@expo/ui/jetpack-compose/modifiers';
import { colorSistema } from './Formulario';
import { MARCA } from './inicio/marca';

/**
 * @param {{ titulo: string, opciones: {id: string, label: string, detalle?: string}[], valor: string,
 *           onElegir: (id: string) => void, onCerrar: () => void, maximo?: number }} props
 *   `maximo`: cuántas filas se pintan sin buscar (cientos de filas traban la hoja).
 *   `accion`: { texto: string | (busqueda) => string, onPress: (busqueda) => void }, un botón al final (p.ej. «Crear una nueva»).
 */
export default function HojaDeEleccion({ titulo, opciones, valor, onElegir, onCerrar, maximo = 200, accion = null }) {
  const [texto, setTexto] = useState('');
  const visibles = useMemo(
    () => opciones.filter((o) => !texto.trim() || tokenMatch(texto, o.label, o.detalle || '')),
    [opciones, texto],
  );
  const elegir = (id) => { onElegir(id); onCerrar(); };
  return (
    <Host style={{ position: 'absolute', width: 1, height: 1 }}>
      <ModalBottomSheet onDismissRequest={onCerrar} containerColor={colorSistema.fila} contentColor={colorSistema.texto}>
        <LazyColumn contentPadding={{ bottom: 24 }}>
          {[
            <Text key="t" color={colorSistema.texto} style={{ fontSize: 18, fontWeight: '600' }} modifiers={[padding(24, 4, 24, 8)]}>{titulo}</Text>,
            opciones.length > 8 ? (
              <OutlinedTextField key="b" onValueChange={setTexto} autoCorrectEnabled={false} imeAction="search"
                modifiers={[fillMaxWidth(), padding(16, 0, 16, 8)]}>
                <OutlinedTextField.Placeholder><Text>Buscar</Text></OutlinedTextField.Placeholder>
              </OutlinedTextField>
            ) : null,
            ...visibles.slice(0, maximo).map((o) => (
              <ListItem key={o.id || '∅'} colors={{ containerColor: colorSistema.fila }} modifiers={[clickable(() => elegir(o.id))]}>
                <ListItem.LeadingContent>
                  <RadioButton selected={String(o.id) === String(valor ?? '')} onClick={() => elegir(o.id)} colors={{ selectedColor: MARCA.azul }} />
                </ListItem.LeadingContent>
                <ListItem.HeadlineContent>
                  <Text color={colorSistema.texto} style={{ fontSize: 16 }}>{o.label}</Text>
                </ListItem.HeadlineContent>
                {o.detalle ? (
                  <ListItem.SupportingContent>
                    <Text color={colorSistema.texto2} style={{ fontSize: 14 }}>{o.detalle}</Text>
                  </ListItem.SupportingContent>
                ) : null}
              </ListItem>
            )),
            visibles.length > maximo ? <Text key="mas" color={colorSistema.texto2} modifiers={[padding(24, 8, 24, 8)]}>{`Hay ${visibles.length - maximo} más: escribe para encontrarlas.`}</Text> : null,
            accion ? (
              <TextButton key="accion" onClick={() => accion.onPress(texto)} modifiers={[padding(12, 8, 12, 0)]}>
                <Text color={MARCA.azul}>{typeof accion.texto === 'function' ? accion.texto(texto) : accion.texto}</Text>
              </TextButton>
            ) : null,
            !visibles.length ? <Text key="n" color={colorSistema.texto2} modifiers={[padding(24, 8, 24, 8)]}>Nada con ese texto.</Text> : null,
          ].filter(Boolean)}
        </LazyColumn>
      </ModalBottomSheet>
    </Host>
  );
}
