// La lista del sistema (SwiftUI) sin su fondo gris: deja ver la aurora detrás
// y las filas quedan como tarjetas sobre ella, igual que Ajustes sobre un
// fondo de pantalla. La lista universal de @expo/ui no deja pasar ese
// modificador, así que en iPhone se usa la de SwiftUI directo.
import { List as ListaSwiftUI } from '@expo/ui/swift-ui';
import { refreshable, scrollContentBackground } from '@expo/ui/swift-ui/modifiers';

export default function Lista({ children, onRefresh }) {
  const modificadores = [scrollContentBackground('hidden'), ...(onRefresh ? [refreshable(onRefresh)] : [])];
  return <ListaSwiftUI modifiers={modificadores}>{children}</ListaSwiftUI>;
}
