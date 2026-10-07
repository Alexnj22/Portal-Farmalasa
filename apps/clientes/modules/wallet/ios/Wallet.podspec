Pod::Spec.new do |s|
  s.name           = 'Wallet'
  s.version        = '1.0.0'
  s.summary        = 'Agregar la tarjeta de socio a Apple Wallet con la hoja del sistema.'
  s.author         = 'Farmacia Salud'
  s.homepage       = 'https://portal.farmasalud.lat'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'PassKit'
  s.source_files   = '**/*.swift'
end
