import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppStateProvider } from './state';
import { MainLayout } from './components/layout/MainLayout';
import { OverviewPage } from './pages/OverviewPage';
import { QueuePage } from './pages/QueuePage';
import { AlertDetailPage } from './pages/AlertDetailPage';
import { WorksPage } from './pages/WorksPage';
import { WorkDetailPage } from './pages/WorkDetailPage';
import { AgenciesPage } from './pages/AgenciesPage';
import { CompliancePage } from './pages/CompliancePage';
import { DigestPage } from './pages/DigestPage';
import { RulesPage } from './pages/RulesPage';
import { AuditPage } from './pages/AuditPage';
import { IngestPage } from './pages/IngestPage';
import { EvaluationPage } from './pages/EvaluationPage';
import { CalibrationPage } from './pages/CalibrationPage';
import { ReadinessPage } from './pages/ReadinessPage';
import { InspectionListPage } from './pages/InspectionListPage';
import { InspectionFormPage } from './pages/InspectionFormPage';
import { PublicListPage } from './pages/PublicListPage';
import { PublicDetailPage } from './pages/PublicDetailPage';

function App() {
  return (
    <AppStateProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            {/* Casework Screens */}
            <Route index element={<OverviewPage />} />
            <Route path="alerts" element={<QueuePage />} />
            <Route path="alerts/:id" element={<AlertDetailPage />} />
            <Route path="works" element={<WorksPage />} />
            <Route path="works/:id" element={<WorkDetailPage />} />
            <Route path="agencies" element={<AgenciesPage />} />
            <Route path="compliance" element={<CompliancePage />} />
            <Route path="digest" element={<DigestPage />} />

            {/* How It Decides & Rigor */}
            <Route path="rules" element={<RulesPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="ingest" element={<IngestPage />} />
            <Route path="evaluation" element={<EvaluationPage />} />
            <Route path="calibration" element={<CalibrationPage />} />
            <Route path="readiness" element={<ReadinessPage />} />

            {/* Field PWA */}
            <Route path="inspection" element={<InspectionListPage />} />
            <Route path="inspection/new" element={<InspectionFormPage />} />

            {/* Citizen Transparency Portal */}
            <Route path="public" element={<PublicListPage />} />
            <Route path="public/:id" element={<PublicDetailPage />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppStateProvider>
  );
}

export default App;
