import { useAuth } from "../lib/authContext";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

export function DashboardPage() {
  const { user } = useAuth();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-slate-600">
          Signed in as <strong>{user?.email ?? user?.id}</strong> ({user?.role.replace("_", " ")}).
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Role-specific dashboards with real data land in Step 1.5d. This is the app shell
          landing page for now.
        </p>
      </CardContent>
    </Card>
  );
}
