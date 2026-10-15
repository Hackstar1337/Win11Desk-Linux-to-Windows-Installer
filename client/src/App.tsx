import { RemoteJobsPage } from "./components/control/remote-install";
import { ProfilesPage, ProfileDetailPage } from "./pages/control/ProfilesPage";
import OperationsPage from "./pages/control/OperationsPage";
import { useEffect, useState } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { loadMe, type User } from "./components/control/api";
import ControlShell from "./components/control/ControlShell";
import {
  LoginPage,
  SetupPage,
  InvitePage,
  RecoveryPage,
} from "./pages/control/AuthPages";
import {
  OverviewPage,
  InstallerPage,
  CommandsPage,
  DeploymentsPage,
  DeploymentDetailPage,
  UsersPage,
  AccountPage,
} from "./pages/control/ControlPages";
import Track from "./pages/Track";
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  const [location, navigate] = useLocation();
  async function refresh() {
    try {
      const me = await loadMe();
      setUser(me?.user || null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, [location]);
  const auth = () => {
    void refresh();
  };
  if (location.startsWith("/track/"))
    return (
      <Switch>
        <Route path="/track/:id" component={Track} />
      </Switch>
    );
  if (
    ["/login", "/setup", "/recovery", "/invite"].some(
      p => location === p || location.startsWith(p + "/")
    )
  )
    return (
      <Switch>
        <Route path="/login">
          {() => <LoginPage onAuthenticated={auth} />}
        </Route>
        <Route path="/setup">
          {() => <SetupPage onAuthenticated={auth} />}
        </Route>
        <Route path="/recovery" component={RecoveryPage} />
        <Route path="/invite">
          {() => <InvitePage onAuthenticated={auth} />}
        </Route>
        <Route path="/invite/:token">
          {() => <InvitePage onAuthenticated={auth} />}
        </Route>
      </Switch>
    );
  if (loading) return <main className="auth-page">Checking session…</main>;
  if (!user) return <LoginPage onAuthenticated={auth} />;
  return (
    <ControlShell user={user}>
      <Switch>
        <Route path="/" component={OverviewPage} />
        <Route path="/installer" component={InstallerPage} />
        <Route path="/commands" component={CommandsPage} />
        <Route path="/remote-jobs">
          {() => <RemoteJobsPage user={user} />}
        </Route>
        <Route path="/deployments/:id">
          {() => <DeploymentDetailPage user={user} />}
        </Route>
        <Route path="/deployments" component={DeploymentsPage} />
        <Route path="/profiles/:id">
          {params => <ProfileDetailPage profileId={params.id} />}
        </Route>
        <Route path="/profiles">{() => <ProfilesPage />}</Route>
        <Route path="/presets">
          <Redirect to="/profiles" replace />
        </Route>
        <Route path="/settings">
          <Redirect to="/profiles" replace />
        </Route>
        <Route path="/users">{() => <UsersPage user={user} />}</Route>
        <Route path="/activity">
          <Redirect to="/operations?removed=activity" replace />
        </Route>
        <Route path="/operations">{() => <OperationsPage user={user} />}</Route>
        <Route path="/account" component={AccountPage} />
        <Route>
          <main className="page-wrap">Page not found.</main>
        </Route>
      </Switch>
    </ControlShell>
  );
}
