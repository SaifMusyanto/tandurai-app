import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DataTable from '@/components/DataTable';
import { useFarmContext } from '@/contexts/FarmContext';
import { api } from '@/lib/api';
import { ROLE_LABELS, formatDate, timeAgo } from './adminFormat';

const FILTERS = [
  ['all', 'Semua akun'],
  ['owner', 'Owner farm'],
  ['operator', 'Operator'],
  ['nofarm', 'Belum punya farm'],
  ['unverified', 'Email belum terverifikasi'],
  ['admin', 'Admin Tandurai'],
];

/** Konsol admin: semua akun, farm & perannya, status verifikasi, dan aktivitas terakhir. */
export default function AdminUsersPage() {
  const { enterFarmAsAdmin } = useFarmContext();
  const navigate = useNavigate();
  const [users, setUsers] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api.adminUsers().then(setUsers).catch(error => { toast.error(error.message); setUsers([]); });
  }, []);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const active = user => user.farms.filter(farm => farm.status === 'active');
    return (users || []).filter(user => {
      if (term && ![user.email, user.username, user.uid, ...user.farms.map(farm => farm.farmName)].some(value => String(value || '').toLowerCase().includes(term))) return false;
      if (filter === 'owner') return active(user).some(farm => farm.role === 'owner');
      if (filter === 'operator') return active(user).some(farm => farm.role === 'operator');
      if (filter === 'nofarm') return !active(user).length;
      if (filter === 'unverified') return !user.emailVerified;
      if (filter === 'admin') return user.isAdmin;
      return true;
    });
  }, [users, search, filter]);

  const openFarm = farmId => { enterFarmAsAdmin(farmId); navigate('/'); };

  const columns = [
    {
      key: 'account', header: 'Akun', cell: user => (
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{user.username || user.email || user.uid}</p>
          {user.username && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
          <div className="mt-1 flex flex-wrap gap-1">
            {user.isAdmin && <Badge className="bg-violet-600 text-[10px]">Admin</Badge>}
            {!user.emailVerified && <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-700">belum verifikasi</Badge>}
          </div>
        </div>
      ),
    },
    { key: 'lastSeen', header: 'Terakhir aktif', className: 'whitespace-nowrap text-sm', cell: user => timeAgo(user.lastSeenAt) },
    {
      key: 'farms', header: 'Farm & peran', hideOnMobile: true, cell: user => (user.farms.length ? (
        <div className="flex flex-wrap gap-1">
          {user.farms.map(farm => (
            <button key={farm.farmId} type="button" onClick={() => openFarm(farm.farmId)} title="Buka dashboard farm"
              className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted">
              {farm.farmName} · {ROLE_LABELS[farm.role]}{farm.status !== 'active' ? ' (nonaktif)' : ''}
            </button>
          ))}
        </div>
      ) : <span className="text-xs text-muted-foreground">Belum punya farm</span>),
    },
    { key: 'created', header: 'Terdaftar', hideOnMobile: true, className: 'whitespace-nowrap text-sm text-muted-foreground', cell: user => formatDate(user.createdAt) },
  ];

  return (
    <>
      <Helmet><title>Pengguna - Konsol Admin</title></Helmet>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Pengguna</h1>
          <p className="text-sm text-muted-foreground">Semua akun yang pernah login ke Dashboard Tandurai{users ? ` · ${users.length} akun` : ''}.</p>
        </div>
        <Card>
          <CardContent className="space-y-3 p-3 sm:p-5">
            <div className="grid gap-2 sm:flex">
              <div className="relative sm:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari email, nama, atau farm" className="h-10 pl-9" />
              </div>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="h-10 sm:w-56" aria-label="Filter akun"><SelectValue /></SelectTrigger>
                <SelectContent>{FILTERS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <DataTable columns={columns} rows={rows} rowKey={user => user.uid} loading={users === null} pageSize={20}
              emptyText={search || filter !== 'all' ? 'Tidak ada akun yang cocok.' : 'Belum ada akun.'} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
