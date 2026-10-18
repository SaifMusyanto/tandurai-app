import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import ManualControlSection from '@/components/iot/ManualControlSection';
import ScheduleSection from '@/components/iot/ScheduleSection';
import RuleSection from '@/components/iot/RuleSection';
import { useFarmContext } from '@/contexts/FarmContext';
import { useIot } from '@/contexts/IotContext';

/**
 * Kontrol aktuator kumbung terpilih dalam tiga bagian: Manual (toggle langsung), Jadwal
 * (jam tertentu/berulang), dan Otomatis (aturan sensor, dijalankan gateway). Satu cara kerja aktif per
 * aktuator; toggle manual menjadi override sementara saat jadwal/otomatis aktif.
 */
export default function ActuatorControlPanel() {
  const { kumbung } = useFarmContext();
  const { gateways, commands, loading, error } = useIot();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const items = useMemo(() => gateways.flatMap(gateway => gateway.actuators
    .filter(actuator => !kumbung || actuator.kumbungId === kumbung.id)
    .map(actuator => ({ actuator, gateway }))), [gateways, kumbung]);

  if (loading) {
    return <Card><CardContent className="flex items-center justify-center gap-2 py-8 text-muted-foreground"><Loader2 className="animate-spin" size={18} />Memuat aktuator…</CardContent></Card>;
  }
  if (error && !gateways.length) {
    return <Card><CardContent className="py-6 text-center text-red-600">Backend tidak dapat dihubungi: {error}</CardContent></Card>;
  }
  if (!items.length) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Belum ada aktuator {kumbung ? `di ${kumbung.name || kumbung.id}` : ''}. <Link to="/devices" className="underline underline-offset-2">Tambah gateway</Link> atau pindahkan aktuator ke kumbung ini.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <ManualControlSection items={items} commands={commands} now={now} />
      <ScheduleSection items={items} />
      <RuleSection items={items} />
    </div>
  );
}
