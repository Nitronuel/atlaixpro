// Reusable interface component for Atlaix product workflows.
import React, { useEffect, useRef, useState } from 'react';
import { ViewState } from '../../types';
import {
  Activity, Bell, Briefcase,
  LayoutDashboard, LogIn, LogOut, Menu, MessageSquare, Moon, PanelLeft, Radar,
  Settings, ShieldCheck, Sun, Target, User, Wallet,
  X, Zap
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { UserProfile } from '../../services/ProfileService';
import { GlobalAiAssistant } from '../assistant/GlobalAiAssistant';

interface LayoutProps {
  children: React.ReactNode;
  currentView: ViewState;
  onViewChange: (view: ViewState) => void;
  onLogout: () => void;
  isAuthenticated: boolean;
  authLoading?: boolean;
  profile?: UserProfile | null;
  userEmail?: string;
  onLogin: () => void;
}

type NavItem = {
  path: string;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  group: 'overview' | 'market' | 'capital' | 'tools' | 'account';
  badge?: string;
  action?: 'theme';
};

const navItems: NavItem[] = [
  { path: '/dashboard', label: 'Overview', shortLabel: 'Overview', icon: <LayoutDashboard size={19} />, group: 'overview' },
  { path: '/detection', label: 'Detection Engine', shortLabel: 'Detection', icon: <Radar size={19} />, group: 'market' },
  { path: '/sentiment', label: 'Narrative Intelligence', shortLabel: 'Narrative', icon: <Target size={19} />, group: 'market' },
  { path: '/smart-money', label: 'Smart Money Engine', shortLabel: 'Smart Money', icon: <Zap size={19} />, group: 'capital' },
  { path: '/heatmap', label: 'Token Heatmap', shortLabel: 'Heatmap', icon: <Activity size={19} />, group: 'capital' },
  { path: '/wallet', label: 'Wallet Tracker', shortLabel: 'Wallets', icon: <Wallet size={19} />, group: 'capital' },
  { path: '/smart-alerts', label: 'Smart Alerts', shortLabel: 'Alerts', icon: <Bell size={19} />, group: 'tools' },
  { path: '/ai-assistant', label: 'AI Assistant', shortLabel: 'Assistant', icon: <MessageSquare size={19} />, group: 'tools' },
  { path: '/safe-scan', label: 'Safe Scan', shortLabel: 'Safe Scan', icon: <ShieldCheck size={19} />, group: 'tools' },
  { path: '/settings', label: 'Settings', shortLabel: 'Settings', icon: <Settings size={19} />, group: 'account' },
  { path: '#theme', label: 'Switch Theme', shortLabel: 'Theme', icon: <Sun size={19} />, group: 'account', action: 'theme' }
];

const navSections: Array<{ key: NavItem['group']; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'market', label: 'Market & Narrative Intelligence' },
  { key: 'capital', label: 'Wallet & Capital Intelligence' },
  { key: 'tools', label: 'Platform-wide Intelligence & Tools' },
  { key: 'account', label: 'Account' }
];

const getInitial = (name?: string, email?: string) => {
  const source = (name || email || 'A').trim();
  return source.charAt(0).toUpperCase();
};

const getPageTitle = (pathname: string) => {
  if (pathname === '/' || pathname.startsWith('/dashboard')) return 'Overview';
  if (pathname.startsWith('/detection/token')) return 'Token Detection';
  if (pathname.startsWith('/detection')) return 'Detection Engine';
  if (pathname.startsWith('/sentiment')) return 'Narrative Intelligence';
  if (pathname.startsWith('/smart-money/')) return 'Smart Wallet Profile';
  if (pathname.startsWith('/smart-money')) return 'Smart Money Engine';
  if (pathname.startsWith('/token-smart-money')) return 'Token Smart Money';
  if (pathname.startsWith('/heatmap')) return 'Token Heatmap';
  if (pathname.startsWith('/wallet/')) return 'Wallet Profile';
  if (pathname.startsWith('/wallet')) return 'Wallet Tracker';
  if (pathname.startsWith('/smart-alerts')) return 'Smart Alerts';
  if (pathname.startsWith('/ai-assistant')) return 'AI Assistant';
  if (pathname.startsWith('/safefy-scan')) return 'Safe Scan';
  if (pathname.startsWith('/safe-scan') || pathname.startsWith('/alchemy-hub')) return 'Safe Scan';
  if (pathname.startsWith('/settings')) return 'Settings';
  if (pathname.startsWith('/token/')) return 'Token Overview';
  return 'Atlaix Workspace';
};

