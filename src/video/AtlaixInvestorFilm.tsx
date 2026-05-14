import React, { CSSProperties } from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Audio } from '@remotion/media';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  Eye,
  Lock,
  Radar,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import { atlaix } from './brand';

const { colors } = atlaix;

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const curve = Easing.bezier(0.16, 1, 0.3, 1);
const sharp = Easing.bezier(0.7, 0, 0.2, 1);
const s = (value: number, fps: number) => Math.round(value * fps);

const inOut = (frame: number, fps: number, start: number, end: number, outStart = end - 0.6, outEnd = end) => {
  const enter = interpolate(frame, [s(start, fps), s(start + 0.85, fps)], [0, 1], {
    ...clamp,
    easing: curve,
  });
  const exit = interpolate(frame, [s(outStart, fps), s(outEnd, fps)], [1, 0], {
    ...clamp,
    easing: Easing.in(Easing.cubic),
  });
  return enter * exit;
};

const progress = (frame: number, fps: number, start: number, end: number, easing = curve) =>
  interpolate(frame, [s(start, fps), s(end, fps)], [0, 1], {
    ...clamp,
    easing,
  });

const sceneStyle = (opacity: number, y = 26): CSSProperties => ({
  opacity,
  transform: `translate3d(0, ${interpolate(opacity, [0, 1], [y, 0], clamp)}px, 0)`,
});

