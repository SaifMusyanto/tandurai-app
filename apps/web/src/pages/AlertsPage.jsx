import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Filter,
  Thermometer,
  Droplets,
  Wind,
  WifiOff,
  Loader2,
} from 'lucide-react';
import { ref, onValue } from 'firebase/database';
import { db } from '../firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const SENSOR_ICONS = {
  temperature_high: Thermometer,
  humidity_low: Droplets,
  co2_high: Wind,
  device_offline: WifiOff,
};

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertTriangle,
    color: 'bg-red-500/10 text-red-600 border-red-500/20',
  },
  warning: {
    icon: AlertCircle,
    color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  },
  normal: {
    icon: Info,
    color: 'bg-green-500/10 text-green-600 border-green-500/20',
  },
};

const getTimeAgo = (timestamp) => {
  const time = Number(timestamp);
  if (!time) return 'Belum ada waktu';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return 'Baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const alertsRef = ref(db, 'tumbara/alerts');
    return onValue(alertsRef, (snapshot) => {
      const value = snapshot.val() || {};
      const nextAlerts = Object.entries(value)
        .map(([id, alert]) => ({ id, ...alert }))
        .sort((a, b) => {
          if (a.status === 'active' && b.status !== 'active') return -1;
          if (a.status !== 'active' && b.status === 'active') return 1;
          return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
        });
      setAlerts(nextAlerts);
      setLoading(false);
    }, () => {
      setAlerts([]);
      setLoading(false);
    });
  }, []);

  const filteredAlerts = severityFilter === 'all'
    ? alerts
    : alerts.filter(alert => alert.severity === severityFilter);

  const criticalCount = alerts.filter(a => a.status === 'active' && a.severity === 'critical').length;
  const warningCount = alerts.filter(a => a.status === 'active' && a.severity === 'warning').length;
  const normalCount = alerts.filter(a => a.status === 'resolved' || a.severity === 'normal').length;

  return (
    <>
      <Helmet>
        <title>Alerts - Tandurai</title>
        <meta name="description" content="Peringatan dini kondisi kumbung secara real-time" />
      </Helmet>

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Pusat Peringatan Dini</h1>
            <p className="text-muted-foreground">Status suhu, kelembapan, CO₂, dan koneksi perangkat secara real-time</p>
          </div>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-44">
              <Filter size={16} className="mr-2" />
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Critical Aktif', count: criticalCount, icon: AlertTriangle, style: 'border-red-500/20 text-red-600' },
            { label: 'Warning Aktif', count: warningCount, icon: AlertCircle, style: 'border-yellow-500/20 text-yellow-600' },
            { label: 'Normal / Pulih', count: normalCount, icon: Info, style: 'border-green-500/20 text-green-600' },
          ].map(({ label, count, icon: Icon, style }, index) => (
            <motion.div key={label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: index * 0.08 }}>
              <Card className={style.split(' ')[0]}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">{label}</p>
                      <p className={`text-3xl font-bold ${style.split(' ')[1]}`}>{count}</p>
                    </div>
                    <Icon className={style.split(' ')[1]} size={32} />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              Status Alert
              <span className="text-muted-foreground font-normal ml-2">({filteredAlerts.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="animate-spin" size={20} /> Memuat status alert…
              </div>
            ) : filteredAlerts.length === 0 ? (
              <div className="text-center py-12">
                <Info className="mx-auto text-muted-foreground mb-4" size={48} />
                <p className="text-muted-foreground">Belum ada data alert dari Cloud Function.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredAlerts.map((alert, index) => {
                  const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.normal;
                  const SeverityIcon = config.icon;
                  const DeviceIcon = SENSOR_ICONS[alert.sensor] || Info;
                  const isActive = alert.status === 'active';

                  return (
                    <motion.div
                      key={alert.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.05 }}
                      className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${isActive ? 'bg-muted border-border' : 'bg-green-500/5 border-green-500/15'}`}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${config.color}`}>
                        <SeverityIcon size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 mb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold">{alert.type}</h3>
                            <Badge variant="outline" className={config.color}>{alert.severity}</Badge>
                            <Badge variant="outline" className={isActive ? 'border-red-500/20 text-red-600' : 'border-green-500/20 text-green-600'}>
                              {isActive ? 'Aktif' : 'Resolved'}
                            </Badge>
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{getTimeAgo(alert.updatedAt)}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{alert.message}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <DeviceIcon size={14} />
                          <span>{alert.device}</span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
