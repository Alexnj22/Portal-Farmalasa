// Vista de prueba AISLADA — sin AppLayout, sin GlassViewLayout, sin nada del Portal.
// Solo HTML puro + gradiente para diagnosticar el comportamiento real en iOS.
export default function RawTestView() {
    return (
        <div style={{
            minHeight: '100dvh',
            width: '100%',
            background: 'radial-gradient(ellipse at 38% 28%, #d8d2ff 0%, #e4e0ff 22%, #eae8ff 50%, #e2deff 100%)',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            boxSizing: 'border-box',
        }}>
            {/* Header fijo que cubre desde y=0 (safe area arriba) */}
            <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 99,
                background: 'rgba(221,216,255,0.80)',
                backdropFilter: 'blur(40px)',
                WebkitBackdropFilter: 'blur(40px)',
                paddingTop: 'env(safe-area-inset-top, 0px)',
                borderBottom: '1px solid rgba(255,255,255,0.4)',
            }}>
                <div style={{ padding: '12px 16px', fontFamily: 'system-ui', fontWeight: 700, fontSize: 16, color: '#1e293b' }}>
                    Vista de Prueba — Header Fijo
                </div>
            </div>

            {/* Spacer para que el contenido no quede bajo el header */}
            <div style={{ height: 'calc(env(safe-area-inset-top, 0px) + 52px)' }} />

            {/* Contenido scrolleable */}
            <div style={{ padding: '16px', fontFamily: 'system-ui' }}>
                <p style={{ fontSize: 13, color: '#475569', marginBottom: 16 }}>
                    Esta vista usa SOLO HTML y CSS inline — sin componentes del Portal.
                    Si el scroll funciona aquí, el problema está en AppLayout/GlassViewLayout.
                    Si no funciona aquí, el problema es más bajo (CSS global o iOS config).
                </p>

                {/* Indicadores de safe area */}
                <div style={{ background: 'rgba(110,70,230,0.12)', borderRadius: 16, padding: 16, marginBottom: 12, border: '1px solid rgba(110,70,230,0.2)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Safe Area Insets</div>
                    <div style={{ fontSize: 13, color: '#4c1d95' }}>Top: env(safe-area-inset-top)</div>
                    <div style={{ fontSize: 13, color: '#4c1d95' }}>Bottom: env(safe-area-inset-bottom)</div>
                </div>

                {/* Bloques de scroll */}
                {Array.from({ length: 20 }, (_, i) => (
                    <div key={i} style={{
                        background: 'rgba(255,255,255,0.55)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        borderRadius: 16,
                        padding: '16px',
                        marginBottom: 10,
                        border: '1px solid rgba(255,255,255,0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                    }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: 12,
                            background: 'linear-gradient(135deg, #6e46e6, #3c64f0)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'white', fontWeight: 900, fontSize: 14, flexShrink: 0,
                        }}>{i + 1}</div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>Fila de prueba {i + 1}</div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>Desliza para verificar scroll</div>
                        </div>
                    </div>
                ))}

                {/* Zona inferior safe area */}
                <div style={{ height: 'env(safe-area-inset-bottom, 0px)', minHeight: 20 }} />
            </div>
        </div>
    );
}
