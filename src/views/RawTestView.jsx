import { useEffect } from 'react';

export default function RawTestView() {
    useEffect(() => {
        const html = document.documentElement;
        const body = document.body;
        const root = document.getElementById('root');

        html.style.setProperty('overflow', 'auto', 'important');
        html.style.setProperty('height', 'auto', 'important');
        html.style.setProperty('overscroll-behavior', 'auto', 'important');

        body.style.setProperty('overflow', 'auto', 'important');
        body.style.setProperty('height', 'auto', 'important');
        body.style.setProperty('overscroll-behavior', 'auto', 'important');

        if (root) {
            root.style.setProperty('overflow', 'visible', 'important');
            root.style.setProperty('height', 'auto', 'important');
            root.style.setProperty('overscroll-behavior', 'auto', 'important');
        }

        return () => {
            ['overflow', 'height', 'overscroll-behavior'].forEach(p => html.style.removeProperty(p));
            ['overflow', 'height', 'overscroll-behavior'].forEach(p => body.style.removeProperty(p));
            if (root) ['overflow', 'height', 'overscroll-behavior'].forEach(p => root.style.removeProperty(p));
        };
    }, []);

    const GRAD = 'radial-gradient(ellipse at 38% 28%, #ddd8ff 0%, #e4e0ff 22%, #eae8ff 50%, #e2deff 100%)';

    return (
        <>
            <style>{`html, body { background: ${GRAD} !important; }`}</style>

            {/*
              DIAGNOSTIC ZONE (magenta) — height = env(safe-area-inset-top).
              If the native ViewController fix works, this block appears in the
              Dynamic Island zone on page load (content starts at physical y=0).
              When scrolling, rows should pass through this zone too.
            */}
            <div style={{
                height: 'env(safe-area-inset-top, 0px)',
                background: 'linear-gradient(to bottom, rgba(220,0,180,0.55), rgba(180,0,220,0.25))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                <span style={{ fontSize: 9, color: 'white', fontWeight: 800, letterSpacing: 1, textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                    DI ZONE
                </span>
            </div>

            {/* Nav bar — sticks right below the Dynamic Island zone */}
            <div style={{
                position: 'sticky',
                top: 'env(safe-area-inset-top, 0px)',
                left: 0, right: 0, zIndex: 99,
                background: 'rgba(221,216,255,0.88)',
                backdropFilter: 'blur(44px)',
                WebkitBackdropFilter: 'blur(44px)',
                borderBottom: '1px solid rgba(255,255,255,0.6)',
            }}>
                <div style={{ padding: '12px 16px', fontFamily: 'system-ui', fontWeight: 800, fontSize: 15, color: '#1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>/raw-test</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#6e46e6', background: 'rgba(110,70,230,0.12)', borderRadius: 8, padding: '2px 8px' }}>v10</span>
                </div>
            </div>

            {/* Contenido — body scroll nativo */}
            <div style={{ padding: 16 }}>
                <div style={{ background: 'rgba(110,70,230,0.12)', borderRadius: 16, padding: 16, marginBottom: 16, border: '1px solid rgba(110,70,230,0.2)' }}>
                    <p style={{ margin: 0, fontSize: 13, color: '#4c1d95', lineHeight: 1.6, fontFamily: 'system-ui' }}>
                        <strong>v10 — native contentInset fix</strong><br />
                        Si la zona magenta aparece en la isla dinámica al cargar → fix aplicado.<br />
                        Al scrollear, las filas deben pasar por esa zona.
                    </p>
                </div>

                {Array.from({ length: 25 }, (_, i) => (
                    <div key={i} style={{
                        background: 'rgba(255,255,255,0.55)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        borderRadius: 16,
                        padding: '16px',
                        marginBottom: 10,
                        border: '1px solid rgba(255,255,255,0.7)',
                        display: 'flex', alignItems: 'center', gap: 12,
                        fontFamily: 'system-ui',
                    }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: 12, flexShrink: 0,
                            background: 'linear-gradient(135deg, #6e46e6, #3c64f0)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'white', fontWeight: 900, fontSize: 14,
                        }}>{i + 1}</div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>Fila {i + 1}</div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>Scroll para ver en Dynamic Island</div>
                        </div>
                    </div>
                ))}

                <div style={{ height: 'max(env(safe-area-inset-bottom, 0px), 20px)' }} />
            </div>
        </>
    );
}
