import React, { useState } from 'react';
import { Hand, Loader2, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useIot } from '@/contexts/IotContext';
import { MODE_LABEL, commandDisplay, describeTrigger, formatDuration, secondsUntilOff } from '@/lib/iot';

function ManualRow({ actuator, gateway, command, now }) {
  const { sendCommand } = useIot();
  const [busy, setBusy] = useState(false);
  const display = commandDisplay(command, gateway.online);
  const waiting = busy || display?.kind === 'pending';
  const isOn = actuator.state === 'on';
  const remaining = secondsUntilOff(actuator, now);
  const automated = actuator.mode !== 'manual';

  const toggle = async next => {
    setBusy(true);
    try {
      // Nyala manual selalu dibatasi durasi maksimal aktuator (pengaman relay), lalu mati sendiri.
      await sendCommand(actuator.id, next ? 'on' : 'off', actuator.maxRunSec);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`flex items-center justify-between gap-3 py-3 px-2 -mx-2 rounded-lg ${isOn ? 'bg-green-500/10' : ''}`}>
      <div className="min-w-0">
        <p className="font-medium flex items-center gap-2 flex-wrap">
          {isOn && <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" aria-hidden />}
          {actuator.name}
          {automated && <Badge variant="outline" className="text-[10px]">{MODE_LABEL[actuator.mode]} aktif</Badge>}
          {!gateway.online && <Badge variant="outline" className="text-[10px] text-red-600 border-red-500/30"><WifiOff size={10} className="mr-1" />offline</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {isOn
            ? `Menyala · ${describeTrigger(actuator)}${remaining !== null ? ` · mati paling lambat dalam ${formatDuration(remaining)}` : ''}`
            : actuator.state === 'off' ? 'Mati' : actuator.state === 'fault' ? 'Gangguan perangkat' : 'Belum ada status'}
          {automated && ` · menyalakan manual = ambil alih sementara, ${MODE_LABEL[actuator.mode].toLowerCase()} lanjut setelah mati`}
        </p>
        {display && display.kind !== 'success' && <p className={`text-xs ${display.kind === 'pending' ? 'text-yellow-700 dark:text-yellow-400' : 'text-red-600'}`}>{display.label}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {waiting && <Loader2 size={14} className="animate-spin text-muted-foreground" aria-label="Menunggu gateway" />}
        <Switch checked={isOn} onCheckedChange={toggle} disabled={waiting || !gateway.online} aria-label={`Nyalakan ${actuator.name}`} />
      </div>
    </li>
  );
}

/** Bagian 1 — nyalakan/matikan aktuator langsung. */
export default function ManualControlSection({ items, commands, now }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2"><Hand size={20} className="text-primary" />Manual</CardTitle>
        <CardDescription>Nyalakan atau matikan langsung. Demi keamanan, aktuator mati sendiri setelah batas maksimalnya.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map(({ actuator, gateway }) => (
            <ManualRow key={actuator.id} actuator={actuator} gateway={gateway} command={commands[actuator.id]} now={now} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
