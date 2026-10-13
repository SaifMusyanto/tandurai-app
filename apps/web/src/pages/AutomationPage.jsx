
import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { 
  Power, 
  Droplets, 
  Fan, 
  Waves, 
  Wind,
  Play,
  Square,
  Lightbulb,
  TrendingUp,
  Calendar,
  Leaf
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ref, onValue, set } from 'firebase/database';
import { db } from '../firebase';
import { useFarmContext } from '@/contexts/FarmContext';
import { readTelemetryHistory } from '@/lib/telemetryService';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HARVEST_CONFIG = {
  mushroomType: 'Oyster Mushroom',
  fruitingStartDate: '',
  standardDays: '10',
};


const scoreRange = (value, min, max, tolerance) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric >= min && numeric <= max) return 100;
  const distance = numeric < min ? min - numeric : numeric - max;
  return Math.max(0, Math.round(100 - (distance / tolerance) * 100));
};

const formatDate = (date) => date.toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export default function AutomationPage() {
  const [automationEnabled, setAutomationEnabled] = useState(true);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [deviceStates, setDeviceStates] = useState({
    spray: false,
    fan: false,
    pump: false,
    humidifier: false
  });
  const [activityLog, setActivityLog] = useState([]);

  const [history, setHistory] = useState([]);
  const [harvestConfig, setHarvestConfig] = useState(DEFAULT_HARVEST_CONFIG);
  const [isSavingHarvest, setIsSavingHarvest] = useState(false);

  const { target } = useFarmContext();
  const { kumbungId: targetKumbungId, sensorId: targetSensorId } = target;

  useEffect(() => {
    setHistory([]);
    if (!targetKumbungId || !targetSensorId) return;
    const endAt = Date.now();
    readTelemetryHistory(db, {
      kumbungId: targetKumbungId,
      sensorId: targetSensorId,
      startAt: endAt - DAY_MS,
      endAt,
      maxPoints: 200,
    }).then(setHistory).catch(error => console.error('Gagal membaca histori telemetry:', error));
  }, [targetKumbungId, targetSensorId]);

  useEffect(() => {
    const configRef = ref(db, 'tumbara/harvest/config');
    return onValue(configRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const value = snapshot.val();
      setHarvestConfig({
        mushroomType: value.mushroomType || DEFAULT_HARVEST_CONFIG.mushroomType,
        fruitingStartDate: value.fruitingStartDate || '',
        standardDays: String(value.standardDays || DEFAULT_HARVEST_CONFIG.standardDays),
      });
    });
  }, []);

  const recentHistory = useMemo(() => {
    const cutoff = Date.now() - DAY_MS;
    return history.filter(item => item.timestamp >= cutoff);
  }, [history]);

  const healthScore = useMemo(() => {
    const scores = recentHistory.flatMap(item => [
      scoreRange(item.temperature, 24, 30, 6),
      scoreRange(item.humidity, 70, 90, 30),
      scoreRange(item.co2, 400, 800, 800),
    ]).filter(score => score !== null);
    if (!scores.length) return 0;
    return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  }, [recentHistory]);

  const harvestPrediction = useMemo(() => {
    const standardDays = Number(harvestConfig.standardDays);
    if (!harvestConfig.fruitingStartDate || !Number.isFinite(standardDays) || standardDays < 1) {
      return { available: false, readiness: 0, delayDays: 0, confidence: 'Unavailable' };
    }

    const startDate = new Date(`${harvestConfig.fruitingStartDate}T00:00:00`);
    if (Number.isNaN(startDate.getTime())) {
      return { available: false, readiness: 0, delayDays: 0, confidence: 'Unavailable' };
    }

    const delayDays = healthScore >= 85 ? 0 : healthScore >= 70 ? 1 : healthScore >= 55 ? 2 : 3;
    const adjustedDays = standardDays + delayDays;
    const centerDate = new Date(startDate.getTime() + adjustedDays * DAY_MS);
    const rangeStart = new Date(centerDate.getTime() - DAY_MS);
    const rangeEnd = new Date(centerDate.getTime() + DAY_MS);
    const elapsedDays = Math.max(0, (Date.now() - startDate.getTime()) / DAY_MS);
    const timeProgress = Math.min(100, (elapsedDays / adjustedDays) * 100);
    const environmentFactor = recentHistory.length ? 0.85 + (healthScore / 100) * 0.15 : 0.85;
    const readiness = Math.min(100, Math.round(timeProgress * environmentFactor));
    const confidence = recentHistory.length >= 60 ? 'High' : recentHistory.length >= 15 ? 'Moderate' : 'Low';
    const trend = healthScore >= 85 ? 'On schedule' : healthScore >= 70 ? 'Monitor closely' : 'Potential delay';

    return {
      available: true,
      readiness,
      delayDays,
      confidence,
      trend,
      dateRange: `${formatDate(rangeStart)} – ${formatDate(rangeEnd)}`,
    };
  }, [harvestConfig, healthScore, recentHistory.length]);

  const handleSaveHarvestConfig = async () => {
    const standardDays = Number(harvestConfig.standardDays);
    if (!harvestConfig.fruitingStartDate || !Number.isFinite(standardDays) || standardDays < 1) {
      toast.error('Enter a valid fruiting start date and SOP duration.');
      return;
    }
    setIsSavingHarvest(true);
    try {
      await set(ref(db, 'tumbara/harvest/config'), {
        mushroomType: harvestConfig.mushroomType.trim() || 'Mushroom',
        fruitingStartDate: harvestConfig.fruitingStartDate,
        standardDays,
        updatedAt: Date.now(),
      });
      toast.success('Harvest estimation profile saved.');
    } catch (error) {
      console.error(error);
      toast.error('Unable to save the harvest estimation profile.');
    } finally {
      setIsSavingHarvest(false);
    }
  };

  const handleDeviceControl = (device, action, isCritical = false) => {
    if (isCritical) {
      setPendingAction({ device, action });
      setShowConfirmDialog(true);
    } else {
      executeAction(device, action);
    }
  };

  const executeAction = (device, action) => {
    const newState = action === 'start' || action === 'on';
    setDeviceStates(prev => ({ ...prev, [device]: newState }));
    
    const actionText = `${device.charAt(0).toUpperCase() + device.slice(1)} ${action === 'start' || action === 'on' ? 'activated' : 'stopped'}`;
    setActivityLog(prev => [
      { action: actionText, time: 'Just now', type: device },
      ...prev.slice(0, 4)
    ]);
    
    toast.success(actionText);
    setShowConfirmDialog(false);
    setPendingAction(null);
  };

  const recommendations = useMemo(() => {
    const latest = recentHistory.at(-1) || history.at(-1);
    if (!latest) {
      return [{
        title: 'Awaiting sensor telemetry',
        description: 'Operational recommendations will be evaluated when historical sensor data becomes available.',
        priority: 'medium',
        icon: Lightbulb,
      }];
    }

    const result = [];
    if (Number.isFinite(latest.humidity)) {
      result.push(latest.humidity < 60
        ? { title: 'Critical humidity deficit', description: `Humidity is ${latest.humidity}%, below the critical threshold. Initiate misting and verify the water supply.`, priority: 'high', icon: Droplets }
        : latest.humidity < 70
          ? { title: 'Humidity adjustment advised', description: `Humidity is ${latest.humidity}%, below the target range. Consider initiating a misting cycle.`, priority: 'medium', icon: Droplets }
          : { title: 'Humidity within target', description: `Humidity is ${latest.humidity}% and remains within the supported operating range.`, priority: 'low', icon: Droplets });
    }
    if (Number.isFinite(latest.temperature)) {
      result.push(latest.temperature > 33
        ? { title: 'Critical thermal condition', description: `Temperature is ${latest.temperature}°C. Initiate ventilation and cooling immediately.`, priority: 'high', icon: TrendingUp }
        : latest.temperature > 30
          ? { title: 'Temperature above target', description: `Temperature is ${latest.temperature}°C. Increased air circulation is recommended.`, priority: 'medium', icon: TrendingUp }
          : { title: 'Temperature within target', description: `Temperature is ${latest.temperature}°C and remains within the target range.`, priority: 'low', icon: TrendingUp });
    }
    if (Number.isFinite(latest.co2)) {
      result.push(latest.co2 > 1200
        ? { title: 'Critical CO₂ concentration', description: `CO₂ is ${latest.co2} ppm. Immediate ventilation is required.`, priority: 'high', icon: Wind }
        : latest.co2 > 800
          ? { title: 'Elevated CO₂ concentration', description: `CO₂ is ${latest.co2} ppm and exceeds the warning threshold. Increase ventilation.`, priority: 'medium', icon: Wind }
          : { title: 'CO₂ within target', description: `CO₂ is ${latest.co2} ppm and remains below the warning threshold.`, priority: 'low', icon: Wind });
    }
    return result;
  }, [history, recentHistory]);

  const priorityColors = {
    high: 'bg-red-500/10 text-red-600 border-red-500/20',
    medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
    low: 'bg-green-500/10 text-green-600 border-green-500/20'
  };

  const getScoreColor = (score) => {
    if (score >= 70) return 'text-green-500';
    if (score >= 40) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <>
      <Helmet>
        <title>Automation Control - Tumbara</title>
        <meta name="description" content="Manage automated systems and manual controls for your smart farm" />
      </Helmet>

      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold mb-2">Automation & Decision Intelligence</h1>
          <p className="text-muted-foreground">Sensor-driven control policies, operational recommendations, and harvest-window analytics</p>
        </div>

        {/* Automatic Misting System */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Droplets className="text-primary" size={24} />
                    Adaptive Misting Controller
                  </CardTitle>
                  <CardDescription>Rule-driven humidity response profile · interface prototype</CardDescription>
                </div>
                <Switch
                  checked={automationEnabled}
                  onCheckedChange={setAutomationEnabled}
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Simulation Policy</p>
                    <Badge variant="outline" className={automationEnabled ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'bg-gray-500/10 text-gray-600 border-gray-500/20'}>
                      {automationEnabled ? 'Armed' : 'Disabled'}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Hardware Link</p>
                    <p className="font-medium">Awaiting ESP32 command acknowledgement</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Execution Mode</p>
                    <p className="font-medium">Interface simulation</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Proposed Control Policy</p>
                    <div className="bg-muted rounded-lg p-4">
                      <p className="text-sm font-medium mb-2">Humidity-based trigger</p>
                      <p className="text-sm text-muted-foreground">
                        Trigger misting when humidity remains below 75% for more than five minutes
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Decision Logic</p>
                    <p className="text-sm">
                      The deterministic policy evaluates sustained humidity conditions and proposes misting cycles to maintain the 75–85% operating range.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Manual Control Center */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Power className="text-primary" size={24} />
                Device Command Simulator
              </CardTitle>
              <CardDescription>Preview device commands before ESP32 and relay acknowledgement is integrated</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Controls */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                    <div className="flex items-center gap-3">
                      <Droplets className="text-primary" size={20} />
                      <div>
                        <p className="font-medium">Spray System</p>
                        <p className="text-sm text-muted-foreground">
                          {deviceStates.spray ? 'Running' : 'Stopped'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={deviceStates.spray ? 'default' : 'outline'}
                        onClick={() => handleDeviceControl('spray', 'start', true)}
                        disabled={deviceStates.spray}
                        className="transition-all duration-200"
                      >
                        <Play size={16} className="mr-1" />
                        Start
                      </Button>
                      <Button
                        size="sm"
                        variant={!deviceStates.spray ? 'default' : 'outline'}
                        onClick={() => handleDeviceControl('spray', 'stop', true)}
                        disabled={!deviceStates.spray}
                        className="transition-all duration-200"
                      >
                        <Square size={16} className="mr-1" />
                        Stop
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                    <div className="flex items-center gap-3">
                      <Fan className="text-primary" size={20} />
                      <div>
                        <p className="font-medium">Ventilation Fan</p>
                        <p className="text-sm text-muted-foreground">
                          {deviceStates.fan ? 'Running' : 'Stopped'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={deviceStates.fan ? 'default' : 'outline'}
                        onClick={() => handleDeviceControl('fan', 'on')}
                        disabled={deviceStates.fan}
                        className="transition-all duration-200"
                      >
                        ON
                      </Button>
                      <Button
                        size="sm"
                        variant={!deviceStates.fan ? 'default' : 'outline'}
                        onClick={() => handleDeviceControl('fan', 'off')}
                        disabled={!deviceStates.fan}
                        className="transition-all duration-200"
                      >
                        OFF
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                    <div className="flex items-center gap-3">
                      <Waves className="text-primary" size={20} />
                      <div>
                        <p className="font-medium">Water Pump</p>
                        <p className="text-sm text-muted-foreground">
                          {deviceStates.pump ? 'Running' : 'Stopped'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={deviceStates.pump ? 'default' : 'outline'}
                        onClick={() => handleDeviceControl('pump', 'on', true)}
                        disabled={deviceStates.pump}
                        className="transition-all duration-200"
                      >
                        ON
                      </Button>
                      <Button
                        size="sm"
                        variant={!deviceStates.pump ? 'default' : 'outline'}
                        onClick={() => handleDeviceControl('pump', 'off', true)}
                        disabled={!deviceStates.pump}
                        className="transition-all duration-200"
                      >
                        OFF
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                    <div className="flex items-center gap-3">
                      <Wind className="text-primary" size={20} />
                      <div>
                        <p className="font-medium">Humidifier</p>
                        <p className="text-sm text-muted-foreground">
                          {deviceStates.humidifier ? 'Running' : 'Stopped'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={deviceStates.humidifier ? 'default' : 'outline'}
                        onClick={() => handleDeviceControl('humidifier', 'on')}
                        disabled={deviceStates.humidifier}
                        className="transition-all duration-200"
                      >
                        ON
                      </Button>
                      <Button
                        size="sm"
                        variant={!deviceStates.humidifier ? 'default' : 'outline'}
                        onClick={() => handleDeviceControl('humidifier', 'off')}
                        disabled={!deviceStates.humidifier}
                        className="transition-all duration-200"
                      >
                        OFF
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Activity Log */}
                <div>
                  <h3 className="font-semibold mb-3">Simulation Activity</h3>
                  <div className="space-y-2">
                    {!activityLog.length && (
                      <div className="p-4 bg-muted rounded-lg text-sm text-muted-foreground">
                        No simulated commands have been issued in this session.
                      </div>
                    )}
                    {activityLog.map((log, index) => (
                      <div key={index} className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                        <div className="w-2 h-2 rounded-full bg-primary mt-2" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{log.action}</p>
                          <p className="text-xs text-muted-foreground">{log.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Rule-based recommendations & harvest estimate */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sensor Recommendations */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="lg:col-span-2"
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="text-primary" size={24} />
                  Environmental Decision Support
                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Deterministic Engine</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recommendations.map((rec, index) => {
                    const Icon = rec.icon;
                    return (
                      <div key={index} className="flex items-start gap-3 p-4 bg-muted rounded-lg">
                        <Icon className="text-primary mt-1" size={20} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium">{rec.title}</p>
                            <Badge variant="outline" className={priorityColors[rec.priority]}>
                              {rec.priority}
                            </Badge>
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

          {/* Scores */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="space-y-6"
          >
            {/* Environmental Health Score */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Environmental Suitability Index</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center">
                  <div className="relative w-32 h-32 mb-4">
                    <svg className="w-full h-full -rotate-90">
                      <circle
                        cx="64"
                        cy="64"
                        r="56"
                        stroke="hsl(var(--muted))"
                        strokeWidth="8"
                        fill="none"
                      />
                      <circle
                        cx="64"
                        cy="64"
                        r="56"
                        stroke="hsl(var(--primary))"
                        strokeWidth="8"
                        fill="none"
                        strokeDasharray={`${2 * Math.PI * 56}`}
                        strokeDashoffset={`${2 * Math.PI * 56 * (1 - healthScore / 100)}`}
                        className="transition-all duration-1000"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-3xl font-bold ${getScoreColor(healthScore)}`}>
                        {healthScore}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Derived from {recentHistory.length} telemetry samples collected over the last 24 hours
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Harvest Readiness */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Leaf className="text-primary" size={20} />
                  SOP-Adjusted Harvest Window
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="mushroomType">Mushroom variety</Label>
                    <Input
                      id="mushroomType"
                      value={harvestConfig.mushroomType}
                      onChange={(event) => setHarvestConfig(prev => ({ ...prev, mushroomType: event.target.value }))}
                      placeholder="Example: Oyster Mushroom"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fruitingStartDate">Fruiting phase start date</Label>
                    <Input
                      id="fruitingStartDate"
                      type="date"
                      value={harvestConfig.fruitingStartDate}
                      onChange={(event) => setHarvestConfig(prev => ({ ...prev, fruitingStartDate: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="standardDays">SOP duration to harvest (days)</Label>
                    <Input
                      id="standardDays"
                      type="number"
                      min="1"
                      max="90"
                      value={harvestConfig.standardDays}
                      onChange={(event) => setHarvestConfig(prev => ({ ...prev, standardDays: event.target.value }))}
                    />
                  </div>
                  <Button className="w-full" onClick={handleSaveHarvestConfig} disabled={isSavingHarvest}>
                    {isSavingHarvest ? 'Saving…' : 'Save Profile & Recalculate'}
                  </Button>
                </div>

                <div className="border-t border-border pt-4 space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">Projected maturity</span>
                      <span className="text-2xl font-bold text-primary">{harvestPrediction.readiness}%</span>
                    </div>
                    <Progress value={harvestPrediction.readiness} className="h-2" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Estimated harvest window</p>
                    <p className="font-medium flex items-start gap-2">
                      <Calendar size={16} className="mt-0.5 shrink-0" />
                      {harvestPrediction.available ? harvestPrediction.dateRange : 'Configure the fruiting profile to calculate an estimate'}
                    </p>
                  </div>
                  {harvestPrediction.available && (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg bg-muted p-3">
                        <p className="text-xs text-muted-foreground">Environmental adjustment</p>
                        <p className="font-semibold">+{harvestPrediction.delayDays} days</p>
                      </div>
                      <div className="rounded-lg bg-muted p-3">
                        <p className="text-xs text-muted-foreground">Data coverage</p>
                        <p className="font-semibold">{harvestPrediction.confidence}</p>
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Schedule outlook</p>
                    <Badge variant="outline" className={healthScore >= 85 ? 'bg-green-500/10 text-green-600 border-green-500/20' : healthScore >= 70 ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' : 'bg-red-500/10 text-red-600 border-red-500/20'}>
                      <TrendingUp size={14} className="mr-1" />
                      {harvestPrediction.available ? harvestPrediction.trend : 'Awaiting configuration'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Deterministic estimate based on fruiting-phase age, SOP duration, and 24-hour temperature, humidity, and CO₂ suitability.
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm action</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to {pendingAction?.action} the {pendingAction?.device}? This action will override automatic controls.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingAction && executeAction(pendingAction.device, pendingAction.action)}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
