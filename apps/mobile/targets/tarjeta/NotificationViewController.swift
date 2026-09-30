// La tarjeta de un aviso con botones, al mantenerlo presionado (iOS).
//
// Dibuja `data.tarjeta`, que arma el servidor (send-push-notification/tarjeta.ts):
// quién lo originó con su foto, una línea de contexto, hasta cuatro renglones
// con su cifra alineada a la derecha, la cuenta del resto y una nota al pie.
// Colores y letras del sistema: cambia sola con el modo oscuro. Los botones
// (Enviar todo, Aprobar, Rechazar…) los pone iOS debajo.
import SwiftUI
import UIKit
import UserNotifications
import UserNotificationsUI

class NotificationViewController: UIViewController, UNNotificationContentExtension {
  private var host: UIHostingController<TarjetaDeAviso>?

  func didReceive(_ notification: UNNotification) {
    let content = notification.request.content
    let modelo = Modelo(titulo: content.title, datos: Datos.de(content.userInfo), texto: content.body)
    let vista = TarjetaDeAviso(m: modelo)

    if let host {
      host.rootView = vista
    } else {
      let h = UIHostingController(rootView: vista)
      h.view.backgroundColor = .clear
      addChild(h)
      view.addSubview(h.view)
      h.view.translatesAutoresizingMaskIntoConstraints = false
      NSLayoutConstraint.activate([
        h.view.topAnchor.constraint(equalTo: view.topAnchor),
        h.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
        h.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        h.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      ])
      h.didMove(toParent: self)
      host = h
    }
    // El alto justo: sin esto la tarjeta queda con el alto inicial (la mitad
    // del ancho) y corta o deja aire.
    let ancho = view.bounds.width > 0 ? view.bounds.width : UIScreen.main.bounds.width
    let alto = host?.sizeThatFits(in: CGSize(width: ancho, height: .greatestFiniteMagnitude)).height ?? 200
    preferredContentSize = CGSize(width: ancho, height: alto)
  }
}

struct Modelo {
  let titulo: String
  let nombre: String?
  let foto: URL?
  let contexto: String?
  let renglones: [(String, String)]
  let resto: Int
  let pie: String?
  let texto: String

  init(titulo: String, datos: [String: Any], texto: String) {
    self.titulo = titulo
    self.texto = texto
    let t = datos["tarjeta"] as? [String: Any] ?? [:]
    let quien = t["quien"] as? [String: Any]
    nombre = quien?["nombre"] as? String
    foto = (quien?["foto"] as? String).flatMap(URL.init(string:))
    contexto = t["contexto"] as? String
    renglones = (t["renglones"] as? [[Any]] ?? []).compactMap { r in
      guard let a = r.first as? String else { return nil }
      return (a, r.count > 1 ? (r[1] as? String ?? "") : "")
    }
    resto = t["resto"] as? Int ?? 0
    pie = t["pie"] as? String
  }

  var iniciales: String {
    (nombre ?? "").split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined()
  }
}

struct TarjetaDeAviso: View {
  let m: Modelo

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 12) {
        foto
        VStack(alignment: .leading, spacing: 2) {
          Text(m.nombre ?? m.titulo).font(.headline).lineLimit(1)
          if let c = m.contexto ?? (m.nombre != nil ? m.titulo : nil) {
            Text(c).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
          }
        }
        Spacer(minLength: 0)
      }

      if m.renglones.isEmpty {
        // Sin tarjeta armada (un aviso viejo, o una lectura que falló): el texto.
        Text(m.texto).font(.body)
      } else {
        VStack(spacing: 0) {
          ForEach(Array(m.renglones.enumerated()), id: \.offset) { i, r in
            if i > 0 { Divider() }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              Text(r.0).font(.subheadline).lineLimit(2)
              Spacer(minLength: 8)
              Text(r.1).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary).lineLimit(1)
            }
            .padding(.vertical, 8)
          }
          if m.resto > 0 {
            Divider()
            Text("y \(m.resto) más").font(.footnote).foregroundStyle(.secondary)
              .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
          }
        }
        .padding(.horizontal, 12)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      }

      if let pie = m.pie, !pie.isEmpty {
        Text(pie).font(.footnote).foregroundStyle(.secondary)
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder private var foto: some View {
    let circulo = Circle().fill(Color(uiColor: .tertiarySystemFill))
    if let url = m.foto {
      AsyncImage(url: url) { img in img.resizable().scaledToFill() } placeholder: { circulo }
        .frame(width: 44, height: 44).clipShape(Circle())
    } else if m.nombre != nil {
      circulo.frame(width: 44, height: 44)
        .overlay(Text(m.iniciales).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary))
    }
  }
}

enum Datos {
  static func de(_ info: [AnyHashable: Any]) -> [String: Any] {
    if let d = info["body"] as? [String: Any] { return d }
    if let s = info["body"] as? String, let data = s.data(using: .utf8),
       let d = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] { return d }
    if let d = info["data"] as? [String: Any] { return d }
    return [:]
  }
}
