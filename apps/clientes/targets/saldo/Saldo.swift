// El widget de Puntos Salud: el saldo como en la tarjeta de socio.
//
// Los datos los escribe la app en el App Group (clave «resumen», un JSON) cada
// vez que carga el resumen; el widget sólo los lee. Sin datos —la persona no
// ha abierto la app o cerró sesión— invita a abrirla.
//
// El material (2026-10-14, «el widget con el material de su nivel, como la
// tarjeta»): de fondo, la misma lámina de la tarjeta de socio —Bronce, Plata,
// Oro, Platino o los rangos de mayoreo Jade, Zafiro, Rubí y Diamante—, en una
// imagen fija por tamaño (Assets.xcassets, renderizada con los MISMOS shaders
// de componentes/minerales/shaders.js). Sin material —un JSON viejo o un nivel
// que este widget no conoce— queda el degradado de siempre.
import SwiftUI
import UIKit
import WidgetKit

private let grupo = "group.lat.farmasalud.clientes"

struct Resumen: Codable {
  let nombre: String
  let saldo: Int
  let equivale: Double
  let vencen90: Int
  let actualizado: String
  // Opcionales: un JSON escrito por una versión anterior de la app no los trae.
  let material: String?
  let rotulo: String?
  let mayoreo: Bool?
  let equipo: Bool?
}

private let materiales: Set<String> = ["bronce", "plata", "oro", "platino", "jade", "zafiro", "rubi", "diamante"]

/// El nombre de la imagen del material para ese tamaño, o nil si no hay.
func imagenMaterial(_ clave: String?, mediano: Bool) -> String? {
  guard let clave, materiales.contains(clave) else { return nil }
  let nombre = "material-\(clave)-\(mediano ? "mediano" : "chico")"
  return UIImage(named: nombre) == nil ? nil : nombre
}

private let miles: NumberFormatter = {
  let f = NumberFormatter()
  f.locale = Locale(identifier: "en_US")
  f.numberStyle = .decimal
  return f
}()
func conMiles(_ n: Int) -> String { miles.string(from: NSNumber(value: n)) ?? String(n) }

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
    Entrada(date: .now, resumen: Resumen(nombre: "Tu nombre", saldo: 1250, equivale: 12.5, vencen90: 0, actualizado: "",
                                     material: "oro", rotulo: "ORO", mayoreo: false, equipo: false))
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

/// La lámina del nivel con un velo oscuro arriba y abajo (el mismo de la
/// tarjeta): el texto blanco se lee sobre el oro claro o la plata.
struct FondoMaterial: View {
  let imagen: String
  var body: some View {
    ZStack {
      Image(imagen).resizable().scaledToFill()
      LinearGradient(stops: [
        .init(color: .black.opacity(0.38), location: 0),
        .init(color: .black.opacity(0.10), location: 0.35),
        .init(color: .black.opacity(0.18), location: 0.6),
        .init(color: .black.opacity(0.62), location: 1),
      ], startPoint: .top, endPoint: .bottom)
    }
  }
}

/// El sello de Equipo del personal: la lámina perlada de la tarjeta, fija.
struct SelloTeam: View {
  var body: some View {
    Text("TEAM")
      .font(.system(size: 9, weight: .black)).tracking(1.2)
      .foregroundStyle(Color(red: 0.12, green: 0.08, blue: 0.18).opacity(0.8))
      .padding(.horizontal, 7).padding(.vertical, 3)
      .background(
        LinearGradient(colors: [Color(red: 0.86, green: 0.84, blue: 0.93), Color(red: 0.80, green: 0.93, blue: 0.92),
                                Color(red: 0.95, green: 0.86, blue: 0.93)],
                       startPoint: .topLeading, endPoint: .bottomTrailing),
        in: RoundedRectangle(cornerRadius: 5, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).stroke(.white.opacity(0.7), lineWidth: 0.5))
  }
}

struct VistaSaldo: View {
  @Environment(\.widgetFamily) var familia
  let entrada: Entrada

