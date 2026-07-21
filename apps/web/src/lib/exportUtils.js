
import { toast } from 'sonner';

export const exportToCSV = (data, filename = 'export.csv') => {
  if (!data || !data.length) {
    toast.error('No data to export');
    return;
  }

  const headers = Object.keys(data[0]).join(',');
  const rows = data.map(row => Object.values(row).map(val => `"${val}"`).join(','));
  const csvContent = [headers, ...rows].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  toast.success(`Exported ${filename} successfully`);
};

export const exportToExcel = (data, filename = 'export.xlsx') => {
  // Mocking Excel export to avoid heavy dependencies
  toast.success(`Exported ${filename} successfully (Mock)`);
  exportToCSV(data, filename.replace('.xlsx', '.csv'));
};

export const exportToPDF = (elementId, filename = 'report.pdf') => {
  // Mocking PDF export. In a real app, use html2canvas + jspdf or window.print()
  toast.success(`Exported ${filename} successfully (Mock)`);
  window.print();
};
