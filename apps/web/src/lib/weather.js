// Ramalan cuaca luar kumbung (Open-Meteo, tanpa API key). Lokasi diatur user di
// Pengaturan → Umum → Lokasi Ramalan Cuaca dan disimpan di pengaturan user (`weatherLocation`).

export const DEFAULT_WEATHER_LOCATION = { name: 'Sidoarjo, Jawa Timur', latitude: -7.4478, longitude: 112.7183 };

const CONDITIONS = {
  0: ['Cerah', '☀️'], 1: ['Cerah Berawan', '🌤️'], 2: ['Berawan Sebagian', '⛅'], 3: ['Berawan', '☁️'],
  45: ['Kabut', '🌫️'], 48: ['Kabut', '🌫️'],
  51: ['Gerimis Ringan', '🌦️'], 53: ['Gerimis', '🌦️'], 55: ['Gerimis Lebat', '🌦️'],
  61: ['Hujan Ringan', '🌧️'], 63: ['Hujan', '🌧️'], 65: ['Hujan Lebat', '🌧️'],
  80: ['Hujan Lokal', '🌦️'], 81: ['Hujan Lokal', '🌧️'], 82: ['Hujan Deras', '🌧️'],
  95: ['Hujan Petir', '⛈️'], 96: ['Hujan Petir', '⛈️'], 99: ['Hujan Petir', '⛈️'],
};

export const weatherCondition = code => CONDITIONS[code]?.[0] || 'Berawan';
export const weatherEmoji = code => CONDITIONS[code]?.[1] || '☁️';
export const isStormCode = code => code >= 95;

/** Lokasi valid dari pengaturan user, atau lokasi bawaan. */
export function resolveWeatherLocation(settings) {
  const location = settings?.weatherLocation;
  if (location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) return location;
  return DEFAULT_WEATHER_LOCATION;
}

/**
 * Cuaca sekarang + ramalan per `stepHours` jam untuk `hours` jam ke depan.
 * Jam dibaca dari zona waktu lokasi (timezone=auto) sehingga tidak bergantung jam browser.
 */
export async function fetchWeather(location, { hours = 24, stepHours = 3 } = {}) {
  const params = new URLSearchParams({
    latitude: location.latitude, longitude: location.longitude, timezone: 'auto', forecast_days: '2',
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error('Gagal mengambil data cuaca.');
  const data = await response.json();

  const start = Math.max(0, data.hourly.time.findIndex(time => time.slice(0, 13) === data.current.time.slice(0, 13)));
  const hourly = [];
  for (let offset = 0; offset <= hours - stepHours; offset += stepHours) {
    const index = start + offset;
    if (index >= data.hourly.time.length) break;
    const code = data.hourly.weather_code[index];
    hourly.push({
      time: offset === 0 ? 'Sekarang' : data.hourly.time[index].slice(11, 16),
      temp: Math.round(data.hourly.temperature_2m[index]),
      rain: data.hourly.precipitation_probability?.[index] ?? null,
      code, condition: weatherCondition(code),
    });
  }

  const code = data.current.weather_code;
  return {
    current: {
      temp: Math.round(data.current.temperature_2m),
      feelsLike: Math.round(data.current.apparent_temperature),
      humidity: data.current.relative_humidity_2m,
      windSpeed: Math.round(data.current.wind_speed_10m),
      code, condition: weatherCondition(code),
    },
    hourly,
  };
}

/** Cari kota/kecamatan untuk dipilih sebagai lokasi ramalan. */
export async function searchWeatherLocations(query) {
  const params = new URLSearchParams({ name: query, count: '6', language: 'id', format: 'json' });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!response.ok) throw new Error('Pencarian lokasi gagal.');
  const data = await response.json();
  return (data.results || []).map(item => ({
    name: [item.name, item.admin1].filter(Boolean).join(', '),
    detail: [item.admin2, item.admin1, item.country].filter(Boolean).join(', '),
    latitude: item.latitude,
    longitude: item.longitude,
  }));
}
