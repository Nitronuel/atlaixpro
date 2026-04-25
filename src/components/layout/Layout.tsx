import React, { useState } from 'react';
import { ViewState } from '../../types';
import {
  LayoutDashboard, Users, Target, Activity, Radar, MessageSquare,
  Wallet, Zap, ShieldCheck, Bell, Settings, LogOut, LogIn, Menu, User, Briefcase, Network
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

interface LayoutProps {
  children: React.ReactNode;
  currentView: ViewState; // Kept for interface compatibility but ignored
  onViewChange: (view: ViewState) => void; // Kept for interface compatibility but ignored
  onLogout: () => void;
  isAuthenticated: boolean;
  onLogin: () => void;
}

const NavItem: React.FC<{
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  colorClass?: string;
  tag?: string;
}> = ({ active, icon, label, onClick, colorClass, tag }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center px-3 py-2 rounded-lg mb-0.5 transition-all duration-200 text-[0.9rem] font-medium relative group text-left
      ${active ? 'bg-card text-text-light font-semibold' : 'text-text-medium hover:bg-card hover:text-text-light'}
      ${active && colorClass ? colorClass : ''}
    `}
  >
    {active && (
      <div className="absolute left-[-0.75rem] top-0 bottom-0 w-1 rounded-r-md bg-primary-green" />
    )}
    <span className={`mr-3 ${active ? 'text-current' : 'text-text-dark group-hover:text-current'}`}>
      {icon}
    </span>
    <span className="flex-1 truncate">{label}</span>
    {tag && (
      <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded bg-primary-green/10 text-primary-green">
        {tag}
      </span>
    )}
  </button>
);

export const Layout: React.FC<LayoutProps> = ({ children, onLogout, isAuthenticated, onLogin }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const handleNavigation = (path: string) => {
    navigate(path);
    setSidebarOpen(false);
  };

  const isActive = (path: string) => {
    if (path === '/dashboard' && location.pathname === '/') return true;
    return location.pathname.startsWith(path);
  };

  const getPageTitle = () => {
    const path = location.pathname;
    if (path.includes('/dashboard')) return 'Overview';
    if (path.includes('/token/')) return 'Detection Engine';
    if (path.includes('/token-smart-money/')) return 'Token Smart Money View';

    if (path.includes('/heatmap')) return 'Token Heatmap';
    if (path.includes('/sentiment')) return 'Sentiment Intelligence';
    if (path.includes('/detection')) return 'Global Detection';
    if (path.includes('/ai-assistant')) return 'AI Assistant';
    if (path.includes('/wallet')) return 'Wallet Tracker';
    if (path.includes('/wallet')) return 'Wallet Tracker';
    if (path.includes('/smart-money-scanner')) return 'Smart Money Scanner';
    if (path.includes('/smart-money/')) return 'Smart Wallet Profile Page';
    if (path.includes('/smart-money')) return 'Smart Money Engine';
    if (path.includes('/safe-scan')) return 'Safe Scan';
    if (path.includes('/alchemy-hub')) return 'Alchemy Hub';
    if (path.includes('/smart-alerts')) return 'Smart Alerts';
    if (path.includes('/settings')) return 'Settings';
    return 'Overview';
  };

  const getPageSubtitle = () => {
    const path = location.pathname;
    if (path.includes('/dashboard')) return 'Track token and stay ahead of the crowd';

    if (path.includes('/heatmap')) return 'Visualize concentration of normal vs. abnormal activity';
    if (path.includes('/sentiment')) return 'Monitor user opinions, reviews, and feedback trends.';
    if (path.includes('/detection')) return 'Identify anomalies, drift, or suspicious patterns';
    if (path.includes('/ai-assistant')) return 'Interact with Atlaix Intelligence';
    if (path.includes('/safe-scan')) return 'Security analysis and risk scoring for tokens';
    if (path.includes('/alchemy-hub')) return 'Alchemy-backed holder, cluster, and funding map intelligence';
    if (path.includes('/smart-money-scanner')) return 'Automate early-buyer wallet discovery and qualification';
    if (path.includes('/wallet')) return 'Monitor wallet activity, performance and patterns';
    if (path.includes('/smart-alerts')) return 'Create AI-powered market alerts';
    return '';
  };

  return (
    <div className="flex h-screen bg-main overflow-hidden text-base">
      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-[1000] xl:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed xl:static inset-y-0 left-0 z-[1100] w-[300px] xl:w-[280px] bg-sidebar border-r border-border
        transform transition-transform duration-300 ease-in-out flex flex-col shadow-2xl xl:shadow-none
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full xl:translate-x-0'}
      `}>
        <div className="px-3 py-4">
          <div className="flex items-center gap-3 text-2xl font-bold text-text-light pl-2">
            <img
              src="./logo.png"
              alt="Atlaix Logo"
              className="w-9 h-9 object-contain"
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
            Atlaix
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <div className="text-xs font-bold text-text-dark uppercase tracking-wider mb-2 mt-2 pl-2">Overview</div>
          <NavItem active={isActive('/dashboard')} onClick={() => handleNavigation('/dashboard')} icon={<LayoutDashboard size={20} />} label="Overview" />

          <div className="text-xs font-bold text-text-dark uppercase tracking-wider mb-2 mt-5 pl-2">Market & Narrative Intelligence</div>
          <NavItem active={isActive('/detection')} onClick={() => handleNavigation('/detection')} icon={<Radar size={20} />} label="Detection Engine" />
          <NavItem active={isActive('/sentiment')} onClick={() => handleNavigation('/sentiment')} icon={<Target size={20} />} label="Sentiment Intelligence" />

          <div className="text-xs font-bold text-text-dark uppercase tracking-wider mb-2 mt-5 pl-2">Wallet & Capital Intelligence</div>
          <NavItem active={isActive('/smart-money')} onClick={() => handleNavigation('/smart-money')} icon={<Zap size={20} />} label="Smart Money Engine" />
          <NavItem active={isActive('/heatmap')} onClick={() => handleNavigation('/heatmap')} icon={<Activity size={20} />} label="Token Heatmap" />
          <NavItem active={isActive('/wallet')} onClick={() => handleNavigation('/wallet')} icon={<Wallet size={20} />} label="Wallet Tracker" />

          <div className="text-xs font-bold text-text-dark uppercase tracking-wider mb-2 mt-5 pl-2">Platform-Wide Intelligence & Tools</div>
          <NavItem active={isActive('/smart-alerts')} onClick={() => handleNavigation('/smart-alerts')} icon={<Bell size={20} />} label="Smart Alerts" />
          <NavItem active={isActive('/ai-assistant')} onClick={() => handleNavigation('/ai-assistant')} icon={<MessageSquare size={20} />} label="AI Assistant" />
          <NavItem active={isActive('/safe-scan')} onClick={() => handleNavigation('/safe-scan')} icon={<ShieldCheck size={20} />} label="Safe Scan" />
          <NavItem active={isActive('/alchemy-hub')} onClick={() => handleNavigation('/alchemy-hub')} icon={<Network size={20} />} label="Alchemy Hub" />

          <div className="text-xs font-bold text-text-dark uppercase tracking-wider mb-2 mt-5 pl-2">Account</div>
          <NavItem active={isActive('/settings')} onClick={() => handleNavigation('/settings')} icon={<Settings size={20} />} label="Settings" />

          <div className="mt-4 pt-4 border-t border-border">
            {isAuthenticated ? (
              <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-card transition-colors cursor-pointer" onClick={onLogout}>
                <div className="w-8 h-8 rounded-full bg-primary-purple flex items-center justify-center text-xs font-bold text-white">
                  A
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text-light truncate">Atlaix User</div>
                  <div className="text-[10px] text-text-medium">Free Plan</div>
                </div>
                <LogOut size={18} className="text-text-medium hover:text-primary-red transition-colors" />
              </div>
            ) : (
              <button
                onClick={onLogin}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-primary-green/10 border border-primary-green/20 text-primary-green font-bold hover:bg-primary-green hover:text-main transition-all"
              >
                <LogIn size={18} /> Sign In
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-main h-full">
        {/* Header */}
        <header className="h-[80px] xl:h-[100px] px-4 xl:px-6 flex items-center justify-between sticky top-0 bg-[#111315e6] backdrop-blur-md z-30 border-b border-border/50">
          <div className="flex items-center gap-5 overflow-hidden">
            <button
              className="xl:hidden text-text-medium hover:text-text-light"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={28} />
            </button>
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold text-text-light flex items-center gap-3 truncate">
                {getPageTitle()}
                {isActive('/dashboard') && (
                  <span className="text-xs px-2.5 py-0.5 rounded bg-card border border-border text-text-light font-semibold uppercase">Free</span>
                )}
              </h1>
              <p className="text-base text-text-medium truncate hidden xl:block mt-1">{getPageSubtitle()}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="relative">
              <button
                className="w-10 h-10 rounded-full bg-[#1C1F22] border border-[#2A2E33] flex items-center justify-center text-text-light hover:bg-[#222529] hover:border-text-medium transition-all shadow-sm group"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
              >
                {isAuthenticated ? (
                  <div className="w-full h-full rounded-full bg-primary-purple flex items-center justify-center text-white font-bold text-sm">A</div>
                ) : (
                  <User size={20} className="text-primary-green group-hover:scale-110 transition-transform" />
                )}
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 top-14 w-64 bg-[#111315] border border-[#2A2E33] rounded-xl shadow-2xl p-1.5 z-50 animate-fade-in overflow-hidden">
                    {/* User Info Header */}
                    <div className="flex items-center gap-3 p-3 mb-1 border-b border-[#2A2E33]/50">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0 ${isAuthenticated ? 'bg-primary-purple' : 'bg-[#222529]'}`}>
                        {isAuthenticated ? 'A' : <User size={20} className="text-[#8F96A3]" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-sm text-[#EAECEF] truncate">
                          {isAuthenticated ? 'AlphaTracker AI' : 'Guest'}
                        </div>
                        <div className="text-[11px] text-[#8F96A3] truncate">
                          {isAuthenticated ? 'user@example.com' : 'Not connected'}
                        </div>
                      </div>
                    </div>

                    {/* Menu Options */}
                    <div className="flex flex-col gap-0.5">
                      <button className="w-full text-left px-3 py-2.5 text-sm font-medium text-[#EAECEF] hover:bg-[#222529] rounded-lg flex items-center gap-3 transition-colors group">
                        <User size={16} className="text-primary-green" />
                        Profile
                      </button>
                      <button className="w-full text-left px-3 py-2.5 text-sm font-medium text-[#8F96A3] hover:text-[#EAECEF] hover:bg-[#222529] rounded-lg flex items-center gap-3 transition-colors">
                        <Briefcase size={16} />
                        Plan & Billing
                      </button>
                      <button
                        onClick={() => { handleNavigation('/settings'); setUserMenuOpen(false); }}
                        className="w-full text-left px-3 py-2.5 text-sm font-medium text-[#8F96A3] hover:text-[#EAECEF] hover:bg-[#222529] rounded-lg flex items-center gap-3 transition-colors"
                      >
                        <Settings size={16} />
                        Settings
                      </button>

                      <div className="h-px bg-[#2A2E33]/50 my-1" />

                      <button
                        onClick={() => {
                          if (isAuthenticated) onLogout();
                          else onLogin();
                          setUserMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-2.5 text-sm font-medium text-[#8F96A3] hover:text-[#EAECEF] hover:bg-[#222529] rounded-lg flex items-center gap-3 transition-colors"
                      >
                        <LogOut size={16} />
                        {isAuthenticated ? 'Login / Switch' : 'Log In'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* View Content */}
        <main className="flex-1 overflow-y-auto p-4 xl:p-6 relative">
          {children}
        </main>
      </div>
    </div>
  );
};