const LightWorld: React.FC = () => {
  const frame = useCurrentFrame();
  const orb = 0.42 + Math.sin(frame / 32) * 0.12;
  const drift = frame * 0.15;

  return (
    <AbsoluteFill style={{ background: '#050708', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 50% 78%, rgba(38,211,86,.20), transparent 32%), radial-gradient(circle at 52% 20%, rgba(42,245,152,.10), transparent 28%), linear-gradient(180deg, #080B0D 0%, #101315 52%, #050607 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: -120,
          right: -120,
          top: 620,
          height: 520,
          borderRadius: '50%',
          borderTop: '12px solid rgba(42,245,152,.74)',
          filter: 'blur(1px)',
          boxShadow: '0 -18px 90px rgba(42,245,152,.34), inset 0 26px 120px rgba(42,245,152,.12)',
          transform: `translateY(${Math.sin(frame / 54) * 8}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: -80,
          right: -80,
          top: 550,
          height: 640,
          borderRadius: '50%',
          borderTop: '1px solid rgba(42,245,152,.28)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: -80,
          opacity: 0.09,
          backgroundImage:
            'linear-gradient(rgba(42,245,152,.28) 1px, transparent 1px), linear-gradient(90deg, rgba(42,245,152,.25) 1px, transparent 1px)',
          backgroundSize: '88px 88px',
          transform: `translate(${-(drift % 88)}px, ${-(drift * 0.7) % 88}px)`,
        }}
      />
      {Array.from({ length: 90 }).map((_, index) => {
        const x = (index * 263) % 1920;
        const y = 80 + ((index * 197) % 900);
        const size = index % 11 === 0 ? 4 : index % 5 === 0 ? 3 : 2;
        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: '50%',
              background: index % 4 === 0 ? colors.greenLight : '#EAECEF',
              opacity: 0.12 + Math.sin(frame / 24 + index) * 0.09,
              boxShadow: `0 0 ${10 + size * 6}px rgba(42,245,152,${orb})`,
            }}
          />
        );
      })}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at center, transparent 48%, rgba(0,0,0,.52) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};

const Header: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = progress(frame, fps, 0.5, 1.3);

  return (
    <div
      style={{
        position: 'absolute',
        left: 72,
        right: 72,
        top: 42,
        height: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        opacity: o * 0.9,
        zIndex: 40,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Img src={staticFile('logo.png')} style={{ width: 34, height: 34, objectFit: 'contain' }} />
        <div style={{ color: colors.text, fontSize: 16, fontWeight: 900, letterSpacing: 3 }}>ATLAIX</div>
      </div>
    </div>
  );
};

const GlowText: React.FC<{ children: React.ReactNode; style?: CSSProperties }> = ({ children, style }) => (
  <span style={{ color: colors.greenLight, textShadow: '0 0 34px rgba(42,245,152,.42)', ...style }}>{children}</span>
);

const HeroLogoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = inOut(frame, fps, 0, 4.2);
  const blur = interpolate(progress(frame, fps, 0, 1.5), [0, 1], [18, 0], clamp);
  const scale = interpolate(progress(frame, fps, 0, 2), [0, 1], [1.18, 1], clamp);

  return (
    <AbsoluteFill style={{ ...sceneStyle(o, 0), alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          position: 'absolute',
          top: 185,
          display: 'flex',
          alignItems: 'center',
          gap: 30,
          filter: `blur(${blur}px)`,
          transform: `scale(${scale})`,
        }}
      >
        <Img src={staticFile('logo.png')} style={{ width: 146, height: 146, objectFit: 'contain', filter: 'drop-shadow(0 0 44px rgba(42,245,152,.52))' }} />
        <div style={{ fontSize: 118, fontWeight: 950, letterSpacing: 5, color: colors.text, textShadow: '0 0 70px rgba(42,245,152,.22)' }}>ATLAIX</div>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 520,
          width: 1160,
          textAlign: 'center',
          fontSize: 54,
          lineHeight: 1.05,
          fontWeight: 850,
          color: '#F6F7F8',
          opacity: progress(frame, fps, 1.2, 2.2),
        }}
      >
        The intelligence layer for finding signal before the market catches up.
      </div>
    </AbsoluteFill>
  );
};

const BrowserChrome: React.FC<{ children: React.ReactNode; style?: CSSProperties; title?: string }> = ({ children, style, title = 'Atlaix Intelligence' }) => (
  <div
    style={{
      border: '1px solid rgba(42,245,152,.34)',
      borderRadius: 28,
      background: 'linear-gradient(180deg, rgba(28,31,34,.94), rgba(10,12,13,.96))',
      boxShadow: '0 0 80px rgba(38,211,86,.22), 0 38px 120px rgba(0,0,0,.56)',
      overflow: 'hidden',
      ...style,
    }}
  >
    <div
      style={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 22px',
        borderBottom: `1px solid ${colors.border}`,
        color: colors.muted,
        fontSize: 14,
        fontWeight: 800,
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: colors.red }} />
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: colors.yellow }} />
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: colors.green }} />
      <span style={{ marginLeft: 12 }}>{title}</span>
    </div>
    {children}
  </div>
);

const ProductStageScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = inOut(frame, fps, 4.8, 9.4);
  const p = progress(frame, fps, 5.0, 6.7);
  const zoom = interpolate(p, [0, 1], [0.82, 1], clamp);

  return (
    <AbsoluteFill style={{ ...sceneStyle(o, 34), perspective: 1600 }}>
      <div style={{ position: 'absolute', left: 170, top: 128 }}>
        <div style={{ fontSize: 80, lineHeight: 0.96, fontWeight: 950, width: 720 }}>
          See the market <GlowText>before</GlowText> it becomes obvious.
        </div>
        <div style={{ marginTop: 28, width: 620, color: colors.muted, fontSize: 25, lineHeight: 1.36, fontWeight: 700 }}>
          Atlaix turns live market structure, on-chain flow, wallet behavior, and token risk into one decisive intelligence surface.
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 112,
          top: 150,
          width: 880,
          transform: `rotateY(-10deg) rotateX(4deg) scale(${zoom})`,
          transformOrigin: 'center',
        }}
      >
        <BrowserChrome>
          <HeroDashboard />
        </BrowserChrome>
      </div>
      <FloatingToken label="DETECT" icon={<Radar size={35} />} x={1330} y={672} delay={0} />
      <FloatingToken label="VERIFY" icon={<ShieldCheck size={35} />} x={1560} y={724} delay={0.8} />
      <FloatingToken label="FOLLOW" icon={<Wallet size={35} />} x={1110} y={744} delay={1.3} />
    </AbsoluteFill>
  );
};

const HeroDashboard: React.FC = () => {
  const frame = useCurrentFrame();
  const sweep = (frame % 120) / 120;
  const rows = [
    ['$VANTA', 'Accumulation', '+38.4%', '$1.1M', colors.green],
    ['$NOVA', 'Liquidity Event', '+19.7%', '$740K', colors.yellow],
    ['$ARC', 'Recovery', '+12.1%', '$260K', colors.blue],
  ] as const;

  return (
    <div style={{ position: 'relative', height: 500, padding: 28, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, transparent ${sweep * 100 - 14}%, rgba(42,245,152,.16), transparent ${sweep * 100 + 14}%)` }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 24, height: '100%' }}>
        <div>
          <div style={{ color: colors.greenLight, fontSize: 15, fontWeight: 950, letterSpacing: 2, textTransform: 'uppercase' }}>Live Alpha Feed</div>
          <div style={{ marginTop: 18, fontSize: 44, lineHeight: .98, fontWeight: 950 }}>High-signal events, ranked by impact.</div>
          <div style={{ marginTop: 28, display: 'grid', gap: 12 }}>
            {rows.map(([token, event, change, flow, color]) => (
              <div key={token} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr .7fr .7fr', gap: 12, alignItems: 'center', height: 58, border: `1px solid ${colors.border}`, borderRadius: 14, padding: '0 14px', background: 'rgba(255,255,255,.025)' }}>
                <b style={{ fontSize: 18 }}>{token}</b>
                <span style={{ fontSize: 13, color, fontWeight: 900 }}>{event}</span>
                <span style={{ color: colors.green, fontWeight: 950 }}>{change}</span>
                <span style={{ color, fontWeight: 950 }}>{flow}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <MetricCard label="Detection score" value="94" icon={<Activity size={26} />} />
          <MetricCard label="Safe Scan confidence" value="91%" icon={<ShieldCheck size={26} />} />
          <MetricCard label="Smart wallet inflow" value="+$2.04M" icon={<Wallet size={26} />} />
        </div>
      </div>
    </div>
  );
};

const MetricCard: React.FC<{ label: string; value: string; icon: React.ReactNode }> = ({ label, value, icon }) => (
  <div style={{ border: `1px solid ${colors.border}`, background: colors.panelSoft, borderRadius: 18, padding: 16 }}>
    <div style={{ color: colors.greenLight }}>{icon}</div>
    <div style={{ marginTop: 12, color: colors.text, fontSize: 31, fontWeight: 950 }}>{value}</div>
    <div style={{ marginTop: 4, color: colors.muted, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1.3 }}>{label}</div>
  </div>
);

const FloatingToken: React.FC<{ label: string; icon: React.ReactNode; x: number; y: number; delay: number }> = ({ label, icon, x, y, delay }) => {
  const frame = useCurrentFrame();
  const float = Math.sin(frame / 24 + delay) * 10;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 64,
        top: y + float,
        width: 128,
        height: 172,
        display: 'flex',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 12,
        color: colors.text,
        transform: `translateY(${Math.sin(frame / 48 + delay) * 4}px)`,
      }}
    >
      <div
        style={{
          width: 128,
          height: 128,
        borderRadius: '50%',
          background: 'radial-gradient(circle at 34% 28%, rgba(42,245,152,.98), rgba(38,211,86,.86) 48%, #09100B 49%, #050607 100%)',
        border: '3px solid rgba(255,255,255,.72)',
        boxShadow: '0 0 56px rgba(42,245,152,.38), 0 24px 70px rgba(0,0,0,.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#041006',
        fontWeight: 950,
          transform: `rotateZ(${Math.sin(frame / 70 + delay) * 5}deg)`,
      }}
    >
      {icon}
      </div>
      <div
        style={{
          border: '1px solid rgba(42,245,152,.28)',
          background: 'rgba(6,10,9,.72)',
          borderRadius: 999,
          padding: '7px 12px',
          fontSize: 12,
          fontWeight: 950,
          letterSpacing: 1.2,
          color: colors.greenLight,
          boxShadow: '0 0 30px rgba(42,245,152,.18)',
        }}
      >
        {label}
      </div>
    </div>
  );
};

const KineticProofScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = inOut(frame, fps, 9.9, 13.7);
  const p = progress(frame, fps, 10.1, 11.1, sharp);

  return (
    <AbsoluteFill style={{ ...sceneStyle(o, 0), overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 130,
          right: 130,
          top: 125,
          fontSize: 92,
          lineHeight: 0.94,
          fontWeight: 950,
          color: 'rgba(234,236,239,.96)',
          textAlign: 'center',
          filter: `blur(${interpolate(p, [0, 1], [8, 0], clamp)}px)`,
          transform: `scale(${interpolate(p, [0, 1], [1.08, 1], clamp)})`,
        }}
      >
        Detect early. <GlowText>Verify risk.</GlowText> Follow smart money.
      </div>
      <div style={{ position: 'absolute', left: 160, bottom: 150, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24, width: 1600 }}>
        {[
          ['Detection Events', 'Accumulation, liquidity shifts, unusual activity', <Radar size={32} />],
          ['Safe Scan', 'Honeypots, LP risk, holder clusters', <ShieldCheck size={32} />],
          ['Live Alpha Field', 'DEX volume, flow, buys, sells, liquidity', <BarChart3 size={32} />],
          ['Smart Money', 'Wallet quality, inflow, outflow, conviction', <Brain size={32} />],
        ].map(([title, body, icon], index) => {
          const card = progress(frame, fps, 11.3 + index * 0.18, 12.4 + index * 0.18);
          return (
            <div key={String(title)} style={{ height: 250, border: `1px solid rgba(42,245,152,${index === 0 ? '.45' : '.22'})`, borderRadius: 26, padding: 24, background: 'linear-gradient(180deg, rgba(28,31,34,.9), rgba(10,12,13,.88))', boxShadow: '0 24px 80px rgba(0,0,0,.42)', opacity: card, transform: `translateY(${interpolate(card, [0, 1], [48, 0], clamp)}px)` }}>
              <div style={{ color: colors.greenLight }}>{icon}</div>
              <div style={{ marginTop: 26, color: colors.text, fontSize: 28, fontWeight: 950 }}>{title}</div>
              <div style={{ marginTop: 13, color: colors.muted, fontSize: 18, lineHeight: 1.35, fontWeight: 700 }}>{body}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const ScannerScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = inOut(frame, fps, 14.2, 20.0);
  const scan = progress(frame, fps, 15.0, 18.7, Easing.linear);

  return (
    <AbsoluteFill style={{ ...sceneStyle(o, 34), perspective: 1500 }}>
      <div style={{ position: 'absolute', left: 130, top: 120, width: 590 }}>
        <div style={{ color: colors.greenLight, display: 'flex', alignItems: 'center', gap: 12, fontSize: 22, fontWeight: 950, letterSpacing: 2.4, textTransform: 'uppercase' }}>
          <Lock size={24} /> Safe Scan
        </div>
        <div style={{ marginTop: 28, fontSize: 76, lineHeight: .96, fontWeight: 950 }}>Risk becomes visible.</div>
        <div style={{ marginTop: 26, color: colors.muted, fontSize: 24, lineHeight: 1.38, fontWeight: 700 }}>Atlaix translates token safety into readable proof: liquidity, clusters, contract flags, and drain pressure.</div>
      </div>
      <div style={{ position: 'absolute', right: 118, top: 118, width: 1040, transform: 'rotateY(-8deg) rotateX(4deg)' }}>
        <BrowserChrome title="Safe Scan Forensics">
          <div style={{ position: 'relative', height: 640, padding: 30 }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: `${scan * 100}%`, height: 90, background: 'linear-gradient(180deg, transparent, rgba(42,245,152,.22), transparent)', filter: 'blur(2px)' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.05fr', gap: 28, height: '100%' }}>
              <div>
                {[
                  ['Honeypot detection', 'PASSED', colors.green],
                  ['LP status', 'SECURE', colors.green],
                  ['Holder cluster ratio', '18%', colors.yellow],
                  ['Mutable metadata', 'LOW', colors.green],
                  ['Drain pressure', 'CONTROLLED', colors.greenLight],
                ].map(([label, value, color], index) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 86, borderBottom: `1px solid ${colors.border}`, fontSize: 22, fontWeight: 850 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}><CheckCircle2 size={23} color={String(color)} />{label}</span>
                    <span style={{ color: String(color), fontWeight: 950 }}>{value}</span>
                  </div>
                ))}
              </div>
              <ForensicMapField />
            </div>
          </div>
        </BrowserChrome>
      </div>
      <CriticalRiskCallout />
    </AbsoluteFill>
  );
};

const CriticalRiskCallout: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      right: 240,
      bottom: 74,
      width: 860,
      minHeight: 106,
      borderRadius: 24,
      border: '1px solid rgba(235,87,87,.7)',
      background: 'linear-gradient(90deg, rgba(235,87,87,.2), rgba(20,8,8,.86))',
      boxShadow: '0 0 70px rgba(235,87,87,.22), 0 26px 80px rgba(0,0,0,.45)',
      display: 'flex',
      alignItems: 'center',
      gap: 22,
      padding: '22px 28px',
    }}
  >
    <div style={{ color: colors.red, width: 48, height: 48, borderRadius: '50%', border: '1px solid rgba(235,87,87,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(235,87,87,.13)' }}>
      <AlertTriangle size={27} />
    </div>
    <div>
      <div style={{ color: colors.red, fontSize: 18, fontWeight: 950, letterSpacing: 2, textTransform: 'uppercase' }}>Critical insider cluster</div>
      <div style={{ marginTop: 6, color: colors.text, fontSize: 34, fontWeight: 950 }}>Controls 65% of total supply</div>
    </div>
  </div>
);

