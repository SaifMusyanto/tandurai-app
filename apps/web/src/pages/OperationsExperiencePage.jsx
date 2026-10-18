import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useSearchParams } from 'react-router-dom';
import { CircleHelp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { auth } from '../firebase';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFarmContext } from '@/contexts/FarmContext';
import { useIot } from '@/contexts/IotContext';
import { api } from '@/lib/api';
import { loadOperations } from '@/lib/operationsService';
import { RECAP_KINDS, todayJakarta } from '@/lib/operationsView';
import TodayPanel from '@/components/operations/TodayPanel';
import QuickActions, { QUICK_BAR_SPACE, VoidDialog } from '@/components/operations/QuickActions';
import ActivityDialog from '@/components/operations/ActivityDialog';
import HarvestDialog from '@/components/operations/HarvestDialog';
import BatchWizard from '@/components/operations/BatchWizard';
import BatchList from '@/components/operations/BatchList';
import { BatchCloseDialog, PhaseAdvanceDialog } from '@/components/operations/BatchDialogs';
import RecapPanel, { ALL_KUMBUNGS } from '@/components/operations/RecapPanel';
import FarmKumbungSettings from '@/components/operations/FarmKumbungSettings';

const GRADE_PCT = { A: 100, B: 0, C: 0, mixed: 50 };
const ALL_KIND_IDS = RECAP_KINDS.map(kind => kind.id);

/**
 * Operasional Kumbung — alat kerja harian petani untuk kumbung terpilih (ContextBar):
 * Hari Ini (batch, kondisi, catatan hari ini) · Batch · Rekap (filter + export) · Pengaturan (owner).
 * Tab & filter rekap disimpan di URL agar bisa dibagikan.
 */
