import React, { useMemo } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Droplets, Wind, Lightbulb, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useFarmContext } from '@/contexts/FarmContext';
import { useKumbungTelemetry } from '@/hooks/useKumbungTelemetry';
import ActuatorControlPanel from '@/components/iot/ActuatorControlPanel';
import ActuatorLog from '@/components/iot/ActuatorLog';

const priorityColors = {
  high: 'bg-red-500/10 text-red-600 border-red-500/20',
  medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  low: 'bg-green-500/10 text-green-600 border-green-500/20',
};
const PRIORITY_LABEL = { high: 'tinggi', medium: 'sedang', low: 'aman' };

/**
 * Rekomendasi sederhana dari nilai terbaru kumbung terhadap rentang optimal & ambang alert farm
 * (FarmContext): lewat ambang kritis = tinggi, di luar rentang optimal = sedang, di dalam = aman.
 */
function buildRecommendations(latest, ranges, thresholds) {
  if (!Object.keys(latest).length) {
    return [{ title: 'Menunggu data sensor', description: 'Rekomendasi muncul setelah sensor di kumbung ini mengirim data.', priority: 'medium', icon: Lightbulb }];
  }
  const result = [];
  if (Number.isFinite(latest.humidity)) {
    const [low, high] = ranges.humidity;
    result.push(latest.humidity < thresholds.humidity.critical
      ? { title: 'Kelembapan sangat rendah', description: `Kelembapan ${latest.humidity}%. Nyalakan sprayer dan periksa pasokan air.`, priority: 'high', icon: Droplets }
      : latest.humidity < low
        ? { title: 'Kelembapan perlu dinaikkan', description: `Kelembapan ${latest.humidity}%, di bawah target ${low}–${high}%. Pertimbangkan siklus pengkabutan.`, priority: 'medium', icon: Droplets }
        : latest.humidity > high
          ? { title: 'Kelembapan terlalu tinggi', description: `Kelembapan ${latest.humidity}%, di atas ${high}%. Kurangi pengkabutan dan tambah sirkulasi.`, priority: 'medium', icon: Droplets }
          : { title: 'Kelembapan sesuai', description: `Kelembapan ${latest.humidity}% berada dalam rentang target ${low}–${high}%.`, priority: 'low', icon: Droplets });
  }
  if (Number.isFinite(latest.temperature)) {
    const [low, high] = ranges.temperature;
    result.push(latest.temperature > thresholds.temperature.critical
      ? { title: 'Suhu sangat tinggi', description: `Suhu ${latest.temperature}°C. Segera tambah ventilasi dan pengkabutan.`, priority: 'high', icon: TrendingUp }
      : latest.temperature > high
        ? { title: 'Suhu di atas target', description: `Suhu ${latest.temperature}°C, di atas ${high}°C. Tambah sirkulasi udara.`, priority: 'medium', icon: TrendingUp }
        : latest.temperature < low
          ? { title: 'Suhu di bawah target', description: `Suhu ${latest.temperature}°C, di bawah ${low}°C. Kurangi bukaan ventilasi.`, priority: 'medium', icon: TrendingUp }
          : { title: 'Suhu sesuai', description: `Suhu ${latest.temperature}°C berada dalam rentang target ${low}–${high}°C.`, priority: 'low', icon: TrendingUp });
  }
  if (Number.isFinite(latest.co2)) {
    const high = ranges.co2[1];
    result.push(latest.co2 > thresholds.co2.critical
      ? { title: 'CO₂ sangat tinggi', description: `CO₂ ${latest.co2} ppm. Ventilasi segera diperlukan.`, priority: 'high', icon: Wind }
      : latest.co2 > high
        ? { title: 'CO₂ meningkat', description: `CO₂ ${latest.co2} ppm di atas batas optimal ${high} ppm. Tambah ventilasi.`, priority: 'medium', icon: Wind }
        : { title: 'CO₂ sesuai', description: `CO₂ ${latest.co2} ppm di bawah ${high} ppm.`, priority: 'low', icon: Wind });
  }
  return result;
}

export default function AutomationPage() {
  const { kumbung, ranges, thresholds } = useFarmContext();
  // Nilai terbaru per parameter dari semua sensor kumbung (sumber tunggal, realtime).
  const { values: latest } = useKumbungTelemetry();
  const recommendations = useMemo(() => buildRecommendations(latest, ranges, thresholds), [latest, ranges, thresholds]);

  return (
    <>
      <Helmet>
        <title>Kontrol & Otomasi - Dashboard Tandurai</title>
        <meta name="description" content="Kontrol aktuator manual, jadwal, dan aturan otomatis kumbung" />
      </Helmet>

      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Kontrol & Otomasi</h1>
          <p className="text-muted-foreground">Kendalikan aktuator kumbung secara manual, terjadwal, atau otomatis berdasarkan sensor.</p>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
          <ActuatorControlPanel />
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Lightbulb className="text-primary" size={22} />Rekomendasi</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recommendations.map(rec => {
                    const Icon = rec.icon;
                    return (
                      <div key={rec.title} className="flex items-start gap-3 p-4 bg-muted rounded-lg">
                        <Icon className="text-primary mt-1" size={20} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium">{rec.title}</p>
                            <Badge variant="outline" className={priorityColors[rec.priority]}>{PRIORITY_LABEL[rec.priority]}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{rec.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }}>
            {kumbung ? <ActuatorLog kumbungId={kumbung.id} /> : null}
          </motion.div>
        </div>
      </div>
    </>
  );
}
