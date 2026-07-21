
import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { FileText, Download, Eye, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { exportToPDF, exportToExcel } from '@/lib/exportUtils.js';

export default function ReportsPage() {
  const [previewReport, setPreviewReport] = useState(null);

  const ReportCard = ({ title, description, type }) => (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="text-primary" size={20} />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="text-sm text-muted-foreground">Last generated: Today, 08:00 AM</p>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 pt-4 border-t border-border">
        <Button variant="outline" size="sm" onClick={() => setPreviewReport(type)}>
          <Eye size={14} className="mr-1" /> Preview
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportToPDF('report-content', `${type}_report.pdf`)}>
          <Download size={14} className="mr-1" /> PDF
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportToExcel([], `${type}_report.xlsx`)}>
          <Download size={14} className="mr-1" /> Excel
        </Button>
      </CardFooter>
    </Card>
  );

  return (
    <>
      <Helmet>
        <title>Reports - Tandurai</title>
      </Helmet>

      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Report Center</h1>
          <p className="text-muted-foreground">Generate, view, and export comprehensive farm reports</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <ReportCard title="Daily Report" description="Summary of the last 24 hours" type="daily" />
          <ReportCard title="Weekly Report" description="Performance over the last 7 days" type="weekly" />
          <ReportCard title="Monthly Report" description="Comprehensive 30-day analysis" type="monthly" />
          <ReportCard title="Custom Report" description="Select specific date ranges" type="custom" />
        </div>

        {previewReport && (
          <Card id="report-content" className="mt-8 border-primary/20 shadow-lg">
            <CardHeader className="border-b border-border bg-muted/30 pb-6">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-2xl font-bold text-primary uppercase tracking-wider">Tandurai Farm Report</h2>
                  <p className="text-lg font-medium mt-1 capitalize">{previewReport} Summary</p>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  <p className="flex items-center justify-end gap-1"><Calendar size={14} /> Generated: {new Date().toLocaleDateString()}</p>
                  <p>Farm: Tandurai Main Facility</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-4 bg-muted/50 rounded-lg border border-border">
                  <h4 className="font-semibold mb-2">Temperature Stats</h4>
                  <ul className="space-y-1 text-sm">
                    <li className="flex justify-between"><span>Average:</span> <span className="font-medium">26.4°C</span></li>
                    <li className="flex justify-between"><span>Min/Max:</span> <span className="font-medium">22.1°C / 29.8°C</span></li>
                    <li className="flex justify-between"><span>Compliance:</span> <span className="font-medium text-green-500">94%</span></li>
                  </ul>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg border border-border">
                  <h4 className="font-semibold mb-2">Humidity Stats</h4>
                  <ul className="space-y-1 text-sm">
                    <li className="flex justify-between"><span>Average:</span> <span className="font-medium">78.2%</span></li>
                    <li className="flex justify-between"><span>Min/Max:</span> <span className="font-medium">65.0% / 85.5%</span></li>
                    <li className="flex justify-between"><span>Compliance:</span> <span className="font-medium text-green-500">91%</span></li>
                  </ul>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg border border-border">
                  <h4 className="font-semibold mb-2">Automation Activity</h4>
                  <ul className="space-y-1 text-sm">
                    <li className="flex justify-between"><span>Spray Events:</span> <span className="font-medium">42</span></li>
                    <li className="flex justify-between"><span>Fan Runtime:</span> <span className="font-medium">14h 20m</span></li>
                    <li className="flex justify-between"><span>Efficiency:</span> <span className="font-medium text-green-500">96%</span></li>
                  </ul>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-bold border-b border-border pb-2 mb-4">Alerts Summary</h3>
                <div className="flex gap-4">
                  <div className="flex-1 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-center">
                    <p className="text-2xl font-bold text-red-500">2</p>
                    <p className="text-xs text-red-600 uppercase tracking-wider">Critical</p>
                  </div>
                  <div className="flex-1 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-center">
                    <p className="text-2xl font-bold text-yellow-500">5</p>
                    <p className="text-xs text-yellow-600 uppercase tracking-wider">Warnings</p>
                  </div>
                  <div className="flex-1 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-center">
                    <p className="text-2xl font-bold text-green-500">12</p>
                    <p className="text-xs text-green-600 uppercase tracking-wider">Normal</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
