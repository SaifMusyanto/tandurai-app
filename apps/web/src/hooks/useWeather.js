import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fetchWeather, resolveWeatherLocation, DEFAULT_WEATHER_LOCATION } from '@/lib/weather';

const REFRESH_MS = 15 * 60 * 1000;

/** Cuaca luar untuk lokasi di pengaturan user; diperbarui tiap 15 menit. */
export function useWeather() {
  const [location, setLocation] = useState(null);
  const [state, setState] = useState({ current: null, hourly: [], loading: true, error: null });

  useEffect(() => {
    let active = true;
    api.settings()
      .then(settings => active && setLocation(resolveWeatherLocation(settings)))
      .catch(() => active && setLocation(DEFAULT_WEATHER_LOCATION));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!location) return undefined;
    let active = true;
    const load = () => fetchWeather(location)
      .then(result => active && setState({ ...result, loading: false, error: null }))
      .catch(error => active && setState(current => ({ ...current, loading: false, error })));
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { active = false; clearInterval(timer); };
  }, [location]);

  return { ...state, location: location || DEFAULT_WEATHER_LOCATION };
}
