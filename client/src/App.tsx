import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { DataProvider } from "./contexts/DataContext";
import { AppLayout } from "./components/AppLayout";
import DailyPulse from "./pages/DailyPulse";
import AgentTrends from "./pages/AgentTrends";
import LeadsPool from "./pages/LeadsPool";
import PipelineIntelligence from "./pages/PipelineIntelligence";
import CoachingMap from "./pages/CoachingMap";
import CoachingDigest from "./pages/CoachingDigest";
import ActivityProfiles from "./pages/ActivityProfiles";
import Settings from "./pages/Settings";
import AgentProfile from "./pages/AgentProfile";

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={DailyPulse} />
        <Route path="/coaching" component={CoachingMap} />
        <Route path="/coaching/digest" component={CoachingDigest} />
        <Route path="/trends" component={AgentTrends} />
        <Route path="/leads-pool" component={LeadsPool} />
        <Route path="/activity" component={ActivityProfiles} />
        <Route path="/pipeline" component={PipelineIntelligence} />
        <Route path="/agent-profile/:name" component={AgentProfile} />
        <Route path="/settings" component={Settings} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <DataProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </DataProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
