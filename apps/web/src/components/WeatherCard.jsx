import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CloudSun, MapPin } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { weatherEmoji } from '@/lib/weather';
import { cn } from '@/lib/utils';

/**
 * Kartu cuaca luar: kondisi sekarang (satu baris ringkas) + ramalan 24 jam per 3 jam dalam grid
 * yang selalu memenuhi lebar kartu (4 kolom di HP, 8 kolom di layar lebar) — tanpa ruang kosong.
 * `weather` = hasil useWeather().
 */
export default function WeatherCard({ weather, className }) {
  const { current, hourly, loading, error, location } = weather;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 py-3 border-b border-border/60">
        <CardTitle className="flex min-w-0 items-center gap-2 text-base font-bold">
          <CloudSun className="shrink-0 text-primary" size={18} />
          <span className="truncate">Cuaca Luar · {location.name}</span>
        </CardTitle>
        <Link to="/settings" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-primary">
          <MapPin size={12} />Ubah lokasi
        </Link>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary" />Memuat ramalan cuaca…
          </div>
        ) : !current ? (
          <div className="flex items-center justify-center gap-2 py-8 text-destructive">
            <AlertCircle size={16} /><p className="text-xs font-bold">{error?.message || 'Gagal memuat ramalan cuaca.'}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-primary/10 bg-gradient-to-br from-primary/5 to-transparent px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="select-none text-4xl leading-none">{weatherEmoji(current.code)}</span>
                <div>
                  <p className="text-2xl font-black leading-tight">{current.temp}°C</p>
                  <p className="text-xs font-semibold text-muted-foreground">{current.condition}</p>
                </div>
              </div>
              <dl className="grid flex-1 grid-cols-3 gap-3 text-xs sm:max-w-sm">
                <div><dt className="text-muted-foreground">Terasa</dt><dd className="font-bold">{current.feelsLike}°C</dd></div>
                <div><dt className="text-muted-foreground">Kelembapan</dt><dd className="font-bold">{current.humidity}%</dd></div>
                <div><dt className="text-muted-foreground">Angin</dt><dd className="font-bold">{current.windSpeed} km/j</dd></div>
              </dl>
            </div>

            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {hourly.map((slot, index) => (
                <div key={slot.time} title={slot.condition}
                  className={cn('flex flex-col items-center rounded-lg border px-1 py-2 text-center',
                    index === 0 ? 'border-primary bg-primary text-primary-foreground' : 'border-border/50 bg-muted/40')}>
                  <span className={cn('text-[10px] font-bold', index === 0 ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{slot.time}</span>
                  <span className="my-1 select-none text-xl leading-none">{weatherEmoji(slot.code)}</span>
                  <span className="text-sm font-black">{slot.temp}°</span>
                  {slot.rain !== null && (
                    <span className={cn('text-[10px]', index === 0 ? 'text-primary-foreground/80' : 'text-blue-600 dark:text-blue-400')}>💧{slot.rain}%</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