  var body: some View {
    let imagen = imagenMaterial(entrada.resumen?.material, mediano: familia != .systemSmall)
    Group {
      if let r = entrada.resumen, imagen != nil {
        ConMaterial(r: r, chico: familia == .systemSmall)
      } else {
        Clasica(entrada: entrada)
      }
    }
    .containerBackground(for: .widget) {
      if let imagen { FondoMaterial(imagen: imagen) } else { Fondo() }
    }
  }
}

/// Sobre el material: el logo y el nivel arriba (como la tarjeta: «CLIENTE» o
/// «MAYOREO» sobre el rótulo), el saldo en grande y el aviso abajo.
struct ConMaterial: View {
  let r: Resumen
  let chico: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(alignment: .top, spacing: 6) {
        Image("logo-blanco").resizable().scaledToFit().frame(width: chico ? 20 : 22, height: chico ? 20 : 22)
        if !chico {
          Text("PUNTOS SALUD").font(.system(size: 10, weight: .heavy)).tracking(1.5).foregroundStyle(.white.opacity(0.9))
            .padding(.top, 5)
        }
        if r.equipo == true && !chico { SelloTeam().padding(.top, 1) }
        Spacer(minLength: 4)
        VStack(alignment: .trailing, spacing: 0) {
          Text(r.mayoreo == true ? "MAYOREO" : "CLIENTE").font(.system(size: 7.5, weight: .bold)).tracking(1.6)
            .foregroundStyle(.white.opacity(0.8))
          Text(r.rotulo ?? "").font(.system(size: chico ? 12 : 13, weight: .heavy)).tracking(2)
            .foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.7)
        }
      }
      Spacer(minLength: 0)
      if chico {
        Text("\(conMiles(r.saldo)) pts")
          .font(.system(size: 26, weight: .black, design: .rounded))
          .foregroundStyle(.white).minimumScaleFactor(0.55).lineLimit(1)
          .contentTransition(.numericText())
        Text(String(format: "≈ $%.2f", r.equivale)).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(0.9))
      } else {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text("\(conMiles(r.saldo)) pts")
            .font(.system(size: 32, weight: .black, design: .rounded))
            .foregroundStyle(.white).minimumScaleFactor(0.6).lineLimit(1)
            .contentTransition(.numericText())
          Text(String(format: "≈ $%.2f", r.equivale)).font(.system(size: 15, weight: .bold)).foregroundStyle(.white.opacity(0.9))
            .lineLimit(1).fixedSize()
          Spacer(minLength: 0)
        }
        Text(r.nombre.uppercased()).font(.system(size: 10, weight: .bold)).tracking(1).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
      }
      Spacer(minLength: 0)
      HStack(spacing: 6) {
        if r.vencen90 > 0 {
          Label("\(r.vencen90) vencen en 3 meses", systemImage: "clock.fill")
            .font(.system(size: 11, weight: .bold)).foregroundStyle(Color.orange).lineLimit(1).minimumScaleFactor(0.8)
        } else {
          Label(r.saldo >= 100 ? "Listo para canjear" : "Sigue sumando", systemImage: r.saldo >= 100 ? "checkmark.seal.fill" : "sparkles")
            .font(.system(size: 11, weight: .bold)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.8)
        }
        if r.equipo == true && chico { Spacer(minLength: 0); SelloTeam() }
      }
    }
    .shadow(color: .black.opacity(0.35), radius: 2, y: 1)
    .widgetURL(URL(string: "puntossalud://puntos"))
  }
}

/// El widget de antes (el degradado de la marca): sin material o sin datos.
struct Clasica: View {
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
      VistaSaldo(entrada: entrada)
    }
    .configurationDisplayName("Tu saldo")
    .description("Tus puntos y lo que vence pronto, con el material de tu tarjeta.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

@main
struct Widgets: WidgetBundle {
  var body: some Widget {
    Saldo()
    // La reserva en la pantalla bloqueada y la Dynamic Island (Reserva.swift).
    ReservaEnVivo()
  }
}
