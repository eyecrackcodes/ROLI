import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { DataProvider } from "./contexts/DataContext";
import { AppLayout } from "./components/AppLayout";
import DailyPulse from "./pages/DailyPulse";
import MonthlyStackRank from "./pages/MonthlyStackRank";
import GateCalculator from "./pages/GateCalculator";
import DataManager from "./pages/DataManager";
import AgentTrends from "./pages/AgentTrends";
import BonusTracker from "./pages/BonusTracker";
import LeadsPool from "./pages/LeadsPool";
import Settings from "./pages/Settings";

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={DailyPulse} />
        <Route path="/stack-rank" component={MonthlyStackRank} />
        <Route path="/trends" component={AgentTrends} />
        <Route path="/bonus" component={BonusTracker} />
        <Route path="/leads-pool" component={LeadsPool} />
        <Route path="/gates" component={GateCalculator} />
        <Route path="/data" component={DataManager} />
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
