import React, { CSSProperties } from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  Activity,
  BarChart3,
  Brain,
  CheckCircle2,
  Eye,
  Radar,
  ShieldCheck,
  Wallet,
  Zap,
} from 'lucide-react';
import { alphaRows, atlaix, demoEvents, smartWallets } from './brand';

const { colors } = atlaix;

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const bezier = (curve: readonly [number, number, number, number]) => Easing.bezier(...curve);

const seconds = (value: number, fps: number) => Math.round(value * fps);

const useSceneProgress = (start: number, duration: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return interpolate(frame, [seconds(start, fps), seconds(start + duration, fps)], [0, 1], {
    ...clamp,
    easing: bezier(atlaix.ease.premium),
  });
};

const styles: Record<string, CSSProperties> = {
  root: {
    background: `radial-gradient(circle at 50% 20%, rgba(38,211,86,.16), transparent 26%), linear-gradient(180deg, ${colors.bgDeep} 0%, ${colors.bg} 46%, #08090A 100%)`,
    color: colors.text,
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    overflow: 'hidden',
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

const fade = (frame: number, start: number, end: number, fps: number) =>
  interpolate(frame, [seconds(start, fps), seconds(end, fps)], [0, 1], {
    ...clamp,
    easing: bezier(atlaix.ease.premium),
  });

const exitFade = (frame: number, start: number, end: number, fps: number) =>
  interpolate(frame, [seconds(start, fps), seconds(end, fps)], [1, 0], {
    ...clamp,
    easing: Easing.in(Easing.cubic),
  });

const BackgroundSystem: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = frame * 0.28;
  const pulse = 0.35 + Math.sin(frame / 28) * 0.18;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          inset: -80,
          opacity: 0.2,
          backgroundImage:
            'linear-gradient(rgba(42,245,152,.22) 1px, transparent 1px), linear-gradient(90deg, rgba(42,245,152,.2) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          transform: `translate3d(${-drift % 72}px, ${(-drift * 0.7) % 72}px, 0)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 980,
          height: 980,
          left: 50,
          top: 210,
          borderRadius: '50%',
          border: `1px solid rgba(42,245,152,${0.2 + pulse * 0.18})`,
          boxShadow: `0 0 120px rgba(38,211,86,${0.12 + pulse * 0.08})`,
          transform: `scale(${1 + Math.sin(frame / 40) * 0.025})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 1300,
          height: 420,
          left: -110,
          top: 560,
          borderRadius: '50%',
          borderTop: `4px solid rgba(42,245,152,${0.28 + pulse * 0.32})`,
          filter: 'blur(.2px)',
          transform: `rotate(${Math.sin(frame / 80) * 2}deg)`,
        }}
      />
      {Array.from({ length: 38 }).map((_, index) => {
        const x = (index * 173) % 1080;
        const y = 140 + ((index * 251) % 1460);
        const opacity = 0.14 + ((index % 5) * 0.045);
        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: index % 4 === 0 ? 4 : 2,
              height: index % 4 === 0 ? 4 : 2,
              borderRadius: '50%',
              background: index % 3 === 0 ? colors.greenLight : colors.muted,
              opacity: opacity + Math.sin(frame / 18 + index) * 0.08,
              boxShadow: `0 0 18px ${colors.greenLight}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const SceneShell: React.FC<{ children: React.ReactNode; start: number; end: number }> = ({ children, start, end }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = fade(frame, start, start + 0.8, fps) * exitFade(frame, end - 0.8, end, fps);
  const y = interpolate(opacity, [0, 1], [28, 0], clamp);

  return (
    <AbsoluteFill style={{ opacity, transform: `translateY(${y}px)` }}>
      {children}
    </AbsoluteFill>
  );
};

const Kicker: React.FC<{ children: React.ReactNode; icon?: React.ReactNode }> = ({ children, icon }) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      border: `1px solid rgba(42,245,152,.22)`,
      background: 'rgba(38,211,86,.09)',
      color: colors.greenLight,
      borderRadius: 999,
      padding: '11px 18px',
      fontSize: 24,
      fontWeight: 900,
      letterSpacing: 1.6,
      textTransform: 'uppercase',
    }}
  >
    {icon}
    {children}
  </div>
);

const Headline: React.FC<{ children: React.ReactNode; size?: number; maxWidth?: number }> = ({ children, size = 82, maxWidth = 900 }) => (
  <div
    style={{
      maxWidth,
      fontSize: size,
      lineHeight: 0.94,
      fontWeight: 950,
      letterSpacing: 0,
      textAlign: 'center',
      textWrap: 'balance',
      textShadow: '0 18px 70px rgba(0,0,0,.7)',
    }}
  >
    {children}
  </div>
);

