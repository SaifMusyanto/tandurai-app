import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import TopNavbar from './TopNavbar.jsx';
import ContextBar from './ContextBar.jsx';
import { FarmProvider } from '@/contexts/FarmContext';

export default function DashboardLayout() {
  return (
    <FarmProvider>
      <div className="min-h-screen bg-background">
        <Sidebar />
        <div className="lg:pl-64">
          <TopNavbar />
          <main className="p-4 lg:p-6">
            <ContextBar />
            <Outlet />
          </main>
        </div>
      </div>
    </FarmProvider>
  );
}