export default function OperationsExperiencePage() {
  const { farm, kumbung, kumbungs, isOwner, loading: contextLoading, refreshKumbungs, refreshProfile, setKumbungId } = useFarmContext();
  const { subscribe } = useIot();
  const uid = auth.currentUser?.uid;
  const [searchParams, setSearchParams] = useSearchParams();

  const [ops, setOps] = useState({ batches: [], harvestEvents: [] });
  const [opsLoading, setOpsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [today, setToday] = useState(null);
  const [batchHarvestKg, setBatchHarvestKg] = useState(null);

  // Dialog: { type: 'harvest'|'care'|'problem'|'batch'|'advance'|'close'|'void', ... }
  const [dialog, setDialog] = useState(null);
  const closeDialog = () => setDialog(null);

  const refresh = useCallback(() => setRefreshKey(key => key + 1), []);

  useEffect(() => {
    let active = true;
    loadOperations()
      .then(result => active && setOps(result))
      .catch(error => active && toast.error(error.message || 'Data kumbung belum dapat dimuat'))
      .finally(() => active && setOpsLoading(false));
    return () => { active = false; };
  }, [refreshKey]);

  // Perubahan dari anggota farm lain (SSE `changed`) → muat ulang.
  useEffect(() => subscribe('changed', event => {
    if (['batch', 'harvest', 'activity', 'kumbung', 'farm'].includes(event.entity)) refresh();
  }), [subscribe, refresh]);

  const farmBatches = useMemo(() => ops.batches.filter(item => item.farmId === farm?.id), [ops.batches, farm?.id]);
  const kumbungBatches = useMemo(() => farmBatches.filter(item => item.kumbungId === kumbung?.id), [farmBatches, kumbung?.id]);
  const activeBatch = useMemo(
    () => kumbungBatches.filter(item => item.status === 'active').sort((a, b) => b.startedAt - a.startedAt)[0] || null,
    [kumbungBatches],
  );

  // Catatan hari ini + total panen batch berjalan (rekap backend).
  useEffect(() => {
    if (!farm?.id || !kumbung?.id) { setToday(null); return undefined; }
    let active = true;
    api.recap(farm.id, { from: todayJakarta(), to: todayJakarta(), kumbungId: kumbung.id })
      .then(result => active && setToday(result))
      .catch(() => active && setToday({ rows: [], summary: null }));
    return () => { active = false; };
  }, [farm?.id, kumbung?.id, refreshKey]);

  useEffect(() => {
    if (!farm?.id || !activeBatch?.id) { setBatchHarvestKg(null); return undefined; }
    let active = true;
    api.recap(farm.id, { batchId: activeBatch.id, kinds: 'harvest' })
      .then(result => active && setBatchHarvestKg(result.summary.harvestKg))
      .catch(() => active && setBatchHarvestKg(null));
    return () => { active = false; };
  }, [farm?.id, activeBatch?.id, refreshKey]);

  // ── URL: tab & filter rekap
  const tab = ['today', 'batches', 'recap', 'settings'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'today';
  const recapFilter = useMemo(() => ({
    from: searchParams.get('from') || todayJakarta(-29),
    to: searchParams.get('to') || todayJakarta(),
    kumbung: searchParams.get('kumbung') || kumbung?.id || ALL_KUMBUNGS,
    batch: searchParams.get('batch') || '',
    kinds: searchParams.has('kinds') ? searchParams.get('kinds').split(',').filter(kind => ALL_KIND_IDS.includes(kind)) : ALL_KIND_IDS,
    actor: searchParams.get('actor') || '',
  }), [searchParams, kumbung?.id]);

  const updateParams = changes => setSearchParams(current => {
    const next = new URLSearchParams(current);
    Object.entries(changes).forEach(([key, value]) => (value === null || value === undefined || value === '' ? next.delete(key) : next.set(key, value)));
    return next;
  }, { replace: true });
  const setTab = value => updateParams({ tab: value === 'today' ? null : value });
  const setRecapFilter = filter => updateParams({
    from: filter.from, to: filter.to, kumbung: filter.kumbung, batch: filter.batch, actor: filter.actor,
    kinds: filter.kinds.length === ALL_KIND_IDS.length ? null : filter.kinds.join(','),
  });

  // ── Aksi
  const openCorrection = row => {
    const ledger = ops.harvestEvents.find(event => event.id === row.id);
    const source = ledger || { id: row.id, batchId: row.batchId, weightKg: row.weightKg, grade: row.grade, gradeAPct: GRADE_PCT[row.grade] ?? 0, harvestedAt: row.occurredAt, notes: row.notes };
    setDialog({ type: 'harvest', correcting: { ...source, id: row.id }, kumbung: kumbungs.find(item => item.id === row.kumbungId) || kumbung });
  };
  const onQuickAction = action => setDialog({ type: action, kumbung });

  if (contextLoading || (opsLoading && !ops.batches.length && farm)) {
    return <div className="flex min-h-[50vh] items-center justify-center gap-2 text-muted-foreground"><Loader2 className="animate-spin" />Memuat data kumbung…</div>;
  }
  if (!farm) return null; // ContextBar menampilkan ajakan membuat farm

  return (
    <>
      <Helmet><title>Operasional Kumbung - Dashboard Tandurai</title></Helmet>
      <div className={`mx-auto max-w-5xl space-y-4 ${kumbung ? QUICK_BAR_SPACE : 'pb-8'}`}>
        <div>
          <h1 className="text-2xl font-black sm:text-3xl">Operasional Kumbung</h1>
          <p className="text-sm text-muted-foreground">{kumbung ? `${kumbung.name} · catat kegiatan dan panen setiap hari.` : 'Pilih atau buat kumbung untuk mulai mencatat.'}</p>
        </div>

        {!kumbung && !isOwner && (
          <Alert><CircleHelp /><AlertTitle>Belum ada kumbung</AlertTitle><AlertDescription>Minta owner farm membuat kumbung terlebih dahulu.</AlertDescription></Alert>
        )}

        {(kumbung || isOwner) && (
          <Tabs value={kumbung ? tab : 'settings'} onValueChange={setTab} className="space-y-4">
            <TabsList className={`grid h-auto w-full gap-1 p-1 ${isOwner ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <TabsTrigger value="today" className="min-h-11 text-sm" disabled={!kumbung}>Hari Ini</TabsTrigger>
              <TabsTrigger value="batches" className="min-h-11 text-sm" disabled={!kumbung}>Batch</TabsTrigger>
              <TabsTrigger value="recap" className="min-h-11 text-sm" disabled={!kumbung}>Rekap</TabsTrigger>
              {isOwner && <TabsTrigger value="settings" className="min-h-11 text-sm">Atur</TabsTrigger>}
            </TabsList>

            {kumbung && (
              <>
                <TabsContent value="today" className="space-y-4">
                  <TodayPanel
                    kumbung={kumbung} batch={activeBatch} batchHarvestKg={batchHarvestKg} today={today} uid={uid} isOwner={isOwner}
                    onStartBatch={() => setDialog({ type: 'batch', batch: null })}
                    onAdvance={batch => setDialog({ type: 'advance', batch })}
                    onCloseBatch={batch => setDialog({ type: 'close', batch })}
                    onVoid={row => setDialog({ type: 'void', row })}
                    onCorrect={openCorrection}
                  />
                </TabsContent>

                <TabsContent value="batches">
                  <BatchList
                    batches={kumbungBatches} isOwner={isOwner}
                    onStart={() => setDialog({ type: 'batch', batch: null })}
                    onEdit={batch => setDialog({ type: 'batch', batch })}
                    onAdvance={batch => setDialog({ type: 'advance', batch })}
                    onClose={batch => setDialog({ type: 'close', batch })}
                    onRecap={batch => updateParams({ tab: 'recap', batch: batch.id, kumbung: batch.kumbungId })}
                  />
                </TabsContent>

                <TabsContent value="recap">
                  <RecapPanel
                    farm={farm} kumbungs={kumbungs} batches={farmBatches} filter={recapFilter} onFilterChange={setRecapFilter}
                    uid={uid} isOwner={isOwner} refreshKey={refreshKey}
                    onVoid={row => setDialog({ type: 'void', row })} onCorrect={openCorrection}
                  />
                </TabsContent>
              </>
            )}

            {isOwner && (
              <TabsContent value="settings">
                <FarmKumbungSettings
                  farm={farm} kumbungs={kumbungs} selectedKumbungId={kumbung?.id}
                  onSaved={() => { refreshKumbungs(); refreshProfile(); refresh(); }}
                  onKumbungCreated={created => setKumbungId(created.id)}
                />
              </TabsContent>
            )}
          </Tabs>
        )}

        {kumbung && <QuickActions onAction={onQuickAction} desktop={tab === 'today'} />}
      </div>

      <ActivityDialog open={dialog?.type === 'care' || dialog?.type === 'problem'} mode={dialog?.type === 'problem' ? 'problem' : 'care'}
        kumbung={kumbung} batch={activeBatch} onClose={closeDialog} onSaved={refresh} />
      <HarvestDialog open={dialog?.type === 'harvest'} kumbung={dialog?.kumbung || kumbung} batches={farmBatches.filter(item => item.kumbungId === (dialog?.kumbung || kumbung)?.id)}
        defaultBatchId={activeBatch?.id} correcting={dialog?.correcting || null}
        today={today?.summary ? { kg: today.summary.harvestKg, count: today.summary.harvestCount } : null}
        onClose={closeDialog} onSaved={refresh} />
      <BatchWizard open={dialog?.type === 'batch'} kumbung={kumbung} defaultCapacity={kumbung?.capacityBaglog} batch={dialog?.batch || null} onClose={closeDialog} onSaved={refresh} />
      {dialog?.type === 'advance' && <PhaseAdvanceDialog batch={dialog.batch} onClose={closeDialog} onSaved={refresh} />}
      {dialog?.type === 'close' && <BatchCloseDialog batch={dialog.batch} farmId={farm.id} onClose={closeDialog} onSaved={refresh} />}
      {dialog?.type === 'void' && <VoidDialog row={dialog.row} onClose={closeDialog} onSaved={refresh} />}
    </>
  );
}
