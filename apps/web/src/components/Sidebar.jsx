import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Activity,
  Package,
  Sliders,
  Cpu,
  Bell,
  Database,
  FileText,
  Settings,
  BrainCircuit,
  Users,
  KeyRound,
  Menu,
  X,
  Gauge,
  Building2,
  UserCog,
  ArrowLeft,
} from 'lucide-react';

import LogoTandurai from '../logo-tandurai.png';
import { useFarmContext } from '@/contexts/FarmContext';

const menuItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/monitoring', label: 'Monitoring', icon: Activity },
  { path: '/operations', label: 'Operasional Kumbung', icon: Package },
  { path: '/ai-forecast', label: 'Perkiraan Panen AI', icon: BrainCircuit },
  { path: '/automation', label: 'Automation Control', icon: Sliders },
  { path: '/devices', label: 'Devices', icon: Cpu },
  { path: '/farm-members', label: 'Anggota Farm', icon: Users },
  { path: '/alerts', label: 'Alerts', icon: Bell },
  { path: '/historical', label: 'Historical Data', icon: Database },
  { path: '/reports', label: 'Reports', icon: FileText },
  { path: '/settings', label: 'Settings', icon: Settings },
];

// Konsol admin Tandurai: pemantauan seluruh sistem (bukan fitur farm).
const adminItems = [
  { path: '/admin', label: 'Ringkasan Sistem', icon: Gauge },
  { path: '/admin/farms', label: 'Farm & Klien', icon: Building2 },
  { path: '/admin/users', label: 'Pengguna', icon: UserCog },
  { path: '/admin/devices', label: 'Registrasi Perangkat', icon: KeyRound },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const { isAdmin, adminConsole, exitFarmView, farm } = useFarmContext();
  const items = adminConsole ? adminItems : menuItems;
  const backToConsole = () => { exitFarmView(); setIsOpen(false); navigate('/admin'); };

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-card border border-border shadow-lg"
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Overlay Mobile */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-screen w-64 bg-card border-r border-border z-40 transition-transform duration-300 flex flex-col ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        {/* Logo */}
        <div className="p-6 border-b border-border">
          <Link to="/" className="flex items-center gap-3 group">
            <img
              src={LogoTandurai}
              alt="Logo Tandurai"
              className="w-14 h-14 object-contain transition-transform duration-300 group-hover:scale-110"
            />

            <div>
              <h1 className="text-lg font-bold leading-tight bg-gradient-to-r from-green-500 to-emerald-600 bg-clip-text text-transparent">
                Dashboard Tandurai
              </h1>

              <p className="text-xs text-muted-foreground">
                Smart Farm Control
              </p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4">
          {adminConsole && <p className="px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-violet-600">Konsol Admin</p>}
          {isAdmin && !adminConsole && (
            <div className="mb-3 space-y-1">
              <button type="button" onClick={backToConsole}
                className="flex w-full items-center gap-3 rounded-lg bg-violet-500/10 px-4 py-3 text-left text-sm font-medium text-violet-700 hover:bg-violet-500/20 dark:text-violet-300">
                <ArrowLeft size={18} />Kembali ke Konsol Admin
              </button>
              <p className="px-4 text-xs text-muted-foreground">Melihat farm: <span className="font-medium text-foreground">{farm?.name || '—'}</span></p>
            </div>
          )}
          <ul className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;

              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    onClick={() => setIsOpen(false)}
                    className={`relative flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                      isActive
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeIndicator"
                        className="absolute left-0 top-0 bottom-0 w-1 bg-green-500 rounded-r-full"
                        transition={{
                          type: 'spring',
                          stiffness: 300,
                          damping: 30,
                        }}
                      />
                    )}

                    <Icon size={20} />

                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <p className="text-xs text-center text-muted-foreground">
            © 2026 Tandurai
          </p>
        </div>
      </aside>
    </>
  );
}