import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu,
  Thermometer,
  Droplets,
  Wind,
  Edit,
  Trash2,
  Wifi,
  WifiOff,
  Plus,
  X,
  AlertTriangle,
  Tag,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* ─── Modal Overlay ─────────────────────────────────────────────────── */
function Modal({ open, onClose, children }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <div
              className="bg-background border rounded-2xl shadow-2xl w-full max-w-sm p-6 relative"
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ─── Edit Modal ─────────────────────────────────────────────────────── */
function EditModal({ open, device, onConfirm, onClose }) {
  const [name, setName] = useState(device?.name ?? '');

  // sync when device changes (e.g. open different card)
  React.useEffect(() => {
    if (device) setName(device.name);
  }, [device]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) onConfirm(name.trim());
  };

  return (
    <Modal open={open} onClose={onClose}>
      {/* Close btn */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X size={18} />
      </button>

      {/* Icon */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Tag size={20} className="text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight">Edit Device</h2>
          <p className="text-xs text-muted-foreground">Update the device name</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="device-name">Device Name</Label>
          <Input
            id="device-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter device name…"
            autoFocus
            className="rounded-xl"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            className="flex-1 rounded-xl"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="flex-1 rounded-xl"
            disabled={!name.trim()}
          >
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Delete Confirm Modal ───────────────────────────────────────────── */
function DeleteModal({ open, device, onConfirm, onClose }) {
  return (
    <Modal open={open} onClose={onClose}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X size={18} />
      </button>

      {/* Warning icon */}
      <div className="flex flex-col items-center text-center gap-3 mb-5">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center">
          <AlertTriangle size={28} className="text-red-500" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Remove Device?</h2>
          <p className="text-sm text-muted-foreground mt-1">
            <span className="font-medium text-foreground">{device?.name}</span> will be
            permanently removed from your farm.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1 rounded-xl"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          className="flex-1 rounded-xl"
          onClick={onConfirm}
        >
          <Trash2 size={15} className="mr-1.5" />
          Remove
        </Button>
      </div>
    </Modal>
  );
}

/* ─── Add Modal ──────────────────────────────────────────────────────── */
function AddModal({ open, onConfirm, onClose }) {
  const [name, setName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      onConfirm(name.trim());
      setName('');
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X size={18} />
      </button>

      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Plus size={20} className="text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight">Add New Device</h2>
          <p className="text-xs text-muted-foreground">Connect a new sensor or controller</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="new-device-name">Device Name</Label>
          <Input
            id="new-device-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Soil Moisture Sensor…"
            autoFocus
            className="rounded-xl"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            className="flex-1 rounded-xl"
            onClick={() => { onClose(); setName(''); }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="flex-1 rounded-xl"
            disabled={!name.trim()}
          >
            <Plus size={15} className="mr-1.5" />
            Add Device
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Initial Data ───────────────────────────────────────────────────── */
const initialDevices = [
  { id: 1, name: 'ESP32 Controller', icon: Cpu,        status: 'online',  lastUpdate: '2 seconds ago', health: 98, signal: 94 },
  { id: 2, name: 'Temperature Sensor', icon: Thermometer, status: 'online', lastUpdate: '5 seconds ago', health: 96, signal: 89 },
  { id: 3, name: 'Humidity Sensor',  icon: Droplets,   status: 'online',  lastUpdate: '3 seconds ago', health: 97, signal: 92 },
  { id: 4, name: 'CO₂ Sensor',       icon: Wind,       status: 'online',  lastUpdate: '7 seconds ago', health: 93, signal: 87 },
];

/* ─── Main Page ──────────────────────────────────────────────────────── */
export default function DevicesPage() {
  const [deviceList, setDeviceList] = useState(initialDevices);

  // Modal state
  const [addOpen,    setAddOpen]    = useState(false);
  const [editTarget, setEditTarget] = useState(null); // device object | null
  const [deleteTarget, setDeleteTarget] = useState(null);

  /* helpers */
  const getHealthColor = (h) =>
    h >= 90 ? 'text-green-500' : h >= 70 ? 'text-yellow-500' : 'text-red-500';

  const getSignalBars = (s) =>
    s >= 80 ? 4 : s >= 60 ? 3 : s >= 40 ? 2 : s > 0 ? 1 : 0;

  /* actions */
  const confirmAdd = (name) => {
    setDeviceList([
      ...deviceList,
      { id: Date.now(), name, icon: Cpu, status: 'online', lastUpdate: 'Just now', health: 100, signal: 100 },
    ]);
    setAddOpen(false);
  };

  const confirmEdit = (newName) => {
    setDeviceList(deviceList.map((d) =>
      d.id === editTarget.id ? { ...d, name: newName } : d
    ));
    setEditTarget(null);
  };

  const confirmDelete = () => {
    setDeviceList(deviceList.filter((d) => d.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  return (
    <>
      <Helmet><title>Devices - TUMBARA</title></Helmet>

      {/* ── Modals ── */}
      <AddModal
        open={addOpen}
        onConfirm={confirmAdd}
        onClose={() => setAddOpen(false)}
      />
      <EditModal
        open={!!editTarget}
        device={editTarget}
        onConfirm={confirmEdit}
        onClose={() => setEditTarget(null)}
      />
      <DeleteModal
        open={!!deleteTarget}
        device={deleteTarget}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />

      <div className="space-y-6">

        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Connected Devices</h1>
            <p className="text-muted-foreground">Monitor and manage all farm devices and sensors</p>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <div>Total: <span className="font-bold ml-1">{deviceList.length}</span></div>
            <div>Online: <span className="font-bold text-green-500 ml-1">{deviceList.filter(d => d.status === 'online').length}</span></div>
            <div>Offline: <span className="font-bold text-red-500 ml-1">{deviceList.filter(d => d.status === 'offline').length}</span></div>
            <Button onClick={() => setAddOpen(true)}>
              <Plus size={16} className="mr-2" />
              Add Device
            </Button>
          </div>
        </div>

        {/* ── Grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch">
          {deviceList.map((device, index) => {
            const Icon = device.icon;
            const signalBars = getSignalBars(device.signal);

            return (
              <motion.div
                key={device.id}
                className="h-full"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: index * 0.05 }}
              >
                <Card className="hover:shadow-lg transition-all hover:-translate-y-1 h-full flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon size={20} className="text-primary" />
                      </div>
                      {/* Fixed min-height so header row is always same size even if name is short */}
                      <div className="min-w-0 min-h-[52px] flex flex-col justify-center">
                        <CardTitle className="text-base leading-snug line-clamp-1">
                          {device.name}
                        </CardTitle>
                        <Badge
                          variant="outline"
                          className={
                            device.status === 'online'
                              ? 'bg-green-500/10 text-green-600 mt-1 w-fit'
                              : 'bg-red-500/10 text-red-600 mt-1 w-fit'
                          }
                        >
                          {device.status === 'online'
                            ? <Wifi size={12} className="mr-1" />
                            : <WifiOff size={12} className="mr-1" />}
                          {device.status}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4 flex flex-col flex-1 pt-0">
                    <div>
                      <p className="text-xs text-muted-foreground">Last Update</p>
                      <p className="font-medium">{device.lastUpdate}</p>
                    </div>

                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Device Health</span>
                        <span className={`font-bold ${getHealthColor(device.health)}`}>{device.health}%</span>
                      </div>
                      <Progress value={device.health} />
                    </div>

                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-xs text-muted-foreground">Signal Quality</span>
                        <div className="flex gap-1 items-end">
                          {[1, 2, 3, 4].map((bar) => (
                            <div
                              key={bar}
                              className={`w-1 rounded-sm ${bar <= signalBars ? 'bg-primary' : 'bg-muted'}`}
                              style={{ height: `${bar * 3 + 4}px` }}
                            />
                          ))}
                        </div>
                      </div>
                      <p className="font-medium">{device.signal}%</p>
                    </div>

                    <div className="flex gap-2 mt-auto pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => setEditTarget(device)}
                      >
                        <Edit size={14} className="mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-red-500 hover:text-red-600 hover:border-red-300"
                        onClick={() => setDeleteTarget(device)}
                      >
                        <Trash2 size={14} className="mr-1" />
                        Remove
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>
    </>
  );
}
