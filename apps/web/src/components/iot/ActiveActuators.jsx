import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Power } from 'lucide-react';
import { useFarmContext } from '@/contexts/FarmContext';
import { useIot } from '@/contexts/IotContext';
import { describeTrigger } from '@/lib/iot';

/** Aktuator yang sedang menyala di farm terpilih (opsional: hanya kumbung tertentu). */
function useActiveActuators(kumbungId = null) {
  const { gateways } = useIot();
  const { farm } = useFarmContext();
  return useMemo(() => gateways
    .filter(gateway => gateway.farmId === farm?.id)
    .flatMap(gateway => gateway.actuators)
    .filter(actuator => actuator.state === 'on' && (!kumbungId || actuator.kumbungId === kumbungId)), [gateways, farm?.id, kumbungId]);
}

/** Navbar: jumlah aktuator menyala (berkedip), klik ke halaman Kontrol. Tidak tampil bila semua mati. */
export function ActiveActuatorsBadge() {
  const active = useActiveActuators();
  if (!active.length) return null;
  return (
    <Link to="/automation" title={active.map(actuator => `${actuator.name}: ${describeTrigger(actuator)}`).join('\n')}
      className="flex items-center gap-1.5 rounded-full bg-green-500/15 px-3 py-1.5 text-xs font-semibold text-green-700 dark:text-green-400 hover:bg-green-500/25">
      <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" aria-hidden />
      <Power size={13} aria-hidden />
      {active.length} aktuator menyala
    </Link>
  );
}

/** Strip di halaman (mis. Monitoring): daftar aktuator kumbung yang sedang menyala beserta alasannya. */
export function ActiveActuatorsStrip({ kumbungId }) {
  const active = useActiveActuators(kumbungId);
  if (!active.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5 font-semibold text-green-700 dark:text-green-400">
        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" aria-hidden />Sedang menyala:
      </span>
      {active.map(actuator => (
        <span key={actuator.id} className="rounded-md bg-background/70 px-2 py-0.5 text-xs">
          <b>{actuator.name}</b> · {describeTrigger(actuator)}
        </span>
      ))}
      <Link to="/automation" className="ml-auto text-xs underline underline-offset-2">Kontrol</Link>
    </div>
  );
}
