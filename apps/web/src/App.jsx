import React, { useState, useEffect } from 'react';
import { Route, Routes, BrowserRouter as Router, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import { Toaster } from '@/components/ui/sonner';
import ScrollToTop from './components/ScrollToTop.jsx';
import DashboardLayout from './components/DashboardLayout.jsx';
import HomePage from './pages/HomePage.jsx';
import MonitoringPage from './pages/MonitoringPage.jsx';
import AutomationPage from './pages/AutomationPage.jsx';
import DevicesPage from './pages/DevicesPage.jsx';
import AlertsPage from './pages/AlertsPage.jsx';
import HistoricalPage from './pages/HistoricalPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import OperationsPage from './pages/OperationsExperiencePage.jsx';
import AIForecastPage from './pages/AIForecastPage.jsx';
import AuthPage from './pages/AuthPage.jsx';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import { publishUserDirectoryEntry } from './lib/deviceManagementService';
import { Leaf } from 'lucide-react';

function App() {
  const [user, setUser] = useState(undefined); // undefined = masih loading

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser ?? null);
      // Indeks email terverifikasi → UID agar owner dapat menambahkan user ini sebagai operator.
      publishUserDirectoryEntry(currentUser).catch(error => {
        console.warn('Gagal memperbarui direktori pengguna:', error);
      });
    });
    return () => unsubscribe();
  }, []);

  // Masih cek session Firebase → tampilkan loading
  if (user === undefined) {
    return (
      <ThemeProvider>
        <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-green-600 flex items-center justify-center">
              <Leaf size={20} className="text-white" />
            </div>
            <span className="text-2xl font-black text-foreground">Tandurai</span>
          </div>
          <div className="animate-spin rounded-full h-7 w-7 border-[3px] border-muted border-t-green-600" />
          <p className="text-sm text-muted-foreground">Memuat sistem Tandurai...</p>
        </div>
      </ThemeProvider>
    );
  }

  // Belum login → tampilkan AuthPage saja
  if (!user) {
    return (
      <ThemeProvider>
        <AuthPage />
        <Toaster />
      </ThemeProvider>
    );
  }

  // Sudah login → tampilkan dashboard dengan semua route
  return (
    <ThemeProvider>
      <Router>
        <ScrollToTop />
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/monitoring" element={<MonitoringPage />} />
            <Route path="/operations" element={<OperationsPage />} />
            <Route path="/ai-forecast" element={<AIForecastPage />} />
            <Route path="/automation" element={<AutomationPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/historical" element={<HistoricalPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                <h1 className="text-4xl font-bold mb-4">404 - Page not found</h1>
                <p className="text-muted-foreground mb-6">The page you are looking for does not exist.</p>
                <a href="/" className="text-primary hover:underline">Back to dashboard</a>
              </div>
            } />
          </Route>
        </Routes>
        <Toaster />
      </Router>
    </ThemeProvider>
  );
}

export default App;