const formatPlanLabel = (plan?: string) => {
  const normalized = (plan || 'free').trim();
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)} Plan`;
};

export const Layout: React.FC<LayoutProps> = ({ children, onLogout, isAuthenticated, authLoading, profile, userEmail, onLogin }) => {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [navPinned, setNavPinned] = useState(false);
  const [navHoverSuppressed, setNavHoverSuppressed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem('atlaix-theme-preview');
    if (stored) return stored === 'dark';
    return false;
  });
  const location = useLocation();
  const navigate = useNavigate();
  const displayName = profile?.display_name || (isAuthenticated ? 'Atlaix User' : 'Guest');
  const displayEmail = userEmail || (isAuthenticated ? 'Connected' : 'Not connected');
  const plan = profile?.plan || 'free';
  const planLabel = formatPlanLabel(plan);
  const initial = getInitial(displayName, userEmail);
  const pageTitle = getPageTitle(location.pathname);

  const isActive = (path: string) => {
    if (path === '/dashboard' && location.pathname === '/') return true;
    return location.pathname.startsWith(path);
  };

  const handleNavigation = (path: string) => {
    setMobileNavOpen(false);
    setNavPinned(false);
    setNavHoverSuppressed(true);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    navigate(path);
  };

  const handleAccountNavigation = (path: string) => {
    setUserMenuOpen(false);
    if (!isAuthenticated) {
      onLogin();
      return;
    }
    handleNavigation(path);
  };

  const handleAuthAction = () => {
    setUserMenuOpen(false);
    setMobileNavOpen(false);
    if (isAuthenticated) {
      onLogout();
      return;
    }
    onLogin();
  };

  useEffect(() => {
    if (!userMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light';
      document.documentElement.dataset.atlaixTheme = darkMode ? 'dark' : 'light';
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('atlaix-theme-preview', darkMode ? 'dark' : 'light');
    }
  }, [darkMode]);

  return (
    <div className={`min-h-screen bg-main text-text-light ${darkMode ? 'atlaix-dark-preview' : ''}`}>
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_18%_8%,rgba(255,255,255,0.98),transparent_28%),radial-gradient(circle_at_76%_14%,rgba(211,239,218,0.24),transparent_22%),linear-gradient(135deg,#FFFFFF_0%,#FAFEFB_56%,#F4FBF6_100%)]" />

      <div className="relative z-10 min-h-screen">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-[60] w-full border-b border-white/70 bg-white/62 shadow-[0_12px_36px_rgba(93,112,145,0.12),inset_0_1px_0_rgba(255,255,255,0.94)] backdrop-blur-2xl">
            <div className="relative flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex min-w-0 items-center">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(true)}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/78 text-text-light shadow-[8px_10px_24px_rgba(101,116,145,0.12)] transition-all hover:bg-white focus:outline-none focus:ring-2 focus:ring-primary-green/40 lg:hidden"
                  aria-label="Open navigation menu"
                  aria-haspopup="dialog"
                  aria-expanded={mobileNavOpen}
                >
                  <Menu size={21} />
                </button>
                <button
                  onClick={() => handleNavigation('/dashboard')}
                  className="hidden min-w-0 items-center gap-3 rounded-full text-left lg:flex lg:min-w-[132px]"
                  aria-label="Atlaix dashboard"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/70 shadow-[8px_10px_24px_rgba(101,116,145,0.12),inset_0_1px_0_rgba(255,255,255,0.9)]">
                    <img src="/logo.png" alt="" className="h-7 w-7 rounded-xl object-contain" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-black text-text-light">Atlaix</span>
                  </span>
                </button>
              </div>
            </div>

            <h1 className="pointer-events-none absolute left-1/2 max-w-[calc(100vw-8.5rem)] -translate-x-1/2 truncate text-center text-base font-black text-text-light sm:text-lg lg:max-w-[42vw]">
              {pageTitle}
            </h1>

            <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDarkMode((current) => !current)}
                  className="atlaix-appearance-trigger hidden items-center rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-primary-green/40 md:inline-flex"
                  aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                  title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  <span className="atlaix-appearance-thumb">
                    {darkMode ? <Moon size={18} /> : <Sun size={19} />}
                  </span>
                </button>
                <div ref={userMenuRef} className="relative">
                  <button
                    type="button"
                    className="atlaix-profile-trigger grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-white text-text-light shadow-sm"
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    aria-label="Open user menu"
                    aria-haspopup="menu"
                    aria-expanded={userMenuOpen}
                  >
                    {isAuthenticated ? (
                      <span className="atlaix-profile-initial grid h-full w-full place-items-center text-sm font-black">{initial}</span>
                    ) : (
                      <User size={19} />
                    )}
                  </button>

                  {userMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-[70]" onClick={() => setUserMenuOpen(false)} />
                      <div role="menu" className="atlaix-profile-menu absolute right-0 top-14 z-[80] w-72 overflow-hidden rounded-[24px] border border-[#D8EBDD] bg-white p-2 shadow-[0_18px_42px_rgba(50,74,59,0.16)] animate-fade-in">
                        <div className="atlaix-profile-summary flex items-center gap-3 rounded-[20px] bg-[#F2FAF5] p-3">
                          <div className="atlaix-profile-avatar grid h-12 w-12 shrink-0 place-items-center rounded-full text-base font-black">
                            {isAuthenticated ? initial : <User size={20} />}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-text-light">{authLoading ? 'Loading...' : displayName}</div>
                            <div className="truncate text-xs font-semibold text-text-medium">{displayEmail}</div>
                            <div className="mt-1 text-[10px] font-black uppercase tracking-wider text-primary-green">{planLabel}</div>
                          </div>
                        </div>
                        <div className="mt-2 grid gap-1">
                          <button type="button" role="menuitem" onClick={() => handleAccountNavigation('/settings')} className="atlaix-profile-menu-item flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-bold text-text-light hover:bg-[#F2FAF5]">
                            <User size={16} /> Profile
                          </button>
                          <button type="button" role="menuitem" onClick={() => handleAccountNavigation('/settings')} className="atlaix-profile-menu-item flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-bold text-text-medium hover:bg-[#F2FAF5] hover:text-text-light">
                            <Briefcase size={16} /> Plan & Billing
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => setDarkMode((current) => !current)}
                            className="atlaix-profile-menu-item flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-bold text-text-medium hover:bg-[#F2FAF5] hover:text-text-light"
                          >
                            {darkMode ? <Moon size={16} /> : <Sun size={16} />}
                            Switch Theme
                          </button>
                          <button type="button" role="menuitem" onClick={() => { isAuthenticated ? onLogout() : onLogin(); setUserMenuOpen(false); }} className="atlaix-profile-menu-item flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-bold text-text-medium hover:bg-[#F2FAF5] hover:text-text-light">
                            {isAuthenticated ? <LogOut size={16} /> : <LogIn size={16} />}
                            {isAuthenticated ? 'Log out' : 'Log in'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
            </div>
            </div>
          </header>

          {mobileNavOpen && (
            <div className="fixed inset-0 z-[90] lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
              <button
                type="button"
                className="absolute inset-0 h-full w-full cursor-default bg-[#10131A]/42 backdrop-blur-[2px]"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation menu"
              />
              <aside className="relative flex h-dvh w-[min(86vw,340px)] flex-col overflow-hidden border-r border-white/70 bg-white/92 shadow-[24px_0_70px_rgba(40,67,48,0.22)] backdrop-blur-2xl">
                <div className="flex h-16 items-center justify-between gap-3 border-b border-[#D8EBDD]/70 px-4">
                  <button
                    type="button"
                    onClick={() => handleNavigation('/dashboard')}
                    className="flex min-w-0 items-center gap-3 rounded-full text-left"
                    aria-label="Atlaix dashboard"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white shadow-[8px_10px_24px_rgba(101,116,145,0.12)]">
                      <img src="/logo.png" alt="" className="h-7 w-7 rounded-xl object-contain" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                    </span>
                    <span className="truncate text-base font-black text-text-light">Atlaix</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileNavOpen(false)}
                    className="atlaix-mobile-nav-close grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#F2FAF5] text-text-light transition-all hover:bg-white focus:outline-none focus:ring-2 focus:ring-primary-green/40"
                    aria-label="Close navigation menu"
                  >
                    <X size={21} />
                  </button>
                </div>

                <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Mobile navigation">
                  {navSections.map((section) => {
                    const sectionItems = navItems.filter((item) => item.group === section.key);
                    if (!sectionItems.length) return null;

                    return (
                      <div key={section.key} className="mb-4 grid gap-1">
                        <div className="px-3 pb-1 text-[11px] font-black uppercase leading-tight tracking-[0.12em] text-text-dark">
                          {section.label}
                        </div>
                        {sectionItems.map((item) => (
                          <button
                            key={item.path}
                            type="button"
                            onClick={() => {
                              if (item.action === 'theme') {
                                setDarkMode((current) => !current);
                                return;
                              }
                              handleNavigation(item.path);
                            }}
                            className={`atlaix-nav-item ${item.action === 'theme' ? 'atlaix-mobile-theme-toggle' : ''} flex min-h-12 w-full items-center gap-3 rounded-[18px] px-3 py-3 text-left transition-all ${
                              isActive(item.path)
                                ? 'is-active'
                                : 'text-text-medium hover:bg-[#F2FAF5] hover:text-text-light'
                            }`}
                            aria-current={!item.action && isActive(item.path) ? 'page' : undefined}
                          >
                            <span className="grid h-6 w-6 shrink-0 place-items-center">{item.action === 'theme' && darkMode ? <Moon size={19} /> : item.icon}</span>
                            <span className="min-w-0 flex-1 truncate text-sm font-black">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </nav>
                <div className="border-t border-border p-3">
                  <button
                    type="button"
                    onClick={handleAuthAction}
                    className="atlaix-side-account-card flex w-full items-center gap-3 rounded-[18px] border border-border bg-card px-3 py-3 text-left shadow-sm transition-all hover:border-primary-green/45 hover:bg-primary-green/10"
                    aria-label={isAuthenticated ? 'Log out' : 'Log in'}
                  >
                    <span className="atlaix-profile-avatar grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-black">
                      {isAuthenticated ? initial : <User size={20} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black text-text-light">{authLoading ? 'Loading...' : displayName}</span>
                      <span className="block truncate text-xs font-bold text-text-medium">{planLabel}</span>
                    </span>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-text-medium">
                      {isAuthenticated ? <LogOut size={18} /> : <LogIn size={18} />}
                    </span>
                  </button>
                </div>
              </aside>
            </div>
          )}

          <div className="pointer-events-none fixed bottom-5 left-0 top-[76px] z-50 hidden w-[72px] lg:block">
            <aside
              className={`atlaix-app-rail group/app-rail pointer-events-auto absolute inset-y-0 left-0 flex flex-col overflow-hidden rounded-[30px] border border-white/70 bg-white/58 shadow-[18px_24px_70px_rgba(93,112,145,0.16),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-2xl transition-[width,box-shadow] duration-300 ease-out hover:w-[286px] hover:shadow-[22px_28px_80px_rgba(73,119,88,0.20)] focus-within:w-[286px] focus-within:shadow-[22px_28px_80px_rgba(73,119,88,0.20)] ${navPinned ? 'is-pinned w-[286px]' : 'w-[72px]'} ${navHoverSuppressed ? 'is-auto-collapsed' : ''}`}
              onMouseLeave={() => setNavHoverSuppressed(false)}
              aria-label="Primary navigation"
            >
              <div className="flex h-20 items-center gap-3 px-3">
                <button
                  type="button"
                  onClick={() => {
                    setNavHoverSuppressed(false);
                    setNavPinned((current) => !current);
                  }}
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-full transition-all ${
                    navPinned
                      ? 'bg-primary-green text-white shadow-[0_12px_30px_rgba(63,163,77,0.28)]'
                      : 'bg-white/74 text-text-light shadow-[8px_10px_24px_rgba(101,116,145,0.12)] hover:bg-white'
                  }`}
                  title={navPinned ? 'Collapse navigation' : 'Keep navigation open'}
                  aria-label={navPinned ? 'Collapse navigation' : 'Keep navigation open'}
                  aria-pressed={navPinned}
                >
                  <PanelLeft size={20} />
                </button>
                <div className={`atlaix-rail-reveal min-w-0 ${navPinned ? 'opacity-100 translate-x-0' : ''}`}>
                  <div className="truncate text-sm font-black text-text-light">Dashboard</div>
                </div>
              </div>

              <nav className="atlaix-app-nav flex min-h-0 flex-1 flex-col px-2 pb-2" aria-label="Atlaix sections">
                {navSections.map((section) => {
                  const sectionItems = navItems.filter((item) => item.group === section.key);
                  if (!sectionItems.length) return null;

                  return (
                    <div key={section.key} className="atlaix-nav-section grid gap-1">
                      <div
                        className={`atlaix-rail-reveal h-0 overflow-hidden px-3 text-[11px] font-black uppercase leading-tight tracking-[0.12em] text-text-dark group-hover/app-rail:h-auto group-hover/app-rail:pb-1 group-hover/app-rail:pt-2 group-focus-within/app-rail:h-auto group-focus-within/app-rail:pb-1 group-focus-within/app-rail:pt-2 ${navPinned ? 'h-auto pb-1 pt-2 opacity-100' : ''}`}
                      >
                        {section.label}
                      </div>
                      {sectionItems.map((item) => (
                        <button
                          key={item.path}
                          type="button"
                          onClick={() => item.action === 'theme' ? setDarkMode((current) => !current) : handleNavigation(item.path)}
                          className={`atlaix-nav-item group/item flex h-12 w-full items-center gap-3 rounded-[18px] px-3 text-left transition-all ${
                            isActive(item.path)
                              ? 'is-active'
                              : 'text-text-medium hover:bg-white/78 hover:text-text-light'
                          }`}
                          title={item.label}
                          aria-current={!item.action && isActive(item.path) ? 'page' : undefined}
                        >
                          <span className="grid h-6 w-6 shrink-0 place-items-center">{item.action === 'theme' && darkMode ? <Moon size={19} /> : item.icon}</span>
                          <span className={`atlaix-rail-reveal min-w-0 flex-1 ${navPinned ? 'opacity-100 translate-x-0' : ''}`}>
                            <span className="block truncate text-sm font-black">{item.label}</span>
                          </span>
                          {item.badge ? (
                            <span className={`atlaix-rail-reveal shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${navPinned ? 'opacity-100 translate-x-0' : ''} ${isActive(item.path) ? 'bg-white text-primary-green' : 'bg-primary-green/10 text-primary-green'}`}>
                              {item.badge}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </nav>

              <div className="shrink-0 px-2 pb-3">
                <button
                  type="button"
                  onClick={handleAuthAction}
                  className="atlaix-side-account-card group/account-card flex h-14 w-full items-center gap-3 overflow-hidden rounded-[18px] border border-border bg-card px-2.5 text-left shadow-sm transition-all hover:border-primary-green/45 hover:bg-primary-green/10"
                  aria-label={isAuthenticated ? 'Log out' : 'Log in'}
                  title={isAuthenticated ? 'Log out' : 'Log in'}
                >
                  <span className="atlaix-profile-avatar grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black">
                    {isAuthenticated ? initial : <User size={19} />}
                  </span>
                  <span className={`atlaix-rail-reveal min-w-0 flex-1 ${navPinned ? 'opacity-100 translate-x-0' : ''}`}>
                    <span className="block truncate text-sm font-black text-text-light">{authLoading ? 'Loading...' : displayName}</span>
                    <span className="block truncate text-xs font-bold text-text-medium">{planLabel}</span>
                  </span>
                  <span className={`atlaix-rail-reveal grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-medium group-hover/account-card:text-primary-green ${navPinned ? 'opacity-100 translate-x-0' : ''}`}>
                    {isAuthenticated ? <LogOut size={18} /> : <LogIn size={18} />}
                  </span>
                </button>
              </div>

            </aside>
          </div>

          <main className="relative flex-1 px-3 pb-8 pt-5 sm:px-5 lg:pl-[96px]">
            {children}
          </main>
          <GlobalAiAssistant />
        </div>
      </div>
    </div>
  );
};
