import React, { lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import DashboardLayout from "@/components/DashboardLayout";
import { ProtectedRoute, PublicOnlyRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { EmptyState } from "@/components/EmptyState";

// Every page but the first screens loads on demand, so the initial download stays small.
const Requirements = lazy(() => import("./pages/Requirements"));
const SyntheticData = lazy(() => import("./pages/SyntheticData"));
const TestExecution = lazy(() => import("./pages/TestExecution"));
const Prioritization = lazy(() => import("./pages/Prioritization"));
const LiveTestRunner = lazy(() => import("./pages/LiveTestRunner"));
const CodeReview = lazy(() => import("./pages/CodeReview"));
const CIIntelligence = lazy(() => import("./pages/CIIntelligence"));
const DefectPrediction = lazy(() => import("./pages/DefectPrediction"));
const GeneratedTests = lazy(() => import("./pages/GeneratedTests"));
const Incidents = lazy(() => import("./pages/Incidents"));
const Monitoring = lazy(() => import("./pages/Monitoring"));
const ReleaseGate = lazy(() => import("./pages/ReleaseGate"));
const RequirementsIntelligence = lazy(() => import("./pages/RequirementsIntelligence"));
const Workspace = lazy(() => import("./pages/Workspace"));
const CodeImpact = lazy(() => import("./pages/CodeImpact"));
const DocTests = lazy(() => import("./pages/DocTests"));
const PRDGenerator = lazy(() => import("./pages/PRDGenerator"));
const UserProfile = lazy(() => import("./pages/UserProfile"));
const Deployments = lazy(() => import("./pages/Deployments"));
const ApiCosts = lazy(() => import("./pages/ApiCosts"));
const AiIde = lazy(() => import("./pages/AiIde"));
const RepoBaseline = lazy(() => import("./pages/RepoBaseline"));
const RootCauseAnalysis = lazy(() => import("@/pages/RootCauseAnalysis"));
const RootCauseDetail = lazy(() => import("@/pages/RootCauseDetail"));
const TestSelection = lazy(() => import("@/pages/TestSelection"));
const SelfHealingTests = lazy(() => import("@/pages/SelfHealingTests"));
const ConnectorsSettings = lazy(() => import("@/pages/ConnectorsSettings"));
const Projects = lazy(() => import("@/pages/Projects"));
const ProjectView = lazy(() => import("@/pages/ProjectView"));

function RootRedirect() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page">
        <EmptyState kind="loading">Checking your session…</EmptyState>
      </div>
    );
  }
  return <Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />;
}

function App() {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<Login />} />
        </Route>
        <Route path="/v1" element={<Navigate to="/" replace />} />
        <Route path="/v1/*" element={<Navigate to="/" replace />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectView />} />
            <Route path="/requirements" element={<Requirements />} />
            <Route path="/synthetic-data" element={<SyntheticData />} />
            <Route path="/test-execution" element={<TestExecution />} />
            <Route path="/prioritization" element={<Prioritization />} />
            <Route path="/live-testing" element={<LiveTestRunner />} />
            <Route path="/live-test-runner" element={<LiveTestRunner />} />
            <Route path="/code-review" element={<CodeReview />} />
            <Route path="/ci-intelligence" element={<CIIntelligence />} />
            <Route path="/defect-prediction" element={<DefectPrediction />} />
            <Route path="/generated-tests" element={<GeneratedTests />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/monitoring" element={<Monitoring />} />
            <Route path="/release-gate" element={<ReleaseGate />} />
            <Route path="/requirements-intelligence" element={<RequirementsIntelligence />} />
            <Route path="/workspace" element={<Workspace />} />
            {/* The SDLC Pipeline page was retired in favour of the project view. */}
            <Route path="/pipeline" element={<Navigate to="/projects" replace />} />
            <Route path="/deployments" element={<Deployments />} />
            <Route path="/code-impact" element={<CodeImpact />} />
            <Route path="/doc-tests" element={<DocTests />} />
            <Route path="/prd" element={<PRDGenerator />} />
            <Route path="/profile" element={<UserProfile />} />
            <Route path="/settings/connectors" element={<ConnectorsSettings />} />
            <Route path="/cost-tracker" element={<ApiCosts />} />
            <Route path="/ai-ide" element={<AiIde />} />
            <Route path="/repo-baseline" element={<RepoBaseline />} />
            <Route path="/root-cause" element={<RootCauseAnalysis />} />
            <Route path="/root-cause/:id" element={<RootCauseDetail />} />
            <Route path="/test-selection" element={<TestSelection />} />
            <Route path="/self-healing" element={<SelfHealingTests />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
