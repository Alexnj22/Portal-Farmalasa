// La reserva en la pantalla bloqueada y en la Dynamic Island (2026-10-15):
// «Tu reserva R-001234 · Lista para retirar en Salud 3 · quedan 23 h», con la
// barra del plazo bajando sola.
//
// La arranca y la pone al día la app (modules/reserva-viva); esta extensión
// sólo la dibuja. Lo que cambia con el reloj NO necesita a la app: la cuenta
// regresiva y la barra son del sistema (`timerInterval`), y al pasar el plazo
// (`staleDate`) el sistema la redibuja y acá se lee `isStale` → «Plazo vencido».
//
// Privacidad: nunca el nombre del producto (la pantalla bloqueada la ve
// cualquiera). Tampoco «receta»: la que espera revisión dice «En revisión».
import ActivityKit
import SwiftUI
import WidgetKit

private let magenta = Color(red: 0x98 / 255, green: 0x1D / 255, blue: 0x97 / 255)
private let verde = Color(red: 52 / 255, green: 199 / 255, blue: 89 / 255)
private let naranja = Color(red: 1, green: 159 / 255, blue: 10 / 255)
private let rojo = Color(red: 1, green: 69 / 255, blue: 58 / 255)

// Vive en la extensión del widget de saldo (targets/saldo): @bacons/apple-targets
// admite UNA extensión por tipo, y con dos «widget» la segunda pisaba a la
// primera y el prebuild reventaba. El @main es el `Widgets` de Saldo.swift.

/// Cómo se dice cada estado. Los mismos textos que modules/reserva-viva/index.js
/// le da a la notificación de Android: si se cambia uno, cambiar el otro.
struct Aspecto {
  let texto: String
  let corto: String
  let icono: String
  let color: Color
}

func aspecto(_ s: ReservaAttributes.ContentState, vencido: Bool) -> Aspecto {
  switch s.estado {
  case "en_revision":
    return Aspecto(texto: "En revisión", corto: "Revisión", icono: "hourglass", color: naranja)
  case "lista" where vencido:
    return Aspecto(texto: "Plazo vencido", corto: "Venció", icono: "clock.badge.exclamationmark", color: rojo)
  case "lista":
    return Aspecto(texto: s.domicilio ? "Lista para entregar" : "Lista para retirar", corto: "Lista",
                   icono: "checkmark.circle.fill", color: verde)
  case "retirada":
    return Aspecto(texto: s.domicilio ? "Entregada" : "Retirada", corto: "Listo", icono: "checkmark.seal.fill", color: verde)
  case "vencida":
    return Aspecto(texto: "Venció sin retirar", corto: "Venció", icono: "clock.badge.exclamationmark", color: rojo)
  case "cancelada":
    return Aspecto(texto: "Cancelada", corto: "Cancelada", icono: "xmark.circle.fill", color: .gray)
  default:
    return Aspecto(texto: "En preparación", corto: "Preparando", icono: "shippingbox.fill", color: naranja)
  }
}

/// «en Salud 3» / «a domicilio» / nada.
func lugar(_ s: ReservaAttributes.ContentState) -> String {
  if s.domicilio { return "a domicilio" }
  return s.sucursal.isEmpty ? "" : "en \(s.sucursal)"
}

/// El plazo que sigue corriendo, o nil (no está lista, ya venció o no hay fecha).
/// El rango se arma SIEMPRE con inicio < fin: uno al revés hace caer la vista.
func plazo(_ s: ReservaAttributes.ContentState, vencido: Bool) -> ClosedRange<Date>? {
  guard s.estado == "lista", !vencido, let vence = s.vence, vence > Date() else { return nil }
  let inicio = min(s.desde ?? vence.addingTimeInterval(-24 * 3600), Date(), vence.addingTimeInterval(-60))
  return inicio...vence
}

struct ReservaEnVivo: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: ReservaAttributes.self) { contexto in
      PantallaBloqueo(contexto: contexto)
        .activitySystemActionForegroundColor(magenta)
        .widgetURL(URL(string: "puntossalud://reservas"))
    } dynamicIsland: { contexto in
      let s = contexto.state
      let vencido = contexto.isStale || (s.vence.map { $0 <= Date() } ?? false)
      let a = aspecto(s, vencido: vencido)
      let rango = plazo(s, vencido: vencido)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: a.icono).font(.title2).foregroundStyle(a.color).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if let rango {
            Text(timerInterval: rango, countsDown: true)
              .font(.headline.monospacedDigit()).foregroundStyle(a.color)
              .multilineTextAlignment(.trailing).frame(maxWidth: 90, alignment: .trailing)
          }
        }
        DynamicIslandExpandedRegion(.center) {
          Text(contexto.attributes.titulo).font(.subheadline.weight(.semibold)).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 6) {
            Text([a.texto, lugar(s)].filter { !$0.isEmpty }.joined(separator: " "))
              .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            if let rango {
              ProgressView(timerInterval: rango, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
                .tint(a.color)
            }
          }
        }
      } compactLeading: {
        Image(systemName: a.icono).foregroundStyle(a.color)
      } compactTrailing: {
        if let rango {
          Text(timerInterval: rango, countsDown: true)
            .monospacedDigit().foregroundStyle(a.color).frame(maxWidth: 56)
        } else {
          Text(a.corto).font(.caption2.weight(.semibold)).foregroundStyle(a.color)
        }
      } minimal: {
        Image(systemName: a.icono).foregroundStyle(a.color)
      }
      .widgetURL(URL(string: "puntossalud://reservas"))
      .keylineTint(a.color)
    }
  }
}

struct PantallaBloqueo: View {
  let contexto: ActivityViewContext<ReservaAttributes>

  var body: some View {
    let s = contexto.state
    let vencido = contexto.isStale || (s.vence.map { $0 <= Date() } ?? false)
    let a = aspecto(s, vencido: vencido)
    let rango = plazo(s, vencido: vencido)
    HStack(alignment: .center, spacing: 14) {
      ZStack {
        Circle().fill(a.color.opacity(0.2))
        Image(systemName: a.icono).font(.title3.weight(.semibold)).foregroundStyle(a.color)
      }
      .frame(width: 44, height: 44)

      VStack(alignment: .leading, spacing: 4) {
        Text(contexto.attributes.titulo)
          .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
        Text([a.texto, lugar(s)].filter { !$0.isEmpty }.joined(separator: " "))
          .font(.headline).lineLimit(2)
        if let rango {
          HStack(spacing: 4) {
            Text("Quedan")
            Text(timerInterval: rango, countsDown: true).monospacedDigit()
          }
          .font(.subheadline.weight(.semibold)).foregroundStyle(a.color)
          ProgressView(timerInterval: rango, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
            .tint(a.color)
        } else if s.estado == "pendiente" || s.estado == "en_revision" {
          Text("Te avisamos cuando esté lista.").font(.subheadline).foregroundStyle(.secondary)
        } else if s.estado == "lista" && vencido {
          Text("Abre la app para ver si todavía la tenemos.").font(.subheadline).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(16)
  }
}