const ForensicMapField: React.FC = () => {
  const frame = useCurrentFrame();
  const hotspots = [
    [180, 170, 96, colors.red, 'INSIDER'],
    [350, 230, 58, colors.yellow, 'LP'],
    [245, 360, 45, colors.green, 'DEX'],
    [445, 410, 38, colors.blue, 'CEX'],
  ] as const;
  return (
    <div style={{ position: 'relative', border: `1px solid ${colors.border}`, borderRadius: 22, background: '#090B0C', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 22, top: 20, color: colors.muted, fontSize: 14, fontWeight: 950, letterSpacing: 2, textTransform: 'uppercase' }}>Supply control map</div>
      <svg width="100%" height="100%" viewBox="0 0 560 560" style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="dangerHeat" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(235,87,87,.58)" />
            <stop offset="55%" stopColor="rgba(235,87,87,.16)" />
            <stop offset="100%" stopColor="rgba(235,87,87,0)" />
          </radialGradient>
        </defs>
        <path d="M95 360 C150 250 180 130 300 112 C420 92 500 190 476 322 C450 465 328 505 210 474 C108 447 61 425 95 360Z" fill="rgba(42,245,152,.045)" stroke="rgba(42,245,152,.20)" strokeWidth="2" />
        <path d="M146 333 C185 254 218 198 298 182 C391 164 443 219 432 316 C417 414 323 432 244 407 C168 383 118 390 146 333Z" fill="none" stroke="rgba(42,245,152,.13)" strokeWidth="2" />
        <path d="M205 330 C225 276 248 242 311 230 C368 219 397 254 391 315 C383 377 321 392 270 373 C222 355 188 376 205 330Z" fill="none" stroke="rgba(42,245,152,.17)" strokeWidth="2" />
        <circle cx="180" cy="170" r={104 + Math.sin(frame / 17) * 8} fill="url(#dangerHeat)" />
        <path d="M180 170 C242 212 296 236 350 230 M180 170 C215 255 219 314 245 360 M180 170 C300 224 389 323 445 410" stroke="rgba(235,87,87,.42)" strokeWidth="3" strokeDasharray="10 12" strokeDashoffset={-frame * 0.9} fill="none" />
      </svg>
      {hotspots.map(([x, y, size, color, label], index) => (
        <div key={label} style={{ position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) scale(${1 + Math.sin(frame / 20 + index) * 0.055})`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ width: size, height: size, borderRadius: '50%', background: color, border: '3px solid rgba(255,255,255,.64)', boxShadow: `0 0 ${size}px ${color}88` }} />
          <div style={{ color, fontSize: 11, fontWeight: 950, letterSpacing: 1.2, background: 'rgba(4,6,7,.72)', border: `1px solid ${color}66`, borderRadius: 999, padding: '5px 8px' }}>{label}</div>
        </div>
      ))}
    </div>
  );
};

const OnePlaceScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = inOut(frame, fps, 20.7, 25.4);
  const ring = progress(frame, fps, 21.0, 22.3);

  return (
    <AbsoluteFill style={{ ...sceneStyle(o, 0), alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', top: 120, fontSize: 80, fontWeight: 950, color: colors.text, textShadow: '0 22px 70px rgba(0,0,0,.5)' }}>
        All intelligence, <GlowText>in one place.</GlowText>
      </div>
      <div style={{ position: 'absolute', top: 284, width: 1060, height: 430, borderRadius: '50%', borderTop: '10px solid rgba(42,245,152,.72)', filter: 'blur(.3px)', boxShadow: '0 -16px 80px rgba(42,245,152,.32)' }} />
      <div style={{ position: 'absolute', top: 306, width: 820, height: 300, borderRadius: '50%', background: 'radial-gradient(ellipse at center, rgba(42,245,152,.17), rgba(42,245,152,.04) 54%, transparent 72%)', transform: `scale(${interpolate(ring, [0, 1], [.86, 1], clamp)})` }} />
      <div style={{ position: 'absolute', top: 384, left: 800, width: 320, height: 118, border: '1px solid rgba(42,245,152,.28)', background: 'linear-gradient(180deg, rgba(28,31,34,.8), rgba(7,9,10,.76))', borderRadius: 26, boxShadow: '0 0 80px rgba(42,245,152,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Img src={staticFile('logo.png')} style={{ width: 50, height: 50 }} />
        <div style={{ fontSize: 24, fontWeight: 950, letterSpacing: 2 }}>ATLAIX CORE</div>
      </div>
      {[
        ['Detection', <Radar size={44} />, 500, 408],
        ['Safe Scan', <ShieldCheck size={44} />, 700, 602],
        ['Alpha Feed', <TrendingUp size={44} />, 960, 660],
        ['Smart Money', <Wallet size={44} />, 1220, 602],
        ['AI Signal', <Brain size={44} />, 1420, 408],
      ].map(([label, icon, x, y], index) => (
        <FloatingModule key={String(label)} label={String(label)} icon={icon as React.ReactNode} x={Number(x)} y={Number(y)} delay={index * 0.6} />
      ))}
    </AbsoluteFill>
  );
};

const FloatingModule: React.FC<{ label: string; icon: React.ReactNode; x: number; y: number; delay: number }> = ({ label, icon, x, y, delay }) => {
  const frame = useCurrentFrame();
  const yFloat = Math.sin(frame / 22 + delay) * 14;
  return (
    <div style={{ position: 'absolute', left: x - 74, top: y + yFloat - 74, width: 148, height: 148, borderRadius: '50%', background: 'radial-gradient(circle at 50% 35%, rgba(42,245,152,.14), #080B0C 66%)', border: '3px solid rgba(255,255,255,.72)', boxShadow: '0 0 70px rgba(42,245,152,.32), inset 0 0 35px rgba(42,245,152,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 11, color: colors.greenLight }}>
      {icon}
      <span style={{ color: colors.text, fontSize: 15, fontWeight: 950, letterSpacing: .8 }}>{label}</span>
    </div>
  );
};

const FinalScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = inOut(frame, fps, 26.0, 30, 29.6, 30);

  return (
    <AbsoluteFill style={{ ...sceneStyle(o, 0), alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', top: 250, display: 'flex', alignItems: 'center', gap: 26, transform: `scale(${interpolate(progress(frame, fps, 26.1, 27.0), [0, 1], [.86, 1], clamp)})` }}>
        <Img src={staticFile('logo.png')} style={{ width: 112, height: 112, filter: 'drop-shadow(0 0 46px rgba(42,245,152,.48))' }} />
        <div style={{ fontSize: 88, fontWeight: 950, color: colors.text, letterSpacing: 4 }}>ATLAIX</div>
      </div>
      <div style={{ position: 'absolute', top: 420, width: 1220, textAlign: 'center', fontSize: 54, lineHeight: 1.08, fontWeight: 900 }}>
        Detect early. Verify risk. Follow smart money.
      </div>
      <div style={{ position: 'absolute', top: 560, display: 'inline-flex', alignItems: 'center', gap: 12, border: '1px solid rgba(42,245,152,.32)', background: 'rgba(38,211,86,.10)', color: colors.greenLight, borderRadius: 999, padding: '16px 24px', fontSize: 18, fontWeight: 950, letterSpacing: 2, textTransform: 'uppercase' }}>
        <Sparkles size={21} /> Crypto intelligence for serious capital
      </div>
    </AbsoluteFill>
  );
};

export const AtlaixInvestorFilm: React.FC = () => (
  <AbsoluteFill style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: colors.text, overflow: 'hidden' }}>
    <Audio src={staticFile('atlaix-investor-bed.wav')} volume={0.42} />
    <LightWorld />
    <HeroLogoScene />
    <ProductStageScene />
    <KineticProofScene />
    <ScannerScene />
    <OnePlaceScene />
    <FinalScene />
    <Header />
  </AbsoluteFill>
);
