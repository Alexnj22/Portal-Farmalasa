// Una sección con título dentro de una lista: la de SwiftUI en iPhone.
import { Section } from '@expo/ui/swift-ui';

export default function Seccion({ titulo, children }) {
  return <Section title={titulo}>{children}</Section>;
}