const DataPanel: React.FC<{
  children: React.ReactNode;
  style?: CSSProperties;
  glow?: boolean;
}> = ({ children, style, glow = false }) => (
  <div
    style={{
      border: `1px solid ${glow ? 'rgba(42,245,152,.34)' : colors.border}`,
      background: 'linear-gradient(180deg, rgba(28,31,34,.96), rgba(17,19,21,.94))',
      borderRadius: 26,
      boxShadow: glow ? '0 0 80px rgba(38,211,86,.18), 0 30px 90px rgba(0,0,0,.45)' : '0 30px 90px rgba(0,0,0,.45)',
      overflow: 'hidden',
      ...style,
    }}
  >
    {children}
  </div>
);

const LogoIgnition: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = fade(frame, 0, 1.4, fps);
  const markScale = interpolate(progress, [0, 1], [0.78, 1], clamp);
  const ring = interpolate(frame, [0, seconds(3.6, fps)], [0, 360], clamp);

  return (
    <SceneShell start={0} end={5.2}>
      <AbsoluteFill style={{ ...styles.center, flexDirection: 'column', gap: 44 }}>
        <div
          style={{
            position: 'relative',
            width: 420,
            height: 420,
            ...styles.center,
            transform: `scale(${markScale})`,
            opacity: progress,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: '2px solid rgba(42,245,152,.22)',
              transform: `rotate(${ring}deg)`,
              borderTopColor: colors.greenLight,
              boxShadow: '0 0 110px rgba(38,211,86,.25)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 52,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(42,245,152,.24), transparent 64%)',
              filter: 'blur(12px)',
            }}
          />
          <Img src={staticFile('logo.png')} style={{ width: 260, height: 260, objectFit: 'contain', filter: 'drop-shadow(0 0 44px rgba(42,245,152,.42))' }} />
        </div>
        <div style={{ opacity: fade(frame, 1.0, 2.0, fps), textAlign: 'center' }}>
          <Headline size={92}>ATLAIX</Headline>
          <div style={{ marginTop: 26, fontSize: 31, color: colors.muted, fontWeight: 700 }}>
            Crypto intelligence that sees through the noise.
          </div>
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};

