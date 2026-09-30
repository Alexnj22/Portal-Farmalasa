// La tarjeta de un aviso, dibujada como IMAGEN al llegar (iOS).
//
// Iba en una extensión de contenido (la vista que se abre al mantener
// presionado), y en el iPhone del usuario —iOS reciente, 2026-09-30— el sistema
// ni siquiera la buscaba: el registro mostraba «Setup ExpandedContentProvider»
// con el contenido por defecto y ninguna llamada a la extensión. En vez de
// apostar a algo que el sistema ignora, la extensión de servicio (que sí corre,
// es la que pone la foto) dibuja la tarjeta con SwiftUI y la ADJUNTA: al
// mantener presionado, iOS muestra la imagen grande. En la lista no se ve
// miniatura, así que el aviso corto queda limpio.
//
// Dibuja `data.tarjeta`, que arma el servidor con el núcleo
// (src/utils/tarjetaDeSolicitud.js): quién, contexto, hasta cuatro renglones
// con la cifra a la derecha, «y N más» y una nota al pie.
import SwiftUI
import UIKit
import UserNotifications

struct Modelo {
  let nombre: String?
  let contexto: String?
  let renglones: [(String, String)]
  let resto: Int
  let pie: String?

  init?(tarjeta t: [String: Any]?) {
    guard let t else { return nil }
    let quien = t["quien"] as? [String: Any]
    nombre = quien?["nombre"] as? String
    contexto = t["contexto"] as? String
    renglones = (t["renglones"] as? [[Any]] ?? []).compactMap { r in
      guard let a = r.first as? String else { return nil }
      return (a, r.count > 1 ? (r[1] as? String ?? "") : "")
    }
    resto = t["resto"] as? Int ?? 0
    pie = t["pie"] as? String
    if renglones.isEmpty { return nil }   // sin renglones el texto ya lo dice todo
  }

  var iniciales: String {
    (nombre ?? "").split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined()
  }
}

struct TarjetaDeAviso: View {
  let m: Modelo
  let foto: UIImage?

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      if m.nombre != nil || m.contexto != nil {
        HStack(spacing: 12) {
          if m.nombre != nil { avatar }
          VStack(alignment: .leading, spacing: 2) {
            if let n = m.nombre { Text(n).font(.headline) }
            if let c = m.contexto { Text(c).font(.subheadline).foregroundStyle(.secondary) }
          }
          Spacer(minLength: 0)
        }
      }

      VStack(spacing: 0) {
        ForEach(Array(m.renglones.enumerated()), id: \.offset) { i, r in
          if i > 0 { Divider() }
          HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(r.0).font(.subheadline).lineLimit(2)
            Spacer(minLength: 8)
            Text(r.1).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary).lineLimit(1)
          }
          .padding(.vertical, 10)
        }
        if m.resto > 0 {
          Divider()
          Text("y \(m.resto) más").font(.footnote).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 10)
        }
      }
      .padding(.horizontal, 14)
      .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

      if let pie = m.pie, !pie.isEmpty {
        Text(pie).font(.footnote).foregroundStyle(.secondary)
      }
    }
    .padding(18)
    .frame(width: 380, alignment: .leading)
    .background(Color(uiColor: .systemGroupedBackground))
  }

  @ViewBuilder private var avatar: some View {
    if let foto {
      Image(uiImage: foto).resizable().scaledToFill().frame(width: 44, height: 44).clipShape(Circle())
    } else {
      Circle().fill(Color(uiColor: .tertiarySystemFill)).frame(width: 44, height: 44)
        .overlay(Text(m.iniciales).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary))
    }
  }
}

enum ImagenDeTarjeta {
  /// La tarjeta como adjunto del aviso, o nil si no se pudo (el aviso sale igual).
  @MainActor
  static func adjunto(_ m: Modelo, foto: Data?) -> UNNotificationAttachment? {
    let oscuro = UIScreen.main.traitCollection.userInterfaceStyle == .dark
    let vista = TarjetaDeAviso(m: m, foto: foto.flatMap(UIImage.init(data:)))
      .environment(\.colorScheme, oscuro ? .dark : .light)
    let r = ImageRenderer(content: vista)
    r.scale = 3
    guard let png = r.uiImage?.pngData() else { return nil }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("tarjeta-\(UUID().uuidString).png")
    do {
      try png.write(to: url)
      return try UNNotificationAttachment(identifier: "tarjeta", url: url,
        options: [UNNotificationAttachmentOptionsThumbnailHiddenKey: true])
    } catch {
      return nil
    }
  }
}
