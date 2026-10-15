Pod::Spec.new do |s|
  s.name           = 'ReservaViva'
  s.version        = '1.0.0'
  s.summary        = 'La reserva en la pantalla bloqueada y la Dynamic Island (Live Activity).'
  s.author         = 'Farmacia Salud'
  s.homepage       = 'https://portal.farmasalud.lat'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # Débil: la app corre desde iOS 15.1 y ActivityKit existe desde 16.1.
  s.weak_frameworks = 'ActivityKit'
  s.source_files   = '**/*.swift'
end