const HookScene: React.FC = () => {
  const p = useSceneProgress(4.6, 4.6);
  const frame = useCurrentFrame();
  const scan = (frame % 90) / 90;

  return (
    <SceneShell start={4.7} end={10}>
      <AbsoluteFill style={{ ...styles.center, padding: 86 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 42 }}>
          <Kicker icon={<Eye size={26} />}>Market signal layer</Kicker>
          <Headline maxWidth={940}>See the signal before the market does.</Headline>
          <DataPanel glow style={{ width: 880, height: 430, position: 'relative', transform: `perspective(1200px) rotateX(${interpolate(p, [0, 1], [10, 0])}deg)` }}>
            <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, transparent ${scan * 100 - 18}%, rgba(42,245,152,.18) ${scan * 100}%, transparent ${scan * 100 + 18}%)` }} />
            <div style={{ padding: 34, display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 24 }}>
              <div>
                <div style={{ fontSize: 18, color: colors.muted, fontWeight: 900, letterSpacing: 2, textTransform: 'uppercase' }}>Live intelligence fabric</div>
                <div style={{ marginTop: 24, fontSize: 42, lineHeight: 1.05, fontWeight: 950 }}>Detection, risk, alpha, and wallet behavior in one system.</div>
                <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {['Detection Events', 'Safe Scan', 'Alpha Feed', 'Smart Money'].map((label) => (
                    <span key={label} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: '11px 14px', color: colors.text, background: colors.panelSoft, fontWeight: 800, fontSize: 18 }}>{label}</span>
                  ))}
                </div>
              </div>
              <SignalOrb />
            </div>
          </DataPanel>
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};

const SignalOrb: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'relative', minHeight: 330, ...styles.center }}>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          style={{
            position: 'absolute',
            width: 90 + index * 86,
            height: 90 + index * 86,
            borderRadius: '50%',
            border: `1px solid rgba(42,245,152,${0.44 - index * 0.1})`,
            transform: `rotate(${frame * (0.5 + index * 0.12)}deg)`,
          }}
        />
      ))}
      <div style={{ width: 132, height: 132, borderRadius: '50%', background: `radial-gradient(circle, ${colors.greenLight}, ${colors.green} 46%, rgba(38,211,86,.1) 70%)`, boxShadow: '0 0 90px rgba(38,211,86,.65)' }} />
      {['DEX', 'Risk', 'Wallet', 'Flow'].map((label, index) => {
        const angle = frame * 0.012 + index * Math.PI * 0.5;
        return (
          <div
            key={label}
            style={{
              position: 'absolute',
              left: 158 + Math.cos(angle) * 144,
              top: 152 + Math.sin(angle) * 144,
              transform: 'translate(-50%, -50%)',
              border: `1px solid rgba(255,255,255,.12)`,
              background: '#0D1012',
              borderRadius: 999,
              padding: '8px 12px',
              color: colors.text,
              fontSize: 15,
              fontWeight: 900,
            }}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
};

const DetectionScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <SceneShell start={9.2} end={16}>
      <AbsoluteFill style={{ padding: '152px 70px' }}>
        <Kicker icon={<Radar size={25} />}>Detection Events</Kicker>
        <div style={{ marginTop: 30, fontSize: 67, lineHeight: 0.96, fontWeight: 950, maxWidth: 820 }}>New market activity becomes structured intelligence.</div>
        <div style={{ marginTop: 54, display: 'grid', gap: 18 }}>
          {demoEvents.map((event, index) => {
            const enter = fade(frame, 10.2 + index * 0.32, 11.2 + index * 0.32, fps);
            const color = event.tone === 'red' ? colors.red : event.tone === 'yellow' ? colors.yellow : event.tone === 'blue' ? colors.blue : colors.green;
            return (
              <DataPanel
                key={event.token}
                glow={index === 0}
                style={{
                  height: 154,
                  transform: `translateX(${interpolate(enter, [0, 1], [110, 0], clamp)}px)`,
                  opacity: enter,
                }}
              >
                <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '10px 1fr auto', alignItems: 'center' }}>
                  <div style={{ height: '100%', background: color }} />
                  <div style={{ padding: '24px 28px' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span style={{ fontSize: 31, fontWeight: 950 }}>{event.token}</span>
                      <span style={{ color: colors.muted, fontSize: 17, fontWeight: 900 }}>{event.chain}</span>
                      <span style={{ border: `1px solid ${color}55`, color, background: `${color}18`, borderRadius: 999, padding: '6px 11px', fontWeight: 950, fontSize: 15, textTransform: 'uppercase' }}>{event.event}</span>
                    </div>
                    <div style={{ marginTop: 15, color: colors.muted, fontSize: 20, fontWeight: 700 }}>Detected {event.age} ago · supporting volume {event.value}</div>
                  </div>
                  <div style={{ paddingRight: 30, textAlign: 'right' }}>
                    <div style={{ color, fontSize: 48, fontWeight: 950 }}>{event.score}</div>
                    <div style={{ color: colors.muted, fontSize: 15, fontWeight: 900, textTransform: 'uppercase' }}>Alpha score</div>
                  </div>
                </div>
              </DataPanel>
            );
          })}
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};

const SafeScanScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sweep = interpolate(frame, [seconds(16, fps), seconds(21, fps)], [-28, 128], clamp);

  return (
    <SceneShell start={15.2} end={22.5}>
      <AbsoluteFill style={{ padding: '142px 68px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 34 }}>
          <div>
            <Kicker icon={<ShieldCheck size={26} />}>Safe Scan</Kicker>
            <div style={{ marginTop: 34, fontSize: 66, lineHeight: 0.96, fontWeight: 950, width: 600 }}>Expose risk before capital moves.</div>
            <div style={{ marginTop: 26, color: colors.muted, fontSize: 28, lineHeight: 1.35, fontWeight: 700, width: 560 }}>
              Honeypots, LP weakness, holder clusters, and drain pressure are translated into decisions.
            </div>
          </div>
          <DataPanel glow style={{ width: 310, padding: 24 }}>
            <div style={{ color: colors.muted, fontWeight: 900, fontSize: 17, letterSpacing: 1.4, textTransform: 'uppercase' }}>Token status</div>
            <div style={{ marginTop: 18, color: colors.greenLight, fontSize: 56, fontWeight: 950 }}>SAFE</div>
            <div style={{ marginTop: 10, borderTop: `1px solid ${colors.border}`, paddingTop: 18, color: colors.text, fontSize: 20, fontWeight: 800 }}>Confidence 91%</div>
          </DataPanel>
        </div>

        <DataPanel style={{ marginTop: 58, height: 620, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, transparent ${sweep - 18}%, rgba(42,245,152,.18) ${sweep}%, transparent ${sweep + 18}%)` }} />
          <div style={{ padding: 34, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div style={{ display: 'grid', gap: 16 }}>
              {[
                ['Honeypot Detection', 'PASSED', colors.green],
                ['LP Status', 'SECURE', colors.green],
                ['Mint Function', 'DISABLED', colors.green],
                ['Mutable Metadata', 'LOW RISK', colors.yellow],
                ['Drain Pressure', '18%', colors.green],
              ].map(([label, value, color], index) => {
                const enter = fade(frame, 16.4 + index * 0.18, 17.2 + index * 0.18, fps);
                return (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1px solid ${colors.border}`, borderRadius: 18, background: colors.panelSoft, padding: '18px 20px', opacity: enter }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: colors.text, fontSize: 22, fontWeight: 850 }}>
                      <CheckCircle2 size={22} color={String(color)} />
                      {label}
                    </div>
                    <div style={{ color: String(color), fontWeight: 950, fontSize: 18 }}>{value}</div>
                  </div>
                );
              })}
            </div>
            <ForensicGraph />
          </div>
        </DataPanel>
      </AbsoluteFill>
    </SceneShell>
  );
};

const ForensicGraph: React.FC = () => {
  const frame = useCurrentFrame();
  const nodes = [
    [250, 120, 54, colors.green],
    [130, 250, 34, colors.blue],
    [360, 250, 38, colors.yellow],
    [230, 380, 30, colors.purple],
    [420, 420, 26, colors.red],
    [95, 430, 24, colors.greenLight],
  ] as const;

  return (
    <div style={{ position: 'relative', minHeight: 540, border: `1px solid ${colors.border}`, borderRadius: 22, background: '#0E1012', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 28, top: 24, color: colors.muted, fontSize: 17, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 2 }}>Holder cluster map</div>
      <svg width="100%" height="100%" viewBox="0 0 500 540" style={{ position: 'absolute', inset: 0 }}>
        {nodes.slice(1).map((node, index) => (
          <line key={index} x1={250} y1={120} x2={node[0]} y2={node[1]} stroke="rgba(42,245,152,.22)" strokeWidth="2" />
        ))}
      </svg>
      {nodes.map(([x, y, size, color], index) => (
        <div
          key={index}
          style={{
            position: 'absolute',
            left: x,
            top: y,
            width: size,
            height: size,
            marginLeft: -size / 2,
            marginTop: -size / 2,
            borderRadius: '50%',
            background: color,
            boxShadow: `0 0 ${28 + size}px ${color}66`,
            transform: `scale(${1 + Math.sin(frame / 18 + index) * 0.08})`,
          }}
        />
      ))}
    </div>
  );
};

const AlphaFeedScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <SceneShell start={21.8} end={29.2}>
      <AbsoluteFill style={{ padding: '128px 48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 36 }}>
          <div>
            <Kicker icon={<Activity size={26} />}>Live Alpha Feed</Kicker>
            <div style={{ marginTop: 26, fontSize: 58, fontWeight: 950 }}>The field view for high-signal tokens.</div>
          </div>
          <div style={{ color: colors.greenLight, fontSize: 22, fontWeight: 950, border: `1px solid rgba(42,245,152,.28)`, borderRadius: 999, padding: '12px 18px', background: 'rgba(38,211,86,.1)' }}>LIVE</div>
        </div>
        <DataPanel glow style={{ height: 890 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.28fr 1.38fr .82fr .88fr .9fr .86fr', gap: 0, borderBottom: `1px solid ${colors.border}`, color: colors.muted, fontSize: 17, fontWeight: 950, textTransform: 'uppercase' }}>
            {['Token', 'Event', '24h', 'MCap', 'DEX Vol', 'Flow'].map((header) => <div key={header} style={{ padding: 20 }}>{header}</div>)}
          </div>
          {alphaRows.map((row, index) => {
            const enter = fade(frame, 23 + index * 0.24, 23.9 + index * 0.24, fps);
            const positive = row.change.startsWith('+');
            return (
              <div
                key={row.token}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.28fr 1.38fr .82fr .88fr .9fr .86fr',
                  alignItems: 'center',
                  minHeight: 150,
                  borderBottom: `1px solid ${colors.border}`,
                  background: index === 0 ? 'rgba(38,211,86,.07)' : index % 2 ? 'rgba(255,255,255,.015)' : 'transparent',
                  opacity: enter,
                  transform: `translateY(${interpolate(enter, [0, 1], [36, 0], clamp)}px)`,
                }}
              >
                <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: `linear-gradient(135deg, ${colors.green}, ${colors.blue})`, boxShadow: '0 0 30px rgba(38,211,86,.25)' }} />
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 950 }}>{row.token}</div>
                    <div style={{ fontSize: 15, color: colors.muted, marginTop: 3 }}>Detected pair</div>
                  </div>
                </div>
                <div style={{ padding: 20 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      maxWidth: '100%',
                      whiteSpace: 'nowrap',
                      border: `1px solid ${colors.border}`,
                      borderRadius: 999,
                      padding: '8px 11px',
                      fontSize: 13,
                      fontWeight: 950,
                    }}
                  >
                    {row.event}
                  </span>
                </div>
                <div style={{ padding: 20, color: positive ? colors.green : colors.red, fontSize: 23, fontWeight: 950 }}>{row.change}</div>
                <div style={{ padding: 20, color: colors.text, fontSize: 22, fontWeight: 850 }}>{row.mcap}</div>
                <div style={{ padding: 20, color: colors.text, fontSize: 22, fontWeight: 850 }}>{row.volume}</div>
                <div style={{ padding: 20, color: row.flow.startsWith('+') ? colors.green : colors.red, fontSize: 24, fontWeight: 950 }}>{row.flow}</div>
              </div>
            );
          })}
        </DataPanel>
      </AbsoluteFill>
    </SceneShell>
  );
};

const SmartMoneyScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <SceneShell start={28.5} end={34.8}>
      <AbsoluteFill style={{ padding: '132px 60px' }}>
        <div style={{ textAlign: 'center' }}>
          <Kicker icon={<Brain size={26} />}>Smart Money Engine</Kicker>
          <div style={{ margin: '30px auto 0', maxWidth: 900 }}>
            <Headline size={64}>Follow qualified wallets, not market noise.</Headline>
          </div>
        </div>
        <div style={{ marginTop: 62, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 26 }}>
          <DataPanel glow style={{ padding: 24, minHeight: 600 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, fontSize: 25, fontWeight: 950 }}>
              <Wallet color={colors.greenLight} />
              Trending Smart Wallets
            </div>
            {smartWallets.map((wallet, index) => {
              const enter = fade(frame, 29.8 + index * 0.24, 30.6 + index * 0.24, fps);
              return (
                <div key={wallet.wallet} style={{ border: `1px solid ${colors.border}`, borderRadius: 20, padding: 20, marginBottom: 16, background: colors.panelSoft, opacity: enter }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 950 }}>{wallet.name}</div>
                      <div style={{ marginTop: 6, color: colors.muted, fontSize: 17, fontFamily: 'monospace' }}>{wallet.wallet}</div>
                    </div>
                    <div style={{ color: colors.greenLight, fontSize: 32, fontWeight: 950 }}>{wallet.score}</div>
                  </div>
                  <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    {[['Win', wallet.win], ['PnL', wallet.pnl], ['Bal', wallet.balance]].map(([label, value]) => (
                      <div key={label} style={{ background: '#0E1012', borderRadius: 14, padding: 12 }}>
                        <div style={{ color: colors.muted, fontSize: 13, fontWeight: 900, textTransform: 'uppercase' }}>{label}</div>
                        <div style={{ marginTop: 5, fontSize: 18, fontWeight: 950, color: value.startsWith('+') ? colors.green : colors.text }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </DataPanel>
          <WalletNetwork />
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};

const WalletNetwork: React.FC = () => {
  const frame = useCurrentFrame();
  const nodes = [
    [260, 130, colors.green],
    [130, 255, colors.blue],
    [390, 260, colors.yellow],
    [185, 430, colors.purple],
    [345, 468, colors.greenLight],
  ] as const;

  return (
    <DataPanel style={{ position: 'relative', minHeight: 600, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 24, top: 24, display: 'flex', gap: 12, alignItems: 'center', fontSize: 25, fontWeight: 950 }}>
        <Zap color={colors.greenLight} />
        Wallet movement map
      </div>
      <svg width="100%" height="100%" viewBox="0 0 520 600" style={{ position: 'absolute', inset: 0 }}>
        {nodes.map((node, index) => {
          const next = nodes[(index + 1) % nodes.length];
          return <line key={index} x1={node[0]} y1={node[1]} x2={next[0]} y2={next[1]} stroke="rgba(42,245,152,.22)" strokeWidth="2" />;
        })}
        <path d="M130 255 C220 200 300 370 390 260 S390 540 185 430" fill="none" stroke="rgba(42,245,152,.35)" strokeWidth="4" strokeDasharray="16 18" strokeDashoffset={-frame * 2} />
      </svg>
      {nodes.map(([x, y, color], index) => (
        <div
          key={index}
          style={{
            position: 'absolute',
            left: x,
            top: y,
            width: 68,
            height: 68,
            marginLeft: -34,
            marginTop: -34,
            borderRadius: '50%',
            background: '#0E1012',
            border: `3px solid ${color}`,
            boxShadow: `0 0 48px ${color}66`,
            transform: `scale(${1 + Math.sin(frame / 16 + index) * 0.07})`,
          }}
        />
      ))}
      <div style={{ position: 'absolute', bottom: 30, left: 30, right: 30, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ borderRadius: 18, background: 'rgba(38,211,86,.1)', border: `1px solid rgba(38,211,86,.3)`, padding: 18 }}>
          <div style={{ color: colors.greenLight, fontSize: 32, fontWeight: 950 }}>+$2.04M</div>
          <div style={{ color: colors.muted, fontSize: 15, marginTop: 4, fontWeight: 850 }}>qualified inflow</div>
        </div>
        <div style={{ borderRadius: 18, background: 'rgba(235,87,87,.08)', border: `1px solid rgba(235,87,87,.25)`, padding: 18 }}>
          <div style={{ color: colors.red, fontSize: 32, fontWeight: 950 }}>-$420K</div>
          <div style={{ color: colors.muted, fontSize: 15, marginTop: 4, fontWeight: 850 }}>sell pressure</div>
        </div>
      </div>
    </DataPanel>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = fade(frame, 33.9, 35.0, fps);

  return (
    <SceneShell start={33.8} end={36}>
      <AbsoluteFill style={{ ...styles.center, flexDirection: 'column', padding: 80 }}>
        <Img src={staticFile('logo.png')} style={{ width: 170, height: 170, objectFit: 'contain', filter: 'drop-shadow(0 0 40px rgba(42,245,152,.42))', transform: `scale(${interpolate(p, [0, 1], [0.82, 1], clamp)})` }} />
        <div style={{ marginTop: 36, fontSize: 86, fontWeight: 950 }}>ATLAIX</div>
        <div style={{ marginTop: 26, textAlign: 'center', maxWidth: 880, fontSize: 42, lineHeight: 1.12, color: colors.text, fontWeight: 900 }}>
          Find the signal. Verify the risk. Follow the money.
        </div>
        <div style={{ marginTop: 42, border: `1px solid rgba(42,245,152,.28)`, background: 'rgba(38,211,86,.1)', color: colors.greenLight, borderRadius: 999, padding: '16px 24px', fontSize: 21, fontWeight: 950, letterSpacing: 1.2, textTransform: 'uppercase' }}>
          Crypto intelligence platform
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};

const AgencyFrame: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill pointerEvents="none">
      <div style={{ position: 'absolute', left: 42, right: 42, top: 42, height: 1, background: `linear-gradient(90deg, transparent, rgba(42,245,152,.36), transparent)` }} />
      <div style={{ position: 'absolute', left: 42, right: 42, bottom: 42, height: 1, background: `linear-gradient(90deg, transparent, rgba(42,245,152,.25), transparent)` }} />
      <div style={{ position: 'absolute', left: 48, top: 52, color: colors.muted, fontSize: 15, fontWeight: 900, letterSpacing: 2 }}>ATLAIX / SIGNAL INTELLIGENCE</div>
      <div style={{ position: 'absolute', right: 48, top: 52, color: colors.greenLight, fontSize: 15, fontWeight: 950, letterSpacing: 2 }}>{String(Math.floor(frame / 30)).padStart(2, '0')}:{String(frame % 30).padStart(2, '0')}</div>
    </AbsoluteFill>
  );
};

export const AtlaixLaunchVideo: React.FC = () => {
  return (
    <AbsoluteFill style={styles.root}>
      <BackgroundSystem />
      <LogoIgnition />
      <HookScene />
      <DetectionScene />
      <SafeScanScene />
      <AlphaFeedScene />
      <SmartMoneyScene />
      <EndCard />
      <AgencyFrame />
    </AbsoluteFill>
  );
};
