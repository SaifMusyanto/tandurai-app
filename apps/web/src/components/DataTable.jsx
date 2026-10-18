import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Tabel standar dashboard dengan pagination di sisi klien: hanya baris halaman aktif yang
 * dirender, sehingga daftar panjang (log, histori) tetap ringan.
 *
 * columns: [{ key, header, cell?: row => node, className?, headerClassName?, hideOnMobile? }]
 *   hideOnMobile: kolom disembunyikan di layar sempit (< sm) dan tampil di panel detail saat
 *   tombol segitiga baris ditekan — tabel muat di layar HP tanpa geser horizontal.
 * rows: array data; rowKey: row => string (default row.id)
 */
export default function DataTable({
  columns, rows, rowKey = row => row.id, pageSize = 10, loading = false, emptyText = 'Belum ada data.',
  rowClassName, className,
}) {
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set());
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const hidden = columns.filter(column => column.hideOnMobile);
  const collapsible = hidden.length > 0;
  // Jumlah kolom yang tampil di HP (untuk colSpan panel detail) dan di layar lebar.
  const mobileSpan = columns.length - hidden.length + (collapsible ? 1 : 0);
  const desktopSpan = columns.length;

  // Data berkurang (filter/hapus) → jangan tertinggal di halaman yang sudah tidak ada.
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const visible = useMemo(() => rows.slice(page * pageSize, (page + 1) * pageSize), [rows, page, pageSize]);
  const from = rows.length ? page * pageSize + 1 : 0;
  const to = Math.min(rows.length, (page + 1) * pageSize);

  const toggle = key => setExpanded(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const cellClass = column => cn('py-2', column.className, column.hideOnMobile && 'hidden sm:table-cell');

  const message = content => (
    <TableRow>
      <TableCell colSpan={desktopSpan + (collapsible ? 1 : 0)} className="py-8 text-center text-sm text-muted-foreground">{content}</TableCell>
    </TableRow>
  );

  return (
    <div className={cn('space-y-3', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {collapsible && <TableHead className="w-8 px-1 sm:hidden"><span className="sr-only">Detail</span></TableHead>}
            {columns.map(column => (
              <TableHead key={column.key} className={cn('text-xs', column.headerClassName, column.hideOnMobile && 'hidden sm:table-cell')}>{column.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? message(<span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Memuat…</span>)
            : !rows.length ? message(emptyText)
              : visible.map((row, index) => {
                const key = rowKey(row, index);
                const open = expanded.has(key);
                return (
                  <Fragment key={key}>
                    <TableRow className={rowClassName?.(row)}>
                      {collapsible && (
                        <TableCell className="w-8 px-1 py-2 sm:hidden">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggle(key)} aria-expanded={open} aria-label={open ? 'Tutup detail' : 'Lihat detail'}>
                            <ChevronDown size={14} className={cn('transition-transform', !open && '-rotate-90')} />
                          </Button>
                        </TableCell>
                      )}
                      {columns.map(column => (
                        <TableCell key={column.key} className={cellClass(column)}>
                          {column.cell ? column.cell(row) : row[column.key]}
                        </TableCell>
                      ))}
                    </TableRow>
                    {collapsible && open && (
                      <TableRow className="sm:hidden bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={mobileSpan} className="py-2">
                          <dl className="space-y-2 text-sm">
                            {hidden.map(column => (
                              <div key={column.key} className="flex flex-col gap-0.5">
                                <dt className="text-[11px] text-muted-foreground">{column.header}</dt>
                                <dd>{column.cell ? column.cell(row) : row[column.key]}</dd>
                              </div>
                            ))}
                          </dl>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
        </TableBody>
      </Table>

      {!loading && rows.length > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Menampilkan {from}–{to} dari {rows.length}</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-8" onClick={() => setPage(current => current - 1)} disabled={page === 0} aria-label="Halaman sebelumnya">
              <ChevronLeft size={14} />
            </Button>
            <span className="px-2">Halaman {page + 1} / {pageCount}</span>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setPage(current => current + 1)} disabled={page >= pageCount - 1} aria-label="Halaman berikutnya">
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
