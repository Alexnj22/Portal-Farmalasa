// El widget de Puntos Salud: el saldo como en la tarjeta de socio.
//
// Los datos los escribe la app en el App Group (clave «resumen», un JSON) cada
// vez que carga el resumen; el widget sólo los lee. Sin datos —la persona no
// ha abierto la app o cerró sesión— invita a abrirla.
import SwiftUI
import WidgetKit

private let grupo = "group.lat.farmasalud.clientes"

struct Resumen: Codable {
  let nombre: String
  let saldo: Int
  let equivale: Double
  let vencen90: Int
  let actualizado: String
}

struct Entrada: TimelineEntry {
  let date: Date
  let resumen: Resumen?
}

struct Proveedor: TimelineProvider {
  func leer() -> Resumen? {
    guard let texto = UserDefaults(suiteName: grupo)?.string(forKey: "resumen"),
          let datos = texto.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(Resumen.self, from: datos)
  }
  func placeholder(in context: Context) -> Entrada {
    Entrada(date: .now, resumen: Resumen(nombre: "Tu nombre", saldo: 420, equivale: 4.2, vencen90: 0, actualizado: ""))
  }
  func getSnapshot(in context: Context, completion: @escaping (Entrada) -> Void) {
    completion(Entrada(date: .now, resumen: leer() ?? placeholder(in: context).resumen))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<Entrada>) -> Void) {
    // La app lo recarga al cambiar el saldo; esto es la red por si no se abre.
    completion(Timeline(entries: [Entrada(date: .now, resumen: leer())], policy: .after(.now.addingTimeInterval(6 * 3600))))
  }
}

private let magenta = Color(red: 0.62, green: 0.13, blue: 0.62)
private let verde = Color(red: 0.56, green: 0.76, blue: 0.06)

struct Fondo: View {
  var body: some View {
    LinearGradient(colors: [Color(red: 0.17, green: 0.04, blue: 0.23), magenta, Color(red: 0.36, green: 0.12, blue: 0.61)],
                   startPoint: .topLeading, endPoint: .bottomTrailing)
  }
}

struct VistaSaldo: View {
  @Environment(\.widgetFamily) var familia
  let entrada: Entrada

  var body: some View {
    if let r = entrada.resumen {
      VStack(alignment: .leading, spacing: 4) {
        HStack {
          Text("PUNTOS SALUD").font(.system(size: 10, weight: .heavy)).tracking(1.5).foregroundStyle(.white.opacity(0.8))
          Spacer()
          if familia != .systemSmall {
            Text(r.nombre.uppercased()).font(.system(size: 10, weight: .bold)).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
          }
        }
        Spacer(minLength: 0)
        Text(String(format: "$%.2f", r.equivale))
          .font(.system(size: familia == .systemSmall ? 30 : 36, weight: .black, design: .rounded))
          .foregroundStyle(.white).minimumScaleFactor(0.6).lineLimit(1)
          .contentTransition(.numericText())
        Text("\(r.saldo) puntos").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(0.85))
        Spacer(minLength: 0)
        if r.vencen90 > 0 {
          Label("\(r.vencen90) vencen en 3 meses", systemImage: "clock.fill")
            .font(.system(size: 11, weight: .bold)).foregroundStyle(Color.orange).lineLimit(1).minimumScaleFactor(0.8)
        } else {
          Label(r.saldo >= 100 ? "Listo para canjear" : "Sigue sumando", systemImage: r.saldo >= 100 ? "checkmark.seal.fill" : "sparkles")
            .font(.system(size: 11, weight: .bold)).foregroundStyle(verde).lineLimit(1)
        }
      }
      .widgetURL(URL(string: "puntossalud://puntos"))
    } else {
      VStack(alignment: .leading, spacing: 6) {
        Text("PUNTOS SALUD").font(.system(size: 10, weight: .heavy)).tracking(1.5).foregroundStyle(.white.opacity(0.8))
        Spacer()
        Text("Abre la app para ver tu saldo").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
      }
    }
  }
}

struct Saldo: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "Saldo", provider: Proveedor()) { entrada in
      VistaSaldo(entrada: entrada).containerBackground(for: .widget) { Fondo() }
    }
    .configurationDisplayName("Tu saldo")
    .description("Tus puntos y lo que vence pronto.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

@main
struct Widgets: WidgetBundle {
  var body: some Widget { Saldo() }
}
