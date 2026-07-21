
export const generateHistoricalData = (count = 50) => {
  const data = [];
  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    const timestamp = new Date(now.getTime() - i * 15 * 60000); // Every 15 mins
    const hour = timestamp.getHours();
    
    // Natural variations based on time of day
    const tempBase = hour > 6 && hour < 18 ? 28 : 22;
    const humBase = hour > 6 && hour < 18 ? 65 : 80;
    
    data.push({
      id: `hist-${i}`,
      timestamp: timestamp.toISOString(),
      temperature: +(tempBase + (Math.random() * 4 - 2)).toFixed(1),
      humidity: +(humBase + (Math.random() * 10 - 5)).toFixed(1),
      co2: Math.floor(400 + Math.random() * 150 + (hour > 8 && hour < 17 ? 100 : 0)),
      airQuality: +(90 + Math.random() * 8).toFixed(1),
      sprayStatus: Math.random() > 0.8 ? 'Active' : 'Inactive',
      fanStatus: Math.random() > 0.6 ? 'Active' : 'Inactive',
      weatherCondition: Math.random() > 0.7 ? 'Cloudy' : 'Clear'
    });
  }
  
  return data;
};

export const generateAnalyticsData = () => {
  return {
    dailyTrends: Array.from({ length: 24 }, (_, i) => ({
      time: `${i}:00`,
      temperature: +(24 + Math.sin(i / 4) * 5 + Math.random()).toFixed(1),
      humidity: +(75 + Math.cos(i / 4) * 10 + Math.random() * 2).toFixed(1),
      co2: Math.floor(450 + Math.sin(i / 3) * 50 + Math.random() * 20)
    })),
    weeklyPerformance: Array.from({ length: 7 }, (_, i) => ({
      day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
      efficiency: Math.floor(85 + Math.random() * 12),
      stability: Math.floor(80 + Math.random() * 15)
    })),
    monthlyStability: Array.from({ length: 30 }, (_, i) => ({
      day: i + 1,
      score: Math.floor(88 + Math.random() * 10)
    }))
  };
};
